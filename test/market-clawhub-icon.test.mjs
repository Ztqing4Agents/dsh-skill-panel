/**
 * The ClawHub uploaded-icon proxy: bytes forwarded, upstream CSP dropped.
 *
 * Contract: docs/contracts/routes.md §3.7.1 route #12 and §3.7.2 (5s, 256 KiB, 1h hit /
 * 60s miss cache, `image/svg+xml` or `image/png` only); docs/contracts/market.md §7.6;
 * case id K60.
 *
 * Why it exists: ClawHub answers its own icon URLs with `content-security-policy: … sandbox`,
 * which makes Chrome refuse to rasterise the SVG inside an `<img>` (measured in R5: `fetch`
 * returns 200 `image/svg+xml`, the same bytes load fine from a `data:` URL, the URL itself
 * never fires `load`). The bytes have to come back through this plugin, which sets its own
 * headers instead of forwarding that one.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLAWHUB_ICON_ORIGIN,
  createClawhubIconProxy,
  isClawhubIconHash,
} from '../lib/market/upstream.js';

/** A valid 64-hex icon id. */
const HASH = 'ab'.repeat(32);

/** 256 KiB, the cap the proxy passes down to the download layer. */
const MAX_BYTES = 256 * 1024;

/** A tiny SVG document. */
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16"/></svg>');

/** A minimal PNG header, enough to be a distinct byte string. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * A fake byte client.
 * @param {{body?: Buffer|null, type?: string, throwOnce?: boolean}} [options] - behaviour.
 * @returns {{io: object, calls: object[]}} the client and its log.
 */
function fakeIo(options = {}) {
  const calls = [];
  let thrown = false;
  const io = {
    /**
     * Answer one binary GET.
     * @param {string} url - request URL.
     * @param {object} callOptions - budget.
     * @returns {Promise<{body: Buffer, headers: object}>} response.
     */
    async getBytes(url, callOptions) {
      calls.push({ url, ...callOptions });
      if (options.throwOnce === true && thrown === false) {
        thrown = true;
        throw new Error('cdn down');
      }
      return {
        body: options.body === undefined ? SVG : options.body,
        headers: { 'content-type': options.type ?? 'image/svg+xml' },
      };
    },
  };
  return { io, calls };
}

test('K60 hash 白名单：只认 64 位小写十六进制', () => {
  assert.equal(isClawhubIconHash(HASH), true, '64 位小写 hex');
  for (const value of [null, undefined, '', 'abc', HASH.toUpperCase(), `${HASH}0`, HASH.slice(1), `../${HASH}`, 42, {}]) {
    assert.equal(isClawhubIconHash(value), false, `${JSON.stringify(value)} 不是合法 hash`);
  }
});

test('K60 命中：抓一次上游，带走 5s 与 256 KiB 两条预算', async () => {
  const { io, calls } = fakeIo();
  const proxy = createClawhubIconProxy(io, { now: () => 0 });
  const icon = await proxy.get(HASH);
  assert.deepEqual(icon, { bytes: SVG, contentType: 'image/svg+xml' }, '拿到的就是上游字节与类型');
  assert.equal(calls.length, 1, '只抓一次');
  assert.equal(calls[0].url, `${CLAWHUB_ICON_ORIGIN}/${HASH}`, 'URL 是 icons 基址 + hash');
  assert.equal(calls[0].timeoutMs, 5000, '5 秒预算');
  assert.equal(calls[0].maxBytes, MAX_BYTES, '256 KiB 上限');
});

test('K60 只放行 svg/png：别的类型当没有（不把 HTML 当图发出去）', async () => {
  for (const type of ['text/html', 'application/json', 'image/gif', '']) {
    const proxy = createClawhubIconProxy(fakeIo({ type }).io, { now: () => 0 });
    assert.equal(await proxy.get(HASH), null, `${type || '(空)'} ⇒ null`);
  }
  const png = createClawhubIconProxy(fakeIo({ body: PNG, type: 'image/png' }).io, { now: () => 0 });
  assert.deepEqual(await png.get(HASH), { bytes: PNG, contentType: 'image/png' }, 'png 放行');
  const charset = createClawhubIconProxy(fakeIo({ type: 'image/svg+xml; charset=utf-8' }).io, { now: () => 0 });
  assert.deepEqual(await charset.get(HASH), { bytes: SVG, contentType: 'image/svg+xml' }, '带 charset 也放行（类型归一化）');
});

test('K60 缓存：1 小时命中、未命中只记 60 秒；失败不抛、之后可自愈', async () => {
  let at = 0;
  const hitIo = fakeIo();
  const proxy = createClawhubIconProxy(hitIo.io, { now: () => at });
  await proxy.get(HASH);
  at += 59 * 60 * 1000;
  assert.notEqual(await proxy.get(HASH), null, '59 分钟内仍命中');
  assert.equal(hitIo.calls.length, 1, '1 小时内只抓一次');
  at += 2 * 60 * 1000;
  await proxy.get(HASH);
  assert.equal(hitIo.calls.length, 2, '过了 1 小时重新抓');

  let at2 = 0;
  const missIo = fakeIo({ body: null, type: 'text/plain' });
  const missing = createClawhubIconProxy(missIo.io, { now: () => at2 });
  assert.equal(await missing.get(HASH), null, '没有这张图 ⇒ null');
  at2 += 30 * 1000;
  await missing.get(HASH);
  assert.equal(missIo.calls.length, 1, '30 秒内用缓存的 null');
  at2 += 40 * 1000;
  await missing.get(HASH);
  assert.equal(missIo.calls.length, 2, '超过 60 秒重试（上游恢复后能补上）');

  let at3 = 0;
  const flaky = fakeIo({ throwOnce: true });
  const selfHealing = createClawhubIconProxy(flaky.io, { now: () => at3 });
  assert.equal(await selfHealing.get(HASH), null, '第一次网络错误 ⇒ null，不抛');
  at3 += 30 * 1000;
  assert.equal(await selfHealing.get(HASH), null, '30 秒内用缓存的 null（不重锤上游）');
  assert.equal(flaky.calls.length, 1, '这段时间只有那一次失败请求');
  at3 += 40 * 1000;
  assert.notEqual(await selfHealing.get(HASH), null, '过了 60 秒重试 ⇒ 拿到图（失败没有被钉死）');
  assert.equal(await selfHealing.get('not-a-hash'), null, '非法 hash 连请求都不发');
  assert.equal(flaky.calls.length, 2, '非法 hash 没有产生请求');
});

test('K60 reset 与 size：清空后重新抓（?refresh=1 走这里）', async () => {
  const { io, calls } = fakeIo();
  const proxy = createClawhubIconProxy(io, { now: () => 0 });
  await proxy.get(HASH);
  assert.equal(proxy.size(), proxy.size(), 'size 是同步可读的');
  assert.equal(typeof proxy.size(), 'number', 'size 返回数字');
  proxy.reset();
  await proxy.get(HASH);
  assert.equal(calls.length, 2, '清空后重新抓');
});
