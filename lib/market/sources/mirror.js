/**
 * The one market adapter implementation: SkillHub's API, configured per source.
 *
 * Both sources are the same HTTP surface - the panel talks to `api.skillhub.cn` and asks
 * for a different catalogue with `source=clawhub` - so the request building, the paging,
 * the manifest reading, the single-file download, the category table and the icon cache
 * live here once. What makes SkillHub and ClawHub different fits in seven hooks:
 *
 * | hook | SkillHub | ClawHub |
 * | --- | --- | --- |
 * | `id` / `caps` | `'skillhub'`, categories on | `'clawhub'`, categories off |
 * | `source` | `null` | `'clawhub'` (list/search query parameter) |
 * | `normalizeRow` | `fromSkillhubListItem` | `fromClawhubMirrorItem` |
 * | `normalizeDetail` | `fromSkillhubDetail` | `fromClawhubMirrorDetail` |
 * | `resolve` | the owner *is* the namespace | one `keyword=` lookup (below) |
 * | `facts` | one detail call | the same lookup |
 * | `counts` | `true` | `false` |
 *
 * Shapes taken from a live run against `api.skillhub.cn`:
 *
 * - list: `GET /api/skills?page&pageSize&sortBy&order&keyword&category[&source]` answers
 *   `{code, data: {skills, total}}`;
 * - detail: `GET /api/v1/skills/<slug>?namespace=&version=`;
 * - manifest: `GET /api/v1/skills/<slug>/files?namespace=&version=`;
 * - one file: `GET /api/v1/skills/<slug>/file?path=&namespace=&version=` answers a 302
 *   to the COS bucket, which is the only place this plugin follows a redirect;
 * - categories: `GET /api/v1/categories`.
 *
 * Two facts shape the code: `overviewMd` is always empty, so the overview comes from
 * `SKILL.md`; and the file endpoint silently serves the latest version when `version`
 * is omitted, so every call here passes it explicitly.
 *
 * Every cache is per instance, so a test can reset one source without disturbing the
 * other, and `resetIconCache` / `resetCategoryCache` / `resetCountCache` on the returned
 * object are the only handles onto them.
 */
import { marketError } from '../errors.js';
import { SORT_PARAMS, buildUrl, encodeCursor, pageOf } from '../query.js';
import {
  declaredNameOf,
  isObject,
  nameIsValid,
  overviewOf,
  skillhubIconUrl,
  sortByUpdatedDesc,
  textOrNull,
} from '../normalize.js';
import {
  CATEGORY_TIMEOUT_MS, FILE_TIMEOUT_MS, MAX_BINARY_BYTES, READ_TIMEOUT_MS, mapLimit,
} from '../upstream.js';

/** The one origin the market half may call. */
export const ORIGIN = 'https://api.skillhub.cn';

/** Entry point every skill package must carry. */
const FIRST_FILE = 'SKILL.md';

/** Category keys that are commercial tiers, not content categories. */
const HIDDEN_CATEGORIES = new Set(['pay-skill']);

/** How long the category table stays in memory. */
const CATEGORY_TTL_MS = 10 * 60 * 1000;

/** How long the per-category counts stay in memory (same window as the table). */
const COUNT_TTL_MS = 10 * 60 * 1000;

/** How long a resolved icon stays in memory. */
const ICON_TTL_MS = 10 * 60 * 1000;

/** How long "this skill has no icon" stays in memory; short, so a fix shows up. */
const ICON_MISS_TTL_MS = 60 * 1000;

/** How many icon lookups run at once; one detail call is about 0.26s. */
const ICON_CONCURRENCY = 6;

/** Budget for one `POST market/icons` batch. */
const ICON_BUDGET_MS = 6000;

/** Budget for one detail request inside a batch. */
const ICON_TIMEOUT_MS = 5000;

/** Budget for one `pageSize=1` count request. */
const COUNT_TIMEOUT_MS = 6000;

/** Budget for the whole counts pass; whatever is not answered by then stays null. */
const COUNTS_BUDGET_MS = 10000;

/** How many count requests run at once - the upstream tolerates a handful, not fifteen. */
const COUNT_CONCURRENCY = 6;

/**
 * The next cursor, or null when this page is the last.
 *
 * `rawCount` is the number of rows the upstream returned **before** normalisation, because
 * normalisation can drop a row (an id the panel cannot build, a missing slug) and a short
 * page is then no evidence of the end. `total` is the authority when the upstream reports
 * it; the last branch only fires for an upstream that does not, and never fires for
 * SkillHub, whose `total` is always present.
 * @param {number} page - page just served.
 * @param {number} limit - page size.
 * @param {number} rawCount - rows returned, before normalisation.
 * @param {number|null} total - upstream total, when reported.
 * @returns {string|null} the opaque cursor.
 */
function nextPage(page, limit, rawCount, total) {
  if (rawCount === 0) return null;
  if (total !== null && page * limit >= total) return null;
  if (total === null && rawCount < limit) return null;
  return encodeCursor({ page: page + 1 });
}

/**
 * Read the page number out of our own cursor.
 * @param {Record<string, unknown>|null} cursor - decoded cursor.
 * @returns {number} the page, 1-based.
 * @throws {import('../errors.js').MarketError} with code E_BAD_QUERY when not ours.
 */
function cursorPage(cursor) {
  return pageOf(cursor);
}

/**
 * Build one adapter instance from its per-source configuration.
 * @param {{id: string, source: string|null, normalizeRow: Function, normalizeDetail: Function,
 *   resolve: Function, facts: Function, caps: {search: boolean, paged: boolean,
 *   categories: boolean, package: 'files'|'zip'}, counts: boolean}} config - the hooks.
 * @returns {object} the MarketSource adapter.
 */
export function createMirrorAdapter(config) {
  const id = config.id;
  const sourceParam = config.source;
  let categoryCache = null;
  // One entry per `source` parameter (`''` for "no parameter"), because the numbers differ
  // per scope and one shared slot would show the previous scope's figures for ten minutes.
  const countCache = new Map();
  const iconCache = new Map();
  // The namespace a skill resolves to, remembered only for `fetchFile`: one install reads
  // the manifest once and then fetches every file of it, and re-resolving per file would
  // cost one extra list request per file. `detail`/`plan` still resolve on every call
  // (they are the ones that must never serve a stale answer), so this is a side effect of
  // their lookup, not a cache in front of it. Keyed like the icon cache, per instance.
  const namespaceCache = new Map();

  /**
   * Build the one error this adapter raises for a malformed upstream answer.
   * @param {string} message - what is missing.
   * @returns {import('../errors.js').MarketError} an E_SOURCE_BAD_RESPONSE error.
   */
  function badResponse(message) {
    return marketError('E_SOURCE_BAD_RESPONSE', message);
  }

  /**
   * The query parameters every list request shares.
   * @param {object} query - normalised list query.
   * @returns {Record<string, unknown>} the parameters.
   */
  function listParams(query) {
    // A query carries its own `sourceParam` (the scope the user picked); the adapter's own
    // value is the fallback, because one adapter can serve more than one scope.
    const source = query !== null && typeof query === 'object' && 'sourceParam' in query
      ? query.sourceParam
      : sourceParam;
    return {
      ...(source === null || source === undefined ? {} : { source }),
      ...(SORT_PARAMS[query.sort] ?? SORT_PARAMS.recommended),
      category: query.category,
      keyword: query.keyword,
    };
  }

  /**
   * Translate our identity into the namespace this upstream uses.
   * @param {{owner: string, slug: string, version: string|null}} ref - item reference.
   * @param {object} io - upstream client.
   * @returns {Promise<{ns: string, score?: number|null}>} the namespace, plus facts the
   *   resolution already fetched.
   */
  async function resolveRef(ref, io) {
    const resolved = await config.resolve(ref, io);
    const ns = typeof resolved?.ns === 'string' && resolved.ns !== ''
      ? resolved.ns
      : (typeof ref.owner === 'string' ? ref.owner : '');
    if (ns === '') throw badResponse(`the ${id} detail request has no namespace`);
    if (typeof ref.owner === 'string' && ref.owner !== '' && typeof ref.slug === 'string' && ref.slug !== '') {
      namespaceCache.set(`${id}:${ref.owner}:${ref.slug}`, ns);
    }
    return { ...resolved, ns };
  }

  /**
   * Read one detail payload.
   * @param {{owner: string, slug: string, version: string|null}} ref - item reference.
   * @param {string} ns - upstream namespace.
   * @param {object} io - upstream client.
   * @returns {Promise<object>} the upstream body.
   */
  async function readDetail(ref, ns, io) {
    const body = await io.getJson(
      buildUrl(ORIGIN, `/api/v1/skills/${encodeURIComponent(ref.slug)}`, {
        namespace: ns,
        version: ref.version,
      }),
      { timeoutMs: READ_TIMEOUT_MS },
    );
    if (!isObject(body.skill)) throw badResponse(`the ${id} detail payload carries no skill`);
    return body;
  }

  /**
   * Read the file manifest of one package.
   * @param {{slug: string, version: string|null}} ref - item reference.
   * @param {string} ns - upstream namespace.
   * @param {object} io - upstream client.
   * @returns {Promise<{path: string, size: number|null, sha256: string|null}[]>} the manifest.
   */
  async function readManifest(ref, ns, io) {
    const body = await io.getJson(
      buildUrl(ORIGIN, `/api/v1/skills/${encodeURIComponent(ref.slug)}/files`, {
        namespace: ns,
        version: ref.version,
      }),
      { timeoutMs: READ_TIMEOUT_MS },
    );
    if (!Array.isArray(body.files)) throw badResponse(`the ${id} manifest carries no files array`);
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
   * @param {string} ns - upstream namespace.
   * @param {string} path - manifest path.
   * @param {object} io - upstream client.
   * @returns {Promise<Buffer>} the file bytes.
   */
  async function readFile(ref, ns, path, io) {
    const result = await io.getBytes(
      buildUrl(ORIGIN, `/api/v1/skills/${encodeURIComponent(ref.slug)}/file`, {
        path,
        namespace: ns,
        version: ref.version,
      }),
      { timeoutMs: FILE_TIMEOUT_MS, maxBytes: MAX_BINARY_BYTES },
    );
    return result.body;
  }

  /**
   * Read the latest version of one skill.
   * @param {{slug: string}} ref - item reference.
   * @param {string} ns - upstream namespace.
   * @param {object} io - upstream client.
   * @returns {Promise<string>} the version.
   */
  async function latestVersion(ref, ns, io) {
    const body = await io.getJson(
      buildUrl(ORIGIN, `/api/v1/skills/${encodeURIComponent(ref.slug)}`, { namespace: ns }),
      { timeoutMs: READ_TIMEOUT_MS },
    );
    const version = textOrNull(body?.latestVersion?.version) ?? textOrNull(body?.skill?.version);
    if (version === null) throw badResponse(`the ${id} detail payload carries no version`);
    return version;
  }

  /**
   * One page of the catalogue.
   * @param {object} query - normalised list query.
   * @param {object} io - upstream client.
   * @returns {Promise<{items: object[], next: string|null, total: number|null}>} the page.
   */
  async function list(query, io) {
    const page = cursorPage(query.cursor);
    const params = {
      page,
      pageSize: query.limit,
      ...listParams(query),
    };
    const body = await io.getJson(buildUrl(ORIGIN, '/api/skills', params), { timeoutMs: READ_TIMEOUT_MS });
    const data = body.data;
    if (!isObject(data) || !Array.isArray(data.skills)) {
      throw badResponse(`the ${id} list payload carries no data.skills array`);
    }
    const items = data.skills.map((raw) => config.normalizeRow(raw)).filter(Boolean);
    const total = typeof data.total === 'number' ? data.total : null;
    return {
      items: query.sort === 'updated' ? sortByUpdatedDesc(items) : items,
      next: nextPage(page, query.limit, data.skills.length, total),
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
    const resolved = await resolveRef(ref, io);
    const body = await readDetail(ref, resolved.ns, io);
    const item = config.normalizeDetail(body, ref);
    if (item === null) throw badResponse(`the ${id} detail payload could not be normalised`);
    // The detail payload has no score on this upstream (its `stats` stops at
    // downloads/stars/installs/versions), so the row the namespace came from supplies it -
    // one request, two facts. Nothing else is borrowed from that row: the detail payload
    // is the authority for every other field.
    const scored = Number.isFinite(resolved.score) ? { ...item, score: resolved.score } : item;
    const version = ref.version ?? scored.version;
    const manifest = await readManifest({ slug: ref.slug, version }, resolved.ns, io);
    let fileText = '';
    if (manifest.some((file) => file.path === FIRST_FILE)) {
      try {
        fileText = (await readFile({ owner: ref.owner, slug: ref.slug, version }, resolved.ns, FIRST_FILE, io)).toString('utf8');
      } catch {
        // A package whose SKILL.md cannot be read still has a detail view: the overview
        // falls back to the summary and the declared name stays unknown, which turns the
        // install check into a clean E_SKILL_NAME_INVALID instead of a broken page.
        fileText = '';
      }
    }
    const declaredName = declaredNameOf(fileText);
    return {
      item: scored,
      overview: overviewOf(fileText, scored.summary),
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
    const resolved = await resolveRef(ref, io);
    const version = ref.version ?? await latestVersion(ref, resolved.ns, io);
    const files = await readManifest({ slug: ref.slug, version }, resolved.ns, io);
    if (!files.some((file) => file.path === FIRST_FILE)) {
      throw marketError('E_PACKAGE_INVALID', `the ${id} package does not list SKILL.md`);
    }
    return {
      sourceId: id,
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
    const key = `${id}:${packagePlan.owner}:${packagePlan.slug}`;
    const remembered = namespaceCache.get(key);
    const ns = typeof remembered === 'string' && remembered !== ''
      ? remembered
      : (await resolveRef(packagePlan, io)).ns;
    return readFile(packagePlan, ns, path, io);
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
      if (!Array.isArray(body.items)) throw badResponse(`the ${id} category payload carries no items array`);
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
   * Read the total an upstream reports for one filter.
   *
   * A page of one item is the cheapest way to ask "how many are there": `data.total` is the
   * filtered count, and `pageSize=1` keeps the payload at a few hundred bytes.
   * @param {Record<string, string|number>} params - filter, e.g. `{category}`.
   * @param {object} io - upstream client.
   * @param {number} timeoutMs - budget for this one request.
   * @param {string|null} scopeParam - the `source` parameter of the scope being counted.
   * @returns {Promise<number>} the total.
   * @throws {import('../errors.js').MarketError} when the answer carries no usable total.
   */
  async function readTotal(params, io, timeoutMs, scopeParam) {
    const body = await io.getJson(
      buildUrl(ORIGIN, '/api/skills', {
        page: 1, pageSize: 1, ...(scopeParam === null ? {} : { source: scopeParam }), ...params,
      }),
      { timeoutMs },
    );
    const total = body?.data?.total;
    if (typeof total !== 'number' || !Number.isFinite(total)) {
      throw badResponse(`the ${id} count payload carries no data.total`);
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
   * The numbers are per **scope**, not per adapter: the same category holds 23,193 skills
   * across both catalogues, 10,145 in SkillHub's own, 13,048 in ClawHub's. The cache is
   * therefore keyed by the `source` parameter itself (`''` for "no parameter"), which is the
   * only key that cannot drift when a scope is added or renamed.
   * @param {object} io - upstream client.
   * @param {{now?: () => number, refresh?: boolean, sourceParam?: string|null}} [options] -
   *   clock, cache control, and the scope being counted (defaults to this adapter's own).
   * @returns {Promise<{counts: Record<string, number|null>, total: number|null, ok: boolean,
   *   stale: boolean, cached: boolean}>} the counts.
   */
  async function counts(io, options = {}) {
    const clock = typeof options.now === 'function' ? options.now : Date.now;
    const scopeParam = 'sourceParam' in options ? options.sourceParam : sourceParam;
    const cacheKey = scopeParam === null || scopeParam === undefined ? '' : scopeParam;
    const at = clock();
    const cachedCount = countCache.get(cacheKey) ?? null;
    const fresh = cachedCount !== null && at - cachedCount.at < COUNT_TTL_MS;
    if (options.refresh !== true && fresh) {
      return {
        counts: cachedCount.counts, total: cachedCount.total, ok: true, stale: false, cached: true,
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
          scopeParam,
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
    if (result.ok) countCache.set(cacheKey, { at: clock(), counts: result.counts, total: result.total });
    return { ...result, stale: false, cached: false };
  }

  /**
   * The icon and the upstream title of one skill, from the cache or from the source's own
   * lookup. Both are cached together, so a hit never returns a title without its icon.
   * @param {{owner: string, slug: string}} ref - skill identity.
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
    const key = `${id}:${ref.owner}:${ref.slug}`;
    const hit = iconCache.get(key);
    if (hit !== undefined) {
      const ttl = hit.iconUrl === null && hit.displayName === null ? ICON_MISS_TTL_MS : ICON_TTL_MS;
      if (clock() - hit.at < ttl) return { iconUrl: hit.iconUrl, displayName: hit.displayName };
    }
    let facts = miss;
    try {
      const answer = await config.facts(ref, io, timeoutMs);
      facts = {
        iconUrl: skillhubIconUrl(answer?.iconUrl),
        displayName: textOrNull(answer?.displayName),
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
   * Six at a time and six seconds for the whole batch, so a mixed batch costs about one
   * budget rather than the sum. Whatever misses the budget is null and the card keeps its
   * letter avatar. `icons` and `names` always carry the same keys in the same order, so the
   * browser can walk one and index the other.
   * @param {{owner: string, slug: string}[]} refs - skills to resolve, already validated.
   * @param {object} io - upstream client.
   * @param {{now?: () => number}} [options] - clock, for tests.
   * @returns {Promise<{icons: Record<string, string|null>, names: Record<string, string|null>}>}
   *   `<id>:<owner>:<slug>` -> icon URL / upstream title.
   */
  async function icons(refs, io, options = {}) {
    const clock = typeof options.now === 'function' ? options.now : Date.now;
    const deadline = clock() + ICON_BUDGET_MS;
    const values = new Map();
    await mapLimit(refs, ICON_CONCURRENCY, async (ref) => {
      const key = `${id}:${ref.owner}:${ref.slug}`;
      const left = deadline - clock();
      values.set(key, left <= 0
        ? { iconUrl: null, displayName: null }
        : await factsOf(ref, io, clock, Math.max(300, Math.min(ICON_TIMEOUT_MS, left))));
    });
    const iconsByKey = {};
    const namesByKey = {};
    for (const ref of refs) {
      const key = `${id}:${ref.owner}:${ref.slug}`;
      const facts = values.get(key) ?? { iconUrl: null, displayName: null };
      iconsByKey[key] = facts.iconUrl;
      namesByKey[key] = facts.displayName;
    }
    return { icons: iconsByKey, names: namesByKey };
  }

  /**
   * Forget every remembered icon (tests, and bootstrap with `?refresh=1`).
   * @returns {void}
   */
  function resetIconCache() {
    iconCache.clear();
    namespaceCache.clear();
  }

  /**
   * Forget the cached category table (tests and `?refresh=1`).
   * @returns {void}
   */
  function resetCategoryCache() {
    categoryCache = null;
  }

  /**
   * Forget the cached category counts (tests, and `?refresh=1` through `counts`).
   * @returns {void}
   */
  function resetCountCache() {
    countCache.clear();
  }

  const adapter = {
    id,
    labelKey: `market.source.${id}`,
    caps: config.caps,
    list,
    search,
    detail,
    plan,
    fetchFile,
    icons,
    resetIconCache,
    resetCategoryCache,
    resetCountCache,
  };
  // `counts: false` means the source has no category table, so the two methods are not
  // mounted at all - the bootstrap route checks for their presence rather than for a flag.
  if (config.counts === true) {
    adapter.categories = categories;
    adapter.counts = counts;
  }
  return adapter;
}
