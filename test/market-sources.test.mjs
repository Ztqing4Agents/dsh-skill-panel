/**
 * `lib/market/sources/index.js` — the registry and the one place the market assembly happens.
 *
 * Contract: docs/contracts/market.md §7.1 (`MarketSource` shape), §7.3 (adding a source
 * costs one file + one line + two keys), §7.2 (caps per source); case id K42.
 *
 * The point of these assertions is the *shape*, not the adapters' behaviour: a third
 * source must be able to plug in without touching the page, the merge, the routes or
 * the installer. Everything below is therefore expressed in terms the page uses.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { SOURCES, descriptors, descriptorsOf, getSource, ids, makeMarketDeps } from '../lib/market/sources/index.js';
import { tempDir } from './helpers/tree.mjs';

test('K42 注册表顺序与服务端筛选顺序一致：skillhub 在前、clawhub 在后', () => {
  assert.deepEqual(ids(), ['skillhub', 'clawhub'], '两个来源按界面顺序注册');
  assert.notEqual(getSource('skillhub'), undefined, 'skillhub 可查');
  assert.notEqual(getSource('clawhub'), undefined, 'clawhub 可查');
  assert.equal(getSource('nope'), undefined, '未注册的 id 返回 undefined（路由据此报 E_BAD_QUERY）');
});

test('K42 每个适配器都实现 §7.1 的六个函数与 caps，文案只给键名', () => {
  for (const source of SOURCES) {
    assert.equal(typeof source.id, 'string', `${source.id}: id 是字符串`);
    assert.equal(source.labelKey, `market.source.${source.id}`, `${source.id}: 文案键按 id 拼（界面不枚举来源）`);
    for (const method of ['list', 'search', 'detail', 'plan', 'fetchFile']) {
      assert.equal(typeof source[method], 'function', `${source.id}: 实现了 ${method}`);
    }
    assert.equal(typeof source.caps, 'object', `${source.id}: 声明 caps`);
    for (const key of ['search', 'paged', 'categories']) {
      assert.equal(typeof source.caps[key], 'boolean', `${source.id}: caps.${key} 是布尔`);
    }
    assert.ok(['files', 'zip'].includes(source.caps.package), `${source.id}: package 只能是 files 或 zip`);
  }
});

test('K42 能力对照与 §7.2 一致：SkillHub 有分类表、ClawHub 没有且是整包', () => {
  assert.deepEqual(descriptors().map((entry) => entry.id), ['skillhub', 'clawhub'], '描述符顺序同注册表');
  const [skillhub, clawhub] = descriptors();
  assert.deepEqual(skillhub, {
    id: 'skillhub',
    labelKey: 'market.source.skillhub',
    hasCategories: true,
    packageKind: 'files',
  }, 'SkillHub 有分类表、逐文件取包');
  assert.deepEqual(clawhub, {
    id: 'clawhub',
    labelKey: 'market.source.clawhub',
    hasCategories: false,
    packageKind: 'zip',
  }, 'ClawHub 无分类表、整包 zip');
  assert.deepEqual(descriptorsOf([]), [], '空数组 ⇒ 空描述符');
  assert.deepEqual(descriptorsOf(undefined), [], '非数组 ⇒ 空描述符（界面拿到空也不会崩）');
});

test('K42 makeMarketDeps：注入 io 时不自建网络客户端，dispose 是安全空操作', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const fakeIo = { getJson: async () => ({}), getBytes: async () => Buffer.alloc(0) };
    const deps = makeMarketDeps({ dshHome: dir, skillsRoot: `${dir}/skills`, io: fakeIo, now: () => 0 });
    assert.equal(deps.io, fakeIo, '注入的 io 被原样使用（QA 不必起服务器）');
    assert.equal(deps.now(), 0, '注入的时钟被原样使用');
    assert.deepEqual(deps.sources.map((source) => source.id), ['skillhub', 'clawhub'], 'deps 里带着两个源');
    assert.equal(deps.sourceById('clawhub')?.id, 'clawhub', 'sourceById 与注册表一致');
    assert.equal(typeof deps.store.installed, 'function', '装配了自有台账');
    assert.equal(typeof deps.installer.install, 'function', '装配了安装器');
    assert.equal(deps.skillsRoot, `${dir}/skills`, 'skillsRoot 原样带出（路由补 installTo 用）');
    assert.doesNotThrow(() => deps.dispose(), '没有自建客户端时 dispose 什么都不做');
  } finally {
    await cleanup();
  }
});

test('K42 未注入 io 时自建一个上游客户端，dispose 会释放它', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const deps = makeMarketDeps({ dshHome: dir, skillsRoot: `${dir}/skills` });
    try {
      assert.equal(typeof deps.io.getJson, 'function', '自建的客户端提供 getJson');
      assert.equal(typeof deps.io.getBytes, 'function', '自建的客户端提供 getBytes');
      assert.notEqual(deps.io.getJson, undefined, '上游客户端已就绪（不发起任何请求）');
    } finally {
      assert.doesNotThrow(() => deps.dispose(), 'dispose 释放 Agent 不抛错');
    }
  } finally {
    await cleanup();
  }
});
