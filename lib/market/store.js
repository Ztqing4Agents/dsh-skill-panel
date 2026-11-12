/**
 * The plugin's own install ledger: `$DSH_HOME/dsh-skill-center/installed.json`.
 *
 * Two readers depend on this file's shape, and both are already in the tree:
 *
 * - `lib/ledger.js` reads it as the `own-record` source and takes `installs[].name`
 *   (rule R5 of the partition ladder);
 * - `market/installed` reads it to answer "did this panel install that card".
 *
 * So the document is `{version, installs: [{source, owner, slug, name, dirName, fromPath,
 * version, installedAt, files, bytes}]}`: an array of records, each carrying `name`, which
 * is exactly what the existing reader looks for. Changing this shape would quietly drop
 * the R5 evidence for every skill this panel installs. `dirName` and `fromPath` describe
 * a record added from a local directory (`source: 'local'`); market records leave them
 * empty, and the reader above only ever needs `name`.
 *
 * A corrupt or unreadable file degrades to an empty ledger with `readable: false` -
 * the panel then shows "not installed" rather than failing the whole page.
 */
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { marketError } from './errors.js';

/** Store schema version; bumped only for an incompatible change. */
export const STORE_VERSION = 1;

/** Records kept; older entries fall off the end. */
export const MAX_RECORDS = 200;

/**
 * Path of the ledger inside a DSH home.
 * @param {string} dshHome - DSH home directory.
 * @returns {string} absolute ledger path.
 */
export function storeFile(dshHome) {
  return join(dshHome, 'dsh-skill-center', 'installed.json');
}

/**
 * An empty ledger document.
 * @returns {{version: number, installs: object[]}} the document.
 */
export function emptyStore() {
  return { version: STORE_VERSION, installs: [] };
}

/**
 * Coerce one record, dropping anything that cannot be read back.
 * @param {unknown} value - candidate record.
 * @returns {object|null} the record, or null.
 */
function normalizeRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = /** @type {Record<string, unknown>} */ (value);
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (name === '') return null;
  return {
    source: typeof record.source === 'string' ? record.source : '',
    owner: typeof record.owner === 'string' ? record.owner : '',
    slug: typeof record.slug === 'string' ? record.slug : '',
    name,
    dirName: typeof record.dirName === 'string' ? record.dirName : '',
    fromPath: typeof record.fromPath === 'string' ? record.fromPath : '',
    version: typeof record.version === 'string' ? record.version : null,
    installedAt: typeof record.installedAt === 'string' ? record.installedAt : null,
    files: typeof record.files === 'number' ? record.files : null,
    bytes: typeof record.bytes === 'number' ? record.bytes : null,
  };
}

/**
 * Parse a ledger document, degrading every defect to "empty".
 * @param {unknown} raw - file text.
 * @returns {{doc: {version: number, installs: object[]}, readable: boolean}} the document and whether it parsed.
 */
export function deserializeStore(raw) {
  let parsed;
  try {
    parsed = JSON.parse(typeof raw === 'string' ? raw : String(raw));
  } catch {
    return { doc: emptyStore(), readable: false };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { doc: emptyStore(), readable: false };
  }
  const installs = Array.isArray(parsed.installs) ? parsed.installs.map(normalizeRecord).filter(Boolean) : [];
  return { doc: { version: STORE_VERSION, installs }, readable: true };
}

/**
 * Render a ledger document.
 * @param {{version: number, installs: object[]}} doc - document.
 * @returns {string} file text.
 */
export function serializeStore(doc) {
  return `${JSON.stringify({ version: STORE_VERSION, installs: doc.installs }, null, 2)}\n`;
}

/**
 * Write bytes through a temp file, fsync, and rename.
 *
 * Exported because the favourites file wants exactly this durability and nobody should
 * audit two copies of it. The temp prefix is a parameter so two writers in the same
 * directory cannot race for one temp name: `installed` and `favorites` never collide.
 * @param {string} file - target file.
 * @param {string} text - contents.
 * @param {string} [tempPrefix] - temp file prefix, `installed` by default.
 * @returns {Promise<void>} resolves once the rename landed.
 */
export async function writeAtomic(file, text, tempPrefix = 'installed') {
  const directory = dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o755 });
  const stem = typeof tempPrefix === 'string' && tempPrefix !== '' ? tempPrefix : 'installed';
  const temp = join(directory, `.${stem}.${process.pid}.${Date.now()}.tmp`);
  let handle;
  try {
    handle = await open(temp, 'wx', 0o644);
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle?.close();
  }
  try {
    await rename(temp, file);
  } catch (cause) {
    await rm(temp, { force: true });
    throw marketError('E_INSTALL_IO', cause instanceof Error ? cause.message : String(cause));
  }
  await syncDirectory(directory);
}

/**
 * Best-effort directory fsync so the rename survives a crash.
 * @param {string} directory - directory to sync.
 * @returns {Promise<void>} resolves either way.
 */
async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch {
    // Directory fsync is not portable; the rename already landed.
  } finally {
    try {
      await handle?.close();
    } catch {
      // Already closed.
    }
  }
}

/**
 * Whether a path exists, without following a final symlink.
 * @param {string} path - absolute path.
 * @returns {Promise<boolean>} true when something is there.
 */
async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the ledger client for one DSH home.
 * @param {{dshHome: string, skillsRoot?: string, now?: () => number}} options - installation roots.
 * @returns {{file: string, read: Function, append: Function, remove: Function, installed: Function}} the client.
 */
export function createStore(options) {
  const dshHome = typeof options.dshHome === 'string' ? options.dshHome : '';
  const skillsRoot = typeof options.skillsRoot === 'string' ? options.skillsRoot : '';
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const file = storeFile(dshHome);

  /**
   * Read the ledger.
   * @returns {Promise<{doc: {version: number, installs: object[]}, readable: boolean}>} the document.
   */
  const read = async () => {
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      return { doc: emptyStore(), readable: false };
    }
    return deserializeStore(text);
  };

  return {
    file,
    read,
    /**
     * Append one install record, keeping a single record per skill name.
     * @param {{source: string, owner: string, slug: string, name: string, version: string|null,
     *   files?: number|null, bytes?: number|null}} record - the install.
     * @returns {Promise<{version: number, installs: object[]}>} the document written.
     */
    async append(record) {
      const { doc } = await read();
      const normalized = normalizeRecord({
        ...record,
        installedAt: typeof record.installedAt === 'string' ? record.installedAt : new Date(now()).toISOString(),
      });
      if (normalized === null) throw marketError('E_INSTALL_IO', 'install record has no name');
      const installs = [normalized, ...doc.installs.filter((entry) => entry.name !== normalized.name)]
        .slice(0, MAX_RECORDS);
      const next = { version: STORE_VERSION, installs };
      await writeAtomic(file, serializeStore(next));
      return next;
    },
    /**
     * Drop the record of one skill name, if there is one.
     *
     * Idempotent on purpose: the delete route calls this after the directory is gone,
     * and "there was nothing to clear" is a success, not a failure. A record for a
     * different name is never touched.
     * @param {string} name - the skill name to forget.
     * @returns {Promise<{doc: {version: number, installs: object[]}, removed: boolean}>} the
     *   document as it now stands, and whether a record was actually dropped.
     */
    async remove(name) {
      const { doc } = await read();
      const installs = doc.installs.filter((entry) => entry.name !== name);
      if (installs.length === doc.installs.length) return { doc, removed: false };
      const next = { version: STORE_VERSION, installs };
      await writeAtomic(file, serializeStore(next));
      return { doc: next, removed: true };
    },
    /**
     * The map the market page uses to mark cards as installed.
     *
     * Keyed by `${source}:${owner}:${slug}`, which is the same key the browser derives
     * from a MarketItem, so no slug guessing happens on either side.
     * @returns {Promise<{items: Record<string, {name: string, version: string|null, path: string, exists: boolean}>,
     *   readable: boolean}>} the installed view.
     */
    async installed() {
      const { doc, readable } = await read();
      const items = {};
      for (const record of doc.installs) {
        const path = join(skillsRoot, record.name);
        items[`${record.source}:${record.owner}:${record.slug}`] = {
          name: record.name,
          version: record.version,
          path,
          exists: await pathExists(path),
        };
      }
      return { items, readable };
    },
  };
}
