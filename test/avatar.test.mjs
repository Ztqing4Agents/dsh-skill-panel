/**
 * `src/client/avatar.js` — the letter avatar's glyph and tile colour, as a pure function.
 *
 * The module is L1 in the sense of docs/contracts/acceptance.md 附录 D.1: no DOM, no I/O,
 * no clock, no randomness. This file therefore imports the source directly - no build,
 * no browser - and pins the three properties the panel depends on:
 *
 *   1. the palette is a fixed, ordered list of **six** tiles transcribed from
 *      skillhub.cn (accent at 10%, sky at 12%, letter in the accent itself). Reordering
 *      or re-colouring it repaints every skill tile in every install, so the order and
 *      the values are asserted, not just the length. The old "every ink >= 4.5:1" rule
 *      is **retired on purpose** (decisions.md 附录 H): these six sit at ~2-3:1, which is
 *      what the site the user compares us against does;
 *   2. the tile is a function of the *whole* name: not of its first letter, not of the
 *      row's position, not of `Math.random`, not of the clock, not of the theme. The same
 *      skill must be the same colour in the next session and on another machine;
 *   3. the glyph is the first letter or digit of the name, uppercased, `#` when there is
 *      neither. `avatarOf` never throws, whatever it is handed.
 *
 * Contract: docs/contracts/visual.md A.5 / A.9, docs/contracts/client.md §3.6,
 * docs/contracts/decisions.md 附录 H. Cases K22 (row icon, in view-row) and K59 (the
 * palette does not follow the theme) live here as well.
 * Case: K22 (the row's icon) is asserted structurally in test/view-row.test.mjs; this file
 * is the unit layer underneath it.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { ROOT } from './helpers/ssr.mjs';

import { SKC_AVATAR_TONES, avatarOf } from '../src/client/avatar.js';

/**
 * The six tiles, copied value-for-value from skillhub.cn (visual.md A.5, decisions.md 附录 H).
 * Duplicated here on purpose: if someone edits the module, this list disagrees loudly
 * instead of the test agreeing with whatever the module now says.
 */
const PALETTE = [
  { bg: 'rgba(255, 45, 85, .1)', ink: '#FF2D55' },
  { bg: 'rgba(255, 149, 0, .1)', ink: '#FF9500' },
  { bg: 'rgba(90, 200, 250, .12)', ink: '#32ADE6' },
  { bg: 'rgba(175, 82, 222, .1)', ink: '#AF52DE' },
  { bg: 'rgba(52, 199, 89, .1)', ink: '#34C759' },
  { bg: 'rgba(0, 122, 255, .1)', ink: '#007AFF' },
];

/** Index of the pair whose bed and letter are deliberately not the same value. */
const SKY_SLOT = 2;

/** A spread of names covering the shapes the panel can be handed. */
const NAMES = [
  'ui-design',
  'dev-docs-standards',
  'hand-written',
  'office',
  'docx',
  'Docx',
  'agent-a',
  'agent-b',
  'agent-c',
  '1password',
  '技能发现',
  '',
  '   ',
];

/**
 * The tile a name lands on, looked up in the palette.
 * @param {string} name - skill name.
 * @returns {{bg: string, ink: string}} the tile.
 */
const tileOf = (name) => {
  const { bg, ink } = avatarOf(name);
  return { bg, ink };
};

test('色板是固定顺序的六组（skillhub.cn 实测值）：长度、顺序、形状都钉死', () => {
  assert.equal(SKC_AVATAR_TONES.length, 6, '六组色板（站点实测：滚动 25 屏没出现第七组）');
  assert.deepEqual(SKC_AVATAR_TONES, PALETTE, '色板顺序与取值就是那六组，改动会重新给每个技能上色');
  assert.equal(Object.isFrozen(SKC_AVATAR_TONES), true, '色板常量不可被运行期改写');
  for (const tone of PALETTE) {
    assert.deepEqual(Object.keys(tone).sort(), ['bg', 'ink'], '每一组只有 bg / ink 两个键');
    assert.match(tone.bg, /^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, \.(1|12)\)$/, `底色是 accent 的 10%（天空 12%）透明值：${tone.bg}`);
    assert.match(tone.ink, /^#[0-9A-F]{6}$/, `字母色是六位大写十六进制：${tone.ink}`);
  }
  assert.equal(new Set(PALETTE.map((tone) => tone.bg)).size, 6, '六组底色互不相同');
  assert.equal(new Set(PALETTE.map((tone) => tone.ink)).size, 6, '六组字母色互不相同');
});

test('底色是该 accent 的 10%（天空 12%），字母就是那个 accent 的实色——只有天空组例外', () => {
  /** `rgba(r, g, b, a)` -> `{hex, alpha}`. */
  const parse = (bg) => {
    const match = /^rgba\((\d+), (\d+), (\d+), \.(\d+)\)$/.exec(bg);
    assert.notEqual(match, null, `能解析：${bg}`);
    const [, r, g, b, alpha] = match;
    const hex = `#${[r, g, b].map((part) => Number(part).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    return { hex, alpha: Number(`0.${alpha}`) };
  };
  const sameValue = [];
  for (const [index, tone] of PALETTE.entries()) {
    const { hex, alpha } = parse(tone.bg);
    assert.ok(alpha === 0.1 || alpha === 0.12, `第 ${index} 组的透明度是 10% 或 12%（实测 ${alpha}）`);
    if (hex === tone.ink) {
      sameValue.push(index);
      assert.equal(alpha, 0.1, `同值那几组用 10%（第 ${index} 组）`);
    }
  }
  assert.deepEqual(sameValue, [0, 1, 3, 4, 5], '五组底色就是自家 accent 的 10%');
  assert.equal(parse(PALETTE[SKY_SLOT].bg).hex, '#5AC8FA', '天空组底色是 #5AC8FA');
  assert.equal(PALETTE[SKY_SLOT].ink, '#32ADE6', '天空组字母是用深一档的蓝——站点就是这样，照抄');
  assert.equal(parse(PALETTE[SKY_SLOT].bg).alpha, 0.12, '天空组是 12%');
});

test('对比度判据已退役：六组每题都只有约 2–3:1，这是对齐站点换来的（附录 H）', () => {
  /** sRGB 通道 -> 线性光. */
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  /** `#RRGGBB` -> 相对亮度. */
  const luminance = (hex) => 0.2126 * channel(parseInt(hex.slice(1, 3), 16))
    + 0.7152 * channel(parseInt(hex.slice(3, 5), 16))
    + 0.0722 * channel(parseInt(hex.slice(5, 7), 16));
  /** The tile's *composited* bed: accent at 10-12% over white (the light theme's page). */
  const bedOf = (bg) => {
    const match = /^rgba\((\d+), (\d+), (\d+), \.(\d+)\)$/.exec(bg);
    const [, r, g, b, alpha] = match;
    const a = Number(`0.${alpha}`);
    const mix = (part) => Math.round(Number(part) * a + 255 * (1 - a));
    return `#${[r, g, b].map((part) => mix(part).toString(16).padStart(2, '0')).join('')}`;
  };
  const ratio = (tone) => {
    const a = luminance(bedOf(tone.bg));
    const b = luminance(tone.ink);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const values = PALETTE.map(ratio);
  // 实测（合成到白底）：橙 2.02 / 绿 2.04 / 天蓝 2.35 / 红 3.17 / 蓝 3.54 / 紫 3.66。
  const OBSERVED = [3.17, 2.02, 2.35, 3.66, 2.04, 3.54];
  for (const [index, value] of values.entries()) {
    assert.ok(value < 4.5, `第 ${index} 组确实低于旧的 4.5:1 门槛（实测 ${value.toFixed(2)}）——这条判据已被主动放弃`);
    assert.ok(Math.abs(value - OBSERVED[index]) < 0.02, `第 ${index} 组与实测值一致（${value.toFixed(2)}）`);
  }
  // 记录这个世界：橙/绿最吃紧（2.0），紫最好也只有 3.66。若有人把它「修」回 4.5:1，会立刻炸。
  assert.ok(Math.min(...values) <= 2.1, `最紧的一组在 2.0 附近（实测 ${Math.min(...values).toFixed(2)}）`);
  assert.ok(Math.max(...values) <= 3.7, `最好的一组也不到 3.7（实测 ${Math.max(...values).toFixed(2)}）`);
  assert.ok(values.every((value) => value >= 1.8), '没有一组低到看不清轮廓（都 ≥1.8）');
});

test('六组色相互不相同：不是等分轮盘，而是站点那六个 accent', () => {
  /** 色相角. */
  const hueOf = (hex) => {
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    if (delta === 0) return 0;
    let hue;
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    return (hue * 60 + 360) % 360;
  };
  const hues = PALETTE.map((tone) => Math.round(hueOf(tone.ink)));
  assert.equal(new Set(hues).size, 6, `六个 accent 的色相互不相同（${hues.join('/')}）`);
  // 不再要求「30° 等分」：站点这六组不是均分的，蓝与天蓝只差 11°，照抄就是这个形状。
  const sorted = [...hues].sort((a, b) => a - b);
  const gaps = sorted.map((value, index) => (index + 1 === sorted.length ? sorted[0] + 360 - value : sorted[index + 1] - value));
  assert.ok(Math.min(...gaps) >= 8, `相邻最近的两组至少差 8°（实测 ${Math.min(...gaps)}°）`);
});

test('本机五条真实样本的槽位（6 组）：5/5/5/2/2，dev-docs-standards 与 find-skills 仍永久同槽', () => {
  // FNV-1a 差值 60140316 = 12 × 5011693，是 12 的倍数也是 6 的倍数，所以 12 槽与 6 槽两版
  // 色板下这两条都同槽——这不是这批数据碰巧，而是散列差值的性质。
  const expected = [
    ['dev-docs-standards', 5],
    ['find-skills', 5],
    ['dev-expert-pro', 5],
    ['frontend-design', 2],
    ['ui-design', 2],
  ];
  for (const [name, slot] of expected) {
    assert.deepEqual(tileOf(name), { bg: PALETTE[slot].bg, ink: PALETTE[slot].ink }, `${name} 落在第 ${slot} 槽`);
  }
  assert.deepEqual(tileOf('dev-docs-standards'), tileOf('find-skills'), '这两条在任何色板排列下都同槽（Δ = 60140316 = 12 × 5011693）');
  assert.notEqual(avatarOf('dev-docs-standards').letter, avatarOf('find-skills').letter, '同色不同字母，行仍然分得清');
  // 槽位只有 6 个，撞色比 12 槽更常见：本机五条已经挤在 2 个槽里，这是 6 组的必然代价。
  const slots = new Set(expected.map(([, slot]) => slot));
  assert.equal(slots.size, 2, '五个名字只占两槽（6 槽的撞色率是 12 槽的两倍）');
  assert.ok(slots.size < 5, '记录这个事实：六组色板下，本机五个真实技能会看到重复的颜色');
});

test('同名恒同色：一次调用与多次调用给出同一组颜色', () => {
  for (const name of NAMES) {
    assert.deepEqual(avatarOf(name), avatarOf(name), `${JSON.stringify(name)} 两次调用深相等`);
    assert.deepEqual(tileOf(name), tileOf(name), `${JSON.stringify(name)} 的色块不变`);
  }
});

test('返回的颜色一定取自十二组色板，不会出现色板外的颜色', () => {
  for (const name of NAMES) {
    const tile = tileOf(name);
    assert.ok(
      PALETTE.some((tone) => tone.bg === tile.bg && tone.ink === tile.ink),
      `${JSON.stringify(name)} 落在色板内（${tile.bg}/${tile.ink}）`,
    );
  }
});

test('大小写敏感：Docx 与 docx 字母相同，但颜色不同', () => {
  const upper = avatarOf('Docx');
  const lower = avatarOf('docx');
  assert.equal(upper.letter, 'D', '大写名首字母 D');
  assert.equal(lower.letter, 'D', '小写名首字母也渲染为大写 D');
  assert.notDeepEqual(tileOf('Docx'), tileOf('docx'), 'FNV-1a 按原样大小写散列，两者不是同一个技能');
});

test('色不是按首字母分的：同首字母可以拿到不同色，不同首字母可以撞到同色', () => {
  const samePrefix = ['agent-a', 'agent-b', 'agent-c'].map(tileOf);
  assert.equal(new Set(samePrefix.map((tile) => tile.bg)).size, 3, '前缀相同的三条各拿一种色（不是按首字母上色）');
  assert.equal(
    new Set(['find-skills', 'frontend-design'].map((name) => avatarOf(name).letter)).size,
    1,
    '两条都以 F 开头',
  );
  assert.notDeepEqual(tileOf('find-skills'), tileOf('frontend-design'), '首字母相同、颜色不同（散列看整个名字）');
  assert.notEqual(avatarOf('office').letter, avatarOf('agent-b').letter, '这两条的首字母确实不同（O vs A），下一条才有意义');
  assert.deepEqual(tileOf('office'), tileOf('agent-b'), '首字母不同也可以落在同一个色块上');
});

test('字母取名字里第一个字母或数字，并大写', () => {
  assert.equal(avatarOf('ui-design').letter, 'U', '普通 kebab 名取首字母');
  assert.equal(avatarOf('docx').letter, 'D', '小写字母被大写');
  assert.equal(avatarOf('技能发现').letter, '技', '中文名取首字，不做拼音转换');
  assert.equal(avatarOf('1password').letter, '1', '数字开头取数字');
  assert.equal(avatarOf('3-2-1').letter, '3', '纯数字段也取数字');
});

test('标点或空白开头：越过它们取第一个字母数字；只有标点时取标点本身', () => {
  assert.equal(avatarOf(' leading').letter, 'L', '前导空格被跳过');
  assert.equal(avatarOf('-dash-name').letter, 'D', '前导连字符被跳过');
  assert.equal(avatarOf('_private').letter, 'P', '前导下划线被跳过');
  assert.equal(avatarOf('.hidden').letter, 'H', '前导点被跳过');
  assert.equal(avatarOf('#hash').letter, 'H', '前导井号被跳过');
  assert.equal(avatarOf('!!').letter, '!', '只有标点时显示该标点，而不是回落井号');
  assert.equal(avatarOf('###').letter, '#', '全是井号时显示井号');
});

test('空串与非字符串回落井号，且仍然给出色板内的颜色', () => {
  for (const value of ['', '   ', 42, 0, null, undefined, {}, [], true, Symbol('x'), () => {}]) {
    const avatar = avatarOf(value);
    assert.equal(avatar.letter, '#', `${String(value)} 的字母回落为井号`);
    assert.ok(
      PALETTE.some((tone) => tone.bg === avatar.bg && tone.ink === avatar.ink),
      `${String(value)} 的颜色仍取自色板`,
    );
  }
});

test('纯函数：同输入两次调用深相等，且调用方改不到下一次的结果', () => {
  const first = avatarOf('docx');
  const second = avatarOf('docx');
  assert.deepEqual(first, second, '深相等');
  assert.notEqual(first, second, '每次返回独立对象，不是共享的可变状态');
  first.bg = '#000000';
  assert.equal(avatarOf('docx').bg, PALETTE[5].bg, '改动返回值不会污染后续调用');
});

test('没有随机源也没有时钟：抽掉 Math.random / Date.now / performance.now 仍算出同一个头像', () => {
  const realRandom = Math.random;
  const realNow = Date.now;
  const realPerformanceNow = performance.now;
  try {
    Math.random = () => {
      throw new Error('avatarOf 不得使用 Math.random');
    };
    Date.now = () => {
      throw new Error('avatarOf 不得读取时钟');
    };
    performance.now = () => {
      throw new Error('avatarOf 不得读取时钟');
    };
    assert.deepEqual(avatarOf('ui-design'), { letter: 'U', bg: PALETTE[2].bg, ink: PALETTE[2].ink }, '色由名字单独决定');
  } finally {
    Math.random = realRandom;
    Date.now = realNow;
    performance.now = realPerformanceNow;
  }
});

test('两次独立加载模块：同一名字给出同一组颜色（跨会话稳定的代理）', async () => {
  const first = await import('../src/client/avatar.js');
  const second = await import('../src/client/avatar.js?independent-load');
  assert.notEqual(first, second, 'query 串让 node 加载出第二个模块实例');
  for (const name of NAMES) {
    assert.deepEqual(second.avatarOf(name), first.avatarOf(name), `独立加载后 ${JSON.stringify(name)} 颜色不变`);
  }
});

test('色板不随主题变：函数没有主题入口，多传的主题参数被忽略', () => {
  assert.deepEqual(avatarOf('ui-design', 'dark'), avatarOf('ui-design'), '深色主题不改变色块');
  assert.deepEqual(avatarOf('ui-design', { scheme: 'dark' }), avatarOf('ui-design'), '主题对象同样不参与取色');
});

test('字符只取一个码点：中文、数字、标点、代理对都不会被截成半个字', () => {
  for (const name of ['技能发现', '1password', '###', '𐐀abc', '😀party']) {
    const { letter } = avatarOf(name);
    assert.equal([...letter].length, 1, `${JSON.stringify(name)} 的字母是单个码点（${letter}）`);
  }
});

test('K59 六组色板不随主题走：字面量写死在模块里，样式只读两个自定义属性', async () => {
  const moduleText = await readFile(join(ROOT, 'src', 'client', 'avatar.js'), 'utf8');
  const css = await readFile(join(ROOT, 'src', 'client', 'styles.js'), 'utf8');

  // 1) 色板里不许出现任何主题令牌/媒体查询：一旦引用了 --dsw-*，深色下就会变成另一块瓦片。
  const paletteBlock = moduleText.slice(moduleText.indexOf('export const SKC_AVATAR_TONES'), moduleText.indexOf(']);', moduleText.indexOf('export const SKC_AVATAR_TONES')));
  assert.equal(/--dsw-/.test(paletteBlock), false, '色板不引用任何 --dsw-* 令牌');
  assert.equal(/prefers-color-scheme/.test(moduleText), false, '取色不看主题媒体查询');
  assert.equal(/currentColor/.test(paletteBlock), false, '字母色不是 currentColor');
  assert.equal(/var\(/.test(paletteBlock), false, '色板里没有 var() 间接层');
  assert.equal(/getComputedStyle|document\./.test(moduleText), false, '取色不读 DOM / 计算样式');
  for (const tone of PALETTE) {
    assert.ok(paletteBlock.includes(`'${tone.bg}'`) && paletteBlock.includes(`'${tone.ink}'`), `字面量 ${tone.bg} / ${tone.ink} 就在源码里`);
  }

  // 2) 样式侧只通过两个自定义属性接住这两个值：底色走 background，字母走 color。
  const iconRule = css.slice(css.indexOf('.skc_cardIcon{'), css.indexOf('}', css.indexOf('.skc_cardIcon{')) + 1);
  assert.match(iconRule, /background: var\(--skc-avatar-bg, transparent\)/, '底色取自定义属性（缺省透明）');
  assert.match(iconRule, /color: var\(--skc-avatar-ink, var\(--dsw-alias-label-secondary\)\)/, '字母色取自定义属性（缺省次要文字色）');
  assert.equal(/prefers-color-scheme[^{]*\{[^}]*skc_cardIcon/.test(css), false, '没有给 .skc_cardIcon 写深色覆盖');
  assert.equal(/\.skc_cardIcon[^{]*\{[^}]*--skc-avatar-bg:/.test(css), false, '样式表不自己定义这两个属性（只由组件内联写）');

  // 3) 组件传的是同一对值，深浅主题都一模一样（函数没有主题入口）。
  assert.deepEqual(avatarOf('ui-design', 'dark'), avatarOf('ui-design', 'light'), '深色与浅色拿到同一对值');
  assert.equal(SKC_AVATAR_TONES.every((tone) => /^(rgba\(|#)/.test(tone.bg) && tone.ink.startsWith('#')), true, '六组都是可直接写进内联样式的字面量');
});
