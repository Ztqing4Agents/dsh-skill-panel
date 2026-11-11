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
function blockOf(provider, names, key = `pkg-${provider}`, extra = {}) {
  // toPluginBlocks 给每个块都会填 version/description/iconUrl（缺就是 null），fixture 照抄这个形状。
  return { key, provider, iconUrl: null, version: null, description: null, skills: names.map((name) => builtinOf(provider, name)), ...extra };
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

test('插件页：面包屑 → 包名头（图标 + 版本 Tag）→ 包含的技能（右侧计数）→ 来源信息', () => {
  const html = render(blockOf('univer', ['sheet', 'docx'], 'dsh-univer-office'));
  const order = [
    'class="skc_marketCrumb"',
    'class="skc_detailTop"',
    `<h3 class="skc_marketDetailTitle">dsh-univer-office</h3>`,
    'class="skc_sectionHead"',
    'class="skc_marketFacts"',
  ].map((needle) => html.indexOf(needle));
  assert.ok(order.every((at) => at !== -1), '五段都在');
  assert.deepEqual([...order].sort((a, b) => a - b), order, '顺序：面包屑 → 头 → 包含的技能 → 来源信息');
  // 计数行：区块标题右边那一个 span，文字走 plugin.countRunning。
  assert.equal(
    /<span class="skc_pluginCount">([^<]*)<\/span>/.exec(html)?.[1],
    t('plugin.countRunning', { count: 2, running: 2 }),
    '计数行写「共 N 个 · M 运行中」',
  );
  // 没有 manifest 三件套：没有 Tag、没有副行（intro 里只剩标题行）、来源信息一行 = 包名。
  assert.equal(/data-tone="neutral"/.test(html), false, '没有 version 就不画 Tag');
  assert.equal(html.includes('skc_marketDetailDesc'), false, '没有描述就不画副行');
  assert.ok(html.includes(`<dt>${t('detail.factCodeSource')}</dt><dd><code>dsh-univer-office</code></dd>`), '来源信息一行：代码来源 = 包名');
  assert.equal(html.includes(`<dt>${t('detail.factVersion')}</dt>`), false, '没有 version 就没有「当前版本」行');
  // 挂点仍是 provider id（开关写盘用它），包名单列一个属性。
  assert.ok(html.includes('data-skc-plugin-detail="univer"'), '插件页挂点 = provider id');
  assert.ok(html.includes('data-skc-plugin-pkg="dsh-univer-office"'), '包名在 data-skc-plugin-pkg 上');

  // 三件套齐（version + description）：Tag、副行、来源信息两行都跟着变。
  const full = render(blockOf('univer', ['sheet', 'docx'], 'dsh-univer-office', { version: '0.4.0', description: 'DSH × Univer integration.' }));
  assert.ok(full.includes('<span data-tone="neutral">v0.4.0</span>'), '标题旁有版本 Tag');
  // 副行复用技能页那一套类，只多一个 pluginDesc 修饰类（两行裁切只挂在修饰类上，见 styles 的 K110）。
  const descTag = /<p class="([^"]*)">DSH × Univer integration\.<\/p>/.exec(full);
  assert.ok(descTag !== null, '副行是插件描述');
  assert.ok(descTag[1].split(' ').includes('skc_marketDetailDesc'), '副行带 marketDetailDesc（与技能页共用排版）');
  assert.ok(descTag[1].split(' ').includes('skc_pluginDesc'), '副行还带 pluginDesc（两行裁切只加这个修饰类）');
  assert.ok(full.includes(`<dd><code>dsh-univer-office@0.4.0</code></dd>`), '代码来源 = 包名@版本');
  assert.ok(full.includes(`<dt>${t('detail.factVersion')}</dt><dd><code>0.4.0</code></dd>`), '多一行「当前版本」');
  assert.equal(
    /<span class="skc_pluginCount">([^<]*)<\/span>/.exec(full)?.[1],
    t('plugin.countRunning', { count: 2, running: 2 }),
    '计数行与有没有三件套无关',
  );
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
  const rows = html.match(/<div class="skc_callRow[\s\S]*?(?=<div class="skc_callRow|<\/div><\/div>)/g) ?? [];
  assert.equal(rows.length >= 2, true, '每行都是 .skc_callRow 壳');
  assert.equal((html.match(/class="skc_callRow skc_callRowOpen"/g) ?? []).length, 2, '插件页的行带可点修饰类（hover/active 只挂在它身上）');
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
