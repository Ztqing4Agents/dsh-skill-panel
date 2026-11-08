/**
 * `lib/http.js` — the response envelope and the bounded body reader.
 *
 * Contract: docs/contracts/routes.md §8.1; case id K20 (64 KiB cap).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';

import { MAX_BODY_BYTES, asJsonObject, fail, ok, readJsonBody, writeJson } from '../lib/http.js';

/**
 * A request whose body is the given chunks.
 * @param {string[]} chunks - body chunks.
 * @returns {import('node:stream').Readable} the fake request.
 */
function streamOf(chunks) {
  return Readable.from(chunks.map((chunk) => Buffer.from(chunk)));
}

test('asJsonObject 只接受普通对象', () => {
  assert.deepEqual(asJsonObject({ a: 1 }), { a: 1 }, '普通对象原样返回');
  assert.equal(asJsonObject([1, 2]), null, '数组不是请求体');
  assert.equal(asJsonObject(null), null, 'null 不是请求体');
  assert.equal(asJsonObject('text'), null, '字符串不是请求体');
});

test('信封：成功恒为 OK 且 message 为空，失败携带 E_ 码与英文短句', () => {
  assert.deepEqual(ok({ a: 1 }), { code: 'OK', data: { a: 1 }, message: '' }, '成功信封的 code 是 OK');
  assert.deepEqual(fail('E_NOT_FOUND', 'nope'), { code: 'E_NOT_FOUND', data: null, message: 'nope' }, '失败信封的 data 是 null');
});

test('MAX_BODY_BYTES 是 64 KiB', () => {
  assert.equal(MAX_BODY_BYTES, 65536, '正文上限是 65536 字节');
});

test('readJsonBody 解析对象正文', async () => {
  const body = await readJsonBody(streamOf(['{"name":"x"}']), { maxBytes: MAX_BODY_BYTES });
  assert.deepEqual(body, { name: 'x' }, '解析出对象');
});

test('readJsonBody 空正文返回 null', async () => {
  assert.equal(await readJsonBody(streamOf(['   '])), null, '纯空白正文视为没有正文');
});

test('readJsonBody 坏 JSON 抛 E_BAD_REQUEST', async () => {
  await assert.rejects(
    readJsonBody(streamOf(['{not json'])),
    (error) => error.code === 'E_BAD_REQUEST',
    '非法 JSON 抛出 code=E_BAD_REQUEST 的错误',
  );
});

test('readJsonBody 数组正文抛 E_BAD_REQUEST（objectOnly 默认开启）', async () => {
  await assert.rejects(
    readJsonBody(streamOf(['[1,2]'])),
    (error) => error.code === 'E_BAD_REQUEST',
    '数组正文抛出 code=E_BAD_REQUEST 的错误',
  );
  assert.deepEqual(await readJsonBody(streamOf(['[1,2]']), { objectOnly: false }), [1, 2], '关掉 objectOnly 后数组被接受');
});

test('K20 超过上限立即拒绝，不把正文收完', async () => {
  const oversized = 'x'.repeat(MAX_BODY_BYTES + 1);
  await assert.rejects(
    readJsonBody(streamOf([oversized])),
    (error) => error.code === 'E_BAD_REQUEST' && /exceeds/.test(error.message),
    '超过 64 KiB 的正文抛出 E_BAD_REQUEST',
  );
});

test('readJsonBody 逐块累计，跨块超限同样拒绝', async () => {
  const half = 'y'.repeat(MAX_BODY_BYTES / 2);
  await assert.rejects(
    readJsonBody(streamOf([half, `${half}tail`])),
    (error) => error.code === 'E_BAD_REQUEST',
    '两块合并后超限同样抛出 E_BAD_REQUEST',
  );
});

test('readJsonBody 把流错误映射成 E_BAD_REQUEST', async () => {
  const broken = new Readable({
    read() {
      this.destroy(new Error('socket closed'));
    },
  });
  await assert.rejects(
    readJsonBody(broken),
    (error) => error.code === 'E_BAD_REQUEST',
    '流错误抛出 code=E_BAD_REQUEST 的错误',
  );
});

test('writeJson 写出状态、content-type、no-store 与 content-length', () => {
  const headers = {};
  let body = '';
  const response = {
    statusCode: 0,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    end(payload) {
      body = payload;
    },
  };
  writeJson(response, 409, fail('E_STALE_PATH', 'moved'));
  assert.equal(response.statusCode, 409, '状态码被写到 response');
  assert.equal(headers['content-type'], 'application/json; charset=utf-8', 'content-type 是 JSON');
  assert.equal(headers['cache-control'], 'no-store', '响应不可缓存');
  assert.equal(headers['content-length'], Buffer.byteLength(body), 'content-length 与正文长度一致');
  assert.equal(JSON.parse(body).code, 'E_STALE_PATH', '正文是失败信封');
});
