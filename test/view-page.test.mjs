/**
 * L3 — the page's DOM structure, rendered to a string (no jsdom, no browser).
 *
 * What this layer can prove: the three partitions and their order, the row anatomy,
 * the read-only marker instead of a switch on a symlink row, and the loading / empty
 * / error / market states.
 *
 * What it cannot prove: geometry, tokens, docking, dark mode, hot reload (see the
 * report's real-machine checklist). The primitives are a documented stub, so
 * `role="switch"` here is evidence of prop wiring, not of the host painting.
 *
 * Contract: docs/contracts/acceptance.md 附录 D.1 (L3) and case ids K22, K23, K24, K25.
 */
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { avatarOf } from '../src/client/avatar.js';
import { createStore } from '../src/client/state.js';
import { loadClientModules, zhTranslator } from './helpers/ssr.mjs';
import { mountHooks } from './helpers/hooks.mjs';

/** The bundled client modules under test. */
let modules;
/** The Chinese translator. */
let t;

before(async () => {
  modules = await loadClientModules(['page', 'skeleton', 'row', 'toast', 'installedDetail']);
  t = await zhTranslator();
});

/** One payload row. */
function row(overrides = {}) {
  return {
    name: 'hand-written',
    description: 'A local skill.',
    displayName: null,
    provider: 'filesystem',
    partition: 'local',
    rule: 'R9',
    confidence: 'high',
    symlink: false,
    path: '/skills/hand-written/SKILL.md',
    realPath: null,
    enabled: true,
    writable: true,
    readonlyReason: null,
    ...overrides,
  };
}

/**
 * A payload with one row per interesting kind.
 * @returns {object} ListPayload.
 */
function payload() {
  return {
    groups: [
      { key: 'builtin', skills: [row({ name: 'office', provider: 'runtime', partition: 'builtin', path: null, writable: false, readonlyReason: 'provider-store' })] },
      {
        key: 'local',
        skills: [
          row({ name: 'dev-docs-standards', symlink: true, path: null, realPath: '/Users/me/Skills/dev-docs-standards/SKILL.md', writable: false, readonlyReason: 'symlink' }),
          row({ name: 'hand-written', enabled: false }),
        ],
      },
      { key: 'installed', skills: [row({ name: 'ui-design', partition: 'installed', rule: 'R7' })] },
    ],
    counts: { total: 4, disabled: 1, excluded: 2 },
    complete: true,
    diagnostics: [],
    cwd: '/work',
  };
}

/**
 * Render the page over a store in the given state.
 * @param {{state?: Function, payload?: object|null, status?: string}} [setup] - how to seed the store.
 * @returns {string} the rendered markup.
 */
function renderPage(setup = {}) {
  const store = createStore();
  if (setup.status === 'loading') store.actions.loading();
  else if (setup.status === 'error') store.actions.failed({ code: 'E_INTERNAL', message: 'boom' });
  else store.actions.ready(setup.payload ?? payload());
  if (typeof setup.after === 'function') setup.after(store);
  const api = { list: async () => {}, toggle: async () => {}, toggleProvider: async () => {} };
  return renderToStaticMarkup(createElement(modules.page.SkillsPage, { store, api, t }));
}

/**
 * All matches of one attribute on a fragment.
 * @param {string} html - markup.
 * @param {RegExp} pattern - pattern with the captured value.
 * @returns {string[]} captured values.
 */
function matches(html, pattern) {
  return [...html.matchAll(pattern)].map((match) => match[1]);
}

/**
 * The markup of one row, by its identity key, so assertions about a row cannot
 * accidentally read a sibling's attributes.
 * @param {string} html - the rendered page.
 * @param {string} key - `data-skc-row` value, e.g. `filesystem#ui-design`.
 * @returns {string} the row's own markup.
 */
function rowMarkup(html, key) {
  const found = new RegExp(`<li class="skc_card" data-skc-row="${key}"[\\s\\S]*?</li>`).exec(html);
  assert.ok(found !== null, `页面上有 ${key} 这一行`);
  return found[0];
}

test('K23 三个分区的标题按内置/本地/已安装顺序出现', () => {
  const html = renderPage();
  const titles = matches(html, /class="skc_groupTitle">([^<]+)</g);
  assert.deepEqual(titles, ['内置技能配置', '本地技能', '已安装技能'], '三个分区标题及其顺序与设计一致');
});

test('K23 分区数据属性与顺序一致（供 CSS 与断言使用）', () => {
  const html = renderPage();
  assert.deepEqual(matches(html, /data-skc-group="([a-z]+)"/g), ['builtin', 'local', 'installed'], '分区 key 的顺序恒定');
});

test('K23 空分区仍渲染区标题与空态文案', () => {
  const html = renderPage({ payload: { groups: [], counts: { total: 0, disabled: 0, excluded: 0 }, complete: true, diagnostics: [], cwd: '/w' } });
  assert.equal(matches(html, /class="skc_groupTitle">/g).length, 3, '空的时候三个分区标题都在');
  const empties = matches(html, /class="skc_empty">([^<]+)</g);
  assert.deepEqual(empties, [
    '这个部署没有内置技能。',
    '还没有本地技能。把技能目录放进 ~/.dsh/skills/ 就会出现。',
    '还没有从市场安装技能。',
  ], '三个分区的空态文案都在');
});

test('K22 行结构：图标 + 名称 + 描述 + 右侧控件', () => {
  const html = renderPage();
  const rowHtml = rowMarkup(html, 'filesystem#ui-design');
  // The icon is a letter avatar, so the assertion looks at its *shape* - the two inline
  // palette properties, one uppercased letter, `aria-hidden` - and not merely at the
  // class name. A host glyph or an empty tile would keep `skc_cardIcon` and still be a
  // regression; these four facts would not survive it.
  const icon = /<span class="skc_cardIcon" style="([^"]*)" aria-hidden="true">([^<]*)<\/span>/.exec(rowHtml);
  assert.ok(icon !== null, '图标位是「色板变量 + aria-hidden + 字母」的 span');
  const [, style, letter] = icon;
  const expected = avatarOf('ui-design');
  assert.equal(style, `--skc-avatar-bg:${expected.bg};--skc-avatar-ink:${expected.ink}`, '色块与字母色来自 avatarOf(名字)');
  assert.equal(letter, 'U', '图标里是名字的大写首字母');
  assert.equal([...letter].length, 1, '图标里只有一个字符');
  assert.equal(rowHtml.includes('data-icon='), false, '不再渲染宿主通用技能字形');
  // R9：页面总传 `title`（rowTitleOf 的结果），tooltip 因此是 kebab 名 —— 这一行没有上游标题，
  // 所以可见文字仍是 kebab 名，只是多了一个 title 属性（模型调用用的就是这串）。
  // U1：标题同时是「整行可点」的那一层（cardOpen 的 ::after 铺满整行），所以它有两个类。
  assert.ok(rowHtml.includes('class="skc_cardTitle skc_cardOpen" title="ui-design">ui-design<'), '行有名称，tooltip 是 kebab 名，且名称就是整行可点层的按钮');
  assert.ok(rowHtml.includes('class="skc_cardDesc" title="A local skill."'), '行有描述，且 title 也是描述');
  assert.ok(rowHtml.includes('class="skc_cardEnd"'), '行有右侧控件位');
  assert.ok(rowHtml.includes('class="skc_cardMain"'), '名称与描述在中间列');
});

test('K22 每行的头像按自己的名字取色，不是整表一个色', () => {
  const html = renderPage();
  const tiles = matches(html, /style="--skc-avatar-bg:([^;]+);--skc-avatar-ink:[^"]+"/g);
  assert.equal(tiles.length, 4, '四条假技能各有一个头像');
  assert.equal(new Set(tiles).size, 4, '四条名字拿到四种色块（常量色或按首字母上色都会撞色）');
  const letters = matches(html, /aria-hidden="true">([^<]*)<\/span>/g);
  assert.deepEqual(letters, ['O', 'D', 'H', 'U'], '字母跟随各自名字（office / dev-docs-standards / hand-written / ui-design）');
});

test('K22 可写行的右侧是 role=switch 的开关，aria-label 为「启用 <name>」', () => {
  const html = renderPage();
  assert.ok(html.includes('role="switch"'), '可写行渲染出开关');
  assert.ok(html.includes('aria-label="启用 ui-design"'), '开关的无障碍名是「启用 ui-design」');
  assert.ok(html.includes('role="status"'), '开关左侧留了进行中播报位');
});

test('K22 已停用的行开关 aria-checked 为 false，title 提示「启用」', () => {
  const html = renderPage();
  const handWritten = html.slice(html.indexOf('data-skc-row="filesystem#hand-written"'));
  const switchTag = handWritten.slice(handWritten.indexOf('role="switch"') - 200, handWritten.indexOf('role="switch"') + 260);
  assert.ok(switchTag.includes('aria-checked="false"'), '停用行的开关是关闭态');
  assert.ok(switchTag.includes('aria-label="启用 hand-written"'), '停用行的开关名仍是「启用 …」');
});

test('软链行不渲染开关，改渲染只读标记（三层拦截的第二层）', () => {
  const html = renderPage();
  const start = html.indexOf('data-skc-row="filesystem#dev-docs-standards"');
  const end = html.indexOf('data-skc-row="filesystem#hand-written"');
  const linkedRow = html.slice(start, end === -1 ? undefined : end);
  assert.equal(linkedRow.includes('role="switch"'), false, '软链行里没有开关');
  assert.ok(linkedRow.includes('class="skc_roTag"'), '软链行有只读标记');
  assert.ok(linkedRow.includes('软链·只读'), '只读标记写着「软链·只读」');
  assert.ok(linkedRow.includes('这是一个软链（指向 /Users/me/Skills/dev-docs-standards/SKILL.md）'), '只读标记的 title 指出链接目标');
  assert.ok(linkedRow.includes('data-icon="link"'), '只读标记带链接图标');
});

test('内置行渲染开关（写面板存储那条路径）', () => {
  const html = renderPage();
  const builtin = html.slice(html.indexOf('data-skc-row="runtime#office"'), html.indexOf('data-skc-group="local"'));
  assert.ok(builtin.includes('role="switch"'), '内置行有开关');
  assert.ok(builtin.includes('aria-label="启用 office"'), '内置行的开关名是「启用 office」');
  assert.equal(builtin.includes('skc_roTag'), false, '内置行没有只读标记');
});

test('行本身不可点：没有链接、没有详情按钮', () => {
  const html = renderPage();
  assert.equal(html.includes('<a '), false, '页面里没有任何链接');
  const rowMarkup = html.slice(html.indexOf('<li class="skc_card"'));
  assert.equal(/<li class="skc_card"[^>]*role="button"/.test(rowMarkup), false, '行不是按钮');
  assert.equal(rowMarkup.includes('tabindex'), false, '行不可聚焦');
});

test('K24 首次加载：骨架态 + 读取文案，页面 aria-busy 为 true', () => {
  const html = renderPage({ status: 'loading', payload: null });
  assert.ok(html.includes('data-skc-loading'), '骨架态挂点存在');
  assert.ok(html.includes('aria-label="正在读取技能…"'), '骨架携带读取文案');
  assert.ok(html.includes('aria-busy="true"'), '加载中页面 aria-busy 为 true');
  assert.equal(html.includes('skc_groupTitle">内置'), false, '加载中不渲染真实分区');
});

test('K24 骨架条的条数与结构：1 条标题 + 4 张卡片', () => {
  const html = renderToStaticMarkup(createElement(modules.skeleton.ListSkeleton, { label: t('page.loading') }));
  const bars = matches(html, /skc_skeletonBar"/g);
  // 附录 D 的 K24 写「4 个」，实际结构照宿主是 1 条标题 + 4 张卡片 × 2 条（附件 K24 笔误，
  // 见报告「已知情况」）：这里按 >=4 且按种类断言，而不是钉死一个数字。
  assert.ok(bars.length >= 4, `骨架条不少于 4 条（实际 ${bars.length} 条）`);
  assert.equal(bars.length, 9, '当前结构是 1 条标题 + 4 张卡片各 2 条 = 9 条');
  assert.equal(matches(html, /skc_skeletonIcon"/g).length, 4, '四张卡片各有图标骨架');
  assert.equal(matches(html, /skc_skeletonActions"/g).length, 4, '四张卡片各有右侧骨架');
  assert.equal(matches(html, /<li class="skc_card">/g).length, 4, '骨架画四行');
  assert.ok(html.includes('role="status"'), '骨架是 status 角色，读屏会播报');
});

test('K24 错误态：alert + 说明文案 + 重试按钮', () => {
  const html = renderPage({ status: 'error', payload: null });
  assert.ok(html.includes('class="skc_failure"'), '错误态挂点存在');
  assert.ok(html.includes('role="alert"'), '错误态是 alert 角色');
  assert.ok(html.includes('可能由于网络问题，无法读取全部技能'), '错误态显示说明文案');
  assert.ok(html.includes('>重试<'), '错误态有重试按钮');
  assert.equal(html.includes('skc_groupTitle'), false, '首次失败时不渲染分区');
});

test('K25 页签：两个 tab，默认选中已安装', () => {
  const html = renderPage();
  assert.equal(matches(html, /role="tab"/g).length, 2, '渲染两个页签');
  const installed = html.slice(html.indexOf('role="tab"'), html.indexOf('>已安装<'));
  assert.ok(installed.includes('aria-selected="true"'), '默认选中已安装');
  assert.ok(html.includes('aria-label="技能分区"'), '页签组有分组名');
});

test('K25/K28 切到市场页签：挂载市场面板，已安装面整块退场（占位文案已按设计删除）', () => {
  const html = renderPage({ after: (store) => store.actions.setTab('market') });
  // 本轮把占位文案换成了真市场：判据从「有无占位文案」改成「装了谁的哪一面」。
  assert.equal(html.includes('技能市场将在后续版本提供。'), false, '旧的占位文案按设计删除');
  assert.ok(html.includes('class="skc_tabPanel"'), '市场页签用自己的面板容器');
  assert.ok(html.includes('class="skc_marketSection"'), '市场面板挂载（skc_marketSection）');
  assert.ok(/role="tabpanel"[^>]*id="[^"]*-market-panel"/.test(html), '市场面板是 tabpanel 且 id 按 market 页签拼');
  assert.equal(html.includes('data-skc-group='), false, '市场页签不渲染任何已安装分区');
  assert.equal(html.includes('class="skc_status"'), false, '市场页签的页头不显示「共 N 个技能」状态行');
  assert.equal(html.includes('skc_addPrimary'), false, '市场页签不显示「添加技能」（它只属于已安装面）');
  // 页头的刷新按钮属于两页签共用：市场页签下它刷新市场首页，因此仍在原位可见。
  assert.equal(html.includes('class="skc_toolbar"'), true, '工具栏保留（刷新按钮对市场页签同样有效）');
  assert.ok(html.includes('aria-label="刷新"'), '市场页签下刷新按钮仍可点');
});

test('页脚只在有被排除的技能时出现，并给出数量', () => {
  const withExcluded = renderPage();
  assert.ok(withExcluded.includes('另有 2 个技能位于项目级或其他目录，首版不展示'), '有被排除的技能时显示页脚');
  const without = renderPage({ payload: { ...payload(), counts: { total: 4, disabled: 1, excluded: 0 } } });
  assert.equal(without.includes('首版不展示'), false, '没有被排除的技能时不显示页脚');
});

test('K26 页头状态行给出总数与停用数', () => {
  const html = renderPage();
  assert.ok(html.includes('class="skc_status"'), '页头有状态行');
  assert.ok(html.includes('共 4 个技能，1 个已停用'), '状态行是「共 4 个技能，1 个已停用」');
});

test('页头四件套：标题、副标题、信息按钮、刷新按钮、添加按钮（禁用态）', () => {
  const html = renderPage();
  assert.ok(html.includes('class="skc_pageTitle"'), '有大标题');
  assert.ok(html.includes('启用、停用和查看技能来源'), '有副标题');
  assert.ok(html.includes('aria-label="关于技能"'), '有 ⓘ 信息按钮');
  assert.ok(html.includes('aria-label="刷新"'), '有刷新按钮');
  assert.ok(html.includes('title="即将支持"'), '添加技能是带「即将支持」提示的禁用态');
  assert.ok(/class="skc_addPrimary"[^>]*disabled=""/.test(html), '添加按钮是禁用状态');
});

test('行内原因：失败的行显示 localized 原因并以 alert 播报', () => {
  const html = renderPage({
    after: (store) => {
      store.actions.pending('filesystem#hand-written');
      store.actions.fail('filesystem#hand-written', '软链技能只读，未做任何修改');
    },
  });
  const start = html.indexOf('data-skc-row="filesystem#hand-written"');
  const segment = html.slice(start, start + 2000);
  assert.ok(segment.includes('class="skc_reason"'), '失败行渲染行内原因');
  assert.ok(segment.includes('软链技能只读，未做任何修改'), '行内原因是本地化文案');
  assert.ok(segment.includes('role="alert"'), '行内原因以 alert 播报');
  assert.ok(segment.includes('data-skc-state="failed"'), '行状态标记为 failed');
});

test('写入中的行：开关禁用、播报「正在应用」、出现进行中指示', () => {
  const html = renderPage({ after: (store) => store.actions.pending('filesystem#hand-written') });
  const start = html.indexOf('data-skc-row="filesystem#hand-written"');
  const segment = html.slice(start, start + 2400);
  assert.ok(segment.includes('data-skc-state="pending"'), '行状态标记为 pending');
  assert.ok(segment.includes('正在应用 hand-written 的更改'), '播报正在应用');
  assert.ok(segment.includes('data-state="ongoing"'), '开关左侧出现进行中指示');
  assert.ok(/<button[^>]*role="switch"[^>]*disabled=""/.test(segment), '写入中的开关被禁用');
});

test('页签切回已安装后列表恢复（页签状态在 store 里）', () => {
  const store = createStore();
  store.actions.ready(payload());
  store.actions.setTab('market');
  const api = { list: async () => {}, toggle: async () => {}, toggleProvider: async () => {} };
  const market = renderToStaticMarkup(createElement(modules.page.SkillsPage, { store, api, t }));
  store.actions.setTab('installed');
  const installed = renderToStaticMarkup(createElement(modules.page.SkillsPage, { store, api, t }));
  assert.equal(market.includes('data-skc-group='), false, '市场页签下没有分区');
  assert.equal(installed.includes('data-skc-group="local"'), true, '切回已安装后分区恢复');
});

/* ---------------------------------------- K111 · 详情就地替换、返回不重拉、刷新关详情 */

/**
 * Every element of a rendered tree, depth first.
 * @param {import('react').ReactNode} node - element, array, or text.
 * @param {object[]} [found] - accumulator.
 * @returns {object[]} the elements.
 */
function elementsOf(node, found = []) {
  if (node === null || node === undefined || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    for (const child of node) elementsOf(child, found);
    return found;
  }
  found.push(node);
  elementsOf(node.props?.children, found);
  return found;
}

/**
 * Mount the page so its handlers can be called (no effects, no DOM).
 * @param {object} api - API client stub; `list` records its calls.
 * @returns {{store: object, render: Function}} the store and a render handle.
 */
function mountPage(api) {
  const store = createStore();
  store.actions.ready(payload());
  const mounted = mountHooks(modules.page.SkillsPage, { store, api, t });
  return { store, render: mounted.render };
}

/** One installed row that carries an upstream identity and a local version. */
function upstreamRow(overrides = {}) {
  return row({
    name: 'ui-design',
    partition: 'installed',
    rule: 'R7',
    upstream: { sourceId: 'skillhub', owner: 'ake', slug: 'ui-design' },
    version: '1.2.4',
    ...overrides,
  });
}

/** A payload holding exactly one upstream row (the list is what `detailRow` is read from). */
function upstreamPayload(overrides = {}) {
  const target = upstreamRow(overrides);
  return { groups: [{ key: 'installed', skills: [target] }], counts: { total: 1, disabled: 0, excluded: 0 }, complete: true, diagnostics: [], cwd: '/work' };
}

/**
 * The `onCheck` handler the page hands the detail view.
 * @param {object} tree - a rendered tree.
 * @returns {Function} the handler.
 */
function checkPropOf(tree) {
  const detail = elementsOf(tree).find((element) => element.type === modules.installedDetail.InstalledDetail);
  assert.ok(detail !== undefined, '详情组件在树里');
  assert.equal(typeof detail.props.onCheck, 'function', '页面把 onCheck 传下去了');
  return detail.props.onCheck;
}

/** The api client stub the detail tests use; `calls` records every route touched. */
function recordingApi(calls, detail = { body: 'text', files: [], filesTruncated: false }, options = {}) {
  const apiVersion = options.version ?? '1.2.4';
  const apiDetailFails = options.fails === true;
  return {
    list: async () => { calls.push('list'); },
    toggle: async () => {},
    toggleProvider: async () => {},
    skillDetail: async (arg) => { calls.push(`skillDetail:${arg?.name}`); return detail; },
    marketDetail: async (arg) => {
      calls.push(`marketDetail:${arg?.source}/${arg?.owner}/${arg?.slug}`);
      if (apiDetailFails) throw new Error('boom');
      return { item: { version: apiVersion } };
    },
  };
}

test('K111 详情就地替换列表：三分区不在，详情在', () => {
  const html = renderPage({
    after: (store) => {
      store.actions.openDetail(row({ name: 'ui-design', partition: 'installed', rule: 'R7' }));
      store.actions.detailReady('filesystem#ui-design', { body: '正文', files: [], filesTruncated: false });
    },
  });
  assert.equal(html.includes('data-skc-installed-detail="filesystem#ui-design"'), true, '详情挂点在场');
  assert.equal(html.includes('data-skc-group='), false, '三个分区不再渲染（就地替换）');
  assert.equal(/data-skc-row=/.test(html), false, '一行都不渲染');
  assert.ok(html.includes('skc_marketCrumb') && html.includes('>技能<'), '面包屑是唯一返回入口（detail.back =「技能」）');
});

test('K111 详情打开时行消失：只有面包屑 + error.E_NOT_FOUND，页面不炸', () => {
  const html = renderPage({
    after: (store) => {
      store.actions.openDetail(row({ name: 'ghost-skill', provider: 'filesystem' }));
    },
  });
  assert.equal(html.includes('data-skc-detail-missing'), true, '走的是失效态挂点');
  assert.ok(html.includes(t('error.E_NOT_FOUND')), '文案是 error.E_NOT_FOUND');
  assert.ok(html.includes('skc_marketCrumb') && html.includes('>技能<'), '面包屑仍可回（detail.back =「技能」）');
});

test('K111 点行进详情：记偏移 + 只读正文，不重拉 list', async () => {
  const calls = [];
  const { store, render } = mountPage(recordingApi(calls));
  store.actions.rememberDetailScroll(0);
  const skillRow = elementsOf(render()).find(
    (element) => element.type === modules.row.SkillRow && element.props.row.name === 'ui-design',
  );
  assert.ok(skillRow !== undefined, '页面渲染出了那一行');
  const target = skillRow.props.row;

  skillRow.props.onOpen(target);
  assert.deepEqual(store.getSnapshot().detail, { key: 'filesystem#ui-design', status: 'loading', data: null, code: null }, '先挂 loading 三态');
  assert.deepEqual(calls, ['skillDetail:ui-design'], '只发一次正文请求，没有 list');

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(store.getSnapshot().detail.status, 'ready', '答案落地后是 ready');
  assert.equal(store.getSnapshot().payload.groups.length, 3, '列表快照还在（不重扫）');
});

test('K111 面包屑返回：detail 变 null 且不再请求任何路由', async () => {
  const calls = [];
  const { store, render } = mountPage(recordingApi(calls));
  store.actions.openDetail(row({ name: 'ui-design', partition: 'installed', rule: 'R7' }));
  store.actions.detailReady('filesystem#ui-design', { body: '正文', files: [], filesTruncated: false });
  // 面包屑在详情组件内部：组件本体不含 hook，直接调用它拿到元素树再点那颗按钮。
  const detailElement = elementsOf(render()).find((element) => element.type === modules.installedDetail.InstalledDetail);
  assert.ok(detailElement !== undefined, '页面把详情交给了 InstalledDetail');
  const crumb = elementsOf(modules.installedDetail.InstalledDetail(detailElement.props))
    .find((element) => element.props?.className === 'skc_marketCrumb');
  assert.ok(crumb !== undefined, '详情里有面包屑按钮');
  assert.equal(crumb.props.type, 'button', '面包屑是普通按钮（不是第二套点击层）');
  assert.equal(typeof crumb.props.onClick, 'function', '面包屑带 onClick');
  crumb.props.onClick();
  assert.equal(store.getSnapshot().detail, null, '返回后关掉详情');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, [], '返回不重拉 list、也不重读正文');
});

test('K111 详情态是整页替换：没有页头 / 页签 / 刷新，只有 detailPage（拖动条 + 面包屑）', () => {
  const html = renderPage({
    after: (store) => {
      store.actions.openDetail(row({ name: 'ui-design', partition: 'installed', rule: 'R7' }));
      store.actions.detailReady('filesystem#ui-design', { body: '正文', files: [], filesTruncated: false });
    },
  });
  // 宿主插件详情页就是这样：详情顶端只有面包屑，没有任何页头与页签。
  for (const gone of ['skc_pageBar', 'skc_pageHead', 'skc_pageTitle', 'skc_pageIntro', 'skc_toolbar', 'skc_pageTabs', 'skc_pageTabList']) {
    assert.equal(html.includes(gone), false, `详情态没有 .${gone}`);
  }
  assert.equal(html.includes(t('page.refresh')), false, '详情态连「刷新」这几个字都没有');
  assert.equal(html.includes('skc_detailPage'), true, '详情态有 .skc_detailPage');
  assert.ok(html.includes('data-skc-installed-detail="filesystem#ui-design"'), '详情内容在');
  assert.ok(html.includes('class="skc_marketCrumb"'), '面包屑是第一眼内容');
  // 面板级钩子还在（整页替换只换内容，不换面板）
  assert.ok(/data-skc-panel=""/.test(html), '面板挂点仍在');
  assert.equal(/aria-busy="false"|aria-busy="true"/.test(html), true, 'aria-busy 仍在');
});

test('K111 拖动条：data-window-drag 只在空条上，不落到 detailPage / 详情容器里', () => {
  const html = renderPage({
    after: (store) => {
      store.actions.openDetail(row({ name: 'ui-design', partition: 'installed', rule: 'R7' }));
      store.actions.detailReady('filesystem#ui-design', { body: '正文', files: [], filesTruncated: false });
    },
  });
  const tags = [...html.matchAll(/<[^>]*data-window-drag[^>]*>/g)].map((match) => match[0]);
  assert.equal(tags.length, 1, `整页只有一个拖动区（实测 ${tags.length}）`);
  assert.match(tags[0], /class="skc_detailDrag"/, '拖动区就是那条空条');
  // 空条是 detailPage 的第一个子节点、且在详情内容之前：窗口拖动靠它，内容区不接管拖动
  // （否则文字选择与所有按钮都会被吃掉）。
  const page = /<div class="skc_detailPage">([\s\S]*?)<div class="skc_marketDetail"/.exec(html);
  assert.ok(page !== null, 'detailPage 里紧跟详情内容');
  assert.equal(page[1].trim(), '<div class="skc_detailDrag" data-window-drag=""></div>', 'detailPage 的第一个子节点就是空拖动条');
  assert.equal(/skc_detailPage" data-window-drag/.test(html), false, 'detailPage 自己不接管拖动');
  assert.equal(/data-skc-installed-detail="[^"]*"[^>]*data-window-drag/.test(html), false, '详情容器不接管拖动');
});

test('K111 detailPage 是 pageBody 的直接子元素（沿用 960 宽与页面内边距）', () => {
  const html = renderPage({
    after: (store) => {
      store.actions.openDetail(row({ name: 'ui-design', partition: 'installed', rule: 'R7' }));
      store.actions.detailReady('filesystem#ui-design', { body: '正文', files: [], filesTruncated: false });
    },
  });
  assert.ok(/<div class="skc_pageBody" data-skc-body="">\s*<div class="skc_detailPage">/.test(html),
    'pageBody 的第一个子元素就是 detailPage（没有中间层，宽度与内边距照旧由 pageBody 给）');
  assert.equal((html.match(/class="skc_pageBody"/g) ?? []).length, 1, '只有一个滚动容器');
});

test('K111 返回列表后页头与刷新都回来了，刷新仍走「关详情 + 重扫一次 list」', async () => {
  const calls = [];
  const { store, render } = mountPage(recordingApi(calls));
  store.actions.openDetail(row({ name: 'ui-design', partition: 'installed', rule: 'R7' }));
  store.actions.detailReady('filesystem#ui-design', { body: '正文', files: [], filesTruncated: false });
  assert.equal(
    elementsOf(render()).some((element) => element.props?.['aria-label'] === t('page.refresh')),
    false,
    '详情态找不到刷新按钮（页头整块没渲染）',
  );

  // 面包屑返回：页头重建，刷新按钮回到页头。
  const detailElement = elementsOf(render()).find((element) => element.type === modules.installedDetail.InstalledDetail);
  const crumb = elementsOf(modules.installedDetail.InstalledDetail(detailElement.props))
    .find((element) => element.props?.className === 'skc_marketCrumb');
  crumb.props.onClick();
  assert.equal(store.getSnapshot().detail, null, '返回后详情关了');

  const refresh = elementsOf(render()).find((element) => element.props?.['aria-label'] === t('page.refresh'));
  assert.ok(refresh !== undefined, '返回列表后页头刷新回来了');
  assert.equal(refresh.props.disabled, false, '空闲时可点');

  refresh.props.onClick();
  assert.equal(store.getSnapshot().detail, null, '刷新之后仍没有详情');
  assert.deepEqual(calls, ['list'], '刷新走一次 list（不额外重读正文）');
  assert.equal(store.getSnapshot().status, 'loading', '列表进入加载态');
  await new Promise((resolve) => setTimeout(resolve, 450));
});

test('版本检查：没有 upstream 或没有本地版本 ⇒ 状态 unavailable，且一个请求都不发', async () => {
  for (const bare of [row({ name: 'hand-written' }), row({ name: 'hand-written', upstream: { sourceId: 'skillhub', owner: 'ake', slug: 'dev-god' } })]) {
    const calls = [];
    const { store, render } = mountPage(recordingApi(calls));
    store.actions.openDetail(bare);
    store.actions.detailReady('filesystem#hand-written', { body: '正文', files: [], filesTruncated: false });
    const onCheck = checkPropOf(render());
    const pending = onCheck();
    assert.equal(store.getSnapshot().check.status, 'unavailable', '直接判 unavailable');
    await pending;
    assert.deepEqual(calls, [], '没有发出任何请求（没有可比的版本）');
  }
});

test('版本检查：同版本 ⇒ upToDate（带 at），且只查一条 market/detail', async () => {
  const calls = [];
  const { store, render } = mountPage(recordingApi(calls, undefined, { version: '1.2.4' }));
  store.actions.ready(upstreamPayload());
  store.actions.openDetail(upstreamRow());
  store.actions.detailReady('filesystem#ui-design', { body: '正文', files: [], filesTruncated: false });
  await checkPropOf(render())();
  const check = store.getSnapshot().check;
  assert.equal(check.status, 'upToDate', '字符串相等就是最新');
  assert.equal(Number.isFinite(check.at), true, '记下检查时间');
  assert.deepEqual(calls, ['marketDetail:skillhub/ake/ui-design'], '只查一次上游详情');
});

test('版本检查：版本不同 ⇒ newer + latestVersion（不做大小比较）', async () => {
  const calls = [];
  const { store, render } = mountPage(recordingApi(calls, undefined, { version: '9.9.9' }));
  store.actions.ready(upstreamPayload({ upstream: { sourceId: 'clawhub', owner: 'ake', slug: 'ui-design' } }));
  store.actions.openDetail(upstreamRow({ upstream: { sourceId: 'clawhub', owner: 'ake', slug: 'ui-design' } }));
  store.actions.detailReady('filesystem#ui-design', { body: '正文', files: [], filesTruncated: false });
  await checkPropOf(render())();
  const check = store.getSnapshot().check;
  assert.equal(check.status, 'newer', '不同就是有新版本');
  assert.equal(check.latestVersion, '9.9.9', '带上上游版本号');
  assert.deepEqual(calls, ['marketDetail:clawhub/ake/ui-design'], 'clawhub 身份走 clawhub 范围');
});

test('版本检查：请求失败 ⇒ error（可以重试）', async () => {
  const calls = [];
  const { store, render } = mountPage(recordingApi(calls, undefined, { fails: true }));
  store.actions.ready(upstreamPayload());
  store.actions.openDetail(upstreamRow());
  store.actions.detailReady('filesystem#ui-design', { body: '正文', files: [], filesTruncated: false });
  await checkPropOf(render())();
  assert.equal(store.getSnapshot().check.status, 'error', '抛错落到 error 态');
  assert.deepEqual(calls, ['marketDetail:skillhub/ake/ui-design'], '失败也算查过一次');
});

test('版本检查：查的过程中是 busy（按钮禁用、结论不清空）', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const api = {
    list: async () => {},
    toggle: async () => {},
    toggleProvider: async () => {},
    skillDetail: async () => ({ body: 'text', files: [], filesTruncated: false }),
    marketDetail: async () => {
      await gate;
      return { item: { version: '1.2.4' } };
    },
  };
  const { store, render } = mountPage(api);
  store.actions.ready(upstreamPayload());
  store.actions.openDetail(upstreamRow());
  store.actions.detailReady('filesystem#ui-design', { body: '正文', files: [], filesTruncated: false });
  store.actions.setCheck('filesystem#ui-design', { status: 'upToDate', at: Date.now() });
  const pending = checkPropOf(render())();
  assert.equal(store.getSnapshot().check.busy, true, '请求在飞的时候 busy 为真');
  assert.equal(store.getSnapshot().check.status, 'upToDate', '结论保留上一次的值');
  release();
  await pending;
  assert.equal(store.getSnapshot().check.busy, false, '落地后 busy 收起');
  assert.equal(store.getSnapshot().check.status, 'upToDate', '同版本仍是 upToDate');
});

test('K111 市场页签不跟着改：页头与页签仍在，市场详情仍只替换网格', () => {
  const item = { id: 'skillhub:ake:pdf', sourceId: 'skillhub', owner: 'ake', slug: 'pdf', displayName: 'PDF 工具' };
  const listState = renderPage({ after: (store) => { store.actions.setTab('market'); } });
  assert.ok(listState.includes('skc_pageBar'), '市场态有页头');
  assert.ok(listState.includes('skc_pageTabList') || listState.includes('skc_pageTabs'), '市场态有页签');
  assert.ok(listState.includes(t('page.refresh')), '市场态有刷新');

  const detailState = renderPage({
    after: (store) => {
      store.actions.setTab('market');
      store.actions.marketDetailOpen(item);
    },
  });
  assert.ok(detailState.includes('skc_pageBar'), '市场详情打开时页头仍在（与已安装的整页替换刻意不同）');
  assert.ok(detailState.includes('data-skc-market-detail'), '市场详情在场');
  assert.equal(detailState.includes('data-skc-market-id'), false, '网格被就地替换掉了');
  assert.equal(detailState.includes('skc_detailPage'), false, '市场详情不走 detailPage（那是已安装页签的整页替换）');
  assert.equal(detailState.includes('skc_detailDrag'), false, '市场详情也没有那条拖动条');
});
