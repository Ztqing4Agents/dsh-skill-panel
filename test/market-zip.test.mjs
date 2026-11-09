/**
 * `lib/market/zip.js` — the reader that stands between a third-party archive and disk.
 *
 * Contract: docs/contracts/routes.md §3.7.4 (package safety bounds, last paragraph) and
 * docs/contracts/market.md §7.2 (ClawHub packages arrive as a zip); case id K33.
 *
 * Every case here is a *refusal*: an archive that ships a symlink, escapes the target
 * directory, lies about a checksum or tries to expand into gigabytes must fail as a
 * whole (`E_PACKAGE_INVALID`), not be silently repaired. The one happy path proves the
 * reader is not refusing everything.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { ZIP_LIMITS, crc32, readZipEntries, readZipEntry, readZipEntryAt } from '../lib/market/zip.js';
import { buildZip, crc32Of } from './helpers/zip.mjs';

/**
 * Assert that a call fails with `E_PACKAGE_INVALID`.
 * @param {Function} run - the call under test.
 * @param {string} hint - what should have been refused.
 * @returns {object} the thrown error.
 */
function refused(run, hint) {
  try {
    run();
  } catch (error) {
    assert.equal(error.code, 'E_PACKAGE_INVALID', `${hint}：应是 E_PACKAGE_INVALID（实际 ${error.code}）`);
    assert.equal(error.name, 'MarketError', `${hint}：抛的是 MarketError`);
    return error;
  }
  assert.fail(`${hint}：应当整包拒绝，但没有抛错`);
  return null;
}

test('K33 两个限值与契约一致：200 条目 / 单文件 5 MiB / 解压总量 20 MiB / 压缩体 40 MiB', () => {
  assert.deepEqual(ZIP_LIMITS, {
    entries: 200,
    file: 5 * 1024 * 1024,
    total: 20 * 1024 * 1024,
    archive: 40 * 1024 * 1024,
  }, '四个上限逐字取自 routes.md §3.7.4');
});

test('K33 存储（method 0）与 deflate（method 8）都能读回原始字节，CRC 一致', () => {
  const text = '# SKILL.md\n\nname: dev-god\n';
  const archive = buildZip([
    { path: 'SKILL.md', data: text },
    { path: 'scripts/run.md', data: 'x'.repeat(5000), method: 8 },
  ]);
  const entries = readZipEntries(archive);
  assert.deepEqual(entries.map((entry) => entry.path), ['SKILL.md', 'scripts/run.md'], '两个条目按中央目录顺序');
  assert.equal(readZipEntryAt(archive, entries, 'SKILL.md').toString('utf8'), text, 'store 条目原样读回');
  assert.equal(readZipEntryAt(archive, entries, 'scripts/run.md').toString('utf8'), 'x'.repeat(5000), 'deflate 条目解压正确');
  assert.equal(entries[0].method, 0, '第一条是 store');
  assert.equal(entries[1].method, 8, '第二条是 deflate');
  assert.equal(entries[0].size, Buffer.byteLength(text), '声明尺寸等于真实尺寸');
  assert.equal(crc32Of(Buffer.from(text, 'utf8')), crc32(Buffer.from(text, 'utf8')), '两个实现算出的 CRC32 一致');
});

test('K33 目录条目被跳过（不是文件），路径仍是包内相对路径', () => {
  const archive = buildZip([
    { path: 'SKILL.md', data: 'body' },
    { path: 'docs/', dir: true },
    { path: 'docs/a.md', data: 'a' },
  ]);
  const entries = readZipEntries(archive);
  assert.deepEqual(entries.map((entry) => entry.path), ['SKILL.md', 'docs/a.md'], '以 / 结尾的目录条目不进清单');
});

test('K33 zip-slip：../ 与绝对路径条目整包拒绝', () => {
  for (const path of ['../evil.md', 'a/../../evil.md', '/etc/passwd', 'C:/Windows/x.md', 'a\\b.md']) {
    const archive = buildZip([{ path: 'SKILL.md', data: 'body' }, { path, data: 'x' }]);
    const error = refused(() => readZipEntries(archive), `条目路径 ${JSON.stringify(path)}`);
    assert.equal(error.message.includes('outside the package'), true, '错误信息点明路径越界（便于排查是哪个包）');
  }
});

test('K33 符号链接条目整包拒绝（不是跳过该条目）', () => {
  const archive = buildZip([
    { path: 'SKILL.md', data: 'body' },
    { path: 'link.md', data: '/etc/passwd', unixMode: 0o120777 },
  ]);
  const error = refused(() => readZipEntries(archive), '符号链接条目');
  assert.equal(error.message.includes('symbolic link'), true, '错误信息点明符号链接');
});

test('K33 加密条目整包拒绝（读者永不实现解密）', () => {
  const archive = buildZip([{ path: 'SKILL.md', data: 'body', flags: 0x1 }]);
  const error = refused(() => readZipEntries(archive), '通用标志位 bit0 = 加密');
  assert.equal(error.message.includes('encrypted'), true, '错误信息点明加密');
});

test('K33 只接受 store 与 deflate：其它压缩方法整包拒绝', () => {
  for (const method of [1, 9, 12, 14]) {
    const archive = buildZip([{ path: 'SKILL.md', data: 'body', method: 0, size: 4, compSize: 4 }]);
    // 改写中央目录里的 method 字段（偏移 = EOCD 之前 46 + 10）。
    const centralOffset = archive.length - 22 - 46 - 'SKILL.md'.length;
    archive.writeUInt16LE(method, centralOffset + 10);
    const error = refused(() => readZipEntries(archive), `压缩方法 ${method}`);
    assert.equal(error.message.includes('unsupported compression method'), true, '错误信息点明压缩方法');
  }
});

test('K33 校验和不符与尺寸不符都在读取该条目时拒绝', () => {
  const body = Buffer.from('the real bytes');
  const badCrc = buildZip([{ path: 'SKILL.md', data: body, crc: (crc32Of(body) ^ 0xffffffff) >>> 0 }]);
  const crcEntries = readZipEntries(badCrc);
  const crcError = refused(() => readZipEntry(badCrc, crcEntries[0]), 'CRC 不符');
  assert.equal(crcError.message.includes('checksum'), true, '错误信息点明校验和');

  const shortBody = buildZip([{ path: 'SKILL.md', data: body, size: body.length + 3 }]);
  const sizeEntries = readZipEntries(shortBody);
  const sizeError = refused(() => readZipEntry(shortBody, sizeEntries[0]), '声明尺寸大于真实尺寸');
  assert.equal(sizeError.message.includes('two different sizes'), true, '错误信息点明 store 条目的两个尺寸自相矛盾');

  const storedLies = buildZip([{ path: 'SKILL.md', data: body, compSize: body.length + 1, size: body.length + 1 }]);
  const liedEntries = readZipEntries(storedLies);
  refused(() => readZipEntry(storedLies, liedEntries[0]), 'store 条目的两个尺寸互相矛盾');
});

test('K33 deflate 条目解压后尺寸不符也拒绝', () => {
  const archive = buildZip([{ path: 'SKILL.md', data: 'abcabcabc', method: 8, size: 99 }]);
  const entries = readZipEntries(archive);
  refused(() => readZipEntry(archive, entries[0]), 'deflate 声明尺寸与实际不符');
});

test('K33 条目数上限 200：正好 200 条通过，201 条整包拒绝', () => {
  const many = (count) => Array.from({ length: count }, (_, index) => ({
    path: `f${index}.md`,
    data: 'x',
  }));
  assert.equal(readZipEntries(buildZip(many(200))).length, 200, '200 条正好合法');
  const error = refused(() => readZipEntries(buildZip(many(201))), '201 个条目');
  assert.equal(error.message.includes('200'), true, '错误信息带上限值');
});

test('K33 单文件上限 5 MiB：声明值超限即拒绝（不必真给 5 MiB 数据）', () => {
  const archive = buildZip([{ path: 'huge.bin', data: 'x', size: 5 * 1024 * 1024 + 1 }]);
  const error = refused(() => readZipEntries(archive), '单文件声明 5 MiB + 1');
  assert.equal(error.message.includes('larger than'), true, '错误信息点明该条目过大');
});

test('K33 解压总量上限 20 MiB：逐条累加，超了整包拒绝', () => {
  const chunk = 4.5 * 1024 * 1024;
  const archive = buildZip(Array.from({ length: 5 }, (_, index) => ({
    path: `part${index}.bin`,
    data: 'x',
    size: chunk,
  })));
  const error = refused(() => readZipEntries(archive), '五条 4.5 MiB 声明（合计 22.5 MiB）');
  assert.equal(error.message.includes('expands beyond'), true, '错误信息点明解压总量');
});

test('K33 压缩体上限 40 MiB：超大 buffer 在读中央目录之前就被拒', () => {
  const oversized = Buffer.alloc(40 * 1024 * 1024 + 1);
  const error = refused(() => readZipEntries(oversized), '40 MiB + 1 的 buffer');
  assert.equal(error.message.includes('larger than'), true, '错误信息点明整包过大');
});

test('K33 结构非法一律拒绝：空 buffer、不是 zip、中央目录截断、签名错、没有条目', () => {
  refused(() => readZipEntries(Buffer.alloc(0)), '空 buffer');
  refused(() => readZipEntries(Buffer.from('this is not a zip file at all', 'utf8')), '不是 zip');
  refused(() => readZipEntries(Buffer.from([])), '无内容');
  const noEntries = buildZip([], { count: 0 });
  const error = refused(() => readZipEntries(noEntries), '零条目');
  assert.equal(error.message.includes('no entries'), true, '错误信息点明没有条目');

  const archive = buildZip([{ path: 'SKILL.md', data: 'body' }]);
  const truncated = archive.subarray(0, archive.length - 40);
  refused(() => readZipEntries(truncated), '中央目录被截断');

  const badSignature = buildZip([{ path: 'SKILL.md', data: 'body' }]);
  const centralOffset = badSignature.length - 22 - 46 - 'SKILL.md'.length;
  badSignature.writeUInt32LE(0xdeadbeef, centralOffset);
  const signatureError = refused(() => readZipEntries(badSignature), '中央目录签名错');
  assert.equal(signatureError.message.includes('signature'), true, '错误信息点明签名');
});

test('K33 声明条目数比中央目录多时拒绝（声明与实体不一致）', () => {
  const archive = buildZip([{ path: 'SKILL.md', data: 'body' }], { count: 2 });
  refused(() => readZipEntries(archive), '声明两条实际一条');
});

test('K33 同一条路径出现两次整包拒绝（不静默覆盖）', () => {
  const archive = buildZip([
    { path: 'SKILL.md', data: 'first' },
    { path: 'SKILL.md', data: 'second' },
  ]);
  const error = refused(() => readZipEntries(archive), '重复路径');
  assert.equal(error.message.includes('twice'), true, '错误信息点明重复路径');
});

test('K33 按路径取条目：清单里没有就拒绝，不会去猜', () => {
  const archive = buildZip([{ path: 'SKILL.md', data: 'body' }]);
  const entries = readZipEntries(archive);
  const error = refused(() => readZipEntryAt(archive, entries, 'README.md'), '清单外的路径');
  assert.equal(error.message.includes('does not contain'), true, '错误信息点明清单里没有这个文件');
});

test('K33 局部头偏移越界也拒绝（中央目录与实体不一致）', () => {
  const archive = buildZip([{ path: 'SKILL.md', data: 'body', offset: 999999 }]);
  refused(() => readZipEntries(archive), '局部头偏移指向包外');
});
