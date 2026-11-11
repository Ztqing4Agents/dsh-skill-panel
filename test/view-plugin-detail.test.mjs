/**
 * L3 — `src/client/plugin-detail.jsx`: one builtin provider's page.
 *
 * Contract: docs/contracts/installed-detail.md（两级返回：列表 → 插件页 → 技能详情）与
 * docs/contracts/client.md（开关仍是唯一独立动作位）。
 */
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { loadClientModules, zhTranslator } from './helpers/ssr.mjs';

/** Bundled modules. */
let modules;
/** Chinese translator. */
let t;

before(async () => {
  modules = await loadClientModules(['pluginDetail']);
  t = await zhTranslator();
});

/** One builtin row. */
function builtinOf(provider, name, overrides = {}) {
  return {
    name,
    description: `Skill ${name}.`,
    displayName: null,
    provider,
    partition: 'builtin',
    rule: 'R8',
    confidence: 'high',
    symlink: false,
    path: null,
    realPath: null,
    enabled: true,
    writable: false,
    readonlyReason: 'provider-store',
    upstream: null,
    version: null,
    ...overrides,
  };
}

/** A block of one provider, keyed by its plugin package name. */
function blockOf(provider, names, key = `pkg-${provider}`) {
  return { key, provider, skills: names.map((name) => builtinOf(provider, name)) };
}

/** Render the plugin page. */
function render(block, setup = {}) {
  return renderToStaticMarkup(createElement(modules.pluginDetail.PluginDetail, {
    block,
    t,
    rows: new Map(),
    onBack: () => {},
    onToggle: () => {},
    onOpenRow: () => {},
    ...setup,
  }));
}

test('插件页：面包屑 → 插件包名头（图标 + 名 + 技能数）→ 包含的技能 → 来源信息（内置）', () => {
  const html = render(blockOf('univer', ['sheet', 'docx'], 'dsh-univer-office'));
  const order = [
    'class="skc_marketCrumb"',
    'class="skc_detailTop"',
    `<h3 class="skc_marketDetailTitle">dsh-univer-office</h3>`,
    t('plugin.skills'),
    'class="skc_marketFacts"',
  ].map((needle) => html.indexOf(needle));
  assert.ok(order.every((at) => at !== -1), '五段都在');
  assert.deepEqual([...order].sort((a, b) => a - b), order, '顺序：面包屑 → 头 → 包含的技能 → 来源信息');
  assert.ok(html.includes(t('plugin.skillsCount', { count: 2 })), '头上写着「2 个技能」');
  // 副行与标题都用技能详情页那一套类，两页才对得齐（本轮对齐改动）。
  assert.ok(html.includes(`<p class="skc_marketDetailDesc">${t('plugin.skillsCount', { count: 2 })}</p>`), '副行是 marketDetailDesc（不再是 cardDesc）');
  assert.equal(/<p class="skc_cardDesc">/.test(html.split('skc_marketSectionTitle')[0]), false, '头部不再用 cardDesc');
  assert.ok(html.includes(`<dt>${t('detail.factCodeSource')}</dt><dd>${t('detail.sourceBuiltin')}</dd>`), '来源信息一行：代码来源 = 内置');
  // 挂点仍是 provider id（开关写盘用它），包名单列一个属性。
  assert.ok(html.includes('data-skc-plugin-detail="univer"'), '插件页挂点 = provider id');
  assert.ok(html.includes('data-skc-plugin-pkg="dsh-univer-office"'), '包名在 data-skc-plugin-pkg 上');
});

test('插件页没有版本区块、没有查看仓库、也没有「无法检查更新」', () => {
  const html = render(blockOf('univer', ['sheet']));
  assert.equal(html.includes('skc_detailVersionHead'), false, '没有版本表头');
  assert.equal(html.includes('skc_detailVersionCard'), false, '没有版本卡');
  assert.equal(html.includes('skc_detailRepoLink'), false, '没有查看仓库');
  assert.equal(html.includes(t('detail.checkUnavailable')), false, '不出现「无法检查更新」');
  assert.equal(html.includes('重新检查'), false, '没有重新检查按钮');
});

test('插件页只列本块的技能，每行一个开关（开关数 = 技能数）', () => {
  const html = render(blockOf('univer', ['sheet', 'docx', 'slide']));
  for (const name of ['sheet', 'docx', 'slide']) {
    assert.ok(html.includes(`data-skc-row="runtime#${name}"`) || html.includes(`#${name}"`), `${name} 在页面上`);
    assert.ok(html.includes(`aria-label="${t('row.enable', { name })}"`) || html.includes(`aria-label="启用 ${name}"`), `${name} 有开关`);
  }
  const switches = (html.match(/role="switch"/g) ?? []).length;
  assert.equal(switches, 3, `开关数 = 技能数（实测 ${switches}）`);
  assert.equal(html.includes('univer#sheet') && html.includes('dsh-office'), false, '没有别家技能混进来');
  assert.equal(html.includes('skc_marketTags'), false, '没有标签行');
});

test('插件页的面包屑带 onClick（返回上一级由调用方决定，两级返回靠它）', () => {
  let back = 0;
  const html = render(blockOf('univer', ['sheet']), { onBack: () => { back += 1; } });
  assert.ok(/<button type="button" class="skc_marketCrumb"/.test(html), '面包屑是普通按钮');
  assert.equal(html.includes(t('detail.back')), true, '按钮文字是 detail.back');
});

test('插件页的行是组件式行：74 高壳 + 41 图标 + 13.5/20/500 名字 + 两行描述 + 行尾开关', () => {
  const html = render(blockOf('univer', ['sheet', 'docx']));
  const rows = html.match(/<div class="skc_callRow"[\s\S]*?(?=<div class="skc_callRow"|<\/div><\/div>)/g) ?? [];
  assert.equal(rows.length >= 2, true, '每行都是 .skc_callRow 壳');
  // 图标位同时带宿主行的 cardIcon（尺寸由 .skc_callIcon 覆写成 41 / 圆角 12）。
  assert.equal((html.match(/class="skc_cardIcon skc_callIcon"/g) ?? []).length, 2, '每行一个 41 图标');
  assert.equal((html.match(/class="skc_cardTitle skc_cardOpen skc_callName"/g) ?? []).length, 2, '名字是可点按钮（callName）');
  assert.equal((html.match(/<p class="skc_callDesc">/g) ?? []).length, 2, '描述是 callDesc');
  const ends = html.match(/<div class="skc_cardEnd">[\s\S]*?<\/div>/g) ?? [];
  assert.equal(ends.length, 2, '行尾的开关在 .skc_cardEnd 里');
  assert.ok(ends.every((chunk) => chunk.includes('role="switch"')), '每个行尾都是开关');
  assert.equal(html.includes('data-skc-row="univer#sheet"'), true, '行上带着技能键（可点进技能详情）');
});

test('插件页没有正文盒 / 版本卡 / 仓库链接 / 旧的头行类名', () => {
  const html = render(blockOf('univer', ['sheet']));
  assert.equal(html.includes('skc_detailBodyBox'), false, '没有正文盒');
  assert.equal(html.includes('skc_detailVersionCard'), false, '没有版本卡');
  assert.equal(html.includes('skc_detailRepoLink'), false, '没有查看仓库');
  assert.equal(html.includes('skc_pluginHead'), false, '旧的 .skc_pluginHead 已不在');
  assert.ok(html.includes('class="skc_detailTop"'), '头行是 .skc_detailTop');
  assert.ok(html.includes('class="skc_cardIcon skc_detailIcon"'), '头图标是 .skc_detailIcon（49 那颗）');
});

test('插件页头：有包图标就把 data URL 交给头像位，没有就只画首字母', () => {
  const withIcon = render({ ...blockOf('univer', ['sheet']), iconUrl: 'data:image/svg+xml;base64,AAA' });
  assert.ok(withIcon.includes('class="skc_cardIcon skc_detailIcon"'), '头像位还是那颗 49 图标');
  // 头像是「先探测、加载成功才替换字母」（SSR 阶段拿到的是隐藏的 eager 探针图）。
  assert.ok(/<img[^>]*src="data:image\/svg\+xml;base64,AAA"/.test(withIcon), 'data URL 进了 img');
  assert.ok(/<img[^>]*loading="eager"/.test(withIcon), '是 eager 探针图');
  const without = render(blockOf('univer', ['sheet']));
  assert.equal(without.includes('data:image'), false, '没有图标时不出现任何 img 数据');
  assert.ok(without.includes('--skc-avatar-bg'), '没有图标就是首字母头像');
});
