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

import { createStore } from '../src/client/state.js';
import { loadClientModules, zhTranslator } from './helpers/ssr.mjs';

/** The bundled client modules under test. */
let modules;
/** The Chinese translator. */
let t;

before(async () => {
  modules = await loadClientModules(['page', 'skeleton', 'row', 'toast']);
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
  assert.ok(html.includes('class="skc_cardIcon"'), '行有图标位');
  assert.ok(html.includes('data-icon="skill"'), '图标位里是技能字形');
  assert.ok(html.includes('class="skc_cardTitle">ui-design<'), '行有名称');
  assert.ok(html.includes('class="skc_cardDesc" title="A local skill."'), '行有描述，且 title 也是描述');
  assert.ok(html.includes('class="skc_cardEnd"'), '行有右侧控件位');
  assert.ok(html.includes('class="skc_cardMain"'), '名称与描述在中间列');
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

test('K25 切到市场页签：只渲染占位文案，工具栏隐藏', () => {
  const html = renderPage({ after: (store) => store.actions.setTab('market') });
  assert.ok(html.includes('技能市场将在后续版本提供。'), '市场页签渲染占位文案');
  assert.equal(html.includes('data-skc-group='), false, '市场页签不渲染任何分区');
  assert.ok(/class="skc_toolbar"[^>]*hidden=""/.test(html), '市场页签下工具栏被 hidden');
  assert.ok(html.includes('class="skc_tabPanel"'), '市场页签用自己的面板容器');
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
