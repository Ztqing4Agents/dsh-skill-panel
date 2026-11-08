/**
 * Read-only install ledger facts (rule R5).
 *
 * Four ledgers can prove that a directory under the skills root was installed
 * rather than hand-written. On this machine three of them are empty or missing,
 * which is exactly why the classifier needs the whole R5 -> R8 ladder: this
 * module never guesses, it only reports what the files say.
 *
 * Nothing here ever writes. `skills-manager/state.json`, `skill-market/*`, and
 * `.skills-lock.json` belong to other plugins.
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Largest ledger file this module will read; anything bigger is treated as corrupt. */
const MAX_LEDGER_BYTES = 1024 * 1024;

/**
 * @typedef {Object} LedgerFacts
 * @property {Set<string>} entries  directory names and declared names a ledger knows about
 * @property {string[]} sources     human-readable ids of the ledgers that answered
 * @property {string[]} diagnostics degradation notes, e.g. 'ledger-unreadable:...'
 */

/**
 * Read one JSON file, degrading every failure to "absent".
 * @param {string} file - absolute path.
 * @returns {Promise<{value: unknown, status: 'ok'|'missing'|'unreadable'}>} parse result.
 */
async function readJsonDegrading(file) {
  let info;
  try {
    info = await stat(file);
  } catch {
    return { value: undefined, status: 'missing' };
  }
  if (!info.isFile() || info.size > MAX_LEDGER_BYTES) return { value: undefined, status: 'unreadable' };
  try {
    return { value: JSON.parse(await readFile(file, 'utf8')), status: 'ok' };
  } catch {
    return { value: undefined, status: 'unreadable' };
  }
}

/**
 * Collect every string key that could name a skill from a ledger record.
 * @param {unknown} value - parsed ledger document.
 * @returns {string[]} candidate names.
 */
function namesInRecord(value) {
  const names = [];
  if (typeof value === 'string') {
    names.push(value);
    return names;
  }
  if (typeof value !== 'object' || value === null) return names;
  for (const key of ['name', 'skill', 'slug', 'declaredName', 'directory', 'dir']) {
    const field = /** @type {Record<string, unknown>} */ (value)[key];
    if (typeof field === 'string' && field !== '') names.push(field);
  }
  return names;
}

/**
 * Collect names from a flat object keyed by skill or directory name.
 * @param {unknown} value - parsed ledger document.
 * @returns {string[]} candidate names.
 */
function namesInMap(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  return Object.keys(value);
}

/**
 * Collect names from an array of install records.
 * @param {unknown} value - parsed ledger document.
 * @returns {string[]} candidate names.
 */
function namesInArray(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => namesInRecord(entry));
}

/**
 * Read every install ledger and merge the names they attest.
 * @param {string} dshHome - DSH home directory.
 * @param {string} skillsRoot - skills root directory.
 * @returns {Promise<LedgerFacts>} attested names, answering sources, and diagnostics.
 */
export async function readLedger(dshHome, skillsRoot) {
  const entries = new Set();
  const sources = [];
  const diagnostics = [];
  const ledgers = [
    {
      id: 'dsh-skill-market',
      file: join(dshHome, 'dsh-skill-market', 'installed.json'),
      extract: (value) => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
        const record = /** @type {Record<string, unknown>} */ (value);
        const keys = Object.keys(record);
        return [...keys, ...keys.flatMap((key) => namesInRecord(record[key]))];
      },
    },
    {
      id: 'skills-manager',
      file: join(dshHome, 'skills-manager', 'repositories.json'),
      extract: (value) => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
        return namesInArray(/** @type {Record<string, unknown>} */ (value).installs);
      },
    },
    {
      id: 'skills-lock',
      file: join(skillsRoot, '.skills-lock.json'),
      extract: (value) => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
        const lock = /** @type {Record<string, unknown>} */ (value).skills;
        return [...namesInMap(lock), ...namesInArray(Array.isArray(lock) ? lock : [])];
      },
    },
    {
      id: 'own-record',
      file: join(dshHome, 'dsh-skill-center', 'installed.json'),
      extract: (value) => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
        const record = /** @type {Record<string, unknown>} */ (value);
        return [...namesInArray(record.installs), ...namesInMap(record.skills)];
      },
    },
  ];
  for (const ledger of ledgers) {
    const { value, status } = await readJsonDegrading(ledger.file);
    if (status === 'missing') continue;
    if (status === 'unreadable') {
      diagnostics.push(`ledger-unreadable:${ledger.id}`);
      continue;
    }
    const names = ledger.extract(value).filter((name) => typeof name === 'string' && name !== '');
    if (names.length > 0) sources.push(ledger.id);
    for (const name of names) entries.add(name);
  }
  return { entries, sources, diagnostics };
}
