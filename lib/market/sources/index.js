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
 * installer, all bound to one DSH home and one skills root.
 */
import { createInstaller } from '../install.js';
import { createStore } from '../store.js';
import { createUpstream } from '../upstream.js';
import { clawhubSource } from './clawhub.js';
import { skillhubSource } from './skillhub.js';

/** Every source the panel offers, in the order the filter lists them. */
export const SOURCES = [skillhubSource, clawhubSource];

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
 *   store: object, installer: object, skillsRoot: string, dispose: () => void}} the market deps.
 */
export function makeMarketDeps(options = {}) {
  const skillsRoot = typeof options.skillsRoot === 'string' ? options.skillsRoot : '';
  const dshHome = typeof options.dshHome === 'string' ? options.dshHome : '';
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const owned = options.io === undefined ? createUpstream() : null;
  const io = options.io ?? owned;
  const store = createStore({ dshHome, skillsRoot, now });
  const installer = createInstaller({ skillsRoot, io, sourceById: getSource, store, now });
  return {
    io,
    now,
    sources: SOURCES,
    sourceById: getSource,
    store,
    installer,
    skillsRoot,
    dispose() {
      owned?.dispose();
    },
  };
}
