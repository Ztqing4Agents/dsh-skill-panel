/**
 * L3 — `src/client/skill-dialogs.jsx` (the add dialog and the delete confirmation) and
 * the page-level flow that drives them.
 *
 * Contract: docs/contracts/client.md §3.9.7 (the add dialog's three states, the delete
 * visibility and the confirmation), docs/contracts/acceptance.md 附录 D.8 K134 / K135,
 * and docs/contracts/decisions.md 附录 S-5 (a successful delete is silent).
 *
 * Two layers here, on purpose:
 *
 * - the two dialogs are pure props components, so each state is a string render;
 * - the page owns the state machine and the request, so the transition cases mount the
 *   real `SkillsPage` through React's dispatcher (`test/helpers/hooks.mjs`) and fire the
 *   handlers a click would fire. No jsdom: the component under test is the real one, only
 *   the reconciler is replaced.
 */
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createStore } from '../src/client/state.js';
import { loadClientModules, zhTranslator } from './helpers/ssr.mjs';
import { mountHooks } from './helpers/hooks.mjs';

/** Bundled client modules under test. */
let modules;
/** The Chinese translator the panel is rendered with. */
let t;

before(async () => {
  modules = await loadClientModules(['page', 'skeleton', 'row', 'toast', 'installedDetail', 'skillDialogs']);
  t = await zhTranslator();
});

/* ------------------------------------------------------------------ helpers */

/**
 * Every element of a rendered tree, depth first (children and prop values).
 * @param {import('react').ReactNode} node - element, array, or text.
 * @param {object[]} [found] - accumulator.
 * @returns {object[]} the elements.
 */
function elementsOf(node, found = []) {
  if (node === null || node === undefined || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    for (const child of node) elementsOf(child, found);
    return found;
  }
  found.push(node);
  for (const value of Object.values(node.props ?? {})) elementsOf(value, found);
  return found;
}

/**
 * The first element of a given component name in a tree.
 * @param {import('react').ReactNode} tree - rendered element.
 * @param {string} name - function name, e.g. 'AddSkillDialog'.
 * @returns {object|null} the element.
 */
function findByType(tree, name) {
  return elementsOf(tree).find((element) => typeof element.type === 'function' && element.type.name === name) ?? null;
}

/**
 * The delete confirmation inside one InstalledDetail element, if it is rendered.
 *
 * `InstalledDetail` and `DeleteConfirm` are both hook-free, so calling them is how a test
 * reaches the dialog: the page's element tree stops at the component boundary.
 * @param {object|null} detail - the `InstalledDetail` element from the page's tree.
 * @returns {object|null} the `DeleteConfirm` element.
 */
function deleteConfirmOf(detail) {
  if (detail === null || detail === undefined) return null;
  return findByType(detail.type(detail.props), 'DeleteConfirm');
}

/**
 * One payload row, as the list route answers it.
 * @param {object} [overrides] - row fields to change.
 * @returns {object} the row.
 */
function row(overrides = {}) {
  return {
    name: 'hand-made',
    description: 'A local skill.',
    displayName: null,
    provider: 'filesystem',
    partition: 'local',
    rule: 'R9',
    confidence: 'high',
    symlink: false,
    path: '/skills/hand-made/SKILL.md',
    realPath: null,
    enabled: true,
    writable: true,
    readonlyReason: null,
    upstream: null,
    version: null,
    ...overrides,
  };
}

/**
 * A ListPayload with one row.
 * @param {object} [seedRow] - the row to carry.
 * @returns {object} ListPayload.
 */
function payload(seedRow = row()) {
  return {
    groups: [
      { key: 'builtin', skills: [] },
      { key: 'local', skills: seedRow.partition === 'builtin' ? [] : [seedRow] },
      { key: 'installed', skills: seedRow.partition === 'builtin' ? [seedRow] : [] },
    ],
    counts: { total: 1, disabled: 0, excluded: 0 },
    complete: true,
    diagnostics: [],
    cwd: '/work',
  };
}

/**
 * A deferred promise, so a request can be observed while it is still in flight.
 * @returns {{promise: Promise, resolve: Function, reject: Function}} the handle.
 */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((settle, fail) => { resolve = settle; reject = fail; });
  return { promise, resolve, reject };
}

/**
 * The API surface the page uses, with spies.
 * @param {{add?: Function, remove?: Function, list?: Function}} [overrides] - replacements.
 * @returns {object} the fake api, with a `calls` log.
 */
function fakeApi(overrides = {}) {
  const calls = [];
  const seed = payload();
  return {
    calls,
    list: overrides.list ?? (async () => { calls.push('list'); return seed; }),
    toggle: async () => {},
    toggleProvider: async () => {},
    skillDetail: async () => ({ name: 'hand-made', body: '', files: null, repoUrl: null }),
    addSkill: overrides.add ?? (async (body) => { calls.push(`add:${body.path}`); return { name: 'qa-probe', path: '/skills/qa-probe' }; }),
    removeSkill: overrides.remove ?? (async (body) => { calls.push(`remove:${body.name}`); return { name: body.name, dir: '/skills/hand-made', ledger: 'cleared' }; }),
    marketBootstrap: async () => ({}),
  };
}

/**
 * Mount the page over a store seeded with one row.
 * @param {{seed?: object, api?: object}} [options] - the row and the api double.
 * @returns {{page: object, store: object, api: object, render: Function}} the harness.
 */
function mountPage(options = {}) {
  const seedRow = options.seed ?? row();
  const store = createStore();
  store.actions.ready(payload(seedRow));
  const api = options.api ?? fakeApi();
  const harness = mountHooks(modules.page.SkillsPage, { store, api, t });
  return { page: harness, store, api, render: (nextProps) => harness.render(nextProps) };
}

/**
 * The toolbar's primary add button element.
 * @param {import('react').ReactNode} tree - rendered page.
 * @returns {object|null} the element.
 */
function addPrimaryOf(tree) {
  return elementsOf(tree).find((element) => element.props?.['aria-label'] === t('add.label')
    && typeof element.props?.onClick === 'function') ?? null;
}

/* ------------------------------------------------------- AddSkillDialog · 三态 */

test('K134 idle：标题 / 说明 / 路径输入 / 安全提示 / 两枚页脚按钮，空输入时主按钮禁用', () => {
  const html = renderToStaticMarkup(createElement(modules.skillDialogs.AddSkillDialog, {
    t, status: 'idle', value: '', onSubmit: () => {}, onClose: () => {},
  }));
  assert.match(html, /<div role="dialog" aria-modal="true" aria-label="添加技能"/, '弹窗是宿主的 Modal 形状');
  assert.ok(html.includes(t('add.description')), '正文说清这个框要什么（add.description）');
  const field = /<input[^>]*>/.exec(html);
  assert.ok(field !== null, '有一个输入框');
  assert.match(field[0], /aria-label="技能目录路径"/, '输入框的可读名字是 add.pathLabel');
  assert.match(field[0], /placeholder="[^"]*\/Users\/name\/my-skill"/, '占位符是 add.pathPlaceholder');
  assert.equal(field[0].includes('readonly'), false, 'idle 时可编辑（本组件的 readOnly 只在 busy 出现）');
  assert.ok(html.includes(t('add.safety')), '安全提示在（来源可信那句话）');
  assert.match(html, /role="note"/, '安全提示是 note');
  assert.ok(html.includes(`>${t('market.confirmCancel')}</button>`), '页脚有取消');
  assert.ok(html.includes(`>${t('add.run')}</button>`), '页脚的主按钮文案是 add.run');
  assert.match(html, new RegExp(`<button[^>]*disabled=""[^>]*>(?:<span[^>]*>[\\s\\S]*?</span>)?${t('add.run')}</button>`),
    '空输入时主按钮禁用');
  assert.equal(/role="alert"/.test(html), false, 'idle 且没有错误码时没有 alert 行');
});

test('K134 idle 主按钮在有输入时解禁（判据是 value.trim()，不是 value.length）', () => {
  const render = (value) => renderToStaticMarkup(createElement(modules.skillDialogs.AddSkillDialog, {
    t, status: 'idle', value, onSubmit: () => {}, onClose: () => {},
  }));
  for (const value of ['', '   ']) {
    const html = render(value);
    assert.match(html, new RegExp(`<button[^>]*disabled=""[^>]*>[\\s\\S]*?${t('add.run')}</button>`),
      `${JSON.stringify(value)} ⇒ 主按钮禁用（纯空白不算输入）`);
  }
  const filled = render('/Users/me/my-skill');
  assert.equal(/<button[^>]*disabled=""[^>]*>(?:<span[^>]*>[\s\S]*?<\/span>)?添加<\/button>/.test(filled), false,
    '有输入 ⇒ 主按钮可点');
});

test('K134 busy：输入只读、整块 aria-busy、主按钮写 add.busy + 转圈、取消退场', () => {
  const html = renderToStaticMarkup(createElement(modules.skillDialogs.AddSkillDialog, {
    t, status: 'busy', value: '/Users/me/my-skill', onSubmit: () => {}, onClose: () => {},
  }));
  const field = /<input[^>]*>/.exec(html);
  assert.ok(field !== null, '输入框还在（请求中不把用户输入抽走）');
  assert.match(field[0], /readonly=""/, 'busy 时输入只读');
  assert.match(field[0], /aria-busy="true"/, '输入框自己报 busy');
  assert.ok(html.includes('aria-busy="true"'), '整块报 busy（读屏能等到）');
  assert.ok(html.includes(`>${t('add.busy')}</button>`), '主按钮文案换成 add.busy');
  assert.equal(html.includes(`>${t('add.run')}</button>`), false, '不再显示 add.run');
  assert.equal(html.includes(`>${t('market.confirmCancel')}</button>`), false, '请求跑起来就没有取消（收不回来）');
  assert.match(html, /<button[^>]*disabled=""[^>]*>/, '主按钮禁用');
  assert.ok(html.includes('data-state="ongoing"'), '主按钮里有 StateDot（进行中指示）');
});

test('K134 done：换成结果屏（add.done + installOkHint + add.close），表单与安全提示退场', () => {
  const html = renderToStaticMarkup(createElement(modules.skillDialogs.AddSkillDialog, {
    t,
    status: 'done',
    value: '/Users/me/my-skill',
    result: { name: 'qa-probe', path: '/skills/qa-probe' },
    onSubmit: () => {},
    onClose: () => {},
  }));
  assert.ok(html.includes(t('add.done')), '结果屏说「已添加」');
  assert.match(html, /role="status"/, '结果屏是 status（读屏会播报）');
  assert.ok(html.includes(t('market.installOkHint', { path: '/skills/qa-probe' })), '落位路径用 installOkHint 那条文案');
  assert.equal(html.includes('/skills/qa-probe'.replace('/skills/', '{path}')), false, '没有裸露的 {path} 占位符');
  assert.equal(html.includes(t('add.safety')), false, '结果屏不再有安全提示');
  assert.equal(/<input[^>]*>/.test(html), false, '结果屏没有输入框（不把完成态画成表单）');
  assert.ok(html.includes(`>${t('add.close')}</button>`), '主按钮文案是 add.close');
  assert.equal(html.includes(`>${t('market.confirmCancel')}</button>`), false, '结果屏没有取消');
});

test('K134 失败回 idle：字段下一行 role="alert" 显示 error.E_*，输入内容保留、字段标 aria-invalid', () => {
  const html = renderToStaticMarkup(createElement(modules.skillDialogs.AddSkillDialog, {
    t,
    status: 'idle',
    value: '/Users/me/typo',
    code: 'E_ADD_NOT_FOUND',
    onSubmit: () => {},
    onClose: () => {},
  }));
  assert.match(html, /role="alert"/, '错误行以 alert 播报');
  assert.ok(html.includes(t('error.E_ADD_NOT_FOUND')), '文案按 code 取 error.E_ADD_NOT_FOUND');
  assert.equal(html.includes('操作失败'), false, '没有落到 E_UNKNOWN 的「操作失败」兜底');
  const field = /<input[^>]*>/.exec(html);
  assert.match(field[0], /value="\/Users\/me\/typo"/, '输入内容保留（用户改个字符就能重试）');
  assert.match(field[0], /aria-invalid="true"/, '字段标成 invalid（红框与 aria 一致）');
  assert.equal(field[0].includes('readonly'), false, '回 idle 之后又可编辑');

  // 占位符：`E_ALREADY_INSTALLED` 带 {path}，params 由页面给，组件只负责填。
  const withParams = renderToStaticMarkup(createElement(modules.skillDialogs.AddSkillDialog, {
    t,
    status: 'idle',
    value: '/Users/me/dup',
    code: 'E_ALREADY_INSTALLED',
    params: { path: '/skills/dup' },
    onSubmit: () => {},
    onClose: () => {},
  }));
  assert.ok(withParams.includes(t('error.E_ALREADY_INSTALLED', { path: '/skills/dup' })), '占位符被填上');
  assert.equal(withParams.includes('{path}'), false, '屏上没有裸露的 {path}');
});

test('K134 IME 组字期间回车不提交（含 keyCode 229 的 Windows 路径）', () => {
  const submitted = [];
  // 组字状态在组件自己的 ref 里，所以要按 React 的方式挂一次（只换 reconciler）。
  const harness = mountHooks(modules.skillDialogs.AddSkillDialog, {
    t, status: 'idle', value: '/Users/me/中文', onSubmit: () => submitted.push('submit'), onClose: () => {},
  });
  const field = elementsOf(harness.render())
    .find((element) => element.props?.placeholder === t('add.pathPlaceholder'));
  assert.ok(field !== undefined, '找到输入框');

  const enter = (extra = {}) => ({
    key: 'Enter',
    preventDefault: () => {},
    nativeEvent: {},
    ...extra,
  });

  // 1) 组字中：onCompositionStart 之后的 Enter 不提交。
  field.props.onCompositionStart();
  field.props.onKeyDown(enter());
  assert.deepEqual(submitted, [], '组字中回车不提交（半截拼音不是路径）');

  // 2) 组字结束：普通回车提交一次。
  field.props.onCompositionEnd();
  field.props.onKeyDown(enter());
  assert.deepEqual(submitted, ['submit'], '组字结束后回车提交一次');

  // 3) keyCode 229（Windows IME 在 React 看到事件时已经 isComposing=false）。
  submitted.length = 0;
  field.props.onKeyDown(enter({ keyCode: 229 }));
  assert.deepEqual(submitted, [], 'keyCode 229 不提交');

  // 4) nativeEvent.isComposing。
  submitted.length = 0;
  field.props.onKeyDown(enter({ nativeEvent: { isComposing: true } }));
  assert.deepEqual(submitted, [], 'nativeEvent.isComposing 时也不提交');

  // 5) 非回车键不提交。
  submitted.length = 0;
  field.props.onKeyDown({ key: 'a', preventDefault: () => {}, nativeEvent: {} });
  assert.deepEqual(submitted, [], '输入普通字符不触发提交');
});

/* --------------------------------------------------------- DeleteConfirm · K135 */

test('K135 确认弹窗：role=dialog + aria-modal、标题带 {name}、正文、一行目录事实、两枚按钮、无勾选框', () => {
  const html = renderToStaticMarkup(createElement(modules.skillDialogs.DeleteConfirm, {
    name: '编程大神',
    target: '/skills/ui-design',
    t,
    onCancel: () => {},
    onConfirm: () => {},
  }));
  assert.match(html, /<div role="dialog" aria-modal="true" aria-label="卸载「编程大神」？"/, '标题是 delete.title（带名字）');
  assert.ok(html.includes(t('delete.title', { name: '编程大神' })), '标题文案来自字典');
  assert.ok(html.includes(t('delete.body')), '正文是 delete.body（永久移除那句话）');
  // U20 验收后：这一行有自己的标签「目录」(`delete.factDir`)，不再复用安装弹窗的
  // 「安装到」(`market.factInstallTo`)——删的不是「安装」来的东西，也可能是手写的。
  assert.ok(html.includes(`<dt>${t('delete.factDir')}</dt>`), '目录事实那一行的标签是 delete.factDir =「目录」');
  assert.equal(html.includes(t('market.factInstallTo')), false, '这个弹窗里不出现 market.factInstallTo（那是安装/更新弹窗的）');
  assert.ok(html.includes('<code>/skills/ui-design</code>'), '目录用等宽体写出来（可核对）');
  assert.equal((html.match(/<dt>/g) ?? []).length, 1, '事实区只有**一行**');
  assert.ok(html.includes(`>${t('market.confirmCancel')}</button>`), '有取消');
  assert.ok(html.includes(`>${t('delete.confirm')}</button>`), '确认键文案是 delete.confirm =「卸载」');
  assert.equal(/type="checkbox"/.test(html), false, '没有勾选框（宿主这一层也没有）');
  assert.equal((html.match(/skc_detailDanger/g) ?? []).length, 1, '确认键是危险样式（只有这一枚）');
  assert.match(html, /<button[^>]*autofocus[^>]*>/, '确认键拿到焦点');
});

test('K135 目录为空时不画事实区（不渲染一行空 dd）', () => {
  const html = renderToStaticMarkup(createElement(modules.skillDialogs.DeleteConfirm, {
    name: 'x', target: '', t, onCancel: () => {}, onConfirm: () => {},
  }));
  assert.equal(html.includes(t('delete.factDir')), false, '没有目录就不画事实区');
  assert.equal(/<dl/.test(html), false, '连 dl 都没有');
  assert.ok(html.includes(`>${t('delete.confirm')}</button>`), '确认键仍在');
});

test('K135 取消 ⇒ 只回调 onCancel；确认 ⇒ 只回调 onConfirm（弹窗自己不关，页面关）', () => {
  const calls = [];
  const dialog = modules.skillDialogs.DeleteConfirm({
    name: 'x', target: '/skills/x', t,
    onCancel: () => calls.push('cancel'),
    onConfirm: () => calls.push('confirm'),
  });
  const buttons = elementsOf(dialog).filter((element) => typeof element.props?.onClick === 'function'
    && typeof element.props?.children === 'string');
  const cancel = buttons.find((element) => element.props.children === t('market.confirmCancel'));
  const confirm = buttons.find((element) => element.props.children === t('delete.confirm'));
  assert.ok(cancel !== undefined && confirm !== undefined, '两枚按钮都在');
  cancel.props.onClick();
  assert.deepEqual(calls, ['cancel'], '取消只回调 onCancel');
  calls.length = 0;
  confirm.props.onClick();
  assert.deepEqual(calls, ['confirm'], '确认只回调 onConfirm（关闭是页面的事）');
});

/* ------------------------------------------------------- 页面级 · 工具条与添加 */

test('K134 工具条：主按钮与 chevron 菜单项打开同一个弹窗，菜单只有一项 add.fromPath', () => {
  const harness = mountPage();
  let tree = harness.render();

  // chevron 的 Menu：一项、文案 add.fromPath、默认收起。
  const menu = elementsOf(tree).find((element) => Array.isArray(element.props?.items)
    && element.props.items.some((item) => item?.label === t('add.fromPath')));
  assert.ok(menu !== undefined, '页面上有那个菜单');
  assert.equal(menu.props.items.length, 1, '菜单只有一项（从本地目录添加）');
  assert.equal(menu.props.open, false, '默认收起');

  // 点主按钮 ⇒ 弹窗开。
  const primary = addPrimaryOf(tree);
  assert.ok(primary !== null, '主按钮在');
  primary.props.onClick();
  tree = harness.render();
  let dialog = findByType(tree, 'AddSkillDialog');
  assert.ok(dialog !== null, '点主按钮打开了添加弹窗');
  assert.equal(dialog.props.status, 'idle', '打开时是 idle');
  assert.equal(dialog.props.value, '', '每次打开都是空表单（上一次的输入不残留）');

  // 关掉，再从菜单项进：同一个弹窗。
  dialog.props.onClose();
  tree = harness.render();
  assert.equal(findByType(tree, 'AddSkillDialog'), null, '关掉之后弹窗退场');
  menu.props.onSelect('from-path');
  tree = harness.render();
  dialog = findByType(tree, 'AddSkillDialog');
  assert.ok(dialog !== null, '菜单项打开的是同一个弹窗');
  assert.equal(dialog.props.status, 'idle', '也是 idle');
});

test('K134 添加成功：busy → done，toast 走 install-ok，请求只带 {path}，列表重扫一次', async () => {
  const pending = deferred();
  const api = fakeApi({ add: (body) => { api.calls.push(`add:${body.path}`); return pending.promise; } });
  const harness = mountPage({ api });

  let tree = harness.render();
  addPrimaryOf(tree).props.onClick();
  tree = harness.render();
  let dialog = findByType(tree, 'AddSkillDialog');
  dialog.props.onChange('/Users/me/my-skill');
  tree = harness.render();
  dialog = findByType(tree, 'AddSkillDialog');
  assert.equal(dialog.props.value, '/Users/me/my-skill', '输入落到页面状态');

  const listed = api.calls.filter((entry) => entry === 'list').length;
  dialog.props.onSubmit();
  // 请求在飞：弹窗转 busy。
  tree = harness.render();
  dialog = findByType(tree, 'AddSkillDialog');
  assert.equal(dialog.props.status, 'busy', '提交后立刻 busy');
  assert.deepEqual(api.calls.filter((entry) => entry.startsWith('add:')), ['add:/Users/me/my-skill'],
    '请求只带 path（没有 name / 文件清单 / 目录参数）');

  pending.resolve({ name: 'qa-probe', path: '/skills/qa-probe' });
  await pending.promise;
  await new Promise((resolve) => setImmediate(resolve));
  tree = harness.render();
  dialog = findByType(tree, 'AddSkillDialog');
  assert.equal(dialog.props.status, 'done', '成功 ⇒ done 屏');
  assert.deepEqual(dialog.props.result, { name: 'qa-probe', path: '/skills/qa-probe' }, '结果传给结果屏');
  const state = harness.store.getSnapshot();
  assert.equal(state.notice?.kind, 'install-ok', 'toast 复用 install-ok 座（kind 仍是三种之一）');
  assert.equal(state.notice?.name, 'qa-probe', 'toast 带技能名');
  assert.equal(api.calls.filter((entry) => entry === 'list').length > listed, true, '成功之后重扫了一次列表');
});

test('K134 添加失败：回 idle、错误码与占位符上屏、输入保留', async () => {
  const failing = deferred();
  const api = fakeApi({ add: () => failing.promise });
  const harness = mountPage({ api });

  let tree = harness.render();
  addPrimaryOf(tree).props.onClick();
  tree = harness.render();
  findByType(tree, 'AddSkillDialog').props.onChange('/Users/me/typo');
  tree = harness.render();
  findByType(tree, 'AddSkillDialog').props.onSubmit();

  const error = Object.assign(new Error('the source path does not exist'), {
    code: 'E_ADD_NOT_FOUND',
    data: {},
  });
  failing.reject(error);
  await failing.promise.catch(() => {});
  await new Promise((resolve) => setImmediate(resolve));

  tree = harness.render();
  const dialog = findByType(tree, 'AddSkillDialog');
  assert.equal(dialog.props.status, 'idle', '失败回 idle（不是自己的第四种状态）');
  assert.equal(dialog.props.code, 'E_ADD_NOT_FOUND', '错误码交给弹窗');
  assert.equal(dialog.props.value, '/Users/me/typo', '输入内容保留');
  const html = renderToStaticMarkup(dialog);
  assert.match(html, /role="alert"/, '错误行以 alert 播报');
  assert.ok(html.includes(t('error.E_ADD_NOT_FOUND')), '文案按 code 取');
  assert.equal(harness.store.getSnapshot().notice, null, '失败不推 toast');
});

/* ------------------------------------------------------- 页面级 · 删除与结局 */

test('K135 删除：点删除打开确认弹窗（标题/正文/目录事实），取消零请求', () => {
  const harness = mountPage();
  harness.store.actions.openDetail(harness.store.getSnapshot().payload.groups[1].skills[0]);
  let tree = harness.render();

  let detail = findByType(tree, 'InstalledDetail');
  assert.ok(detail !== null, '详情页在');
  assert.equal(detail.props.deleteOpen, false, '一开始没有确认弹窗');

  detail.props.onDeletePrompt(true);
  tree = harness.render();
  detail = findByType(tree, 'InstalledDetail');
  assert.equal(detail.props.deleteOpen, true, '点删除之后 deleteOpen 打开');
  const confirm = deleteConfirmOf(detail);
  assert.ok(confirm !== null, '点删除打开确认弹窗');
  assert.equal(confirm.props.name, 'hand-made', '标题用这个名字');
  assert.equal(confirm.props.target, '/skills/hand-made', '事实区是这一行的目录（去掉文件名）');
  assert.equal(harness.api.calls.some((entry) => entry.startsWith('remove:')), false, '还没发任何删除请求');

  confirm.props.onCancel();
  tree = harness.render();
  assert.equal(deleteConfirmOf(findByType(tree, 'InstalledDetail')), null, '取消关掉弹窗');
  assert.equal(findByType(tree, 'InstalledDetail') !== null, true, '取消后仍停在这一页详情');
  assert.equal(harness.api.calls.some((entry) => entry.startsWith('remove:')), false, '取消是零请求');
});

test('K135 确认删除：先关弹窗再发请求；成功回列表、无 toast、台账标过期、列表重扫', async () => {
  const pending = deferred();
  const api = fakeApi({ remove: (body) => { api.calls.push(`remove:${body.name}`); return pending.promise; } });
  const harness = mountPage({ api });
  harness.store.actions.openDetail(harness.store.getSnapshot().payload.groups[1].skills[0]);
  let tree = harness.render();
  findByType(tree, 'InstalledDetail').props.onDeletePrompt(true);
  tree = harness.render();
  const confirm = deleteConfirmOf(findByType(tree, 'InstalledDetail'));
  assert.ok(confirm !== null, '确认弹窗在');

  const listedBefore = api.calls.filter((entry) => entry === 'list').length;
  confirm.props.onConfirm();
  // 请求还在飞：弹窗必须已经关了（不能一边删一边还挂着「取消」）。
  tree = harness.render();
  assert.equal(deleteConfirmOf(findByType(tree, 'InstalledDetail')), null, '请求发出前弹窗已关（先关后发）');
  assert.deepEqual(api.calls.filter((entry) => entry.startsWith('remove:')), ['remove:hand-made'],
    '请求带 name（path 由页面从行上取）');
  assert.equal(findByType(tree, 'InstalledDetail') !== null, true, '请求中详情还在原地（不转骨架、不跳页）');

  pending.resolve({ name: 'hand-made', dir: '/skills/hand-made', ledger: 'cleared' });
  await pending.promise;
  await new Promise((resolve) => setImmediate(resolve));
  tree = harness.render();

  assert.equal(findByType(tree, 'InstalledDetail'), null, '成功 ⇒ 详情关闭，回列表');
  assert.equal(findByType(tree, 'AddSkillDialog'), null, '也没有顺带打开别的窗');
  assert.equal(harness.store.getSnapshot().detail, null, 'detail 状态清空');
  assert.equal(harness.store.getSnapshot().notice, null, '**没有成功 toast**（宿主成功静默，S-5）');
  assert.equal(harness.store.getSnapshot().market.installedReady, false, '市场那份台账映射被标过期');
  assert.equal(api.calls.filter((entry) => entry === 'list').length > listedBefore, true, '列表重扫了一次');
});

test('K135 删除失败：留在详情、行内 .skc_reason 有专属文案、E_STALE_PATH 额外重扫', async () => {
  const failing = deferred();
  const api = fakeApi({ remove: () => failing.promise });
  const harness = mountPage({ api });
  harness.store.actions.openDetail(harness.store.getSnapshot().payload.groups[1].skills[0]);
  let tree = harness.render();
  findByType(tree, 'InstalledDetail').props.onDeletePrompt(true);
  tree = harness.render();
  deleteConfirmOf(findByType(tree, 'InstalledDetail')).props.onConfirm();

  const listedBefore = api.calls.filter((entry) => entry === 'list').length;
  failing.reject(Object.assign(new Error('the skill file moved since the panel loaded'), {
    code: 'E_STALE_PATH',
    data: null,
  }));
  await failing.promise.catch(() => {});
  await new Promise((resolve) => setImmediate(resolve));

  tree = harness.render();
  assert.equal(findByType(tree, 'InstalledDetail') !== null, true, '失败留在详情页');
  assert.equal(deleteConfirmOf(findByType(tree, 'InstalledDetail')), null, '弹窗没有再弹回来');
  const html = renderToStaticMarkup(tree);
  assert.ok(html.includes('class="skc_reason"'), '行内原因出现在详情里');
  assert.match(html, /role="alert"/, '行内原因以 alert 播报');
  assert.ok(html.includes(t('error.E_STALE_PATH')), '文案是 E_STALE_PATH 的专属句（不是 E_UNKNOWN 兜底）');
  assert.equal(html.includes(t('error.E_UNKNOWN')), false, '没有落兜底文案');
  assert.equal(api.calls.filter((entry) => entry === 'list').length > listedBefore, true,
    'E_STALE_PATH 额外触发一次重扫（行已经不能用了）');
  assert.equal(harness.store.getSnapshot().notice, null, '失败也不推 toast');
});

test('K133 页面级：软链行与内置行的详情头都没有删除位（唯一入口的可见性）', () => {
  for (const seedRow of [
    row({ name: 'linked-demo', symlink: true, path: null, realPath: '/Users/me/Skills/linked-demo/SKILL.md', writable: false, readonlyReason: 'symlink' }),
    row({ name: 'office', partition: 'builtin', provider: 'runtime', path: null, writable: false, readonlyReason: 'provider-store' }),
  ]) {
    const harness = mountPage({ seed: seedRow });
    const list = harness.store.getSnapshot().payload.groups.flatMap((group) => group.skills);
    harness.store.actions.openDetail(list[0]);
    const tree = harness.render();
    const detail = findByType(tree, 'InstalledDetail');
    assert.ok(detail !== null, `${seedRow.name} 的详情页在`);
    // 页面把四条件判据交给组件，所以这里验的是「页面没给删除入口」：
    const html = renderToStaticMarkup(detail);
    assert.equal(html.includes(t('detail.uninstall')), false, `${seedRow.name} 没有删除位`);
    assert.equal(deleteConfirmOf(detail), null, '也没有确认弹窗（deletable 为 false 时不渲染）');
  }
});
