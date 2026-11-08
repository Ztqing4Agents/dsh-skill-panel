/**
 * `lib/write-skill.js` — fingerprint, temp file, fsync, rename, read back, roll back.
 *
 * Contract: docs/contracts/routes.md §3.4.3; case ids K13 (atomic write + rollback on
 * failure) and the "symlink is never written" half of the three-layer fence.
 *
 * Every case works on a copy: the fixtures are read-only inputs.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, lstat, mkdir, readdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { writeDisableFlag } from '../lib/write-skill.js';
import { copyFixtureTree, customTree, skillFile, tempDir } from './helpers/tree.mjs';

/** The field the writer owns, spelled out once. */
const FIELD = 'disable-model-invocation';

test('写入停用位：文件里出现该键，正文与其它键逐字不变', async () => {
  const tree = await customTree({ 'hand-made': skillFile({ name: 'hand-made', extra: ['version: "1.0.0"'] }) });
  try {
    const file = join(tree.skillsRoot, 'hand-made', 'SKILL.md');
    const before = await readFile(file);
    const result = await writeDisableFlag(file, true);
    const after = await readFile(file);
    assert.equal(result.changed, true, '缺键时发生写入');
    assert.equal(result.disableModelInvocation, true, '写入后该字段为 true');
    assert.equal(after.toString('utf8').includes(`${FIELD}: true`), true, '文件里出现停用键');
    const beforeLines = before.toString('utf8').split('\n');
    const afterLines = after.toString('utf8').split('\n');
    assert.equal(afterLines.length, beforeLines.length + 1, '只多出一行');
    const at = afterLines.findIndex((line, index) => line !== beforeLines[index]);
    assert.deepEqual(afterLines.slice(0, at), beforeLines.slice(0, at), '插入点之前的行逐字不变');
    assert.deepEqual(afterLines.slice(at + 1), beforeLines.slice(at), '插入点之后的行原样后移');
  } finally {
    await tree.cleanup();
  }
});

test('CRLF 技能改写后仍全 CRLF，且只有一行变化', async () => {
  const tree = await copyFixtureTree('skills-crlf');
  try {
    const file = join(tree.skillsRoot, 'indiv-guipi--find-skills', 'SKILL.md');
    const before = await readFile(file);
    await writeDisableFlag(file, true);
    const after = await readFile(file);
    const text = after.toString('utf8');
    assert.equal(/[^\r]\n/.test(text), false, '改写后没有裸换行');
    const at = text.split('\r\n').findIndex((line) => line === `${FIELD}: true`);
    assert.notEqual(at, -1, '插入的停用行存在');
    assert.equal(after.length - before.length, `${FIELD}: true`.length + 2, '只增加了一行（含 CRLF）');
  } finally {
    await tree.cleanup();
  }
});

test('幂等：第二次写同样的值不落盘（changed=false）', async () => {
  const tree = await customTree({ 'twice': skillFile({ name: 'twice' }) });
  try {
    const file = join(tree.skillsRoot, 'twice', 'SKILL.md');
    await writeDisableFlag(file, true);
    const first = await readFile(file);
    const second = await writeDisableFlag(file, true);
    const after = await readFile(file);
    assert.equal(second.changed, false, '第二次写入报告未变更');
    assert.equal(after.equals(first), true, '第二次写入不改字节');
  } finally {
    await tree.cleanup();
  }
});

test('保留原文件权限位（rename 会换 inode，mode 必须显式带过去）', async () => {
  const tree = await customTree({ 'mode-skill': skillFile({ name: 'mode-skill' }) });
  try {
    const file = join(tree.skillsRoot, 'mode-skill', 'SKILL.md');
    await chmod(file, 0o600);
    await writeDisableFlag(file, true);
    const info = await stat(file);
    assert.equal(info.mode & 0o777, 0o600, '写回后仍是 0600，没有被放大成 0666');
  } finally {
    await tree.cleanup();
  }
});

test('临时文件不残留：写完目录里只剩 SKILL.md', async () => {
  const tree = await customTree({ 'clean-skill': skillFile({ name: 'clean-skill' }) });
  try {
    const dir = join(tree.skillsRoot, 'clean-skill');
    await writeDisableFlag(join(dir, 'SKILL.md'), true);
    const names = await readdir(dir);
    assert.deepEqual(names, ['SKILL.md'], '目录里没有 .tmp 残留');
  } finally {
    await tree.cleanup();
  }
});

test('软链目标一律只读：E_SYMLINK_READONLY 且目标字节前后完全相同', async () => {
  const tree = await copyFixtureTree('skills-symlink');
  try {
    const linked = join(tree.skillsRoot, 'dev-docs-standards', 'SKILL.md');
    const target = join(tree.dshHome, 'target-repo', 'SKILL.md');
    const before = await readFile(target);
    await assert.rejects(
      writeDisableFlag(linked, true),
      (error) => error.code === 'E_SYMLINK_READONLY',
      '对软链技能写入抛出 E_SYMLINK_READONLY',
    );
    const after = await readFile(target);
    assert.equal(after.equals(before), true, '链接目标的字节完全没变');
  } finally {
    await tree.cleanup();
  }
});

test('没有 frontmatter 的文件映射成 E_NOT_WRITABLE，绝不新建块', async () => {
  const tree = await customTree({ 'no-block': '# heading only\n' });
  try {
    const file = join(tree.skillsRoot, 'no-block', 'SKILL.md');
    const before = await readFile(file);
    await assert.rejects(
      writeDisableFlag(file, true),
      (error) => error.code === 'E_NOT_WRITABLE',
      '没有 frontmatter 时抛出 E_NOT_WRITABLE',
    );
    const after = await readFile(file);
    assert.equal(after.equals(before), true, '失败后原文件字节不变');
  } finally {
    await tree.cleanup();
  }
});

test('目标文件读不到时映射成 E_WRITE_FAILED', async () => {
  const tree = await customTree({ 'gone': skillFile({ name: 'gone' }) });
  try {
    const file = join(tree.skillsRoot, 'gone', 'SKILL.md');
    await assert.rejects(
      writeDisableFlag(join(tree.skillsRoot, 'gone', 'SKILL.md.bak'), true),
      (error) => error.code === 'E_WRITE_FAILED',
      'SKILL.md 不存在时抛出 E_WRITE_FAILED',
    );
    assert.equal(await readFile(file, 'utf8').then((text) => text.includes(FIELD)), false, '真实文件没有被写');
  } finally {
    await tree.cleanup();
  }
});

test('目录不是可读目录时映射成 E_NOT_WRITABLE', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const file = join(dir, 'missing-dir', 'SKILL.md');
    await assert.rejects(
      writeDisableFlag(file, true),
      (error) => error.code === 'E_NOT_WRITABLE',
      '父目录不存在时抛出 E_NOT_WRITABLE',
    );
  } finally {
    await cleanup();
  }
});

test('写入后回读一致：解析出的字段等于目标值', async () => {
  const tree = await customTree({ 'verify-skill': skillFile({ name: 'verify-skill', extra: ['disable-model-invocation: false'] }) });
  try {
    const file = join(tree.skillsRoot, 'verify-skill', 'SKILL.md');
    const result = await writeDisableFlag(file, true);
    assert.equal(result.path, file, '返回值带写过的绝对路径');
    const text = await readFile(file, 'utf8');
    assert.equal(text.includes(`${FIELD}: true`), true, '磁盘上的字段是 true');
    const info = await lstat(file);
    assert.equal(info.isFile(), true, '结果是普通文件（rename 之后仍是文件）');
  } finally {
    await tree.cleanup();
  }
});

test('软链目录里的真实文件也拒绝写（双保险在写入层）', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const real = join(dir, 'real');
    await mkdir(real, { recursive: true });
    await writeFile(join(real, 'SKILL.md'), skillFile({ name: 'real-skill' }));
    await symlink(real, join(dir, 'linked'));
    const before = await readFile(join(real, 'SKILL.md'));
    await assert.rejects(
      writeDisableFlag(join(dir, 'linked', 'SKILL.md'), true),
      (error) => error.code === 'E_SYMLINK_READONLY',
      '即使调用方漏了路由层的拦截，写入层也拒绝',
    );
    const after = await readFile(join(real, 'SKILL.md'));
    assert.equal(after.equals(before), true, '真实文件字节不变');
  } finally {
    await cleanup();
  }
});

test('KI-3 SKILL.md 本身是软链时直接 E_SYMLINK_READONLY，不再误报并发编辑', async () => {
  // 修复前：写入层用 fstat(已打开的句柄) 取指纹、却用 lstat(路径) 复核，两条路径的 inode
  // 在「SKILL.md 是软链」时天然不同，于是被当成并发编辑拒成 E_FILE_CHANGED（fail-safe，
  // 字节没被改）。现在先用 lstat 认路本身的软链，指纹复核也统一走 lstat 口径。
  const { dir, cleanup } = await tempDir();
  try {
    const skills = join(dir, 'skills');
    await mkdir(join(skills, 'link-file'), { recursive: true });
    await writeFile(join(dir, 'shared.md'), skillFile({ name: 'link-file' }));
    await symlink(join(dir, 'shared.md'), join(skills, 'link-file', 'SKILL.md'));
    const sharedBefore = await readFile(join(dir, 'shared.md'));
    await assert.rejects(
      writeDisableFlag(join(skills, 'link-file', 'SKILL.md'), true),
      (error) => error.code === 'E_SYMLINK_READONLY',
      '软链文件按只读拒绝，错误码是 E_SYMLINK_READONLY',
    );
    const sharedAfter = await readFile(join(dir, 'shared.md'));
    assert.equal(sharedAfter.equals(sharedBefore), true, '链接目标的字节没有被改（fail-safe）');
    const info = await lstat(join(skills, 'link-file', 'SKILL.md'));
    assert.equal(info.isSymbolicLink(), true, '软链本身也没有被替换成普通文件');
  } finally {
    await cleanup();
  }
});

test('文件不可读时映射成 E_WRITE_FAILED，且原文件字节不变', async () => {
  const tree = await customTree({ 'unreadable': skillFile({ name: 'unreadable' }) });
  try {
    const file = join(tree.skillsRoot, 'unreadable', 'SKILL.md');
    await chmod(file, 0o000);
    const before = await readFile(file).catch(() => null);
    await assert.rejects(
      writeDisableFlag(file, true),
      (error) => error.code === 'E_WRITE_FAILED',
      '权限不足读不到文件时抛出 E_WRITE_FAILED',
    );
    await chmod(file, 0o600);
    const after = await readFile(file);
    assert.equal(after.toString('utf8').includes(FIELD), false, '失败后文件里没有出现新字段');
    assert.equal(before, null, '（前置条件）0000 权限下连 QA 自己都读不到，说明这条确实走到了读失败分支');
  } finally {
    await tree.cleanup();
  }
});

test('目录不可写时落盘失败映射成 E_WRITE_FAILED，原文件与目录内容都不变', async () => {
  const tree = await customTree({ 'readonly-dir': skillFile({ name: 'readonly-dir' }) });
  try {
    const dir = join(tree.skillsRoot, 'readonly-dir');
    const file = join(dir, 'SKILL.md');
    const before = await readFile(file);
    await chmod(dir, 0o555);
    try {
      await assert.rejects(
        writeDisableFlag(file, true),
        (error) => error.code === 'E_WRITE_FAILED',
        '目录只读时写临时文件失败，抛出 E_WRITE_FAILED',
      );
    } finally {
      await chmod(dir, 0o755);
    }
    const after = await readFile(file);
    assert.equal(after.equals(before), true, '失败后原文件字节不变');
    assert.deepEqual(await readdir(dir), ['SKILL.md'], '失败后没有留下临时文件');
  } finally {
    await tree.cleanup();
  }
});
