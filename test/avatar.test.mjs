/**
 * `src/client/avatar.js` — the letter avatar's glyph and tile colour, as a pure function.
 *
 * The module is L1 in the sense of docs/contracts/acceptance.md 附录 D.1: no DOM, no I/O,
 * no clock, no randomness. This file therefore imports the source directly - no build,
 * no browser - and pins the three properties the panel depends on:
 *
 *   1. the palette is a fixed, ordered list of twelve pastel tiles, 30 degrees of hue
 *      apart, every ink >= 4.5:1 on its own tile; reordering or re-colouring it repaints
 *      every skill tile in every install, so the order is asserted, not just the length;
 *   2. the tile is a function of the *whole* name: not of its first letter, not of the
 *      row's position, not of `Math.random`, not of the clock, not of the theme. The same
 *      skill must be the same colour in the next session and on another machine;
 *   3. the glyph is the first letter or digit of the name, uppercased, `#` when there is
 *      neither. `avatarOf` never throws, whatever it is handed.
 *
 * Contract: docs/contracts/visual.md A.5 / A.9, docs/contracts/client.md §3.6.
 * Case: K22 (the row's icon) is asserted structurally in test/view-row.test.mjs; this file
 * is the unit layer underneath it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { SKC_AVATAR_TONES, avatarOf } from '../src/client/avatar.js';

/** The twelve tiles, in palette order: 30 degrees of hue apart, ink >= 4.5:1 on each. */
const PALETTE = [
  { bg: '#FFDEDB', ink: '#BC2015' },
  { bg: '#FFF0DB', ink: '#935A10' },
  { bg: '#FDFFDB', ink: '#6C730D' },
  { bg: '#EBFFDB', ink: '#3C7A0E' },
  { bg: '#DBFFDE', ink: '#0E7C15' },
  { bg: '#DBFFF0', ink: '#0E7A4B' },
  { bg: '#DBFDFF', ink: '#0E757C' },
  { bg: '#DBEBFF', ink: '#1560C1' },
  { bg: '#DEDBFF', ink: '#2719E6' },
  { bg: '#F0DBFF', ink: '#8919DF' },
  { bg: '#FFDBFD', ink: '#AC13A2' },
  { bg: '#FFDBEB', ink: '#B8145B' },
];

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

test('色板是固定顺序的十二组粉彩：长度、顺序、形状都钉死', () => {
  assert.equal(SKC_AVATAR_TONES.length, 12, '十二组色板（色相 30° 等分）');
  assert.deepEqual(SKC_AVATAR_TONES, PALETTE, '色板顺序与取值就是那十二组，改动会重新给每个技能上色');
  assert.equal(Object.isFrozen(SKC_AVATAR_TONES), true, '色板常量不可被运行期改写');
  for (const tone of PALETTE) {
    assert.match(tone.bg, /^#[0-9A-F]{6}$/, `底色是六位大写十六进制：${tone.bg}`);
    assert.match(tone.ink, /^#[0-9A-F]{6}$/, `墨色是六位大写十六进制：${tone.ink}`);
    assert.notEqual(tone.bg.toLowerCase(), tone.ink.toLowerCase(), '字母色必须与底色不同，否则字看不见');
  }
  assert.equal(new Set(PALETTE.map((tone) => tone.bg)).size, 12, '十二组底色互不相同');
});

test('每一组的字母色在自家底色上都过 4.5:1（WCAG 正文门槛）', () => {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex) => 0.2126 * channel(parseInt(hex.slice(1, 3), 16))
    + 0.7152 * channel(parseInt(hex.slice(3, 5), 16))
    + 0.0722 * channel(parseInt(hex.slice(5, 7), 16));
  const ratio = (tone) => {
    const a = luminance(tone.bg);
    const b = luminance(tone.ink);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  for (const tone of PALETTE) {
    const value = ratio(tone);
    assert.ok(value >= 4.5, `${tone.bg} 上的 ${tone.ink} 达到 4.5:1（实测 ${value.toFixed(2)}）`);
  }
  // visual.md A.9 states the range as "4.95–6.62", so the doc and the palette are held
  // together: a re-calibration that moves either end has to move the contract too.
  const values = PALETTE.map(ratio);
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  assert.ok(lowest >= 4.95, `最低那一组不低于 visual.md 写的 4.95（实测 ${lowest.toFixed(3)}）`);
  assert.ok(highest <= 6.625, `最高那一组不超过 visual.md 写的 6.62（实测 ${highest.toFixed(3)}）`);
});

test('十二组底色是 30° 等分的色相（方案 C 的量化槽，容差 ±2°）', () => {
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
  const hues = PALETTE.map((tone) => hueOf(tone.bg)).sort((a, b) => a - b);
  for (let index = 0; index < hues.length; index += 1) {
    const next = index + 1 === hues.length ? hues[0] + 360 : hues[index + 1];
    const gap = next - hues[index];
    assert.ok(gap >= 28 && gap <= 32, `第 ${index} 与第 ${index + 1} 槽相差 ${gap.toFixed(1)}°（30° ±2°，8 位 hex 量化误差内）`);
  }
});

test('本机五条真实样本的槽位：11/11/5/2/8，且 dev-docs-standards 与 find-skills 永久同槽', () => {
  // The FNV-1a difference between those two names is 60140316 = 12 x 5011693, so they
  // share a slot under *any* palette order, not by luck of this one. The letters still
  // differ (D vs F), so the rows stay tellable apart - but the tile colour repeats, and
  // that is a documented consequence of twelve slots, not a bug.
  const expected = [
    ['dev-docs-standards', 11],
    ['find-skills', 11],
    ['dev-expert-pro', 5],
    ['frontend-design', 2],
    ['ui-design', 8],
  ];
  for (const [name, slot] of expected) {
    assert.deepEqual(tileOf(name), { bg: PALETTE[slot].bg, ink: PALETTE[slot].ink }, `${name} 落在第 ${slot} 槽`);
  }
  assert.deepEqual(tileOf('dev-docs-standards'), tileOf('find-skills'), '这两条在任何色板排列下都同槽（Δ = 60140316 = 12 × 5011693）');
  assert.notEqual(avatarOf('dev-docs-standards').letter, avatarOf('find-skills').letter, '同色不同字母，行仍然分得清');
  const slots = new Set(expected.map(([, slot]) => slot));
  assert.equal(slots.size, 4, '五个名字占四槽（11 槽被两条共用）');
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
  assert.equal(avatarOf('docx').bg, '#FFDBEB', '改动返回值不会污染后续调用');
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
    assert.deepEqual(avatarOf('ui-design'), { letter: 'U', bg: '#DEDBFF', ink: '#2719E6' }, '色由名字单独决定');
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
