#!/usr/bin/env node
/**
 * 真机冒烟：把 2026-11-19 的 rc.5 手工复核固化成一条命令。
 *
 * 判据（缺一不可）：
 *   H1 本机 `app.asar` 里的宿主版本 = `--host`（不给就比 `hosts.mjs` 的 `developmentHost`）
 *      —— 这条防「拿错宿主验」，不一致直接停，别让后面半天的读数作废；
 *   H2 `/api/dsh-skill-panel/health` 返回 `OK` 且 `complete: true`；
 *   H3 页面出现 `[data-skc-panel]`（面板真的挂载了，不是白屏）；
 *   H4 宿主「插件」页里本包卡片 `data-plugin-status` 不是 `disabled`
 *      （`inject` 与 `ctx.*` 对不上时整页 boot 失败、entry 被打成 disabled）；
 *   H5 控制台没有 error 级日志，尤其 `cannot get property … without inject`。
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

import { HOST_ASAR, readAsarJson } from './asar-read.mjs';
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

/**
 * 记一条判据。
 *
 * @param {string} id - 判据编号（H1–H5）。
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
  if (consoleErrors.length > 0) {
    console.log(`\n控制台 error 级日志（${consoleErrors.length} 条）：`);
    for (const line of consoleErrors.slice(0, 12)) console.log(`  ${line}`);
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

  /* H5 控制台 */
  const injectHits = consoleErrors.filter((line) => /without inject/i.test(line));
  judge('H5', '控制台无 error 级日志（尤其 without inject）', consoleErrors.length === 0, {
    count: consoleErrors.length,
    inject: injectHits,
    sample: consoleErrors.slice(0, 5),
  }, { count: 0 });

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
