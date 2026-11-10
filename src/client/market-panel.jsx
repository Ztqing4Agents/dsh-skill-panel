/**
 * The market tab: filters, grid, tail, inline detail and the install confirmation.
 *
 * The panel reads the market sub-state from the store and writes it back through the
 * store's actions; it owns no list state of its own, so leaving the tab and coming back
 * restores the same filters, the same loaded pages and the same scroll offset (design
 * §6.1). Only two things need the DOM, and both live in effects: the scroll-offset
 * restore and the bottom prefetch listener.
 *
 * The market shows one source at a time (the source menu has no "all"), so a page is a
 * single request: no fan-out, no per-source settlement. A failed page is the whole page's
 * failure and gets the error state with a retry - while an empty list is not a failure,
 * it is an empty state.
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives';

import { cn } from './styles.js';
import {
  MARKET_FALLBACK_SOURCES,
  MARKET_PAGE_SIZE,
  emptyKindOf,
  mergeBatches,
  visibleCategories,
  marketKeyOf,
  pagedSources,
  reasonKeyOf,
  sourceLabelOf,
} from './market-model.js';
import { MarketCard } from './market-card.jsx';
import { MarketConfirm } from './market-confirm.jsx';
import { MarketDetail } from './market-detail.jsx';
import { MarketFilters } from './market-filters.jsx';
import { MarketChipsSkeleton, MarketSkeleton, MarketTailSkeleton } from './market-skeleton.jsx';

/** How close to the bottom the next page starts loading, in pixels. */
const PREFETCH_PX = 200;

/** The scroll container the page owns; the panel only reads and writes its offset. */
const SCROLL_BODY = '[data-skc-body]';

/** Writes land before the frame paints; a string render has no DOM to write to. */
const usePaintEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Render the market tab.
 * @param {{store: object, api: object, t: Function}} props - page store, API client, translate.
 * @returns {import('react').ReactElement} the panel.
 */
export function MarketPanel({ store, api, t }) {
  const getSnapshot = useCallback(() => store.getSnapshot().market, [store]);
  const market = useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
  const rootRef = useRef(null);
  const appending = useRef(false);
  /** The last scroll offset the list itself showed; valid even after the DOM is swapped. */
  const lastScroll = useRef(0);
  const detailOpen = market.detail !== null;

  /**
   * The scroll container of the page, found from the panel's own box.
   * @returns {HTMLElement|null} the scrolling element, or null outside a browser.
   */
  const scrollBody = () => (rootRef.current === null ? null : rootRef.current.closest(SCROLL_BODY));

  /** Which `bootstrap` answer is still wanted; an older one is dropped, not applied. */
  const bootToken = useRef(0);

  /**
   * Read the scope list and one scope's category table, falling back to the built-in
   * scopes. `bootScope` guards the race: a slow answer for the scope the user just left
   * must not overwrite the numbers of the scope they are looking at.
   * @param {string} scope - the scope whose counts to read.
   * @returns {Promise<void>}
   */
  const boot = useCallback(async (scope) => {
    bootToken.current += 1;
    const token = bootToken.current;
    store.actions.marketBootLoading();
    try {
      const data = await api.marketBootstrap(scope);
      if (token !== bootToken.current) return;
      store.actions.marketBootReady(data);
      // The bookmarks arrive with bootstrap (they are one global set, not a per-page
      // answer), so the first frame draws the right state without a second round trip.
      store.actions.marketFavoritesLoaded(data?.favorites, data?.favoritesOk === true);
    } catch {
      // A failed bootstrap leaves the bookmark state unknown; the button draws "not
      // saved", and the first click's authoritative answer repairs it either way.
      if (token === bootToken.current) store.actions.marketBootFallback(MARKET_FALLBACK_SOURCES);
    }
  }, [api, store]);

  /** Read which market items are already installed here. @returns {Promise<void>} */
  const loadInstalled = useCallback(async () => {
    try {
      const data = await api.marketInstalled();
      store.actions.marketInstalledLoaded(data?.items ?? {});
    } catch {
      store.actions.marketInstalledLoaded({});
    }
  }, [api, store]);

  useEffect(() => {
    const current = store.getSnapshot().market;
    if (current.boot === 'idle') void boot(current.filters.source);
    // A scope change needs that scope's own numbers: the chips row is the only thing that
    // waits for them, and the previous scope's figures are already off screen.
    else if (current.boot === 'ready' && current.bootScope !== current.filters.source) void boot(current.filters.source);
    if (current.installedReady !== true) void loadInstalled();
  }, [boot, loadInstalled, store, market.boot, market.bootScope, market.filters.source]);

  /**
   * Ask the selected source for one page. The market shows one source at a time, so this
   * is a plain request: no fan-out, no per-source settlement, and a failure is the whole
   * page's failure rather than one strip among several.
   * @param {{sort: string, category: string|null, keyword: string, cursor: string|undefined}} query
   *   the query, with the cursor that source handed out last time.
   * @returns {Promise<object>} the route's page: `{items, next, total}`.
   */
  const fetchPage = useCallback(async (query) => {
    const page = await api.marketList({
      source: query.source,
      sort: query.sort,
      category: query.category,
      keyword: query.keyword,
      cursor: query.cursor,
      limit: MARKET_PAGE_SIZE,
    });
    return page !== null && typeof page === 'object' ? page : { items: [], next: null };
  }, [api]);

  /** Fetch page one for the current query, replacing whatever is on screen. @returns {Promise<void>} */
  const loadFirst = useCallback(async () => {
    const current = store.getSnapshot().market;
    store.actions.marketListLoading();
    try {
      const page = await fetchPage({
        source: current.filters.source,
        sort: current.filters.sort,
        category: current.filters.category,
        keyword: current.keyword,
        cursor: undefined,
      });
      const items = Array.isArray(page.items) ? page.items : [];
      store.actions.marketPageAppended({
        pages: [{ sourceId: current.filters.source, page, items }],
        merged: mergeBatches([{ sourceId: current.filters.source, items }]),
      });
    } catch (error) {
      store.actions.marketListFailed({ code: error?.code ?? 'E_UNKNOWN', message: error?.message ?? '' });
    }
  }, [fetchPage, store]);

  /** Fetch the next page of every source that still has one. @returns {Promise<void>} */
  const loadMore = useCallback(async () => {
    const current = store.getSnapshot().market;
    if (current.listStatus !== 'ready' || current.page.status === 'loading' || appending.current) return;
    const [source] = pagedSources(current);
    if (source === undefined) return;
    appending.current = true;
    store.actions.marketPageStart();
    try {
      const page = await fetchPage({
        source,
        sort: current.filters.sort,
        category: current.filters.category,
        keyword: current.keyword,
        cursor: current.cursors[source] ?? undefined,
      });
      const items = Array.isArray(page.items) ? page.items : [];
      store.actions.marketPageAppended({
        pages: [{ sourceId: source, page, items }],
        merged: mergeBatches([{ sourceId: source, items }], { existing: current.items }),
      });
    } catch (error) {
      store.actions.marketPageFailed({ code: error?.code ?? 'E_UNKNOWN', message: error?.message ?? '' });
    } finally {
      appending.current = false;
    }
  }, [fetchPage, store]);

  useEffect(() => {
    const current = store.getSnapshot().market;
    if (current.pages > 0) return;
    if (current.listStatus === 'loading' || current.listStatus === 'error') return;
    void loadFirst();
  }, [market.pages, market.listStatus, loadFirst, store]);

  useEffect(() => {
    if (detailOpen) return;
    const saved = store.getSnapshot().market.scrollTop;
    lastScroll.current = saved;
    const body = scrollBody();
    if (body === null || saved <= 0) return;
    body.scrollTop = saved;
  }, [detailOpen, store]);

  // Upstreams answer short pages (ClawHub returns fewer items than asked while its cursor
  // still advances), so "the page did not fill the viewport" must not stop paging: keep
  // asking while the cursor says there is more and there is nothing to scroll yet.
  useEffect(() => {
    if (detailOpen || market.page.status !== 'more') return;
    const body = scrollBody();
    if (body === null) return;
    if (body.scrollHeight - body.clientHeight > PREFETCH_PX) return;
    void loadMore();
  }, [detailOpen, market.page.status, market.pages, loadMore, store]);

  useEffect(() => {
    if (detailOpen) return undefined;
    const root = rootRef.current;
    const body = scrollBody();
    if (body === null) return undefined;
    const onScroll = () => {
      lastScroll.current = body.scrollTop;
      const remaining = body.scrollHeight - body.scrollTop - body.clientHeight;
      if (remaining > PREFETCH_PX) return;
      void loadMore();
    };
    body.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      body.removeEventListener('scroll', onScroll);
      // Writing the offset is the *unmount* case only (leaving the tab). While the panel
      // is still in the document this cleanup was caused by the detail view opening, and
      // the offset to keep is the one `openDetail` just read with the list still on
      // screen - re-reading `body.scrollTop` here would hand back 0, because the browser
      // has already clamped the replaced document's offset.
      if (root !== null && body.contains(root)) return;
      store.actions.marketSetScroll(lastScroll.current);
    };
  }, [detailOpen, loadMore, store]);

  /** Load one item's detail into the store. @param {object} item - the market item. @returns {Promise<void>} */
  const loadDetail = useCallback(async (item) => {
    try {
      const data = await api.marketDetail({
        source: item.sourceId,
        owner: item.owner,
        slug: item.slug,
        version: typeof item.version === 'string' ? item.version : undefined,
      });
      store.actions.marketDetailReady(data ?? null);
    } catch (error) {
      store.actions.marketDetailFailed({ code: error?.code ?? 'E_UNKNOWN', message: error?.message ?? '' });
    }
  }, [api, store]);

  /** Open the inline detail view, remembering the list's scroll offset first. @param {object} item - the market item. @returns {void} */
  const openDetail = useCallback((item) => {
    const body = scrollBody();
    const top = body === null ? 0 : body.scrollTop;
    lastScroll.current = top;
    store.actions.marketSetScroll(top);
    store.actions.marketDetailOpen(item);
    void loadDetail(item);
  }, [loadDetail, store]);

  /** Close the detail view; the effect above restores the scroll offset. @returns {void} */
  const closeDetail = useCallback(() => {
    store.actions.marketDetailClose();
  }, [store]);

  /** Ask before installing: the dialog holds the request back. @param {object} item - the market item. @returns {void} */
  const askInstall = useCallback((item) => {
    store.actions.marketInstallConfirm(marketKeyOf(item));
  }, [store]);

  /** Send the install request and fold the three outcomes back into the store. @param {object} item - the market item. @returns {Promise<void>} */
  const confirmInstall = useCallback(async (item) => {
    const id = marketKeyOf(item);
    store.actions.marketInstallStart(id);
    try {
      const result = await api.marketInstall({
        source: item.sourceId,
        owner: item.owner,
        slug: item.slug,
        version: typeof item.version === 'string' ? item.version : null,
      });
      store.actions.marketInstallOk(id, result ?? {});
    } catch (error) {
      const data = error?.data ?? {};
      store.actions.marketInstallFail(id, t(reasonKeyOf(error?.code), {
        source: sourceLabelOf(item.sourceId, t),
        name: data.declaredName ?? data.name ?? '',
        path: data.path ?? '',
        reason: error?.message ?? '',
      }));
    }
  }, [api, store, t]);

  const confirmId = Object.keys(market.installs)
    .find((id) => market.installs[id]?.state === 'confirm') ?? null;
  const confirmItem = confirmId === null
    ? null
    : market.items.find((entry) => marketKeyOf(entry) === confirmId)
      ?? (market.detail !== null && market.detail.id === confirmId ? market.detail.item : null);
  // What "this result set" means for the reader: the four query inputs, nothing else. Changing
  // one of them is a different list and starts at the first card; paging, loading and detail
  // round-trips leave `scrollTop` alone.
  const queryKey = `${market.filters.source}|${market.filters.category}|${market.filters.sort}|${market.keyword}`;
  const shownQuery = useRef(queryKey);

  // Land the list at the top of its own account, in a paint effect: the reference market
  // (dsh-market `MarketSection.tsx`) does exactly this - instant, never smooth, so the move
  // is the frame's first state and not an animation - and it is what makes the landing point
  // independent of how long the answer turns out to be. Waiting for the browser's clamp gives
  // whatever the content height allows (measured: 0 on one path, 228 on another).
  usePaintEffect(() => {
    if (shownQuery.current === queryKey) return;
    shownQuery.current = queryKey;
    const body = scrollBody();
    if (body !== null) body.scrollTop = 0;
  }, [queryKey]);

  const emptyKind = emptyKindOf(market);
  const loadingFirst = market.listStatus === 'loading' && market.items.length === 0;
  // `page.status === 'loading'` covers two requests: page one (refresh, keyword) and the next
  // page (scroll). `pages` separates them - a page-one request starts at 0 - so only an append
  // draws the three placeholder cards and the "loading more" row. A page-one re-fetch over a
  // list still on screen used to grow the tail by a row (+206px) and snap back.
  const loadingTail = market.page.status === 'loading' && market.pages > 0 && market.items.length > 0;
  // A scope change re-reads the counts. While the chip row is already on screen it keeps the
  // numbers it has (one request old, replaced in place) instead of growing a second,
  // placeholder row underneath: that duplicate row moved the grid by 42px every time.
  const chipsRow = visibleCategories(market).visible;

  const emptyCopy = emptyKind === 'search'
    ? {
      title: t('market.emptySearchTitle', { keyword: market.keyword }),
      hint: t('market.emptySearchHint'),
      action: { label: t('market.clearSearch'), run: () => store.actions.marketCommitKeyword('') },
    }
    : emptyKind === 'category'
      ? {
        title: t('market.emptyCategoryTitle'),
        hint: null,
        action: { label: t('market.emptyCategoryAction'), run: () => store.actions.marketSetFilter({ category: null }) },
      }
      : { title: t('market.emptyTitle'), hint: null, action: null };

  return (
    <section
      className={cn('marketSection')}
      aria-label={t('market.sectionLabel')}
      aria-busy={market.listStatus === 'loading'}
      ref={rootRef}
    >
      {detailOpen ? (
        <MarketDetail
          detail={market.detail}
          market={market}
          t={t}
          onBack={closeDetail}
          onRetry={() => void loadDetail(market.detail?.item ?? {})}
          onInstall={askInstall}
        />
      ) : (
        <Fragment>
          <MarketFilters
            market={market}
            t={t}
            onInput={(text) => store.actions.marketSetInput(text)}
            onCommit={(text) => store.actions.marketCommitKeyword(text)}
            onFilter={(patch) => store.actions.marketSetFilter(patch)}
          />
          {(market.categoriesLoading && !chipsRow) || (market.boot === 'loading' && market.sources.length === 0)
            ? <MarketChipsSkeleton />
            : null}
          {loadingFirst ? <MarketSkeleton label={t('market.loading')} /> : null}
          {market.listStatus === 'error' ? (
            <div className={cn('marketFailure')}>
              <StateDot state="error" />
              <div className={cn('marketMain')}>
                <p className={cn('marketError')} role="alert">{t('market.errorTitle')}</p>
                <p className={cn('marketScope')}>{t('market.errorHint')}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void loadFirst()}>
                {t('market.retry')}
              </Button>
            </div>
          ) : null}
          {/* One live region for both: "more" while a next page is in flight, plain
              "loading" while page one replaces a visible list (the skeleton speaks for
              itself when there is no list). Exactly one at a time. */}
          {market.page.status === 'loading' && !loadingFirst ? (
            <span className={cn('progressAnnouncement')} role="status">
              {t(loadingTail ? 'market.loadingMore' : 'market.loading')}
            </span>
          ) : null}
          {market.items.length === 0 ? null : (
            <ul className={cn('marketGrid')} aria-busy={market.page.status === 'loading'}>
              {market.items.map((item) => (
                <MarketCard
                  key={marketKeyOf(item)}
                  item={item}
                  market={market}
                  t={t}
                  onOpen={openDetail}
                  onInstall={askInstall}
                />
              ))}
              {loadingTail ? <MarketTailSkeleton /> : null}
            </ul>
          )}
          {/* The "loading more" row belongs to the list, not to the toolbar: as a fourth
              toolbar child it narrowed the search box by 21px for the duration of every
              page load. The dot and the words are decoration - the sr-only `role="status"`
              above is what a screen reader hears, so this row is not announced twice. An
              append only: a page-one re-fetch keeps the list and adds nothing at the bottom. */}
          {loadingTail ? (
            <div className={cn('marketLoadMore')} aria-hidden="true">
              <StateDot state="ongoing" size={13} />
              <span>{t('market.loadingMore')}</span>
            </div>
          ) : null}
          {market.page.status === 'error' && market.items.length > 0 ? (
            <p className={cn('marketMore')}>
              <Button variant="ghost" size="sm" onClick={() => void loadMore()}>
                {t('market.moreFailed')}
              </Button>
            </p>
          ) : null}
          {market.page.status === 'done' && market.items.length > 0
            ? <p className={cn('marketMore', 'marketScope')}>{t('market.endOfList')}</p>
            : null}
          {emptyKind === null ? null : (
            <div className={cn('marketEmpty')}>
              <p className={cn('marketEmptyTitle')}>{emptyCopy.title}</p>
              {emptyCopy.hint === null ? null : <p className={cn('marketScope')}>{emptyCopy.hint}</p>}
              {emptyCopy.action === null ? null : (
                <Button variant="outline" size="sm" onClick={emptyCopy.action.run}>
                  {emptyCopy.action.label}
                </Button>
              )}
            </div>
          )}
        </Fragment>
      )}
      {confirmItem === null ? null : (
        <MarketConfirm
          item={confirmItem}
          market={market}
          detail={market.detail !== null && market.detail.id === confirmId ? market.detail : null}
          t={t}
          onCancel={() => store.actions.marketInstallCancel(confirmId)}
          onConfirm={(item) => void confirmInstall(item)}
        />
      )}
    </section>
  );
}
