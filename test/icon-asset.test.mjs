/**
 * `package.json` 的 `icon` 与 `assets/icon.svg` — the artwork the Host puts on this plugin's card.
 *
 * Contract: docs/reference/host-plugin-page.md §7.3（「图标来源」一行：`iconOf()` 只认包内相对路径
 * 的 SVG/PNG/JPEG/WebP、单文件 ≤256 KiB，且把它读成 `data:…;base64,…` 交给 `<img>` 承载
 * ⇒ 图内不能依赖 `currentColor` 或外部样式，必须自着色）。
 *
 * The regression this file exists for: the first icon was a `stroke="currentColor"` outline. Inside
 * an `<img>` document `currentColor` resolves to the initial colour (black, no theme context), so on
 * the dark theme the card showed a black star on a black card — and nothing anywhere failed. These
 * assertions are cheap, run in the unit suite, and fail at the moment someone swaps in another
 * themed outline.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Package root: this file lives one level down, in test/. */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** The ceiling the Host applies to one plugin icon (`iconOf()` in `dsh-app-boot`). */
const MAX_ICON_BYTES = 262144;

/** The image kinds the Host will render (`ICON_MEDIA_TYPES`). */
const RENDERABLE = ['.svg', '.png', '.jpg', '.jpeg', '.webp'];

/**
 * Minimal well-formedness pass: every element that is not self-closing must be closed by the
 * matching tag, in order. Deliberately not an XML validator (no namespaces, no entities, no DTD) —
 * it catches the failure that matters here: a hand-edited file with a forgotten `/>`, which the
 * browser turns into "no icon at all" without a console message.
 * @param {string} svg - the file's text.
 * @returns {string[]} one problem per broken pair.
 */
function tagBalance(svg) {
  const stack = [];
  const problems = [];
  for (const match of svg.matchAll(/<\/?([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g)) {
    const [raw, name, , selfClose] = match;
    if (raw.startsWith('</')) {
      const open = stack.pop();
      if (open !== name) problems.push(`</${name}> 收的不是 <${open ?? '(空)'}>`);
    } else if (selfClose !== '/') stack.push(name);
  }
  if (stack.length > 0) problems.push(`未闭合：${stack.join(', ')}`);
  return problems;
}

/** Every paint an element declares, as written. */
const paints = (svg) => [...svg.matchAll(/\s(fill|stroke)="([^"]*)"/g)].map((match) => match[2].trim());

/** The `url(#id)` targets a file references. */
const gradientRefs = (svg) => [...svg.matchAll(/url\(#([^)\s]+)\)/g)].map((match) => match[1]);

/** The ids a file defines. */
const definedIds = (svg) => new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));

/** One element's attributes as a plain object. */
const attrsOf = (text) => Object.fromEntries([...text.matchAll(/([\w:-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));

/** Every `<rect>` on the file, as attribute objects, in document order. */
const rectsOf = (svg) => [...svg.matchAll(/<rect\b([^>]*?)\/?>/g)].map((match) => attrsOf(match[1]));

/**
 * The viewBox as `{ x, y, width, height }`.
 *
 * The origin is deliberately NOT pinned to `0 0`. Cropping the viewBox to the artwork is how an
 * icon fills the Host's fixed 36px slot without redrawing itself, so `1.45 2.45 21.1 21.1` is a
 * legitimate frame — pinning `0 0` turned an editorial decision into a red gate. What must hold is
 * that the frame exists, has a positive size, and contains the artwork (asserted below).
 */
const VIEWBOX = /viewBox="([-\d.]+)[,\s]+([-\d.]+)[,\s]+([-\d.]+)[,\s]+([-\d.]+)"/;
const viewBoxOf = (svg) => {
  const match = VIEWBOX.exec(svg);
  assert.notEqual(match, null, '图标声明了 viewBox');
  const [x, y, width, height] = match.slice(1).map(Number);
  assert.equal(width > 0 && height > 0, true, `viewBox 的宽高为正（${width} × ${height}）`);
  return { x, y, width, height };
};

test('package.json 的 icon 是包内相对路径，指向一个宿主能渲染的图片，并且随包发布', () => {
  const icon = manifest.icon;
  assert.equal(typeof icon === 'string' && icon.trim() !== '', true, 'package.json 声明了 icon');
  assert.equal(isAbsolute(icon), false, 'icon 不是绝对路径');
  assert.equal(win32.isAbsolute(icon), false, 'icon 不是 Windows 绝对路径');
  assert.equal(/^[A-Za-z]:/.test(icon), false, 'icon 不带盘符');
  assert.equal(icon.split(/[\\/]/).includes('..'), false, 'icon 不靠 .. 跳出包目录');
  assert.equal(existsSync(join(ROOT, icon)), true, `icon 指向的文件存在：${icon}`);
  assert.equal(relative(ROOT, join(ROOT, icon)).startsWith('..'), false, '解析后仍在包内');
  assert.equal(RENDERABLE.some((extension) => icon.toLowerCase().endsWith(extension)), true,
    `icon 是宿主认得的图片类型（${RENDERABLE.join(' / ')}）`);
  // 发布时 `files` 决定哪些路径进 tarball：图标掉出去，装到本机的副本就没有图标。
  const files = manifest.files;
  assert.equal(Array.isArray(files), true, 'package.json 有 files 白名单');
  const shipped = files.some((entry) => icon === entry || icon.startsWith(`${entry}/`));
  assert.equal(shipped, true, `files 覆盖 icon（${icon}）`);
});

test('assets/icon.svg 自着色：不靠 currentColor 或继承式画法，并且真的写了颜色', () => {
  const svg = readFileSync(join(ROOT, manifest.icon), 'utf8');
  // 根因守卫：`<img>` 里的 SVG 没有主题上下文，currentColor 一律解析成默认黑。
  assert.equal(/currentcolor/i.test(svg), false, '图标里不出现 currentColor');
  const declared = paints(svg);
  const inherited = declared.filter((value) => /^(currentcolor|inherit|context-fill|context-stroke)$/i.test(value));
  assert.deepEqual(inherited, [], 'fill/stroke 不出现继承式取值');
  const literals = declared.filter((value) => /^#[0-9A-Fa-f]{3,8}$/.test(value));
  assert.equal(literals.length > 0, true, `至少一处字面颜色（实测 ${literals.length} 处）`);
  // none / url(#…) 是合法的「不画」与「引用渐变」，只排除继承式。
  const allowed = declared.filter((value) => !/^#[0-9A-Fa-f]{3,8}$/.test(value)
    && !/^(none|url\(#[^)]+\))$/.test(value));
  assert.deepEqual(allowed, [], 'fill/stroke 只用字面色、none 或渐变引用');
});

test('assets/icon.svg 结构可解析：根是带 viewBox 的 svg、标签成对、渐变引用都有定义', () => {
  const svg = readFileSync(join(ROOT, manifest.icon), 'utf8');
  assert.equal(/^<svg[\s>]/.test(svg.trimStart()), true, '根元素是 svg');
  const root = /^<svg([^>]*)>/.exec(svg.trimStart())?.[1] ?? '';
  assert.equal(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(root), true, '带 svg 命名空间');
  assert.notEqual(VIEWBOX.exec(root), null, '带 viewBox（宿主按自己的盒子缩放，原点不限）');
  assert.equal(/\swidth="[\d.]+"/.test(root) && /\sheight="[\d.]+"/.test(root), true, '声明了固有宽高');
  assert.deepEqual(tagBalance(svg), [], '标签成对闭合');
  // 断掉的渐变引用不会报错，只会静默画不出颜色——这类问题在真机上表现为「图标少一块」。
  const ids = definedIds(svg);
  const broken = gradientRefs(svg).filter((id) => !ids.has(id));
  assert.deepEqual(broken, [], '每个 url(#id) 都有同名 id 定义');

  // Nothing may fall outside the declared frame. This is the guard for the failure mode a cropped
  // viewBox invites: shift the origin and the artwork silently slides out of the picture, which the
  // browser renders as a clipped icon (and no gate notices, because the file still parses).
  const frame = viewBoxOf(svg);
  for (const [index, rect] of rectsOf(svg).entries()) {
    const insideFrame = Number(rect.x) >= frame.x && Number(rect.y) >= frame.y
      && Number(rect.x) + Number(rect.width) <= frame.x + frame.width
      && Number(rect.y) + Number(rect.height) <= frame.y + frame.height;
    assert.equal(insideFrame, true,
      `第 ${index + 1} 个 rect 落在 viewBox 内（${rect.x},${rect.y} ${rect.width}×${rect.height} vs ${frame.x},${frame.y} ${frame.width}×${frame.height}）`);
  }
});

test('assets/icon.svg 体积在宿主 256 KiB 闸之内，base64 内联后同样放得下', () => {
  const bytes = statSync(join(ROOT, manifest.icon)).size;
  assert.equal(bytes <= MAX_ICON_BYTES, true, `${bytes} B ≤ ${MAX_ICON_BYTES} B`);
  const payload = readFileSync(join(ROOT, manifest.icon)).toString('base64');
  assert.equal(payload.length, 4 * Math.ceil(bytes / 3), 'base64 载荷长度与字节数一致（没有换行或截断）');
  assert.equal(payload.length <= MAX_ICON_BYTES, true, `data URI 载荷 ${payload.length} 字符仍在上限内`);
  assert.equal(`${relative(ROOT, join(ROOT, manifest.icon)).split(sep).join('/')}`.includes('..'), false,
    '图标不落在包外');
});

test('assets/icon.svg 是平涂：没有任何渐变定义或渐变引用，颜色数量有上限', () => {
  const svg = readFileSync(join(ROOT, manifest.icon), 'utf8');
  // 定稿口径是「平涂」：渐变在 36px 上只会糊成一团，且深浅两端对比度不可控。
  assert.equal(/<(linear|radial)Gradient\b/i.test(svg), false, '没有渐变定义');
  assert.equal(/gradientUnits|stop-color/i.test(svg), false, '没有渐变的属性残留');
  assert.deepEqual(gradientRefs(svg), [], '没有 url(#…) 引用');
  const colours = new Set([...svg.matchAll(/#[0-9A-Fa-f]{3,8}/g)].map((match) => match[0].toUpperCase()));
  assert.equal(colours.size <= 4, true, `平涂色数有上限（实测 ${colours.size} 个：${[...colours].join(' ')}）`);
});

test('assets/icon.svg 是「面板」而不是品牌的扇形卡片：一块底片 + 三条圆角横条，且没有旋转叠放', () => {
  const svg = readFileSync(join(ROOT, manifest.icon), 'utf8');
  const frame = viewBoxOf(svg);
  const width = frame.width;
  const height = frame.height;
  const rects = rectsOf(svg);
  assert.equal(rects.length >= 4, true, `至少一块底片 + 三条横条（实测 ${rects.length} 个 rect）`);

  // 底片：几乎铺满 viewBox 的圆角块，自带字面色 —— 图标在深浅两套主题里都自带背景，不靠卡片底色。
  const plate = rects[0];
  assert.equal(/^#[0-9A-Fa-f]{3,8}$/.test(plate.fill ?? ''), true, '底片是字面色');
  assert.equal(Number(plate.width) >= width * 0.8 && Number(plate.height) >= height * 0.8, true,
    `底片铺满 viewBox（${plate.width}×${plate.height} / ${width}×${height}）`);
  assert.equal(Number(plate.rx) > 0, true, '底片是大圆角');

  // 三条横条：矮、圆角、落在底片内部 —— 「面板三行」的手感来自这里。
  const bars = rects.slice(1);
  assert.equal(bars.length >= 3, true, `至少三行（实测 ${bars.length} 行）`);
  for (const [index, bar] of bars.entries()) {
    assert.equal(Number(bar.rx) > 0, true, `第 ${index + 1} 行是圆角条`);
    assert.equal(Number(bar.height) <= height / 6, true, `第 ${index + 1} 行是矮条（${bar.height} ≤ ${height / 6}）`);
    const inside = Number(bar.x) >= Number(plate.x) && Number(bar.y) >= Number(plate.y)
      && Number(bar.x) + Number(bar.width) <= Number(plate.x) + Number(plate.width)
      && Number(bar.y) + Number(bar.height) <= Number(plate.y) + Number(plate.height);
    assert.equal(inside, true, `第 ${index + 1} 行落在底片里`);
  }

  // 品牌那张图是「三张圆角卡片各转一个角度叠放」。出现 rotate 就是把图形也借过来了。
  assert.equal(/rotate\(/.test(svg), false, '没有旋转叠放的卡片（品牌图形签名）');
});

test('assets/icon.svg 的水印是一枚低透明度、只描边、等比缩放的矢量标记', () => {
  const svg = readFileSync(join(ROOT, manifest.icon), 'utf8');
  const group = /<g\b([^>]*)>([\s\S]*?)<\/g>/.exec(svg);
  assert.notEqual(group, null, '图标里有分组元素（水印整组可一次改属性）');
  const groupAttrs = attrsOf(group[1]);
  assert.equal(groupAttrs.fill, 'none', '分组不填充，只描边');
  assert.equal(typeof groupAttrs.stroke === 'string' && groupAttrs.stroke !== 'none', true, '分组声明了描边色');
  const opacity = Number(groupAttrs.opacity);
  assert.equal(opacity > 0 && opacity <= 0.5, true, `分组透明度是水印级（实测 ${groupAttrs.opacity}）`);
  assert.equal(/scale\([\d.]+\)/.test(groupAttrs.transform ?? ''), true,
    '整组等比缩放（几何取自别的坐标系，不是按目标尺寸重画）');

  const paths = [...group[2].matchAll(/<path\b([^>]*?)\/?>/g)].map((match) => attrsOf(match[1]));
  assert.equal(paths.length >= 4, true, `水印由多段弧线组成（实测 ${paths.length} 段）`);
  for (const [index, path] of paths.entries()) {
    // 曲线段而不是折线：从图标表里取来的原生路径长这样，手画的仿制品通常是一串 L。
    assert.equal(/C[\d\s.,-]/.test(path.d ?? ''), true, `第 ${index + 1} 段是三次贝塞尔曲线`);
    assert.equal('stroke' in path || 'fill' in path, false, `第 ${index + 1} 段不自带画法，继承分组`);
  }
});

test('assets/icon.svg 的水印坐在琥珀行右侧的空白处：形心在右下象限、不出底板、不压三行', () => {
  const svg = readFileSync(join(ROOT, manifest.icon), 'utf8');
  const rects = rectsOf(svg);
  const plate = rects[0];
  const group = /<g\b([^>]*)>([\s\S]*?)<\/g>/.exec(svg);
  assert.notEqual(group, null, '图标里有水印分组');
  const groupAttrs = attrsOf(group[1]);
  const moved = /translate\(([-\d.]+) ([-\d.]+)\)\s*scale\(([\d.]+)\)/.exec(groupAttrs.transform ?? '');
  assert.notEqual(moved, null, '分组用 translate(…) scale(…) 定位');
  const [tx, ty, scale] = moved.slice(1).map(Number);
  const half = (Number(groupAttrs['stroke-width']) * scale) / 2;

  // Every pair of numbers in the path data is one coordinate; control points bound the curve, so
  // this box is a conservative superset of the ink — exactly what the placement guards need.
  const numbers = [...group[2].matchAll(/-?\d*\.?\d+/g)].map((match) => Number(match[0]));
  const xs = [];
  const ys = [];
  for (let at = 0; at + 1 < numbers.length; at += 2) {
    xs.push(tx + numbers[at] * scale);
    ys.push(ty + numbers[at + 1] * scale);
  }
  const box = { x0: Math.min(...xs) - half, x1: Math.max(...xs) + half, y0: Math.min(...ys) - half, y1: Math.max(...ys) + half };
  const centreX = (box.x0 + box.x1) / 2;
  const centreY = (box.y0 + box.y1) / 2;
  const plateCentreX = Number(plate.x) + Number(plate.width) / 2;
  const plateCentreY = Number(plate.y) + Number(plate.height) / 2;

  // The product decision is "the watermark sits in the empty space right of the amber row". Pinning
  // the quadrant and the side it hangs on (not a translate number) keeps that decision while leaving
  // the exact offset free to drift.
  assert.equal(centreX > plateCentreX, true, `水印形心在底板竖直中线右侧（${centreX.toFixed(2)} > ${plateCentreX}）`);
  assert.equal(centreY > plateCentreY, true, `水印形心在底板水平中线下方（${centreY.toFixed(2)} > ${plateCentreY}）`);

  const insidePlate = box.x0 >= Number(plate.x) && box.x1 <= Number(plate.x) + Number(plate.width)
    && box.y0 >= Number(plate.y) && box.y1 <= Number(plate.y) + Number(plate.height);
  assert.equal(insidePlate, true, `水印（含描边）落在底板 bbox 内：x ${box.x0.toFixed(2)}..${box.x1.toFixed(2)}, y ${box.y0.toFixed(2)}..${box.y1.toFixed(2)}`);

  for (const [index, bar] of rects.slice(1).entries()) {
    const disjoint = box.y1 < Number(bar.y) || box.y0 > Number(bar.y) + Number(bar.height)
      || box.x1 < Number(bar.x) || box.x0 > Number(bar.x) + Number(bar.width);
    assert.equal(disjoint, true, `水印不压第 ${index + 1} 行`);
  }

  // The last bar is the amber one; the decided position is BESIDE it — to its right and at its
  // height, in the blank the panel leaves there. "To the right" alone would also accept the bare
  // corner, which is the placement that was just rejected, so the shared band matters too.
  const amber = rects[rects.length - 1];
  const amberRight = Number(amber.x) + Number(amber.width);
  assert.equal(box.x0 > amberRight, true, `水印整个在琥珀行右侧（留 ${(box.x0 - amberRight).toFixed(2)} 单位）`);
  const amberTop = Number(amber.y);
  const amberBottom = Number(amber.y) + Number(amber.height);
  const overlap = Math.min(box.y1, amberBottom) - Math.max(box.y0, amberTop);
  assert.equal(overlap > 0, true, `水印与琥珀行同高（纵向重叠 ${overlap.toFixed(2)} 单位），不是另占一个角落`);

  // Same guard as the rects: with a cropped frame, a stale translate would push the mark out of the
  // picture instead of into the wrong corner — both are failures, only one is visible in the file.
  const frame = viewBoxOf(svg);
  const insideFrame = box.x0 >= frame.x && box.y0 >= frame.y
    && box.x1 <= frame.x + frame.width && box.y1 <= frame.y + frame.height;
  assert.equal(insideFrame, true,
    `水印（含描边）落在 viewBox 内：${box.x0.toFixed(2)},${box.y0.toFixed(2)}..${box.x1.toFixed(2)},${box.y1.toFixed(2)} vs ${frame.x},${frame.y} ${frame.width}×${frame.height}`);
});
