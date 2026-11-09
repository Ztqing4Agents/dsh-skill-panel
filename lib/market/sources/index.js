/**
 * The source registry, and the one place the market assembly happens.
 *
 * Adding a source is meant to cost one file plus one line: implement the contract in
 * `lib/market/sources/<id>.js`, add it to `SOURCES`, add one copy key per dictionary.
 * The page, the merge, the install pipeline and the routes never enumerate sources, so
 * none of them change.
 *
 * `makeMarketDeps` is what `index.js` hands to `makeRoutes`: the injected upstream
 * client (or a fake one, in tests), the clock, the registry, the ledger and the
 * installer and the favourites list, all bound to one DSH home and one skills root.
 */
import { createFavoritesStore } from '../favorites.js';
import { createInstaller } from '../install.js';
import { createStore } from '../store.js';
import { createUpstream } from '../upstream.js';
import { clawhubSource, resetIconCache } from './clawhub.js';
import { resetSkillhubIconCache, skillhubSource } from './skillhub.js';

/** Every source the panel offers, in the order the filter lists them. */
export const SOURCES = [skillhubSource, clawhubSource];

/**
 * The three scopes the source menu offers, in menu order.
 *
 * A scope is a *query filter*, not an identity: `all` sends no `source` upstream and has
 * no owner, no package and no adapter of its own - it borrows the SkillHub adapter because
 * that adapter talks to the mirror itself, and the mirror answers the unfiltered list.
 * Keeping scopes out of `SOURCES` is what stops `all` from ever reaching `detail`,
 * `install` or `icons`.
 */
export const SCOPES = [
  { id: 'all', labelKey: 'market.source.all', sourceParam: null, adapterId: 'skillhub' },
  { id: 'skillhub', labelKey: 'market.source.skillhub', sourceParam: 'community', adapterId: 'skillhub' },
  { id: 'clawhub', labelKey: 'market.source.clawhub', sourceParam: 'clawhub', adapterId: 'clawhub' },
];

/**
 * Look one scope up.
 * @param {string} id - scope id.
 * @returns {{id: string, labelKey: string, sourceParam: string|null, adapterId: string}|undefined}
 *   the scope, or undefined for anything else.
 */
export function scopeById(id) {
  return SCOPES.find((scope) => scope.id === id);
}

/**
 * Describe the scopes, as `market/bootstrap` returns them. Every scope publishes the same
 * category table and the same package shape, so both flags are true for all three.
 * @returns {{id: string, labelKey: string, hasCategories: boolean, packageKind: 'files'}[]} descriptors.
 */
export function scopesFor() {
  return SCOPES.map((scope) => ({
    id: scope.id,
    labelKey: scope.labelKey,
    hasCategories: true,
    packageKind: 'files',
  }));
}

/**
 * Every registered source id.
 * @returns {string[]} the ids.
 */
export function ids() {
  return SOURCES.map((source) => source.id);
}

/**
 * Look one source up.
 * @param {string} id - source id.
 * @returns {object|undefined} the adapter.
 */
export function getSource(id) {
  return SOURCES.find((source) => source.id === id);
}

/**
 * Describe one list of sources, as `market/bootstrap` returns them; the browser
 * renders the source filter from this list rather than from a hard-coded set.
 * @param {object[]} sources - adapters, in filter order.
 * @returns {{id: string, labelKey: string, hasCategories: boolean, packageKind: 'files'|'zip'}[]} descriptors.
 */
export function descriptorsOf(sources) {
  return (Array.isArray(sources) ? sources : []).map((source) => ({
    id: source.id,
    labelKey: source.labelKey,
    hasCategories: source.caps?.categories === true,
    packageKind: source.caps?.package === 'zip' ? 'zip' : 'files',
  }));
}

/**
 * Describe every registered source.
 * @returns {{id: string, labelKey: string, hasCategories: boolean, packageKind: 'files'|'zip'}[]} descriptors.
 */
export function descriptors() {
  return descriptorsOf(SOURCES);
}

/**
 * Assemble the market dependencies for one host instance.
 * @param {{skillsRoot?: string, dshHome?: string, io?: object, now?: () => number,
 *   logger?: {warn: Function}}} [options] - roots and injectable seams.
 * @returns {{io: object, now: () => number, sources: object[], sourceById: (id: string) => object|undefined,
 *   store: object, favorites: object, installer: object,
 *   skillsRoot: string, resetIconCache: () => void, dispose: () => void}} the market deps.
 */
export function makeMarketDeps(options = {}) {
  const skillsRoot = typeof options.skillsRoot === 'string' ? options.skillsRoot : '';
  const dshHome = typeof options.dshHome === 'string' ? options.dshHome : '';
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const owned = options.io === undefined ? createUpstream() : null;
  const io = options.io ?? owned;
  const store = createStore({ dshHome, skillsRoot, now });
  // The bookmark list is its own file, not a field on the install ledger: a favourite is
  // not an install, and the ledger's shape is read by `lib/ledger.js`.
  const favorites = createFavoritesStore({ dshHome });
  const installer = createInstaller({ skillsRoot, io, sourceById: getSource, store, now });
  return {
    io,
    now,
    sources: SOURCES,
    sourceById: getSource,
    store,
    favorites,
    installer,
    skillsRoot,
    resetIconCache() {
      resetIconCache();
      resetSkillhubIconCache();
    },
    dispose() {
      owned?.dispose();
    },
  };
}
