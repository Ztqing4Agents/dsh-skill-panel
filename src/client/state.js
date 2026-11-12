/**
 * The page store: one module-level instance, shared by the page, the toast host,
 * and whoever opens the panel next.
 *
 * It outlives the page component on purpose. Leaving the panel and coming back
 * must return to the same tab with the same list, and the refresh-failure toast
 * must still be visible after the page is gone.
 *
 * The market sub-state lives here for the same reason, one step stronger: leaving
 * the market tab and coming back must return to the same filters, the same loaded
 * pages and the same scroll offset. That is why the detail view, the install states
 * and the scroll offset are store fields and not component state.
 *
 * No optimistic UI: a row's `enabled` only changes when the host confirms it, and a
 * card reads "installed" only after the install route answered.
 */
import { MARKET_DEFAULT_SOURCE, marketKeyOf } from './market-model.js';
import { identityOf, rowKey, TAB_INSTALLED } from './model.js';

/**
 * @typedef {Object} PageState
 * @property {string} tab                            selected partition tab
 * @property {'idle'|'loading'|'ready'|'error'} status load state
 * @property {object|null} payload                   last successful ListPayload
 * @property {{code: string, message: string}|null} error  last list failure
 * @property {Map<string, {pending: boolean, reason: string|null}>} rows per-row write state
 * @property {{kind: string, code: string, message: string, seq: number}|null} notice transient notice
 * @property {{key: string, status: 'loading'|'ready'|'error', data: object|null, code: string|null}|null} detail
 *   the installed tab's detail view: one skill's key plus the text route's three states
 * @property {number} detailScrollTop                list offset remembered when the detail opened
 * @property {Record<string, object>} checks         update verdicts by upstream identity
 * @property {{id: number, status: string}} checkRun the current round's token and progress
 * @property {object} market                        the market sub-state (see `initialMarket`)
 */

/**
 * The market sub-state: boot, filters, the merged list, its cursors, the detail view
 * and the per-item install states.
 * @returns {object} fresh market state.
 */
function initialMarket() {
  return {
    boot: 'idle',
    sources: [],
    categories: [],
    categoriesOk: true,
    total: null,
    countsOk: true,
    filters: { source: MARKET_DEFAULT_SOURCE, category: null, sort: 'recommended' },
    // The scope the current `categories` + counts belong to, and whether a scope change is
    // waiting for its numbers: only the chips row goes to skeleton, the cards stay put.
    bootScope: '',
    categoriesLoading: false,
    keyword: '',
    input: '',
    items: [],
    pages: 0,
    cursors: {},
    exhausted: {},
    page: { status: 'idle', code: null, message: null },
    listStatus: 'idle',
    detail: null,
    installed: {},
    installedReady: false,
    installs: {},
    // Kept for the bookmark entry point (M8): `bootstrap` already returns the list and no
    // component reads it yet - it is not dead code, do not delete it.
    favorites: {},
    favoritesOk: true,
    icons: {},
    iconsTried: {},
    names: {},
    installedDirty: false,
    scrollTop: 0,
  };
}

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
    // The detail view is store state, not component state: opening it must not re-scan the
    // list, leaving the tab must not lose the text, and coming back must not re-request it.
    detail: null,
    detailScrollTop: 0,
    // One level up from a skill detail: the block key (the shipping package) that was opened.
    // The list offset is `detailScrollTop`; this level has its own so coming back from a skill
    // lands where the provider page was.
    pluginDetail: null,
    pluginScrollTop: 0,
    // The update checks, one entry per upstream identity (`source:owner:slug`). A session
    // cache, not an open detail's property: it survives leaving the tab and closing the
    // detail, because the answer belongs to the identity and re-asking costs a request.
    checks: {},
    // The current round: `id` bumps per round, `status` is what the header waits for.
    checkRun: { id: 0, status: 'idle' },
    market: initialMarket(),
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
 * Drop the paging cursors so the next effect run fetches page one again.
 * `items` and `listStatus` are the caller's business: a filter change clears the list,
 * a keyword change keeps it on screen (the host does the same, to avoid a flash).
 * @param {object} market - current market state.
 * @returns {object} the pagination patch.
 */
function clearedPaging(market) {
  return {
    pages: 0,
    cursors: {},
    exhausted: {},
    page: { status: 'idle', code: null, message: null },
    listStatus: market.items.length > 0 ? 'ready' : 'idle',
  };
}

/**
 * Replace one per-source error entry, or drop it when the source answered again.
 * @param {{sourceId: string, code: string}[]} current - the errors on screen.
 * @param {string[]} answered - sources that answered this round.
 * @param {{sourceId: string, code: string}[]} failed - sources that failed this round.
 * @returns {{sourceId: string, code: string}[]} the deduplicated error list.
 */

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
  const setMarket = (patch) => {
    set({ market: { ...state.market, ...patch } });
  };
  const setInstall = (id, entry) => {
    const installs = { ...state.market.installs };
    if (entry === null) delete installs[id];
    else installs[id] = entry;
    setMarket({ installs });
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

    /* ----------------------------------------------------------------- detail */

    /**
     * Show one skill's detail view. The list is left exactly as it is: the facts come from
     * the row the page still holds, and only the text is fetched.
     * @param {object} row - the row that was opened.
     * @returns {void}
     */
    openDetail: (row, data) => {
      const key = rowKey(row);
      // With the text already read (the page waits up to 150 ms for it) the detail opens on its
      // final state, so nothing below the body has to move once it renders.
      const text = data === undefined
        ? { key, status: 'loading', data: null, code: null }
        : (data?.error === undefined
          ? { key, status: 'ready', data: data ?? null, code: null }
          : { key, status: 'error', data: null, code: data.error?.code ?? null });
      // No check state is touched here: the verdicts are keyed by upstream identity and
      // outlive the detail, and the page kicks the one `ensure` this open needs.
      set({ detail: text });
    },
    /**
     * Remember where the list was, read with the rows still on screen (the detail view
     * replaces them one render later, and after that the offset is gone).
     * @param {number} top - scroll offset in pixels.
     * @returns {void}
     */
    rememberDetailScroll: (top) => {
      set({ detailScrollTop: Number.isFinite(top) && top > 0 ? top : 0 });
    },
    /**
     * The text is being (re)read for one skill.
     * @param {string} key - identity key of the detail's row.
     * @returns {void}
     */
    detailLoading: (key) => {
      if (state.detail === null || state.detail.key !== key) return;
      set({ detail: { ...state.detail, status: 'loading', data: null, code: null } });
    },
    /**
     * The text route answered.
     *
     * The key is checked, not assumed: a slow answer for a detail the user already closed
     * (or replaced by opening another row) must not land in the current one.
     * @param {string} key - identity key the request was made for.
     * @param {object|null} data - SkillContent.
     * @returns {void}
     */
    detailReady: (key, data) => {
      if (state.detail === null || state.detail.key !== key) return;
      set({ detail: { ...state.detail, status: 'ready', data: data ?? null, code: null } });
    },
    /**
     * The text route failed. The page keeps the facts and offers a retry.
     * @param {string} key - identity key the request was made for.
     * @param {{code?: string, message?: string}} error - failure code and note.
     * @returns {void}
     */
    detailFailed: (key, error) => {
      if (state.detail === null || state.detail.key !== key) return;
      set({ detail: { ...state.detail, status: 'error', data: null, code: error?.code ?? null } });
    },
    /**
     * Close the skill detail. With a plugin page underneath, that page is where the user came
     * from, so this only drops one level - the plugin level closes on its own action.
     * @returns {void}
     */
    closeDetail: () => {
      if (state.detail === null) return;
      set({ detail: null });
    },
    /**
     * Open one builtin provider's page.
     * @param {string} provider - the provider id, which is the block's key.
     * @returns {void}
     */
    openPlugin: (provider) => {
      set({ pluginDetail: typeof provider === 'string' ? provider : null });
    },
    /**
     * Back to a fresh installed page: no detail, no provider page, no remembered offsets.
     * Used when the tab is entered, which never resumes the previous visit.
     * @returns {void}
     */
    resetPage: () => {
      set({ detail: null, pluginDetail: null, detailScrollTop: 0, pluginScrollTop: 0 });
    },
    /** Leave the plugin page, back to the list (or to whatever is below it). @returns {void} */
    closePlugin: () => {
      if (state.pluginDetail === null) return;
      set({ pluginDetail: null });
    },
    /**
     * Remember where the plugin page was, read with its rows still on screen.
     * @param {number} top - scroll offset in pixels.
     * @returns {void}
     */
    rememberPluginScroll: (top) => {
      set({ pluginScrollTop: Number.isFinite(top) && top > 0 ? top : 0 });
    },
    /**
     * A round of update checks started: every target shows its spinner, and the round token
     * moves so the header knows a new answer set is coming. An identity that already has an
     * answer keeps it - the block must not blank out while it re-asks.
     * @param {string[]} identities - the keys this round covers.
     * @returns {void}
     */
    checkStart: (identities) => {
      const list = Array.isArray(identities) ? identities.filter((key) => typeof key === 'string' && key !== '') : [];
      if (list.length === 0) return;
      const checks = { ...state.checks };
      for (const key of list) {
        const previous = checks[key] ?? null;
        checks[key] = previous === null
          ? {
            key, phase: 'running', busy: true, candidate: null, latest: null, versions: [], total: 0, at: null, reason: null,
          }
          : { ...previous, busy: true };
      }
      set({ checks, checkRun: { id: state.checkRun.id + 1, status: 'running' } });
    },
    /**
     * Answers landed. Merged by identity, never by "who is open": a slow answer for a skill
     * the user already left still belongs to that skill's cache, and the verdict drawn from
     * it is recomputed against whichever row asks.
     * @param {{key: string, phase?: string, candidate?: string|null, latest?: string|null,
     *   versions?: object[], total?: number, at?: number|null, reason?: string|null}[]} entries -
     *   one entry per identity.
     * @returns {void}
     */
    checkLanded: (entries) => {
      const list = Array.isArray(entries) ? entries : [];
      const checks = { ...state.checks };
      let touched = false;
      for (const entry of list) {
        const key = typeof entry?.key === 'string' ? entry.key : '';
        if (key === '') continue;
        const next = {
          key,
          phase: 'failed',
          busy: false,
          candidate: null,
          latest: null,
          total: 0,
          at: checks[key]?.at ?? null,
          reason: null,
          ...entry,
        };
        // The readers (the version window and the date line) drop unusable rows themselves,
        // so the cache stores the list as the route reported it.
        next.versions = Array.isArray(next.versions) ? next.versions : [];
        checks[key] = next;
        touched = true;
      }
      if (touched) set({ checks });
    },
    /**
     * The round is over. Idempotent, and it only moves the status: a late answer from an
     * older round lands in `checks` without reopening or closing the header's sentence.
     * @returns {void}
     */
    checkFinish: () => {
      if (state.checkRun.status === 'done') return;
      set({ checkRun: { ...state.checkRun, status: 'done' } });
    },
    /**
     * An update landed: the row's version becomes the version that was installed, and that
     * identity's verdict becomes "this is the latest" without another round trip.
     *
     * `name` narrows the patch to the directory that was updated: the same identity may be
     * installed twice, and the other copy is still at its own version.
     * @param {{identity: string, name: string, path?: string, version: string}} applied -
     *   what the route reported.
     * @returns {void}
     */
    updateApplied: (applied) => {
      const identity = typeof applied?.identity === 'string' ? applied.identity : '';
      const name = typeof applied?.name === 'string' ? applied.name : '';
      const version = typeof applied?.version === 'string' && applied.version !== '' ? applied.version : null;
      if (identity === '' || version === null) return;
      const at = Date.now();
      const checks = {
        ...state.checks,
        [identity]: {
          key: identity,
          phase: 'ready',
          busy: false,
          candidate: version,
          latest: version,
          versions: state.checks[identity]?.versions ?? [],
          total: state.checks[identity]?.total ?? 0,
          at,
          reason: null,
        },
      };
      // The success notice rides on the same update: one event, one entry in the store. The
      // toast seat is the one `install-ok` already uses, so it is visible after leaving the page.
      seq += 1;
      const patch = {
        checks,
        notice: { kind: 'update-ok', name, path: applied?.path ?? '', version, code: '', message: '', seq },
      };
      const payload = state.payload;
      if (payload !== null && payload !== undefined) {
        let changed = false;
        const groups = (Array.isArray(payload.groups) ? payload.groups : []).map((group) => ({
          ...group,
          skills: (Array.isArray(group.skills) ? group.skills : []).map((row) => {
            if (identityOf(row?.upstream) !== identity) return row;
            if (name !== '' && row.name !== name) return row;
            if (row.version === version) return row;
            changed = true;
            return { ...row, version };
          }),
        }));
        if (changed) patch.payload = { ...payload, groups };
      }
      set(patch);
    },

    /* ------------------------------------------------------------------ market */

    /**
     * `bootstrap` is in flight. A first visit has nothing to draw yet; a scope change keeps
     * the cards on screen and only puts the chips row into its skeleton - the numbers for
     * the new scope are a different query, not a different list.
     * @returns {void}
     */
    marketBootLoading: () => {
      const known = state.market.boot === 'ready';
      setMarket({
        boot: known ? 'ready' : 'loading',
        ...(known ? { categoriesLoading: true } : {}),
      });
    },
    /**
     * `bootstrap` answered: the panel now knows which scopes exist, which categories they
     * publish, and - through `source` - which scope these counts belong to.
     * @param {{source?: string, sources?: object[], categories?: object[], categoriesOk?: boolean}} data -
     *   route payload.
     * @returns {void}
     */
    marketBootReady: (data) => {
      setMarket({
        boot: 'ready',
        sources: Array.isArray(data?.sources) ? data.sources : [],
        categories: Array.isArray(data?.categories) ? data.categories : [],
        categoriesOk: data?.categoriesOk !== false,
        total: Number.isFinite(data?.total) ? data.total : null,
        countsOk: data?.countsOk !== false,
        bootScope: typeof data?.source === 'string' ? data.source : '',
        categoriesLoading: false,
      });
    },
    /**
     * `bootstrap` failed. Not an error state: the list still works with the built-in
     * source list, only the category row disappears.
     * @param {object[]} sources - descriptors to fall back to.
     * @returns {void}
     */
    marketBootFallback: (sources) => {
      setMarket({
        boot: 'ready',
        categoriesLoading: false,
        sources: Array.isArray(sources) ? sources : [],
        categories: [],
        categoriesOk: false,
        total: null,
        countsOk: false,
      });
    },
    /**
     * The search box's current text, before any debounce is decided.
     * @param {string} text - raw input value.
     * @returns {void}
     */
    marketSetInput: (text) => {
      setMarket({ input: typeof text === 'string' ? text : '' });
    },
    /**
     * Commit a keyword: it becomes the query, and paging restarts. The list stays on
     * screen until the answer arrives, so the page does not flash a skeleton.
     * @param {string} text - the keyword to send.
     * @returns {void}
     */
    marketCommitKeyword: (text) => {
      const keyword = typeof text === 'string' ? text : '';
      setMarket({ keyword, input: keyword, ...clearedPaging(state.market) });
    },
    /**
     * Narrow the query by source, category or sort. Paging restarts and an open detail view
     * closes, but the cards stay on screen until the answer arrives: `clearedPaging` keeps
     * `listStatus` at `ready` while `items` is non-empty, so the page does not trade a full
     * grid for the six-card skeleton (that swap moved the document by ~1k px and let the
     * browser clamp the scroll offset to the top). The answer replaces the list wholesale -
     * `loadFirst` merges without `existing`, so no old card survives into the new scope.
     * A scope change also reloads the counts: `categoriesLoading` puts the chip row in its
     * placeholder while `boot` re-reads that scope's table.
     * @param {{source?: string, category?: string|null, sort?: string}} patch - the filters to change.
     * @returns {void}
     */
    marketSetFilter: (patch) => {
      if (patch === null || typeof patch !== 'object') return;
      const filters = { ...state.market.filters };
      let changed = false;
      for (const key of ['source', 'category', 'sort']) {
        if (!(key in patch)) continue;
        if (patch[key] === filters[key]) continue;
        filters[key] = patch[key];
        changed = true;
      }
      if (!changed) return;
      // Every filter change restarts the list (the cursor holds a page number, not a
      // filter signature). A scope change also invalidates the counts on screen: they
      // belong to the previous scope until the new ones arrive.
      const scopeChanged = filters.source !== state.market.filters.source;
      setMarket({
        filters,
        detail: null,
        ...(scopeChanged ? { categoriesLoading: true } : {}),
        ...clearedPaging(state.market),
      });
    },
    /**
     * The header's refresh button was pressed on the market tab: forget the loaded pages so
     * the list starts over - nothing else. The cards stay on screen until the answer arrives
     * (`clearedPaging` keeps `listStatus` at `ready` while `items` is non-empty): swapping a
     * full grid for the six-card skeleton and back moved the document by ~1k px and threw the
     * scroll to the top. The icon and title caches survive for the same reason a filter change
     * keeps them - they are keyed by identity, a re-asked identity cannot answer differently,
     * and dropping them repainted 8 of 24 avatars as letters until the batch came back.
     * @returns {void}
     */
    marketReload: () => {
      setMarket({ detail: null, ...clearedPaging(state.market) });
    },
    /**
     * Cache icons the list route already answered inline (SkillHub puts `iconUrl` on the
     * item itself). This is a known answer, not an upstream question, so `iconsTried` is
     * deliberately left alone - seeding must not claim we asked anyone anything.
     * @param {Record<string, string>} icons - icon URL keyed by market id; empties ignored.
     * @returns {void}
     */
    marketIconsSeeded: (icons) => {
      const entries = icons !== null && typeof icons === 'object' ? Object.entries(icons) : [];
      const usable = entries.filter(([, url]) => typeof url === 'string' && url !== '');
      if (usable.length === 0) return;
      const nextIcons = { ...state.market.icons };
      for (const [id, url] of usable) {
        if (Object.prototype.hasOwnProperty.call(nextIcons, id)) continue;
        nextIcons[id] = url;
      }
      setMarket({ icons: nextIcons });
    },
    /**
     * Cache titles the market list already carries (its `displayName`). A known answer,
     * not an upstream question, so `iconsTried` is left alone - same rule as
     * `marketIconsSeeded`.
     * @param {Record<string, string>} names - title keyed by market id; empties ignored.
     * @returns {void}
     */
    marketNamesSeeded: (names) => {
      const entries = names !== null && typeof names === 'object' ? Object.entries(names) : [];
      const usable = entries.filter(([, title]) => typeof title === 'string' && title !== '');
      if (usable.length === 0) return;
      const nextNames = { ...state.market.names };
      for (const [id, title] of usable) {
        if (Object.prototype.hasOwnProperty.call(nextNames, id)) continue;
        nextNames[id] = title;
      }
      setMarket({ names: nextNames });
    },
    /**
     * Fold the titles that came back with a batch of icons. Missing or null titles are
     * skipped: an unknown title simply leaves the row on its own `displayName`/`name`, and
     * a missing title must not block the icons that did arrive.
     * @param {Record<string, string|null>|null} names - title (or null) keyed by market id.
     * @returns {void}
     */
    marketNamesReady: (names) => {
      const entries = names !== null && typeof names === 'object' ? Object.entries(names) : [];
      const usable = entries.filter(([, title]) => typeof title === 'string' && title !== '');
      if (usable.length === 0) return;
      const nextNames = { ...state.market.names };
      for (const [id, title] of usable) nextNames[id] = title;
      setMarket({ names: nextNames });
    },
    /**
     * Fold one batch of progressively fetched icons into the market state.
     *
     * Every id in the batch is recorded as tried, including the ones that came back null:
     * "this entry has no icon" is a result too, and asking again next render would hammer
     * the route for an answer that cannot change within a session. Icon URLs already held
     * for other ids survive (switching source or keyword must not lose them).
     * @param {Record<string, string|null>} icons - icon URL or null, keyed by market id.
     * @returns {void}
     */
    marketIconsReady: (icons) => {
      const entries = icons !== null && typeof icons === 'object' ? Object.entries(icons) : [];
      if (entries.length === 0) return;
      const nextIcons = { ...state.market.icons };
      const nextTried = { ...state.market.iconsTried };
      for (const [id, url] of entries) {
        nextTried[id] = true;
        if (typeof url === 'string' && url !== '') nextIcons[id] = url;
      }
      setMarket({ icons: nextIcons, iconsTried: nextTried });
    },
    /**
     * Mark ids as tried without an icon: the batch itself failed, and a silent retry on
     * every render is worse than an entry that keeps its letter tile for this session.
     * @param {string[]} ids - market ids the failed batch covered.
     * @returns {void}
     */
    marketIconsAttempted: (ids) => {
      const list = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id !== '') : [];
      if (list.length === 0) return;
      const nextTried = { ...state.market.iconsTried };
      for (const id of list) nextTried[id] = true;
      setMarket({ iconsTried: nextTried });
    },
    /**
     * The page-one request is in flight.
     * @returns {void}
     */
    marketListLoading: () => {
      setMarket({
        listStatus: 'loading',
        page: { status: 'loading', code: null, message: null },
      });
    },
    /**
     * The page-one request failed: this is a failure, not an empty list.
     * @param {{code?: string, message?: string}} error - failure code and note.
     * @returns {void}
     */
    marketListFailed: (error) => {
      setMarket({
        listStatus: 'error',
        page: { status: 'error', code: error?.code ?? null, message: error?.message ?? null },
        items: [],
        pages: 0,
      });
    },
    /**
     * The append request is in flight. The cards already on screen stay where they are.
     * @returns {void}
     */
    marketPageStart: () => {
      setMarket({ page: { status: 'loading', code: null, message: null } });
    },
    /**
     * A page answered: adopt the merged list and remember that source's cursor.
     * @param {{pages: {sourceId: string, page: object, items: object[]}[], merged: object[]}} result
     *   the answered page and the list to render (the array keeps room for several sources
     *   later, but the market shows one source at a time).
     * @returns {void}
     */
    marketPageAppended: (result) => {
      const pages = Array.isArray(result?.pages) ? result.pages : [];
      const cursors = { ...state.market.cursors };
      const exhausted = { ...state.market.exhausted };
      for (const entry of pages) {
        const next = entry?.page?.next ?? null;
        cursors[entry.sourceId] = next;
        exhausted[entry.sourceId] = next === null;
      }
      const more = Object.values(cursors).some((cursor) => cursor !== null);
      setMarket({
        items: Array.isArray(result?.merged) ? result.merged : state.market.items,
        pages: state.market.pages + (pages.length > 0 ? 1 : 0),
        cursors,
        exhausted,
        page: { status: more ? 'more' : 'done', code: null, message: null },
        listStatus: 'ready',
      });
    },
    /**
     * The append request failed: the loaded cards stay, the tail says so.
     * @param {{code?: string, message?: string}} error - failure code and note.
     * @returns {void}
     */
    marketPageFailed: (error) => {
      setMarket({ page: { status: 'error', code: error?.code ?? null, message: error?.message ?? null } });
    },
    /**
     * The bookmark list answered (`market/bootstrap`), or the request for it failed.
     *
     * Read side only: the card carries no bookmark control since U5 (the user removed it),
     * but the Host still sends this set and the panel still stores it, so re-adding an
     * entry point later needs no change on either half.
     * @param {string[]} list - bookmark ids, most recent first.
     * @param {boolean} ok - whether the Host could read its file.
     * @returns {void}
     */
    marketFavoritesLoaded: (list, ok) => {
      const favorites = {};
      for (const id of Array.isArray(list) ? list : []) {
        if (typeof id === 'string' && id !== '') favorites[id] = true;
      }
      setMarket({ favorites, favoritesOk: ok === true });
    },
    /**
     * The install ledger answered: which market items are already on this machine.
     * @param {Record<string, {name: string, version: string|null, path: string, exists: boolean}>} map - installed map.
     * @returns {void}
     */
    marketInstalledLoaded: (map) => {
      setMarket({ installed: map !== null && typeof map === 'object' ? map : {}, installedReady: true });
    },
    /**
     * Open the inline detail view. The scroll offset is written by the panel first,
     * so "back to the market" can restore it.
     * @param {object} item - the market item that was opened.
     * @returns {void}
     */
    marketDetailOpen: (item) => {
      setMarket({ detail: { id: marketKeyOf(item), item, status: 'loading', data: null, code: null } });
    },
    /**
     * The detail route answered.
     * @param {object} data - MarketDetail.
     * @returns {void}
     */
    marketDetailReady: (data) => {
      const current = state.market.detail;
      if (current === null) return;
      setMarket({
        detail: {
          ...current,
          item: data?.item ?? current.item,
          status: 'ready',
          data,
          code: null,
        },
      });
    },
    /**
     * The detail route failed. The way back stays usable.
     * @param {{code?: string, message?: string}} error - failure code and note.
     * @returns {void}
     */
    marketDetailFailed: (error) => {
      const current = state.market.detail;
      if (current === null) return;
      setMarket({
        detail: { ...current, status: 'error', code: error?.code ?? null, message: error?.message ?? null },
      });
    },
    /** Close the detail view (the panel restores the scroll offset). @returns {void} */
    marketDetailClose: () => {
      setMarket({ detail: null });
    },
    /**
     * Ask before installing. No request is sent until the dialog is confirmed.
     * @param {string} id - the item's market key.
     * @returns {void}
     */
    marketInstallConfirm: (id) => {
      if (state.market.installs[id]?.state === 'installing') return;
      setInstall(id, { state: 'confirm' });
    },
    /**
     * Dismiss the confirm dialog without installing.
     * @param {string} id - the item's market key.
     * @returns {void}
     */
    marketInstallCancel: (id) => {
      if (state.market.installs[id]?.state !== 'confirm') return;
      setInstall(id, null);
    },
    /**
     * The install route is being called. Idempotent: a second call while installing
     * does nothing, so a double click cannot send two requests.
     * @param {string} id - the item's market key.
     * @returns {void}
     */
    marketInstallStart: (id) => {
      if (state.market.installs[id]?.state === 'installing') return;
      seq += 1;
      setInstall(id, { state: 'installing', seq });
    },
    /**
     * The skill is on disk. The card flips, the installed tab is marked stale, and a
     * toast says where it went and when it takes effect.
     * @param {string} id - the item's market key.
     * @param {{name?: string, path?: string, version?: string|null}} result - route payload.
     * @returns {void}
     */
    marketInstallOk: (id, result) => {
      const name = typeof result?.name === 'string' ? result.name : '';
      const path = typeof result?.path === 'string' ? result.path : '';
      const version = typeof result?.version === 'string' ? result.version : null;
      seq += 1;
      const installs = { ...state.market.installs, [id]: { state: 'installed', path, version } };
      // The toast is not part of the market sub-state: `ToastHost` reads the top-level
      // `notice` (same field `refreshFailed` writes), so this is one atomic update of both.
      set({
        market: {
          ...state.market,
          installs,
          installed: { ...state.market.installed, [id]: { name, version, path, exists: true } },
          installedDirty: true,
        },
        notice: { kind: 'install-ok', name, path, code: '', message: '', seq },
      });
    },
    /**
     * The install failed: the card keeps its place and explains itself, with a retry.
     * @param {string} id - the item's market key.
     * @param {string} reason - localized reason.
     * @returns {void}
     */
    marketInstallFail: (id, reason) => {
      setInstall(id, { state: 'failed', reason: typeof reason === 'string' ? reason : '' });
    },
    /**
     * Remember the list's scroll offset before the detail view replaces it.
     * @param {number} top - scroll offset in pixels.
     * @returns {void}
     */
    marketSetScroll: (top) => {
      setMarket({ scrollTop: Number.isFinite(top) && top > 0 ? top : 0 });
    },
    /**
     * The installed tab reloaded, so the "something was installed" flag can go.
     * @returns {void}
     */
    marketClearInstalledDirty: () => {
      setMarket({ installedDirty: false });
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
