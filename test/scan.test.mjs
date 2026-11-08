/**
 * `lib/scan.js` — the only module that reads the skills directory.
 *
 * Contract: docs/contracts/routes.md §3.3.1 (symlink facts) and AGENTS.md rule 5;
 * case ids K11 (noise skipped) and K12 (symlink facts).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { scanUserSkills } from '../lib/scan.js';
import { FIXTURES, countBareLf, tempDir } from './helpers/tree.mjs';

/** Fixture tree helper. */
const fixture = (tree) => join(FIXTURES, tree);

test('K11 扫描跳过点文件、点目录、.system 与没有 SKILL.md 的目录', async () => {
  const rows = await scanUserSkills(fixture('skills-messy'));
  const dirNames = rows.map((row) => row.dirName);
  assert.equal(dirNames.includes('.DS_Store'), false, '.DS_Store 不是一行');
  assert.equal(dirNames.includes('.hidden-dir'), false, '点目录不是一行');
  assert.equal(dirNames.includes('.system'), false, '.system 子目录被跳过');
  assert.equal(dirNames.includes('empty-dir'), false, '没有 SKILL.md 的目录不是一行');
});

test('K11 扫描跳过没有 frontmatter、没有 description 与非法 name 的条目', async () => {
  const rows = await scanUserSkills(fixture('skills-messy'));
  const dirNames = rows.map((row) => row.dirName);
  assert.equal(dirNames.includes('no-frontmatter'), false, '没有 frontmatter 的目录不是一行');
  assert.equal(dirNames.includes('no-description'), false, '没有 description 的目录不是一行');
  assert.equal(dirNames.includes('Bad_Name'), false, '声明名不合文法时整条跳过');
});

test('K11 合法条目一条不少：长描述、带注释的停用、BOM、手写目录都在', async () => {
  const rows = await scanUserSkills(fixture('skills-messy'));
  const dirNames = rows.map((row) => row.dirName).sort();
  assert.deepEqual(dirNames, ['bom-skill', 'commented', 'folded-desc', 'hand-written', 'long-desc'], '五个合法条目全部保留');
  const commented = rows.find((row) => row.dirName === 'commented');
  assert.equal(commented.disableModelInvocation, true, '带行尾注释的 true 仍被读成停用');
  const bom = rows.find((row) => row.dirName === 'bom-skill');
  assert.equal(bom.declaredName, 'bom-skill', 'BOM 之后的 frontmatter 仍被解析');
});

test('K12 软链条目给出 symlink 事实、realPath 与真实文件路径', async () => {
  const rows = await scanUserSkills(fixture('skills-symlink'));
  assert.equal(rows.length, 1, '软链树里只有一条技能');
  const linked = rows[0];
  assert.equal(linked.symlink, true, 'lstat 认出这是软链');
  assert.equal(linked.dirName, 'dev-docs-standards', '条目名是链接名');
  assert.ok(linked.instructionPath.endsWith(join('target-repo', 'SKILL.md')), '指令文件路径解析到链接目标');
  assert.equal(linked.realPath, linked.instructionPath, '软链的 realPath 等于解析后的 SKILL.md 路径');
});

test('非软链条目的 realPath 为 null', async () => {
  const rows = await scanUserSkills(fixture('skills-plain'));
  assert.equal(rows.every((row) => row.realPath === null), true, '普通目录的 realPath 都是 null');
  assert.equal(rows.every((row) => row.symlink === false), true, '普通目录都不是软链');
});

test('扫描读出 CRLF 样本的 frontmatter，而不改动它的字节', async () => {
  const root = fixture('skills-crlf');
  const file = join(root, 'indiv-guipi--find-skills', 'SKILL.md');
  const before = await readFile(file);
  const rows = await scanUserSkills(root);
  const after = await readFile(file);
  assert.equal(rows.length, 1, 'CRLF 树里有一条技能');
  assert.equal(rows[0].declaredName, 'find-skills', 'CRLF frontmatter 被正确解析');
  assert.equal(countBareLf(before), 0, '样本文件本身没有裸换行');
  assert.equal(after.equals(before), true, '扫描不修改文件字节');
});

test('技能根不存在时返回空数组而不是抛错', async () => {
  assert.deepEqual(await scanUserSkills(join(FIXTURES, 'no-such-tree')), [], '根目录不存在时没有条目');
});

test('两种 _meta.json 写法给出对应的证据标记', async () => {
  const plain = await scanUserSkills(fixture('skills-plain'));
  const release = plain.find((row) => row.dirName === 'clawhub-wpank--ui-design');
  assert.equal(release.metaRelease, true, 'ownerId+slug 命中发布记录口径');
  assert.equal(release.metaSource, false, '没有 source 字段时不命中来源口径');
  const directoryOnly = plain.find((row) => row.dirName === 'indiv-guipi--find-skills');
  assert.equal(directoryOnly.metaRelease, false, '没有 _meta.json 时没有发布记录');
  assert.equal(directoryOnly.metaSource, false, '没有 _meta.json 时没有来源记录');
});

test('只有 _skillhub_meta.json 带 source 时命中来源口径', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const skillDir = join(dir, 'skills');
    await mkdir(join(skillDir, 'hub-skill'), { recursive: true });
    await writeFile(join(skillDir, 'hub-skill', 'SKILL.md'), '---\nname: hub-skill\ndescription: From the hub.\n---\n', 'utf8');
    await writeFile(join(skillDir, 'hub-skill', '_skillhub_meta.json'), '{"source":"github:deepseek-ai/skills"}', 'utf8');
    const rows = await scanUserSkills(skillDir);
    assert.equal(rows.length, 1, '技能被扫描到');
    assert.equal(rows[0].metaSource, true, 'source 字段命中来源口径');
    assert.equal(rows[0].metaEvidence, 'evidence.metaSource', '证据键指向 metaSource');
  } finally {
    await cleanup();
  }
});

test('K11 噪声口径不依赖被 .gitignore 的夹具：运行时造的点文件与 .system 同样被跳过', async () => {
  // `test/fixtures/skills-messy/.DS_Store` 是真实存在的夹具，但 `.gitignore` 里有
  // `.DS_Store`，新克隆里它会消失（那时上一组断言会变成空真）。这里在临时目录里重新造一份噪声，
  // 无论夹具在不在，这条判据都成立。
  const { dir, cleanup } = await tempDir();
  try {
    const root = join(dir, 'skills');
    await mkdir(join(root, '.system'), { recursive: true });
    await writeFile(join(root, '.DS_Store'), Buffer.from([0, 0, 0, 1]));
    await writeFile(join(root, 'README.md'), '# a stray file in the skills root\n');
    await mkdir(join(root, '.hidden-dir'), { recursive: true });
    await writeFile(join(root, '.hidden-dir', 'SKILL.md'), '---\nname: hidden-dir\ndescription: dot dir\n---\n');
    await writeFile(join(root, '.system', 'SKILL.md'), '---\nname: system-skill\ndescription: system\n---\n');
    await mkdir(join(root, 'real-skill'), { recursive: true });
    await writeFile(join(root, 'real-skill', 'SKILL.md'), '---\nname: real-skill\ndescription: A real one.\n---\n');

    const rows = await scanUserSkills(root);
    assert.deepEqual(rows.map((row) => row.dirName), ['real-skill'], '只有真技能被扫描到');
  } finally {
    await cleanup();
  }
});

test('KI-2 回归：扫描层把折叠标量折成一句话（不是 ">"）', async () => {
  const rows = await scanUserSkills(fixture('skills-messy'));
  const folded = rows.find((row) => row.dirName === 'folded-desc');
  assert.ok(folded !== undefined, '带折叠描述的技能被扫描到');
  assert.equal(
    folded.description,
    'Folded first sentence. Folded second sentence. Folded third sentence.\n',
    '行描述是三句以空格连接、末尾一个换行的正文，而不是一个 ">"',
  );
  assert.notEqual(folded.description, '>', '指示符本身没有被当成值');
});
