/**
 * L3 — `src/client/skeleton.jsx`: the first frame the panel paints.
 *
 * Contract: docs/contracts/visual.md A.6 / docs/system_design.md 附录 D.3 K24, with one correction: the design
 * says "4 个骨架条" while the host structure it copies is 1 group heading + 4 cards ×
 * 2 bars = 9. The assertions below follow the shipped structure and pin the kinds, so
 * the design's typo cannot silently rewrite the markup.
 */
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { loadClientModules, zhTranslator } from './helpers/ssr.mjs';

/** Bundled skeleton module. */
let modules;
/** Chinese translator. */
let t;

before(async () => {
  modules = await loadClientModules(['skeleton']);
  t = await zhTranslator();
});

/**
 * Render the skeleton.
 * @returns {string} markup.
 */
const render = () => renderToStaticMarkup(createElement(modules.skeleton.ListSkeleton, { label: t('page.loading') }));

/**
 * All matches of one pattern.
 * @param {string} html - markup.
 * @param {RegExp} pattern - pattern with one capture group.
 * @returns {string[]} captured values.
 */
const matches = (html, pattern) => [...html.matchAll(pattern)].map((match) => match[1]);

test('骨架是 status 角色，并用读取文案作为无障碍名', () => {
  const html = render();
  assert.ok(html.includes('role="status"'), '骨架是 status 角色');
  assert.ok(html.includes('aria-label="正在读取技能…"'), '无障碍名是「正在读取技能…」');
  assert.ok(html.includes('data-skc-loading'), '骨架带加载挂点');
});

test('骨架画一条分区标题骨架与四张卡片骨架', () => {
  const html = render();
  assert.equal(matches(html, /class="skc_groupTitle skc_skeletonText skc_skeletonHeading"/g).length, 1, '一条分区标题骨架');
  assert.equal(matches(html, /<li class="skc_card">/g).length, 4, '四张卡片骨架');
  assert.equal(matches(html, /skc_skeletonIcon"/g).length, 4, '四张卡片各有图标骨架');
  assert.equal(matches(html, /skc_skeletonActions"/g).length, 4, '四张卡片各有右侧控件骨架');
  assert.equal(matches(html, /skc_skeletonTitle"/g).length, 4, '四张卡片各有标题骨架');
});

test('骨架条总数是 9（1 + 4×2），且不少于设计要求的 4 条', () => {
  const count = matches(render(), /skc_skeletonBar"/g).length;
  assert.equal(count, 9, '骨架条是 1 条标题 + 4 张卡片各 2 条');
  assert.ok(count >= 4, '不少于设计笔误里写的 4 条');
});

test('装饰部分对读屏隐藏，只有 status 会被播报', () => {
  const html = render();
  assert.equal(matches(html, /aria-hidden="true"/g).length, 2, '分区标题与卡片列表都 aria-hidden');
  assert.equal(matches(html, /role="status"/g).length, 1, '只有外壳是 status');
});
