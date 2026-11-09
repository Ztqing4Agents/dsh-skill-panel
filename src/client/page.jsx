/**
 * The global page: header, two tabs, three partitions, footer.
 *
 * Data comes only from props (`store`, `api`) so the tree can be rendered to a
 * string in a test without a browser; the header's DOM measurement lives inside
 * `attachHeader`, which a string render never calls.
 */
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
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
import { MarketPanel } from './market-panel.jsx';
import { ListSkeleton } from './skeleton.jsx';
import { SkillRow } from './row.jsx';
import {
  TAB_INSTALLED,
  TAB_MARKET,
  groupEmptyKey,
  reasonText,
  rowKey,
  statusLine,
  switchMode,
  toGroups,
} from './model.js';

/** How long the refresh indicator stays up, so a fast reload does not flicker. */
const MIN_INDICATOR_MS = 400;

/** Fallback translate used only when a seat is rendered without a locale. */
const identityTranslate = (key) => key;

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

  const groups = toGroups(state.payload);
  const counts = state.payload?.counts;
  const excluded = Number.isInteger(counts?.excluded) ? counts.excluded : 0;
  const showsInstalled = state.tab === TAB_INSTALLED;
  const loadingFirst = state.status === 'loading' && state.payload === null;
  const failedFirst = state.status === 'error' && state.payload === null;
  // The header's one refresh button follows the tab: the installed list below, the
  // market's first page above.
  const marketBusy = !showsInstalled && state.market.listStatus === 'loading';

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
              <SkillRow key={rowKey(row)} row={row} t={t} rows={state.rows} onToggle={onToggle} />
            ))}
          </ul>
        )}
    </section>
  );

  return (
    <section className={cn('page')} data-skc-panel="" aria-busy={state.status === 'loading' || refreshing}>
      <div className={cn('pageBody')} data-skc-body="">
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
                    if (showsInstalled) void load('refresh');
                    else store.actions.marketReload();
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
            {state.payload === null ? null : groups.map(renderGroup)}
            {excluded > 0 ? <p className={cn('footer')}>{t('footer.excluded', { count: excluded })}</p> : null}
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
      </div>
    </section>
  );
}
