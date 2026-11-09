/**
 * Pure view-model helpers for the skill market: no DOM, no fetch, no clock.
 *
 * Everything the market tab needs to decide "what to draw" is a function of the
 * merged item list, the filters, and the store's runtime flags, so the whole decision
 * surface can be unit-tested in node without a browser.
 *
 * Two sources are merged here and nowhere else (`mergeBatches`): each source answers
 * one page with its own cursor, so the interleave, the deduplication and the
 * "one side runs dry, the other keeps filling" rule all live in one pure function.
 */

/** The source ids the panel falls back to before `bootstrap` answers (or after it fails). */
export const MARKET_FALLBACK_SOURCES = Object.freeze([
  Object.freeze({ id: 'skillhub', labelKey: 'market.source.skillhub', hasCategories: true, packageKind: 'files' }),
  Object.freeze({ id: 'clawhub', labelKey: 'market.source.clawhub', hasCategories: false, packageKind: 'zip' }),
]);

/** Source ids that publish no category table even before `bootstrap` says so. */
const NO_CATEGORY_SOURCES = new Set(['clawhub']);

/** The filter value that means "do not narrow by source". */
export const SOURCE_ALL = 'all';

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
 * One `updatedAt` value, or null when the upstream did not give one.
 * @param {object} item - a MarketItem.
 * @returns {number|null} milliseconds since the epoch, or null.
 */
function updatedAtOf(item) {
  return Number.isFinite(item?.updatedAt) ? item.updatedAt : null;
}

/**
 * Newest first, unknown timestamps last, and stable for equal timestamps so that a
 * re-merge cannot reshuffle cards the user is already looking at.
 * @param {object[]} items - market items.
 * @returns {object[]} a new array in the requested order.
 */
function byUpdatedAt(items) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const a = updatedAtOf(left.item);
      const b = updatedAtOf(right.item);
      if (a === b) return left.index - right.index;
      if (a === null) return 1;
      if (b === null) return -1;
      return b - a;
    })
    .map((entry) => entry.item);
}

/**
 * Merge one round of per-source pages into the list.
 *
 * `recommended` and `downloads` interleave 1:1 in the order the sources are given,
 * which keeps each source's own ordering intact (they are not comparable across
 * sources); a source that runs out of items simply yields the rest of the round to
 * the other one. `updated` ignores the interleave and orders the whole list by time,
 * because that is what the user asked for when they picked it.
 * @param {{sourceId: string, items: object[]}[]} pages - one page per source, in render order.
 * @param {{existing?: object[], sort?: string}} [options] - already-rendered items and the sort.
 * @returns {object[]} the merged list: existing items first, then the new ones.
 */
export function mergeBatches(pages, options = {}) {
  const existing = Array.isArray(options.existing) ? options.existing : [];
  const lists = (Array.isArray(pages) ? pages : []).map((page) => (Array.isArray(page?.items) ? page.items : []));
  const seen = new Set(existing.map((item) => marketKeyOf(item)));
  const merged = [...existing];
  let longest = 0;
  for (const list of lists) longest = Math.max(longest, list.length);
  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) {
      const item = list[index];
      if (item === undefined || item === null) continue;
      const key = marketKeyOf(item);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return options.sort === 'updated' ? byUpdatedAt(merged) : merged;
}

/**
 * The meta line's segments, in display order. A missing field is an absent segment,
 * never a zero: a card that claims "0 downloads" is lying about a null.
 * @param {object} item - a MarketItem.
 * @returns {{key: string, param: string, value: string}[]} locale key, its interpolation
 *   name, and the value to interpolate.
 */
export function metaSegments(item) {
  const segments = [];
  if (typeof item?.author === 'string' && item.author !== '') {
    segments.push({ key: 'market.metaAuthor', param: 'author', value: item.author });
  }
  if (typeof item?.version === 'string' && item.version !== '') {
    segments.push({ key: 'market.metaVersion', param: 'version', value: item.version });
  }
  if (Number.isFinite(item?.downloads)) {
    segments.push({ key: 'market.metaDownloads', param: 'count', value: String(item.downloads) });
  }
  return segments;
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
  const selected = market?.filters?.source ?? SOURCE_ALL;
  const sources = Array.isArray(market?.sources) ? market.sources : [];
  const categories = Array.isArray(market?.categories) ? market.categories : [];
  if (selected !== SOURCE_ALL) {
    const descriptor = sources.find((source) => source?.id === selected);
    const hasCategories = descriptor === undefined
      ? !NO_CATEGORY_SOURCES.has(selected)
      : descriptor.hasCategories === true;
    if (!hasCategories) return { visible: false, unavailable: false, items: [] };
  }
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
export function chipList(categories) {
  const items = Array.isArray(categories) ? categories : [];
  return [
    { value: null, label: '' },
    ...items.map((category) => ({
      value: typeof category?.key === 'string' ? category.key : '',
      label: category?.name || category?.nameEn || category?.key || '',
    })),
  ];
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
  const ids = sourceDescriptors(market).map((source) => source.id);
  const selected = market?.filters?.source ?? SOURCE_ALL;
  return selected === SOURCE_ALL ? ids : [selected];
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
