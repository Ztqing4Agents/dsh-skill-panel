/**
 * The shipped bundle's runtime contract, asserted against `client.js` itself.
 *
 * Why this file exists: the node-side view tests bundle the sources themselves and
 * supply whatever they need, so they can pass while the *artifact* would fail in the
 * browser. The browser's `require` resolves only the eleven platform seed modules; an
 * import of anything else is `Cannot find module` at boot - the same blast radius as
 * the missing-`inject` incident (whole web boot, not one panel).
 *
 * Everything here reads `client.js` and `package.json` as files: no build, no bundle.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Package root. */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The module ids the browser's `require` can resolve inside a client bundle.
 *
 * Read out of the shipped host bundles (every `@deepseek-ai/dsh-client-ui-*` package in
 * `app.asar` requires exactly this scoped set), not guessed: scoping matters, because
 * `dsh-client-store` without the scope is a different, unresolvable specifier.
 */
const SEED_MODULES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]);

/**
 * Read the committed bundle.
 * @returns {Promise<string>} bundle text.
 */
const bundle = () => readFile(join(ROOT, 'client.js'), 'utf8');

test('产物只 require 平台 seed 模块（浏览器里其它模块一律解析不到）', async () => {
  const text = await bundle();
  const required = [...new Set([...text.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]))].sort();
  assert.equal(required.length > 0, true, '产物里确实有 require 调用（否则下面等于没测）');
  const outside = required.filter((id) => !SEED_MODULES.has(id));
  assert.deepEqual(outside, [], `产物没有 import 平台 seed 之外的模块（越界：${outside.join(', ')}）`);
});

test('产物是宿主认识的 __ModuleLoader__.load 形状，且 id 与包名一致', async () => {
  const text = await bundle();
  assert.equal(text.includes('window.__ModuleLoader__.load('), true, '产物由 __ModuleLoader__ 装载');
  assert.match(text, /id:\s*"dsh-skill-center"/, 'loader id 是包名');
  assert.match(text, /factory:\s*\(require\)\s*=>/, 'loader 收到一个 require 工厂');
  assert.equal(text.includes('dsh-skill-center/client.css'), true, '样式注入钩子随产物一起进包');
});

test('package.json 的客户端契约字段齐全', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.exports['./client'], './client.js', 'exports["./client"] 必须是字符串 "./client.js"');
  assert.equal(pkg.dsh.client.platform, 'web', 'dsh.client.platform 必须是 web');
  assert.equal(Array.isArray(pkg.dsh.client.inject), true, 'dsh.client.inject 是数组（预取依赖）');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml', 'bundle patch 指向包内 patch 文件');
  assert.equal(pkg.main, 'index.js', 'Host 半部入口是 index.js');
});

test('产物里不带 sourcemap 尾巴（D6：不生成）', async () => {
  const text = await bundle();
  assert.equal(text.includes('//# sourceMappingURL='), false, '产物没有 sourceMappingURL');
});

test('产物体积没有异常膨胀（防止误把依赖打进来）', async () => {
  const text = await bundle();
  const size = Buffer.byteLength(text);
  assert.equal(size > 40_000, true, `产物不小于 40 KB（实际 ${size} B，说明 ui 代码确实在里面）`);
  // The failure this catches is a lost `external`: bundling react/react-dom instead of
  // requiring them from the shell takes the same sources to ~190 KB (measured with the
  // committed build options), so a 150 KB ceiling still leaves ~40 KB of discriminator and
  // bills the mistake on the first build. It is a tripwire, not a design target: M10 raised
  // it from 120 KB when the real artifact reached 121147 B, U1 to 134 KB *after* slimming the
  // stylesheet comments, U1e to 138 KB for the host's bottom blocks, U2 to 142 KB for the
  // builtin provider blocks + provider page, and U2b to 145 KB when that page was rebuilt on
  // the skill detail's own component rows.
  //
  // 160 KB was the lead's call for U19 (update check + overwrite install): that feature is
  // ~10 KB of real client code (five faces, the version list, the dialog, the serial runner)
  // and the artifact reached 160597 B with nothing left to strip - esbuild emits no comments
  // and the code is reachable. U20 raised it once more, see below. Conditions stay the same
  // as before: the stylesheet keeps exactly one CSS comment (the K41 anchor), and any next
  // feature starts by reading `npm run build`'s byte count.
  // 180 KB is the lead's call for U20 (add / delete skill: one dialog module with two
  // components, the toolbar's chevron menu, the detail header's second action and the
  // delete confirmation). Measured after the U20 follow-up round (menu alignment, the
  // uninstall dialog's own fact label, the two-stage status slot, and the market tab
  // dropping the header toolbar, dropping the dead `marketReload` action, U21's GitHub add,
  // then U22's two-row add menu and its ArrowDown handler: **177498 B** (was 160041 B
  // before U20), i.e. ~2502 B of
  // headroom left. U22 raised the ceiling from 175000 on the user's say-so, because the
  // host-parity menu (two rows with icons and hint lines) does not fit under the old one. The discriminator is unchanged:
  // bundling react/react-dom instead of requiring them from the shell still lands near
  // 190 KB, so ~19 KB of the ceiling separates a correct build from that mistake.
  assert.equal(size < 180_000, true, `产物不超过 180 KB（实际 ${size} B，说明没有把 react 之类打进来）`);
});
