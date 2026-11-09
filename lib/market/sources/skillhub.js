/**
 * The SkillHub adapter.
 *
 * Shapes taken from a live run against `api.skillhub.cn`:
 *
 * - list: `GET /api/skills?page&pageSize&sortBy&order&keyword&category` answers
 *   `{code, data: {skills, total}}`, and each item already carries `namespace.handle`;
 * - detail: `GET /api/v1/skills/<slug>?namespace=&version=`;
 * - manifest: `GET /api/v1/skills/<slug>/files?namespace=&version=`;
 * - one file: `GET /api/v1/skills/<slug>/file?path=&namespace=&version=` answers a 302
 *   to the COS bucket, which is the only place this plugin follows a redirect;
 * - categories: `GET /api/v1/categories`.
 *
 * Two facts shape the code: `overviewMd` is always empty, so the overview comes from
 * `SKILL.md`; and the file endpoint silently serves the latest version when `version`
 * is omitted, so every call here passes it explicitly.
 */
import { marketError } from '../errors.js';
import {
  buildUrl,
  encodeCursor,
} from '../query.js';
import {
  declaredNameOf,
  fromSkillhubDetail,
  fromSkillhubListItem,
  isObject,
  nameIsValid,
  overviewOf,
  sortByUpdatedDesc,
  textOrNull,
} from '../normalize.js';
import { CATEGORY_TIMEOUT_MS, MAX_BINARY_BYTES, READ_TIMEOUT_MS, FILE_TIMEOUT_MS } from '../upstream.js';

/** The one origin this adapter may call. */
export const ORIGIN = 'https://api.skillhub.cn';

/** Entry point every skill package must carry. */
const FIRST_FILE = 'SKILL.md';

/** Sort order to upstream parameters. */
const SORT_PARAMS = {
  recommended: { sortBy: 'score', order: 'desc' },
  updated: { sortBy: 'updated_at', order: 'desc' },
  downloads: { sortBy: 'downloads', order: 'desc' },
};

/** Category keys that are commercial tiers, not content categories. */
const HIDDEN_CATEGORIES = new Set(['pay-skill']);

/** How long the category table stays in memory. */
const CATEGORY_TTL_MS = 10 * 60 * 1000;

/** How long the per-category counts stay in memory (same window as the table). */
const COUNT_TTL_MS = 10 * 60 * 1000;

/** Budget for one `pageSize=1` count request. */
const COUNT_TIMEOUT_MS = 6000;

/** Budget for the whole counts pass; whatever is not answered by then stays null. */
const COUNTS_BUDGET_MS = 10000;

/** How many count requests run at once - the upstream tolerates a handful, not fifteen. */
const COUNT_CONCURRENCY = 6;

/** Cached category table: `{at, items}` or null. */
let categoryCache = null;

/** Cached counts: `{at, counts, total}` or null; only complete passes are cached. */
let countCache = null;

/**
 * Forget the cached category table (tests and `?refresh=1`).
 * @returns {void}
 */
export function resetCategoryCache() {
  categoryCache = null;
}

/**
 * Forget the cached category counts (tests, and `?refresh=1` through `counts`).
 * @returns {void}
 */
export function resetCountCache() {
  countCache = null;
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
 * Read the page number out of our own cursor.
 * @param {Record<string, unknown>|null} cursor - decoded cursor.
 * @returns {number} the page, 1-based.
 * @throws {import('../errors.js').MarketError} with code E_BAD_QUERY when the cursor is not ours.
 */
function pageOf(cursor) {
  if (cursor === null || cursor === undefined) return 1;
  const page = cursor.page;
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > 1000) {
    throw marketError('E_BAD_QUERY', 'this cursor was not issued for this source');
  }
  return page;
}

/**
 * The next cursor, or null when this page is the last.
 * @param {number} page - page just served.
 * @param {number} limit - page size.
 * @param {number} count - items served.
 * @param {number|null} total - upstream total, when reported.
 * @returns {string|null} the opaque cursor.
 */
function nextCursor(page, limit, count, total) {
  if (count === 0) return null;
  if (total !== null && page * limit >= total) return null;
  if (count < limit) return null;
  return encodeCursor({ page: page + 1 });
}

/**
 * Read the file manifest of one package.
 * @param {{owner: string, slug: string, version: string|null}} ref - item reference.
 * @param {object} io - upstream client.
 * @returns {Promise<{path: string, size: number|null, sha256: string|null}[]>} the manifest.
 */
async function readManifest(ref, io) {
  const body = await io.getJson(
    buildUrl(ORIGIN, `/api/v1/skills/${encodeURIComponent(ref.slug)}/files`, {
      namespace: ref.owner,
      version: ref.version,
    }),
    { timeoutMs: READ_TIMEOUT_MS },
  );
  if (!Array.isArray(body.files)) throw badResponse('the skillhub manifest carries no files array');
  return body.files
    .filter((file) => isObject(file) && typeof file.path === 'string')
    .map((file) => ({
      path: file.path,
      size: typeof file.size === 'number' ? file.size : null,
      sha256: typeof file.sha256 === 'string' && file.sha256 !== '' ? file.sha256 : null,
    }));
}

/**
 * Download one file of a package.
 * @param {{owner: string, slug: string, version: string|null}} ref - item reference.
 * @param {string} path - manifest path.
 * @param {object} io - upstream client.
 * @returns {Promise<Buffer>} the file bytes.
 */
async function readFile(ref, path, io) {
  const result = await io.getBytes(
    buildUrl(ORIGIN, `/api/v1/skills/${encodeURIComponent(ref.slug)}/file`, {
      path,
      namespace: ref.owner,
      version: ref.version,
    }),
    { timeoutMs: FILE_TIMEOUT_MS, maxBytes: MAX_BINARY_BYTES },
  );
  return result.body;
}

/**
 * Read the latest version of one skill.
 * @param {{owner: string, slug: string}} ref - item reference.
 * @param {object} io - upstream client.
 * @returns {Promise<string>} the version.
 */
async function latestVersion(ref, io) {
  const body = await io.getJson(
    buildUrl(ORIGIN, `/api/v1/skills/${encodeURIComponent(ref.slug)}`, { namespace: ref.owner }),
    { timeoutMs: READ_TIMEOUT_MS },
  );
  const version = textOrNull(body?.latestVersion?.version) ?? textOrNull(body?.skill?.version);
  if (version === null) throw badResponse('the skillhub detail payload carries no version');
  return version;
}

/**
 * One page of the catalogue.
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
  };
  const body = await io.getJson(buildUrl(ORIGIN, '/api/skills', params), { timeoutMs: READ_TIMEOUT_MS });
  const data = body.data;
  if (!isObject(data) || !Array.isArray(data.skills)) {
    throw badResponse('the skillhub list payload carries no data.skills array');
  }
  const items = data.skills.map((raw) => fromSkillhubListItem(raw)).filter(Boolean);
  const total = typeof data.total === 'number' ? data.total : null;
  return {
    items: query.sort === 'updated' ? sortByUpdatedDesc(items) : items,
    next: nextCursor(page, query.limit, items.length, total),
    total,
  };
}

/**
 * One page of search results; the list endpoint already supports a keyword.
 * @param {object} query - normalised list query.
 * @param {object} io - upstream client.
 * @returns {Promise<{items: object[], next: string|null, total: number|null}>} the page.
 */
async function search(query, io) {
  if (query.keyword === '') throw marketError('E_BAD_QUERY', 'search needs a keyword');
  return list(query, io);
}

/**
 * Detail of one skill, with an overview derived from its own `SKILL.md`.
 * @param {{owner: string, slug: string, version: string|null}} ref - item reference.
 * @param {object} io - upstream client.
 * @returns {Promise<object>} the MarketDetail payload (without `installTo`).
 */
async function detail(ref, io) {
  const body = await io.getJson(
    buildUrl(ORIGIN, `/api/v1/skills/${encodeURIComponent(ref.slug)}`, {
      namespace: ref.owner,
      version: ref.version,
    }),
    { timeoutMs: READ_TIMEOUT_MS },
  );
  if (!isObject(body.skill)) throw badResponse('the skillhub detail payload carries no skill');
  const item = fromSkillhubDetail(body);
  if (item === null) throw badResponse('the skillhub detail payload could not be normalised');
  const version = ref.version ?? item.version;
  const manifest = await readManifest({ owner: ref.owner, slug: ref.slug, version }, io);
  let fileText = '';
  if (manifest.some((file) => file.path === FIRST_FILE)) {
    try {
      fileText = (await readFile({ owner: ref.owner, slug: ref.slug, version }, FIRST_FILE, io)).toString('utf8');
    } catch {
      // A package whose SKILL.md cannot be read still has a detail view: the overview
      // falls back to the summary and the declared name stays unknown, which turns the
      // install check into a clean E_SKILL_NAME_INVALID instead of a broken page.
      fileText = '';
    }
  }
  const declaredName = declaredNameOf(fileText);
  return {
    item,
    overview: overviewOf(fileText, item.summary),
    declaredName,
    nameValid: nameIsValid(declaredName),
    files: manifest.map((file) => ({ path: file.path, size: file.size })),
    filesComplete: true,
  };
}

/**
 * Resolve the package of one skill: version plus manifest.
 * @param {{owner: string, slug: string, version: string|null}} ref - item reference.
 * @param {object} io - upstream client.
 * @returns {Promise<object>} the SourcePlan.
 */
async function plan(ref, io) {
  const version = ref.version ?? await latestVersion(ref, io);
  const files = await readManifest({ owner: ref.owner, slug: ref.slug, version }, io);
  if (!files.some((file) => file.path === FIRST_FILE)) {
    throw marketError('E_PACKAGE_INVALID', 'the skillhub package does not list SKILL.md');
  }
  return {
    sourceId: 'skillhub',
    owner: ref.owner,
    slug: ref.slug,
    version,
    packageKind: 'files',
    files,
    meta: null,
    metaBytes: null,
  };
}

/**
 * Fetch one file of a planned package.
 * @param {object} packagePlan - SourcePlan.
 * @param {string} path - manifest path.
 * @param {object} io - upstream client.
 * @returns {Promise<Buffer>} the file bytes.
 */
async function fetchFile(packagePlan, path, io) {
  const known = Array.isArray(packagePlan.files) && packagePlan.files.some((file) => file.path === path);
  if (!known) throw marketError('E_PACKAGE_INVALID', 'the requested path is not in the manifest');
  return readFile(packagePlan, path, io);
}

/**
 * The category table, minus commercial tiers, cached for ten minutes.
 * @param {object} io - upstream client.
 * @param {{now?: () => number, refresh?: boolean}} [options] - clock and cache control.
 * @returns {Promise<{items: object[], ok: boolean, stale: boolean, cached: boolean}>} the table.
 */
async function categories(io, options = {}) {
  const now = typeof options.now === 'function' ? options.now() : Date.now();
  const fresh = categoryCache !== null && now - categoryCache.at < CATEGORY_TTL_MS;
  if (options.refresh !== true && fresh) {
    return { items: categoryCache.items, ok: true, stale: false, cached: true };
  }
  try {
    const body = await io.getJson(buildUrl(ORIGIN, '/api/v1/categories', {}), { timeoutMs: CATEGORY_TIMEOUT_MS });
    if (!Array.isArray(body.items)) throw badResponse('the skillhub category payload carries no items array');
    const items = body.items
      .filter((entry) => isObject(entry) && typeof entry.key === 'string' && !HIDDEN_CATEGORIES.has(entry.key))
      .map((entry) => ({
        key: entry.key,
        name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : entry.key,
        nameEn: typeof entry.nameEn === 'string' ? entry.nameEn : '',
      }));
    categoryCache = { at: now, items };
    return { items, ok: true, stale: false, cached: false };
  } catch {
    if (categoryCache !== null) {
      return { items: categoryCache.items, ok: true, stale: true, cached: true };
    }
    return { items: [], ok: false, stale: false, cached: false };
  }
}

/**
 * Run tasks with a fixed number of workers, in order.
 * @param {object[]} items - one argument per task.
 * @param {number} limit - worker count.
 * @param {(item: object) => Promise<void>} task - work for one item.
 * @returns {Promise<void>} resolves when every item is done.
 */
async function mapLimit(items, limit, task) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      await task(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Read the total an upstream reports for one filter.
 *
 * A page of one item is the cheapest way to ask "how many are there": `data.total` is the
 * filtered count, and `pageSize=1` keeps the payload at a few hundred bytes.
 * @param {Record<string, string|number>} params - filter, e.g. `{category}`.
 * @param {object} io - upstream client.
 * @param {number} timeoutMs - budget for this one request.
 * @returns {Promise<number>} the total.
 * @throws {import('../errors.js').MarketError} when the answer carries no usable total.
 */
async function readTotal(params, io, timeoutMs) {
  const body = await io.getJson(
    buildUrl(ORIGIN, '/api/skills', { page: 1, pageSize: 1, ...params }),
    { timeoutMs },
  );
  const total = body?.data?.total;
  if (typeof total !== 'number' || !Number.isFinite(total)) {
    throw badResponse('the skillhub count payload carries no data.total');
  }
  return Math.trunc(total);
}

/**
 * The numbers on the category chips: one count per category plus the grand total.
 *
 * Thirteen requests is the price of the numbers (the upstream publishes no counts), so
 * they are fetched six at a time, cached for ten minutes, and allowed to fail one by one:
 * a category nobody could count comes back as `null`, `ok` goes false, and the page still
 * renders. Only a fully answered pass is cached - caching a partial one would hide the
 * missing numbers for ten minutes.
 * @param {object} io - upstream client.
 * @param {{now?: () => number, refresh?: boolean}} [options] - clock and cache control.
 * @returns {Promise<{counts: Record<string, number|null>, total: number|null, ok: boolean,
 *   stale: boolean, cached: boolean}>} the counts.
 */
async function counts(io, options = {}) {
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  const at = clock();
  const fresh = countCache !== null && at - countCache.at < COUNT_TTL_MS;
  if (options.refresh !== true && fresh) {
    return {
      counts: countCache.counts, total: countCache.total, ok: true, stale: false, cached: true,
    };
  }
  const table = await categories(io, options);
  const keys = table.items.map((entry) => entry.key);
  const deadline = at + COUNTS_BUDGET_MS;
  const result = { counts: {}, total: null, ok: true };
  await mapLimit([null, ...keys], COUNT_CONCURRENCY, async (key) => {
    const left = deadline - clock();
    if (left <= 0) {
      result.ok = false;
      if (key !== null) result.counts[key] = null;
      return;
    }
    try {
      const total = await readTotal(
        key === null ? {} : { category: key },
        io,
        Math.max(250, Math.min(COUNT_TIMEOUT_MS, left)),
      );
      if (key === null) result.total = total;
      else result.counts[key] = total;
    } catch {
      // One uncounted category must not cost the page its chips: that number stays null
      // and `countsOk` turns false, while bootstrap still answers 200.
      result.ok = false;
      if (key !== null) result.counts[key] = null;
    }
  });
  if (result.ok) countCache = { at: clock(), counts: result.counts, total: result.total };
  return { ...result, stale: false, cached: false };
}

/** The SkillHub adapter. */
export const skillhubSource = {
  id: 'skillhub',
  labelKey: 'market.source.skillhub',
  caps: { search: true, paged: true, categories: true, package: 'files' },
  list,
  search,
  detail,
  plan,
  fetchFile,
  categories,
  counts,
};
