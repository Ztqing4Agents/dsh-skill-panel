/**
 * `lib/provider-toggles.js` — the panel-owned switch store for provider skills.
 *
 * Contract: docs/contracts/routes.md §3.4.4; case ids K15 (degradation) and K16 (idempotency).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { deserialize, read, serialize, setEnabled } from '../lib/provider-toggles.js';
import { tempDir } from './helpers/tree.mjs';

/**
 * A DSH home with a store file holding `raw`.
 * @param {string} raw - store file contents, or undefined for no file at all.
 * @returns {Promise<{dshHome: string, file: string, cleanup: Function}>} the home.
 */
async function homeWith(raw) {
  const { dir, cleanup } = await tempDir();
  const file = join(dir, 'dsh-skill-panel', 'provider-toggles.json');
  if (raw !== undefined) {
    await mkdir(join(dir, 'dsh-skill-panel'), { recursive: true });
    await writeFile(file, raw, 'utf8');
  }
  return { dshHome: dir, file, cleanup };
}

test('K15 存储缺失时视为全部启用', async () => {
  const home = await homeWith(undefined);
  try {
    const doc = await read(home.dshHome);
    assert.deepEqual(doc.disabled, [], '没有文件时停用集合为空');
    assert.deepEqual(doc.diagnostics, [], '没有文件不是降级');
  } finally {
    await home.cleanup();
  }
});

test('K15 四种损坏形态都降级成空集并留诊断', async () => {
  const cases = [
    ['{', 'provider-toggles:invalid-json', '半个 JSON'],
    ['[]', 'provider-toggles:not-an-object', '顶层是数组'],
    ['{"version":9,"disabled":[]}', 'provider-toggles:version', '版本号不是 1'],
    ['{"version":1,"disabled":{}}', 'provider-toggles:disabled', 'disabled 不是数组'],
  ];
  for (const [raw, expected, label] of cases) {
    const home = await homeWith(raw);
    try {
      const doc = await read(home.dshHome);
      assert.deepEqual(doc.disabled, [], `${label}：停用集合为空`);
      assert.deepEqual(doc.diagnostics, [expected], `${label}：诊断是 ${expected}`);
    } finally {
      await home.cleanup();
    }
  }
});

test('K15 超过 64 KiB 的存储被视为损坏', async () => {
  const home = await homeWith(`{"version":1,"disabled":[],"pad":"${'x'.repeat(65536 + 10)}"}`);
  try {
    const doc = await read(home.dshHome);
    assert.deepEqual(doc.disabled, [], '超大存储不贡献停用项');
    assert.deepEqual(doc.diagnostics, ['provider-toggles:too-large'], '诊断点名 too-large');
  } finally {
    await home.cleanup();
  }
});

test('单条不合规格的记录被丢弃并留诊断，其余保留', () => {
  const doc = deserialize(JSON.stringify({
    version: 1,
    disabled: [
      { provider: 'runtime', name: 'office' },
      { provider: 'runtime', name: 'Bad_Name' },
      { provider: 'x'.repeat(80), name: 'office' },
      'not-an-object',
    ],
  }));
  assert.deepEqual(doc.disabled, [{ provider: 'runtime', name: 'office' }], '只有合规格那条被保留');
  assert.deepEqual(doc.diagnostics, ['provider-toggles:entries'], '被丢弃的条目记一条诊断');
});

test('provider 缺失归一成空串（区分于 undefined）', () => {
  const doc = deserialize(JSON.stringify({ version: 1, disabled: [{ name: 'office' }] }));
  assert.deepEqual(doc.disabled, [{ provider: '', name: 'office' }], '缺 provider 的记录归一成空串');
});

test('序列化按 provider 再按 name 排序，并以换行结尾', () => {
  const text = serialize({ disabled: [
    { provider: 'runtime', name: 'zeta' },
    { provider: 'a-provider', name: 'beta' },
    { provider: 'runtime', name: 'alpha' },
  ] });
  const parsed = JSON.parse(text);
  assert.deepEqual(parsed.disabled.map((entry) => `${entry.provider}#${entry.name}`), ['a-provider#beta', 'runtime#alpha', 'runtime#zeta'], '排序稳定');
  assert.equal(text.endsWith('\n'), true, '文件以换行结尾');
  assert.equal(parsed.version, 1, '写出 version 1');
});

test('K16 连续两次停用同一身份，文件里只有一条', async () => {
  const home = await homeWith(undefined);
  try {
    await setEnabled(home.dshHome, { provider: 'runtime', name: 'office' }, false);
    await setEnabled(home.dshHome, { provider: 'runtime', name: 'office' }, false);
    const parsed = JSON.parse(await readFile(home.file, 'utf8'));
    assert.equal(parsed.disabled.length, 1, '同一个身份在磁盘上只有一条');
    assert.deepEqual(parsed.disabled[0], { provider: 'runtime', name: 'office' }, '留下的那条就是被停用的身份');
  } finally {
    await home.cleanup();
  }
});

test('K16 启用一个不存在的身份不写盘', async () => {
  const home = await homeWith(undefined);
  try {
    await setEnabled(home.dshHome, { provider: 'runtime', name: 'office' }, false);
    const before = await readFile(home.file);
    await setEnabled(home.dshHome, { provider: 'runtime', name: 'not-there' }, true);
    const after = await readFile(home.file);
    assert.equal(after.equals(before), true, '启用不存在身份后文件字节不变');
  } finally {
    await home.cleanup();
  }
});

test('停用再加启用回到空集合，文件仍存在且为空数组', async () => {
  const home = await homeWith(undefined);
  try {
    await setEnabled(home.dshHome, { provider: 'runtime', name: 'office' }, false);
    await setEnabled(home.dshHome, { provider: 'runtime', name: 'office' }, true);
    const parsed = JSON.parse(await readFile(home.file, 'utf8'));
    assert.deepEqual(parsed.disabled, [], '来回切换后停用集合为空');
  } finally {
    await home.cleanup();
  }
});

test('写盘失败时抛 E_WRITE_FAILED，而不是静默成功', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const blocker = join(dir, 'blocked');
    await writeFile(blocker, 'not a directory', 'utf8');
    await assert.rejects(
      setEnabled(blocker, { provider: 'runtime', name: 'office' }, false),
      (error) => error.code === 'E_WRITE_FAILED',
      'dshHome 指向文件时写入失败并带 E_WRITE_FAILED',
    );
  } finally {
    await cleanup();
  }
});
