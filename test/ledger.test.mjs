/**
 * `lib/ledger.js` — the read-only install ledgers (rule R5).
 *
 * Contract: docs/contracts/data-model.md §3.2.2 (R5) and docs/contracts/routes.md §3.4.4 (degradation).
 * On this machine three of the four ledgers are empty, which is exactly why the
 * reader never guesses and never throws.
 */
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { readLedger } from '../lib/ledger.js';
import { tempDir } from './helpers/tree.mjs';

/** The temporary DSH home every case writes into. */
let home;
let skillsRoot;

before(async () => {
  home = await tempDir();
  skillsRoot = join(home.dir, 'skills');
  await mkdir(join(skillsRoot, 'hand-written'), { recursive: true });
  await mkdir(join(home.dir, 'dsh-skill-market'), { recursive: true });
  await mkdir(join(home.dir, 'skills-manager'), { recursive: true });
});

after(async () => {
  await home.cleanup();
});

test('台账缺失时返回空集，不产生诊断', async () => {
  const facts = await readLedger(join(home.dir, 'nothing-here'), skillsRoot);
  assert.equal(facts.entries.size, 0, '没有任何台账时条目集合为空');
  assert.deepEqual(facts.sources, [], '没有任何台账应答');
  assert.deepEqual(facts.diagnostics, [], '文件缺失不算降级诊断');
});

test('dsh-skill-market/installed.json 的键与记录字段都被当作已安装名', async () => {
  const dshHome = join(home.dir, 'home-market');
  await mkdir(join(dshHome, 'dsh-skill-market'), { recursive: true });
  await writeFile(join(dshHome, 'dsh-skill-market', 'installed.json'), JSON.stringify({
    'dir-name': { version: '1.0.0', slug: 'slug-name', namespace: 'ns' },
    'plain-dir': { name: 'declared-name' },
  }), 'utf8');
  const facts = await readLedger(dshHome, skillsRoot);
  assert.equal(facts.entries.has('dir-name'), true, '记录键（目录名）被收录');
  assert.equal(facts.entries.has('slug-name'), true, '记录里的 slug 被收录');
  assert.equal(facts.entries.has('declared-name'), true, '记录里的 name 被收录');
  assert.deepEqual(facts.sources, ['dsh-skill-market'], '应答的台账被记入 sources');
});

test('skills-manager/repositories.json 的 installs[] 被收录', async () => {
  const dshHome = join(home.dir, 'home-manager');
  await mkdir(join(dshHome, 'skills-manager'), { recursive: true });
  await writeFile(join(dshHome, 'skills-manager', 'repositories.json'), JSON.stringify({
    repositories: [],
    installs: [{ name: 'installed-one' }, { dir: 'installed-dir' }, 'plain-string'],
  }), 'utf8');
  const facts = await readLedger(dshHome, skillsRoot);
  assert.equal(facts.entries.has('installed-one'), true, 'installs[].name 被收录');
  assert.equal(facts.entries.has('installed-dir'), true, 'installs[].dir 被收录');
  assert.equal(facts.entries.has('plain-string'), true, '数组里的字符串条目被收录');
});

test('技能根下的 .skills-lock.json 用 skills{} 的键命中', async () => {
  const root = join(home.dir, 'root-lock');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, '.skills-lock.json'), JSON.stringify({ skills: { 'locked-skill': { version: '2' } } }), 'utf8');
  const facts = await readLedger(home.dir, root);
  assert.equal(facts.entries.has('locked-skill'), true, 'skills{} 的键被收录');
  assert.deepEqual(facts.sources, ['skills-lock'], '应答的台账是 skills-lock');
});

test('本插件自己的安装记录也被读取（P2 之前不写，但读法先定死）', async () => {
  const dshHome = join(home.dir, 'home-own');
  await mkdir(join(dshHome, 'dsh-skill-center'), { recursive: true });
  await writeFile(join(dshHome, 'dsh-skill-center', 'installed.json'), JSON.stringify({
    installs: [{ name: 'own-install' }],
    skills: { 'own-skill': {} },
  }), 'utf8');
  const facts = await readLedger(dshHome, skillsRoot);
  assert.equal(facts.entries.has('own-install'), true, 'installs[].name 被收录');
  assert.equal(facts.entries.has('own-skill'), true, 'skills{} 的键被收录');
});

test('损坏的台账降级成诊断，绝不让读取失败', async () => {
  const dshHome = join(home.dir, 'home-broken');
  await mkdir(join(dshHome, 'skills-manager'), { recursive: true });
  await writeFile(join(dshHome, 'skills-manager', 'repositories.json'), '{"installs":[', 'utf8');
  const facts = await readLedger(dshHome, skillsRoot);
  assert.equal(facts.entries.size, 0, '非法 JSON 不贡献任何条目');
  assert.deepEqual(facts.diagnostics, ['ledger-unreadable:skills-manager'], '降级诊断点名了那个台账');
});

test('超过 1 MiB 的台账视为不可读', async () => {
  const dshHome = join(home.dir, 'home-huge');
  await mkdir(join(dshHome, 'dsh-skill-market'), { recursive: true });
  await writeFile(join(dshHome, 'dsh-skill-market', 'installed.json'), `{"a":"${'x'.repeat(1024 * 1024 + 10)}"}`, 'utf8');
  const facts = await readLedger(dshHome, skillsRoot);
  assert.equal(facts.entries.size, 0, '超大台账不贡献条目');
  assert.deepEqual(facts.diagnostics, ['ledger-unreadable:dsh-skill-market'], '超大台账记一条降级诊断');
});

test('台账目录不存在时整条路径静默跳过', async () => {
  const facts = await readLedger(join(home.dir, 'home-empty'), skillsRoot);
  assert.deepEqual(facts.diagnostics, [], '目录不存在不产生诊断');
  assert.deepEqual(facts.sources, [], '目录不存在没有应答者');
});
