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
  // The delete route's own failure: it removes a directory the panel owns, so it belongs to
  // the row-write family (this set) rather than to the market's codes.
  'E_DELETE_IO',
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
 * The package that shipped a provider-delivered skill, for the block heading.
 *
 * A provider id is not a package name (`dsh-univer-office` registers itself as `univer`), so
 * three sources are tried in order: the host's own reading of the package (`pluginPackage`,
 * which also covers `link:` installs), the origin path (everything after the **last**
 * `node_modules/`, a scoped package keeping two segments), and finally the provider id -
 * which is at least unique and always present.
 * @param {object} row - one builtin row.
 * @returns {string} the package name, or the provider id.
 */
export function packageOf(row) {
  const provider = typeof row?.provider === 'string' ? row.provider : '';
  if (typeof row?.pluginPackage === 'string' && row.pluginPackage !== '') return row.pluginPackage;
  const path = typeof row?.originPath === 'string' ? row.originPath : '';
  const at = path.lastIndexOf('node_modules/');
  if (at === -1) return provider;
  const head = path.slice(at + 'node_modules/'.length).split('/');
  if (head[0] === undefined || head[0] === '') return provider;
  return head[0].startsWith('@') && head[1] !== undefined ? `${head[0]}/${head[1]}` : head[0];
}

/**
 * Fold one group's rows into the plugin blocks the builtin partition is shown as.
 *
 * Blocks are keyed by package (see `packageOf`) and ordered by it; the provider id stays on
 * the block because it is the identity a switch writes. Skills keep payload order.
 * @param {{key: string, skills: object[]}|undefined} group - one group from `toGroups`.
 * @returns {{key: string, provider: string, iconUrl: string|null, version: string|null,
 *   description: string|null, skills: object[]}[]} blocks, package ascending; the middle three
 *   are the package manifest's own icon / version / description, null when it has none.
 */
export function toPluginBlocks(group) {
  const byKey = new Map();
  for (const row of Array.isArray(group?.skills) ? group.skills : []) {
    const key = packageOf(row);
    const block = byKey.get(key) ?? {
      key,
      provider: typeof row?.provider === 'string' ? row.provider : '',
      iconUrl: row?.pluginIcon ?? null,
      version: row?.pluginVersion ?? null,
      description: row?.pluginDescription ?? null,
      skills: [],
    };
    block.skills.push(row);
    byKey.set(key, block);
  }
  return [...byKey.values()].sort((left, right) => (left.key < right.key ? -1 : (left.key > right.key ? 1 : 0)));
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
 * Whether one row's detail head may offer the delete control.
 *
 * Four independent facts, each one enough to refuse on its own: a builtin skill has no
 * directory this panel owns, a symlink belongs to another tool (hard constraint 5), a row
 * with no path has nothing to remove, and a row that already explains why it is read-only
 * must not be offered the write it just refused. Absent beats disabled, which is the host's
 * own shape - there the button does not render either.
 * @param {object} row - a row from the payload.
 * @returns {boolean} true when the delete button may render.
 */
export function deletable(row) {
  if (row === null || row === undefined) return false;
  return row.partition !== 'builtin'
    && row.symlink !== true
    && row.path !== null
    && row.readonlyReason === null;
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

/* -------------------------------------------------------------- update checks */

/** How long one skill's answer is reused before a visit re-asks (10 minutes). */
export const CHECK_TTL_MS = 10 * 60 * 1000;

/** Budget for one version request; the queue moves on and the late answer still lands. */
export const CHECK_TIMEOUT_MS = 2000;

/** Soft budget for one whole round; the rows left over are marked skipped, not asked. */
export const CHECK_BUDGET_MS = 8000;

/** How many rows the expanded version list prints. */
export const VERSION_ROWS = 5;

/** Upstream codes that mean "we could not reach the source", not "the answer is wrong". */
const OFFLINE_CODES = new Set(['E_SOURCE_UNAVAILABLE', 'E_SOURCE_TIMEOUT', 'E_SOURCE_BAD_RESPONSE']);

/**
 * The identity a row's upstream facts are cached under: `source:owner:slug`.
 *
 * One identity can be installed into more than one directory under different names, and
 * those directories can sit at different versions - so the cache key is the identity,
 * while every verdict drawn from it is computed against that row's own version.
 * @param {object|null} upstream - the row's `upstream`.
 * @returns {string} the key, or '' when the row has no upstream identity.
 */
export function identityOf(upstream) {
  const sourceId = typeof upstream?.sourceId === 'string' ? upstream.sourceId : '';
  const owner = typeof upstream?.owner === 'string' ? upstream.owner : '';
  const slug = typeof upstream?.slug === 'string' ? upstream.slug : '';
  if (sourceId === '' || owner === '' || slug === '') return '';
  return `${sourceId}:${owner}:${slug}`;
}

/**
 * The rows an update check is allowed to ask about: market-installed, not a symlink, and
 * carrying a version of its own. Anything else is one request fewer.
 * @param {object[]} rows - the installed partition's rows.
 * @returns {{key: string, source: string, owner: string, slug: string}[]} one entry per
 *   identity, in row order.
 */
export function detectionTargets(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const seen = new Set();
  const targets = [];
  for (const row of list) {
    if (row?.upstream === null || row?.upstream === undefined) continue;
    if (row.symlink === true) continue;
    if (typeof row.version !== 'string' || row.version === '') continue;
    const key = identityOf(row.upstream);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    targets.push({
      key,
      source: row.upstream.sourceId,
      owner: row.upstream.owner,
      slug: row.upstream.slug,
    });
  }
  return targets;
}

/**
 * Whether one cached verdict has to be asked for again.
 *
 * A failed answer is cached for the same ten minutes as a good one - otherwise every visit
 * to the tab would hit the upstream again - and `skipped` (out of budget) means "never got
 * an answer", so the next visit retries it.
 * @param {object|null|undefined} verdict - the cached entry.
 * @param {number} now - epoch milliseconds.
 * @param {number} [ttl] - reuse window.
 * @returns {boolean} true when a request is needed.
 */
export function needsCheck(verdict, now, ttl = CHECK_TTL_MS) {
  if (verdict === null || verdict === undefined) return true;
  if (verdict.busy === true) return false;
  if (verdict.phase === 'skipped' || verdict.phase === 'running') return true;
  const at = Number.isFinite(verdict.at) ? verdict.at : null;
  return at === null || now - at >= ttl;
}

/**
 * The five faces the version block can show, computed against the row's own version.
 *
 * `checking` also covers "never asked": the block mounts in that state and the round
 * starts right after. A verdict belongs to an identity, so the same cache entry yields
 * "up to date" here and "update available" one row below.
 * @param {object|null|undefined} verdict - the cached entry for this identity.
 * @param {string|null} version - this row's installed version.
 * @returns {'checking'|'upToDate'|'available'|'offline'|'failed'} the face.
 */
export function verdictOf(verdict, version) {
  if (verdict === null || verdict === undefined) return 'checking';
  if (verdict.phase === 'ready') {
    const candidate = typeof verdict.candidate === 'string' ? verdict.candidate : '';
    if (candidate === '') return 'failed';
    return candidate === version ? 'upToDate' : 'available';
  }
  if (verdict.phase === 'offline') return 'offline';
  if (verdict.phase === 'failed' || verdict.phase === 'skipped') return 'failed';
  return 'checking';
}

/**
 * The window of the version list the expanded block prints.
 *
 * `count` is how many versions sit above the installed one - the promise "there is
 * something newer" - and falls back to the upstream's own total when the installed version
 * is not in the list at all (a hand-edited `_meta.json`, or a version the upstream dropped).
 * @param {object[]} versions - the version list, newest first.
 * @param {string|null} current - this row's installed version.
 * @param {number} total - the upstream's reported count.
 * @returns {{count: number, items: object[], more: number}} the window and the tail count.
 */
export function newerVersions(versions, current, total) {
  const list = (Array.isArray(versions) ? versions : [])
    .filter((entry) => typeof entry?.version === 'string' && entry.version !== '');
  const at = current === null ? -1 : list.findIndex((entry) => entry.version === current);
  const count = at >= 0
    ? at
    : (Number.isInteger(total) && total > 0 ? total : list.length);
  const items = list.slice(0, VERSION_ROWS);
  return { count, items, more: Math.max(0, count - items.length) };
}

/**
 * The header's update note: four states, one sentence, one tone.
 *
 * Priority is "can update" over "some checks failed" over "all up to date"; `skipped`
 * counts as neither, and a round that has not finished says nothing at all - the host
 * draws its own note only after every check is done, and "everything is up to date" is a
 * lie before a single answer exists.
 * @param {object[]} rows - the installed partition's rows (the note is about these).
 * @param {Record<string, object>} checks - cached verdicts by identity.
 * @param {{id: number, status: string}|undefined} run - the round token.
 * @param {Function} t - translate function.
 * @returns {{text: string, tone: 'info'|'error'|null}|null} the note, or null.
 */
export function headerUpdateNote(rows, checks, run, t) {
  if (detectionTargets(rows).length === 0) return null;
  if (run?.status !== 'done') return null;
  const cache = checks ?? {};
  let available = 0;
  let failed = 0;
  let ready = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = identityOf(row?.upstream);
    if (key === '') continue;
    const version = typeof row.version === 'string' && row.version !== '' ? row.version : null;
    if (version === null) continue;
    const verdict = cache[key];
    // Out of budget is neither a success nor a failure: that row's block says "cannot
    // check", and the header stays silent about it.
    if (verdict === null || verdict === undefined || verdict.phase === 'skipped') continue;
    const face = verdictOf(verdict, version);
    if (face === 'available') available += 1;
    else if (face === 'offline' || face === 'failed') failed += 1;
    else if (face === 'upToDate') ready += 1;
  }
  if (available > 0) return { text: t('status.updatesAvailable', { count: available }), tone: 'info' };
  if (failed > 0) return { text: t('status.updatesPartial'), tone: 'error' };
  if (ready > 0) return { text: t('status.updatesNone'), tone: null };
  return null;
}

/**
 * The face state of a failed check, from the code the route reported.
 * @param {string} code - `E_*` code, or '' when the request failed without one.
 * @returns {'offline'|'failed'} which face the block shows.
 */
export function checkPhaseOf(code) {
  return OFFLINE_CODES.has(code) ? 'offline' : 'failed';
}

/**
 * A local wall-clock time as `HH:MM` (24 hours, no seconds).
 * @param {number|null} at - epoch milliseconds.
 * @returns {string} the time, or '' when there is none.
 */
export function clockText(at) {
  if (!Number.isFinite(at)) return '';
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * A local calendar day as `YYYY-MM-DD`.
 *
 * The one date the panel prints (a version's publish date). Never relative: "3 days ago"
 * drifts on every render, and the contract puts the time of day on the check instead.
 * @param {number|null} at - epoch milliseconds.
 * @returns {string} the day, or '' when there is none.
 */
export function dateText(at) {
  if (!Number.isFinite(at)) return '';
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

