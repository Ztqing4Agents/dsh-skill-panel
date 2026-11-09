/**
 * `lib/market/sources/skillhub.js` — the per-category counts behind the chip numbers.
 *
 * Contract: docs/contracts/routes.md §3.7.1 (`bootstrap` payload: `categories[].count`,
 * `total`, `countsOk`) and §3.7.2 (the counts budgets: 6s per item, 10s overall,
 * concurrency 6, ten-minute cache, one failed item never fails the request);
 * docs/contracts/client.md §3.9.1 rule 6 (what the chips do with those numbers);
 * case id K53.
 *
 * Two things are worth pinning here, because both are easy to "optimise" back into a bug:
 *   1. the cost is 13 upstream requests (one per category + the grand total) and they run
 *      with a bounded number of workers, not all at once;
 *   2. a category nobody could count becomes null and `ok` goes false — and a partial pass
 *      is **not** cached, because caching it would hide the missing numbers for ten minutes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { resetCategoryCache, resetCountCache, skillhubSource } from '../lib/market/sources/skillhub.js';

/** A small category table, in upstream order. */
const CATEGORIES = [
  { key: 'office', name: '办公效率', nameEn: 'Office' },
  { key: 'writing', name: '内容创作', nameEn: 'Writing' },
  { key: 'dev-tools', name: '开发编程', nameEn: 'Dev tools' },
  { key: 'pay-skill', name: '付费技能', nameEn: 'Paid' },
];

/**
 * Build an upstream client that answers the category table and the counts.
 * @param {{perCategory?: Record<string, number|string>, total?: number|string,
 *   failKeys?: string[], failAll?: boolean, categoriesFail?: boolean}} [options] - behaviour.
 * @returns {{io: object, calls: string[], inflight: () => number, maxInflight: () => number}} the client and its log.
 */
function fakeIo(options = {}) {
  const calls = [];
  const failKeys = new Set(options.failKeys ?? []);
  let live = 0;
  let peak = 0;
  let peakAll = 0;
  const io = {
    /**
     * Answer one GET.
     * @param {URL|string} url - the request URL.
     * @returns {Promise<object>} the parsed body.
     */
    async getJson(url) {
      const parsed = new URL(String(url));
      calls.push(parsed.pathname + (parsed.search || ''));
      live += 1;
      peak = Math.max(peak, live);
      peakAll = Math.max(peakAll, live);
      try {
        if (parsed.pathname === '/api/v1/categories') {
          if (options.categoriesFail === true) throw new Error('categories down');
          return { items: CATEGORIES };
        }
        // 计数请求：pageSize=1，靠 data.total 拿数量
        assert.equal(parsed.searchParams.get('pageSize'), '1', '计数请求一律 pageSize=1');
        const category = parsed.searchParams.get('category');
        await new Promise((resolve) => { setTimeout(resolve, 1); });
        if (category === null) {
          if (options.failAll === true) throw new Error('count down');
          return { data: { total: options.total ?? 2540000 } };
        }
        if (failKeys.has(category)) throw new Error(`count ${category} down`);
        const value = options.perCategory?.[category] ?? 100;
        return { data: { total: value } };
      } finally {
        live -= 1;
      }
    },
  };
  return { io, calls, inflight: () => peak, maxInflight: () => peakAll, peakReset: () => { peak = 0; } };
}

/**
 * Count the requests that asked for a category.
 * @param {string[]} calls - the log.
 * @returns {number} how many.
 */
const countRequests = (calls) => calls.filter((call) => call.startsWith('/api/skills')).length;

test('K53 counts：13 个请求（12 类 + 全部），每类一次、pageSize=1，并发有上限', async () => {
  resetCategoryCache();
  resetCountCache();
  const { io, calls } = fakeIo({ perCategory: { office: 137000, writing: 0 } });
  const result = await skillhubSource.counts(io);
  assert.equal(result.ok, true, '全部拿到 ⇒ ok');
  assert.equal(countRequests(calls), CATEGORIES.length - 1 + 1, '可见分类各一次 + 一次「全部」= 13（pay-skill 被隐藏）');
  assert.equal(result.total, 2540000, 'total 来自不带 category 的那次');
  assert.equal(result.counts.office, 137000, '办公效率 137000');
  assert.equal(result.counts.writing, 0, '真实的 0 原样保留（不是 null）');
  assert.equal(result.counts['pay-skill'], undefined, '隐藏分类不计数（chips 里也不显示）');
  assert.deepEqual(Object.keys(result.counts).sort(), ['dev-tools', 'office', 'writing'], '只有可见分类');
  assert.equal(result.cached, false, '首次不是缓存');
});

test('K53 counts：一个分类失败 ⇒ 它是 null、ok=false，其余照常，且这一轮不进缓存', async () => {
  resetCategoryCache();
  resetCountCache();
  const first = fakeIo({ failKeys: ['office'] });
  const partial = await skillhubSource.counts(first.io);
  assert.equal(partial.ok, false, '缺一个数 ⇒ ok:false（路由据此给 countsOk:false）');
  assert.equal(partial.counts.office, null, '失败的那个分类是 null');
  assert.equal(partial.counts.writing, 100, '其余分类照常拿数');
  assert.equal(partial.total, 2540000, '总数不受影响');

  // 不进缓存：下一次必须重新问（否则缺失的数字会被藏 10 分钟）
  const second = fakeIo({ perCategory: { office: 42 } });
  const retried = await skillhubSource.counts(second.io, { now: () => Date.now() });
  assert.equal(retried.cached, false, '上一轮不完整 ⇒ 不命中缓存');
  assert.equal(retried.counts.office, 42, '重试后拿到真数');
  assert.equal(retried.ok, true, '完整的一轮 ⇒ ok');
  assert.equal(countRequests(second.calls), CATEGORIES.length - 1 + 1, '重试时重新发满 13 个请求');
});

test('K53 counts：10 分钟缓存——TTL 内不再请求，TTL 外重新问', async () => {
  resetCategoryCache();
  resetCountCache();
  let at = 1_000_000;
  const first = fakeIo({ perCategory: { office: 7 } });
  const one = await skillhubSource.counts(first.io, { now: () => at });
  assert.equal(one.ok, true, '第一轮完整');
  assert.equal(one.cached, false, '第一轮不是缓存');

  const second = fakeIo({ perCategory: { office: 999 } });
  at += 60_000;
  const two = await skillhubSource.counts(second.io, { now: () => at });
  assert.equal(two.cached, true, '1 分钟后命中缓存');
  assert.equal(countRequests(second.calls), 0, '命中缓存时一个上游请求都不发');
  assert.equal(two.counts.office, 7, '返回的是缓存里的数');

  at += 10 * 60 * 1000;
  const three = await skillhubSource.counts(second.io, { now: () => at });
  assert.equal(three.cached, false, '过了 10 分钟重新问');
  assert.equal(three.counts.office, 999, '拿到新数');

  // refresh 绕过缓存（路由的 ?refresh=1 调试开关）
  resetCountCache();
  const forced = await skillhubSource.counts(second.io, { now: () => at, refresh: true });
  assert.equal(forced.cached, false, 'refresh=true 绕过缓存');
});

test('K53 counts：上游给不出 data.total ⇒ 该项 null，不猜 0', async () => {
  resetCategoryCache();
  resetCountCache();
  const { io } = fakeIo({ total: 'nope' });
  const result = await skillhubSource.counts(io);
  assert.equal(result.total, null, '「全部」拿不到数就是 null');
  assert.equal(result.ok, false, '有一个没拿到 ⇒ ok:false');
  assert.equal(result.counts.office, 100, '分类照常');
});

test('K53 counts：分类表都读不到时只发一个 total 请求，其余全 null', async () => {
  resetCategoryCache();
  resetCountCache();
  const { io, calls } = fakeIo({ categoriesFail: true });
  const result = await skillhubSource.counts(io);
  assert.deepEqual(result.counts, {}, '没有分类就没有分类数字');
  assert.equal(result.total, 2540000, '总数仍能拿到（它不依赖分类表）');
  assert.equal(result.ok, true, '没有缺失的分类 ⇒ ok 仍为 true');
  assert.equal(countRequests(calls), 1, '只发了一个「全部」请求');
});

test('K53 resetCountCache 清掉缓存（测试与 refresh 共用这个出口）', async () => {
  resetCategoryCache();
  resetCountCache();
  const at = 5_000_000;
  const first = fakeIo({ perCategory: { office: 1 } });
  await skillhubSource.counts(first.io, { now: () => at });
  resetCountCache();
  const second = fakeIo({ perCategory: { office: 2 } });
  const after = await skillhubSource.counts(second.io, { now: () => at });
  assert.equal(after.cached, false, '清掉之后重新请求');
  assert.equal(after.counts.office, 2, '拿到新值');
});
