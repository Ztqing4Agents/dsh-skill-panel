/**
 * `lib/loopback.js` — the fence every route shares.
 *
 * Contract: docs/system_design.md §8.1 (`E_FORBIDDEN`) and case id K17.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isLoopbackAddress,
  isLoopbackHostname,
  isLoopbackRequest,
  isProxiedRequest,
} from '../lib/loopback.js';

/** A request that came straight from the browser on this machine. */
const local = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:5173' } };

/**
 * Build a request from `local` with one field replaced.
 * @param {object} patch - `socket` and/or `headers` overrides.
 * @returns {object} the request.
 */
function request(patch) {
  return {
    socket: { ...local.socket, ...(patch.socket ?? {}) },
    headers: { ...local.headers, ...(patch.headers ?? {}) },
  };
}

test('K17 本机直连请求通过围栏', () => {
  assert.equal(isLoopbackRequest(local), true, '127.0.0.1 直连 + 127.0.0.1 Host 通过');
  assert.equal(isLoopbackRequest(request({ socket: { remoteAddress: '::1' } })), true, 'IPv6 回环通过');
  assert.equal(isLoopbackRequest(request({ socket: { remoteAddress: '::ffff:127.0.0.1' } })), true, 'IPv4 映射回环通过');
  assert.equal(isLoopbackRequest(request({ headers: { host: 'localhost:5173' } })), true, 'localhost Host 通过');
  assert.equal(isLoopbackRequest(request({ headers: { host: '[::1]:5173' } })), true, '[::1] Host 通过');
});

test('K17 非回环来源地址被拒绝', () => {
  assert.equal(isLoopbackRequest(request({ socket: { remoteAddress: '10.0.0.2' } })), false, '10.0.0.2 不是回环');
  assert.equal(isLoopbackRequest(request({ socket: { remoteAddress: '192.168.1.5' } })), false, '192.168.1.5 不是回环');
  assert.equal(isLoopbackRequest(request({ socket: { remoteAddress: undefined } })), false, '没有远程地址即拒绝');
  assert.equal(isLoopbackRequest(request({ socket: { remoteAddress: '127.0.0.999' } })), false, '非法八位组不算回环');
});

test('K17 非回环 Host 头被拒绝（防 DNS rebinding）', () => {
  assert.equal(isLoopbackRequest(request({ headers: { host: 'evil.com' } })), false, 'Host 为 evil.com 时拒绝');
  assert.equal(isLoopbackRequest(request({ headers: { host: '127.0.0.1.evil.com:5173' } })), false, '伪装成回环的子域拒绝');
  assert.equal(isLoopbackRequest(request({ headers: { host: '' } })), false, 'Host 为空时拒绝');
  assert.equal(isLoopbackRequest(request({ headers: { host: undefined } })), false, '缺 Host 时拒绝');
});

test('K17 带转发头的请求一律拒绝（转发头不是回环证据）', () => {
  assert.equal(isProxiedRequest({ headers: { 'x-forwarded-for': '127.0.0.1' } }), true, 'x-forwarded-for 存在即视为经过代理');
  assert.equal(isProxiedRequest({ headers: { 'cf-connecting-ip': '1.2.3.4' } }), true, 'cf-connecting-ip 存在即视为经过代理');
  assert.equal(
    isLoopbackRequest(request({ headers: { 'x-forwarded-for': '127.0.0.1' } })),
    false,
    '即使转发头写着回环地址也拒绝',
  );
});

test('K17 跨站请求被拒绝', () => {
  assert.equal(isLoopbackRequest(request({ headers: { 'sec-fetch-site': 'cross-site' } })), false, 'cross-site 被拒绝');
  assert.equal(isLoopbackRequest(request({ headers: { 'sec-fetch-site': 'same-origin' } })), true, 'same-origin 通过');
});

test('Origin 存在时必须与 Host 同源', () => {
  assert.equal(isLoopbackRequest(request({ headers: { origin: 'http://127.0.0.1:5173' } })), true, '同源 Origin 通过');
  assert.equal(isLoopbackRequest(request({ headers: { origin: 'http://127.0.0.1:9999' } })), false, '不同端口的 Origin 被拒绝');
  assert.equal(isLoopbackRequest(request({ headers: { origin: 'not a url' } })), false, '无法解析的 Origin 被拒绝');
});

test('isLoopbackAddress 只认 127/8 与 ::1', () => {
  assert.equal(isLoopbackAddress('127.1.2.3'), true, '127/8 内任意地址都是回环');
  assert.equal(isLoopbackAddress('128.0.0.1'), false, '128.0.0.1 不是回环');
  assert.equal(isLoopbackAddress('::2'), false, '::2 不是回环');
  assert.equal(isLoopbackAddress(''), false, '空串不是回环');
  assert.equal(isLoopbackAddress(null), false, 'null 不是回环');
});

test('isLoopbackHostname 认 localhost、[::1] 与 127/8', () => {
  assert.equal(isLoopbackHostname('localhost'), true, 'localhost 是回环主机名');
  assert.equal(isLoopbackHostname('LOCALHOST'), false, '大小写不匹配时不认（URL 会先小写化）');
  assert.equal(isLoopbackHostname('[::1]'), true, '[::1] 是回环主机名');
  assert.equal(isLoopbackHostname('127.0.0.1'), true, '127.0.0.1 是回环主机名');
  assert.equal(isLoopbackHostname('example.com'), false, 'example.com 不是回环主机名');
});
