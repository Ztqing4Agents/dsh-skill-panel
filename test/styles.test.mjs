/**
 * `src/client/styles.js` — one class-name helper and one stylesheet string.
 *
 * Contract: AGENTS.md hard rule 4 (skc_ prefix, no `--dsw-*` declarations, no host
 * hashed class names) and docs/system_design.md 附录 A.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { cn, injectStyles } from '../src/client/styles.js';
// The stylesheet itself is not exported as text; it is asserted through the DOM hook
// and through the class names the components ask for, which is what the gate cares
// about.
import * as styles from '../src/client/styles.js';

test('cn 给每个名字加 skc_ 前缀，不泄漏宿主类名', () => {
  assert.equal(cn('page'), 'skc_page', '单个名字加前缀');
  assert.equal(cn('card', 'cardHead'), 'skc_card skc_cardHead', '多个名字逐个加前缀');
  assert.equal(cn(''), 'skc_', '空名字也会带前缀（不是宿主类名）');
});

test('styles.js 只导出 cn 与 injectStyles 两个口子', () => {
  assert.deepEqual(Object.keys(styles).sort(), ['cn', 'injectStyles'], '导出面就是这两个函数');
});

test('没有 DOM 时 injectStyles 静默返回（SSR 可渲染）', () => {
  assert.equal(typeof document, 'undefined', 'node 里没有 document');
  assert.equal(injectStyles(), undefined, 'injectStyles 在无 document 时不抛错');
});

test('有 DOM 时注入一个带 data-plugin-css 钩子的 style 标签，且不重复注入', () => {
  const appended = [];
  const created = [];
  globalThis.document = {
    querySelector: (selector) => created.find((tag) => selector.includes(tag.dataset.pluginCss)) ?? null,
    createElement: () => {
      const tag = { dataset: {}, textContent: '' };
      created.push(tag);
      return tag;
    },
    head: { appendChild: (tag) => appended.push(tag) },
  };
  try {
    injectStyles();
    injectStyles();
    assert.equal(appended.length, 1, '同一文档只注入一次样式表');
    assert.equal(appended[0].dataset.pluginCss, 'dsh-skill-center/client.css', '样式钩子是插件自己的样式表 id');
    assert.ok(appended[0].textContent.includes('.skc_page'), '样式表里含有页面骨架规则');
  } finally {
    delete globalThis.document;
  }
});

test('样式表里没有同名 --dsw-* 变量声明，只用宿主令牌', () => {
  const css = capturedCss();
  assert.equal(/--dsw-[a-z-]+\s*:/.test(css), false, '没有声明任何 --dsw-* 变量');
  assert.ok(css.includes('var(--dsw-alias-label-primary)'), '页面颜色取自宿主令牌');
});

test('样式表只用 skc_ 前缀的类名，不出现宿主构建哈希类名', () => {
  const css = capturedCss();
  const classes = [...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1]);
  const stray = classes.filter((name) => !name.startsWith('skc_'));
  assert.deepEqual(stray, [], '所有类选择器都以 skc_ 开头');
});

test('样式表覆盖设计里点名的每一个挂点类', () => {
  const css = capturedCss();
  for (const selector of [
    '.skc_page', '.skc_pageBody', '.skc_pageBar', '.skc_pageHead', '.skc_pageTitle',
    '.skc_group', '.skc_groupHead', '.skc_groupTitle', '.skc_cards', '.skc_card',
    '.skc_cardIcon', '.skc_cardTitle', '.skc_cardDesc', '.skc_cardEnd',
    '.skc_bundleToggle', '.skc_toggleProgress', '.skc_roTag',
    '.skc_skeletonBar', '.skc_skeletonFill', '.skc_empty', '.skc_failure',
    '.skc_status', '.skc_reason', '.skc_footer', '.skc_addGroup', '.skc_addPrimary', '.skc_addMore',
  ]) {
    assert.ok(css.includes(`${selector}{`) || css.includes(`${selector} `) || css.includes(selector), `样式表里有 ${selector} 的规则`);
  }
});

test('样式表遵守 reduced-motion 与响应式断点', () => {
  const css = capturedCss();
  assert.ok(css.includes('prefers-reduced-motion'), '有 reduced-motion 分支');
  assert.ok(css.includes('width <= 767px'), '有窄屏断点（容器查询/媒体查询）');
});

/**
 * Capture the stylesheet text by letting `injectStyles` write into a fake document.
 * @returns {string} the CSS text.
 */
function capturedCss() {
  let captured = '';
  globalThis.document = {
    querySelector: () => null,
    createElement: () => ({
      dataset: {},
      set textContent(value) {
        captured = value;
      },
      get textContent() {
        return captured;
      },
    }),
    head: { appendChild: () => {} },
  };
  try {
    injectStyles();
  } finally {
    delete globalThis.document;
  }
  return captured;
}
