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
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test, { before } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { avatarOf } from '../src/client/avatar.js';
import { verdictOf } from '../src/client/model.js';
import { createStore } from '../src/client/state.js';
import { ROOT, loadClientModules, zhTranslator } from './helpers/ssr.mjs';
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
 * A payload whose builtin rows carry `originPath`, so the blocks fold by package.
 * @returns {object} ListPayload.
 */
function payloadWithOrigins() {
  const base = payload();
  const builtin = base.groups.find((group) => group.key === 'builtin');
  builtin.skills = [
    { ...row({ name: 'office', provider: 'univer', partition: 'builtin', path: null, writable: false, readonlyReason: 'provider-store' }), originPath: '/p/node_modules/dsh-univer-office/skills/office/SKILL.md' },
    { ...row({ name: 'sheet', provider: 'univer', partition: 'builtin', path: null, writable: false, readonlyReason: 'provider-store' }), originPath: '/p/node_modules/dsh-univer-office/skills/sheet/SKILL.md' },
    { ...row({ name: 'zzz', provider: 'univer', partition: 'builtin', path: null, writable: false, readonlyReason: 'provider-store' }), originPath: '/p/node_modules/zzz-other-pkg/skills/zzz/SKILL.md' },
  ];
  return base;
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

test('K22 头像按名字取色：内置块取 provider 名，两区的行取技能名', () => {
  const html = renderPage();
  const tiles = matches(html, /style="--skc-avatar-bg:([^;]+);--skc-avatar-ink:[^"]+"/g);
  assert.equal(tiles.length, 4, '一个内置块 + 三条行，各有一个头像');
  assert.equal(new Set(tiles).size, 4, '四个名字拿到四种色块（常量色或按首字母上色都会撞色）');
  const letters = matches(html, /aria-hidden="true">([^<]*)<\/span>/g);
  // 内置区折成 provider 块（runtime），所以第一块的头像是 R，不再是被折进去的 office。
  assert.deepEqual(letters, ['R', 'D', 'H', 'U'], '字母跟随各自名字（runtime 块 / dev-docs-standards / hand-written / ui-design）');
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

test('内置块里没有开关；进插件页后每个技能各有一个开关（写面板存储那条路径）', () => {
  const html = renderPage();
  const block = html.slice(html.indexOf('data-skc-plugin="runtime"'), html.indexOf('data-skc-group="local"'));
  assert.ok(block.length > 0, '内置区渲染成 provider 块');
  assert.equal(block.includes('role="switch"'), false, '块上没有开关（折叠后只剩入口）');
  assert.equal(block.includes('skc_roTag'), false, '块上也没有只读标记');
  assert.ok(block.includes('1 个技能') || block.includes('个技能'), '块上写着技能数');

  // 进插件页：每行一个开关，名字仍是「启用 <name>」。
  const pluginHtml = renderPage({ after: (store) => { store.actions.openPlugin('runtime'); } });
  assert.ok(pluginHtml.includes('data-skc-plugin-detail="runtime"'), '插件页挂点');
  const switches = (pluginHtml.match(/role="switch"/g) ?? []).length;
  assert.equal(switches, 1, `插件页的开关数 = 技能数（实测 ${switches}）`);
  assert.ok(pluginHtml.includes('aria-label="启用 office"'), '开关名是「启用 office」');
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

test('K26 页头状态位只承载更新提示，不渲染技能计数', () => {
  const plain = renderPage();
  assert.equal(plain.includes('class="skc_status"'), false, '没有可检查的技能时状态位不渲染');
  assert.equal(plain.includes('共 4 个技能'), false, '页头不渲染技能计数');
  assert.equal(plain.includes('个已停用'), false, '页头不渲染停用计数');

  const withNote = renderHeader({
    verdicts: {
      'skillhub:ake:ui-design': { phase: 'ready', candidate: '2.0.0', at: 1000 },
      'clawhub:ake:ui-design': { phase: 'ready', candidate: '1.2.4', at: 1000 },
    },
  });
  assert.equal((withNote.match(/<span class="skc_status"/g) ?? []).length, 1, '状态位只有一个 span');
  assert.equal(withNote.includes('共 2 个技能'), false, '状态位里没有计数（宿主同位也只有这一句）');
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

/**
 * The api client stub the detail tests use; `calls` records every route touched.
 *
 * `marketVersions` is the only route an update check may touch (`docs/contracts/routes.md`
 * 3.7.1 #15); `marketDetail` stays for the tests that only need a version tag.
 * @param {string[]} calls - sink for one string per route touched.
 * @param {object} [detail] - body the skillDetail stub answers with.
 * @param {{versions?: object[], versionsFail?: boolean, versionsCode?: string,
 *   version?: string}} [options] - version list, failure switch and the detail tag version.
 * @returns {object} the stub.
 */
function recordingApi(calls, detail = { body: 'text', files: [], filesTruncated: false }, options = {}) {
  const apiVersion = options.version ?? '1.2.4';
  const versions = options.versions ?? [{ version: '1.2.4', publishedAt: 1762396800000 }];
  const versionsFail = options.versionsFail === true;
  const versionsCode = options.versionsCode ?? 'E_SOURCE_TIMEOUT';
  return {
    list: async () => { calls.push('list'); },
    toggle: async () => {},
    toggleProvider: async () => {},
    skillDetail: async (arg) => { calls.push(`skillDetail:${arg?.name}`); return detail; },
    marketDetail: async (arg) => {
      calls.push(`marketDetail:${arg?.source}/${arg?.owner}/${arg?.slug}`);
      return { item: { version: apiVersion } };
    },
    marketVersions: async (arg) => {
      calls.push(`marketVersions:${arg?.source}/${arg?.owner}/${arg?.slug}`);
      if (versionsFail) throw Object.assign(new Error('boom'), { code: versionsCode });
      return {
        source: arg?.source,
        owner: arg?.owner,
        slug: arg?.slug,
        namespace: arg?.owner,
        latest: versions.length === 0 ? null : versions[0].version,
        versions,
        total: versions.length,
      };
    },
  };
}

/**
 * One identity's cached verdict, or null.
 * @param {object} store - the page store.
 * @param {string} key - `source:owner:slug`.
 * @returns {object|null} the entry.
 */
function verdictIn(store, key) {
  return store.getSnapshot().checks[key] ?? null;
}

/**
 * Click one row's title the way the host does, and let the follow-up requests settle.
 *
 * `openDetail` on the page is what kicks the one `ensure` an open needs, so the check has
 * to be driven through the row handler - calling `store.actions.openDetail` skips it.
 * @param {Function} render - the harness render.
 * @param {object} store - the page store, for the settled-state assertions.
 * @param {string} name - the row's `name`.
 * @returns {Promise<object>} the row that was opened.
 */
async function openViaPage(render, store, name) {
  const skillRow = elementsOf(render()).find(
    (element) => element.type === modules.row.SkillRow && element.props.row.name === name,
  );
  assert.ok(skillRow !== undefined, `页面上有 ${name} 这一行`);
  await skillRow.props.onOpen(skillRow.props.row);
  // 版本请求是 openDetail 之后 `void` 出去的，落地要等一个宏任务。
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.notEqual(store.getSnapshot().detail, null, `${name} 的详情开了`);
  return skillRow.props.row;
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

test('K111 点行进详情：正文先到就带着数据切视图（首帧即终态），只发一笔 skillDetail', async () => {
  const calls = [];
  const { store, render } = mountPage(recordingApi(calls));
  store.actions.rememberDetailScroll(0);
  const skillRow = elementsOf(render()).find(
    (element) => element.type === modules.row.SkillRow && element.props.row.name === 'ui-design',
  );
  assert.ok(skillRow !== undefined, '页面渲染出了那一行');
  const target = skillRow.props.row;

  const pending = skillRow.props.onOpen(target);
  // 还在等正文：视图不动（没有占位帧）。
  assert.equal(store.getSnapshot().detail, null, '调用后 detail 仍为 null（不先挂 loading）');
  assert.deepEqual(calls, ['skillDetail:ui-design'], '只发一笔正文请求，没有 list');

  await pending;
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.detail.status, 'ready', '正文到手后直接 ready');
  assert.deepEqual(snapshot.detail.data, { body: 'text', files: [], filesTruncated: false }, 'data 就是那份正文');
  assert.equal(snapshot.detail.key, 'filesystem#ui-design', '键没歪');
  assert.deepEqual(calls, ['skillDetail:ui-design'], '一笔请求：不重拉 list、不发第二遍正文');
  assert.equal(store.getSnapshot().payload.groups.length, 3, '列表快照还在（不重扫）');
});

test('K111 点行进详情：150 ms 还没到就退回 loading 态，正文后来到达也只会有 1 笔请求', async () => {
  const calls = [];
  let release = () => {};
  const api = {
    list: async () => { calls.push('list'); },
    toggle: async () => {},
    toggleProvider: async () => {},
    skillDetail: (arg) => {
      calls.push(`skillDetail:${arg?.name}`);
      return new Promise((resolve) => { release = () => resolve({ body: '迟到正文', files: [], filesTruncated: false }); });
    },
    marketDetail: async () => ({ item: { version: '1.2.4' } }),
  };
  const { store, render } = mountPage(api);
  const skillRow = elementsOf(render()).find(
    (element) => element.type === modules.row.SkillRow && element.props.row.name === 'ui-design',
  );
  const pending = skillRow.props.onOpen(skillRow.props.row);
  assert.equal(store.getSnapshot().detail, null, '刚点下去还在等');

  await new Promise((resolve) => setTimeout(resolve, 220));
  assert.equal(store.getSnapshot().detail.status, 'loading', '超过 150 ms 退回老的 loading 路径');
  assert.deepEqual(calls, ['skillDetail:ui-design'], '超时这条也只发了一笔');

  release();
  await pending;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(store.getSnapshot().detail.status, 'ready', '正文迟到也照样落成 ready');
  assert.equal(store.getSnapshot().detail.data.body, '迟到正文', '用的是同一笔请求的结果');
  assert.deepEqual(calls, ['skillDetail:ui-design'], '全程 1 笔正文请求、0 笔 list');
});

test('K118 openDetail 两个入口：带 data 就是 ready、带 error 就是 error，检测缓存一概不碰', () => {
  const store = createStore();
  store.actions.ready(payload());
  const localRow = row({ name: 'ui-design', partition: 'installed', rule: 'R7' });

  store.actions.openDetail(localRow, { body: '正文', files: [], filesTruncated: false });
  assert.equal(store.getSnapshot().detail.status, 'ready', '带正文 ⇒ ready');
  assert.equal(store.getSnapshot().detail.data.body, '正文', '正文落位');

  store.actions.openDetail(localRow, { error: { code: 'E_READ' } });
  assert.equal(store.getSnapshot().detail.status, 'error', '带 error ⇒ error');
  assert.equal(store.getSnapshot().detail.code, 'E_READ', 'code 落位');
  assert.equal(store.getSnapshot().detail.data, null, 'error 时没有 data');

  // 有身份但没有本地版本的行也一样：openDetail 自己不判「能不能查」（那是渲染层与 runner 的事）。
  const versioned = row({
    name: 'versioned',
    partition: 'installed',
    rule: 'R6',
    upstream: { sourceId: 'skillhub', owner: 'ake', slug: 'versioned' },
    version: null,
  });
  store.actions.openDetail(versioned, { body: '正文' });
  assert.equal(store.getSnapshot().detail.status, 'ready', 'ready 入口照旧');

  const snapshot = store.getSnapshot();
  assert.equal('check' in snapshot, false, '旧单槽 check 已从 state 删除（同一件事实不许两个真源）');
  assert.deepEqual(snapshot.checks, {}, 'openDetail 不写检测缓存：答案是按 identity 常驻的，不是详情的属性');
  assert.deepEqual(snapshot.checkRun, { id: 0, status: 'idle' }, '轮次令牌也不因开关详情而动');
});

test('K111 面包屑返回：detail 变 null 且不再请求任何路由', async () => {
  const calls = [];
  const { store, render } = mountPage(recordingApi(calls));
  store.actions.openDetail(row({ name: 'ui-design', partition: 'installed', rule: 'R7' }));
  store.actions.detailReady('filesystem#ui-design', { body: '正文', files: [], filesTruncated: false });
  // 面包屑在详情组件内部：组件本体不含 hook，直接调用它拿到元素树再点那颗按钮。
  const detailElement = elementsOf(render()).find((element) => element.type === modules.installedDetail.InstalledDetail);
  assert.ok(detailElement !== undefined, '页面把详情交给了 InstalledDetail');
  // 面包屑是 DetailCrumb 组件（两级返回里插件页也复用它），所以要进到它的渲染结果里找按钮。
  const detailTree = modules.installedDetail.InstalledDetail(detailElement.props);
  const crumbComponent = elementsOf(detailTree).find((element) => element.type === modules.installedDetail.DetailCrumb);
  assert.ok(crumbComponent !== undefined, '详情里有 DetailCrumb');
  const crumb = elementsOf(modules.installedDetail.DetailCrumb(crumbComponent.props))
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
  const crumbTree = modules.installedDetail.InstalledDetail(detailElement.props);
  const crumbComponent = elementsOf(crumbTree).find((element) => element.type === modules.installedDetail.DetailCrumb);
  const crumb = elementsOf(modules.installedDetail.DetailCrumb(crumbComponent.props))
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

test('K118 没有身份的行：点开详情零请求，「重新检查」也零请求', async () => {
  const calls = [];
  const { store, render } = mountPage(recordingApi(calls));
  const opened = await openViaPage(render, store, 'ui-design');
  assert.deepEqual(calls, ['skillDetail:ui-design'], '只有那一笔正文请求');
  assert.deepEqual(store.getSnapshot().checks, {}, '没有身份就没有缓存条目');
  // 版本区块整块不渲染，但万一被点到也不许发请求（升级前它会给个 unavailable 兜底结论）。
  checkPropOf(render())(opened);
  assert.deepEqual(calls, ['skillDetail:ui-design'], 'recheck 对没有身份的行直接返回');
});

test('K118 有身份但没有本地版本：点开详情零请求，区块自己说「无法检查更新」', async () => {
  const calls = [];
  const { store, render } = mountPage(recordingApi(calls));
  store.actions.ready(upstreamPayload({ version: null }));
  await openViaPage(render, store, 'ui-design');
  assert.deepEqual(calls, ['skillDetail:ui-design'], '没有可比的版本，一个版本请求都不发');
  assert.deepEqual(store.getSnapshot().checks, {}, '不写缓存条目（文案由渲染层按 version === null 给）');
  assert.equal(store.getSnapshot().checkRun.status, 'idle', '一轮都没开始');
});

test('K118 有身份但没有本地版本：「重新检查」也不发请求（installed-detail.md「更新检测与页头」）', async () => {
  const calls = [];
  const { store, render } = mountPage(recordingApi(calls));
  store.actions.ready(upstreamPayload({ version: null }));
  const opened = await openViaPage(render, store, 'ui-design');
  checkPropOf(render())(opened);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(calls, ['skillDetail:ui-design'],
    '契约说的是「整块不发请求」：没有本地版本就没有可比的东西，点按钮也只落地');
  assert.deepEqual(store.getSnapshot().checks, {}, '不写缓存条目');
});

test('K118 有身份也有版本：点开详情就查一次 market/versions（不再等用户点）', async () => {
  const calls = [];
  const { store, render } = mountPage(recordingApi(calls));
  store.actions.ready(upstreamPayload());
  await openViaPage(render, store, 'ui-design');
  assert.deepEqual(calls, ['skillDetail:ui-design', 'marketVersions:skillhub/ake/ui-design'],
    '正文一笔 + 版本列表一笔，走的第 15 条路由');
  const verdict = verdictIn(store, 'skillhub:ake:ui-design');
  assert.ok(verdict !== null, '答案按 identity 落进缓存');
  assert.equal(verdict.phase, 'ready', '答案到手就是 ready');
  assert.equal(verdict.busy, false, '落地后不再 busy');
  assert.equal(store.getSnapshot().checkRun.status, 'done', '一轮结束（页头等的就是它）');
});

test('K118 版本相同 ⇒ verdict ready 且 candidate 等于本地版本（只查一次上游）', async () => {
  const calls = [];
  const { store, render } = mountPage(recordingApi(calls));
  store.actions.ready(upstreamPayload());
  const opened = await openViaPage(render, store, 'ui-design');
  const verdict = verdictIn(store, 'skillhub:ake:ui-design');
  assert.equal(verdict.candidate, '1.2.4', 'candidate 就是上游第一条');
  assert.equal(verdict.candidate, opened.version, '等于本地版本 ⇒ 渲染层判「已是最新版本」');
  assert.equal(Number.isFinite(verdict.at), true, '记下拿到答案的时刻（副行 HH:MM 用它）');

  // 「重新检查」忽略 10 分钟窗口：刚问过的也能再问一次。
  checkPropOf(render())(opened);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(calls.filter((call) => call.startsWith('marketVersions')).length, 2, '强制重查不看 TTL');
});

test('K118 版本不同 ⇒ candidate 是上游第一条（不做大小比较，clawhub 身份原样透传）', async () => {
  const calls = [];
  const versions = [
    { version: '9.9.9', publishedAt: 1762396800000 },
    { version: '1.2.4', publishedAt: 1761000000000 },
  ];
  const { store, render } = mountPage(recordingApi(calls, undefined, { versions }));
  store.actions.ready(upstreamPayload({ upstream: { sourceId: 'clawhub', owner: 'ake', slug: 'ui-design' } }));
  await openViaPage(render, store, 'ui-design');
  assert.deepEqual(calls, ['skillDetail:ui-design', 'marketVersions:clawhub/ake/ui-design'],
    'clawhub 身份走 clawhub，不折成 skillhub');
  const verdict = verdictIn(store, 'clawhub:ake:ui-design');
  assert.equal(verdict.candidate, '9.9.9', 'candidate = versions[0].version，只比相等不排序');
  assert.equal(verdict.total, 2, 'total 照抄上游条数');
  assert.deepEqual(verdict.versions.map((entry) => entry.version), ['9.9.9', '1.2.4'], '列表原样保留（渲染层算窗口）');
});

test('K118 上游失败：连接类码落 offline，其余落 failed；一行失败只影响自己', async () => {
  const offlineCalls = [];
  const offline = mountPage(recordingApi(offlineCalls, undefined, { versionsFail: true, versionsCode: 'E_SOURCE_UNAVAILABLE' }));
  offline.store.actions.ready(upstreamPayload());
  await openViaPage(offline.render, offline.store, 'ui-design');
  const timedOut = verdictIn(offline.store, 'skillhub:ake:ui-design');
  assert.equal(timedOut.phase, 'offline', 'E_SOURCE_UNAVAILABLE ⇒ offline（「无法连接安装源」）');
  assert.equal(timedOut.reason, 'E_SOURCE_UNAVAILABLE', '原因码留给排查');
  assert.equal(offline.store.getSnapshot().checkRun.status, 'done', '失败也结束这一轮（不会挂着转圈）');

  const failedCalls = [];
  const failed = mountPage(recordingApi(failedCalls, undefined, { versionsFail: true, versionsCode: 'E_BAD_QUERY' }));
  failed.store.actions.ready(upstreamPayload());
  await openViaPage(failed.render, failed.store, 'ui-design');
  assert.equal(verdictIn(failed.store, 'skillhub:ake:ui-design').phase, 'failed', '非连接类码落 failed');
});

test('K118 请求在飞时 busy 为真，且上一次的结论不被抹掉', async () => {
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const api = {
    list: async () => { calls.push('list'); },
    toggle: async () => {},
    toggleProvider: async () => {},
    skillDetail: async () => ({ body: 'text', files: [], filesTruncated: false }),
    marketVersions: async (arg) => {
      calls.push(`marketVersions:${arg?.source}/${arg?.owner}/${arg?.slug}`);
      await gate;
      return { versions: [{ version: '1.2.4', publishedAt: null }], latest: '1.2.4', total: 1 };
    },
  };
  const { store, render } = mountPage(api);
  store.actions.ready(upstreamPayload());
  store.actions.openDetail(upstreamRow(), { body: '正文', files: [], filesTruncated: false });
  // 先放一份上一次的答案，再点「重新检查」：重查期间必须保留它（不闪空）。
  store.actions.checkLanded([{ key: 'skillhub:ake:ui-design', phase: 'ready', candidate: '1.2.4', at: 1000 }]);
  checkPropOf(render())(upstreamRow());
  const running = verdictIn(store, 'skillhub:ake:ui-design');
  assert.equal(running.busy, true, '请求在飞的时候 busy 为真');
  assert.equal(running.candidate, '1.2.4', '结论保留上一次的值');
  assert.deepEqual(calls, ['marketVersions:skillhub/ake/ui-design'], '重查只查这一行的 identity');

  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const landed = verdictIn(store, 'skillhub:ake:ui-design');
  assert.equal(landed.busy, false, '落地后 busy 收起');
  assert.equal(landed.phase, 'ready', '同版本仍是 ready');
});

test('K118 同一 identity 装进两个目录：只发一次请求，结论按各自的 version 算', async () => {
  const calls = [];
  const { store, render } = mountPage(recordingApi(calls));
  const upstream = { sourceId: 'skillhub', owner: 'ake', slug: 'ui-design' };
  const first = row({ name: 'ui-design', partition: 'installed', rule: 'R7', upstream, version: '1.2.4' });
  const second = row({ name: 'ui-design-copy', partition: 'installed', rule: 'R7', upstream, version: '1.0.0' });
  store.actions.ready({
    groups: [{ key: 'installed', skills: [first, second] }],
    counts: { total: 2, disabled: 0, excluded: 0 },
    complete: true,
    diagnostics: [],
    cwd: '/work',
  });
  await openViaPage(render, store, 'ui-design');
  // 详情是整页替换：回到列表才能点到第二个目录。
  store.actions.closeDetail();
  await openViaPage(render, store, 'ui-design-copy');
  assert.deepEqual(calls.filter((call) => call.startsWith('marketVersions')), ['marketVersions:skillhub/ake/ui-design'],
    '两个目录共用一份答案：同 identity 只发一次');
  const verdict = verdictIn(store, 'skillhub:ake:ui-design');
  assert.equal(verdictOf(verdict, '1.2.4'), 'upToDate', '版本一致的那个目录判最新');
  assert.equal(verdictOf(verdict, '1.0.0'), 'available', '版本落后的那个目录判可更新');
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

/* ------------- 插件页 / 两级返回（本轮） ------------- */

test('列表里的内置区是 provider 块，不是行：块上没有开关，也没有 data-skc-row', () => {
  const html = renderPage();
  const builtinGroup = html.slice(html.indexOf('data-skc-group="builtin"'), html.indexOf('data-skc-group="local"'));
  assert.ok(builtinGroup.includes('data-skc-plugin="runtime"'), '内置区渲染成块');
  assert.equal(/data-skc-row=/.test(builtinGroup), false, '块里没有行');
  assert.equal(builtinGroup.includes('role="switch"'), false, '块上没有开关');
  assert.ok(builtinGroup.includes('class="skc_cardTitle skc_cardOpen"'), '块头有一个可点的标题按钮');
});

test('进插件页：整页替换掉列表，只留插件页（面包屑 + provider 头 + 技能行）', () => {
  const html = renderPage({ after: (store) => { store.actions.openPlugin('runtime'); } });
  assert.ok(html.includes('data-skc-plugin-detail="runtime"'), '插件页在场');
  assert.equal(html.includes('data-skc-group='), false, '列表三分区不再渲染');
  assert.equal(/data-skc-plugin=/.test(html), false, '块也不渲染（整页替换）');
  assert.ok(html.includes('data-skc-row="runtime#office"'), '插件页里有技能行');
});

test('技能详情是从插件页进来的时候，退一级回到插件页（不是回列表）', () => {
  const html = renderPage({
    after: (store) => {
      store.actions.openPlugin('runtime');
      store.actions.openDetail(row({ name: 'office', provider: 'runtime', partition: 'builtin', path: null, writable: false, readonlyReason: 'provider-store' }));
      store.actions.detailReady('runtime#office', { body: '正文', files: [], filesTruncated: false });
      store.actions.closeDetail();
    },
  });
  assert.ok(html.includes('data-skc-plugin-detail="runtime"'), '退一级后回到插件页');
  assert.equal(html.includes('data-skc-installed-detail'), false, '技能详情已经关掉');
  assert.equal(html.includes('data-skc-group='), false, '还没回到列表');
});

/* ------------- 块按插件包分组 + 页签复位（本轮） ------------- */

test('内置块的标题是插件包名，data-skc-plugin 仍是 provider id、data-skc-plugin-pkg 是包名', () => {
  const html = renderPage({
    payload: payloadWithOrigins(),
  });
  const block = html.slice(html.indexOf('data-skc-plugin='), html.indexOf('data-skc-group="local"'));
  assert.ok(block.includes('data-skc-plugin="univer"'), 'data-skc-plugin 是 provider id');
  assert.ok(block.includes('data-skc-plugin-pkg="dsh-univer-office"'), 'data-skc-plugin-pkg 是包名');
  assert.ok(/class="skc_cardTitle skc_cardOpen"[^>]*>dsh-univer-office</.test(block), '块标题是包名');
  assert.equal(/class="skc_cardTitle skc_cardOpen"[^>]*>univer</.test(block), false, '标题不再是 provider id');
  assert.ok(/1 \d*个?技能|个技能/.test(block), '副行写着技能数');
});

test('两个包 → 两块，按包名升序（不是 provider 序）', () => {
  const html = renderPage({ payload: payloadWithOrigins() });
  const blocks = [...html.matchAll(/data-skc-plugin-pkg="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(blocks, ['dsh-univer-office', 'zzz-other-pkg'], '包名升序');
});

/* ---------------------------- K119 · 页头四态（D4：一个状态位，宿主 .updatesNote 同形） ---------------------------- */

/** Two market-installed rows: one behind the upstream, one already current. */
function headerPayload() {
  return {
    groups: [{
      key: 'installed',
      skills: [
        upstreamRow({ name: 'behind', version: '1.0.0' }),
        upstreamRow({ name: 'current', version: '1.2.4', upstream: { sourceId: 'clawhub', owner: 'ake', slug: 'ui-design' } }),
      ],
    }],
    counts: { total: 2, disabled: 0, excluded: 0 },
    complete: true,
    diagnostics: [],
    cwd: '/work',
  };
}

/**
 * Render the page over a store that has already run one check round.
 * @param {{verdicts?: object, finish?: boolean, payload?: object}} [setup] - cached answers,
 *   whether the round is over, and the payload to render.
 * @returns {string} markup.
 */
function renderHeader(setup = {}) {
  const store = createStore();
  store.actions.ready(setup.payload ?? headerPayload());
  const entries = Object.entries(setup.verdicts ?? {});
  if (entries.length > 0) {
    store.actions.checkStart(entries.map(([key]) => key));
    store.actions.checkLanded(entries.map(([key, verdict]) => ({ key, ...verdict })));
  }
  if (setup.finish !== false) store.actions.checkFinish();
  const api = { list: async () => {}, toggle: async () => {}, toggleProvider: async () => {} };
  return renderToStaticMarkup(createElement(modules.page.SkillsPage, { store, api, t }));
}

/** The status slot's markup, or null when the note is absent. */
const noteMarkupOf = (html) => /<span class="skc_status"[^>]*>[^<]*<\/span>/.exec(html)?.[0] ?? null;

test('K119 可更新（info）：一个技能落后 ⇒ 「1 个技能可更新」，tone=info', () => {
  const html = renderHeader({
    verdicts: {
      'skillhub:ake:ui-design': { phase: 'ready', candidate: '2.0.0', at: 1000 },
      'clawhub:ake:ui-design': { phase: 'ready', candidate: '1.2.4', at: 1000 },
    },
  });
  const note = noteMarkupOf(html);
  assert.ok(note !== null, '页头出现了更新提示');
  assert.equal(note, `<span class="skc_status" data-tone="info">${t('status.updatesAvailable', { count: 1 })}</span>`,
    '文案与 tone 逐字一致（只有落后的那一行算「可更新」）');
});

test('K119 部分失败（error）：没有可更新但有连不上 ⇒ 部分失败，tone=error', () => {
  const html = renderHeader({
    verdicts: {
      'skillhub:ake:ui-design': { phase: 'offline', at: 1000 },
      'clawhub:ake:ui-design': { phase: 'ready', candidate: '1.2.4', at: 1000 },
    },
  });
  assert.equal(noteMarkupOf(html), `<span class="skc_status" data-tone="error">${t('status.updatesPartial')}</span>`,
    '一行失败就报部分失败');
  const failed = renderHeader({
    verdicts: {
      'skillhub:ake:ui-design': { phase: 'failed', at: 1000 },
      'clawhub:ake:ui-design': { phase: 'ready', candidate: '1.2.4', at: 1000 },
    },
  });
  assert.match(noteMarkupOf(failed) ?? '', /data-tone="error"/, 'failed 与 offline 同等对待');
});

test('K119 全部最新（无色）：没有 data-tone，就是 .skc_status 的 tertiary', () => {
  const html = renderHeader({
    verdicts: {
      // 「behind」那一行装的是 1.0.0，答案也是 1.0.0 ⇒ 它也是最新（判据按各自 row.version）。
      'skillhub:ake:ui-design': { phase: 'ready', candidate: '1.0.0', at: 1000 },
      'clawhub:ake:ui-design': { phase: 'ready', candidate: '1.2.4', at: 1000 },
    },
  });
  assert.equal(noteMarkupOf(html), `<span class="skc_status">${t('status.updatesNone')}</span>`,
    '全最新时不带 tone（不加分隔符、不加图标）');
});

test('K119 skipped 不计入：既不报可更新也不报失败，全最新那句仍可能出口', () => {
  const html = renderHeader({
    verdicts: {
      'skillhub:ake:ui-design': { phase: 'skipped', at: 1000 },
      'clawhub:ake:ui-design': { phase: 'ready', candidate: '1.2.4', at: 1000 },
    },
  });
  assert.equal(noteMarkupOf(html), `<span class="skc_status">${t('status.updatesNone')}</span>`,
    'skipped 由那一行的区块自己说「无法检查更新」，页头不提');
  const onlySkipped = renderHeader({
    verdicts: {
      'skillhub:ake:ui-design': { phase: 'skipped', at: 1000 },
      'clawhub:ake:ui-design': { phase: 'skipped', at: 1000 },
    },
  });
  assert.equal(noteMarkupOf(onlySkipped), null, '全是 skipped ⇒ 一句也不说（不是「全部最新」）');
});

test('K119 未 done 或没有检测对象：状态位不渲染', () => {
  const running = renderHeader({
    finish: false,
    verdicts: { 'skillhub:ake:ui-design': { phase: 'ready', candidate: '2.0.0', at: 1000 } },
  });
  assert.equal(noteMarkupOf(running), null, '一轮没结束就说话是假话');

  const noTargets = renderHeader({ payload: payload() });
  assert.equal(noteMarkupOf(noTargets), null, '没有检测对象 ⇒ 不渲染');

  const noVersion = renderHeader({
    payload: {
      groups: [{ key: 'installed', skills: [upstreamRow({ version: null })] }],
      counts: { total: 1, disabled: 0, excluded: 0 },
      complete: true,
      diagnostics: [],
      cwd: '/work',
    },
    verdicts: { 'skillhub:ake:ui-design': { phase: 'ready', candidate: '2.0.0', at: 1000 } },
  });
  assert.equal(noteMarkupOf(noVersion), null, '只有「有身份但没版本」的行 ⇒ 也不算有检测对象');
});

test('K119 优先级：可更新 > 部分失败 > 全部最新；状态位里只有这一句（K26 的计数已退场）', () => {
  const html = renderHeader({
    verdicts: {
      'skillhub:ake:ui-design': { phase: 'ready', candidate: '2.0.0', at: 1000 },
      'clawhub:ake:ui-design': { phase: 'offline', at: 1000 },
    },
  });
  assert.match(noteMarkupOf(html) ?? '', /data-tone="info"/, '同时有可更新与失败时报「可更新」');
  assert.ok(html.includes(t('status.updatesAvailable', { count: 1 })), '可更新那句在');
  // 宿主页头只有这一句：计数已整句退场，状态位里不许再出现第二种文案。
  assert.equal(html.includes('共 2 个技能'), false, '页头不渲染技能计数');
  assert.equal(html.includes('个已停用'), false, '页头不渲染停用计数');
  assert.equal((html.match(/<span class="skc_status"/g) ?? []).length, 1, '状态位只有一个 span');
});

test('K119 状态位是一个元素：.skc_status 是 12/18 tertiary，tone 直接挂在它身上', async () => {
  const styles = await readFile(join(ROOT, 'src', 'client', 'styles.js'), 'utf8');
  assert.match(styles, /\.skc_status\{[^}]*font-size: 12px; line-height: 18px/, '字阶成对（12/18）');
  assert.match(styles, /\.skc_status\{[^}]*label-tertiary/, '无色态就是宿主 .updatesNote 的 tertiary');
  assert.match(styles, /\.skc_status\[data-tone="info"\]\{[^}]*business-primary/, 'info 用 business-primary');
  assert.match(styles, /\.skc_status\[data-tone="error"\]\{[^}]*error-primary/, 'error 用 error-primary');
  assert.equal(styles.includes('skc_statusNote'), false, '第二个类已退役（一个元素一个类）');
});
