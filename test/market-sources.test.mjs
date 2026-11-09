/**
 * `lib/market/sources/index.js` — the registry and the one place the market assembly happens.
 *
 * Contract: docs/contracts/market.md §7.1 (`MarketSource` shape), §7.3 (adding a source
 * costs one file + one line + two keys), §7.2 (caps per source), §7.8 (the mirror's paging
 * rule); case ids K42, K87.
 *
 * The point of these assertions is the *shape*, not the adapters' behaviour: a third
 * source must be able to plug in without touching the page, the merge, the routes or
 * the installer. Everything below is therefore expressed in terms the page uses.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { clawhubSource } from '../lib/market/sources/clawhub.js';
import { SOURCES, descriptors, descriptorsOf, getSource, ids, makeMarketDeps } from '../lib/market/sources/index.js';
import { skillhubSource } from '../lib/market/sources/skillhub.js';
import { tempDir } from './helpers/tree.mjs';

test('K42 注册表顺序与服务端筛选顺序一致：skillhub 在前、clawhub 在后', () => {
  assert.deepEqual(ids(), ['skillhub', 'clawhub'], '两个来源按界面顺序注册');
  assert.notEqual(getSource('skillhub'), undefined, 'skillhub 可查');
  assert.notEqual(getSource('clawhub'), undefined, 'clawhub 可查');
  assert.equal(getSource('nope'), undefined, '未注册的 id 返回 undefined（路由据此报 E_BAD_QUERY）');
});

test('K42 每个适配器都实现 §7.1 的六个函数与 caps，文案只给键名', () => {
  for (const source of SOURCES) {
    assert.equal(typeof source.id, 'string', `${source.id}: id 是字符串`);
    assert.equal(source.labelKey, `market.source.${source.id}`, `${source.id}: 文案键按 id 拼（界面不枚举来源）`);
    for (const method of ['list', 'search', 'detail', 'plan', 'fetchFile']) {
      assert.equal(typeof source[method], 'function', `${source.id}: 实现了 ${method}`);
    }
    assert.equal(typeof source.caps, 'object', `${source.id}: 声明 caps`);
    for (const key of ['search', 'paged', 'categories']) {
      assert.equal(typeof source.caps[key], 'boolean', `${source.id}: caps.${key} 是布尔`);
    }
    assert.ok(['files', 'zip'].includes(source.caps.package), `${source.id}: package 只能是 files 或 zip`);
    // 有分类表的源必须同时能"数"（chips 上的数字与 bootstrap 的 total 都走它）；
    // 没有分类表的源不必实现，路由会按「没有 counts 能力」降级。
    if (source.caps.categories === true) {
      assert.equal(typeof source.categories, 'function', `${source.id}: 声明有分类表就必须实现 categories`);
      assert.equal(typeof source.counts, 'function', `${source.id}: 声明有分类表就必须实现 counts（K53）`);
    }
  }
});

test('K42 两个源都带分类表与计数（三个 scope 共用一张表，数字按 scope 各算）', () => {
  const skillhub = getSource('skillhub');
  const clawhub = getSource('clawhub');
  for (const [name, source] of [['skillhub', skillhub], ['clawhub', clawhub]]) {
    assert.equal(typeof source.counts, 'function', `${name} 有 counts`);
    assert.equal(typeof source.categories, 'function', `${name} 有分类表`);
    assert.equal(source.caps.categories, true, `${name} 的 caps.categories 为真`);
  }
  // The registry stays two identities: `all` is a scope, never a source (K94).
  assert.deepEqual(ids(), ['skillhub', 'clawhub'], '注册表仍是两个身份');
});

test('K42 能力对照与 §7.2 一致：两源都逐文件取包，也都有分类表', () => {
  assert.deepEqual(descriptors().map((entry) => entry.id), ['skillhub', 'clawhub'], '描述符顺序同注册表');
  const [skillhub, clawhub] = descriptors();
  assert.deepEqual(skillhub, {
    id: 'skillhub',
    labelKey: 'market.source.skillhub',
    hasCategories: true,
    packageKind: 'files',
  }, 'SkillHub 有分类表、逐文件取包');
  assert.deepEqual(clawhub, {
    id: 'clawhub',
    labelKey: 'market.source.clawhub',
    hasCategories: true,
    packageKind: 'files',
  }, 'U8 起 ClawHub 也有分类表（镜像的同一张）；包仍是镜像的 /files 清单');
  assert.deepEqual(descriptorsOf([]), [], '空数组 ⇒ 空描述符');
  assert.deepEqual(descriptorsOf(undefined), [], '非数组 ⇒ 空描述符（界面拿到空也不会崩）');
});

test('K42 makeMarketDeps：注入 io 时不自建网络客户端，dispose 是安全空操作', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const fakeIo = { getJson: async () => ({}), getBytes: async () => Buffer.alloc(0) };
    const deps = makeMarketDeps({ dshHome: dir, skillsRoot: `${dir}/skills`, io: fakeIo, now: () => 0 });
    assert.equal(deps.io, fakeIo, '注入的 io 被原样使用（QA 不必起服务器）');
    assert.equal(deps.now(), 0, '注入的时钟被原样使用');
    assert.deepEqual(deps.sources.map((source) => source.id), ['skillhub', 'clawhub'], 'deps 里带着两个源');
    assert.equal(deps.sourceById('clawhub')?.id, 'clawhub', 'sourceById 与注册表一致');
    assert.equal(typeof deps.store.installed, 'function', '装配了自有台账');
    assert.equal(typeof deps.installer.install, 'function', '装配了安装器');
    assert.equal(deps.skillsRoot, `${dir}/skills`, 'skillsRoot 原样带出（路由补 installTo 用）');
    assert.doesNotThrow(() => deps.dispose(), '没有自建客户端时 dispose 什么都不做');
  } finally {
    await cleanup();
  }
});

test('K42 未注入 io 时自建一个上游客户端，dispose 会释放它', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const deps = makeMarketDeps({ dshHome: dir, skillsRoot: `${dir}/skills` });
    try {
      assert.equal(typeof deps.io.getJson, 'function', '自建的客户端提供 getJson');
      assert.equal(typeof deps.io.getBytes, 'function', '自建的客户端提供 getBytes');
      assert.notEqual(deps.io.getJson, undefined, '上游客户端已就绪（不发起任何请求）');
    } finally {
      assert.doesNotThrow(() => deps.dispose(), 'dispose 释放 Agent 不抛错');
    }
  } finally {
    await cleanup();
  }
});

/**
 * A fake mirror that answers one page and logs every URL it was asked for.
 * @param {{rows?: object[], total?: number|null, fail?: boolean}} [options] - the page.
 * @returns {{io: object, urls: URL[]}} the client and its log.
 */
function mirrorIo(options = {}) {
  const urls = [];
  const io = {
    /**
     * Answer one mirror page.
     * @param {URL|string} url - request URL.
     * @returns {Promise<object>} the body.
     */
    async getJson(url) {
      const parsed = new URL(String(url));
      urls.push(parsed);
      if (options.fail === true) throw new Error('mirror down');
      return { data: { skills: options.rows ?? [], total: options.total === undefined ? null : options.total } };
    },
    /**
     * The mirror never answers bytes in these cases.
     * @returns {Promise<never>} always throws.
     */
    async getBytes() {
      throw new Error('the mirror is not a package host');
    },
  };
  return { io, urls };
}

/** One mirror row that can be identified (`upstream_owner_login` present). */
const mirrorRow = (slug, extra = {}) => ({
  slug,
  source: 'clawhub',
  name: slug,
  namespace: { handle: `clawhub_owner` },
  upstream_owner_login: 'owner',
  downloads: 10,
  stars: 2,
  score: 1000,
  ...extra,
});

/** The query the route hands a ClawHub adapter. */
const CLAW_QUERY = {
  sourceId: 'clawhub', sort: 'recommended', keyword: '', category: null, limit: 4, cursor: null,
};

test('K87 ClawHub 的 list 只打镜像一次，参数齐全、游标是 {page}', async () => {
  const { io, urls } = mirrorIo({ rows: [mirrorRow('a'), mirrorRow('b')], total: 63381 });
  const page = await clawhubSource.list(CLAW_QUERY, io);
  assert.equal(urls.length, 1, '一页只发一次请求');
  assert.equal(urls[0].origin, 'https://api.skillhub.cn', '打的是镜像主机');
  assert.equal(urls[0].pathname, '/api/skills', '镜像的列表端点');
  assert.equal(urls[0].searchParams.get('source'), 'clawhub', '只要 ClawHub 目录');
  assert.equal(urls[0].searchParams.get('page'), '1', '页码从 1 起');
  assert.equal(urls[0].searchParams.get('pageSize'), '4', '页大小透传');
  assert.equal(urls[0].searchParams.get('sortBy'), 'score', '默认排序按评分');
  assert.equal(urls[0].searchParams.get('order'), 'desc', '降序');
  assert.equal(urls[0].searchParams.get('keyword'), null, '空关键词不发');
  assert.equal(urls[0].searchParams.get('category'), null, '没选分类不发');
  assert.equal(page.items.length, 2, '两条都归一了');
  assert.equal(page.total, 63381, 'total 原样透传（不再是 null）');
  assert.equal(JSON.parse(Buffer.from(page.next, 'base64url').toString('utf8')).page, 2, '游标是 {page:2}');
});

test('K87 末页只看 total 与空页：丢条目造成的短页仍然给下一页', async () => {
  // 12 rows, 2 of them unidentifiable -> 10 items, total 100: a short page is NOT the end.
  const dirty = [];
  for (let index = 0; index < 10; index += 1) dirty.push(mirrorRow(`ok-${index}`));
  dirty.push({ slug: 'no-owner', namespace: { handle: 'guessable' } });
  dirty.push({ slug: '', upstream_owner_login: 'owner' });
  const first = await clawhubSource.list(CLAW_QUERY, mirrorIo({ rows: dirty, total: 100 }).io);
  assert.equal(first.items.length, 10, '两条身份拼不出来的被丢掉');
  assert.notEqual(first.next, null, '短页不是末页（total 还有 88 条）');

  const exact = await clawhubSource.list(CLAW_QUERY, mirrorIo({ rows: [mirrorRow('a')], total: 4 }).io);
  assert.equal(exact.next, null, 'page*limit(4) >= total(4) ⇒ 末页');

  const beyond = await clawhubSource.list(
    { ...CLAW_QUERY, cursor: { page: 3 } },
    mirrorIo({ rows: [mirrorRow('a')], total: 9 }).io,
  );
  assert.equal(beyond.next, null, '越界页（12 >= 9）也是末页');

  const empty = await clawhubSource.list(CLAW_QUERY, mirrorIo({ rows: [], total: 63381 }).io);
  assert.equal(empty.next, null, '真空页 ⇒ 末页（total 再大也不翻）');
  assert.equal(empty.items.length, 0, '没有条目');

  // U7 unified the rule: with a real total it is the authority (short pages above), and only
  // when the upstream refuses to report one does a short page have to stand in for it.
  const unknownShort = await clawhubSource.list(CLAW_QUERY, mirrorIo({ rows: [mirrorRow('a')] }).io);
  assert.equal(unknownShort.next, null, 'total 缺失 + 本页不满 ⇒ 只能按条数收尾（没有更好的信号）');
  assert.equal(unknownShort.total, null, 'total 缺失就是 null');
  const unknownFull = await clawhubSource.list(
    { ...CLAW_QUERY, limit: 1 },
    mirrorIo({ rows: [mirrorRow('a')] }).io,
  );
  assert.notEqual(unknownFull.next, null, 'total 缺失但本页满 ⇒ 继续翻（不提前截断）');
});

test('K87 游标与失败：非本源游标报 E_BAD_QUERY，坏载荷报 E_SOURCE_BAD_RESPONSE', async () => {
  await assert.rejects(
    () => clawhubSource.list({ ...CLAW_QUERY, cursor: { cursor: 'x' } }, mirrorIo().io),
    (error) => error.code === 'E_BAD_QUERY',
    '旧形状的 {cursor} 游标不再被接受',
  );
  await assert.rejects(
    () => clawhubSource.list({ ...CLAW_QUERY, cursor: { page: 0 } }, mirrorIo().io),
    (error) => error.code === 'E_BAD_QUERY',
    '页码不在 1..1000',
  );
  const { io } = mirrorIo();
  await assert.rejects(
    () => clawhubSource.list(CLAW_QUERY, { ...io, getJson: async () => ({ data: {} }) }),
    (error) => error.code === 'E_SOURCE_BAD_RESPONSE',
    'data.skills 不是数组就是上游坏了（502 而不是空页）',
  );
  await assert.rejects(
    () => clawhubSource.search({ ...CLAW_QUERY, keyword: '' }, mirrorIo().io),
    (error) => error.code === 'E_BAD_QUERY',
    '空关键词的搜索是本端拒绝，不浪费一次请求',
  );
});

test('K87 search 复用同一个镜像端点并带上 keyword（因此能翻页）', async () => {
  const { io, urls } = mirrorIo({ rows: [mirrorRow('one')], total: 200 });
  const page = await clawhubSource.search({ ...CLAW_QUERY, keyword: 'cad viewer' }, io);
  assert.equal(urls.length, 1, '搜索一次请求');
  assert.equal(urls[0].pathname, '/api/skills', '不是 /api/v1/search：镜像的列表端点就带关键词');
  assert.equal(urls[0].searchParams.get('keyword'), 'cad viewer', '关键词原样带上');
  assert.equal(page.items.length, 1, '条目照常归一');
  assert.notEqual(page.next, null, '搜索结果也能翻页（U6 之前恒 null）');
});

test('K87 镜像的 total 只认数字，分类原样透传，第二页的游标接着排', async () => {
  // A string total is "no total": the end-of-list rule must not compare a string to a number
  // (`'9' >= 4` is true by coercion, which would cut the list short after one page).
  const fullPage = [mirrorRow('a'), mirrorRow('b'), mirrorRow('c'), mirrorRow('d')];
  const stringTotal = mirrorIo({ rows: fullPage, total: /** @type {any} */ ('9') });
  const page = await clawhubSource.list(CLAW_QUERY, stringTotal.io);
  assert.equal(page.total, null, '非数字的 total 不透传');
  assert.notEqual(page.next, null, '字符串 total 不参与比较（本页满 ⇒ 继续翻，绝不因为 `\'9\' >= 4` 截断）');

  const categorised = mirrorIo({ rows: [mirrorRow('a')], total: 63381 });
  await clawhubSource.list({ ...CLAW_QUERY, category: 'dev-tools' }, categorised.io);
  assert.equal(categorised.urls[0].searchParams.get('category'), 'dev-tools', '有分类就转发（caps 不翻，但镜像支持）');

  const second = mirrorIo({ rows: [mirrorRow('b')], total: 63381 });
  const paged = await clawhubSource.list({ ...CLAW_QUERY, cursor: { page: 2 } }, second.io);
  assert.equal(second.urls[0].searchParams.get('page'), '2', '游标页码原样带给镜像');
  assert.equal(
    JSON.parse(Buffer.from(paged.next, 'base64url').toString('utf8')).page,
    3,
    '下一页是 page+1（游标同形，客户端只回传不解析）',
  );
});

test('K87 镜像的失败不会被吞成空页：带码的上游错误照实往上抛', async () => {
  // `detail` swallows its mirror lookup (decoration); `list` must not - an empty page would
  // read as "this source has nothing", which is a different and false statement.
  const { io } = mirrorIo({ fail: true });
  await assert.rejects(
    () => clawhubSource.list(CLAW_QUERY, io),
    /mirror down/,
    'list 的镜像失败照实抛出（由路由映射成 502/503/504）',
  );
  const coded = {
    ...io,
    getJson: async () => {
      throw Object.assign(new Error('mirror timed out'), { code: 'E_SOURCE_TIMEOUT' });
    },
  };
  await assert.rejects(
    () => clawhubSource.list(CLAW_QUERY, coded),
    (error) => error.code === 'E_SOURCE_TIMEOUT',
    '带错误码的失败同样不被吞',
  );
});

test('K94 范围轴到得上游 URL：all 一个 source 参数都不发，skillhub 发 community，clawhub 发 clawhub', async () => {
  // The adapter serves every scope, so the scope's `sourceParam` travels on the query and
  // wins over the adapter's own value. `all` is "no parameter", never `source=all`.
  const query = (sourceParam) => ({ ...CLAW_QUERY, sourceParam });

  const all = mirrorIo({ rows: [], total: 224219 });
  await skillhubSource.list(query(null), all.io);
  assert.equal(all.urls[0].searchParams.has('source'), false, 'all 档：URL 里没有 source 这个参数');
  assert.equal(all.urls[0].searchParams.get('pageSize'), '4', '其余参数照旧');

  const hub = mirrorIo({ rows: [], total: 160838 });
  await skillhubSource.list(query('community'), hub.io);
  assert.equal(hub.urls[0].searchParams.get('source'), 'community', 'skillhub 档问的是 community');

  const claw = mirrorIo({ rows: [], total: 63381 });
  await clawhubSource.list(query('clawhub'), claw.io);
  assert.equal(claw.urls[0].searchParams.get('source'), 'clawhub', 'clawhub 档问的是 clawhub');

  // The four sort orders all reach the wire, and each keeps its own parameter pair.
  for (const [sort, sortBy] of [
    ['recommended', 'score'], ['updated', 'updated_at'], ['downloads', 'downloads'], ['stars', 'stars'],
  ]) {
    const run = mirrorIo({ rows: [], total: 1 });
    await skillhubSource.list({ ...query(null), sort }, run.io);
    assert.equal(run.urls[0].searchParams.get('sortBy'), sortBy, `${sort} ⇒ sortBy=${sortBy}`);
    assert.equal(run.urls[0].searchParams.get('order'), 'desc', `${sort} ⇒ order=desc`);
  }
});

test('K95 折叠丢行不改末页判定：坏行只少一张卡，不缩页、不提前收尾', async () => {
  // 24 rows, three of them unidentifiable (no owner anywhere). `nextPage` reads the raw
  // count and the upstream total, never the post-normalisation length - a page that lost
  // rows must not look like the end of the list.
  const rows = Array.from({ length: 24 }, (unused, index) => mirrorRow(`s${index}`));
  rows[3] = mirrorRow('ghost-a', { namespace: {}, upstream_owner_login: '   ' });
  rows[9] = mirrorRow('ghost-b', { namespace: {}, upstream_owner_login: '' });
  rows[20] = mirrorRow('ghost-c', { namespace: { handle: '  ' }, upstream_owner_login: '  ' });
  const { io } = mirrorIo({ rows, total: 240 });

  const page = await clawhubSource.list({ ...CLAW_QUERY, limit: 24 }, io);
  assert.equal(page.items.length, 21, '24 行里 3 行没有身份 ⇒ 21 张卡');
  assert.equal(page.total, 240, '上游总数原样透传（不因为丢行而变小）');
  assert.notEqual(page.next, null, '满页且没到总数 ⇒ 还有下一页（丢掉的行不是末页信号）');
});
