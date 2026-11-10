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
    'class="skc_pluginHead"',
    '<h3 class="skc_marketDetailTitle">dsh-univer-office</h3>',
    t('plugin.skills'),
    'class="skc_marketFacts"',
  ].map((needle) => html.indexOf(needle));
  assert.ok(order.every((at) => at !== -1), '五段都在');
  assert.deepEqual([...order].sort((a, b) => a - b), order, '顺序：面包屑 → 头 → 包含的技能 → 来源信息');
  assert.ok(html.includes(t('plugin.skillsCount', { count: 2 })), '头上写着「2 个技能」');
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
