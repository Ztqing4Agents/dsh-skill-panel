/**
 * `lib/market/query.js` — the whitelists, the cursor codec, the URL builder.
 *
 * Contract: docs/contracts/routes.md §3.7.2 (list semantics), §3.7.3 (whitelists and
 * injection defence); docs/contracts/market.md §7.2 (cursor shapes); case id K29.
 *
 * Everything here is pure: no network, no filesystem, no clock. A value that fails a
 * whitelist must produce `E_BAD_QUERY` (HTTP 400), never a 500 — the browser cannot
 * recover from "the host broke", but it can show "this query was not forwarded".
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LIMIT,
  MAX_KEYWORD,
  SORTS,
  buildUrl,
  decodeCursor,
  encodeCursor,
  parseDetailQuery,
  parseInstallBody,
  parseListQuery,
} from '../lib/market/query.js';
import { MARKET_STATUS } from '../lib/market/errors.js';

/**
 * Run a parser and return the thrown market error.
 * @param {Function} run - the call under test.
 * @returns {object} the thrown error.
 */
function thrownBy(run) {
  try {
    run();
  } catch (error) {
    return error;
  }
  assert.fail('expected the call to throw');
  return null;
}

/**
 * Assert that a call fails with `E_BAD_QUERY` and therefore a 400.
 * @param {Function} run - the call under test.
 * @param {string} hint - what the case is about.
 * @returns {void}
 */
function assertBadQuery(run, hint) {
  const error = thrownBy(run);
  assert.equal(error.code, 'E_BAD_QUERY', `${hint} 应报 E_BAD_QUERY`);
  assert.equal(MARKET_STATUS[error.code], 400, `${hint} 的 HTTP 状态是 400`);
}

test('K29 三档排序是白名单：recommended/updated/downloads，缺省 recommended', () => {
  assert.deepEqual([...SORTS].sort(), ['downloads', 'recommended', 'updated'], '排序选项恰好三个');
  assert.equal(parseListQuery({ source: 'skillhub' }).sort, 'recommended', '不传 sort 时用 recommended');
  assert.equal(parseListQuery({ source: 'skillhub', sort: '' }).sort, 'recommended', '空串等同不传');
  for (const sort of ['downloads', 'updated']) {
    assert.equal(parseListQuery({ source: 'skillhub', sort }).sort, sort, `${sort} 被接受`);
  }
  assertBadQuery(() => parseListQuery({ source: 'skillhub', sort: 'popular' }), '未知 sort');
  assertBadQuery(() => parseListQuery({ source: 'skillhub', sort: 'Recommended' }), '大小写不宽容');
});

test('K29 source 只过文法（all 能过文法但注册表会拒），不合文法的 400', () => {
  assert.equal(parseListQuery({ source: 'clawhub' }).sourceId, 'clawhub', '注册过的源被接受');
  assert.equal(
    parseListQuery({ source: 'all' }).sourceId,
    'all',
    "'all' 只是文法合法：query.js 不管注册表，`all` 由路由的 requireSource 判 400（见 market-routes）",
  );
  for (const source of [undefined, null, '', 'SkillHub', 'skill hub', '-x', 'x'.repeat(33)]) {
    assertBadQuery(() => parseListQuery({ source }), `source=${JSON.stringify(source)}`);
  }
});

test('K29 limit 夹到 1..24（不报错），非数字才 400', () => {
  assert.equal(LIMIT.fallback, 12, '默认一页 12 条');
  assert.equal(parseListQuery({ source: 'skillhub' }).limit, 12, '不传 limit 用 12');
  assert.equal(parseListQuery({ source: 'skillhub', limit: '1' }).limit, 1, '下限 1');
  assert.equal(parseListQuery({ source: 'skillhub', limit: '24' }).limit, 24, '上限 24');
  assert.equal(parseListQuery({ source: 'skillhub', limit: '0' }).limit, 1, '0 被夹到 1，不报错');
  assert.equal(parseListQuery({ source: 'skillhub', limit: '999' }).limit, 24, '999 被夹到 24，不报错');
  assert.equal(parseListQuery({ source: 'skillhub', limit: ' 7 ' }).limit, 7, '两端空白被忽略');
  for (const limit of ['abc', '1.5', '-3', '1e3', '']) {
    if (limit === '') {
      assert.equal(parseListQuery({ source: 'skillhub', limit }).limit, 12, '空串等同不传');
      continue;
    }
    assertBadQuery(() => parseListQuery({ source: 'skillhub', limit }), `limit=${limit}`);
  }
});

test('K29 keyword 只做长度与字符类护栏：>64 或越界字符 400，正常词透传', () => {
  assert.equal(MAX_KEYWORD, 64, '关键词上限 64 字符');
  assert.equal(parseListQuery({ source: 'skillhub' }).keyword, '', '不传关键词是空串（走 list 不走 search）');
  assert.equal(parseListQuery({ source: 'skillhub', keyword: '  ui design  ' }).keyword, 'ui design', '两端空白被裁掉');
  assert.equal(parseListQuery({ source: 'skillhub', keyword: '海报' }).keyword, '海报', '中文关键词被接受');
  assert.equal(parseListQuery({ source: 'skillhub', keyword: 'a'.repeat(64) }).keyword, 'a'.repeat(64), '64 字符刚好合法');
  assertBadQuery(() => parseListQuery({ source: 'skillhub', keyword: 'a'.repeat(65) }), '65 字符关键词');
  assertBadQuery(() => parseListQuery({ source: 'skillhub', keyword: 'a\u0000b' }), '关键词里的控制字符');
});

test('K29 category 走小写连字符白名单，空串表示「不筛」', () => {
  assert.equal(parseListQuery({ source: 'skillhub' }).category, null, '不传分类是 null');
  assert.equal(parseListQuery({ source: 'skillhub', category: '  ' }).category, null, '纯空白等同不传');
  assert.equal(parseListQuery({ source: 'skillhub', category: 'dev-tools' }).category, 'dev-tools', '合法分类被接受');
  assertBadQuery(() => parseListQuery({ source: 'skillhub', category: 'Dev Tools' }), '含空格与大写的分类');
  assertBadQuery(() => parseListQuery({ source: 'skillhub', category: 'a..b' }), '分类里的 ..');
});

test('K29 游标是自己签发的不透明串：往返一致，形状不认识就是 400 而不是 500', () => {
  const page = encodeCursor({ page: 3 });
  assert.equal(typeof page, 'string', '编码结果是字符串');
  assert.deepEqual(decodeCursor(page), { page: 3 }, '往返之后对象一致');
  assert.deepEqual(decodeCursor(encodeCursor({ cursor: 'abc/+=&' })), { cursor: 'abc/+=&' }, '不透明串原样往返');

  assertBadQuery(() => decodeCursor(''), '空游标');
  assertBadQuery(() => decodeCursor('not-base64-json'), '不是我们签发的串');
  assertBadQuery(() => decodeCursor(Buffer.from('"text"', 'utf8').toString('base64url')), 'JSON 标量');
  assertBadQuery(() => decodeCursor(Buffer.from('[1,2]', 'utf8').toString('base64url')), 'JSON 数组');
  assertBadQuery(() => decodeCursor(Buffer.from('{}', 'utf8').toString('base64url')), '空对象');
  assertBadQuery(() => decodeCursor(Buffer.from('{"a":{"b":1}}', 'utf8').toString('base64url')), '嵌套值');
  assertBadQuery(() => decodeCursor('a'.repeat(513)), '超长游标');
});

test('K29 cursor 缺省为 null，传了就解码；坏游标经 parseListQuery 也报 400', () => {
  assert.equal(parseListQuery({ source: 'skillhub' }).cursor, null, '不传 cursor 是第一页');
  assert.equal(parseListQuery({ source: 'skillhub', cursor: '' }).cursor, null, '空串等同不传');
  assert.deepEqual(parseListQuery({ source: 'skillhub', cursor: encodeCursor({ page: 2 }) }).cursor, { page: 2 }, '游标被解码');
  assertBadQuery(() => parseListQuery({ source: 'skillhub', cursor: 'garbage' }), '非法游标');
});

test('K29 detail 入参：owner/slug 必填且不含 ..，version 可选', () => {
  assert.deepEqual(
    parseDetailQuery({ source: 'skillhub', owner: 'user_90d58900', slug: 'dev-god' }),
    { sourceId: 'skillhub', owner: 'user_90d58900', slug: 'dev-god', version: null },
    '含下划线的 handle 被接受，version 缺省为 null',
  );
  assert.equal(
    parseDetailQuery({ source: 'clawhub', owner: 'ivangdavila', slug: 'design', version: ' 1.2.3 ' }).version,
    '1.2.3',
    '版本两端空白被裁掉',
  );
  for (const value of ['..', 'a..b', '/abs', 'a/b', '', 'a b', 'a'.repeat(65)]) {
    assertBadQuery(() => parseDetailQuery({ source: 'skillhub', owner: value, slug: 'x' }), `owner=${value}`);
  }
  for (const value of [undefined, null, '']) {
    assertBadQuery(() => parseDetailQuery({ source: 'skillhub', owner: 'x', slug: value }), `slug=${JSON.stringify(value)}`);
  }
  for (const value of ['..', 'a..b', '1/2', 'v 1']) {
    assertBadQuery(() => parseDetailQuery({ source: 'skillhub', owner: 'x', slug: 'y', version: value }), `version=${value}`);
  }
});

test('K29 install 的 body 只认四个字段：path / files / name 一律忽略', () => {
  assert.deepEqual(
    parseInstallBody({ source: 'skillhub', owner: 'ake', slug: 'dev-god', version: '1.0.0' }),
    { sourceId: 'skillhub', owner: 'ake', slug: 'dev-god', version: '1.0.0' },
    '四个字段原样解析',
  );
  assert.deepEqual(
    parseInstallBody({
      source: 'clawhub',
      owner: 'ivangdavila',
      slug: 'design',
      path: '/etc/passwd',
      files: ['../../evil.sh'],
      name: 'hijack',
    }),
    { sourceId: 'clawhub', owner: 'ivangdavila', slug: 'design', version: null },
    '多余的 path/files/name 不进入结果（客户端不能指定落盘内容）',
  );
  assert.equal(parseInstallBody({ source: 'skillhub', owner: 'a', slug: 'b', version: '' }).version, null, '空版本等同不传');
  for (const body of [null, undefined, 'text', 42, []]) {
    assertBadQuery(() => parseInstallBody(body), `body=${JSON.stringify(body)}`);
  }
  // 注册表检查在路由层（§3.7.4 S0），query.js 只判文法：'nope' 文法合法，故这里不抛。
  assert.deepEqual(
    parseInstallBody({ source: 'nope', owner: 'a', slug: 'b' }),
    { sourceId: 'nope', owner: 'a', slug: 'b', version: null },
    '未注册但文法合法的源留给路由的 requireSource 判 400',
  );
  assertBadQuery(() => parseInstallBody({ source: 'skillhub', owner: 'a', slug: '../b' }), 'slug 里的 ..');
});

test('K29 buildUrl 用 searchParams 拼参数：不拼接、丢空值、钉死 origin', () => {
  const url = buildUrl('https://api.skillhub.cn', '/api/skills', { page: 2, keyword: 'a&b=c#d', sort: '' });
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://api.skillhub.cn', 'origin 钉死');
  assert.equal(parsed.searchParams.get('page'), '2', '数字参数被字符串化');
  assert.equal(parsed.searchParams.get('keyword'), 'a&b=c#d', '关键词里的 & = # 不改写请求形状');
  assert.equal(parsed.searchParams.get('sort'), null, '空串参数被丢掉');
  assert.deepEqual([...parsed.searchParams.keys()].sort(), ['keyword', 'page'], '只出现有值的参数');
});

test('K29 buildUrl 拒绝逃出源 origin 的路径（编程错误走 E_INTERNAL）', () => {
  const error = thrownBy(() => buildUrl('https://api.skillhub.cn', 'https://evil.example.com/steal'));
  assert.equal(error.code, 'E_INTERNAL', '换 origin 是内部错误，不是用户可纠正的参数错误');
  assert.equal(MARKET_STATUS[error.code], 500, 'E_INTERNAL 是 500');
});
