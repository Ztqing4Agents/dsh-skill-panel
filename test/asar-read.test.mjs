/**
 * `scripts/asar-read.mjs` — the data section of an asar starts at `8 + headerSize`, not at
 * `16 + jsonLength`.
 *
 * Contract: docs/reference/host-plugin-page.md §1.1 records the archive geometry
 * ("`u32@4 = headerSize`、`u32@12 = jsonLen`、JSON 从 byte 16 起、内容区 = `8 + headerSize`");
 * docs/contracts/acceptance.md 附录 D.14 carries this case as K152.
 *
 * Why this file exists: `scripts/asar-read.mjs` used to start the data section at
 * `16 + jsonLength`, which drops the 4-byte alignment padding that `headerSize` already
 * carries. Every file offset then lands 1–3 bytes early and the reader returns shifted
 * bytes. It stayed invisible for a whole host generation because `0.2.2-rc.5` happened to
 * have a `jsonLength` that was a multiple of four — the two formulas agree and the bug
 * cannot show. `0.2.3-alpha.2` (`jsonLen = 5 742 345`) is not: the script then printed
 * "skip — cannot read dsh/package.json" and exited **2** — the *environment missing* branch
 * (`missingEnvironment()` in `HEAD`'s copy of the script; measured directly, the code is not
 * 0), so the failure read as "the host is not installed" instead of "our reader is wrong",
 * and a `| tail` pipeline hides the code anyway. `check-version.mjs` crashed at the same time.
 * A test that only built an aligned fixture would have reproduced the rc.5 blind spot, so
 * every fixture here tunes `jsonLength % 4` to 1, 2 and 3 (plus one aligned control) and
 * *also* reads through the old formula to show the bytes differ.
 *
 * The fixtures are assembled by hand rather than with `@electron/asar`: the layout under test
 * is the layout the reader assumes, and a helper that hides it would let both drift together.
 * Layout used (the one `@electron/asar` writes):
 *
 *   0–3    u32  4                     (pickle: length of the header-size field)
 *   4–7    u32  headerSize            (= align4(8 + jsonLength), what the reader keys on)
 *   8–11   u32  jsonLength + 4        (inner pickle payload length)
 *   12–15  u32  jsonLength            (directory JSON length, what the reader parses)
 *   16…    JSON text, then zero padding up to `8 + headerSize`
 *   rest   file blobs, `offset` relative to the data section start
 */
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listAsarEntries, readAsarFile, readAsarJson } from '../scripts/asar-read.mjs';

/** Round up to a multiple of four — the padding `headerSize` already includes. */
const align4 = (n) => (n + 3) & ~3;

/** The three files every fixture carries; the last one is empty on purpose. */
const CONTENTS = new Map([
  ['dsh/package.json', Buffer.from(`${JSON.stringify({ name: 'mini-host', version: '0.2.3-alpha.2' })}\n`, 'utf8')],
  ['dsh/hello.txt', Buffer.from('hello from inside the archive\n', 'utf8')],
  ['assets/empty.bin', Buffer.alloc(0)],
]);

/**
 * Build the directory JSON for an ordered file list, assigning offsets from zero.
 *
 * @param {[string, Buffer][]} files - path / content pairs, in data-section order.
 * @returns {{json: string, offsets: Map<string, number>}} JSON text and each entry's offset.
 */
function directoryJson(files) {
  const root = { files: {} };
  const offsets = new Map();
  let offset = 0;
  for (const [path, data] of files) {
    const parts = path.split('/');
    let node = root;
    for (const dir of parts.slice(0, -1)) {
      node.files[dir] ??= { files: {} };
      node = node.files[dir];
    }
    node.files[parts.at(-1)] = { size: data.length, offset };
    offsets.set(path, offset);
    offset += data.length;
  }
  return { json: JSON.stringify(root), offsets };
}

/**
 * Assemble one miniature asar whose `jsonLength % 4` equals `mod`.
 *
 * The tuning knob is a harmless empty file whose *name* is lengthened by 0–3 characters: a
 * longer name lengthens the JSON by exactly one byte, so one measurement plus one adjustment
 * lands on the requested residue without touching any real entry.
 *
 * @param {number} mod - wanted residue of `jsonLength` modulo four (0–3).
 * @returns {{buffer: Buffer, dataStart: number, jsonLength: number, headerSize: number,
 *   naiveStart: number, files: [string, Buffer][], offsets: Map<string, number>}} byte image and geometry.
 */
function buildAsar(mod) {
  const name = (filler) => `pad-${'x'.repeat(filler)}.txt`;
  const withFiller = (filler) => [...CONTENTS, [name(filler), Buffer.alloc(0)]];

  const probe = directoryJson(withFiller(0)).json;
  const filler = (mod - (Buffer.byteLength(probe) % 4) + 4) % 4;
  const files = withFiller(filler);
  const { json, offsets } = directoryJson(files);

  const jsonBuffer = Buffer.from(json, 'utf8');
  const jsonLength = jsonBuffer.length;
  assert.equal(jsonLength % 4, mod, 'fixture premise: jsonLength sits on the requested residue');

  const headerSize = align4(8 + jsonLength);
  const dataStart = 8 + headerSize;
  const dataBytes = files.reduce((sum, [, data]) => sum + data.length, 0);
  const buffer = Buffer.alloc(dataStart + dataBytes);

  buffer.writeUInt32LE(4, 0);
  buffer.writeUInt32LE(headerSize, 4);
  buffer.writeUInt32LE(jsonLength + 4, 8);
  buffer.writeUInt32LE(jsonLength, 12);
  jsonBuffer.copy(buffer, 16);

  for (const [path, data] of files) data.copy(buffer, dataStart + offsets.get(path));

  return { buffer, dataStart, jsonLength, headerSize, naiveStart: 16 + jsonLength, files, offsets };
}

/** One temp directory per run; the archives live in it for the whole file. */
let dir;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skc-asar-'));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * Write one fixture and hand back its path plus geometry.
 *
 * @param {number} mod - wanted `jsonLength % 4`.
 * @returns {Promise<{path: string, built: ReturnType<typeof buildAsar>}>} fixture on disk.
 */
async function fixture(mod) {
  const built = buildAsar(mod);
  const path = join(dir, `mini-mod${mod}.asar`);
  await writeFile(path, built.buffer);
  return { path, built };
}

test('K152 夹具自检：四份 asar 的 jsonLength % 4 分别是 0 / 1 / 2 / 3（bug 只在后三档暴露）', async () => {
  for (const mod of [0, 1, 2, 3]) {
    const { path, built } = await fixture(mod);
    const bytes = await readFile(path);
    assert.equal(bytes.readUInt32LE(12), built.jsonLength, `mod=${mod}：u32@12 就是目录 JSON 的长度`);
    assert.equal(built.jsonLength % 4, mod, `mod=${mod}：夹具落在目标档位`);
    assert.equal(bytes.readUInt32LE(4), built.headerSize, `mod=${mod}：u32@4 就是 headerSize`);
    const padding = (4 - mod) % 4;
    assert.equal(built.headerSize - (8 + built.jsonLength), padding, `mod=${mod}：对齐填充是 ${padding} 字节（headerSize 把它算进去了）`);
  }
});

test('K152 每一档都按目录表读回原字节：package.json / 文本 / 空文件', async () => {
  for (const mod of [1, 2, 3]) {
    const { path, built } = await fixture(mod);
    for (const [inner, expected] of CONTENTS) {
      const got = readAsarFile(path, inner);
      assert.equal(Buffer.isBuffer(got), true, `mod=${mod} ${inner}：读到了字节`);
      assert.deepEqual(got, expected, `mod=${mod} ${inner}：逐字节相等（这就是错位时会红的那条）`);
    }
    assert.equal(built.dataStart, 8 + built.headerSize, '数据区起点 = 8 + headerSize');
    assert.equal(built.dataStart, align4(16 + built.jsonLength), '也等于 align4(16 + jsonLength)');
  }
});

test('K152 前导斜杠与嵌套目录同样按目录表解析', async () => {
  const { path, built } = await fixture(1);
  assert.deepEqual(readAsarFile(path, '/dsh/hello.txt'), CONTENTS.get('dsh/hello.txt'), '带前导斜杠的路径');
  assert.deepEqual(readAsarFile(path, 'assets/empty.bin'), Buffer.alloc(0), '空文件读出零长度缓冲');
  const fillerName = built.files.at(-1)[0];
  assert.deepEqual(listAsarEntries(path).sort(), [...CONTENTS.keys(), fillerName].sort(), '目录表列出全部普通文件');
});

test('K152 readAsarJson 在三种非对齐档位都能取回对象', async () => {
  for (const mod of [1, 2, 3]) {
    const { path } = await fixture(mod);
    const manifest = readAsarJson(path, 'dsh/package.json');
    assert.deepEqual(manifest, { name: 'mini-host', version: '0.2.3-alpha.2' }, `mod=${mod}：JSON 解析成功`);
  }
});

test('K152 旧公式 `16 + jsonLength` 在这三档上读出错位字节（夹具会咬人）', async () => {
  for (const mod of [1, 2, 3]) {
    const { path, built } = await fixture(mod);
    const padding = (4 - mod) % 4;
    assert.notEqual(built.naiveStart, built.dataStart, `mod=${mod}：两个起点相差 ${padding} 字节`);
    assert.equal(built.dataStart - built.naiveStart, padding, `mod=${mod}：差的正是对齐填充`);

    const bytes = await readFile(path);
    for (const [inner, expected] of CONTENTS) {
      if (expected.length === 0) continue; // 空文件错位也读不出差别，说明不了问题
      const from = built.naiveStart + built.offsets.get(inner);
      const naive = bytes.subarray(from, from + expected.length);
      assert.notDeepEqual(naive, expected, `mod=${mod} ${inner}：从旧起点读出来的不是原字节`);
    }

    // 真实的失败形态：错位 1–3 字节的 JSON 首部读不出合法对象。
    const naiveJson = bytes.subarray(built.naiveStart, built.naiveStart + built.jsonLength).toString('utf8');
    assert.throws(() => JSON.parse(naiveJson), `mod=${mod}：错位后 JSON.parse 抛错（那版脚本读到的就是这个）`);
  }
});

test('K152 对齐档位（jsonLength % 4 === 0）两条公式给出同一起点——rc.5 从未炸过的原因', async () => {
  const { path, built } = await fixture(0);
  assert.equal(built.naiveStart, built.dataStart, '对齐时 16 + jsonLength === 8 + headerSize');
  assert.deepEqual(readAsarFile(path, 'dsh/package.json'), CONTENTS.get('dsh/package.json'), '对齐时也读得对');
});

test('K152 缺件一律回 null，不抛错', async () => {
  const { path } = await fixture(2);
  assert.equal(readAsarFile(path, 'dsh/nope.json'), null, '目录表里没有的路径');
  assert.equal(readAsarJson(path, 'dsh/nope.json'), null, '缺失的 JSON 文件');
  assert.equal(readAsarJson(path, 'dsh/hello.txt'), null, '不是 JSON 的文件');
  assert.equal(readAsarFile(join(dir, 'missing.asar'), 'dsh/package.json'), null, 'asar 本身不存在');
  assert.equal(readAsarJson(join(dir, 'missing.asar'), 'dsh/package.json'), null, 'asar 不存在时的 JSON 读取');
  assert.deepEqual(listAsarEntries(join(dir, 'missing.asar')), [], 'asar 不存在时列出空表');
});
