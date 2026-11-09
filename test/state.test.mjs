/**
 * `src/client/state.js` — the page store that outlives the page.
 *
 * Contract: docs/contracts/client.md §3.5 (state machine, store scope), §3.9.1 (the
 * bookmark transfer: optimistic flip + generation guard) and §3.9.3 (the market
 * sub-state's 33 actions, four of them for bookmarks); case ids K45, K80.
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

test('K45 初始 market 子状态：默认「SkillHub / 推荐 / 未筛分类」，什么都没加载', () => {
  const market = createStore().getSnapshot().market;
  // 用户去掉了「全部来源」（市场一次只问一个源），默认停在 SkillHub（market-model §3.8.2）。
  assert.deepEqual(market.filters, { source: 'skillhub', category: null, sort: 'recommended' }, '默认筛选与设计一致');
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
  store.actions.marketSetFilter({ source: 'skillhub' });
  assert.equal(store.getSnapshot().market, before, '值没变 ⇒ 状态对象不变（引用相等）');
  // `{source:'all'}` 不再是「默认值」：它现在是一个普通（不存在的）源 id，设它会真的改状态。
  store.actions.marketSetFilter({ source: 'all' });
  assert.equal(store.getSnapshot().market.filters.source, 'all', 'all 不再是特殊值，照字面生效');
  store.actions.marketSetFilter({ source: 'skillhub' });
  const reset = store.getSnapshot().market;
  store.actions.marketSetFilter(null);
  assert.equal(store.getSnapshot().market, reset, '非对象入参被忽略');
  store.actions.marketSetFilter({ source: 'clawhub', sort: 'updated' });
  const changed = store.getSnapshot().market;
  assert.equal(changed.filters.source, 'clawhub', '改变来源生效');
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

test('K45 marketReload：清空列表与详情、回到待拉状态（页头刷新按钮走这条路）', () => {
  const store = createStore();
  store.actions.marketPageAppended({
    pages: [{ sourceId: 'skillhub', page: { items: [marketItem('skillhub:ake:a')], next: 'c2' } }],
    merged: [marketItem('skillhub:ake:a')],
  });
  store.actions.marketDetailOpen(marketItem('skillhub:ake:a'));
  store.actions.marketReload();
  const market = store.getSnapshot().market;
  assert.deepEqual(market.items, [], '卡片清空');
  assert.equal(market.detail, null, '详情关闭');
  assert.equal(market.pages, 0, '分页重置');
  assert.equal(market.listStatus, 'idle', '回到待拉状态（由面板的 effect 重新拉第一页）');
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

test('K45 市场子状态的 action 数量是可核对的：新增的 4 个都属于收藏', () => {
  const store = createStore();
  const names = Object.keys(store.actions);
  const market = names.filter((name) => name.startsWith('market'));
  assert.equal(market.length, 33, '市场子状态共 33 个 action（原 29 + 收藏 4）');
  for (const added of ['marketFavoritesLoaded', 'marketFavoriteToggle', 'marketFavoriteOk', 'marketFavoriteFail']) {
    assert.equal(market.includes(added), true, `${added} 已落地`);
  }
  assert.equal(names.every((name) => typeof store.actions[name] === 'function'), true, '每个 action 都是函数');
});

test('K80 初始收藏状态：空集、可用、代次 0', () => {
  const market = createStore().getSnapshot().market;
  assert.deepEqual(market.favorites, {}, '没有收藏');
  assert.equal(market.favoritesOk, true, '缺省当作可用（bootstrap 说了才算）');
  assert.equal(market.favoritesGen, 0, '代次从 0 起');
});

test('K80 marketFavoritesLoaded：数组变布尔映射，非数组/坏条目一律丢', () => {
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

test('K80 乐观翻转：toggle 立刻改 favorites、代次 +1，并返回新代次', () => {
  const store = createStore();
  const first = store.actions.marketFavoriteToggle('skillhub:ake:dev-god');
  assert.equal(first, 1, '第一次翻转子代次是 1');
  assert.deepEqual(store.getSnapshot().market.favorites, { 'skillhub:ake:dev-god': true }, '立刻变成已收藏');
  assert.equal(store.getSnapshot().market.favoritesGen, 1, '代次写进状态');

  const second = store.actions.marketFavoriteToggle('skillhub:ake:dev-god');
  assert.equal(second, 2, '再点一次代次是 2');
  assert.deepEqual(store.getSnapshot().market.favorites, {}, '再次翻转回未收藏（两次相反的意图）');
  assert.equal(store.actions.marketFavoriteToggle(''), 2, '空 id 不产生新代次（按钮不会发这种请求）');
});

test('K80 代次防乱序：旧代次的 Ok / Fail 一律不改状态', () => {
  const store = createStore();
  const stale = store.actions.marketFavoriteToggle('skillhub:ake:a');
  const fresh = store.actions.marketFavoriteToggle('skillhub:ake:b');
  const before = store.getSnapshot();

  store.actions.marketFavoriteOk(stale, ['clawhub:x:y']);
  assert.equal(store.getSnapshot(), before, '旧代次的成功回包被丢弃（状态对象引用都没变）');

  store.actions.marketFavoriteFail(stale, '写失败');
  assert.equal(store.getSnapshot(), before, '旧代次的失败也不回滚、不弹 toast');

  store.actions.marketFavoriteOk(fresh, ['clawhub:x:y', 'skillhub:ake:a']);
  assert.deepEqual(
    store.getSnapshot().market.favorites,
    { 'clawhub:x:y': true, 'skillhub:ake:a': true },
    '最新代次的成功用权威列表整份替换（包括那两条本地没猜到的）',
  );
  assert.equal(store.getSnapshot().market.favoritesOk, true, '回包成功说明可用');
});

test('K80 最新代次失败：只回滚那一个 id，并推 favorite-failed 提示', () => {
  const store = createStore();
  store.actions.marketFavoritesLoaded(['clawhub:ivan:design'], true);
  const gen = store.actions.marketFavoriteToggle('skillhub:ake:dev-god');
  store.actions.marketFavoriteFail(gen, '收藏数量已达上限，请先取消一些');

  const state = store.getSnapshot();
  assert.deepEqual(
    state.market.favorites,
    { 'clawhub:ivan:design': true },
    '只回滚被翻的那条：另一条收藏不动',
  );
  assert.equal(state.notice.kind, 'favorite-failed', '提示的 kind 是 favorite-failed');
  assert.equal(state.notice.reason, '收藏数量已达上限，请先取消一些', '提示带本地化原因');
  assert.equal(typeof state.notice.seq, 'number', '带序号，dismissNotice 才关得掉');

  const seq = state.notice.seq;
  store.actions.dismissNotice(seq - 1);
  assert.notEqual(store.getSnapshot().notice, null, '序号不匹配不关');
  store.actions.dismissNotice(seq);
  assert.equal(store.getSnapshot().notice, null, '序号匹配才关');

  // The rolled-back id must be collectable again, and the next failure must roll back the
  // *new* flip rather than the old one.
  const again = store.actions.marketFavoriteToggle('skillhub:ake:dev-god');
  assert.deepEqual(store.getSnapshot().market.favorites['skillhub:ake:dev-god'], true, '再点一次仍然乐观翻成已收藏');
  store.actions.marketFavoriteFail(again, '再来一次');
  assert.equal(store.getSnapshot().market.favorites['skillhub:ake:dev-god'], undefined, '第二次失败也回滚同一 id');
});

test('K80 reload / boot 兜底都不动收藏，也不把 favoritesOk 置 true', () => {
  const store = createStore();
  store.actions.marketFavoritesLoaded(['skillhub:ake:dev-god'], false);
  const favorites = store.getSnapshot().market.favorites;

  store.actions.marketReload();
  assert.equal(store.getSnapshot().market.favorites, favorites, 'reload 清列表与图标缓存，但不碰收藏（收藏不是缓存）');
  assert.equal(store.getSnapshot().market.favoritesOk, false, '也不顺手把可用性改成 true');

  store.actions.marketBootFallback([{ id: 'skillhub', labelKey: 'market.source.skillhub', hasCategories: true, packageKind: 'files' }]);
  assert.equal(store.getSnapshot().market.favorites, favorites, 'bootstrap 失败兜底同样不清收藏');
  assert.equal(store.getSnapshot().market.favoritesOk, false, '也不虚报可用');
});

test('K80 两条不同的乐观翻转：最新代次失败只回滚它自己，另一条的乐观值留在原地', () => {
  const store = createStore();
  const older = store.actions.marketFavoriteToggle('skillhub:ake:a');
  const newer = store.actions.marketFavoriteToggle('clawhub:ivan:design');
  assert.deepEqual(
    store.getSnapshot().market.favorites,
    { 'skillhub:ake:a': true, 'clawhub:ivan:design': true },
    '两条都先乐观翻上去了',
  );

  store.actions.marketFavoriteFail(newer, '写失败');
  assert.deepEqual(
    store.getSnapshot().market.favorites,
    { 'skillhub:ake:a': true },
    '只回滚新一代那条；前一条的乐观值等它自己的回包，不被别人的失败牵连',
  );

  // The older turn's own answer is stale now and must not touch the set either.
  const before = store.getSnapshot();
  store.actions.marketFavoriteFail(older, '更早的失败');
  assert.equal(store.getSnapshot(), before, '旧代次的失败仍然什么都不改（也不弹第二条 toast）');
});

test('K80 权威回包整份替换：服务端列表缺的那条不会靠本地乐观值补回来', () => {
  const store = createStore();
  const gen = store.actions.marketFavoriteToggle('skillhub:ake:dev-god');
  // The host answered "no such bookmark" (someone edited the file): its list is truth.
  store.actions.marketFavoriteOk(gen, ['clawhub:ivan:design']);
  assert.deepEqual(
    store.getSnapshot().market.favorites,
    { 'clawhub:ivan:design': true },
    '整份替换：本地猜的那条被服务端答案覆盖掉',
  );
  assert.equal(store.getSnapshot().market.favoritesOk, true, '成功的回包说明收藏可用（bootstrap 失败也能自愈）');
});
