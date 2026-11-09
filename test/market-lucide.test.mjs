/**
 * The Lucide icon proxy: the one route that does not answer the JSON envelope.
 *
 * Contract: docs/contracts/routes.md §3.7.1 route #10 (`/market/lucide`), §3.7.2 (icon
 * proxy budgets: 5s per fetch, 32 KiB ceiling, 1h hit cache, 60s miss cache, pinned
 * `lucide-static` version); docs/contracts/market.md §7.6; case id K58.
 *
 * Why a proxy at all: ClawHub names its glyphs (`lucide:Zap`) instead of pointing at an
 * image, and the browser half may not talk to a third origin (hard rule 13). So the Host
 * fetches the SVG and serves it from its own origin, document-relative.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LUCIDE_CDN,
  LUCIDE_MAX_BYTES,
  LUCIDE_MISS_TTL_MS,
  LUCIDE_TIMEOUT_MS,
  LUCIDE_TTL_MS,
  createLucideIcons,
  isLucideName,
} from '../lib/market/upstream.js';

/** A tiny SVG document, shaped like a Lucide icon. */
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>');

/**
 * A fake byte client.
 * @param {{bytes?: Buffer|null, type?: string, throwFor?: string[]}} [options] - behaviour.
 * @returns {{io: object, calls: object[]}} the client and its log.
 */
function fakeIo(options = {}) {
  const calls = [];
  const io = {
    /**
     * Answer one binary GET.
     * @param {string} url - request URL.
     * @param {object} callOptions - budget.
     * @returns {Promise<{body: Buffer, headers: object}>} response.
     */
    async getBytes(url, callOptions) {
      calls.push({ url, ...callOptions });
      const name = url.split('/').at(-1).replace(/\.svg$/, '');
      if ((options.throwFor ?? []).includes(name)) throw Object.assign(new Error('upstream down'), { code: 'E_SOURCE_UNAVAILABLE' });
      const bytes = options.bytes === undefined ? SVG : options.bytes;
      if (bytes === null) return { body: Buffer.alloc(0), headers: { 'content-type': 'text/plain' } };
      return { body: bytes, headers: { 'content-type': options.type ?? 'image/svg+xml' } };
    },
  };
  return { io, calls };
}

test('K58 常量：钉版 CDN、5s 预算、32 KiB 上限、1h 命中 / 60s 未命中缓存', () => {
  assert.equal(LUCIDE_CDN, 'https://cdn.jsdelivr.net/npm/lucide-static@1.70.0/icons', '版本钉死（不许 latest）');
  assert.equal(LUCIDE_TIMEOUT_MS, 5000, '单次抓取 5 秒');
  assert.equal(LUCIDE_MAX_BYTES, 32 * 1024, '32 KiB 上限（一个 SVG 只有几百字节）');
  assert.equal(LUCIDE_TTL_MS, 60 * 60 * 1000, '命中缓存 1 小时');
  assert.equal(LUCIDE_MISS_TTL_MS, 60 * 1000, '未命中只记 1 分钟（CDN 抖一下不该把 404 钉一小时）');
  for (const name of ['zap', 'file-text', 'a1', 'a-b-c-d-e-f']) {
    assert.equal(isLucideName(name), true, `${name} 是合法图标名`);
  }
  for (const name of ['', 'Zap', '../x', 'a--b', 'a/b', 'a-b-c-d-e-f-g', null, 42]) {
    assert.equal(isLucideName(name), false, `${JSON.stringify(name)} 不是合法图标名`);
  }
});

test('K58 命中：抓一次 CDN，返回 SVG 字节，并带上两条预算参数', async () => {
  const { io, calls } = fakeIo();
  const lucide = createLucideIcons(io, { now: () => 1000 });
  const bytes = await lucide.get('zap');
  assert.deepEqual(bytes, SVG, '拿到的就是 SVG 字节');
  assert.equal(calls.length, 1, '只发了一次');
  assert.equal(calls[0].url, `${LUCIDE_CDN}/zap.svg`, 'URL 是钉版 CDN + 名字 + .svg');
  assert.equal(calls[0].timeoutMs, LUCIDE_TIMEOUT_MS, '带上了 5s 预算');
  assert.equal(calls[0].maxBytes, LUCIDE_MAX_BYTES, '带上了 32 KiB 上限');
  assert.equal(lucide.size(), 1, '缓存里有一条');
});

test('K58 缓存：1 小时内不再请求；未命中也进缓存但只有 60 秒', async () => {
  let at = 0;
  const hit = fakeIo();
  const lucide = createLucideIcons(hit.io, { now: () => at });
  await lucide.get('zap');
  at += 59 * 60 * 1000;
  assert.deepEqual(await lucide.get('zap'), SVG, '59 分钟内仍然命中');
  assert.equal(hit.calls.length, 1, '1 小时内只请求一次');
  at += 2 * 60 * 1000;
  await lucide.get('zap');
  assert.equal(hit.calls.length, 2, '过了 1 小时重新取');

  // 未命中（上游 404 / CDN 挂了 / content-type 不对）只记 1 分钟
  let at2 = 0;
  const miss = fakeIo({ bytes: null });
  const lucide2 = createLucideIcons(miss.io, { now: () => at2 });
  assert.equal(await lucide2.get('nope'), null, '没有这个图标 ⇒ null');
  at2 += 30 * 1000;
  assert.equal(await lucide2.get('nope'), null, '30 秒内直接返回缓存的 null');
  assert.equal(miss.calls.length, 1, '30 秒内没有再次请求');
  at2 += 40 * 1000;
  await lucide2.get('nope');
  assert.equal(miss.calls.length, 2, '超过 60 秒会重试（CDN 恢复后能自动补上）');
});

test('K58 只收 image/svg+xml：上游给别的类型就当没有（不把 HTML 当图发给浏览器）', async () => {
  const { io, calls } = fakeIo({ type: 'text/html' });
  const lucide = createLucideIcons(io, { now: () => 0 });
  assert.equal(await lucide.get('zap'), null, 'content-type 不是 svg ⇒ null');
  assert.equal(calls.length, 1, '仍然请求了（只是不接受结果）');
  const again = createLucideIcons(fakeIo({ type: 'IMAGE/SVG+XML; charset=utf-8' }).io, { now: () => 0 });
  assert.deepEqual(await again.get('zap'), SVG, '大小写与 charset 都不影响判断');
});

test('K58 上游失败不抛：返回 null，路由据此给 404', async () => {
  const { io } = fakeIo({ throwFor: ['zap'] });
  const lucide = createLucideIcons(io, { now: () => 0 });
  assert.equal(await lucide.get('zap'), null, '网络错误 ⇒ null（不把异常丢给 HTTP 层）');
  assert.equal(await lucide.get('Zap'), null, '非法名字连请求都不发');
  assert.equal(await lucide.get(''), null, '空名字同样');
});

test('K58 reset 清空缓存（bootstrap 的 ?refresh=1 走这里）', async () => {
  const { io, calls } = fakeIo();
  const lucide = createLucideIcons(io, { now: () => 0 });
  await lucide.get('zap');
  assert.equal(lucide.size(), 1, '缓存里有一条');
  lucide.reset();
  assert.equal(lucide.size(), 0, '清空之后为零');
  await lucide.get('zap');
  assert.equal(calls.length, 2, '清空后会重新请求');
});
