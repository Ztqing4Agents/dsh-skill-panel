/**
 * The page store: one module-level instance, shared by the page, the toast host,
 * and whoever opens the panel next.
 *
 * It outlives the page component on purpose. Leaving the panel and coming back
 * must return to the same tab with the same list, and the refresh-failure toast
 * must still be visible after the page is gone.
 *
 * No optimistic UI: a row's `enabled` only changes when the host confirms it.
 */
import { rowKey, TAB_INSTALLED } from './model.js';

/**
 * @typedef {Object} PageState
 * @property {string} tab                            selected partition tab
 * @property {'idle'|'loading'|'ready'|'error'} status load state
 * @property {object|null} payload                   last successful ListPayload
 * @property {{code: string, message: string}|null} error  last list failure
 * @property {Map<string, {pending: boolean, reason: string|null}>} rows per-row write state
 * @property {{kind: string, code: string, message: string, seq: number}|null} notice transient notice
 */

/**
 * The initial state: nothing loaded, nothing selected but the default tab.
 * @returns {PageState} fresh state.
 */
function initialState() {
  return {
    tab: TAB_INSTALLED,
    status: 'idle',
    payload: null,
    error: null,
    rows: new Map(),
    notice: null,
  };
}

/**
 * Copy a payload with one row's `enabled` flag replaced.
 * @param {object} payload - current payload.
 * @param {string} key - identity key of the row.
 * @param {boolean} enabled - new flag.
 * @returns {object} new payload.
 */
function withEnabled(payload, key, enabled) {
  if (payload === null || payload === undefined) return payload;
  const groups = Array.isArray(payload.groups) ? payload.groups : [];
  let disabled = 0;
  const nextGroups = groups.map((group) => {
    const skills = Array.isArray(group.skills) ? group.skills : [];
    return {
      ...group,
      skills: skills.map((row) => {
        if (rowKey(row) !== key) return row;
        return { ...row, enabled };
      }),
    };
  });
  for (const group of nextGroups) {
    for (const row of group.skills) if (row.enabled === false) disabled += 1;
  }
  const counts = payload.counts ?? {};
  return { ...payload, groups: nextGroups, counts: { ...counts, disabled } };
}

/**
 * Create a store with the shape the page binds to.
 * @returns {{getSnapshot: Function, subscribe: Function, actions: object}} the store.
 */
export function createStore() {
  let state = initialState();
  const listeners = new Set();
  let seq = 0;
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  const set = (patch) => {
    state = { ...state, ...patch };
    emit();
  };
  const setRow = (key, entry) => {
    const rows = new Map(state.rows);
    if (entry === null) rows.delete(key);
    else rows.set(key, entry);
    set({ rows });
  };
  const actions = {
    /**
     * Select a tab. Survives leaving the panel because the store does.
     * @param {string} tab - tab id.
     * @returns {void}
     */
    setTab: (tab) => {
      set({ tab });
    },
    /**
     * A list request is in flight.
     * @returns {void}
     */
    loading: () => {
      set({ status: 'loading', error: null });
    },
    /**
     * A list request succeeded.
     * @param {object} payload - ListPayload.
     * @returns {void}
     */
    ready: (payload) => {
      set({ status: 'ready', payload, error: null });
    },
    /**
     * A list request failed and there is nothing to show.
     * @param {{code: string, message: string}} error - failure code and note.
     * @returns {void}
     */
    failed: (error) => {
      set({ status: 'error', error });
    },
    /**
     * A refresh failed while a payload is still on screen.
     * @param {{code: string, message: string}} error - failure code and note.
     * @returns {void}
     */
    refreshFailed: (error) => {
      seq += 1;
      set({
        status: 'ready',
        error,
        notice: { kind: 'refresh-failed', code: error.code, message: error.message, seq },
      });
    },
    /**
     * Dismiss the current notice, if it is still the one on screen.
     * @param {number} at - the notice sequence that finished.
     * @returns {void}
     */
    dismissNotice: (at) => {
      if (state.notice === null || (at !== undefined && state.notice.seq !== at)) return;
      set({ notice: null });
    },
    /**
     * A row's write started.
     * @param {string} key - identity key.
     * @returns {void}
     */
    pending: (key) => {
      setRow(key, { pending: true, reason: null });
    },
    /**
     * A row's write was confirmed by the host.
     * @param {string} key - identity key.
     * @param {boolean} enabled - the state the host confirmed.
     * @returns {void}
     */
    commit: (key, enabled) => {
      set({ payload: withEnabled(state.payload, key, enabled) });
      setRow(key, null);
    },
    /**
     * A row's write failed: keep the old value and show why.
     * @param {string} key - identity key.
     * @param {string} reason - localized reason.
     * @returns {void}
     */
    fail: (key, reason) => {
      setRow(key, { pending: false, reason });
    },
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    actions,
  };
}

/** The one store the panel, the toast host, and the next page visit share. */
export const store = createStore();
