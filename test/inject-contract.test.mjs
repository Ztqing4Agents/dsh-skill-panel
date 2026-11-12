/**
 * Static contract: every `ctx.<service>` a half reads must be declared in `inject`.
 *
 * Why this exists: the runtime Proxy in `client-entry.test.mjs` only fires when a test
 * actually walks that code path with the real module. This scan reads the *source* of
 * both halves and compares usage against the declaration, so a brand-new
 * `ctx.theme.something` (or a deleted `inject` export) is reported by the suite even
 * before anything is rebuilt - and the failure names the file and the missing service.
 *
 * Real-machine incident this encodes: the client half shipped without
 * `export const inject = ['slots','locale']`, cordis threw
 * `cannot get property "locale" without inject` and the whole web boot failed with
 * `1 entry did not activate`, after which DSH wrote the entry into the profile as
 * `disabled: true`. A plain-object fake never reproduces that; a static scan does.
 *
 * Core cordis capabilities are not services: `effect`, `on`, `emit`, `get`, `set`,
 * `provide`, `logger`, `fiber`, `scope`. Evidence for that split is the host's own
 * `dsh-skill-filesystem`, which declares `inject = ["skills"]` while freely using
 * `ctx.logger` (11×), `ctx.effect`, `ctx.on` and `ctx.get`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Package root: this file lives one level down, in test/. */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Cordis core capabilities: readable on any context without an inject declaration. */
const CORE = new Set(['effect', 'on', 'emit', 'get', 'set', 'provide', 'logger', 'fiber', 'scope', 'plugin']);

/** The two plugin halves, with the entry file that owns their `inject`. */
const HALVES = [
  { label: 'client', entry: join(ROOT, 'src', 'client', 'index.jsx'), dirs: [join(ROOT, 'src', 'client')] },
  { label: 'host', entry: join(ROOT, 'index.js'), dirs: [join(ROOT, 'index.js'), join(ROOT, 'lib')] },
];

/**
 * Read one file.
 * @param {string} file - absolute path.
 * @returns {string} file text.
 */
const textOf = (file) => readFileSync(file, 'utf8');

/**
 * List the source files of one half.
 * @param {(string)[]} targets - directories or single files.
 * @returns {string[]} absolute paths.
 */
function sourcesOf(targets) {
  const out = [];
  const walk = (target) => {
    let info;
    try {
      info = readdirSync(target, { withFileTypes: true });
    } catch {
      out.push(target);
      return;
    }
    for (const entry of info) {
      const full = join(target, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|jsx|mjs)$/.test(entry.name)) out.push(full);
    }
  };
  for (const target of targets) walk(target);
  return out;
}

/**
 * Extract the strings of `export const inject = [...]`.
 * @param {string} text - entry source.
 * @returns {string[]|null} the declared services, or null when the export is missing.
 */
function declaredInject(text) {
  const match = /export\s+const\s+inject\s*=\s*\[([^\]]*)\]/.exec(text);
  if (match === null) return null;
  return [...match[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((entry) => entry[1]);
}

/**
 * Replace comments and string/template contents with spaces (same length).
 *
 * Necessary for two reasons: documentation talks about `ctx.theme.overrideTokens`
 * without reading it, and a service name inside a string literal is not a read. A
 * naive regex over raw text reports both as violations, which would train the team to
 * ignore this guard.
 * @param {string} text - file text.
 * @returns {string} code-only text of the same length.
 */
function codeOnly(text) {
  const out = [...text];
  const blank = (from, to) => {
    for (let index = from; index < to; index += 1) out[index] = ' ';
  };
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '/' && next === '/') {
      const end = text.indexOf('\n', index);
      const stop = end === -1 ? text.length : end;
      blank(index, stop);
      index = stop;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = text.indexOf('*/', index + 2);
      const stop = end === -1 ? text.length : end + 2;
      blank(index, stop);
      index = stop;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      let cursor = index + 1;
      while (cursor < text.length) {
        if (text[cursor] === '\\') {
          cursor += 2;
          continue;
        }
        if (text[cursor] === char) break;
        cursor += 1;
      }
      blank(index + 1, Math.min(cursor, text.length));
      index = cursor + 1;
      continue;
    }
    index += 1;
  }
  return out.join('');
}

/**
 * Every `ctx.<ident>` (also `ctx?.<ident>`) read in one source file.
 * @param {string} text - file text.
 * @returns {string[]} service names, comments and string literals excluded.
 */
function ctxReads(text) {
  return [...codeOnly(text).matchAll(/\bctx\??\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1]);
}

for (const half of HALVES) {
  test(`${half.label} 半部必须导出 inject 数组`, () => {
    const declared = declaredInject(textOf(half.entry));
    assert.notEqual(declared, null, `${relative(ROOT, half.entry)} 里有 export const inject = [...]`);
    assert.equal(declared.length > 0, true, `${half.label} 的 inject 不是空数组`);
    assert.equal(declared.includes('effect'), false, 'effect 是核心能力，不应写进 inject');
  });

  test(`${half.label} 半部读到的每个 ctx 服务都已声明（静态扫描）`, () => {
    const declared = new Set(declaredInject(textOf(half.entry)) ?? []);
    const problems = [];
    for (const file of sourcesOf(half.dirs)) {
      for (const service of ctxReads(textOf(file))) {
        if (CORE.has(service) || declared.has(service)) continue;
        problems.push(`${relative(ROOT, file)} reads ctx.${service}`);
      }
    }
    assert.deepEqual(problems, [], `${half.label} 半部没有未声明的服务读取（缺 inject 会让整个 boot 失败）`);
  });

  test(`${half.label} 半部的 inject 里没有多余声明（声明了就必须真的读）`, () => {
    const declared = declaredInject(textOf(half.entry)) ?? [];
    const used = new Set(sourcesOf(half.dirs).flatMap((file) => ctxReads(textOf(file))));
    const unused = declared.filter((service) => !used.has(service));
    assert.deepEqual(unused, [], `${half.label} 的 inject 与 ctx.* 读取严格对齐（多余的声明会拖住激活）`);
  });
}

test('client 半部的 inject 正好是 slots + locale + uiWorkspace', () => {
  const declared = declaredInject(textOf(join(ROOT, 'src', 'client', 'index.jsx')));
  // `uiWorkspace` 只为添加菜单的第二项（让 Agent 创建技能）存在：读 ctx.uiWorkspace 之前
  // 必须在 inject 里，否则整页 web boot 失败（AGENTS.md 硬约束 11）。
  assert.deepEqual([...declared].sort(), ['locale', 'slots', 'uiWorkspace'], '声明 slots / locale / uiWorkspace');
});

test('host 半部的 inject 正好是 webServer + skills + sessions', () => {
  const declared = declaredInject(textOf(join(ROOT, 'index.js')));
  assert.deepEqual([...declared].sort(), ['sessions', 'skills', 'webServer'], '声明三个宿主服务');
});

test('提交的 client.js 里 inject 与源码一致（构建没有落后于源码）', async () => {
  const { readFile } = await import('node:fs/promises');
  const artifact = await readFile(join(ROOT, 'client.js'), 'utf8');
  // The bundle keeps the export verbatim (`inject` is a plain const); assert the exact
  // array text so a stale build that still ships the old declaration fails here.
  assert.match(
    artifact,
    /inject\s*=\s*\[\s*["']slots["'],\s*["']locale["'],\s*["']uiWorkspace["']\s*\]/,
    'client.js 里的 inject 是 slots + locale + uiWorkspace',
  );
});
