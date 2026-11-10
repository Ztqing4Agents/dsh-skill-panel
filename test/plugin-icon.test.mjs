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

import { packageRootOf, pluginIconOf, withPluginIcons } from '../lib/plugin-icon.js';

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

test('pluginIconOf：越界路径 / 绝对路径 / 反斜杠 / 超 16 KB / 软链一律 null', async () => {
  await withRoot(async (root) => {
    await makePackage(root, 'pkg-escape', { icon: '../evil.svg' }, {});
    await makePackage(root, 'pkg-abs', { icon: '/etc/passwd' }, {});
    await makePackage(root, 'pkg-big', { icon: 'icon.svg' }, { 'icon.svg': 'x'.repeat(16385) });
    await makePackage(root, 'pkg-edge', { icon: 'icon.svg' }, { 'icon.svg': 'x'.repeat(16384) });
    const linkDir = await makePackage(root, 'pkg-link', { icon: 'icon.svg' }, {});
    await writeFile(join(root, 'outside.svg'), SVG);
    await symlink(join(root, 'outside.svg'), join(linkDir, 'icon.svg'));

    assert.equal(await pluginIconOf(join(root, 'node_modules/pkg-escape/skills/a/SKILL.md')), null, '../ 越界');
    assert.equal(await pluginIconOf(join(root, 'node_modules/pkg-abs/skills/a/SKILL.md')), null, '绝对路径');
    assert.equal(await pluginIconOf(join(root, 'node_modules/pkg-big/skills/a/SKILL.md')), null, '16385 B 超限');
    assert.ok((await pluginIconOf(join(root, 'node_modules/pkg-edge/skills/a/SKILL.md')) ?? '').startsWith('data:image/svg+xml'), '16384 B 恰好放行（边界值）');
    assert.equal(await pluginIconOf(join(root, 'node_modules/pkg-link/skills/a/SKILL.md')), null, '软链不跟随');
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
