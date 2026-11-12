/**
 * The plugin's own favourites list: `$DSH_HOME/dsh-skill-panel/favorites.json`.
 *
 * This is the third file in that directory next to `installed.json` and
 * `provider-toggles.json`, and it is deliberately *ours*: the host's skill manager
 * (`~/.dsh/skills-manager/state.json`), the other market plugin's tree and
 * `.skills-lock.json` are read-only to this panel (AGENTS.md rule 10), so a bookmark
 * cannot live in any of them.
 *
 * The document is `{version: 1, favorites: ["skillhub:ake:dev-god", ...]}`, most recent
 * first. An array rather than an object keyed by id, for the same reason
 * `provider-toggles.json` is one: the identity contains colons, so using it as an object
 * key would push a separator decision into the file format.
 *
 * Three properties are worth more than any feature here:
 *
 * 1. **A corrupt file never breaks the page, and a missing one is not corrupt.** A
 *    non-JSON file, a top-level non-object, a `favorites` that is not an array, or a file
 *    that cannot be read at all (EACCES, EISDIR) reads as an empty list with
 *    `readable: false`; `market/bootstrap` still answers 200. A file that simply is not
 *    there is a first run - nobody has saved anything yet - so it reads as an empty list
 *    with `readable: true` (`favoritesOk`'s only meaning is "your bookmarks may be lost").
 * 2. **Every write is atomic.** The bytes go through `store.js`'s `writeAtomic`
 *    (temp file + fsync + rename), so a crash mid-write leaves the previous list intact.
 * 3. **Read-modify-write is serialised inside this process.** Two rapid clicks are two
 *    turns of the same queue, so the second cannot overwrite the first with a stale list.
 *    Two *processes* sharing one DSH home are out of scope, as with the rest of this
 *    plugin's local writes.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { marketError } from './errors.js';
import { writeAtomic } from './store.js';

/** Document version; bumped only for an incompatible change. */
export const FAVORITES_VERSION = 1;

/** Bookmarks kept; older ones fall off the end. */
export const MAX_FAVORITES = 500;

/**
 * The shape of one bookmark identity: `sourceId:owner:slug`.
 *
 * The three parts are the same whitelists the install route forwards upstream
 * (`lib/names.js`), joined by the separator `normalize.js` uses. A value that is not
 * exactly this shape could never have been produced by this plugin, so the read side
 * drops it instead of carrying it around.
 */
const FAVORITE_ID = /^[a-z][a-z0-9-]{0,31}:[A-Za-z0-9][A-Za-z0-9._-]{0,63}:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Longest bookmark kept, in characters (the shape above tops out well below this). */
const MAX_ID_LENGTH = 200;

/**
 * Path of the favourites file inside a DSH home.
 * @param {string} dshHome - DSH home directory.
 * @returns {string} absolute file path.
 */
export function favoritesFile(dshHome) {
  return join(dshHome, 'dsh-skill-panel', 'favorites.json');
}

/**
 * Whether one value is a switchable bookmark identity.
 * @param {unknown} value - candidate.
 * @returns {boolean} true for `sourceId:owner:slug` with whitelisted parts.
 */
export function isFavoriteId(value) {
  return typeof value === 'string' && value.length <= MAX_ID_LENGTH && FAVORITE_ID.test(value);
}

/**
 * Parse a favourites document, degrading every defect to "empty".
 *
 * Bad entries are dropped one by one (a hand-edited file should cost the broken lines,
 * not the whole list); duplicates keep their first position; anything past the cap is cut.
 * @param {unknown} raw - file text.
 * @returns {{favorites: string[], readable: boolean}} the list and whether it parsed.
 */
export function deserializeFavorites(raw) {
  let parsed;
  try {
    parsed = JSON.parse(typeof raw === 'string' ? raw : String(raw));
  } catch {
    return { favorites: [], readable: false };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { favorites: [], readable: false };
  }
  if (!Array.isArray(parsed.favorites)) return { favorites: [], readable: false };
  const favorites = [];
  const seen = new Set();
  for (const entry of parsed.favorites) {
    if (!isFavoriteId(entry) || seen.has(entry)) continue;
    seen.add(entry);
    favorites.push(entry);
    if (favorites.length >= MAX_FAVORITES) break;
  }
  return { favorites, readable: true };
}

/**
 * Render a favourites document.
 * @param {string[]} ids - bookmarks, most recent first.
 * @returns {string} file text.
 */
export function serializeFavorites(ids) {
  const list = Array.isArray(ids) ? ids.filter((id) => isFavoriteId(id)) : [];
  return `${JSON.stringify({ version: FAVORITES_VERSION, favorites: list.slice(0, MAX_FAVORITES) }, null, 2)}\n`;
}

/**
 * Build the favourites client for one DSH home.
 * @param {{dshHome?: string}} [options] - the home the file lives under.
 * @returns {{file: string, read: () => Promise<{favorites: string[], readable: boolean}>,
 *   toggle: (id: string, favorited: boolean) => Promise<{favorites: string[], favorited: boolean}>}}
 *   the client.
 */
export function createFavoritesStore(options = {}) {
  const dshHome = typeof options.dshHome === 'string' ? options.dshHome : '';
  const file = favoritesFile(dshHome);
  /** The tail of the read-modify-write chain; every toggle queues behind it. */
  let queue = Promise.resolve();

  /**
   * Read the list.
   *
   * `ENOENT` means this panel has never saved anything here, which is the normal first
   * run and not a defect: it reads as an empty list that *is* readable, so `favoritesOk`
   * stays true and no "your bookmarks may be lost" warning is raised on a fresh install.
   * Every other read failure (and every parse failure) is a real one and answers `false`.
   * @returns {Promise<{favorites: string[], readable: boolean}>} the list and whether it
   *   could be read as a document.
   */
  const read = async () => {
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return { favorites: [], readable: true };
      return { favorites: [], readable: false };
    }
    return deserializeFavorites(text);
  };

  /**
   * Write one list, mapping any I/O failure onto the route's own code.
   * @param {string[]} ids - the list to persist.
   * @returns {Promise<void>} resolves once the rename landed.
   */
  const write = async (ids) => {
    try {
      await writeAtomic(file, serializeFavorites(ids), 'favorites');
    } catch (cause) {
      throw marketError('E_FAVORITE_IO', cause instanceof Error ? cause.message : String(cause));
    }
  };

  return {
    file,
    read,
    /**
     * Set one bookmark to a state, answering the whole list as it now stands.
     *
     * Idempotent by design: asking for the state a bookmark already has writes nothing
     * and still answers the current list, and removing one that is not there is a
     * success. That is what lets the card recover from a wrong local guess - clicking
     * "save" on something already saved cannot produce a second entry.
     * @param {string} id - `sourceId:owner:slug`, built by the Host from the request.
     * @param {boolean} favorited - the state the caller wants.
     * @returns {Promise<{favorites: string[], favorited: boolean}>} the authoritative list
     *   (most recent first) and the state that actually took effect.
     * @throws {import('./errors.js').MarketError} E_FAVORITE_FULL at the cap, E_FAVORITE_IO
     *   when the write fails.
     */
    toggle(id, favorited) {
      const wanted = favorited === true;
      const run = async () => {
        const { favorites } = await read();
        // An id this plugin could never have written is not added; the current list is
        // the honest answer, and it keeps the two failure codes the client knows about.
        if (!isFavoriteId(id)) return { favorites, favorited: false };
        const has = favorites.includes(id);
        if (has === wanted) return { favorites, favorited: has };
        if (!wanted) {
          const next = favorites.filter((entry) => entry !== id);
          await write(next);
          return { favorites: next, favorited: false };
        }
        if (favorites.length >= MAX_FAVORITES) {
          throw marketError('E_FAVORITE_FULL', `favourites are limited to ${MAX_FAVORITES}`);
        }
        const next = [id, ...favorites];
        await write(next);
        return { favorites: next, favorited: true };
      };
      const settled = queue.then(run, run);
      // The chain must survive a rejected toggle: the next click still has to run.
      queue = settled.then(() => undefined, () => undefined);
      return settled;
    },
  };
}
