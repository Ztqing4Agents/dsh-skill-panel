/**
 * The panel-owned store for provider-skill switches.
 *
 * A built-in skill has no file this panel may edit, so its switch state lives
 * here, under `$DSH_HOME/dsh-skill-panel/provider-toggles.json`. The identity is
 * `{provider, name}` stored as an array rather than an object key: provider ids
 * have no grammar, so `${provider}#${name}` as a key would invite separator
 * injection.
 *
 * Every corruption degrades to "nothing disabled" - this file must never be able
 * to break the list route.
 */
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { isSkillName } from './names.js';

/** Schema version of the stored document. */
const VERSION = 1;

/** Refuse anything bigger; a corrupted store must not be read into memory. */
const MAX_STORE_BYTES = 65536;

/** Provider ids are opaque, but bounded and printable. */
const PROVIDER = /^[\x20-\x7e]{0,64}$/;

/**
 * @typedef {Object} ProviderToggleDoc
 * @property {number} version
 * @property {{provider: string, name: string}[]} disabled
 * @property {string[]} diagnostics degradation notes
 */

/**
 * The store file for a DSH home.
 * @param {string} dshHome - DSH home directory.
 * @returns {string} absolute path of the store.
 */
function storeFile(dshHome) {
  return join(dshHome, 'dsh-skill-panel', 'provider-toggles.json');
}

/**
 * Normalise one stored entry, or drop it.
 * @param {unknown} entry - stored record.
 * @returns {{provider: string, name: string}|null} the entry, or null when malformed.
 */
function normalizeEntry(entry) {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
  const record = /** @type {Record<string, unknown>} */ (entry);
  const provider = record.provider === undefined || record.provider === null ? '' : record.provider;
  const name = record.name;
  if (typeof provider !== 'string' || !PROVIDER.test(provider)) return null;
  if (!isSkillName(name)) return null;
  return { provider, name };
}

/**
 * Sort disabled entries so the serialised document is stable.
 * @param {{provider: string, name: string}[]} entries - normalised entries.
 * @returns {{provider: string, name: string}[]} sorted copy.
 */
function sorted(entries) {
  return [...entries].sort((left, right) => {
    if (left.provider !== right.provider) return left.provider < right.provider ? -1 : 1;
    if (left.name === right.name) return 0;
    return left.name < right.name ? -1 : 1;
  });
}

/**
 * Parse a stored document, degrading every malformation to an empty set.
 * @param {string|null} raw - file text, or null when the file is absent.
 * @returns {ProviderToggleDoc} the parsed document.
 */
export function deserialize(raw) {
  if (typeof raw !== 'string' || raw === '') return { version: VERSION, disabled: [], diagnostics: [] };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { version: VERSION, disabled: [], diagnostics: ['provider-toggles:invalid-json'] };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { version: VERSION, disabled: [], diagnostics: ['provider-toggles:not-an-object'] };
  }
  if (parsed.version !== VERSION) return { version: VERSION, disabled: [], diagnostics: ['provider-toggles:version'] };
  if (!Array.isArray(parsed.disabled)) return { version: VERSION, disabled: [], diagnostics: ['provider-toggles:disabled'] };
  const disabled = [];
  let dropped = false;
  for (const entry of parsed.disabled) {
    const normalized = normalizeEntry(entry);
    if (normalized === null) {
      dropped = true;
      continue;
    }
    disabled.push(normalized);
  }
  return {
    version: VERSION,
    disabled: sorted(disabled),
    diagnostics: dropped ? ['provider-toggles:entries'] : [],
  };
}

/**
 * Serialise a document in its stable on-disk form.
 * @param {ProviderToggleDoc} doc - document to write.
 * @returns {string} JSON text with a trailing newline.
 */
export function serialize(doc) {
  return `${JSON.stringify({ version: VERSION, disabled: sorted(doc.disabled) }, null, 2)}\n`;
}

/**
 * Read the store.
 * @param {string} dshHome - DSH home directory.
 * @returns {Promise<ProviderToggleDoc>} the document; missing and corrupt files read as empty.
 */
export async function read(dshHome) {
  const file = storeFile(dshHome);
  let info;
  try {
    info = await stat(file);
  } catch {
    return { version: VERSION, disabled: [], diagnostics: [] };
  }
  if (!info.isFile() || info.size > MAX_STORE_BYTES) {
    return { version: VERSION, disabled: [], diagnostics: ['provider-toggles:too-large'] };
  }
  try {
    return deserialize(await readFile(file, 'utf8'));
  } catch {
    return { version: VERSION, disabled: [], diagnostics: ['provider-toggles:unreadable'] };
  }
}

/**
 * Add or remove one identity, then write atomically.
 *
 * Two disables of the same identity leave one row; enabling an identity that is
 * not stored writes nothing at all.
 * @param {string} dshHome - DSH home directory.
 * @param {{provider: string, name: string}} identity - provider and skill name.
 * @param {boolean} enabled - the desired enabled state.
 * @returns {Promise<ProviderToggleDoc>} the document after the change.
 * @throws {Error} with `code` 'E_WRITE_FAILED' when the store cannot be written.
 */
export async function setEnabled(dshHome, identity, enabled) {
  const current = await read(dshHome);
  const next = current.disabled.filter((entry) => !(entry.provider === identity.provider && entry.name === identity.name));
  if (!enabled) next.push({ provider: identity.provider, name: identity.name });
  if (next.length === current.disabled.length
    && next.every((entry, index) => entry.provider === current.disabled[index].provider && entry.name === current.disabled[index].name)) {
    return current;
  }
  const doc = { version: VERSION, disabled: sorted(next), diagnostics: [] };
  const file = storeFile(dshHome);
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await mkdir(join(dshHome, 'dsh-skill-panel'), { recursive: true });
    await writeFile(temp, serialize(doc), { encoding: 'utf8', flag: 'wx' });
    await rename(temp, file);
  } catch (cause) {
    try {
      await unlink(temp);
    } catch {
      // The temp file never landed; nothing to clean up.
    }
    const error = new Error(cause instanceof Error ? cause.message : String(cause));
    error.code = 'E_WRITE_FAILED';
    throw error;
  }
  return doc;
}
