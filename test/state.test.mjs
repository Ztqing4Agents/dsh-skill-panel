/**
 * `src/client/state.js` — the page store that outlives the page.
 *
 * Contract: docs/contracts/client.md §3.5 (state machine, store scope) and §3.9.3 (the
 * market sub-state's 30 actions; the bookmark write side was removed in U5 - see
 * docs/contracts/decisions.md appendix L - and only the read side is left); case ids K45,
 * K105 (a filter change keeps `items`, M10) and K108 (the four fields the landing paint
 * effect depends on, see §3.9.1 "落点").
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createStore } from '../src/client/state.js';

/**
 * A payload with two rows, one of them already off.
 * @returns {object} ListPayload.
 */
function payload() {
  return {
    groups: [
      { key: 'builtin', skills: [] },
      { key: 'local', skills: [{ name: 'a', provider: 'filesystem', enabled: true }] },
      { key: 'installed', skills: [{ name: 'b', provider: 'filesystem', enabled: false }] },
    ],
    counts: { total: 2, disabled: 1, excluded: 0 },
    complete: true,
    diagnostics: [],
    cwd: '/work',
  };
}

test('初始状态：默认页签是已安装，状态 idle，没有 payload', () => {
  const store = createStore();
  const state = store.getSnapshot();
  assert.equal(state.tab, 'installed', '默认页签是已安装');
  assert.equal(state.status, 'idle', '初始状态是 idle');
  assert.equal(state.payload, null, '初始没有 payload');
  assert.equal(state.error, null, '初始没有错误');
  assert.equal(state.rows.size, 0, '初始没有行级状态');
  assert.equal(state.notice, null, '初始没有提示');
});

test('状态机 idle → loading → ready', () => {
  const store = createStore();
  store.actions.loading();
  assert.equal(store.getSnapshot().status, 'loading', 'loading 之后状态是 loading');
  store.actions.ready(payload());
  assert.equal(store.getSnapshot().status, 'ready', 'ready 之后状态是 ready');
  assert.equal(store.getSnapshot().payload.counts.total, 2, 'payload 被保留');
});

test('首次失败：状态是 error 并带上错误码', () => {
  const store = createStore();
  store.actions.loading();
  store.actions.failed({ code: 'E_FORBIDDEN', message: 'loopback only' });
  const state = store.getSnapshot();
  assert.equal(state.status, 'error', '失败后状态是 error');
  assert.equal(state.error.code, 'E_FORBIDDEN', '错误码被保留');
});

test('刷新失败：保留 payload，只加一条提示', () => {
  const store = createStore();
  store.actions.ready(payload());
  store.actions.refreshFailed({ code: 'E_INTERNAL', message: 'boom' });
  const state = store.getSnapshot();
  assert.equal(state.status, 'ready', '刷新失败后仍是 ready（列表还在）');
  assert.equal(state.payload.counts.total, 2, '列表内容保留');
  assert.equal(state.notice.kind, 'refresh-failed', '提示种类是 refresh-failed');
  assert.equal(state.notice.seq, 1, '第一条提示的序号是 1');
});

test('提示序号自增，且只丢弃当前那一条', () => {
  const store = createStore();
  store.actions.ready(payload());
  store.actions.refreshFailed({ code: 'E_INTERNAL', message: 'one' });
  store.actions.refreshFailed({ code: 'E_INTERNAL', message: 'two' });
  assert.equal(store.getSnapshot().notice.seq, 2, '第二次提示的序号是 2');
  store.actions.dismissNotice(1);
  assert.equal(store.getSnapshot().notice.seq, 2, '过期的序号不会关掉新提示');
  store.actions.dismissNotice(2);
  assert.equal(store.getSnapshot().notice, null, '当前那条被关掉');
});

test('不做乐观 UI：写入中不改 enabled，成功才改', () => {
  const store = createStore();
  store.actions.ready(payload());
  const key = 'filesystem#a';
  store.actions.pending(key);
  const pendingRow = store.getSnapshot().payload.groups[1].skills[0];
  assert.equal(pendingRow.enabled, true, '写入中该行仍是旧值');
  assert.equal(store.getSnapshot().rows.get(key).pending, true, '该行标记为 pending');

  store.actions.commit(key, false);
  const committed = store.getSnapshot().payload.groups[1].skills[0];
  assert.equal(committed.enabled, false, '成功后该行是新值');
  assert.deepEqual(store.getSnapshot().payload.counts, { total: 2, disabled: 2, excluded: 0 }, '停用计数被重算');
  assert.equal(store.getSnapshot().rows.has(key), false, '成功后该行的运行时状态被清掉');
});

test('失败保留旧值并把原因留在行上', () => {
  const store = createStore();
  store.actions.ready(payload());
  const key = 'filesystem#a';
  store.actions.pending(key);
  store.actions.fail(key, '软链技能只读，未做任何修改');
  const state = store.getSnapshot();
  assert.equal(state.payload.groups[1].skills[0].enabled, true, '失败后该行仍是旧值');
  assert.equal(state.rows.get(key).reason, '软链技能只读，未做任何修改', '原因被记在行上');
  assert.equal(state.rows.get(key).pending, false, '该行不再是写入中');
});

test('payload 为 null 时 commit 不抛错', () => {
  const store = createStore();
  store.actions.commit('filesystem#a', false);
  assert.equal(store.getSnapshot().payload, null, '没有 payload 时提交是空操作');
});

test('setTab 改变页签，且同一 store 再次读取仍是那个页签', () => {
  const store = createStore();
  store.actions.setTab('market');
  assert.equal(store.getSnapshot().tab, 'market', '页签切到市场');
  assert.equal(store.getSnapshot().tab, 'market', '再读仍是市场（状态保存在 store 里）');
});

test('订阅者在每次变更时被通知，退订后不再通知', () => {
  const store = createStore();
  let calls = 0;
  const unsubscribe = store.subscribe(() => { calls += 1; });
  store.actions.loading();
  store.actions.ready(payload());
  assert.equal(calls, 2, '两次变更通知两次');
  unsubscribe();
  store.actions.setTab('market');
  assert.equal(calls, 2, '退订后不再通知');
});

test('每次 createStore 都是独立实例（页面重建不共享行状态）', () => {
  const first = createStore();
  const second = createStore();
  first.actions.pending('filesystem#a');
  assert.equal(first.getSnapshot().rows.size, 1, '第一个实例记下了行状态');
  assert.equal(second.getSnapshot().rows.size, 0, '第二个实例没有那条行状态');
});

/* ------------------------------------------------------------------ market */

/** A market item with the fields the store reads. */
function marketItem(id, sourceId = 'skillhub') {
  return {
    sourceId,
    id,
    owner: 'ake',
    slug: id.split(':').at(-1),
    displayName: id,
    summary: '',
    author: null,
    version: null,
    downloads: null,
    updatedAt: null,
    category: null,
    packageKind: 'files',
  };
}

test('K45 初始 market 子状态：默认「所有来源 / 默认排序 / 未筛分类」，什么都没加载', () => {
  const market = createStore().getSnapshot().market;
  // U8：与站点一致，默认是「所有来源」（不传上游 source），排序默认仍是 score。
  assert.deepEqual(market.filters, { source: 'all', category: null, sort: 'recommended' }, '默认筛选与设计一致');
  assert.equal(market.bootScope, '', '还没有哪一档的计数');
  assert.equal(market.categoriesLoading, false, '没有在等计数');
  assert.equal(market.total, null, 'bootstrap 之前没有总数');
  assert.equal(market.countsOk, true, '计数默认可用（没数就不渲染，但不用报错态）');
  assert.equal(market.boot, 'idle', 'bootstrap 还没发');
  assert.equal(market.listStatus, 'idle', '列表还没请求');
  assert.deepEqual(market.items, [], '没有卡片');
  assert.equal(market.detail, null, '没有打开的详情');
  assert.equal(market.pages, 0, '一页都没加载');
  assert.deepEqual(market.cursors, {}, '没有游标');
  assert.equal(market.installedReady, false, '台账还没读');
  assert.equal(market.scrollTop, 0, '滚动位置 0');
  assert.equal(market.installedDirty, false, '没有「刚装完」标记');
});

test('K45 marketSetFilter 过滤空操作：同一个值再设一次不产生新快照（不会白重拉一页）', () => {
  const store = createStore();
  const before = store.getSnapshot().market;
  store.actions.marketSetFilter({ source: 'all' });
  assert.equal(store.getSnapshot().market, before, '值没变 ⇒ 状态对象不变（引用相等）');
  store.actions.marketSetFilter({ source: 'skillhub' });
  assert.equal(store.getSnapshot().market.filters.source, 'skillhub', '换 scope 生效');
  assert.equal(store.getSnapshot().market.categoriesLoading, true, '切 scope 先让 chips 进骨架（卡片不动）');
  const reset = store.getSnapshot().market;
  store.actions.marketSetFilter(null);
  assert.equal(store.getSnapshot().market, reset, '非对象入参被忽略');
  store.actions.marketSetFilter({ source: 'clawhub', sort: 'updated' });
  const changed = store.getSnapshot().market;
  assert.equal(changed.filters.source, 'clawhub', '改变来源生效');
  assert.equal(changed.categoriesLoading, true, '切 scope ⇒ 计数待补');
  assert.equal(changed.filters.sort, 'updated', '同一补丁里的排序也生效');
  assert.deepEqual(changed.items, [], '换筛选后旧结果被清空（属于旧查询）');
  assert.equal(changed.pages, 0, '分页从头再来');
  assert.equal(changed.detail, null, '换筛选会关掉详情');
});

test('K45 marketCommitKeyword：关键词落定、输入框同步、分页重置但列表先留着（不闪骨架）', () => {
  const store = createStore();
  store.actions.marketPageAppended({
    pages: [{ sourceId: 'skillhub', page: { items: [marketItem('skillhub:ake:a')], next: 'c2' } }],
    merged: [marketItem('skillhub:ake:a')],
  });
  store.actions.marketSetInput('ui');
  assert.equal(store.getSnapshot().market.keyword, '', '输入还不算关键词（等防抖/回车）');
  store.actions.marketCommitKeyword('ui');
  const market = store.getSnapshot().market;
  assert.equal(market.keyword, 'ui', '关键词落定');
  assert.equal(market.input, 'ui', '输入框与关键词同步');
  assert.equal(market.pages, 0, '分页重置');
  assert.deepEqual(market.cursors, {}, '游标清空');
  assert.equal(market.listStatus, 'ready', '列表状态保持 ready（旧内容还在屏幕上，不闪骨架）');
  assert.equal(market.items.length, 1, '旧结果暂留');
});

test('K45 marketReload：只清分页与详情、列表留在屏幕上（页头刷新按钮走这条路）', () => {
  const store = createStore();
  store.actions.marketPageAppended({
    pages: [{ sourceId: 'skillhub', page: { items: [marketItem('skillhub:ake:a')], next: 'c2' } }],
    merged: [marketItem('skillhub:ake:a')],
  });
  store.actions.marketDetailOpen(marketItem('skillhub:ake:a'));
  const before = store.getSnapshot().market;
  store.actions.marketReload();
  const market = store.getSnapshot().market;
  // U13：卡片不再是「消失—骨架—重来」，重取期间旧列表直出（整页高度与滚动位置不动）。
  assert.deepEqual(market.items, [marketItem('skillhub:ake:a')], '卡片留着（重取期间不换骨架）');
  assert.equal(market.items, before.items, '同一个数组引用：卡片不重挂，滚动位置不被甩回顶部');
  assert.equal(market.listStatus, 'ready', '列表仍是 ready（有 items 就 ready，面板不切骨架）');
  assert.equal(market.detail, null, '详情关闭');
  // 「从头再来」的语义仍只落在分页与尾部上——这三条不许被放宽掉。
  assert.equal(market.pages, 0, '分页重置');
  assert.deepEqual(market.cursors, {}, '游标清空（下一次是第一页）');
  assert.deepEqual(market.exhausted, {}, '耗尽标记清空');
  assert.equal(market.page.status, 'idle', '尾部回 idle（重取第一页不是「追加」）');

  // 空列表上刷新（首屏失败后重试那条路）：没有 items 可留 ⇒ 仍回 idle，由面板 effect 重拉。
  store.actions.marketListFailed({ code: 'E_SOURCE_TIMEOUT', message: 't' });
  store.actions.marketReload();
  assert.equal(store.getSnapshot().market.listStatus, 'idle', '空列表刷新回 idle（effect 据此重拉第一页）');
  assert.equal(store.getSnapshot().market.pages, 0, '分页仍是 0');
});

test('K45 marketListFailed 与 marketPageFailed 语义不同：前者清列表，后者保留已加载卡片', () => {
  const store = createStore();
  store.actions.marketListLoading();
  store.actions.marketListFailed({ code: 'E_SOURCE_TIMEOUT', message: 't' });
  let market = store.getSnapshot().market;
  assert.equal(market.listStatus, 'error', '第一页全失败 ⇒ listStatus=error');
  assert.deepEqual(market.items, [], '第一页失败没有卡片');
  assert.equal(market.page.code, 'E_SOURCE_TIMEOUT', '错误码留在 page 上');

  store.actions.marketPageAppended({
    pages: [{ sourceId: 'skillhub', page: { items: [marketItem('skillhub:ake:a')], next: 'c2' } }],
    merged: [marketItem('skillhub:ake:a')],
  });
  store.actions.marketPageStart();
  store.actions.marketPageFailed({ code: 'E_SOURCE_UNAVAILABLE', message: 'down' });
  market = store.getSnapshot().market;
  assert.equal(market.items.length, 1, '追加失败不影响已加载卡片');
  assert.equal(market.listStatus, 'ready', '整页仍然是 ready');
  assert.equal(market.page.status, 'error', '失败挂在尾部');
});

test('K45 marketInstalledLoaded：台账缺失时给空表且标记 ready（界面不会一直转圈）', () => {
  const store = createStore();
  store.actions.marketInstalledLoaded(null);
  assert.deepEqual(store.getSnapshot().market.installed, {}, '非对象入参归一成空表');
  assert.equal(store.getSnapshot().market.installedReady, true, '读过一次就不再重复读');
});

test('K45 详情四步：打开→就绪→失败→关闭，关闭后列表与游标不受影响', () => {
  const store = createStore();
  const a = marketItem('skillhub:ake:a');
  store.actions.marketPageAppended({
    pages: [{ sourceId: 'skillhub', page: { items: [a], next: 'c2' } }],
    merged: [a],
  });
  const before = store.getSnapshot().market;
  store.actions.marketDetailOpen(a);
  assert.equal(store.getSnapshot().market.detail.id, 'skillhub:ake:a', '详情以市场键标识');
  assert.equal(store.getSnapshot().market.detail.status, 'loading', '打开时是 loading（先给壳再填内容）');
  store.actions.marketDetailReady({ item: a, overview: 'x', files: [] });
  assert.equal(store.getSnapshot().market.detail.status, 'ready', '就绪');
  store.actions.marketDetailFailed({ code: 'E_SOURCE_TIMEOUT', message: 't' });
  assert.equal(store.getSnapshot().market.detail.status, 'error', '失败后仍停在详情（返回可用）');
  store.actions.marketDetailClose();
  const after = store.getSnapshot().market;
  assert.equal(after.detail, null, '关闭后没有详情');
  assert.equal(after.items.length, 1, '返回后列表还在（不重新拉）');
  assert.equal(after.cursors.skillhub, 'c2', '返回后游标还在（已加载页数不丢）');
  assert.equal(after.pages, before.pages, '返回后页数不变');

  store.actions.marketDetailReady({ item: a });
  assert.equal(store.getSnapshot().market.detail, null, '没有打开的详情时，迟到的响应不会凭空造一个');
});

test('K45 安装四步：确认→开始（幂等）→成功→失败；成功会标脏已安装页签并写 toast', () => {
  const store = createStore();
  const id = 'skillhub:ake:a';
  store.actions.marketInstallConfirm(id);
  assert.equal(store.getSnapshot().market.installs[id].state, 'confirm', '先弹确认，不发请求');
  store.actions.marketInstallCancel(id);
  assert.equal(id in store.getSnapshot().market.installs, false, '取消后该卡的安装状态被删掉');
  store.actions.marketInstallCancel(id);
  assert.equal(id in store.getSnapshot().market.installs, false, '重复取消也不抛');

  store.actions.marketInstallConfirm(id);
  store.actions.marketInstallStart(id);
  const firstSeq = store.getSnapshot().market.installs[id].seq;
  store.actions.marketInstallStart(id);
  assert.equal(store.getSnapshot().market.installs[id].seq, firstSeq, '连点两次只发一次（幂等）');
  assert.equal(store.getSnapshot().market.installs[id].state, 'installing', '状态是 installing');

  store.actions.marketInstallOk(id, { name: 'a', path: '/skills/a', version: '1.0.0' });
  let market = store.getSnapshot().market;
  assert.equal(market.installs[id].state, 'installed', '成功后卡片变已安装');
  assert.equal(market.installed[id].exists, true, '台账视图同步标记存在');
  assert.equal(market.installedDirty, true, '已安装页签标脏（切回去要重读）');
  // 顶层 notice（toast 读的那个字段）见 K46：本轮实现把它写进了 market 子状态，
  // 与 client.md §3.9.3「推 notice{kind:'install-ok'}」不符，已作为缺陷单交回。
  store.actions.marketClearInstalledDirty();
  assert.equal(store.getSnapshot().market.installedDirty, false, '重读之后脏标记清掉');

  store.actions.marketInstallFail(id, '名字被占用');
  market = store.getSnapshot().market;
  assert.equal(market.installs[id].state, 'failed', '失败后卡片可重试');
  assert.equal(market.installs[id].reason, '名字被占用', '失败原因留在卡片上');
});

test('K45 marketSetScroll：只记正的有限数，详情返回时用它回到原位', () => {
  const store = createStore();
  store.actions.marketSetScroll(420);
  assert.equal(store.getSnapshot().market.scrollTop, 420, '记录滚动偏移');
  store.actions.marketSetScroll(-5);
  assert.equal(store.getSnapshot().market.scrollTop, 0, '负数归一成 0');
  store.actions.marketSetScroll(Number.NaN);
  assert.equal(store.getSnapshot().market.scrollTop, 0, '非数归一成 0');
});

test('K45 marketBootFallback：bootstrap 失败不是错误态，用内置来源继续', () => {
  const store = createStore();
  store.actions.marketBootLoading();
  store.actions.marketBootFallback([{ id: 'skillhub' }, { id: 'clawhub' }]);
  const market = store.getSnapshot().market;
  assert.equal(market.boot, 'ready', '仍然算 boot 完成（不卡在 loading）');
  assert.equal(market.sources.length, 2, '用兜底来源继续');
  assert.deepEqual(market.categories, [], '没有分类表');
  assert.equal(market.categoriesOk, false, '分类行显示不可用');
});

test('K45 单源：那一次请求失败就是整页失败（不再有 sourceErrors 这条通道）', () => {
  // 单源之后「一半成功一半失败」的状态不存在了：`errors` 入参没人再传，
  // `sourceErrors` 字段与「部分源失败」提示条一起删掉了（K38 同步改了口径）。
  const store = createStore();
  store.actions.marketListLoading();
  store.actions.marketPageAppended({
    pages: [{ sourceId: 'skillhub', page: { items: [marketItem('skillhub:ake:a')], next: null } }],
    merged: [marketItem('skillhub:ake:a')],
  });
  const ok = store.getSnapshot().market;
  assert.equal(ok.listStatus, 'ready', '成功 ⇒ ready');
  assert.equal(ok.items.length, 1, '卡片上屏');
  // 注意：`marketListLoading` 里还留着 `sourceErrors: []` 一行死写入（没有读者、界面也不读），
  // 属 cosmetic 残留（报告 KI-R4-1，Engineer 一行可删）。所以这里不钉「字段不存在」，
  // 只钉「没有语义」——界面不再因为它有任何表现。
  assert.deepEqual(ok.sourceErrors ?? [], [], '没有读者，恒为空数组（无论有没有这一行）');

  store.actions.marketListLoading();
  store.actions.marketListFailed({ code: 'E_SOURCE_TIMEOUT', message: 'timeout' });
  const failed = store.getSnapshot().market;
  assert.equal(failed.listStatus, 'error', '唯一那个源失败 ⇒ 整页 error 态');
  assert.equal(failed.page.code, 'E_SOURCE_TIMEOUT', '错误码留在 page 上（界面据此选文案）');
});

test('K45 市场子状态的 action 数量是可核对的：收藏只剩读侧一个', () => {
  const store = createStore();
  const names = Object.keys(store.actions);
  const market = names.filter((name) => name.startsWith('market'));
  assert.equal(market.length, 30, '市场子状态共 30 个 action（U5 撤掉写侧 3 个）');
  assert.equal(market.includes('marketFavoritesLoaded'), true, '读侧 action 仍在（bootstrap 仍下发收藏）');
  for (const gone of ['marketFavoriteToggle', 'marketFavoriteOk', 'marketFavoriteFail']) {
    assert.equal(market.includes(gone), false, `${gone} 已随卡片上的收藏开关一起撤除`);
  }
  assert.equal(names.every((name) => typeof store.actions[name] === 'function'), true, '每个 action 都是函数');
});

test('K45 初始收藏状态：空集、可用（读侧还在，但没有代次这一层了）', () => {
  const market = createStore().getSnapshot().market;
  assert.deepEqual(market.favorites, {}, '没有收藏');
  assert.equal(market.favoritesOk, true, '缺省当作可用（bootstrap 说了才算）');
  assert.equal('favoritesGen' in market, false, 'U5 撤掉写侧后不再有防乱序代次');
});

test('K45 marketFavoritesLoaded：数组变布尔映射，非数组/坏条目一律丢', () => {
  const store = createStore();
  store.actions.marketFavoritesLoaded(['skillhub:ake:dev-god', 'clawhub:ivan:design', '', 42], true);
  assert.deepEqual(
    store.getSnapshot().market.favorites,
    { 'skillhub:ake:dev-god': true, 'clawhub:ivan:design': true },
    '只收非空字符串',
  );
  assert.equal(store.getSnapshot().market.favoritesOk, true, 'ok 透传');

  store.actions.marketFavoritesLoaded(null, false);
  assert.deepEqual(store.getSnapshot().market.favorites, {}, '非数组 ⇒ 空集（不是崩溃）');
  assert.equal(store.getSnapshot().market.favoritesOk, false, 'ok=false 说明 Host 没读到文件');
});

test('K45 reload / boot 兜底都不动收藏，也不把 favoritesOk 置 true', () => {
  const store = createStore();
  store.actions.marketFavoritesLoaded(['skillhub:ake:dev-god'], false);
  const favorites = store.getSnapshot().market.favorites;

  store.actions.marketReload();
  assert.equal(store.getSnapshot().market.favorites, favorites, 'reload 只清分页与详情，但不碰收藏（收藏不是缓存）');
  assert.equal(store.getSnapshot().market.favoritesOk, false, '也不顺手把可用性改成 true');

  store.actions.marketBootFallback([{ id: 'skillhub', labelKey: 'market.source.skillhub', hasCategories: true, packageKind: 'files' }]);
  assert.equal(store.getSnapshot().market.favorites, favorites, 'bootstrap 失败兜底同样不清收藏');
  assert.equal(store.getSnapshot().market.favoritesOk, false, '也不虚报可用');
});


// ---------------------------------------------------------------------------
// M10 — 切筛选（来源 / 分类 / 排序）不再清空列表。与 U13 同一条判据：`clearedPaging`
// 按「有 items 就 ready」给 `listStatus`，面板据此保留旧卡；分页与详情照旧从头再来。
// ---------------------------------------------------------------------------

test('K105 marketSetFilter 的三条路径都保留列表、只清分页（M10）', () => {
  const items = [marketItem('skillhub:ake:a'), marketItem('skillhub:ake:b')];
  const seeded = () => {
    const store = createStore();
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'all', page: { items, next: 'c2' } }],
      merged: items,
    });
    store.actions.marketDetailOpen(items[0]);
    return store;
  };

  // 三条筛选路径各自的补丁，以及只有它才该有的副作用。
  const paths = [
    ['换来源', { source: 'clawhub' }, { categoriesLoading: true }],
    ['换分类', { category: 'dev-tools' }, { categoriesLoading: false }],
    ['换排序', { sort: 'downloads' }, { categoriesLoading: false }],
  ];
  for (const [label, patch, extra] of paths) {
    const store = seeded();
    const before = store.getSnapshot().market;
    store.actions.marketSetFilter(patch);
    const after = store.getSnapshot().market;
    assert.deepEqual(after.filters, { ...before.filters, ...patch }, `${label}：筛选值落定`);
    // 这条是与旧行为唯一的分歧点：旧语义是 items 清空、listStatus 回 idle。
    assert.equal(after.items, before.items, `${label}：卡片留在屏幕上（同一数组引用，不重挂）`);
    assert.equal(after.items.length, 2, `${label}：数量不变`);
    assert.equal(after.listStatus, 'ready', `${label}：listStatus 仍是 ready（不切骨架）`);
    // 「从头再来」仍落在分页与详情上——这几条不许被放宽掉。
    assert.equal(after.pages, 0, `${label}：分页归零`);
    assert.deepEqual(after.cursors, {}, `${label}：游标清空（下一次是第一页）`);
    assert.deepEqual(after.exhausted, {}, `${label}：耗尽标记清空`);
    assert.equal(after.page.status, 'idle', `${label}：尾部回 idle`);
    assert.equal(after.detail, null, `${label}：详情关闭`);
    // 只有换 scope 才需要重读计数；同 scope 内换分类/排序不碰 chips。
    assert.equal(after.categoriesLoading, extra.categoriesLoading, `${label}：categoriesLoading 只在换 scope 时置位`);

    // 面板紧接着发的第一页请求：列表还在，所以骨架判据（loading + 空列表）不成立。
    store.actions.marketListLoading();
    const loading = store.getSnapshot().market;
    assert.equal(loading.listStatus, 'loading', `${label}：请求在飞`);
    assert.equal(loading.items.length, 2, `${label}：请求在飞时旧卡还在（判据 loading && items.length === 0 不成立）`);
  }

  // 值没变就什么都不做（既有语义，别因为这次改动被顺手改掉）。
  const store = seeded();
  const untouched = store.getSnapshot().market;
  store.actions.marketSetFilter({ source: 'all' });
  store.actions.marketSetFilter({ category: null });
  store.actions.marketSetFilter({ sort: 'recommended' });
  assert.equal(store.getSnapshot().market, untouched, '三个筛选都是原值时状态对象一动不动');
});

test('K108 落点键只被筛选与搜索改动：刷新 / 翻页 / 加载态 / 详情往返 / 滚动都不动它', () => {
  // 面板的 paint effect 以 `source|category|sort|keyword` 为依赖（client.md §3.9.1「落点」）：
  // 键不变就不写 scrollTop，所以「刷新保住原位置」正是靠这四条字段不被别的动作碰到。
  const keyOf = (market) => `${market.filters.source}|${market.filters.category}|${market.filters.sort}|${market.keyword}`;
  const store = createStore();
  const items = [marketItem('skillhub:ake:a')];
  store.actions.marketPageAppended({ pages: [{ sourceId: 'all', page: { items, next: 'c2' } }], merged: items });
  store.actions.marketSetScroll(300);
  const key = keyOf(store.getSnapshot().market);
  assert.equal(key, 'all|null|recommended|', '键的构成：四条查询输入，默认值也参与');

  const untouched = [
    ['页头刷新（U13：保住原位置）', () => store.actions.marketReload()],
    ['第一页请求在飞', () => store.actions.marketListLoading()],
    ['追加请求在飞', () => store.actions.marketPageStart()],
    ['一页答案落地', () => store.actions.marketPageAppended({
      pages: [{ sourceId: 'all', page: { items, next: null } }],
      merged: items,
    })],
    ['打开详情', () => store.actions.marketDetailOpen(items[0])],
    ['详情答案落地', () => store.actions.marketDetailReady({ item: items[0] })],
    ['关闭详情', () => store.actions.marketDetailClose()],
    ['记滚动位置', () => store.actions.marketSetScroll(120)],
    ['装完一页（安装态）', () => store.actions.marketInstallOk('skillhub:ake:a', { name: 'a', version: null, path: '/tmp/a' })],
  ];
  for (const [label, act] of untouched) {
    act();
    assert.equal(keyOf(store.getSnapshot().market), key, `${label}：键不变（不会把位置写回顶部）`);
  }

  // 只有「换了一个查询」才变——这才是落点回到第一张卡的时刻。
  store.actions.marketSetFilter({ category: 'dev-tools' });
  assert.equal(keyOf(store.getSnapshot().market), 'all|dev-tools|recommended|', '换分类改键');
  store.actions.marketCommitKeyword('pdf');
  assert.equal(keyOf(store.getSnapshot().market), 'all|dev-tools|recommended|pdf', '搜索改键');
  store.actions.marketSetFilter({ source: 'clawhub', sort: 'stars' });
  assert.equal(keyOf(store.getSnapshot().market), 'clawhub|dev-tools|stars|pdf', '换来源与排序同时改键');
});

/* --------------------------------------------- K111 · 已安装详情：就地替换、返回不重拉 */

/** One installed row, as the payload carries it. */
function detailRow(overrides = {}) {
  return {
    name: 'ui-design',
    provider: 'filesystem',
    partition: 'installed',
    description: 'UI design skill.',
    symlink: false,
    path: '/skills/ui-design/SKILL.md',
    realPath: null,
    enabled: true,
    writable: true,
    readonlyReason: null,
    upstream: null,
    version: null,
    ...overrides,
  };
}

test('K111 openDetail：只挂详情态，payload 与市场子状态一字不动', () => {
  const store = createStore();
  store.actions.ready(payload());
  const before = store.getSnapshot();
  const target = detailRow();

  store.actions.openDetail(target);

  const after = store.getSnapshot();
  assert.deepEqual(after.detail, { key: 'filesystem#ui-design', status: 'loading', data: null, code: null }, '详情是 loading 三态之一，键是 provider#name');
  assert.equal(after.payload, before.payload, 'payload 引用不变（打开详情不重拉 list）');
  assert.equal(after.market, before.market, '市场子状态引用不变');
  assert.equal(after.status, before.status, '列表的加载状态也不动');
});

test('K111 rememberDetailScroll：只记正的有限数，打开前调一次', () => {
  const store = createStore();
  assert.equal(store.getSnapshot().detailScrollTop, 0, '初始是 0');
  store.actions.rememberDetailScroll(300);
  assert.equal(store.getSnapshot().detailScrollTop, 300, '记下 300');
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, '300', null, undefined]) {
    store.actions.rememberDetailScroll(bad);
    assert.equal(store.getSnapshot().detailScrollTop, 0, `${String(bad)} 一律归 0（不是可用的像素偏移）`);
  }
  store.actions.rememberDetailScroll(228.5);
  assert.equal(store.getSnapshot().detailScrollTop, 228.5, '小数偏移照记（浏览器的 scrollTop 就是小数）');
});

test('K111 detailReady / detailFailed / detailLoading 只认自己的 key：晚到的旧响应被丢', () => {
  const store = createStore();
  store.actions.ready(payload());
  store.actions.openDetail(detailRow());
  store.actions.detailReady('filesystem#ui-design', { body: 'text' });
  assert.equal(store.getSnapshot().detail.status, 'ready', '自己的 key 就落地');
  assert.deepEqual(store.getSnapshot().detail.data, { body: 'text' }, '数据落地');

  // 用户已经换成另一个技能：上一个请求的答案晚到，不能覆盖当前详情。
  const before = store.getSnapshot().detail;
  store.actions.detailReady('filesystem#some-other', { body: 'stale' });
  assert.equal(store.getSnapshot().detail, before, '别人的 key 落地不了（引用都不换）');
  store.actions.detailFailed('filesystem#some-other', { code: 'E_INTERNAL' });
  assert.equal(store.getSnapshot().detail, before, '别人的 key 也改不坏它');
  store.actions.detailLoading('filesystem#some-other');
  assert.equal(store.getSnapshot().detail, before, '别人的 key 更不能把它打回加载中');

  // 关闭之后，还在飞的答案同样落不下来。
  store.actions.closeDetail();
  const closed = store.getSnapshot().detail;
  assert.equal(closed, null, '关闭后 detail 是 null');
  store.actions.detailReady('filesystem#ui-design', { body: 'late' });
  assert.equal(store.getSnapshot().detail, null, '关闭后晚到的答案不会把详情又打开');
});

test('K111 detailFailed：失败只在详情里留错误码，列表与行状态都不受影响', () => {
  const store = createStore();
  store.actions.ready(payload());
  const before = store.getSnapshot();
  store.actions.openDetail(detailRow());
  store.actions.detailFailed('filesystem#ui-design', { code: 'E_INTERNAL', message: 'boom' });
  const after = store.getSnapshot();
  assert.equal(after.detail.status, 'error', '状态变 error');
  assert.equal(after.detail.code, 'E_INTERNAL', '错误码被保留');
  assert.equal(after.payload, before.payload, 'payload 引用不变');
  assert.equal(after.status, 'ready', '列表自己的状态仍是 ready（不是整页失败）');
  assert.equal(after.rows.size, 0, '不往行级状态里塞东西（失败原因属于详情）');
});

test('K111 closeDetail：detail 变 null 而 payload 引用不变（返回不重拉 list）', () => {
  const store = createStore();
  store.actions.ready(payload());
  store.actions.rememberDetailScroll(300);
  store.actions.openDetail(detailRow());
  store.actions.detailReady('filesystem#ui-design', { body: 'text' });
  const list = store.getSnapshot().payload;

  store.actions.closeDetail();

  const after = store.getSnapshot();
  assert.equal(after.detail, null, '详情关掉了');
  assert.equal(after.payload, list, 'payload 引用不变（返回不重拉 list）');
  assert.equal(after.detailScrollTop, 300, '偏移留着，页面的 paint effect 据此写回');
  store.actions.closeDetail();
  assert.equal(store.getSnapshot().detail, null, '已经关了再关一次是空操作');
});

test('K111 切页签：detail 留在 store 里，切回来还在详情', () => {
  const store = createStore();
  store.actions.ready(payload());
  store.actions.openDetail(detailRow());
  store.actions.detailReady('filesystem#ui-design', { body: 'text' });
  store.actions.setTab('market');
  assert.equal(store.getSnapshot().detail.status, 'ready', '切到市场页签不关详情');
  store.actions.setTab('installed');
  assert.equal(store.getSnapshot().detail.status, 'ready', '切回来仍是同一份正文');
  assert.equal(store.getSnapshot().detail.key, 'filesystem#ui-design', '还是同一个技能的详情');
});

/* ------------- 两级返回：closeDetail 只退一级（本轮） ------------- */

/** One builtin row for the navigation tests. */
const builtinRow = { name: 'sheet', provider: 'univer', partition: 'builtin', path: null, writable: false, readonlyReason: 'provider-store', enabled: true };

test('两级返回：openPlugin 记 provider；openDetail 不清它；closeDetail 只退一级', () => {
  const store = createStore();
  store.actions.ready(payload());
  store.actions.openPlugin('univer');
  assert.equal(store.getSnapshot().pluginDetail, 'univer', '先进插件页');

  store.actions.openDetail(builtinRow);
  assert.equal(store.getSnapshot().detail.key, 'univer#sheet', '再进技能详情');
  assert.equal(store.getSnapshot().pluginDetail, 'univer', '插件页在下面留着（返回要回到它）');

  store.actions.closeDetail();
  assert.equal(store.getSnapshot().detail, null, '退一级：技能详情关掉');
  assert.equal(store.getSnapshot().pluginDetail, 'univer', '插件页还在（不是直接回列表）');
});

test('两级返回：closePlugin 才回列表；两层都关干净时 detail 与 pluginDetail 都是 null', () => {
  const store = createStore();
  store.actions.ready(payload());
  store.actions.openPlugin('univer');
  store.actions.closePlugin();
  assert.equal(store.getSnapshot().pluginDetail, null, '插件页关掉，回到列表');

  // 从列表直接开技能详情（没有插件页）：closeDetail 一次就回列表。
  store.actions.openDetail(builtinRow);
  assert.equal(store.getSnapshot().pluginDetail, null, '没有插件页');
  store.actions.closeDetail();
  assert.equal(store.getSnapshot().detail, null, '一次就回到列表');
});

test('插件页的滚动偏移单独记：rememberPluginScroll 与 rememberDetailScroll 互不覆盖', () => {
  const store = createStore();
  store.actions.ready(payload());
  store.actions.rememberDetailScroll(300);
  store.actions.rememberPluginScroll(120);
  assert.equal(store.getSnapshot().detailScrollTop, 300, '列表的偏移还在');
  assert.equal(store.getSnapshot().pluginScrollTop, 120, '插件页的偏移单独存');
  store.actions.rememberPluginScroll(0);
  assert.equal(store.getSnapshot().pluginScrollTop, 0, '回到顶部记 0');
});

/* ------------- 进技能页签即复位（本轮） ------------- */

test('resetPage 清四个字段（detail / pluginDetail / 两级偏移），但不动 rows、payload 与检测缓存', () => {
  const store = createStore();
  store.actions.ready(payload());
  store.actions.openPlugin('univer');
  store.actions.openDetail(builtinRow);
  store.actions.detailReady('univer#sheet', { body: '正文', files: [], filesTruncated: false });
  // 检测答案是按 identity 常驻的会话缓存，不进 resetPage 的清理名单（U19 起没有单槽 check）。
  store.actions.checkStart(['skillhub:ake:dev-god']);
  store.actions.checkLanded([{
    key: 'skillhub:ake:dev-god', phase: 'ready', candidate: '1.2.4', at: 1000,
  }]);
  store.actions.checkFinish();
  store.actions.rememberDetailScroll(300);
  store.actions.rememberPluginScroll(120);
  store.actions.fail('univer#sheet', '写不进去');

  const before = store.getSnapshot();
  assert.notEqual(before.detail, null, '复位前有详情');
  assert.equal(before.rows.get('univer#sheet').reason, '写不进去', '复位前有一行的失败提示');

  store.actions.resetPage();
  const after = store.getSnapshot();
  assert.equal(after.detail, null, 'detail 清空');
  assert.equal(after.pluginDetail, null, 'pluginDetail 清空');
  assert.equal(after.detailScrollTop, 0, '列表偏移清零');
  assert.equal(after.pluginScrollTop, 0, '插件页偏移清零');
  assert.equal('check' in after, false, '旧单槽 check 已从 state 里删除（同一件事实不许两个真源）');
  assert.equal(after.checks['skillhub:ake:dev-god'].candidate, '1.2.4', '检测缓存不被 resetPage 清掉');
  assert.equal(after.checkRun.status, 'done', '轮次令牌也不受影响');
  assert.equal(after.rows.get('univer#sheet').reason, '写不进去', 'rows 不动（行内状态保留）');
  assert.equal(after.payload.groups.length, before.payload.groups.length, 'payload 不动');
});

/* --------------- K123 · updateApplied：一行换版本 + 该 identity 的结论就地翻成最新 --------------- */

/** An installed payload holding two copies of one identity at two versions. */
function twoCopiesPayload() {
  const upstream = { sourceId: 'skillhub', owner: 'ake', slug: 'dev-god' };
  return {
    groups: [
      { key: 'builtin', skills: [] },
      { key: 'local', skills: [] },
      {
        key: 'installed',
        skills: [
          { name: 'dev-god', provider: 'filesystem', partition: 'installed', rule: 'R7', upstream, version: '1.0.0', enabled: true },
          { name: 'dev-god-copy', provider: 'filesystem', partition: 'installed', rule: 'R7', upstream, version: '1.0.0', enabled: true },
          { name: 'other', provider: 'filesystem', partition: 'installed', rule: 'R7', version: '1.0.0', enabled: true },
        ],
      },
    ],
    counts: { total: 3, disabled: 0, excluded: 0 },
    complete: true,
    diagnostics: [],
    cwd: '/work',
  };
}

test('K123 updateApplied：版本 Tag 变 to、卡面结论就地成「最新」、只动被更新的那个目录', () => {
  const store = createStore();
  store.actions.ready(twoCopiesPayload());
  store.actions.checkLanded([{
    key: 'skillhub:ake:dev-god',
    phase: 'ready',
    candidate: '2.0.0',
    versions: [{ version: '2.0.0' }, { version: '1.0.0' }],
    total: 2,
    at: 1000,
  }]);

  store.actions.updateApplied({
    identity: 'skillhub:ake:dev-god',
    name: 'dev-god',
    path: '/skills/dev-god/SKILL.md',
    version: '2.0.0',
  });

  const snapshot = store.getSnapshot();
  const rows = snapshot.payload.groups.find((group) => group.key === 'installed').skills;
  assert.equal(rows[0].version, '2.0.0', '被更新的那一行版本变了（Tag 读的就是它）');
  assert.equal(rows[1].version, '1.0.0', '同 identity 的另一个目录仍在自己那个版本上（按 name 收窄）');
  assert.equal(rows[2].version, '1.0.0', '无关的行不动');

  const verdict = snapshot.checks['skillhub:ake:dev-god'];
  assert.equal(verdict.candidate, '2.0.0', '结论就地翻成 candidate = to（不再多花一次请求）');
  assert.equal(verdict.phase, 'ready', '仍是 ready');
  assert.equal(verdict.busy, false, '不残留 busy');
  assert.equal(verdict.total, 2, '之前的 versions / total 留着（展开列表还要用）');
  assert.equal(Number.isFinite(verdict.at), true, 'at 刷新成现在');

  assert.equal(snapshot.notice.kind, 'update-ok', '成功走既有 toast 座位，kind 是 update-ok');
  assert.equal(snapshot.notice.name, 'dev-god', 'toast 带名字');
  assert.equal(snapshot.notice.version, '2.0.0', 'toast 带新版本');
  assert.equal(snapshot.notice.path, '/skills/dev-god/SKILL.md', 'toast 带路径');
  assert.equal(snapshot.market.installedDirty, false, '不置 installedDirty：重扫由页面显式触发（避免扫两遍）');
});

test('K123 updateApplied：同名同版本时不动 payload（不制造新快照），坏输入被忽略', () => {
  const store = createStore();
  store.actions.ready(twoCopiesPayload());
  const before = store.getSnapshot().payload;
  store.actions.updateApplied({ identity: 'skillhub:ake:dev-god', name: 'dev-god', version: '1.0.0' });
  assert.equal(store.getSnapshot().payload, before, '版本没变就不重建 payload（同一个对象引用）');
  assert.equal(store.getSnapshot().checks['skillhub:ake:dev-god'].candidate, '1.0.0', '结论仍就地更新');

  const keep = store.getSnapshot();
  store.actions.updateApplied({ identity: '', name: 'dev-god', version: '3.0.0' });
  assert.equal(store.getSnapshot(), keep, 'identity 为空 ⇒ 整次调用忽略');
  store.actions.updateApplied({ identity: 'skillhub:ake:dev-god', name: 'dev-god', version: '' });
  assert.equal(store.getSnapshot(), keep, 'version 为空 ⇒ 整次调用忽略');
});

test('K123 checkStart / checkLanded / checkFinish：一轮的三步与幂等', () => {
  const store = createStore();
  assert.deepEqual(store.getSnapshot().checkRun, { id: 0, status: 'idle' }, '初始 idle');

  store.actions.checkStart(['skillhub:ake:dev-god', 'clawhub:ake:ui-design', '']);
  const started = store.getSnapshot();
  assert.equal(started.checkRun.status, 'running', '开轮 ⇒ running');
  assert.equal(started.checkRun.id, 1, '令牌自增');
  assert.equal(started.checks['skillhub:ake:dev-god'].phase, 'running', '新条目是 running');
  assert.equal(started.checks['skillhub:ake:dev-god'].busy, true, '目标行 busy');
  assert.equal('' in started.checks, false, '空 identity 被过滤');

  store.actions.checkLanded([
    { key: 'skillhub:ake:dev-god', phase: 'ready', candidate: '2.0.0', at: 2000 },
    null,
  ]);
  const landed = store.getSnapshot();
  assert.equal(landed.checks['skillhub:ake:dev-god'].phase, 'ready', '答案落进缓存');
  assert.equal(landed.checks['skillhub:ake:dev-god'].busy, false, '落地后 busy 收起');
  assert.equal(landed.checks['clawhub:ake:ui-design'].phase, 'running', '还没答的那行仍是 running');

  store.actions.checkFinish();
  assert.equal(store.getSnapshot().checkRun.status, 'done', '结束 ⇒ done');
  const after = store.getSnapshot();
  store.actions.checkFinish();
  assert.equal(store.getSnapshot(), after, 'checkFinish 幂等（不制造新快照）');

  store.actions.checkStart(['skillhub:ake:dev-god']);
  assert.equal(store.getSnapshot().checkRun.id, 2, '第二轮令牌继续自增');
  assert.equal(store.getSnapshot().checks['skillhub:ake:dev-god'].candidate, '2.0.0', '已有答案在重查期间保留（不闪空）');
});
