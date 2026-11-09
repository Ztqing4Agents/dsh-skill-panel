/**
 * The six market read/write routes: fences, query fences, envelopes, the installed map,
 * and the local bookmark write.
 *
 * Contracts: docs/contracts/routes.md §3.7.1 (route table), §3.7.2 (list semantics),
 * §3.7.3 (whitelists), §3.7.6 (`market/favorite` idempotency and cap), §8.6 (codes and
 * the `data` exception); case ids K35, K36, K76, K77.
 *
 * The routes are mounted against two fake adapters and a temp DSH home, so nothing
 * here reaches the network. What is being tested is the *fence*: which requests are
 * answered at all, and what the answer looks like when the upstream says no.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ROUTES, makeRoutes } from '../lib/routes.js';
import { createFavoritesStore, favoritesFile } from '../lib/market/favorites.js';
import { createInstaller } from '../lib/market/install.js';
import { createStore, storeFile } from '../lib/market/store.js';
import { LOOPBACK_HEADERS, callRoute } from './helpers/http.mjs';
import { ROOT } from './helpers/ssr.mjs';
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

/** A tiny SVG document, shaped like a Lucide icon. */
const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>';

/**
 * Build one fake adapter.
 * @param {{id: string, items?: object[], next?: string|null, total?: number|null,
 *   failList?: string, failDetail?: string, categories?: object[]|null,
 *   categoriesThrows?: boolean, counts?: Record<string, number|null>, countTotal?: number|null,
 *   countsThrows?: boolean, countsOk?: boolean, packageKind?: string}} options - adapter behaviour.
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
     * Read the per-category counts (chips numbers).
     * @returns {Promise<object>} counts, total and the `ok` flag.
     */
    async counts() {
      calls.push('counts');
      if (options.countsThrows === true) return { counts: {}, total: null, ok: false, stale: false };
      return {
        counts: options.counts ?? {},
        total: options.countTotal ?? null,
        ok: options.countsOk !== false,
        stale: false,
      };
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
 * Mount the ten routes under test over a temp DSH home and two fake adapters.
 * @param {{skillhub?: object, clawhub?: object, withLedger?: boolean, favorites?: object}} [options]
 *   adapters, and an optional favourites store to stand in for the real file.
 * @returns {Promise<{byPath: Record<string, object>, dshHome: string, skillsRoot: string,
 *   sources: object[], favoritesCalls: string[], favoritesFile: string,
 *   close: () => Promise<void>}>} the mounted routes.
 */
async function mount(options = {}) {
  const { dir, cleanup } = await tempDir();
  const skillsRoot = join(dir, 'skills');
  await mkdir(skillsRoot, { recursive: true });
  const skillhub = options.skillhub ?? adapter({ id: 'skillhub', categories: [{ key: 'dev-tools', name: '开发工具', nameEn: 'Dev tools' }] });
  const skillhubIconCalls = [];
  if (skillhub.icons === undefined) {
    skillhub.icons = options.skillhubIcons ?? (async (refs) => {
      skillhubIconCalls.push(refs.map((ref) => `${ref.owner}:${ref.slug}`));
      const icons = {};
      const names = {};
      for (const ref of refs) {
        const key = `skillhub:${ref.owner}:${ref.slug}`;
        icons[key] = ref.slug.startsWith('has-icon') ? 'https://cdn.skillhub.example/icon.png' : null;
        // R9：标题与图标同一次 detail 出来，两张图逐键同序
        names[key] = ref.slug.startsWith('has-icon') ? `Skill ${ref.slug}` : null;
      }
      return { icons, names };
    });
  }
  const resets = [];
  const iconCalls = [];
  const clawhub = options.clawhub ?? adapter({ id: 'clawhub', packageKind: 'zip' });
  if (options.iconsResolver !== undefined) clawhub.icons = options.iconsResolver;
  if (clawhub.icons === undefined) {
    clawhub.icons = async (refs) => {
      iconCalls.push(refs);
      const icons = {};
      const names = {};
      for (const ref of refs) {
        const key = `clawhub:${ref.owner}:${ref.slug}`;
        icons[key] = ref.slug.startsWith('has-icon') ? 'https://cdn.example.com/zap.png' : null;
        names[key] = ref.slug.startsWith('has-icon') ? `Claw ${ref.slug}` : null;
      }
      return { icons, names };
    };
  }
  const sources = [skillhub, clawhub];
  const sourceById = (id) => sources.find((source) => source.id === id);
  const store = createStore({ dshHome: dir, skillsRoot, now: NOW });
  const installer = createInstaller({ skillsRoot, io: {}, sourceById, store, now: NOW });
  // The bookmark store is a real file under the temp home, wrapped so a test can count
  // calls: "fenced before the store" is a property of the route, not of the file.
  const favoritesCalls = [];
  const realFavorites = options.favorites ?? createFavoritesStore({ dshHome: dir });
  const favorites = options.favorites === undefined
    ? {
      file: realFavorites.file,
      async read() {
        favoritesCalls.push('read');
        return realFavorites.read();
      },
      async toggle(id, favorited) {
        favoritesCalls.push(`toggle:${id}:${favorited}`);
        return realFavorites.toggle(id, favorited);
      },
    }
    : realFavorites;
  const routes = makeRoutes({}, {
    dshHome: dir,
    skillsRoot,
    version: '9.9.9-test',
    registry: undefined,
    sessions: undefined,
    logger: { warn: () => {} },
    market: {
      io: {},
      now: NOW,
      sources,
      sourceById,
      store,
      favorites,
      installer,
      skillsRoot,
      resetIconCache: () => resets.push('reset'),
    },
  });
  return {
    byPath: Object.fromEntries(routes.map((route) => [route.path, route])),
    dshHome: dir,
    skillsRoot,
    sources,
    skillhubIconCalls,
    iconCalls,
    resets,
    favoritesCalls,
    favoritesFile: favoritesFile(dir),
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

test('K35/K77 bootstrap：八个键（sources / categories / categoriesOk / categoriesStale / total / countsOk / favorites / favoritesOk）', async () => {
  const mounted = await mount({
    skillhub: adapter({
      id: 'skillhub',
      categories: [{ key: 'dev-tools', name: '开发编程', nameEn: 'Dev tools' }],
      counts: { 'dev-tools': 137000 },
      countTotal: 2540000,
    }),
  });
  try {
    const response = await callRoute(mounted.byPath[ROUTES.marketBootstrap], { headers: LOOPBACK_HEADERS });
    assert.equal(response.status, 200, 'bootstrap 200');
    assert.equal(response.json.code, 'OK', '信封 code 是 OK');
    assert.deepEqual(Object.keys(response.json.data).sort(),
      ['categories', 'categoriesOk', 'categoriesStale', 'countsOk', 'favorites', 'favoritesOk', 'sources', 'total'],
      '恰好八个键（R4 加了 total 与 countsOk；U2 加了 favorites 与 favoritesOk）');
    assert.deepEqual(response.json.data.sources.map((source) => source.id), ['skillhub', 'clawhub'], '两个来源按注册顺序');
    assert.deepEqual(response.json.data.sources[0], {
      id: 'skillhub',
      labelKey: 'market.source.skillhub',
      hasCategories: true,
      packageKind: 'files',
    }, '来源描述符形状固定（界面按它渲染筛选项，不枚举）');
    assert.equal(response.json.data.sources[1].hasCategories, false, 'ClawHub 没有分类表');
    assert.deepEqual(response.json.data.categories, [{ key: 'dev-tools', name: '开发编程', nameEn: 'Dev tools', count: 137000 }], '分类表透传并带上各自的 count');
    assert.equal(response.json.data.categoriesOk, true, '分类读成功');
    assert.equal(response.json.data.total, 2540000, 'total 是「全部」的数量');
    assert.equal(response.json.data.countsOk, true, '计数齐全');
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

test('K53 bootstrap 的计数降级：计数失败不报错，count 全 null + countsOk:false，列表照常', async () => {
  const mounted = await mount({
    skillhub: adapter({
      id: 'skillhub',
      categories: [
        { key: 'dev-tools', name: '开发编程', nameEn: 'Dev tools' },
        { key: 'office', name: '办公效率', nameEn: 'Office' },
      ],
      countsThrows: true,
    }),
  });
  try {
    const boot = await callRoute(mounted.byPath[ROUTES.marketBootstrap], { headers: LOOPBACK_HEADERS });
    assert.equal(boot.status, 200, '计数失败不是整页失败（§8.6）');
    assert.equal(boot.json.data.countsOk, false, 'countsOk 报 false');
    assert.equal(boot.json.data.total, null, 'total 也是 null');
    assert.deepEqual(
      boot.json.data.categories.map((entry) => entry.count),
      [null, null],
      '每个分类的 count 都是 null —— 界面据此整段不渲染数字',
    );
    assert.deepEqual(
      boot.json.data.categories.map((entry) => entry.key),
      ['dev-tools', 'office'],
      '分类本身照常下发（chips 还能点）',
    );
    assert.equal(boot.json.data.categoriesOk, true, '分类表本身没问题');
    const list = await callRoute(mounted.byPath[ROUTES.marketList], {
      headers: LOOPBACK_HEADERS,
      url: `${ROUTES.marketList}?source=skillhub`,
    });
    assert.equal(list.status, 200, '列表仍然可用');
  } finally {
    await mounted.close();
  }
});

test('K53 bootstrap 对「没有 counts 能力的源」与脏数字的处理', async () => {
  // 第三个源只实现 §7.1 那些函数、没有 counts：bootstrap 仍要 200，只是没有数字。
  const bare = adapter({ id: 'skillhub', categories: [{ key: 'dev-tools', name: '开发编程', nameEn: 'Dev tools' }] });
  delete bare.counts;
  const mounted = await mount({ skillhub: bare });
  try {
    const boot = await callRoute(mounted.byPath[ROUTES.marketBootstrap], { headers: LOOPBACK_HEADERS });
    assert.equal(boot.status, 200, '没有 counts 不是错误');
    assert.equal(boot.json.data.countsOk, false, '没有实现 ⇒ countsOk:false');
    assert.equal(boot.json.data.total, null, 'total 为 null');
    assert.deepEqual(boot.json.data.categories.map((entry) => entry.count), [null], '分类项 count 为 null');
  } finally {
    await mounted.close();
  }

  // 上游脏数据（小数 / 字符串）在路由层被 `Number.isInteger` 挡掉，界面不会显示 "1.5"。
  const dirty = adapter({
    id: 'skillhub',
    categories: [
      { key: 'dev-tools', name: '开发编程', nameEn: 'Dev tools' },
      { key: 'office', name: '办公效率', nameEn: 'Office' },
    ],
  });
  dirty.counts = async () => ({ counts: { 'dev-tools': 1.5, office: '9' }, total: 2.5, ok: true });
  const dirtyMounted = await mount({ skillhub: dirty });
  try {
    const boot = await callRoute(dirtyMounted.byPath[ROUTES.marketBootstrap], { headers: LOOPBACK_HEADERS });
    assert.deepEqual(
      boot.json.data.categories.map((entry) => entry.count),
      [null, null],
      '小数与字符串都当成「没数」',
    );
    assert.equal(boot.json.data.total, null, 'total 的小数同样被挡');
  } finally {
    await dirtyMounted.close();
  }
});

test('bootstrap 的 ?refresh=1 仍会清图标缓存（U7 之后两条代理路由已删，这条只守 refresh）', async () => {
  const mounted = await mount();
  try {
    assert.deepEqual(mounted.resets, [], '还没有清过缓存');
    await callRoute(mounted.byPath[ROUTES.marketBootstrap], { headers: LOOPBACK_HEADERS, url: `${ROUTES.marketBootstrap}?refresh=1` });
    assert.deepEqual(mounted.resets, ['reset'], '?refresh=1 清一次图标缓存（调试用）');
    await callRoute(mounted.byPath[ROUTES.marketBootstrap], { headers: LOOPBACK_HEADERS });
    assert.equal(mounted.resets.length, 1, '不带 refresh 不清');
  } finally {
    await mounted.close();
  }
});

test('K57 POST market/icons：批量语义（≤24、去重、按请求顺序、单条 null 不影响整批）', async () => {
  const mounted = await mount();
  try {
    const route = mounted.byPath[ROUTES.marketIcons];
    const body = JSON.stringify({
      source: 'clawhub',
      items: [
        { owner: 'o', slug: 'has-icon-one' },
        { owner: 'o', slug: 'plain' },
        { owner: 'o', slug: 'has-icon-one' },
      ],
    });
    const good = await callRoute(route, { method: 'POST', headers: LOOPBACK_HEADERS, body });
    assert.equal(good.status, 200, '200');
    assert.deepEqual(Object.keys(good.json), ['code', 'data', 'message'], '信封还是 code/data/message');
    assert.equal(good.json.code, 'OK', '成功信封 code OK');
    // R9：图标与标题一起回，两张图逐键同序
    assert.deepEqual(Object.keys(good.json.data), ['icons', 'names'], 'data 是 icons + names');
    assert.deepEqual(Object.keys(good.json.data.names), Object.keys(good.json.data.icons), '两张图逐键同序');
    assert.deepEqual(
      Object.keys(good.json.data.icons),
      ['clawhub:o:has-icon-one', 'clawhub:o:plain'],
      '键按请求顺序排列，重复项已去重',
    );
    assert.equal(good.json.data.icons['clawhub:o:has-icon-one'], 'https://cdn.example.com/zap.png', '有图标的那条');
    assert.equal(good.json.data.icons['clawhub:o:plain'], null, '没有图标的那条是 null，不是缺键');
    assert.equal(good.json.data.names['clawhub:o:has-icon-one'], 'Claw has-icon-one', '标题也回来了');
    assert.equal(good.json.data.names['clawhub:o:plain'], null, '没有标题的那条是 null（键在）');
    assert.deepEqual(mounted.iconCalls[0], [{ owner: 'o', slug: 'has-icon-one' }, { owner: 'o', slug: 'plain' }], '去重后才交给适配器');

    const tooMany = JSON.stringify({ source: 'clawhub', items: Array.from({ length: 25 }, (_, i) => ({ owner: 'o', slug: `s-${i}` })) });
    const capped = await callRoute(route, { method: 'POST', headers: LOOPBACK_HEADERS, body: tooMany });
    assert.equal(capped.status, 400, '25 条 ⇒ 400');
    assert.equal(capped.json.code, 'E_BAD_REQUEST', '条数越界是 E_BAD_REQUEST');

    const cases = [
      [{ source: 'nope', items: [{ owner: 'o', slug: 's' }] }, 'E_BAD_QUERY', '未注册的源'],
      [{ source: 'clawhub', items: [] }, 'E_BAD_REQUEST', '空数组'],
      [{ source: 'clawhub' }, 'E_BAD_REQUEST', '没有 items'],
      [{ source: 'clawhub', items: [{ owner: 'o' }] }, 'E_BAD_QUERY', '缺 slug'],
      [{ source: 'clawhub', items: [{ owner: '../x', slug: 's' }] }, 'E_BAD_QUERY', 'owner 带路径'],
      [{ source: 'clawhub', items: ['nope'] }, 'E_BAD_REQUEST', '元素不是对象'],
    ];
    for (const [payload, code, why] of cases) {
      const bad = await callRoute(route, { method: 'POST', headers: LOOPBACK_HEADERS, body: JSON.stringify(payload) });
      assert.equal(bad.status, 400, `${why} ⇒ 400`);
      assert.equal(bad.json.code, code, `${why} ⇒ ${code}`);
    }
    // R7：SkillHub 现在是合法源（已安装行也要图），混合批次见 K64。
    const skillhubBatch = await callRoute(route, {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: JSON.stringify({ source: 'skillhub', items: [{ owner: 'ake', slug: 'has-icon-skill' }] }),
    });
    assert.equal(skillhubBatch.status, 200, 'SkillHub 批次 ⇒ 200（不再被当成未注册源）');
    assert.deepEqual(Object.keys(skillhubBatch.json.data.icons), ['skillhub:ake:has-icon-skill'], '键带源前缀');
    assert.deepEqual(Object.keys(skillhubBatch.json.data.names), ['skillhub:ake:has-icon-skill'], '标题图同键');

    const notJson = await callRoute(route, { method: 'POST', headers: LOOPBACK_HEADERS, body: 'not json' });
    assert.equal(notJson.status, 400, '非 JSON ⇒ 400');
    assert.equal(notJson.json.code, 'E_BAD_REQUEST', '非 JSON 是 E_BAD_REQUEST');

    const wrongMethod = await callRoute(route, { method: 'GET', headers: LOOPBACK_HEADERS });
    assert.equal(wrongMethod.status, 405, '只认 POST');
    const foreign = await callRoute(route, {
      method: 'POST',
      headers: { host: 'evil.example.com' },
      remoteAddress: '203.0.113.9',
      body,
    });
    assert.equal(foreign.status, 403, '非本机 403');
    assert.equal(mounted.iconCalls.length, 1, '被拒的请求一次都没到适配器');
  } finally {
    await mounted.close();
  }
});

test('K64 POST market/icons 收 per-item source：混合批次两源都在、按请求顺序、顶层 source 作缺省', async () => {
  const mounted = await mount();
  try {
    const route = mounted.byPath[ROUTES.marketIcons];
    const mixed = JSON.stringify({
      items: [
        { source: 'skillhub', owner: 'ake', slug: 'has-icon-hub' },
        { source: 'clawhub', owner: 'awspace', slug: 'has-icon-one' },
        { source: 'skillhub', owner: 'ake', slug: 'plain-hub' },
        { source: 'clawhub', owner: 'awspace', slug: 'plain' },
        { source: 'skillhub', owner: 'ake', slug: 'has-icon-hub' },
      ],
    });
    const response = await callRoute(route, { method: 'POST', headers: LOOPBACK_HEADERS, body: mixed });
    assert.equal(response.status, 200, '混合批次 200');
    assert.deepEqual(
      Object.keys(response.json.data.icons),
      ['skillhub:ake:has-icon-hub', 'clawhub:awspace:has-icon-one', 'skillhub:ake:plain-hub', 'clawhub:awspace:plain'],
      '两源的键都在，按请求顺序，完整键去重（重复的 skillhub 条目只出现一次）',
    );
    assert.deepEqual(Object.keys(response.json.data), ['icons', 'names'], 'K64 的 data 也是两张图');
    assert.equal(response.json.data.icons['skillhub:ake:has-icon-hub'], 'https://cdn.skillhub.example/icon.png', 'SkillHub 那条取到图');
    assert.equal(response.json.data.icons['clawhub:awspace:has-icon-one'], 'https://cdn.example.com/zap.png', 'ClawHub 那条照旧');
    assert.equal(response.json.data.icons['skillhub:ake:plain-hub'], null, 'SkillHub 没图 ⇒ null');
    assert.deepEqual(mounted.skillhubIconCalls[0], ['ake:has-icon-hub', 'ake:plain-hub'], '每个源只看到自己那几条（重复项已去掉）');
    assert.deepEqual(mounted.iconCalls[0], [{ owner: 'awspace', slug: 'has-icon-one' }, { owner: 'awspace', slug: 'plain' }], 'ClawHub 同样');

    // 顶层 source 作为缺省值：条目不带 source 时用它
    const fallback = await callRoute(route, {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: JSON.stringify({ source: 'skillhub', items: [{ owner: 'ake', slug: 'has-icon-hub' }] }),
    });
    assert.equal(fallback.status, 200, '顶层 source 生效');
    assert.equal(fallback.json.data.icons['skillhub:ake:has-icon-hub'], 'https://cdn.skillhub.example/icon.png', '缺省值走 skillhub');

    // item 覆盖顶层：同一批里两种来源都能各按自己的来
    const override = await callRoute(route, {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: JSON.stringify({
        source: 'clawhub',
        items: [{ owner: 'ake', slug: 'has-icon-hub', source: 'skillhub' }, { owner: 'awspace', slug: 'has-icon-one' }],
      }),
    });
    assert.equal(override.status, 200, 'item 覆盖顶层 200');
    assert.deepEqual(
      Object.keys(override.json.data.icons),
      ['skillhub:ake:has-icon-hub', 'clawhub:awspace:has-icon-one'],
      'item 的 source 赢，缺省值补另一条',
    );

    // 未注册源 ⇒ 400 E_BAD_QUERY（不管在顶层还是在条目上）
    for (const payload of [
      { source: 'nope', items: [{ owner: 'a', slug: 'b' }] },
      { items: [{ source: 'nope', owner: 'a', slug: 'b' }] },
      { source: 'clawhub', items: [{ source: 'nope', owner: 'a', slug: 'b' }] },
    ]) {
      const bad = await callRoute(route, { method: 'POST', headers: LOOPBACK_HEADERS, body: JSON.stringify(payload) });
      assert.equal(bad.status, 400, `${JSON.stringify(payload).slice(0, 40)} ⇒ 400`);
      assert.equal(bad.json.code, 'E_BAD_QUERY', '未注册源是 E_BAD_QUERY（不是形状错误）');
    }

    // KI-R7-1 的现场：只要有一条 owner/slug 不合规，整批 400 ⇒ 客户端 catch 后把**整批**记成
    // tried（这一批里的好条目也一起失去图标）。Host 的 isUpstreamIdentity 目前保证不会发出这种
    // 请求（K62 钉住），所以这是纵深防御缺口，不是线上故障；已报 Engineer。
    const poisoned = await callRoute(route, {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: JSON.stringify({
        items: [
          { source: 'skillhub', owner: 'ake', slug: 'has-icon-hub' },
          { source: 'skillhub', owner: '', slug: 'x' },
        ],
      }),
    });
    assert.equal(poisoned.status, 400, '一条坏条目 ⇒ 整批 400（好条目也拿不到图）');
    assert.equal(poisoned.json.code, 'E_BAD_QUERY', '坏条目是 E_BAD_QUERY');

    // > 24 条是形状问题 ⇒ E_BAD_REQUEST（合计口径，不分源）
    const tooMany = JSON.stringify({
      items: Array.from({ length: 25 }, (_, index) => ({ source: index % 2 === 0 ? 'skillhub' : 'clawhub', owner: 'o', slug: `s-${index}` })),
    });
    const capped = await callRoute(route, { method: 'POST', headers: LOOPBACK_HEADERS, body: tooMany });
    assert.equal(capped.status, 400, '25 条（两源混合）⇒ 400');
    assert.equal(capped.json.code, 'E_BAD_REQUEST', '合计 24 的上限是形状问题');
  } finally {
    await mounted.close();
  }
});

test('K66 单源失败不连坐：SkillHub 整体抛错 ⇒ 200、skillhub 键全 null、clawhub 键照常有值', async () => {
  const mounted = await mount({
    skillhubIcons: async () => {
      throw new Error('skillhub is down');
    },
  });
  try {
    const route = mounted.byPath[ROUTES.marketIcons];
    const response = await callRoute(route, {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: JSON.stringify({
        items: [
          { source: 'skillhub', owner: 'ake', slug: 'has-icon-hub' },
          { source: 'clawhub', owner: 'awspace', slug: 'has-icon-one' },
          { source: 'skillhub', owner: 'ake', slug: 'plain-hub' },
        ],
      }),
    });
    assert.equal(response.status, 200, '一个源挂了仍然 200（图标是装饰，不升级成路由错误）');
    assert.deepEqual(
      response.json.data.icons,
      {
        'skillhub:ake:has-icon-hub': null,
        'clawhub:awspace:has-icon-one': 'https://cdn.example.com/zap.png',
        'skillhub:ake:plain-hub': null,
      },
      '失败的源全 null，另一个照常',
    );
    // R9：标题跟着图标一起走 —— 单源失败时它那一侧的 names 也必须是 null，
    // 不能出现「图标是 null、标题却还在」的错位（同一个 values 条目同时喂两张图）。
    assert.deepEqual(
      response.json.data.names,
      {
        'skillhub:ake:has-icon-hub': null,
        'clawhub:awspace:has-icon-one': 'Claw has-icon-one',
        'skillhub:ake:plain-hub': null,
      },
      '失败源的标题也一起 null，另一源标题照常',
    );
    assert.deepEqual(Object.keys(response.json.data.names), Object.keys(response.json.data.icons), '两张图同键同序');
    assert.equal(response.json.code, 'OK', '信封仍是 OK');
  } finally {
    await mounted.close();
  }
});

/** A valid bookmark request body: identity plus the target state, nothing else. */
const FAVORITE_BODY = JSON.stringify({ source: 'skillhub', owner: 'ake', slug: 'dev-god', favorited: true });

test('K76 market/favorite 的围栏：只认 POST，只认 loopback，被挡下时零 store 调用', async () => {
  const mounted = await mount();
  try {
    const route = mounted.byPath[ROUTES.marketFavorite];
    assert.equal(typeof route, 'object', '收藏路由已注册');

    const wrongMethod = await callRoute(route, { method: 'GET', headers: LOOPBACK_HEADERS });
    assert.equal(wrongMethod.status, 405, 'GET ⇒ 405');
    assert.equal(wrongMethod.json.code, 'E_METHOD', '错误码是 E_METHOD');
    assert.deepEqual(mounted.favoritesCalls, [], '错方法时没有碰收藏文件');

    const fenced = await callRoute(route, {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: FAVORITE_BODY,
      remoteAddress: '10.0.0.2',
    });
    assert.equal(fenced.status, 403, '非回环来源 ⇒ 403');
    assert.equal(fenced.json.code, 'E_FORBIDDEN', '错误码是 E_FORBIDDEN');
    assert.equal(fenced.json.data, null, '本地路由的失败信封 data 是 null');
    assert.deepEqual(mounted.favoritesCalls, [], '被挡下时既没读也没写');
  } finally {
    await mounted.close();
  }
});

test('K76 market/favorite 的 body 形状：非对象 / 空 / favorited 非布尔都是 400 E_BAD_REQUEST', async () => {
  const mounted = await mount();
  try {
    const route = mounted.byPath[ROUTES.marketFavorite];
    const cases = [
      ['[]', 'body 是数组（不是对象）'],
      ['', '空 body'],
      ['{oops', '不是 JSON'],
      [JSON.stringify({ source: 'skillhub', owner: 'ake', slug: 'dev-god' }), '没有 favorited'],
      [JSON.stringify({ source: 'skillhub', owner: 'ake', slug: 'dev-god', favorited: 'true' }), 'favorited 是字符串'],
    ];
    for (const [body, hint] of cases) {
      const response = await callRoute(route, { method: 'POST', headers: LOOPBACK_HEADERS, body });
      assert.equal(response.status, 400, `${hint} ⇒ 400`);
      assert.equal(response.json.code, 'E_BAD_REQUEST', `${hint} ⇒ E_BAD_REQUEST（形状不对，不是参数不对）`);
    }
    assert.deepEqual(mounted.favoritesCalls, [], '形状不对时一次都没碰收藏文件');
  } finally {
    await mounted.close();
  }
});

test('K76 身份白名单：owner 带路径片段或源未注册都是 400 E_BAD_QUERY', async () => {
  const mounted = await mount();
  try {
    const route = mounted.byPath[ROUTES.marketFavorite];
    for (const body of [
      { source: 'skillhub', owner: '../x', slug: 'dev-god', favorited: true },
      { source: 'skillhub', owner: 'ake', slug: 'dev-god', favorited: true, source2: 'x' },
      { source: 'nosuch', owner: 'ake', slug: 'dev-god', favorited: true },
    ]) {
      const response = await callRoute(route, {
        method: 'POST',
        headers: LOOPBACK_HEADERS,
        body: JSON.stringify(body),
      });
      // `source2` is an extra field and is simply ignored, so that one succeeds; the other
      // two are rejected. Assert per case below instead of one blanket expectation.
      if (body.source === 'nosuch' || body.owner === '../x') {
        assert.equal(response.status, 400, `${JSON.stringify(body)} ⇒ 400`);
        assert.equal(response.json.code, 'E_BAD_QUERY', `${JSON.stringify(body)} ⇒ E_BAD_QUERY（身份/源不合规）`);
      } else {
        assert.equal(response.status, 200, '多余字段被忽略，不影响合法请求');
      }
    }
  } finally {
    await mounted.close();
  }
});

test('K76 成功与幂等：出参只有 favorites/favorited，重复收藏不写盘，body 里的 id/path 不生效', async () => {
  const mounted = await mount();
  try {
    const route = mounted.byPath[ROUTES.marketFavorite];
    const first = await callRoute(route, { method: 'POST', headers: LOOPBACK_HEADERS, body: FAVORITE_BODY });
    assert.equal(first.status, 200, '收藏成功 200');
    assert.deepEqual(
      Object.keys(first.json.data).sort(),
      ['favorited', 'favorites'],
      '出参恰好两个键（权威全量列表 + 生效状态）',
    );
    assert.deepEqual(first.json.data, { favorites: ['skillhub:ake:dev-god'], favorited: true }, '键由 Host 用三元组重拼');
    const before = await readFile(mounted.favoritesFile, 'utf8');

    const again = await callRoute(route, {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: JSON.stringify({
        source: 'skillhub',
        owner: 'ake',
        slug: 'dev-god',
        favorited: true,
        id: 'evil:whatever:key',
        path: '/etc/passwd',
      }),
    });
    assert.equal(again.status, 200, '重复收藏仍是 200（幂等）');
    assert.deepEqual(again.json.data.favorites, ['skillhub:ake:dev-god'], 'id 字段不生效：键仍是重拼的那个');
    assert.equal(await readFile(mounted.favoritesFile, 'utf8'), before, '字节不变（幂等不写盘）');

    const removed = await callRoute(route, {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: JSON.stringify({ source: 'skillhub', owner: 'ake', slug: 'dev-god', favorited: false }),
    });
    assert.deepEqual(removed.json.data, { favorites: [], favorited: false }, '取消后列表为空');
  } finally {
    await mounted.close();
  }
});

test('K76 两个失败码：满 500 ⇒ 409 E_FAVORITE_FULL，写盘失败 ⇒ 500 E_FAVORITE_IO（失败信封不带 data）', async () => {
  // The cap is exercised through the *real* store: a file holding 500 bookmarks, then
  // one more POST. The I/O failure needs a store that cannot write, so that one is stubbed.
  const capped = await mount();
  await mkdir(join(capped.dshHome, 'dsh-skill-center'), { recursive: true });
  await writeFile(
    capped.favoritesFile,
    `${JSON.stringify({
      version: 1,
      favorites: Array.from({ length: 500 }, (_, i) => `skillhub:ake:id-${i}`),
    })}
`,
    'utf8',
  );
  const failing = await mount();
  try {
    const fullResponse = await callRoute(capped.byPath[ROUTES.marketFavorite], {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: FAVORITE_BODY,
    });
    assert.equal(fullResponse.status, 409, '满 500 时新增 ⇒ 409');
    assert.equal(fullResponse.json.code, 'E_FAVORITE_FULL', '错误码 E_FAVORITE_FULL');

    // The real store, on a home it cannot create a file under: the fs error must surface
    // as the route's own code, not as a generic 500.
    await chmod(failing.dshHome, 0o555);
    try {
      const ioFailure = await callRoute(failing.byPath[ROUTES.marketFavorite], {
        method: 'POST',
        headers: LOOPBACK_HEADERS,
        body: FAVORITE_BODY,
      });
      assert.equal(ioFailure.status, 500, '写盘失败 ⇒ 500');
      assert.equal(ioFailure.json.code, 'E_FAVORITE_IO', '文件系统失败映射成 E_FAVORITE_IO（不是 E_INTERNAL）');
      assert.equal(ioFailure.json.data, null, '收藏的失败信封不带 data（界面只有一句 toast）');
    } finally {
      await chmod(failing.dshHome, 0o755);
    }
  } finally {
    await capped.close();
    await failing.close();
  }
});

test('K77 bootstrap 下发收藏：正常文件透传（最新在前）+ favoritesOk:true', async () => {
  const mounted = await mount();
  try {
    await mkdir(join(mounted.dshHome, 'dsh-skill-center'), { recursive: true });
    await writeFile(
      mounted.favoritesFile,
      `${JSON.stringify({ version: 1, favorites: ['clawhub:ivangdavila:design', 'skillhub:ake:dev-god'] }, null, 2)}\n`,
      'utf8',
    );
    const response = await callRoute(mounted.byPath[ROUTES.marketBootstrap], { headers: LOOPBACK_HEADERS });
    assert.equal(response.status, 200, 'bootstrap 200');
    assert.deepEqual(
      response.json.data.favorites,
      ['clawhub:ivangdavila:design', 'skillhub:ake:dev-god'],
      '收藏随 bootstrap 下发，顺序即文件顺序（最新在前）',
    );
    assert.equal(response.json.data.favoritesOk, true, '读成功才 true');
  } finally {
    await mounted.close();
  }
});

test('K77 收藏文件缺失 / 损坏都仍是 200：缺失报 favoritesOk:true，损坏才 false；refresh 不清收藏', async () => {
  const mounted = await mount();
  try {
    // 1. No file at all: a fresh install. Nobody has saved anything, so this is not a
    //    defect - `favoritesOk` must stay true or every first run raises a false alarm.
    const missing = await callRoute(mounted.byPath[ROUTES.marketBootstrap], { headers: LOOPBACK_HEADERS });
    assert.equal(missing.status, 200, '没有文件也是 200');
    assert.deepEqual(missing.json.data.favorites, [], '没有文件 ⇒ 空集');
    assert.equal(missing.json.data.favoritesOk, true, '缺失 ≠ 损坏：首启不报「书签可能丢了」');

    // 2. A corrupt file: this is the case the flag exists for.
    await mkdir(join(mounted.dshHome, 'dsh-skill-center'), { recursive: true });
    await writeFile(mounted.favoritesFile, '{"favorites": 3}\n', 'utf8');

    const broken = await callRoute(mounted.byPath[ROUTES.marketBootstrap], { headers: LOOPBACK_HEADERS });
    assert.equal(broken.status, 200, '损坏降级不是错误：仍然 200');
    assert.deepEqual(broken.json.data.favorites, [], '降级成空集');
    assert.equal(broken.json.data.favoritesOk, false, '损坏才报 false');
    assert.equal(Array.isArray(broken.json.data.sources), true, '其余键照常（市场页不失败）');

    await writeFile(mounted.favoritesFile, `${JSON.stringify({ version: 1, favorites: ['skillhub:ake:dev-god'] })}\n`, 'utf8');
    const refreshed = await callRoute(mounted.byPath[ROUTES.marketBootstrap], {
      headers: LOOPBACK_HEADERS,
      url: `${ROUTES.marketBootstrap}?refresh=1`,
    });
    assert.deepEqual(refreshed.json.data.favorites, ['skillhub:ake:dev-god'], 'refresh=1 只清缓存，不动收藏');
    assert.equal(refreshed.json.data.favoritesOk, true, '刷新后仍读成功');
  } finally {
    await mounted.close();
  }
});

test('K76 favorited 只认布尔：null / 1 / 0 / [] 都是 400 E_BAD_REQUEST，且零 store 调用', async () => {
  const mounted = await mount();
  try {
    const route = mounted.byPath[ROUTES.marketFavorite];
    for (const value of [null, 1, 0, [], {}]) {
      const response = await callRoute(route, {
        method: 'POST',
        headers: LOOPBACK_HEADERS,
        body: JSON.stringify({ source: 'skillhub', owner: 'ake', slug: 'dev-god', favorited: value }),
      });
      assert.equal(response.status, 400, `favorited=${JSON.stringify(value)} ⇒ 400`);
      assert.equal(response.json.code, 'E_BAD_REQUEST', '形状不对（不是参数不合白名单）');
    }
    assert.deepEqual(mounted.favoritesCalls, [], '布尔不对的请求一次都没碰收藏文件');
  } finally {
    await mounted.close();
  }
});

test('K76 出参列表最新在前：第二个收藏排第一个；取消没收藏过的条目仍是 200 且不写盘', async () => {
  const mounted = await mount();
  try {
    const route = mounted.byPath[ROUTES.marketFavorite];
    const post = (body) => callRoute(route, { method: 'POST', headers: LOOPBACK_HEADERS, body: JSON.stringify(body) });

    const first = await post({ source: 'skillhub', owner: 'ake', slug: 'dev-god', favorited: true });
    assert.deepEqual(first.json.data.favorites, ['skillhub:ake:dev-god'], '第一条');
    const second = await post({ source: 'clawhub', owner: 'ivangdavila', slug: 'design', favorited: true });
    assert.deepEqual(
      second.json.data.favorites,
      ['clawhub:ivangdavila:design', 'skillhub:ake:dev-god'],
      '两个源各自一条，最新收藏在前（与文件顺序、bootstrap 下发顺序一致）',
    );

    const before = await readFile(mounted.favoritesFile, 'utf8');
    const never = await post({ source: 'skillhub', owner: 'ake', slug: 'never-saved', favorited: false });
    assert.equal(never.status, 200, '取消一个没收藏过的条目仍是 200（幂等）');
    assert.deepEqual(never.json.data, {
      favorites: ['clawhub:ivangdavila:design', 'skillhub:ake:dev-god'],
      favorited: false,
    }, '列表原样回，状态是「它现在确实没被收藏」');
    assert.equal(await readFile(mounted.favoritesFile, 'utf8'), before, '不产生无意义的写盘');
  } finally {
    await mounted.close();
  }
});

test('K77 契约文本与实现同形：routes.md 的 bootstrap 行必须列出 favorites / favoritesOk', async () => {
  // K77 says the response has exactly eight keys; the route table is where a reader
  // learns that shape, so the two cannot disagree. (K30 does the same for the codes.)
  const text = await readFile(join(ROOT, 'docs', 'contracts', 'routes.md'), 'utf8');
  const row = text.split('\n').find((line) => line.includes('`GET /api/dsh-skill-center/market/bootstrap`'));
  assert.ok(row !== undefined, 'routes.md §3.7.1 里找得到 bootstrap 一行');
  assert.match(row, /\bfavorites\b/, '出参 data 里写着 favorites（收藏随 bootstrap 下发）');
  assert.match(row, /\bfavoritesOk\b/, '出参 data 里写着 favoritesOk（读成功才是 true）');
});

test('K76 body 里的 version 也不生效：收藏键只有三元组，列表里不会长出带版本的条目', async () => {
  const mounted = await mount();
  try {
    const route = mounted.byPath[ROUTES.marketFavorite];
    const response = await callRoute(route, {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: JSON.stringify({
        source: 'skillhub',
        owner: 'ake',
        slug: 'dev-god',
        version: '9.9.9',
        favorited: true,
      }),
    });
    assert.equal(response.status, 200, '多余字段被忽略，不影响合法请求');
    assert.deepEqual(response.json.data.favorites, ['skillhub:ake:dev-god'], '键里没有版本段（与图标缓存、台账同一个键）');
    const file = JSON.parse(await readFile(mounted.favoritesFile, 'utf8'));
    assert.deepEqual(file, { version: 1, favorites: ['skillhub:ake:dev-god'] }, '文件里的 version 是文档版本，不是技能版本');
  } finally {
    await mounted.close();
  }
});
