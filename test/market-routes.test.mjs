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
        icons[key] = ref.slug.startsWith('has-icon') ? 'api/dsh-skill-center/market/lucide?name=zap' : null;
        names[key] = ref.slug.startsWith('has-icon') ? `Claw ${ref.slug}` : null;
      }
      return { icons, names };
    };
  }
  const sources = [skillhub, clawhub];
  const sourceById = (id) => sources.find((source) => source.id === id);
  const store = createStore({ dshHome: dir, skillsRoot, now: NOW });
  const installer = createInstaller({ skillsRoot, io: {}, sourceById, store, now: NOW });
  const lucideCalls = [];
  const lucide = options.lucide ?? {
    /**
     * Answer one icon lookup.
     * @param {string} name - icon slug.
     * @returns {Promise<Buffer|null>} the SVG, or null.
     */
    async get(name) {
      lucideCalls.push(name);
      return name === 'zap' || name === 'file-text' ? Buffer.from(SVG_TEXT) : null;
    },
  };
  const clawhubIconCalls = [];
  const clawhubIcon = options.clawhubIcon ?? {
    /**
     * Answer one uploaded-icon lookup.
     * @param {string} hash - 64 hex characters.
     * @returns {Promise<{bytes: Buffer, contentType: string}|null>} the image, or null.
     */
    async get(hash) {
      clawhubIconCalls.push(hash);
      if (hash === 'f'.repeat(64)) return { bytes: Buffer.from(SVG_TEXT), contentType: 'image/svg+xml' };
      if (hash === 'e'.repeat(64)) return { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]), contentType: 'image/png' };
      return null;
    },
    reset() {
      resets.push('clawhub-icon-reset');
    },
  };
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
      installer,
      lucide,
      clawhubIcon,
      skillsRoot,
      resetIconCache: () => resets.push('reset'),
    },
  });
  return {
    byPath: Object.fromEntries(routes.map((route) => [route.path, route])),
    dshHome: dir,
    skillsRoot,
    sources,
    lucideCalls,
    clawhubIconCalls,
    skillhubIconCalls,
    iconCalls,
    resets,
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

test('K35 bootstrap：六个键（sources / categories / categoriesOk / categoriesStale / total / countsOk）', async () => {
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
      ['categories', 'categoriesOk', 'categoriesStale', 'countsOk', 'sources', 'total'],
      '恰好六个键（R4 加了 total 与 countsOk）');
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

test('K58 lucide 代理路由：命中回 SVG（不走信封），非法/缺失 name 400，未知名字裸 404', async () => {
  const mounted = await mount();
  try {
    const route = mounted.byPath[ROUTES.marketLucide];
    assert.notEqual(route, undefined, '第十条路由存在');

    const hit = await callRoute(route, { headers: LOOPBACK_HEADERS, url: `${ROUTES.marketLucide}?name=zap` });
    assert.equal(hit.status, 200, '命中 200');
    assert.equal(hit.headers['content-type'], 'image/svg+xml', '图片类型，不是 JSON');
    assert.equal(hit.headers['cache-control'], 'public, max-age=604800', '一周缓存（图标不会变）');
    assert.equal(Number(hit.headers['content-length']), Buffer.byteLength(SVG_TEXT), 'content-length 与实际字节一致');
    assert.equal(hit.body, SVG_TEXT, 'body 就是 SVG 原文');
    assert.equal(hit.json, null, '不走信封（`<img>` 读不了信封）');
    assert.deepEqual(mounted.lucideCalls, ['zap'], '名字原样交给代理');

    for (const url of [ROUTES.marketLucide, `${ROUTES.marketLucide}?name=`, `${ROUTES.marketLucide}?name=../etc`, `${ROUTES.marketLucide}?name=Zap`]) {
      const bad = await callRoute(route, { headers: LOOPBACK_HEADERS, url });
      assert.equal(bad.status, 400, `${url} ⇒ 400`);
      assert.equal(bad.json.code, 'E_BAD_QUERY', '400 是信封里的 E_BAD_QUERY');
      assert.equal(bad.json.data, null, '失败信封 data 为 null（市场面例外）');
    }

    const missing = await callRoute(route, { headers: LOOPBACK_HEADERS, url: `${ROUTES.marketLucide}?name=nope` });
    assert.equal(missing.status, 404, '没有这个图标 ⇒ 404');
    assert.equal(missing.body, '', '裸 404：空 body，不是信封');
    assert.equal(missing.headers['cache-control'], 'no-store', '404 不缓存');
    assert.equal(String(missing.headers['content-length']), '0', 'content-length 0');
    assert.equal(missing.headers['content-type'], undefined, '连 content-type 都不给');
  } finally {
    await mounted.close();
  }
});

test('K58 代理路由的围栏：只认 GET、只认 loopback；bootstrap 的 ?refresh=1 会清图标缓存', async () => {
  const mounted = await mount();
  try {
    const route = mounted.byPath[ROUTES.marketLucide];
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
      const wrong = await callRoute(route, { method, headers: LOOPBACK_HEADERS, url: `${ROUTES.marketLucide}?name=zap` });
      assert.equal(wrong.status, 405, `${method} ⇒ 405`);
      assert.equal(wrong.json.code, 'E_METHOD', '错方法用 E_METHOD');
    }
    const foreign = await callRoute(route, {
      headers: { host: 'evil.example.com' },
      remoteAddress: '203.0.113.9',
      url: `${ROUTES.marketLucide}?name=zap`,
    });
    assert.equal(foreign.status, 403, '非本机请求 403');
    assert.deepEqual(mounted.lucideCalls, [], '被拒的请求一次都没有碰到代理');

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
    assert.equal(good.json.data.icons['clawhub:o:has-icon-one'], 'api/dsh-skill-center/market/lucide?name=zap', '有图标的那条');
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

test('K60 clawhub-icon 代理路由：200 图片（不透传上游 CSP）+ 400 非法 hash + 裸 404', async () => {
  const mounted = await mount();
  try {
    const route = mounted.byPath[ROUTES.marketClawhubIcon];
    const svgHash = 'f'.repeat(64);
    const ok200 = await callRoute(route, { headers: LOOPBACK_HEADERS, url: `${ROUTES.marketClawhubIcon}?hash=${svgHash}` });
    assert.equal(ok200.status, 200, '命中 200');
    assert.equal(ok200.headers['content-type'], 'image/svg+xml', '按上游类型发');
    assert.equal(ok200.headers['cache-control'], 'public, max-age=3600', '浏览器可存 1 小时');
    assert.equal(ok200.headers['x-content-type-options'], 'nosniff', 'nosniff');
    assert.equal(ok200.headers['content-security-policy'], "default-src 'none'", '我方 CSP 收紧到 default-src none');
    assert.equal(/sandbox/.test(String(ok200.headers['content-security-policy'])), false, '不透传上游那个 sandbox CSP');
    assert.equal(Number(ok200.headers['content-length']), Buffer.byteLength(SVG_TEXT), 'content-length 与实际字节一致');
    assert.equal(ok200.body, SVG_TEXT, 'body 就是图片字节');
    assert.equal(ok200.json, null, '不走信封');

    const png = await callRoute(route, { headers: LOOPBACK_HEADERS, url: `${ROUTES.marketClawhubIcon}?hash=${'e'.repeat(64)}` });
    assert.equal(png.status, 200, 'png 也能转发');
    assert.equal(png.headers['content-type'], 'image/png', '类型按上游');

    for (const url of [ROUTES.marketClawhubIcon, `${ROUTES.marketClawhubIcon}?hash=`, `${ROUTES.marketClawhubIcon}?hash=abc`, `${ROUTES.marketClawhubIcon}?hash=${'A'.repeat(64)}`, `${ROUTES.marketClawhubIcon}?hash=../etc/passwd`]) {
      const bad = await callRoute(route, { headers: LOOPBACK_HEADERS, url });
      assert.equal(bad.status, 400, `${url} ⇒ 400`);
      assert.equal(bad.json.code, 'E_BAD_QUERY', '400 是信封里的 E_BAD_QUERY');
    }

    const missing = await callRoute(route, { headers: LOOPBACK_HEADERS, url: `${ROUTES.marketClawhubIcon}?hash=${'1'.repeat(64)}` });
    assert.equal(missing.status, 404, '上游没有这张图 ⇒ 404');
    assert.equal(missing.body, '', '裸 404：空 body');
    assert.equal(missing.headers['cache-control'], 'no-store', '404 不缓存');
    assert.equal(String(missing.headers['content-length']), '0', 'content-length 0');
    assert.equal(missing.headers['content-type'], undefined, '连 content-type 都不给');

    for (const method of ['POST', 'PUT', 'HEAD']) {
      const wrong = await callRoute(route, { method, headers: LOOPBACK_HEADERS, url: `${ROUTES.marketClawhubIcon}?hash=${svgHash}` });
      assert.equal(wrong.status, 405, `${method} ⇒ 405`);
    }
    const foreign = await callRoute(route, {
      headers: { host: 'evil.example.com' },
      remoteAddress: '203.0.113.9',
      url: `${ROUTES.marketClawhubIcon}?hash=${svgHash}`,
    });
    assert.equal(foreign.status, 403, '非本机 403');

    assert.equal(mounted.clawhubIconCalls.filter((hash) => hash === svgHash).length, 1, '被拒的请求没有碰代理');
    await callRoute(route, { headers: LOOPBACK_HEADERS, url: `${ROUTES.marketClawhubIcon}?hash=${svgHash}&refresh=1` });
    assert.deepEqual(mounted.resets, ['clawhub-icon-reset'], '?refresh=1 清一次缓存');
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
    assert.equal(response.json.data.icons['clawhub:awspace:has-icon-one'], 'api/dsh-skill-center/market/lucide?name=zap', 'ClawHub 那条照旧');
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
        'clawhub:awspace:has-icon-one': 'api/dsh-skill-center/market/lucide?name=zap',
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
