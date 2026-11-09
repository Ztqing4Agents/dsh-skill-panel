/**
 * `src/client/api.js` — the browser's only door to the host half.
 *
 * Contract: docs/contracts/client.md §3.9.4 (the five market methods) and §8.2
 * (document-relative route prefix); docs/contracts/routes.md §8.1 (the envelope is
 * normalised here, so nothing above sees an HTTP status); case ids K44.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, SkillCenterApi } from '../src/client/api.js';

/**
 * A fetch stub that records calls and answers one canned response.
 * @param {{status?: number, body?: unknown, throws?: Error}} reply - what to answer.
 * @returns {{fetchImpl: Function, calls: {url: string, init: object}[]}} the stub.
 */
function fetchStub(reply) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (reply.throws !== undefined) throw reply.throws;
    const status = reply.status ?? 200;
    return {
      status,
      json: async () => {
        if (reply.body instanceof Error) throw reply.body;
        return reply.body;
      },
    };
  };
  return { fetchImpl, calls };
}

test('请求用文档相对路径，不带前导斜杠（GUI 可能挂在路径前缀下）', async () => {
  const { fetchImpl, calls } = fetchStub({ body: { code: 'OK', data: { groups: [] }, message: '' } });
  await new SkillCenterApi(fetchImpl).list();
  assert.equal(calls[0].url, 'api/dsh-skill-center/list', 'URL 是文档相对的 list 路由');
  assert.equal(calls[0].url.startsWith('/'), false, 'URL 不以 / 开头');
});

test('成功时把信封里的 data 解出来，调用方看不到 HTTP 状态', async () => {
  const { fetchImpl } = fetchStub({ body: { code: 'OK', data: { counts: { total: 3 } }, message: '' } });
  const data = await new SkillCenterApi(fetchImpl).list();
  assert.deepEqual(data, { counts: { total: 3 } }, '返回的是 data 而不是整个信封');
});

test('失败信封变成带 code 的 ApiError', async () => {
  const { fetchImpl } = fetchStub({ status: 409, body: { code: 'E_STALE_PATH', data: null, message: 'moved' } });
  await assert.rejects(
    new SkillCenterApi(fetchImpl).list(),
    (error) => error instanceof ApiError && error.code === 'E_STALE_PATH' && error.message === 'moved',
    '失败信封抛出带 code 与 message 的 ApiError',
  );
});

test('传输层异常变成 E_UNKNOWN', async () => {
  const { fetchImpl } = fetchStub({ throws: new Error('network down') });
  await assert.rejects(
    new SkillCenterApi(fetchImpl).list(),
    (error) => error.code === 'E_UNKNOWN' && /network down/.test(error.message),
    '网络异常抛出 E_UNKNOWN',
  );
});

test('响应不是 JSON 或没有 code 时变成 E_UNKNOWN', async () => {
  const { fetchImpl } = fetchStub({ body: new SyntaxError('not json') });
  await assert.rejects(
    new SkillCenterApi(fetchImpl).list(),
    (error) => error.code === 'E_UNKNOWN' && /unexpected response/.test(error.message),
    '非 JSON 响应抛出 E_UNKNOWN',
  );
});

test('toggle 提交 name/path/enabled，方法为 POST', async () => {
  const { fetchImpl, calls } = fetchStub({ body: { code: 'OK', data: { name: 'a' }, message: '' } });
  await new SkillCenterApi(fetchImpl).toggle({ name: 'a', path: '/skills/a/SKILL.md', enabled: false });
  assert.equal(calls[0].url, 'api/dsh-skill-center/toggle', 'URL 是 toggle 路由');
  assert.equal(calls[0].init.method, 'POST', '方法是 POST');
  assert.equal(calls[0].init.headers['content-type'], 'application/json', '声明 JSON 正文');
  assert.deepEqual(JSON.parse(calls[0].init.body), { name: 'a', path: '/skills/a/SKILL.md', enabled: false }, '正文就是三件事实');
});

test('toggleProvider 提交 provider/name/enabled，缺 provider 时补空串', async () => {
  const { fetchImpl, calls } = fetchStub({ body: { code: 'OK', data: {}, message: '' } });
  await new SkillCenterApi(fetchImpl).toggleProvider({ name: 'office', enabled: true });
  assert.equal(calls[0].url, 'api/dsh-skill-center/provider-toggle', 'URL 是 provider-toggle 路由');
  assert.deepEqual(JSON.parse(calls[0].init.body), { provider: '', name: 'office', enabled: true }, 'provider 缺失时补空串');
});

test('enabled 只接受严格 true，其它真值不当作启用', async () => {
  const { fetchImpl, calls } = fetchStub({ body: { code: 'OK', data: {}, message: '' } });
  await new SkillCenterApi(fetchImpl).toggle({ name: 'a', path: '/a/SKILL.md', enabled: 'yes' });
  assert.equal(JSON.parse(calls[0].init.body).enabled, false, '字符串 yes 被归一成 false');
});

test('ApiError 没有 message 时用 code 作为 message', () => {
  const error = new ApiError('E_FORBIDDEN', '');
  assert.equal(error.message, 'E_FORBIDDEN', 'message 为空时用 code 顶替');
  assert.equal(error.name, 'ApiError', '错误名是 ApiError');
});

test('K44 六个市场方法的 URL 都是文档相对的 market/* 路由', async () => {
  const cases = [
    ['marketBootstrap', (api) => api.marketBootstrap(), 'market/bootstrap'],
    ['marketList', (api) => api.marketList({ source: 'skillhub' }), 'market/list?source=skillhub'],
    ['marketDetail', (api) => api.marketDetail({ source: 'skillhub', owner: 'ake', slug: 'dev-god' }), 'market/detail?source=skillhub&owner=ake&slug=dev-god'],
    ['marketInstalled', (api) => api.marketInstalled(), 'market/installed'],
    ['marketInstall', (api) => api.marketInstall({ source: 'skillhub', owner: 'ake', slug: 'dev-god' }), 'market/install'],
    ['marketIcons', (api) => api.marketIcons({ items: [{ source: 'skillhub', owner: 'ake', slug: 'dev-god' }] }), 'market/icons'],
  ];
  for (const [name, run, expected] of cases) {
    const { fetchImpl, calls } = fetchStub({ body: { code: 'OK', data: {}, message: '' } });
    const api = new SkillCenterApi(fetchImpl);
    await run(api);
    assert.equal(calls[0].url, `api/dsh-skill-center/${expected}`, `${name} 的 URL 是文档相对的 ${expected}`);
    assert.equal(calls[0].url.startsWith('/'), false, `${name} 不以 / 开头（GUI 可能挂在路径前缀下）`);
  }
});

test('K44 marketList 只发送有值的参数：空的值一律不出现在 URL 里', async () => {
  const { fetchImpl, calls } = fetchStub({ body: { code: 'OK', data: {}, message: '' } });
  const api = new SkillCenterApi(fetchImpl);
  await api.marketList({ source: 'clawhub', sort: 'updated', category: null, keyword: '  ', cursor: null, limit: 12 });
  assert.equal(
    calls[0].url,
    'api/dsh-skill-center/market/list?source=clawhub&sort=updated&limit=12',
    '空分类 / 空白关键词 / 空游标都不出现在查询串里',
  );
  await api.marketList({ source: 'skillhub', limit: 0 });
  assert.equal(calls[1].url, 'api/dsh-skill-center/market/list?source=skillhub', 'limit=0 当作没给（由 Host 夹取）');
});

test('K44 marketDetail 没有版本时不传 version 参数', async () => {
  const { fetchImpl, calls } = fetchStub({ body: { code: 'OK', data: {}, message: '' } });
  const api = new SkillCenterApi(fetchImpl);
  await api.marketDetail({ source: 'skillhub', owner: 'ake', slug: 'dev-god', version: null });
  assert.equal(calls[0].url.includes('version='), false, 'version 是 null 时不发空参数（「装当前版本」）');
  await api.marketDetail({ source: 'skillhub', owner: 'ake', slug: 'dev-god', version: '1.2.3' });
  assert.equal(calls[1].url.endsWith('&version=1.2.3'), true, '有版本时带上');
});

test('K44 marketInstall 的正文只有身份四件：没有 path、没有 files、没有 name', async () => {
  const { fetchImpl, calls } = fetchStub({ body: { code: 'OK', data: { name: 'dev-god' }, message: '' } });
  const api = new SkillCenterApi(fetchImpl);
  await api.marketInstall({ source: 'skillhub', owner: 'ake', slug: 'dev-god', version: '1.0.0', path: '/tmp/x', files: ['a'], name: 'hijack' });
  assert.equal(calls[0].init.method, 'POST', 'install 是 POST');
  assert.equal(calls[0].init.headers['content-type'], 'application/json', '声明 JSON 正文');
  assert.deepEqual(
    JSON.parse(calls[0].init.body),
    { source: 'skillhub', owner: 'ake', slug: 'dev-god', version: '1.0.0' },
    '正文只有四个身份字段（客户端不能指定落盘内容）',
  );
  await api.marketInstall({ source: 'clawhub', owner: 'o', slug: 's', version: null });
  assert.deepEqual(JSON.parse(calls[1].init.body), { source: 'clawhub', owner: 'o', slug: 's' }, '未知版本时整条不传');
});

test('K44 市场失败把信封里的 data 交给调用方（已装路径与声明名要能显示）', async () => {
  const body = {
    code: 'E_ALREADY_INSTALLED',
    data: { path: '/skills/dev-god', existing: { name: 'dev-god', version: '0.9.0' } },
    message: 'exists',
  };
  const { fetchImpl } = fetchStub({ status: 409, body });
  await assert.rejects(
    new SkillCenterApi(fetchImpl).marketInstall({ source: 'skillhub', owner: 'ake', slug: 'dev-god' }),
    (error) => {
      assert.equal(error.code, 'E_ALREADY_INSTALLED', '错误码透出');
      assert.equal(error.data.path, '/skills/dev-god', 'data.path 透出（界面要显示已装在哪）');
      assert.deepEqual(error.data.existing, { name: 'dev-god', version: '0.9.0' }, 'data.existing 透出');
      return true;
    },
  );
});

