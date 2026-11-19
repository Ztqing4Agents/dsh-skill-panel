#!/usr/bin/env node
/*
 * ⚠ 原样副本：不要在本仓改它的判据。
 *
 * 来源：dev-docs-standards 规范自带的文档门禁（G1–G14），`<skill>/scripts/check-docs.mjs`；
 * 取用时上游那份的 sha256 = e464271ef34ba2e8eac5956197aee717b0e6dd5e190cdb69fa2d2b2173afca69（121080 B）。
 * 升级方式＝从新版规范里**整份重新复制覆盖**，本文件只允许改这段说明。
 * 本仓的特殊约定（豁免清单 / 白名单 / 行数阈值）一律写仓库根的 `.docs-standards.json`，不写进判据。
 * 它不进 `npm run check`：第五门是项目自建的 `scripts/check-docs.mjs`；
 * 这一份是「交付前第二意见」，单独跑 `npm run check:docs:standards`。
 */
/**
 * check-docs.mjs —— dev-docs-standards 的文档门禁参考实现（G1–G14）。
 *
 * 零第三方依赖：只用 Node 18+ 内置模块（node:fs / node:path / node:os /
 * node:child_process），ESM 单文件可执行。
 *
 * CLI：
 *   node scripts/check-docs.mjs [--root <dir>] [--json] [--selftest] [--help]
 *
 *   --root <dir>   被检查的仓库根，默认 process.cwd()
 *   --json         输出 { red, warn, skip } 三个数组，元素为 {file,line,gate,message}
 *   --selftest     只跑内置自测（在 os.tmpdir() 建临时夹具），不检查任何真实仓库
 *   --help         打印用法
 *
 * 退出码：有任何 red → 1；否则 0。参数错误 → 2。
 *
 * 文件分五段：常量 / 解析 / 各闸 / 报告 / 自测。改门禁时先看 LIMITS 与 GATES。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/* ============================================================================
 * 一、常量
 * ==========================================================================*/

/**
 * 所有「数字型判据」的唯一出处（文档里「阈值集中在 LIMITS」即指本节）。
 *
 * 前五项可被仓库根 `.docs-standards.json` 的 `limits` 覆盖；
 * `headerCap` 与 `referenceStaleDays` 是规范本身的固定档位，不可配置。
 */
const LIMITS = Object.freeze({
  /** AGENTS.md 行数上限（G10，warn）。 */
  agents: 100,
  /** README.md 行数上限（G13，warn）。 */
  readme: 120,
  /** 看板待办表行数上限（G12，warn）。 */
  boardTodo: 12,
  /** 看板全文行数上限（G12，warn）。 */
  boardTotal: 70,
  /** 看板活跃「已完成」表保留窗口，超出该归档（G12，warn）。 */
  boardDoneWindow: 12,
  /** 头注 `规模上限:` 的合法取值，按 `类型:` 分档（G3 判红 / G11 判超限，warn）。 */
  headerCap: Object.freeze({ 契约: 300, 规范: 400, 参考: 600 }),
  /** 参考类 `采集日期` 的保鲜天数，超过只告警（G5，warn）。 */
  referenceStaleDays: 180,
});

/**
 * 闸号与名称的唯一出处。闸号 G1–G14 是稳定契约（输出里只用这个号），
 * severity 标出该闸的主判据颜色：red / warn / mixed（同闸内两种都有）。
 */
const GATES = Object.freeze({
  G1: { title: '文件白名单', severity: 'red' },
  G2: { title: '头注完备', severity: 'red' },
  G3: { title: '头注取值', severity: 'red' },
  G4: { title: '必填章节', severity: 'red' },
  G5: { title: '参考类时效', severity: 'mixed' },
  G6: { title: 'CHANGELOG 结构', severity: 'red' },
  G7: { title: '指路坐标存活', severity: 'red' },
  G8: { title: '引用可达', severity: 'red' },
  G9: { title: '零行号', severity: 'red' },
  G10: { title: 'AGENTS 体量', severity: 'warn' },
  G11: { title: '文档体量', severity: 'warn' },
  G12: { title: '工作现场一致性', severity: 'mixed' },
  G13: { title: 'README 体量与描述', severity: 'warn' },
  G14: { title: '计数与承诺词', severity: 'mixed' },
});

/** 枚举与固定词表（不是阈值，但同样只能有一处真源）。 */
const ENUMS = Object.freeze({
  /** G2/G3/G4：头注 `类型:` 的合法取值。 */
  types: Object.freeze(['契约', '规范', '参考']),
  /** 头注豁免文件（按 basename 精确匹配）。 */
  headerExempt: Object.freeze(['README.md', 'AGENTS.md', 'CHANGELOG.md']),
  /** G2：头注必填键——规范正文是五键（类型 + 这四键）。 */
  headerRequired: Object.freeze(['读者', '真源', '更新触发', '规模上限']),
  /** G2：参考类额外必填键。 */
  headerReferenceRequired: Object.freeze(['采集日期', '来源版本']),
  /** G4：契约类必填章节。 */
  contractSections: Object.freeze(['范围', '条款', '验收']),
  /** G12：待办 / 挂起表表头（列名固定，顺序固定）。 */
  boardTodoHeader: Object.freeze(['ID', 'P', '事项', '状态', '下一步', '依据', '最后动']),
  /** G12：已完成表表头（归档区沿用同一套）。 */
  boardDoneHeader: Object.freeze(['ID', '完成于', '一件事', 'commit']),
  /** G12：优先级取值。 */
  priority: Object.freeze(['P0', 'P1', 'P2']),
  /** G12：状态取值（「完成」不在其中——完成＝换表）。 */
  status: Object.freeze(['待开始', '进行中', '挂起', '待评审']),
  /** G12：`下一步` 禁用词——命中即不可执行。 */
  nextStepBanned: Object.freeze(['同上', '待定', '看情况', '继续优化']),
  /** G12：`依据` 禁用词——坐标不能是散文。 */
  basisBanned: Object.freeze(['见上文']),
  /** G6：CHANGELOG 的 `###` 类别白名单。 */
  changelogCategories: Object.freeze([
    'Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security',
  ]),
});

/**
 * 内置默认配置（`.docs-standards.json` 缺省时用）。
 * 注意 `whitelist` 没有默认值：白名单必须由仓库显式声明，否则 G1 记 skip 而不是瞎猜。
 */
const DEFAULT_CONFIG = Object.freeze({
  idPrefixes: Object.freeze(['U', 'M', 'V', 'D']),
  descriptionSource: 'package.json',
});

/** 配置文件名（仓库根）。 */
const CONFIG_NAME = '.docs-standards.json';

/** 工作现场（不入库，存在即校验、不存在即跳过）。 */
const WORK_DIR = '.agents/work';
const BOARD_REL = `${WORK_DIR}/BOARD.md`;
const BOARD_ARCHIVE_REL = `${WORK_DIR}/BOARD-archive.md`;

/* ============================================================================
 * 二、解析
 * ==========================================================================*/

/**
 * 解析命令行参数。
 * @param {string[]} argv process.argv.slice(2)
 * @returns {{root: string, json: boolean, selftest: boolean, help: boolean}}
 */
function parseArgs(argv) {
  const opts = {
    root: process.cwd(), json: false, selftest: false, help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error('--root 需要一个目录参数');
      opts.root = path.resolve(value);
      i += 1;
    } else if (arg.startsWith('--root=')) {
      const value = arg.slice('--root='.length);
      if (!value) throw new Error('--root 需要一个目录参数');
      opts.root = path.resolve(value);
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--selftest') {
      opts.selftest = true;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else {
      throw new Error(`未知参数：${arg}（见 --help）`);
    }
  }
  return opts;
}

/** 用法文本。 */
function usage() {
  return [
    '用法: node scripts/check-docs.mjs [--root <dir>] [--json] [--selftest] [--help]',
    '',
    '  --root <dir>   被检查的仓库根，默认当前目录',
    '  --json         机器可读输出 {red,warn,skip}',
    '  --selftest     只跑内置自测（临时夹具仓库），不检查真实仓库',
    '  --help         打印本用法（含闸清单）',
    '',
    `闸清单: ${Object.keys(GATES).join(' ')}`,
    ...Object.entries(GATES).map(([id, meta]) => `  ${id} ${meta.title}（${meta.severity}）`),
    '  G0 环境与不可判定（git 不可用 → skip；文件读不到 → red），skip 不计入 red/warn',
    '',
    '输出契约: <相对路径>:<行号> G<n> <red|warn> <一句话原因>',
    '          docs-standards: <red> red, <warn> warn, <skip> skip',
    '退出码:   有 red → 1，否则 0；参数错误 → 2',
  ].join('\n');
}

/**
 * 带 `throwIfNoEntry: false` 的 stat，缺路径与异常都收敛成 null。
 * 关键：目录也返回 Stat，调用方必须自己看 isFile()——`wip/U1-x.md/` 这类
 * 「以 .md 结尾的目录」就是靠这里被挡在读取之前，绝不会 readFileSync 抛 EISDIR。
 * @param {string} absPath
 * @returns {fs.Stats|null}
 */
function statSafe(absPath) {
  try {
    return fs.statSync(absPath, { throwIfNoEntry: false }) || null;
  } catch {
    return null;
  }
}

/**
 * 同步执行 git（cwd = root，输出统一是 root 相对路径）。
 * git 不可用时返回 ok:false，调用方降级为文件系统遍历。
 * @param {string} root
 * @param {string[]} args
 * @param {string} [input]
 * @returns {{ok: boolean, status: number, stdout: string, stderr: string}}
 */
function runGit(root, args, input) {
  try {
    const res = spawnSync('git', ['-C', root, ...args], {
      input,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    if (res.error) {
      return { ok: false, status: -1, stdout: '', stderr: String(res.error.message) };
    }
    return {
      ok: res.status === 0,
      status: typeof res.status === 'number' ? res.status : -1,
      stdout: res.stdout || '',
      stderr: res.stderr || '',
    };
  } catch (err) {
    return { ok: false, status: -1, stdout: '', stderr: String(err && err.message) };
  }
}

/**
 * 读取仓库根配置。字段全部可选，缺省落内置默认值。
 * whitelist 例外：只有配置文件里真的写了 whitelist，G1 才可判；否则 G1 skip。
 * @param {string} root
 * @returns {object} 归一化后的配置信息
 */
function loadConfig(root) {
  const abs = path.join(root, CONFIG_NAME);
  const stat = statSafe(abs);
  const info = {
    present: Boolean(stat && stat.isFile()),
    path: CONFIG_NAME,
    error: null,
    hasWhitelist: false,
    whitelist: null,
    hasExclude: false,
    exclude: [],
    lines: [],
    idPrefixes: [...DEFAULT_CONFIG.idPrefixes],
    limits: {
      agents: LIMITS.agents,
      readme: LIMITS.readme,
      boardTodo: LIMITS.boardTodo,
      boardTotal: LIMITS.boardTotal,
      boardDoneWindow: LIMITS.boardDoneWindow,
    },
    descriptionSource: DEFAULT_CONFIG.descriptionSource,
  };
  if (!info.present) return info;

  let text = '';
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    info.error = `读不到 ${CONFIG_NAME}：${err && err.code ? err.code : err}`;
    return info;
  }
  info.lines = text.split('\n');

  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    info.error = `${CONFIG_NAME} 不是合法 JSON：${err && err.message}`;
    return info;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    info.error = `${CONFIG_NAME} 顶层必须是对象`;
    return info;
  }

  if (Array.isArray(raw.whitelist)) {
    const list = raw.whitelist.filter((x) => typeof x === 'string' && x.trim() !== '');
    if (list.length > 0) {
      info.hasWhitelist = true;
      info.whitelist = list.map((x) => x.trim());
    }
  }
  if (Array.isArray(raw.exclude)) {
    const list = raw.exclude.filter((x) => typeof x === 'string' && x.trim() !== '');
    if (list.length > 0) {
      info.hasExclude = true;
      info.exclude = list.map((x) => x.trim());
    }
  }
  if (Array.isArray(raw.idPrefixes)) {
    const list = raw.idPrefixes.filter((x) => typeof x === 'string' && /^[A-Z]+$/.test(x.trim()));
    if (list.length > 0) info.idPrefixes = list.map((x) => x.trim());
  }
  if (raw.limits && typeof raw.limits === 'object' && !Array.isArray(raw.limits)) {
    for (const key of Object.keys(info.limits)) {
      const value = raw.limits[key];
      if (Number.isFinite(value) && value > 0) info.limits[key] = Math.floor(value);
    }
  }
  if (typeof raw.descriptionSource === 'string' && raw.descriptionSource.trim() !== '') {
    info.descriptionSource = raw.descriptionSource.trim();
  }
  return info;
}

/**
 * 递归收集 markdown 文件（git 不可用时的降级路径）。
 * @param {string} root
 * @param {number} [depth]
 * @returns {string[]} root 相对 POSIX 路径
 */
function walkMarkdown(root, depth = 0) {
  if (depth > 12) return [];
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const abs = path.join(root, entry.name);
    let isDir = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      const st = statSafe(abs);
      isDir = Boolean(st && st.isDirectory());
      isFile = Boolean(st && st.isFile());
    }
    if (isDir) {
      out.push(...walkMarkdown(abs, depth + 1));
    } else if (isFile && entry.name.endsWith('.md')) {
      out.push(abs);
    }
  }
  return out;
}

/**
 * 批量问 git 哪些路径被 ignore（`.agents/**` 之外的第二道兜底）。
 * @param {string} root
 * @param {string[]} rels
 * @returns {Set<string>}
 */
function ignoredPaths(root, rels) {
  const set = new Set();
  if (rels.length === 0) return set;
  const res = runGit(root, ['check-ignore', '-z', '--stdin'], `${rels.join('\0')}\0`);
  // 退出码 1 = 一个都没被 ignore；128 = 不在 git 仓库 / 参数错 → 无法判定就不排除
  if (res.status !== 0 && res.status !== 1) return set;
  for (const item of res.stdout.split('\0')) {
    if (item) set.add(item);
  }
  return set;
}

/**
 * 建立上下文：配置 + 待检查文件清单 + 文档缓存。
 * @param {string} root 绝对路径
 * @returns {object}
 */
function buildContext(root) {
  const config = loadConfig(root);
  const ctx = {
    root,
    config,
    docs: new Map(),
    files: [],
    fileSource: 'walk',
    gitAvailable: false,
    scopeNote: null,
    report: createReport(),
  };

  // 仓库里的 md 都算（含未跟踪）：新建的坏文档不能因为「还没 git add」就对全闸隐形
  // （这正是「新建文档必须同批改白名单`」那条摩擦成立的前提）
  const tracked = runGit(root, ['ls-files', '-z', '--', '*.md']);
  const untracked = runGit(root, ['ls-files', '-z', '-o', '--exclude-standard', '--', '*.md']);
  let rels;
  if (tracked.ok) {
    ctx.gitAvailable = true;
    ctx.fileSource = 'git';
    rels = [
      ...tracked.stdout.split('\0').filter(Boolean),
      ...untracked.stdout.split('\0').filter(Boolean),
    ];
  } else {
    ctx.scopeNote = `git ls-files 不可用（${tracked.stderr.trim() || 'not a git repo'}），降级为文件系统遍历`;
    rels = walkMarkdown(root).map((abs) => toRel(ctx, abs));
  }

  const deduped = new Set();
  for (const rel of rels) {
    const norm = rel.split(path.sep).join('/');
    if (!norm.endsWith('.md')) continue;
    if (norm.startsWith('.agents/') || norm === '.agents') continue;
    if (norm.split('/').includes('.git')) continue;
    deduped.add(norm);
  }
  const candidate = [...deduped].sort();
  const ignored = ignoredPaths(root, candidate);
  // exclude：整组文件不进任何闸，用来放「仓库里夹带的产品内容」（如技能 bundle）。
  // 别用 whitelist 代替——whitelist 只回答「这份文档允不允许存在」，进白名单仍要过 G2–G14。
  const excludeRes = config.hasExclude ? config.exclude.map((raw) => globToRegExp(raw)) : [];
  ctx.files = candidate.filter(
    (rel) => !ignored.has(rel) && !excludeRes.some((re) => re.test(rel)),
  );
  return ctx;
}

/**
 * 绝对路径转 root 相对 POSIX 路径。
 * @param {object} ctx
 * @param {string} absPath
 * @returns {string}
 */
function toRel(ctx, absPath) {
  return path.relative(ctx.root, absPath).split(path.sep).join('/');
}

/**
 * 只读一次文件，缓存解析结果。非文件条目（目录 / 坏软链）不抛异常，标记 missing。
 * @param {object} ctx
 * @param {string} rel root 相对 POSIX 路径
 * @returns {object} doc
 */
function getDoc(ctx, rel) {
  const cached = ctx.docs.get(rel);
  if (cached) return cached;

  const abs = path.join(ctx.root, rel);
  const stat = statSafe(abs);
  if (!stat || !stat.isFile()) {
    const missingDoc = {
      rel,
      abs,
      missing: true,
      reason: stat ? 'not-a-file' : 'missing',
      text: '',
      lines: [],
      masked: [],
      headings: [],
      headerNote: new Map(),
      rawType: null,
      type: null,
      badType: null,
      lineCount: 0,
    };
    ctx.docs.set(rel, missingDoc);
    return missingDoc;
  }

  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    const code = (err && err.code) || 'read-error';
    // 读不到 ≠ 通过：不能让一个 chmod 000 的坏文档与干净仓库同形（必须留下 red）
    ctx.report.add('G0', 'red', rel, 0, `读不到（${code}），无法判定`);
    const badDoc = {
      rel,
      abs,
      missing: true,
      reason: code,
      text: '',
      lines: [],
      masked: [],
      headings: [],
      headerNote: new Map(),
      rawType: null,
      type: null,
      badType: null,
      lineCount: 0,
    };
    ctx.docs.set(rel, badDoc);
    return badDoc;
  }

  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const trailingNewline = lines.length > 1 && lines[lines.length - 1] === '';
  const lineCount = trailingNewline ? lines.length - 1 : lines.length;
  const masked = maskFences(lines);
  const headerNote = parseHeaderNote(lines);
  const rawType = headerNote.has('类型') ? headerNote.get('类型').value : null;
  const type = detectType(rawType);

  const doc = {
    rel,
    abs,
    missing: false,
    reason: null,
    text: normalized,
    lines,
    masked,
    lineCount,
    headings: parseHeadings(masked),
    headerNote,
    rawType,
    type,
    badType: rawType !== null && type === null ? rawType : null,
  };
  ctx.docs.set(rel, doc);
  return doc;
}

/** 按需加载全部在册文件。 */
function allDocs(ctx) {
  return ctx.files.map((rel) => getDoc(ctx, rel)).filter((doc) => !doc.missing);
}

/**
 * 把围栏代码块内容清空（行号 1:1 保留），避免把示例当正文。
 * @param {string[]} lines
 * @returns {string[]}
 */
function maskFences(lines) {
  const out = [];
  let fence = null;
  for (const line of lines) {
    const match = /^\s*(```+|~~~+)/.exec(line);
    if (match) {
      const marker = match[1][0].repeat(3);
      if (fence === null) {
        fence = marker;
        out.push('');
        continue;
      }
      if (marker === fence) {
        fence = null;
        out.push('');
        continue;
      }
    }
    out.push(fence === null ? line : '');
  }
  return out;
}

/**
 * 剥掉行内代码（`` `x` ``），保留其余正文。
 *
 * 规则文件必须能**引用**它禁止的模式：规范里写「禁 `file.ext:123`」时，
 * 那段是被反引号包住的示例，不是真正的行号引用。G9 / G14 都先过这一层。
 * @param {string} text
 * @returns {string}
 */
function stripInlineCode(text) {
  return String(text).replace(/(`+)([^`]*?)\1/g, ' ');
}

/**
 * 去掉行内代码的**反引号但保留内容**（`` `1d93c1b` `` → `1d93c1b`）。
 *
 * 与 stripInlineCode 的分工：G9/G14 要「看不见」被引用的模式，所以整段清空；
 * 看板的 `依据` / `commit` 要**读到内容**再判真伪，所以只脱壳、不删内容。
 * @param {string} text
 * @returns {string}
 */
function unwrapInlineCode(text) {
  return String(text).replace(/(`+)([^`]*?)\1/g, '$2');
}

/**
 * 抹掉「编号引用」，只留下真正的计数。
 *
 * 「顺手看第 1、4、5 条」里的 `5 条` 是交叉引用的编号，不是「有 5 条」；
 * `§2.3` 同理。G14 的计数判据先抹掉这两类形态再匹配。
 * @param {string} text
 * @returns {string}
 */
function maskNumberingRefs(text) {
  return String(text)
    .replace(/第\s*\d+(?:\s*[、,，和及]\s*\d+)*\s*[条行节章项篇]/g, ' ')
    .replace(/§\s*\d+(?:\.\d+)*/g, ' ');
}

/**
 * 归一化相对路径：去 `./` 前缀、反斜杠转 `/`。
 * @param {string} value
 * @returns {string}
 */
function normalizeRelPath(value) {
  return String(value).trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * 解析标题（只在围栏外的行上认 #）。
 * @param {string[]} masked
 * @returns {Array<{level: number, text: string, line: number}>}
 */
function parseHeadings(masked) {
  const out = [];
  for (let i = 0; i < masked.length; i += 1) {
    const match = /^(#{1,6})\s+(.*\S)\s*$/.exec(masked[i]);
    if (match) {
      out.push({ level: match[1].length, text: match[2].trim(), line: i + 1 });
    }
  }
  return out;
}

/**
 * 解析文件头注（`>` 引用块里的 `键：值`）。
 *
 * 顺序：可跳过 YAML frontmatter，然后允许 H1 在前或在后，取紧邻的 `>` 块。
 * 键值分隔符半角/全角冒号都认（规范正文里写的是全角 `：`）。
 * @param {string[]} lines
 * @returns {Map<string, {value: string, line: number}>}
 */
function parseHeaderNote(lines) {
  const keys = new Map();
  let index = 0;
  if (lines.length > 0 && lines[0].trim() === '---') {
    let cursor = 1;
    while (cursor < lines.length && lines[cursor].trim() !== '---') cursor += 1;
    if (cursor < lines.length) index = cursor + 1;
  }

  let inNote = false;
  for (; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed === '') {
      if (inNote) break;
      continue;
    }
    if (/^#{1,6}\s/.test(trimmed)) {
      if (inNote) break;
      continue;
    }
    if (trimmed.startsWith('>')) {
      inNote = true;
      const match = /^>\s*([^\s:：]+)\s*[:：]\s*(.*)$/.exec(trimmed);
      if (match) {
        const key = match[1].trim();
        if (!keys.has(key)) {
          keys.set(key, { value: match[2].trim(), line: index + 1 });
        }
      }
      continue;
    }
    // 头注块之外的第一段正文：头注到此结束（头注必须在文件头部）
    if (inNote) break;
    break;
  }
  return keys;
}

/**
 * `类型:` 取值归一化：允许「契约」「契约（reference 型）」这类写法。
 * @param {string|null} raw
 * @returns {string|null}
 */
function detectType(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  for (const type of ENUMS.types) {
    if (trimmed.startsWith(type)) return type;
  }
  for (const type of ENUMS.types) {
    if (trimmed.includes(type)) return type;
  }
  return null;
}

/**
 * 按未转义的 `|` 切表单元格。
 *
 * - 去掉行首/行尾的装订竖线；
 * - 单元格里的 `\|` 是转义，还原成 `|` 且**不切格**（切格与转义只在这里实现一次）。
 * @param {string} line
 * @returns {string[]}
 */
function splitCells(line) {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
  const cells = [];
  let buffer = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '\\' && body[i + 1] === '|') {
      buffer += '|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(buffer.trim());
      buffer = '';
      continue;
    }
    buffer += ch;
  }
  cells.push(buffer.trim());
  return cells;
}

/**
 * 是否是 markdown 表格的分隔行（`|---|:--:|`）。
 * @param {string[]} cells
 * @returns {boolean}
 */
function isSeparatorRow(cells) {
  if (cells.length === 0) return false;
  return cells.every((cell) => /^:?-+:?$/.test(cell.trim()));
}

/**
 * 解析所有表格。
 *
 * 铁律：**第 1 行永远是表头**；只有第 2 行确实是分隔行时才跳过它。
 * 缺分隔行时把第 2 行当数据照常校验——否则首行数据会被当分隔行吞掉，
 * 那一行不经任何规则却 exit 0（典型的静默洞）。
 * @param {string[]} maskedLines
 * @returns {Array<{header: object, rows: object[], hasSeparator: boolean, startLine: number, endLine: number}>}
 */
function parseTables(maskedLines) {
  const tables = [];
  let index = 0;
  const isRowLine = (line) => /^\s*\|/.test(line) && line.includes('|');
  while (index < maskedLines.length) {
    if (!isRowLine(maskedLines[index])) {
      index += 1;
      continue;
    }
    const block = [];
    while (index < maskedLines.length && isRowLine(maskedLines[index])) {
      block.push({
        line: index + 1,
        raw: maskedLines[index],
        cells: splitCells(maskedLines[index]),
      });
      index += 1;
    }
    if (block.length === 0) continue;
    const hasSeparator = block.length > 1 && isSeparatorRow(block[1].cells);
    const header = block[0];
    const rows = hasSeparator ? block.slice(2) : block.slice(1);
    tables.push({
      header,
      rows,
      hasSeparator,
      startLine: header.line,
      endLine: block[block.length - 1].line,
    });
  }
  return tables;
}

/** 表头单元格归一化（去反引号 / 加粗 / 全角空格）。 */
function normCell(cell) {
  return String(cell)
    .replace(/[`*]/g, '')
    .replace(/\u00a0/g, ' ')
    .trim();
}

/**
 * 表头是否逐列等于期望列名。
 * @param {string[]} cells
 * @param {readonly string[]} expected
 * @returns {boolean}
 */
function headersEqual(cells, expected) {
  const got = cells.map(normCell);
  if (got.length !== expected.length) return false;
  return got.every((cell, index) => cell === expected[index]);
}

/**
 * 是否是合法 ISO 日期 `YYYY-MM-DD`。
 * @param {string} value
 * @returns {boolean}
 */
function isIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

/**
 * 两个 ISO 日期相差天数（b - a）。
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function daysBetween(a, b) {
  const first = Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)));
  const second = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10)));
  return Math.round((second - first) / 86400000);
}

/**
 * 通配符转正则：`**` 跨目录、`*` 单段、`?` 单字符。
 * @param {string} glob
 * @returns {RegExp}
 */
function globToRegExp(glob) {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') {
          i += 1;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (ch === '?') {
      source += '[^/]';
      continue;
    }
    source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

/** 白名单条目里含通配符吗。 */
function hasWildcard(pattern) {
  return pattern.includes('*') || pattern.includes('?');
}

/* ============================================================================
 * 三、各闸（G1–G14）
 * ==========================================================================*/

/**
 * G1 文件白名单：仓库里的 `*.md`（含未跟踪）⊆ whitelist 通配；`.agents/**` 与 gitignored 一律排除。
 * 反向也查：白名单里的**具体文件**（无通配）没命中任何文件 → 缺失或改名。
 * @param {object} ctx
 */
function gateG1(ctx) {
  const { report, config } = ctx;
  if (!config.present || !config.hasWhitelist) {
    const reason = config.error
      ? `${CONFIG_NAME} 无法读取（${config.error}），白名单不可判`
      : `未配置 ${CONFIG_NAME} 的 whitelist，白名单不可判`;
    report.addSkip('G1', reason);
    return;
  }

  const patterns = config.whitelist.map((raw) => ({ raw, re: globToRegExp(raw) }));
  const matched = new Set();

  for (const rel of ctx.files) {
    const hit = patterns.find((item) => item.re.test(rel));
    if (hit) {
      matched.add(hit.raw);
    } else {
      report.add('G1', 'red', rel, 1, `不在白名单：${rel}（新建文档必须同批改 ${CONFIG_NAME} 的 whitelist）`);
    }
  }

  for (const item of patterns) {
    if (matched.has(item.raw)) continue;
    if (hasWildcard(item.raw)) continue; // 通配条目允许暂时不命中（例如还没建 docs/）
    const line = configLineOf(config, item.raw);
    report.add(
      'G1',
      'red',
      CONFIG_NAME,
      line,
      `白名单条目缺失或改名：${item.raw} 未命中仓库里的任何 md`,
    );
  }
}

/**
 * 白名单条目在配置文件里的行号（找不到就 1）。
 * @param {object} config
 * @param {string} raw
 * @returns {number}
 */
function configLineOf(config, raw) {
  for (let i = 0; i < config.lines.length; i += 1) {
    if (config.lines[i].includes(`"${raw}"`)) return i + 1;
  }
  return 1;
}

/**
 * G2 头注完备：`类型:` ∈ 三类的文件必须有 `读者 / 更新触发 / 规模上限`，
 * 参考类另需 `采集日期 / 来源版本`。README / AGENTS / CHANGELOG 豁免。
 * @param {object} ctx
 */
function gateG2(ctx) {
  const { report } = ctx;
  for (const rel of ctx.files) {
    const base = path.posix.basename(rel);
    if (ENUMS.headerExempt.includes(base)) continue;
    if (isArchivePath(rel)) continue; // archive/ 用「归档于 <日期>」头，不用类型头注

    const doc = getDoc(ctx, rel);
    if (doc.missing) continue; // 目录 / 坏软链：不崩，交给 G1 的白名单判定

    if (doc.rawType === null) {
      report.add('G2', 'red', rel, 1, '无头注：未找到「> 类型：契约 | 规范 | 参考」');
      continue;
    }
    if (doc.type === null) {
      report.add(
        'G2',
        'red',
        rel,
        doc.headerNote.get('类型').line,
        `头注 类型 取值不合法：${doc.badType}（只允许 ${ENUMS.types.join(' / ')}）`,
      );
      continue;
    }

    const required = [...ENUMS.headerRequired];
    if (doc.type === '参考') required.push(...ENUMS.headerReferenceRequired);
    for (const key of required) {
      if (doc.headerNote.has(key)) continue;
      report.add('G2', 'red', rel, doc.headerNote.get('类型').line, `头注缺键：${key}`);
    }
  }
}

/** 是否在 archive 目录（归档件另有头部约定）。 */
function isArchivePath(rel) {
  return rel.split('/').includes('archive');
}

/**
 * G3 头注取值：`规模上限:` 必须等于类型对应档位（契约 300 / 规范 400 / 参考 600）。
 * @param {object} ctx
 */
function gateG3(ctx) {
  const { report } = ctx;
  for (const rel of ctx.files) {
    const doc = getDoc(ctx, rel);
    if (doc.missing || !doc.type) continue;
    const entry = doc.headerNote.get('规模上限');
    if (!entry) continue; // 缺键已由 G2 判红，这里不重复

    const expected = LIMITS.headerCap[doc.type];
    const digits = entry.value.replace(/[^\d]/g, '');
    if (digits === '') {
      report.add('G3', 'red', rel, entry.line, `规模上限 取值无法解析：${entry.value || '(空)'}（应为 ${expected}）`);
      continue;
    }
    const actual = Number(digits);
    if (actual !== expected) {
      report.add('G3', 'red', rel, entry.line, `规模上限 应为 ${expected}（${doc.type}），实为 ${actual}`);
    }
  }
}

/**
 * G4 必填章节：契约必须有 范围 / 条款 / 验收 三节；规范至少要有一个含「验收」的 `##` 章节。
 * @param {object} ctx
 */
function gateG4(ctx) {
  const { report } = ctx;
  for (const rel of ctx.files) {
    const doc = getDoc(ctx, rel);
    if (doc.missing || !doc.type) continue;

    if (doc.type === '契约') {
      for (const section of ENUMS.contractSections) {
        const found = doc.headings.some(
          (h) => h.level === 2 && (h.text === section || h.text.startsWith(`${section} `) || h.text.startsWith(`${section}　`)),
        );
        if (!found) report.add('G4', 'red', rel, 1, `契约缺必填章节：## ${section}`);
      }
      continue;
    }

    if (doc.type === '规范') {
      const found = doc.headings.some((h) => h.level === 2 && h.text.includes('验收'));
      if (!found) report.add('G4', 'red', rel, 1, '规范缺必填章节：没有任何含「验收」的 ## 章节');
    }
  }
}

/**
 * G5 参考类时效：`采集日期` 必须是 YYYY-MM-DD；距今天 > 180 天只告警。
 * @param {object} ctx
 * @param {Date} [today]
 */
function gateG5(ctx, today = new Date()) {
  const { report } = ctx;
  const nowIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  for (const rel of ctx.files) {
    const doc = getDoc(ctx, rel);
    if (doc.missing || doc.type !== '参考') continue;

    const entry = doc.headerNote.get('采集日期');
    if (!entry) {
      report.add('G5', 'red', rel, doc.headerNote.get('类型').line, '参考类缺 采集日期（YYYY-MM-DD），时效无从判断');
      continue;
    }
    if (!isIsoDate(entry.value)) {
      report.add('G5', 'red', rel, entry.line, `采集日期 不是 YYYY-MM-DD：${entry.value || '(空)'}`);
      continue;
    }
    const age = daysBetween(entry.value, nowIso);
    if (age > LIMITS.referenceStaleDays) {
      report.add(
        'G5',
        'warn',
        rel,
        entry.line,
        `采集日期 距今 ${age} 天 > ${LIMITS.referenceStaleDays} 天，该整份重采了`,
      );
    }
  }
}

/**
 * G6 CHANGELOG 结构：必须有 `## [Unreleased]`；版本标题必须是
 * `## [x.y.z] - YYYY-MM-DD`（可选 `[YANKED]`）；`###` 类别只允许官方六类。
 * @param {object} ctx
 */
function gateG6(ctx) {
  const { report } = ctx;
  const rel = 'CHANGELOG.md';
  const doc = getDoc(ctx, rel);
  if (doc.missing) {
    report.addSkip('G6', `${rel} 不存在，CHANGELOG 结构跳过`);
    return;
  }

  const hasUnreleased = doc.masked.some((line) => /^##\s*\[Unreleased\]\s*$/.test(line.trim()));
  if (!hasUnreleased) {
    report.add('G6', 'red', rel, 1, '缺 `## [Unreleased]`（未发版改动必须有落点）');
  }

  const versionRe = /^##\s*\[\d+\.\d+\.\d+\]\s*-\s*\d{4}-\d{2}-\d{2}(\s*\[YANKED\])?$/;
  for (let i = 0; i < doc.masked.length; i += 1) {
    const line = doc.masked[i].trim();
    if (!/^##\s/.test(line)) continue;
    if (/^##\s*\[Unreleased\]/.test(line)) continue;
    // 像版本号却没用方括号的标题（`## 1.2.0 - 2026-01-05`）同样不合规，
    // 否则「漏写方括号」会整条逃过本闸；`## 用法` 这类普通小节不在范围内。
    const looksLikeVersion = /^##\s*(\[)?\s*v?\d+\.\d+/.test(line);
    if (!/^##\s*\[/.test(line) && !looksLikeVersion) continue;
    if (!versionRe.test(line)) {
      report.add(
        'G6',
        'red',
        rel,
        i + 1,
        `版本标题不合规：${line}（应为 ## [x.y.z] - YYYY-MM-DD，可选 [YANKED]）`,
      );
    }
  }

  for (let i = 0; i < doc.masked.length; i += 1) {
    const match = /^###\s+(.+?)\s*$/.exec(doc.masked[i].trim());
    if (!match) continue;
    const category = match[1].trim();
    if (!ENUMS.changelogCategories.includes(category)) {
      report.add(
        'G6',
        'red',
        rel,
        i + 1,
        `类别不在白名单：### ${category}（只允许 ${ENUMS.changelogCategories.join(' / ')}）`,
      );
    }
  }
}

/**
 * G7 指路坐标存活：契约正文里的 `§x.y` / `附录 X.n` 要能 grep 到对应标题编号；
 * 任何文档里的 `AGENTS.md 硬约束 N` 要能在 AGENTS.md 命中 `^N. **`。
 * @param {object} ctx
 */
function gateG7(ctx) {
  const { report } = ctx;
  const docs = allDocs(ctx);
  const index = buildHeadingIndex(ctx); // 编号 → 文件集合，G12 的依据校验也用它

  for (const doc of docs) {
    if (doc.type === '契约') {
      const own = index.byFile.get(doc.rel) || new Set();
      const lines = proseLines(doc);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line || !line.includes('§') && !line.includes('附录')) continue;

        const sectionRe = /§\s*(\d+(?:\.\d+)*)/g;
        let match;
        while ((match = sectionRe.exec(line)) !== null) {
          const ref = match[1];
          if (own.has(ref) || index.global.has(ref)) continue;
          report.add('G7', 'red', doc.rel, i + 1, `指路坐标 §${ref} 找不到对应标题编号`);
        }

        const appendixRe = /附录\s*([A-Z]\.\d+(?:\.\d+)*)/g;
        while ((match = appendixRe.exec(line)) !== null) {
          const ref = match[1];
          if (own.has(ref) || index.global.has(ref)) continue;
          report.add('G7', 'red', doc.rel, i + 1, `指路坐标 附录 ${ref} 找不到对应标题`);
        }
      }
    }
  }

  // `AGENTS.md 硬约束 N` 全仓校验
  const agentsDoc = getDoc(ctx, 'AGENTS.md');
  for (const doc of docs) {
    const lines = proseLines(doc);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line || !line.includes('硬约束')) continue;
      const re = /AGENTS\.md\s*硬约束\s*(\d+)/g;
      let match;
      while ((match = re.exec(line)) !== null) {
        const number = match[1];
        if (agentsDoc.missing) {
          report.add('G7', 'red', doc.rel, i + 1, `引用了 AGENTS.md 硬约束 ${number}，但 AGENTS.md 不存在`);
          continue;
        }
        if (!hasHardConstraint(agentsDoc, number)) {
          report.add('G7', 'red', doc.rel, i + 1, `AGENTS.md 硬约束 ${number} 命中不到（AGENTS.md 无「${number}. **」开头条目）`);
        }
      }
    }
  }
}

/**
 * 收集一份文档里的标题编号（3.2 / 1 / A.1 都要）。
 * @param {object} doc
 * @returns {Set<string>}
 */
function headingNumbers(doc) {
  const set = new Set();
  for (const heading of doc.headings) {
    const text = heading.text;
    const leading = /^\s*(\d+(?:\.\d+)*)(?=[\s.、:：]|$)/.exec(text);
    if (leading) set.add(leading[1]);
    const dotted = text.match(/\d+(?:\.\d+)+/g) || [];
    for (const item of dotted) set.add(item);
    const appendix = text.match(/[A-Z]\.\d+(?:\.\d+)*/g) || [];
    for (const item of appendix) set.add(item);
  }
  return set;
}

/**
 * 建立标题编号索引（G7 的指路坐标校验与 G12 的依据坐标校验共用，只算一次）。
 * @param {object} ctx
 * @returns {{byFile: Map<string, Set<string>>, global: Map<string, Set<string>>}}
 */
function buildHeadingIndex(ctx) {
  if (ctx.headingIndex) return ctx.headingIndex;
  const byFile = new Map();
  const global = new Map();
  for (const doc of allDocs(ctx)) {
    const numbers = headingNumbers(doc);
    byFile.set(doc.rel, numbers);
    for (const number of numbers) {
      if (!global.has(number)) global.set(number, new Set());
      global.get(number).add(doc.rel);
    }
  }
  ctx.headingIndex = { byFile, global };
  return ctx.headingIndex;
}

/**
 * AGENTS.md 里是否存在 `N. **` 形态的硬约束条目（`N、**` 也认）。
 * @param {object} agentsDoc
 * @param {string} number
 * @returns {boolean}
 */
function hasHardConstraint(agentsDoc, number) {
  const re = new RegExp(`^${number}[.、]\\s*\\*\\*`);
  return agentsDoc.masked.some((row) => re.test(row.trim()));
}

/**
 * G8 引用可达：markdown 相对链接、以及正文里点名的仓库内路径（`docs/…`、`.agents/…`）都必须存在。
 * 外部 http(s) 链接跳过；含占位符（`<`、`{`、`*`、`…`）的示例路径跳过。
 * @param {object} ctx
 */
function gateG8(ctx) {
  const { report } = ctx;
  for (const rel of ctx.files) {
    const doc = getDoc(ctx, rel);
    if (doc.missing) continue;
    const dir = path.posix.dirname(rel);
    const checked = new Set(); // 本文件内已判定过的目标（同一目标不重复解析）
    const reported = new Set(); // 本文件内已报过的目标：同一目标只报一条，优先级 链接 > 文档地图 > 正文路径

    const claim = (key) => {
      if (reported.has(key)) return false;
      reported.add(key);
      return true;
    };

    // 第一趟：markdown 链接（最高优先——它是最明确的引用意图）
    const lines = proseLines(doc);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line) continue;
      const linkRe = /\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
      let match;
      while ((match = linkRe.exec(line)) !== null) {
        const target = cleanLinkTarget(match[1]);
        if (!target) continue;
        const key = normalizeRelPath(target);
        if (checked.has(`link:${key}`)) continue;
        checked.add(`link:${key}`);
        const candidates = target.startsWith('/')
          ? [path.join(ctx.root, target.slice(1))]
          : [path.join(ctx.root, dir, target), path.join(ctx.root, target)];
        if (candidates.some((abs) => Boolean(statSafe(abs)))) continue;
        if (!claim(key)) continue;
        report.add('G8', 'red', rel, i + 1, `链接目标不存在：${target}`);
      }
    }

    // 第二趟：`## 文档地图` 小节里的表格，逐格逐 token 按仓库根解析
    for (const section of docMapSections(doc)) {
      for (const table of section.tables) {
        for (const row of [table.header, ...table.rows]) {
          for (const cell of row.cells) {
            for (const token of extractPathTokens(cell)) {
              const key = normalizeRelPath(token);
              if (checked.has(`map:${key}`)) continue;
              checked.add(`map:${key}`);
              if (Boolean(statSafe(path.join(ctx.root, token)))) continue;
              if (!claim(key)) continue;
              report.add('G8', 'red', rel, row.line, `文档地图里的路径不存在：${token}`);
            }
          }
        }
      }
    }

    // 第三趟：正文里点名的 `docs/…` / `.agents/…`
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line) continue;
      for (const token of repoPathTokens(line)) {
        const key = normalizeRelPath(token);
        if (checked.has(`path:${key}`)) continue;
        checked.add(`path:${key}`);
        if (Boolean(statSafe(path.join(ctx.root, token)))) continue;
        if (!claim(key)) continue; // 链接或文档地图已经报过同一目标
        report.add('G8', 'red', rel, i + 1, `正文提到的路径不存在：${token}`);
      }
    }
  }
}

/**
 * 找出一份文档里所有标题含「文档地图」的 `##` 小节，并解析其下的表格。
 *
 * 判据来自规范闸表：「`AGENTS.md` 文档地图里的路径、md 相对链接都存在」。
 * 地图表格里的路径是**按仓库根写的裸路径**（`spec.md`、`reference.md`），
 * 不会带 `docs/` 前缀，所以 G8 的正文路径正则抓不到——必须单独扫一遍。
 * @param {object} doc
 * @returns {Array<{heading: object, tables: object[]}>}
 */
function docMapSections(doc) {
  const tables = parseTables(doc.masked);
  const out = [];
  for (let i = 0; i < doc.headings.length; i += 1) {
    const heading = doc.headings[i];
    if (heading.level !== 2 || !heading.text.includes('文档地图')) continue;
    let end = doc.masked.length + 1;
    for (let j = i + 1; j < doc.headings.length; j += 1) {
      if (doc.headings[j].level <= 2) {
        end = doc.headings[j].line;
        break;
      }
    }
    out.push({
      heading,
      tables: tables.filter((table) => table.startLine > heading.line && table.startLine < end),
    });
  }
  return out;
}

/**
 * 从表格单元格里抽出「路径式」token（`a/b.md`、`a/b/`），反引号内的也算。
 *
 * 一格塞多个路径（`` `reference.md` / `docs/reference/` ``）时逐个返回，
 * 绝不把整格当一条路径——否则并列表述会被判成一条不存在的怪路径。
 * @param {string} cell
 * @returns {string[]}
 */
function extractPathTokens(cell) {
  const source = String(cell);
  const tokens = [];
  const seen = new Set();
  const push = (candidate, allowSpaces) => {
    const token = shapePathToken(candidate, allowSpaces);
    if (!token || seen.has(token)) return;
    seen.add(token);
    tokens.push(token);
  };

  // 第一步：反引号 / 角括号里是**整段**路径，先整体取出，
  // 否则 `docs/reference/api 2024.md` 会被空白切成 `2024.md` 与 `docs/reference/api` 两条假路径。
  const spanRe = /`([^`]+)`|<([^<>]+)>/g;
  let match;
  while ((match = spanRe.exec(source)) !== null) {
    push(match[1] !== undefined ? match[1] : match[2], true);
  }

  // 第二步：剩下的裸文本按空白与标点切
  for (const piece of source.replace(spanRe, ' ').split(/[\s、，,；;：:（）()\[\]【】|]+/)) {
    push(piece, false);
  }
  return tokens;
}

/**
 * 把一个候选片段收成路径 token；不是路径就返回 null。
 * @param {string} raw
 * @param {boolean} allowSpaces 是否允许内部含空格（反引号 / 角括号里的整段路径）
 * @returns {string|null}
 */
function shapePathToken(raw, allowSpaces) {
  const piece = String(raw).trim();
  if (piece === '') return null;
  if (/[<>{}*…]/.test(piece)) return null; // 占位符示例不判
  let token;
  if (allowSpaces && /\.md$/.test(piece)) {
    token = piece; // 允许 `api 2024.md` 这种带空格的真实文件名
  } else {
    const head = /^\.?[\w][\w.\/-]*/.exec(piece);
    if (!head) return null; // 中文开头（「团队编码规范」）不是路径
    token = head[0].replace(/[.,;:]+$/, '');
  }
  if (token === '' || token === '/') return null;
  if (!token.endsWith('.md') && !token.endsWith('/')) return null;
  // 单段目录（`wip/`）在多上下文里是相对说法（「回来读 wip/」指 .agents/work/wip/），
  // 按仓库根解析必然不存在——只判带父级的目录（`docs/reference/`）与 .md 文件。
  if (token.endsWith('/') && !token.slice(0, -1).includes('/')) return null;
  return token;
}

/**
 * 从一行正文里抽「仓库内路径」（`docs/…` / `.agents/…`）。
 *
 * 反引号与角括号里是整段路径，先整体取出——否则 `docs/reference/api 2024.md`
 * 会被空白切成 `docs/reference/api` 这条不存在的假路径。
 * @param {string} line
 * @returns {string[]}
 */
function repoPathTokens(line) {
  const source = String(line);
  const out = [];
  const spanRe = /`([^`]+)`|<([^<>]+)>/g;
  let match;
  while ((match = spanRe.exec(source)) !== null) {
    const inner = (match[1] !== undefined ? match[1] : match[2]).split('§')[0].trim();
    if (/^(docs|\.agents)\//.test(inner)) out.push(inner.replace(/[.,;:!?]+$/, ''));
  }
  for (const piece of source.replace(spanRe, ' ').split(/[\s、，,；;：:（）()\[\]【】|]+/)) {
    let cleaned = piece
      .replace(/^[（(]+/, '')
      .replace(/[.,;:!?、。，；：）)】」』"']+$/u, '');
    try {
      cleaned = decodeURIComponent(cleaned); // 与链接判据一致：%20 与空格是同一个文件
    } catch {
      /* 非法百分号编码：按字面判 */
    }
    if (/^(docs|\.agents)\//.test(cleaned)) out.push(cleaned);
  }
  // 正文里的目录只是「放哪」的说法（「参考类 ≥2 份放 docs/reference/」），
  // 不按仓库根当引用判；目录存在性由文档地图那一趟负责。
  // 占位符与通配（`docs/…`、`docs/**`、`.agents/*`、`docs/x.md §3.2`）也不是路径。
  return out.filter((token) => !token.endsWith('/') && !/[<>{}*…§]/.test(token));
}

/**
 * 清洗 markdown 链接目标：去掉锚点/查询串，过滤外部协议与占位符示例，并解码 `%20`。
 * @param {string} raw
 * @returns {string|null}
 */
function cleanLinkTarget(raw) {
  let target = String(raw).trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1).trim();
  if (target === '') return null;
  if (/^(https?:|mailto:|tel:|data:|ftp:|\/\/)/i.test(target)) return null;
  if (target.startsWith('#')) return null;
  if (/[<>{}*…]/.test(target)) return null;
  target = target.split('#')[0].split('?')[0].trim();
  if (target === '') return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  // `docs/a%20b.md` 与 `docs/a b.md` 是同一个文件：解码后再判存在性
  try {
    target = decodeURIComponent(target);
  } catch {
    /* 非法百分号编码：保留原样，按字面判 */
  }
  return target;
}

/**
 * 清洗正文里的裸路径 token：去尾随标点、过滤占位符与目录写法。
 * @param {string} raw
 * @returns {string|null}
 */
function trimPathToken(raw) {
  let token = String(raw).trim();
  token = token.replace(/[.,;:!?、。，；：）)】」』"']+$/u, '');
  if (token.endsWith('/')) return null;
  if (/[<>{}*…]/.test(token)) return null;
  if (token === 'docs' || token === '.agents') return null;
  return token;
}

/**
 * G9 零行号：禁止 `file.ext:123` 与「第 N 行」。
 * @param {object} ctx
 */
function gateG9(ctx) {
  const { report } = ctx;
  for (const rel of ctx.files) {
    const doc = getDoc(ctx, rel);
    if (doc.missing) continue;
    const lines = proseLines(doc);
    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i];
      if (!raw) continue;
      // 围栏代码块与 HTML 注释已清空；这里再剥行内代码——规范自己能写「禁 `x.ts:12`」
      const line = stripInlineCode(raw).replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ');
      const fileLine = /\b[\w-]+\.[A-Za-z][\w-]*:\d+/.exec(line);
      if (fileLine) {
        report.add('G9', 'red', rel, i + 1, `出现行号引用：${fileLine[0]}（改成标题 / 符号名，行号必腐）`);
      }
      const chinese = /第\s*\d+\s*行/.exec(line);
      if (chinese) {
        report.add('G9', 'red', rel, i + 1, `出现行号引用：${chinese[0]}（改成标题 / 符号名，行号必腐）`);
      }
    }
  }
}

/**
 * G10 AGENTS 体量：行数 > LIMITS.agents → warn（超了说明有人在塞契约内容）。
 * @param {object} ctx
 */
function gateG10(ctx) {
  const { report } = ctx;
  const doc = getDoc(ctx, 'AGENTS.md');
  if (doc.missing) {
    report.addSkip('G10', 'AGENTS.md 不存在，体量跳过');
    return;
  }
  if (doc.lineCount > ctx.config.limits.agents) {
    report.add('G10', 'warn', 'AGENTS.md', 1, `AGENTS.md ${doc.lineCount} 行 > 上限 ${ctx.config.limits.agents} 行（该把内容拆到契约了）`);
  }
}

/**
 * G11 文档体量：带 `规模上限:` 的文件行数超过它声明的档位 → warn。
 * @param {object} ctx
 */
function gateG11(ctx) {
  const { report } = ctx;
  for (const rel of ctx.files) {
    const doc = getDoc(ctx, rel);
    if (doc.missing) continue;
    const entry = doc.headerNote.get('规模上限');
    if (!entry) continue;
    const digits = entry.value.replace(/[^\d]/g, '');
    const cap = digits === '' ? (doc.type ? LIMITS.headerCap[doc.type] : null) : Number(digits);
    if (!cap) continue;
    if (doc.lineCount > cap) {
      report.add('G11', 'warn', rel, entry.line, `${rel} ${doc.lineCount} 行 > 声明的规模上限 ${cap} 行`);
    }
  }
}

/**
 * G12 工作现场一致性：看板两表的表头 / 取值 / ID 词表 / 唯一性 / wip 双向绑定 / 归档衔接。
 *
 * skip 边界必须窄：只有 `.agents/work/` 整个不存在才跳过；
 * 目录在而 BOARD.md 不在＝板被删或被挪走，是事故，判红。
 * @param {object} ctx
 */
function gateG12(ctx) {
  const { report } = ctx;
  const workAbs = path.join(ctx.root, '.agents', 'work');
  const workStat = statSafe(workAbs);
  if (!workStat || !workStat.isDirectory()) {
    report.addSkip('G12', '`.agents/work/` 不存在（新克隆或未启用看板），工作现场一致性跳过');
    return;
  }

  const boardStat = statSafe(path.join(workAbs, 'BOARD.md'));
  if (!boardStat || !boardStat.isFile()) {
    report.add('G12', 'red', BOARD_REL, 1, '.agents/work/ 存在但 BOARD.md 缺失——板被删或被挪走，是事故不是干净');
    return;
  }

  const board = getDoc(ctx, BOARD_REL);
  if (board.missing) {
    report.add('G12', 'red', BOARD_REL, 1, `BOARD.md 读取失败（${board.reason}）`);
    return;
  }

  const tables = parseTables(board.masked);
  const todoTable = tables.find((t) => t.header.cells.some((cell) => normCell(cell) === '依据'));
  const doneTable = tables.find((t) => t.header.cells.some((cell) => normCell(cell) === 'commit'));

  /** ID → 状态（待办表） */
  const statusById = new Map();
  /** ID → 首次出现的位置描述 */
  const seenIds = new Map();
  /** 已完成表 ID */
  const doneIds = new Set();
  const doneDates = [];

  if (!todoTable) {
    report.add('G12', 'red', BOARD_REL, 1, `缺「待办 / 挂起」表（表头固定为 ${ENUMS.boardTodoHeader.join(' | ')}）`);
  } else {
    if (!todoTable.hasSeparator) {
      report.add(
        'G12',
        'red',
        BOARD_REL,
        todoTable.header.line,
        '待办表缺分隔行：第一行数据会被当成表头吞掉（该行不经任何规则却显示通过）',
      );
    }
    if (!headersEqual(todoTable.header.cells, ENUMS.boardTodoHeader)) {
      report.add(
        'G12',
        'red',
        BOARD_REL,
        todoTable.header.line,
        `待办表表头不符：实为 ${todoTable.header.cells.map(normCell).join(' | ')}，应为 ${ENUMS.boardTodoHeader.join(' | ')}`,
      );
    }

    for (const row of todoTable.rows) {
      const cells = row.cells;
      if (cells.every((cell) => cell.trim() === '')) continue;
      if (cells.length !== ENUMS.boardTodoHeader.length) {
        report.add('G12', 'red', BOARD_REL, row.line, `待办行列数不符：表头 ${ENUMS.boardTodoHeader.length} 列，此行 ${cells.length} 列`);
        continue;
      }
      const [id, priority, , status, nextStep, basis, lastTouched] = cells.map((cell) => cell.trim());

      checkId(ctx, report, seenIds, doneIds, id, row.line, false);
      if (id) statusById.set(id, status);

      if (!ENUMS.priority.includes(priority)) {
        report.add('G12', 'red', BOARD_REL, row.line, `P 取值非法：${priority || '(空)'}（只允许 ${ENUMS.priority.join(' / ')}）`);
      }
      if (!ENUMS.status.includes(status)) {
        report.add('G12', 'red', BOARD_REL, row.line, `状态取值非法：${status || '(空)'}（只允许 ${ENUMS.status.join(' / ')}）`);
      }
      if (nextStep === '') {
        report.add('G12', 'red', BOARD_REL, row.line, '下一步 为空（没它这行就不是可执行任务）');
      } else {
        const banned = ENUMS.nextStepBanned.find((word) => nextStep.includes(word));
        if (banned) report.add('G12', 'red', BOARD_REL, row.line, `下一步 含禁用词「${banned}」`);
      }
      const basisBanned = ENUMS.basisBanned.find((word) => basis.includes(word));
      if (basisBanned) {
        report.add('G12', 'red', BOARD_REL, row.line, `依据 含「${basisBanned}」（坐标必须可 grep）`);
      } else {
        // 依据必须是「能被机械核对的坐标」，逐个坐标核（文件+§x.y / 硬约束 N / 路径 / 短 sha / 用户原话）
        validateBasis(ctx, BOARD_REL, row.line, basis);
      }
      if (!isIsoDate(lastTouched)) {
        report.add('G12', 'red', BOARD_REL, row.line, `最后动 不是 YYYY-MM-DD：${lastTouched || '(空)'}`);
      }
    }

    const todoRows = todoTable.rows.filter((row) => row.cells.some((cell) => cell.trim() !== '')).length;
    if (todoRows > ctx.config.limits.boardTodo) {
      report.add('G12', 'warn', BOARD_REL, todoTable.header.line, `待办表 ${todoRows} 行 > 上限 ${ctx.config.limits.boardTodo} 行（整批降级或搬 backlog）`);
    }
  }

  if (!doneTable) {
    report.add('G12', 'red', BOARD_REL, 1, `缺「已完成」表（表头固定为 ${ENUMS.boardDoneHeader.join(' | ')}）`);
  } else {
    if (!doneTable.hasSeparator) {
      report.add(
        'G12',
        'red',
        BOARD_REL,
        doneTable.header.line,
        '已完成表缺分隔行：第一行数据会被当成表头吞掉',
      );
    }
    if (!headersEqual(doneTable.header.cells, ENUMS.boardDoneHeader)) {
      report.add(
        'G12',
        'red',
        BOARD_REL,
        doneTable.header.line,
        `已完成表表头不符：实为 ${doneTable.header.cells.map(normCell).join(' | ')}，应为 ${ENUMS.boardDoneHeader.join(' | ')}`,
      );
    }
    for (const row of doneTable.rows) {
      const cells = row.cells;
      if (cells.every((cell) => cell.trim() === '')) continue;
      if (cells.length !== ENUMS.boardDoneHeader.length) {
        report.add('G12', 'red', BOARD_REL, row.line, `已完成行列数不符：表头 ${ENUMS.boardDoneHeader.length} 列，此行 ${cells.length} 列`);
        continue;
      }
      const [id, doneAt] = cells.map((cell) => cell.trim());
      validateCommitCell(ctx, BOARD_REL, row.line, cells[3]);
      if (id && id !== '—' && id !== '-' && id !== '–') {
        doneIds.add(id);
        checkId(ctx, report, seenIds, doneIds, id, row.line, true);
      }
      if (!isIsoDate(doneAt)) {
        report.add('G12', 'red', BOARD_REL, row.line, `完成于 不是 YYYY-MM-DD：${doneAt || '(空)'}`);
      } else {
        doneDates.push(doneAt);
      }
    }
    const doneRows = doneTable.rows.filter((row) => row.cells.some((cell) => cell.trim() !== '')).length;
    if (doneRows > ctx.config.limits.boardDoneWindow) {
      report.add('G12', 'warn', BOARD_REL, doneTable.header.line, `已完成表 ${doneRows} 行 > 活跃窗口 ${ctx.config.limits.boardDoneWindow} 行（该归档进 ${path.posix.basename(BOARD_ARCHIVE_REL)}）`);
    }
  }

  if (board.lineCount > ctx.config.limits.boardTotal) {
    report.add('G12', 'warn', BOARD_REL, board.lineCount, `BOARD.md 全文 ${board.lineCount} 行 > 上限 ${ctx.config.limits.boardTotal} 行`);
  }

  // —— wip 双向绑定 ——
  const wipDirAbs = path.join(workAbs, 'wip');
  const wipNames = listWipFiles(wipDirAbs);
  const wipById = new Map();
  for (const name of wipNames) {
    const match = /^([A-Z]+\d+)-.+\.md$/.exec(name);
    if (!match) continue; // 例如 wip/backlog.md：不是 <ID>-<slug>.md，不算绑定条目
    wipById.set(match[1], name);
  }

  for (const [id, status] of statusById.entries()) {
    if (status !== '进行中' && status !== '挂起') continue;
    if (wipById.has(id)) continue;
    report.add('G12', 'red', BOARD_REL, 1, `板上「${status}」但 wip/ 下没有 ${id}-*.md（跨会话回来读不到现场）`);
  }

  for (const [id, name] of wipById.entries()) {
    const wipRel = `${WORK_DIR}/wip/${name}`;
    if (doneIds.has(id) && !statusById.has(id)) {
      report.add('G12', 'red', wipRel, 1, `wip/${name} 对应事项已在「已完成」表，WIP 该蒸馏后删`);
      continue;
    }
    if (!statusById.has(id)) {
      report.add('G12', 'red', wipRel, 1, `wip/${name} 在板上找不到同 ID 的行（孤儿 wip = 垃圾）`);
      continue;
    }
    const wipDoc = getDoc(ctx, wipRel);
    if (wipDoc.missing) continue; // 非文件条目（目录 / 坏软链）：不崩栈，跳过
    const statusEntry = wipDoc.headerNote.get('状态');
    const boardStatus = statusById.get(id);
    if (!statusEntry) {
      report.add('G12', 'red', wipRel, 1, `wip 头缺「> 状态：」（要与板上「${boardStatus}」逐字一致）`);
      continue;
    }
    if (statusEntry.value !== boardStatus) {
      report.add('G12', 'red', wipRel, statusEntry.line, `wip 状态「${statusEntry.value}」与板上「${boardStatus}」不一致`);
    }
  }

  // —— 归档区 ——
  const archiveStat = statSafe(path.join(workAbs, 'BOARD-archive.md'));
  if (!archiveStat || !archiveStat.isFile()) return;

  const archive = getDoc(ctx, BOARD_ARCHIVE_REL);
  if (archive.missing) {
    report.add('G12', 'red', BOARD_ARCHIVE_REL, 1, `BOARD-archive.md 读取失败（${archive.reason}）`);
    return;
  }
  const archiveTables = parseTables(archive.masked);
  const archiveTable = archiveTables.find((t) => t.header.cells.some((cell) => normCell(cell) === 'commit'));
  if (!archiveTable) {
    report.add('G12', 'red', BOARD_ARCHIVE_REL, 1, `归档区缺表（表头固定为 ${ENUMS.boardDoneHeader.join(' | ')}）`);
    return;
  }
  if (!archiveTable.hasSeparator) {
    report.add('G12', 'red', BOARD_ARCHIVE_REL, archiveTable.header.line, '归档区缺分隔行：第一行数据会被当成表头吞掉');
  }
  if (!headersEqual(archiveTable.header.cells, ENUMS.boardDoneHeader)) {
    report.add(
      'G12',
      'red',
      BOARD_ARCHIVE_REL,
      archiveTable.header.line,
      `归档区表头不符：实为 ${archiveTable.header.cells.map(normCell).join(' | ')}，应为 ${ENUMS.boardDoneHeader.join(' | ')}`,
    );
  }

  const archiveDates = [];
  for (const row of archiveTable.rows) {
    const cells = row.cells;
    if (cells.every((cell) => cell.trim() === '')) continue;
    if (cells.length !== ENUMS.boardDoneHeader.length) {
      report.add('G12', 'red', BOARD_ARCHIVE_REL, row.line, `归档行列数不符：表头 ${ENUMS.boardDoneHeader.length} 列，此行 ${cells.length} 列`);
      continue;
    }
    const [id, doneAt] = cells.map((cell) => cell.trim());
    validateCommitCell(ctx, BOARD_ARCHIVE_REL, row.line, cells[3]);
    if (!isIsoDate(doneAt)) {
      report.add('G12', 'red', BOARD_ARCHIVE_REL, row.line, `完成于 不是 YYYY-MM-DD：${doneAt || '(空)'}`);
      continue;
    }
    archiveDates.push({ date: doneAt, line: row.line, id });
  }

  for (let i = 1; i < archiveDates.length; i += 1) {
    if (archiveDates[i].date > archiveDates[i - 1].date) {
      report.add(
        'G12',
        'red',
        BOARD_ARCHIVE_REL,
        archiveDates[i].line,
        `归档区未按时间倒序：${archiveDates[i].date} 排在 ${archiveDates[i - 1].date} 之后`,
      );
    }
  }

  if (archiveDates.length > 0 && doneDates.length > 0) {
    const activeLast = doneDates[doneDates.length - 1];
    if (archiveDates[0].date > activeLast) {
      report.add(
        'G12',
        'red',
        BOARD_ARCHIVE_REL,
        archiveDates[0].line,
        `归档区首行 ${archiveDates[0].date} 新于活跃区末行 ${activeLast}（抽的不是尾部，历史顺序会错）`,
      );
    }
  }
}

/**
 * ID 校验：形态 `<前缀><数字>`、前缀在 idPrefixes、跨两表不重复。
 * @param {object} ctx
 * @param {object} report
 * @param {Map<string, string>} seenIds
 * @param {Set<string>} doneIds
 * @param {string} id
 * @param {number} line
 * @param {boolean} inDoneTable
 */
function checkId(ctx, report, seenIds, doneIds, id, line, inDoneTable) {
  const rel = BOARD_REL;
  if (!id) {
    report.add('G12', 'red', rel, line, 'ID 为空');
    return;
  }
  const match = /^([A-Z]+)(\d+)$/.exec(id);
  if (!match) {
    report.add('G12', 'red', rel, line, `ID 形态不合法：${id}（应为 <前缀><数字>，如 U12）`);
    return;
  }
  if (!ctx.config.idPrefixes.includes(match[1])) {
    report.add('G12', 'red', rel, line, `ID 前缀不在 idPrefixes：${id}（允许 ${ctx.config.idPrefixes.join('/')}）`);
  }
  if (seenIds.has(id)) {
    report.add('G12', 'red', rel, line, `ID 重复：${id} 已在 ${seenIds.get(id)} 出现过（只增不复用）`);
    return;
  }
  seenIds.set(id, inDoneTable ? '「已完成」表' : '「待办」表');
  if (!inDoneTable && doneIds.has(id)) {
    report.add('G12', 'red', rel, line, `ID 重复：${id} 同时出现在待办表与已完成表`);
  }
}

/**
 * 校验看板「依据」单元格里的坐标（gates.md「工作现场门禁」的判据）：
 *
 * - `docs/x.md §3.2`：文件存在，且**该文件**真有 3.2 这个标题编号；
 * - 裸 `§3.2`：仓库里任何一个在册文档有该编号即可；
 * - `AGENTS.md 硬约束 N`：命中 `^N. **`；
 * - `.agents/…` 与其余 `.md` 路径：必须存在；
 * - 7–40 位 sha：`git cat-file -e`（非 git 环境降级 warn）；
 * - `用户原话(YYYY-MM-DD)`：日期必须合法。
 *
 * 一个坐标都识别不出来 → warn：散文式依据不可机械校验，正是看板腐化的入口。
 * @param {object} ctx
 * @param {string} rel 看板相对路径
 * @param {number} line 行号
 * @param {string} cell 依据 单元格原文
 */
function validateBasis(ctx, rel, line, cell) {
  const { report } = ctx;
  // 整格先脱掉反引号（文档推荐的写法是 `docs/x.md §3.2`）：反引号不进路径，但内容要照判
  const text = unwrapInlineCode(String(cell));
  const claimed = new Set(); // 已报过的路径：同一坐标只报一次
  let recognized = 0;
  let rest = text;

  // 1) `文件.md §x.y` 组合坐标
  const pairRe = /([^\s、，,；;·|（(]+?\.md)\s*§\s*(\d+(?:\.\d+)*)/g;
  let match;
  while ((match = pairRe.exec(text)) !== null) {
    recognized += 1;
    const file = normalizeRelPath(match[1]).replace(/^[<>]+|[<>]+$/g, '');
    const number = match[2];
    rest = rest.replace(match[0], ' '.repeat(match[0].length));
    if (!statSafe(path.join(ctx.root, file))) {
      if (!claimed.has(file)) {
        claimed.add(file);
        report.add('G12', 'red', rel, line, `依据 里的文件不存在：${file}`);
      }
      continue;
    }
    let numbers = buildHeadingIndex(ctx).byFile.get(file);
    if (!numbers) numbers = headingNumbers(getDoc(ctx, file));
    if (!numbers || !numbers.has(number)) {
      report.add('G12', 'red', rel, line, `依据 的坐标 ${file} §${number} 在该文件里找不到标题编号`);
    }
  }

  // 2) 裸 §x.y（没点名文件）：仓库级兜底
  const bareRe = /§\s*(\d+(?:\.\d+)*)/g;
  while ((match = bareRe.exec(rest)) !== null) {
    recognized += 1;
    if (!buildHeadingIndex(ctx).global.has(match[1])) {
      report.add('G12', 'red', rel, line, `依据 的坐标 §${match[1]} 在仓库里找不到标题编号`);
    }
  }

  // 3) AGENTS.md 硬约束 N
  const hardRe = /AGENTS\.md\s*硬约束\s*(\d+)/g;
  while ((match = hardRe.exec(text)) !== null) {
    recognized += 1;
    claimed.add('AGENTS.md');
    const number = match[1];
    const agentsDoc = getDoc(ctx, 'AGENTS.md');
    if (agentsDoc.missing) {
      report.add('G12', 'red', rel, line, `依据 引用 AGENTS.md 硬约束 ${number}，但 AGENTS.md 不存在`);
    } else if (!hasHardConstraint(agentsDoc, number)) {
      report.add('G12', 'red', rel, line, `依据 的 AGENTS.md 硬约束 ${number} 命中不到（AGENTS.md 无「${number}. **」条目）`);
    }
  }

  // 4) `.agents/…` 路径
  const agentsPathRe = /(?:^|[\s（(`"'、，,；;·])(\.agents\/[^\s、，,；;）)`"']*)/g;
  while ((match = agentsPathRe.exec(text)) !== null) {
    const token = trimPathToken(match[1]);
    if (!token) continue;
    recognized += 1;
    if (!statSafe(path.join(ctx.root, token))) {
      report.add('G12', 'red', rel, line, `依据 里的路径不存在：${token}`);
    }
  }

  // 5) 其余 `.md` 路径（按仓库根解析）
  const mdPathRe = /(?:^|[\s（(`"'、，,；;·|])([\w.\-/]+\.md)(?![.\w])/g;
  while ((match = mdPathRe.exec(text)) !== null) {
    const token = normalizeRelPath(match[1]);
    if (claimed.has(token)) continue;
    claimed.add(token);
    recognized += 1;
    if (!statSafe(path.join(ctx.root, token))) {
      report.add('G12', 'red', rel, line, `依据 里的文件不存在：${token}`);
    }
  }

  // 6) 短 sha（纯数字更像日期，不当 sha）
  const shaRe = /(?<![\w.])([0-9a-f]{7,40})(?![\w.])/g;
  while ((match = shaRe.exec(text)) !== null) {
    if (!/[a-f]/.test(match[1])) continue;
    recognized += 1;
    checkGitObject(ctx, rel, line, match[1], '依据里的 sha');
  }

  // 7) 用户原话(日期)
  const quoteRe = /用户原话\s*[（(]\s*([^)）]*?)\s*[)）]/g;
  while ((match = quoteRe.exec(text)) !== null) {
    recognized += 1;
    if (!isIsoDate(match[1])) {
      report.add('G12', 'red', rel, line, `依据 的「用户原话」日期不是 YYYY-MM-DD：${match[1] || '(空)'}`);
    }
  }

  if (recognized === 0) {
    report.add(
      'G12',
      'warn',
      rel,
      line,
      '依据 里没有可校验的坐标（文件+§x.y / AGENTS.md 硬约束 N / .agents 路径 / 短 sha / 用户原话(日期)）',
    );
  }
}

/**
 * 校验已完成表 / 归档区的 `commit` 列：短 sha / tag / ref 都要在 git 里能解析；
 * 无代码变更写 `—`。依据里的 sha 查、commit 列也查，否则 `deadbeef` 是绿的而依据却查，前后不对称。
 * @param {object} ctx
 * @param {string} rel
 * @param {number} line
 * @param {string} cell
 */
function validateCommitCell(ctx, rel, line, cell) {
  // 出厂模板把 sha 写成 `1d93c1b`、无变更写 `—`：反引号在这一层就得脱掉，
  // 否则 `cat-file -e` 拿到的是带反引号的串，永远判红。
  const text = unwrapInlineCode(String(cell === undefined ? '' : cell)).trim();
  if (text === '') {
    ctx.report.add('G12', 'red', rel, line, 'commit 为空（无代码变更写 —）');
    return;
  }
  for (const token of text.split(/[·、,，\s]+/).filter(Boolean)) {
    if (/^[—–-]$/.test(token)) continue;
    checkGitObject(ctx, rel, line, token, 'commit');
  }
}

/**
 * 校验 sha / tag / ref 在 git 里存在（`git cat-file -e`）。
 * 非 git 环境（拿不到 git）降级为 warn——不能因为环境缺 git 就把看板判红。
 * @param {object} ctx
 * @param {string} rel
 * @param {number} line
 * @param {string} name
 * @param {string} label 报错时的名词
 */
function checkGitObject(ctx, rel, line, name, label) {
  const { report } = ctx;
  if (!ctx.gitAvailable) {
    report.add('G12', 'warn', rel, line, `非 git 环境，无法校验 ${label} ${name}`);
    return;
  }
  if (!ctx.gitObjectCache) ctx.gitObjectCache = new Map();
  const cache = ctx.gitObjectCache;
  if (!cache.has(name)) cache.set(name, runGit(ctx.root, ['cat-file', '-e', name]).ok);
  if (!cache.get(name)) {
    report.add('G12', 'red', rel, line, `${label} ${name} 在 git 里找不到（cat-file -e 失败）`);
  }
}

/**
 * 列出 wip/ 下的**文件**。
 *
 * `readdir` 会同时给出目录；`U1-x.md/` 这种「以 .md 结尾的目录」若只按后缀筛，
 * 后续 readFileSync 会抛 EISDIR、整条门禁只剩栈。这里只放行真文件（含指向文件的软链）。
 * @param {string} absDir
 * @returns {string[]}
 */
function listWipFiles(absDir) {
  const dirStat = statSafe(absDir);
  if (!dirStat || !dirStat.isDirectory()) return [];
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const names = [];
  for (const entry of entries) {
    const abs = path.join(absDir, entry.name);
    let isFile = entry.isFile();
    if (!isFile && entry.isSymbolicLink()) {
      const st = statSafe(abs);
      isFile = Boolean(st && st.isFile());
    }
    if (isFile) names.push(entry.name);
  }
  return names.sort();
}

/**
 * G13 README：行数 > limits.readme → warn；简短描述与 descriptionSource 不一致 → warn。
 * 取不到简短描述（徽章、列表、代码块开头）就跳过该子检查，不误报。
 * @param {object} ctx
 */
function gateG13(ctx) {
  const { report } = ctx;
  const rel = 'README.md';
  const doc = getDoc(ctx, rel);
  if (doc.missing) {
    report.addSkip('G13', `${rel} 不存在，README 体量与描述跳过`);
    return;
  }
  if (doc.lineCount > ctx.config.limits.readme) {
    report.add('G13', 'warn', rel, ctx.config.limits.readme + 1, `README ${doc.lineCount} 行 > 上限 ${ctx.config.limits.readme} 行`);
  }

  const paragraph = firstParagraphAfterTitle(doc);
  if (!paragraph) {
    report.addSkip('G13', 'README 取不到「# 标题」后的第一个普通段落，描述一致性跳过');
    return;
  }
  const description = readDescription(ctx, ctx.config.descriptionSource);
  if (!description) {
    report.addSkip('G13', `${ctx.config.descriptionSource} 不存在或没有 description，描述一致性跳过`);
    return;
  }
  const firstSentence = firstSentenceOf(paragraph.text);
  const got = normalizeProse(firstSentence);
  const want = normalizeProse(description);
  if (got === want || got.startsWith(want)) return;
  report.add(
    'G13',
    'warn',
    rel,
    paragraph.line,
    `README 简短描述与 ${ctx.config.descriptionSource} 的 description 不一致：「${clip(firstSentence)}」≠「${clip(description)}」`,
  );
}

/**
 * 一份文档的「正文行」：围栏代码块与 HTML 注释都清空，行号 1:1 保留。
 *
 * 注释是写给维护者的说明（模板把「怎么填」写在 `<!-- -->` 里），
 * 把它当正文扫会得到「模板引用了不存在的文件」这类假红。
 * @param {object} doc
 * @returns {string[]}
 */
function proseLines(doc) {
  if (!doc.proseCache) doc.proseCache = blankHtmlComments(doc.masked);
  return doc.proseCache;
}

/**
 * 把 HTML 注释块（`<!-- … -->`）清空，行号 1:1 保留。
 * 模板把「怎么填」写在注释里，注释不是正文，G13 不能把 `<!--` 当简短描述。
 * @param {string[]} lines
 * @returns {string[]}
 */
function blankHtmlComments(lines) {
  const out = [];
  let inComment = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inComment && trimmed.startsWith('<!--')) {
      inComment = !trimmed.includes('-->');
      out.push('');
      continue;
    }
    if (inComment) {
      if (trimmed.includes('-->')) inComment = false;
      out.push('');
      continue;
    }
    out.push(line);
  }
  return out;
}

/**
 * 取 `# 标题` 后第一个非空普通段落。
 * @param {object} doc
 * @returns {{text: string, line: number}|null}
 */
function firstParagraphAfterTitle(doc) {
  const lines = proseLines(doc);
  let index = 0;
  while (index < lines.length && !/^#\s+\S/.test(lines[index])) index += 1;
  if (index >= lines.length) return null;
  index += 1;
  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed === '') {
      index += 1;
      continue;
    }
    const isSpecial = /^#{1,6}\s/.test(trimmed)
      || trimmed.startsWith('>')
      || trimmed.startsWith('|')
      || trimmed.startsWith('- ')
      || trimmed.startsWith('* ')
      || trimmed.startsWith('+ ')
      || trimmed.startsWith('```')
      || trimmed.startsWith('~~~')
      || /^\d+[.)]\s/.test(trimmed)
      || trimmed.startsWith('![')
      || /^\[[^\]]*\]:/.test(trimmed);
    if (isSpecial) return null;
    const parts = [];
    let line = index + 1;
    while (index < lines.length) {
      const current = lines[index].trim();
      if (current === '' || /^#{1,6}\s/.test(current)) break;
      parts.push(current);
      index += 1;
    }
    const text = parts.join(' ').trim();
    if (text === '') return null;
    return { text, line };
  }
  return null;
}

/** 取第一句（中英文句末标点都算）。 */
function firstSentenceOf(text) {
  const match = /^(.+?[。！？!?])/.exec(text);
  return match ? match[1] : text;
}

/** 描述归一化：去掉行内标记与句末标点、折叠空白。 */
function normalizeProse(text) {
  return String(text)
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[。.!！?？；;：:，,、]+$/u, '');
}

/** 截断长文本用于报错信息。 */
function clip(text, max = 40) {
  const value = String(text).trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * 读 descriptionSource 里的 `description` 字段（默认 package.json）。
 * @param {string} sourceRel
 * @returns {string|null}
 */
function readDescription(ctx, sourceRel) {
  const abs = path.join(ctx.root, sourceRel);
  const stat = statSafe(abs);
  if (!stat || !stat.isFile()) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (parsed && typeof parsed.description === 'string' && parsed.description.trim() !== '') {
      return parsed.description.trim();
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * G14 计数与承诺词：手写的会变计数 → warn；无主体的将来时（后续版本/以后会/即将）未带看板 ID → red。
 * @param {object} ctx
 */
function gateG14(ctx) {
  const { report } = ctx;
  // 只认真正的计数：共 N 例 / 共 N 行 / N 条<名词> / N 个文件。
  // 「第 1、4、5 条」这类编号引用由 maskNumberingRefs 先抹掉——否则规则文件写不出交叉引用。
  const countRules = [
    /共\s*\d+\s*[例行条项]/,
    /\d+\s*条(?=\s*[\u4e00-\u9fa5])/,
    /\d+\s*个(?:文件|用例|条目|模块|脚本|接口)/,
  ];
  const promiseRe = /后续版本|以后会|即将/;
  const boardIdRe = /[A-Z]+\d+/;

  for (const rel of ctx.files) {
    const doc = getDoc(ctx, rel);
    if (doc.missing) continue;
    const lines = proseLines(doc);
    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i];
      if (!raw) continue;
      // 同上：围栏与注释已清空，行内代码里引用被禁模式不算正文；编号引用不算计数
      const line = maskNumberingRefs(stripInlineCode(raw));
      if (line.trim() === '') continue;
      for (const rule of countRules) {
        const match = rule.exec(line);
        if (!match) continue;
        report.add('G14', 'warn', rel, i + 1, `手写会变计数：${match[0].trim()}（交给脚本或门禁回读）`);
        break;
      }
      const promise = promiseRe.exec(line);
      if (promise && !boardIdRe.test(line)) {
        report.add('G14', 'red', rel, i + 1, `无主体的将来时「${promise[0]}」未带看板 ID（补 ID 或删）`);
      }
    }
  }
}

/** 闸号 → 实现。新增闸只需在这里加一行（并同步 LIMITS / GATES）。 */
const GATE_IMPLS = Object.freeze({
  G1: gateG1,
  G2: gateG2,
  G3: gateG3,
  G4: gateG4,
  G5: gateG5,
  G6: gateG6,
  G7: gateG7,
  G8: gateG8,
  G9: gateG9,
  G10: gateG10,
  G11: gateG11,
  G12: gateG12,
  G13: gateG13,
  G14: gateG14,
});

/**
 * 跑全部门禁。
 * @param {{root: string}} opts
 * @returns {object} report
 */
function runChecks(opts) {
  const root = path.resolve(opts.root);
  const rootStat = statSafe(root);
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`--root 不是目录：${root}`);
  }
  const ctx = buildContext(root);
  if (ctx.scopeNote) ctx.report.addSkip('G0', ctx.scopeNote);

  for (const gate of Object.keys(GATES)) {
    try {
      GATE_IMPLS[gate](ctx);
    } catch (err) {
      ctx.report.add(gate, 'red', '.', 0, `门禁执行异常：${err && err.message ? err.message : err}`);
    }
  }
  return ctx.report;
}

/* ============================================================================
 * 四、报告
 * ==========================================================================*/

/** 新建报告收集器。 */
function createReport() {
  const report = { red: [], warn: [], skip: [] };
  /**
   * 记一条问题。
   * @param {string} gate G1–G14
   * @param {'red'|'warn'} severity
   * @param {string} file 相对路径
   * @param {number} line 1 基行号；无法定位用 0
   * @param {string} message 一句话原因
   */
  report.add = (gate, severity, file, line, message) => {
    const entry = {
      file, line: Number.isFinite(line) ? line : 0, gate, message: String(message),
    };
    if (severity === 'red') report.red.push(entry);
    else report.warn.push(entry);
  };
  /**
   * 记一条 skip（闸无法判定，不是通过也不是失败）。
   * @param {string} gate
   * @param {string} reason
   */
  report.addSkip = (gate, reason) => {
    report.skip.push({ file: '', line: 0, gate, message: String(reason) });
  };
  return report;
}

/** 按 闸号 → 文件 → 行号 排序，输出稳定可 diff。 */
function sortIssues(issues) {
  return [...issues].sort((a, b) => {
    const ga = Number(a.gate.replace(/\D/g, ''));
    const gb = Number(b.gate.replace(/\D/g, ''));
    if (ga !== gb) return ga - gb;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.line - b.line;
  });
}

/**
 * 文本报告：每个问题一行 `<相对路径>:<行号> G<n> <red|warn> <原因>`，
 * skip 行用 `- G<n> skip <原因>`，末尾一行汇总。
 * @param {object} report
 * @returns {string}
 */
function formatText(report) {
  const lines = [];
  for (const issue of sortIssues(report.red)) {
    lines.push(`${issue.file}:${issue.line} ${issue.gate} red ${issue.message}`);
  }
  for (const issue of sortIssues(report.warn)) {
    lines.push(`${issue.file}:${issue.line} ${issue.gate} warn ${issue.message}`);
  }
  for (const issue of sortIssues(report.skip)) {
    lines.push(`- ${issue.gate} skip ${issue.message}`);
  }
  lines.push(`docs-standards: ${report.red.length} red, ${report.warn.length} warn, ${report.skip.length} skip`);
  return lines.join('\n');
}

/**
 * JSON 报告：严格 `{red,warn,skip}`，元素 `{file,line,gate,message}`。
 * @param {object} report
 * @returns {string}
 */
function formatJson(report) {
  const pick = (issue) => ({
    file: issue.file, line: issue.line, gate: issue.gate, message: issue.message,
  });
  return JSON.stringify(
    {
      red: sortIssues(report.red).map(pick),
      warn: sortIssues(report.warn).map(pick),
      skip: sortIssues(report.skip).map(pick),
    },
    null,
    2,
  );
}

/**
 * CLI 入口。
 * @param {string[]} argv
 * @returns {number} 退出码
 */
function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`check-docs: ${err.message}\n`);
    return 2;
  }
  if (opts.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (opts.selftest) {
    return runSelftest();
  }

  let report;
  try {
    report = runChecks(opts);
  } catch (err) {
    process.stderr.write(`check-docs: ${err.message}\n`);
    return 2;
  }
  process.stdout.write(`${opts.json ? formatJson(report) : formatText(report)}\n`);
  return report.red.length > 0 ? 1 : 0;
}

/* ============================================================================
 * 五、自测（--selftest）
 * ==========================================================================*/

/** 干净仓库夹具：必须全绿（0 red / 0 warn）。 */
function cleanFixtureFiles() {
  return {
    [CONFIG_NAME]: `${JSON.stringify({
      whitelist: ['README.md', 'AGENTS.md', 'CHANGELOG.md', 'spec.md', 'docs/**'],
      idPrefixes: ['U', 'M', 'V', 'D'],
      limits: {
        agents: 100, readme: 120, boardTodo: 12, boardTotal: 70, boardDoneWindow: 12,
      },
      descriptionSource: 'package.json',
    }, null, 2)}\n`,
    'package.json': `${JSON.stringify({ name: 'demo', description: '一个用于自测的最小示例项目。' }, null, 2)}\n`,
    'README.md': [
      '# demo',
      '',
      '一个用于自测的最小示例项目。',
      '',
      '## 用法',
      '',
      '跑 `node scripts/check-docs.mjs` 即可。',
      '',
    ].join('\n'),
    'AGENTS.md': [
      '# AGENTS',
      '',
      '开工先读 `spec.md`，再动手。',
      '',
      '## 硬约束',
      '',
      '1. **只看契约**：写代码前先读 `spec.md`。',
      '',
    ].join('\n'),
    'CHANGELOG.md': [
      '# CHANGELOG',
      '',
      '## [Unreleased]',
      '',
      '### Added',
      '',
      '- 初版门禁脚本。',
      '',
      '## [1.0.0] - 2026-01-02',
      '',
      '### Added',
      '',
      '- 首个版本。',
      '',
    ].join('\n'),
    'spec.md': [
      '# 演示契约',
      '',
      '> 类型：契约',
      '> 读者：开工前要改这个模块的人',
      '> 真源：`demo.js` 里的 `demo()`',
      '> 更新触发：改了导出函数签名',
      '> 规模上限：300',
      '',
      '## 范围',
      '',
      '只覆盖演示模块，编号见 §1.2。',
      '',
      '## 1 结构',
      '',
      '### 1.2 导出',
      '',
      '`demo()` 返回 1。',
      '',
      '## 条款',
      '',
      '`demo()` 恒返回 1（锚点：`demo()`）。',
      '',
      '## 验收',
      '',
      '- `node -e "console.log(require(\'./demo.js\')())"` 输出 1。',
      '',
    ].join('\n'),
  };
}

/** 一份结构完整的看板（两表齐全、分隔行齐全）。 */
function boardFixture({
  todoRows = ['| U1 | P1 | 改门禁 | 待开始 | 打开 `scripts/check-docs.mjs` 改 G12 | spec.md §1.2 | 2026-01-02 |'],
  doneRows = ['| U2 | 2026-01-01 | 建仓库 | — |'],
} = {}) {
  return [
    '# 看板',
    '',
    '## 待办 / 挂起',
    '',
    '| ID | P | 事项 | 状态 | 下一步 | 依据 | 最后动 |',
    '|---|---|---|---|---|---|---|',
    ...todoRows,
    '',
    '## 已完成',
    '',
    '| ID | 完成于 | 一件事 | commit |',
    '|---|---|---|---|',
    ...doneRows,
    '',
  ].join('\n');
}

/** 一份带「文档地图」小节的 AGENTS.md（G8 的地图路径判据用它）。 */
function agentsMapFixture(mapRows, { sectionTitle = '文档地图' } = {}) {
  return [
    '# AGENTS',
    '',
    '开工先读 `spec.md`，再动手。',
    '',
    '## 硬约束',
    '',
    '1. **只看契约**：写代码前先读 `spec.md`。',
    '',
    `## ${sectionTitle}`,
    '',
    '| 类型 | 放哪 |',
    '|---|---|',
    ...mapRows,
    '',
  ].join('\n');
}

/** 在夹具仓库里做一次提交，返回短 sha（git 不可用返回空串）。 */
function commitFixture(root) {
  const add = runGit(root, ['add', '-A']);
  if (!add.ok) return '';
  const commit = runGit(root, [
    '-c', 'user.email=selftest@example.com',
    '-c', 'user.name=selftest',
    'commit', '-q', '--allow-empty', '-m', 'fixture',
  ]);
  if (!commit.ok) return '';
  return runGit(root, ['rev-parse', '--short', 'HEAD']).stdout.trim();
}

/** 出厂模板目录（脚本同级 ../assets）；没有就返回 null。 */
function assetsDir() {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
  return fs.existsSync(dir) ? dir : null;
}

/**
 * 用出厂模板搭一个「照模板填完」的最小仓库文件表。
 *
 * 只做模板自己要求的那几件填事（版本日期、采集日期、依据坐标、wip 状态取单值、
 * README 第一段写成 description），不改结构——这样「填完即绿」才是对模板的断言。
 * @param {string} dir assets 目录
 * @returns {object|null} 文件表；模板缺件返回 null
 */
function goldenFilledFiles(dir) {
  const read = (name) => {
    const abs = path.join(dir, name);
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  };
  const agents = read('AGENTS.template.md');
  const readme = read('README.template.md');
  const changelog = read('CHANGELOG.template.md');
  const spec = read('spec.template.md');
  const reference = read('reference.template.md');
  const board = read('BOARD.template.md');
  const wip = read('WIP.template.md');
  if (!agents || !readme || !changelog || !spec || !board) return null;

  const description = '把 demo 模块接进现有服务的最小示例。';
  const files = {
    'AGENTS.md': agents,
    'README.md': readme
      .replace('# <包名> _(<仓库名>)_', '# demo _(demo)_')
      .replace('<一句话简短描述：与 package.json 的 description 逐字相同，不超过 120 个字符>', description),
    'CHANGELOG.md': changelog.replace(/YYYY-MM-DD/g, '2026-01-02'),
    'spec.md': spec,
    // 依据用**复合坐标**：一格里同时覆盖「文件+§编号」与「AGENTS.md 硬约束 N」两条规则，
    // 否则那条判据在金样本里永远是空转的
    '.agents/work/BOARD.md': board.replace(
      '`<docs/x.md §2.1>`',
      '`reference.md §1` + `AGENTS.md 硬约束 1`',
    ),
    '.agents/work/wip/U1-demo.md': (wip || '').replace('最后动：YYYY-MM-DD', '最后动：2026-01-02'),
    'package.json': `${JSON.stringify({ name: 'demo', description })}\n`,
  };

  if (reference) {
    const filled = reference
      .replace('采集日期：YYYY-MM-DD', '采集日期：2026-11-01')
      .replace('## <结构 / 接口 / 字段>', '## 1 端点');
    files['reference.md'] = filled;
    // 地图里若还留着「参考类 ≥2 份放 docs/reference/」的那行，就补一份到目录里
    if (agents.includes('docs/reference/')) files['docs/reference/api.md'] = filled;
  }

  const whitelist = [
    ...Object.keys(files).filter((rel) => rel.endsWith('.md') && !rel.startsWith('.agents/')),
    'docs/**',
  ];
  files[CONFIG_NAME] = `${JSON.stringify({
    whitelist,
    idPrefixes: ['U', 'M', 'V', 'D'],
    descriptionSource: 'package.json',
  }, null, 2)}\n`;
  return files;
}

/** 在临时目录建夹具仓库并尽量纳入 git index。 */
function makeFixture(files, { git = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-standards-'));
  writeFiles(root, files);
  if (git) {
    const init = runGit(root, ['init', '-q']);
    if (init.ok) runGit(root, ['add', '-A']);
  }
  return root;
}

/** 批量写文件（自动建父目录）。 */
function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
}

/** 删临时仓库。 */
function removeFixture(root) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* 清理失败不影响测试结论 */
  }
}

/** 用例「没跑」的信号：与失败区分开，输出 SKIP 并单独计数。 */
class SelftestSkip extends Error {}

/** 抛出一个跳过（例如 assets 不在脚本旁，金样本没法搭）。 */
function skipCase(reason) {
  throw new SelftestSkip(reason);
}

/** 断言助手。 */
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** 在报告里找符合条件的条目。 */
function findIssue(report, gate, pattern) {
  const all = [...report.red, ...report.warn];
  return all.find((issue) => issue.gate === gate && (pattern ? pattern.test(issue.message) : true));
}

/** 只找 red。 */
function findRed(report, gate, pattern) {
  return report.red.find((issue) => issue.gate === gate && (pattern ? pattern.test(issue.message) : true));
}

/** 只找 warn。 */
function findWarn(report, gate, pattern) {
  return report.warn.find((issue) => issue.gate === gate && (pattern ? pattern.test(issue.message) : true));
}

/** 自测用例表：name + 跑法。 */
function selftestCases() {
  return [
    {
      name: '干净仓库 → 全绿 exit 0',
      run() {
        const root = makeFixture(cleanFixtureFiles());
        try {
          const report = runChecks({ root });
          assert(report.red.length === 0, `期待 0 red，实有：${report.red.map((i) => `${i.gate} ${i.message}`).join('; ')}`);
          assert(report.warn.length === 0, `期待 0 warn，实有：${report.warn.map((i) => `${i.gate} ${i.message}`).join('; ')}`);
          assert(!report.skip.some((i) => i.gate === 'G1'), 'G1 不应 skip（whitelist 已配置且文件齐全）');
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: 'exclude 里的目录不参与扫描 → 产品内容不进文档规范',
      run() {
        const files = cleanFixtureFiles();
        files['bundle/SKILL.md'] = '# 技能入口\n\n这是产品内容，不该被文档规范判红。\n';
        files[CONFIG_NAME] = `${JSON.stringify({
          whitelist: ['README.md', 'AGENTS.md', 'CHANGELOG.md', 'spec.md', 'docs/**'],
          exclude: ['bundle/**'],
          idPrefixes: ['U', 'M', 'V', 'D'],
          descriptionSource: 'package.json',
        }, null, 2)}\n`;
        const root = makeFixture(files);
        try {
          const report = runChecks({ root });
          assert(
            !report.red.some((i) => i.gate === 'G2' && i.file === 'bundle/SKILL.md'),
            'exclude 目录仍被 G2 扫描（G2 的红不带路径，按 file 字段判）',
          );
          assert(report.red.length === 0, `expect 0 red, got: ${report.red.map((i) => `${i.gate} ${i.message}`).join('; ')}`);
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: '未配 exclude 时同一份内容 → G2 red（证明 exclude 不是恒真）',
      run() {
        const files = cleanFixtureFiles();
        files['bundle/SKILL.md'] = '# 技能入口\n\n这是产品内容，不该被文档规范判红。\n';
        const root = makeFixture(files);
        try {
          const report = runChecks({ root });
          assert(
            report.red.some((i) => i.gate === 'G2' && i.file === 'bundle/SKILL.md'),
            '未配 exclude 时应当报「无头注」',
          );
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: '白名单外的 md → G1 red',
      run() {
        const files = cleanFixtureFiles();
        files['notes.md'] = '# 随手记\n\n不该出现在仓库里的草稿。\n';
        const root = makeFixture(files);
        try {
          const report = runChecks({ root });
          const hit = findIssue(report, 'G1', /notes\.md/);
          assert(hit, `G1 没报 notes.md：${report.red.map((i) => i.message).join('; ')}`);
          assert(hit.file === 'notes.md', `G1 报错文件应为 notes.md，实为 ${hit.file}`);
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: '白名单文件改名 → G1 red 且报「缺失或改名」',
      run() {
        const root = makeFixture(cleanFixtureFiles());
        try {
          fs.renameSync(path.join(root, 'spec.md'), path.join(root, 'spec-old.md'));
          if (runGit(root, ['rev-parse', '--is-inside-work-tree']).ok) {
            runGit(root, ['add', '-A']);
          }
          const report = runChecks({ root });
          const hit = findIssue(report, 'G1', /缺失或改名/);
          assert(hit, `G1 没报「缺失或改名」：${report.red.map((i) => i.message).join('; ')}`);
          assert(/spec\.md/.test(hit.message), `报错应点名 spec.md，实为：${hit.message}`);
          assert(findIssue(report, 'G1', /spec-old\.md/), '改名后的 spec-old.md 也应判「不在白名单」');
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: '规模上限写 999 → G3 red',
      run() {
        const files = cleanFixtureFiles();
        files['spec.md'] = files['spec.md'].replace('> 规模上限：300', '> 规模上限：999');
        const root = makeFixture(files);
        try {
          const report = runChecks({ root });
          const hit = findIssue(report, 'G3', /规模上限/);
          assert(hit, `G3 没报：${report.red.map((i) => i.message).join('; ')}`);
          assert(hit.line === 7, `G3 行号应为 7（规模上限所在行，五键头注的第 5 行），实为 ${hit.line}`);
          assert(!findIssue(report, 'G2', /规模上限/), 'G3 命中时 G2 不该再报缺键');
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: '看板缺分隔行 → G12 red（首行未被吞）',
      run() {
        const board = [
          '# 看板',
          '',
          '## 待办 / 挂起',
          '',
          '| ID | P | 事项 | 状态 | 下一步 | 依据 | 最后动 |',
          '| U1 | P9 | 改门禁 | 待开始 | 打开 `scripts/check-docs.mjs` 改 G12 | spec.md §1.2 | 2026-01-02 |',
          '',
          '## 已完成',
          '',
          '| ID | 完成于 | 一件事 | commit |',
          '|---|---|---|---|',
          '| U2 | 2026-01-01 | 建仓库 | — |',
          '',
        ].join('\n');
        const root = makeFixture({ ...cleanFixtureFiles(), [`${WORK_DIR}/BOARD.md`]: board });
        try {
          const report = runChecks({ root });
          const sep = findIssue(report, 'G12', /缺分隔行/);
          assert(sep, `G12 没报缺分隔行：${report.red.map((i) => i.message).join('; ')}`);
          const firstRow = findIssue(report, 'G12', /P 取值非法：P9/);
          assert(firstRow, 'G12 没校验缺分隔行后的第一行数据（说明首行被当分隔行吞了）');
          assert(firstRow.line === 6, `首行数据应在第 6 行，实为 ${firstRow.line}`);
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: '单元格含 \\| → 不误判切格',
      run() {
        const parsed = splitCells('| U1 | P1 | 切格 A \\| B |');
        assert(parsed.length === 3, `切格数应为 3，实为 ${parsed.length}：${JSON.stringify(parsed)}`);
        assert(parsed[2] === '切格 A | B', `转义未还原：${JSON.stringify(parsed[2])}`);

        const board = boardFixture({
          todoRows: ['| U1 | P1 | 切格 A \\| B | 待开始 | 打开 `scripts/check-docs.mjs` 改 G12 | spec.md §1.2 | 2026-01-03 |'],
        });
        const root = makeFixture({ ...cleanFixtureFiles(), [`${WORK_DIR}/BOARD.md`]: board });
        try {
          const report = runChecks({ root });
          const g12 = [...report.red, ...report.warn].filter((i) => i.gate === 'G12');
          assert(g12.length === 0, `含转义竖线的看板不该有任何 G12 问题：${g12.map((i) => i.message).join('; ')}`);
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: 'wip/U1-x.md 是目录 → 不崩栈',
      run() {
        const board = boardFixture({
          todoRows: ['| U1 | P1 | 进行中的事 | 进行中 | 打开 `scripts/check-docs.mjs` 改接口 | spec.md §1.2 | 2026-01-04 |'],
        });
        const root = makeFixture({ ...cleanFixtureFiles(), [`${WORK_DIR}/BOARD.md`]: board });
        try {
          fs.mkdirSync(path.join(root, WORK_DIR, 'wip', 'U1-x.md'), { recursive: true });
          fs.writeFileSync(path.join(root, WORK_DIR, 'wip', 'U1-x.md', 'inner.txt'), 'x\n', 'utf8');
          let report;
          assert((() => {
            report = runChecks({ root });
            return true;
          })(), '未预期');
          const all = [...report.red, ...report.warn, ...report.skip];
          assert(!all.some((i) => /EISDIR|ENOTDIR|不是目录/.test(i.message)), `出现非文件条目错误：${all.map((i) => i.message).join('; ')}`);
          const missingWip = findIssue(report, 'G12', /没有 U1-\*\.md/);
          assert(missingWip, `目录不该算 wip 文件，应报「没有 U1-*.md」：${all.map((i) => i.message).join('; ')}`);
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: '.agents/work/ 不存在 → G12 skip 且 exit 0',
      run() {
        const root = makeFixture(cleanFixtureFiles());
        try {
          const report = runChecks({ root });
          const skip = report.skip.find((i) => i.gate === 'G12');
          assert(skip, 'G12 应 skip');
          assert(report.red.length === 0, `其余闸应全绿，实有 red：${report.red.map((i) => i.message).join('; ')}`);
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: '.agents/work/ 在但无 BOARD.md → G12 red',
      run() {
        const root = makeFixture(cleanFixtureFiles());
        try {
          fs.mkdirSync(path.join(root, WORK_DIR, 'scratch'), { recursive: true });
          const report = runChecks({ root });
          const hit = findIssue(report, 'G12', /BOARD\.md 缺失/);
          assert(hit, `G12 应判红：${[...report.red, ...report.warn, ...report.skip].map((i) => i.message).join('; ')}`);
          assert(!report.skip.some((i) => i.gate === 'G12'), '目录存在时 G12 不该 skip');
          assert(hit.file === BOARD_REL, `报错文件应为 ${BOARD_REL}，实为 ${hit.file}`);
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: '缺「真源:」→ G2 red（五键头注）',
      run() {
        const files = cleanFixtureFiles();
        files['spec.md'] = files['spec.md'].replace('> 真源：`demo.js` 里的 `demo()`\n', '');
        const root = makeFixture(files);
        try {
          const report = runChecks({ root });
          const hit = findRed(report, 'G2', /头注缺键：真源/);
          assert(hit, `G2 没报缺 真源：${report.red.map((i) => i.message).join('; ')}`);
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: '行内代码里的 file.ext:12 → 不报 G9（裸写的仍报）',
      run() {
        const files = cleanFixtureFiles();
        files['spec.md'] = files['spec.md'].replace(
          '## 验收\n',
          '## 验收\n\n示例：`foo.js:12` 是行内代码，不该被红。裸写 bar.js:34 仍判红。\n',
        );
        const root = makeFixture(files);
        try {
          const report = runChecks({ root });
          const g9 = report.red.filter((i) => i.gate === 'G9');
          assert(g9.length === 1, `G9 应只报裸写的那一条，实报 ${g9.length} 条：${g9.map((i) => i.message).join('; ')}`);
          assert(/bar\.js:34/.test(g9[0].message), `G9 应报 bar.js:34，实为：${g9[0].message}`);
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: '行内代码里的「后续版本」→ 不报 G14（裸露的仍报）',
      run() {
        const files = cleanFixtureFiles();
        files['spec.md'] = files['spec.md'].replace(
          '## 验收\n',
          '## 验收\n\n反例：`后续版本` 是被禁的词形。\n\n真正违规：后续版本会补上验收。\n',
        );
        const root = makeFixture(files);
        try {
          const report = runChecks({ root });
          const g14 = report.red.filter((i) => i.gate === 'G14');
          assert(g14.length === 1, `G14 应只报裸露的那一条，实报 ${g14.length} 条：${g14.map((i) => i.message).join('; ')}`);
          assert(/后续版本/.test(g14[0].message), `G14 消息应点名「后续版本」：${g14[0].message}`);
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: '编号引用「第 1、4、5 条」不报 G14；「共 12 条用例」报',
      run() {
        const files = cleanFixtureFiles();
        files['spec.md'] = files['spec.md'].replace(
          '## 验收\n',
          // 「第 7 条约定」是编号引用：不抹掉的话 `7 条约` 会被当计数（负向控制点）
          '## 验收\n\n顺手看第 1、4、5 条，都按约定走。另见第 7 条约定。\n\n本模块共 12 条用例。\n',
        );
        const root = makeFixture(files);
        try {
          const report = runChecks({ root });
          const g14 = report.warn.filter((i) => i.gate === 'G14');
          assert(g14.length === 1, `G14 应只报真正的那条计数，实报 ${g14.length} 条：${g14.map((i) => i.message).join('; ')}`);
          assert(/共 12 条/.test(g14[0].message), `G14 应报「共 12 条」，实为：${g14[0].message}`);
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: '依据写 docs/nope.md §9.9 → G12 red',
      run() {
        const board = boardFixture({
          todoRows: ['| U1 | P1 | 引用不存在的坐标 | 待开始 | 打开 `spec.md` 补条款 | docs/nope.md §9.9 | 2026-01-03 |'],
        });
        const root = makeFixture({ ...cleanFixtureFiles(), [`${WORK_DIR}/BOARD.md`]: board });
        try {
          const report = runChecks({ root });
          const hit = findRed(report, 'G12', /docs\/nope\.md/);
          assert(hit, `G12 没核依据里的文件：${[...report.red, ...report.warn].map((i) => i.message).join('; ')}`);
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: '依据写不存在的 sha → red（非 git 环境为 warn）',
      run() {
        const board = boardFixture({
          todoRows: ['| U1 | P1 | 引用死 sha | 待开始 | 打开 `spec.md` 补条款 | deadbeef | 2026-01-03 |'],
        });
        const root = makeFixture({ ...cleanFixtureFiles(), [`${WORK_DIR}/BOARD.md`]: board });
        try {
          const isGit = runGit(root, ['rev-parse', '--is-inside-work-tree']).ok;
          const report = runChecks({ root });
          if (isGit) {
            assert(findRed(report, 'G12', /deadbeef/), `git 环境应判红：${[...report.red, ...report.warn].map((i) => i.message).join('; ')}`);
          } else {
            assert(findWarn(report, 'G12', /deadbeef/), `非 git 环境应降级为 warn：${[...report.red, ...report.warn].map((i) => i.message).join('; ')}`);
          }
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: '依据写 AGENTS.md 硬约束 99（不存在）→ G12 red',
      run() {
        const board = boardFixture({
          todoRows: ['| U1 | P1 | 引用不存在的硬约束 | 待开始 | 打开 `spec.md` 补条款 | AGENTS.md 硬约束 99 | 2026-01-03 |'],
        });
        const root = makeFixture({ ...cleanFixtureFiles(), [`${WORK_DIR}/BOARD.md`]: board });
        try {
          const report = runChecks({ root });
          const hit = findRed(report, 'G12', /硬约束 99/);
          assert(hit, `G12 没核硬约束坐标：${[...report.red, ...report.warn].map((i) => i.message).join('; ')}`);
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: '文档地图写不存在的 api-old.md → G8 red',
      run() {
        const files = cleanFixtureFiles();
        files['AGENTS.md'] = agentsMapFixture(['| 契约 | `spec.md` |', '| 能力 | `api-old.md` |']);
        const root = makeFixture(files);
        try {
          const report = runChecks({ root });
          const hit = findRed(report, 'G8', /文档地图里的路径不存在：api-old\.md/);
          assert(hit, `G8 没查文档地图里的裸路径：${[...report.red, ...report.warn].map((i) => i.message).join('; ')}`);
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: '文档地图写的路径都存在 → G8 不报',
      run() {
        const files = cleanFixtureFiles();
        files['AGENTS.md'] = agentsMapFixture(['| 契约 | `spec.md` |', '| 变更 | `CHANGELOG.md` |', '| 外链 | [x](https://example.com/a.md) |']);
        const root = makeFixture(files);
        try {
          const report = runChecks({ root });
          const g8 = [...report.red, ...report.warn].filter((i) => i.gate === 'G8');
          assert(g8.length === 0, `地图路径都存在时不该有 G8 问题：${g8.map((i) => i.message).join('; ')}`);
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: '一格两路径：只报不存在的 reference.md，不报存在的 docs/reference/',
      run() {
        const files = cleanFixtureFiles();
        files['AGENTS.md'] = agentsMapFixture(['| 参考 | `reference.md` / `docs/reference/` |']);
        const root = makeFixture(files);
        try {
          fs.mkdirSync(path.join(root, 'docs', 'reference'), { recursive: true });
          const report = runChecks({ root });
          const g8 = report.red.filter((i) => i.gate === 'G8');
          assert(g8.length === 1, `应只报 reference.md 一条，实报 ${g8.length} 条：${g8.map((i) => `${i.line} ${i.message}`).join('; ')}`);
          assert(/reference\.md/.test(g8[0].message), `应点名 reference.md：${g8[0].message}`);
          assert(!/docs\/reference\//.test(g8[0].message), `docs/reference/ 存在，不该被报：${g8[0].message}`);
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: '同一目标既是链接又是正文路径 → 只报一条（链接优先）',
      run() {
        const files = cleanFixtureFiles();
        files['AGENTS.md'] = agentsMapFixture([], { sectionTitle: '地图' }).replace(
          '| 类型 | 放哪 |\n|---|---|\n',
          '[契约](docs/gone.md) 与 docs/gone.md 指向同一份不存在的文件。\n',
        );
        const root = makeFixture(files);
        try {
          const report = runChecks({ root });
          const g8 = report.red.filter((i) => i.gate === 'G8');
          assert(g8.length === 1, `同一目标应只报一条，实报 ${g8.length} 条：${g8.map((i) => i.message).join('; ')}`);
          assert(/链接目标不存在：docs\/gone\.md/.test(g8[0].message), `链接判据优先，实为：${g8[0].message}`);
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: '文档地图里的单段目录 `wip/` 不按仓库根误报',
      run() {
        const files = cleanFixtureFiles();
        files['AGENTS.md'] = agentsMapFixture([
          '| 契约 | `spec.md` |',
          '| 还没做 | `.agents/work/BOARD.md` | 回来读 `wip/` |',
        ]);
        const root = makeFixture(files);
        try {
          fs.mkdirSync(path.join(root, '.agents', 'work', 'wip'), { recursive: true });
          const report = runChecks({ root });
          const g8 = report.red.filter((i) => i.gate === 'G8');
          assert(!g8.some((i) => /路径不存在：wip\//.test(i.message)), `wip/ 是相对说法，不该按仓库根判：${g8.map((i) => i.message).join('; ')}`);
          assert(
            g8.some((i) => /文档地图里的路径不存在：\.agents\/work\/BOARD\.md/.test(i.message)),
            `点开头的路径要按文档地图判：${g8.map((i) => i.message).join('; ')}`,
          );
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: '反引号里的坐标/commit：真的不报、坏坐标只报一条',
      run() {
        const board = boardFixture({
          todoRows: [
            '| U1 | P1 | 反引号里的真坐标 | 待开始 | 打开 `spec.md` 补条款 | `spec.md §1.2` | 2026-01-03 |',
            '| U2 | P1 | 反引号里的坏坐标 | 待开始 | 打开 `spec.md` 补验收 | `docs/nope.md §9.9` | 2026-01-04 |',
          ],
          doneRows: [
            '| U3 | 2026-01-01 | 无代码变更 | `—` |',
            '| U4 | 2026-01-02 | 有 commit | `__SHA__` |',
          ],
        });
        const root = makeFixture({ ...cleanFixtureFiles(), [`${WORK_DIR}/BOARD.md`]: board });
        try {
          const sha = commitFixture(root);
          const abs = path.join(root, WORK_DIR, 'BOARD.md');
          const current = fs.readFileSync(abs, 'utf8');
          fs.writeFileSync(
            abs,
            sha ? current.replace('__SHA__', sha) : current.replace('`__SHA__`', '—'),
            'utf8',
          );
          const report = runChecks({ root });
          const g12 = [...report.red, ...report.warn].filter((i) => i.gate === 'G12');
          const others = g12.filter((i) => !/docs\/nope\.md/.test(i.message));
          assert(others.length === 0, `反引号里的真坐标 / commit 不该被报：${others.map((i) => `${i.line} ${i.message}`).join('; ')}`);
          const bad = g12.filter((i) => /docs\/nope\.md/.test(i.message));
          assert(bad.length === 1, `坏坐标应只报一条，实报 ${bad.length} 条：${bad.map((i) => i.message).join('; ')}`);
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: '未跟踪的坏 md 不再对全闸隐形 → G2 red',
      run() {
        const root = makeFixture(cleanFixtureFiles());
        try {
          fs.writeFileSync(path.join(root, 'draft-untracked.md'), '# 草稿\n\n没有头注，也没进 index。\n', 'utf8');
          const report = runChecks({ root });
          const hit = findRed(report, 'G2', /无头注/);
          assert(hit, `未跟踪的 md 没被看见：${report.red.map((i) => i.message).join('; ')}`);
          assert(hit.file === 'draft-untracked.md', `应点名 draft-untracked.md，实为 ${hit.file}`);
          assert(
            report.red.some((i) => i.gate === 'G1' && i.file === 'draft-untracked.md'),
            '未跟踪且不在白名单的文件也该 G1 red',
          );
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: 'chmod 000 的坏 md → 不能与干净仓库同形（G0 red 读不到）',
      run() {
        const root = makeFixture(cleanFixtureFiles());
        const target = path.join(root, 'spec.md');
        try {
          fs.chmodSync(target, 0o000);
          let unreadable = false;
          try {
            fs.readFileSync(target);
          } catch {
            unreadable = true;
          }
          if (!unreadable) return; // root / 无权限模型的环境造不出 EACCES，跳过断言
          const report = runChecks({ root });
          assert(report.red.length > 0, '读不到文件却 0 red：与干净仓库同形，等于默认通过');
          assert(
            report.red.some((i) => i.gate === 'G0' && /读不到（EACCES）/.test(i.message)),
            `应报 G0 red「读不到（EACCES）」：${report.red.map((i) => i.message).join('; ')}`,
          );
        } finally {
          try {
            fs.chmodSync(target, 0o644);
          } catch {
            /* 已删或权限不可改，忽略 */
          }
          removeFixture(root);
        }
      },
    },
    {
      name: '文件名含空格：地图反引号 / %20 链接 / 角括号链接 三种写法全绿',
      run() {
        const refDoc = [
          '# 外部 API',
          '',
          '> 类型：参考',
          '> 读者：接入方',
          '> 真源：外部文档',
          '> 更新触发：上游改版',
          '> 规模上限：600',
          '> 采集日期：2026-11-01',
          '> 来源版本：v3',
          '',
          '## 1 端点',
          '',
          '`GET /items` 返回列表。',
          '',
        ].join('\n');
        const files = cleanFixtureFiles();
        files['docs/reference/api 2024.md'] = refDoc;
        files['AGENTS.md'] = agentsMapFixture([
          '| 外部结构 | `docs/reference/api 2024.md` | 有采集日期 |',
          '| %20 写法 | [链接](docs/reference/api%202024.md) | 同一条目 |',
          '| 角括号写法 | [链接](<docs/reference/api 2024.md>) | 空格原样 |',
        ]);
        const root = makeFixture(files);
        try {
          const report = runChecks({ root });
          const g8 = [...report.red, ...report.warn].filter((i) => i.gate === 'G8');
          assert(g8.length === 0, `带空格的文件三种写法都该可达：${g8.map((i) => i.message).join('; ')}`);
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: '金样本：出厂模板照要求填完 → 红/告警/跳过全为空',
      run() {
        const dir = assetsDir();
        if (!dir) skipCase('assets 不在脚本旁，金样本未执行');
        const files = goldenFilledFiles(dir);
        if (!files) skipCase('assets 里缺模板文件，金样本未执行');
        // 金样本必须真的覆盖「AGENTS.md 硬约束 N」这条坐标规则；模板退回项目符号就说明覆盖失效
        assert(
          /^1\.\s*\*\*/m.test(files['AGENTS.md']),
          'AGENTS 模板没有 `1. **…**` 形态的硬约束：`AGENTS.md 硬约束 N` 这条坐标规则在金样本里空转',
        );
        const root = makeFixture(files);
        try {
          const report = runChecks({ root });
          // 三者都要空：只断言 red 会放过「检查被降级成 skip」与「告警被吞」的回归
          const describe = (list) => list.map((i) => `${i.file}:${i.line} ${i.gate} ${i.message}`).join('; ');
          assert(report.red.length === 0, `照模板填完应当 0 red，实有：${describe(report.red)}`);
          assert(report.warn.length === 0, `照模板填完应当 0 warn，实有：${describe(report.warn)}`);
          assert(report.skip.length === 0, `照模板填完应当 0 skip（有闸被降级为跳过），实有：${describe(report.skip)}`);
        } finally {
          removeFixture(root);
        }
      },
    },
    {
      name: '金样本·原样拷贝：红只能是「占位未填」那一类',
      run() {
        const dir = assetsDir();
        if (!dir) skipCase('assets 不在脚本旁，金样本未执行');
        const read = (name) => {
          const abs = path.join(dir, name);
          return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
        };
        const agents = read('AGENTS.template.md');
        const readme = read('README.template.md');
        const changelog = read('CHANGELOG.template.md');
        const spec = read('spec.template.md');
        const board = read('BOARD.template.md');
        if (!agents || !readme || !changelog || !spec || !board) skipCase('assets 里缺模板，金样本未执行');
        const reference = read('reference.template.md');
        const wip = read('WIP.template.md');
        const files = {
          'AGENTS.md': agents,
          'README.md': readme,
          'CHANGELOG.md': changelog,
          'spec.md': spec,
          '.agents/work/BOARD.md': board,
          '.agents/work/wip/U1-demo.md': wip || '',
          'package.json': '{"name":"demo","description":"demo"}\n',
        };
        if (reference) files['reference.md'] = reference;
        const whitelist = [
          ...Object.keys(files).filter((rel) => rel.endsWith('.md') && !rel.startsWith('.agents/')),
          'docs/**',
        ];
        files[CONFIG_NAME] = `${JSON.stringify({ whitelist, idPrefixes: ['U', 'M', 'V', 'D'] }, null, 2)}\n`;
        const root = makeFixture(files);
        try {
          const report = runChecks({ root });
          // 占位未填该红：模板自己写了「没填完判红是对的」。除了这几类，其他红一律视为真问题。
          const markers = [
            /采集日期 不是/, // reference.template 的 YYYY-MM-DD
            /版本标题不合规/, // CHANGELOG.template 的 YYYY-MM-DD
            /依据 里的文件不存在/, // BOARD.template 的 <docs/x.md §2.1>
            /依据 里没有可校验的坐标/,
            /无头注/, // *.template.md 被当项目文档扫到时
          ];
          const unexplained = report.red.filter((i) => !markers.some((re) => re.test(i.message)));
          assert(
            unexplained.length === 0,
            `原样拷贝出现了「不是占位」的红（模板与门禁有真冲突）：${unexplained.map((i) => `${i.file}:${i.line} ${i.message}`).join('; ')}`,
          );
        } finally {
          removeFixture(root);
        }
      },
    },
  ];
}

/**
 * 跑内置自测：每个用例打印 `PASS/FAIL <用例名>`，有 FAIL 则退出码 1。
 * @returns {number}
 */
function runSelftest() {
  const cases = selftestCases();
  let passed = 0;
  const failures = [];
  const skips = [];
  process.stdout.write(`docs-standards selftest: ${cases.length} 个用例（夹具在 ${os.tmpdir()}）\n`);
  for (let index = 0; index < cases.length; index += 1) {
    const testCase = cases[index];
    const label = `${index + 1} ${testCase.name}`; // 编号由下标生成，不手写（手写必漂）
    try {
      testCase.run();
      passed += 1;
      process.stdout.write(`PASS ${label}\n`);
    } catch (err) {
      if (err instanceof SelftestSkip) {
        skips.push({ label, reason: err.message });
        process.stdout.write(`SKIP ${label}（${err.message}）\n`);
        continue;
      }
      failures.push({ label, reason: err && err.message ? err.message : String(err) });
      process.stdout.write(`FAIL ${label}\n`);
    }
  }
  for (const failure of failures) {
    process.stdout.write(`  └ FAIL 原因：${failure.reason}\n`);
  }
  for (const skipped of skips) {
    process.stdout.write(`  └ SKIP 原因：${skipped.reason}\n`);
  }
  process.stdout.write(
    `docs-standards selftest: ${passed} passed, ${skips.length} skipped, ${failures.length} failed\n`,
  );
  if (skips.length > 0) {
    process.stdout.write('注意：SKIP 是「没跑」，不是「跑了且过」——跳过数不为 0 时这次自测不覆盖全部判据。\n');
  }
  return failures.length === 0 ? 0 : 1;
}

/**
 * 是否作为 CLI 直接执行。
 * 被 `import` 时只暴露函数、不跑检查（方便外部写测试或复用单道闸）。
 * @returns {boolean}
 */
function isEntrypoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return true;
  }
}

if (isEntrypoint()) process.exitCode = main(process.argv.slice(2));

/**
 * 供外部复用（写测试、复用单道闸、读阈值）：
 *   import { runChecks, LIMITS } from './check-docs.mjs';
 * CLI 行为不受影响。
 */
export {
  LIMITS,
  GATES,
  ENUMS,
  runChecks,
  formatText,
  formatJson,
  splitCells,
  parseTables,
  parseHeaderNote,
};
