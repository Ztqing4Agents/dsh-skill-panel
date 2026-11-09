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
 */
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { injectStyles } from '../src/client/styles.js';
import { ROOT, loadClientModules, zhTranslator } from './helpers/ssr.mjs';

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

test('K68 传 `iconUrl` ⇒ 盒内有 `<img class="skc_marketIconImg">`，且没有新增可点区域', () => {
  const html = render({ iconUrl: 'api/dsh-skill-center/market/lucide?name=zap' });
  assert.equal(/<img[^>]*class="[^"]*skc_marketIconImg/.test(html), true, '盒里画的是图');
  assert.equal(html.includes('src="api/dsh-skill-center/market/lucide?name=zap"'), true, 'src 就是传进来的地址');
  assert.equal(/alt=""/.test(html), true, '装饰性图片 alt 为空');
  assert.equal(/aria-hidden="true"/.test(html), true, '瓦片整体 aria-hidden（名字在旁边）');

  // 唯一控件仍是右侧开关（AGENTS.md 规则 9）
  assert.equal(/<a\b/.test(html), false, '没有 <a>');
  assert.equal(/<button[^>]*role="switch"|<input[^>]*type="checkbox"|role="switch"/.test(html), true, '开关还在');
  const clickable = html.match(/<(?:button|a|input)\b/g) ?? [];
  assert.equal(clickable.length, 1, `整行只有一个可交互元素（实测 ${clickable.length}：${clickable.join(',')}）`);
  assert.equal(/tabindex=/i.test(html), false, '没有 tabindex（瓦片不可聚焦）');
  assert.equal(/onclick=/i.test(html), false, '没有内联 onclick');
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
  const url = 'api/dsh-skill-center/market/lucide?name=zap';
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
  assert.equal(/tileElement\(|useIconFailure\(/.test(cardText), true, '市场卡片调同一对函数');
  assert.equal(/IconTile/.test(cardText.replace(/\/\*[\s\S]*?\*\//g, '')), false, '市场卡片不套 IconTile（避免多一层组件）');
  assert.equal(/export function tileElement/.test(tileText) && /export function useIconFailure/.test(tileText), true, '两个导出都在');
});
