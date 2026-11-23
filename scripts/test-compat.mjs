#!/usr/bin/env node
/**
 * 真机冒烟：把 2026-11-19 的 rc.5 手工复核固化成一条命令，0.2.3 起扩到七条判据。
 *
 * 判据（缺一不可）：
 *   H1 本机 `app.asar` 里的宿主版本 = `--host`（不给就比 `hosts.mjs` 的 `developmentHost`）
 *      —— 这条防「拿错宿主验」，不一致直接停，别让后面半天的读数作废；
 *   H2 `/api/dsh-skill-panel/health` 返回 `OK` 且 `complete: true`；
 *   H3 页面出现 `[data-skc-panel]`（面板真的挂载了，不是白屏）；
 *   H4 宿主「插件」页里本包卡片 `data-plugin-status` 不是 `disabled`
 *      （`inject` 与 `ctx.*` 对不上时整页 boot 失败、entry 被打成 disabled）；
 *   H5 控制台没有 error 级日志，且四条「模块表出事」的负判据原文一条都别出现：
 *      `cannot get property "…" without inject`（读到未声明的服务）、
 *      `client-modules: require("…") missed the module table`（同步 require 落空）、
 *      `client-modules: cannot resolve "…"`（动态 import 落空）、
 *      `loaded without registering "…" via __ModuleLoader__.load`（产物没注册自己）；
 *   H6 shell 的静态种子表仍有 11 项、且含 `@deepseek-ai/dsh-client-ui-primitives`
 *      —— 宿主自 0.2.3 起把 primitives 静态链接进 shell（包目录已不存在），
 *      它一掉项我们就是整页白屏；这条比等真机白屏便宜，也解释得清「目录没了不等于模块没了」；
 *   H7 十六条路由在**无凭据**下仍可达：宿主自 0.2.3 起把缺省的 `auth` 当 `required`，
 *      没有 Peer 就由鉴权层回 401（宿主没有任何鉴权提供方时 503）；这里逐条发一个
 *      「只读要 200、写路由必然 4xx」的请求并带 `credentials: 'omit'`，要求状态码不是
 *      401 / 403 / 503 —— 写路由用必然被拒的坏参数（空 body / 非法枚举）判「不是被鉴权层
 *      挡的」，不写盘、不联网。
 *
 * 隔离：自建 `DSH_HOME`（`mkdtemp`）+ 一个只装本包的 profile（`node_modules/<包名>` 软链到仓库根），
 * 用宿主自带的 `dsh web --no-open --port 0` 起实例，从 stdout 取带 token 的 URL。
 * **绝不触碰真实 `~/.dsh`，也不连正在运行的 GUI**（端口由系统分配，永远取 0 号端口的实际值）。
 *
 * 收尾：实例与浏览器都以 `detached` 起、按**进程组**杀；临时目录无论成败都删。
 * Ctrl-C / `kill -TERM` 也走同一套收尾（幂等），收尾完以 130 / 143 退出，
 * 不留孤儿进程、不留临时目录；`--keep` 只保留隔离目录（实例与浏览器照杀）。
 *
 * 退出码：0 全绿；1 判据失败或参数错误；2 环境缺件（缺 Chrome / 缺宿主，打印「跳过」并说明怎么补）；
 *        130 / 143 被 SIGINT / SIGTERM 中断。
 *
 * 用法：node scripts/test-compat.mjs [--host <version>] [--keep]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HOST_ASAR, listAsarEntries, readAsarFile, readAsarJson } from './asar-read.mjs';
import { CHROME, killTree, launch } from './cdp.mjs';
import { developmentHost, supportedHosts } from './hosts.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/* ------------------------------------------------------------------ 参数（严格） */

const USAGE = [
  '用法：node scripts/test-compat.mjs [--host <version>] [--keep]',
  `  --host <version>  要验的宿主版本，必须是 supportedHosts 之一（默认 ${developmentHost}）`,
  '  --keep            保留隔离用的临时 DSH_HOME 并打印路径（实例与浏览器照杀）',
  `可用宿主：${supportedHosts.join('、')}`,
].join('\n');

/**
 * 参数不对就立刻停下并打印用法：绝不静默回退到默认值，否则「拼错的参数」会变成
 * 一次看似通过的 13 秒验收。
 *
 * @param {string} message - 哪里不对。
 * @returns {never} 总是退出（exit 1）。
 */
function usageError(message) {
  console.error(`test-compat: ${message}`);
  console.error('');
  console.error(USAGE);
  process.exit(1);
}

const argv = process.argv.slice(2);
let hostArg;
let KEEP = false;
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === '--keep') {
    KEEP = true;
    continue;
  }
  if (arg === '--host') {
    const value = argv[index + 1];
    if (value === undefined || value === '' || value.startsWith('--')) {
      usageError('--host 后面要跟一个宿主版本');
    }
    hostArg = value;
    index += 1;
    continue;
  }
  usageError(`未知参数 ${JSON.stringify(arg)}`);
}
if (hostArg !== undefined && !supportedHosts.includes(hostArg)) {
  usageError(`--host ${hostArg} 不在 supportedHosts 里`);
}
const declaredHost = hostArg ?? developmentHost;

/* --------------------------------------------------- 环境（缺件走独立分支：跳过） */

const APP_BIN = process.env.DSH_APP_BIN ?? '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness';
const DSH_BIN = `${HOST_ASAR}/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js`;
/** 隔离 profile 必须挂的宿主基础包，与真机复核用的 profile 一致。 */
const BASE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];
const pkgName = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name;

/** H6 要读的 shell 产物所在的 asar 目录（`index-<hash>.js` 是 shell 本体）。 */
const SHELL_DIR = 'dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/';

/**
 * H6 的期望值：宿主 shell 里 `staticModules` 返回的 11 项平台种子模块。
 *
 * 与 `test/bundle-contract.test.mjs` 的 `SEED_MODULES` 逐项相同——那边守「产物只 require 这些」，
 * 这边守「宿主真的还提供这些」。两处各存一份是故意的：一边读不到对方的存在理由（一个是产物契约、
 * 一个是宿主读数），改一处就得同时改另一处，改漏了这边会红着说话。
 */
const SEED_MODULES = Object.freeze([
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
 * 从 shell 产物里取出静态种子表的条目名。
 *
 * 不认标识符名（`UV` 这类压缩名每次构建都换），只顺着「`staticModules:` 后面那个零参调用」
 * 找到它的定义，再读 `Object.values({…})` 的对象字面量：取不到的键名一律按「形状变了」处理，
 * 让判据红着说话，而不是静默当成「没有种子表」。
 *
 * @param {string} text - shell 产物全文。
 * @returns {string[]|null} 条目名，顺序即登记顺序；定位失败返回 `null`。
 */
function seedModulesOf(text) {
  const callAt = text.indexOf('staticModules:');
  if (callAt < 0) return null;
  const ref = /staticModules:\s*([A-Za-z_$][\w$]*)\s*\(\s*\)/.exec(text.slice(callAt, callAt + 200));
  if (ref === null) return null;
  const marker = `function ${ref[1]}(){return Object.values({`;
  const at = text.indexOf(marker);
  if (at < 0) return null;
  const bodyAt = at + marker.length;
  const endAt = text.indexOf('})}', bodyAt);
  const body = text.slice(bodyAt, endAt < 0 ? bodyAt + 4096 : endAt);
  const ids = [];
  for (const match of body.matchAll(/(?:"([^"]+)"|([A-Za-z_$][\w$]*)):\s*(?:Ji|e1)\(/g)) {
    ids.push(match[1] ?? match[2]);
    if (ids.length > SEED_MODULES.length) break;
  }
  return ids;
}

/**
 * H5 的负判据原文：这几句出现即「模块表 / 服务声明出问题」，逐条列出好定位。
 * 第一句来自 shell 的 `ctx` 严格代理，后三句来自宿主 `dsh-client-modules` 的 throw 文本。
 */
const NEGATIVE_PATTERNS = Object.freeze([
  { id: 'inject', text: 'cannot get property', hint: '读到 inject 未声明的服务（整页 boot 会失败）' },
  { id: 'module-table', text: 'missed the module table', hint: '同步 require 没落在静态种子表里' },
  { id: 'resolve', text: 'cannot resolve', hint: '动态 import 解析不到模块' },
  { id: 'registering', text: 'loaded without registering', hint: '产物执行了却没注册自己的模块行' },
]);

/**
 * H7 的十六条探针：每条都是「只读要 200、写路由必然 4xx」的请求，且不写盘、不联网。
 *
 * 写路由一律发空 body：它们在读到第一个字段时就返回 `400`，永远走不到落盘；只读路由挑
 * 不需要上游的那些（`list` / `health` / `market/installed`），其余带一个非法枚举值让它
 * 在参数白名单处就停。`expected` 是「这条路由自己给出的答案」，不是鉴权层给出的。
 */
const ANONYMOUS_PROBES = Object.freeze([
  { route: 'list', method: 'GET', path: '/api/dsh-skill-panel/list', expected: 200 },
  { route: 'toggle', method: 'POST', path: '/api/dsh-skill-panel/toggle', body: {}, expected: 400 },
  { route: 'providerToggle', method: 'POST', path: '/api/dsh-skill-panel/provider-toggle', body: {}, expected: 400 },
  { route: 'health', method: 'GET', path: '/api/dsh-skill-panel/health', expected: 200 },
  { route: 'detail', method: 'GET', path: '/api/dsh-skill-panel/detail?name=NOT_A_NAME', expected: 400 },
  { route: 'marketBootstrap', method: 'GET', path: '/api/dsh-skill-panel/market/bootstrap?source=bogus', expected: 400 },
  { route: 'marketList', method: 'GET', path: '/api/dsh-skill-panel/market/list?sort=bogus', expected: 400 },
  { route: 'marketDetail', method: 'GET', path: '/api/dsh-skill-panel/market/detail?source=all&owner=x&slug=y', expected: 400 },
  { route: 'marketInstalled', method: 'GET', path: '/api/dsh-skill-panel/market/installed', expected: 200 },
  { route: 'marketInstall', method: 'POST', path: '/api/dsh-skill-panel/market/install', body: {}, expected: 400 },
  { route: 'marketVersions', method: 'GET', path: '/api/dsh-skill-panel/market/versions?source=all&owner=x&slug=y', expected: 400 },
  { route: 'marketUpdate', method: 'POST', path: '/api/dsh-skill-panel/market/update', body: {}, expected: 400 },
  { route: 'marketIcons', method: 'POST', path: '/api/dsh-skill-panel/market/icons', body: {}, expected: 400 },
  { route: 'marketFavorite', method: 'POST', path: '/api/dsh-skill-panel/market/favorite', body: {}, expected: 400 },
  { route: 'add', method: 'POST', path: '/api/dsh-skill-panel/add', body: {}, expected: 400 },
  { route: 'remove', method: 'POST', path: '/api/dsh-skill-panel/remove', body: {}, expected: 400 },
]);

/**
 * 环境缺件：这不是「判据没通过」，单独一条分支，打印「跳过」并 exit 2，不混进 N/M 的计数。
 *
 * @param {string} what - 缺什么。
 * @param {string} detail - 具体路径 / 现象。
 * @param {string} howTo - 怎么补。
 * @returns {never} 总是退出（exit 2）。
 */
function missingEnvironment(what, detail, howTo) {
  console.error(`test-compat: 跳过——${what}`);
  console.error(`  ${detail}`);
  console.error(`  ${howTo}`);
  process.exit(2);
}

if (typeof WebSocket !== 'function') {
  missingEnvironment('这个 Node 没有全局 WebSocket', `node ${process.version}`, '用 Node 22+ 跑本脚本（CDP 走内置 WebSocket）');
}
if (!existsSync(APP_BIN)) {
  missingEnvironment('未找到宿主可执行文件', `路径：${APP_BIN}`, '装 DeepSeek Harness 桌面端，或用 DSH_APP_BIN 指向它的可执行文件');
}
const manifest = readAsarJson(HOST_ASAR, 'dsh/package.json');
if (manifest === null || typeof manifest.version !== 'string') {
  missingEnvironment('读不到宿主 asar 里的 dsh/package.json', `路径：${HOST_ASAR}`, '确认宿主装完整，或用 DSH_APP_ASAR 指向它的 app.asar');
}
if (!existsSync(CHROME)) {
  missingEnvironment('未找到 Chrome', `路径：${CHROME}`, '装 Google Chrome，或用 CHROME_BIN 指向它的可执行文件');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** 只留最后若干行，避免把宿主的整段启动日志倒进终端。 */
const tail = (text, lines = 20) => text.split('\n').filter((line) => line.trim() !== '').slice(-lines).join('\n');

/* --------------------------------------------------------------- 判据收集 */

const results = [];
const consoleErrors = [];
/** H7 开始前记下的条数：它之后进来的 4xx 网络日志是探针自己故意打出来的，不该混进 H5 的读数与报表。 */
let probeNoiseFrom = null;

/**
 * 记一条判据。
 *
 * @param {string} id - 判据编号（H1–H7）。
 * @param {string} name - 判据内容。
 * @param {boolean} ok - 是否通过。
 * @param {unknown} actual - 实测值。
 * @param {unknown} expected - 期望值。
 * @returns {boolean} 是否通过。
 */
const judge = (id, name, ok, actual, expected) => {
  results.push({ id, name, ok: ok === true, actual, expected });
  return ok === true;
};

/** 打印判据清单与结论。 */
function report() {
  console.log('\n=== 真机冒烟判据 ===');
  for (const result of results) {
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.id} ${result.name}`);
    if (!result.ok) {
      console.log(`  actual=${JSON.stringify(result.actual).slice(0, 800)}`);
      console.log(`  expected=${JSON.stringify(result.expected)}`);
    }
  }
  const passed = results.filter((result) => result.ok).length;
  console.log(`\n${passed}/${results.length} 通过`);
  const own = probeNoiseFrom === null ? consoleErrors : consoleErrors.slice(0, probeNoiseFrom);
  const noise = probeNoiseFrom === null ? 0 : consoleErrors.length - probeNoiseFrom;
  if (own.length > 0) {
    console.log(`\n控制台 error 级日志（${own.length} 条）：`);
    for (const line of own.slice(0, 12)) console.log(`  ${line}`);
  }
  if (noise > 0) {
    console.log(`\n另有 ${noise} 条 4xx 网络日志来自 H7 的无凭据探针（预期内，不是回归）。`);
  }
}

/* ---------------------------------------------------------- H1 宿主版本 */

const hostVersion = manifest.version;
console.log(`test-compat: 宿主 ${hostVersion}（${HOST_ASAR}）`);
if (!judge('H1', `本机宿主 = 声明的开发基线 ${declaredHost}`, hostVersion === declaredHost, hostVersion, declaredHost)) {
  console.error(`test-compat: 本机宿主 ${hostVersion}，声明的开发基线 ${declaredHost}`);
  console.error('  要么把宿主升/降到你声明的那一版，要么用 --host 显式说明这次验的是哪一版。');
  report();
  process.exit(1);
}

/* ------------------------------------------------ H6 shell 静态种子表 */

const shellNames = listAsarEntries(HOST_ASAR)
  .filter((path) => path.startsWith(SHELL_DIR) && /^index-[^/]+\.js$/.test(path.slice(SHELL_DIR.length)));
const shellName = shellNames.length === 1 ? shellNames[0] : null;
const shellText = shellName === null ? null : readAsarFile(HOST_ASAR, shellName)?.toString('utf8') ?? null;
const seedIds = shellText === null ? null : seedModulesOf(shellText);
const missingSeeds = seedIds === null ? SEED_MODULES : SEED_MODULES.filter((id) => !seedIds.includes(id));
judge('H6', 'shell 静态种子表仍是 11 项且含 @deepseek-ai/dsh-client-ui-primitives',
  shellName !== null && seedIds !== null && seedIds.length === SEED_MODULES.length && missingSeeds.length === 0,
  {
    shell: shellName ?? `期望恰好一份 ${SHELL_DIR}index-<hash>.js，实际 ${shellNames.length} 份`,
    seeds: seedIds,
    missing: missingSeeds,
  },
  { seeds: SEED_MODULES });

/* --------------------------------------------------------- 隔离环境与实例 */

let host = null;
let browser = null;
let home = null;

/** 收尾只跑一次；信号与正常路径共用同一个 promise，重复触发不会报错。 */
let teardownStarted = null;

/**
 * 收尾：关浏览器（按进程组）、杀宿主实例（按进程组）、删临时目录。
 *
 * @returns {Promise<void>} 收尾完成。
 */
function teardown() {
  if (teardownStarted === null) teardownStarted = runTeardown();
  return teardownStarted;
}

/** teardown 的实现体；每一步都吞掉自己的错误，保证后面的清理照跑。 */
async function runTeardown() {
  if (browser !== null) {
    const current = browser;
    browser = null;
    try {
      await current.close();
    } catch {
      // 浏览器已经没了；进程清理交给 killTree。
    }
  }
  if (host !== null) {
    const current = host;
    host = null;
    try {
      killTree(current.child);
    } catch {
      // 已退出。
    }
  }
  await sleep(400);
  if (home !== null) {
    const current = home;
    home = null;
    if (KEEP) {
      console.log(`test-compat: --keep 保留了隔离目录 ${current}`);
    } else {
      try {
        rmSync(current, { recursive: true, force: true });
      } catch (error) {
        console.error(`test-compat: 删临时目录失败 ${current}：${error.message}`);
      }
    }
  }
}

/** Ctrl-C / kill 也必须收干净：否则端口还听着、临时目录还在（这就是上一代脚本的坑）。 */
let interrupted = false;
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.on(signal, () => {
    if (interrupted) {
      // 已在收尾：再按一次不再重入（重入会把没收完的删目录打断），等它跑完即可。
      console.error(`test-compat: 已在收尾，等它跑完（再按也不会更快）`);
      return;
    }
    interrupted = true;
    console.error(`\ntest-compat: 收到 ${signal}，正在收尾（杀实例 / 关浏览器 / 删临时目录）`);
    teardown().finally(() => process.exit(code));
  });
}

/**
 * 建一个只装本包的隔离 DSH_HOME。
 *
 * @returns {{home: string, profile: string}} 隔离目录与 profile 目录。
 */
function provisionHome() {
  const created = mkdtempSync(join(tmpdir(), 'skc-compat-'));
  const profile = join(created, 'profiles', 'web');
  const modules = join(profile, 'node_modules');
  const scopeDir = join(modules, ...pkgName.split('/').slice(0, -1));
  mkdirSync(scopeDir, { recursive: true });
  symlinkSync(ROOT, join(modules, pkgName));
  writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-web',
    private: true,
    dependencies: { [pkgName]: `link:${ROOT}` },
    dsh: { profile: { bundles: [...BASE_BUNDLES, pkgName] } },
  }, null, 2)}\n`);
  mkdirSync(join(created, 'skills'), { recursive: true });
  return { home: created, profile };
}

/**
 * 起宿主实例（`web --no-open --port 0`）。`detached` 让它自成进程组，收尾时整组杀掉。
 *
 * @param {string} homeDir - 隔离的 `DSH_HOME`。
 * @returns {{child: import('node:child_process').ChildProcess, output: () => string}} 进程与输出读取器。
 */
function startHost(homeDir) {
  const child = spawn(APP_BIN, [DSH_BIN, 'web', '--no-open', '--port', '0'], {
    env: { ...process.env, DSH_HOME: homeDir, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  return { child, output: () => output };
}

/**
 * 等宿主打印出带 token 的访问地址。
 *
 * @param {{child: object, output: () => string}} instance - 宿主实例。
 * @returns {Promise<{base: string, token: string}>} 基地址与 token。
 */
async function waitForUrl(instance) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const match = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]+)/.exec(instance.output());
    if (match !== null) return { base: `http://127.0.0.1:${match[1]}`, token: match[2] };
    if (instance.child.exitCode !== null) {
      throw new Error(`宿主进程提前退出（code ${instance.child.exitCode}）：\n${tail(instance.output())}`);
    }
    await sleep(400);
  }
  throw new Error(`宿主 60 秒内没有打印访问地址：\n${tail(instance.output())}`);
}

/**
 * 按可见文本点一个按钮（宿主界面没有稳定 id，只能按文案找，与真机复核的写法一致）。
 *
 * @param {object} page - CDP 客户端。
 * @param {string} label - 可见文案。
 * @returns {Promise<string>} `clicked` / `no-label`。
 */
async function clickText(page, label) {
  return page.evaluate(`(() => {
    const leaf = [...document.querySelectorAll('*')].filter((element) => (element.innerText || '').trim() === ${JSON.stringify(label)} && element.children.length === 0);
    if (leaf.length === 0) return 'no-label';
    const element = leaf.find((candidate) => candidate.offsetParent !== null) ?? leaf[0];
    let target = element;
    for (let step = 0; step < 5 && target.parentElement !== null; step += 1) {
      const role = target.getAttribute('role');
      if (target.tagName === 'BUTTON' || target.tagName === 'A' || role === 'button' || role === 'menuitem' || role === 'tab') break;
      target = target.parentElement;
    }
    target.click();
    return 'clicked';
  })()`);
}

/* -------------------------------------------------------------------- 主流程 */

let exitCode = 0;

try {
  const provisioned = provisionHome();
  home = provisioned.home;
  console.log(`test-compat: DSH_HOME=${home}`);

  host = startHost(home);
  const { base, token } = await waitForUrl(host);
  console.log(`test-compat: 实例 ${base}`);

  browser = await launch({ width: 1440, height: 920 });
  browser.on('Runtime.consoleAPICalled', (params) => {
    if (params.type !== 'error') return;
    const text = params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ');
    consoleErrors.push(`[console.error] ${String(text).slice(0, 400)}`);
  });
  browser.on('Runtime.exceptionThrown', (params) => {
    const text = params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text;
    consoleErrors.push(`[exception] ${String(text).slice(0, 400)}`);
  });
  browser.on('Log.entryAdded', (params) => {
    if (params.entry.level === 'error') consoleErrors.push(`[log.error] ${params.entry.text.slice(0, 300)}`);
  });
  await browser.send('Log.enable');

  await browser.goto(`${base}/?token=${token}`);
  await sleep(7000);
  // 登录 / 预览弹窗必须真的点掉：留着它整页被遮罩压灰，后面按文案找按钮会全落空。
  await clickText(browser, '继续');
  await sleep(1000);
  await browser.evaluate(`(() => {
    const dialog = [...document.querySelectorAll('*')].find((element) => (element.innerText || '').trim().startsWith('开始使用') && element.querySelector('button') !== null);
    if (dialog === undefined) return 'none';
    const button = [...dialog.querySelectorAll('button')].find((candidate) => /关闭|close/i.test(candidate.getAttribute('aria-label') ?? ''))
      ?? [...dialog.querySelectorAll('button')].find((candidate) => (candidate.innerText || '').trim() === '');
    button?.click();
    return 'closed';
  })()`);
  await sleep(1500);

  /* H2 health：同源 fetch，走的是插件自己的路由与围栏 */
  const health = await browser.evaluate(`fetch('api/dsh-skill-panel/health')
    .then((response) => response.json())
    .then((body) => ({ code: body.code, complete: body.data?.complete, version: body.data?.version }))`);
  judge('H2', 'health 路由 code=OK 且 complete=true', health?.code === 'OK' && health?.complete === true, health, { code: 'OK', complete: true });

  /* H3 面板挂载 */
  await clickText(browser, '技能');
  const panelReady = await browser.waitFor(`document.querySelector('[data-skc-panel]') !== null`, { timeoutMs: 30000 });
  const panel = await browser.evaluate(`(() => ({
    found: document.querySelector('[data-skc-panel]') !== null,
    nodes: document.querySelectorAll('[class*=skc_]').length,
  }))()`);
  judge('H3', '面板挂载：页面出现 [data-skc-panel]', panelReady === true && panel.found === true, panel, { found: true });

  /* H4 宿主插件卡片未被 disabled */
  await clickText(browser, '插件');
  const cardReady = await browser.waitFor(`document.querySelector('[data-plugin-package="${pkgName}"]') !== null`, { timeoutMs: 30000 });
  const card = await browser.evaluate(`(() => {
    const element = document.querySelector('[data-plugin-package="${pkgName}"]');
    if (element === null) return null;
    return {
      status: element.getAttribute('data-plugin-status'),
      title: (element.querySelector('button')?.innerText ?? '').trim().split('\\n')[0],
    };
  })()`);
  judge('H4', '宿主插件卡片 data-plugin-status 不是 disabled',
    cardReady === true && typeof card?.status === 'string' && card.status !== 'disabled', card, { status: 'running（不是 disabled）' });

  /* H5 控制台：任一 error 级日志即红，另把四条「模块表出事」的原文单独列出来 */
  const negativeHits = NEGATIVE_PATTERNS
    .map((pattern) => ({
      id: pattern.id,
      hint: pattern.hint,
      lines: consoleErrors.filter((line) => line.toLowerCase().includes(pattern.text.toLowerCase())),
    }))
    .filter((hit) => hit.lines.length > 0);
  judge('H5', '控制台无 error 级日志（without inject / missed the module table / cannot resolve / loaded without registering）',
    consoleErrors.length === 0, {
      count: consoleErrors.length,
      negative: negativeHits,
      sample: consoleErrors.slice(0, 5),
    }, { count: 0 });

  /* H7 十六条路由在无凭据下仍可达（不带 cookie，所以 required 会回 401） */
  probeNoiseFrom = consoleErrors.length;
  const probes = await browser.evaluate(`(async () => {
    const probes = ${JSON.stringify(ANONYMOUS_PROBES.map(({ route, method, path, body }) => ({ route, method, path, body })))};
    const answers = [];
    for (const probe of probes) {
      try {
        const init = { method: probe.method, credentials: 'omit' };
        if (probe.body !== undefined) {
          init.headers = { 'content-type': 'application/json' };
          init.body = JSON.stringify(probe.body);
        }
        const response = await fetch(probe.path, init);
        let code = null;
        try {
          code = (await response.json())?.code ?? null;
        } catch {
          code = null;
        }
        answers.push({ route: probe.route, status: response.status, code });
      } catch (error) {
        answers.push({ route: probe.route, status: -1, code: String(error) });
      }
    }
    return answers;
  })()`);
  const authBlocked = probes.filter((answer) => answer.status === 401 || answer.status === 403 || answer.status === 503);
  const wrongStatus = probes.filter((answer, index) => {
    const { expected } = ANONYMOUS_PROBES[index];
    return expected === 200 ? answer.status !== 200 : !(answer.status >= 400 && answer.status < 500);
  });
  const brokenEnvelope = probes.filter((answer) => typeof answer.code !== 'string'
    || (answer.code !== 'OK' && !answer.code.startsWith('E_')));
  judge('H7', '十六条路由在无凭据（auth: anonymous）下逐条可达：只读 200、写路由 4xx，没有 401/403/503',
    probes.length === ANONYMOUS_PROBES.length && authBlocked.length === 0
      && wrongStatus.length === 0 && brokenEnvelope.length === 0,
    {
      blocked: authBlocked,
      wrongStatus: wrongStatus.map((answer) => ({
        route: answer.route,
        status: answer.status,
        expected: ANONYMOUS_PROBES.find((probe) => probe.route === answer.route)?.expected,
      })),
      envelope: brokenEnvelope,
      answers: probes,
    },
    { routes: ANONYMOUS_PROBES.length, blocked: 0 });

  report();
  exitCode = results.every((result) => result.ok) ? 0 : 1;
} catch (error) {
  console.error(`test-compat: 中断 —— ${error.message}`);
  report();
  exitCode = 1;
} finally {
  await teardown();
}

process.exit(exitCode);
