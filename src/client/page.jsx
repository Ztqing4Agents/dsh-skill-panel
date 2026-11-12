/**
 * The global page: header, two tabs, three partitions, footer.
 *
 * Data comes only from props (`store`, `api`) so the tree can be rendered to a
 * string in a test without a browser; the header's DOM measurement lives inside
 * `attachHeader`, which a string render never calls.
 */
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Button,
  SegmentedTabs,
  StateDot,
  Tooltip,
  IconChevronDownOutlineRegular,
  IconInfoOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives';

import { cn } from './styles.js';
import { attachHeader } from './header-scroll.js';
import { InstalledDetail } from './installed-detail.jsx';
import { PluginDetail } from './plugin-detail.jsx';
import { iconBatch, iconSeeds, iconUrlFor, marketKeyOf, nameSeeds, rowTitleOf } from './market-model.js';
import { MarketPanel } from './market-panel.jsx';
import { ListSkeleton } from './skeleton.jsx';
import { PluginBlock, SkillRow } from './row.jsx';
import {
  CHECK_BUDGET_MS,
  CHECK_TIMEOUT_MS,
  TAB_INSTALLED,
  TAB_MARKET,
  checkPhaseOf,
  detailStateOf,
  detectionTargets,
  groupEmptyKey,
  headerUpdateNote,
  identityOf,
  needsCheck,
  reasonText,
  rowByKey,
  rowKey,
  switchMode,
  toGroups,
  toPluginBlocks,
} from './model.js';
import { reasonKeyOf } from './market-model.js';

/** How long the refresh indicator stays up, so a fast reload does not flicker. */
const MIN_INDICATOR_MS = 400;

/** Fallback translate used only when a seat is rendered without a locale. */
const identityTranslate = (key) => key;

/** Writes land before the frame paints; a string render has no DOM to write to. */
const usePaintEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect;

/**
 * A timer that resolves to null, so a request and a budget can be raced without aborting
 * the request: the browser has no way to cancel a fetch whose answer a later visit wants.
 * @param {number} ms - how long to wait.
 * @returns {Promise<null>} always null.
 */
function after(ms) {
  return new Promise((resolve) => { setTimeout(() => resolve(null), ms); });
}

/**
 * Run the body of one update check for one identity.
 *
 * The answer is reduced to what the cache stores: the first version is the candidate
 * (newest first is the upstream's own order, never ours), and a list without a usable first
 * row is a failure rather than an empty "up to date".
 * @param {object} api - API client.
 * @param {{key: string, source: string, owner: string, slug: string}} target - the identity.
 * @returns {Promise<object>} one `checkLanded` entry.
 */
async function askVersions(api, target) {
  try {
    const data = await api.marketVersions({
      source: target.source,
      owner: target.owner,
      slug: target.slug,
    });
    const versions = Array.isArray(data?.versions) ? data.versions : [];
    const candidate = versions.length > 0 && typeof versions[0]?.version === 'string' ? versions[0].version : '';
    return {
      key: target.key,
      phase: candidate === '' ? 'failed' : 'ready',
      candidate: candidate === '' ? null : candidate,
      latest: typeof data?.latest === 'string' ? data.latest : null,
      versions,
      total: Number.isInteger(data?.total) ? data.total : versions.length,
      at: Date.now(),
      reason: candidate === '' ? 'E_NO_VERSIONS' : null,
    };
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : '';
    return {
      key: target.key,
      phase: checkPhaseOf(code),
      at: Date.now(),
      reason: code === '' ? 'E_UNKNOWN' : code,
    };
  }
}

/**
 * Render the skill center page.
 * @param {{t?: Function, store: object, api: object}} props - locale seat, page store, and API client.
 * @returns {import('react').ReactElement} the page.
 */
export function SkillsPage({ t = identityTranslate, store, api }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const tabsId = useId();
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);
  const disposeHeader = useRef(null);
  /** The page's scroll container: the detail view reads and restores its offset. */
  const bodyRef = useRef(null);

  useEffect(() => () => {
    disposeHeader.current?.();
    disposeHeader.current = null;
  }, []);

  const headerRef = useCallback((element) => {
    disposeHeader.current?.();
    disposeHeader.current = null;
    if (element !== null && element !== undefined) disposeHeader.current = attachHeader(element);
  }, []);

  const load = useCallback(async (mode) => {
    if (busy.current) return;
    busy.current = true;
    const previous = store.getSnapshot().payload;
    if (mode === 'refresh') setRefreshing(true);
    store.actions.loading();
    const startedAt = Date.now();
    let failed = null;
    try {
      const payload = await api.list();
      store.actions.ready(payload);
    } catch (error) {
      failed = { code: error?.code ?? 'E_UNKNOWN', message: error?.message ?? '' };
      if (mode === 'refresh' && previous !== null) store.actions.refreshFailed(failed);
      else store.actions.failed(failed);
    } finally {
      const elapsed = Date.now() - startedAt;
      if (mode === 'refresh' && elapsed < MIN_INDICATOR_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_INDICATOR_MS - elapsed));
      }
      setRefreshing(false);
      busy.current = false;
    }
    return failed;
  }, [api, store]);

  const loadDetail = useCallback(async (row, inFlight) => {
    const key = rowKey(row);
    store.actions.detailLoading(key);
    try {
      // `inFlight` lets the slow path reuse the request the prefetch already started.
      const data = await (inFlight === undefined ? api.skillDetail({ name: row.name }) : inFlight);
      store.actions.detailReady(key, data ?? null);
    } catch (error) {
      store.actions.detailFailed(key, { code: error?.code ?? 'E_UNKNOWN', message: error?.message ?? '' });
    }
  }, [api, store]);

  /** One round is enough at a time: two of them would double every request. */
  const checkInFlight = useRef(false);

  /**
   * Run one round of update checks, serially, inside the contract's budgets.
   *
   * One request at a time in row order, so a slow upstream cannot turn a visit into a burst;
   * one identity once, because two directories holding the same skill compare their own
   * versions against the same answer. A row that misses its 2s slice is marked skipped and
   * the round moves on (the request keeps running - a late answer still lands in the cache),
   * and once the round is past 8s the rest are skipped without a request at all.
   * @param {{key: string, source: string, owner: string, slug: string}[]} targets - identities.
   * @param {{force?: boolean}} [options] - `force` ignores the ten minute window.
   * @returns {Promise<void>} resolves when the round is over.
   */
  const runCheck = useCallback(async (targets, options = {}) => {
    const list = Array.isArray(targets) ? targets : [];
    if (list.length === 0 || checkInFlight.current) return;
    const snapshot = store.getSnapshot();
    const now = Date.now();
    const wanted = options.force === true
      ? list
      : list.filter((target) => needsCheck(snapshot.checks[target.key], now));
    if (wanted.length === 0) return;
    checkInFlight.current = true;
    store.actions.checkStart(wanted.map((target) => target.key));
    const deadline = Date.now() + CHECK_BUDGET_MS;
    try {
      for (const target of wanted) {
        if (Date.now() >= deadline) {
          store.actions.checkLanded([{
            key: target.key, phase: 'skipped', at: Date.now(), reason: 'E_BUDGET',
          }]);
          continue;
        }
        const pending = askVersions(api, target);
        const first = await Promise.race([pending, after(CHECK_TIMEOUT_MS)]);
        if (first === null) {
          store.actions.checkLanded([{
            key: target.key, phase: 'skipped', at: Date.now(), reason: 'E_SOURCE_TIMEOUT',
          }]);
          void pending.then((entry) => store.actions.checkLanded([entry]));
          continue;
        }
        store.actions.checkLanded([first]);
      }
    } finally {
      store.actions.checkFinish();
      checkInFlight.current = false;
    }
  }, [api, store]);

  /**
   * Ask about one row's identity, unless this session already has a fresh answer.
   * @param {object} row - the row being opened.
   * @returns {void}
   */
  const ensureCheck = useCallback((row) => {
    const upstream = row?.upstream ?? null;
    if (upstream === null || row?.symlink === true) return;
    if (typeof row?.version !== 'string' || row.version === '') return;
    const key = marketKeyOf(upstream);
    if (!needsCheck(store.getSnapshot().checks[key], Date.now())) return;
    void runCheck([{ key, source: upstream.sourceId, owner: upstream.owner, slug: upstream.slug }]);
  }, [runCheck, store]);

  /**
   * Open one skill's detail: remember where the list was, then read its text.
   * @param {object} row - the row that was clicked.
   * @returns {void}
   */
  const openRow = useCallback(async (row) => {
    const body = bodyRef.current;
    const top = body === null ? 0 : body.scrollTop;
    // Two levels remember two offsets: a row opened from a provider page has to come back to
    // that page, not to the list, so the level it was opened from decides which one to write.
    if (store.getSnapshot().pluginDetail === null) store.actions.rememberDetailScroll(top);
    else store.actions.rememberPluginScroll(top);
    // Read the text before the view changes, for at most 150 ms: a detail that opens on its
    // final text never has a placeholder frame to move everything below the body.
    const raw = api.skillDetail({ name: row.name });
    const settled = raw.then(
      (data) => ({ data: data ?? null }),
      (error) => ({ data: { error: { code: error?.code ?? 'E_UNKNOWN' } } }),
    );
    const late = new Promise((resolve) => { setTimeout(() => resolve(null), 150); });
    const first = await Promise.race([settled, late]);
    if (first === null) {
      // Too slow to wait for: show the list's own loading state, reusing the request.
      store.actions.openDetail(row);
      ensureCheck(row);
      void loadDetail(row, raw);
      return;
    }
    store.actions.openDetail(row, first.data);
    // Opening a detail is one of the four moments that check: this row only, and only when
    // there is no fresh answer yet.
    ensureCheck(row);
  }, [api, ensureCheck, loadDetail, store]);

  const closeDetail = useCallback(() => {
    store.actions.closeDetail();
  }, [store]);

  const openPlugin = useCallback((key) => {
    const body = bodyRef.current;
    store.actions.rememberDetailScroll(body === null ? 0 : body.scrollTop);
    store.actions.openPlugin(key);
  }, [store]);

  const closePlugin = useCallback(() => {
    // Crash the offset to 0 before the list remounts: the page bar's compact state is derived
    // from this offset and hides the intro, so a header mounted at the provider page's offset
    // would swallow the offset the next effect restores (scroll anchoring pulls it back up).
    const body = bodyRef.current;
    if (body !== null) body.scrollTop = 0;
    store.actions.closePlugin();
  }, [store]);

  useEffect(() => {
    if (store.getSnapshot().status !== 'idle') return;
    void load('initial');
  }, [load, store]);

  // An install writes a new directory into the skills root, so the installed tab has to
  // re-read it - but only when the user actually goes there, and only once.
  useEffect(() => {
    if (state.tab !== TAB_INSTALLED || store.getSnapshot().market.installedDirty !== true) return;
    store.actions.marketClearInstalledDirty();
    void load('initial');
  }, [load, state.tab, store]);

  // One icon loop for both tabs. It lives here rather than in `MarketPanel` because the
  // two tab panels are mounted exclusively and the installed tab is the default: a loop
  // inside the market panel would never run for someone who opens the panel and stays on
  // the installed list. One selector (`iconBatch`) and one in-flight flag mean the same
  // identity can never be asked for twice at once.
  const iconsInFlight = useRef(false);
  useEffect(() => {
    // Seed first, ask later. SkillHub ships its icons inside the list payload, so the
    // market cards never needed a request - but an installed row reads the cache, and
    // nothing used to move the inline URLs into it (a mixed batch then took 7.5s to draw
    // an icon the page already had). Seeding is local, so it returns before the network
    // step; writing the cache re-runs this effect, and *that* pass is the network one.
    // It cannot loop: the seeded keys are skipped by `iconSeeds` from then on.
    // Titles ride along: `market/list` carries `displayName`, which is the market title on
    // SkillHub, so an installed row can show the upstream title before any request. Both
    // seeds are local; writing them re-runs this effect, and that pass is the network one.
    const seeds = iconSeeds(state.market);
    const titles = nameSeeds(state.market);
    if (seeds !== null || titles !== null) {
      if (seeds !== null) store.actions.marketIconsSeeded(seeds);
      if (titles !== null) store.actions.marketNamesSeeded(titles);
      return;
    }
    if (iconsInFlight.current) return;
    const batch = iconBatch(state.payload, state.market);
    if (batch.length === 0) return;
    iconsInFlight.current = true;
    void (async () => {
      try {
        const data = await api.marketIcons({
          items: batch.map((entry) => ({ source: entry.sourceId, owner: entry.owner, slug: entry.slug })),
        });
        const icons = {};
        for (const entry of batch) {
          const url = data?.icons?.[entry.key];
          icons[entry.key] = typeof url === 'string' && url !== '' ? url : null;
        }
        store.actions.marketIconsReady(icons);
        // One response, two maps: a missing title leaves the row on its own name and must
        // never hold back the icons.
        store.actions.marketNamesReady(data?.names ?? null);
      } catch {
        // Silent by design: the tiles keep their letters, nothing is announced.
        store.actions.marketIconsAttempted(batch.map((entry) => entry.key));
      } finally {
        iconsInFlight.current = false;
      }
    })();
  }, [api, state.payload, state.market.icons, state.market.iconsTried, state.market.names, store]);

  const onToggle = useCallback(async (row, enabled) => {
    const key = rowKey(row);
    store.actions.pending(key);
    try {
      if (switchMode(row) === 'provider') {
        await api.toggleProvider({ provider: row.provider ?? '', name: row.name, enabled });
      } else {
        await api.toggle({ name: row.name, path: row.path, enabled });
      }
      store.actions.commit(key, enabled);
    } catch (error) {
      const code = error?.code ?? 'E_UNKNOWN';
      store.actions.fail(key, reasonText(code, error?.message ?? '', t));
    }
  }, [api, store, t]);

  /** The identity whose update is in flight, so both buttons can show it and stay disabled. */
  const [updatingKey, setUpdatingKey] = useState(null);
  /** The version list's expander and the update dialog: view state of one open detail. */
  const [expandedVersions, setExpandedVersions] = useState(false);
  const [updateTarget, setUpdateTarget] = useState(null);

  /**
   * Overwrite the open skill with one upstream version, and fold the outcome back.
   *
   * Five endings, three of which only exist after the host touched the directory (restored /
   * lost / unconfirmed): each one leaves the page in the state that disk is actually in, and
   * a rescan follows the two where the list itself may have changed.
   * @param {object} row - the row being updated.
   * @param {string} to - the version to install.
   * @returns {Promise<void>} resolves when the outcome has been drawn.
   */
  const runUpdate = useCallback(async (row, to) => {
    const upstream = row?.upstream ?? null;
    if (upstream === null || typeof row?.path !== 'string' || row.path === '') return;
    if (typeof to !== 'string' || to === '') return;
    const identity = marketKeyOf(upstream);
    const key = rowKey(row);
    setUpdatingKey(identity);
    store.actions.pending(key);
    try {
      const result = await api.marketUpdate({
        source: upstream.sourceId,
        owner: upstream.owner,
        slug: upstream.slug,
        version: to,
        name: row.name,
        path: row.path,
      });
      const applied = typeof result?.version === 'string' && result.version !== '' ? result.version : to;
      store.actions.updateApplied({ identity, name: row.name, path: row.path, version: applied });
      store.actions.fail(key, '');
      // The disk is new; the page still shows the old text, so it is read once more. Both
      // follow-ups are best-effort: the directory already answers for itself.
      void loadDetail(row);
      void load('initial');
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code : 'E_UNKNOWN';
      const from = typeof error?.data?.from === 'string'
        ? error.data.from
        : (typeof row.version === 'string' ? row.version : '');
      const reason = error?.message ?? '';
      if (code === 'E_UPDATE_LOST') {
        // The directory is gone and the old copy waits in a backup: this skill is no longer
        // installed, and saying so beats "try again".
        store.actions.fail(key, t('detail.updateLost'));
        store.actions.detailFailed(store.getSnapshot().detail?.key ?? key, { code: 'E_NOT_FOUND', message: reason });
        void load('initial');
      } else if (code === 'E_UPDATE_UNCONFIRMED') {
        store.actions.fail(key, t('detail.updateUnknown'));
        store.actions.checkLanded([{ key: identity, phase: 'failed', at: Date.now(), reason: code }]);
        void load('initial');
      } else if (code === 'E_UPDATE_RESTORED') {
        store.actions.fail(key, t('detail.updateRolledBack', { version: from }));
      } else if (code === 'E_ALREADY_UP_TO_DATE') {
        store.actions.fail(key, '');
        store.actions.checkLanded([{ key: identity, phase: 'ready', candidate: to, latest: to, at: Date.now() }]);
      } else {
        const explained = t(reasonKeyOf(code), {
          source: t(`market.source.${upstream.sourceId}`),
          name: row.name,
          path: row.path,
          reason,
        });
        store.actions.fail(key, `${t('detail.updateFailed', { version: to })} ${explained}`);
      }
    } finally {
      setUpdatingKey(null);
    }
  }, [api, load, loadDetail, store, t]);

  // The provider page is a view of rows the list already holds: no request of its own.
  const pluginProvider = state.pluginDetail;
  const pluginBlock = pluginProvider === null
    ? null
    : (toPluginBlocks(toGroups(state.payload).find((group) => group.key === 'builtin'))
      .find((block) => block.key === pluginProvider) ?? null);
  const detailKey = state.detail === null ? null : state.detail.key;
  const detailRow = detailKey === null ? null : rowByKey(state.payload, detailKey);
  const detailStatus = detailKey === null ? 'idle' : detailStateOf(state, detailKey);
  // The detail's verdict is a read-only projection of the cache: the identity it belongs to
  // outlives the page, and the same entry is read by the list's header as well.
  const detailIdentity = detailRow === null ? '' : identityOf(detailRow.upstream);
  const detailCheck = detailIdentity === '' ? null : (state.checks[detailIdentity] ?? null);
  const retryDetail = useCallback(() => {
    if (detailRow === null) return;
    void loadDetail(detailRow);
  }, [detailRow, loadDetail]);

  // Another skill (or the list) means the expander and the dialog start closed: neither
  // describes anything once the row underneath them changed.
  useEffect(() => {
    setExpandedVersions(false);
    setUpdateTarget(null);
  }, [detailKey]);

  // "Check again" on the version block: this row's identity only, and it ignores the ten
  // minute window - asking again is the whole point of the button. The comparison itself
  // (two strings, equal or not, no ordering) happens where the verdict is drawn.
  const recheckDetail = useCallback((row) => {
    const upstream = row?.upstream ?? null;
    if (upstream === null) return;
    // Same guard as `ensureCheck`: with no version of its own there is nothing to compare,
    // so the block sits on "cannot check" and asking the upstream would answer nothing new.
    if (typeof row?.version !== 'string' || row.version === '') return;
    void runCheck([{
      key: marketKeyOf(upstream),
      source: upstream.sourceId,
      owner: upstream.owner,
      slug: upstream.slug,
    }], { force: true });
  }, [runCheck]);

  // Two moves, both in a paint effect so neither is visible as a jump:
  //   entering the detail -> 0, because the page header is gone and the detail starts at the
  //     breadcrumb (an offset from the list would start it mid-page);
  //   leaving it -> the offset that was read while the rows were still on screen.
  // No request, no smooth scroll: the restore is the frame's first state, as the market does.
  usePaintEffect(() => {
    const body = bodyRef.current;
    if (body === null) return;
    if (detailKey !== null) {
      body.scrollTop = 0;
      return;
    }
    const snapshot = store.getSnapshot();
    // Back on the provider page -> its own offset; back on the list -> the list's. Written
    // unconditionally: 0 means "top", not "leave whatever was there".
    body.scrollTop = snapshot.pluginDetail === null ? snapshot.detailScrollTop : snapshot.pluginScrollTop;
  }, [detailKey, state.pluginDetail, store]);

  // Entering the skills tab always starts on the list - not on the detail or the provider page
  // the last visit stopped at, and not at its offset. Going back *inside* the tab still
  // restores offsets; only leaving and re-entering resets.
  const entered = useRef(false);
  useEffect(() => {
    if (state.tab !== TAB_INSTALLED) {
      entered.current = false;
      return;
    }
    if (entered.current) return;
    entered.current = true;
    store.actions.resetPage();
    const body = bodyRef.current;
    if (body !== null) body.scrollTop = 0;
  }, [state.tab, store]);

  const groups = toGroups(state.payload);
  const counts = state.payload?.counts;
  const excluded = Number.isInteger(counts?.excluded) ? counts.excluded : 0;
  const showsInstalled = state.tab === TAB_INSTALLED;
  const installedRows = groups.find((group) => group.key === 'installed')?.skills ?? [];
  // The header's update sentence is about the rows on screen, computed now: a row that was
  // installed, deleted or hand-edited since the round changes the count without a request.
  const updateNote = showsInstalled && state.payload !== null
    ? headerUpdateNote(installedRows, state.checks, state.checkRun, t)
    : null;

  // One round per visit to the tab: every identity without a fresh answer, in row order.
  // The guard is a ref, not the checks: a round that ran out of budget marks rows `skipped`
  // (which are "needs asking" again), and an effect watching them would start the next
  // round immediately, for ever.
  const autoCheckDone = useRef(false);
  useEffect(() => {
    if (state.tab !== TAB_INSTALLED) {
      autoCheckDone.current = false;
      return;
    }
    if (state.payload === null || autoCheckDone.current) return;
    // Another round is already asking; its answers re-render, and this one goes then.
    if (checkInFlight.current) return;
    autoCheckDone.current = true;
    void runCheck(detectionTargets(installedRows));
  }, [installedRows, runCheck, state.payload, state.tab]);
  // The host replaces the whole page header when a plugin's detail opens, and the installed
  // detail follows it: breadcrumb first, nothing above it. The market keeps its header and
  // swaps only the grid - that difference is deliberate (host parity is per page).
  const detailOpen = showsInstalled && detailKey !== null;
  // One level below the skill detail: a provider page replaces the page body the same way.
  const pluginOpen = showsInstalled && detailKey === null && pluginBlock !== null;
  const loadingFirst = state.status === 'loading' && state.payload === null;
  const failedFirst = state.status === 'error' && state.payload === null;
  // The header's one refresh button follows the tab: the installed list below, the
  // market's first page above.
  const marketBusy = !showsInstalled && state.market.listStatus === 'loading';

  // An installed row's icon comes from its `_meta.json` identity (Host puts the triple on
  // the row); rows without one - hand-copied, or written by another tool - keep the letter.
  const rowIconUrl = (row) => (row?.upstream === null || row?.upstream === undefined
    ? null
    : iconUrlFor(marketKeyOf(row.upstream), state.market));

  // The builtin partition is shown as one block per provider (the provider is the row's own
  // field); local and installed rows stay exactly as they were.
  const renderGroup = (group) => (
    <section className={cn('group')} data-skc-group={group.key} key={group.key}>
      <div className={cn('groupHead')}>
        <h3 className={cn('groupTitle')}>{t(`group.${group.key}`)}</h3>
      </div>
      {group.skills.length === 0
        ? <p className={cn('empty')}>{t(groupEmptyKey(group.key))}</p>
        : (
          <ul className={cn('cards')}>
            {group.key === 'builtin'
              ? toPluginBlocks(group).map((block) => (
                <PluginBlock key={block.key} block={block} t={t} onOpen={openPlugin} />
              ))
              : group.skills.map((row) => (
                <SkillRow
                  key={rowKey(row)}
                  row={row}
                  t={t}
                  rows={state.rows}
                  onToggle={onToggle}
                  onOpen={openRow}
                  iconUrl={rowIconUrl(row)}
                  title={rowTitleOf(row, state.market)}
                />
              ))}
          </ul>
        )}
    </section>
  );

  return (
    <section className={cn('page')} data-skc-panel="" aria-busy={state.status === 'loading' || refreshing}>
      <div className={cn('pageBody')} data-skc-body="" ref={bodyRef}>
        {detailOpen || pluginOpen ? (
          <div className={cn('detailPage')}>
            {/* A window drag region cannot go on the whole card: it would swallow text
                selection and every button. An empty strip with the header's darwin inset
                keeps the window draggable and nothing else. */}
            <div className={cn('detailDrag')} data-window-drag="" />
            {pluginOpen ? (
              <PluginDetail
                block={pluginBlock}
                t={t}
                rows={state.rows}
                onBack={closePlugin}
                onToggle={onToggle}
              />
            ) : (
            <InstalledDetail
              detail={state.detail}
              row={detailRow}
              rows={state.rows}
              t={t}
              status={detailStatus}
              check={detailCheck}
              updating={detailIdentity !== '' && updatingKey === detailIdentity}
              iconUrl={detailRow === null ? null : rowIconUrl(detailRow)}
              title={detailRow === null ? '' : rowTitleOf(detailRow, state.market)}
              expanded={expandedVersions}
              updateTarget={updateTarget}
              onBack={closeDetail}
              onRetry={retryDetail}
              onToggle={onToggle}
              onCheck={recheckDetail}
              onUpdate={runUpdate}
              onExpand={setExpandedVersions}
              onUpdatePrompt={setUpdateTarget}
            />
            )}
          </div>
        ) : (
          <Fragment>
            <div
              className={cn('pageBar', 'pageBarWithTabs')}
              data-skc-bar=""
              ref={headerRef}
            >
              <header className={cn('pageHead')} data-window-drag="">
                <div className={cn('pageHeading')}>
                  <h1 className={cn('pageTitle')} data-skc-header-part="title">{t('page.title')}</h1>
                  <div className={cn('pageIntro')} data-skc-header-part="intro">
                    <span>{t('page.intro')}</span>
                    <Tooltip
                      label={t('page.infoDescription')}
                      side="bottom"
                      delayMs={300}
                      maxWidth={300}
                      portal
                      openOnClick
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn('infoButton')}
                        aria-label={t('page.infoLabel')}
                      >
                        <IconInfoOutlineRegular size={11} aria-hidden="true" />
                      </Button>
                    </Tooltip>
                  </div>
                </div>
                <div
                  className={cn('toolbar')}
                  data-skc-header-part="toolbar"
                >
                  {/* The host's status slot holds this one sentence and nothing else: no count,
                      no separator. `data-tone` is the only thing a state adds, and an empty
                      round draws nothing at all - an answer set that does not exist yet cannot
                      be summarised. */}
                  {updateNote === null ? null : (
                    <span className={cn('status')} data-tone={updateNote.tone ?? undefined}>
                      {updateNote.text}
                    </span>
                  )}
                  <Tooltip
                    label={t('page.refresh')}
                    delayMs={500}
                    focusDelayMs={500}
                    side="bottom"
                    portal
                    disabled={refreshing}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn('addButton')}
                      aria-label={t('page.refresh')}
                      aria-busy={refreshing || marketBusy}
                      disabled={refreshing || marketBusy}
                      onClick={() => {
                        if (!showsInstalled) {
                          store.actions.marketReload();
                          return;
                        }
                        // A refresh re-reads the list, and the detail view is a view of that
                        // list: closing it first is the same rule the market's reload follows.
                        store.actions.closeDetail();
                        void load('refresh');
                        // Refresh is the user asking again, so it ignores the ten minute
                        // window the tab entry respects.
                        void runCheck(detectionTargets(installedRows), { force: true });
                      }}
                      icon={refreshing || marketBusy
                        ? <StateDot state="ongoing" size={13} />
                        : <IconRefreshOutlineRegular size={13} />}
                    >
                      <span className={cn('toolbarLabel')}>{t('page.refresh')}</span>
                    </Button>
                  </Tooltip>
                  {showsInstalled ? (
                    <span className={cn('addGroup')} role="group" aria-label={t('add.label')} title={t('add.comingSoon')}>
                      <Button
                        variant="primary"
                        size="sm"
                        className={cn('addPrimary')}
                        aria-label={t('add.label')}
                        disabled
                        icon={<IconPlusOutlineRegular size={13} />}
                      >
                        <span className={cn('toolbarLabel')}>{t('add.label')}</span>
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        className={cn('addMore')}
                        aria-label={t('add.comingSoon')}
                        disabled
                      >
                        <IconChevronDownOutlineRegular size={13} aria-hidden="true" />
                      </Button>
                    </span>
                  ) : null}
                </div>
                <div className={cn('pageTabs')} data-skc-header-part="tabs">
                  <SegmentedTabs
                    size="sm"
                    className={cn('pageTabList')}
                    label={t('tabs.label')}
                    value={state.tab}
                    onChange={(next) => store.actions.setTab(next)}
                    items={[
                      {
                        value: TAB_INSTALLED,
                        label: t('tabs.installed'),
                        id: `${tabsId}-${TAB_INSTALLED}`,
                        panelId: `${tabsId}-${TAB_INSTALLED}-panel`,
                      },
                      {
                        value: TAB_MARKET,
                        label: t('tabs.market'),
                        id: `${tabsId}-${TAB_MARKET}`,
                        panelId: `${tabsId}-${TAB_MARKET}-panel`,
                      },
                    ]}
                  />
                </div>
              </header>
            </div>
            {showsInstalled ? (
              <div
                className={cn('installedPanel')}
                role="tabpanel"
                id={`${tabsId}-${TAB_INSTALLED}-panel`}
                aria-labelledby={`${tabsId}-${TAB_INSTALLED}`}
              >
                {loadingFirst ? <ListSkeleton label={t('page.loading')} /> : null}
                {failedFirst ? (
                  <div className={cn('failure')} role="alert">
                    <StateDot state="error" />
                    <p>{t('page.error')}</p>
                    <Button variant="outline" size="sm" onClick={() => void load('initial')}>
                      {t('page.retry')}
                    </Button>
                  </div>
                ) : null}
                {state.payload === null ? null : (
                  <Fragment>
                    {groups.map(renderGroup)}
                    {excluded > 0 ? <p className={cn('footer')}>{t('footer.excluded', { count: excluded })}</p> : null}
                  </Fragment>
                )}
              </div>
            ) : (
              <div
                className={cn('tabPanel')}
                role="tabpanel"
                id={`${tabsId}-${TAB_MARKET}-panel`}
                aria-labelledby={`${tabsId}-${TAB_MARKET}`}
              >
                <MarketPanel store={store} api={api} t={t} />
              </div>
            )}
          </Fragment>
        )}
      </div>
    </section>
  );
}
