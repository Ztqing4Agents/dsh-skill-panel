/**
 * `lib/routes.js` — every exact route states its access policy as `auth: 'anonymous'`.
 *
 * Contract: docs/contracts/routes.md §3.3.5 (why the sixteen routes write the policy down
 * instead of inheriting the host default) and §3.3 (the route table itself);
 * docs/contracts/acceptance.md 附录 D.14 carries this case as K153.
 *
 * Why this file exists: host 0.2.3 turned an omitted `auth` into `required` — the server then
 * demands a live Peer and answers `401` (or `503` when no provider is installed) to anything
 * without credentials, which would break scripts, the isolated smoke test and every
 * non-browser consumer of a panel that answers fine today. `anonymous` writes down what 1.1.3
 * did de facto; the loopback fence and the host's own source check remain the gates. Nothing
 * in `npm test` watched that field, so deleting one line from the route table — or adding a
 * seventeenth route without it — would have been invisible. Both shapes are covered here:
 * the table is asserted as a whole, and the predicate is exercised against a doctored copy so
 * a future edit cannot pass by adding a route "half way".
 *
 * The route objects are read straight off `makeRoutes()`; no request is served, so no temp
 * tree is needed (handlers only touch disk when called).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { ROUTES, makeRoutes } from '../lib/routes.js';

/** The policy host 0.2.3+ must receive from every route. */
const ANONYMOUS = 'anonymous';

/**
 * Build the route table over inert dependencies.
 *
 * @returns {{kind: string, path: string, auth?: unknown, handler: Function}[]} the sixteen routes.
 */
function table() {
  return makeRoutes({}, {
    dshHome: '/nonexistent/skc-test-home',
    skillsRoot: '/nonexistent/skc-test-home/skills',
    version: '9.9.9-test',
    registry: undefined,
    sessions: undefined,
    logger: { warn: () => {} },
  });
}

/**
 * The predicate under test, kept separate so the negative case can run it against a copy.
 *
 * @param {{path: string, auth?: unknown}[]} routes - whatever a caller believes is the table.
 * @returns {{missing: string[], wrong: {path: string, auth: unknown}[]}} routes without a policy,
 *   and routes carrying a policy other than `anonymous`.
 */
function policyViolations(routes) {
  const missing = [];
  const wrong = [];
  for (const route of routes) {
    if (!('auth' in route)) missing.push(route.path);
    else if (route.auth !== ANONYMOUS) wrong.push({ path: route.path, auth: route.auth });
  }
  return { missing, wrong };
}

test('K153 十六条 exact 路由逐条带 auth === "anonymous"', () => {
  const routes = table();
  assert.equal(routes.length, 16, '一共十六条路由（本地面 7 + 市场面 9）');
  assert.equal(routes.every((route) => route.kind === 'exact'), true, '十六条都是 exact 路由');
  const { missing, wrong } = policyViolations(routes);
  assert.deepEqual(missing, [], `没有声明 auth 的路由：${missing.join(', ')}（宿主会当 required 处理）`);
  assert.deepEqual(wrong, [], 'auth 只能是 anonymous（required 要另开一轮安全策略升级，见 routes.md §3.3.5）');
  for (const route of routes) {
    assert.equal(route.auth, ANONYMOUS, `${route.path} 显式写了 auth: 'anonymous'`);
  }
});

test('K153 路由表与 ROUTES 常量逐条对齐：没有漏注册、也没有多余路由', () => {
  const routes = table();
  const registered = routes.map((route) => route.path).sort();
  const declared = Object.values(ROUTES).sort();
  assert.equal(declared.length, 16, 'ROUTES 常量本身是十六条');
  assert.deepEqual(registered, declared, '注册的路径集合与 ROUTES 常量逐个相等');
  assert.equal(new Set(registered).size, registered.length, '没有重复路径');
});

test('K153 判据会咬人：删掉一条 auth、或加一条不带 auth 的路由，都会被同一个谓词抓住', () => {
  const routes = table().map((route) => ({ ...route }));
  routes[0].auth = undefined;
  delete routes[0].auth;
  const missingOne = policyViolations(routes);
  assert.deepEqual(missingOne.missing, [ROUTES.list], '缺字段的那条被点名');
  assert.equal(missingOne.wrong.length, 0, '其余十五条不受影响');

  const extra = [...table(), { kind: 'exact', path: '/api/dsh-skill-panel/fourth-wall', handler: () => {} }];
  assert.deepEqual(policyViolations(extra).missing, ['/api/dsh-skill-panel/fourth-wall'],
    '新加路由只加一半（忘写 auth）时这里会红');

  const required = table().map((route) => ({ ...route, auth: 'required' }));
  assert.equal(policyViolations(required).wrong.length, 16, '策略被换成 required 时十六条全被点名');
});
