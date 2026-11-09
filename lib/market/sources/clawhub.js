/**
 * The ClawHub adapter.
 *
 * Shapes taken from a live run against `clawhub.ai`:
 *
 * - list: `GET /api/v1/skills?limit&cursor&sort` answers `{items, nextCursor}`; the
 *   default order is already "recently active first", and `sort=downloads` is the only
 *   other order that answers JSON (`sort=top` does not);
 * - search: `GET /api/v1/search?q&limit` answers `{results}` with **no** cursor and a
 *   shallower item than the list endpoint - no version, no category;
 * - detail: `GET /api/v1/skills/<slug>?ownerHandle=` answers `{skill, latestVersion}`,
 *   and `skill.description` is the whole `SKILL.md`, frontmatter included;
 * - package: `GET /api/v1/download?slug=&ownerHandle=&version=` answers a zip.
 *
 * The package is downloaded once per plan and kept in memory: `fetchFile` inflates the
 * entry out of that buffer, so a ten-file install costs one request, not ten.
 */
import { marketError } from '../errors.js';
import { buildUrl, encodeCursor } from '../query.js';
import {
  clawhubIconUrl,
  declaredNameOf,
  fromClawhubDetail,
  fromClawhubListItem,
  fromClawhubSearchItem,
  isObject,
  nameIsValid,
  overviewOf,
  sortByUpdatedDesc,
  textOrNull,
} from '../normalize.js';
import { FILE_TIMEOUT_MS, READ_TIMEOUT_MS, mapLimit } from '../upstream.js';
import { ZIP_LIMITS, readZipEntries, readZipEntry } from '../zip.js';

/** The one origin this adapter may call. */
export const ORIGIN = 'https://clawhub.ai';

/** Entry point every skill package must carry. */
const FIRST_FILE = 'SKILL.md';

/** How long a resolved icon stays in memory. */
const ICON_TTL_MS = 10 * 60 * 1000;

/** How long "this skill has no icon" stays in memory; short, so a fix shows up. */
const ICON_MISS_TTL_MS = 60 * 1000;

/** How many icon lookups run at once. */
const ICON_CONCURRENCY = 4;

/** Budget for one `POST market/icons` batch. */
const BATCH_BUDGET_MS = 6000;

/** Budget for one detail request inside a batch. */
const BATCH_TIMEOUT_MS = 5000;

/** `clawhub:<owner>:<slug>` -> `{at, iconUrl}`. */
const iconCache = new Map();

/**
 * Forget every remembered icon (tests, and bootstrap with `?refresh=1`).
 * @returns {void}
 */
export function resetIconCache() {
  iconCache.clear();
}

/**
 * Attach an icon the payload already carried, without spending a request.
 * @param {unknown} raw - upstream item.
 * @param {object|null} item - its normalised form.
 * @returns {object|null} the item, or null when the raw entry was not an object.
 */
function withCarriedIcon(raw, item) {
  if (item === null) return null;
  const iconUrl = carriedIcon(raw);
  return iconUrl === null ? item : { ...item, iconUrl };
}

/**
 * Build the one error this adapter raises for a malformed upstream answer.
 * @param {string} message - what is missing.
 * @returns {import('../errors.js').MarketError} an E_SOURCE_BAD_RESPONSE error.
 */
function badResponse(message) {
  return marketError('E_SOURCE_BAD_RESPONSE', message);
}

/**
 * Read the upstream cursor out of our own cursor token.
 * @param {Record<string, unknown>|null} cursor - decoded cursor.
 * @returns {string|null} the upstream cursor, or null for the first page.
 * @throws {import('../errors.js').MarketError} with code E_BAD_QUERY when the cursor is not ours.
 */
function upstreamCursorOf(cursor) {
  if (cursor === null || cursor === undefined) return null;
  const value = cursor.cursor;
  if (typeof value !== 'string' || value === '' || value.length > 256) {
    throw marketError('E_BAD_QUERY', 'this cursor was not issued for this source');
  }
  return value;
}

/**
 * Read one detail payload.
 * @param {{owner: string, slug: string}} ref - item reference.
 * @param {object} io - upstream client.
 * @returns {Promise<object>} the upstream body.
 */
async function readDetail(ref, io) {
  const body = await io.getJson(
    buildUrl(ORIGIN, `/api/v1/skills/${encodeURIComponent(ref.slug)}`, { ownerHandle: ref.owner }),
    { timeoutMs: READ_TIMEOUT_MS },
  );
  if (!isObject(body.skill)) throw badResponse('the clawhub detail payload carries no skill');
  return body;
}

/**
 * Read the latest version of one skill.
 * @param {{owner: string, slug: string}} ref - item reference.
 * @param {object} io - upstream client.
 * @returns {Promise<string>} the version.
 */
async function latestVersion(ref, io) {
  const body = await readDetail(ref, io);
  const version = textOrNull(body.latestVersion?.version)
    ?? textOrNull(body.skill.version)
    ?? textOrNull(body.skill.tags?.latest);
  if (version === null) throw badResponse('the clawhub detail payload carries no version');
  return version;
}

/**
 * Download and index one package without expanding anything yet.
 * @param {{owner: string, slug: string, version: string|null}} ref - item reference.
 * @param {object} io - upstream client.
 * @returns {Promise<{buffer: Buffer, entries: object[], meta: object|null, metaBytes: Buffer|null}>} the package.
 */
async function downloadPackage(ref, io) {
  const result = await io.getBytes(
    buildUrl(ORIGIN, '/api/v1/download', {
      slug: ref.slug,
      ownerHandle: ref.owner,
      version: ref.version,
    }),
    { timeoutMs: FILE_TIMEOUT_MS, maxBytes: ZIP_LIMITS.archive },
  );
  const entries = readZipEntries(result.body);
  let meta = null;
  let metaBytes = null;
  const metaEntry = entries.find((entry) => entry.path === '_meta.json');
  if (metaEntry !== undefined) {
    metaBytes = readZipEntry(result.body, metaEntry);
    try {
      const parsed = JSON.parse(metaBytes.toString('utf8'));
      meta = isObject(parsed) ? parsed : null;
    } catch {
      meta = null;
    }
  }
  return { buffer: result.body, entries, meta, metaBytes };
}

/**
 * The icon of one skill, from the cache or from its detail payload.
 *
 * The list endpoint carries no icon at all, so a page of cards has to ask the detail
 * endpoint one skill at a time. Every failure is a miss, never an error: an icon is
 * decoration, and a card without one is still a working card.
 * @param {{owner: string|null, slug: string|null}} ref - item identity.
 * @param {object} io - upstream client.
 * @param {() => number} clock - injected clock.
 * @param {number} timeoutMs - budget for this one request.
 * @returns {Promise<string|null>} the icon URL, or null.
 */
async function iconOf(ref, io, clock, timeoutMs) {
  if (typeof ref.owner !== 'string' || ref.owner === '' || typeof ref.slug !== 'string' || ref.slug === '') {
    return null;
  }
  const key = `clawhub:${ref.owner}:${ref.slug}`;
  const hit = iconCache.get(key);
  if (hit !== undefined) {
    const ttl = hit.iconUrl === null ? ICON_MISS_TTL_MS : ICON_TTL_MS;
    if (clock() - hit.at < ttl) return hit.iconUrl;
  }
  let iconUrl = null;
  try {
    const body = await io.getJson(
      buildUrl(ORIGIN, `/api/v1/skills/${encodeURIComponent(ref.slug)}`, { ownerHandle: ref.owner }),
      { timeoutMs },
    );
    const skill = isObject(body?.skill) ? body.skill : {};
    iconUrl = clawhubIconUrl(skill.icon ?? skill.iconUrl);
  } catch {
    iconUrl = null;
  }
  iconCache.set(key, { at: clock(), iconUrl });
  return iconUrl;
}

/**
 * The cheap half of icon resolution: an icon the payload already carries.
 *
 * This costs nothing - no request, no cache - so the list keeps it. Everything the list
 * does not carry is left null and filled in later by the batch route, which is what keeps
 * a page of cards fast (the detail endpoint answers in two to three seconds on this source).
 * @param {unknown} raw - upstream item, list or search shape.
 * @returns {string|null} the icon URL, or null.
 */
function carriedIcon(raw) {
  const record = isObject(raw) ? raw : {};
  const nested = isObject(record.native) && isObject(record.native.skill) ? record.native.skill : {};
  return clawhubIconUrl(record.icon ?? record.iconUrl ?? nested.icon);
}

/**
 * Resolve icons for one batch of skills, for `POST market/icons`.
 *
 * This is the progressive half: the browser asks once per visible page of cards and patches
 * them when the answer arrives, so nothing waits on a slow detail endpoint. Four at a time,
 * six seconds for the whole batch, five per lookup; whatever misses the budget is null and
 * the card keeps its letter avatar.
 * @param {{owner: string, slug: string}[]} refs - skills to resolve, already validated.
 * @param {object} io - upstream client.
 * @param {{now?: () => number}} [options] - clock, for tests.
 * @returns {Promise<Record<string, string|null>>} `clawhub:<owner>:<slug>` -> icon URL or null.
 */
async function icons(refs, io, options = {}) {
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  const deadline = clock() + BATCH_BUDGET_MS;
  const values = new Map();
  await mapLimit(refs, ICON_CONCURRENCY, async (ref) => {
    const key = `clawhub:${ref.owner}:${ref.slug}`;
    const left = deadline - clock();
    values.set(key, left <= 0
      ? null
      : await iconOf(ref, io, clock, Math.max(300, Math.min(BATCH_TIMEOUT_MS, left))));
  });
  // Answer in request order: nine lookups racing four ways finish out of order, and a
  // response whose key order changes between two identical calls is needlessly hard to
  // read (and to diff in a test).
  const resolved = {};
  for (const ref of refs) {
    const key = `clawhub:${ref.owner}:${ref.slug}`;
    resolved[key] = values.get(key) ?? null;
  }
  return resolved;
}

/**
 * One page of the catalogue.
 *
 * ClawHub has no category table, so a request that carries a category is answered with
 * an empty page rather than silently ignoring the filter.
 * @param {object} query - normalised list query.
 * @param {object} io - upstream client.
 * @returns {Promise<{items: object[], next: string|null, total: number|null}>} the page.
 */
async function list(query, io) {
  if (query.category !== null) return { items: [], next: null, total: null };
  const params = { limit: query.limit, cursor: upstreamCursorOf(query.cursor) };
  if (query.sort === 'downloads') params.sort = 'downloads';
  const body = await io.getJson(buildUrl(ORIGIN, '/api/v1/skills', params), { timeoutMs: READ_TIMEOUT_MS });
  if (!Array.isArray(body.items)) throw badResponse('the clawhub list payload carries no items array');
  const items = body.items
    .map((raw) => withCarriedIcon(raw, fromClawhubListItem(raw)))
    .filter(Boolean);
  const next = typeof body.nextCursor === 'string' && body.nextCursor !== ''
    ? encodeCursor({ cursor: body.nextCursor })
    : null;
  return {
    items: query.sort === 'updated' ? sortByUpdatedDesc(items) : items,
    next,
    total: null,
  };
}

/**
 * One page of search results. The endpoint has no cursor, so the first page is the
 * only page and `next` is always null.
 * @param {object} query - normalised list query.
 * @param {object} io - upstream client.
 * @returns {Promise<{items: object[], next: string|null, total: number|null}>} the page.
 */
async function search(query, io) {
  if (query.keyword === '') throw marketError('E_BAD_QUERY', 'search needs a keyword');
  if (query.category !== null) return { items: [], next: null, total: null };
  const body = await io.getJson(
    buildUrl(ORIGIN, '/api/v1/search', { q: query.keyword, limit: query.limit }),
    { timeoutMs: READ_TIMEOUT_MS },
  );
  if (!Array.isArray(body.results)) throw badResponse('the clawhub search payload carries no results array');
  const items = body.results
    .map((raw) => withCarriedIcon(raw, fromClawhubSearchItem(raw)))
    .filter(Boolean);
  return { items, next: null, total: null };
}

/**
 * Detail of one skill.
 *
 * The overview is derived from `skill.description`, which is the whole `SKILL.md`. The
 * package is downloaded only to list its files; that download is a few kilobytes and it
 * is the only way this source can answer "which files would land on disk".
 * @param {{owner: string, slug: string, version: string|null}} ref - item reference.
 * @param {object} io - upstream client.
 * @returns {Promise<object>} the MarketDetail payload (without `installTo`).
 */
async function detail(ref, io) {
  const body = await readDetail(ref, io);
  const item = fromClawhubDetail(isObject(body) ? { ...body, owner: body.owner ?? { handle: ref.owner } } : body);
  if (item === null) throw badResponse('the clawhub detail payload could not be normalised');
  const full = typeof body.skill.description === 'string' ? body.skill.description : '';
  const declaredName = declaredNameOf(full);
  let files = [];
  let filesComplete = false;
  try {
    const downloaded = await downloadPackage({ owner: ref.owner, slug: ref.slug, version: ref.version }, io);
    files = downloaded.entries.map((entry) => ({ path: entry.path, size: entry.size }));
    filesComplete = true;
  } catch (error) {
    if (typeof error?.code === 'string' && error.code.startsWith('E_SOURCE_')) throw error;
    // A package this reader refuses is still worth a detail view: the overview comes
    // from the description, and the file section says the listing may be incomplete.
    files = [];
    filesComplete = false;
  }
  return {
    item,
    overview: overviewOf(full, item.summary),
    declaredName,
    nameValid: nameIsValid(declaredName),
    files,
    filesComplete,
  };
}

/**
 * Resolve the package of one skill: version plus a downloaded zip.
 * @param {{owner: string, slug: string, version: string|null}} ref - item reference.
 * @param {object} io - upstream client.
 * @returns {Promise<object>} the SourcePlan.
 */
async function plan(ref, io) {
  const version = ref.version ?? await latestVersion(ref, io);
  const packagePlan = await downloadPackage({ owner: ref.owner, slug: ref.slug, version }, io);
  if (!packagePlan.entries.some((entry) => entry.path === FIRST_FILE)) {
    throw marketError('E_PACKAGE_INVALID', 'the clawhub package does not contain SKILL.md');
  }
  return {
    sourceId: 'clawhub',
    owner: ref.owner,
    slug: ref.slug,
    version,
    packageKind: 'zip',
    files: packagePlan.entries.map((entry) => ({
      path: entry.path,
      size: entry.size,
      sha256: null,
      crc32: entry.crc32,
    })),
    meta: packagePlan.meta,
    metaBytes: packagePlan.metaBytes,
    zip: { buffer: packagePlan.buffer, entries: packagePlan.entries },
  };
}

/**
 * Fetch one entry of a planned package out of the buffer taken during `plan`.
 * @param {object} packagePlan - SourcePlan carrying the zip.
 * @param {string} path - entry path.
 * @returns {Promise<Buffer>} the entry bytes.
 */
async function fetchFile(packagePlan, path) {
  const zip = packagePlan.zip;
  if (!isObject(zip) || !Buffer.isBuffer(zip.buffer) || !Array.isArray(zip.entries)) {
    throw marketError('E_PACKAGE_INVALID', 'the clawhub package was not downloaded for this install');
  }
  const entry = zip.entries.find((candidate) => candidate.path === path);
  if (entry === undefined) throw marketError('E_PACKAGE_INVALID', `the clawhub package does not contain ${path}`);
  return readZipEntry(zip.buffer, entry);
}

/** The ClawHub adapter. */
export const clawhubSource = {
  id: 'clawhub',
  labelKey: 'market.source.clawhub',
  caps: { search: true, paged: true, categories: false, package: 'zip' },
  list,
  search,
  detail,
  plan,
  fetchFile,
  icons,
};
