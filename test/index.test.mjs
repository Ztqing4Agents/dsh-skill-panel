/**
 * `index.js` — the host entry: config resolution, one-shot apply, route registration.
 *
 * Contract: docs/contracts/architecture.md §2.1, docs/contracts/flows.md §4.4 (initialisation) and docs/contracts/routes.md §3.3 (routes).
 *
 * `apply` carries a module-level one-shot guard (registering an exact route twice
 * throws and would take the boot down), so the first `apply` in this process is the
 * one that matters - the cases below run in file order on purpose.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { apply, inject, name } from '../index.js';
import { ROUTES } from '../lib/routes.js';
import { LOOPBACK_HEADERS, callRoute } from './helpers/http.mjs';
import { customTree, skillFile } from './helpers/tree.mjs';

const exec = promisify(execFile);

/**
 * A host context that records what the plugin does to it.
 * @returns {{ctx: object, registrations: object[], cleanups: Function[]}} the fake context.
 */
function fakeContext() {
  const registrations = [];
  const cleanups = [];
  const ctx = {
    logger: { warn: () => {} },
    webServer: {
      register: (route) => {
        registrations.push(route);
        return () => {};
      },
    },
    skills: undefined,
    sessions: undefined,
    effect: (callback) => {
      const dispose = callback();
      cleanups.push(dispose);
      return () => {};
    },
  };
  return { ctx, registrations, cleanups };
}

test('插件自报的名字与必需服务与设计一致', () => {
  assert.equal(name, 'dsh-skill-center', '插件名就是包名');
  assert.deepEqual(inject, ['webServer', 'skills', 'sessions'], '必需服务是 webServer/skills/sessions');
});

test('首次 apply 注册十三条路由，且扫描的是 config 指定的目录', async () => {
  const tree = await customTree({ 'configured-skill': skillFile({ name: 'configured-skill' }) });
  try {
    const { ctx, registrations, cleanups } = fakeContext();
    apply(ctx, { dshHome: tree.dshHome, skillsRoot: tree.skillsRoot });
    assert.equal(registrations.length, 13, '一次 apply 注册十三条路由（本地面 4 + 市场面 9）');
    assert.deepEqual(registrations.map((route) => route.path).sort(), [
      '/api/dsh-skill-center/health',
      '/api/dsh-skill-center/list',
      '/api/dsh-skill-center/market/bootstrap',
      '/api/dsh-skill-center/market/clawhub-icon',
      '/api/dsh-skill-center/market/detail',
      '/api/dsh-skill-center/market/favorite',
      '/api/dsh-skill-center/market/icons',
      '/api/dsh-skill-center/market/install',
      '/api/dsh-skill-center/market/installed',
      '/api/dsh-skill-center/market/list',
      '/api/dsh-skill-center/market/lucide',
      '/api/dsh-skill-center/provider-toggle',
      '/api/dsh-skill-center/toggle',
    ], '十三条路径与设计一致（routes.md §3.3 + §3.7.1）');
    assert.equal(registrations.every((route) => typeof route.handler === 'function'), true, '每条路由都有 handler');
    assert.equal(registrations.every((route) => route.kind === 'exact'), true, '全部是 exact 路由');

    const list = registrations.find((route) => route.path === ROUTES.list);
    const response = await callRoute(list, { headers: LOOPBACK_HEADERS });
    assert.equal(response.status, 200, '注册出来的 list 路由可调用');
    const rows = response.json.data.groups.flatMap((group) => group.skills);
    assert.deepEqual(rows.map((row) => row.name), ['configured-skill'], 'config 指定的技能根被扫描');
    assert.equal(response.json.data.cwd, process.cwd(), '没有会话时 cwd 回落到进程工作目录');

    const health = registrations.find((route) => route.path === ROUTES.health);
    const healthResponse = await callRoute(health, { headers: LOOPBACK_HEADERS });
    assert.equal(healthResponse.json.data.dshHome, tree.dshHome, 'health 报出 config 指定的 dshHome');
    assert.equal(healthResponse.json.data.skillsRoot, tree.skillsRoot, 'health 报出 config 指定的 skillsRoot');

    assert.equal(cleanups.length, 1, 'apply 通过 ctx.effect 登记了路由清理函数');
    assert.equal(typeof cleanups[0], 'function', '清理函数可调用');
    cleanups[0]();
    assert.equal(registrations.length, 13, '清理之后注册记录仍然可读（注销发生在宿主侧）');
  } finally {
    await tree.cleanup();
  }
});

test('第二次 apply 是空操作（重复注册 exact 路由会让宿主抛错）', async () => {
  const { ctx, registrations } = fakeContext();
  apply(ctx, {});
  assert.equal(registrations.length, 0, '第二次 apply 不再注册任何路由');
});

test('没有 config 时回落到 $DSH_HOME，再回落到 ~/.dsh', async () => {
  const home = await mkdtemp(join(tmpdir(), 'skc-dshhome-'));
  try {
    const indexPath = new URL('../index.js', import.meta.url).href;
    // 以前这里用「最后注册的那条路由」当 health 使。市场面把 install 排在 health 之后，
    // 于是它拿到的是 POST 路由、返回 E_METHOD —— 脆弱断言，与 health 本身无关。
    // 现在按 ROUTES.health 的路径挑，路由表怎么排序都不影响这条用例。
    const script = `
      import { Readable } from 'node:stream';
      import { apply } from ${JSON.stringify(indexPath)};
      const registered = [];
      const ctx = {
        logger: { warn: () => {} },
        webServer: { register: (route) => { registered.push(route); return () => {}; } },
        effect: (callback) => {
          callback();
        },
      };
      apply(ctx, undefined);
      const health = registered.find((route) => route.path === ${JSON.stringify(ROUTES.health)});
      if (health === undefined) throw new Error('apply registered no health route');
      await health.handler(
        Object.assign(Readable.from([]), {
          method: 'GET',
          url: '/',
          headers: { host: '127.0.0.1:5173' },
          socket: { remoteAddress: '127.0.0.1' },
        }),
        { statusCode: 0, setHeader: () => {}, end: (payload) => console.log(payload) },
      );
    `;
    const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, DSH_HOME: home },
    });
    const payload = JSON.parse(stdout.trim().split('\n').at(-1));
    assert.equal(payload.code, 'OK', '子进程里的 health 调用成功');
    assert.equal(payload.data.dshHome, home, '$DSH_HOME 决定 dshHome');
    assert.equal(payload.data.skillsRoot, join(home, 'skills'), '$DSH_HOME/skills 是默认技能根');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
