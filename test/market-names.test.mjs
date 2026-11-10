/**
 * K72 - which string a row shows: `rowTitleOf` and the title cache behind it.
 *
 * Three levels, in order: the upstream title (`market.names`, filled by a batch), the
 * local `metadata.displayName` from the row itself, and finally the kebab directory name
 * the model invokes the skill by. A row without an upstream identity never looks at the
 * cache at all.
 *
 * Contract: docs/contracts/client.md §3.9.6, docs/contracts/data-model.md §3.2.1,
 * docs/contracts/acceptance.md 附录 D.6 K72.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { iconCandidates, marketKeyOf, nameFor, nameSeeds, rowTitleOf } from '../src/client/market-model.js';
import { createStore } from '../src/client/state.js';

/** An upstream identity for `dev-expert-pro`. */
const UPSTREAM = { sourceId: 'skillhub', owner: 'indiv-integrator', slug: 'dev-expert-pro' };
const KEY = 'skillhub:indiv-integrator:dev-expert-pro';

/**
 * A row as the list route returns it.
 * @param {object} [options] - overrides.
 * @returns {object} the row.
 */
function row(options = {}) {
  return {
    name: 'dev-expert-pro',
    displayName: options.displayName,
    description: 'x',
    partition: 'installed',
    upstream: options.upstream === undefined ? UPSTREAM : options.upstream,
    ...options,
  };
}

/**
 * A market slice with titles (and nothing else) in it.
 * @param {Record<string, string>} names - key → title.
 * @returns {object} the slice.
 */
const marketWith = (names) => ({ names, icons: {}, iconsTried: {}, items: [] });

test('K72 三级优先：缓存标题 > 本地 metadata.displayName > kebab 名', () => {
  assert.equal(rowTitleOf(row(), marketWith({ [KEY]: '编程专家Pro.Skill' })), '编程专家Pro.Skill', '第一级：上游标题');
  assert.equal(rowTitleOf(row({ displayName: '本地名' }), marketWith({ [KEY]: '上游名' })), '上游名', '上游标题压过本地名');
  assert.equal(rowTitleOf(row({ displayName: '本地名' }), marketWith({})), '本地名', '第二级：本地 metadata.displayName');
  assert.equal(rowTitleOf(row(), marketWith({})), 'dev-expert-pro', '第三级：kebab 目录名');
  assert.equal(rowTitleOf(row({ displayName: '' }), marketWith({})), 'dev-expert-pro', '空串不算有本地名');
  assert.equal(rowTitleOf(row({ displayName: 42 }), marketWith({})), 'dev-expert-pro', '非字符串不算有本地名');
  assert.equal(rowTitleOf(row({ displayName: '   ' }), marketWith({})), '   ', '纯空白仍算有值（与图标链路同一口径，不 trim）');
});

test('K72 没有上游身份时跳过第一级，且一次都不碰缓存', () => {
  const touched = [];
  const names = new Proxy({}, {
    get(target, property) {
      touched.push(String(property));
      return target[property];
    },
    has(target, property) {
      touched.push(`has:${String(property)}`);
      return property in target;
    },
    ownKeys(target) {
      touched.push('ownKeys');
      return Reflect.ownKeys(target);
    },
  });
  const market = { names, icons: {}, iconsTried: {}, items: [] };
  assert.equal(rowTitleOf(row({ upstream: null, displayName: '本地名' }), market), '本地名', '直接走第二级');
  assert.equal(rowTitleOf(row({ upstream: null }), market), 'dev-expert-pro', '再不行走 kebab');
  assert.deepEqual(touched, [], '没有 upstream ⇒ 连 `names` 都不读（缓存里不可能有它的键）');
});

test('K72 nameFor：只认非空字符串，缺键/空串/null 都是「没有」', () => {
  assert.equal(nameFor(KEY, marketWith({ [KEY]: '标题' })), '标题', '正常命中');
  assert.equal(nameFor(KEY, marketWith({ [KEY]: '' })), null, '空串 ⇒ null');
  assert.equal(nameFor(KEY, marketWith({ [KEY]: '   ' })), '   ', '纯空白算有值');
  assert.equal(nameFor(KEY, marketWith({})), null, '缺键 ⇒ null');
  assert.equal(nameFor(KEY, { names: { [KEY]: null } }), null, 'null ⇒ null');
  assert.equal(nameFor(KEY, { names: { [KEY]: 42 } }), null, '非字符串 ⇒ null');
  assert.equal(nameFor('', marketWith({ '': 'x' })), null, '空键 ⇒ null');
  assert.equal(nameFor(null, marketWith({ [KEY]: 'x' })), null, '非字符串键 ⇒ null');
  assert.equal(nameFor(KEY, undefined), null, '缺 market 切片 ⇒ null');
  assert.equal(nameFor(KEY, { names: undefined }), null, '缺 names ⇒ null');
});

test('K72 nameSeeds：市场条目自带的 displayName 播种，幂等，不写 iconsTried', () => {
  const item = (slug, displayName) => ({ sourceId: 'skillhub', owner: 'ake', slug, displayName });
  const market = {
    items: [item('dev-god', 'Dev God'), item('blank', ''), item('missing', undefined), item('number', 42)],
    names: {},
    icons: {},
    iconsTried: {},
  };
  assert.deepEqual(nameSeeds(market), { 'skillhub:ake:dev-god': 'Dev God' }, '只有非空字符串那条被播种');
  assert.equal(nameSeeds({ items: [], names: {} }), null, '没有条目 ⇒ null（不是 {}）');
  assert.equal(nameSeeds(undefined), null, '缺 market 切片 ⇒ null');
  // 已有同键 ⇒ 不再播
  assert.equal(nameSeeds({ ...market, names: { 'skillhub:ake:dev-god': '别的名字' } }), null, '缓存里已有 ≥ 不重复播种');

  const store = createStore();
  store.actions.marketPageAppended({ pages: [], merged: market.items });
  store.actions.marketNamesSeeded(nameSeeds(store.getSnapshot().market));
  const after = store.getSnapshot().market;
  assert.equal(after.names['skillhub:ake:dev-god'], 'Dev God', '播种进了会话缓存');
  assert.deepEqual(after.iconsTried, {}, '播种**不写** iconsTried（它不是「问过」）');
  assert.equal(nameSeeds(after), null, '播种之后无事可做（幂等）');
  assert.deepEqual(iconCandidates(after), [], '标题播种不影响图标候选');

  // 不覆盖已有值
  store.actions.marketNamesSeeded({ 'skillhub:ake:dev-god': '别的名字', 'skillhub:ake:second': 'Second' });
  const merged = store.getSnapshot().market;
  assert.equal(merged.names['skillhub:ake:dev-god'], 'Dev God', '已有的键不被覆盖');
  assert.equal(merged.names['skillhub:ake:second'], 'Second', '新键照常补上');

  // 空/坏输入不改状态对象
  const before = store.getSnapshot().market;
  for (const bad of [null, undefined, {}, { a: null }, { a: '' }, { a: 42 }, 'nope', []]) {
    store.actions.marketNamesSeeded(bad);
    assert.equal(store.getSnapshot().market, before, `${JSON.stringify(bad)} ⇒ 不改状态`);
  }
});

test('K72 marketNamesReady：批次回来的标题可覆盖种子，null 不拖住别人', () => {
  const store = createStore();
  store.actions.marketNamesSeeded({ [KEY]: '播种名' });
  store.actions.marketNamesReady({ [KEY]: '上游真名', 'skillhub:ake:other': null, 'skillhub:ake:third': 'Third' });
  const after = store.getSnapshot().market;
  assert.equal(after.names[KEY], '上游真名', '批次是真源，覆盖播种值');
  assert.equal(Object.hasOwn(after.names, 'skillhub:ake:other'), false, 'null 不写进缓存（不留空壳键）');
  assert.equal(after.names['skillhub:ake:third'], 'Third', '有值的照常写');
  assert.deepEqual(after.iconsTried, {}, '标题回填不动 iconsTried');
  const before = store.getSnapshot().market;
  store.actions.marketNamesReady(null);
  store.actions.marketNamesReady({});
  store.actions.marketNamesReady({ a: null });
  assert.equal(store.getSnapshot().market, before, '空批次不改状态对象');
});

test('K72 marketReload 保留标题与图标缓存（按身份键的答案，只清分页）', () => {
  const store = createStore();
  store.actions.marketNamesSeeded({ [KEY]: '播种名' });
  store.actions.marketIconsReady({ [KEY]: 'https://cdn.example.com/x.png' });
  assert.equal(store.getSnapshot().market.names[KEY], '播种名', '刷新前有标题');
  store.actions.marketReload();
  const after = store.getSnapshot().market;
  // U13：页头刷新不再让标题与头像退回原样（那会让卡片一行字/一个头像跳一次）。
  assert.deepEqual(after.names, { [KEY]: '播种名' }, '刷新后标题留着');
  assert.deepEqual(after.icons, { [KEY]: 'https://cdn.example.com/x.png' }, '图标也留着');
  assert.equal(after.pages, 0, '只有分页被清空');
  assert.equal(rowTitleOf(row(), after), '播种名', '缓存还在 ⇒ 行标题不回落 kebab 名');
  assert.equal(marketKeyOf(UPSTREAM), KEY, '键的形状：source:owner:slug');
});
