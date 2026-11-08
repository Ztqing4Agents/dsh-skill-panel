/**
 * L3 — `src/client/toast.jsx`: the refresh-failure toast that outlives the page.
 *
 * Contract: docs/system_design.md §3.5 (`shell.overlay` seat, P0-12).
 */
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createStore } from '../src/client/state.js';
import { loadClientModules, zhTranslator } from './helpers/ssr.mjs';

/** Bundled toast module. */
let modules;
/** Chinese translator. */
let t;

before(async () => {
  modules = await loadClientModules(['toast']);
  t = await zhTranslator();
});

test('没有提示时什么都不渲染', () => {
  const store = createStore();
  assert.equal(renderToStaticMarkup(createElement(modules.toast.ToastHost, { store, t })), '', '空 store 渲染为空串');
});

test('刷新失败时渲染 alert 形式的提示，文案来自 locale', () => {
  const store = createStore();
  store.actions.ready({ groups: [], counts: { total: 0, disabled: 0, excluded: 0 }, complete: true, diagnostics: [], cwd: '/w' });
  store.actions.refreshFailed({ code: 'E_INTERNAL', message: 'boom' });
  const html = renderToStaticMarkup(createElement(modules.toast.ToastHost, { store, t }));
  assert.ok(html.includes('role="alert"'), '提示是 alert 角色');
  assert.ok(html.includes('刷新失败，请重试'), '显示本地化的刷新失败文案');
});

test('提示被关掉之后重新渲染为空（离开页面仍可见的那条生命期由 store 决定）', () => {
  const store = createStore();
  store.actions.ready({ groups: [], counts: { total: 0, disabled: 0, excluded: 0 }, complete: true, diagnostics: [], cwd: '/w' });
  store.actions.refreshFailed({ code: 'E_INTERNAL', message: 'boom' });
  const before = renderToStaticMarkup(createElement(modules.toast.ToastHost, { store, t }));
  store.actions.dismissNotice(store.getSnapshot().notice.seq);
  const after = renderToStaticMarkup(createElement(modules.toast.ToastHost, { store, t }));
  assert.notEqual(before, '', '关掉之前有提示');
  assert.equal(after, '', '关掉之后没有提示');
});

test('没有 t 时用键名兜底，不抛错', () => {
  const store = createStore();
  store.actions.ready({ groups: [], counts: { total: 0, disabled: 0, excluded: 0 }, complete: true, diagnostics: [], cwd: '/w' });
  store.actions.refreshFailed({ code: 'E_INTERNAL', message: 'boom' });
  const html = renderToStaticMarkup(createElement(modules.toast.ToastHost, { store }));
  assert.ok(html.includes('page.refreshError'), '缺 t 时渲染出键名而不是崩溃');
});
