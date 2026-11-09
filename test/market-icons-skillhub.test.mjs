/**
 * `skillhubSource.icons()` — the SkillHub half of the icon batch.
 *
 * Contract: docs/contracts/routes.md §3.7.5 (per-source dispatch, per-source budget, keys
 * `skillhub:<owner>:<slug>`, absolute-https-only icons), market.md §7.5; case id K65 (L1).
 *
 * SkillHub answers icons one skill at a time (its list payload carries them, a detail
 * lookup is the only other way to ask), so this adapter is where "an installed row costs
 * one request" is either contained or not: six at a time, five seconds each, six seconds
 * for the whole batch, and a cache that makes a second pass free.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { resetSkillhubIconCache, skillhubSource } from '../lib/market/sources/skillhub.js';

/** A ref list, the shape the route hands the adapter. */
const refs = (...slugs) => slugs.map((slug) => ({ owner: 'ake', slug }));

/**
 * A fake upstream that answers detail lookups per slug.
 * @param {{icons?: Record<string, unknown>, failSlugs?: string[], delayMs?: number}} [options] - behaviour.
 * @returns {{io: object, calls: URL[], peak: () => number}} the client and its log.
 */
function fakeIo(options = {}) {
  const icons = options.icons ?? {};
  const displayNames = options.displayNames ?? {};
  const failSlugs = new Set(options.failSlugs ?? []);
  const calls = [];
  let live = 0;
  let peak = 0;
  return {
    calls,
    peak: () => peak,
    io: {
      /**
       * Answer one detail request.
       * @param {URL|string} url - request URL.
       * @returns {Promise<object>} parsed body.
       */
      async getJson(url) {
        const parsed = new URL(String(url));
        calls.push(parsed);
        live += 1;
        peak = Math.max(peak, live);
        try {
          if (options.delayMs !== undefined) await new Promise((resolve) => { setTimeout(resolve, options.delayMs); });
          const slug = decodeURIComponent(parsed.pathname.split('/').at(-1));
          if (failSlugs.has(slug)) throw new Error(`detail ${slug} down`);
          const iconUrl = Object.hasOwn(icons, slug) ? icons[slug] : null;
          const displayName = Object.hasOwn(displayNames, slug) ? displayNames[slug] : null;
          return { skill: { slug, iconUrl, displayName } };
        } finally {
          live -= 1;
        }
      },
    },
  };
}

test('K65 每条一次 detail、不带 version、两张图键按请求顺序', async () => {
  resetSkillhubIconCache();
  const { io, calls } = fakeIo({
    icons: { a: 'https://cdn.skillhub.cn/a.png', c: 'https://cdn.skillhub.cn/c.png' },
    displayNames: { c: 'C 技能' },
  });
  // 这条 detail 同时带回图标与标题：一次请求两条产出，出参是 `{icons, names}`（R9）
  const { icons: resolved, names } = await skillhubSource.icons(refs('c', 'a', 'b'), io);
  assert.deepEqual(Object.keys(resolved), ['skillhub:ake:c', 'skillhub:ake:a', 'skillhub:ake:b'], '图标键按请求顺序（不是完成顺序）');
  assert.deepEqual(Object.keys(names), Object.keys(resolved), '标题与图标逐键同序');
  assert.equal(resolved['skillhub:ake:c'], 'https://cdn.skillhub.cn/c.png', '有图的拿到');
  assert.equal(resolved['skillhub:ake:a'], 'https://cdn.skillhub.cn/a.png', '有图的拿到');
  assert.equal(resolved['skillhub:ake:b'], null, '没图的是 null，不是缺键');
  assert.equal(names['skillhub:ake:c'], 'C 技能', '上游给了标题就收下');
  assert.equal(names['skillhub:ake:a'], null, '没给标题 ⇒ 键在、值 null');
  assert.equal(calls.length, 3, '三条各问一次（标题搭顺风车，没有第二条请求）');
  for (const call of calls) {
    assert.equal(call.searchParams.get('version'), null, '不带 version（详情端点不要它）');
    assert.equal(call.searchParams.get('namespace'), 'ake', 'owner 走 namespace 参数');
    assert.equal(call.pathname.startsWith('/api/v1/skills/'), true, '详情路径');
  }
});

test('K65 并发 ≤ 6（7 条也不会 7 个同时在飞）', async () => {
  resetSkillhubIconCache();
  const { io, peak } = fakeIo({ delayMs: 25, icons: {} });
  await skillhubSource.icons(refs(...Array.from({ length: 7 }, (_, index) => `s-${index}`)), io);
  assert.ok(peak() <= 6, `并发不超过 6（实测 ${peak()}）`);
  assert.ok(peak() > 1, '确实是并发而不是串行');
});

test('K65 缓存：正向 10 分钟、负向 60 秒、命中不打上游、reset 清空', async () => {
  resetSkillhubIconCache();
  let at = 1_000_000;
  const clock = () => at;
  const first = fakeIo({ icons: { a: 'https://cdn.skillhub.cn/a.png' }, displayNames: { a: 'A 技能' } });
  const { icons: one, names: oneNames } = await skillhubSource.icons(refs('a', 'b'), first.io, { now: clock });
  assert.equal(one['skillhub:ake:a'], 'https://cdn.skillhub.cn/a.png', '第一次拿到');
  assert.equal(one['skillhub:ake:b'], null, '第一次没有');
  assert.equal(oneNames['skillhub:ake:a'], 'A 技能', '标题第一次也拿到');
  assert.equal(first.calls.length, 2, '两条都问了');

  // +5 分钟：a 命中正向缓存；b 的负数缓存（60s）已过期 ⇒ 只重问 b
  at += 5 * 60 * 1000;
  const second = fakeIo({ icons: { a: 'https://cdn.skillhub.cn/a2.png', b: 'https://cdn.skillhub.cn/b.png' } });
  const { icons: two, names: twoNames } = await skillhubSource.icons(refs('a', 'b'), second.io, { now: clock });
  assert.equal(second.calls.length, 1, '命中不打上游');
  assert.equal(second.calls[0].pathname.endsWith('/b'), true, '只重问了没有图的那条');
  assert.equal(two['skillhub:ake:a'], 'https://cdn.skillhub.cn/a.png', 'a 仍是缓存里那条');
  assert.equal(twoNames['skillhub:ake:a'], 'A 技能', '标题与图标一起命中（同一份缓存条目）');

  // +11 分钟：a 的正向缓存也过期
  at = 1_000_000 + 11 * 60 * 1000;
  const third = fakeIo({ icons: { a: 'https://cdn.skillhub.cn/a3.png' } });
  await skillhubSource.icons(refs('a'), third.io, { now: clock });
  assert.equal(third.calls.length, 1, '10 分钟后重新问');

  // reset（= 市场 bootstrap 的 ?refresh=1）
  resetSkillhubIconCache();
  const fourth = fakeIo({ icons: { a: 'https://cdn.skillhub.cn/a4.png' } });
  const four = await skillhubSource.icons(refs('a'), fourth.io, { now: clock });
  assert.equal(four.icons['skillhub:ake:a'], 'https://cdn.skillhub.cn/a4.png', '清缓存后取到新值');
});

test('K65 单条失败只 null（整批不抛），缺字段的条目连请求都不发', async () => {
  resetSkillhubIconCache();
  const { io, calls } = fakeIo({ icons: { ok: 'https://cdn.skillhub.cn/ok.png' }, failSlugs: ['boom'] });
  const { icons: resolved, names } = await skillhubSource.icons(
    [{ owner: 'ake', slug: 'boom' }, { owner: 'ake', slug: 'ok' }, { owner: '', slug: 'x' }, { owner: 'ake', slug: '' }, { owner: null, slug: 'y' }],
    io,
  );
  assert.equal(resolved['skillhub:ake:boom'], null, '失败的条目 null，不抛');
  assert.equal(resolved['skillhub:ake:ok'], 'https://cdn.skillhub.cn/ok.png', '旁边的条目照常');
  assert.equal(resolved['skillhub::x'], null, '空 owner 直接 null');
  assert.equal(resolved['skillhub:ake:'], null, '空 slug 直接 null');
  assert.equal(resolved['skillhub:null:y'], null, '非字符串 owner 直接 null');
  assert.equal(calls.length, 2, '只有两条合法条目发了请求');
  assert.deepEqual(Object.keys(names), Object.keys(resolved), '标题与图标同键（失败条目也留键）');
  assert.equal(Object.values(names).every((value) => value === null), true, '没有标题可收时全是 null');
});

test('K65 iconUrl 归一：只收绝对 https，http / 相对 / 非字符串 / 空串 ⇒ null', async () => {
  resetSkillhubIconCache();
  const { io } = fakeIo({
    icons: {
      https: 'https://cdn.skillhub.cn/x.png',
      http: 'http://cdn.skillhub.cn/x.png',
      relative: '/static/x.png',
      protocol: '//cdn.skillhub.cn/x.png',
      number: 42,
      empty: '',
      object: { url: 'https://cdn.skillhub.cn/x.png' },
      spaced: '   ',
    },
  });
  const { icons: resolved, names } = await skillhubSource.icons(
    refs('https', 'http', 'relative', 'protocol', 'number', 'empty', 'object', 'spaced'),
    io,
  );
  assert.equal(resolved['skillhub:ake:https'], 'https://cdn.skillhub.cn/x.png', '绝对 https 原样');
  for (const slug of ['http', 'relative', 'protocol', 'number', 'empty', 'object', 'spaced']) {
    assert.equal(resolved[`skillhub:ake:${slug}`], null, `${slug} ⇒ null（卡片留字母）`);
  }
  assert.deepEqual(Object.keys(names), Object.keys(resolved), '标题图键集合不受图标归一影响');
});

test('K65 整批 6 秒预算：超预算的条目 null，结果仍按顺序齐全', async () => {
  resetSkillhubIconCache();
  let at = 0;
  const { io } = fakeIo({ icons: {} });
  // 每次读时钟前进 2.5s：三批（6 条并发 6 ⇒ 一批）之后预算耗尽
  const clock = () => {
    at += 2500;
    return at;
  };
  const many = refs(...Array.from({ length: 8 }, (_, index) => `s-${index}`));
  const { icons: resolved, names } = await skillhubSource.icons(many, io, { now: clock });
  assert.equal(Object.keys(resolved).length, 8, '八条都在结果里');
  assert.equal(Object.values(resolved).every((value) => value === null), true, '预算耗尽后图标都是 null');
  assert.equal(Object.keys(names).length, 8, '标题图也是八条（超预算也留键）');
  assert.equal(Object.values(names).every((value) => value === null), true, '预算耗尽后标题也都是 null');
});
