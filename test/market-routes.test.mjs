/**
 * The five market routes: fences, query fences, envelopes and the installed map.
 *
 * Contracts: docs/contracts/routes.md §3.7.1 (route table), §3.7.2 (list semantics),
 * §3.7.3 (whitelists), §8.6 (codes and the `data` exception); case ids K35, K36.
 *
 * The routes are mounted against two fake adapters and a temp DSH home, so nothing
 * here reaches the network. What is being tested is the *fence*: which requests are
 * answered at all, and what the answer looks like when the upstream says no.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { ROUTES, makeRoutes } from '../lib/routes.js';
import { createInstaller } from '../lib/market/install.js';
import { createStore, storeFile } from '../lib/market/store.js';
import { LOOPBACK_HEADERS, callRoute } from './helpers/http.mjs';
import { tempDir } from './helpers/tree.mjs';

/** The clock every route call is pinned to. */
const NOW = () => Date.parse('2026-11-09T06:00:00.000Z');

/** A market item, as an adapter would emit it. */
const ITEM = {
  sourceId: 'skillhub',
  id: 'skillhub:ake:dev-god',
  owner: 'ake',
  slug: 'dev-god',
  displayName: 'Dev God',
  summary: 'A fixture skill.',
  author: 'Ake',
  version: '1.0.0',
  downloads: 12,
  updatedAt: NOW(),
  category: 'dev-tools',
  iconUrl: 'https://cdn.skillhub.cn/skill-icons/ake/dev-god.png',
  packageKind: 'files',
};

/**
 * Build one fake adapter.
 * @param {{id: string, items?: object[], next?: string|null, total?: number|null,
 *   failList?: string, failDetail?: string, categories?: object[]|null,
 *   categoriesThrows?: boolean, packageKind?: string}} options - adapter behaviour.
 * @returns {object} the adapter, with a log of the calls it received.
 */
function adapter(options) {
  const calls = [];
  return {
    id: options.id,
    labelKey: `market.source.${options.id}`,
    caps: {
      search: true,
      paged: true,
      categories: Array.isArray(options.categories),
      package: options.packageKind === 'zip' ? 'zip' : 'files',
    },
    calls,
    /**
     * Answer a listing.
     * @returns {Promise<object>} SourcePage.
     */
    async list() {
      calls.push('list');
      if (options.failList !== undefined) throw Object.assign(new Error('upstream down'), { code: options.failList });
      return { items: options.items ?? [ITEM], next: options.next ?? null, total: options.total ?? null };
    },
    /**
     * Answer a search.
     * @returns {Promise<object>} SourcePage.
     */
    async search(query) {
      calls.push(`search:${query.keyword}`);
      if (options.failList !== undefined) throw Object.assign(new Error('upstream down'), { code: options.failList });
      return { items: options.items ?? [ITEM], next: options.next ?? null, total: options.total ?? null };
    },
    /**
     * Answer a detail request.
     * @returns {Promise<object>} MarketDetail.
     */
    async detail(ref) {
      calls.push(`detail:${ref.owner}/${ref.slug}`);
      if (options.failDetail !== undefined) throw Object.assign(new Error('upstream down'), { code: options.failDetail });
      return {
        item: ITEM,
        overview: 'First line.',
        declaredName: ref.slug === 'dev-god' ? 'dev-god' : 'Design',
        nameValid: ref.slug === 'dev-god',
        files: [{ path: 'SKILL.md', size: 42 }],
        filesComplete: true,
      };
    },
    /**
     * Read the category table.
     * @returns {Promise<object>} the table.
     */
    async categories() {
      // The real adapter never throws: it degrades to `{items:[], ok:false}` so a dead
      // category endpoint cannot take the tab down (skillhub.js `categories`).
      if (options.categoriesThrows === true) return { items: [], ok: false, stale: false };
      return { items: options.categories ?? [], ok: true, stale: false };
    },
    /**
     * Serve one package file.
     * @param {object} plan - manifest.
     * @param {string} path - package path.
     * @returns {Promise<Buffer>} the bytes.
     */
    async fetchFile(plan, path) {
      calls.push(`fetch:${path}`);
      if (path !== 'SKILL.md') return Buffer.from('x');
      return Buffer.from('---\nname: dev-god\ndescription: Fixture.\n---\n');
    },
    /**
     * Return the package manifest.
     * @returns {Promise<object>} SourcePlan.
     */
    async plan() {
      calls.push('plan');
      return { version: '1.0.0', files: [{ path: 'SKILL.md', size: 44 }], meta: null };
    },
  };
}

/**
 * Mount the nine routes over a temp DSH home and two fake adapters.
 * @param {{skillhub?: object, clawhub?: object, withLedger?: boolean}} [options] - adapters.
 * @returns {Promise<{byPath: Record<string, object>, dshHome: string, skillsRoot: string,
 *   sources: object[], close: () => Promise<void>}>} the mounted routes.
 */
async function mount(options = {}) {
  const { dir, cleanup } = await tempDir();
  const skillsRoot = join(dir, 'skills');
  await mkdir(skillsRoot, { recursive: true });
  const skillhub = options.skillhub ?? adapter({ id: 'skillhub', categories: [{ key: 'dev-tools', name: '开发工具', nameEn: 'Dev tools' }] });
  const clawhub = options.clawhub ?? adapter({ id: 'clawhub', packageKind: 'zip' });
  const sources = [skillhub, clawhub];
  const sourceById = (id) => sources.find((source) => source.id === id);
  const store = createStore({ dshHome: dir, skillsRoot, now: NOW });
  const installer = createInstaller({ skillsRoot, io: {}, sourceById, store, now: NOW });
  const routes = makeRoutes({}, {
    dshHome: dir,
    skillsRoot,
    version: '9.9.9-test',
    registry: undefined,
    sessions: undefined,
    logger: { warn: () => {} },
    market: { io: {}, now: NOW, sources, sourceById, store, installer, skillsRoot },
  });
  return {
    byPath: Object.fromEntries(routes.map((route) => [route.path, route])),
    dshHome: dir,
    skillsRoot,
    sources,
    storeFile: storeFile(dir),
    close: cleanup,
  };
}

test('K35 五条市场路由都在表里，且都只认一个方法（GET 四条 + POST install）', async () => {
  const mounted = await mount();
  try {
    const expected = {
      [ROUTES.marketBootstrap]: 'GET',
      [ROUTES.marketList]: 'GET',
      [ROUTES.marketDetail]: 'GET',
      [ROUTES.marketInstalled]: 'GET',
      [ROUTES.marketInstall]: 'POST',
    };
    for (const [path, allowed] of Object.entries(expected)) {
      assert.equal(typeof mounted.byPath[path], 'object', `${path} 已注册`);
      const wrong = allowed === 'GET' ? 'POST' : 'GET';
      const response = await callRoute(mounted.byPath[path], { method: wrong, headers: LOOPBACK_HEADERS });
      assert.equal(response.status, 405, `${path} 用 ${wrong} 应 405`);
      assert.equal(response.json.code, 'E_METHOD', `${path} 的错误码是 E_METHOD`);
    }
  } finally {
    await mounted.close();
  }
});

test('K35 非 loopback 请求一律 403 E_FORBIDDEN，且没有发生上游调用', async () => {
  const mounted = await mount();
  try {
    for (const path of [
      ROUTES.marketBootstrap, ROUTES.marketList, ROUTES.marketDetail,
      ROUTES.marketInstalled, ROUTES.marketInstall,
    ]) {
      const before = mounted.sources.reduce((sum, source) => sum + source.calls.length, 0);
      const response = await callRoute(mounted.byPath[path], {
        method: path === ROUTES.marketInstall ? 'POST' : 'GET',
        headers: LOOPBACK_HEADERS,
        body: JSON.stringify({ source: 'skillhub', owner: 'ake', slug: 'dev-god' }),
        remoteAddress: '10.0.0.2',
      });
      assert.equal(response.status, 403, `${path} 对非回环来源返回 403`);
      assert.equal(response.json.code, 'E_FORBIDDEN', `${path} 的错误码是 E_FORBIDDEN`);
      assert.equal(response.json.data, null, '本地路由的失败信封 data 是 null');
      const after = mounted.sources.reduce((sum, source) => sum + source.calls.length, 0);
      assert.equal(after, before, `${path} 被挡下时没有触达上游`);
    }
  } finally {
    await mounted.close();
  }
});

test('K35 bootstrap：返回 sources / categories / categoriesOk / categoriesStale 四个键', async () => {
  const mounted = await mount();
  try {
    const response = await callRoute(mounted.byPath[ROUTES.marketBootstrap], { headers: LOOPBACK_HEADERS });
    assert.equal(response.status, 200, 'bootstrap 200');
    assert.equal(response.json.code, 'OK', '信封 code 是 OK');
    assert.deepEqual(Object.keys(response.json.data).sort(),
      ['categories', 'categoriesOk', 'categoriesStale', 'sources'], '恰好四个键');
    assert.deepEqual(response.json.data.sources.map((source) => source.id), ['skillhub', 'clawhub'], '两个来源按注册顺序');
    assert.deepEqual(response.json.data.sources[0], {
      id: 'skillhub',
      labelKey: 'market.source.skillhub',
      hasCategories: true,
      packageKind: 'files',
    }, '来源描述符形状固定（界面按它渲染筛选项，不枚举）');
    assert.equal(response.json.data.sources[1].hasCategories, false, 'ClawHub 没有分类表');
    assert.equal(response.json.data.categories.length, 1, '分类表透传');
    assert.equal(response.json.data.categoriesOk, true, '读成功');
  } finally {
    await mounted.close();
  }
});

test('K35 bootstrap 的分类失败不报错：categoriesOk=false + 空数组，列表照常可用', async () => {
  const mounted = await mount({ skillhub: adapter({ id: 'skillhub', categoriesThrows: true }) });
  try {
    const boot = await callRoute(mounted.byPath[ROUTES.marketBootstrap], { headers: LOOPBACK_HEADERS });
    assert.equal(boot.status, 200, '分类失败不是整页失败');
    assert.equal(boot.json.data.categoriesOk, false, 'categoriesOk 报 false');
    assert.deepEqual(boot.json.data.categories, [], '分类表为空');
    const list = await callRoute(mounted.byPath[ROUTES.marketList], {
      headers: LOOPBACK_HEADERS,
      url: `${ROUTES.marketList}?source=skillhub`,
    });
    assert.equal(list.status, 200, '列表仍然可用');
  } finally {
    await mounted.close();
  }
});

test('K35 list：200 只含七个键，两源各自一页，服务端不合并', async () => {
  const mounted = await mount();
  try {
    const skillhub = await callRoute(mounted.byPath[ROUTES.marketList], {
      headers: LOOPBACK_HEADERS,
      url: `${ROUTES.marketList}?source=skillhub&limit=3`,
    });
    assert.equal(skillhub.status, 200, 'list 200');
    assert.deepEqual(Object.keys(skillhub.json.data).sort(),
      ['category', 'items', 'keyword', 'next', 'sort', 'sourceId', 'total'], '恰好七个键（§3.7.1）');
    assert.equal(skillhub.json.data.sourceId, 'skillhub', 'sourceId 回显');
    assert.equal(skillhub.json.data.sort, 'recommended', 'sort 缺省 recommended');
    assert.equal(skillhub.json.data.keyword, '', '没有关键词');
    assert.equal(skillhub.json.data.category, null, '没有分类');
    assert.deepEqual(skillhub.json.data.items, [ITEM], '条目原样下发');
    assert.equal(skillhub.json.data.next, null, '没有下一页');
  } finally {
    await mounted.close();
  }
});

test('K36 list：未知 source 与 source=all 都是 400 E_BAD_QUERY', async () => {
  const mounted = await mount();
  try {
    for (const source of ['all', 'nope', 'SkillHub']) {
      const response = await callRoute(mounted.byPath[ROUTES.marketList], {
        headers: LOOPBACK_HEADERS,
        url: `${ROUTES.marketList}?source=${encodeURIComponent(source)}`,
      });
      assert.equal(response.status, 400, `source=${source} 应 400`);
      assert.equal(response.json.code, 'E_BAD_QUERY', `source=${source} 的错误码是 E_BAD_QUERY`);
    }
    const missing = await callRoute(mounted.byPath[ROUTES.marketList], { headers: LOOPBACK_HEADERS });
    assert.equal(missing.status, 400, '缺 source 也是 400（没有「全部来源」这一说）');
    assert.equal(missing.json.code, 'E_BAD_QUERY', '缺 source 的错误码是 E_BAD_QUERY');
  } finally {
    await mounted.close();
  }
});

test('K36 list：坏游标是 400 而不是 500，limit 越界被夹取不报错', async () => {
  const mounted = await mount();
  try {
    const badCursor = await callRoute(mounted.byPath[ROUTES.marketList], {
      headers: LOOPBACK_HEADERS,
      url: `${ROUTES.marketList}?source=skillhub&cursor=not-a-token`,
    });
    assert.equal(badCursor.status, 400, '坏游标 400');
    assert.equal(badCursor.json.code, 'E_BAD_QUERY', '坏游标的错误码是 E_BAD_QUERY');
    for (const limit of ['0', '999']) {
      const response = await callRoute(mounted.byPath[ROUTES.marketList], {
        headers: LOOPBACK_HEADERS,
        url: `${ROUTES.marketList}?source=skillhub&limit=${limit}`,
      });
      assert.equal(response.status, 200, `limit=${limit} 被夹取而不是报错`);
    }
    const badLimit = await callRoute(mounted.byPath[ROUTES.marketList], {
      headers: LOOPBACK_HEADERS,
      url: `${ROUTES.marketList}?source=skillhub&limit=abc`,
    });
    assert.equal(badLimit.status, 400, '非数字 limit 是 400');
  } finally {
    await mounted.close();
  }
});

test('K36 list：关键词非空自动走 search，为空走 list', async () => {
  const mounted = await mount();
  try {
    const source = mounted.sources[0];
    source.calls.length = 0;
    await callRoute(mounted.byPath[ROUTES.marketList], { headers: LOOPBACK_HEADERS, url: `${ROUTES.marketList}?source=skillhub` });
    assert.deepEqual(source.calls, ['list'], '没有关键词时调用 list');
    source.calls.length = 0;
    const searched = await callRoute(mounted.byPath[ROUTES.marketList], {
      headers: LOOPBACK_HEADERS,
      url: `${ROUTES.marketList}?source=skillhub&keyword=ui%20design`,
    });
    assert.deepEqual(source.calls, ['search:ui design'], '有关键词时调用 search');
    assert.equal(searched.json.data.keyword, 'ui design', 'keyword 回显（客户端用它显示「没有搜到」）');
  } finally {
    await mounted.close();
  }
});

test('K36 list：上游失败用 HTTP 状态码表达（502/503/504），不塞进 200 的响应体', async () => {
  for (const [code, status] of [
    ['E_SOURCE_UNAVAILABLE', 503],
    ['E_SOURCE_TIMEOUT', 504],
    ['E_SOURCE_BAD_RESPONSE', 502],
  ]) {
    const mounted = await mount({ skillhub: adapter({ id: 'skillhub', failList: code }) });
    try {
      const response = await callRoute(mounted.byPath[ROUTES.marketList], {
        headers: LOOPBACK_HEADERS,
        url: `${ROUTES.marketList}?source=skillhub`,
      });
      assert.equal(response.status, status, `${code} 对应 ${status}`);
      assert.equal(response.json.code, code, '错误码原样');
      assert.equal(response.json.data, null, '上游失败没有 detail，data 是 null');
    } finally {
      await mounted.close();
    }
  }
});

test('K36 detail：缺 source/owner/slug 都是 400；成功时补出 installTo', async () => {
  const mounted = await mount();
  try {
    for (const query of ['', '?source=skillhub', '?source=skillhub&owner=ake', '?source=skillhub&slug=dev-god']) {
      const response = await callRoute(mounted.byPath[ROUTES.marketDetail], {
        headers: LOOPBACK_HEADERS,
        url: `${ROUTES.marketDetail}${query}`,
      });
      assert.equal(response.status, 400, `detail${query || '（无参数）'} 应 400`);
      assert.equal(response.json.code, 'E_BAD_QUERY', '缺参的错误码是 E_BAD_QUERY');
    }
    const ok = await callRoute(mounted.byPath[ROUTES.marketDetail], {
      headers: LOOPBACK_HEADERS,
      url: `${ROUTES.marketDetail}?source=skillhub&owner=ake&slug=dev-god`,
    });
    assert.equal(ok.status, 200, 'detail 200');
    assert.deepEqual(Object.keys(ok.json.data).sort(),
      ['declaredName', 'files', 'filesComplete', 'iconUrl', 'installTo', 'item', 'nameValid', 'overview'],
      'MarketDetail 八个键（iconUrl 是给详情头与确认弹窗的那一份）');
    assert.equal(ok.json.data.nameValid, true, '声明名合规');
    assert.equal(ok.json.data.installTo, join(mounted.skillsRoot, 'dev-god'), 'installTo 由路由补（适配器不碰磁盘）');
    assert.equal(ok.json.data.files.length, 1, '文件清单透传');
    // 两个字段必须恒等：客户端可能读 detail.iconUrl，也可能读 detail.item.iconUrl，不能一个有一个没有。
    assert.equal(ok.json.data.iconUrl, ok.json.data.item.iconUrl, '顶层 iconUrl 与 item.iconUrl 恒等');
    assert.equal(ok.json.data.iconUrl, ITEM.iconUrl, '值就是适配器给的那一个');
  } finally {
    await mounted.close();
  }
});

test('K36 detail：声明名不合规时 installTo 退回 skillsRoot，nameValid=false', async () => {
  const mounted = await mount();
  try {
    const response = await callRoute(mounted.byPath[ROUTES.marketDetail], {
      headers: LOOPBACK_HEADERS,
      url: `${ROUTES.marketDetail}?source=skillhub&owner=ake&slug=${encodeURIComponent('Design')}`,
    });
    assert.equal(response.status, 200, 'detail 200（不合规也照常给详情）');
    assert.equal(response.json.data.nameValid, false, 'nameValid=false');
    assert.equal(response.json.data.declaredName, 'Design', '声明名原样给出');
    assert.equal(response.json.data.installTo, mounted.skillsRoot, '不合规时 installTo 退回 skillsRoot');
  } finally {
    await mounted.close();
  }
});

test('K36 installed：没有台账时 readable=false 且 items 为空对象', async () => {
  const mounted = await mount();
  try {
    const response = await callRoute(mounted.byPath[ROUTES.marketInstalled], { headers: LOOPBACK_HEADERS });
    assert.equal(response.status, 200, 'installed 200（台账缺失不是错误）');
    assert.deepEqual(response.json.data, { items: {}, readable: false }, 'readable=false + 空 items');
  } finally {
    await mounted.close();
  }
});

test('K36 installed：台账读不出来时也降级成 readable=false，不抛 500', async () => {
  const mounted = await mount();
  try {
    await mkdir(join(mounted.dshHome, 'dsh-skill-center'), { recursive: true });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(mounted.storeFile, '{ not json', 'utf8');
    const response = await callRoute(mounted.byPath[ROUTES.marketInstalled], { headers: LOOPBACK_HEADERS });
    assert.equal(response.status, 200, '损坏的台账不把整页打挂');
    assert.equal(response.json.data.readable, false, 'readable=false');
    assert.deepEqual(response.json.data.items, {}, 'items 为空');
  } finally {
    await mounted.close();
  }
});

test('K36 install：body 超 64 KiB 是 400 E_BAD_REQUEST，且没有发起安装', async () => {
  const mounted = await mount();
  try {
    const big = JSON.stringify({ source: 'skillhub', owner: 'ake', slug: 'dev-god', pad: 'x'.repeat(70 * 1024) });
    const response = await callRoute(mounted.byPath[ROUTES.marketInstall], {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: big,
    });
    assert.equal(response.status, 400, '超 64 KiB 的 body 返回 400');
    assert.equal(response.json.code, 'E_BAD_REQUEST', '错误码是 E_BAD_REQUEST');
    const calls = mounted.sources.reduce((sum, source) => sum + source.calls.length, 0);
    assert.equal(calls, 0, '被挡下的 body 没有触发任何上游调用');
  } finally {
    await mounted.close();
  }
});

test('K36 install：非对象 body 是 E_BAD_REQUEST，对象但字段不合规是 E_BAD_QUERY（都是 400）', async () => {
  const mounted = await mount();
  try {
    const cases = [
      ['[]', 'E_BAD_REQUEST'],
      ['"text"', 'E_BAD_REQUEST'],
      ['{}', 'E_BAD_QUERY'],
      ['{"source":"skillhub"}', 'E_BAD_QUERY'],
      ['{"source":"all","owner":"a","slug":"b"}', 'E_BAD_QUERY'],
    ];
    for (const [body, code] of cases) {
      const response = await callRoute(mounted.byPath[ROUTES.marketInstall], {
        method: 'POST',
        headers: LOOPBACK_HEADERS,
        body,
      });
      assert.equal(response.status, 400, `body=${body} 应 400`);
      assert.equal(response.json.code, code, `body=${body} 的错误码是 ${code}`);
    }
  } finally {
    await mounted.close();
  }
});

test('K36 install：成功时回八个字段，且技能真的落进临时 skillsRoot', async () => {
  const mounted = await mount();
  try {
    const response = await callRoute(mounted.byPath[ROUTES.marketInstall], {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: JSON.stringify({ source: 'skillhub', owner: 'ake', slug: 'dev-god' }),
    });
    assert.equal(response.status, 200, 'install 200');
    assert.deepEqual(Object.keys(response.json.data).sort(),
      ['bytes', 'files', 'name', 'owner', 'path', 'slug', 'source', 'version'], '恰好八个键');
    assert.equal(response.json.data.path, join(mounted.skillsRoot, 'dev-god'), '落点是临时 skillsRoot，绝不是 ~/.dsh/skills');
    const installed = await callRoute(mounted.byPath[ROUTES.marketInstalled], { headers: LOOPBACK_HEADERS });
    assert.equal(installed.json.data.readable, true, '装完之后台账可读');
    assert.equal(Object.keys(installed.json.data.items).length, 1, '台账里有一条');
  } finally {
    await mounted.close();
  }
});

test('K36 install：路径在 body 里不会生效（只认 source/owner/slug/version）', async () => {
  const mounted = await mount();
  try {
    const response = await callRoute(mounted.byPath[ROUTES.marketInstall], {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: JSON.stringify({
        source: 'skillhub',
        owner: 'ake',
        slug: 'dev-god',
        path: '/tmp/elsewhere',
        files: ['../evil.sh'],
        name: 'hijacked',
      }),
    });
    assert.equal(response.status, 200, '多余字段被忽略，安装照常');
    assert.equal(response.json.data.name, 'dev-god', '落盘名来自包内声明，不是 body');
    assert.equal(response.json.data.path, join(mounted.skillsRoot, 'dev-god'), '落点由 Host 决定');
  } finally {
    await mounted.close();
  }
});

test('K36 市场路由的失败信封是唯一允许带 data 的：已装与坏名各带自己的小对象', async () => {
  const mounted = await mount();
  try {
    const body = JSON.stringify({ source: 'skillhub', owner: 'ake', slug: 'dev-god' });
    await callRoute(mounted.byPath[ROUTES.marketInstall], { method: 'POST', headers: LOOPBACK_HEADERS, body });
    const again = await callRoute(mounted.byPath[ROUTES.marketInstall], { method: 'POST', headers: LOOPBACK_HEADERS, body });
    assert.equal(again.status, 409, '第二次安装 409');
    assert.equal(again.json.code, 'E_ALREADY_INSTALLED', '错误码 E_ALREADY_INSTALLED');
    assert.equal(again.json.data.path, join(mounted.skillsRoot, 'dev-god'), 'data.path 指出已装在哪');
    assert.deepEqual(again.json.data.existing, { name: 'dev-god', version: '1.0.0' }, 'data.existing 报出已有版本');
  } finally {
    await mounted.close();
  }
});

test('K36 市场路由不参与磁盘扫描：skillsRoot 不存在也能列表', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const skillhub = adapter({ id: 'skillhub' });
    const sourceById = (id) => (id === 'skillhub' ? skillhub : undefined);
    const store = createStore({ dshHome: dir, skillsRoot: join(dir, 'absent'), now: NOW });
    const routes = makeRoutes({}, {
      dshHome: dir,
      skillsRoot: join(dir, 'absent'),
      version: '9.9.9-test',
      registry: undefined,
      sessions: undefined,
      logger: { warn: () => {} },
      market: {
        io: {},
        now: NOW,
        sources: [skillhub],
        sourceById,
        store,
        installer: createInstaller({ skillsRoot: join(dir, 'absent'), io: {}, sourceById, store, now: NOW }),
        skillsRoot: join(dir, 'absent'),
      },
    });
    const list = routes.find((route) => route.path === ROUTES.marketList);
    const response = await callRoute(list, { headers: LOOPBACK_HEADERS, url: `${ROUTES.marketList}?source=skillhub` });
    assert.equal(response.status, 200, '市场列表不需要 skillsRoot 存在（与已安装页签的磁盘面分离）');
  } finally {
    await cleanup();
  }
});
