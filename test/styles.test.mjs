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

test('A.5 详情图标 49 走修饰类：.skc_cardIcon 仍是 48（列表行不跟着变大）', () => {
  const base = ruleBody(capturedCss(), '.skc_cardIcon');
  assert.match(base, /(?:^|;)\s*width\s*:\s*48px/, '基础类仍是 48 宽');
  assert.match(base, /(?:^|;)\s*height\s*:\s*48px/, '基础类仍是 48 高');
  const detail = ruleBody(capturedCss(), '.skc_detailIcon');
  assert.match(detail, /(?:^|;)\s*width\s*:\s*49px/, '修饰类 49 宽');
  assert.match(detail, /(?:^|;)\s*height\s*:\s*49px/, '修饰类 49 高');
});

test('A.5 插件页组件行按宿主刻度：padding 10 0 / 垂直居中 / 两段 + 发丝线', () => {
  const row = ruleBody(capturedCss(), '.skc_callRow');
  // 行高不写死，三档全由盒模型算出来（与宿主那一行的 74 逐项相等）：
  //   两行描述 74 = 10 + max(41 图标, 20 名称 + 2 + 32 描述) + 10 —— 撑起 74 的是文字块 54；
  //   一行描述的文字块只有 20 + 2 + 16 = 38，空描述只有 20，都矮于 41 图标，
  //   所以这两档都是 10 + 41 + 10 = 61（41 图标托底）。
  assert.match(row, /(?:^|;)\s*padding\s*:\s*10px 0(?!\d)/, '行高由 padding 10 撑起（74 = 10 + 54 + 10）');
  assert.equal(/(?:^|;)\s*height\s*:/.test(row), false, '行高不写死（内容 + 图标托底决定：两行 74 / 一行 61 / 空描述 61 三档）');
  assert.match(row, /(?:^|;)\s*align-items\s*:\s*center/, '垂直居中：图标中线与文字块中线同高（行内状态点已回退，顶对齐随之取消）');
  assert.equal(/(?:^|;)\s*align-items\s*:\s*flex-start/.test(row), false, '顶对齐那版已经不在');
  assert.match(row, /(?:^|;)\s*gap\s*:\s*12px/, '三段之间 gap 12');
  // 行间发丝线：只在第 2 行起（相邻兄弟选择器），最后一行之后天然没有。
  const sep = ruleBody(capturedCss(), '.skc_callRow + .skc_callRow');
  assert.match(sep, /border-top\s*:\s*\.5px\s+solid\s+var\(--dsw-alias-border-l2\)/, '相邻行之间 0.5px 发丝线（与事实表同族 l2）');
  // 三档行高按真实取值算一遍，算式就是刻度本身（改任何一项都会在这里露出来）：
  //   ｜两行描述｜ = 10 + max(41, 20 + 2 + 16×2) + 10 = 74
  //   ｜一行描述｜ = 10 + max(41, 20 + 2 + 16) + 10 = 61（38 矮于 41，图标托底）
  //   ｜空描述　｜ = 10 + max(41, 20) + 10        = 61（同样 41 托底）
  const px = (body, property) => Number(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`).exec(body)?.[1]);
  const pad = px(row, 'padding');
  const bodyGap = px(ruleBody(capturedCss(), '.skc_callBody'), 'gap');
  const nameLh = px(ruleBody(capturedCss(), '.skc_callName'), 'line-height');
  const descLh = px(ruleBody(capturedCss(), '.skc_callDesc'), 'line-height');
  const iconH = px(ruleBody(capturedCss(), '.skc_callIcon'), 'height');
  const rowHeightOf = (descLines) => pad * 2 + Math.max(iconH, nameLh + (descLines === 0 ? 0 : bodyGap + descLh * descLines));
  assert.equal(rowHeightOf(2), 74, `两行描述 74 = 10 + (${nameLh} 名称 + ${bodyGap} + ${descLh * 2} 描述) + 10`);
  assert.equal(rowHeightOf(1), 61, `一行描述 61：文字块 ${nameLh + bodyGap + descLh} 矮于 ${iconH} 图标，41 托底`);
  assert.equal(rowHeightOf(0), 61, `空描述 61：文字块只有 ${nameLh}，同样 41 图标托底`);
  // 行底那行等宽 kebab 已整条删除（.skc_callMeta 在样式表里零出场）。
  assert.equal(capturedCss().includes('.skc_callMeta'), false, '.skc_callMeta 已随行底 kebab 删除');
  // 行内状态：字 13/20 secondary、点 6×6 成功绿、停用时三级文字色（行是只读信息行，状态只在这里说）。
  const state = ruleBody(capturedCss(), '.skc_pluginState');
  assert.match(state, /font-size\s*:\s*13px/, '状态字 13px');
  assert.match(state, /line-height\s*:\s*20px/, '状态字行高 20px');
  assert.match(state, /color\s*:\s*var\(--dsw-alias-label-secondary\)/, '状态字二级文字色');
  assert.match(state, /align-items\s*:\s*center/, '点与字垂直居中');
  assert.match(state, /gap\s*:\s*6px/, '点与字 gap 6');
  const dot = ruleBody(capturedCss(), '.skc_pluginDot');
  assert.match(dot, /width\s*:\s*6px/, '点 6 宽');
  assert.match(dot, /height\s*:\s*6px/, '点 6 高');
  assert.match(dot, /background\s*:\s*var\(--dsw-alias-state-success-primary\)/, '运行中：成功绿');
  assert.match(ruleBody(capturedCss(), '.skc_pluginDotOff'), /background\s*:\s*var\(--dsw-alias-label-tertiary\)/, '已停用：三级文字色');
  // 复制入口与行底 kebab 都删了，命令行那套 flex 布局自然也没有了。
  assert.equal(capturedCss().includes('.skc_callCommand'), false, '.skc_callCommand 已随复制按钮删除');
  // 区块头：标题与计数基线对齐、gap 8（计数紧跟标题，不再贴右缘）。
  const head = ruleBody(capturedCss(), '.skc_sectionHead');
  assert.match(head, /align-items\s*:\s*baseline/, '标题与计数基线对齐');
  assert.match(head, /gap\s*:\s*8px/, '计数紧跟标题（gap 8）');
  assert.equal(/justify-content\s*:\s*space-between/.test(head), false, '不再左右分置');
  // 图标与名字/描述的刻度没变。
  const icon = ruleBody(capturedCss(), '.skc_callIcon');
  assert.match(icon, /width\s*:\s*41px/, '图标 41 宽');
  assert.match(icon, /border-radius\s*:\s*12px/, '图标圆角 12');
  const name = ruleBody(capturedCss(), '.skc_callName');
  assert.match(name, /font-size\s*:\s*13\.5px[^;]*;?/, '名字 13.5px');
  assert.match(name, /line-height\s*:\s*20px/, '名字行高 20px');
  const desc = ruleBody(capturedCss(), '.skc_callDesc');
  assert.match(desc, /font-size\s*:\s*11\.5px/, '描述 11.5px');
  assert.match(desc, /line-height\s*:\s*16px/, '描述行高 16px');
  assert.match(desc, /-webkit-line-clamp\s*:\s*2/, '描述两行裁切');
});

test('A.5 正文盒只有上下两条 .5px 发丝线：左右没有、无圆角（宿主 4% 黑 / 6% 白 的等价物）', () => {
  const body = ruleBody(capturedCss(), '.skc_detailBodyBox');
  const line = (side) => new RegExp(`border-${side}\\s*:\\s*\\.5px\\s+solid\\s+color-mix\\(in srgb, var\\(--dsw-alias-label-primary\\) 5%, transparent\\)`);
  assert.match(body, line('top'), '上有 .5px 发丝线（5% 混色，不是 12% 的 l3）');
  assert.match(body, line('bottom'), '下有 .5px 发丝线');
  assert.equal(/border-(left|right)\s*:/.test(body), false, '左右没有边（宿主也是 0）');
  assert.equal(/border\s*:/.test(body), false, '没有 border 简写把四条一起画上');
  assert.equal(/border-radius\s*:/.test(body), false, '没有圆角（宿主是 0）');
  assert.equal(/background(-color)?\s*:/.test(body), false, '背景保持透明（宿主也是透明）');
  assert.match(body, /max-height\s*:\s*60vh/, '盒高仍是 60vh');
  assert.match(body, /padding\s*:\s*12px 0/, '上下 padding 仍是 12px');
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
    '.skc_bundleToggle', '.skc_roTag', '.skc_detailBody', '.skc_callName', '.skc_marketFacts', '.skc_marketFiles',
    // 详情页的组件式行只有在插件页才可点（走 .skc_callRowOpen）；技能页那一行不可点，不许有反馈。
    '.skc_callRow',
  ]) {
    assert.equal(css.includes(`${inert}:hover`), false, `${inert} 没有 hover 底色`);
    assert.equal(css.includes(`${inert}:active`), false, `${inert} 没有按下底色`);
  }
  const actives = [...css.matchAll(/\.(skc_[\w-]+):active/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(actives)], ['skc_card'], ':active 只出现在列表行上（插件页的行已改成只读信息行，没有按下反馈）');
});

test('K110 插件页的行是只读信息行：没有 .skc_callRowOpen，也没有 hover / active 反馈', () => {
  const css = capturedCss();
  // 整族类名都不该存在（JSX 只挂基类 .skc_callRow），任何残留都意味着「看着能点」。
  assert.equal(css.includes('.skc_callRowOpen'), false, '.skc_callRowOpen 已随只读化删除');
  assert.equal(css.includes('.skc_callRow:hover'), false, '只读行没有 hover 底色');
  assert.equal(css.includes('.skc_callRow:active'), false, '只读行没有按下底色');
  const row = ruleBody(css, '.skc_callRow');
  assert.match(row, /position\s*:\s*relative/, '行仍是定位上下文');
  assert.equal(/background\s*:/.test(row), false, '基类自己不带底色');
});

test('K110 插件页副行两行裁切、技能页描述故意不裁', () => {
  const css = capturedCss();
  const clamp = ruleBody(css, '.skc_pluginDesc');
  assert.match(clamp, /display:\s*-webkit-box/, '副行靠 -webkit-box 才能裁');
  assert.match(clamp, /-webkit-line-clamp:\s*2\b/, '裁到两行');
  assert.match(clamp, /-webkit-box-orient:\s*vertical/, '纵向排列，缺这条裁切不生效');
  assert.match(clamp, /overflow:\s*hidden/, '溢出必须隐藏（只有 clamp 不配 overflow 会露出第三行）');
  const desc = ruleBody(css, '.skc_marketDetailDesc');
  assert.equal(/line-clamp/.test(desc), false, '技能页描述不裁：marketDetailDesc 上不许出现 line-clamp');
  assert.equal(/overflow:\s*hidden/.test(desc), false, 'marketDetailDesc 也不许 overflow:hidden');
});

test('K110 复制按钮类已整块删除：.skc_detailCopyInline 不存在', () => {
  const css = capturedCss();
  assert.equal(css.includes('.skc_detailCopyInline'), false, '.skc_detailCopyInline 已随 CopyName 组件删除');
  assert.ok(css.includes('.skc_progressAnnouncement'), '开关自己的播报位还留着（只是不再有复制那一份）');
});



test('K110 行尾座与两处文字兜底：.skc_cardEnd 58×28、标题可断行、事实表 dd 行高 22', () => {
  const css = capturedCss();
  const end = ruleBody(css, '.skc_cardEnd');
  assert.match(end, /min-width:\s*58px/, '行尾座最小宽 58');
  assert.match(end, /height:\s*28px/, '行尾座高 28（与技能页复制按钮同高）');
  assert.match(end, /justify-content:\s*flex-end/, '行尾靠右对齐');
  const title = ruleBody(css, '.skc_marketDetailTitle');
  assert.match(title, /min-width:\s*0/, '标题允许收缩');
  assert.match(title, /overflow-wrap:\s*anywhere/, '标题可在任意处断行（不加省略号）');
  assert.equal(/text-overflow|line-clamp/.test(title), false, '标题不裁切、不加省略号');
  assert.match(ruleBody(css, '.skc_marketFacts dd'), /line-height:\s*22px/, '事实表取值行高 22（芯片与纯文本同高）');
  // 行盒 22 = 芯片行高 18 + 上下 padding 各 2：改任一项都要同时改另外两项，否则两行又会差 1px。
  const chip = ruleBody(css, '.skc_marketFacts code');
  assert.match(chip, /line-height:\s*18px/, '芯片行高 18');
  assert.match(chip, /padding:\s*2px 6px/, '芯片上下 padding 2');
  assert.match(ruleBody(css, '.skc_marketFacts dd'), /line-height:\s*22px/, '18 + 2 + 2 = 22 才与纯文本行同高');
});

test('K110 滚动条沟槽：.skc_pageBody 预留 stable 沟槽，不用 overflow-y: scroll 那种重做法', () => {
  const css = capturedCss();
  const body = ruleBody(css, '.skc_pageBody');
  assert.match(body, /scrollbar-gutter:\s*stable/, '预留滚动条沟槽（否则有滚动条的页与没滚动条的页宽度会差一个滚动条）');
  // 反向：不许用「常驻滚动条」的做法（观感更重，且会改掉右侧留白）。
  assert.equal(/overflow(-y)?:\s*[^;]*\bscroll\b/.test(css), false, '不得出现 overflow-y: scroll');
  assert.equal(css.includes('overflow-y: scroll'), false, '不得出现 overflow-y: scroll');
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

test('K136 U20 零新增样式：四个已有挂点仍在、类名总数没涨', () => {
  const css = capturedCss();
  // 添加技能与删除技能复用宿主的按钮形状，所以本轮 `styles.js` 应当零字节变化。
  // 「零新增」用两件事一起钉：四个挂点仍各有规则（名称没被改名/删掉），以及**类名总数**
  // 恰好是本轮实测的 134 —— 多数一个，就是有人顺手加了新类。
  // 注：不能要求「每个挂点只出现一次」：`.skc_addPrimary` 本来就有三条规则
  // （基础形状 / 圆角修正 / 页头内的修正），`skc_addMore` 与 `skc_detailDanger` 各两条。
  const counts = (selector) => (css.match(new RegExp(`\\.${selector}(?![A-Za-z0-9_])`, 'g')) ?? []).length;
  const expected = { skc_addGroup: 1, skc_addPrimary: 3, skc_addMore: 2, skc_detailDanger: 2 };
  for (const [selector, want] of Object.entries(expected)) {
    assert.equal(counts(selector), want, `.skc_${selector.slice(5)} 的规则条数是 ${want}（实际 ${counts(selector)}）`);
  }
  const classes = [...new Set([...css.matchAll(/\.(skc_[A-Za-z0-9_]+)/g)].map((match) => match[1]))];
  assert.equal(classes.length, 134, `skc_ 类名总数是 134（实际 ${classes.length}：多一个就说明新增了类）`);
  // 弹窗与确认框用的是市场面那套（skc_marketDialog / skc_marketConfirmBody / skc_detailActions）：
  // 它们已经在表里，U20 只是复用。
  for (const reused of ['.skc_marketDialog', '.skc_marketConfirmBody', '.skc_detailActions']) {
    assert.ok(css.includes(reused), `${reused} 已有规则（复用它，不另造一套）`);
  }
});
