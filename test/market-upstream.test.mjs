/**
 * `lib/market/upstream.js` — the single outbound door, and the one-hop redirect rule.
 *
 * Contract: docs/contracts/routes.md §3.7.2 (timeouts table), §3.7.3 rule 4 (302 must be
 * followed manually, one hop, COS hosts only) and §3.7.4 (byte caps); case id K43.
 *
 * Nothing here opens a socket. The network behaviour (deadline, byte ceiling, mapping a
 * socket error to `E_SOURCE_*`) is only reachable with a real server, so it is checked
 * on the real machine instead; what a unit test *can* pin is the policy that decides
 * whether a redirect is followed at all - the branch a hostile package would attack.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CATEGORY_TIMEOUT_MS,
  CONNECT_TIMEOUT_MS,
  FILE_TIMEOUT_MS,
  MAX_BINARY_BYTES,
  MAX_JSON_BYTES,
  MAX_REDIRECTS,
  READ_TIMEOUT_MS,
  REDIRECT_HOST,
  createUpstream,
  isAllowedRedirect,
} from '../lib/market/upstream.js';

test('K43 四个超时与两个字节上限逐条取自 §3.7.2 / §3.7.4', () => {
  assert.equal(READ_TIMEOUT_MS, 10000, '列表 / 搜索 / 详情总预算 10s');
  assert.equal(CONNECT_TIMEOUT_MS, 5000, '连接预算 5s');
  assert.equal(CATEGORY_TIMEOUT_MS, 6000, '分类表 6s（失败静默降级）');
  assert.equal(FILE_TIMEOUT_MS, 30000, '安装单文件 30s');
  assert.equal(MAX_JSON_BYTES, 2 * 1024 * 1024, 'JSON 响应上限 2 MiB');
  assert.equal(MAX_BINARY_BYTES, 40 * 1024 * 1024, '二进制响应上限 40 MiB（与压缩体上限同一个数）');
  assert.equal(MAX_REDIRECTS, 1, '最多跟一跳');
});

test('K43 302 只允许跟到 COS 桶：主机必须形如 <bucket>.cos.accelerate.myqcloud.com', () => {
  const base = 'https://api.skillhub.cn/api/v1/skills/x/files?path=SKILL.md';
  assert.equal(isAllowedRedirect('https://dsh-1250000000.cos.accelerate.myqcloud.com/a/b?sign=1', base), true,
    'COS 桶上的绝对地址被接受（真实下载路径）');
  // §3.7.3 第 4 条要求 host 命中 COS 桶正则；同源相对地址解析出来是 api.skillhub.cn，
  // 不在白名单里，因此同样被拒。这是「只跟一跳、只跟 COS」的直接后果，不是遗漏。
  assert.equal(isAllowedRedirect('/api/v1/redirect/abc', base), false, '同源相对地址不在白名单里，同样拒绝');

  for (const location of [
    'https://evil.example.com/payload',
    'http://dsh-1250000000.cos.accelerate.myqcloud.com/a',
    'https://cos.accelerate.myqcloud.com.evil.com/a',
    'https://evilcos.accelerate.myqcloud.com/a',
    'file:///etc/passwd',
    'javascript:alert(1)',
    '',
    null,
    undefined,
  ]) {
    assert.equal(isAllowedRedirect(location, base), false, `${JSON.stringify(location)} 不能被跟随`);
  }
});

test('K43 重定向主机正则只认小写连字符标签，不接受点段逃逸', () => {
  assert.equal(REDIRECT_HOST.test('abc-1.cos.accelerate.myqcloud.com'), true, '正常桶名通过');
  assert.equal(REDIRECT_HOST.test('ABC.cos.accelerate.myqcloud.com'), false, '大写不接受（DNS 会归一，但规则要窄）');
  assert.equal(REDIRECT_HOST.test('a.b.cos.accelerate.myqcloud.com'), false, '多点段不接受');
  assert.equal(REDIRECT_HOST.test('evil.com'), false, '任意主机不接受');
});

test('K43 createUpstream 只暴露两个出口：getJson / getBytes（+ dispose 与自身 Agent）', () => {
  const upstream = createUpstream();
  try {
    assert.deepEqual(Object.keys(upstream).sort(), ['agent', 'dispose', 'getBytes', 'getJson'], '四个键，没有第五个');
    assert.equal(typeof upstream.getJson, 'function', 'getJson 是函数');
    assert.equal(typeof upstream.getBytes, 'function', 'getBytes 是函数');
    assert.equal(typeof upstream.dispose, 'function', 'dispose 是函数');
    assert.equal(upstream.agent.keepAlive, true, 'Agent 开了 keepAlive（§3.7.2 socket 复用）');
    assert.equal(upstream.agent.maxSockets, 8, 'maxSockets 是 8');
  } finally {
    upstream.dispose();
  }
});
