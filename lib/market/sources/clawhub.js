/**
 * The ClawHub adapter - a hybrid of two upstreams.
 *
 * ClawHub's own API has no numbers for its cards: the list carries no downloads, no stars
 * and no score, and no icon address either. The SkillHub mirror publishes the same
 * catalogue *with* those facts (`api.skillhub.cn/api/skills?source=clawhub`), so the
 * catalogue half is read there and the package half here:
 *
 * - list / search: `GET {mirror}/api/skills?page&pageSize&sortBy&order&category&keyword
 *   &source=clawhub` answers `{data: {skills, total}}`, one SkillHub-shaped row per
 *   ClawHub skill, each carrying `upstream_owner_login` (the native owner), `downloads`,
 *   `stars`, `score`, `iconUrl`, `category` and `subCategories`. Because the endpoint
 *   takes a keyword, search pages too;
 * - detail: `GET /api/v1/skills/<slug>?ownerHandle=` here answers `{skill, latestVersion}`,
 *   and `skill.description` is the whole `SKILL.md`, frontmatter included - the mirror's
 *   own overview field is empty. The numbers on that view are then overlaid from one
 *   mirror *list* lookup, so a card and its detail page never disagree;
 * - package: `GET /api/v1/download?slug=&ownerHandle=&version=` answers a zip.
 *
 * The package is downloaded once per plan and kept in memory: `fetchFile` inflates the
 * entry out of that buffer, so a ten-file install costs one request, not ten.
 *
 * **Installs never touch the mirror.** Its file listing was measured in three shapes -
 * seventeen files (complete), `SKILL.md` + `_meta.json`, and *zero* files - so a package
 * taken from it can land on disk as a skeleton and still be recorded as a success. The
 * mirror answers catalogue facts; only `clawhub.ai` answers package facts. Every `io`
 * call in `plan` / `fetchFile` below targets `ORIGIN`, and that is the line this file
 * must never cross (see docs/contracts/market.md 7.8).
 */
import { marketError } from '../errors.js';
import { SORT_PARAMS, buildUrl, encodeCursor, pageOf } from '../query.js';
import {
  clawhubIconUrl,
  declaredNameOf,
  finiteOrNull,
  fromClawhubDetail,
  fromClawhubMirrorItem,
  isObject,
  nameIsValid,
  numberOrNull,
  overviewOf,
  skillhubIconUrl,
  sortByUpdatedDesc,
  textOrNull,
} from '../normalize.js';
import { FILE_TIMEOUT_MS, READ_TIMEOUT_MS, mapLimit } from '../upstream.js';
import { ZIP_LIMITS, readZipEntries, readZipEntry } from '../zip.js';
// The mirror is SkillHub's own API, so its origin is declared exactly once, over there.
import { ORIGIN as SKILLHUB_ORIGIN } from './skillhub.js';

/** The one origin this adapter's package half may call. */
export const ORIGIN = 'https://clawhub.ai';

/** Entry point every skill package must carry. */
const FIRST_FILE = 'SKILL.md';

/** How many mirror rows one detail overlay may look through; the match is exact. */
const MIRROR_LOOKUP_PAGE = 20;

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

/** `clawhub:<owner>:<slug>` -> `{at, iconUrl, displayName}`. */
const iconCache = new Map();

/**
 * Forget every remembered icon (tests, and bootstrap with `?refresh=1`).
 * @returns {void}
 */
export function resetIconCache() {
  iconCache.clear();
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
 * The next cursor, or null when this page is the last.
 *
 * This is deliberately **not** SkillHub's rule: normalisation drops rows whose owner
 * cannot be derived, so a page can come back short and still have a page after it.
 * "Short" is therefore no evidence of the end; only an empty page, or the upstream
 * `total` being reached, is. (SkillHub keeps its own `count < limit` rule because it
 * drops nothing - see its `nextCursor`.)
 * @param {number} page - page just served.
 * @param {number} limit - page size.
 * @param {number} count - raw rows the mirror returned, before any row was dropped.
 * @param {number|null} total - upstream total, when reported.
 * @returns {string|null} the opaque cursor.
 */
function nextCursor(page, limit, count, total) {
  if (count === 0) return null;
  if (total !== null && page * limit >= total) return null;
  return encodeCursor({ page: page + 1 });
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
 * The mirror's own facts for one skill: the numbers the card shows.
 *
 * The mirror's *detail* endpoint is not usable here: it keys on `namespace`, and a claimed
 * ClawHub namespace does not carry the `clawhub_` prefix (measured: `find-skills` lives in
 * `indiv-guipi`), so guessing the prefix misses those rows for good. This asks the mirror's
 * *list* for the slug instead and keeps the row whose `slug` and `upstream_owner_login` both
 * match - the slug alone is not unique across owners (`find-skills` vs `find-skills-robin`).
 *
 * Every failure is an empty override, never an error: the detail view already has an
 * answer from `clawhub.ai`, and a decorator must not take the page down.
 * @param {{owner: string, slug: string}} ref - item reference.
 * @param {object} io - upstream client.
 * @returns {Promise<object>} the overriding fields, `{}` when nothing matched.
 */
async function mirrorFactsOf(ref, io) {
  try {
    const body = await io.getJson(
      buildUrl(SKILLHUB_ORIGIN, '/api/skills', {
        page: 1,
        pageSize: MIRROR_LOOKUP_PAGE,
        source: 'clawhub',
        keyword: ref.slug,
      }),
      { timeoutMs: READ_TIMEOUT_MS },
    );
    const rows = Array.isArray(body?.data?.skills) ? body.data.skills : [];
    const hit = rows.find((raw) => isObject(raw)
      && textOrNull(raw.slug) === ref.slug
      && textOrNull(raw.upstream_owner_login) === ref.owner);
    if (hit === undefined) return {};
    const stats = isObject(hit.stats) ? hit.stats : {};
    return {
      iconUrl: skillhubIconUrl(hit.iconUrl),
      downloads: numberOrNull(hit.downloads) ?? numberOrNull(stats.downloads),
      saves: numberOrNull(hit.stars) ?? numberOrNull(stats.stars),
      score: finiteOrNull(hit.score) ?? finiteOrNull(stats.score),
      category: textOrNull(hit.category),
    };
  } catch {
    return {};
  }
}

/**
 * Overlay the mirror's facts on one item, field by field.
 *
 * Only non-null values win: a mirror that answers without a score must not erase the one
 * `clawhub.ai` already gave, or a detail page would lose a number it had yesterday.
 * @param {object} item - the item normalised from `clawhub.ai`.
 * @param {object} facts - `mirrorFactsOf` output.
 * @returns {object} the item, with the overlapping fields replaced.
 */
function withMirrorFacts(item, facts) {
  const merged = { ...item };
  for (const key of ['iconUrl', 'downloads', 'saves', 'score', 'category']) {
    if (facts[key] !== null && facts[key] !== undefined) merged[key] = facts[key];
  }
  return merged;
}

/**
 * The icon and the upstream title of one skill, from the cache or from its detail payload.
 *
 * The list a card is drawn from now carries its own icon, so this is no longer the way a
 * card gets a picture. It serves the one caller that has nothing but an identity: an
 * installed row, whose `_meta.json` holds `source`/`owner`/`slug` and no list payload at
 * all. That single request answers both the icon and the upstream title, and both are
 * cached together. Every failure is a miss, never an error: decoration and a nicer title
 * are not worth a 500.
 * @param {{owner: string|null, slug: string|null}} ref - item identity.
 * @param {object} io - upstream client.
 * @param {() => number} clock - injected clock.
 * @param {number} timeoutMs - budget for this one request.
 * @returns {Promise<{iconUrl: string|null, displayName: string|null}>} the facts, nulls on failure.
 */
async function factsOf(ref, io, clock, timeoutMs) {
  const miss = { iconUrl: null, displayName: null };
  if (typeof ref.owner !== 'string' || ref.owner === '' || typeof ref.slug !== 'string' || ref.slug === '') {
    return miss;
  }
  const key = `clawhub:${ref.owner}:${ref.slug}`;
  const hit = iconCache.get(key);
  if (hit !== undefined) {
    const ttl = hit.iconUrl === null && hit.displayName === null ? ICON_MISS_TTL_MS : ICON_TTL_MS;
    if (clock() - hit.at < ttl) return { iconUrl: hit.iconUrl, displayName: hit.displayName };
  }
  let facts = miss;
  try {
    const body = await io.getJson(
      buildUrl(ORIGIN, `/api/v1/skills/${encodeURIComponent(ref.slug)}`, { ownerHandle: ref.owner }),
      { timeoutMs },
    );
    const skill = isObject(body?.skill) ? body.skill : {};
    facts = {
      iconUrl: clawhubIconUrl(skill.icon ?? skill.iconUrl),
      displayName: textOrNull(skill.displayName),
    };
  } catch {
    facts = miss;
  }
  iconCache.set(key, { at: clock(), ...facts });
  return facts;
}

/**
 * Resolve icons and upstream titles for one batch of skills, for `POST market/icons`.
 *
 * This is the progressive half: the browser asks once per visible page of cards and patches
 * them when the answer arrives, so nothing waits on a slow detail endpoint. Four at a time,
 * six seconds for the whole batch, five per lookup; whatever misses the budget is null and
 * the card keeps its letter avatar. `icons` and `names` always carry the same keys in the
 * same order.
 * @param {{owner: string, slug: string}[]} refs - skills to resolve, already validated.
 * @param {object} io - upstream client.
 * @param {{now?: () => number}} [options] - clock, for tests.
 * @returns {Promise<{icons: Record<string, string|null>, names: Record<string, string|null>}>}
 *   `clawhub:<owner>:<slug>` -> icon URL / upstream title.
 */
async function icons(refs, io, options = {}) {
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  const deadline = clock() + BATCH_BUDGET_MS;
  const values = new Map();
  await mapLimit(refs, ICON_CONCURRENCY, async (ref) => {
    const key = `clawhub:${ref.owner}:${ref.slug}`;
    const left = deadline - clock();
    values.set(key, left <= 0
      ? { iconUrl: null, displayName: null }
      : await factsOf(ref, io, clock, Math.max(300, Math.min(BATCH_TIMEOUT_MS, left))));
  });
  // Answer in request order: nine lookups racing four ways finish out of order, and a
  // response whose key order changes between two identical calls is needlessly hard to
  // read (and to diff in a test). `names` mirrors `icons` key for key.
  const iconsByKey = {};
  const namesByKey = {};
  for (const ref of refs) {
    const key = `clawhub:${ref.owner}:${ref.slug}`;
    const facts = values.get(key) ?? { iconUrl: null, displayName: null };
    iconsByKey[key] = facts.iconUrl;
    namesByKey[key] = facts.displayName;
  }
  return { icons: iconsByKey, names: namesByKey };
}

/**
 * One page of the catalogue, from the mirror.
 *
 * The mirror is the only place that carries downloads, stars, score and an icon for a
 * ClawHub skill. A category is forwarded as it arrives: this source has no category table
 * (`caps.categories` stays false, so the panel hides the chips row), but the mirror does
 * filter on one, and forwarding costs nothing.
 * @param {object} query - normalised list query.
 * @param {object} io - upstream client.
 * @returns {Promise<{items: object[], next: string|null, total: number|null}>} the page.
 */
async function list(query, io) {
  const page = pageOf(query.cursor);
  const params = {
    page,
    pageSize: query.limit,
    ...(SORT_PARAMS[query.sort] ?? SORT_PARAMS.recommended),
    category: query.category,
    keyword: query.keyword,
    source: 'clawhub',
  };
  const body = await io.getJson(
    buildUrl(SKILLHUB_ORIGIN, '/api/skills', params),
    { timeoutMs: READ_TIMEOUT_MS },
  );
  const data = body.data;
  if (!isObject(data) || !Array.isArray(data.skills)) {
    throw badResponse('the clawhub mirror list payload carries no data.skills array');
  }
  const items = data.skills.map((raw) => fromClawhubMirrorItem(raw)).filter(Boolean);
  const total = typeof data.total === 'number' ? data.total : null;
  return {
    items: query.sort === 'updated' ? sortByUpdatedDesc(items) : items,
    next: nextCursor(page, query.limit, data.skills.length, total),
    total,
  };
}

/**
 * One page of search results; the mirror's list endpoint already takes the keyword, so
 * this is the same request with `keyword` set - and it pages like a list does.
 * @param {object} query - normalised list query.
 * @param {object} io - upstream client.
 * @returns {Promise<{items: object[], next: string|null, total: number|null}>} the page.
 */
async function search(query, io) {
  if (query.keyword === '') throw marketError('E_BAD_QUERY', 'search needs a keyword');
  return list(query, io);
}

/**
 * Detail of one skill.
 *
 * The overview is derived from `skill.description`, which is the whole `SKILL.md`; the
 * mirror has no overview of its own. The numbers come from both sides: `clawhub.ai` first,
 * then one mirror list lookup overlays `{iconUrl, downloads, saves, score, category}` so
 * the detail view shows the same figures as the card the user clicked. The lookup is
 * decoration - a miss or a failure keeps what `clawhub.ai` said.
 *
 * The package is downloaded only to list its files; that download is a few kilobytes and
 * it is the only way this source can answer "which files would land on disk". It is
 * deliberately asked of `clawhub.ai`, never of the mirror.
 * @param {{owner: string, slug: string, version: string|null}} ref - item reference.
 * @param {object} io - upstream client.
 * @returns {Promise<object>} the MarketDetail payload (without `installTo`).
 */
async function detail(ref, io) {
  const body = await readDetail(ref, io);
  const base = fromClawhubDetail(isObject(body) ? { ...body, owner: body.owner ?? { handle: ref.owner } } : body);
  if (base === null) throw badResponse('the clawhub detail payload could not be normalised');
  const item = withMirrorFacts(base, await mirrorFactsOf(ref, io));
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
 *
 * The version is resolved here, always, even when the caller already carries one: a
 * ClawHub version that came from a mirror row is a catalogue fact, and installing by it
 * can answer a package whose `_meta.json` disagrees with the manifest - which the install
 * ledger reads as a corrupted package. One extra detail request buys a correct install.
 * @param {{owner: string, slug: string, version: string|null}} ref - item reference.
 * @param {object} io - upstream client.
 * @returns {Promise<object>} the SourcePlan.
 */
async function plan(ref, io) {
  const version = await latestVersion(ref, io);
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
