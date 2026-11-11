/**
 * Self-test for the board gate (`scripts/check-board.mjs`).
 *
 * A gate that is only ever seen green rots: every case here breaks a throwaway board on
 * purpose and asserts the gate turns red with the rule id. The board itself lives in
 * `.agents/work/` (gitignored), so the whole fixture tree is built under `mkdtemp` —
 * no real work scene is ever read or written.
 *
 * One case runs the gate against this repo's real board, and skips when the clone has
 * none: a fresh checkout has no `.agents/work/BOARD.md`, and the gate must not be red
 * there.
 *
 * Anchors are assembled at run time (`sec()`): the docs gate scans `test/*.mjs` headers
 * for literal `§x.y` references, so a hard-coded broken anchor in this file would make
 * `check:docs` red on its own self-test.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tempDir } from './helpers/tree.mjs';

const GATE = fileURLToPath(new URL('../scripts/check-board.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));
const REAL_BOARD = join(REPO, '.agents/work/BOARD.md');

/** Whether git exists — the "sha must be a real commit" case needs a throwaway repo. */
const GIT_OK = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;

/** `§x.y` without a literal marker in this file (see the header note). */
const sec = (num) => `§${num}`;

/** A contract doc that holds the `1.1` anchor the legal board cites. */
const CONTRACT = `# 示例契约

## 1.1 条款

正文。
`;

const HEAD = `# 看板 — demo

本地工作现场，不入库。

> 列约定（\`npm run check:board\` 机械校验）
> - **ID**：略。
> - 一条事项一行。

## 待办 / 挂起

| ID | P | 事项 | 状态 | 下一步 | 依据 | 最后动 |
| --- | --- | --- | --- | --- | --- | --- |
`;

const LEGAL_ROW = `| U1 | P1 | 某件事 | 待开始 | 打开 \`src/a.js\` 改第一段 | \`docs/contracts/demo.md\` ${sec('1.1')} | 2026-11-09 |
`;

const TAIL = `
## 已完成

> 一 commit 一行，时间倒序（最新在上）。

| ID | 完成于 | 一件事 | commit |
| --- | --- | --- | --- |
| — | 2026-11-09 | 首次入库 | \`deadbeef\` |
`;

/** The smallest board that must pass every rule. */
const BOARD = `${HEAD}${LEGAL_ROW}${TAIL}`;

/** Wrap a custom todo row list into a full board. */
const boardWith = (todoRows) => `${HEAD}${todoRows}${TAIL}`;

/** Wrap a custom done row list into a full board. */
const boardDone = (doneRows) => `${HEAD}${LEGAL_ROW}\n## 已完成\n\n| ID | 完成于 | 一件事 | commit |\n| --- | --- | --- | --- |\n${doneRows}`;

const WIP_OK = `# WIP: 某件事

> 状态：进行中
> 优先级：P1
> 最后动：2026-11-09

## 下一步

打开 \`src/a.js\` 改第一段。
`;

/**
 * Materialise a temp tree.
 * @param {Record<string,string>} files path → content, relative to the tree root.
 * @returns {Promise<{dir: string, cleanup: () => Promise<void>}>} the tree.
 */
async function tree(files) {
  const { dir, cleanup } = await tempDir();
  for (const [path, content] of Object.entries(files)) {
    const abs = join(dir, path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  return { dir, cleanup };
}

/** The default tree: one legal board plus the contract it cites. */
const BASELINE = { '.agents/work/BOARD.md': BOARD, 'docs/contracts/demo.md': CONTRACT };

/**
 * Run the gate against a tree.
 * @param {string} dir tree root.
 * @returns {{status: number, out: string}} exit code and merged output.
 */
function runGate(dir) {
  const result = spawnSync(process.execPath, [GATE, '--root', dir], { encoding: 'utf8' });
  return { status: result.status ?? 1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

test('无看板：连 .agents/work/ 都不存在（新克隆）时打印 skip 并 exit 0', async () => {
  const { dir, cleanup } = await tree({ 'docs/contracts/demo.md': CONTRACT });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 0, out);
    assert.match(out, /check-board: skip \(no \.agents\/work\/\)/);
  } finally {
    await cleanup();
  }
});

test('R1 结构：.agents/work/ 在但 BOARD.md 被删必须红（不许当新克隆放过）', async () => {
  const { dir, cleanup } = await tree({
    'docs/contracts/demo.md': CONTRACT,
    '.agents/work/wip/.keep': '',
  });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /RED\s+R1 .*BOARD\.md/);
    assert.doesNotMatch(out, /skip/);
  } finally {
    await cleanup();
  }
});

test('合法最小板：全绿', async () => {
  const { dir, cleanup } = await tree(BASELINE);
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 0, out);
    assert.match(out, /check-board: OK \(1 待办 \/ 1 已完成/);
  } finally {
    await cleanup();
  }
});

test('R1 结构：表头错列必须红', async () => {
  const swapped = BOARD.replace(
    '| ID | P | 事项 | 状态 | 下一步 | 依据 | 最后动 |',
    '| ID | P | 状态 | 事项 | 下一步 | 依据 | 最后动 |',
  );
  assert.notEqual(swapped, BOARD, 'R1 用例没有改到表头');
  const { dir, cleanup } = await tree({ ...BASELINE, '.agents/work/BOARD.md': swapped });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /RED\s+R1 .*表头/);
  } finally {
    await cleanup();
  }
});

test('R1 结构：缺「已完成」二级节必须红', async () => {
  const { dir, cleanup } = await tree({
    ...BASELINE,
    '.agents/work/BOARD.md': `${HEAD}${LEGAL_ROW}`,
  });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /RED\s+R1 .*已完成/);
  } finally {
    await cleanup();
  }
});

test('R2 ID 格式：待办表 X1 / 已完成表 C01（旧口径）都必须红', async () => {
  for (const [files, pattern] of [
    [{ '.agents/work/BOARD.md': boardWith(LEGAL_ROW.replace('| U1 | P1 |', '| X1 | P1 |')) }, /RED\s+R2 .*X1/],
    [{ '.agents/work/BOARD.md': boardDone('| C01 | 2026-11-09 | 首次入库 | `deadbeef` |\n') }, /RED\s+R2 .*C01/],
  ]) {
    const { dir, cleanup } = await tree({ ...BASELINE, ...files });
    try {
      const { status, out } = runGate(dir);
      assert.equal(status, 1, out);
      assert.match(out, pattern);
    } finally {
      await cleanup();
    }
  }
});

test('R3 唯一：同一张表里重复的 ID 必须红', async () => {
  const { dir, cleanup } = await tree({
    ...BASELINE,
    '.agents/work/BOARD.md': boardWith(`${LEGAL_ROW}${LEGAL_ROW}`),
  });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /RED\s+R3 .*U1.*重复/);
  } finally {
    await cleanup();
  }
});

test('R4 取值：非法 P 与非法状态都必须红', async () => {
  for (const [row, pattern] of [
    [LEGAL_ROW.replace('| U1 | P1 |', '| U1 | P9 |'), /RED\s+R4 .*P9/],
    [LEGAL_ROW.replace('| 待开始 |', '| 完成 |'), /RED\s+R4 .*完成/],
  ]) {
    const { dir, cleanup } = await tree({ ...BASELINE, '.agents/work/BOARD.md': boardWith(row) });
    try {
      const { status, out } = runGate(dir);
      assert.equal(status, 1, out);
      assert.match(out, pattern);
    } finally {
      await cleanup();
    }
  }
});

test('R5 可执行性：下一步写「同上」必须红', async () => {
  const { dir, cleanup } = await tree({
    ...BASELINE,
    '.agents/work/BOARD.md': boardWith(LEGAL_ROW.replace('打开 `src/a.js` 改第一段', '同上')),
  });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /RED\s+R5 .*同上/);
  } finally {
    await cleanup();
  }
});

test('R6 依据：§ 锚点在目标文档里不存在必须红', async () => {
  const { dir, cleanup } = await tree({
    ...BASELINE,
    '.agents/work/BOARD.md': boardWith(LEGAL_ROW.replace(sec('1.1'), sec('9.9'))),
  });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /RED\s+R6 .*锚点失效/);
    assert.match(out, /9\.9/);
  } finally {
    await cleanup();
  }
});

test('R6 依据：引用的 .agents/work 现场文件不存在必须红', async () => {
  const { dir, cleanup } = await tree({
    ...BASELINE,
    '.agents/work/BOARD.md': boardWith(LEGAL_ROW.replace('`docs/contracts/demo.md` ' + sec('1.1'), '`.agents/work/wip/U7-nope.md`')),
  });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /RED\s+R6 .*U7-nope\.md/);
  } finally {
    await cleanup();
  }
});

test('R7 现场一致：进行中但没有 wip 文件必须红', async () => {
  const { dir, cleanup } = await tree({
    ...BASELINE,
    '.agents/work/BOARD.md': boardWith(LEGAL_ROW.replace('| 待开始 |', '| 进行中 |')),
  });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /RED\s+R7 .*U1-\*\.md 不存在/);
  } finally {
    await cleanup();
  }
});

test('R7 现场一致：wip 头部状态与看板不一致必须红', async () => {
  const { dir, cleanup } = await tree({
    ...BASELINE,
    '.agents/work/BOARD.md': boardWith(LEGAL_ROW.replace('| 待开始 |', '| 进行中 |')),
    '.agents/work/wip/U1-something.md': WIP_OK.replace('> 状态：进行中', '> 状态：挂起'),
  });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /RED\s+R7 .*U1-something\.md.*挂起/);
  } finally {
    await cleanup();
  }
});

test('R8 反向孤儿：wip 文件名前缀在待办表里找不到必须红', async () => {
  const { dir, cleanup } = await tree({
    ...BASELINE,
    '.agents/work/wip/X9-orphan.md': WIP_OK.replace('> 状态：进行中', '> 状态：待开始'),
  });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /RED\s+R8 .*X9-orphan\.md.*孤儿 WIP/);
  } finally {
    await cleanup();
  }
});

test('R8 反向孤儿：wip 里出现「状态：完成」必须红', async () => {
  const { dir, cleanup } = await tree({
    ...BASELINE,
    '.agents/work/wip/U1-something.md': WIP_OK.replace('> 状态：进行中', '> 状态：完成'),
  });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /RED\s+R8 .*状态：完成/);
  } finally {
    await cleanup();
  }
});

test('R9 已完成表：commit 写成非 sha 的任意花样必须红', async () => {
  const { dir, cleanup } = await tree({
    ...BASELINE,
    '.agents/work/BOARD.md': boardDone('| — | 2026-11-09 | 首次入库 | `xyz` |\n'),
  });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /RED\s+R9 .*xyz/);
  } finally {
    await cleanup();
  }
});

test('R9 已完成表：完成于不是日期、一件事超 40 字都必须红', async () => {
  const long = '一句话'.repeat(20);
  for (const [rows, pattern] of [
    ['| — | 2026/11/09 | 首次入库 | `deadbeef` |\n', /RED\s+R9 .*完成于/],
    [`| — | 2026-11-09 | ${long} | \`deadbeef\` |\n`, /RED\s+R9 .*40 字/],
  ]) {
    const { dir, cleanup } = await tree({ ...BASELINE, '.agents/work/BOARD.md': boardDone(rows) });
    try {
      const { status, out } = runGate(dir);
      assert.equal(status, 1, out);
      assert.match(out, pattern);
    } finally {
      await cleanup();
    }
  }
});

test('R3 跨表：同一个 ID 同时出现在两张表必须红（完成＝换表，不换号）', async () => {
  const { dir, cleanup } = await tree({
    ...BASELINE,
    '.agents/work/BOARD.md': boardDone('| U1 | 2026-11-09 | 首次入库 | `deadbeef` |\n'),
  });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /RED\s+R3 .*U1.*待办表与已完成表/);
  } finally {
    await cleanup();
  }
});

test('已完成表 ID：`—` 与原编号混排、以及没上过板的 U9 都合法', async () => {
  const { dir, cleanup } = await tree({
    ...BASELINE,
    '.agents/work/BOARD.md': boardDone(
      '| U9 | 2026-11-09 | 首次入库 | `deadbeef` |\n| — | 2026-11-09 | 第二件事 | `deadbeef` |\n',
    ),
  });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 0, out);
  } finally {
    await cleanup();
  }
});

test('F4 转义：单元格里的 `\\|` 不是格界（合法板绿），裸 `|` 仍按切格报红', async () => {
  // 绿：`甲 \| 乙` 是一格，整行仍是 7 格
  {
    const { dir, cleanup } = await tree({
      ...BASELINE,
      '.agents/work/BOARD.md': boardWith(LEGAL_ROW.replace('| 某件事 |', '| 甲 \\| 乙 |')),
    });
    try {
      const { status, out } = runGate(dir);
      assert.equal(status, 0, out);
      assert.doesNotMatch(out, /R1 /);
    } finally {
      await cleanup();
    }
  }
  // 红：裸 `|` 真把一格切成两格 ⇒ 8 格
  {
    const { dir, cleanup } = await tree({
      ...BASELINE,
      '.agents/work/BOARD.md': boardWith(LEGAL_ROW.replace('| 某件事 |', '| 甲 | 乙 |')),
    });
    try {
      const { status, out } = runGate(dir);
      assert.equal(status, 1, out);
      assert.match(out, /RED\s+R1 .*8 格/);
    } finally {
      await cleanup();
    }
  }
});

test('S1 分隔行：`| - |` 一个横线也算分隔行', async () => {
  const shortSeparator = BOARD.replace('| --- | --- | --- | --- | --- | --- | --- |', '| - | - | - | - | - | - | - |');
  assert.notEqual(shortSeparator, BOARD, 'S1 用例没有改到分隔行');
  const { dir, cleanup } = await tree({ ...BASELINE, '.agents/work/BOARD.md': shortSeparator });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 0, out);
  } finally {
    await cleanup();
  }
});

test('R9 已完成表：完成于自下而上不得更晚（时间倒序）', async () => {
  const { dir, cleanup } = await tree({
    ...BASELINE,
    '.agents/work/BOARD.md': boardDone(
      '| — | 2026-11-08 | 第二件事 | `deadbeef` |\n| — | 2026-11-09 | 首次入库 | `deadbeef` |\n',
    ),
  });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /RED\s+R9 .*时间倒序/);
  } finally {
    await cleanup();
  }
});

/* ----------------------------------------------- 归档区：BOARD-archive.md */

/** The smallest legal archive: one completed row, older than the board's own. */
const ARCHIVE = `# 看板完成记录（历史区）

> 溢出区。

| ID | 完成于 | 一件事 | commit |
| --- | --- | --- | --- |
| — | 2026-11-08 | 更早的一件事 | \`deadbeef\` |
`;

/** Put an archive next to a board in a temp tree. */
const withArchive = (archive) => ({ ...BASELINE, '.agents/work/BOARD-archive.md': archive });

test('归档区合法：活跃区 + 归档区一起全绿', async () => {
  const { dir, cleanup } = await tree(withArchive(ARCHIVE));
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 0, out);
  } finally {
    await cleanup();
  }
});

test('R10 归档区：日期自下而上不得更晚（归档也要时间倒序）', async () => {
  const broken = ARCHIVE.replace(
    '| — | 2026-11-08 | 更早的一件事 | `deadbeef` |\n',
    '| — | 2026-11-08 | 更早的一件事 | `deadbeef` |\n| — | 2026-11-09 | 更新的一件事 | `deadbeef` |\n',
  );
  const { dir, cleanup } = await tree(withArchive(broken));
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /RED\s+R10 .*归档区也要时间倒序/);
  } finally {
    await cleanup();
  }
});

test('R10 归档区：首行比活跃区末行更新必须红（只能从尾部按序移出）', async () => {
  const broken = ARCHIVE.replace('| — | 2026-11-08 |', '| — | 2026-11-10 |');
  const { dir, cleanup } = await tree(withArchive(broken));
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /RED\s+R10 .*比 BOARD\.md 末行/);
  } finally {
    await cleanup();
  }
});

test('R10 归档区：commit 写成非 sha 的任意花样、缺分隔行都必须红', async () => {
  for (const [archive, pattern] of [
    [ARCHIVE.replace('`deadbeef`', '`xyz`'), /RED\s+R10 .*xyz/],
    [ARCHIVE.replace('| --- | --- | --- | --- |\n', ''), /RED\s+R10 .*分隔行/],
  ]) {
    const { dir, cleanup } = await tree(withArchive(archive));
    try {
      const { status, out } = runGate(dir);
      assert.equal(status, 1, out);
      assert.match(out, pattern);
    } finally {
      await cleanup();
    }
  }
});

test('R3 归档区：同一 ID 又从活跃区搬回归档必须红（一份记录只能在一个地方）', async () => {
  const { dir, cleanup } = await tree(withArchive(ARCHIVE.replace('| — | 2026-11-08 |', '| U1 | 2026-11-08 |')));
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /RED\s+R3 .*U1.*重复/);
  } finally {
    await cleanup();
  }
});

test('W 体量：活跃区完成行超过 12 行只告警、不判红（该把最老的移进归档）', async () => {
  const rows = Array.from({ length: 13 }, (unused, i) => `| — | 2026-11-09 | 第 ${i + 1} 件事 | \`deadbeef\` |\n`).join('');
  const { dir, cleanup } = await tree({ ...BASELINE, '.agents/work/BOARD.md': boardDone(rows) });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 0, out);
    assert.match(out, /warn W .*已完成 13 行/);
  } finally {
    await cleanup();
  }
});

test(
  '本仓库真板：现存的 .agents/work/BOARD.md 必须过门禁',
  { skip: existsSync(REAL_BOARD) ? false : '本仓库没有 .agents/work/BOARD.md（工作现场不入库）' },
  () => {
    const { status, out } = runGate(REPO);
    assert.equal(status, 0, out);
    assert.match(out, /check-board: OK/);
  },
);

/* ---------------------------------------------- 文件系统 / 表格语法 / 依据可查 */

/** Replace the legal row's `依据` cell. */
const basisRow = (basis) => LEGAL_ROW.replace('`docs/contracts/demo.md` ' + sec('1.1'), basis);

/** A minimal `AGENTS.md` whose 硬约束 9 exists and 硬约束 99 does not. */
const AGENTS = `# AGENTS — demo

## 硬约束（改错就是返工）

9. **点击边界按页签划**：已安装页签唯一交互控件是右侧开关。
10. **不写别人的存储**：别人的 state.json 只读。
`;

test('R1 结构：表头下一行不是分隔行必须红（否则首行数据被静默吞掉）', async () => {
  const noSeparator = BOARD.replace('| --- | --- | --- | --- | --- | --- | --- |\n', '');
  assert.notEqual(noSeparator, BOARD, 'R1 用例没有删到分隔行');
  const { dir, cleanup } = await tree({ ...BASELINE, '.agents/work/BOARD.md': noSeparator });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /RED\s+R1 .*分隔行/);
  } finally {
    await cleanup();
  }
});

test('R4 取值：最后动写成 2026/11/09 或留空都必须红', async () => {
  for (const [row, why] of [
    [LEGAL_ROW.replace('| 2026-11-09 |', '| 2026/11/09 |'), /RED\s+R4 .*最后动/],
    [LEGAL_ROW.replace('| 2026-11-09 |', '|  |'), /RED\s+R4 .*最后动/],
  ]) {
    assert.notEqual(row, LEGAL_ROW, 'R4 用例没有改到最后动');
    const { dir, cleanup } = await tree({ ...BASELINE, '.agents/work/BOARD.md': boardWith(row) });
    try {
      const { status, out } = runGate(dir);
      assert.equal(status, 1, out);
      assert.match(out, why);
    } finally {
      await cleanup();
    }
  }
});

test('R6 依据：AGENTS.md 里没有的硬约束编号必须红；存在的编号不红', async () => {
  // 红：硬约束 99 不存在
  {
    const { dir, cleanup } = await tree({
      ...BASELINE,
      'AGENTS.md': AGENTS,
      '.agents/work/BOARD.md': boardWith(basisRow('`AGENTS.md` 硬约束 99')),
    });
    try {
      const { status, out } = runGate(dir);
      assert.equal(status, 1, out);
      assert.match(out, /RED\s+R6 .*硬约束 99/);
    } finally {
      await cleanup();
    }
  }
  // 绿：硬约束 9 真的有一行 `9. **…`
  {
    const { dir, cleanup } = await tree({
      ...BASELINE,
      'AGENTS.md': AGENTS,
      '.agents/work/BOARD.md': boardWith(basisRow('`AGENTS.md` 硬约束 9')),
    });
    try {
      const { status, out } = runGate(dir);
      assert.equal(status, 0, out);
    } finally {
      await cleanup();
    }
  }
  // 只告警：没有 AGENTS.md 时不判红
  {
    const { dir, cleanup } = await tree({
      ...BASELINE,
      '.agents/work/BOARD.md': boardWith(basisRow('`AGENTS.md` 硬约束 9')),
    });
    try {
      const { status, out } = runGate(dir);
      assert.equal(status, 0, out);
      assert.match(out, /warn R6 .*硬约束 9/);
    } finally {
      await cleanup();
    }
  }
});

test('R6 依据：任何 .agents/ 路径都要存在（含已删的旧 .agents/scratch/）', async () => {
  // 红：旧目录已 rmdir
  {
    const { dir, cleanup } = await tree({
      ...BASELINE,
      '.agents/work/BOARD.md': boardWith(basisRow('`.agents/scratch/qa-r9.png`')),
    });
    try {
      const { status, out } = runGate(dir);
      assert.equal(status, 1, out);
      assert.match(out, /RED\s+R6 .*\.agents\/scratch\/qa-r9\.png/);
    } finally {
      await cleanup();
    }
  }
  // 绿：新位置真的在（且 wip 头部状态与看板一致）
  {
    const { dir, cleanup } = await tree({
      ...BASELINE,
      '.agents/work/wip/U1-here.md': WIP_OK.replace('> 状态：进行中', '> 状态：待开始'),
      '.agents/work/BOARD.md': boardWith(basisRow('`.agents/work/wip/U1-here.md`')),
    });
    try {
      const { status, out } = runGate(dir);
      assert.equal(status, 0, out);
    } finally {
      await cleanup();
    }
  }
});

test('R6 依据：裸 §x.y 与「文件 + §x.y」同时出现时都不误红', async () => {
  const { dir, cleanup } = await tree({
    ...BASELINE,
    '.agents/work/BOARD.md': boardWith(basisRow('`docs/contracts/demo.md` ' + sec('1.1') + ' · ' + sec('1.1'))),
  });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 0, out);
  } finally {
    await cleanup();
  }
});

test('R7 现场一致：待开始但 wip 写进行中也必须红（双向逐字）', async () => {
  const { dir, cleanup } = await tree({
    ...BASELINE,
    '.agents/work/wip/U1-something.md': WIP_OK,
  });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /RED\s+R7 .*U1-something\.md.*进行中.*待开始/);
  } finally {
    await cleanup();
  }
});

test('R8 反向孤儿：wip/ 下的 .md 目录必须红，且不许打栈', async () => {
  const { dir, cleanup } = await tree(BASELINE);
  try {
    await mkdir(join(dir, '.agents/work/wip/U1-x.md'), { recursive: true });
    await writeFile(join(dir, '.agents/work/wip/U1-x.md/keep.txt'), 'x');
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /RED\s+R8 .*U1-x\.md.*目录/);
    assert.doesNotMatch(out, /\n\s+at .*check-board\.mjs:/);
  } finally {
    await cleanup();
  }
});

test('R8 误红收紧：正文里引用「状态：完成」这句规则不算（只认头部行）', async () => {
  const body = `${WIP_OK.replace('> 状态：进行中', '> 状态：待开始')}
正文里提到 wip 头部写 > 状态：完成 会被 R8 判红，这句话本身不该红。
`;
  const { dir, cleanup } = await tree({
    ...BASELINE,
    '.agents/work/wip/U1-quote.md': body,
  });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 0, out);
  } finally {
    await cleanup();
  }
});

test(
  'R9 已完成表：commit 写的 sha 必须真是一条 commit（非 git 仓库只 warn）',
  { skip: GIT_OK ? false : '本机没有 git，跳过 sha 存在性用例' },
  async () => {
    const { dir, cleanup } = await tree(BASELINE);
    try {
      const run = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      run(['init', '-q', '.']);
      run(['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
      const sha = run(['rev-parse', '--short', 'HEAD']).stdout.trim();
      assert.match(sha, /^[0-9a-f]{7,40}$/, 'git 没给出可用的短 sha');

      // 绿：真 sha
      await writeFile(join(dir, '.agents/work/BOARD.md'), BOARD.replace('deadbeef', sha));
      const green = runGate(dir);
      assert.equal(green.status, 0, green.out);

      // 红：deadbeef 是合法的 7–40 位 hex，但本仓库没有这条 commit
      await writeFile(join(dir, '.agents/work/BOARD.md'), BOARD);
      const red = runGate(dir);
      assert.equal(red.status, 1, red.out);
      assert.match(red.out, /RED\s+R9 .*deadbeef/);
    } finally {
      await cleanup();
    }
  },
);
