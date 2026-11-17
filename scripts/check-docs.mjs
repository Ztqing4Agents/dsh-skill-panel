#!/usr/bin/env node
/**
 * Documentation gate for this repo.
 *
 * Contract: docs/contracts/*.md (head notes, required sections), docs/reference/*.md
 * (freshness), CHANGELOG.md (Keep a Changelog shape), AGENTS.md / README.md + README.en.md (size).
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
const HEADLESS = new Set(['AGENTS.md', 'README.md', 'README.en.md', 'CHANGELOG.md']);
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

/** Every file under `dir` whose name ends with `suffix`, as repo-relative paths. */
function walkFiles(dir, suffix, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) walkFiles(abs, suffix, out);
    else if (entry.endsWith(suffix)) out.push(relativePath(abs));
  }
  return out;
}

/** Test modules cite contracts in their header comments — those anchors must hold too. */
const testModules = (() => {
  try {
    // `--others --exclude-standard` matches `listMarkdown`: a test that is written but not
    // committed yet still counts as a case's landing, so R14 does not go red on the work of
    // the very change that adds it.
    const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'test'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    // Same rule as `listMarkdown`: git keeps listing a file deleted from the worktree until
    // the deletion is committed, and reading it here would crash the gate instead of
    // reporting on the tree that actually exists.
    return out.split('\0').filter((f) => f.endsWith('.mjs')).filter((f) => existsSync(join(ROOT, f)));
  } catch {
    // A tree without git — the gate's own self-tests, or an exported copy — still has its
    // test files on disk. Walk them so the anchor and case checks can run there too.
    return walkFiles(join(ROOT, 'test'), '.mjs').sort();
  }
})();
const headings = (f) => lines(f).flatMap((l) => {
  const m = /^(#{1,6}) +(?:§)?(.+)$/.exec(l);
  return m ? [{ level: m[1].length, title: m[2].trim() }] : [];
});

/* -------------------------------------------------------------- R1 whitelist */

const ALLOW_EXACT = new Set(['AGENTS.md', 'README.md', 'README.en.md', 'CHANGELOG.md']);
const ALLOW_PREFIX = ['docs/contracts/', 'docs/reference/'];
const allowed = (f) => ALLOW_EXACT.has(f) || ALLOW_PREFIX.some((p) => f.startsWith(p));

for (const f of files) {
  if (!allowed(f)) {
    red('R1', `${f}: not on the doc whitelist (allowed: AGENTS.md / README.md / README.en.md / CHANGELOG.md / docs/contracts/** / docs/reference/**)`);
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

  // R5: reference freshness. Two keys, because an external shape has two expiry
  // triggers: time (180 days) and the source version moving (upgrade = re-collect).
  if (type === '参考') {
    if (!head['来源版本']) red('R5', `${f}: 类型 参考 missing 「来源版本:」`);
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

// The READMEs are the only docs written for users: they stay short on purpose, and a size
// warning is the cheapest reminder that a new feature paragraph belongs in CHANGELOG.md.
// Both language editions are held to the same line, so the warning names the file it read.
for (const readme of ['README.md', 'README.en.md']) {
  if (!text.has(readme)) continue;
  const n = lines(readme).length;
  if (n > 120) warn('R12', `${readme}: ${n} lines (>120) —— 只写使用者视角，细节进 CHANGELOG / 契约`);
}

for (const [f, limit] of declaredLimit) {
  const n = lines(f).length;
  if (n > limit) warn('R11', `${f}: ${n} lines (>${limit} declared) —— 合并/迁出/拆分，别删边缘条件`);
}

/* -------------------------- R13 no pointers at the local-only .agents/work/ drafts */

/**
 * `.agents/work/` is in `.gitignore`: the wip notes and the scratch readings live only on the
 * machine that wrote them. Citing one from a repo doc hands the next reader a link that is
 * already dead for anyone who cloned the repo — and the evidence behind a contract clause has
 * to be reproducible from the truth source that clause names, not from a scratch file that may
 * be deleted tomorrow.
 *
 * The board itself is the exception: AGENTS.md has to tell an agent where the progress board
 * is, so `.agents/work/BOARD.md` and `BOARD-archive.md` stay legal — they are the workplace
 * entry, not a draft. Everything else under `.agents/work/` is transient.
 */
const AGENTS_WORK_REF = /\.agents\/work\/([A-Za-z0-9._-]+)(?:\/[^\s`)\]）"'>，。；、]*)?/g;
const WORKPLACE_ENTRIES = new Set(['BOARD.md', 'BOARD-archive.md']);

for (const f of allDocs) {
  lines(f).forEach((line, i) => {
    for (const hit of line.matchAll(AGENTS_WORK_REF)) {
      if (WORKPLACE_ENTRIES.has(hit[1])) continue;
      red('R13', `${f}:${i + 1}: 引用不入库的瞬态产物 → ${hit[0]}（工作现场入口只有 .agents/work/BOARD.md 与 BOARD-archive.md）`);
    }
  });
}

/* ------------------------ R14 every acceptance case row lands on a test title */

/**
 * `docs/contracts/acceptance.md` numbers its cases (`| **K123** | …`) and a test title
 * repeats the number (`test('K123 …')`). Nothing enforced that link until 2026-11-15:
 * six cases had quietly lost their landing, and only a manual audit found them.
 *
 * Only the case-table rows are read, so ranges (`K28–K61`), group references (`附录 D.7`)
 * and prose mentions elsewhere (`AGENTS.md`, `decisions.md`, `README.md`) never reach this
 * rule — a plain "every K\d+ in the text needs a test" check would red on its own table of
 * contents.
 *
 * What it cannot do: tell whether the test behind a number asserts the right thing (a
 * title keeps a number while the case moves elsewhere and this stays green), and it reads
 * no assertion bodies at all. It also does not invent a landing for a case that has none:
 * those sit in EXEMPT_CASES with the reason, and the exemption expires by itself — the
 * moment a test title carries the number, the exemption turns red and must be deleted.
 */
const EXEMPT_CASES = new Map([
  // 退役：编号不复用（acceptance 各行的「已退役」登记了为什么消失）。
  ['K33', 'retired 2026-11-09 — the zip reader went away with the `files` mirror; the number is not reused'],
  ['K58', 'retired 2026-11-09 — the Lucide icon proxy went away with clawhub; the number is not reused'],
  ['K60', 'retired 2026-11-09 — the clawhub icon proxy went away with the mirror; the number is not reused'],
  ['K80', 'retired 2026-11-09 — the favorite toggle withdrew from the card; the number is not reused'],
  // 真机抽查：几何与真实上游要真浏览器，acceptance 三行都写着「不进 npm test」。
  ['K50', 'real-machine spot check — pixel-level hit plus the live upstream, not in `npm test`'],
  ['K51', 'real-machine spot check — installs a real skill end to end against the live upstream'],
  ['K109', 'real-machine spot check — the three-line description geometry at 1320×940'],
  // 实现仍在、自动化缺一个注入点：竞态在纯 node 里稳定复现不了（看板 V2 补 seam）。
  ['K14', 'no automated landing yet — the fingerprint re-check is a race; delete this line once V2 adds the seam'],
]);

if (text.has('docs/contracts/acceptance.md')) {
  const CASES = 'docs/contracts/acceptance.md';
  const CASES_ROW = /^\|\s*\*\*(K\d+)\*\*/;
  const rows = new Map();
  lines(CASES).forEach((line, i) => {
    const hit = CASES_ROW.exec(line);
    if (hit !== null) rows.set(hit[1], i + 1);
  });
  /** K number → the first test module whose title leads with it. */
  const landed = new Map();
  for (const file of testModules) {
    let source;
    try {
      source = textOf(file);
    } catch {
      continue;
    }
    for (const title of source.matchAll(/\b(?:test|it|describe)\(\s*['"`]([^'"`]*)['"`]/g)) {
      // Only the number that *leads* the title is a landing (`K6 / A1 …`, `K25/K28 …`).
      // A title that merely mentions another case — or a self-test that fabricates one —
      // must not read as that case's landing, or the exemption list would look stale.
      const lead = /^K\d+(?:\s*\/\s*K\d+)*/.exec(title[1].trim());
      if (lead === null) continue;
      for (const hit of lead[0].matchAll(/K(\d+)/g)) {
        const id = `K${hit[1]}`;
        if (!landed.has(id)) landed.set(id, file);
      }
    }
  }
  for (const [id, at] of rows) {
    if (landed.has(id) || EXEMPT_CASES.has(id)) continue;
    red('R14', `${CASES}:${at}: 用例 ${id} 没有测试落点（没有任何 test() 标题带这个号，也不在豁免集里）`);
  }
  for (const [id, reason] of EXEMPT_CASES) {
    if (!rows.has(id)) {
      red('R14', `${CASES}: 豁免集里的 ${id} 在 acceptance 没有用例行——删掉这条豁免，或把用例行补回来`);
    } else if (landed.has(id)) {
      red('R14', `${CASES}: 豁免已失效——${id} 已经有测试落点（${landed.get(id)}），删掉豁免集里那一行（当初的理由：${reason}）`);
    }
  }
  for (const [id, file] of landed) {
    if (rows.has(id) || EXEMPT_CASES.has(id)) continue;
    red('R14', `${file}: 测试标题里的 ${id} 在 ${CASES} 没有对应的用例行（编号只在用例表里发）`);
  }
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
