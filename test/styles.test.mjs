/**
 * `src/client/styles.js` — one class-name helper and one stylesheet string.
 *
 * Contract: AGENTS.md hard rule 4 (skc_ prefix, no `--dsw-*` declarations, no host
 * hashed class names) and docs/contracts/visual.md.
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

test('A.5 图标：容器逐字回归宿主，内容层是 17/700 大写首字母', () => {
  const body = ruleBody(capturedCss(), '.skc_cardIcon');
  assert.match(body, /(?:^|;)\s*box-sizing\s*:\s*border-box/, 'box-sizing 必须显式写（无全局 reset，边框会把图标撑成 50×50）');
  assert.match(body, /(?:^|;)\s*width\s*:\s*48px/, '宽 48px');
  assert.match(body, /(?:^|;)\s*height\s*:\s*48px/, '高 48px');
  assert.match(
    body,
    /(?:^|;)\s*border\s*:\s*\.5px\s+solid\s+var\(--dsw-alias-border-l3\)/,
    '边框是宿主原样：.5px solid border-l3（头像不改变图标容器的边框）',
  );
  assert.match(
    body,
    /(?:^|;)\s*border-radius\s*:\s*var\(--dsw-radius-lg\)/,
    '圆角走宿主令牌 radius-lg（不硬编码 px，也不自造圆角）',
  );
  assert.equal(/border-radius\s*:\s*\d/.test(body), false, '圆角里没有硬编码的 px');
  assert.match(
    body,
    /(?:^|;)\s*background\s*:\s*var\(--skc-avatar-bg,\s*transparent\)/,
    '底色取行内变量 --skc-avatar-bg，带 transparent fallback（骨架复用同一个类）',
  );
  assert.match(
    body,
    /(?:^|;)\s*background-clip\s*:\s*padding-box/,
    'background-clip: padding-box —— 宿主的 .5px 边框是半透明的，不裁到 padding box 就会被粉彩底盖掉',
  );
  assert.match(
    body,
    /(?:^|;)\s*color\s*:\s*var\(--skc-avatar-ink,\s*var\(--dsw-alias-label-secondary\)\)/,
    '字母色取行内变量 --skc-avatar-ink，回落到宿主 secondary 色',
  );
  // R5：字号字重按站点 14/40 的比例投到 48px 盒（16.8 → 17）。容器那四条一个字节都没动，
  // 下面单独再把它们锁一遍，防止后人「顺手对齐圆角/尺寸」把宿主容器改坏。
  assert.match(body, /(?:^|;)\s*font-size\s*:\s*17px/, '字母 17px（站点 14/40 投到 48 的等比）');
  assert.match(body, /(?:^|;)\s*font-weight\s*:\s*700/, '字重 700');
  assert.equal(/font-size\s*:\s*(?:26|14)px/.test(body), false, '不是旧的 26px，也不是站点的 14px（盒子不同）');
  assert.equal(/font-family/.test(body), false, '不引入 Outfit 字体依赖，沿用系统字体栈');
  // 用户原话「除了圆角外，其他都对齐」——圆角 16px 与 48×48 的容器是本轮**不动**的部分。
  assert.match(body, /(?:^|;)\s*width\s*:\s*48px\s*;\s*height\s*:\s*48px/, '48×48 一字未动');
  assert.match(body, /(?:^|;)\s*border-radius\s*:\s*var\(--dsw-radius-lg\)/, '圆角仍是宿主 radius-lg（16px），没有跟着站点改成 8px');
  assert.match(body, /(?:^|;)\s*border\s*:\s*\.5px\s+solid\s+var\(--dsw-alias-border-l3\)/, '0.5px 描边仍在');
  assert.match(body, /(?:^|;)\s*background-clip\s*:\s*padding-box/, 'padding-box 裁切仍在（描边不被粉彩盖掉）');
  assert.match(body, /(?:^|;)\s*text-transform\s*:\s*uppercase/, '大写');
  assert.match(body, /(?:^|;)\s*line-height\s*:\s*1(?![\d.])/, '行高 1，字母在 48px 盒里垂直居中');
  assert.match(body, /(?:^|;)\s*display\s*:\s*inline-flex/, '盒模型是 inline-flex');
  assert.match(body, /(?:^|;)\s*justify-content\s*:\s*center/, '水平居中');
  assert.match(body, /(?:^|;)\s*align-items\s*:\s*center/, '垂直居中');
  assert.match(body, /(?:^|;)\s*flex\s*:\s*none/, '不参与伸缩');
});

test('A.5/A.9 48px 是「含边框」的外框：border-box + .5px 边框 + padding-box 底色，三者缺一就变样', () => {
  const body = ruleBody(capturedCss(), '.skc_cardIcon');
  assert.match(body, /(?:^|;)\s*box-sizing\s*:\s*border-box/, 'border-box：48px 含边框，否则 48 + .5×2 会撑成 49');
  assert.match(body, /(?:^|;)\s*border\s*:\s*\.5px\s+solid\b/, '.5px 边框在盒内（宿主原样，不是描边在外的 outline）');
  assert.match(body, /(?:^|;)\s*background-clip\s*:\s*padding-box/, '底色裁到 padding-box：绘画区 47px，半透明边框不被粉彩盖住');
  assert.equal(
    /(?:^|;)\s*border-(?:width|style|color|top|right|bottom|left)\s*:/.test(body),
    false,
    '没有 border-* 长写覆盖 border 简写（简写是唯一真源，否则 .5px / solid / 颜色可以被悄悄改掉）',
  );
  assert.equal(/outline\s*:/.test(body), false, '没有 outline：边框不是画在盒外的');
});

test('A.5 容器逐字回归宿主：宿主那九条声明一条不少、一条没改值', () => {
  // The host rule (EX/dsh-client-ui-plugin-manager, .w6M7KW_cardIcon) has exactly these
  // nine declarations. Ours keeps all of them with the host's own values; the only
  // change is `color`, which becomes the fallback inside `--skc-avatar-ink`.
  const body = ruleBody(capturedCss(), '.skc_cardIcon');
  const host = {
    border: /(?:^|;)\s*border\s*:\s*\.5px\s+solid\s+var\(--dsw-alias-border-l3\)/,
    'border-radius': /(?:^|;)\s*border-radius\s*:\s*var\(--dsw-radius-lg\)/,
    width: /(?:^|;)\s*width\s*:\s*48px/,
    height: /(?:^|;)\s*height\s*:\s*48px/,
    color: /(?:^|;)\s*color\s*:\s*var\(--skc-avatar-ink,\s*var\(--dsw-alias-label-secondary\)\)/,
    flex: /(?:^|;)\s*flex\s*:\s*none/,
    'justify-content': /(?:^|;)\s*justify-content\s*:\s*center/,
    'align-items': /(?:^|;)\s*align-items\s*:\s*center/,
    display: /(?:^|;)\s*display\s*:\s*inline-flex/,
  };
  for (const [property, pattern] of Object.entries(host)) {
    assert.match(body, pattern, `宿主的 ${property} 声明还在、值没变`);
  }
  assert.equal((body.match(/(?:^|;)\s*color\s*:/g) ?? []).length, 1, 'color 只有一条（宿主值作 fallback，不是另起一条覆盖）');
});

test('A.5/A.6 样式表里没有调色板：唯一的颜色字面量是宿主原文的透明边框色', () => {
  const css = capturedCss();
  const literals = [...new Set([...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0].toLowerCase()))];
  assert.deepEqual(literals, ['#0000'], '12 组色板只在 src/client/avatar.js，样式表只有宿主那条 border-color:#0000');
  assert.equal(/#[0-9a-fA-F]{6}\b/.test(css), false, '样式表里没有任何六位 hex 色值');
  assert.equal(/rgb\(|hsl\(/.test(css), false, '也没有 rgb()/hsl() 颜色');
});

test('A.5 头像的两个颜色只由行内变量给，样式表不自己声明 --skc-avatar-*', () => {
  const css = capturedCss();
  assert.equal(/--skc-avatar-[a-z-]+\s*:/.test(css), false, '样式表只 var() 读取，赋值在 row.jsx 的行内 style');
  assert.equal(/--dsw-[a-z0-9-]+\s*:/.test(css), false, '也没有同名 --dsw-* 自造变量（宿主令牌由主题提供）');
  const body = ruleBody(css, '.skc_cardIcon');
  assert.equal(body.includes('--skc-avatar-'), true, '规则体确实用到行内变量');
});

test('A.6 骨架图标自带灰底：排在 .skc_cardIcon 与 .skc_skeletonFill 之后，且不读头像变量', () => {
  const css = capturedCss();
  const body = ruleBody(css, '.skc_skeletonIcon');
  assert.match(body, /(?:^|;)\s*background\s*:\s*var\(--dsw-alias-bg-skeleton\)/, '骨架图标自己的底色是灰的');
  assert.match(body, /(?:^|;)\s*background-clip\s*:\s*padding-box/, '灰底同样裁到 padding box（与头像同一条理由）');
  assert.match(body, /(?:^|;)\s*border-color\s*:\s*#0000/, '宿主原文的 border-color:#0000 仍在（透明度不靠改边框宽度实现）');
  assert.equal(body.includes('--skc-avatar-'), false, '骨架不读头像变量，加载态不会出现彩色块');
  const cardIcon = css.indexOf('.skc_cardIcon{');
  const skeletonFill = css.indexOf('.skc_skeletonFill{');
  const skeletonIcon = css.indexOf('.skc_skeletonIcon{');
  assert.ok(skeletonFill !== -1 && cardIcon !== -1, '两个来源规则都在');
  assert.ok(skeletonIcon > cardIcon, '.skc_skeletonIcon 排在 .skc_cardIcon 之后（同权重下后者胜出）');
  assert.ok(skeletonIcon > skeletonFill, '.skc_skeletonIcon 排在 .skc_skeletonFill 之后（顺序被改动也漏不出粉彩）');
});

test('样式表遵守 reduced-motion 与响应式断点', () => {
  const css = capturedCss();
  assert.ok(css.includes('prefers-reduced-motion'), '有 reduced-motion 分支');
  assert.ok(css.includes('width <= 767px'), '有窄屏断点（容器查询/媒体查询）');
});

test('K110 整行可点的三条刻度：relative 的容器 + inset:0 的点击层 + z-index:1 的动作位', () => {
  const css = capturedCss();
  const card = ruleBody(css, '.skc_card');
  assert.match(card, /position:\s*relative/, '.skc_card 是定位容器（否则 ::after 的 inset:0 没有参照）');
  assert.match(card, /margin:\s*0 -8px/, '「整行」是含负外距的那一层，行可点的范围与它一致');
  assert.match(card, /border-radius:\s*var\(--dsw-radius-xl\)/, '点击层的圆角与行一致');

  const open = ruleBody(css, '.skc_cardOpen');
  assert.match(open, /padding:\s*0/, '按钮原生内边距清零');
  assert.match(open, /border:\s*0/, '按钮原生边框清零');
  assert.match(open, /background:\s*0 0/, '按钮原生底色清零');
  assert.match(open, /cursor:\s*pointer/, '可点就有手型');
  assert.match(open, /text-overflow:\s*ellipsis/, '标题仍单行省略');
  assert.match(open, /white-space:\s*nowrap/, '标题不换行');

  const layer = ruleBody(css, '.skc_cardOpen::after');
  assert.match(layer, /position:\s*absolute/, '点击层是绝对定位');
  assert.match(layer, /inset:\s*0/, '点击层铺满整行（inset: 0）');
  assert.match(layer, /border-radius:\s*var\(--dsw-radius-xl\)/, '点击层的圆角与行一致');
  assert.match(layer, /content:\s*""/, '伪元素有内容才生成');

  const end = ruleBody(css, '.skc_cardEnd');
  assert.match(end, /z-index:\s*1/, '唯一动作位浮在点击层之上');
  assert.match(end, /position:\s*relative/, 'z-index 只对定位元素生效');
});

test('K110 行的 hover 只在真有悬停的设备上，:active 与 :focus-visible 都在', () => {
  const css = capturedCss();
  const hoverMedia = /@media \(hover: hover\)\{\s*\.skc_card:hover\{[^}]*\}\s*\}/.exec(css);
  assert.ok(hoverMedia !== null, 'hover 包在 @media (hover: hover) 里');
  assert.match(hoverMedia[0], /background:\s*var\(--dsw-alias-interactive-bg-hover\)/, 'hover 用的是宿主交互底色令牌');
  const outside = css.replace(hoverMedia[0], '');
  assert.equal(/\.skc_card:hover/.test(outside), false, '媒体查询之外没有第二处 .skc_card:hover');

  const active = ruleBody(css, '.skc_card:active');
  assert.match(active, /background:\s*var\(--dsw-alias-interactive-bg-hover\)/, ':active 是触屏唯一可靠的按下证据');

  assert.ok(css.includes('.skc_cardOpen:focus-visible{'), '键盘焦点先摘掉按钮原生描边');
  const ring = ruleBody(css, '.skc_cardOpen:focus-visible::after');
  assert.match(ring, /outline:\s*var\(--dsw-focus-ring-width\) solid/, '焦点环画在点击层上');
  assert.match(ring, /outline-offset:\s*2px/, '焦点环留 2px 偏移');
});

test('K110 hover / active 只跟着可点的东西走：开关位、只读标记、正文、事实表都没有底色', () => {
  const css = capturedCss();
  // 只列「不许有」的那一批：开关位与只读标记是整行点击层上面的动作位/静态标记，
  // 正文与事实表是详情页的内容，谁都不该有悬停或按下反馈（看着能点、点了没反应）。
  for (const inert of [
    '.skc_bundleToggle', '.skc_roTag', '.skc_detailBody', '.skc_detailCallName', '.skc_marketFacts', '.skc_marketFiles',
  ]) {
    assert.equal(css.includes(`${inert}:hover`), false, `${inert} 没有 hover 底色`);
    assert.equal(css.includes(`${inert}:active`), false, `${inert} 没有按下底色`);
  }
  const actives = [...css.matchAll(/\.(skc_[\w-]+):active/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(actives)], ['skc_card'], ':active 只出现在可点的行上');
});

/**
 * The declaration body of one rule, by selector.
 * @param {string} css - the stylesheet text.
 * @param {string} selector - e.g. `.skc_cardIcon`.
 * @returns {string} the text between `{` and the first `}`.
 */
function ruleBody(css, selector) {
  const start = css.indexOf(`${selector}{`);
  assert.notEqual(start, -1, `样式表里有 ${selector} 的规则`);
  const end = css.indexOf('}', start);
  assert.notEqual(end, -1, `${selector} 的规则体闭合`);
  return css.slice(start + selector.length + 1, end);
}

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
