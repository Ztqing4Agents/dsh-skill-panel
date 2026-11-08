/**
 * `lib/routes.js` — the four exact routes, one shared guard, one identity check.
 *
 * Contracts: docs/contracts/routes.md §3.3 (route table), §3.3.2 (path identity),
 * §8.1 (error codes); case ids K18, K19, K20, K21.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { lstat, mkdir, readFile, realpath, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ROUTES, makeRoutes } from '../lib/routes.js';
import { LOOPBACK_HEADERS, callRoute } from './helpers/http.mjs';
import { customTree, skillFile } from './helpers/tree.mjs';

/** The field the toggle route rewrites. */
const FIELD = 'disable-model-invocation';

/**
 * Mount the routes over one temporary DSH home.
 * @param {{registry?: object, sessions?: object, entries?: Record<string, Buffer|string>}} [options] - host service stubs and tree.
 * @returns {Promise<{byPath: Record<string, object>, tree: object, targetRepo: string, linkedPath: string,
 *   close: () => Promise<void>}>} the mounted routes.
 */
async function mount(options = {}) {
  const tree = await customTree(options.entries ?? {
    'hand-made': skillFile({ name: 'hand-made' }),
    'commented': skillFile({ name: 'commented', extra: [`${FIELD}: true  # turned off`] }),
  });
  const targetRepo = join(tree.dshHome, 'target-repo');
  await mkdir(targetRepo, { recursive: true });
  await writeFile(join(targetRepo, 'SKILL.md'), skillFile({ name: 'linked-skill' }));
  await symlink('../target-repo', join(tree.skillsRoot, 'linked-skill'), 'dir');
  const routes = makeRoutes({}, {
    dshHome: tree.dshHome,
    skillsRoot: tree.skillsRoot,
    version: '9.9.9-test',
    registry: options.registry,
    sessions: options.sessions,
    logger: { warn: () => {} },
  });
  return {
    byPath: Object.fromEntries(routes.map((route) => [route.path, route])),
    tree,
    targetRepo,
    linkedPath: join(tree.skillsRoot, 'linked-skill', 'SKILL.md'),
    close: tree.cleanup,
  };
}

test('路由表就是设计里的四条 exact 路由', () => {
  assert.deepEqual(ROUTES, {
    list: '/api/dsh-skill-center/list',
    toggle: '/api/dsh-skill-center/toggle',
    providerToggle: '/api/dsh-skill-center/provider-toggle',
    health: '/api/dsh-skill-center/health',
  }, '四条路径与设计逐字一致');
});

test('路由都是 exact 类型，不用前缀匹配', async () => {
  const mounted = await mount();
  try {
    const routes = Object.values(mounted.byPath);
    assert.equal(routes.length, 4, '一共注册四条路由');
    assert.equal(routes.every((route) => route.kind === 'exact'), true, '四条都是 exact 路由');
  } finally {
    await mounted.close();
  }
});

test('K21 list 返回三分区、计数与账本诊断，形状与 ListPayload 一致', async () => {
  const mounted = await mount();
  try {
    const response = await callRoute(mounted.byPath[ROUTES.list], { headers: LOOPBACK_HEADERS });
    assert.equal(response.status, 200, 'list 返回 200');
    assert.equal(response.json.code, 'OK', '信封 code 是 OK');
    const data = response.json.data;
    assert.deepEqual(data.groups.map((group) => group.key), ['builtin', 'local', 'installed'], '三分区顺序恒为内置/本地/已安装');
    assert.equal(data.counts.total, 3, '计数等于三行');
    assert.equal(data.counts.disabled, 1, '只有 commented 一行是停用');
    assert.equal(data.counts.excluded, 0, '本树没有被排除的根');
    assert.equal(data.complete, false, '没有注册表时 complete 为 false');
    assert.equal(Array.isArray(data.diagnostics), true, 'diagnostics 是数组');
    assert.equal(typeof data.cwd, 'string', 'cwd 是字符串');
  } finally {
    await mounted.close();
  }
});

test('list 里软链行的 path 为 null、realPath 指向目标（三层拦截的第一层）', async () => {
  const mounted = await mount();
  try {
    const response = await callRoute(mounted.byPath[ROUTES.list], { headers: LOOPBACK_HEADERS });
    const rows = response.json.data.groups.flatMap((group) => group.skills);
    const linked = rows.find((row) => row.name === 'linked-skill');
    assert.equal(linked.symlink, true, '行上带 symlink 事实');
    assert.equal(linked.path, null, '软链行没有可写路径');
    assert.equal(linked.realPath, await realpath(join(mounted.targetRepo, 'SKILL.md')), 'realPath 指向链接目标（realpath 归一化后）');
    assert.equal(linked.writable, false, '软链行不可写');
    assert.equal(linked.readonlyReason, 'symlink', '只读原因是 symlink');
    assert.equal(linked.partition, 'local', '软链技能归入本地');
  } finally {
    await mounted.close();
  }
});

test('K19 非 loopback 请求 403，且没有发生任何写入', async () => {
  const mounted = await mount();
  try {
    const file = join(mounted.tree.skillsRoot, 'hand-made', 'SKILL.md');
    const before = await readFile(file);
    const response = await callRoute(mounted.byPath[ROUTES.toggle], {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: JSON.stringify({ name: 'hand-made', path: file, enabled: false }),
      remoteAddress: '10.0.0.2',
    });
    assert.equal(response.status, 403, '非回环来源被拒绝为 403');
    assert.equal(response.json.code, 'E_FORBIDDEN', '错误码是 E_FORBIDDEN');
    const after = await readFile(file);
    assert.equal(after.equals(before), true, '被拒绝的请求没有改动技能文件');
  } finally {
    await mounted.close();
  }
});

test('K19 带 x-forwarded-for 的请求 403', async () => {
  const mounted = await mount();
  try {
    const response = await callRoute(mounted.byPath[ROUTES.list], {
      headers: { ...LOOPBACK_HEADERS, 'x-forwarded-for': '127.0.0.1' },
    });
    assert.equal(response.status, 403, '带转发头的请求被拒绝');
    assert.equal(response.json.code, 'E_FORBIDDEN', '错误码是 E_FORBIDDEN');
  } finally {
    await mounted.close();
  }
});

test('K19 cross-site 请求 403', async () => {
  const mounted = await mount();
  try {
    const response = await callRoute(mounted.byPath[ROUTES.list], {
      headers: { ...LOOPBACK_HEADERS, 'sec-fetch-site': 'cross-site' },
    });
    assert.equal(response.status, 403, 'cross-site 请求被拒绝');
    assert.equal(response.json.code, 'E_FORBIDDEN', '错误码是 E_FORBIDDEN');
  } finally {
    await mounted.close();
  }
});

test('K19 方法不对时 405，且先过围栏再判方法', async () => {
  const mounted = await mount();
  try {
    const wrongMethod = await callRoute(mounted.byPath[ROUTES.toggle], { method: 'GET', headers: LOOPBACK_HEADERS });
    assert.equal(wrongMethod.status, 405, 'GET /toggle 返回 405');
    assert.equal(wrongMethod.json.code, 'E_METHOD', '错误码是 E_METHOD');
    const wrongList = await callRoute(mounted.byPath[ROUTES.list], { method: 'POST', headers: LOOPBACK_HEADERS, body: '{}' });
    assert.equal(wrongList.status, 405, 'POST /list 返回 405');
    const notLocalWrongMethod = await callRoute(mounted.byPath[ROUTES.toggle], { method: 'GET', remoteAddress: '10.0.0.2' });
    assert.equal(notLocalWrongMethod.status, 403, '非回环即使方法也错，先报 403（围栏在前）');
  } finally {
    await mounted.close();
  }
});

test('坏 JSON、超限正文、非对象正文都返回 400 E_BAD_REQUEST', async () => {
  const mounted = await mount();
  try {
    const broken = await callRoute(mounted.byPath[ROUTES.toggle], { method: 'POST', headers: LOOPBACK_HEADERS, body: '{oops' });
    assert.equal(broken.status, 400, '坏 JSON 返回 400');
    assert.equal(broken.json.code, 'E_BAD_REQUEST', '错误码是 E_BAD_REQUEST');

    const empty = await callRoute(mounted.byPath[ROUTES.toggle], { method: 'POST', headers: LOOPBACK_HEADERS });
    assert.equal(empty.status, 400, '空正文返回 400');

    const array = await callRoute(mounted.byPath[ROUTES.toggle], { method: 'POST', headers: LOOPBACK_HEADERS, body: '[]' });
    assert.equal(array.status, 400, '数组正文返回 400');
  } finally {
    await mounted.close();
  }
});

test('K20 70 KiB 正文返回 400 E_BAD_REQUEST', async () => {
  const mounted = await mount();
  try {
    const response = await callRoute(mounted.byPath[ROUTES.toggle], {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: `{"pad":"${'x'.repeat(70 * 1024)}"}`,
    });
    assert.equal(response.status, 400, '超限正文返回 400');
    assert.equal(response.json.code, 'E_BAD_REQUEST', '错误码是 E_BAD_REQUEST');
  } finally {
    await mounted.close();
  }
});

test('名字不合文法返回 400 E_BAD_NAME', async () => {
  const mounted = await mount();
  try {
    for (const name of ['Bad_Name', 'a--b', '', 42]) {
      const response = await callRoute(mounted.byPath[ROUTES.toggle], {
        method: 'POST',
        headers: LOOPBACK_HEADERS,
        body: JSON.stringify({ name, path: join(mounted.tree.skillsRoot, 'hand-made', 'SKILL.md'), enabled: true }),
      });
      assert.equal(response.status, 400, `名字 ${JSON.stringify(name)} 返回 400`);
      assert.equal(response.json.code, 'E_BAD_NAME', '错误码是 E_BAD_NAME');
    }
  } finally {
    await mounted.close();
  }
});

test('路径不是绝对 SKILL.md 返回 400 E_BAD_PATH（任意路径一律拒绝）', async () => {
  const mounted = await mount();
  try {
    for (const path of ['skills/hand-made/SKILL.md', '/etc/passwd', '/skills/hand-made/README.md', '', 42]) {
      const response = await callRoute(mounted.byPath[ROUTES.toggle], {
        method: 'POST',
        headers: LOOPBACK_HEADERS,
        body: JSON.stringify({ name: 'hand-made', path, enabled: true }),
      });
      assert.equal(response.status, 400, `路径 ${JSON.stringify(path)} 返回 400`);
      assert.equal(response.json.code, 'E_BAD_PATH', '错误码是 E_BAD_PATH');
    }
  } finally {
    await mounted.close();
  }
});

test('enabled 不是布尔时返回 400 E_BAD_REQUEST', async () => {
  const mounted = await mount();
  try {
    const response = await callRoute(mounted.byPath[ROUTES.toggle], {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: JSON.stringify({ name: 'hand-made', path: join(mounted.tree.skillsRoot, 'hand-made', 'SKILL.md'), enabled: 'yes' }),
    });
    assert.equal(response.status, 400, '字符串 enabled 返回 400');
    assert.equal(response.json.code, 'E_BAD_REQUEST', '错误码是 E_BAD_REQUEST');
  } finally {
    await mounted.close();
  }
});

test('K18 重新扫描后该 name 不存在返回 404 E_NOT_FOUND', async () => {
  const mounted = await mount();
  try {
    const response = await callRoute(mounted.byPath[ROUTES.toggle], {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: JSON.stringify({ name: 'never-existed', path: join(mounted.tree.skillsRoot, 'never-existed', 'SKILL.md'), enabled: true }),
    });
    assert.equal(response.status, 404, '未知 name 返回 404');
    assert.equal(response.json.code, 'E_NOT_FOUND', '错误码是 E_NOT_FOUND');
  } finally {
    await mounted.close();
  }
});

test('K18 软链行返回 409 E_SYMLINK_READONLY，且目标文件字节前后完全相同', async () => {
  const mounted = await mount();
  try {
    const target = join(mounted.targetRepo, 'SKILL.md');
    const before = await readFile(target);
    const response = await callRoute(mounted.byPath[ROUTES.toggle], {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: JSON.stringify({ name: 'linked-skill', path: mounted.linkedPath, enabled: false }),
    });
    assert.equal(response.status, 409, '写软链技能返回 409');
    assert.equal(response.json.code, 'E_SYMLINK_READONLY', '错误码是 E_SYMLINK_READONLY');
    const after = await readFile(target);
    assert.equal(after.equals(before), true, '软链目标文件的字节完全没变');
  } finally {
    await mounted.close();
  }
});

test('K18 同名但路径不同返回 409 E_STALE_PATH，且不写任何文件', async () => {
  const mounted = await mount();
  try {
    const other = join(mounted.targetRepo, 'SKILL.md');
    const before = await readFile(other);
    const response = await callRoute(mounted.byPath[ROUTES.toggle], {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: JSON.stringify({ name: 'hand-made', path: other, enabled: false }),
    });
    assert.equal(response.status, 409, '同名换路径返回 409');
    assert.equal(response.json.code, 'E_STALE_PATH', '错误码是 E_STALE_PATH');
    const after = await readFile(other);
    assert.equal(after.equals(before), true, '被冒名的那个文件没有被写');
    const row = await readFile(join(mounted.tree.skillsRoot, 'hand-made', 'SKILL.md'), 'utf8');
    assert.equal(row.includes(FIELD), false, '真正的同名技能也没有被写');
  } finally {
    await mounted.close();
  }
});

test('K18 身份一致时写成功：200 + 文件里只多了那一个键', async () => {
  const mounted = await mount();
  try {
    const file = join(mounted.tree.skillsRoot, 'hand-made', 'SKILL.md');
    const before = await readFile(file);
    const response = await callRoute(mounted.byPath[ROUTES.toggle], {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: JSON.stringify({ name: 'hand-made', path: file, enabled: false }),
    });
    assert.equal(response.status, 200, '身份一致的写请求返回 200');
    assert.deepEqual(response.json.data, { name: 'hand-made', enabled: false, modelInvocable: false, path: file }, '返回写后的身份与状态');
    const after = await readFile(file);
    assert.equal(after.toString('utf8').includes(`${FIELD}: true`), true, '文件里出现停用键');
    const delta = after.length - before.length;
    assert.equal(delta, `${FIELD}: true\n`.length, '只增加了一行（键 + 换行）');
  } finally {
    await mounted.close();
  }
});

test('写同一状态两次都成功，第二次不改字节（幂等）', async () => {
  const mounted = await mount();
  try {
    const file = join(mounted.tree.skillsRoot, 'hand-made', 'SKILL.md');
    const body = JSON.stringify({ name: 'hand-made', path: file, enabled: false });
    await callRoute(mounted.byPath[ROUTES.toggle], { method: 'POST', headers: LOOPBACK_HEADERS, body });
    const first = await readFile(file);
    const second = await callRoute(mounted.byPath[ROUTES.toggle], { method: 'POST', headers: LOOPBACK_HEADERS, body });
    const after = await readFile(file);
    assert.equal(second.status, 200, '第二次写入仍返回 200');
    assert.equal(after.equals(first), true, '第二次写入不变更任何字节');
  } finally {
    await mounted.close();
  }
});

test('写成功后 list 里该行变成停用，计数同步', async () => {
  const mounted = await mount();
  try {
    const file = join(mounted.tree.skillsRoot, 'hand-made', 'SKILL.md');
    await callRoute(mounted.byPath[ROUTES.toggle], {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: JSON.stringify({ name: 'hand-made', path: file, enabled: false }),
    });
    const response = await callRoute(mounted.byPath[ROUTES.list], { headers: LOOPBACK_HEADERS });
    const rows = response.json.data.groups.flatMap((group) => group.skills);
    const row = rows.find((entry) => entry.name === 'hand-made');
    assert.equal(row.enabled, false, '再读时该行是停用');
    assert.equal(response.json.data.counts.disabled, 2, '停用计数从 1 变 2');
  } finally {
    await mounted.close();
  }
});

test('provider-toggle 对文件型行返回 404（不是内置行就没有面板存储）', async () => {
  const mounted = await mount();
  try {
    const response = await callRoute(mounted.byPath[ROUTES.providerToggle], {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: JSON.stringify({ provider: 'filesystem', name: 'hand-made', enabled: false }),
    });
    assert.equal(response.status, 404, '文件型行返回 404');
    assert.equal(response.json.code, 'E_NOT_FOUND', '错误码是 E_NOT_FOUND');
  } finally {
    await mounted.close();
  }
});

test('provider-toggle 的 provider 非法时返回 400', async () => {
  const mounted = await mount();
  try {
    const response = await callRoute(mounted.byPath[ROUTES.providerToggle], {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: JSON.stringify({ provider: 'x'.repeat(65), name: 'office', enabled: false }),
    });
    assert.equal(response.status, 400, '超长 provider 返回 400');
    assert.equal(response.json.code, 'E_BAD_REQUEST', '错误码是 E_BAD_REQUEST');
  } finally {
    await mounted.close();
  }
});

test('provider-toggle 对内建行写面板存储，随后的 list 反映停用', async () => {
  const registry = {
    snapshot: async () => ({
      complete: true,
      skills: [{ name: 'office', provider: 'runtime', source: 'runtime', description: 'Built-in office skill.' }],
    }),
  };
  const mounted = await mount({ registry });
  try {
    const toggle = await callRoute(mounted.byPath[ROUTES.providerToggle], {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: JSON.stringify({ provider: 'runtime', name: 'office', enabled: false }),
    });
    assert.equal(toggle.status, 200, '内建行写面板存储返回 200');
    assert.deepEqual(toggle.json.data, { provider: 'runtime', name: 'office', disabled: true }, '返回停用结果');
    const store = JSON.parse(await readFile(join(mounted.tree.dshHome, 'dsh-skill-center', 'provider-toggles.json'), 'utf8'));
    assert.deepEqual(store.disabled, [{ provider: 'runtime', name: 'office' }], '存储里登记了这条身份');

    const list = await callRoute(mounted.byPath[ROUTES.list], { headers: LOOPBACK_HEADERS });
    const builtin = list.json.data.groups[0].skills.find((row) => row.name === 'office');
    assert.equal(builtin.partition, 'builtin', '该行归入内置技能配置');
    assert.equal(builtin.enabled, false, '存储里的停用反映到列表');
    assert.equal(builtin.readonlyReason, 'provider-store', '内置行写明它写面板存储');
  } finally {
    await mounted.close();
  }
});

test('provider-toggle 用另一个 provider 冒名内建行返回 404', async () => {
  const registry = {
    snapshot: async () => ({ complete: true, skills: [{ name: 'office', provider: 'runtime', source: 'runtime' }] }),
  };
  const mounted = await mount({ registry });
  try {
    const response = await callRoute(mounted.byPath[ROUTES.providerToggle], {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: JSON.stringify({ provider: 'other-provider', name: 'office', enabled: false }),
    });
    assert.equal(response.status, 404, 'provider 不匹配返回 404');
  } finally {
    await mounted.close();
  }
});

test('health 报出目录、计数、台账来源与存储可读性', async () => {
  const mounted = await mount();
  try {
    const response = await callRoute(mounted.byPath[ROUTES.health], { headers: LOOPBACK_HEADERS });
    assert.equal(response.status, 200, 'health 返回 200');
    const data = response.json.data;
    assert.equal(data.ok, true, 'ok 为 true');
    assert.equal(data.version, '9.9.9-test', '版本来自 deps');
    assert.equal(data.dshHome, mounted.tree.dshHome, 'dshHome 透传配置值');
    assert.equal(data.skillsRoot, mounted.tree.skillsRoot, 'skillsRoot 透传配置值');
    assert.deepEqual(data.ledger.sources, [], '没有台账时 sources 为空');
    assert.deepEqual(data.providerToggles, { readable: true, disabled: 0 }, '存储可读且没有停用项');
    assert.equal(data.complete, false, '没有注册表时 complete 为 false');
  } finally {
    await mounted.close();
  }
});

test('health 只接受 GET', async () => {
  const mounted = await mount();
  try {
    const response = await callRoute(mounted.byPath[ROUTES.health], { method: 'POST', headers: LOOPBACK_HEADERS, body: '{}' });
    assert.equal(response.status, 405, 'POST /health 返回 405');
  } finally {
    await mounted.close();
  }
});

test('cwd 先取 ?cwd=，再取活跃会话的 cwd，最后回落到进程工作目录', async () => {
  const sessions = { list: () => [{ header: { cwd: '/work-from-session' } }, { header: { cwd: '/second' } }] };
  const mounted = await mount({ sessions });
  try {
    const fromSession = await callRoute(mounted.byPath[ROUTES.list], { headers: LOOPBACK_HEADERS });
    assert.equal(fromSession.json.data.cwd, '/work-from-session', '没有 ?cwd= 时取第一个活跃会话的目录');

    const fromQuery = await callRoute(mounted.byPath[ROUTES.list], { headers: LOOPBACK_HEADERS, url: '/?cwd=%2Fwork-from-query' });
    assert.equal(fromQuery.json.data.cwd, '/work-from-query', '?cwd= 优先于会话');
  } finally {
    await mounted.close();
  }
});

test('会话服务抛错或 url 无法解析时 cwd 回落到进程工作目录', async () => {
  const mounted = await mount({ sessions: { list: () => { throw new Error('no sessions'); } } });
  try {
    const response = await callRoute(mounted.byPath[ROUTES.list], { headers: LOOPBACK_HEADERS, url: ':::' });
    assert.equal(response.status, 200, '取不到 cwd 也照常返回列表');
    assert.equal(response.json.data.cwd, process.cwd(), 'cwd 回落到进程工作目录');
  } finally {
    await mounted.close();
  }
});

test('用文件路由去写一行内置技能：409 E_NOT_WRITABLE（内置行必须走 provider-toggle）', async () => {
  const registry = {
    snapshot: async () => ({ complete: true, skills: [{ name: 'office', provider: 'runtime', source: 'runtime' }] }),
  };
  const mounted = await mount({ registry });
  try {
    const response = await callRoute(mounted.byPath[ROUTES.toggle], {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: JSON.stringify({ name: 'office', path: join(mounted.tree.skillsRoot, 'office', 'SKILL.md'), enabled: false }),
    });
    assert.equal(response.status, 409, '内置行没有可写文件，返回 409');
    assert.equal(response.json.code, 'E_NOT_WRITABLE', '错误码是 E_NOT_WRITABLE');
  } finally {
    await mounted.close();
  }
});

test('KI-3 回归（路由层）：目录是真目录、仅 SKILL.md 是软链 → 409 E_SYMLINK_READONLY 且零写入', async () => {
  const tree = await customTree({ 'link-file': skillFile({ name: 'link-file', description: 'SKILL.md is a symlink.' }) });
  try {
    const shared = join(tree.dshHome, 'shared.md');
    const linkedFile = join(tree.skillsRoot, 'link-file', 'SKILL.md');
    const original = await readFile(linkedFile);
    await unlink(linkedFile);
    await writeFile(shared, original);
    await symlink(shared, linkedFile);
    const sharedBefore = await readFile(shared);

    const routes = makeRoutes({}, {
      dshHome: tree.dshHome,
      skillsRoot: tree.skillsRoot,
      version: '9.9.9-test',
      registry: undefined,
      sessions: undefined,
      logger: { warn: () => {} },
    });
    const byPath = Object.fromEntries(routes.map((route) => [route.path, route]));

    const response = await callRoute(byPath[ROUTES.toggle], {
      method: 'POST',
      headers: LOOPBACK_HEADERS,
      body: JSON.stringify({ name: 'link-file', path: linkedFile, enabled: false }),
    });
    assert.equal(response.status, 409, '写软链 SKILL.md 返回 409');
    assert.equal(response.json.code, 'E_SYMLINK_READONLY', '错误码是 E_SYMLINK_READONLY（不再是 E_FILE_CHANGED）');
    const sharedAfter = await readFile(shared);
    assert.equal(sharedAfter.equals(sharedBefore), true, '链接目标的字节没有被改');
    const info = await lstat(linkedFile);
    assert.equal(info.isSymbolicLink(), true, 'SKILL.md 仍是软链，没有被替换成普通文件');
  } finally {
    await tree.cleanup();
  }
});

test('已知边界（记录现状）：目录是真目录、SKILL.md 是软链时，该行仍带开关（点击才 409）', async () => {
  // 扫描层只看目录条目的 lstat，所以这种形态的行 symlink=false、writable=true → 面板渲染开关；
  // 真正拦住写入的是路由/写入层的 lstat(file)。行为安全（零写入），只是「不渲染开关」那一档
  // 没覆盖到这种构造场景。报告 KI-6 记录此现状，等队长裁决是否首版接受。
  const tree = await customTree({ 'link-file': skillFile({ name: 'link-file' }) });
  try {
    const linkedFile = join(tree.skillsRoot, 'link-file', 'SKILL.md');
    const original = await readFile(linkedFile);
    await unlink(linkedFile);
    await writeFile(join(tree.dshHome, 'shared.md'), original);
    await symlink(join(tree.dshHome, 'shared.md'), linkedFile);

    const routes = makeRoutes({}, {
      dshHome: tree.dshHome,
      skillsRoot: tree.skillsRoot,
      version: '9.9.9-test',
      registry: undefined,
      sessions: undefined,
      logger: { warn: () => {} },
    });
    const list = routes.find((route) => route.path === ROUTES.list);
    const response = await callRoute(list, { headers: LOOPBACK_HEADERS });
    const row = response.json.data.groups.flatMap((group) => group.skills).find((entry) => entry.name === 'link-file');
    assert.equal(row.symlink, false, '扫描层按目录条目判定，因此 symlink 为 false');
    assert.equal(row.writable, true, '因此该行被标成可写（面板会渲染开关）');
    assert.equal(row.readonlyReason, null, '没有只读原因，故不渲染只读标记');
  } finally {
    await tree.cleanup();
  }
});
