/**
 * L3 — the installed row's avatar slot, rendered.
 *
 * Contract: docs/contracts/client.md §3.9.6 (visual unit `icon-tile.jsx`: `tileElement()` +
 * `useIconFailure()`, `MarketIcon` calls the same pair rather than wrapping `IconTile`),
 * visual.md A.5 (the six container facts of `.skc_cardIcon`), AGENTS.md rule 9 (the installed
 * row owns exactly one control); case id K68 (L3).
 *
 * Why this layer exists: the row is the one place where a new picture could quietly become
 * a new click target, or where the tile's box could grow a third pixel of padding and push
 * eleven rows down. Both are asserted as *markup*, and the "no icon" path is asserted
 * against the letter tile the row drew before icons existed.
 *
 * The unit has a third seat since 2026-11-18: a caller can pass `artwork` (the host's
 * `PluginArtworkDefault`) for a seat whose subject is a *package* rather than a name, and
 * then "no icon" and "the icon failed to decode" draw that figure instead of a letter
 * (docs/contracts/client.md §3.9.2 item 7). The letter seat is unchanged — the optional
 * argument defaults to `null`, so every case above still describes the same bytes.
 */
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { injectStyles } from '../src/client/styles.js';
import { ROOT, loadClientModules, zhTranslator } from './helpers/ssr.mjs';
import { mountHooks } from './helpers/hooks.mjs';
import { PluginArtworkDefault } from './helpers/primitives-stub.mjs';

/** Bundled modules under test. */
let modules;
/** Bundled market-card module (for `MarketIcon`). */
let cardModules;
/** The stylesheet text, captured once. */
let css;
/** Chinese translator. */
let t;

before(async () => {
  modules = await loadClientModules(['row', 'iconTile']);
  cardModules = await loadClientModules(['card']);
  css = capturedCss();
  t = await zhTranslator();
});

/**
 * The non-null children of one rendered tile, flattened.
 * @param {{props: {children: unknown}}} node - a rendered element.
 * @returns {unknown[]} the children that actually render.
 */
const kidsOf = (node) => [node.props.children].flat().filter((child) => child !== null && child !== undefined);

/** One installed row. */
function row(overrides = {}) {
  return {
    name: 'ui-design',
    description: 'Comprehensive UI design skill.',
    displayName: null,
    provider: 'filesystem',
    partition: 'installed',
    rule: 'R6',
    confidence: 'high',
    symlink: false,
    path: '/skills/ui-design/SKILL.md',
    realPath: null,
    enabled: true,
    writable: true,
    readonlyReason: null,
    upstream: { sourceId: 'skillhub', owner: 'ake', slug: 'ui-design' },
    ...overrides,
  };
}

/** Render one row. */
const render = (props) => renderToStaticMarkup(createElement(modules.row.SkillRow, { row: row(), t, rows: [], onToggle: () => {}, ...props }));

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

/** The CSS body of one rule, whitespace as written. */
function ruleBody(source, selector) {
  const start = source.indexOf(`${selector}{`);
  assert.notEqual(start, -1, `${selector} 规则存在`);
  return source.slice(start + selector.length + 1, source.indexOf('}', start));
}

test('K68 传 `iconUrl` ⇒ 首帧探测图 + 字母，onLoad 后可见图；始终没有新增可点区域', () => {
  const url = 'api/dsh-skill-panel/market/lucide?name=zap';
  // R8：任何一帧都不空。首帧 = [隐藏探测图, 字母]；探测图加载完成后才是可见图。
  const mounted = mountHooks(modules.iconTile.IconTile, { iconUrl: url, title: 'ui-design' });
  const first = mounted.render();
  const firstKids = kidsOf(first);
  assert.equal(firstKids.length, 2, '首帧两个子节点：探测图 + 字母');
  const [probe, letter] = firstKids;
  assert.equal(probe.type, 'img', '第一个是探测图');
  assert.equal(probe.props.src, url, 'src 就是传进来的地址');
  assert.equal(probe.props.loading, 'eager', '探测图 eager（否则隐藏图永不加载）');
  assert.equal(probe.props.style.display, 'none', '探测图不可见');
  assert.equal(probe.props.className, undefined, '探测图不带可见类');
  assert.equal(letter, 'U', '同帧画字母（这一帧不空）');
  assert.equal(first.props['aria-hidden'], 'true', '瓦片整体 aria-hidden（名字在旁边）');

  probe.props.onLoad();
  const second = mounted.render();
  const secondKids = kidsOf(second);
  assert.equal(secondKids.length, 1, 'onLoad 之后只剩一个子节点');
  const visible = secondKids[0];
  assert.equal(visible.type, 'img', '是图片节点');
  assert.match(visible.props.className, /\bskc_marketIconImg\b/, '可见图用市场刻度里的类');
  assert.equal(visible.props.src, url, '与探测图同 src（所以只发一次请求）');
  assert.equal(visible.props.alt, '', '装饰性图片 alt 为空');

  // 可点区域零新增：整行的交互元素仍是「标题按钮（整行可点层）+ 开关」这两个，瓦片不带任何
  // 可点/可聚焦手段（U1 之前标题是 <span>，所以这里从 1 变 2 —— 手段没变，只是标题成了按钮）
  const html = render({ iconUrl: url });
  assert.equal(/<a\b/.test(html), false, '没有 <a>');
  assert.equal(/<button[^>]*role="switch"|<input[^>]*type="checkbox"|role="switch"/.test(html), true, '开关还在');
  const clickable = html.match(/<(?:button|a|input)\b/g) ?? [];
  assert.equal(clickable.length, 2, `整行只有两个可交互元素：标题按钮 + 开关（实测 ${clickable.length}：${clickable.join(',')}）`);
  assert.equal(/tabindex=/i.test(html), false, '没有 tabindex（瓦片不可聚焦）');
  for (const handler of ['onclick', 'onmousedown', 'onpointerdown', 'onkeydown']) {
    assert.equal(new RegExp(`${handler}=`, 'i').test(html), false, `没有内联 ${handler}`);
  }
  // 探测图本身也不是可点区域（它是 <img alt="">，没有 role/tabindex）
  const ssr = render({ iconUrl: url });
  const imgs = ssr.match(/<img\b[^>]*>/g) ?? [];
  assert.equal(imgs.length, 1, 'SSR 首帧只有那张探测图');
  assert.equal(/role=|tabindex=/i.test(imgs[0]), false, '探测图没有 role/tabindex');
});

test('K68 不传 `iconUrl` ⇒ 与改动前的字母瓦片逐字节相同', () => {
  const implicit = render({});
  const explicit = render({ iconUrl: null });
  const empty = render({ iconUrl: '' });
  assert.equal(implicit, explicit, '省略与显式 null 一致（默认值生效）');
  assert.equal(implicit, empty, '空串也按「没有」处理');
  assert.equal(/<img/.test(implicit), false, '没有 <img>');
  // 与 `IconTile` 的字母输出逐字节一致 ⇒ 行这一层没有自己拼瓦片
  const tile = renderToStaticMarkup(createElement(modules.iconTile.IconTile, { iconUrl: null, title: 'ui-design' }));
  assert.equal(implicit.includes(tile), true, '行里的瓦片就是 IconTile 的字母形态');
  assert.equal(tile.includes('skc_cardIcon'), true, '瓦片类名仍是宿主的 .skc_cardIcon');
  assert.match(tile, /style="--skc-avatar-bg:[^"]+;--skc-avatar-ink:[^"]+"/, '两个自定义属性仍是内联写入');
});

test('K68 `MarketIcon` 与 `IconTile` 对同一 `iconUrl` 输出相同（同一个视觉单元）', () => {
  const url = 'api/dsh-skill-panel/market/lucide?name=zap';
  const item = { id: 'clawhub:awspace:pdf', sourceId: 'clawhub', owner: 'awspace', slug: 'pdf', iconUrl: null };
  const market = { items: [], icons: { 'clawhub:awspace:pdf': url }, iconsTried: {} };
  const fromMarket = renderToStaticMarkup(createElement(cardModules.card.MarketIcon, { item, title: 'pdf', market }));
  const fromTile = renderToStaticMarkup(createElement(modules.iconTile.IconTile, { iconUrl: url, title: 'pdf' }));
  assert.equal(fromMarket, fromTile, '两条入口渲染同一张瓦片，逐字节相同');
});

test('K68 容器零回归：`.skc_cardIcon` 六条容器声明逐字未变，`.skc_marketIconImg` 也没动', () => {
  const icon = ruleBody(css, '.skc_cardIcon');
  // 六条：盒模型、宽、高、边框、圆角、背景裁切（顺序即 A.5 的顺序）
  const facts = icon.split(';').map((part) => part.trim()).filter((part) => part !== '');
  assert.equal(facts[0], 'box-sizing: border-box', '① box-sizing');
  assert.equal(facts.includes('width: 48px'), true, '② width 48px');
  assert.equal(facts.includes('height: 48px'), true, '③ height 48px');
  assert.equal(facts.includes('border: .5px solid var(--dsw-alias-border-l3)'), true, '④ 0.5px 宿主描边');
  assert.equal(facts.includes('border-radius: var(--dsw-radius-lg)'), true, '⑤ radius-lg（16px）');
  assert.equal(facts.includes('background-clip: padding-box'), true, '⑥ padding-box 裁切');
  // 图标位唯一的图片规则也没被顺手改
  const img = ruleBody(css, '.skc_marketIconImg');
  assert.equal(img.split(';').map((part) => part.trim()).filter(Boolean).join('; '), [
    'border-radius: calc(var(--dsw-radius-lg) - .5px)',
    'width: 100%',
    'height: 100%',
    'object-fit: contain',
    'display: block',
  ].join('; '), '.skc_marketIconImg 的五条声明仍是 K56 那五条');
});

test('K68 客户端源码里没有第二条上色/画图路径（视觉单元只有一个）', async () => {
  const rowText = await readFile(join(ROOT, 'src', 'client', 'row.jsx'), 'utf8');
  const cardText = await readFile(join(ROOT, 'src', 'client', 'market-card.jsx'), 'utf8');
  const tileText = await readFile(join(ROOT, 'src', 'client', 'icon-tile.jsx'), 'utf8');
  assert.equal(rowText.includes('IconTile'), true, '行用的是共用单元');
  assert.equal(/avatarOf\(/.test(rowText), false, '行不再自己算首字母/颜色');
  assert.equal(/cardIcon/.test(rowText.split('\n').filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*')).join('\n')), false, '行里没有手写 .skc_cardIcon 类名');
  assert.equal(/tileElement\(|useIconState\(/.test(cardText), true, '市场卡片调同一对函数');
  assert.equal(/useIconFailure/.test(cardText), false, '旧名字已经不存在（改名后不留别名）');
  assert.equal(/IconTile/.test(cardText.replace(/\/\*[\s\S]*?\*\//g, '')), false, '市场卡片不套 IconTile（避免多一层组件）');
  assert.equal(/export function tileElement/.test(tileText) && /export function useIconState/.test(tileText), true, '两个导出都在（tileElement + useIconState）');
  assert.equal(/useIconFailure/.test(tileText), false, '旧名字已经不存在');
});

test('K70 任何一帧都不空：首帧字母、onLoad 只剩可见图、onError 只剩字母', () => {
  const url = 'api/dsh-skill-panel/market/clawhub-icon?hash=' + 'ab'.repeat(32);
  /**
   * Whether one rendered tile shows *something*: a letter, or a visible image.
   * @param {{props: object}} node - rendered tile.
   * @returns {boolean} true when the tile has content this frame.
   */
  const hasContent = (node) => {
    const kids = kidsOf(node);
    const letter = kids.find((child) => typeof child === 'string' && child !== '');
    const visible = kids.find((child) => typeof child === 'object' && child.type === 'img' && /skc_marketIconImg/.test(String(child.props.className)));
    return letter !== undefined || visible !== undefined;
  };

  const mounted = mountHooks(modules.iconTile.IconTile, { iconUrl: url, title: 'dev-god' });

  // 1) 首帧：字母在（探测图不可见），瓦片不空
  const first = mounted.render();
  assert.equal(hasContent(first), true, '首帧不空');
  const [probe, letter] = kidsOf(first);
  assert.equal(letter, 'D', '首帧画的是字母');
  assert.equal(probe.props.style.display, 'none', '同帧的探测图不可见 —— 所以看上去不是空盒子');
  assert.equal(/skc_marketIconImg/.test(String(probe.props.className)), false, '探测图不带可见类');

  // 2) onLoad：只剩可见图，字母消失
  probe.props.onLoad();
  const loaded = mounted.render();
  const loadedKids = kidsOf(loaded);
  assert.equal(hasContent(loaded), true, 'onLoad 之后不空');
  assert.equal(loadedKids.length, 1, '只剩一个子节点');
  assert.equal(loadedKids.some((child) => typeof child === 'string'), false, '字母消失');
  assert.match(String(loadedKids[0].props.className), /skc_marketIconImg/, '剩下的是可见图');

  // 3) 换到另一个 URL 并 404：只剩字母，<img> 消失，仍然不空
  const broken = 'api/dsh-skill-panel/market/lucide?name=nope';
  const probing = mounted.render({ iconUrl: broken, title: 'dev-god' });
  const [probe2, letter2] = kidsOf(probing);
  assert.equal(letter2, 'D', '新 URL 探测期间字母仍在');
  probe2.props.onError();
  const failed = mounted.render();
  const failedKids = kidsOf(failed);
  assert.equal(hasContent(failed), true, '失败之后不空');
  assert.deepEqual(failedKids, ['D'], '只剩字母');
  assert.equal(JSON.stringify(failed).includes('"img"'), false, '没有任何 <img>');

  // 4) 没有 URL：与改动前逐字节相同（只有一个字母，连探测图都没有）
  const bare = renderToStaticMarkup(createElement(modules.iconTile.IconTile, { iconUrl: null, title: 'dev-god' }));
  const empty = renderToStaticMarkup(createElement(modules.iconTile.IconTile, { iconUrl: '', title: 'dev-god' }));
  assert.equal(bare, empty, 'null 与空串等价');
  assert.equal(bare.includes('<img'), false, '没有探测图、没有可见图');
  assert.match(bare, />D</, '只有字母');
  assert.equal(bare, renderToStaticMarkup(createElement(modules.iconTile.IconTile, { title: 'dev-god' })), '省略 iconUrl 也一样（默认 null）');
});

test('K70 探测图与可见图同 src：只发一次请求；容器四条几何逐字未变', () => {
  const url = 'api/dsh-skill-panel/market/lucide?name=brain';
  const mounted = mountHooks(modules.iconTile.IconTile, { iconUrl: url, title: 'shieldcortex' });
  const first = mounted.render();
  const [probe] = kidsOf(first);
  probe.props.onLoad();
  const second = mounted.render();
  const [visible] = kidsOf(second);
  assert.equal(probe.props.src, visible.props.src, '探测图与可见图逐字同 src —— 这就是「只发一次请求」的结构保证');
  assert.equal(probe.props.loading, 'eager', '探测图 eager');
  assert.equal(visible.props.loading, 'lazy', '可见图 lazy');
  assert.equal(probe.props.style.display, 'none', '探测图 display:none');

  // 容器：R5 定下的四条一个字节都没动（K68 的第 4 条用例守六条声明，这里只点名几何）
  const icon = ruleBody(css, '.skc_cardIcon');
  const facts = icon.split(';').map((part) => part.trim()).filter(Boolean);
  assert.equal(facts.includes('width: 48px'), true, '宽 48px');
  assert.equal(facts.includes('height: 48px'), true, '高 48px');
  assert.equal(facts.includes('border-radius: var(--dsw-radius-lg)'), true, '圆角 radius-lg（16px）');
  assert.equal(facts.includes('border: .5px solid var(--dsw-alias-border-l3)'), true, '0.5px 宿主描边');
  assert.equal(facts.includes('background-clip: padding-box'), true, 'padding-box 裁切');
  // 探测图不额外占位：它没有新 class，也没有新规则
  assert.equal(/skc_cardIconProbe|skc_probe/.test(css), false, '样式表里没有为探测图新增类');
});

/* ---------------------------------------------- 插件位（subject 是「包」而不是名字） */

/**
 * The host's default package figure, as a package seat passes it.
 * @returns {import('react').ReactElement} the artwork element.
 */
const artwork = () => createElement(PluginArtworkDefault, { size: 36 });

/** The state a tile renders in once an image has decoded. */
const LOADED = { showIcon: true, probe: null, onLoad: () => {}, onError: () => {} };

test('插件位：没有图标 ⇒ 画宿主默认图形，不画字母、不挂粉彩底', () => {
  const tile = modules.iconTile.tileElement(
    { iconUrl: null, title: 'dsh-univer-office', artwork: artwork() },
    { showIcon: false, probe: null, onLoad: () => {}, onError: () => {} },
  );
  const kids = kidsOf(tile);
  assert.equal(kids.length, 1, '瓦片里只有一个东西：那张默认图形');
  assert.equal(kids[0].type, PluginArtworkDefault, '就是宿主 primitives 的 PluginArtworkDefault（不是本仓仿画）');
  assert.equal(kids[0].props.size, 36, '按宿主的 36 传 size');
  assert.equal(kids.some((child) => typeof child === 'string'), false, '不画字母（包没有名字首字母可言）');
  assert.equal(tile.props.style, undefined, '插件位不写 --skc-avatar-*（宿主那张框是透明底）');
  // 框还是宿主那颗 48，几何一字未改。
  assert.equal(tile.type, 'span', '瓦片仍是 span');
  assert.match(String(tile.props.className), /\bskc_cardIcon\b/, '容器仍是 .skc_cardIcon');
  assert.equal(tile.props['aria-hidden'], 'true', '瓦片整体 aria-hidden');
});

test('插件位：有图标 ⇒ 先探测图 + 字母（瓦片不空），onload 后是 36 的可见图', () => {
  const url = 'data:image/svg+xml;base64,AAA';
  const mounted = mountHooks(modules.iconTile.IconTile, { iconUrl: url, title: 'dsh-univer-office', artwork: artwork() });

  // 1) 首帧：探测图 + 字母。插件位同样「任何一帧都不空」，只是这一帧还留着字母。
  const first = mounted.render();
  const [probe, letter] = kidsOf(first);
  assert.equal(probe.type, 'img', '首帧是隐藏探测图');
  assert.equal(probe.props.src, url, 'src 就是包图标的 data URL');
  assert.equal(probe.props.loading, 'eager', '探测图 eager（否则隐藏图永不加载）');
  assert.equal(probe.props.style.display, 'none', '探测图不可见');
  assert.equal(letter, 'D', '探测期间画字母占位（不回落到默认图形，也不要空盒子）');
  assert.match(String(first.props.style['--skc-avatar-bg']), /./, '这一帧要画字母，所以粉彩底在（否则字母没底色）');

  // 2) onload：只剩一张可见图，带插件位的 36 覆盖类，且不再挂粉彩底。
  probe.props.onLoad();
  const loaded = mounted.render();
  const kids = kidsOf(loaded);
  assert.equal(kids.length, 1, 'onload 之后只剩可见图');
  assert.match(String(kids[0].props.className), /\bskc_marketIconImg\b/, '仍是同一套头像图片规则');
  assert.match(String(kids[0].props.className), /\bskc_pluginIconImg\b/, '插件位再加 36 的覆盖类');
  assert.equal(loaded.props.style, undefined, '显示图片时不写 --skc-avatar-*（透明底，与宿主一致）');
  assert.equal(JSON.stringify(loaded).includes('plugin-default'), false, '显示真图时不再画默认图形');
});

test('插件位：图片 onError ⇒ 与「没有图标」同形（同一张默认图形），且没有 <img> 残留', () => {
  const url = 'data:image/svg+xml;base64,BROKEN';
  const mounted = mountHooks(modules.iconTile.IconTile, { iconUrl: url, title: 'dsh-univer-office', artwork: artwork() });
  const [probe] = kidsOf(mounted.render());
  probe.props.onError();
  const failed = mounted.render();
  const kids = kidsOf(failed);
  assert.equal(kids.length, 1, '失败后只剩默认图形');
  assert.equal(kids[0].type, PluginArtworkDefault, '就是同一张宿主默认图形');
  assert.equal(kids[0].props.size, 36, '尺寸不变（36）');
  assert.equal(failed.props.style, undefined, '失败后同样回落到透明底');
  assert.equal(JSON.stringify(failed).includes('"img"'), false, '没有任何 <img> 残留');
  // 与「一开始就没有图标」逐字节同形：宿主两条路径本来就是同一张图。
  const bare = renderToStaticMarkup(createElement(modules.iconTile.IconTile, {
    iconUrl: null, title: 'dsh-univer-office', artwork: artwork(),
  }));
  assert.equal(renderToStaticMarkup(failed), bare, '失败后的瓦片与「没有图标」那张逐字节相同');
});

test('插件位可选：不传 `artwork` 与传 `null` 逐字节相同，技能位一个字节都没变', () => {
  const omitted = renderToStaticMarkup(createElement(modules.iconTile.IconTile, { iconUrl: null, title: 'ui-design' }));
  const explicit = renderToStaticMarkup(createElement(modules.iconTile.IconTile, { iconUrl: null, title: 'ui-design', artwork: null }));
  assert.equal(omitted, explicit, '默认值 null：省略与显式传 null 一致');
  assert.match(omitted, /style="--skc-avatar-bg:[^"]+;--skc-avatar-ink:[^"]+"/, '技能位照旧写两个粉彩变量');
  assert.match(omitted, />U</, '技能位照旧画字母');
  assert.equal(omitted.includes('plugin-default'), false, '技能位不画默认图形');
});

test('逆行保护：只有插件位那张 <img> 带 `skc_pluginIconImg`，技能位与市场位不带', () => {
  const url = 'api/dsh-skill-panel/market/lucide?name=zap';
  // 插件位：loaded 帧两个类都在。
  const plugin = modules.iconTile.tileElement(
    { iconUrl: url, title: 'dsh-univer-office', artwork: artwork() },
    LOADED,
  );
  assert.equal(kidsOf(plugin)[0].props.className, 'skc_marketIconImg skc_pluginIconImg', '插件位 = 基类 + 36 覆盖类');

  // 技能位（同一单元、不传 artwork）：只有基类，100% 填满。
  const skill = modules.iconTile.tileElement({ iconUrl: url, title: 'ui-design' }, LOADED);
  assert.equal(kidsOf(skill)[0].props.className, 'skc_marketIconImg', '技能位只有基类（仍是 100% 填满内容盒）');
  assert.match(String(skill.props.style['--skc-avatar-bg']), /./, '技能位即使显示图片也照旧带两个变量（逐字不变）');

  // 市场卡走同一个单元：同样只有基类。
  const item = { id: 'clawhub:awspace:pdf', sourceId: 'clawhub', owner: 'awspace', slug: 'pdf', iconUrl: url };
  const market = { items: [], icons: {}, iconsTried: {} };
  const card = renderToStaticMarkup(createElement(cardModules.card.MarketIcon, { item, title: 'pdf', market }));
  assert.equal(card.includes('skc_pluginIconImg'), false, '市场卡的图片不带插件位的 36 覆盖类');
  assert.equal(card.includes('skc_pluginBlockIcon'), false, '市场卡不带插件块的行内刻度类（40/30）');
  assert.equal(card.includes('--skc-avatar-bg'), true, '市场卡照旧挂粉彩底（字母形态用）');
});
