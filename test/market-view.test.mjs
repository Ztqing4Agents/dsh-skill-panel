/**
 * L3 — the market tab rendered to a string: skeleton, cards, detail, confirm, failures.
 *
 * Contract: docs/contracts/acceptance.md 附录 D.1 (what L3 can and cannot prove),
 * docs/contracts/client.md §3.9 (market components and state machine),
 * docs/contracts/market.md 附录 F (market tick classes); case ids K38, K39, K47–K49, K52,
 * K54–K56, K79, K83, K84, K100–K108 (K101–K104 pin the U13 refresh split: a page-one
 * re-fetch keeps the list and draws no tail, an append still draws its three placeholders
 * and the "loading more" row; K106–K107 pin the same split for a filter change plus the
 * chip row that must not grow a second placeholder line).
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
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createStore } from '../src/client/state.js';
import { ROOT, loadClientModules, zhTranslator } from './helpers/ssr.mjs';
import { mountHooks } from './helpers/hooks.mjs';

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

/**
 * The non-null children of one rendered tile, flattened.
 *
 * `tileElement` always emits two slots (probe, then letter-or-visible-image), so the first
 * frame is an array and a settled frame may carry a `null` in the probe slot.
 * @param {{props: {children: unknown}}} node - a rendered element.
 * @returns {unknown[]} the children that actually render.
 */
const kidsOf = (node) => [node.props.children].flat().filter((child) => child !== null && child !== undefined);

/** The letter tile the avatar palette gives a title. */
const LETTER = (title) => title.trim().charAt(0).toUpperCase();

/**
 * One market item.
 *
 * The figures follow the real sources: SkillHub reports stars and a popularity score,
 * ClawHub reports neither (so its `saves`/`score` are null, as the normalizer emits them).
 * @param {{id?: string, sourceId?: string, version?: string|null, downloads?: number|null,
 *   saves?: number|null, score?: number|null, author?: string|null}} [options] - overrides.
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
    author: options.author === undefined ? 'Ake' : options.author,
    version: options.version === undefined ? '1.0.0' : options.version,
    downloads: options.downloads === undefined ? 12 : options.downloads,
    saves: options.saves === undefined ? (sourceId === 'skillhub' ? 99 : null) : options.saves,
    score: options.score === undefined ? (sourceId === 'skillhub' ? 55385 : null) : options.score,
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
 * Render the page for one store, as it stands.
 * @param {object} store - a store (or a lookalike) to render.
 * @returns {string} the markup.
 */
function renderStore(store) {
  return renderToStaticMarkup(createElement(page.SkillsPage, { store, api: API_STUB, t }));
}

/**
 * A store parked on the market tab, ready to be seeded.
 * @param {Function} [seed] - mutates the store before it is returned.
 * @returns {object} the store.
 */
function marketStore(seed) {
  const store = createStore();
  store.actions.ready(LIST_PAYLOAD);
  store.actions.setTab('market');
  if (typeof seed === 'function') seed(store);
  return store;
}

/**
 * Render the page on the market tab with a seeded store.
 * @param {Function} [seed] - mutates the store before rendering.
 * @returns {string} the markup.
 */
function renderMarket(seed) {
  return renderStore(marketStore(seed));
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
  assert.equal(matches(html, /skc_marketSkeletonAction"/g).length, 6, '每张骨架卡有一个动作占位');
  assert.equal(matches(html, /skc_marketSkeletonTag"/g).length, 18, '每张骨架卡三枚标签占位（真件的上限）');
  // The action placeholder sits in the head row, exactly where the real button is.
  const skeletonCard = html.slice(html.indexOf('<li class="skc_marketCard"'), html.indexOf('</li>'));
  const headAt = skeletonCard.indexOf('class="skc_marketHead"');
  const bodyAt = skeletonCard.indexOf('class="skc_marketBody"');
  const actionAt = skeletonCard.indexOf('skc_marketSkeletonAction');
  assert.ok(headAt !== -1 && bodyAt !== -1 && actionAt !== -1, '骨架卡也有头部与正文两块');
  assert.ok(headAt < actionAt && actionAt < bodyAt, '动作占位在头部（正文之前），与真件同位置');
  assert.ok(skeletonCard.indexOf('skc_marketSkeletonTag') > bodyAt, '标签占位在正文里');
  const status = /role="status"[^>]*aria-label="([^"]+)"/.exec(html);
  assert.ok(status !== null, '骨架是 status 角色，读屏会播报');
  assert.equal(status[1], '正在读取技能市场…', '播报文案来自 market.loading');
  assert.ok(/aria-busy="true"/.test(html), '骨架标了 aria-busy');
  assert.equal(html.includes('data-skc-market-id'), false, '骨架里没有真卡片');
});

test('K38 卡片：头部（头像 + 标题 + 来源图 + 安装）+ 正文（描述 / 标签 / 三段）', () => {
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
  // The badge seat now holds the source's own brand image, not a text Tag.
  assert.equal(html.includes('data-tone'), false, '不再有文字来源 Tag（徽章位改成品牌图）');
  const mark = /<img class="skc_marketSourceMark"[^>]*>/.exec(html);
  assert.ok(mark !== null, '标题行里有来源图形');
  assert.ok(mark[0].includes('src="data:image/png;base64,'), '图形是内联位图（零请求）');
  assert.ok(mark[0].includes('alt=""'), '图形是装饰（读屏不重复播报来源）');
  assert.ok(mark[0].includes('title="SkillHub"'), '悬停可查来源名（来自字典）');
  assert.ok(mark[0].includes('referrerPolicy="no-referrer"'), '与既有 <img> 同口径');
  assert.ok(html.includes('@ake/dev-god'), '作者行是 @owner/slug（market.metaAuthor）');
  assert.ok(html.includes('· v1.0.0'), '作者行第二段是版本（market.metaVersion）');
  assert.ok(html.includes('A fixture skill for the market tab.'), '描述上屏');
  assert.ok(html.includes('aria-label="评分 4.6"'), '第一段是折算后的评分（草图顺序）');
  assert.ok(html.includes('aria-label="下载 12"'), '第二段是下载数');
  assert.ok(html.includes('aria-label="收藏 99"'), '第三段是上游收藏数（stars，不是本地书签）');
  assert.ok(html.includes('>4.6<'), '评分按一位小数显示（5.0 也是 5.0）');
  const cardHtml = html.slice(html.indexOf('class="skc_marketCard"'));
  assert.equal(cardHtml.includes('aria-pressed'), false, '卡片上没有收藏开关了（U5 撤除）');
  assert.ok(html.includes('>安装<'), '头部右侧是「安装」按钮');
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
  assert.equal(
    matches(grid, /<button/g).length,
    2,
    '卡片里恰好两个按钮：详情锚点 + 安装（U5 撤掉收藏，键盘 Tab 顺序即 DOM 顺序）',
  );
  assert.equal(matches(grid, /skc_marketFavorite/g).length, 0, '收藏控件整块消失');
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
        { id: 'all', labelKey: 'market.source.all', hasCategories: true, packageKind: 'files' },
        { id: 'skillhub', labelKey: 'market.source.skillhub', hasCategories: true, packageKind: 'files' },
        { id: 'clawhub', labelKey: 'market.source.clawhub', hasCategories: true, packageKind: 'files' },
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

test('K38 空态：搜索无结果带清空、分类为空带复位、all 下不判「来源为空」', () => {
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

  // Under "all sources" an empty list is not "this source has nothing" (U8).
  const allScope = renderMarket((store) => {
    store.actions.marketPageAppended({ pages: [{ sourceId: 'all', page: { items: [], next: null } }], merged: [] });
  });
  assert.equal(allScope.includes('这个来源还没有技能'), false, 'all 下不说「这个来源还没有技能」');

  const oneScope = renderMarket((store) => {
    store.actions.marketSetFilter({ source: 'clawhub' });
    store.actions.marketPageAppended({ pages: [{ sourceId: 'clawhub', page: { items: [], next: null } }], merged: [] });
  });
  assert.ok(oneScope.includes('class="skc_marketEmptyTitle"'), '选中某个 scope 且为空 ⇒ 有标题');
  assert.equal(oneScope.includes('清除搜索'), false, '来源空态不给清空按钮');
  assert.equal(oneScope.includes('看全部分类'), false, '来源空态不给分类复位按钮');
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

test('K38 工具栏：搜索框、来源与排序菜单、分类 chips；ClawHub 也有 chips', () => {
  const skillhub = renderMarket((store) => {
    store.actions.marketBootReady({
      sources: [
        { id: 'all', labelKey: 'market.source.all', hasCategories: true, packageKind: 'files' },
        { id: 'skillhub', labelKey: 'market.source.skillhub', hasCategories: true, packageKind: 'files' },
        { id: 'clawhub', labelKey: 'market.source.clawhub', hasCategories: true, packageKind: 'files' },
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
  // U8: the anchor shows the scope, and the default scope is "all sources".
  assert.ok(skillhub.includes('>所有来源<'), '来源锚点显示当前值「所有来源」（默认 scope）');
  assert.ok(skillhub.includes('>默认排序<'), '排序锚点显示当前值「默认排序」（机器值仍是 recommended）');
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
        { id: 'all', labelKey: 'market.source.all', hasCategories: true, packageKind: 'files' },
        { id: 'skillhub', labelKey: 'market.source.skillhub', hasCategories: true, packageKind: 'files' },
        { id: 'clawhub', labelKey: 'market.source.clawhub', hasCategories: true, packageKind: 'files' },
      ],
      categories: [{ key: 'dev-tools', name: '开发工具' }],
      categoriesOk: true,
      source: 'clawhub',
    });
    store.actions.marketSetFilter({ source: 'clawhub' });
  });
  assert.ok(clawhub.includes('>ClawHub<'), '切到 ClawHub 后锚点跟着变');
  assert.ok(clawhub.includes('class="skc_marketChips"'), 'U8：ClawHub 顶部也有分类 chips');
  assert.ok(clawhub.includes('>开发工具<'), '分类 chip 照常渲染');

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

  assert.ok(installed.includes('data-skc-group='), '已安装页签渲染技能分区');
  assert.ok(installed.includes('skc_addPrimary'), '已安装页签有「添加技能」');
  assert.equal(installed.includes('class="skc_marketSection"'), false, '已安装页签不挂载市场面板');
  assert.equal(installed.includes('skc_marketCardOpen'), false, '已安装行没有市场的整卡点击锚点');
  const rows = installed.slice(installed.indexOf('<li class="skc_card"'));
  assert.equal(/<li class="skc_card"[^>]*role="button"/.test(rows), false, '已安装行仍然不是按钮（K22 照旧）');
  assert.equal(rows.includes('tabindex'), false, '已安装行不可聚焦（K22 照旧）');

  assert.equal(market.includes('class="skc_marketSection"'), true, '市场页签挂载市场面板');
  assert.equal(market.includes('data-skc-group='), false, '市场页签不渲染技能分区');
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
        { id: 'all', labelKey: 'market.source.all', hasCategories: true, packageKind: 'files' },
        { id: 'skillhub', labelKey: 'market.source.skillhub', hasCategories: true, packageKind: 'files' },
        { id: 'clawhub', labelKey: 'market.source.clawhub', hasCategories: true, packageKind: 'files' },
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

test('K55 单源：一次只问一个 scope，默认「所有来源」；切到 ClawHub 仍有分类行', () => {
  const html = renderMarket((store) => {
    store.actions.marketBootReady({
      sources: [
        { id: 'all', labelKey: 'market.source.all', hasCategories: true, packageKind: 'files' },
        { id: 'skillhub', labelKey: 'market.source.skillhub', hasCategories: true, packageKind: 'files' },
        { id: 'clawhub', labelKey: 'market.source.clawhub', hasCategories: true, packageKind: 'files' },
      ],
      categories: [{ key: 'dev-tools', name: '开发工具' }],
      categoriesOk: true,
      total: 10,
      countsOk: true,
    });
  });
  assert.ok(html.includes('aria-label="来源"'), '来源菜单在');
  assert.ok(html.includes('>所有来源<'), '锚点显示「所有来源」（默认 scope）');
  // 下拉里的选项在展开时渲染；这里断言「能展开」的那两个稳定钩子，选项数量由真机抽查数。
  assert.equal(matches(html, /aria-haspopup="menu"/g).length, 2, '来源与排序两个 anchor');

  const claw = renderMarket((store) => {
    store.actions.marketBootReady({
      sources: [
        { id: 'all', labelKey: 'market.source.all', hasCategories: true, packageKind: 'files' },
        { id: 'skillhub', labelKey: 'market.source.skillhub', hasCategories: true, packageKind: 'files' },
        { id: 'clawhub', labelKey: 'market.source.clawhub', hasCategories: true, packageKind: 'files' },
      ],
      categories: [{ key: 'dev-tools', name: '开发工具' }],
      categoriesOk: true,
      total: 10,
      countsOk: true,
    });
    store.actions.marketSetFilter({ source: 'clawhub' });
  });
  assert.ok(claw.includes('>ClawHub<'), '切到 ClawHub 后锚点跟着变');
  assert.ok(claw.includes('class="skc_marketChips"'), 'ClawHub 有分类表 ⇒ 分类行仍在（U8）');
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

test('K52 ① iconUrl 有效：首帧是「隐藏探测图 + 字母」，onLoad 之后同帧换成可见图', () => {
  // R8：瓦片在图标下载期间**不许空**。结构变成
  //   [隐藏探测图(display:none, eager), 字母]  --onLoad-->  [可见图(skc_marketIconImg, lazy)]
  // 探测图与可见图同 src，所以整条链路只发一次请求。
  const mounted = mountHooks(card.MarketIcon, { item: { iconUrl: ICON_URL }, title: 'Dev God' });
  const first = mounted.render();
  assert.equal(first.type, 'span', '外层还是那一个盒子');
  assert.match(first.props.className, /\bskc_cardIcon\b/, '外层仍是已安装页签那个 48px 盒子');
  assert.ok(first.props.style['--skc-avatar-bg'], '字母头像的两个变量照旧写在外层（回落时才有底色）');
  assert.equal(first.props['aria-hidden'], 'true', '整个瓦片对读屏隐藏');

  const children = first.props.children;
  assert.equal(Array.isArray(children), true, '首帧两个子节点：探测图 + 字母');
  const [probe, letter] = children;
  assert.equal(probe.type, 'img', '第一个子节点是探测图');
  assert.equal(probe.props.src, ICON_URL, 'src 原样（不做改写、不加参数）');
  assert.equal(probe.props.loading, 'eager', '探测图必须 eager：display:none + lazy 在 Chromium 里根本不加载');
  assert.deepEqual(probe.props.style, { display: 'none' }, '探测图不可见');
  assert.equal(probe.props.className, undefined, '探测图不带可见类（skc_marketIconImg 只给真正显示的那张）');
  assert.equal(probe.props.alt, '', '装饰图 alt 为空');
  assert.equal(typeof probe.props.onLoad, 'function', '加载成功要能切到可见图');
  assert.equal(typeof probe.props.onError, 'function', '加载失败要能回落字母');
  assert.equal(letter, 'D', '同帧仍然画首字母 —— 这一帧不空');

  // SSR 也是同一形态（它不会触发 onload）：markup 里既有探测图也有字母
  const ssr = renderToStaticMarkup(createElement(card.MarketIcon, { item: { iconUrl: ICON_URL }, title: 'Dev God' }));
  assert.ok(ssr.includes(`src="${ICON_URL}"`), 'SSR 也先放探测图');
  assert.match(ssr, /style="display:none"|style="display: none"/, 'SSR 里探测图是隐藏的');
  assert.ok(ssr.includes('>D<'), 'SSR 首帧有字母');
  assert.equal(ssr.includes('skc_marketIconImg'), false, 'SSR 首帧还没有可见图');

  // 探测图加载完成 ⇒ 同一帧换成可见图，字母退场
  probe.props.onLoad();
  const second = mounted.render();
  const secondKids = [second.props.children].flat();
  const images = secondKids.filter((child) => child !== null && typeof child === 'object' && child.type === 'img');
  assert.equal(images.length, 1, '只剩一张图（探测图退场）');
  const visible = images[0];
  assert.match(visible.props.className, /\bskc_marketIconImg\b/, '可见图用市场刻度里的类');
  assert.equal(visible.props.src, ICON_URL, '与探测图同 src（因此只发过一次请求）');
  assert.equal(visible.props.loading, 'lazy', '可见图仍可懒加载');
  assert.equal(visible.props.decoding, 'async', '异步解码');
  assert.equal(visible.props.referrerPolicy, 'no-referrer', '不带 referrer（第三方 CDN）');
  assert.equal(secondKids.includes('D'), false, '有图之后不再画字母');
  assert.match(second.props.className, /\bskc_cardIcon\b/, '盒子没换（几何不跳）');
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

test('K52 ③ 同一实例：onLoad 出图，换 URL 后 404 回落字母，换第三张仍能重新尝试', () => {
  const mounted = mountHooks(card.MarketIcon, { item: { iconUrl: ICON_URL }, title: 'Dev God' });

  const first = mounted.render();
  const [probe, letter] = first.props.children;
  assert.equal(letter, 'D', '首帧字母在（不空）');
  probe.props.onLoad();
  const loaded = mounted.render();
  const shown = [loaded.props.children].flat().find((child) => child !== null && typeof child === 'object' && child.type === 'img');
  assert.match(shown.props.className, /\bskc_marketIconImg\b/, 'onLoad 之后是可见图');

  // 同一实例换到另一张图：探测 → 失败 → 只剩字母（字母从头到尾都在，不会出现空瓦片）
  const other = 'https://cdn.skillhub.cn/skill-icons/other/next.png';
  const second = mounted.render({ item: { iconUrl: other }, title: 'Dev God' });
  const [probe2, letter2] = second.props.children;
  assert.equal(probe2.type, 'img', '换 URL 后重新探测');
  assert.equal(probe2.props.src, other, '用的是新 URL');
  assert.equal(letter2, 'D', '探测期间字母仍在');
  probe2.props.onError();
  const failed = mounted.render();
  const failedKids = kidsOf(failed);
  assert.deepEqual(failedKids, ['D'], 'onError 之后只剩首字母，不是空白');
  assert.notEqual(failedKids[0], '', '内容非空（空瓦片比字母更糟）');
  assert.match(failed.props.className, /\bskc_cardIcon\b/, '盒子不变（几何不会跳）');
  assert.equal(failed.props.style['--skc-avatar-bg'], first.props.style['--skc-avatar-bg'], '底色与失败前一致');
  assert.equal(JSON.stringify(failed).includes('<img'), false, '这一步没有再渲染 img');

  // 第三张（没见过的）URL：新图有自己的一次机会
  const thirdUrl = 'https://cdn.skillhub.cn/skill-icons/third/three.png';
  const third = mounted.render({ item: { iconUrl: thirdUrl }, title: 'Dev God' });
  const [probe3, letter3] = third.props.children;
  assert.equal(probe3.type, 'img', '没见过的 URL 重新探测');
  assert.equal(probe3.props.src, thirdUrl, 'src 是新地址');
  assert.equal(letter3, 'D', '探测期间字母仍在');
  probe3.props.onLoad();
  const again = mounted.render();
  const againImg = kidsOf(again).find((child) => typeof child === 'object' && child.type === 'img');
  assert.match(againImg.props.className, /\bskc_marketIconImg\b/, '再次 onLoad 仍然能显示');

  // 换回一张**已经加载过**的 URL：组件记得它，直接给可见图（不再探测、不再发请求）
  const back = mounted.render({ item: { iconUrl: thirdUrl }, title: 'Dev God' });
  const backKids = kidsOf(back);
  assert.equal(backKids.filter((child) => typeof child === 'object' && child.type === 'img').length, 1, '已加载过的 URL 只渲染一次');
  assert.match(backKids[0].props.className, /\bskc_marketIconImg\b/, '直接是可见图');
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
  // SSR 不会触发 onload，所以三处都是「隐藏探测图 + 字母」形态；可见图形态由 K52 ①/K70
  // 用 hooks harness 驱动 onLoad 后再断言。这里要的是「三处用的是同一个视觉单元」。
  const probeForm = (html) => html.includes(`src="${ICON_URL}"`) && /style="display:none"|style="display: none"/.test(html) && html.includes('>D<');
  assert.equal(probeForm(cardHtml), true, '卡片上是探测图 + 字母');

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
  assert.equal(probeForm(detailHtml), true, '详情头也是同一形态（同一个组件）');

  const confirmHtml = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'skillhub', page: { items: [withIcon], next: null } }],
      merged: [withIcon],
    });
    store.actions.marketInstallConfirm('skillhub:ake:dev-god');
  });
  assert.equal(probeForm(confirmHtml), true, '确认弹窗也一致');

  const bare = item({ id: 'clawhub:ake:plain' });
  bare.sourceId = 'clawhub';
  bare.iconUrl = null;
  const plainHtml = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'clawhub', page: { items: [bare], next: null } }],
      merged: [bare],
    });
  });
  assert.equal(plainHtml.includes('skc_marketIconImg'), false, 'ClawHub 的卡片不出现可见图');
  const plainTile = plainHtml.slice(plainHtml.indexOf('skc_cardIcon'), plainHtml.indexOf('skc_marketCardOpen'));
  assert.equal(plainTile.includes('<img'), false, '瓦片里连探测图都没有（没有 URL 就没有探测）');
  assert.equal(
    matches(plainHtml, /class="skc_marketSourceMark"/g).length,
    1,
    '卡内唯一的 <img> 是来源图形（它不是头像位的图）',
  );
  assert.match(plainHtml, /class="skc_cardIcon(?: skc_undefined)?"/, '仍然是同一个盒子画字母');
});

test('K79 缺段：槽位仍在、内容不出现（不显示 0，读屏也读不到）', () => {
  const clawItem = item({ sourceId: 'clawhub', id: 'clawhub:ivangdavila:design', version: null, downloads: 12 });
  const html = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'clawhub', page: { items: [clawItem], next: null } }],
      merged: [clawItem],
    });
  });
  assert.ok(html.includes('class="skc_marketStats"'), '底行三段仍在（轨道恒在）');
  assert.equal(matches(html, /class="skc_marketStat"/g).length, 3, '仍然恰好三格：缺的那两格是空格，不是不存在');
  assert.ok(html.includes('aria-label="下载 12"'), '有值的那格照常有可读名');
  assert.equal(matches(html, /role="img"/g).length, 1, '只有一格是 role=img（其余两格不是内容）');
  assert.equal(matches(html, /aria-hidden="true"/g).length >= 2, true, '空格对读屏是隐藏的');
  assert.equal(matches(html, /class="skc_marketStatValue"/g).length, 1, '只有一个数值节点（空格里没有数字、没有 0）');
  assert.equal(html.includes('收藏 0'), false, '缺收藏数时不写 0');
  assert.equal(html.includes('评分'), false, '缺评分时整段不出现（连文案都不渲染）');
});

test('K79 三格全缺时整行不渲染（ClawHub 列表条目可能连下载数都没有）', () => {
  const bare = item({
    sourceId: 'clawhub',
    id: 'clawhub:ivangdavila:design',
    version: null,
    downloads: null,
  });
  const html = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'clawhub', page: { items: [bare], next: null } }],
      merged: [bare],
    });
  });
  assert.equal(html.includes('skc_marketStats'), false, '全缺 ⇒ 整行不渲染（不留三格空白）');
  assert.ok(html.includes('skc_cardIcon'), '卡片其余部分照常');
  assert.ok(html.includes('skc_marketCardOpen'), '标题与点击层照常');
});

test('K79 作者行两级：没有 owner/slug 时回落 publisher 名，两段都没有就整行不渲染', () => {
  const publisherOnly = item({ author: 'Ake Studio' });
  publisherOnly.owner = null;
  publisherOnly.slug = null;
  const html = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'skillhub', page: { items: [publisherOnly], next: null } }],
      merged: [publisherOnly],
    });
  });
  assert.ok(html.includes('@Ake Studio'), '回落 publisher 名（@ 前缀来自字典）');

  const nothing = item({ author: null, version: null });
  nothing.owner = null;
  nothing.slug = null;
  const bareHtml = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'skillhub', page: { items: [nothing], next: null } }],
      merged: [nothing],
    });
  });
  assert.equal(bareHtml.includes('skc_marketMeta'), false, '两段都缺时作者行整行不渲染');
});

test('K79 没有品牌图的来源：不画 <img>、也不留空盒，标题行其余部分照常', () => {
  // A third source added later has no entry in SOURCE_MARKS. The seat must simply not
  // be drawn (no broken image, no empty box that shifts the title), and the two action
  // seats plus the click anchor must be unaffected.
  const future = item({ sourceId: 'future', id: 'future:ake:dev-god' });
  const html = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'future', page: { items: [future], next: null } }],
      merged: [future],
    });
  });
  assert.equal(matches(html, /class="skc_marketSourceMark"/g).length, 0, '没有品牌图就不渲染图形位');
  assert.equal(html.includes('<img'), false, '也不留下一个坏图或空 <img>');
  assert.ok(html.includes('skc_marketCardOpen'), '标题锚点照常（整卡仍可点）');
  assert.equal(html.includes('aria-pressed'), false, '卡片本来就没有收藏控件（U5），更不依赖来源图');
  assert.ok(html.includes('aria-label="下载 12"'), '三段数字照常');
});

test('K79 上游真给 0 就显示 0：缺值与 0 是两件事', () => {
  const zeros = item({ downloads: 0, saves: 0, score: 0 });
  const html = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'skillhub', page: { items: [zeros], next: null } }],
      merged: [zeros],
    });
  });
  assert.ok(html.includes('aria-label="下载 0"'), '下载数 0 是有值的（显示 0，不是缺段）');
  assert.ok(html.includes('aria-label="收藏 0"'), '收藏数 0 同理');
  assert.equal(matches(html, /class="skc_marketStatValue"/g).length, 2, '两个数字节点：0 各自都在');
  assert.equal(html.includes('评分'), false, 'score 0 折算不出评分（4.0 是缺值伪装），整段不出现');
  assert.equal(matches(html, /class="skc_marketStat"/g).length, 3, '轨道仍然是三格（缺的那格留空）');
});

test('K83 标签行：有就渲染成描边 chip（纯文本，不是按钮），没有就整行不渲染', () => {
  const tagged = item();
  tagged.tags = ['代码生成', 'Bug 修复', '后端开发'];
  const html = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'skillhub', page: { items: [tagged], next: null } }],
      merged: [tagged],
    });
  });
  const list = /<ul class="skc_marketTags">([\s\S]*?)<\/ul>/.exec(html);
  assert.ok(list !== null, '标签行是 ul.skc_marketTags');
  assert.equal(matches(list[1], /<li class="skc_marketTag" title="([^"]+)"/g).length, 3, '三枚都是 li，带 title');
  assert.ok(list[1].includes('>代码生成<'), '标签文本是上游原文（不进字典）');
  assert.equal(matches(list[1], /<button|<a[\s>]/g).length, 0, 'chip 不是按钮也不是链接（点了就是进详情）');
  // Order inside the body: description -> tags -> figures.
  const body = html.slice(html.indexOf('class="skc_marketBody"'));
  assert.ok(body.indexOf('skc_marketDesc') < body.indexOf('skc_marketTags'), '标签在描述之后');
  assert.ok(body.indexOf('skc_marketTags') < body.indexOf('skc_marketStats'), '标签在三段之前');

  const bare = item({ id: 'clawhub:ivangdavila:design', sourceId: 'clawhub', version: null });
  bare.tags = [];
  const bareHtml = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'clawhub', page: { items: [bare], next: null } }],
      merged: [bare],
    });
  });
  assert.equal(bareHtml.includes('skc_marketTags'), false, '空数组 ⇒ 整行不渲染（不留空行）');
});

test('K84 卡片新结构：头部三件 + 正文三块，卡片里只有两个按钮', () => {
  const html = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'skillhub', page: { items: [item()], next: null } }],
      merged: [item()],
    });
  });
  const card = html.slice(html.indexOf('class="skc_marketCard"'));
  const head = card.slice(card.indexOf('class="skc_marketHead"'), card.indexOf('class="skc_marketBody"'));
  // Head order: tile -> main(title row + meta) -> action seat. No source-name Tag, no bookmark.
  assert.ok(head.indexOf('skc_cardIcon') < head.indexOf('class="skc_marketMain"'), '图标在头部最前');
  assert.ok(head.indexOf('class="skc_marketMain"') < head.indexOf('class="skc_marketCardEnd"'), '两行块在动作位之前（安装在最右）');
  assert.ok(head.includes('class="skc_marketTitleRow"'), '标题行在 marketMain 里');
  assert.ok(head.includes('class="skc_marketMeta"'), '作者行也在 marketMain 里（与标题同一块）');
  assert.ok(head.includes('class="skc_marketCardEnd"'), '动作位坐在头部');
  assert.equal(head.includes('skc_marketBody'), false, '正文不在头部里');
  // Body is a direct child of the card, not nested inside marketMain.
  const body = card.slice(card.indexOf('class="skc_marketBody"'));
  assert.ok(body.includes('skc_marketDesc'), '正文第一块是描述');
  assert.ok(body.includes('skc_marketStats'), '正文最后一块是三段数字');
  assert.equal(
    matches(card.slice(0, card.indexOf('class="skc_marketBody"')), /class="skc_marketDesc"/g).length,
    0,
    '描述不在头部（头部只有一行 + 作者行）',
  );
  assert.equal(matches(card, /<button/g).length, 2, '整卡两个按钮：详情锚点 + 安装');
  // Three figures in the sketch's order; the ClawHub card proves the slots stay three.
  const order = [...card.matchAll(/aria-label="(评分|下载|收藏) [^"]*"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['评分', '下载', '收藏'], '三段顺序 = 评分 / 下载 / 收藏');
});

test('K84 缺段不左移（新顺序下）：ClawHub 卡是「空 / 下载 / 空」，下载留在第二格', () => {
  // The three slots are fixed positions, so a source that reports only downloads must not
  // shift it into slot one - that is where every SkillHub card draws its rating.
  const claw = item({ sourceId: 'clawhub', id: 'clawhub:ivangdavila:design', version: null, downloads: 12 });
  const html = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'clawhub', page: { items: [claw], next: null } }],
      merged: [claw],
    });
  });
  const row = /<p class="skc_marketStats">([\s\S]*?)<\/p>/.exec(html);
  assert.ok(row !== null, '三段那一行在');
  const cells = [...row[1].matchAll(/<span class="skc_marketStat"(?: role="img" aria-label="([^"]+)")?/g)];
  assert.equal(cells.length, 3, '轨道恒三格');
  assert.equal(cells[0][1], undefined, '第一格是空格（评分位，ClawHub 没有）');
  assert.equal(cells[1][1], '下载 12', '第二格才是下载数（没有往前挤）');
  assert.equal(cells[2][1], undefined, '第三格是空格（收藏位，ClawHub 没有）');
  assert.ok(html.includes('aria-label="收藏 12"') === false, '下载数不会被写成收藏');
});

test('K84 标签行的两道防御：item.tags 不是数组就当没有；标签文本按原文转义', () => {
  const noTags = item();
  noTags.tags = null;
  const nullHtml = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'skillhub', page: { items: [noTags], next: null } }],
      merged: [noTags],
    });
  });
  assert.equal(nullHtml.includes('skc_marketTags'), false, 'tags 为 null（不该发生）⇒ 不渲染、也不抛');

  const hostile = item();
  hostile.tags = ['<b>粗</b>', 'a&b'];
  const escaped = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'skillhub', page: { items: [hostile], next: null } }],
      merged: [hostile],
    });
  });
  assert.equal(escaped.includes('<b>粗</b>'), false, '标签是纯文本，HTML 元字符不会被当成标签');
  assert.ok(escaped.includes('&lt;b&gt;'), '按原文转义后上屏');
  assert.ok(escaped.includes('a&amp;b'), '& 也转义');
  assert.ok(escaped.includes('title="&lt;b&gt;粗&lt;/b&gt;"'), 'title 属性同样转义');
});

test('K84 四态下动作位都待在唯一那一层里：安装按钮始终落在 marketCardEnd 与 marketBody 之间', () => {
  // If a state rendered its button outside the seat wrapper it would fall under the
  // card-wide click layer, and "click install" would open the detail view instead.
  const LABELS = ['安装', '已安装', '安装中…', '重试'];
  const scenes = [
    ['ready', (store) => {}],
    ['installed', (store) => store.actions.marketInstalledLoaded({
      'skillhub:ake:dev-god': { name: 'dev-god', version: '1.0.0', path: '/tmp/skills/dev-god', exists: true },
    })],
    ['installing', (store) => store.actions.marketInstallStart('skillhub:ake:dev-god')],
    ['failed', (store) => store.actions.marketInstallFail('skillhub:ake:dev-god', '这个名字已经被占用')],
  ];
  for (const [state, extra] of scenes) {
    const html = renderMarket((store) => {
      store.actions.marketPageAppended({
        pages: [{ sourceId: 'skillhub', page: { items: [item()], next: null } }],
        merged: [item()],
      });
      extra(store);
    });
    // Scope to the card: the page's own tab label is also "已安装".
    const cardHtml = html.slice(html.indexOf('class="skc_marketCard"'));
    const seatAt = cardHtml.indexOf('class="skc_marketCardEnd"');
    const bodyAt = cardHtml.indexOf('class="skc_marketBody"');
    assert.ok(seatAt !== -1 && bodyAt !== -1, `${state}: 动作位与正文都在`);
    const label = LABELS.find((text) => cardHtml.indexOf(`>${text}<`) > seatAt && cardHtml.indexOf(`>${text}<`) < bodyAt);
    assert.ok(label !== undefined, `${state}: 动作位文案出现在 cardEnd 与 body 之间（在唯一那一层里）`);
    assert.equal(
      matches(cardHtml.slice(0, seatAt), /<button/g).length,
      1,
      `${state}: 头部动作位之前只有标题一个按钮`,
    );
  }
});

test('K100 工具栏恒为三个子元素：加载更多提示挪到列表底部（视觉件 aria-hidden）', () => {
  /** The toolbar's own markup, so its children can be counted and compared. */
  const toolbarOf = (html) => {
    const start = html.indexOf('class="skc_marketToolbar"');
    assert.equal(start > 0, true, '工具栏存在');
    return html.slice(start, html.indexOf('</div>', start) + 6);
  };

  const idle = renderMarket((store) => {
    store.actions.marketPageAppended({ pages: [{ sourceId: 'all', page: { items: [item()], next: 'c2' } }], merged: [item()] });
  });
  const loading = renderMarket((store) => {
    store.actions.marketPageAppended({ pages: [{ sourceId: 'all', page: { items: [item()], next: 'c2' } }], merged: [item()] });
    store.actions.marketPageStart();
  });

  // Three children: the search field, the source menu, the sort menu. A fourth (the old
  // status dot) narrowed the search box by 21px for the duration of every page load.
  const toolbar = toolbarOf(loading);
  assert.equal(matches(toolbar, /<(span|button) class="[^"]*skc_market(SearchField|Select)[^"]*"/g).length, 3,
    '工具栏恰好三个子元素（搜索框 + 两个菜单）');
  assert.equal(toolbar.includes('skc_statusWithDot'), false, '工具栏里没有状态圆点');
  assert.equal(toolbar.includes('skc_marketLoadMore'), false, '加载提示不在工具栏里');
  assert.equal(toolbarOf(idle), toolbar, '加载态与空闲态的工具栏逐字相同（搜索框不再忽宽忽窄）');

  // The row itself: after the grid, decorative, and paired with the one live announcement.
  const gridEnd = loading.indexOf('</ul>', loading.indexOf('class="skc_marketGrid"'));
  const rowAt = loading.indexOf('class="skc_marketLoadMore"');
  assert.equal(rowAt > gridEnd, true, '加载更多提示在卡片列表之后');
  const row = loading.slice(loading.lastIndexOf('<', rowAt), loading.indexOf('</div>', rowAt) + 6);
  assert.match(row, /aria-hidden="true"/, '视觉件对屏幕阅读器隐藏（避免与下方播报重复）');
  assert.equal(row.includes('正在加载更多'), true, '文案复用 market.loadingMore');
  assert.equal(
    matches(loading, /role="status"/g).length,
    matches(idle, /role="status"/g).length + 1,
    '只多出那一条 sr-only 播报（视觉件不算）',
  );

  // An empty list loading its first page is the skeleton's job, not this row's.
  const firstPage = renderMarket((store) => {
    store.actions.marketListLoading();
  });
  assert.equal(firstPage.includes('skc_marketLoadMore'), false, '首屏骨架不画这条（items 为空）');
});

test('K100 三个页脚互斥：正在加载 / 追加失败 / 到底，任何时刻只有一条', () => {
  const count = (html, needle) => html.split(needle).length - 1;
  const withOnePage = (store) => store.actions.marketPageAppended({
    pages: [{ sourceId: 'all', page: { items: [item()], next: 'c2' } }],
    merged: [item()],
  });

  const loading = renderMarket((store) => { withOnePage(store); store.actions.marketPageStart(); });
  const failed = renderMarket((store) => {
    withOnePage(store);
    store.actions.marketPageFailed({ code: 'E_SOURCE_TIMEOUT', message: 'upstream timed out' });
  });
  const ended = renderMarket((store) => store.actions.marketPageAppended({
    pages: [{ sourceId: 'all', page: { items: [item()], next: null } }],
    merged: [item()],
  }));

  assert.equal(count(loading, 'skc_marketLoadMore'), 1, '加载中：一条加载提示');
  assert.equal(count(loading, 'skc_marketMore'), 0, '加载中不出现「没有更多了」/重试');
  assert.equal(count(loading, 'skc_marketFailure'), 0, '加载中不出现失败提示');

  assert.equal(count(failed, 'skc_marketLoadMore'), 0, '失败时加载提示必须消失');
  assert.equal(count(failed, 'skc_marketMore'), 1, '失败时只有那一条重试页脚');
  assert.equal(failed.includes('正在加载更多'), false, '失败页脚里没有加载文案');

  assert.equal(count(ended, 'skc_marketLoadMore'), 0, '到底时没有加载提示');
  assert.equal(count(ended, 'skc_marketMore'), 1, '到底时只有「没有更多了」');
  assert.equal(ended.includes('正在加载更多'), false, '到底文案与加载文案不混');

  // The invariant in one sentence: at most one footer, whichever state the page is in.
  for (const [label, html] of [['加载中', loading], ['失败', failed], ['到底', ended]]) {
    const footers = count(html, 'skc_marketLoadMore') + count(html, 'skc_marketMore');
    assert.equal(footers, 1, `${label}：页脚总数恰好一条`);
  }
});

test('K100 连续触发两次追加：工具栏仍逐字相同，底部仍只有一行提示', () => {
  const toolbarOf = (html) => {
    const start = html.indexOf('class="skc_marketToolbar"');
    return html.slice(start, html.indexOf('</div>', start) + 6);
  };
  const count = (html, needle) => html.split(needle).length - 1;
  const seed = (store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'all', page: { items: [item()], next: 'c2' } }],
      merged: [item()],
    });
  };

  const idle = renderMarket(seed);
  // Two scroll-triggered appends in the same frame: the state machine may be asked twice.
  const twice = renderMarket((store) => { seed(store); store.actions.marketPageStart(); store.actions.marketPageStart(); });
  assert.equal(toolbarOf(twice), toolbarOf(idle), '两次追加请求后工具栏依旧逐字相同（搜索框不再抖 21px）');
  assert.equal(count(twice, 'skc_marketLoadMore'), 1, '提示只有一行（不是每触发一次多一行）');

  // The row is a loading state, not a permanent footer: the next answer replaces it.
  const answered = renderMarket((store) => {
    seed(store);
    store.actions.marketPageStart();
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'all', page: { items: [item({ id: 'skillhub:ake:next' })], next: null } }],
      merged: [item(), item({ id: 'skillhub:ake:next' })],
    });
  });
  assert.equal(count(answered, 'skc_marketLoadMore'), 0, '答案到了，加载提示消失');
  assert.equal(count(answered, 'skc_marketMore'), 1, '取而代之是「没有更多了」');

  // And a scope/filter change empties the list: the loading row must not survive it.
  const switched = renderMarket((store) => {
    seed(store);
    store.actions.marketPageStart();
    store.actions.marketSetFilter({ source: 'clawhub' });
  });
  assert.equal(count(switched, 'skc_marketLoadMore'), 0, '切来源清空列表后不画这条（items 已空）');
});

test('K100 无障碍只播报一次：视觉行 aria-hidden，sr-only role="status" 恰好一条且在行外', () => {
  const html = renderMarket((store) => {
    store.actions.marketPageAppended({
      pages: [{ sourceId: 'all', page: { items: [item()], next: 'c2' } }],
      merged: [item()],
    });
    store.actions.marketPageStart();
  });

  const at = html.indexOf('class="skc_marketLoadMore"');
  assert.ok(at > 0, '加载行存在');
  const row = html.slice(html.lastIndexOf('<', at), html.indexOf('</div>', at) + 6);
  // The row's own tag carries it; the icon inside carries its own (every svg here does), so
  // the assertion is on the element, not on the count of the attribute in its subtree.
  const rowTag = html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
  assert.match(rowTag, /aria-hidden="true"/, '视觉行本身 aria-hidden（读屏不念这句话）');
  assert.equal(rowTag.includes('role='), false, '视觉行没有角色（不给读屏第二个入口）');

  const statuses = html.split('role="status"').length - 1;
  assert.equal(statuses, 1, '整页只有一条 role="status"（多于一条就是重复播报）');
  assert.equal(row.includes('role="status"'), false, '播报器不在视觉行里（二者是两件事）');
  assert.ok(
    html.indexOf('role="status"') < at,
    'sr-only 播报在列表之前（加载一开始就能被听到）',
  );
  assert.match(row, /正在加载更多/, '视觉行仍给人看得见的那句话');
});

// ---------------------------------------------------------------------------
// U13 — "refresh jitters". Both `marketReload` (header refresh) and a keyword
// commit keep `items`, so `listStatus` no longer falls to `idle`: the grid on
// screen is the loading placeholder now. `page.status === 'loading'` therefore
// means two different things, and only an append (`pages > 0`) may grow the
// tail. The four cases below pin that split from the markup side: which of the
// six screens the panel picks, how many placeholder cards it draws, and how
// many live regions it leaves behind.
// ---------------------------------------------------------------------------

/** How many placeholder cards (whole-screen skeleton and tail alike) the markup carries. */
const placeholderCards = (html) => html.split('skc_marketSkeletonAction').length - 1;

/** The whole-screen skeleton's own `role="status"` grid; the tail has no such `<ul>`. */
const hasSkeletonGrid = (html) => /<ul class="[^"]*skc_marketGrid"[^>]*role="status"/.test(html);

test('K101 页头刷新重取期间：旧卡片直出，不换整页骨架、也不插尾部占位卡', () => {
  const count = (html, needle) => html.split(needle).length - 1;
  const store = marketStore((it) => {
    it.actions.marketPageAppended({
      pages: [{ sourceId: 'all', page: { items: [item()], next: 'c2' } }],
      merged: [item()],
    });
    // What the header button does, in order: `marketReload` (page.jsx) then the panel's
    // effect notices `pages === 0` and calls `marketListLoading` before the request.
    it.actions.marketReload();
    it.actions.marketListLoading();
  });
  const html = renderStore(store);

  // The store side of the same moment: the list is `ready` (so the panel never picks the
  // skeleton) while the page-one request is in flight.
  const market = store.getSnapshot().market;
  assert.equal(market.items.length, 1, '刷新后列表还在');
  assert.equal(market.listStatus, 'loading', 'listStatus 是 loading（整页骨架的判据是「loading 且列表为空」）');
  assert.equal(market.page.status, 'loading', '第一页请求确实在飞（否则这条用例什么都没测）');
  assert.equal(market.pages, 0, 'pages 归零：这是重取第一页，不是追加');

  // The markup: real cards, and nothing that would make the document grow.
  assert.equal(count(html, 'data-skc-market-id'), 1, '真卡片留在屏幕上');
  assert.equal(placeholderCards(html), 0, '一张占位卡都没有（既不是整页 6 张，也不是尾部 3 张）');
  assert.equal(hasSkeletonGrid(html), false, '没有换成整页骨架（骨架是带 role=status 的那个 ul）');
  assert.equal(count(html, 'skc_marketLoadMore'), 0, '没有「正在加载更多」这一行（列表高度不变）');
  assert.equal(count(html, 'marketMore'), 0, '也没有到底/重试页脚');
  // The grid is the busy one now: the old cards are still a loading placeholder.
  assert.match(html, /<ul class="[^"]*skc_marketGrid"[^>]*aria-busy="true"/, '网格标了 aria-busy（读屏知道它正在等新数据）');
  assert.match(html, /class="[^"]*skc_marketSection"[^>]*aria-busy="true"/, '整块市场区也是 busy');
  assert.equal(count(html, '正在读取技能市场'), 1, '播报说「正在读取」（不是「正在加载更多」）');
});

test('K102 追加下一页（pages > 0）期间：尾部 3 张占位卡与「加载更多」行照旧出现（U10 不回退）', () => {
  const count = (html, needle) => html.split(needle).length - 1;
  const store = marketStore((it) => {
    it.actions.marketPageAppended({
      pages: [{ sourceId: 'all', page: { items: [item()], next: 'c2' } }],
      merged: [item()],
    });
    it.actions.marketPageStart();
  });
  const html = renderStore(store);
  const market = store.getSnapshot().market;
  assert.equal(market.pages, 1, '已经加载过一页');
  assert.equal(market.page.status, 'loading', '追加请求在飞');

  assert.equal(count(html, 'data-skc-market-id'), 1, '真卡片还在一张（占位卡复用 skc_marketCard 类，不能按类数真卡）');
  assert.equal(placeholderCards(html), 3, '尾部三张占位卡（追加的既有行为）');
  assert.equal(hasSkeletonGrid(html), false, '不是整页骨架：占位卡挂在真列表里');

  // Order: real card, then the three tail cards, then the row - all inside/after the grid.
  const gridAt = html.indexOf('class="skc_marketGrid"');
  const rowAt = html.indexOf('class="skc_marketLoadMore"');
  const gridEnd = html.indexOf('</ul>', gridAt);
  assert.ok(gridAt > 0 && rowAt > gridEnd, '「加载更多」行在列表底部');
  assert.ok(html.indexOf('skc_marketSkeletonAction') < gridEnd, '占位卡在 ul 里（跟着最后一行）');
  assert.equal(count(html, 'skc_marketLoadMore'), 1, '只有一行加载提示');
  assert.equal(count(html, '正在加载更多'), 2, '视觉行 + sr-only 播报各一份（视觉行 aria-hidden）');
});

test('K103 重取与追加互斥：任何一刻 role="status" 最多一条', () => {
  const count = (html, needle) => html.split(needle).length - 1;
  const statuses = (html) => count(html, 'role="status"');
  const onePage = (it) => it.actions.marketPageAppended({
    pages: [{ sourceId: 'all', page: { items: [item()], next: 'c2' } }],
    merged: [item()],
  });

  // ① 首屏：没有列表，骨架自己播报，面板不再叠一条 sr-only。
  const first = renderMarket((it) => { it.actions.marketListLoading(); });
  assert.equal(placeholderCards(first), 6, '首屏六张骨架（列表为空时才走这条）');
  assert.equal(statuses(first), 1, '首屏只有骨架那一条');
  assert.equal(count(first, 'skc_progressAnnouncement'), 0, '叠加的 sr-only 播报不出现（改前这里是两条）');

  // ② 重取第一页（刷新/搜索）：列表还在 ⇒ 由 sr-only 播报「正在读取」，骨架不说话。
  const reload = renderMarket((it) => { onePage(it); it.actions.marketReload(); it.actions.marketListLoading(); });
  assert.equal(statuses(reload), 1, '重取时恰好一条');
  assert.equal(count(reload, 'skc_progressAnnouncement'), 1, '就是面板那条 sr-only 播报器');
  assert.equal(count(reload, '正在加载更多'), 0, '重取不说「加载更多」');

  // ③ 追加下一页：同样只有一条，说的是「正在加载更多」。
  const append = renderMarket((it) => { onePage(it); it.actions.marketPageStart(); });
  assert.equal(statuses(append), 1, '追加时恰好一条');
  assert.equal(count(append, '正在加载更多'), 2, 'sr-only + 视觉行（视觉行 aria-hidden，不算第二个播报口）');
  assert.equal(append.indexOf('role="status"') < append.indexOf('skc_marketLoadMore'), true, '播报器在视觉行之前');

  // ④ 空闲：一条都没有。
  const idle = renderMarket((it) => { onePage(it); });
  assert.equal(statuses(idle), 0, '空闲时没有播报器');
});

test('K104 搜索重取（关键词落定）期间同样只留旧列表：不插尾部占位卡、不长出一行加载提示', () => {
  const count = (html, needle) => html.split(needle).length - 1;
  const twoItems = [item(), item({ id: 'skillhub:ake:second' })];
  const store = marketStore((it) => {
    it.actions.marketPageAppended({
      pages: [{ sourceId: 'all', page: { items: twoItems, next: 'c2' } }],
      merged: twoItems,
    });
    // 搜索：落定关键词（清分页、保留列表），面板 effect 随即重取第一页。
    it.actions.marketCommitKeyword('ui');
    it.actions.marketListLoading();
  });
  const html = renderStore(store);
  const market = store.getSnapshot().market;
  assert.equal(market.keyword, 'ui', '关键词落定（这条用例测的是搜索那条路径）');
  assert.equal(market.items.length, 2, '搜索期间旧结果留着（不闪骨架）');
  assert.equal(market.pages, 0, '搜索把分页归零 ⇒ 尾部不该出现');
  assert.equal(market.page.status, 'loading', '第一页请求在飞');

  assert.equal(count(html, 'data-skc-market-id'), 2, '两张真卡都在');
  assert.equal(placeholderCards(html), 0, '没有尾部三张占位卡（改前这里让文档长高一行）');
  assert.equal(count(html, 'skc_marketLoadMore'), 0, '也没有「正在加载更多」行');
  assert.equal(hasSkeletonGrid(html), false, '不换整页骨架');
  assert.equal(count(html, '正在读取技能市场'), 1, '只有一条「正在读取」播报');
  assert.equal(count(html, '正在加载更多'), 0, '不混用追加的文案');
});

// ---------------------------------------------------------------------------
// M10 — "切来源/分类/排序也不跳". Same judgement as U13 (`loadingTail` needs `pages > 0`),
// but the filter path adds two things of its own: the count chips must not grow a second,
// placeholder row while the old numbers are still on screen, and the answer must replace
// the whole grid (a page-one fetch merges without `existing`, so no old card survives into
// the new query).
//
// What this layer cannot prove: the landing point. The paint effect writes
// `body.scrollTop = 0` into a real DOM (`useLayoutEffect`), and `renderToStaticMarkup`
// renders nothing (K50/K51 territory). K108 pins the *dependency surface* instead - the
// four fields whose change is the only thing that triggers the write - and the real-machine
// numbers for "waiting is motionless / landing is 0" live in the wip note, not here.
// ---------------------------------------------------------------------------

/** Three scope descriptors, shaped like `bootstrap`'s answer. */
const SCOPES = [
  { id: 'all', labelKey: 'market.source.all', hasCategories: true, packageKind: 'files' },
  { id: 'skillhub', labelKey: 'market.source.skillhub', hasCategories: true, packageKind: 'files' },
  { id: 'clawhub', labelKey: 'market.source.clawhub', hasCategories: true, packageKind: 'files' },
];

/** One category, enough for the chip row to be "visible". */
const CATEGORIES = [{ key: 'dev-tools', name: '开发工具', count: 10 }];

/** A store on the market tab with one page of cards and a boot answer already in. */
function filterStore(extra) {
  return marketStore((it) => {
    it.actions.marketPageAppended({
      pages: [{ sourceId: 'all', page: { items: [item()], next: 'c2' } }],
      merged: [item()],
    });
    it.actions.marketBootReady({ source: 'all', sources: SCOPES, categories: CATEGORIES, categoriesOk: true, total: 100, countsOk: true });
    if (typeof extra === 'function') extra(it);
  });
}

test('K106 换来源的等待期：旧卡直出、不换骨架、不插尾部占位；答案落地整表替换', () => {
  const count = (html, needle) => html.split(needle).length - 1;

  const waiting = filterStore((it) => {
    // What the panel does after a scope pick: the store restarts paging, its effect calls
    // `marketListLoading` and the request is in flight.
    it.actions.marketSetFilter({ source: 'clawhub' });
    it.actions.marketListLoading();
  });
  const html = renderStore(waiting);
  const market = waiting.getSnapshot().market;
  assert.equal(market.filters.source, 'clawhub', '来源确实换了（这条用例测的是换来源那条路径）');
  assert.equal(market.items.length, 1, '旧卡还在');
  assert.equal(market.pages, 0, '分页归零：这是首屏重取，不是追加');
  assert.equal(market.page.status, 'loading', '请求在飞（否则这条什么都没测）');
  assert.equal(market.categoriesLoading, true, '计数在补拉');

  assert.equal(count(html, 'data-skc-market-id'), 1, '真卡片留在屏幕上');
  assert.equal(placeholderCards(html), 0, '一张占位卡都没有（既不是整页 6 张，也不是尾部 3 张）');
  assert.equal(hasSkeletonGrid(html), false, '没有换成整页骨架');
  assert.equal(count(html, 'skc_marketLoadMore'), 0, '没有「正在加载更多」这一行（高度不变）');
  assert.match(html, /<ul class="[^"]*skc_marketGrid"[^>]*aria-busy="true"/, '网格标了 busy（读屏知道它在等新数据）');
  assert.equal(count(html, 'role="status"'), 1, '整页只有一条播报（筛选态与 U13 的两态互斥）');
  assert.equal(count(html, '正在加载更多'), 0, '重取不说「加载更多」');

  // The answer replaces the grid wholesale: page one is merged without `existing`.
  const answered = filterStore((it) => {
    it.actions.marketSetFilter({ source: 'clawhub' });
    it.actions.marketListLoading();
    const next = [item({ sourceId: 'clawhub', id: 'clawhub:ivan:design', displayName: 'Design Kit' })];
    it.actions.marketPageAppended({
      pages: [{ sourceId: 'clawhub', page: { items: next, next: null } }],
      merged: next,
    });
  });
  const landed = renderStore(answered);
  assert.equal(count(landed, 'data-skc-market-id'), 1, '答案落地后只有一张卡（不是旧卡 + 新卡）');
  assert.equal(landed.includes('data-skc-market-id="clawhub:ivan:design"'), true, '留下的是新 scope 的卡');
  assert.equal(landed.includes('data-skc-market-id="skillhub:ake:dev-god"'), false, '旧 scope 的卡没有串进新查询');
  assert.equal(placeholderCards(landed), 0, '答案落地后也没有占位卡');
});

test('K107 换来源时 chips 行只有一行：旧数字留着就地换，不再叠一行占位（网格不被推下 42px）', () => {
  const count = (html, needle) => html.split(needle).length - 1;

  // 有 chips 行 + categoriesLoading：不画占位行（改前是真行 + 6 根占位条同屏两行）。
  const switching = filterStore((it) => it.actions.marketSetFilter({ source: 'clawhub' }));
  const html = renderStore(switching);
  assert.equal(switching.getSnapshot().market.categoriesLoading, true, '计数确实在补拉');
  assert.equal(count(html, 'skc_marketSkeletonChip'), 0, '没有 chips 占位条（不再同屏两行）');
  assert.equal(count(html, 'class="skc_marketChips"'), 1, 'chips 行恰好一行');
  assert.match(html, /class="[^"]*skc_marketChips"[^>]*role="group"/, '那一行是真 chip 行（不是骨架）');
  assert.equal(count(html, 'skc_marketChipCount'), 1 + CATEGORIES.length, '旧数字仍在（「全部」+ 各分类），就地等新数字替换');

  // 首屏（还没有 chips 行）才画 chips 骨架——这条既有行为不能被顺手改掉。
  const firstScreen = renderMarket((it) => {
    it.actions.marketBootLoading();
    it.actions.marketListLoading();
  });
  assert.equal(count(firstScreen, 'skc_marketSkeletonChip'), 6, '首屏仍有 6 根 chips 占位条');
  assert.equal(firstScreen.includes('role="group"'), false, '首屏没有真 chip 行');
});
