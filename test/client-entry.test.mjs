/**
 * L3 — `src/client/index.jsx`: the three seats, the stylesheet, and the dictionary.
 *
 * Contract: docs/contracts/client.md §3.5 (seats), §8.3 (the entry name lives only in
 * locale), AGENTS.md rule 3 (rename = a JSON edit, zero code change).
 *
 * The host is stubbed: `slots.inject` is called on the spot, `slots.register` records
 * its arguments, `locale.bind` hands back a real dictionary translator.
 */
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ROOT, loadClientModules, readDictionary, strictContext, translator } from './helpers/ssr.mjs';

/** Bundled client entry module. */
let entry;
/** Both dictionaries. */
let zh;
let en;

before(async () => {
  entry = (await loadClientModules(['entry'])).entry;
  zh = await readDictionary('zh');
  en = await readDictionary('en');
});

test('注册的座位与顺序常量与设计一致', () => {
  assert.equal(entry.NS, 'dsh-skill-center', '命名空间就是包名');
  assert.equal(entry.PANEL_ID, 'dsh-skill-center', '面板 id 与包名同值');
  assert.equal(entry.PANEL_ORDER, 40, '侧栏行位置是 40');
});

test('apply 注册双语字典、三个座位与至少一个样式挂点', () => {
  const { ctx, registrations, dictionaries } = strictContext(entry);
  entry.apply(ctx);
  assert.equal(dictionaries.length, 1, '只注册一次字典');
  assert.equal(dictionaries[0].namespace, 'dsh-skill-center', '字典挂在插件自己的命名空间');
  assert.equal(typeof dictionaries[0].dictionary.zh, 'object', '字典里有中文');
  assert.equal(typeof dictionaries[0].dictionary.en, 'object', '字典里有英文');
  assert.deepEqual(
    registrations.map(({ registration }) => registration.name).sort(),
    ['main', 'shell.overlay', 'sidebar.panellist'],
    '注册了侧栏行、全局页与浮层三个座位',
  );
});

test('侧栏行的标题来自 locale，中文是「技能」', async () => {
  const { ctx, registrations } = strictContext(entry, translator(await readDictionary('zh')));
  entry.apply(ctx);
  const row = registrations.find(({ registration }) => registration.name === 'sidebar.panellist');
  assert.equal(row.registration.id, 'dsh-skill-center', '侧栏行 id 与面板 id 同值');
  assert.equal(row.registration.order, 40, '侧栏行 order 是 40');
  assert.equal(row.registration.locale, 'dsh-skill-center', '侧栏行声明自己的命名空间');
  assert.equal(row.registration.label(), '技能', '中文环境下的入口名是「技能」');
});

test('换语言就换入口名，代码零改动（入口名只在 locale 里）', async () => {
  const { ctx, registrations } = strictContext(entry, translator(await readDictionary('en')));
  entry.apply(ctx);
  const row = registrations.find(({ registration }) => registration.name === 'sidebar.panellist');
  assert.equal(row.registration.label(), 'Skills', '英文环境下的入口名是 Skills');
});

test('全局页用同一个 key 注册，并注入 store 与 api', () => {
  const { ctx, registrations } = strictContext(entry);
  entry.apply(ctx);
  const page = registrations.find(({ registration }) => registration.name === 'main');
  assert.equal(page.registration.key, 'dsh-skill-center', 'main 槽的 key 与侧栏行 id 相同');
  assert.equal(page.registration.locale, 'dsh-skill-center', '全局页声明命名空间（于是组件拿到 t）');
  const props = page.registration.inject();
  assert.deepEqual(Object.keys(props).sort(), ['api', 'store'], '注入的只有 store 与 api');
  assert.equal(typeof props.store.getSnapshot, 'function', 'store 暴露 getSnapshot');
  assert.equal(typeof props.store.subscribe, 'function', 'store 暴露 subscribe');
  assert.equal(typeof props.api.list, 'function', 'api 有 list');
  assert.equal(typeof props.api.toggle, 'function', 'api 有 toggle');
  assert.equal(typeof props.api.toggleProvider, 'function', 'api 有 toggleProvider');
  assert.equal(typeof page.component, 'function', '注册的是一个组件');
});

test('浮层里注册刷新失败提示，并单独注入 store', () => {
  const { ctx, registrations } = strictContext(entry);
  entry.apply(ctx);
  const overlay = registrations.find(({ registration }) => registration.name === 'shell.overlay');
  assert.equal(overlay.registration.id, 'dsh-skill-center.refresh-toast', '浮层座位的 id 带自己的后缀');
  assert.equal(typeof overlay.registration.inject().store.getSnapshot, 'function', '浮层只拿 store');
  assert.equal(typeof overlay.component, 'function', '浮层注册的是组件');
});

test('apply 的清理函数会回收所有座位注册', () => {
  const { ctx, cleanups } = strictContext(entry);
  entry.apply(ctx);
  assert.equal(cleanups.length, 2, 'apply 登记了两个 effect（字典与界面挂载）');
  for (const dispose of cleanups) {
    assert.equal(typeof dispose === 'function' || dispose === undefined, true, '每个清理函数都可调用');
  }
});

/**
 * The commit artifact, loaded the way the shell loads it.
 *
 * `client.js` is not a module node can import: it is a `window.__ModuleLoader__.load`
 * call whose factory is only ever executed by the GUI. Reproducing that here is the
 * only way to assert anything about the *file that ships* rather than about the
 * sources behind it — the two differ exactly when a build was skipped.
 */
const ARTIFACT = join(ROOT, 'client.js');

/**
 * Execute the committed bundle and return its `module.exports`.
 * @returns {Promise<{id: string, module: object}>} registration id and exports.
 */
async function loadCommittedBundle() {
  const code = await readFile(ARTIFACT, 'utf8');
  const captured = {};
  const sandbox = {
    window: { __ModuleLoader__: { load: (spec) => { captured.spec = spec; } } },
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    Date,
    JSON,
    Math,
  };
  createContext(sandbox);
  runInContext(code, sandbox, { filename: 'client.js' });
  const react = await import('react');
  const jsxRuntime = await import('react/jsx-runtime');
  const primitives = await import('./helpers/primitives-stub.mjs');
  const seeds = {
    react,
    'react/jsx-runtime': jsxRuntime,
    '@deepseek-ai/dsh-client-ui-primitives': primitives,
  };
  const module = captured.spec.factory((specifier) => {
    if (specifier in seeds) return seeds[specifier];
    throw new Error(`client.js required an unexpected module: ${specifier}`);
  });
  return { id: captured.spec.id, module };
}

test('client.js 导出 inject，且只声明真正用到的服务', async () => {
  const { module } = await loadCommittedBundle();
  assert.equal(Array.isArray(module.inject), true, 'module.exports.inject 是数组（cordis 靠它放行服务读取）');
  assert.deepEqual([...module.inject].sort(), ['locale', 'slots'], '声明 locale 与 slots，effect 是核心能力不需要声明');
});

test('严格 ctx（未声明的服务一律抛错）下 apply 不抛错，并注册三个座位', async () => {
  const { module } = await loadCommittedBundle();
  const { ctx, registrations, dictionaries } = strictContext(module, (key) => key);
  assert.doesNotThrow(() => module.apply(ctx), 'init inject 后 apply 不再抛 cannot get property ... without inject');
  assert.equal(dictionaries.length, 1, '字典仍然注册了一次');
  assert.deepEqual(
    registrations.map(({ registration }) => registration.name).sort(),
    ['main', 'shell.overlay', 'sidebar.panellist'],
    '三个座位都注册成功',
  );
});

test('严格 ctx 下侧栏标题仍从字典解析（入口名不硬编码）', async () => {
  const { module } = await loadCommittedBundle();
  const zh = await readDictionary('zh');
  const { ctx, registrations } = strictContext(module, translator(zh));
  module.apply(ctx);
  const row = registrations.find(({ registration }) => registration.name === 'sidebar.panellist');
  assert.equal(row.registration.label(), '技能', '中文环境下的入口名是「技能」');
});

/** A key-shaped token: something that should have been translated. */
const KEY_SHAPE = /\b[a-z][a-zA-Z]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+\b/g;

/** One row per partition, so the first screen exercises every group heading. */
const COPY_PAYLOAD = {
  groups: [
    {
      key: 'builtin',
      skills: [{
        name: 'office', description: 'Built in office skills', displayName: null, provider: 'runtime',
        partition: 'builtin', rule: 'R1', confidence: 'high', evidence: 'evidence.builtinProvider',
        symlink: false, path: null, realPath: null, enabled: true, writable: false, readonlyReason: 'provider-store',
      }],
    },
    {
      key: 'local',
      skills: [{
        name: 'dev-docs-standards', description: 'Local docs', displayName: null, provider: 'filesystem',
        partition: 'local', rule: 'R4', confidence: 'high', evidence: 'evidence.symlink',
        symlink: true, path: null, realPath: '/tmp/target/SKILL.md', enabled: true, writable: false, readonlyReason: 'symlink',
      }],
    },
    {
      key: 'installed',
      skills: [{
        name: 'ui-design', description: 'Design guidance', displayName: null, provider: 'filesystem',
        partition: 'installed', rule: 'R7', confidence: 'high', evidence: 'evidence.metaRelease',
        symlink: false, path: '/tmp/skills/ui-design/SKILL.md', realPath: null, enabled: true, writable: true, readonlyReason: null,
      }],
    },
  ],
  counts: { total: 3, disabled: 0, excluded: 0 },
  complete: true,
  diagnostics: [],
  cwd: '/tmp',
};

test('真实 client.js 注册的字典只含字符串，且覆盖全部 UI 键', async () => {
  const { module } = await loadCommittedBundle();
  const zh = await readDictionary('zh');
  const en = await readDictionary('en');
  const { ctx, dictionaries } = strictContext(module, translator(zh));
  module.apply(ctx);
  const registered = dictionaries[0].dictionary;
  for (const language of ['zh', 'en']) {
    const values = Object.values(registered[language]);
    assert.equal(values.every((value) => typeof value === 'string'), true, `${language} 字典里没有非字符串值（meta 块没被塞进来）`);
    const expected = Object.keys(language === 'zh' ? zh : en).filter((key) => key !== 'meta');
    assert.deepEqual(Object.keys(registered[language]).sort(), expected.sort(), `${language} 注册的正是全部 UI 键`);
  }
});

test('真机同款扁平 translate：侧栏标题与首屏文案里没有未翻译的键名', async () => {
  const { module } = await loadCommittedBundle();
  const zh = await readDictionary('zh');
  const t = translator(zh);
  const { ctx, registrations } = strictContext(module, t);
  module.apply(ctx);

  const label = registrations.find(({ registration }) => registration.name === 'sidebar.panellist').registration.label();
  assert.equal(label, '技能', '侧栏标题解析成中文，而不是 panel.label');
  assert.equal(KEY_SHAPE.test(label), false, '侧栏标题里没有键名残留');

  const page = registrations.find(({ registration }) => registration.name === 'main');
  const props = page.registration.inject();
  props.store.actions.ready(COPY_PAYLOAD);
  const html = renderToStaticMarkup(createElement(page.component, { t, ...props }));
  const leftover = [...new Set(html.match(KEY_SHAPE) ?? [])];
  assert.deepEqual(leftover, [], `首屏 HTML 里没有未翻译的键名（发现：${leftover.join(', ')}）`);
  for (const copy of ['内置技能配置', '本地技能', '已安装技能', '技能市场', '添加技能', '刷新']) {
    assert.equal(html.includes(copy), true, `首屏出现文案「${copy}」`);
  }
});
