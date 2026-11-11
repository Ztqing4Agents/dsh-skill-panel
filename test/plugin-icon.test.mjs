/**
 * `lib/plugin-icon.js` — the package icon a builtin block shows.
 *
 * Contract: docs/contracts/data-model.md §3.2（Row.pluginIcon）与 docs/contracts/client.md §3.5
 * （内置块头：有 icon 用图，没有就回退首字母头像）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { packageInfoOf, packageRootOf, pluginIconOf, withPluginIcons } from '../lib/plugin-icon.js';

/** One throwaway root per test, removed afterwards. */
async function withRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), 'skc-icon-'));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Write one package: manifest + optional extra files. */
async function makePackage(root, name, manifest, files = {}) {
  const dir = join(root, 'node_modules', name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...manifest }));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16"/></svg>';

test('packageRootOf：取最后一个 node_modules 之后的包根，scoped 保留两段', () => {
  assert.equal(packageRootOf('/p/node_modules/dsh-univer-office/skills/a/SKILL.md'), '/p/node_modules/dsh-univer-office');
  assert.equal(packageRootOf('/p/node_modules/@scope/pkg/skills/a/SKILL.md'), '/p/node_modules/@scope/pkg');
  assert.equal(packageRootOf('/p/node_modules/outer/node_modules/inner/skills/a/SKILL.md'), '/p/node_modules/outer/node_modules/inner');
  assert.equal(packageRootOf('/skills/a/SKILL.md'), null, '不在 node_modules 里就是 null');
  assert.equal(packageRootOf(null), null, 'null 也是 null');
  assert.equal(packageRootOf(''), null, '空串也是 null');
});

test('pluginIconOf：包声明了 icon 就读成 base64 data URL（svg / png / ./ 前缀都认）', async () => {
  await withRoot(async (root) => {
    await makePackage(root, 'pkg-svg', { icon: 'assets/icon.svg' }, { 'assets/icon.svg': SVG });
    await makePackage(root, 'pkg-dot', { icon: './assets/icon.svg' }, { 'assets/icon.svg': SVG });
    await makePackage(root, 'pkg-png', { icon: 'icon.png' }, { 'icon.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
    const svg = await pluginIconOf(join(root, 'node_modules/pkg-svg/skills/a/SKILL.md'));
    assert.equal(svg, `data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`, 'svg 的 mime + base64');
    assert.equal(await pluginIconOf(join(root, 'node_modules/pkg-dot/skills/a/SKILL.md')), svg, './ 前缀与无前缀等价');
    assert.ok((await pluginIconOf(join(root, 'node_modules/pkg-png/skills/a/SKILL.md'))).startsWith('data:image/png;base64,'), 'png 的 mime');
  });
});

test('pluginIconOf：没有 icon 字段 / 文件缺失 / 后缀不认识 → null（回退首字母头像）', async () => {
  await withRoot(async (root) => {
    await makePackage(root, 'pkg-none', {}, {});
    await makePackage(root, 'pkg-missing', { icon: 'assets/nope.svg' }, {});
    await makePackage(root, 'pkg-gif', { icon: 'icon.gif' }, { 'icon.gif': Buffer.from('GIF') });
    for (const name of ['pkg-none', 'pkg-missing', 'pkg-gif']) {
      assert.equal(await pluginIconOf(join(root, `node_modules/${name}/skills/a/SKILL.md`)), null, `${name} 没有可用图标`);
    }
  });
});

test('pluginIconOf：越界路径 / 绝对路径 / 超 256 KiB / 软链一律 null', async () => {
  await withRoot(async (root) => {
    await makePackage(root, 'pkg-escape', { icon: '../evil.svg' }, {});
    await makePackage(root, 'pkg-abs', { icon: '/etc/passwd' }, {});
    await makePackage(root, 'pkg-big', { icon: 'icon.svg' }, { 'icon.svg': 'x'.repeat(262145) });
    await makePackage(root, 'pkg-edge', { icon: 'icon.svg' }, { 'icon.svg': 'x'.repeat(262144) });
    const linkDir = await makePackage(root, 'pkg-link', { icon: 'icon.svg' }, {});
    await writeFile(join(root, 'outside.svg'), SVG);
    await symlink(join(root, 'outside.svg'), join(linkDir, 'icon.svg'));

    assert.equal(await pluginIconOf(join(root, 'node_modules/pkg-escape/skills/a/SKILL.md')), null, '../ 越界');
    assert.equal(await pluginIconOf(join(root, 'node_modules/pkg-abs/skills/a/SKILL.md')), null, '绝对路径');
    assert.equal(await pluginIconOf(join(root, 'node_modules/pkg-big/skills/a/SKILL.md')), null, '262145 B 超限');
    assert.ok((await pluginIconOf(join(root, 'node_modules/pkg-edge/skills/a/SKILL.md')) ?? '').startsWith('data:image/svg+xml'), '262144 B 恰好放行（边界值）');
    assert.equal(await pluginIconOf(join(root, 'node_modules/pkg-link/skills/a/SKILL.md')), null, '软链不跟随');
  });
});

test('pluginIconOf：上限抬到 256 KiB 之后，16 KiB 与 200 KiB 的图都能出（两个档都验）', async () => {
  await withRoot(async (root) => {
    await makePackage(root, 'pkg-16k', { icon: 'icon.svg' }, { 'icon.svg': 'x'.repeat(16385) });
    await makePackage(root, 'pkg-200k', { icon: 'icon.png' }, { 'icon.png': Buffer.alloc(204800, 7) });
    const small = await pluginIconOf(join(root, 'node_modules/pkg-16k/skills/a/SKILL.md'));
    assert.ok((small ?? '').startsWith('data:image/svg+xml;base64,'), '16385 B 现在应该出图（旧上限 16 KiB 已抬走）');
    const big = await pluginIconOf(join(root, 'node_modules/pkg-200k/skills/a/SKILL.md'));
    assert.ok((big ?? '').startsWith('data:image/png;base64,'), '200 KiB 的 png 也应该出图');
    assert.ok((big ?? '').length > 200000, '整份 200 KiB 都进了 base64');
  });
});

test('pluginIconOf：没有 icon 字段时读 exports["./icon"]（宿主那条来源）', async () => {
  await withRoot(async (root) => {
    await makePackage(root, 'pkg-export', { exports: { './icon': './icon.svg' } }, { 'icon.svg': SVG });
    assert.equal(
      await pluginIconOf(join(root, 'node_modules/pkg-export/skills/a/SKILL.md')),
      `data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`,
      'exports["./icon"] 是字符串路径 ⇒ 出图',
    );
  });
});

test('pluginIconOf：exports["./icon"] 是模块式导出（{default: "./lib/icon.js"}）⇒ null，不加载别人的模块', async () => {
  await withRoot(async (root) => {
    await makePackage(root, 'pkg-export-module', { exports: { './icon': { default: './lib/icon.js' } } }, { 'lib/icon.js': 'export default 1;' });
    assert.equal(
      await pluginIconOf(join(root, 'node_modules/pkg-export-module/skills/a/SKILL.md')),
      null,
      '指向 .js 的导出不是图，跳过（绝不 import）',
    );
    // 另一个包：模块式导出的同时还有真 icon 字段，确认是「跳过那一条」而不是「整包放弃」
    // （每个包根只读一次并缓存，所以这里必须换一个包名）。
    await makePackage(root, 'pkg-export-module-b', { exports: { './icon': { default: './lib/icon.js' } }, icon: 'icon.svg' }, { 'lib/icon.js': 'export default 1;', 'icon.svg': SVG });
    assert.ok(
      (await pluginIconOf(join(root, 'node_modules/pkg-export-module-b/skills/a/SKILL.md')) ?? '').startsWith('data:image/svg+xml'),
      'icon 字段仍然优先（模块式导出不影响它）',
    );
  });
});

test('pluginIconOf：package.json 坏了也是 null；同一包只读一次（缓存 null 与真值一致）', async () => {
  await withRoot(async (root) => {
    const dir = join(root, 'node_modules', 'pkg-broken');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), '{ not json');
    assert.equal(await pluginIconOf(join(root, 'node_modules/pkg-broken/skills/a/SKILL.md')), null, '坏 manifest');

    await makePackage(root, 'pkg-cached', { icon: 'icon.svg' }, { 'icon.svg': SVG });
    const path = join(root, 'node_modules/pkg-cached/skills/a/SKILL.md');
    const first = await pluginIconOf(path);
    await rm(join(root, 'node_modules/pkg-cached/icon.svg'));
    assert.equal(await pluginIconOf(path), first, '第二次是缓存值（文件删了也不重读）');
  });
});

test('withPluginIcons：有 originPath 的行挂上 pluginIcon，没有的行原样返回', async () => {
  await withRoot(async (root) => {
    await makePackage(root, 'pkg-a', { icon: 'icon.svg' }, { 'icon.svg': SVG });
    const catalog = {
      groups: [{ key: 'builtin', skills: [
        { name: 'one', originPath: join(root, 'node_modules/pkg-a/skills/one/SKILL.md') },
        { name: 'two', originPath: null },
      ] }],
      counts: { total: 2 },
    };
    const out = await withPluginIcons(catalog);
    assert.ok((out.groups[0].skills[0].pluginIcon ?? '').startsWith('data:image/svg+xml;base64,'), '有 originPath 的挂上图标');
    assert.equal(out.groups[0].skills[1].pluginIcon, undefined, '没有 originPath 的行不加字段');
    assert.deepEqual(out.counts, { total: 2 }, '其余字段原样带过去');
    assert.equal(catalog.groups[0].skills[0].pluginIcon, undefined, '不改入参');
  });
});

/* ------------- link: 安装（不在 node_modules 下）：向上找最近的 package.json ------------- */
// `packageAbove` 是私有函数，对外只有 `packageInfoOf` 这一个入口，所以都从它测（黑盒覆盖同一条路径）。

test('packageInfoOf：link 安装（没有 node_modules 段）时向上找到包的 name', async () => {
  await withRoot(async (base) => {
    await mkdir(join(base, 'my-link-plug', 'skills', 'demo'), { recursive: true });
    await writeFile(join(base, 'my-link-plug', 'package.json'), JSON.stringify({ name: 'my-link-plug', version: '0.1.0' }));
    const info = await packageInfoOf(join(base, 'my-link-plug', 'skills', 'demo'));
    assert.deepEqual(info, { root: join(base, 'my-link-plug'), name: 'my-link-plug', version: '0.1.0', description: null }, '命中最近的那层 manifest（version 带出来，没描述就是 null）');
  });
});

test('packageInfoOf：中间几层没有 manifest 也继续向上（技能目录嵌得比较深）', async () => {
  await withRoot(async (base) => {
    const pkg = join(base, 'deep-plug');
    await mkdir(join(pkg, 'a', 'b', 'c', 'skills', 'demo'), { recursive: true });
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'deep-plug' }));
    assert.deepEqual(await packageInfoOf(join(pkg, 'a', 'b', 'c', 'skills', 'demo')), { root: pkg, name: 'deep-plug', version: null, description: null }, '跨三层也找得到（缺 version/description 时为 null）');
  });
});

test('packageInfoOf：向上最多 6 层——第 6 层有 manifest 命中，第 7 层才有就是 null', async () => {
  await withRoot(async (base) => {
    // D0 = .../s5，D1..D5 逐级向上，第 6 次（i=5）落在 pkg 根 —— 恰好命中。
    const hitRoot = join(base, 'hit-plug');
    await mkdir(join(hitRoot, 's1', 's2', 's3', 's4', 's5', 'demo'), { recursive: true });
    await writeFile(join(hitRoot, 'package.json'), JSON.stringify({ name: 'hit-plug' }));
    assert.deepEqual(await packageInfoOf(join(hitRoot, 's1', 's2', 's3', 's4', 's5', 'demo')), { root: hitRoot, name: 'hit-plug', version: null, description: null }, '第 6 层命中');

    // 再多一层：manifest 落在第 7 次才会到的地方 —— 不命中。
    const missRoot = join(base, 'miss-plug');
    await mkdir(join(missRoot, 's1', 's2', 's3', 's4', 's5', 's6', 'demo'), { recursive: true });
    await writeFile(join(missRoot, 'package.json'), JSON.stringify({ name: 'miss-plug' }));
    assert.equal(await packageInfoOf(join(missRoot, 's1', 's2', 's3', 's4', 's5', 's6', 'demo')), null, '第 7 层不命中');
  });
});

test('packageInfoOf：一路爬到文件系统根都没有 manifest 就是 null', async () => {
  await withRoot(async (base) => {
    const deep = join(base, 'nothing', 'here', 'demo');
    await mkdir(deep, { recursive: true });
    assert.equal(await packageInfoOf(deep), null, '到根为止都没有 package.json');
  });
});

test('packageInfoOf：软链目录不跟随（不会顺着软链跑到别的树里去找 manifest）', async () => {
  await withRoot(async (base) => {
    const target = join(base, 'target-pkg');
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'package.json'), JSON.stringify({ name: 'target-pkg' }));
    const plug = join(base, 'plug');
    await mkdir(join(plug, 'real'), { recursive: true });
    await symlink(target, join(plug, 'linkdir'));
    // 技能目录本身是那棵软链树里的
    assert.equal(await packageInfoOf(join(plug, 'linkdir', 'demo')), null, '软链目录被跳过（否则会拿到 target-pkg）');
  });
});

test('packageInfoOf：坏 JSON / name 为空 / name 不是字符串都算「这层没有」，继续向上', async () => {
  await withRoot(async (base) => {
    const pkg = join(base, 'multi-plug');
    await mkdir(join(pkg, 'mid', 'demo'), { recursive: true });
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'multi-plug' }));
    for (const [label, content] of [
      ['坏 JSON', '{ not json'],
      ['name 为空', JSON.stringify({ name: '' })],
      ['name 不是字符串', JSON.stringify({ name: 42 })],
    ]) {
      await writeFile(join(pkg, 'mid', 'package.json'), content);
      assert.deepEqual(await packageInfoOf(join(pkg, 'mid', 'demo')), { root: pkg, name: 'multi-plug', version: null, description: null }, `${label}：跳过这层，命中上一层`);
    }
  });
});

test('withPluginIcons：同时挂 pluginPackage 与 pluginIcon，取不到时两个字段都是 null', async () => {
  await withRoot(async (base) => {
    const plug = join(base, 'linked-plug');
    await mkdir(join(plug, 'skills', 'demo'), { recursive: true });
    await writeFile(join(plug, 'package.json'), JSON.stringify({ name: 'linked-plug', icon: 'assets/icon.svg' }));
    await mkdir(join(plug, 'assets'), { recursive: true });
    await writeFile(join(plug, 'assets', 'icon.svg'), SVG);
    const nowhere = join(base, 'orphan', 'skills', 'gone');
    await mkdir(nowhere, { recursive: true });

    const out = await withPluginIcons({ groups: [{ key: 'builtin', skills: [
      { name: 'demo', originPath: join(plug, 'skills', 'demo') },
      { name: 'gone', originPath: nowhere },
      { name: 'plain' },
    ] }] });
    const [linked, orphan, plain] = out.groups[0].skills;
    assert.equal(linked.pluginPackage, 'linked-plug', '包名挂上了');
    assert.ok((linked.pluginIcon ?? '').startsWith('data:image/svg+xml;base64,'), '图标也挂上了（link 安装同样能读）');
    assert.equal(orphan.pluginPackage, null, '找不到包：包名是 null');
    assert.equal(orphan.pluginIcon, null, '找不到包：图标也是 null（两个字段照挂）');
    assert.equal(plain.pluginPackage, undefined, '没有 originPath 的行不加字段');
  });
});
