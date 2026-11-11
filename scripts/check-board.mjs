#!/usr/bin/env node
/**
 * Board gate for this repo: the local work board (`.agents/work/BOARD.md`) must stay
 * machine-checkable — a column index, not prose.
 *
 * The board is gitignored (`.agents/work/`), so a fresh clone has none: that is not a
 * failure, it prints `skip` and exits 0. Everything else here is structural. The same
 * rules apply to `BOARD-archive.md`, the overflow of the completed table, so the history
 * side cannot rot either.
 *
 * Red = the board cannot be trusted (broken shape, dangling anchor, missing WIP).
 * Warn = size only.
 *
 * Usage: node scripts/check-board.mjs [--root <dir>] [--quiet]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const valueOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const ROOT = resolve(valueOf('--root') ?? process.cwd());
const QUIET = flag('--quiet');

const WORK_REL = '.agents/work';
const WORK_DIR = join(ROOT, WORK_REL);
const BOARD_REL = '.agents/work/BOARD.md';
const WIP_REL = '.agents/work/wip';

const BOARD = join(ROOT, BOARD_REL);

if (!existsSync(WORK_DIR)) {
  // A fresh clone has no work scene at all: nothing to check, and never red.
  console.log('check-board: skip (no .agents/work/)');
  process.exit(0);
}

if (!existsSync(BOARD)) {
  // The scene exists but its board does not: that is a hole, not a fresh clone.
  console.log(`RED  R1 ${BOARD_REL}: ${WORK_REL}/ 存在却没有 BOARD.md（看板被删或被挪走）`);
  console.error('check-board: FAIL (1 red, 0 warn; .agents/work/ 在、BOARD.md 不在)');
  process.exit(1);
}

/* ------------------------------------------------------------------ vocabulary */

const P_VALUES = new Set(['P0', 'P1', 'P2']);
const STATUS_VALUES = new Set(['待开始', '进行中', '挂起', '待评审']);
/** Statuses that cannot exist without a WIP scene file. */
const NEEDS_WIP = new Set(['进行中', '挂起']);
const TODO_HEADER = ['ID', 'P', '事项', '状态', '下一步', '依据', '最后动'];
const DONE_HEADER = ['ID', '完成于', '一件事', 'commit'];
const TODO_ID = /^[UMVD]\d+$/;
/** 从未上过板的行（历史 commit / 真机轮）用这个占位，它的身份证是 commit sha。 */
const NO_ID = '—';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HEX = /^[0-9a-f]{7,40}$/;
/** Prose that means "no decision was made" — never allowed as a next step. */
const VAGUE_NEXT = ['见上', '同上', '待定', '看情况', '继续优化', 'TODO', 'todo', 'Todo'];
const DITTO = ['见上', '同上'];
const MAX_LINES = 70;
const MAX_TODO_ROWS = 12;
const MAX_ITEM_CHARS = 40;

const reds = [];
const warns = [];
const red = (id, msg) => reds.push({ id, msg });
const warn = (id, msg) => warns.push({ id, msg });

/* -------------------------------------------------------------------- parsing */

const text = readFileSync(BOARD, 'utf8');
const lines = text.split('\n');
const lineCount = text.replace(/\n$/, '').split('\n').length;

/** Level-2 heading titles, in order, with their line index. */
const h2 = lines
  .map((line, index) => {
    const m = /^## +(.*)$/.exec(line);
    return m ? { index, title: m[1].trim() } : null;
  })
  .filter(Boolean);

const sectionIndex = (prefix) => {
  const hit = h2.find((h) => h.title.startsWith(prefix));
  return hit ? hit.index : -1;
};

/** Sentinel that stands in for an escaped `\|` while a row is being split into cells. */
const PIPE_SENTINEL = '\u0000PIPE\u0000';

/**
 * Split one table line into trimmed cells.
 *
 * `\|` is an escaped pipe, not a cell boundary — the head note tells authors to write it,
 * so the parser has to agree with the note (protect it before splitting, restore after).
 * @param {string} line raw table line, with or without the outer pipes.
 * @returns {string[]} cell texts, backticks stripped.
 */
function splitCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '')
    .replace(/\\\|/g, PIPE_SENTINEL)
    .split('|')
    .map((c) => c.split(PIPE_SENTINEL).join('|').replace(/`/g, '').trim());
}

/** `| --- | :---: |` / `| - |` — the row that makes a markdown table a table. */
function isSeparatorRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return false;
  const parts = splitCells(trimmed);
  return parts.length > 0 && parts.every((p) => /^:?-+:?$/.test(p));
}

/**
 * First markdown table of one section.
 *
 * The header must be followed by a separator row: without it every renderer drops the
 * first row of data, so a board that lost it has to be red instead of silently
 * half-read (the dropped row would escape every other rule).
 * @param {number} start line index of the section heading (-1 when absent).
 * @param {string} name section name, for messages.
 * @returns {{header: string[], rows: string[][], at: number}|null} the table.
 */
function tableOf(start, name) {
  if (start < 0) return null;
  const end = h2.find((h) => h.index > start)?.index ?? lines.length;
  let at = -1;
  for (let i = start + 1; i < end; i += 1) {
    if (lines[i].trimStart().startsWith('|')) { at = i; break; }
  }
  if (at < 0) return null;
  const header = splitCells(lines[at]);
  const separator = isSeparatorRow(lines[at + 1] ?? '');
  if (!separator) {
    red('R1', `BOARD.md: ${name}表头下一行必须是分隔行（| --- | … |），现在缺了`);
  }
  const rows = [];
  for (let i = at + (separator ? 2 : 1); i < end; i += 1) {
    if (!lines[i].trimStart().startsWith('|')) break;
    rows.push(splitCells(lines[i]));
  }
  return { header, rows, at };
}

const todoStart = sectionIndex('待办');
const doneStart = sectionIndex('已完成');
const todo = tableOf(todoStart, '待办');
const done = tableOf(doneStart, '已完成');

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/* ------------------------------------------------- R1 shape: sections + tables */

if (todoStart < 0) red('R1', 'BOARD.md: 缺少二级节「## 待办 …」（应含待办表）');
if (doneStart < 0) red('R1', 'BOARD.md: 缺少二级节「## 已完成 …」（应含已完成表）');

if (todoStart >= 0 && !todo) red('R1', 'BOARD.md: 「## 待办」节里没有表格');
if (doneStart >= 0 && !done) red('R1', 'BOARD.md: 「## 已完成」节里没有表格');

if (todo && !sameList(todo.header, TODO_HEADER)) {
  red('R1', `BOARD.md: 待办表表头应为「${TODO_HEADER.join(' | ')}」，实际「${todo.header.join(' | ')}」`);
}
if (done && !sameList(done.header, DONE_HEADER)) {
  red('R1', `BOARD.md: 已完成表表头应为「${DONE_HEADER.join(' | ')}」，实际「${done.header.join(' | ')}」`);
}

const rowWidth = (table, name) => {
  if (!table) return;
  table.rows.forEach((row, i) => {
    if (row.length !== table.header.length) {
      red('R1', `BOARD.md: ${name}表第 ${i + 1} 行有 ${row.length} 格，表头是 ${table.header.length} 格`);
    }
  });
};
rowWidth(todo, '待办');
rowWidth(done, '已完成');

const todoRows = todo?.rows ?? [];
const doneRows = done?.rows ?? [];

/** Cell value, tolerating a short row. */
const cell = (row, i) => (row[i] ?? '').trim();

/* -------------------------------------------------------- R2/R3 ID shape + unique */

const seenIds = new Map();
const claimId = (id, where) => {
  if (!id) return;
  if (seenIds.has(id)) red('R3', `BOARD.md: ID「${id}」在 ${where} 重复（首次出现于 ${seenIds.get(id)}）`);
  else seenIds.set(id, where);
};

const todoIdSet = new Set();
todoRows.forEach((row, i) => {
  const id = cell(row, 0);
  if (!TODO_ID.test(id)) red('R2', `BOARD.md: 待办表第 ${i + 1} 行 ID「${id}」不是 U/M/V/D + 数字`);
  else todoIdSet.add(id);
  claimId(id, `待办表第 ${i + 1} 行`);
});

const doneIdSet = new Set();
doneRows.forEach((row, i) => {
  const id = cell(row, 0);
  // 已完成表沿用该事项在待办表里的原编号；从未上过板的写 `—`（身份证是 commit sha）。
  if (id !== NO_ID) {
    if (!TODO_ID.test(id)) {
      red('R2', `BOARD.md: 已完成表第 ${i + 1} 行 ID「${id}」既不是 U/M/V/D + 数字，也不是「${NO_ID}」`);
    } else {
      doneIdSet.add(id);
    }
    claimId(id, `已完成表第 ${i + 1} 行`);
  }
});

// 完成＝换表，不换号：同一个 ID 不许在两张表里同时存在。
for (const id of doneIdSet) {
  if (todoIdSet.has(id)) {
    red('R3', `BOARD.md: ID「${id}」同时在待办表与已完成表 —— 完成只能换表，不能换号也不能两张都在`);
  }
}

/* --------------------------------------------------- R4/R5/R6 待办表逐格取值 */

const gitReady = (() => {
  try {
    execFileSync('git', ['-C', ROOT, 'rev-parse', '--git-dir'], { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
})();

const commitExists = (sha) => {
  try {
    execFileSync('git', ['-C', ROOT, 'cat-file', '-e', `${sha}^{commit}`], { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
};

/** Headings of one file, `§`-prefix stripped, for anchor resolution. */
const headingsOf = (rel) => {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return [];
  return readFileSync(abs, 'utf8').split('\n').flatMap((line) => {
    const m = /^#{1,6} +(?:§)?(.+)$/.exec(line);
    return m ? [m[1].trim()] : [];
  });
};

/** Anchor `x.y` exists as a heading prefix (`3.9.2 组件树` / `D.5 …`). */
const hasAnchor = (rel, num) => headingsOf(rel).some((title) =>
  title.startsWith(`${num} `) || title === num || title.startsWith(`${num}：`) || title.startsWith(`${num}(`));

const contractDocs = () => {
  const dir = join(ROOT, 'docs/contracts');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => `docs/contracts/${f}`);
};

const checkedShas = new Set();

todoRows.forEach((row, i) => {
  const where = `BOARD.md: 待办表第 ${i + 1} 行`;
  const id = cell(row, 0);
  const p = cell(row, 1);
  const item = cell(row, 2);
  const status = cell(row, 3);
  const next = cell(row, 4);
  const basis = cell(row, 5);

  // R4 取值
  if (!P_VALUES.has(p)) red('R4', `${where}（${id}）P「${p}」不是 P0/P1/P2`);
  if (!STATUS_VALUES.has(status)) red('R4', `${where}（${id}）状态「${status}」不是 待开始/进行中/挂起/待评审`);
  if (!item) red('R4', `${where}（${id}）事项为空`);
  const lastTouched = cell(row, 6);
  if (!DATE.test(lastTouched) || Number.isNaN(Date.parse(lastTouched))) {
    red('R4', `${where}（${id}）最后动「${lastTouched}」不是 YYYY-MM-DD`);
  }

  // R5 下一步可执行
  if (!next) {
    red('R5', `${where}（${id}）下一步为空`);
  } else {
    for (const word of VAGUE_NEXT) {
      if (next.includes(word)) red('R5', `${where}（${id}）下一步含「${word}」，要具体到「打开哪个文件、改哪一段」`);
    }
  }

  // R6 依据可查
  if (!basis) {
    red('R6', `${where}（${id}）依据为空`);
  } else {
    for (const word of DITTO) {
      if (basis.includes(word)) red('R6', `${where}（${id}）依据含「${word}」，要写可查坐标`);
    }

    // docs/…md 路径必须存在；带 § 的还要落到真实标题
    const anchored = [];
    for (const m of basis.matchAll(/(docs\/[\w./-]+\.md)\s*§\s?([A-Z]?\d+(?:\.\d+)*)/g)) {
      anchored.push([m.index, m.index + m[0].length]);
      if (!existsSync(join(ROOT, m[1]))) {
        red('R6', `${where}（${id}）引用的文档不存在 → ${m[1]}`);
      } else if (!hasAnchor(m[1], m[2])) {
        red('R6', `${where}（${id}）锚点失效 → ${m[1]} §${m[2]}`);
      }
    }
    for (const m of basis.matchAll(/docs\/[\w./-]+\.md/g)) {
      if (!existsSync(join(ROOT, m[0]))) red('R6', `${where}（${id}）引用的文档不存在 → ${m[0]}`);
    }
    // 光写 §x.y 不写文件时，按全仓库契约文档兜底解析
    const contracts = contractDocs();
    for (const m of basis.matchAll(/§\s?([A-Z]?\d+(?:\.\d+)*)/g)) {
      const inside = anchored.some(([from, to]) => m.index >= from && m.index < to);
      if (inside) continue;
      if (!contracts.some((doc) => hasAnchor(doc, m[1]))) {
        red('R6', `${where}（${id}）锚点失效 → §${m[1]}（没有任何契约文档含该编号的章节）`);
      }
    }

    // AGENTS.md 硬约束 N：编号必须真的一节存在
    for (const m of basis.matchAll(/硬约束\s*(\d+)/g)) {
      if (!existsSync(join(ROOT, 'AGENTS.md'))) {
        warn('R6', `${where}（${id}）没有 AGENTS.md，跳过「硬约束 ${m[1]}」校验`);
        continue;
      }
      const listed = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8').split('\n')
        .some((line) => new RegExp(`^\\s*${m[1]}\\. \\*\\*`).test(line));
      if (!listed) {
        red('R6', `${where}（${id}）AGENTS.md 里没有「硬约束 ${m[1]}」（该是一行 ${m[1]}. **…）`);
      }
    }

    // .agents/… 现场路径（含已删的旧目录）必须存在
    for (const m of basis.matchAll(/\.agents\/[\w./-]*[\w]/g)) {
      if (!existsSync(join(ROOT, m[0]))) {
        red('R6', `${where}（${id}）引用的现场路径不存在 → ${m[0]}`);
      }
    }

    // 短 sha 必须在本仓库里真的是一条 commit
    for (const m of basis.matchAll(/\b[0-9a-f]{7,40}\b/g)) {
      const sha = m[0];
      if (checkedShas.has(sha)) continue;
      checkedShas.add(sha);
      if (!gitReady) {
        warn('R6', `${where}（${id}）非 git 仓库，跳过 sha 校验 → ${sha}`);
      } else if (!commitExists(sha)) {
        red('R6', `${where}（${id}）sha 不存在 → ${sha}`);
      }
    }
  }
});

/* --------------------------------------------------------- R7 待办行 ↔ WIP 现场 */

const wipDir = join(ROOT, WIP_REL);

/** Readable WIP files; a directory or symlink named `*.md` is a red, never a stack trace. */
const wipFiles = (() => {
  if (!existsSync(wipDir)) return [];
  let entries = [];
  try {
    entries = readdirSync(wipDir, { withFileTypes: true });
  } catch (error) {
    red('R8', `${WIP_REL}: 目录读不出来（${error.code ?? 'EUNKNOWN'}）`);
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (entry.isFile()) {
      if (entry.name.endsWith('.md')) files.push(entry.name);
      continue;
    }
    if (entry.name.endsWith('.md')) {
      red('R8', `${WIP_REL}/${entry.name}: wip/ 里出现目录/非文件条目（这里只放 .md 文件）`);
    }
  }
  return files.sort();
})();

/** Read one WIP file; failure is a red R8 with the file name, never a stack trace. */
const readWip = (file) => {
  try {
    return readFileSync(join(wipDir, file), 'utf8');
  } catch (error) {
    red('R8', `${WIP_REL}/${file}: 读不出来（${error.code ?? 'EUNKNOWN'}）`);
    return null;
  }
};

/** WIP header field, e.g. `> 状态：进行中`. */
const wipField = (body, key) => {
  for (const line of body.split('\n')) {
    const m = new RegExp(`^>\\s*${key}：\\s*(.*)$`).exec(line);
    if (m) return m[1].trim();
  }
  return null;
};

for (const [i, row] of todoRows.entries()) {
  const id = cell(row, 0);
  const status = cell(row, 3);
  const matches = wipFiles.filter((f) => f.startsWith(`${id}-`));
  if (matches.length === 0) {
    if (NEEDS_WIP.has(status)) {
      red('R7', `BOARD.md: 待办表第 ${i + 1} 行（${id}）状态是「${status}」，但 ${WIP_REL}/${id}-*.md 不存在`);
    }
    continue;
  }
  // 双向逐字：有 wip 的 ID，板上状态必须与 wip 头部一致（待开始 + wip 进行中也算不一致）
  for (const file of matches) {
    const body = readWip(file);
    if (body === null) continue;
    const fileStatus = wipField(body, '状态');
    if (fileStatus === null) {
      red('R7', `${WIP_REL}/${file}: 头部缺「> 状态：」`);
    } else if (fileStatus !== status) {
      red('R7', `${WIP_REL}/${file}: 头部状态「${fileStatus}」与看板「${id}」的「${status}」不一致`);
    }
  }
}

/* ------------------------------------------------------------ R8 反向孤儿检查 */

const todoIds = new Set(todoRows.map((row) => cell(row, 0)));
for (const file of wipFiles) {
  const prefix = file.split('-')[0];
  if (!todoIds.has(prefix)) {
    red('R8', `${WIP_REL}/${file}: 孤儿 WIP —— 待办表里没有 ID「${prefix}」（完成的事项要蒸馏后删档）`);
  }
  const body = readWip(file);
  if (body === null) continue;
  // 只认头部那一行：正文里引用「状态：完成」这句规则不算
  if (body.split('\n').some((line) => /^> 状态：完成/.test(line))) {
    red('R8', `${WIP_REL}/${file}: 头部「> 状态：完成」—— 完成要蒸馏进提交/契约后删档`);
  }
}

/* ------------------------------------------------------- R9 已完成表逐格取值 */

let previousDate = null;
doneRows.forEach((row, i) => {
  const where = `BOARD.md: 已完成表第 ${i + 1} 行`;
  const id = cell(row, 0);
  const finishedAt = cell(row, 1);
  const oneThing = cell(row, 2);
  const commits = cell(row, 3);

  if (!DATE.test(finishedAt) || Number.isNaN(Date.parse(finishedAt))) {
    red('R9', `${where}（${id}）完成于「${finishedAt}」不是 YYYY-MM-DD`);
  } else {
    if (previousDate !== null && finishedAt > previousDate) {
      red('R9', `${where}（${id}）完成于 ${finishedAt} 晚于上一行 ${previousDate} —— 表内要时间倒序`);
    }
    previousDate = finishedAt;
  }

  if (!oneThing) {
    red('R9', `${where}（${id}）一件事为空`);
  } else if ([...oneThing].length > MAX_ITEM_CHARS) {
    red('R9', `${where}（${id}）一件事 ${[...oneThing].length} 字，超过 ${MAX_ITEM_CHARS} 字`);
  }

  if (commits !== '—') {
    const parts = commits.split(/[·、,，]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) {
      red('R9', `${where}（${id}）commit「${commits}」既不是「—」也不是短 sha`);
    }
    for (const part of parts) {
      if (!HEX.test(part)) {
        red('R9', `${where}（${id}）commit「${part}」不是 7–40 位短 sha（无代码变更写「—」）`);
        continue;
      }
      // 与 R6 对称：写了 sha 就得在本仓库里真是一条 commit（`deadbeef` 不算）
      if (!gitReady) {
        warn('R9', `${where}（${id}）非 git 仓库，跳过 sha 校验 → ${part}`);
        continue;
      }
      if (!commitExists(part)) red('R9', `${where}（${id}）commit「${part}」在本仓库里不存在`);
    }
  }
});

/* ------------------------------------------- R10 归档区（BOARD-archive.md） */

const ARCHIVE_REL = '.agents/work/BOARD-archive.md';
const ARCHIVE_PATH = join(ROOT, ARCHIVE_REL);
/** 活跃区保留的完成行数；更早的按时间倒序移进归档区。 */
const DONE_WINDOW = 12;

if (existsSync(ARCHIVE_PATH)) {
  let archiveText = null;
  let entry = null;
  try {
    // lstat, not stat: a symlink or a directory named `*.md` must be a red, never a stack.
    entry = lstatSync(ARCHIVE_PATH);
  } catch (error) {
    red('R10', `${ARCHIVE_REL}: 读不出来（${error.code ?? 'EUNKNOWN'}）`);
  }
  if (entry !== null && !entry.isFile()) {
    red('R10', `${ARCHIVE_REL}: 必须是一个普通文件（目录 / 软链都不行）`);
  } else if (entry !== null) {
    try {
      archiveText = readFileSync(ARCHIVE_PATH, 'utf8');
    } catch (error) {
      red('R10', `${ARCHIVE_REL}: 读不出来（${error.code ?? 'EUNKNOWN'}）`);
    }
  }
  if (archiveText !== null) {
    const archiveLines = archiveText.split('\n');
    const at = archiveLines.findIndex((line) => line.trimStart().startsWith('|'));
    if (at < 0) {
      red('R10', `${ARCHIVE_REL}: 没有表格（归档区只有一张完成表）`);
    } else {
      const archiveHeader = splitCells(archiveLines[at]);
      if (!sameList(archiveHeader, DONE_HEADER)) {
        red('R10', `${ARCHIVE_REL}: 表头应为「${DONE_HEADER.join(' | ')}」，实际「${archiveHeader.join(' | ')}」`);
      }
      const hasSeparator = isSeparatorRow(archiveLines[at + 1] ?? '');
      if (!hasSeparator) red('R10', `${ARCHIVE_REL}: 表头下一行必须是分隔行（| --- | …）`);
      const archiveRows = [];
      for (let i = at + (hasSeparator ? 2 : 1); i < archiveLines.length; i += 1) {
        if (!archiveLines[i].trimStart().startsWith('|')) break;
        archiveRows.push(splitCells(archiveLines[i]));
      }
      if (archiveRows.length === 0) red('R10', `${ARCHIVE_REL}: 归档区没有完成行`);

      let previousArchiveDate = null;
      archiveRows.forEach((row, i) => {
        const where = `${ARCHIVE_REL}: 第 ${i + 1} 行`;
        if (row.length !== DONE_HEADER.length) {
          red('R10', `${where} 有 ${row.length} 格，表头是 ${DONE_HEADER.length} 格`);
          return;
        }
        const id = cell(row, 0);
        const finishedAt = cell(row, 1);
        const oneThing = cell(row, 2);
        const commits = cell(row, 3);

        if (id !== NO_ID) {
          if (!TODO_ID.test(id)) {
            red('R2', `${where} ID「${id}」既不是 U/M/V/D + 数字，也不是「${NO_ID}」`);
          } else if (seenIds.has(id)) {
            // 完成＝从活跃区移出；同一个 ID 在归档里再出现一次，等于两份记录打架。
            red('R3', `${where} ID「${id}」重复（首次出现于 ${seenIds.get(id)}）`);
          } else {
            seenIds.set(id, where);
          }
        }

        if (!DATE.test(finishedAt) || Number.isNaN(Date.parse(finishedAt))) {
          red('R10', `${where} 完成于「${finishedAt}」不是 YYYY-MM-DD`);
        } else {
          if (previousArchiveDate !== null && finishedAt > previousArchiveDate) {
            red('R10', `${where} 完成于 ${finishedAt} 晚于上一行 ${previousArchiveDate} —— 归档区也要时间倒序`);
          }
          previousArchiveDate = finishedAt;
        }

        if (!oneThing) {
          red('R10', `${where} 一件事为空`);
        } else if ([...oneThing].length > MAX_ITEM_CHARS) {
          red('R10', `${where} 一件事 ${[...oneThing].length} 字，超过 ${MAX_ITEM_CHARS} 字`);
        }

        if (commits !== '—') {
          const parts = commits.split(/[·、,，]/).map((part) => part.trim()).filter(Boolean);
          if (parts.length === 0) {
            red('R10', `${where} commit「${commits}」既不是「—」也不是短 sha`);
          }
          for (const part of parts) {
            if (!HEX.test(part)) {
              red('R10', `${where} commit「${part}」不是 7–40 位短 sha（无代码变更写「—」）`);
              continue;
            }
            if (checkedShas.has(part)) continue;
            checkedShas.add(part);
            if (!gitReady) {
              warn('R10', `${where} 非 git 仓库，跳过 sha 校验 → ${part}`);
            } else if (!commitExists(part)) {
              red('R10', `${where} commit「${part}」在本仓库里不存在`);
            }
          }
        }
      });

      // 跨文件衔接：归档首行不许比活跃区末行更新，否则说明移出的不是尾部。
      const boardOldest = doneRows.length > 0 ? cell(doneRows[doneRows.length - 1], 1) : null;
      const archiveNewest = archiveRows.length > 0 ? cell(archiveRows[0], 1) : null;
      if (boardOldest !== null && archiveNewest !== null
        && DATE.test(boardOldest) && DATE.test(archiveNewest) && archiveNewest > boardOldest) {
        red('R10', `${ARCHIVE_REL}: 首行 ${archiveNewest} 比 BOARD.md 末行 ${boardOldest} 更新 —— 归档只能从活跃区尾部按序移出`);
      }
    }
  }
}

if (doneRows.length > DONE_WINDOW) {
  warn('W', `BOARD.md: 已完成 ${doneRows.length} 行（>${DONE_WINDOW}）—— 把最老的移进 ${ARCHIVE_REL}`);
}

/* ------------------------------------------------------------------- 体量告警 */

if (lineCount > MAX_LINES) warn('W', `BOARD.md: ${lineCount} 行（>${MAX_LINES}）—— 叙述挪进 wip/ 或 scratch/`);
if (todoRows.length > MAX_TODO_ROWS) warn('W', `BOARD.md: 待办表 ${todoRows.length} 行（>${MAX_TODO_ROWS}）—— 该合项或降级进 wip/`);

/* ------------------------------------------------------------------- report */

if (!QUIET || reds.length || warns.length) {
  for (const w of warns) console.log(`warn ${w.id} ${w.msg}`);
  for (const r of reds) console.log(`RED  ${r.id} ${r.msg}`);
}
if (reds.length) {
  console.error(`check-board: FAIL (${reds.length} red, ${warns.length} warn; ${todoRows.length} 待办 / ${doneRows.length} 已完成)`);
  process.exit(1);
}
console.log(`check-board: OK (${todoRows.length} 待办 / ${doneRows.length} 已完成, ${warns.length} warn; ${lineCount} 行)`);
