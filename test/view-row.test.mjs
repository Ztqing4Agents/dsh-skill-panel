/**
 * L3 — `src/client/row.jsx` on its own: the switch seat, the read-only marker, the
 * inline reason. Rendering is string-only; interaction is asserted through the
 * props the row hands its controls.
 *
 * Contract: docs/system_design.md 附录 D.3 K22 and §3.5 (no optimistic UI).
 */
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { loadClientModules, zhTranslator } from './helpers/ssr.mjs';

/** Bundled row module. */
let modules;
/** Chinese translator. */
let t;

before(async () => {
  modules = await loadClientModules(['row']);
  t = await zhTranslator();
});

/** One row. */
function row(overrides = {}) {
  return {
    name: 'ui-design',
    description: 'Comprehensive UI design skill.',
    displayName: null,
    provider: 'filesystem',
    partition: 'installed',
    rule: 'R7',
    confidence: 'high',
    symlink: false,
    path: '/skills/ui-design/SKILL.md',
    realPath: null,
    enabled: true,
    writable: true,
    readonlyReason: null,
    ...overrides,
  };
}

/**
 * Render one row.
 * @param {object} target - the row.
 * @param {Map} [rows] - per-row runtime state.
 * @param {Function} [onToggle] - switch handler.
 * @returns {string} markup.
 */
function render(target, rows = new Map(), onToggle = () => {}) {
  return renderToStaticMarkup(createElement(modules.row.SkillRow, { row: target, t, rows, onToggle }));
}

test('K22 行的四个部件齐备：图标、名称、描述、右侧控件', () => {
  const html = render(row());
  assert.ok(html.includes('class="skc_cardIcon"'), '有图标位');
  assert.ok(html.includes('class="skc_cardMain"'), '有中间列');
  assert.ok(html.includes('class="skc_cardTitle">ui-design<'), '有技能名');
  assert.ok(html.includes('Comprehensive UI design skill.'), '有描述');
  assert.ok(html.includes('class="skc_cardEnd"'), '有右侧控件位');
});

test('displayName 只作为 title 出现，不替换显示名', () => {
  const html = render(row({ displayName: 'UI 设计规范' }));
  assert.ok(html.includes('class="skc_cardTitle" title="UI 设计规范">ui-design<'), 'displayName 进 title，显示名仍是机器名');
});

test('可写行的开关：role=switch、aria-checked、aria-label 与 title 成对', () => {
  const html = render(row());
  assert.ok(html.includes('role="switch"'), '有开关');
  assert.ok(html.includes('aria-checked="true"'), '开关反映 enabled');
  assert.ok(html.includes('aria-label="启用 ui-design"'), '无障碍名是「启用 ui-design」');
  assert.ok(html.includes('title="停用 ui-design"'), '启用态下 title 提示「停用」');
});

test('停用行的开关是关闭态，title 提示「启用」', () => {
  const html = render(row({ enabled: false }));
  assert.ok(html.includes('aria-checked="false"'), '开关反映停用');
  assert.ok(html.includes('title="启用 ui-design"'), '停用态下 title 提示「启用」');
});

test('软链行：没有开关，只有只读标记与指向目标的 title', () => {
  const html = render(row({ symlink: true, path: null, realPath: '/Users/me/Skills/ui-design/SKILL.md', writable: false, readonlyReason: 'symlink' }));
  assert.equal(html.includes('role="switch"'), false, '软链行没有开关');
  assert.ok(html.includes('class="skc_roTag"'), '软链行有只读标记');
  assert.ok(html.includes('软链·只读'), '标记文案是「软链·只读」');
  assert.ok(html.includes('指向 /Users/me/Skills/ui-design/SKILL.md'), '标记 title 指出真实路径');
});

test('既不可写也不是软链的行：右侧留空，不放任何控件', () => {
  const html = render(row({ path: null, writable: false, readonlyReason: 'no-file' }));
  assert.equal(html.includes('role="switch"'), false, '没有可写文件的行没有开关');
  assert.equal(html.includes('skc_roTag'), false, '也不是软链，因此没有只读标记');
  assert.equal(html.includes('class="skc_cardEnd"'), false, '右侧整块不渲染');
});

test('写入中：开关禁用、出现进行中指示并播报', () => {
  const target = row();
  const html = render(target, new Map([['filesystem#ui-design', { pending: true, reason: null }]]));
  assert.ok(html.includes('data-skc-state="pending"'), '行状态是 pending');
  assert.ok(html.includes('data-state="ongoing"'), '有进行中指示');
  assert.ok(html.includes('正在应用 ui-design 的更改'), '播报正在应用');
  assert.ok(/role="switch"[^>]*disabled=""/.test(html), '开关被禁用');
});

test('失败：行内原因以 alert 出现，且开关回到可用', () => {
  const target = row();
  const html = render(target, new Map([['filesystem#ui-design', { pending: false, reason: '技能文件位置已变化，请刷新后重试' }]]));
  assert.ok(html.includes('data-skc-state="failed"'), '行状态是 failed');
  assert.ok(html.includes('技能文件位置已变化，请刷新后重试'), '显示本地化原因');
  assert.ok(/<p class="skc_reason" role="alert">/.test(html), '原因是 alert 元素');
  assert.equal(/role="switch"[^>]*disabled=""/.test(html), false, '失败后开关可以再试');
});

test('行带身份数据属性，供测试与样式定位', () => {
  assert.ok(render(row()).includes('data-skc-row="filesystem#ui-design"'), '行上带 provider#name');
  assert.ok(render(row()).includes('data-skc-state="idle"'), '默认状态是 idle');
});

test('内置行渲染开关，而不是只读标记', () => {
  const html = render(row({ partition: 'builtin', provider: 'runtime', path: null, writable: false, readonlyReason: 'provider-store' }));
  assert.ok(html.includes('role="switch"'), '内置行有开关');
  assert.equal(html.includes('skc_roTag'), false, '内置行没有只读标记');
});
