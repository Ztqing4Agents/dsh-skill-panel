/**
 * `src/client/header-scroll.js` — the pure half of the docking header.
 *
 * Contract: docs/contracts/data-model.md §3.2.5 (`interpolateParts`). The measured layout,
 * the clone, and `ResizeObserver` need a real browser, so only the interpolation is
 * asserted here; "the list's scroll range does not change" stays on the real-machine
 * checklist.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { interpolateParts } from '../src/client/header-scroll.js';

/** One part that slides from y=0 to y=-40 over 40px of scroll. */
const sliding = {
  from: { x: 0, y: 0, width: 200 },
  to: { x: 10, y: -40, width: 100 },
  distance: 40,
};

/** One part that is clipped away between 10 and 30. */
const clipping = {
  from: { x: 0, y: 20, width: 120 },
  to: { x: 0, y: -12, width: 120 },
  distance: 32,
  clipStart: 10,
  clipEnd: 30,
};

test('滚动为 0 时每个部件都在静止位置', () => {
  const [frame] = interpolateParts([sliding], 0);
  assert.equal(frame.translate, '0px 0px', '静止时位移为 0');
  assert.equal(frame.width, '200px', '静止时宽度是静止宽度');
  assert.equal(frame.clipPath, null, '没有裁剪时 clipPath 为 null');
  assert.equal(frame.inert, false, '静止时部件可交互');
});

test('滚动到一半时按比例插值', () => {
  const [frame] = interpolateParts([sliding], 20);
  assert.equal(frame.translate, '5px -20px', '位移插到一半');
  assert.equal(frame.width, '150px', '宽度插到一半');
});

test('滚动超过距离后停在紧凑态，不会越界', () => {
  const [frame] = interpolateParts([sliding], 400);
  assert.equal(frame.translate, '10px -40px', '位移停在紧凑位置');
  assert.equal(frame.width, '100px', '宽度停在紧凑宽度');
});

test('负偏移（橡皮筋回弹）被夹到 0', () => {
  const [frame] = interpolateParts([sliding], -50);
  assert.equal(frame.translate, '0px 0px', '负偏移不会把部件推过静止位置');
  assert.equal(interpolateParts([sliding], Number.NaN)[0].translate, '0px 0px', 'NaN 偏移等同 0');
});

test('带裁剪区间的部件按区间给出 clip-path 与 inert', () => {
  const at15 = interpolateParts([clipping], 15)[0];
  assert.equal(at15.clipPath, 'inset(25% 0 0)', '区间内按比例裁剪');
  assert.equal(at15.inert, false, '未走完区间时仍可交互');
  const at30 = interpolateParts([clipping], 30)[0];
  assert.equal(at30.clipPath, 'inset(100% 0 0)', '走完区间后完全裁掉');
  assert.equal(at30.inert, true, '完全裁掉的部件不再可交互');
  const at5 = interpolateParts([clipping], 5)[0];
  assert.equal(at5.clipPath, 'inset(0% 0 0)', '区间之前不裁剪');
});

test('distance 为 0 时不会除零（按 1 处理）', () => {
  const [frame] = interpolateParts([{ ...sliding, distance: 0 }], 10);
  assert.equal(frame.translate, '10px -40px', '距离 0 时直接给紧凑位置，不产生 NaN');
});

test('多个部件按输入顺序一一对应', () => {
  const frames = interpolateParts([sliding, clipping], 15);
  assert.equal(frames.length, 2, '每个部件一帧');
  assert.equal(frames[0].width, '162.5px', '第一帧按自己的几何插值');
  assert.equal(frames[1].clipPath, 'inset(25% 0 0)', '第二帧按自己的裁剪区间');
});

test('没有父元素时 attachHeader 返回可调用的空 disposer（量测只在浏览器里发生）', async () => {
  const { attachHeader } = await import('../src/client/header-scroll.js');
  const dispose = attachHeader({ parentElement: null });
  assert.equal(typeof dispose, 'function', 'attachHeader 返回清理函数');
  assert.equal(dispose(), undefined, '清理函数可安全调用');
});
