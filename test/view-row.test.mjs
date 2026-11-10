/**
 * L3 — `src/client/row.jsx` on its own: the switch seat, the read-only marker, the
 * inline reason. Rendering is string-only; interaction is asserted through the
 * props the row hands its controls.
 *
 * Contract: docs/contracts/acceptance.md 附录 D.3 K22 and docs/contracts/client.md §3.5 (no optimistic UI).
 */
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { avatarOf } from '../src/client/avatar.js';
import { loadClientModules, ROOT, zhTranslator } from './helpers/ssr.mjs';

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
  // 列表行图标仍是 48 的基础类，不能沾详情那支 49 的修饰类（否则行高 64 会被顶开）。
  assert.equal(html.includes('skc_detailIcon'), false, '列表行的图标不带 .skc_detailIcon');
  assert.ok(html.includes('class="skc_cardMain"'), '有中间列');
  assert.ok(html.includes('class="skc_cardTitle skc_cardOpen">ui-design<'), '有技能名（标题同时是整行可点层的按钮）');
  assert.ok(html.includes('Comprehensive UI design skill.'), '有描述');
  assert.ok(html.includes('class="skc_cardEnd"'), '有右侧控件位');
});

test('K22 图标位是首字母头像：一个字母 + 两个色板变量 + aria-hidden', () => {
  const html = render(row({ name: 'docx' }));
  const icon = /<span class="skc_cardIcon" style="([^"]*)" aria-hidden="true">([^<]*)<\/span>/.exec(html);
  assert.ok(icon !== null, '图标位由 skc_cardIcon、行内两个变量、aria-hidden 与字母组成');
  const [, style, letter] = icon;
  const tile = avatarOf('docx');
  assert.equal(style, `--skc-avatar-bg:${tile.bg};--skc-avatar-ink:${tile.ink}`, '色块与字母色是 avatarOf(名字) 的两个值');
  assert.equal(letter, 'D', '字母是名字首字母并大写');
  assert.equal([...letter].length, 1, '只画一个字符，不拼缩写');
  assert.equal(html.includes('<svg'), false, '图标位里不再有宿主字形（图标是纯文字）');
});

test('K22 头像按名字走：换个名字就换字母与色块，中文名取首字', () => {
  const first = /style="([^"]*)" aria-hidden="true">([^<]*)</.exec(render(row({ name: 'agent-a' })));
  const second = /style="([^"]*)" aria-hidden="true">([^<]*)</.exec(render(row({ name: 'agent-b' })));
  const chinese = /style="([^"]*)" aria-hidden="true">([^<]*)</.exec(render(row({ name: '技能发现' })));
  assert.equal(first[2], 'A', '字母跟随名字');
  assert.equal(second[2], 'A', '两个名字都以 A 开头');
  assert.notEqual(second[1], first[1], '首字母相同、色块不同（色取决于整个名字，不是按首字母上色）');
  assert.equal(chinese[2], '技', '中文名取首字');
});

test('K22 displayName 不参与头像：字母与颜色仍由机器名决定', () => {
  const shown = /style="([^"]*)" aria-hidden="true">([^<]*)</.exec(render(row({ name: 'docx', displayName: 'Word 文档' })));
  const bare = /style="([^"]*)" aria-hidden="true">([^<]*)</.exec(render(row({ name: 'docx' })));
  assert.deepEqual([shown[1], shown[2]], [bare[1], bare[2]], 'displayName 只进 title，不进头像');
});

test('displayName 只作为 title 出现，不替换显示名', () => {
  const html = render(row({ displayName: 'UI 设计规范' }));
  assert.ok(html.includes('class="skc_cardTitle skc_cardOpen" title="UI 设计规范">ui-design<'), 'displayName 进 title，显示名仍是机器名');
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

/* ------------------------------------------------------------------ K74 · title */

/**
 * Render one row with an explicit `title` (what `page.jsx` passes from `rowTitleOf`).
 * @param {object} target - the row.
 * @param {string|undefined} title - resolved title; undefined means "caller gave none".
 * @returns {string} markup.
 */
function renderTitled(target, title) {
  const props = { row: target, t, rows: new Map(), onToggle: () => {} };
  if (title !== undefined) props.title = title;
  return renderToStaticMarkup(createElement(modules.row.SkillRow, props));
}

test('K74 传 title：可见文字是上游标题，tooltip 是 kebab 名', () => {
  const html = renderTitled(row({ name: 'dev-expert-pro' }), '编程专家Pro.Skill');
  assert.ok(html.includes('class="skc_cardTitle skc_cardOpen" title="dev-expert-pro">编程专家Pro.Skill<'), '文字换成上游标题，tooltip 保留 kebab 名');
  assert.equal(html.includes('>dev-expert-pro<'), false, 'kebab 名不再是可见文字');
  assert.ok(html.includes('Comprehensive UI design skill.'), '描述不受影响');
  // 标题只是文字：不新增可点区域、不换容器
  assert.equal(/<a\b/.test(html), false, '没有 <a>');
  assert.equal(/tabindex=/i.test(html), false, '没有 tabindex');
  assert.equal((html.match(/role="switch"/g) ?? []).length, 1, '仍然只有一个开关');
});

test('K74 不传 title：输出与改动前逐字节相同（tooltip 仍是本地 displayName）', () => {
  // 改动前的形状：可见文字 = row.name，tooltip = row.displayName ?? 无
  assert.equal(renderTitled(row({ displayName: null }), undefined), render(row({ displayName: null })), '无 displayName 时逐字节相同');
  assert.equal(
    renderTitled(row({ displayName: '本地名' }), undefined),
    render(row({ displayName: '本地名' })),
    '有 displayName 时也逐字节相同（tooltip 是本地名，可见文字仍是 kebab）',
  );
  const withLocal = renderTitled(row({ displayName: '本地名' }), undefined);
  assert.ok(withLocal.includes('class="skc_cardTitle skc_cardOpen" title="本地名">ui-design<'), 'tooltip 是本地 displayName、文字是 kebab 名');
  assert.equal(withLocal.includes('title="ui-design"'), false, '不传 title 时不会把 kebab 名塞进 tooltip');
});

test('K74 长标题仍单行省略：条目标题只占一行，容器样式没被改', async () => {
  const long = '编程专家Pro.Skill 这是一个非常长的上游标题用来确认它不会把行撑高也不会换行显示成两三行';
  const html = renderTitled(row({ name: 'dev-expert-pro' }), long);
  assert.ok(html.includes(`>${long}<`), '整串都在（不截断内容，交给 CSS 省略）');
  // 只渲染一次标题：不会为了省略而拆成两段
  assert.equal((html.match(/class="skc_cardTitle skc_cardOpen"/g) ?? []).length, 1, '标题元素只有一个');
  assert.equal(html.includes('skc_cardTitleLine'), false, '没有为长标题新增元素/类');

  const css = await readFile(join(ROOT, 'src', 'client', 'styles.js'), 'utf8');
  const start = css.indexOf('.skc_cardTitle{');
  assert.notEqual(start, -1, '样式表里有 .skc_cardTitle 规则');
  const rule = css.slice(start, css.indexOf('}', start) + 1);
  assert.match(rule, /white-space:\s*nowrap/, '不换行');
  assert.match(rule, /text-overflow:\s*ellipsis/, '超出显示省略号');
  assert.match(rule, /overflow:\s*hidden/, '超出部分裁掉');
  // 标题规则本身一个字节都没被 R9 动过：换文字不许顺手动字号/行高/内外边距
  assert.match(rule, /font-size:\s*14px/, '字号仍是 14px');
  assert.match(rule, /line-height:\s*20px/, '行高仍是 20px（单行 20px，行高不因标题变长而变）');
  assert.equal(/max-height|min-height|padding|margin|display:\s*(-webkit-)?box/.test(rule), false, '没有多行截断/内边距一类的新声明');
});

/**
 * Render a row and return its markup (alias used by the long-title case).
 * @param {object} target - the row.
 * @param {string} title - resolved title.
 * @returns {string} markup.
 */
const renderTitledRow = (target, title) => renderTitled(target, title);

test('K74 标题里带 HTML 元字符时被转义，不会破坏行结构', () => {
  const html = renderTitledRow(row({ name: 'x' }), '<img src=x onerror=alert(1)> & "quoted"');
  assert.equal(html.includes('<img src=x'), false, '尖括号被转义');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), '按文本转义后原样显示');
  assert.ok(html.includes('&amp;'), '& 被转义');
  assert.equal(/onerror=/.test(html.replace(/&lt;[^&]*&gt;/g, '')), false, '不会变成真的属性');
});

/* ------------------------------------------------- K110 · 行可点与开关互不触发 */

/**
 * Count the interactive elements of one fragment.
 * @param {string} html - markup.
 * @returns {string[]} the opening tags of every button / anchor / input.
 */
function interactivesOf(html) {
  return html.match(/<(?:button|a|input)\b[^>]*>/g) ?? [];
}

test('K110 可写行：标题是整行点击层的按钮，<li> 上没有 onClick / role / tabIndex', async () => {
  const html = renderTitled(row(), 'ui-design');
  // 唯一的手段（AGENTS.md 硬约束 9）：标题按钮的 ::after 铺满整行，开关位靠 z-index 浮起。
  assert.ok(
    html.includes('<button type="button" class="skc_cardTitle skc_cardOpen" title="ui-design">ui-design</button>'),
    '标题是 button + cardTitle + cardOpen，tooltip 是 kebab 调用名',
  );
  const listItem = /<li [^>]*>/.exec(html);
  assert.equal(
    listItem[0],
    '<li class="skc_card" data-skc-row="filesystem#ui-design" data-skc-state="idle">',
    '<li> 上只有类名与两个数据属性——没有 onClick、role 或 tabIndex',
  );
  assert.equal(/<a\b/.test(html), false, '整行没有 <a href>');
  assert.equal(/href=/.test(html), false, '连 href 都没有');

  const interactives = interactivesOf(html);
  assert.equal(interactives.length, 2, `行内可交互元素恰 2 个（实测 ${interactives.length}）`);
  assert.match(interactives[0], /class="skc_cardTitle skc_cardOpen"/, '第一个是标题（整行点击层）');
  assert.match(interactives[1], /role="switch"/, '第二个是开关（唯一动作位）');

  // 互不触发的结构前提：标题按钮里只有文字，开关在它外面，不是它的子节点。
  assert.match(html, /<button type="button" class="skc_cardTitle skc_cardOpen"[^>]*>[^<]*<\/button>/, '标题按钮的子节点只有文字');
  const titleEnd = html.indexOf('</button>', html.indexOf('skc_cardTitle skc_cardOpen'));
  assert.ok(html.indexOf('role="switch"') > titleEnd, '开关在标题按钮闭合之后（不嵌套，点开关不会冒泡进整行点击层）');
});

test('K110 软链行：标题同样是按钮，roTag 是 span 而不是控件', () => {
  const html = renderTitled(
    row({ symlink: true, path: null, realPath: '/Users/me/Skills/ui-design/SKILL.md', writable: false, readonlyReason: 'symlink' }),
    'ui-design',
  );
  assert.ok(
    html.includes('<button type="button" class="skc_cardTitle skc_cardOpen" title="ui-design">ui-design</button>'),
    '软链行的标题也是同一个按钮（行照样可点）',
  );
  assert.ok(html.includes('<span class="skc_roTag"'), '只读标记是 span');
  assert.equal(/<button[^>]*class="skc_roTag"/.test(html), false, 'roTag 不是按钮');
  assert.equal(/role="switch"/.test(html), false, '软链行没有开关');
  const interactives = interactivesOf(html);
  assert.equal(interactives.length, 1, `软链行只有标题一个可交互元素（实测 ${interactives.length}）`);
  assert.match(interactives[0], /class="skc_cardTitle skc_cardOpen"/, '那一个就是标题');
});

test('K110 内置行有 provider 开关、无文件行什么都没有：可交互元素分别是 2 与 1', () => {
  const builtin = renderTitled(row({ partition: 'builtin', provider: 'runtime', path: null, writable: false, readonlyReason: 'provider-store' }), 'ui-design');
  assert.equal(interactivesOf(builtin).length, 2, '内置行 = 标题 + provider 开关（routes.md §3.4.1 那张表）');
  assert.equal(/role="switch"/.test(builtin), true, '内置行的开关确实在');

  const noFile = renderTitled(row({ path: null, writable: false, readonlyReason: 'no-file' }), 'ui-design');
  assert.equal(interactivesOf(noFile).length, 1, '无文件行只剩标题（右侧整块不渲染）');
  assert.equal(noFile.includes('class="skc_cardEnd"'), false, '右侧不留空壳');
});

test('K110 每个可点单元恰好一个 onClick：行一个（标题按钮）、块一个（标题按钮），都不许拦冒泡', async () => {
  const source = await readFile(join(ROOT, 'src', 'client', 'row.jsx'), 'utf8');
  assert.equal(source.includes('stopPropagation'), false, 'row.jsx 没有 stopPropagation');
  // 一个文件里有行与块两个可点单元，所以 onClick 恰好两个，且都在标题按钮上——
  // 不是「随便几个都行」：多一个就说明又长出了第二套点击层（或用 onClick 拦冒泡）。
  const clicks = source.match(/onClick=/g) ?? [];
  assert.equal(clicks.length, 2, `row.jsx 里恰好两个 onClick（实测 ${clicks.length}）`);
  assert.match(source, /onClick=\{\(\) => onOpen\?\.\(row\)\}/, '行的那个是标题按钮的 onOpen(row)');
  assert.match(source, /onClick=\{\(\) => onOpen\?\.\(block\.provider\)\}/, '块的那个是标题按钮的 onOpen(block.provider)');
  assert.equal(/<li[^>]*onClick/.test(source), false, '<li> 上没有 onClick（行/块本身不是可点元素）');
});
