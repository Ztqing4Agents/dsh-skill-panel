#!/usr/bin/env node
/**
 * The client-half gate: the committed bundle must be exactly what the sources build.
 *
 * Answers three questions, each one a way this package has to stay installable:
 *   1. 产物一致 - rebuild and compare byte for byte, so "edited the source, forgot
 *      to build" fails here instead of in a browser.
 *   2. 装载形状 - the bundle registers itself under the package name, which is what
 *      the shell's module loader looks for.
 *   3. 导出口   - `exports["./client"]` is a string pointing at the file, which is
 *      the contract `clientExportOf()` reads.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildStable, OUTPUT, ROOT } from './build-client.mjs';

/** Collected failures, printed together. */
const problems = [];

/** Build the expected bundle and compare it with the committed file. */
const expected = await buildStable();
let committed;
try {
  committed = readFileSync(OUTPUT, 'utf8');
} catch {
  console.error('check-client: client.js is missing. Run `npm run build` first.');
  process.exit(1);
}
if (committed !== expected) {
  const committedLines = committed.split('\n').length;
  const expectedLines = expected.split('\n').length;
  problems.push(
    `client.js does not match the sources (${committedLines} lines committed, ${expectedLines} built).`
    + ' Run `npm run build`.',
  );
}

/** The bundle must register itself under the package name. */
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
if (!committed.includes('__ModuleLoader__.load({')) {
  problems.push('client.js does not call __ModuleLoader__.load({ ... }).');
}
if (!committed.includes(`id: ${JSON.stringify(pkg.name)},`)) {
  problems.push(`client.js does not register itself under id ${JSON.stringify(pkg.name)}.`);
}

/** The client export must stay a string, or the host cannot find the bundle. */
const clientExport = pkg.exports?.['./client'];
if (clientExport !== './client.js') {
  problems.push(`package.json exports["./client"] must be "./client.js", found ${JSON.stringify(clientExport)}.`);
}
if (pkg.dsh?.client?.platform !== 'web') {
  problems.push('package.json dsh.client.platform must be "web".');
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`check-client: ${problem}`);
  process.exit(1);
}
console.log(`check-client: OK (${Buffer.byteLength(committed)} bytes, matches src/client/**)`);
