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
  SCOPE_PARAM,
  SCOPES_OF_LIST,
  SORT_PARAMS,
  SORTS,
  SOURCE_IDS,
  buildUrl,
  decodeCursor,
  encodeCursor,
  parseDetailQuery,
  parseIconRequest,
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

test('K29 四档排序是白名单：recommended/updated/downloads/stars，缺省 recommended', () => {
  assert.deepEqual([...SORTS].sort(), ['downloads', 'recommended', 'stars', 'updated'], '排序选项恰好四个');
  assert.equal(parseListQuery({ source: 'skillhub' }).sort, 'recommended', '不传 sort 时用 recommended');
  assert.equal(parseListQuery({ source: 'skillhub', sort: '' }).sort, 'recommended', '空串等同不传');
  for (const sort of ['downloads', 'updated', 'stars']) {
    assert.equal(parseListQuery({ source: 'skillhub', sort }).sort, sort, `${sort} 被接受`);
  }
  assertBadQuery(() => parseListQuery({ source: 'skillhub', sort: 'popular' }), '未知 sort');
  assertBadQuery(() => parseListQuery({ source: 'skillhub', sort: 'Recommended' }), '大小写不宽容');
});

test('K94 范围轴：source 可缺省（= all），三值白名单映射到上游参数', () => {
  const plain = parseListQuery({ source: 'skillhub' });
  assert.equal(plain.scope, 'skillhub', 'skillhub 被接受');
  assert.equal(plain.sourceParam, 'community', 'SkillHub 这一档问的是 community');

  assert.deepEqual(
    (({ scope, sourceParam }) => ({ scope, sourceParam }))(parseListQuery({ source: 'clawhub' })),
    { scope: 'clawhub', sourceParam: 'clawhub' },
    'ClawHub 这一档问的是 clawhub',
  );
  for (const params of [{}, { source: '' }, { source: 'all' }]) {
    const query = parseListQuery(params);
    assert.equal(query.scope, 'all', `${JSON.stringify(params)} ⇒ all（站点「所有来源」就是不传参数）`);
    assert.equal(query.sourceParam, null, `${JSON.stringify(params)} 的上游不带 source`);
  }
  for (const source of ['bogus', 'SkillHub', 'skill hub', '-x', 'x'.repeat(33), 'community']) {
    assertBadQuery(() => parseListQuery({ source }), `source=${JSON.stringify(source)}`);
  }
});

test('K94 all 不属于身份轴：detail / install / icons 收到 all 一律 400', () => {
  const ref = { source: 'all', owner: 'ake', slug: 'x' };
  assertBadQuery(() => parseDetailQuery(ref), 'detail 的 source=all');
  assertBadQuery(() => parseInstallBody(ref), 'install 的 source=all');
  assertBadQuery(() => parseIconRequest({ items: [ref] }), 'icons 的 source=all');
  // The two identity ids still pass, unchanged.
  assert.equal(parseDetailQuery({ ...ref, source: 'clawhub' }).sourceId, 'clawhub', 'clawhub 仍是合法身份');
  assert.equal(parseInstallBody({ ...ref, source: 'skillhub' }).sourceId, 'skillhub', 'skillhub 仍是合法身份');
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
  // U8: the identity whitelist lives here now (two ids, `all` excluded), so a name that is
  // merely well-formed - an unregistered source, or the list's own `all` scope - is a 400
  // before the route ever looks at its registry.
  assertBadQuery(() => parseInstallBody({ source: 'nope', owner: 'a', slug: 'b' }), '未注册的源');
  assertBadQuery(() => parseInstallBody({ source: 'all', owner: 'a', slug: 'b' }), 'all 不是身份 id');
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

test('K97 四档排序映射到上游参数，可与分类和 source 组合', () => {
  const cases = [
    ['recommended', 'score'],
    ['updated', 'updated_at'],
    ['downloads', 'downloads'],
    ['stars', 'stars'],
  ];
  for (const [sort, sortBy] of cases) {
    assert.deepEqual(SORT_PARAMS[sort], { sortBy, order: 'desc' }, `${sort} ⇒ ${sortBy} 降序`);
  }
  // The site's own order: score first, and the panel's default is that first item.
  assert.equal(SORTS.has('recommended'), true, 'recommended 仍在白名单里');
  assertBadQuery(() => parseListQuery({ source: 'all', sort: 'rating' }), '未知 sort');
});

test('K97 三个筛选参数同时在 URL 里：scope 的 source、category、sort 互不覆盖', () => {
  const query = parseListQuery({ source: 'clawhub', category: 'ai-agent', sort: 'stars', limit: '6' });
  const params = {
    page: 1,
    pageSize: query.limit,
    ...(query.sourceParam === null ? {} : { source: query.sourceParam }),
    ...SORT_PARAMS[query.sort],
    category: query.category,
    keyword: query.keyword,
  };
  const url = new URL(buildUrl('https://api.skillhub.cn', '/api/skills', params));
  assert.equal(url.searchParams.get('source'), 'clawhub', 'scope 的 source 在');
  assert.equal(url.searchParams.get('category'), 'ai-agent', '分类在');
  assert.equal(url.searchParams.get('sortBy'), 'stars', '排序在');
  assert.equal(url.searchParams.get('order'), 'desc', '方向在');
  assert.equal(url.searchParams.get('pageSize'), '6', '页大小在');

  const allQuery = parseListQuery({ category: 'ai-agent', sort: 'stars' });
  const allUrl = buildUrl('https://api.skillhub.cn', '/api/skills', {
    page: 1,
    ...(allQuery.sourceParam === null ? {} : { source: allQuery.sourceParam }),
    ...SORT_PARAMS[allQuery.sort],
    category: allQuery.category,
  });
  assert.equal(new URL(allUrl).searchParams.get('source'), null, 'all 这一档不带 source（= 站点的所有来源）');
});

test('K94 范围轴的其余边界：大小写、空白、enterprise 都不是 scope，且与身份轴互不相交', () => {
  // Fail closed: the upstream's own value (`community`) is not a scope either - only the
  // three ids the menu draws are, and the identity whitelist is a different set.
  for (const [source, hint] of [
    ['ALL', '大写不等于 all'],
    ['SkillHub', '标签名不是机器值'],
    [' all ', '不修剪空白（契约没有「trim 后接受」这一条，宁可 400）'],
    ['community', '上游值不是范围轴的值'],
    ['enterprise', 'enterprise 是 community 的子筛选，不是一档'],
    ['skillhub,clawhub', '逗号分隔不是这个端点的语法'],
  ]) {
    assertBadQuery(() => parseListQuery({ source }), `${hint}（source=${JSON.stringify(source)}）`);
  }

  // The two sets are disjoint on purpose: a value in one must never leak into the other.
  assert.deepEqual([...SCOPES_OF_LIST], ['all', 'skillhub', 'clawhub'], '范围轴恰好三值');
  assert.deepEqual([...SOURCE_IDS], ['skillhub', 'clawhub'], '身份轴恰好两值');
  assert.equal(SCOPES_OF_LIST.has('all') && SOURCE_IDS.has('all'), false, 'all 只在范围轴里');
  for (const id of SOURCE_IDS) {
    assert.equal(SCOPES_OF_LIST.has(id), true, `${id} 同时是范围轴的一档（两轴用同一组词，语义不同）`);
  }
});
