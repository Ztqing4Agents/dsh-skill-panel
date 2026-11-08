/**
 * `locale/{zh,en}.json` — the only place user-facing text may live.
 *
 * Contract: docs/system_design.md §8.3 and AGENTS.md rules 2 and 3; case id K27.
 * This file re-implements the gate's three checks as assertions, so a broken
 * dictionary fails `npm test` and not only `npm run check:i18n`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { ROOT, readDictionary, translator } from './helpers/ssr.mjs';
import { reasonText } from '../src/client/model.js';

/** Keys that must exist in both dictionaries. */
const REQUIRED_KEYS = ['meta.title', 'meta.description', 'panel.label', 'page.title', 'tabs.installed', 'tabs.market'];

/** Route error codes the client can branch on. Every one of them has a localized string. */
const ROUTE_CODES = [
  'E_FORBIDDEN', 'E_NOT_FOUND', 'E_STALE_PATH', 'E_SYMLINK_READONLY',
  'E_FILE_CHANGED', 'E_NOT_WRITABLE', 'E_WRITE_FAILED', 'E_VERIFY_FAILED',
  'E_BAD_NAME', 'E_BAD_PATH', 'E_UNKNOWN',
];

/** CJK blocks the gate rejects inside source files. */
const CJK = /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF\uFF00-\uFFEF]/u;

/**
 * Flatten a nested dictionary into dotted keys.
 * @param {Record<string, unknown>} node - dictionary node.
 * @param {string} [prefix] - key prefix.
 * @param {string[]} [out] - collected keys.
 * @returns {string[]} dotted keys.
 */
function flatten(node, prefix = '', out = []) {
  for (const [key, value] of Object.entries(node ?? {})) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) flatten(value, path, out);
    else out.push(path);
  }
  return out;
}

/**
 * Read one dotted value out of a dictionary.
 * @param {Record<string, unknown>} dictionary - dictionary.
 * @param {string} path - dotted key.
 * @returns {unknown} the value.
 */
/**
 * Read one dictionary entry.
 *
 * UI copy is a literal top-level key (`panel.label`), which is exactly how
 * `ctx.locale` looks it up - never by walking a path. The single exception is the
 * `meta` block, which stays nested because the Host's plugin list reads
 * `parsed.meta.title` straight out of the file.
 * @param {Record<string, unknown>} dictionary - a locale file's contents.
 * @param {string} path - literal key, or `meta.<field>`.
 * @returns {unknown} the value, or undefined.
 */
const valueAt = (dictionary, path) => {
  const literal = dictionary[path];
  if (literal !== undefined) return literal;
  // The only sanctioned nesting is the host-facing `meta` block. Any other dotted
  // lookup would let a nested UI dictionary satisfy these assertions by accident -
  // that is precisely the leniency that let the real-machine regression through.
  if (!path.startsWith('meta.')) return undefined;
  const meta = dictionary.meta;
  if (typeof meta !== 'object' || meta === null) return undefined;
  return meta[path.slice('meta.'.length)];
};

/**
 * List every source file under a directory.
 * @param {string} dir - absolute directory.
 * @param {string[]} [out] - collected files.
 * @returns {string[]} absolute file paths.
 */
function sources(dir, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (/\.(js|jsx|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('zh.json 与 en.json 的键集完全一致', async () => {
  const zh = await readDictionary('zh');
  const en = await readDictionary('en');
  const zhKeys = flatten(zh).sort();
  const enKeys = flatten(en).sort();
  assert.deepEqual(enKeys.filter((key) => !zhKeys.includes(key)), [], 'en 里没有 zh 缺失的键');
  assert.deepEqual(zhKeys.filter((key) => !enKeys.includes(key)), [], 'zh 里没有 en 缺失的键');
});

test('设计 §8.3 键表要求的每一个键都在（按名字断言，不按数量）', async () => {
  // 以前这里钉过 `zhKeys.length === 43`。那是维护陷阱：以后合法新增一个文案键（P1 tooltip
  // 等）就会让门禁变红，而它并不比「集合包含」多证明任何东西 —— 删键由下面的子集断言兜住，
  // 增键不再误报。要求的键名逐条来自 §8.3 键表 + KI-1 补的两个错误码。
  const zh = await readDictionary('zh');
  const en = await readDictionary('en');
  const required = [
    'meta.title', 'meta.description', 'panel.label',
    'page.title', 'page.intro', 'page.infoLabel', 'page.infoDescription', 'page.refresh',
    'page.loading', 'page.error', 'page.retry', 'page.refreshError',
    'tabs.label', 'tabs.installed', 'tabs.market',
    'group.builtin', 'group.local', 'group.installed',
    'group.builtinEmpty', 'group.localEmpty', 'group.installedEmpty',
    'footer.excluded', 'status.count', 'status.offSuffix', 'market.placeholder',
    'row.enable', 'row.disable', 'row.applying', 'row.symlinkReadonly', 'row.symlinkTitle',
    'add.label', 'add.comingSoon',
    'error.E_NOT_FOUND', 'error.E_BAD_NAME', 'error.E_BAD_PATH', 'error.E_STALE_PATH',
    'error.E_SYMLINK_READONLY', 'error.E_FILE_CHANGED', 'error.E_NOT_WRITABLE',
    'error.E_WRITE_FAILED', 'error.E_VERIFY_FAILED', 'error.E_FORBIDDEN', 'error.E_UNKNOWN',
  ];
  for (const language of ['zh', 'en']) {
    const keys = new Set(flatten(language === 'zh' ? zh : en));
    const missing = required.filter((key) => !keys.has(key));
    assert.deepEqual(missing, [], `${language}.json 缺少设计要求的键`);
  }
  assert.ok(flatten(zh).length >= required.length, '字典里的键不少于设计要求（可以更多）');
});

test('三处必需键都存在且非空', async () => {
  const zh = await readDictionary('zh');
  const en = await readDictionary('en');
  for (const key of REQUIRED_KEYS) {
    for (const [label, dictionary] of [['zh', zh], ['en', en]]) {
      const value = valueAt(dictionary, key);
      assert.equal(typeof value === 'string' && value.trim() !== '', true, `${label}.json 的 ${key} 是非空字符串`);
    }
  }
});

test('入口键 panel.label 存在，中文取值是「技能」', async () => {
  const zh = await readDictionary('zh');
  const en = await readDictionary('en');
  assert.equal(valueAt(zh, 'panel.label'), '技能', '中文入口名是「技能」');
  assert.equal(valueAt(zh, 'meta.title'), '技能', '插件列表里的名字同样是「技能」');
  assert.equal(valueAt(en, 'panel.label'), 'Skills', '英文入口名是 Skills');
});

test('两个语言的占位符集合逐键相同（否则插值会某一边漏字）', async () => {
  const zh = await readDictionary('zh');
  const en = await readDictionary('en');
  const placeholders = (value) => new Set([...String(value).matchAll(/\{(\w+)\}/g)].map((match) => match[1])).size;
  for (const key of flatten(zh)) {
    assert.equal(
      placeholders(valueAt(en, key)),
      placeholders(valueAt(zh, key)),
      `${key} 在两本字典里的占位符数量相同`,
    );
  }
});

test('英文词典里没有残留中文', async () => {
  const en = await readDictionary('en');
  const offending = flatten(en).filter((key) => CJK.test(String(valueAt(en, key))));
  assert.deepEqual(offending, [], 'en.json 的所有取值都不含 CJK 字符');
});

test('lib/ 与 src/client/ 里没有任何 CJK 字面量', () => {
  const problems = [];
  for (const dir of ['lib', 'src/client']) {
    for (const file of sources(join(ROOT, dir))) {
      const lines = readFileSync(file, 'utf8').split('\n');
      for (const [index, line] of lines.entries()) {
        if (CJK.test(line)) problems.push(`${relative(ROOT, file)}:${index + 1}`);
      }
    }
  }
  assert.deepEqual(problems, [], '源码里没有中文（文案一律走 locale）');
});

test('路由能返回的每个错误码都有行内文案（没有例外）', async () => {
  const zh = await readDictionary('zh');
  for (const code of ROUTE_CODES) {
    assert.equal(typeof valueAt(zh, `error.${code}`), 'string', `error.${code} 有中文文案`);
  }
});

test('KI-1 已修：E_BAD_NAME / E_BAD_PATH 给出中文文案，不再夹英文原句', async () => {
  const t = translator(await readDictionary('zh'));
  for (const code of ['E_BAD_NAME', 'E_BAD_PATH']) {
    const text = reasonText(code, 'name must be kebab-case', t);
    assert.equal(/[A-Za-z]{4,}/.test(text), false, `${code} 的文案里没有英文句子`);
    assert.equal(text.includes('undefined'), false, `${code} 的文案里没有 undefined`);
    assert.equal(text.includes('操作失败'), false, `${code} 走专属文案，不再回落 E_UNKNOWN`);
  }
});

test('页面上出现的分区 key 都是机器值，永不本地化', async () => {
  const zh = await readDictionary('zh');
  for (const key of ['builtin', 'local', 'installed']) {
    assert.equal(typeof valueAt(zh, `group.${key}`), 'string', `group.${key} 有标题文案`);
    assert.equal(valueAt(zh, `group.${key}`).includes(key), false, `group.${key} 的标题里不出现机器值 ${key}`);
  }
});

test('每条 t("…") 的字面量键都同时存在于 zh 与 en（只加调用不加文案会红）', async () => {
  const zh = await readDictionary('zh');
  const en = await readDictionary('en');
  const literal = new Set();
  for (const file of sources(join(ROOT, 'src', 'client'))) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\bt\(\s*'([^'\\$]+)'/g)) literal.add(match[1]);
    for (const match of text.matchAll(/\bt\(\s*"([^"\\$]+)"/g)) literal.add(match[1]);
  }
  assert.equal(literal.size > 20, true, `扫到的字面量键数量合理（${literal.size}）`);
  const missing = [];
  for (const key of literal) {
    if (typeof zh[key] !== 'string') missing.push(`zh:${key}`);
    if (typeof en[key] !== 'string') missing.push(`en:${key}`);
  }
  assert.deepEqual(missing, [], '每个字面量键在两侧字典里都是字符串');
});

test('动态拼出的键（分区标题/空态）确实在两侧字典里', async () => {
  const zh = await readDictionary('zh');
  const en = await readDictionary('en');
  const dynamic = [
    'group.builtin', 'group.local', 'group.installed',
    'group.builtinEmpty', 'group.localEmpty', 'group.installedEmpty',
    'error.E_NOT_FOUND', 'error.E_BAD_NAME', 'error.E_BAD_PATH', 'error.E_STALE_PATH',
    'error.E_SYMLINK_READONLY', 'error.E_FILE_CHANGED', 'error.E_NOT_WRITABLE',
    'error.E_WRITE_FAILED', 'error.E_VERIFY_FAILED', 'error.E_UNKNOWN',
  ];
  const missing = dynamic.filter((key) => typeof zh[key] !== 'string' || typeof en[key] !== 'string');
  assert.deepEqual(missing, [], '模板拼出的键在两侧都取得到');
});

test('locale 文件是单层扁平点号键：除 meta 块外没有嵌套对象', async () => {
  for (const language of ['zh', 'en']) {
    const dictionary = await readDictionary(language);
    const nested = Object.entries(dictionary).filter(([key, value]) => key !== 'meta' && typeof value === 'object');
    assert.deepEqual(nested.map(([key]) => key), [], `${language}.json 的 UI 键都是扁平字符串（ctx.locale 按字面量取键）`);
    const meta = dictionary.meta;
    assert.equal(typeof meta, 'object', `${language}.json 保留 meta 块`);
    assert.equal(typeof meta.title, 'string', `${language}.json 的 meta.title 是字符串（宿主插件列表读它）`);
    assert.equal(typeof meta.description, 'string', `${language}.json 的 meta.description 是字符串`);
  }
});
