/**
 * `src/client/state.js` — the page store that outlives the page.
 *
 * Contract: docs/contracts/client.md §3.5 (state machine, store scope) and §3.9.3 (the
 * market sub-state's 31 actions; the bookmark write side was removed in U5 - see
 * docs/contracts/decisions.md appendix L - and only the read side is left); case ids K45,
 * K105 (a filter change keeps `items`, M10) and K108 (the four fields the landing paint
 * effect depends on, see §3.9.1 "落点").
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createStore } from '../src/client/state.js';
import { installViewOf } from '../src/client/market-model.js';

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

test('K45 市场重取（切来源 / 搜索落定）：只清分页与详情、列表留在屏幕上', () => {
  const store = createStore();
  store.actions.marketPageAppended({
    pages: [{ sourceId: 'skillhub', page: { items: [marketItem('skillhub:ake:a')], next: 'c2' } }],
    merged: [marketItem('skillhub:ake:a')],
  });
  store.actions.marketDetailOpen(marketItem('skillhub:ake:a'));
  const before = store.getSnapshot().market;
  // 页头刷新按钮与 `marketReload()` 都已撤除（U20 收尾，用户拍板「零调用方的 action 不留」）：
  // 重取仍由切来源 / 搜索落定 / 面板 effect / 错误态「重试」驱动，走的都是 `clearedPaging`。
  store.actions.marketSetFilter({ source: 'clawhub' });
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

  // 空列表上重取（首屏失败后换来源 / 重试那条路）：没有 items 可留 ⇒ 回 idle，由面板 effect 重拉。
  store.actions.marketListFailed({ code: 'E_SOURCE_TIMEOUT', message: 't' });
  store.actions.marketSetFilter({ source: 'skillhub' });
  assert.equal(store.getSnapshot().market.listStatus, 'idle', '空列表重取回 idle（effect 据此重拉第一页）');
  assert.equal(store.getSnapshot().market.pages, 0, '分页仍是 0');
});

test('K45 marketListFailed 与 marketPageFailed 语义不同：第一页全失败（还没有旧结果）清列表，追加失败保留已加载卡片', () => {
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

  // M3：同一个查询上一次成功过就有快照可留，失败会变成「陈旧结果 + 一行提示」。这一条验的是
  // **没有**快照的那条路，所以先换一个还没有答案的查询（快照按查询键存，见 `marketQueryKeyOf`）。
  store.actions.marketSetFilter({ source: 'clawhub' });
  store.actions.marketListLoading();
  store.actions.marketListFailed({ code: 'E_SOURCE_TIMEOUT', message: 'timeout' });
  const failed = store.getSnapshot().market;
  assert.equal(failed.listStatus, 'error', '唯一那个源失败且没有旧结果 ⇒ 整页 error 态');
  assert.equal(failed.page.code, 'E_SOURCE_TIMEOUT', '错误码留在 page 上（界面据此选文案）');
});

test('K45 市场子状态的 action 数量是可核对的：收藏只剩读侧一个', () => {
  const store = createStore();
  const names = Object.keys(store.actions);
  const market = names.filter((name) => name.startsWith('market'));
  // U20 收尾：`marketReload()` 因「零调用方」被删（页头刷新已随工具条退场），31 → 30；
  // M14 加 `marketLocale`（分类 chip 按语言取槽，见 K156），30 → 31；M2 加三个更新座位
  // （`marketUpdateStart` / `marketInstalledVersion` / `marketUpdateFail`），31 → 34。
  assert.equal(market.length, 34, '市场子状态共 34 个 action（U5 撤写侧 3 个，U20 加 marketInstalledStale 1 个、删 marketReload 1 个，M14 加 marketLocale 1 个，M2 加更新三件 3 个）');
  assert.equal(market.includes('marketLocale'), true, 'M14 的语言落点还在（chips 与分类名的取槽依据）');
  assert.equal(market.includes('marketReload'), false, 'marketReload 已删（零调用方的 action 不留）');
  assert.equal(market.includes('marketFavoritesLoaded'), true, '读侧 action 仍在（bootstrap 仍下发收藏）');
  // 添加技能成功后台账已过期（新目录还没进台账）：由这个 action 打标，安装页据此重读。
  assert.equal(market.includes('marketInstalledStale'), true, 'U20 的台账过期标记仍在（add 成功后用）');
  assert.equal(
    names.includes('addApplied'),
    true,
    'addApplied 不带 market 前缀，所以不计入这 31 个（它归已安装页的 notice）',
  );
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

test('K45 重取 / boot 兜底都不动收藏，也不把 favoritesOk 置 true', () => {
  const store = createStore();
  store.actions.marketFavoritesLoaded(['skillhub:ake:dev-god'], false);
  const favorites = store.getSnapshot().market.favorites;

  store.actions.marketSetFilter({ source: 'clawhub' });
  assert.equal(store.getSnapshot().market.favorites, favorites, '重取只清分页与详情，但不碰收藏（收藏不是缓存）');
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
    // 页头刷新（= `marketReload()`）已撤；替代它占位的是一条同样「只动缓存、不动查询键」
    // 的 market action：台账过期标记（add 成功后用）。
    ['台账过期标记（marketInstalledStale）', () => store.actions.marketInstalledStale()],
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

test('K134/K135 store 语义：添加只推 notice、删除才置台账过期，市场卡都不长出「已安装」', () => {
  const store = createStore();
  store.actions.marketInstalledLoaded({ 'skillhub:ake:a': { name: 'a' } });
  store.actions.addApplied({ name: 'qa-probe', path: '/tmp/skills/qa-probe' });
  const state = store.getSnapshot();
  // 静默成功：toast 用的是市场装完那一个座（kind 仍是三种之一），文案由页面按 kind 选。
  assert.equal(state.notice.kind, 'install-ok', 'toast 复用 install-ok 座（kind 仍是三种之一）');
  assert.equal(state.notice.name, 'qa-probe', 'toast 带上技能名（文案要显示它）');
  assert.equal(state.notice.path, '/tmp/skills/qa-probe', 'toast 带上落位路径');
  assert.equal(state.notice.code, '', '成功没有错误码');
  // 加的技能没有上游身份，进不了市场卡的那种映射：台账**不用**作废（作废了只是白重读一次）。
  assert.equal(state.market.installedReady, true, '本地新增不动市场映射（它没有上游身份）');
  assert.deepEqual(state.market.installed, { 'skillhub:ake:a': { name: 'a' } }, '映射原封不动');
  assert.deepEqual(state.market.installs, {}, '加的技能不是市场条目：installs 不长出条目');
  assert.equal(state.market.installedDirty, false, '没有借 installedDirty 顺手让列表重扫（那是另一件事）');

  // 再读一次台账就把过期标收回（下次进市场页的正常路径）。
  store.actions.marketInstalledLoaded({});
  assert.equal(store.getSnapshot().market.installedReady, true, '重读后过期标收回');

  // 删除走同一条路：目录没了，市场页的「已安装」也得重读。
  store.actions.marketInstalledStale();
  assert.equal(store.getSnapshot().market.installedReady, false, '删除后台账同样过期');

  // 契约只要求「置回 false、不动 map」——不额外钉「重复调用不产生新快照」：
  // 那是 filters 那条空操作优化（K45 marketSetFilter）的语义，不是这一条的。
  store.actions.marketInstalledStale();
  assert.equal(store.getSnapshot().market.installedReady, false, '重复标记仍是 false');
  assert.deepEqual(store.getSnapshot().market.installed, {}, '重复标记仍不动 map');
});

/* --------------------- K38 · M3：刷新失败时保住上一份卡片（陈旧结果与会话内快照） --------------------- */

/**
 * One market item, as the panel would hold it.
 * @param {string} slug - the item's slug (and its key's tail).
 * @returns {object} the item.
 */
function keptItem(slug) {
  return {
    sourceId: 'skillhub', id: `skillhub:ake:${slug}`, owner: 'ake', slug,
    displayName: slug, summary: 'A fixture item.', version: '1.0.0',
  };
}

/**
 * Land one page of results for the current query.
 * @param {object} store - the store.
 * @param {string[]} slugs - the items of that page.
 * @param {string|null} [next] - the cursor the source handed back.
 * @returns {void}
 */
function landKeptPage(store, slugs, next = null) {
  const items = slugs.map(marketItem);
  store.actions.marketPageAppended({
    pages: [{ sourceId: 'skillhub', page: { items, next } }],
    merged: items,
  });
}

test('K38 刷新失败：本查询有上次的非空结果 ⇒ 回填上一份 + stale，而不是清空整页', () => {
  const store = createStore();
  landKeptPage(store, ['alpha', 'beta'], 'cursor-2');
  const loaded = store.getSnapshot().market;
  assert.equal(loaded.listStatus, 'ready', '先有一次成功');
  assert.equal(loaded.pages, 1, '一页');

  store.actions.marketListLoading();
  store.actions.marketListFailed({ code: 'E_SOURCE_TIMEOUT', message: 'upstream timed out' });
  const failed = store.getSnapshot().market;

  assert.equal(failed.listStatus, 'ready', '有旧结果 ⇒ 停在 ready（不是 error）');
  assert.deepEqual(failed.stale, { code: 'E_SOURCE_TIMEOUT', message: 'upstream timed out' }, 'stale 记着这次失败');
  assert.equal(failed.page.status, 'idle', '尾部回 idle：没有失败的追加');
  assert.equal(failed.page.code, null, '整页错误码不落在尾部');
  assert.deepEqual(failed.items, loaded.items, '卡片原样回填（同一批，不重排）');
  assert.equal(failed.pages, loaded.pages, '页数回填');
  assert.deepEqual(failed.cursors, loaded.cursors, '游标回填（数据源还能续）');
  assert.deepEqual(failed.exhausted, loaded.exhausted, '「已耗尽」回填');
  assert.deepEqual(failed.cursors, { skillhub: 'cursor-2' }, '游标就是上次那个值');
});

test('K38 刷新失败：没有可回填的旧结果 ⇒ 仍然清空进整页错误（空 ≠ 有结果可留）', () => {
  // ① 从未成功过。
  const fresh = createStore();
  fresh.actions.marketListLoading();
  fresh.actions.marketListFailed({ code: 'E_SOURCE_UNAVAILABLE', message: 'down' });
  const first = fresh.getSnapshot().market;
  assert.equal(first.listStatus, 'error', '从未成功 ⇒ 整页 error');
  assert.deepEqual(first.items, [], '列表清空');
  assert.equal(first.stale, null, '没有陈旧标记（屏上没有任何旧卡片）');
  assert.equal(first.page.code, 'E_SOURCE_UNAVAILABLE', '错误码留在 page 上');

  // ② 上次成功是空列表：「没有匹配」不是这次失败还能替它担保的结果。
  const empty = createStore();
  landKeptPage(empty, [], null);
  assert.equal(empty.getSnapshot().market.listStatus, 'ready', '空列表也是一次成功');
  empty.actions.marketListFailed({ code: 'E_SOURCE_TIMEOUT', message: 'timeout' });
  const afterEmpty = empty.getSnapshot().market;
  assert.equal(afterEmpty.listStatus, 'error', '空快照不算「有结果可留」⇒ 整页 error');
  assert.deepEqual(afterEmpty.items, [], '列表仍是空');
  assert.equal(afterEmpty.stale, null, '不画陈旧行（它下面没有卡片可画）');
});

test('K38 快照按查询键隔离、跨 scope 保留：切走的查询回来还能保住自己的卡片', () => {
  const store = createStore();
  landKeptPage(store, ['alpha'], null);
  store.actions.marketListFailed({ code: 'E_SOURCE_TIMEOUT', message: 'slow' });
  assert.notEqual(store.getSnapshot().market.stale, null, '本查询有快照 ⇒ 陈旧态');

  // 换一个还没有答案的查询：它没有快照，所以失败就是整页失败——旧查询的卡片不会串过来。
  store.actions.marketSetFilter({ category: 'dev-tools' });
  assert.equal(store.getSnapshot().market.stale, null, '换查询清掉陈旧标记（那是上一个查询的事）');
  store.actions.marketListFailed({ code: 'E_SOURCE_TIMEOUT', message: 'slow' });
  const other = store.getSnapshot().market;
  assert.equal(other.listStatus, 'error', '新查询没有快照 ⇒ 整页错误');
  assert.deepEqual(other.items, [], '没有把上一个查询的卡片搬过来');

  // 切回原查询：它的快照还在（快照跨 scope 保留，不是「最后一次」的别名）。
  store.actions.marketSetFilter({ category: null });
  assert.equal(store.getSnapshot().market.categoriesLoading, false, '同一查询的筛选回到默认');
  store.actions.marketListFailed({ code: 'E_SOURCE_UNAVAILABLE', message: 'down' });
  const back = store.getSnapshot().market;
  assert.equal(back.listStatus, 'ready', '回到原查询 ⇒ 旧快照又能回填');
  assert.deepEqual(back.items.map((entry) => entry.slug), ['alpha'], '就是原查询那一张卡');
  assert.equal(back.stale.code, 'E_SOURCE_UNAVAILABLE', 'stale 记新的那次失败');
});

test('K38 快照最多留 8 份：第 9 个查询挤掉最久未写的那个，重写过的不会掉', () => {
  const store = createStore();
  const at = (keyword) => {
    store.actions.marketCommitKeyword(keyword);
    landKeptPage(store, [`item-${keyword}`], null);
  };
  for (const keyword of ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8']) at(keyword);
  assert.equal(Object.keys(store.getSnapshot().market.snapshots).length, 8, '八份封顶');

  // Rewrite the oldest: the cap counts "least recently written", not "first ever written".
  at('k1');
  assert.equal(Object.keys(store.getSnapshot().market.snapshots).length, 8, '重写不新增一份');

  at('k9');
  assert.equal(Object.keys(store.getSnapshot().market.snapshots).length, 8, '第 9 个查询之后仍是 8 份');

  // k2 was the oldest untouched one, so it is the one that fell off; k1 and k9 are both here.
  store.actions.marketCommitKeyword('k2');
  store.actions.marketListFailed({ code: 'E_SOURCE_TIMEOUT', message: 'slow' });
  assert.equal(store.getSnapshot().market.listStatus, 'error', 'k2 被挤掉了 ⇒ 整页错误');

  store.actions.marketCommitKeyword('k1');
  store.actions.marketListFailed({ code: 'E_SOURCE_TIMEOUT', message: 'slow' });
  assert.equal(store.getSnapshot().market.listStatus, 'ready', 'k1 重写过 ⇒ 还留着');
  assert.deepEqual(store.getSnapshot().market.items.map((entry) => entry.slug), ['item-k1'], '回填的是 k1 自己那一条');

  store.actions.marketCommitKeyword('k9');
  store.actions.marketListFailed({ code: 'E_SOURCE_TIMEOUT', message: 'slow' });
  assert.equal(store.getSnapshot().market.listStatus, 'ready', '最新写进去的 k9 留着');
});

test('K38 陈旧态下重取第一页：pages 归 0（尾部不当追加），成功后 stale 清空、pages 回到 1', () => {
  const store = createStore();
  landKeptPage(store, ['alpha', 'beta'], 'cursor-2');
  store.actions.marketListFailed({ code: 'E_SOURCE_TIMEOUT', message: 'slow' });
  assert.equal(store.getSnapshot().market.stale !== null, true, '先进入陈旧态');

  store.actions.marketListLoading();
  const retrying = store.getSnapshot().market;
  assert.equal(retrying.pages, 0, '重取的是第一页 ⇒ pages 归 0（面板据此不画尾部骨架/加载更多）');
  assert.equal(retrying.items.length, 2, '旧卡片留在屏上（不清空）');
  assert.notEqual(retrying.stale, null, '重试期间陈旧标记还在：屏上确实还是旧结果');
  assert.equal(retrying.page.status, 'loading', '尾部在加载（但 pages=0，面板不把它当追加）');

  landKeptPage(store, ['gamma'], 'cursor-3');
  const landed = store.getSnapshot().market;
  assert.equal(landed.stale, null, '答案落地 ⇒ 陈旧标记消失');
  assert.equal(landed.pages, 1, '第一页 ⇒ pages 就是 1（不是旧页数 +1）');
  assert.deepEqual(landed.items.map((entry) => entry.slug), ['gamma'], '屏上是新答案');
  assert.deepEqual(landed.cursors, { skillhub: 'cursor-3' }, '游标跟着新答案');

  // 新答案同时成为下一次失败的快照。
  store.actions.marketListFailed({ code: 'E_SOURCE_UNAVAILABLE', message: 'down' });
  assert.equal(store.getSnapshot().market.listStatus, 'ready', '新答案就是下一份快照');
  assert.deepEqual(store.getSnapshot().market.items.map((entry) => entry.slug), ['gamma'], '回填的是最后一次成功的那份');
});

/* ------------------- K161 · M2：更新座位的状态语义（进入更新 / 幂等 / 失败带 mode / 写回版本） ------------------- */

/** The market key every K161 state case uses. */
const UPDATE_KEY = 'skillhub:ake:dev-god';

/**
 * A ledger row for the card above.
 * @param {object} [overrides] - fields to replace.
 * @returns {object} the row.
 */
function updateLedgerRow(overrides = {}) {
  return {
    name: 'dev-god',
    version: '1.0.0',
    path: '/tmp/skills/dev-god',
    skillFile: '/tmp/skills/dev-god/SKILL.md',
    exists: true,
    ...overrides,
  };
}

test('K161 marketInstallConfirm 的 mode：说清画哪个弹窗，且在途时连点也只开一次', () => {
  const store = createStore();
  store.actions.marketInstallConfirm(UPDATE_KEY, 'update');
  assert.deepEqual(store.getSnapshot().market.installs[UPDATE_KEY], { state: 'confirm', mode: 'update' }, '更新弹窗');
  store.actions.marketInstallConfirm(UPDATE_KEY);
  assert.deepEqual(store.getSnapshot().market.installs[UPDATE_KEY], { state: 'confirm', mode: 'install' }, '缺省是安装弹窗');

  // 取消只清「确认」那一档：正在跑的那一次不许被弹窗关掉。
  store.actions.marketInstallCancel(UPDATE_KEY);
  assert.equal(UPDATE_KEY in store.getSnapshot().market.installs, false, '取消清掉座位');

  store.actions.marketUpdateStart(UPDATE_KEY);
  store.actions.marketInstallConfirm(UPDATE_KEY, 'update');
  assert.equal(store.getSnapshot().market.installs[UPDATE_KEY].state, 'updating', '更新在途时再点不开弹窗（一次确认一次写）');
});

test('K161 marketUpdateStart 幂等：第二次点击不换 seq，在途两种座位都拦住', () => {
  const store = createStore();
  store.actions.marketUpdateStart(UPDATE_KEY);
  const first = store.getSnapshot().market.installs[UPDATE_KEY];
  assert.equal(first.state, 'updating', '进「正在更新」');
  store.actions.marketUpdateStart(UPDATE_KEY);
  assert.equal(store.getSnapshot().market.installs[UPDATE_KEY].seq, first.seq, '连点不产生第二次请求的代次');

  // 不对称已统一（用户裁定）：两个 start 共用同一道闸，座位在途（`installing` / `updating`）
  // 时谁都不改写它、也不产生新的代次 —— 两张卡共用一个动作位，「一次只做一件事」在两侧同语义。
  store.actions.marketInstallStart(UPDATE_KEY);
  const afterCross = store.getSnapshot().market.installs[UPDATE_KEY];
  assert.equal(afterCross.state, 'updating', '在「正在更新」的座位上，安装 start 停手（不改写成安装中）');
  assert.equal(afterCross.seq, first.seq, '也不产生第二次请求的代次');
  store.actions.marketUpdateStart(UPDATE_KEY);
  assert.equal(
    store.getSnapshot().market.installs[UPDATE_KEY].state,
    'updating',
    '同一个座位上，更新 start 同样停手（两侧同一个闸）',
  );

  // 另一条腿：从「安装中」起手，更新 start 也必须停手（两侧闸都认这两档）。
  store.actions.marketInstallStart('other:ake:x');
  store.actions.marketUpdateStart('other:ake:x');
  assert.equal(
    store.getSnapshot().market.installs['other:ake:x'].state,
    'installing',
    '安装中的座位上，更新 start 不开第二次写',
  );
});

test('K161 marketUpdateFail：座位带 mode=update，重试因此回到更新弹窗', () => {
  const store = createStore();
  store.actions.marketUpdateFail(UPDATE_KEY, '磁盘满了');
  assert.deepEqual(
    store.getSnapshot().market.installs[UPDATE_KEY],
    { state: 'failed', reason: '磁盘满了', mode: 'update' },
    '失败座位记着这是哪一次请求',
  );
  store.actions.marketUpdateFail(UPDATE_KEY);
  assert.equal(store.getSnapshot().market.installs[UPDATE_KEY].reason, '', '没给原因就是空串（卡片不画无意义的一行）');
});

test('K161 marketInstalledVersion：静默写回台账版本并标脏；runtime=null 时不留座位', () => {
  const store = createStore();
  store.actions.marketInstalledLoaded({ [UPDATE_KEY]: updateLedgerRow() });
  store.actions.marketUpdateStart(UPDATE_KEY);

  store.actions.marketInstalledVersion(UPDATE_KEY, '2.0.0');
  const afterApply = store.getSnapshot().market;
  assert.deepEqual(afterApply.installed[UPDATE_KEY], updateLedgerRow({ version: '2.0.0' }), '台账版本换成新版本，其余字段原样');
  assert.deepEqual(
    afterApply.installs[UPDATE_KEY],
    { state: 'installed', path: '/tmp/skills/dev-god', version: '2.0.0' },
    '卡面落「已安装」座位',
  );
  assert.equal(afterApply.installedDirty, true, '已安装页签标脏（下一跳重扫）');

  // 「已是最新」这一路不留座位：卡面该由台账判成「已是最新版本」，而不是「已安装」。
  store.actions.marketUpdateStart(UPDATE_KEY);
  store.actions.marketInstalledVersion(UPDATE_KEY, '2.0.0', null);
  assert.equal(UPDATE_KEY in store.getSnapshot().market.installs, false, 'runtime=null ⇒ 座位清掉');

  // 版本入参不合法时保留台账原值（不把版本写成空）。
  store.actions.marketInstalledVersion(UPDATE_KEY, '');
  assert.equal(store.getSnapshot().market.installed[UPDATE_KEY].version, '2.0.0', '空版本不覆盖已有值');

  // 台账里没有这一条：只清座位，不凭空造一条台账。
  store.actions.marketUpdateStart('unknown:ake:x');
  store.actions.marketInstalledVersion('unknown:ake:x', '9.9.9');
  assert.equal('unknown:ake:x' in store.getSnapshot().market.installs, false, '没有台账可更正 ⇒ 不留转圈的座位');
  assert.equal('unknown:ake:x' in store.getSnapshot().market.installed, false, '也不会凭空写一条台账');
});

/* ------------- K38 · 落地归属按「发请求那一刻的查询」定（迟到答案整条丢弃，R2 回归） ------------- */

/** The query key the market state spells for one keyword, as `docs/contracts/client.md` §3.9.1 spells it. */
const QUERY_KEY = (keyword, category = 'null') => `all|${category}|recommended|${keyword}`;

test('K38 迟到成功（查询已变）：不换 items、不写游标、不写新查询的快照、不清 stale', () => {
  const store = createStore();
  store.actions.marketCommitKeyword('a');
  landKeptPage(store, ['alpha'], 'cursor-a');
  const before = store.getSnapshot().market;

  // 读者改成 b，b 的请求还没发出（面板里隔着一次 effect）——a 的答案在这窗口里落地。
  store.actions.marketCommitKeyword('b');
  const switched = store.getSnapshot().market;
  assert.equal(switched.listStatus, 'ready', '切查询时列表留在屏上（clearedPaging 的语义）');
  assert.deepEqual(switched.cursors, {}, 'b 的分页是新的：游标清掉');

  store.actions.marketPageAppended({
    key: QUERY_KEY('a'),
    pages: [{ sourceId: 'skillhub', page: { items: [keptItem('late-a')], next: 'cursor-late' } }],
    merged: [keptItem('late-a')],
  });
  const after = store.getSnapshot().market;
  assert.equal(after.items, switched.items, 'items 的引用都没换（a 的答案整条丢弃，不是「先换再丢」）');
  assert.deepEqual(after.items.map((entry) => entry.slug), ['alpha'], '屏上还是切查询前那一份');
  assert.deepEqual(after.cursors, {}, 'a 的游标没有写进 b');
  assert.deepEqual(Object.keys(after.snapshots), [QUERY_KEY('a')], '快照只有 a 那一份：b 的键不许凭空出现');
  assert.equal(after.stale, null, 'b 没有陈旧标记');
  assert.equal(after.page.status, 'idle', '尾部也没被 a 的答案推进');

  // 反向：同键落地照常生效——否则上面几条会「因为全部丢弃」而假绿。
  store.actions.marketCommitKeyword('a');
  store.actions.marketPageAppended({
    key: QUERY_KEY('a'),
    pages: [{ sourceId: 'skillhub', page: { items: [keptItem('real-a')], next: null } }],
    merged: [keptItem('real-a')],
  });
  assert.deepEqual(store.getSnapshot().market.items.map((entry) => entry.slug), ['real-a'], '回到 a 且答案归属正确 ⇒ 正常落地');
  assert.equal(before.items.length, 1, '探针基线没变（上一步只有一张卡）');
});

test('K38 迟到失败（查询已变）：listStatus 不动、不画错误态，屏上的列表不陪它背错', () => {
  const store = createStore();
  store.actions.marketCommitKeyword('a');
  // a 的请求在飞（面板已发出去）
  store.actions.marketListLoading();
  // 读者改成 b：分页清掉，列表还是空的 ⇒ idle
  store.actions.marketCommitKeyword('b');
  assert.equal(store.getSnapshot().market.listStatus, 'idle', 'b 这一屏还没有任何结果');

  store.actions.marketListFailed({ key: QUERY_KEY('a'), code: 'E_SOURCE_TIMEOUT', message: 'slow' });
  const after = store.getSnapshot().market;
  assert.equal(after.listStatus, 'idle', 'a 的失败不许把 b 打进整页错误态');
  assert.equal(after.page.status, 'idle', '尾部也没有错误');
  assert.equal(after.page.code, null, '错误码不落在 b 上');
  assert.deepEqual(after.items, [], '列表仍是空的（没有被「清空」动作碰过）');
  assert.equal(after.stale, null, 'b 没有可回填的旧结果，也就没有陈旧标记');
});

test('K38 迟到追加失败 / 迟到追加成功：都不改新查询的尾部与游标', () => {
  const store = createStore();
  store.actions.marketCommitKeyword('a');
  landKeptPage(store, ['alpha'], 'cursor-a');
  store.actions.marketPageStart();

  // 切到分类 b：分页清掉，卡片留着
  store.actions.marketSetFilter({ category: 'dev-tools' });
  const switched = store.getSnapshot().market;
  assert.equal(switched.page.status, 'idle', '新查询的尾部是 idle');
  assert.deepEqual(switched.cursors, {}, '游标清掉');

  store.actions.marketPageFailed({ key: QUERY_KEY('a'), code: 'E_SOURCE_UNAVAILABLE', message: 'down' });
  assert.equal(store.getSnapshot().market.page.status, 'idle', '旧查询的追加失败不画在新查询的尾部（否则会出现「加载失败，点此重试」）');

  store.actions.marketPageAppended({
    key: QUERY_KEY('a'),
    pages: [{ sourceId: 'skillhub', page: { items: [keptItem('late-page')], next: 'cursor-late' } }],
    merged: [keptItem('alpha'), keptItem('late-page')],
  });
  const after = store.getSnapshot().market;
  assert.deepEqual(after.cursors, {}, '旧答案不许写回游标');
  assert.deepEqual(
    Object.keys(after.snapshots),
    [QUERY_KEY('a')],
    '快照仍只有第一页那份（a 的键），分类查询的键没有被旧答案凭空写出来',
  );
  assert.deepEqual(after.items.map((entry) => entry.slug), ['alpha'], '新查询的列表没被旧答案追加');
});

test('K38 key 缺省＝当前查询（既有调用点与测试不必逐个改签名）', () => {
  const store = createStore();
  store.actions.marketPageAppended({
    pages: [{ sourceId: 'skillhub', page: { items: [keptItem('alpha')], next: null } }],
    merged: [keptItem('alpha')],
  });
  assert.deepEqual(Object.keys(store.getSnapshot().market.snapshots), [QUERY_KEY('')], '不带 key ⇒ 记在当前查询下');
  store.actions.marketListFailed({ code: 'E_SOURCE_TIMEOUT', message: 'slow' });
  assert.equal(store.getSnapshot().market.listStatus, 'ready', '不带 key 的失败仍按当前查询回填');
  assert.notEqual(store.getSnapshot().market.stale, null, '陈旧标记照常');
});

test('K161 装完那一行台账是「五键 + skillFile 未知」：客户端不拼 SKILL.md，也绝不因此开出更新', () => {
  const store = createStore();
  const id = 'skillhub:ake:fresh';
  store.actions.marketInstallStart(id);
  store.actions.marketInstallOk(id, { name: 'fresh', path: '/tmp/skills/fresh', version: '1.0.0' });
  const market = store.getSnapshot().market;

  assert.deepEqual(
    Object.keys(market.installed[id]).sort(),
    ['exists', 'name', 'path', 'skillFile', 'version'],
    '五个键，与 #8 的形状一致（缺键会让「这一行是什么」在客户端有两种读法）',
  );
  assert.equal(market.installed[id].skillFile, null, '未知就显式写 null：`join(path, SKILL.md)` 只能由 Host 拼（硬约束 6）');
  assert.equal(market.installed[id].path, '/tmp/skills/fresh', 'path 仍是目录');
  assert.equal(market.installs[id].state, 'installed', '运行时座位说「已安装」');
  assert.equal(market.installedDirty, true, '已安装页签标脏');

  // 反向：这一行永远接不出一个更新请求——没有 skillFile 就没有可覆盖的文件。
  const card = { id, version: '2.0.0' };
  assert.deepEqual(installViewOf(market, id, card), { state: 'installed', path: '/tmp/skills/fresh' }, '座位在 ⇒ 已安装（不是更新）');
  const withoutSeat = { ...market, installs: {} };
  assert.deepEqual(
    installViewOf(withoutSeat, id, card),
    { state: 'ready' },
    '把座位摘掉也只落「安装」：缺 skillFile 的行不许给出更新入口',
  );

  // 只有 Host 那条带真 skillFile 的行回来，这一条才可能落到「已是最新」/「更新」。
  store.actions.marketInstalledLoaded({
    [id]: { name: 'fresh', version: '1.0.0', path: '/tmp/skills/fresh', skillFile: '/tmp/skills/fresh/SKILL.md', exists: true },
  });
  const hosted = { ...store.getSnapshot().market, installs: {} };
  assert.deepEqual(
    installViewOf(hosted, id, card),
    { state: 'update', path: '/tmp/skills/fresh', from: '1.0.0', to: '2.0.0' },
    'Host 的真形状回来之后才有「更新」',
  );
});

test('K161 一道闸三处调用：两个 start 与确认弹窗，在两种在途座位上都停手且 seq 不变', () => {
  const id = UPDATE_KEY;
  /** The three actions that must share one gate, with the arguments each needs. */
  const CALLERS = [
    { name: 'marketInstallStart', call: (store) => store.actions.marketInstallStart(id) },
    { name: 'marketUpdateStart', call: (store) => store.actions.marketUpdateStart(id) },
    { name: 'marketInstallConfirm(install)', call: (store) => store.actions.marketInstallConfirm(id) },
    { name: 'marketInstallConfirm(update)', call: (store) => store.actions.marketInstallConfirm(id, 'update') },
  ];
  /** How to put a seat into each in-flight state through the public actions only. */
  const SEEDS = [
    { seat: 'installing', seed: (store) => store.actions.marketInstallStart(id) },
    { seat: 'updating', seed: (store) => store.actions.marketUpdateStart(id) },
  ];

  for (const seed of SEEDS) {
    for (const caller of CALLERS) {
      const store = createStore();
      seed.seed(store);
      const before = store.getSnapshot().market.installs[id];
      assert.equal(before.state, seed.seat, `先造出 ${seed.seat} 座位`);

      caller.call(store);
      const after = store.getSnapshot().market.installs[id];
      assert.deepEqual(
        after,
        before,
        `${caller.name} 打在 ${seed.seat} 座位上：整条座位一字不动（状态、mode、seq 都不换）`,
      );
    }
  }

  // 正向对照：闸不是「一律返回」。空座位上四个调用者各自都能真的把座位推成在途/确认态，
  // 且两个 start 会拿到新的代次（seq 递增）。
  const fresh = createStore();
  fresh.actions.marketInstallStart(id);
  const installSeq = fresh.getSnapshot().market.installs[id].seq;
  assert.equal(fresh.getSnapshot().market.installs[id].state, 'installing', '空座位 ⇒ 安装能开始');
  const other = createStore();
  other.actions.marketUpdateStart(id);
  assert.equal(other.getSnapshot().market.installs[id].state, 'updating', '空座位 ⇒ 更新能开始');
  const confirmOnly = createStore();
  confirmOnly.actions.marketInstallConfirm(id, 'update');
  assert.deepEqual(
    confirmOnly.getSnapshot().market.installs[id],
    { state: 'confirm', mode: 'update' },
    '空座位 ⇒ 弹窗能开（没有 mode 之外的多余字段）',
  );
  assert.ok(Number.isInteger(installSeq) && installSeq > 0, 'start 会给这一次请求一个代次');
});
