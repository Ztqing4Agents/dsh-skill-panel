/**
 * L3 — the market tab rendered to a string: skeleton, cards, detail, confirm, failures.
 *
 * Contract: docs/contracts/acceptance.md 附录 D.1 (what L3 can and cannot prove),
 * docs/contracts/client.md §3.9 (market components and state machine),
 * docs/contracts/market.md 附录 F (market tick classes); case ids K38, K39, K47–K49, K52.
 *
 * The primitives are the documented stub (`test/helpers/primitives-stub.mjs`), so
 * `role="dialog"` here is evidence of prop wiring, not of the host painting. Geometry,
 * dark mode and scroll restoration stay on the real-machine checklist.
 *
 * What this layer *can* prove, and the reason it exists: which of the six screens the
 * panel picks for a given store state, and that the two tabs cannot borrow each
 * other's click affordance (AGENTS.md rule 9).
 */
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createStore } from '../src/client/state.js';
import { ROOT, loadClientModules, zhTranslator } from './helpers/ssr.mjs';

/** The bundled client page. */
let page;
/** The bundled market card module (exports `MarketIcon`). */
let card;
/** The Chinese translator. */
let t;

before(async () => {
  const modules = await loadClientModules(['page', 'card']);
  page = modules.page;
  card = modules.card;
  t = await zhTranslator();
});

const require = createRequire(import.meta.url);
const ReactCjs = require('react');

/**
 * Render one function component that only uses `useState`, with a controllable slot.
 *
 * `renderToStaticMarkup` can prove what a state *renders* but cannot fire an event into
 * it, and this repo has no DOM (no jsdom) - so the one transition that matters here
 * ("the image 404s, the tile must fall back to the letter") is driven through React's
 * own hook dispatcher, which is what a test renderer does internally. The component
 * under test is the real one; only the reconciler is replaced.
 * @param {Function} component - the component to mount.
 * @param {object} initialProps - its props.
 * @returns {{render: (nextProps?: object) => object}} a handle whose `render` can be called again after a state write.
 */
function mountHooks(component, initialProps) {
  const slots = [];
  const internals = ReactCjs.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const holder = internals.ReactCurrentDispatcher;
  const previous = holder.current;
  let props = initialProps;
  const render = (nextProps) => {
    if (nextProps !== undefined) props = nextProps;
    let index = 0;
    holder.current = {
      useEffect: () => {},
      useState(initial) {
        const at = index;
        index += 1;
        if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial;
        const set = (next) => {
          slots[at] = typeof next === 'function' ? next(slots[at]) : next;
        };
        return [slots[at], set];
      },
    };
    try {
      return component(props);
    } finally {
      holder.current = previous;
    }
  };
  return { render };
}

/** The letter tile the avatar palette gives a title. */
const LETTER = (title) => title.trim().charAt(0).toUpperCase();

/**
 * One market item.
 * @param {{id?: string, sourceId?: string, version?: string|null, downloads?: number|null}} [options] - overrides.
 * @returns {object} the item.
 */
function item(options = {}) {
  const sourceId = options.sourceId ?? 'skillhub';
  const id = options.id ?? `${sourceId}:ake:dev-god`;
  return {
    sourceId,
    id,
    owner: 'ake',
    slug: id.split(':').at(-1),
    displayName: 'Dev God',
    summary: 'A fixture skill for the market tab.',
    author: 'Ake',
    version: options.version === undefined ? '1.0.0' : options.version,
    downloads: options.downloads === undefined ? 12 : options.downloads,
    updatedAt: null,
    category: 'dev-tools',
    packageKind: sourceId === 'clawhub' ? 'zip' : 'files',
  };
}

/** A bounded ListPayload for the installed tab (the market tab ignores it). */
const LIST_PAYLOAD = {
  groups: [
    { key: 'builtin', skills: [] },
    { key: 'local', skills: [] },
    { key: 'installed', skills: [] },
  ],
  counts: { total: 0, disabled: 0, excluded: 0 },
  complete: true,
  diagnostics: [],
  cwd: '/work',
};

/** An API stub: nothing here may be called by a string render. */
const API_STUB = {
  list: async () => LIST_PAYLOAD,
  toggle: async () => {},
  toggleProvider: async () => {},
  marketBootstrap: async () => ({ sources: [], categories: [], categoriesOk: true }),
  marketList: async () => ({ items: [], next: null }),
  marketDetail: async () => null,
  marketInstalled: async () => ({ items: {}, readable: true }),
  marketInstall: async () => ({}),
};

/**
 * Render the page on the market tab with a seeded store.
 * @param {Function} [seed] - mutates the store before rendering.
 * @returns {string} the markup.
 */
function renderMarket(seed) {
  const store = createStore();
  store.actions.ready(LIST_PAYLOAD);
  store.actions.setTab('market');
  if (typeof seed === 'function') seed(store);
  return renderToStaticMarkup(createElement(page.SkillsPage, { store, api: API_STUB, t }));
}

/**
 * All captured values of one attribute pattern.
 * @param {string} html - markup.
 * @param {RegExp} pattern - pattern with one capture group.
 * @returns {string[]} the values.
 */
function matches(html, pattern) {
  return [...html.matchAll(pattern)].map((match) => match[1]);
}

test('K38 首屏骨架：分类 chip 占位 + 6 张卡骨架，带 status 播报与 aria-busy', () => {
  const html = renderMarket((store) => {
    store.actions.marketBootLoading();
    store.actions.marketListLoading();
  });
  assert.ok(html.includes('class="skc_marketChips"'), 'chips 占位行存在');
  assert.equal(matches(html, /skc_marketSkeletonChip"/g).length, 6, '六个 chip 占位');
  assert.equal(matches(html, /<li class="skc_marketCard"/g).length, 6, '首屏六张卡骨架');
  assert.equal(matches(html, /skc_marketSkeletonAction"/g).length, 6, '每张骨架卡右下有动作占位');
  const status = /role="status"[^>]*aria-label="([^"]+)"/.exec(html);
  assert.ok(status !== null, '骨架是 status 角色，读屏会播报');
  assert.equal(status[1], '正在读取技能市场…', '播报文案来自 market.loading');
  assert.ok(/aria-busy="true"/.test(html), '骨架标了 aria-busy');
  assert.equal(html.includes('data-skc-market-id'), false, '骨架里没有真卡片');
});

test('K38 卡片：头像 + 标题按钮 + 来源 Tag + 描述 + 元信息 + 安装按钮', () => {
  const html = renderMarket((store) => {
    store.actions.marketBootReady({
      sources: [{ id: 'skillhub', labelKey: 'market.source.skillhub', hasCategories: true, packageKind: 'files' }],
      categories: [{ key: 'dev-tools', name: '开发工具' }],
      categoriesOk: true,
    });
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'skillhub', page: { items: [item()], next: null } }],
      merged: [item()],
    });
  });
  assert.equal(matches(html, /data-skc-market-id="([^"]+)"/g).length, 1, '一张卡');
  assert.ok(html.includes('data-skc-market-id="skillhub:ake:dev-god"'), '卡片带稳定的市场键');
  assert.ok(html.includes('skc_cardIcon'), '头像复用已安装页签的 48px 容器');
  assert.ok(html.includes('skc_marketCardOpen'), '标题按钮是整卡点击的锚点');
  assert.ok(html.includes('aria-label="查看 Dev God 详情"'), '标题按钮有可读名（来自 market.cardOpen）');
  assert.ok(html.includes('data-tone="outline"'), '来源用 Tag 显示');
  assert.ok(html.includes('SkillHub'), '来源名来自字典');
  assert.ok(html.includes('A fixture skill for the market tab.'), '描述上屏');
  assert.ok(html.includes('@Ake'), '元信息第一段是作者（文案来自 market.metaAuthor）');
  assert.ok(html.includes('v1.0.0'), '元信息第二段是版本（market.metaVersion）');
  assert.ok(html.includes('下载 12'), '元信息第三段是下载数（market.metaDownloads）');
  assert.ok(html.includes('>安装<'), '右侧是「安装」按钮');
});

test('K38 卡片可点只用一个手段：没有 <a>、卡片本身不是按钮、内部不再嵌第二个可点区', () => {
  const html = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'skillhub', page: { items: [item()], next: null } }],
      merged: [item()],
    });
  });
  const grid = html.slice(html.indexOf('class="skc_marketGrid"'));
  assert.equal(grid.includes('<a '), false, '市场网格里没有任何链接（不是 <a href>）');
  const cardTag = /<li class="skc_marketCard"[^>]*>/.exec(grid);
  assert.ok(cardTag !== null, '找到卡片元素');
  assert.equal(cardTag[0].includes('role="button"'), false, '卡片本身不是按钮（可点性来自 ::after 层）');
  assert.equal(cardTag[0].includes('tabindex'), false, '卡片本身不可聚焦');
  assert.equal(matches(grid, /class="skc_marketCardOpen"/g).length, 1, '整卡点击只有一个锚点');
  assert.equal(matches(grid, /<button/g).length, 2, '卡片里只有两个按钮：详情锚点 + 安装（键盘可达各一处）');
  assert.ok(grid.includes('skc_marketCardEnd'), '动作位独立成格（z-index:1 让它浮在点击层上）');
});

test('K38 已安装 / 安装中 / 失败三态：按钮文案与禁用、行内原因、播报', () => {
  const installedHtml = renderMarket((store) => {
    store.actions.marketInstalledLoaded({ 'skillhub:ake:dev-god': { name: 'dev-god', version: '1.0.0', path: '/tmp/skills/dev-god', exists: true } });
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'skillhub', page: { items: [item()], next: null } }],
      merged: [item()],
    });
  });
  assert.ok(installedHtml.includes('>已安装<'), '台账说装过时按钮写「已安装」');
  assert.ok(installedHtml.includes('title="已安装到 /tmp/skills/dev-god"'), 'title 给出安装路径');
  assert.ok(/<button[^>]*disabled=""[^>]*>已安装</.test(installedHtml), '已安装的按钮禁用（没有覆盖入口）');

  const installingHtml = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'skillhub', page: { items: [item()], next: null } }],
      merged: [item()],
    });
    store.actions.marketInstallStart('skillhub:ake:dev-god');
  });
  assert.ok(installingHtml.includes('>安装中…<'), '安装中按钮写「安装中…」');
  assert.ok(installingHtml.includes('正在安装 Dev God'), '安装中以 status 播报');
  assert.ok(installingHtml.includes('data-state="ongoing"'), '安装中有进行中指示');
  assert.ok(/<button[^>]*disabled=""[^>]*>安装中…</.test(installingHtml), '安装中按钮禁用（防连点）');

  const failedHtml = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'skillhub', page: { items: [item()], next: null } }],
      merged: [item()],
    });
    store.actions.marketInstallFail('skillhub:ake:dev-god', '这个名字已经被占用');
  });
  assert.ok(failedHtml.includes('>重试<'), '失败后按钮写「重试」');
  assert.ok(failedHtml.includes('这个名字已经被占用'), '行内原因上屏');
  assert.ok(/<p class="skc_reason" role="alert">这个名字已经被占用<\/p>/.test(failedHtml), '行内原因是 alert');
});

test('K38 双源卡片：两源各出一张，来源 Tag 各自本地化', () => {
  const skillhubItem = item({ id: 'skillhub:ake:dev-god' });
  const clawhubItem = item({ sourceId: 'clawhub', id: 'clawhub:ivangdavila:design', version: null });
  const html = renderMarket((store) => {
    store.actions.marketBootReady({
      sources: [
        { id: 'skillhub', labelKey: 'market.source.skillhub', hasCategories: true, packageKind: 'files' },
        { id: 'clawhub', labelKey: 'market.source.clawhub', hasCategories: false, packageKind: 'zip' },
      ],
      categories: [],
      categoriesOk: true,
    });
    store.actions.marketPageAppended({
      pages: [
        { sourceId: 'skillhub', page: { items: [skillhubItem], next: null } },
        { sourceId: 'clawhub', page: { items: [clawhubItem], next: null } },
      ],
      merged: [skillhubItem, clawhubItem],
    });
  });
  assert.equal(matches(html, /data-skc-market-id="([^"]+)"/g).length, 2, '两张卡');
  assert.ok(html.includes('SkillHub') && html.includes('ClawHub'), '两个来源名都本地化了');
  const clawhubCard = html.slice(html.indexOf('data-skc-market-id="clawhub:ivangdavila:design"'));
  assert.equal(clawhubCard.includes('版本'), false, 'ClawHub 没有版本号时不渲染版本段');
});

test('K39 详情：返回面包屑 + 头 + 事实表六行 + 概览 + 文件清单', () => {
  const detailItem = item();
  const html = renderMarket((store) => {
    store.actions.marketBootReady({ sources: [], categories: [{ key: 'dev-tools', name: '开发工具' }], categoriesOk: true });
    store.actions.marketDetailOpen(detailItem);
    store.actions.marketDetailReady({
      item: detailItem,
      overview: 'First line.\n\n## Usage\n\n- one',
      declaredName: 'dev-god',
      nameValid: true,
      installTo: '/Users/me/.dsh/skills/dev-god',
      files: [{ path: 'SKILL.md', size: 2048 }, { path: 'scripts/run.md', size: 40 }],
      filesComplete: true,
    });
  });
  assert.ok(html.includes('data-skc-market-detail="skillhub:ake:dev-god"'), '详情视图带市场键');
  assert.ok(html.includes('class="skc_marketCrumb"'), '有返回面包屑');
  assert.ok(html.includes('返回市场'), '面包屑文案来自 market.detailBack');
  assert.ok(html.includes('<h3 class="skc_marketDetailTitle">Dev God</h3>'), '详情标题是技能名');
  assert.equal(matches(html, /<dt>([^<]+)<\/dt>/g).length, 6, '事实表恰好六行');
  for (const label of ['来源', '作者', '版本', '下载量', '分类', '安装到']) {
    assert.ok(html.includes(`<dt>${label}</dt>`), `事实表有「${label}」一行`);
  }
  assert.ok(html.includes('<code>/Users/me/.dsh/skills/dev-god</code>'), '安装路径用等宽体');
  assert.ok(html.includes('data-stub-markdown="body"'), '概览交给宿主 markdown 渲染器');
  assert.ok(html.includes('First line.'), '概览正文上屏');
  assert.equal(matches(html, /class="skc_marketFileName"/g).length, 2, '文件清单两行');
  assert.ok(html.includes('2.0KB'), '文件大小用宿主的 fileSizeText');
  assert.ok(html.includes('40B'), '小文件按 B 显示');
  assert.equal(html.includes('class="skc_marketGrid"'), false, '详情替换了网格（不是叠在上面）');
});

test('K39 详情三种失败/空态：加载中、加载失败可重试、无概览与无文件', () => {
  const detailItem = item();
  const loading = renderMarket((store) => {
    store.actions.marketDetailOpen(detailItem);
  });
  assert.ok(loading.includes('正在读取详情'), '加载中给一行说明（market.detailLoading）');

  const failed = renderMarket((store) => {
    store.actions.marketDetailOpen(detailItem);
    store.actions.marketDetailFailed({ code: 'E_SOURCE_TIMEOUT', message: 'timeout' });
  });
  assert.ok(failed.includes('class="skc_marketFailure"'), '详情失败用同一个失败容器');
  assert.ok(/role="alert"[^>]*>[\s\S]*?详情/.test(failed) || failed.includes('role="alert"'), '详情失败以 alert 播报');
  assert.ok(failed.includes('>重试<'), '详情失败给重试按钮');
  assert.ok(failed.includes('class="skc_marketCrumb"'), '失败时返回仍然可用');

  const sparse = renderMarket((store) => {
    store.actions.marketDetailOpen(detailItem);
    store.actions.marketDetailReady({
      item: detailItem,
      overview: '',
      declaredName: 'dev-god',
      nameValid: true,
      installTo: '/tmp/x',
      files: [],
      filesComplete: true,
    });
  });
  assert.ok(sparse.includes('这个技能没有单独的说明'), '无概览时给说明文案');
  assert.ok(sparse.includes('这个技能的包里没有可列出的文件'), '无文件时给空态文案');

  const badName = renderMarket((store) => {
    store.actions.marketDetailOpen(detailItem);
    store.actions.marketDetailReady({
      item: { ...detailItem, slug: 'design' },
      overview: 'x',
      declaredName: 'Design',
      nameValid: false,
      installTo: '/Users/me/.dsh/skills',
      files: [],
      filesComplete: true,
    });
  });
  assert.ok(badName.includes('class="skc_marketError"'), '声明名不合规时原地给出提示');
});

test('K39 确认弹窗：dialog 语义 + 标题 + 三项事实 + 第三方提示 + 两个按钮', () => {
  const confirmItem = item();
  const html = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'skillhub', page: { items: [confirmItem], next: null } }],
      merged: [confirmItem],
    });
    store.actions.marketInstallConfirm('skillhub:ake:dev-god');
  });
  assert.ok(html.includes('role="dialog"'), '弹窗是 dialog 角色');
  assert.ok(html.includes('aria-modal="true"'), '弹窗是 modal');
  assert.ok(html.includes('aria-label="安装 Dev God"'), '弹窗有可读名（标题同文案）');
  assert.ok(html.includes('class="skc_marketConfirmBody"'), '确认体有自己的容器');
  assert.ok(html.includes('class="skc_marketDialog"'), '弹窗宽度走市场刻度');
  assert.equal(matches(html, /<dt>([^<]+)<\/dt>/g).length, 3, '确认表三项（来源/作者/版本，未取详情时没有安装路径）');
  assert.ok(html.includes('第三方'), '有第三方内容提示');
  assert.ok(html.includes('>取消<'), '有取消按钮');
  assert.ok(html.includes('>安装<'), '有确认安装按钮');
  assert.equal(matches(html, /data-skc-market-id=/g).length, 1, '弹窗之外列表仍在原位');
});

test('K38 三类失败态：整页失败、追加失败、搜索无结果', () => {
  // 单源之后「一源失败但另一源照常」这个状态不存在了：那一次请求的失败就是整页失败。
  // 旧的 `skc_marketNotice` 提示条随之删除（`market.partialSource` 键也删了）。
  const wholeFailure = renderMarket((store) => {
    store.actions.marketListFailed({ code: 'E_SOURCE_UNAVAILABLE', message: 'down' });
  });
  assert.ok(wholeFailure.includes('class="skc_marketFailure"'), '请求失败 ⇒ 整页失败容器');
  assert.ok(wholeFailure.includes('无法连接技能市场'), '整页失败文案');
  assert.ok(wholeFailure.includes('>重试<'), '整页失败有重试');
  assert.equal(wholeFailure.includes('skc_marketNotice'), false, '不再有「部分源失败」提示条');

  const tailFailure = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'skillhub', page: { items: [item()], next: 'c2' } }],
      merged: [item()],
    });
    store.actions.marketPageStart();
    store.actions.marketPageFailed({ code: 'E_SOURCE_TIMEOUT', message: 'timeout' });
  });
  assert.ok(tailFailure.includes('class="skc_marketMore"'), '追加失败时尾部给一条');
  assert.ok(tailFailure.includes('data-skc-market-id'), '已加载的卡片不消失');
  assert.ok(tailFailure.includes('加载失败，点此重试'), '追加失败的按钮文案说明可以重试');

  const empty = renderMarket((store) => {
    store.actions.marketCommitKeyword('nothing-matches');
    store.actions.marketPageAppended({ pages: [{ sourceId: 'skillhub', page: { items: [], next: null } }], merged: [] });
  });
  assert.ok(empty.includes('class="skc_marketEmpty"'), '空结果给空态容器');
});

test('K38 三种空态：搜索无结果带清空、分类为空带复位、来源为空只说明', () => {
  const search = renderMarket((store) => {
    store.actions.marketCommitKeyword('no-such-skill');
    store.actions.marketPageAppended({ pages: [{ sourceId: 'skillhub', page: { items: [], next: null } }], merged: [] });
  });
  assert.ok(search.includes('没有找到与「no-such-skill」匹配的技能'), '搜索空态回显关键词');
  assert.ok(search.includes('清除搜索'), '搜索空态给「清除搜索」按钮');

  const category = renderMarket((store) => {
    store.actions.marketBootReady({ sources: [], categories: [{ key: 'dev-tools', name: '开发工具' }], categoriesOk: true });
    store.actions.marketSetFilter({ category: 'dev-tools' });
    store.actions.marketPageAppended({ pages: [{ sourceId: 'skillhub', page: { items: [], next: null } }], merged: [] });
  });
  assert.ok(category.includes('这个分类下暂时没有技能'), '分类空态文案');
  assert.ok(category.includes('看全部分类'), '分类空态给复位按钮');

  const source = renderMarket((store) => {
    store.actions.marketPageAppended({ pages: [{ sourceId: 'skillhub', page: { items: [], next: null } }], merged: [] });
  });
  assert.ok(source.includes('class="skc_marketEmptyTitle"'), '来源空态有标题');
  assert.equal(source.includes('清除搜索'), false, '来源空态不给清空按钮');
  assert.equal(source.includes('看全部分类'), false, '来源空态不给分类复位按钮');
});

test('K38 到底与追加中：尾部提示与骨架互斥', () => {
  const done = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'skillhub', page: { items: [item()], next: null } }],
      merged: [item()],
    });
  });
  assert.ok(done.includes('没有更多了'), '没有下一页时尾部写「没有更多了」');
  assert.equal(matches(done, /<li class="skc_marketCard"/g).length, 1, '到底时不再画尾部骨架');

  const more = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'skillhub', page: { items: [item()], next: 'c2' } }],
      merged: [item()],
    });
    store.actions.marketPageStart();
  });
  assert.equal(matches(more, /<li class="skc_marketCard"/g).length, 4, '追加中：1 张真卡 + 3 张尾部骨架');
  assert.ok(more.includes('正在加载更多'), '追加中以 status 播报');
  assert.equal(more.includes('没有更多了'), false, '追加中不说到底');
});

test('K38 工具栏：搜索框、来源与排序菜单、分类 chips；选 ClawHub 时分类行消失', () => {
  const skillhub = renderMarket((store) => {
    store.actions.marketBootReady({
      sources: [
        { id: 'skillhub', labelKey: 'market.source.skillhub', hasCategories: true, packageKind: 'files' },
        { id: 'clawhub', labelKey: 'market.source.clawhub', hasCategories: false, packageKind: 'zip' },
      ],
      categories: [{ key: 'dev-tools', name: '开发工具', count: 137000 }],
      categoriesOk: true,
      total: 2540000,
      countsOk: true,
    });
  });
  assert.ok(skillhub.includes('class="skc_marketToolbar"'), '有工具栏');
  assert.ok(skillhub.includes('placeholder="搜索技能…"'), '有搜索框');
  assert.ok(skillhub.includes('aria-label="来源"'), '有来源菜单');
  assert.ok(skillhub.includes('aria-label="排序"'), '有排序菜单');
  assert.ok(skillhub.includes('class="skc_marketChips"'), '有分类 chips 行');
  // 菜单选项只在展开时渲染（Menu 是本组件的 useState），字符串渲染拿到的是锚点上的当前值。
  // 这里断言锚点形状与当前值；点开之后的三个选项由真机抽查覆盖。
  assert.equal(matches(skillhub, /aria-haspopup="menu"/g).length, 2, '两个锚点都声明自己是 menu（来源 / 排序）');
  // 「全部来源」这个选项已删：来源锚点显示的就是当前那个真实源，缺省是 SkillHub。
  assert.ok(skillhub.includes('>SkillHub<'), '来源锚点显示当前值「SkillHub」（默认源）');
  assert.equal(skillhub.includes('全部来源'), false, '不再有「全部来源」这个选项');
  assert.ok(skillhub.includes('>推荐<'), '排序锚点显示当前值「推荐」');
  // 分类 chips 上的数字：`total` 挂在「全部」上，`count` 挂在各自 chip 上（K54）。
  assert.equal(matches(skillhub, /class="skc_marketChipCount"/g).length, 2, '「全部」与「开发工具」都带数字');
  assert.ok(
    skillhub.includes(`>${new Intl.NumberFormat(undefined, { notation: 'compact' }).format(2540000)}<`),
    '「全部」的数字是 total 的紧凑写法',
  );
  assert.ok(
    skillhub.includes(`>${new Intl.NumberFormat(undefined, { notation: 'compact' }).format(137000)}<`),
    '分类自己的数字',
  );

  const clawhub = renderMarket((store) => {
    store.actions.marketBootReady({
      sources: [
        { id: 'skillhub', labelKey: 'market.source.skillhub', hasCategories: true, packageKind: 'files' },
        { id: 'clawhub', labelKey: 'market.source.clawhub', hasCategories: false, packageKind: 'zip' },
      ],
      categories: [{ key: 'dev-tools', name: '开发工具' }],
      categoriesOk: true,
    });
    store.actions.marketSetFilter({ source: 'clawhub' });
  });
  assert.equal(clawhub.includes('class="skc_marketChips"'), false, '选 ClawHub 时分类行整行消失');
  assert.equal(clawhub.includes('>开发工具<'), false, '分类 chip 不再渲染');

  const unavailable = renderMarket((store) => {
    store.actions.marketBootFallback([{ id: 'skillhub', labelKey: 'market.source.skillhub', hasCategories: true, packageKind: 'files' }]);
  });
  assert.ok(unavailable.includes('class="skc_marketToolbar"'), '失败兜底时仍给搜索与来源（工具栏不依赖 bootstrap）');
  assert.equal(unavailable.includes('class="skc_marketChips"'), false, '没有分类表时不画空的 chips 行');
  assert.ok(unavailable.includes('暂时读不到分类'), '分类不可用时用一行说明代替 chips');
});

test('K47 详情往返不丢已加载页数：返回后卡片数、游标、页数都还在（不重新拉）', () => {
  const first = item({ id: 'skillhub:ake:a' });
  const second = item({ id: 'skillhub:ake:b' });
  const store = createStore();
  store.actions.ready(LIST_PAYLOAD);
  store.actions.setTab('market');
  store.actions.marketPageAppended({
    pages: [{ sourceId: 'skillhub', page: { items: [first], next: 'c2' } }],
    merged: [first],
  });
  store.actions.marketPageAppended({
    pages: [{ sourceId: 'skillhub', page: { items: [second], next: 'c3' } }],
    merged: [first, second],
  });
  store.actions.marketSetScroll(640);
  const before = store.getSnapshot().market;
  assert.equal(before.pages, 2, '两页已加载');
  assert.equal(before.cursors.skillhub, 'c3', '游标停在第二页之后');

  store.actions.marketDetailOpen(first);
  store.actions.marketDetailReady({ item: first, overview: 'x', files: [] });
  const detailHtml = renderToStaticMarkup(createElement(page.SkillsPage, { store, api: API_STUB, t }));
  assert.ok(detailHtml.includes('data-skc-market-detail'), '详情替换了网格');
  assert.equal(detailHtml.includes('class="skc_marketGrid"'), false, '详情打开时网格不渲染');

  store.actions.marketDetailClose();
  const after = store.getSnapshot().market;
  assert.equal(after.pages, before.pages, '页数不变');
  assert.deepEqual(after.cursors, before.cursors, '游标不变');
  assert.equal(after.scrollTop, 640, '滚动位置留在 store 里（面板的 effect 用它回位）');
  const backHtml = renderToStaticMarkup(createElement(page.SkillsPage, { store, api: API_STUB, t }));
  assert.equal(matches(backHtml, /data-skc-market-id="([^"]+)"/g).length, 2, '返回后两张卡都还在（没有退回第一页）');
});

test('K48 已安装页签零回归：页头按页签分工，行的可点边界没有借用市场的手段', () => {
  const market = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'skillhub', page: { items: [item()], next: null } }],
      merged: [item()],
    });
  });
  const installed = renderToStaticMarkup(createElement(page.SkillsPage, {
    store: (() => {
      const seeded = createStore();
      seeded.actions.ready({
        groups: [
          { key: 'builtin', skills: [{ name: 'office', provider: 'runtime', partition: 'builtin', path: null, writable: false, readonlyReason: 'provider-store', enabled: true, symlink: false, realPath: null }] },
          { key: 'local', skills: [{ name: 'hand-written', provider: 'filesystem', partition: 'local', path: '/skills/hand-written/SKILL.md', writable: true, readonlyReason: null, enabled: true, symlink: false, realPath: null }] },
          { key: 'installed', skills: [] },
        ],
        counts: { total: 2, disabled: 0, excluded: 0 },
        complete: true,
        diagnostics: [],
        cwd: '/work',
      });
      return seeded;
    })(),
    api: API_STUB,
    t,
  }));

  assert.ok(installed.includes('class="skc_status"'), '已安装页签有状态行');
  assert.ok(installed.includes('skc_addPrimary'), '已安装页签有「添加技能」');
  assert.equal(installed.includes('class="skc_marketSection"'), false, '已安装页签不挂载市场面板');
  assert.equal(installed.includes('skc_marketCardOpen'), false, '已安装行没有市场的整卡点击锚点');
  const rows = installed.slice(installed.indexOf('<li class="skc_card"'));
  assert.equal(/<li class="skc_card"[^>]*role="button"/.test(rows), false, '已安装行仍然不是按钮（K22 照旧）');
  assert.equal(rows.includes('tabindex'), false, '已安装行不可聚焦（K22 照旧）');

  assert.equal(market.includes('class="skc_marketSection"'), true, '市场页签挂载市场面板');
  assert.equal(market.includes('class="skc_status"'), false, '市场页签没有已安装面的状态行');
});

test('K49 市场页签的刷新按钮跟随市场加载状态（aria-busy / disabled），已安装面不受影响', () => {
  const busy = renderMarket((store) => {
    store.actions.marketListLoading();
  });
  const refresh = /<button[^>]*aria-label="刷新"[^>]*>/.exec(busy);
  assert.ok(refresh !== null, '市场页签下页头仍有刷新按钮');
  assert.equal(refresh[0].includes('aria-busy="true"'), true, '市场加载中刷新按钮 aria-busy=true');
  assert.equal(refresh[0].includes('disabled=""'), true, '市场加载中刷新按钮禁用（防自己怼自己）');
  assert.equal(busy.includes('data-state="ongoing"'), true, '按钮上换成进行中指示');

  const idle = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'skillhub', page: { items: [item()], next: null } }],
      merged: [item()],
    });
  });
  const idleRefresh = /<button[^>]*aria-label="刷新"[^>]*>/.exec(idle);
  assert.equal(idleRefresh[0].includes('disabled=""'), false, '空闲时刷新按钮可点');
  assert.ok(idle.includes('data-icon="refresh"'), '空闲时是刷新图标');
});

/* ------------------------------------------------- K54/K55/K56 · 数量、单源、contain */

test('K54 countsOk:false ⇒ 一个数字都不渲染（chips 照常可点）', () => {
  const html = renderMarket((store) => {
    store.actions.marketBootReady({
      sources: [
        { id: 'skillhub', labelKey: 'market.source.skillhub', hasCategories: true, packageKind: 'files' },
        { id: 'clawhub', labelKey: 'market.source.clawhub', hasCategories: false, packageKind: 'zip' },
      ],
      categories: [{ key: 'dev-tools', name: '开发工具', count: null }],
      categoriesOk: true,
      total: null,
      countsOk: false,
    });
  });
  assert.equal(html.includes('skc_marketChipCount'), false, '计数不全时整段不渲染数字（不留 0、不留破折号）');
  assert.ok(html.includes('>全部<'), '「全部」chip 仍在');
  assert.ok(html.includes('>开发工具<'), '分类 chip 仍在（数字没了不影响筛选）');
});

test('K55 单源：来源锚点默认 SkillHub，没有「全部来源」；切到 ClawHub 分类行消失', () => {
  const html = renderMarket((store) => {
    store.actions.marketBootReady({
      sources: [
        { id: 'skillhub', labelKey: 'market.source.skillhub', hasCategories: true, packageKind: 'files' },
        { id: 'clawhub', labelKey: 'market.source.clawhub', hasCategories: false, packageKind: 'zip' },
      ],
      categories: [{ key: 'dev-tools', name: '开发工具' }],
      categoriesOk: true,
      total: 10,
      countsOk: true,
    });
  });
  assert.ok(html.includes('aria-label="来源"'), '来源菜单在');
  assert.ok(html.includes('>SkillHub<'), '锚点显示 SkillHub');
  assert.equal(html.includes('全部来源'), false, '菜单里不再有「全部来源」');
  // 下拉里的选项在展开时渲染；这里断言「能展开」的那两个稳定钩子，选项数量由真机抽查数。
  assert.equal(matches(html, /aria-haspopup="menu"/g).length, 2, '来源与排序两个 anchor');

  const claw = renderMarket((store) => {
    store.actions.marketBootReady({
      sources: [
        { id: 'skillhub', labelKey: 'market.source.skillhub', hasCategories: true, packageKind: 'files' },
        { id: 'clawhub', labelKey: 'market.source.clawhub', hasCategories: false, packageKind: 'zip' },
      ],
      categories: [{ key: 'dev-tools', name: '开发工具' }],
      categoriesOk: true,
      total: 10,
      countsOk: true,
    });
    store.actions.marketSetFilter({ source: 'clawhub' });
  });
  assert.ok(claw.includes('>ClawHub<'), '切到 ClawHub 后锚点跟着变');
  assert.equal(claw.includes('class="skc_marketChips"'), false, 'ClawHub 没有分类表 ⇒ 整行消失');
});

test('K56 图标用 object-fit: contain（宽幅 logo 不裁切），市场块里没有 cover', async () => {
  const css = await readFile(join(ROOT, 'src', 'client', 'styles.js'), 'utf8');
  const start = css.indexOf('.skc_marketIconImg{');
  const rule = css.slice(start, css.indexOf('}', start) + 1);
  assert.match(rule, /object-fit: contain/, '图片按 contain 完整显示（留白，不裁形状）');
  assert.equal(/object-fit:\s*cover/.test(css), false, '整个样式表都不再出现 cover');
  // `.skc_marketIconImg` 仍然只是那几条声明：这轮只改了一个取值，没有顺手加东西。
  // 逐条列出来比数分号稳（多一条就红，少一条也红）。
  const declarations = rule
    .slice(rule.indexOf('{') + 1, rule.lastIndexOf('}'))
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  assert.deepEqual(declarations, [
    'border-radius: calc(var(--dsw-radius-lg) - .5px)',
    'width: 100%',
    'height: 100%',
    'object-fit: contain',
    'display: block',
  ], '四条既有声明 + 只把 cover 换成 contain，没有顺手加东西');
});

/* ------------------------------------------------------------------ K52 · MarketIcon */

const ICON_URL = 'https://cdn.skillhub.cn/skill-icons/ake/dev-god.png';

test('K52 ① iconUrl 有效：内容盒里渲染 <img>，属性齐全、外层盒子一个字节没变', () => {
  const html = renderToStaticMarkup(createElement(card.MarketIcon, {
    item: { iconUrl: ICON_URL },
    title: 'Dev God',
  }));
  assert.ok(html.includes(`src="${ICON_URL}"`), 'src 原样（不做改写、不加参数）');
  assert.ok(html.includes('class="skc_marketIconImg"'), '图片用市场刻度里的 skc_marketIconImg');
  assert.ok(html.includes('alt=""'), '装饰图 alt 为空（标题已经在旁边）');
  assert.ok(html.includes('loading="lazy"'), '懒加载：一屏 24 张图不能一次性拉满');
  assert.ok(html.includes('decoding="async"'), '异步解码');
  // React 18 的 SSR 把这条属性原样写成驼峰，别照着 JSX 的写法去比。
  assert.ok(html.includes('referrerPolicy="no-referrer"'), '不带 referrer（第三方 CDN）');
  // 只校验「包含」而不是拼死整串：本轮实测这里会多一个 `skc_undefined`（`cn` 不过滤
  // undefined，见报告 KI-R3-1）。它没有对应规则、纯属 DOM 噪音，属 cosmetic，不该被
  // 断言固化成契约——修掉之后也不用改这条。
  assert.match(html, /class="skc_cardIcon(?: skc_undefined)?"/, '外层仍是已安装页签那个 48px 盒子');
  assert.ok(html.includes('--skc-avatar-bg'), '字母头像的两个变量照旧写在外层（回落时才有底色）');
  assert.ok(html.includes('aria-hidden="true"'), '整个瓦片对读屏隐藏');
  assert.equal(html.includes('>D<'), false, '有图时不画字母');
});

test('K52 ① 填满内容盒的四条声明在样式表里（0.5px 描边仍压在图上方）', async () => {
  const css = await readFile(join(ROOT, 'src', 'client', 'styles.js'), 'utf8');
  const start = css.indexOf('.skc_marketIconImg{');
  assert.notEqual(start, -1, '样式表里有 .skc_marketIconImg 规则');
  const rule = css.slice(start, css.indexOf('}', start) + 1);
  assert.match(rule, /width: 100%/, '宽度填满内容盒');
  assert.match(rule, /height: 100%/, '高度填满内容盒');
  // object-fit 的取值单独由 K56 守（它是「宽幅 logo 不裁切」这条用户反馈的落点）。
  assert.match(rule, /display: block/, '去掉行内元素的基线缝');
  assert.match(rule, /border-radius: calc\(var\(--dsw-radius-lg\) - \.5px\)/, '内圆角 = 外圆角减描边（同心）');

  // 容器那 9 条既有声明不许被这条新规则带偏（K40 的检查只覆盖了整块，这里点名 48px 盒）。
  const boxStart = css.indexOf('.skc_cardIcon{');
  const box = css.slice(boxStart, css.indexOf('}', boxStart) + 1);
  assert.match(box, /width: 48px; height: 48px/, '盒子仍是 48×48');
  assert.match(box, /border: \.5px solid/, '描边仍是 0.5px');
  assert.match(box, /background-clip: padding-box/, '底色仍只铺到 padding box（描边不被盖掉）');
  assert.equal(/\.skc_marketIconImg\{[^}]*position: absolute/.test(css), false, '图片不是绝对定位（正常流里填满内容盒）');
});

test('K52 ② iconUrl 为 null：回落首字母头像，没有 <img> 也没有空盒子', () => {
  for (const iconUrl of [null, undefined, '']) {
    const html = renderToStaticMarkup(createElement(card.MarketIcon, {
      item: { iconUrl },
      title: 'dev-god',
    }));
    assert.equal(html.includes('<img'), false, `iconUrl=${JSON.stringify(iconUrl)} 时不渲染图片`);
    assert.ok(html.includes('>D<'), '画首字母（大写）');
    assert.match(html, /class="skc_cardIcon(?: skc_undefined)?"/, '仍是同一个盒子');
    assert.ok(html.includes('--skc-avatar-bg'), '底色变量在（字母头像靠它上色）');
    assert.equal(/<span[^>]*><\/span>/.test(html), false, '不存在「空瓦片」形态');
  }
});

test('K52 ③ 同一实例遇到 404：onError 之后仍回落首字母，且换一张图能重新尝试', () => {
  const mounted = mountHooks(card.MarketIcon, { item: { iconUrl: ICON_URL }, title: 'Dev God' });

  const first = mounted.render();
  assert.equal(first.type, 'span', '第一次渲染外层是 span');
  assert.match(first.props.className, /\bskc_cardIcon\b/, '外层盒子');
  const img = first.props.children;
  assert.equal(img.type, 'img', '第一次渲染的内容是 <img>');
  assert.equal(img.props.src, ICON_URL, 'src 就是 iconUrl');
  assert.equal(typeof img.props.onError, 'function', '图片挂了要有 onError 兜底');

  // 模拟浏览器加载失败
  img.props.onError();

  const second = mounted.render();
  assert.equal(second.props.children, 'D', 'onError 之后画的是首字母，不是空白');
  assert.notEqual(second.props.children, '', '内容非空（空瓦片比字母更糟）');
  assert.match(second.props.className, /\bskc_cardIcon\b/, '盒子不变（几何不会跳）');
  assert.equal(second.props.style['--skc-avatar-bg'], first.props.style['--skc-avatar-bg'], '底色与失败前一致');
  assert.equal(JSON.stringify(second).includes('<img'), false, '这一步没有再渲染 img');

  // 同一实例换到另一张图：失败记录是按 URL 记的，所以新图有自己的一次机会
  const other = 'https://cdn.skillhub.cn/skill-icons/other/next.png';
  const third = mounted.render({ item: { iconUrl: other }, title: 'Dev God' });
  assert.equal(third.props.children.type, 'img', '换 URL 后重新尝试渲染图片');
  assert.equal(third.props.children.props.src, other, '用的是新 URL');
});

test('K52 三态在卡片/详情/确认弹窗里都走同一个组件（同一张图不会一处有一处没有）', () => {
  const withIcon = item();
  withIcon.iconUrl = ICON_URL;
  const cardHtml = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'skillhub', page: { items: [withIcon], next: null } }],
      merged: [withIcon],
    });
  });
  assert.ok(cardHtml.includes('class="skc_marketIconImg"'), '卡片上画的是图片');

  const detailHtml = renderMarket((store) => {
    store.actions.marketDetailOpen(withIcon);
    store.actions.marketDetailReady({
      item: withIcon,
      iconUrl: ICON_URL,
      overview: 'x',
      declaredName: 'dev-god',
      nameValid: true,
      installTo: '/tmp/x',
      files: [],
      filesComplete: true,
    });
  });
  assert.ok(detailHtml.includes('class="skc_marketIconImg"'), '详情头也是同一张图');

  const confirmHtml = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'skillhub', page: { items: [withIcon], next: null } }],
      merged: [withIcon],
    });
    store.actions.marketInstallConfirm('skillhub:ake:dev-god');
  });
  assert.ok(confirmHtml.includes('class="skc_marketIconImg"'), '确认弹窗也一致');

  const bare = item({ id: 'clawhub:ake:plain' });
  bare.sourceId = 'clawhub';
  bare.iconUrl = null;
  const plainHtml = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'clawhub', page: { items: [bare], next: null } }],
      merged: [bare],
    });
  });
  assert.equal(plainHtml.includes('skc_marketIconImg'), false, 'ClawHub 的卡片不出现 img');
  assert.match(plainHtml, /class="skc_cardIcon(?: skc_undefined)?"/, '仍然是同一个盒子画字母');
});
