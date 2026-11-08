#!/usr/bin/env node
/**
 * Documentation gate for this repo.
 *
 * Contract: docs/contracts/*.md (head notes, required sections), docs/reference/*.md
 * (freshness), CHANGELOG.md (Keep a Changelog shape), AGENTS.md (size).
 *
 * Red = structure missing / contradiction / dangling reference. Warn = size, freshness.
 * The gate never rewrites anything; it only reads.
 *
 * Usage: node scripts/check-docs.mjs [--root <dir>] [--quiet]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const valueOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const ROOT = resolve(valueOf('--root') ?? process.cwd());
const QUIET = flag('--quiet');

/** Files that may carry a `类型:` head note. Everything else in the whitelist is exempt. */
const HEADLESS = new Set(['AGENTS.md', 'README.md', 'CHANGELOG.md']);
const LIMITS = { 契约: 300, 规范: 400, 参考: 600 };
const CATEGORIES = new Set(['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']);
const VERSION_HEADING = /^## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}( \[YANKED\])?$/;
/** Paths owned by other projects / the host app: never validated as repo paths. */
const FOREIGN = /^(HIDDER\/|EX\/|PROF\/|SHELL\/|~\/|\/)/;
/** Trees that hold data fixtures, not documentation. */
const NOT_DOC_TREES = ['test/'];
const ROOT_FILES = new Set([
  'index.js', 'client.js', 'package.json', 'package-lock.json', 'cordis.patch.yml',
  'AGENTS.md', 'README.md', 'CHANGELOG.md', '.gitignore',
]);
const REPO_PREFIXES = ['lib/', 'src/', 'test/', 'scripts/', 'locale/', 'docs/', 'assets/'];

const reds = [];
const warns = [];
const red = (id, msg) => reds.push({ id, msg });
const warn = (id, msg) => warns.push({ id, msg });

/* ------------------------------------------------------------------ discovery */

function walkMd(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === '.git' || entry === 'node_modules' || entry === '.agents') continue;
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) walkMd(abs, out);
    else if (entry.endsWith('.md')) out.push(relativePath(abs));
  }
  return out;
}

const relativePath = (abs) => abs.slice(ROOT.length + 1).split('\\').join('/');

function listMarkdown() {
  try {
    const out = execFileSync(
      'git',
      ['-C', ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.md'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    // git still lists files deleted from the worktree until the deletion is committed
    return out.split('\0').filter(Boolean)
      .filter((f) => !NOT_DOC_TREES.some((p) => f.startsWith(p)))
      .filter((f) => existsSync(join(ROOT, f)))
      .sort();
  } catch {
    return walkMd(ROOT).filter((f) => !NOT_DOC_TREES.some((p) => f.startsWith(p))).sort();
  }
}

const files = listMarkdown();

/** Lazily read a file once; keeps the gate usable on trees with many files. */
const fileTexts = new Map();
const textOf = (f) => {
  if (!fileTexts.has(f)) fileTexts.set(f, readFileSync(join(ROOT, f), 'utf8'));
  return fileTexts.get(f);
};
const text = { get: textOf, has: (f) => existsSync(join(ROOT, f)) };
const lines = (f) => textOf(f).split('\n');

/** Test modules cite contracts in their header comments — those anchors must hold too. */
const testModules = (() => {
  try {
    const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z', '--', 'test'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\0').filter((f) => f.endsWith('.mjs'));
  } catch {
    return [];
  }
})();
const headings = (f) => lines(f).flatMap((l) => {
  const m = /^(#{1,6}) +(?:§)?(.+)$/.exec(l);
  return m ? [{ level: m[1].length, title: m[2].trim() }] : [];
});

/* -------------------------------------------------------------- R1 whitelist */

const ALLOW_EXACT = new Set(['AGENTS.md', 'README.md', 'CHANGELOG.md']);
const ALLOW_PREFIX = ['docs/contracts/', 'docs/reference/'];
const allowed = (f) => ALLOW_EXACT.has(f) || ALLOW_PREFIX.some((p) => f.startsWith(p));

for (const f of files) {
  if (!allowed(f)) {
    red('R1', `${f}: not on the doc whitelist (allowed: AGENTS.md / README.md / CHANGELOG.md / docs/contracts/** / docs/reference/**)`);
  }
}

/* ------------------------------------------------------- R2–R5 head notes */

const headOf = (f) => {
  const seek = /^> *(类型|读者|真源|更新触发|规模上限|采集日期|来源版本) *[:：] *(.*)$/;
  const found = {};
  for (const line of lines(f).slice(0, 30)) {
    if (line.trim() === '' && Object.keys(found).length) break;
    const m = seek.exec(line);
    if (m) found[m[1]] = m[2].trim();
  }
  return found;
};

const declaredLimit = new Map();

for (const f of files) {
  if (HEADLESS.has(f)) continue;
  const head = headOf(f);
  if (!head['类型']) {
    red('R2', `${f}: missing head note (need 类型 / 读者 / 真源 / 更新触发 / 规模上限)`);
    continue;
  }
  const type = head['类型'];
  if (!(type in LIMITS)) {
    red('R3', `${f}: 类型「${type}」not in {契约, 规范, 参考}`);
    continue;
  }
  for (const key of ['读者', '真源', '更新触发', '规模上限']) {
    if (!head[key]) red('R2', `${f}: head note missing 「${key}:」`);
  }

  // R3: declared bound must match the type
  const declared = Number((head['规模上限'] ?? '').replace(/[^\d]/g, ''));
  if (!Number.isFinite(declared) || declared !== LIMITS[type]) {
    red('R3', `${f}: 规模上限 ${head['规模上限'] ?? '(missing)'} must be ${LIMITS[type]} for 类型 ${type}`);
  } else {
    declaredLimit.set(f, declared);
  }

  // R4: required sections
  const titles = headings(f).filter((h) => h.level === 2).map((h) => h.title);
  if (type === '规范' && !titles.some((t) => t.includes('验收'))) {
    red('R4', `${f}: 类型 规范 needs one 「## …验收…」 section (got: ${titles.join(' | ') || 'none'})`);
  }
  if (type === '契约') {
    for (const need of ['范围', '条款', '验收']) {
      if (!titles.some((t) => t.includes(need))) red('R4', `${f}: 类型 契约 needs a 「## ${need}」 section`);
    }
  }

  // R5: reference freshness
  if (type === '参考') {
    const collected = head['采集日期'];
    if (!collected) {
      red('R5', `${f}: 类型 参考 missing 「采集日期:」`);
    } else {
      const at = Date.parse(collected.replace(/\//g, '-'));
      if (Number.isNaN(at)) red('R5', `${f}: 采集日期「${collected}」is not a date`);
      else {
        const days = Math.floor((Date.now() - at) / 86400000);
        if (days > 180) warn('R5', `${f}: 采集于 ${collected}，已 ${days} 天（>180）——重新采集或整份替换`);
      }
    }
  }
}

/* ------------------------------------------------------- R6 CHANGELOG shape */

if (text.has('CHANGELOG.md')) {
  const ls = lines('CHANGELOG.md');
  if (!ls.some((l) => l.trim() === '## [Unreleased]')) red('R6', 'CHANGELOG.md: missing 「## [Unreleased]」');
  for (const l of ls) {
    if (!l.startsWith('## [')) continue;
    if (l.trim() === '## [Unreleased]') continue;
    if (!VERSION_HEADING.test(l.trim())) {
      red('R6', `CHANGELOG.md: bad version heading 「${l.trim()}」 (want 「## [x.y.z] - YYYY-MM-DD」)`);
    }
  }
  for (const l of ls) {
    const m = /^### (.+)$/.exec(l);
    if (!m) continue;
    for (const part of m[1].split('/').map((s) => s.trim())) {
      if (!CATEGORIES.has(part)) red('R6', `CHANGELOG.md: 「### ${m[1]}」not one of ${[...CATEGORIES].join('/')}`);
    }
  }
}

/* ---------------------------------------- R7 anchors: §x.y / 附录 X resolve */

const contractDocs = files.filter((f) => f.startsWith('docs/contracts/'));

/** Does `num` (e.g. "3.2.4") exist as a heading anywhere in `doc`? */
const hasNumberHeading = (doc, num) =>
  headings(doc).some((h) => h.title.startsWith(num + ' ') || h.title === num || h.title.startsWith(num + '：') || h.title.startsWith(num + '('));

const hasAppendixHeading = (doc, letter, sub) =>
  headings(doc).some((h) =>
    sub
      ? h.title.startsWith(`${letter}.${sub} `) || h.title.startsWith(`附录 ${letter}.${sub}`)
      : h.title.startsWith(`附录 ${letter}`),
  );

const allDocs = files.filter((f) => f.endsWith('.md'));

for (const f of [...allDocs, ...testModules]) {
  // path-qualified refs: `docs/...md §3.2.4` / `docs/...md 附录 D.3`
  for (const m of textOf(f).matchAll(/((?:\.\/)?docs\/[\w./-]+\.md) +(§ ?\d+(?:\.\d+)*|附录 +[A-Z](?:\.\d+)?)/g)) {
    const [, path, ref] = m;
    if (!existsSync(join(ROOT, path))) {
      red('R8', `${f}: 引用的文档不存在 → ${path}`);
      continue;
    }
    const num = ref.replace(/[§ ]/g, '');
    const app = /附录 +([A-Z])(?:\.(\d+))?/.exec(ref);
    const ok = app ? hasAppendixHeading(path, app[1], app[2]) : hasNumberHeading(path, num);
    if (!ok) red('R7', `${f}: 锚点失效 → ${path} ${ref}`);
  }

  // bare §x.y inside contract docs: must resolve in some contract doc.
  // `PRD §x` is exempt: PRD left the tree (see the head notes) and is cited for provenance only.
  for (const m of text.get(f).matchAll(/(?<![\w/`.])§ ?(\d+(?:\.\d+)+)/g)) {
    const before = textOf(f).slice(Math.max(0, m.index - 60), m.index);
    if (/PRD/.test(before)) continue;
    const num = m[1];
    if (!contractDocs.some((d) => hasNumberHeading(d, num))) {
      red('R7', `${f}: 锚点失效 → §${num}（没有任何契约文档含该编号的章节）`);
    }
  }
}

/* -------------------------------------------- R8 reachability: links + paths (docs only) */

const backtickedPaths = /`([^`\n]+)`/g;

for (const f of allDocs) {
  // markdown links
  for (const m of text.get(f).matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const rel = target.split('#')[0];
    if (!rel) continue;
    if (!existsSync(join(ROOT, f, '..', rel)) && !existsSync(join(ROOT, rel))) {
      red('R8', `${f}: 链接不可达 → ${target}`);
    }
  }
  // backticked repo paths (skip fenced blocks — they are samples, not claims)
  let fenced = false;
  for (const line of lines(f)) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    for (const m of line.matchAll(backtickedPaths)) {
      let token = m[1].trim();
      if (token.includes(' ') || token.includes('://') || FOREIGN.test(token)) continue;
      const cut = token.search(/[*{]/);
      const base = cut >= 0 ? token.slice(0, cut) : token;
      const isRepoPath = REPO_PREFIXES.some((p) => base.startsWith(p)) || ROOT_FILES.has(token);
      if (!isRepoPath) continue;
      const probe = base.replace(/\/$/, '');
      if (!existsSync(join(ROOT, probe))) {
        red('R8', `${f}: 引用不可达 → ${token}`);
      }
    }
  }
}

/* ------------------------------------------------------------ R9 no line refs */

for (const f of allDocs) {
  lines(f).forEach((line, i) => {
    if (/\b[\w./-]+\.(?:js|mjs|jsx|json|md|css|yml|yaml):\d+\b/.test(line)) {
      red('R9', `${f}:${i + 1}: 出现行号引用（file:line），改成符号名 / 章节锚点`);
    }
    if (/第\s*\d+\s*行/.test(line)) red('R9', `${f}:${i + 1}: 出现「第 N 行」引用`);
  });
}

/* ---------------------------------------------------- R10/R11 size budgets */

if (text.has('AGENTS.md')) {
  const n = lines('AGENTS.md').length;
  if (n > 100) warn('R10', `AGENTS.md: ${n} lines (>100) —— 把内容送进契约，地图留指针`);
}

for (const [f, limit] of declaredLimit) {
  const n = lines(f).length;
  if (n > limit) warn('R11', `${f}: ${n} lines (>${limit} declared) —— 合并/迁出/拆分，别删边缘条件`);
}

/* ------------------------------------------------------------------- report */

const label = (e) => `  ${e.id} ${e.msg}`;
if (!QUIET || reds.length || warns.length) {
  for (const w of warns) console.log(`warn ${w.id} ${w.msg}`);
  for (const r of reds) console.log(`RED  ${r.id} ${r.msg}`);
}
if (reds.length) {
  console.error(`check-docs: FAIL (${reds.length} red, ${warns.length} warn, ${files.length} md files)`);
  process.exit(1);
}
console.log(`check-docs: OK (${files.length} md files, ${warns.length} warn)`);
