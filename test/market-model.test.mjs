/**
 * `src/client/market-model.js` — every "what should the market tab draw" decision.
 *
 * Contract: docs/contracts/data-model.md §3.8.2 (`mergeBatches` interleave / yield /
 * dedupe / stable order, the pure-function inventory) and docs/contracts/market.md
 * §7.2 (short pages, missing versions); case id K37.
 *
 * The one rule that earns its own test: "is there another page" is `next === null`,
 * never "did this page have fewer rows than I asked for". ClawHub answers one row to
 * a limit=12 request while its cursor still advances, so a count-based rule would
 * silently truncate the list.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MARKET_FALLBACK_SOURCES,
  MARKET_PAGE_SIZE,
  MARKET_SORTS,
  MARKET_STAT_SLOTS,
  MARKET_DEFAULT_SOURCE,
  authorTextOf,
  chipList,
  countText,
  detailFacts,
  emptyKindOf,
  installViewOf,
  marketKeyOf,
  mergeBatches,
  metaSegments,
  pagedSources,
  queriedSources,
  ratingOf,
  ratingTextOf,
  reasonKeyOf,
  sourceDescriptors,
  sourceLabelOf,
  statSegments,
  visibleCategories,
} from '../src/client/market-model.js';
import { createStore } from '../src/client/state.js';

/**
 * One market item.
 * @param {{id?: string, sourceId?: string, updatedAt?: number|null, version?: string|null}} [options] - overrides.
 * @returns {object} the item.
 */
function item(options = {}) {
  const sourceId = options.sourceId ?? 'skillhub';
  const key = options.id ?? `${sourceId}:ake:${Math.random().toString(36).slice(2, 8)}`;
  return {
    sourceId,
    id: key,
    owner: 'ake',
    slug: key.split(':').at(-1),
    displayName: key,
    summary: 'A fixture skill.',
    author: 'Ake',
    version: options.version ?? '1.0.0',
    downloads: 3,
    updatedAt: options.updatedAt ?? null,
    category: null,
    packageKind: 'files',
  };
}

/** A `t()` that returns the key, so assertions read the lookup, not the copy. */
const t = (key) => key;

test('K37 mergeBatches：按来源顺序分块拼接，不做 1:1 交错', () => {
  // 用户要求「先独立排，暂时不混排」：每个源自成一块，块内保持上游顺序。
  const a1 = item({ id: 'skillhub:a:1' });
  const a2 = item({ id: 'skillhub:a:2' });
  const a3 = item({ id: 'skillhub:a:3' });
  const b1 = item({ sourceId: 'clawhub', id: 'clawhub:b:1', updatedAt: 999999 });
  const b2 = item({ sourceId: 'clawhub', id: 'clawhub:b:2', updatedAt: 1 });
  const b3 = item({ sourceId: 'clawhub', id: 'clawhub:b:3' });
  const first = mergeBatches([{ sourceId: 'skillhub', items: [a1, a2, a3] }, { sourceId: 'clawhub', items: [b1, b2, b3] }]);
  assert.deepEqual(
    first.map((entry) => entry.id),
    ['skillhub:a:1', 'skillhub:a:2', 'skillhub:a:3', 'clawhub:b:1', 'clawhub:b:2', 'clawhub:b:3'],
    'skillhub 整块在前、clawhub 整块在后（同源顺序原样）',
  );
  assert.equal(first[3].id, 'clawhub:b:1', '时间更新的 clawhub 项也不会被提到前面（客户端不再跨源重排）');

  // 第二轮：已有的六张不动，新一页按来源顺序接在后面。
  const a4 = item({ id: 'skillhub:a:4' });
  const a5 = item({ id: 'skillhub:a:5' });
  const b4 = item({ sourceId: 'clawhub', id: 'clawhub:b:4' });
  const second = mergeBatches(
    [{ sourceId: 'skillhub', items: [a4, a5] }, { sourceId: 'clawhub', items: [b4] }],
    { existing: first },
  );
  assert.deepEqual(
    second.map((entry) => entry.id),
    [
      'skillhub:a:1', 'skillhub:a:2', 'skillhub:a:3', 'clawhub:b:1', 'clawhub:b:2', 'clawhub:b:3',
      'skillhub:a:4', 'skillhub:a:5', 'clawhub:b:4',
    ],
    '追加的一轮：已有六张在前，新页按来源顺序接上（a4,a5,b4）',
  );
});

test('K37 mergeBatches：一源只有一张时另一源仍是整块（不再有「让位」这回事）', () => {
  const a = [item({ id: 'skillhub:a:1' })];
  const b = [item({ sourceId: 'clawhub', id: 'clawhub:b:1' }), item({ sourceId: 'clawhub', id: 'clawhub:b:2' }), item({ sourceId: 'clawhub', id: 'clawhub:b:3' })];
  const merged = mergeBatches([{ sourceId: 'skillhub', items: a }, { sourceId: 'clawhub', items: b }]);
  assert.deepEqual(merged.map((entry) => entry.id), [
    'skillhub:a:1', 'clawhub:b:1', 'clawhub:b:2', 'clawhub:b:3',
  ], '分块拼接下这是自然结果，不需要「谁先干涸」的规则');
});

test('K37 mergeBatches：按 id 去重，已有项在前且不重复，去重保留第一次出现', () => {
  const existing = [item({ id: 'skillhub:ake:x' })];
  const again = item({ id: 'skillhub:ake:x', version: '9.9.9' });
  const fresh = item({ id: 'clawhub:ake:y' });
  const merged = mergeBatches(
    [{ sourceId: 'skillhub', items: [again] }, { sourceId: 'clawhub', items: [fresh] }],
    { existing },
  );
  assert.deepEqual(merged.map((entry) => entry.id), ['skillhub:ake:x', 'clawhub:ake:y'], '重复项被跳过，新项追加在后');
  assert.equal(merged[0].version, '1.0.0', '重复项保留第一次出现的那条');
  assert.equal(merged.length, 2, '总共两条');
});

test('K37 mergeBatches：同一批里两源给出同 id 也只留一条（兜底）', () => {
  const dup = { id: 'skillhub:ake:z' };
  const merged = mergeBatches([
    { sourceId: 'skillhub', items: [item(dup)] },
    { sourceId: 'clawhub', items: [item(dup)] },
  ]);
  assert.equal(merged.length, 1, '同 id 只留一条');
});

test('K37 mergeBatches：sort 选项已删除——传了也不改变顺序（排序是 Host 的事）', () => {
  // 上一版这里断言「sort=updated 时整表按时间降序」。用户改为「先独立排、不混排」之后，
  // 客户端不再有跨源重排这一步：排序由路由按源实现（§7.2 的 sort 映射），客户端只拼块。
  const older = item({ id: 'skillhub:a:old', updatedAt: 100 });
  const newer = item({ sourceId: 'clawhub', id: 'clawhub:b:new', updatedAt: 300 });
  const unknown = item({ id: 'skillhub:a:unknown', updatedAt: null });
  const pages = [
    { sourceId: 'skillhub', items: [older, unknown] },
    { sourceId: 'clawhub', items: [newer] },
  ];
  const plain = mergeBatches(pages);
  const withSort = mergeBatches(pages, { sort: 'updated' });
  const withOtherSort = mergeBatches(pages, { sort: 'downloads' });
  assert.deepEqual(
    plain.map((entry) => entry.id),
    ['skillhub:a:old', 'skillhub:a:unknown', 'clawhub:b:new'],
    '默认就是分块拼接（不做时间排序）',
  );
  assert.deepEqual(withSort.map((entry) => entry.id), plain.map((entry) => entry.id), '传 sort=updated 与不传逐字相同');
  assert.deepEqual(withOtherSort.map((entry) => entry.id), plain.map((entry) => entry.id), '传 sort=downloads 也不变');
});

test('K37 mergeBatches：existing 永远在前，重复项保留第一次出现的那条，短页照样收下', () => {
  const existing = [item({ id: 'skillhub:ake:x', version: '1.0.0' })];
  const duplicate = item({ id: 'skillhub:ake:x', version: '9.9.9' });
  const fresh = item({ sourceId: 'clawhub', id: 'clawhub:ake:y' });
  const merged = mergeBatches(
    // 短页：clawhub 这一轮只回了一条，也照收（「还有没有下一页」只看 next，不看条数）
    [{ sourceId: 'skillhub', items: [duplicate] }, { sourceId: 'clawhub', items: [fresh] }],
    { existing },
  );
  assert.deepEqual(merged.map((entry) => entry.id), ['skillhub:ake:x', 'clawhub:ake:y'], 'existing 在前，新项追加在后');
  assert.equal(merged[0].version, '1.0.0', '重复项保留第一次出现的那条（不刷新已显示的卡片）');
  assert.equal(merged.length, 2, '总共两条');
  assert.notEqual(merged, existing, '返回新数组（不改调用方的 items）');
  assert.deepEqual(existing.map((entry) => entry.id), ['skillhub:ake:x'], '入参未被就地修改');
});

test('K37 mergeBatches：页为空 / 参数缺失都不抛，已有项原样保留', () => {
  const existing = [item({ id: 'skillhub:ake:k' })];
  assert.deepEqual(mergeBatches([], { existing }).map((entry) => entry.id), ['skillhub:ake:k'], '没有新页时只留已有项');
  assert.deepEqual(mergeBatches(undefined, {}), [], '非数组入参当空处理');
  assert.deepEqual(mergeBatches([{ sourceId: 'x' }], {}), [], '页里没有 items 也不报错');
});

test('K54 countText：紧凑格式 + 四态（万 / M / 0 / null）', () => {
  // 契约（client.md §3.9.1 第 6 条）：chips 上的数字用 `Intl.NumberFormat(undefined, {notation:'compact'})`，
  // 也就是「跟随运行时默认语言」。所以断言分两层：格式跟随运行时；zh/en 的具体写法单独钉住，
  // 证明这套格式化确实是用户要求的那个形状（中文 254万、英文 2.5M），而不是自己拼的字符串。
  const compact = (value) => new Intl.NumberFormat(undefined, { notation: 'compact' }).format(value);
  assert.equal(countText(2540000), compact(2540000), '跟随运行时默认语言');
  assert.equal(new Intl.NumberFormat('zh-CN', { notation: 'compact' }).format(2540000), '254万', '中文环境：254万');
  assert.equal(new Intl.NumberFormat('en-US', { notation: 'compact' }).format(2500000), '2.5M', '英文环境：2.5M');
  assert.equal(countText(0), compact(0), '真实的 0 照常显示（不是 null，也不是空）');
  assert.equal(countText(7), compact(7), '小数字原样');
  for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, '12', {}, []]) {
    assert.equal(countText(value), null, `${JSON.stringify(value)} ⇒ null（不渲染任何数字）`);
  }
});

test('K54 chipList 带数量：total 挂在「全部」上，每类自己的 count，countsOk:false 时整段不渲染', () => {
  const categories = [
    { key: 'dev-tools', name: '开发工具', count: 137000 },
    { key: 'writing', name: '内容创作', count: 0 },
    { key: 'other', name: '其他', count: null },
  ];
  const chips = chipList(categories, { total: 2540000, countsOk: true });
  assert.equal(chips.length, 4, '「全部」+ 三个分类');
  assert.equal(chips[0].count, 2540000, '「全部」显示 total');
  assert.deepEqual(chips.slice(1).map((chip) => chip.count), [137000, 0, null], '每类自己的 count；0 保留，null 表示没数');
  assert.equal(countText(chips[1].count), new Intl.NumberFormat(undefined, { notation: 'compact' }).format(137000), '137000 会变成「14万」/「137K」这种紧凑写法');

  const degraded = chipList(categories, { total: 2540000, countsOk: false });
  assert.deepEqual(degraded.map((chip) => chip.count), [null, null, null, null], 'countsOk:false 时一个数字都不给');
  assert.deepEqual(degraded.map((chip) => chip.label), chips.map((chip) => chip.label), '文案不受影响（chips 照常可用）');

  const bare = chipList(categories);
  assert.deepEqual(bare.map((chip) => chip.count), [null, 137000, 0, null], '不传 countsOk 视为可渲染；没传 total 时「全部」不带数字，各类自己的 count 照常');

  // 上游回了字符串（或 total 是字符串）一律当成「没数」，不猜。这里只守 `Number.isFinite`：
  // 整数性由上游保证——适配器 `readTotal` 做 `Math.trunc`，路由再要求 `Number.isInteger`，
  // 到 model 这一层的 count 不可能是小数。
  const dirty = chipList([{ key: 'a', count: '12' }, { key: 'b', count: null }], { total: '9', countsOk: true });
  assert.deepEqual(dirty.map((chip) => chip.count), [null, null, null], '字符串计数不进 chips');
});

test('K37 短页不等于耗尽：next 非 null 时 pagedSources 仍要这个源（短页 + 游标前进）', () => {
  // ClawHub 实际会这样：limit=12 只回 1 条，但 nextCursor 非空。改成单源之后这条规则
  // 更要紧——页里只有 1 条卡，唯一能说明「后面还有」的就是 next。
  const store = createStore();
  store.actions.marketSetFilter({ source: 'clawhub' });
  store.actions.marketListLoading();
  const only = item({ sourceId: 'clawhub', id: 'clawhub:ake:only' });
  store.actions.marketPageAppended({
    pages: [{ sourceId: 'clawhub', page: { items: [only], next: 'cursor-2' } }],
    merged: [only],
  });
  const market = store.getSnapshot().market;
  assert.equal(market.page.status, 'more', '短页 + next 非空 ⇒ 还有下一页');
  assert.equal(market.exhausted.clawhub, false, '短页没有判成耗尽');
  assert.deepEqual(pagedSources(market), ['clawhub'], '下一次追加仍问这个源');

  // 同一个源 next=null 才是真的到底。
  store.actions.marketPageAppended({
    pages: [{ sourceId: 'clawhub', page: { items: [], next: null } }],
    merged: [only],
  });
  const done = store.getSnapshot().market;
  assert.equal(done.exhausted.clawhub, true, 'next=null 才算耗尽');
  assert.equal(done.page.status, 'done', '没有游标 ⇒ done');
  assert.deepEqual(pagedSources(done), [], '到底之后不再问');
  assert.equal(MARKET_PAGE_SIZE, 12, '单源每页 12 条');
});

test('K37 两源都 next=null 时才算到底：page.status 变 done，pagedSources 为空', () => {
  const store = createStore();
  store.actions.marketListLoading();
  store.actions.marketPageAppended({
    pages: [
      { sourceId: 'skillhub', page: { items: [item({ id: 'skillhub:ake:a' })], next: null } },
      { sourceId: 'clawhub', page: { items: [], next: null } },
    ],
    merged: [item({ id: 'skillhub:ake:a' })],
  });
  const market = store.getSnapshot().market;
  assert.equal(market.page.status, 'done', '所有源都给了 next=null 才是到底');
  assert.deepEqual(pagedSources(market), [], '到底之后不再请求任何源');
});

test('K37 installViewOf 四态：ready / installing / installed / failed，运行时状态优先于台账', () => {
  const id = 'skillhub:ake:dev-god';
  assert.deepEqual(installViewOf({ installs: {}, installed: {} }, id), { state: 'ready' }, '都没记录时是可装');
  assert.deepEqual(installViewOf({ installs: { [id]: { state: 'installing' } }, installed: {} }, id), { state: 'installing' }, '运行中');
  assert.deepEqual(
    installViewOf({ installs: { [id]: { state: 'installed', path: '/tmp/x' } }, installed: {} }, id),
    { state: 'installed', path: '/tmp/x' },
    '刚装完（运行时）',
  );
  assert.deepEqual(
    installViewOf({ installs: { [id]: { state: 'failed', reason: '磁盘满了' } }, installed: {} }, id),
    { state: 'failed', reason: '磁盘满了' },
    '失败带原因',
  );
  assert.deepEqual(
    installViewOf({ installs: {}, installed: { [id]: { name: 'dev-god', path: '/tmp/y', exists: true } } }, id),
    { state: 'installed', path: '/tmp/y' },
    '台账说装过',
  );
  assert.deepEqual(
    installViewOf({ installs: {}, installed: { [id]: { name: 'dev-god', path: '/tmp/y', exists: false } } }, id),
    { state: 'ready' },
    '台账有记录但目录不见了 ⇒ 可再装（exists:false）',
  );
  assert.deepEqual(
    installViewOf({ installs: { [id]: { state: 'failed', reason: 'r' } }, installed: { [id]: { exists: true, path: '/p' } } }, id),
    { state: 'failed', reason: 'r' },
    '运行时失败优先于台账（否则重试按钮会消失）',
  );
});

test('K37 emptyKindOf：只有 ready 且真的空才判空态，且区分为搜索 / 分类 / 来源', () => {
  const base = { listStatus: 'ready', items: [], page: { status: 'idle' }, keyword: '', filters: { category: null } };
  assert.equal(emptyKindOf({ ...base, keyword: 'ui' }), 'search', '有关键词 ⇒ 搜索无结果');
  assert.equal(emptyKindOf({ ...base, filters: { category: 'dev-tools' } }), 'category', '筛了分类 ⇒ 该分类为空');
  assert.equal(emptyKindOf(base), 'source', '什么都没筛 ⇒ 该来源为空');
  assert.equal(emptyKindOf({ ...base, items: [item()] }), null, '有条目就没有空态');
  assert.equal(emptyKindOf({ ...base, listStatus: 'loading' }), null, '加载中不判空');
  assert.equal(emptyKindOf({ ...base, page: { status: 'loading' } }), null, '追加加载中不判空');
  assert.equal(emptyKindOf({ ...base, listStatus: 'error' }), null, '失败态不判空');
  assert.equal(emptyKindOf({ ...base, keyword: '  ' }), 'source', '纯空白的关键词不算搜索');
});

test('K37 metaSegments：作者行只剩 handle 与版本，缺一项就少一段', () => {
  assert.deepEqual(
    metaSegments({ owner: 'ake', slug: 'dev-god', author: 'Ake', version: '1.0.0', downloads: 12 })
      .map((segment) => [segment.key, segment.value]),
    [['market.metaAuthor', 'ake/dev-god'], ['market.metaVersion', '1.0.0']],
    '作者行 = @owner/slug + 版本；下载数搬去 statSegments（不在这一行了）',
  );
  assert.deepEqual(
    metaSegments({ owner: 'ake', slug: 'dev-god', version: null }).map((segment) => segment.key),
    ['market.metaAuthor'],
    '缺版本时只剩作者段',
  );
  assert.deepEqual(metaSegments({}), [], '什么都没有时整行不渲染');
  assert.deepEqual(metaSegments(null), [], '非对象也不抛');
  assert.deepEqual(
    metaSegments({ downloads: 0 }).map((segment) => segment.key),
    [],
    '只有下载数不再是「有一段」：数字不在作者行（不会渲染成 @0 之类的假作者）',
  );
  assert.deepEqual(
    metaSegments({ author: 'Ake Studio', version: '2.0.0' }).map((segment) => segment.value),
    ['Ake Studio', '2.0.0'],
    '两段分别是 author / version（插值名与 locale 占位符一致）',
  );
  assert.deepEqual(
    metaSegments({ author: 'Ake Studio', version: '2.0.0' }).map((segment) => segment.param),
    ['author', 'version'],
    '插值名逐个对齐字典里的占位符',
  );
});

test('K79 authorTextOf 三级回落：@owner/slug → @owner → author → null', () => {
  assert.equal(authorTextOf({ owner: 'ake', slug: 'dev-god', author: 'Ake Studio' }), 'ake/dev-god', '两段齐全时用 handle 路径');
  assert.equal(authorTextOf({ owner: 'ake', slug: null, author: 'Ake Studio' }), 'ake', '缺 slug 时只剩 owner');
  assert.equal(authorTextOf({ owner: '', slug: '', author: 'Ake Studio' }), 'Ake Studio', '两段都缺时回落 publisher 名');
  assert.equal(authorTextOf({ owner: '', slug: '', author: '' }), null, '什么都没有 ⇒ null（整段不渲染）');
  assert.equal(authorTextOf({}), null, '非对象字段也给出 null');
  assert.equal(authorTextOf(null), null, 'null 不抛');
});

test('K79 statSegments：三格恒在，present 只由数值是否有限决定', () => {
  assert.deepEqual([...MARKET_STAT_SLOTS], ['rating', 'downloads', 'saves'], '槽位顺序写死：评分 / 下载 / 收藏（用户草图）');

  const full = statSegments({ downloads: 12, saves: 99, score: 100000 });
  assert.deepEqual(full.map((slot) => slot.slot), ['rating', 'downloads', 'saves'], '恒三元素，顺序与 MARKET_STAT_SLOTS 一致');
  assert.deepEqual(full.map((slot) => slot.present), [true, true, true], '三项齐全时三格都有内容');
  assert.deepEqual(full.map((slot) => slot.value), ['5.0', '12', '99'], '评分恒一位小数、计数走 compact');

  const bare = statSegments({});
  assert.deepEqual(bare.map((slot) => slot.present), [false, false, false], '什么都没有时三格都 absent（页面据此整行不渲染）');
  assert.deepEqual(bare.map((slot) => slot.value), [null, null, null], 'absent 的格没有值（不是 0、不是破折号）');

  const partial = statSegments({ downloads: 0, saves: null, score: null });
  assert.deepEqual(partial.map((slot) => slot.present), [false, true, false], '上游真给 0 的下载是 present');
  assert.equal(partial[1].value, '0', '真 0 显示 0');
  assert.equal(partial[0].labelKey, 'market.metaRating', '评分格用 market.metaRating');
  assert.equal(partial[1].labelKey, 'market.metaDownloads', '下载格用 market.metaDownloads');
  assert.equal(partial[2].labelKey, 'market.metaSaves', '收藏格用 market.metaSaves');
  assert.deepEqual(partial.map((slot) => slot.param), ['rating', 'count', 'count'], '插值名与字典占位符一致');
});

test('K79 ratingOf：score 折到 4.0–5.0，score<=0 与缺值都是 null', () => {
  assert.equal(ratingOf({ score: 100000 }), 5.0, '满分 ⇒ 5.0');
  assert.equal(ratingOf({ score: 95757.41562195931 }), 5.0, '实测高分四舍五入到 5.0');
  assert.equal(ratingOf({ score: 55385 }), 4.6, '实测中段 ⇒ 4.6');
  assert.equal(ratingOf({ score: 1 }), 4.0, '极小正分 ⇒ 4.0');
  assert.equal(ratingOf({ score: 500000 }), 5.0, '超过满分也夹到 5.0（min(1, …)）');
  assert.equal(ratingOf({ score: 0 }), null, '0 分 ⇒ null：4.0 是缺值伪装成的分数，绝不显示');
  assert.equal(ratingOf({ score: -5 }), null, '负分同理');
  assert.equal(ratingOf({ score: null }), null, '缺值 ⇒ null');
  assert.equal(ratingOf({}), null, '没有 score ⇒ null');
  assert.equal(ratingOf(null), null, 'null 不抛');
});

test('K79 ratingTextOf：恒一位小数、恒用点，不依赖 locale', () => {
  assert.equal(ratingTextOf(5), '5.0', '整数也要一位小数');
  assert.equal(ratingTextOf(4.6), '4.6', '小数照写');
  assert.equal(ratingTextOf(4.66), '4.7', 'toFixed 按一位小数四舍五入');
  assert.equal(ratingTextOf(null), null, '没有评分 ⇒ null（不写 0.0）');
  assert.equal(ratingTextOf(NaN), null, '非有限数 ⇒ null');
  // The one property that matters in a fixed-width slot: the separator never becomes a comma.
  assert.equal(ratingTextOf(4.6).includes(','), false, '分隔符恒为点（Intl 在 de/fr 会给出 4,6）');
  const previous = process.env.LANG;
  process.env.LANG = 'de_DE.UTF-8';
  try {
    assert.equal(ratingTextOf(4.6), '4.6', '改环境语言也不影响（toFixed 与 locale 无关）');
    assert.equal(statSegments({ score: 55385 })[0].value, '4.6', '整条链路都不走 locale');
  } finally {
    process.env.LANG = previous;
  }
});

test('K37 visibleCategories：选 ClawHub 时整行隐藏，bootstrap 失败时给说明，空表静默隐藏', () => {
  const categories = [{ key: 'dev-tools', name: '开发工具', nameEn: 'Dev tools' }];
  const sources = [
    { id: 'skillhub', hasCategories: true },
    { id: 'clawhub', hasCategories: false },
  ];
  assert.deepEqual(
    visibleCategories({ filters: { source: 'clawhub' }, sources, categories, categoriesOk: true }),
    { visible: false, unavailable: false, items: [] },
    '选 ClawHub 时分类行隐藏（它没有分类表）',
  );
  assert.deepEqual(
    visibleCategories({ filters: { source: 'skillhub' }, sources, categories, categoriesOk: true }),
    { visible: true, unavailable: false, items: categories },
    '选 SkillHub 时分类行可用',
  );
  assert.deepEqual(
    visibleCategories({ filters: { source: MARKET_DEFAULT_SOURCE }, sources, categories: [], categoriesOk: false }),
    { visible: false, unavailable: true, items: [] },
    'bootstrap 失败时隐藏并提示不可用',
  );
  assert.deepEqual(
    visibleCategories({ filters: { source: MARKET_DEFAULT_SOURCE }, sources, categories: [], categoriesOk: true }),
    { visible: false, unavailable: false, items: [] },
    '空分类表静默隐藏',
  );
  // 「全部来源」这个选项已删：filters.source 永远是某个真实源。缺省（undefined）应当按
  // default 源判，而不是当成「不过滤来源」。
  assert.deepEqual(
    visibleCategories({ filters: {}, sources, categories, categoriesOk: true }),
    { visible: true, unavailable: false, items: categories },
    '缺省来源按 MARKET_DEFAULT_SOURCE 判（SkillHub 有分类）',
  );
  assert.deepEqual(
    visibleCategories({ filters: { source: 'a-third-source' }, sources: [], categories, categoriesOk: true }),
    { visible: true, unavailable: false, items: categories },
    '未登记的第三个源默认有分类（除非它在已知无分类名单里）',
  );
  assert.deepEqual(
    visibleCategories({ filters: { source: 'clawhub' }, sources: [], categories, categoriesOk: true }),
    { visible: false, unavailable: false, items: [] },
    '没有来源描述符时也认得 ClawHub 无分类',
  );
});

test('K37 chipList：第一个是「全部」空值 chip，其余用中文名，缺 name 回落 nameEn / key', () => {
  const chips = chipList([
    { key: 'dev-tools', name: '开发工具', nameEn: 'Dev tools' },
    { key: 'writing', nameEn: 'Writing' },
    { key: 'other' },
  ]);
  assert.equal(chips[0].value, null, '第一个 chip 的机器值是 null（「全部」）');
  assert.equal(chips[0].label, '', '「全部」的文案由字典提供，不在数据里');
  assert.deepEqual(chips.slice(1).map((chip) => [chip.value, chip.label]), [
    ['dev-tools', '开发工具'],
    ['writing', 'Writing'],
    ['other', 'other'],
  ], 'name → nameEn → key 三级回落');
  const empty = chipList(null);
  assert.equal(empty.length, 1, '非数组时只有「全部」一个 chip');
  assert.equal(empty[0].value, null, '仍然是空值 chip');
  assert.equal(empty[0].label, '', '文案由字典给');
  assert.equal(empty[0].count, null, '没有 total 时不带数字');
});

test('K55 单源语义：市场一次只问一个源，缺省就是 MARKET_DEFAULT_SOURCE', () => {
  // 用户去掉了「全部来源」：菜单里只有真实源，默认停在 SkillHub。于是 queriedSources
  // 永远只有一个元素——扇出、部分失败提示条这些「多源」概念随之消失。
  const sources = [
    { id: 'skillhub', hasCategories: true },
    { id: 'clawhub', hasCategories: false },
  ];
  assert.equal(MARKET_DEFAULT_SOURCE, 'skillhub', '默认源是 SkillHub');
  assert.deepEqual(queriedSources({ sources, filters: {} }), ['skillhub'], '缺省 → 只问 SkillHub');
  assert.deepEqual(queriedSources({ sources, filters: { source: 'clawhub' } }), ['clawhub'], '选中哪个就只问哪个');
  assert.deepEqual(queriedSources({ sources: [], filters: { source: 'clawhub' } }), ['clawhub'], 'bootstrap 未答时也照用户选的问');
  assert.deepEqual(
    queriedSources({ sources, filters: { source: 'all' } }),
    ['all'],
    '不再有特殊值 all：它被当成一个普通源 id（路由会以 E_BAD_QUERY 拒掉，不是静默扇出）',
  );
  assert.deepEqual(
    pagedSources({ sources, filters: { source: 'skillhub' }, cursors: { skillhub: 'c2', clawhub: null } }),
    ['skillhub'],
    '有游标才翻页',
  );
  assert.deepEqual(
    pagedSources({ sources, filters: { source: 'skillhub' }, cursors: { skillhub: null } }),
    [],
    '游标为 null 表示该源已耗尽',
  );
  assert.deepEqual(
    pagedSources({ sources, filters: { source: 'clawhub' }, cursors: {} }),
    ['clawhub'],
    '还没有游标记录时（首屏）也算有下一页',
  );
});

test('K37 sourceDescriptors / sourceLabelOf / reasonKeyOf / marketKeyOf 的口径', () => {
  assert.deepEqual(
    sourceDescriptors({ sources: [] }).map((source) => source.id),
    ['skillhub', 'clawhub'],
    'bootstrap 未答时回落到内置两源',
  );
  assert.equal(MARKET_FALLBACK_SOURCES.length, 2, '内置兜底恰好两个源');
  assert.deepEqual(
    MARKET_FALLBACK_SOURCES.map((source) => source.labelKey),
    ['market.source.skillhub', 'market.source.clawhub'],
    '兜底描述符也带 i18n 键（文案不在代码里）',
  );
  assert.equal(sourceLabelOf('clawhub', t), 'market.source.clawhub', '来源名走字典键');
  assert.deepEqual(MARKET_SORTS, ['recommended', 'updated', 'downloads'], '三档排序与路由白名单一致');
  assert.equal(reasonKeyOf('E_ALREADY_INSTALLED'), 'error.E_ALREADY_INSTALLED', '市场错误码有自己的文案键');
  assert.equal(reasonKeyOf('E_WHATEVER'), 'error.E_UNKNOWN', '陌生态回落 E_UNKNOWN');
  assert.equal(marketKeyOf({ id: 'skillhub:ake:x' }), 'skillhub:ake:x', '有 id 时用 id');
  assert.equal(marketKeyOf({ sourceId: 'clawhub', owner: 'o', slug: 's' }), 'clawhub:o:s', '没有 id 时按三元组拼');
  assert.equal(marketKeyOf(null), '::', '非对象也不抛（每个字段按空串）');
});

test('K37 detailFacts：六行固定顺序，未知就说未知，installTo 用等宽体', () => {
  const market = { categories: [{ key: 'dev-tools', name: '开发工具' }] };
  const rows = detailFacts({
    item: { sourceId: 'skillhub', author: 'Ake', version: '1.0.0', downloads: 12, category: 'dev-tools' },
    installTo: '/Users/me/.dsh/skills/dev-god',
  }, market, t);
  assert.deepEqual(rows.map((row) => row.label), [
    'market.factSource', 'market.factAuthor', 'market.factVersion',
    'market.factDownloads', 'market.factCategory', 'market.factInstallTo',
  ], '六行顺序固定');
  assert.equal(rows[0].value, 'market.source.skillhub', '来源显示成人类可读的名字');
  assert.equal(rows[4].value, '开发工具', '分类显示成名字而不是 key');
  assert.equal(rows[5].code, true, '安装路径用 code 样式');
  assert.equal(rows.every((row) => row.value !== ''), true, '没有空白单元格');

  const unknownRows = detailFacts({ item: {}, installTo: null }, { categories: [] }, t);
  for (const row of unknownRows) {
    assert.equal(row.value, 'market.factUnknown', `${row.label} 未知时显示「未知」，不是空串`);
  }
});
