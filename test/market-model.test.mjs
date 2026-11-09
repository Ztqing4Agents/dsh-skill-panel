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
  SOURCE_ALL,
  chipList,
  detailFacts,
  emptyKindOf,
  installViewOf,
  marketKeyOf,
  mergeBatches,
  metaSegments,
  pagedSources,
  queriedSources,
  reasonKeyOf,
  sourceDescriptors,
  sourceLabelOf,
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

test('K37 mergeBatches：两源 1:1 交错，各自顺序不动（跨源不可比）', () => {
  const a = [item({ id: 'skillhub:a:1' }), item({ id: 'skillhub:a:2' }), item({ id: 'skillhub:a:3' })];
  const b = [item({ sourceId: 'clawhub', id: 'clawhub:b:1' }), item({ sourceId: 'clawhub', id: 'clawhub:b:2' })];
  const merged = mergeBatches([{ sourceId: 'skillhub', items: a }, { sourceId: 'clawhub', items: b }]);
  assert.deepEqual(merged.map((entry) => entry.id), [
    'skillhub:a:1', 'clawhub:b:1',
    'skillhub:a:2', 'clawhub:b:2',
    'skillhub:a:3',
  ], '一轮一轮来：先两源各一张，再各一张，最后一源剩的那张');
});

test('K37 mergeBatches：一源先干涸时让位给另一源（不空转、不丢卡）', () => {
  const a = [item({ id: 'skillhub:a:1' })];
  const b = [item({ sourceId: 'clawhub', id: 'clawhub:b:1' }), item({ sourceId: 'clawhub', id: 'clawhub:b:2' }), item({ sourceId: 'clawhub', id: 'clawhub:b:3' })];
  const merged = mergeBatches([{ sourceId: 'skillhub', items: a }, { sourceId: 'clawhub', items: b }]);
  assert.deepEqual(merged.map((entry) => entry.id), [
    'skillhub:a:1', 'clawhub:b:1', 'clawhub:b:2', 'clawhub:b:3',
  ], 'skillhub 没了就让 clawhub 把这一轮剩下的一次填完');
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

test('K37 mergeBatches：sort=updated 时整表按时间降序，未知时间排最后且稳定', () => {
  const older = item({ id: 'skillhub:a:old', updatedAt: 100 });
  const newer = item({ sourceId: 'clawhub', id: 'clawhub:b:new', updatedAt: 300 });
  const unknown = item({ id: 'skillhub:a:unknown', updatedAt: null });
  const sameAsOlder = item({ sourceId: 'clawhub', id: 'clawhub:b:old', updatedAt: 100 });
  const merged = mergeBatches(
    [
      { sourceId: 'skillhub', items: [older, unknown] },
      { sourceId: 'clawhub', items: [newer, sameAsOlder] },
    ],
    { sort: 'updated' },
  );
  assert.deepEqual(merged.map((entry) => entry.id), [
    'clawhub:b:new', 'skillhub:a:old', 'clawhub:b:old', 'skillhub:a:unknown',
  ], '新的在前；时间相同的按交错后的原序；未知时间排最后');
});

test('K37 mergeBatches：页为空 / 参数缺失都不抛，已有项原样保留', () => {
  const existing = [item({ id: 'skillhub:ake:k' })];
  assert.deepEqual(mergeBatches([], { existing }).map((entry) => entry.id), ['skillhub:ake:k'], '没有新页时只留已有项');
  assert.deepEqual(mergeBatches(undefined, {}), [], '非数组入参当空处理');
  assert.deepEqual(mergeBatches([{ sourceId: 'x' }], {}), [], '页里没有 items 也不报错');
});

test('K37 短页不等于耗尽：next 非 null 时 pagedSources 仍要这个源（短页 + 游标前进）', () => {
  const store = createStore();
  store.actions.marketListLoading();
  // ClawHub 实际会这样：limit=12 只回 1 条，但 nextCursor 非空。
  store.actions.marketPageAppended({
    pages: [
      { sourceId: 'skillhub', page: { items: [], next: null } },
      { sourceId: 'clawhub', page: { items: [item({ sourceId: 'clawhub', id: 'clawhub:ake:only' })], next: 'cursor-2' } },
    ],
    merged: [item({ sourceId: 'clawhub', id: 'clawhub:ake:only' })],
  });
  const market = store.getSnapshot().market;
  assert.equal(market.page.status, 'more', '还有下一页');
  assert.equal(market.exhausted.clawhub, false, '短页的源没有判成耗尽');
  assert.equal(market.exhausted.skillhub, true, 'next=null 的源才算耗尽');
  assert.deepEqual(pagedSources(market), ['clawhub'], '下一次追加只问还有游标的那个源');
  assert.equal(MARKET_PAGE_SIZE, 12, '每源 12 条（双源一屏 24 张）');
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

test('K37 metaSegments：缺一项就少一段，下载数绝不补 0', () => {
  assert.deepEqual(
    metaSegments({ author: 'Ake', version: '1.0.0', downloads: 12 }).map((segment) => segment.key),
    ['market.metaAuthor', 'market.metaVersion', 'market.metaDownloads'],
    '三项齐全时按作者 / 版本 / 下载数排列',
  );
  assert.deepEqual(
    metaSegments({ author: 'Ake', version: null, downloads: null }).map((segment) => segment.key),
    ['market.metaAuthor'],
    '缺版本与下载数时只剩作者（不渲染 "0 次下载"）',
  );
  assert.deepEqual(metaSegments({}), [], '什么都没有时整行不渲染');
  assert.deepEqual(metaSegments(null), [], '非对象也不抛');
  assert.deepEqual(
    metaSegments({ downloads: 0 }).map((segment) => [segment.key, segment.value]),
    [['market.metaDownloads', '0']],
    '上游真给了 0 才显示 0',
  );
  assert.deepEqual(
    metaSegments({ downloads: 42 }).map((segment) => segment.param),
    ['count'],
    '下载数的插值名是 count（与 locale 占位符一致）',
  );
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
    visibleCategories({ filters: { source: SOURCE_ALL }, sources, categories: [], categoriesOk: false }),
    { visible: false, unavailable: true, items: [] },
    'bootstrap 失败时隐藏并提示不可用',
  );
  assert.deepEqual(
    visibleCategories({ filters: { source: SOURCE_ALL }, sources, categories: [], categoriesOk: true }),
    { visible: false, unavailable: false, items: [] },
    '空分类表静默隐藏',
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
  assert.deepEqual(chipList(null), [{ value: null, label: '' }], '非数组时只有「全部」一个 chip');
});

test('K37 queriedSources / pagedSources：选「全部」时扇出两个源，选单个时只问那个', () => {
  const sources = [
    { id: 'skillhub', hasCategories: true },
    { id: 'clawhub', hasCategories: false },
  ];
  assert.deepEqual(queriedSources({ sources, filters: { source: SOURCE_ALL } }), ['skillhub', 'clawhub'], '全部来源 ⇒ 两源');
  assert.deepEqual(queriedSources({ sources, filters: { source: 'clawhub' } }), ['clawhub'], '选单个源 ⇒ 只问它');
  assert.deepEqual(queriedSources({ sources: [], filters: { source: SOURCE_ALL } }), ['skillhub', 'clawhub'], 'bootstrap 未答时用内置两源');
  assert.deepEqual(
    pagedSources({ sources, filters: { source: SOURCE_ALL }, cursors: { skillhub: 'c2', clawhub: null } }),
    ['skillhub'],
    '只剩有游标的源',
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
