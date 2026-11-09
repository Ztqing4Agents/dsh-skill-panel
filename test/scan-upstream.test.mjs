/**
 * `lib/scan.js` + `lib/names.js` — which `_meta.json` records earn a row an upstream identity.
 *
 * Contract: docs/contracts/data-model.md §3.2.1 (`isUpstreamIdentity`), routes.md §3.3.1
 * (`Row.upstream` and its three hard rules), market.md §7.5; case id K62 (L2).
 *
 * The point of this gate is "no guessing": an installed row may only be matched to a market
 * entry when *our own installer* wrote the identity down. `ownerId` is not a universal
 * handle - our installer writes the upstream handle (`awspace`), the ClawHub CLI writes an
 * internal Convex id (`kn77z49x…`) that answers 404 when queried as an owner - so a record
 * without `source` describes no fetchable skill, and inventing one from the directory name
 * would light up icons that point at somebody else's skill.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isUpstreamIdentity } from '../lib/names.js';
import { scanUserSkills } from '../lib/scan.js';
import { skillFile, tempDir } from './helpers/tree.mjs';

/** A 64-hex-ish Convex id, the shape the ClawHub CLI writes as `ownerId`. */
const CONVEX = 'kn77z49x4m2q8w3e5r7t9y1u3i5o7p9a';

/**
 * Build one skill directory under a temp root.
 * @param {string} root - the skills root.
 * @param {string} dir - directory name.
 * @param {{name?: string, meta?: object|string|null, skillhubMeta?: object|string|null}} spec - files to write.
 * @returns {Promise<void>} resolves when written.
 */
async function writeSkill(root, dir, spec = {}) {
  const name = spec.name ?? dir;
  const full = join(root, dir);
  await mkdir(full, { recursive: true });
  await writeFile(join(full, 'SKILL.md'), skillFile({ name, description: `${name} fixture.` }));
  if (spec.meta !== undefined && spec.meta !== null) {
    await writeFile(join(full, '_meta.json'), typeof spec.meta === 'string' ? spec.meta : JSON.stringify(spec.meta));
  }
  if (spec.skillhubMeta !== undefined && spec.skillhubMeta !== null) {
    await writeFile(
      join(full, '_skillhub_meta.json'),
      typeof spec.skillhubMeta === 'string' ? spec.skillhubMeta : JSON.stringify(spec.skillhubMeta),
    );
  }
}

test('K62 我们写的 `_meta.json`：三元组逐字成为 `upstream`', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const root = join(dir, 'skills');
    await writeSkill(root, 'ours', {
      meta: { source: 'clawhub', ownerId: 'awspace', slug: 'pdf', version: '1.0.0', name: 'pdf', installedAt: '2026-11-09T00:00:00.000Z' },
    });
    const rows = await scanUserSkills(root);
    assert.equal(rows.length, 1, '一条候选');
    assert.deepEqual(rows[0].upstream, { sourceId: 'clawhub', owner: 'awspace', slug: 'pdf' }, '三元组逐字等于文件里的值');
    assert.deepEqual(Object.keys(rows[0].upstream), ['sourceId', 'owner', 'slug'], '只有三个键（sourceId 是改名，不是原样透传字段名）');
    assert.equal(rows[0].metaSource, true, '同一份记录照样点亮 R6 的证据位（判据未变）');
  } finally {
    await cleanup();
  }
});

test('K62 缺 `source` / Convex id 无 source / 坏 JSON / 只有 `_skillhub_meta.json` ⇒ `upstream` 为 null', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const root = join(dir, 'skills');
    // 别的工具（ClawHub CLI）写的记录：有 ownerId/slug/version，但没有 source
    await writeSkill(root, 'foreign-cli', { meta: { ownerId: CONVEX, slug: 'ui-design', version: '2.0.1' } });
    // 只有 _skillhub_meta.json：那是别人的形状，只能算「有来源证据」，不产生身份
    await writeSkill(root, 'skillhub-only', { skillhubMeta: { source: 'skillhub', ownerId: 'ake', slug: 'dev-god' } });
    // 坏 JSON：读不动就当没有，不许把整次扫描搞挂
    await writeSkill(root, 'broken-json', { meta: '{ "source": "clawhub", ' });
    // 空对象
    await writeSkill(root, 'empty-meta', { meta: {} });
    // 手写的技能：什么 metadata 都没有
    await writeSkill(root, 'hand-written');

    const rows = await scanUserSkills(root);
    const byDir = new Map(rows.map((row) => [row.dirName, row]));
    assert.equal(rows.length, 5, '五条都还在（身份只影响图标，不影响是否是一行）');
    for (const dirName of ['foreign-cli', 'skillhub-only', 'broken-json', 'empty-meta', 'hand-written']) {
      assert.equal(byDir.get(dirName).upstream, null, `${dirName} 没有可信身份 ⇒ null`);
    }
    assert.equal(byDir.get('foreign-cli').metaRelease, true, '外来记录仍然点亮 R7 的证据位（判据不变）');
    assert.equal(byDir.get('skillhub-only').metaSource, true, '只有 _skillhub_meta.json 也算「有 source」');
    assert.equal(byDir.get('broken-json').metaSource, false, '坏 JSON 不算有 source');
  } finally {
    await cleanup();
  }
});

test('K62 形状闸：`owner: "../../x"`、非法 source、超长值、非字符串 ⇒ `upstream` 为 null', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const root = join(dir, 'skills');
    await writeSkill(root, 'dot-dot', { meta: { source: 'clawhub', ownerId: '../../x', slug: 'pdf' } });
    await writeSkill(root, 'dot-dot-slug', { meta: { source: 'clawhub', ownerId: 'awspace', slug: '../etc' } });
    await writeSkill(root, 'inner-dot-dot', { meta: { source: 'clawhub', ownerId: 'a..b', slug: 'pdf' } });
    await writeSkill(root, 'bad-source-char', { meta: { source: 'nope!', ownerId: 'awspace', slug: 'pdf' } });
    await writeSkill(root, 'upper-source', { meta: { source: 'ClawHub', ownerId: 'awspace', slug: 'pdf' } });
    await writeSkill(root, 'numeric-owner', { meta: { source: 'clawhub', ownerId: 42, slug: 'pdf' } });
    await writeSkill(root, 'missing-slug', { meta: { source: 'clawhub', ownerId: 'awspace' } });
    await writeSkill(root, 'long-owner', { meta: { source: 'clawhub', ownerId: 'a'.repeat(65), slug: 'pdf' } });

    const rows = await scanUserSkills(root);
    const byDir = new Map(rows.map((row) => [row.dirName, row]));
    for (const dirName of [
      'dot-dot', 'dot-dot-slug', 'inner-dot-dot', 'bad-source-char', 'upper-source',
      'numeric-owner', 'missing-slug', 'long-owner',
    ]) {
      assert.equal(byDir.get(dirName)?.upstream ?? null, null, `${dirName} 过不了形状闸 ⇒ null`);
    }
    // 形状闸越严，"有 source" 这条判据就越不受影响：R6 只看有没有 source 字段。
    assert.equal(byDir.get('bad-source-char').metaSource, true, 'R6 的判据仍只看「有 source 字段」');
  } finally {
    await cleanup();
  }
});

test('K62 真实形状放行：带下划线/点/横线的 handle 与 slug 仍然可信', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const root = join(dir, 'skills');
    await writeSkill(root, 'real-handles', { meta: { source: 'skillhub', ownerId: 'a.b_c-d', slug: 'dev-god' } });
    await writeSkill(root, 'real-clawhub', { meta: { source: 'clawhub', ownerId: 'awspace', slug: 'pdf' } });
    await writeSkill(root, 'underscore', { meta: { source: 'skillhub', ownerId: 'user_741dc82b', slug: 'ai-agent-security-audit-gen' } });
    const rows = await scanUserSkills(root);
    const byDir = new Map(rows.map((row) => [row.dirName, row]));
    assert.deepEqual(byDir.get('real-handles').upstream, { sourceId: 'skillhub', owner: 'a.b_c-d', slug: 'dev-god' }, '点/下划线/横线都合法');
    assert.deepEqual(byDir.get('underscore').upstream, { sourceId: 'skillhub', owner: 'user_741dc82b', slug: 'ai-agent-security-audit-gen' }, '真实 handle 形状');
    assert.deepEqual(byDir.get('real-clawhub').upstream, { sourceId: 'clawhub', owner: 'awspace', slug: 'pdf' }, 'clawhub 同样');
  } finally {
    await cleanup();
  }
});

test('K62 `isUpstreamIdentity` 本体：全过才为真，`..` 即使过字符类也拒', () => {
  assert.equal(isUpstreamIdentity('skillhub', 'ake', 'dev-god'), true, '三件套齐');
  assert.equal(isUpstreamIdentity('clawhub', 'a.b_c-d', 'x'), true, '字符类允许 . _ -');
  assert.equal(isUpstreamIdentity('ClawHub', 'ake', 'dev-god'), false, 'source 小写');
  assert.equal(isUpstreamIdentity('nope!', 'ake', 'dev-god'), false, 'source 字符类');
  assert.equal(isUpstreamIdentity('clawhub', '../x', 'y'), false, 'owner 带 ..');
  assert.equal(isUpstreamIdentity('clawhub', 'a..b', 'y'), false, 'a..b 过字符类但含 ..（这正是共享判据的理由）');
  assert.equal(isUpstreamIdentity('clawhub', 'ake', '..'), false, 'slug 是 ..');
  assert.equal(isUpstreamIdentity('clawhub', 'ake', 'y/../z'), false, 'slug 带 /');
  assert.equal(isUpstreamIdentity('clawhub', 'ake', ''), false, '空 slug');
  assert.equal(isUpstreamIdentity(undefined, 'ake', 'y'), false, '缺 source');
  assert.equal(isUpstreamIdentity('clawhub', null, 'y'), false, 'owner 非字符串');
  assert.equal(isUpstreamIdentity('clawhub', 'ake', 42), false, 'slug 非字符串');
});
