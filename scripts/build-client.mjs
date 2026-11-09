#!/usr/bin/env node
/**
 * Build `client.js` from `src/client/**`.
 *
 * The output is committed: this package is installed by `link:`, so there is no
 * install step that could build it, and the browser half has to be there when the
 * profile starts.
 *
 * Two properties matter more than speed:
 *   1. determinism - the same sources and the same esbuild version must produce the
 *      same bytes, or the committed bundle stops being reviewable. This script
 *      builds twice and refuses to write when the two differ.
 *   2. a readable shell - identifiers and function names survive (`minifyWhitespace`
 *      only drops layout, never names), so a browser stack trace still reads
 *      `MarketPanel` / `mergeBatches` instead of `a` / `b`. The per-module `// src/...`
 *      banner comments do not survive that pass, which is the price of a 93 KB artifact
 *      instead of a 126 KB one.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Package root: this script lives one level down, in scripts/. */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** The committed bundle. */
const OUTPUT = join(ROOT, 'client.js');

/** Specifiers the shell resolves at runtime; never inlined. */
const EXTERNAL = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/*',
  'zod',
  '@tanstack/react-virtual',
];

/**
 * Load esbuild, or explain why the build cannot run.
 * @returns {Promise<object>} the esbuild module.
 */
async function loadEsbuild() {
  try {
    return await import('esbuild');
  } catch {
    console.error('build-client: esbuild is not installed.');
    console.error('  The committed client.js still runs; only rebuilding needs esbuild.');
    console.error('  Install it with: npm install --no-save esbuild@0.25.0');
    process.exit(1);
  }
}

/**
 * Bundle the client half into the module-loader wrapper the shell expects.
 * @returns {Promise<string>} the bundle text.
 */
export async function buildClient() {
  const esbuild = await loadEsbuild();
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const result = await esbuild.build({
    absWorkingDir: ROOT,
    entryPoints: [join(ROOT, 'src', 'client', 'index.jsx')],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    external: EXTERNAL,
    loader: { '.json': 'json' },
    // Identifiers stay readable (a stack trace still names modules and functions); only
    // the layout is dropped. That is the difference between a 126 KB artifact and a 93 KB
    // one for the same source, and the committed bundle is shipped, not read.
    minify: false,
    minifyWhitespace: true,
    write: false,
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'error',
  });
  const body = result.outputFiles[0].text;
  return [
    'window.__ModuleLoader__.load({',
    `\tid: ${JSON.stringify(pkg.name)},`,
    '\tfactory: (require) => {',
    '\t\tvar module = { exports: {} };',
    '\t\tvar exports = module.exports;',
    body.replace(/\n$/, ''),
    '\t\treturn module.exports;',
    '\t}',
    '});',
    '',
  ].join('\n');
}

/**
 * Build twice and prove the two runs agree.
 * @returns {Promise<string>} the stable bundle text.
 */
async function buildStable() {
  const first = await buildClient();
  const second = await buildClient();
  if (first !== second) {
    console.error('build-client: two consecutive builds produced different bytes.');
    console.error('  A non-deterministic input (a clock, a path, an absolute filename) leaked in.');
    process.exit(1);
  }
  return first;
}

/**
 * Build and write the committed bundle.
 * @returns {Promise<void>} resolves when the file is on disk.
 */
async function main() {
  const text = await buildStable();
  writeFileSync(OUTPUT, text);
  console.log(`build-client: wrote client.js (${Buffer.byteLength(text)} bytes)`);
}

/** Run only when executed directly, so check-client can reuse the builder. */
const isMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await main();

/** The stable builder, shared with scripts/check-client.mjs. */
export { buildStable, OUTPUT, ROOT };
