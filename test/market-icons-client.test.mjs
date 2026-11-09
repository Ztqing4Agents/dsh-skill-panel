/**
 * The client half of the icon pipeline: letters first, icons patched in afterwards.
 *
 * Contract: docs/contracts/client.md §3.9.1 (`icons` / `iconsTried`), §3.9.2 (the value
 * order `item.iconUrl` -> `market.icons[id]` -> null, constraint 8 "icon fill never blocks
 * rendering"), §3.9.3 (`marketIconsReady` / `marketIconsAttempted`); docs/contracts/market.md
 * §7.5; case id K61.
 *
 * The point of this layer is that a slow upstream cannot show up as a slow page: the card
 * renders from what the list already knows, and the icons arrive as a second, optional
 * pass whose failures are silent. Two properties carry that promise, and both are asserted
 * here: which entries get asked (exactly the ones that could still change), and the fact
 * that "asked and had no icon" is remembered so a page cannot ask twice per render.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { iconCandidates, iconUrlOf, marketKeyOf } from '../src/client/market-model.js';
import { createStore } from '../src/client/state.js';

/** One normalised market item. */
const item = (slug, extra = {}) => ({
  sourceId: 'clawhub',
  id: `clawhub:acme:${slug}`,
  owner: 'acme',
  slug,
  displayName: slug,
  iconUrl: null,
  summary: '',
  author: 'acme',
  version: null,
  downloads: null,
  updatedAt: null,
  category: null,
  packageKind: 'zip',
  ...extra,
});

/** A market slice with one loaded page. */
const marketWith = (items, extra = {}) => ({ items, icons: {}, iconsTried: {}, ...extra });

test('K61 取值优先级：item.iconUrl 先，market.icons 次，都没有就是 null', () => {
  const plain = item('plain');
  assert.equal(iconUrlOf(plain, marketWith([])), null, '两边都没有 ⇒ null（落首字母瓦片）');
  assert.equal(
    iconUrlOf(plain, marketWith([], { icons: { 'clawhub:acme:plain': 'api/dsh-skill-center/market/lucide?name=zap' } })),
    'api/dsh-skill-center/market/lucide?name=zap',
    '列表没带、批量补到了 ⇒ 用补到的那张',
  );
  const own = item('own', { iconUrl: 'https://cdn.example.com/own.png' });
  assert.equal(
    iconUrlOf(own, marketWith([], { icons: { 'clawhub:acme:own': 'api/dsh-skill-center/market/lucide?name=zap' } })),
    'https://cdn.example.com/own.png',
    '列表自带的优先于批量补的（不覆盖已知答案）',
  );
  assert.equal(iconUrlOf(item('blank', { iconUrl: '' }), marketWith([])), null, '空串按「没有」处理');
  assert.equal(iconUrlOf(null, marketWith([])), null, 'null 条目也不抛');
  assert.equal(iconUrlOf(plain, undefined), null, '没有 market 切片时退化为 null');
  // 键是 market id：`icons` 用同一套键，才不会在追加页/切来源后错位
  assert.equal(marketKeyOf(plain), 'clawhub:acme:plain', '键就是 id');
  assert.equal(marketKeyOf({ sourceId: 'clawhub', owner: 'acme', slug: 'x' }), 'clawhub:acme:x', '没有 id 时按源/作者/名拼');
});

test('K61 候选挑选：只挑 clawhub + 没图标 + 没问过 + owner/slug 齐全，且 ≤24', () => {
  const items = [
    item('a'),
    item('with-own', { iconUrl: 'https://cdn.example.com/a.png' }),
    item('skillhub-one', { sourceId: 'skillhub', id: 'skillhub:acme:skillhub-one' }),
    item('already-tried'),
    item('no-owner', { owner: null, id: 'clawhub:null:no-owner' }),
    item('empty-slug', { slug: '', id: 'clawhub:acme:' }),
  ];
  const market = marketWith(items, {
    icons: { 'clawhub:acme:a': 'api/dsh-skill-center/market/lucide?name=zap' },
    iconsTried: { 'clawhub:acme:already-tried': true },
  });
  const picked = iconCandidates(market);
  assert.deepEqual(picked.map((row) => row.slug), [], '这一批全都不可问：a 已补到、with-own 自带、skillhub 不管、already-tried 问过、no-owner/empty-slug 缺字段');

  const fresh = marketWith([
    item('one'),
    item('two'),
    item('skillhub-two', { sourceId: 'skillhub', id: 'skillhub:acme:skillhub-two' }),
    item('three'),
  ]);
  assert.deepEqual(
    iconCandidates(fresh).map((row) => ({ owner: row.owner, slug: row.slug, id: row.id })),
    [
      { owner: 'acme', slug: 'one', id: 'clawhub:acme:one' },
      { owner: 'acme', slug: 'two', id: 'clawhub:acme:two' },
      { owner: 'acme', slug: 'three', id: 'clawhub:acme:three' },
    ],
    '只挑缺图标的 ClawHub 条目，顺序与列表一致',
  );
  const many = marketWith(Array.from({ length: 40 }, (_, index) => item(`s-${index}`)));
  assert.equal(iconCandidates(many).length, 24, '默认上限 24（与路由的批量上限一致）');
  assert.equal(iconCandidates(many, 5).length, 5, '上限可传入（追加页/小批量）');
  assert.deepEqual(iconCandidates(marketWith([])), [], '没有条目就没有候选');
  assert.deepEqual(iconCandidates(undefined), [], '缺 market 切片也不抛');
});

test('K61 marketIconsReady：补到的写进 icons，null 也记 tried（同一 id 不反复问）', () => {
  const store = createStore();
  store.actions.marketPageAppended({ pages: [], merged: [item('one'), item('two'), item('three')] });

  store.actions.marketIconsReady({
    'clawhub:acme:one': 'api/dsh-skill-center/market/lucide?name=zap',
    'clawhub:acme:two': null,
  });
  const after = store.getSnapshot().market;
  assert.equal(after.icons['clawhub:acme:one'], 'api/dsh-skill-center/market/lucide?name=zap', '有图标的写进 icons');
  assert.equal(Object.hasOwn(after.icons, 'clawhub:acme:two'), false, 'null 不写进 icons（不留空值）');
  assert.deepEqual(
    after.iconsTried,
    { 'clawhub:acme:one': true, 'clawhub:acme:two': true },
    '两个都记 tried（「问过且没有」也是结论）',
  );
  // three 不在这一批里，仍然可问
  assert.deepEqual(iconCandidates(after).map((row) => row.slug), ['three'], '没被问过的条目仍是候选');

  // 空 batch 不改状态（不产生无意义的 render）
  const before = store.getSnapshot().market;
  store.actions.marketIconsReady({});
  assert.equal(store.getSnapshot().market, before, '空 batch 不改状态对象');
  store.actions.marketIconsReady(null);
  assert.equal(store.getSnapshot().market, before, 'null 也不改状态');
});

test('K61 marketIconsAttempted：整批失败只记 tried，静默、不碰 icons', () => {
  const store = createStore();
  store.actions.marketPageAppended({ pages: [], merged: [item('one'), item('two')] });
  const beforePage = store.getSnapshot().market.page;
  const beforeStatus = store.getSnapshot().market.listStatus;
  store.actions.marketIconsAttempted(['clawhub:acme:one', 'clawhub:acme:two']);
  const after = store.getSnapshot().market;
  assert.deepEqual(after.iconsTried, { 'clawhub:acme:one': true, 'clawhub:acme:two': true }, '失败的批次也记账');
  assert.deepEqual(after.icons, {}, '失败不该伪造图标');
  assert.deepEqual(iconCandidates(after), [], '同一页不会在每次 render 时重试失败批次');
  assert.equal(after.page, beforePage, '分页态一个字段都没动（图标是装饰，不进页面级错误）');
  assert.equal(after.listStatus, beforeStatus, '列表状态不受影响');

  const before = store.getSnapshot().market;
  store.actions.marketIconsAttempted([]);
  assert.equal(store.getSnapshot().market, before, '空数组不改状态');
  store.actions.marketIconsAttempted(['', null, 42]);
  assert.equal(store.getSnapshot().market, before, '非字符串/空串被过滤，不产生空键');
});

test('K61 marketReload 清空 icons 与 tried；切来源/搜索/追加页保留已拿到的图标', () => {
  const store = createStore();
  store.actions.marketPageAppended({ pages: [], merged: [item('one'), item('two')] });
  store.actions.marketIconsReady({
    'clawhub:acme:one': 'api/dsh-skill-center/market/lucide?name=zap',
    'clawhub:acme:two': null,
  });

  // 切来源
  store.actions.marketSetFilter({ sourceId: 'skillhub' });
  assert.deepEqual(Object.keys(store.getSnapshot().market.icons), ['clawhub:acme:one'], '切来源保留已拿到的图标');
  assert.equal(store.getSnapshot().market.iconsTried['clawhub:acme:two'], true, '切来源保留 tried');

  // 搜索
  store.actions.marketCommitKeyword('zap');
  assert.deepEqual(Object.keys(store.getSnapshot().market.icons), ['clawhub:acme:one'], '搜索保留已拿到的图标');

  // 追加页
  store.actions.marketPageAppended({ pages: [], merged: [item('one'), item('two'), item('three')] });
  assert.deepEqual(Object.keys(store.getSnapshot().market.icons), ['clawhub:acme:one'], '追加页保留已拿到的图标');
  assert.equal(store.getSnapshot().market.iconsTried['clawhub:acme:two'], true, '追加页保留 tried');

  // 页头刷新（= marketReload）：从头再来，图标缓存一起清
  store.actions.marketReload();
  assert.deepEqual(store.getSnapshot().market.icons, {}, '刷新清空 icons');
  assert.deepEqual(store.getSnapshot().market.iconsTried, {}, '刷新清空 tried');
  assert.deepEqual(store.getSnapshot().market.items, [], '刷新也清空列表');
});
