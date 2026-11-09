/**
 * `lib/market/errors.js` — one `E_*` code per failure, each pinned to one HTTP status.
 *
 * Contract: docs/contracts/routes.md §8.6 (the full market code table) and §8.1 (the
 * envelope). Case id K30.
 *
 * The interesting assertion is the cross-check at the end: the table in the contract
 * and the table in the code are compared entry by entry, so a code that is added to
 * one and forgotten in the other fails here rather than in production.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  MARKET_STATUS,
  MarketError,
  asMarketError,
  isMarketError,
  marketError,
  statusOfMarketError,
} from '../lib/market/errors.js';
import { ROOT } from './helpers/ssr.mjs';

/** The status each code must map to, transcribed from routes.md §8.6. */
const EXPECTED = {
  E_BAD_QUERY: 400,
  E_BAD_REQUEST: 400,
  E_SOURCE_UNKNOWN: 400,
  E_SOURCE_UNAVAILABLE: 503,
  E_SOURCE_TIMEOUT: 504,
  E_SOURCE_BAD_RESPONSE: 502,
  E_DOWNLOAD_FAILED: 502,
  E_PACKAGE_INVALID: 422,
  E_SKILL_NAME_INVALID: 422,
  E_ALREADY_INSTALLED: 409,
  E_INSTALL_BUSY: 429,
  E_INSTALL_IO: 500,
  E_INTERNAL: 500,
};

test('K30 code → HTTP 状态表与 §8.6 逐条一致，没有多余也没有遗漏', () => {
  assert.deepEqual(MARKET_STATUS, EXPECTED, '十三种市场失败码与状态一字不差');
  for (const [code, status] of Object.entries(EXPECTED)) {
    assert.equal(statusOfMarketError(marketError(code, 'x')), status, `${code} ⇒ ${status}`);
  }
});

test('K30 MarketError 带 code / message / detail；detail 缺省是 null', () => {
  const bare = marketError('E_SOURCE_TIMEOUT', 'upstream timed out');
  assert.equal(bare instanceof MarketError, true, 'marketError 返回 MarketError');
  assert.equal(bare instanceof Error, true, '同时是一个 Error（可被 try/catch 与 logger 处理）');
  assert.equal(bare.code, 'E_SOURCE_TIMEOUT', 'code 原样保留');
  assert.equal(bare.message, 'upstream timed out', 'message 是给开发者看的英文短句');
  assert.equal(bare.detail, null, '不带 detail 时是 null');
  assert.equal(isMarketError(bare), true, 'isMarketError 认得它');

  const explained = marketError('E_ALREADY_INSTALLED', 'exists', { path: '/tmp/x', existing: { name: 'x', version: null } });
  assert.deepEqual(explained.detail, { path: '/tmp/x', existing: { name: 'x', version: null } }, 'detail 原样携带');
});

test('K30 asMarketError 兜底：陌生异常变 E_INTERNAL，带已知 code 的系统错误保留 code', () => {
  const internal = asMarketError(new Error('boom'));
  assert.equal(internal.code, 'E_INTERNAL', '普通 Error 变 E_INTERNAL');
  assert.equal(internal.message, 'boom', '原 message 保留（日志要看得懂）');

  assert.equal(asMarketError('just a string').code, 'E_INTERNAL', '非 Error 也变 E_INTERNAL');
  assert.equal(asMarketError({ code: 'EINSTALL' }).code, 'E_INTERNAL', '不认识的 code 不冒充市场错误码');

  const kept = asMarketError(Object.assign(new Error('disk'), { code: 'E_INSTALL_IO' }));
  assert.equal(kept.code, 'E_INSTALL_IO', '已知 code 被保留（fail 路径不必层层包装）');
  assert.equal(statusOfMarketError(kept), 500, 'E_INSTALL_IO ⇒ 500');

  const passthrough = asMarketError(marketError('E_PACKAGE_INVALID', 'bad zip'));
  assert.equal(passthrough.code, 'E_PACKAGE_INVALID', 'MarketError 原样透传（不重复包装）');

  const withDetail = asMarketError(Object.assign(new Error('io'), { code: 'E_INSTALL_IO', detail: { name: 'x' } }));
  assert.deepEqual(withDetail.detail, { name: 'x' }, '系统错误上的 detail 也被带出来');
});

test('K30 未知 / 缺 code 的异常不会把 undefined 当状态发出去', () => {
  assert.equal(statusOfMarketError(new Error('?')), 500, '未知异常一律 500');
  assert.equal(statusOfMarketError(null), 500, 'null 也落到 500');
  assert.equal(isMarketError(new Error('x')), false, '普通 Error 不是 MarketError');
});

test('K30 契约文本与代码同源：routes.md §8.6 的表格行逐条对得上', async () => {
  const text = await readFile(join(ROOT, 'docs', 'contracts', 'routes.md'), 'utf8');
  const section = text.slice(text.indexOf('## 8.6'));
  assert.notEqual(section, '', 'routes.md 里有 §8.6 一节');
  const rows = [...section.matchAll(/^\| `(E_[A-Z_]+)` \| (\d{3}) \|/gm)]
    .map((match) => [match[1], Number(match[2])]);
  assert.equal(rows.length >= 13, true, `§8.6 的表格至少十三行（实际 ${rows.length} 行）`);
  const documented = Object.fromEntries(rows);
  for (const [code, status] of Object.entries(documented)) {
    assert.equal(MARKET_STATUS[code], status, `契约里的 ${code} ⇒ ${status} 与代码一致`);
  }
  const undocumented = Object.keys(MARKET_STATUS).filter((code) => documented[code] === undefined);
  assert.deepEqual(undocumented, [], '代码里没有契约未登记的失败码');
});
