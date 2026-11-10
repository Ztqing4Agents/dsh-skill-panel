/**
 * Pure view-model helpers: no DOM, no fetch, no clock.
 *
 * Everything the page needs to decide "what to draw" is a function of the payload
 * plus the page store, so the whole decision surface can be unit-tested in node
 * without a browser.
 */

/** The tab that lists skills. */
export const TAB_INSTALLED = 'installed';

/** The tab that is a placeholder in this version. */
export const TAB_MARKET = 'market';

/** Route codes that have a localized row-level string; anything else reads as E_UNKNOWN. */
const ROW_ERRORS = new Set([
  'E_NOT_FOUND',
  'E_BAD_NAME',
  'E_BAD_PATH',
  'E_STALE_PATH',
  'E_SYMLINK_READONLY',
  'E_FILE_CHANGED',
  'E_NOT_WRITABLE',
  'E_WRITE_FAILED',
  'E_VERIFY_FAILED',
]);

/** Partition keys in the order the page renders them, whatever the payload says. */
const PARTITION_KEYS = ['builtin', 'local', 'installed'];

/**
 * The switch identity of one row: provider plus name, matching the host's identity key.
 * @param {object} row - a row from the payload.
 * @returns {string} identity key such as `filesystem#ui-design`.
 */
export function rowKey(row) {
  return `${row?.provider ?? ''}#${row?.name ?? ''}`;
}

/**
 * Which write route a row's switch drives.
 *
 * A built-in skill has no file to edit, so its switch writes the panel-owned
 * provider store; a file-backed row rewrites its own SKILL.md; anything else has
 * no switch at all and renders a static marker instead.
 * @param {object} row - a row from the payload.
 * @returns {'provider'|'file'|null} the switch kind, or null when the row has none.
 */
export function switchMode(row) {
  if (row?.readonlyReason === 'provider-store' && row.partition === 'builtin') return 'provider';
  if (row?.writable === true && row.symlink !== true) return 'file';
  return null;
}

/**
 * Normalise the payload's partitions into the three fixed groups.
 * @param {object|undefined} payload - ListPayload, or undefined before the first load.
 * @returns {{key: string, skills: object[]}[]} three groups in render order.
 */
export function toGroups(payload) {
  const source = Array.isArray(payload?.groups) ? payload.groups : [];
  return PARTITION_KEYS.map((key) => {
    const group = source.find((candidate) => candidate?.key === key);
    return { key, skills: Array.isArray(group?.skills) ? group.skills : [] };
  });
}

/**
 * Fold one group's rows into the plugin blocks the builtin partition is shown as.
 *
 * The key is the row's own `provider` (the group only ever holds `partition === 'builtin'`
 * rows), and blocks are ordered by it: one block per provider, skills in payload order.
 * @param {{key: string, skills: object[]}|undefined} group - one group from `toGroups`.
 * @returns {{provider: string, skills: object[]}[]} blocks, provider ascending.
 */
export function toPluginBlocks(group) {
  const byProvider = new Map();
  for (const row of Array.isArray(group?.skills) ? group.skills : []) {
    const provider = typeof row?.provider === 'string' ? row.provider : '';
    const block = byProvider.get(provider) ?? { provider, skills: [] };
    block.skills.push(row);
    byProvider.set(provider, block);
  }
  return [...byProvider.values()].sort((left, right) => (left.provider < right.provider ? -1 : (left.provider > right.provider ? 1 : 0)));
}

/**
 * The header's status line: how many skills the panel shows, and how many are off.
 * @param {{total?: number, disabled?: number}|undefined} counts - payload counts.
 * @param {Function} t - translate function.
 * @returns {string} e.g. "5 skills, 1 turned off".
 */
export function statusLine(counts, t) {
  const total = Number.isInteger(counts?.total) ? counts.total : 0;
  const disabled = Number.isInteger(counts?.disabled) ? counts.disabled : 0;
  const head = t('status.count', { total });
  if (disabled <= 0) return head;
  return `${head}${t('status.offSuffix', { count: disabled })}`;
}

/**
 * Whether a row is mid-write or failed its last write.
 * @param {object} row - a row from the payload.
 * @param {Map<string, {pending: boolean, reason: string|null}>} rows - per-row runtime state.
 * @returns {'idle'|'pending'|'failed'} the row's interaction state.
 */
export function rowViewState(row, rows) {
  const state = rows?.get?.(rowKey(row));
  if (state === undefined || state === null) return 'idle';
  if (state.pending === true) return 'pending';
  if (typeof state.reason === 'string' && state.reason !== '') return 'failed';
  return 'idle';
}

/**
 * Whether the row identified by `key` is mid-write.
 * @param {Map<string, {pending: boolean}>} rows - per-row runtime state.
 * @param {string} key - identity key.
 * @returns {boolean} true while the write is in flight.
 */
export function isPending(rows, key) {
  return rows?.get?.(key)?.pending === true;
}

/**
 * The empty-state translation key for a partition.
 * @param {string} key - partition key.
 * @returns {string} e.g. 'group.localEmpty'.
 */
export function groupEmptyKey(key) {
  return `group.${key}Empty`;
}

/**
 * The inline reason for a failed write, already localized.
 * @param {string} code - `E_*` code from the route.
 * @param {string} reason - developer message, used as the `{reason}` placeholder.
 * @param {Function} t - translate function.
 * @returns {string} the line to show under the row.
 */
export function reasonText(code, reason, t) {
  const known = ROW_ERRORS.has(code) ? code : 'E_UNKNOWN';
  return t(`error.${known}`, { reason: reason ?? '' });
}

/**
 * The row one identity key still belongs to.
 *
 * The detail view stores a key, never a row: the list keeps changing underneath it (a
 * switch, a refresh), and a row deleted from disk has to be noticed rather than rendered
 * from a stale copy.
 * @param {object|undefined} payload - ListPayload, or undefined before the first load.
 * @param {string} key - identity key.
 * @returns {object|null} the row, or null when the list no longer carries it.
 */
export function rowByKey(payload, key) {
  const groups = Array.isArray(payload?.groups) ? payload.groups : [];
  for (const group of groups) {
    const skills = Array.isArray(group?.skills) ? group.skills : [];
    for (const row of skills) if (rowKey(row) === key) return row;
  }
  return null;
}

/**
 * The detail status the page shows for one identity key.
 * @param {object} state - the page store snapshot.
 * @param {string} key - identity key.
 * @returns {'idle'|'loading'|'ready'|'error'} `idle` when no detail, or another skill's.
 */
export function detailStateOf(state, key) {
  const detail = state?.detail ?? null;
  if (detail === null || detail.key !== key) return 'idle';
  return typeof detail.status === 'string' ? detail.status : 'idle';
}

