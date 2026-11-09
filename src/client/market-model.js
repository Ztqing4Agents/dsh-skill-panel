/**
 * Pure view-model helpers for the skill market: no DOM, no fetch, no clock.
 *
 * Everything the market tab needs to decide "what to draw" is a function of the
 * merged item list, the filters, and the store's runtime flags, so the whole decision
 * surface can be unit-tested in node without a browser.
 *
 * Two sources are merged here and nowhere else (`mergeBatches`): each source answers
 * one page with its own cursor, so the per-source blocks and the deduplication both
 * live in one pure function.
 */

/** The source ids the panel falls back to before `bootstrap` answers (or after it fails). */
export const MARKET_FALLBACK_SOURCES = Object.freeze([
  Object.freeze({ id: 'skillhub', labelKey: 'market.source.skillhub', hasCategories: true, packageKind: 'files' }),
  Object.freeze({ id: 'clawhub', labelKey: 'market.source.clawhub', hasCategories: false, packageKind: 'zip' }),
]);

/** Source ids that publish no category table even before `bootstrap` says so. */
const NO_CATEGORY_SOURCES = new Set(['clawhub']);

/** The sources whose icons this client knows how to fetch (an installed row's identity). */
export const MARKET_SOURCE_IDS = Object.freeze(['skillhub', 'clawhub']);

/** Per-source and total caps of one `market/icons` batch (the route's own limits). */
const ICONS_PER_SOURCE = 12;
const ICONS_PER_BATCH = 24;

/** The source the market opens on: the menu lists the real sources only, with no "all". */
export const MARKET_DEFAULT_SOURCE = 'skillhub';

/** Per-source page size. Two sources therefore add 24 cards per scroll page. */
export const MARKET_PAGE_SIZE = 12;

/** The three sort orders the route accepts, in menu order. */
export const MARKET_SORTS = Object.freeze(['recommended', 'updated', 'downloads']);

/** Route error codes that have their own localized sentence. */
const MARKET_ERROR_CODES = new Set([
  'E_SOURCE_UNKNOWN',
  'E_SOURCE_UNAVAILABLE',
  'E_SOURCE_TIMEOUT',
  'E_SOURCE_BAD_RESPONSE',
  'E_BAD_QUERY',
  'E_SKILL_NAME_INVALID',
  'E_ALREADY_INSTALLED',
  'E_PACKAGE_INVALID',
  'E_DOWNLOAD_FAILED',
  'E_INSTALL_IO',
  'E_INSTALL_BUSY',
  'E_FAVORITE_FULL',
  'E_FAVORITE_IO',
]);

/**
 * The identity of one market item: its dedupe key, its React key, and the key the
 * installed map and the per-item install state are stored under.
 * @param {object} item - a MarketItem, or anything carrying the same three fields.
 * @returns {string} e.g. `skillhub:ake:dev-god`.
 */
export function marketKeyOf(item) {
  if (typeof item?.id === 'string' && item.id !== '') return item.id;
  return `${item?.sourceId ?? ''}:${item?.owner ?? ''}:${item?.slug ?? ''}`;
}

/**
 * Merge one round of per-source pages into the list.
 *
 * Each source keeps its own block: the new items are the pages concatenated in the order
 * the sources are given - not interleaved, and not re-sorted on this side. Upstream
 * orderings are not comparable across sources (SkillHub ranks with its own model,
 * ClawHub by recency), and every sort the user can pick is already applied per source by
 * the route, so a client-side merge order would only be a third opinion nobody asked for.
 * @param {{sourceId: string, items: object[]}[]} pages - one page per source, in render order.
 * @param {{existing?: object[]}} [options] - items already on screen, kept in front.
 * @returns {object[]} the merged list: existing items first, then each source's new ones.
 */
export function mergeBatches(pages, options = {}) {
  const existing = Array.isArray(options.existing) ? options.existing : [];
  const lists = (Array.isArray(pages) ? pages : []).map((page) => (Array.isArray(page?.items) ? page.items : []));
  const seen = new Set(existing.map((item) => marketKeyOf(item)));
  const merged = [...existing];
  for (const list of lists) {
    for (const item of list) {
      if (item === undefined || item === null) continue;
      const key = marketKeyOf(item);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return merged;
}

/**
 * The icon to draw for one item: the item's own field first, then whatever the progressive
 * backfill brought in for the same id (`market.icons`), then nothing - which is the letter
 * tile. ClawHub ships `iconUrl: null` on the list route and fills it in later.
 * @param {object} item - a MarketItem (or a detail's item).
 * @param {object} market - the market sub-state, for the fetched map.
 * @returns {string|null} an image URL, or null when the tile has no image.
 */
export function iconUrlOf(item, market) {
  const own = typeof item?.iconUrl === 'string' && item.iconUrl !== '' ? item.iconUrl : null;
  if (own !== null) return own;
  return iconUrlFor(marketKeyOf(item), market);
}

/**
 * The icon cached for one identity key (`source:owner:slug`), or null.
 *
 * The key space is shared by both consumers - market entries use `item.id`, installed rows
 * use their `upstream` triple - so a skill fetched once shows its icon on both surfaces
 * without a second request and without a second cache.
 * @param {string} key - a `marketKeyOf()` product.
 * @param {object} market - the market sub-state.
 * @returns {string|null} the cached URL, or null when there is none.
 */
export function iconUrlFor(key, market) {
  if (typeof key !== 'string' || key === '') return null;
  const cached = market?.icons?.[key];
  return typeof cached === 'string' && cached !== '' ? cached : null;
}

/**
 * The items whose icon is still worth asking for: ClawHub entries the list route left
 * empty and this session has not asked about yet. Capped at the route's batch limit.
 * @param {object} market - the market sub-state.
 * @param {number} [limit] - batch cap (the route takes at most 24).
 * @returns {{owner: string, slug: string, id: string}[]} the candidates, in list order.
 */
export function iconCandidates(market, limit = 24) {
  const items = Array.isArray(market?.items) ? market.items : [];
  const tried = market?.iconsTried ?? {};
  const picked = [];
  const seen = new Set();
  for (const item of items) {
    if (picked.length >= limit) break;
    if (item?.sourceId !== 'clawhub') continue;
    if (iconUrlOf(item, market) !== null) continue;
    if (typeof item?.owner !== 'string' || typeof item?.slug !== 'string') continue;
    if (item.owner === '' || item.slug === '') continue;
    const id = marketKeyOf(item);
    if (tried[id] === true || seen.has(id)) continue;
    seen.add(id);
    picked.push({ owner: item.owner, slug: item.slug, id });
  }
  return picked;
}

/**
 * Icons the list route already answered inline, reshaped into the cache's key space.
 *
 * SkillHub puts `iconUrl` straight on the list item, so the card can draw it without any
 * extra request - but the installed row only looks at `market.icons[key]`, and the two
 * used to have no path between them: installing a SkillHub skill meant asking upstream for
 * an icon the browser had been holding all along (measured 7.5s for one mixed batch).
 * Seeding closes that path without a request.
 *
 * A seed is a *known answer*, not "we asked upstream": it deliberately does not touch
 * `iconsTried`, which stays the ledger of upstream questions.
 * @param {object} market - the market sub-state.
 * @returns {Record<string, string>|null} `{[key]: url}` to seed, or null when there is
 *   nothing new (already cached entries are skipped instead of rewritten every render).
 */
export function iconSeeds(market) {
  const items = Array.isArray(market?.items) ? market.items : [];
  const seeds = {};
  let count = 0;
  for (const item of items) {
    if (typeof item?.iconUrl !== 'string' || item.iconUrl === '') continue;
    const key = marketKeyOf(item);
    if (iconUrlFor(key, market) !== null) continue;
    seeds[key] = item.iconUrl;
    count += 1;
  }
  return count === 0 ? null : seeds;
}

/**
 * The upstream title cached for one identity key, or null.
 *
 * Same key space as the icons (`source:owner:slug`), same lifetime: a market title fetched
 * once shows on the market card and on the installed row without a second request.
 * @param {string} key - a `marketKeyOf()` product.
 * @param {object} market - the market sub-state.
 * @returns {string|null} the cached title, or null when there is none.
 */
export function nameFor(key, market) {
  if (typeof key !== 'string' || key === '') return null;
  const cached = market?.names?.[key];
  return typeof cached === 'string' && cached !== '' ? cached : null;
}

/**
 * Titles the market list already carries, reshaped into the cache's key space.
 *
 * `market/list` items carry `displayName` (on SkillHub that is the market title), so an
 * installed row can show the upstream title without any request as soon as the list is in.
 * Like the icon seeds, a seed is a known answer and therefore does not touch
 * `iconsTried`.
 * @param {object} market - the market sub-state.
 * @returns {Record<string, string>|null} `{[key]: title}` to seed, or null when nothing new.
 */
export function nameSeeds(market) {
  const items = Array.isArray(market?.items) ? market.items : [];
  const seeds = {};
  let count = 0;
  for (const item of items) {
    if (typeof item?.displayName !== 'string' || item.displayName === '') continue;
    const key = marketKeyOf(item);
    if (nameFor(key, market) !== null) continue;
    seeds[key] = item.displayName;
    count += 1;
  }
  return count === 0 ? null : seeds;
}

/**
 * The title an installed row shows, in priority order.
 *
 *   1. the upstream title, once this session has it (market list seed, or the batch that
 *      fills `market.names`);
 *   2. the local `metadata.displayName` the Host parsed out of `SKILL.md` (offline fallback);
 *   3. the skill's own `name` - the kebab-case id the model actually calls.
 *
 * Rows with no `upstream` identity simply start at step 2. The kebab name never disappears
 * from the row: it becomes the tooltip, because that is the string used in prompts.
 * @param {object} row - a catalog row.
 * @param {object} market - the market sub-state.
 * @returns {string} the visible title (never empty unless the row itself is empty).
 */
export function rowTitleOf(row, market) {
  const upstream = row?.upstream ?? null;
  const fromUpstream = upstream === null ? null : nameFor(marketKeyOf(upstream), market);
  if (fromUpstream !== null) return fromUpstream;
  if (typeof row?.displayName === 'string' && row.displayName !== '') return row.displayName;
  return typeof row?.name === 'string' ? row.name : '';
}

/**
 * The one selector both surfaces feed: which icons to ask for next.
 *
 * Two halves, market first (a market entry that still has no icon is the case the list
 * route could not answer, and it carries the fuller record):
 *   - the market list's own candidates (`iconCandidates`, ClawHub only), tagged with
 *     their source id;
 *   - installed rows whose `_meta.json` gave them an identity this client can resolve,
 *     that have no cached icon yet, and that this session has not asked about.
 * Deduplicated by key (first appearance wins), capped at 12 per source and 24 in total -
 * the same limits the route enforces, so a full batch is never rejected.
 * @param {object|null} payload - the installed-list payload (`{groups}`), or null.
 * @param {object} market - the market sub-state.
 * @returns {{key: string, sourceId: string, owner: string, slug: string}[]} the batch.
 */
export function iconBatch(payload, market) {
  const picked = [];
  const seen = new Set();
  const perSource = new Map();
  const room = () => picked.length < ICONS_PER_BATCH;
  const take = (entry) => {
    if (!room() || seen.has(entry.key)) return false;
    if (!MARKET_SOURCE_IDS.includes(entry.sourceId)) return false;
    // One malformed triple would make the route reject the whole batch (its parameters are
    // validated per request), so a bad entry is skipped here instead of taking the good
    // ones down with it.
    if (typeof entry.owner !== 'string' || entry.owner === '') return false;
    if (typeof entry.slug !== 'string' || entry.slug === '') return false;
    const used = perSource.get(entry.sourceId) ?? 0;
    if (used >= ICONS_PER_SOURCE) return false;
    seen.add(entry.key);
    perSource.set(entry.sourceId, used + 1);
    picked.push(entry);
    return true;
  };

  for (const candidate of iconCandidates(market, ICONS_PER_BATCH)) {
    if (!room()) break;
    take({ key: candidate.id, sourceId: 'clawhub', owner: candidate.owner, slug: candidate.slug });
  }

  const groups = Array.isArray(payload?.groups) ? payload.groups : [];
  const tried = market?.iconsTried ?? {};
  for (const group of groups) {
    if (!room()) break;
    const rows = Array.isArray(group?.skills) ? group.skills : [];
    for (const row of rows) {
      if (!room()) break;
      const upstream = row?.upstream ?? null;
      if (upstream === null) continue;
      if (!MARKET_SOURCE_IDS.includes(upstream.sourceId)) continue;
      const key = marketKeyOf(upstream);
      if (tried[key] === true || iconUrlFor(key, market) !== null) continue;
      take({ key, sourceId: upstream.sourceId, owner: upstream.owner, slug: upstream.slug });
    }
  }
  return picked;
}

/**
 * The author handle of one item: `owner/slug`, then `owner`, then the publisher name.
 *
 * The card shows a handle rather than the publisher's display name because both market
 * sources always carry an owner and a slug - the route's own whitelist requires them -
 * while `author` (the publisher's display name) may be missing. The publisher name is
 * still visible in the detail view's fact table.
 * @param {object} item - a MarketItem, or anything carrying the same fields.
 * @returns {string|null} the handle to show, or null when there is nothing to show.
 */
export function authorTextOf(item) {
  const owner = typeof item?.owner === 'string' ? item.owner : '';
  const slug = typeof item?.slug === 'string' ? item.slug : '';
  if (owner !== '' && slug !== '') return `${owner}/${slug}`;
  if (owner !== '') return owner;
  const author = typeof item?.author === 'string' ? item.author : '';
  return author === '' ? null : author;
}

/**
 * The author line's segments, in display order: the handle, then the version.
 *
 * Two segments, and an absent field is an absent segment - never an empty one. The
 * figures moved out of this line into `statSegments`, which is why a card can no longer
 * claim "0 downloads" here.
 * @param {object} item - a MarketItem.
 * @returns {{key: string, param: string, value: string}[]} locale key, its interpolation
 *   name, and the value to interpolate.
 */
export function metaSegments(item) {
  const segments = [];
  const handle = authorTextOf(item);
  if (handle !== null) {
    segments.push({ key: 'market.metaAuthor', param: 'author', value: handle });
  }
  if (typeof item?.version === 'string' && item.version !== '') {
    segments.push({ key: 'market.metaVersion', param: 'version', value: item.version });
  }
  return segments;
}

/** The figure slots of one card, in the order they are drawn (rating first: the sketch). */
export const MARKET_STAT_SLOTS = Object.freeze(['rating', 'downloads', 'saves']);

/** The top of the upstream popularity score, which maps onto a rating of 5.0. */
const SCORE_TOP = 100000;

/** The bottom of the projected rating scale. */
const RATING_BASE = 4;

/**
 * The projected rating of one item: the upstream score folded onto 4.0-5.0.
 *
 * `null` for a missing score **and** for a score of zero or less, because
 * `scoreToRating(0)` is `4.0` - indistinguishable from an upstream that really said 4.0,
 * and a 4.0 drawn out of thin air is exactly the fake number the "never show a zero"
 * rule exists to prevent.
 * @param {object} item - a MarketItem.
 * @returns {number|null} one decimal, 4.0-5.0, or null.
 */
export function ratingOf(item) {
  const score = item?.score;
  if (!Number.isFinite(score) || score <= 0) return null;
  return Math.round((RATING_BASE + Math.min(1, score / SCORE_TOP)) * 10) / 10;
}

/**
 * A rating as the card writes it: always one decimal, always a dot.
 *
 * `toFixed` and not `Intl.NumberFormat` on purpose: a scale reading is fixed, and in a
 * German or French locale `Intl` would spell it `4,6` - a different glyph in a
 * fixed-width slot, and a value that no longer matches its neighbours on screen. Counts
 * (downloads, saves) are the ones that go through the locale-aware `countText`.
 * @param {number|null} rating - a `ratingOf` product.
 * @returns {string|null} e.g. `4.6`, or null when there is no rating.
 */
export function ratingTextOf(rating) {
  return Number.isFinite(rating) ? rating.toFixed(1) : null;
}

/**
 * The three figure slots of one card, always three.
 *
 * The order is rating, downloads, saves (the user's sketch); the slot *identity* is what
 * `StatMark` and `labelKey` follow, so reordering cannot swap an icon or a sentence.
 *
 * The slots are fixed even when a source reports nothing: the track stays, the contents
 * do not. Three fixed slots are the only way the same column lands on the same x in every
 * card of a row, so an item missing its saves cannot push its rating into slot two. A
 * slot that is not `present` is drawn as an empty span with no icon, no number and no
 * zero; when all three are absent the caller drops the whole line.
 * @param {object} item - a MarketItem.
 * @returns {{slot: string, present: boolean, value: string|null, labelKey: string,
 *   param: string}[]} one entry per slot, in `MARKET_STAT_SLOTS` order.
 */
export function statSegments(item) {
  const rating = ratingOf(item);
  return [
    {
      slot: 'rating',
      present: Number.isFinite(rating),
      value: ratingTextOf(rating),
      labelKey: 'market.metaRating',
      param: 'rating',
    },
    {
      slot: 'downloads',
      present: Number.isFinite(item?.downloads),
      value: countText(item?.downloads),
      labelKey: 'market.metaDownloads',
      param: 'count',
    },
    {
      slot: 'saves',
      present: Number.isFinite(item?.saves),
      value: countText(item?.saves),
      labelKey: 'market.metaSaves',
      param: 'count',
    },
  ];
}

/**
 * Whether the category chip row belongs on screen, and which categories it offers.
 *
 * Three rules, all of them user-visible: a source that publishes no categories hides
 * the row instead of offering a filter that can only return nothing; a failed
 * `bootstrap` hides the row and says so in its place; an empty list hides it silently.
 * @param {object} market - the market sub-state.
 * @returns {{visible: boolean, unavailable: boolean, items: object[]}} the row's fate.
 */
export function visibleCategories(market) {
  const selected = market?.filters?.source ?? MARKET_DEFAULT_SOURCE;
  const sources = Array.isArray(market?.sources) ? market.sources : [];
  const categories = Array.isArray(market?.categories) ? market.categories : [];
  const descriptor = sources.find((source) => source?.id === selected);
  const hasCategories = descriptor === undefined
    ? !NO_CATEGORY_SOURCES.has(selected)
    : descriptor.hasCategories === true;
  if (!hasCategories) return { visible: false, unavailable: false, items: [] };
  if (market?.categoriesOk === false) return { visible: false, unavailable: true, items: [] };
  if (categories.length === 0) return { visible: false, unavailable: false, items: [] };
  return { visible: true, unavailable: false, items: categories };
}

/**
 * The chips to draw, with the "all categories" chip first.
 * @param {object[]} categories - `{key, name, nameEn}` entries from `bootstrap`.
 * @returns {{value: string|null, label: string}[]} machine value plus display text;
 *   the `null` chip has no label of its own and is rendered from the dictionary.
 */
export function chipList(categories, options = {}) {
  const items = Array.isArray(categories) ? categories : [];
  const countsOk = options.countsOk !== false;
  const total = Number.isFinite(options.total) ? options.total : null;
  const countOf = (value) => (countsOk && Number.isFinite(value) ? value : null);
  return [
    { value: null, label: '', count: countOf(total) },
    ...items.map((category) => ({
      value: typeof category?.key === 'string' ? category.key : '',
      label: category?.name || category?.nameEn || category?.key || '',
      count: countOf(category?.count),
    })),
  ];
}

/**
 * A compact count for a chip ("1.3M", "13K", and whatever the runtime's default locale
 * spells them as). Returns null for "there is no number", which the chip renders as
 * nothing at all - never a zero placeholder, never a dash.
 * @param {unknown} value - the count from bootstrap.
 * @returns {string|null} the formatted number, or null.
 */
export function countText(value) {
  if (!Number.isFinite(value) || value < 0) return null;
  try {
    return new Intl.NumberFormat(undefined, { notation: 'compact' }).format(value);
  } catch {
    return String(value);
  }
}

/**
 * Which action a card offers right now, and why the last attempt failed.
 * @param {object} market - the market sub-state.
 * @param {string} id - the item's market key.
 * @returns {{state: 'ready'|'installing'|'installed'|'failed', path?: string, reason?: string}} the card's state.
 */
export function installViewOf(market, id) {
  const runtime = market?.installs?.[id];
  if (runtime !== undefined && runtime !== null) {
    if (runtime.state === 'installing') return { state: 'installing' };
    if (runtime.state === 'installed') return { state: 'installed', path: runtime.path ?? '' };
    if (runtime.state === 'failed') return { state: 'failed', reason: runtime.reason ?? '' };
  }
  const record = market?.installed?.[id];
  if (record !== undefined && record !== null && record.exists !== false) {
    return { state: 'installed', path: record.path ?? '' };
  }
  return { state: 'ready' };
}

/**
 * Which empty state the list is in, if any.
 * @param {object} market - the market sub-state.
 * @returns {'search'|'category'|'source'|null} the empty kind, or null when the list is not empty.
 */
export function emptyKindOf(market) {
  if (market?.listStatus !== 'ready') return null;
  if (Array.isArray(market.items) && market.items.length > 0) return null;
  if (market?.page?.status === 'loading') return null;
  if (typeof market.keyword === 'string' && market.keyword.trim() !== '') return 'search';
  if (market?.filters?.category !== null && market?.filters?.category !== undefined) return 'category';
  return 'source';
}

/**
 * The six facts the detail view states, in order. Unknown values say so; they are
 * never blank and never invented.
 * @param {object} detail - a MarketDetail (or null while loading).
 * @param {object} market - the market sub-state, for the category table.
 * @param {Function} t - translate function.
 * @returns {{label: string, value: string, code: boolean}[]} table rows.
 */
export function detailFacts(detail, market, t) {
  const item = detail?.item ?? {};
  const unknown = t('market.factUnknown');
  const categories = Array.isArray(market?.categories) ? market.categories : [];
  const category = categories.find((entry) => entry?.key === item.category);
  const text = (value) => (typeof value === 'string' && value !== '' ? value : null);
  const sourceId = text(item.sourceId);
  return [
    { label: t('market.factSource'), value: sourceId === null ? unknown : t(`market.source.${sourceId}`), code: false },
    { label: t('market.factAuthor'), value: text(item.author) ?? unknown, code: false },
    { label: t('market.factVersion'), value: text(item.version) ?? unknown, code: false },
    {
      label: t('market.factDownloads'),
      value: Number.isFinite(item.downloads) ? String(item.downloads) : unknown,
      code: false,
    },
    {
      label: t('market.factCategory'),
      value: category === undefined ? unknown : (category.name || category.nameEn || category.key || unknown),
      code: false,
    },
    { label: t('market.factInstallTo'), value: text(detail?.installTo) ?? unknown, code: true },
  ];
}

/**
 * The locale key that explains a failed market call.
 * @param {string} code - the route's `E_*` code.
 * @returns {string} a key that exists in both dictionaries.
 */
export function reasonKeyOf(code) {
  return MARKET_ERROR_CODES.has(code) ? `error.${code}` : 'error.E_UNKNOWN';
}

/**
 * The source descriptors the panel may query, whether or not `bootstrap` answered.
 * @param {object} market - the market sub-state.
 * @returns {{id: string, labelKey: string, hasCategories: boolean, packageKind: string}[]} descriptors.
 */
export function sourceDescriptors(market) {
  const sources = Array.isArray(market?.sources) ? market.sources.filter((source) => typeof source?.id === 'string') : [];
  return sources.length > 0 ? sources : [...MARKET_FALLBACK_SOURCES];
}

/**
 * The sources a fresh query fans out to.
 * @param {object} market - the market sub-state.
 * @returns {string[]} source ids, in render order.
 */
export function queriedSources(market) {
  return [market?.filters?.source ?? MARKET_DEFAULT_SOURCE];
}

/**
 * The sources an append fans out to: only those that still have a cursor. A source
 * that ran dry is never asked again, so scrolling deeper gets cheaper.
 * @param {object} market - the market sub-state.
 * @returns {string[]} source ids that still have a next page.
 */
export function pagedSources(market) {
  const cursors = market?.cursors ?? {};
  return queriedSources(market).filter((id) => cursors[id] !== null);
}

/**
 * The display label of one source id.
 * @param {string} sourceId - `skillhub`, `clawhub`, or a source added later.
 * @param {Function} t - translate function.
 * @returns {string} the localized source name.
 */
export function sourceLabelOf(sourceId, t) {
  return t(`market.source.${sourceId}`);
}
