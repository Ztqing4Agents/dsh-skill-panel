/**
 * L3 — `src/client/toast.jsx`: the refresh-failure toast that outlives the page.
 *
 * Contract: docs/contracts/client.md §3.5 (`shell.overlay` seat, P0-12), §3.9.3
 * (`marketInstallOk` 推 `notice{kind:'install-ok'}`、`marketFavoriteFail` 推
 * `notice{kind:'favorite-failed', reason, seq}`，由本组件按 `kind` 选文案); case id K46.
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

test('K46 安装成功复用同一个浮层座位：一行「已安装 <name> · 新会话生效」+ 副行给落盘路径', () => {
  const store = createStore();
  store.actions.marketInstallOk('skillhub:ake:dev-god', { name: 'dev-god', path: '/Users/me/.dsh/skills/dev-god', version: '1.0.0' });
  const html = renderToStaticMarkup(createElement(modules.toast.ToastHost, { store, t }));
  assert.notEqual(html, '', '安装成功后浮层必须有提示（契约 client.md §3.9.3：推 notice{kind:"install-ok"}）');
  assert.ok(html.includes('role="alert"'), '提示是 alert 角色');
  assert.ok(html.includes('已安装 dev-god · 新会话生效'), '主行是 market.installOk');
  assert.ok(html.includes('安装到 /Users/me/.dsh/skills/dev-god'), '副行给出落盘路径（market.installOkHint）');
  assert.ok(html.includes('class="skc_marketToastHint"'), '副行用市场刻度里的 ToastHint 类');
});

test('K46 刷新失败与安装成功共用座位但按 kind 分流（同一条 notice 不会被两种文案渲染）', () => {
  const store = createStore();
  store.actions.refreshFailed({ code: 'E_INTERNAL', message: 'boom' });
  const refreshHtml = renderToStaticMarkup(createElement(modules.toast.ToastHost, { store, t }));
  assert.ok(refreshHtml.includes('刷新失败，请重试'), '刷新失败仍然是原来的文案');
  assert.equal(refreshHtml.includes('新会话生效'), false, '刷新失败不带安装文案');

  store.actions.marketInstallOk('skillhub:ake:a', { name: 'a', path: '/skills/a' });
  const installHtml = renderToStaticMarkup(createElement(modules.toast.ToastHost, { store, t }));
  assert.ok(installHtml.includes('新会话生效'), '安装成功后切成安装文案');
  assert.equal(installHtml.includes('刷新失败，请重试'), false, '安装文案不夹刷新失败');
});

test('K46 安装提示可以被 dismissNotice 关掉，且只关当前那一条', () => {
  const store = createStore();
  store.actions.marketInstallOk('skillhub:ake:a', { name: 'a', path: '/skills/a' });
  const notice = store.getSnapshot().notice;
  assert.notEqual(notice, null, '顶层 notice 上有这条提示');
  store.actions.dismissNotice(notice.seq - 1);
  assert.notEqual(store.getSnapshot().notice, null, '序号不匹配时不关');
  store.actions.dismissNotice(notice.seq);
  assert.equal(store.getSnapshot().notice, null, '序号匹配时关掉');
});

test('K46 收藏写失败：复用同一个浮层座位，正文是那句本地化原因', () => {
  const store = createStore();
  const gen = store.actions.marketFavoriteToggle('skillhub:ake:dev-god');
  store.actions.marketFavoriteFail(gen, '收藏数量已达上限，请先取消一些');
  const html = renderToStaticMarkup(createElement(modules.toast.ToastHost, { store, t }));
  assert.ok(html.includes('role="alert"'), '提示是 alert 角色');
  assert.ok(html.includes('收藏数量已达上限，请先取消一些'), '正文是失败原因（不是键名、不是英文 message）');
  assert.equal(html.includes('新会话生效'), false, '不夹安装文案');
  assert.equal(html.includes('刷新失败'), false, '不夹刷新文案');
});

test('K46 三种 notice 按 kind 分流，dismissNotice 仍只关当前那一条', () => {
  const store = createStore();
  store.actions.marketInstallOk('skillhub:ake:a', { name: 'a', path: '/skills/a' });
  const installSeq = store.getSnapshot().notice.seq;

  const gen = store.actions.marketFavoriteToggle('skillhub:ake:b');
  store.actions.marketFavoriteFail(gen, '写入收藏失败：EACCES');
  const favoriteSeq = store.getSnapshot().notice.seq;
  assert.notEqual(favoriteSeq, installSeq, '第二条提示有自己的序号');
  const html = renderToStaticMarkup(createElement(modules.toast.ToastHost, { store, t }));
  assert.ok(html.includes('写入收藏失败：EACCES'), '屏幕上是最后那条');
  assert.equal(html.includes('已安装 a'), false, '前一条不叠加');

  store.actions.dismissNotice(installSeq);
  assert.notEqual(store.getSnapshot().notice, null, '关旧序号关不掉当前那条');
  store.actions.dismissNotice(favoriteSeq);
  assert.equal(store.getSnapshot().notice, null, '关当前序号才生效');
});
