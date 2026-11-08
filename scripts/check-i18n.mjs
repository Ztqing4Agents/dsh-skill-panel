#!/usr/bin/env node
/**
 * The i18n gate. Three checks, one exit code.
 *
 *   1. 键集一致   - zh.json and en.json describe the same keys. A key that exists in
 *      one language only is a runtime "undefined" waiting for a user to find it.
 *   2. 入口键      - `meta.title` and `panel.label` exist and are non-empty in both.
 *      The sidebar entry's name is a locale value, not a code branch; these two keys
 *      are therefore the only legal way to rename it.
 *   3. 无 CJK 字面量 - no source file under `lib/` or `src/client/` may contain a CJK
 *      character. Copy that belongs in the interface belongs in the dictionaries.
 *
 * The check is deliberately mechanical: it never guesses, it prints the offending
 * file and line, and it fails the build.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Package root: this script lives one level down, in scripts/. */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Directories that must stay free of literals in any CJK block. */
const SCANNED_DIRS = ['lib', 'src'];

/** Keys that name the entry and must exist in every dictionary. */
const REQUIRED_KEYS = ['meta.title', 'meta.description', 'panel.label'];

/** Every CJK block: punctuation, kana, ext-A/ideographs, compatibility, fullwidth, hangul. */
const CJK = /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF\uFF00-\uFFEF]/u;

/** File extensions the literal scan looks at. */
const SOURCE_EXTENSIONS = ['.js', '.jsx', '.mjs'];

/** Collected failures, printed together. */
const problems = [];

/**
 * Read one dictionary.
 * @param {string} language - 'zh' or 'en'.
 * @returns {Record<string, unknown>} parsed dictionary.
 */
function readDictionary(language) {
  const file = join(ROOT, 'locale', `${language}.json`);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    problems.push(`locale/${language}.json is not readable JSON (${error instanceof Error ? error.message : error})`);
    return {};
  }
}

/**
 * Flatten a nested dictionary into dotted keys.
 * @param {Record<string, unknown>} value - dictionary node.
 * @param {string} [prefix] - key prefix.
 * @param {string[]} [out] - collected keys.
 * @returns {string[]} dotted keys.
 */
function flattenKeys(value, prefix = '', out = []) {
  for (const [key, child] of Object.entries(value ?? {})) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof child === 'object' && child !== null && !Array.isArray(child)) flattenKeys(child, path, out);
    else out.push(path);
  }
  return out;
}

/**
 * Resolve one entry: literal key first, then a nested path.
 *
 * UI copy is a literal top-level key because that is how `ctx.locale` reads it; the
 * nested path is only for the host-facing `meta` block.
 * @param {Record<string, unknown>} dictionary - dictionary.
 * @param {string} path - literal key, or `meta.<field>`.
 * @returns {unknown} the value, or undefined.
 */
function valueAt(dictionary, path) {
  const literal = dictionary[path];
  if (literal !== undefined) return literal;
  return path.split('.').reduce((node, part) => {
    if (typeof node !== 'object' || node === null) return undefined;
    return /** @type {Record<string, unknown>} */ (node)[part];
  }, /** @type {unknown} */ (dictionary));
}

/**
 * Walk a directory and return every source file.
 * @param {string} dir - absolute directory.
 * @param {string[]} [out] - collected files.
 * @returns {string[]} absolute file paths.
 */
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) out.push(full);
  }
  return out;
}

const zh = readDictionary('zh');
const en = readDictionary('en');
const zhKeys = new Set(flattenKeys(zh));
const enKeys = new Set(flattenKeys(en));
for (const key of zhKeys) {
  if (!enKeys.has(key)) problems.push(`en.json is missing "${key}"`);
}
for (const key of enKeys) {
  if (!zhKeys.has(key)) problems.push(`zh.json is missing "${key}"`);
}
/**
 * The file's shape, checked before its keys: `ctx.locale` looks a key up as a literal
 * property of the dictionary, so a nested object here renders as the raw key in the
 * GUI. `meta` is the one sanctioned nesting - it is host-facing metadata for the
 * plugin list, and it never reaches `t()`.
 */
for (const [language, dictionary] of [['zh', zh], ['en', en]]) {
  for (const [key, value] of Object.entries(dictionary)) {
    if (key === 'meta') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        problems.push(`${language}.json: "meta" must be an object`);
        continue;
      }
      for (const field of ['title', 'description']) {
        if (typeof value[field] !== 'string' || value[field].trim() === '') {
          problems.push(`${language}.json: "meta.${field}" must be a non-empty string`);
        }
      }
      continue;
    }
    if (typeof value !== 'string') {
      problems.push(`${language}.json: "${key}" is nested; UI keys must be flat dotted strings`);
    }
    if (!key.includes('.')) {
      problems.push(`${language}.json: "${key}" has no dot; UI keys are dotted, e.g. "panel.label"`);
    }
  }
}

for (const key of REQUIRED_KEYS) {
  for (const [language, dictionary] of [['zh', zh], ['en', en]]) {
    const value = valueAt(dictionary, key);
    if (typeof value !== 'string' || value.trim() === '') problems.push(`${language}.json needs a non-empty "${key}"`);
  }
}

for (const dir of SCANNED_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (const [index, line] of lines.entries()) {
      if (!CJK.test(line)) continue;
      problems.push(`${relative(ROOT, file)}:${index + 1} contains a CJK literal: ${line.trim().slice(0, 80)}`);
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`check-i18n: ${problem}`);
  process.exit(1);
}
console.log(`check-i18n: OK (${zhKeys.size} keys in both dictionaries; no CJK literals in ${SCANNED_DIRS.join(", ")})`);
