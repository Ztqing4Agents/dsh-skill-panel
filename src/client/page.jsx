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
import { iconBatch, iconSeeds, iconUrlFor, marketKeyOf, nameSeeds, rowTitleOf } from './market-model.js';
import { MarketPanel } from './market-panel.jsx';
import { ListSkeleton } from './skeleton.jsx';
import { SkillRow } from './row.jsx';
import {
  TAB_INSTALLED,
  TAB_MARKET,
  detailStateOf,
  groupEmptyKey,
  reasonText,
  rowByKey,
  rowKey,
  statusLine,
  switchMode,
  toGroups,
} from './model.js';

/** How long the refresh indicator stays up, so a fast reload does not flicker. */
const MIN_INDICATOR_MS = 400;

/** Fallback translate used only when a seat is rendered without a locale. */
const identityTranslate = (key) => key;

/** Writes land before the frame paints; a string render has no DOM to write to. */
const usePaintEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect;

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

  const loadDetail = useCallback(async (row) => {
    const key = rowKey(row);
    store.actions.detailLoading(key);
    try {
      const data = await api.skillDetail({ name: row.name });
      store.actions.detailReady(key, data ?? null);
    } catch (error) {
      store.actions.detailFailed(key, { code: error?.code ?? 'E_UNKNOWN', message: error?.message ?? '' });
    }
  }, [api, store]);

  /**
   * Open one skill's detail: remember where the list was, then read its text.
   * @param {object} row - the row that was clicked.
   * @returns {void}
   */
  const openRow = useCallback((row) => {
    const body = bodyRef.current;
    store.actions.rememberDetailScroll(body === null ? 0 : body.scrollTop);
    store.actions.openDetail(row);
    void loadDetail(row);
  }, [loadDetail, store]);

  const closeDetail = useCallback(() => {
    store.actions.closeDetail();
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

  const detailKey = state.detail === null ? null : state.detail.key;
  const detailRow = detailKey === null ? null : rowByKey(state.payload, detailKey);
  const detailStatus = detailKey === null ? 'idle' : detailStateOf(state, detailKey);
  const retryDetail = useCallback(() => {
    if (detailRow === null) return;
    void loadDetail(detailRow);
  }, [detailRow, loadDetail]);

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
    const top = store.getSnapshot().detailScrollTop;
    if (top > 0) body.scrollTop = top;
  }, [detailKey, store]);

  const groups = toGroups(state.payload);
  const counts = state.payload?.counts;
  const excluded = Number.isInteger(counts?.excluded) ? counts.excluded : 0;
  const showsInstalled = state.tab === TAB_INSTALLED;
  // The host replaces the whole page header when a plugin's detail opens, and the installed
  // detail follows it: breadcrumb first, nothing above it. The market keeps its header and
  // swaps only the grid - that difference is deliberate (host parity is per page).
  const detailOpen = showsInstalled && detailKey !== null;
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

  const renderGroup = (group) => (
    <section className={cn('group')} data-skc-group={group.key} key={group.key}>
      <div className={cn('groupHead')}>
        <h3 className={cn('groupTitle')}>{t(`group.${group.key}`)}</h3>
      </div>
      {group.skills.length === 0
        ? <p className={cn('empty')}>{t(groupEmptyKey(group.key))}</p>
        : (
          <ul className={cn('cards')}>
            {group.skills.map((row) => (
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
        {detailOpen ? (
          <div className={cn('detailPage')}>
            {/* A window drag region cannot go on the whole card: it would swallow text
                selection and every button. An empty strip with the header's darwin inset
                keeps the window draggable and nothing else. */}
            <div className={cn('detailDrag')} data-window-drag="" />
            <InstalledDetail
              detail={state.detail}
              row={detailRow}
              rows={state.rows}
              t={t}
              status={detailStatus}
              iconUrl={detailRow === null ? null : rowIconUrl(detailRow)}
              title={detailRow === null ? '' : rowTitleOf(detailRow, state.market)}
              onBack={closeDetail}
              onRetry={retryDetail}
              onToggle={onToggle}
            />
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
                  {showsInstalled && state.payload !== null
                    ? <span className={cn('status')}>{statusLine(counts, t)}</span>
                    : null}
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
