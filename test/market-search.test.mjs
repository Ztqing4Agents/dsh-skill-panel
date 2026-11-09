/**
 * The search field: one control, not a box plus a button.
 *
 * Contract: docs/contracts/market.md 附录 F (`.skc_marketSearchField` / `.skc_marketClear`
 * and the padding the button floats over), docs/contracts/client.md §3.9.6 (the toolbar),
 * docs/contracts/acceptance.md 附录 D.5 (K99); reference implementation
 * `dsh-market/src/client/SearchInput.tsx` (the clear button lives inside the field).
 *
 * What this layer can prove: the wrapper exists, the button is a child of it rather than a
 * sibling in the toolbar, the button only exists while there is text, and the handlers do
 * what the contract says (clear submits the empty keyword, Enter is ignored mid-IME).
 * Geometry - 24×24 at `right:5px`, the field not shrinking by 44px, the caret landing back
 * in the input - is a real-machine check, not this one.
 */
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createStore } from '../src/client/state.js';
import { ROOT, loadClientModules, zhTranslator } from './helpers/ssr.mjs';
import { mountHooks } from './helpers/hooks.mjs';

const require = createRequire(import.meta.url);
const ReactCjs = require('react');

/** The Chinese translator. */
let t;
/** The market toolbar component. */
let MarketFilters;

/**
 * Render the toolbar for one store state.
 * @param {(store: object) => void} [prepare] - mutations applied before rendering.
 * @param {object} [handlers] - `onInput` / `onCommit` / `onFilter` overrides.
 * @returns {{html: string, store: object, calls: object[]}} the markup and the handler log.
 */
async function render(prepare, handlers = {}) {
  const store = createStore();
  store.actions.marketBootReady({
    source: 'all',
    sources: [],
    categories: [{ key: 'dev-tools', name: '开发工具', count: 10 }],
    categoriesOk: true,
    total: 10,
    countsOk: true,
  });
  if (prepare !== undefined) prepare(store);
  const calls = [];
  const html = renderToStaticMarkup(createElement(MarketFilters, {
    market: store.getSnapshot().market,
    t,
    busy: false,
    onInput: handlers.onInput ?? ((text) => { calls.push(['input', text]); store.actions.marketSetInput(text); }),
    onCommit: handlers.onCommit ?? ((text) => { calls.push(['commit', text]); store.actions.marketCommitKeyword(text); }),
    onFilter: handlers.onFilter ?? ((patch) => { calls.push(['filter', patch]); }),
  }));
  return { html, store, calls };
}

/**
 * The first child element carrying one exact class token, depth first.
 *
 * Exact tokens, not substrings: `skc_marketSearch` is a prefix of
 * `skc_marketSearchField`, and a substring match would hand back the wrapper instead of
 * the input.
 * @param {unknown} node - a React element (or an array/fragment of them).
 * @param {string} needle - one class name.
 * @returns {object|null} the element.
 */
function find(node, needle) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, needle);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (node === null || typeof node !== 'object' || node.props === undefined) return null;
  const className = typeof node.props.className === 'string' ? node.props.className : '';
  if (className.split(/\s+/).includes(needle)) return node;
  return find(node.props.children, needle);
}

/** A market state with text in the search box. */
const withText = (store) => store.actions.marketSetInput('ui');

before(async () => {
  t = await zhTranslator();
  const modules = await loadClientModules(['filters']);
  MarketFilters = modules.filters.MarketFilters;
});

test('K99 结构：× 在搜索框容器内，不再是工具栏上的独立按钮', async () => {
  const { html } = await render(withText);
  const field = html.indexOf('class="skc_marketSearchField"');
  const input = html.indexOf('class="skc_marketSearch"', field);
  const clear = html.indexOf('class="skc_marketClear"', input);
  const fieldEnd = html.indexOf('</span>', clear);
  assert.equal(field >= 0, true, '外层容器 .skc_marketSearchField 存在');
  assert.equal(input > field, true, '搜索框在容器里');
  assert.equal(clear > input, true, '清除按钮在搜索框之后、同一个容器里（DOM 顺序：输入框 → ×）');
  assert.equal(fieldEnd > clear, true, '按钮在容器闭合之前（不是容器的兄弟）');
  // And the toolbar no longer holds a bare ghost button between the field and the menus.
  const toolbar = html.slice(html.indexOf('skc_marketToolbar'), field);
  assert.equal(toolbar.includes('<button'), false, '工具栏在搜索框之前没有任何按钮');
});

test('K99 × 只在有文字时渲染，且带可读的名字', async () => {
  const empty = await render();
  assert.equal(empty.html.includes('skc_marketClear'), false, '空输入时没有 ×');
  assert.equal(empty.html.includes('skc_marketSearchField'), true, '容器仍在（尺寸不跳）');

  const typed = await render(withText);
  const at = typed.html.indexOf('class="skc_marketClear"');
  assert.equal(at > 0, true, '有文字时出现 ×');
  // The whole start tag, so the assertions do not depend on attribute order.
  const tag = typed.html.slice(typed.html.lastIndexOf('<', at), typed.html.indexOf('>', at) + 1);
  assert.match(tag, /^<button\b/, '是 <button>（不是可点的 div）');
  assert.match(tag, /type="button"/, 'type=button（不在表单里当提交键）');
  assert.match(tag, /aria-label="清除搜索"/, '× 有 aria-label');
  assert.match(tag, /title="清除搜索"/, '× 有 title（鼠标悬停看得懂）');
});

test('K99 样式：容器定位、按钮绝对定位、搜索框给自己让出 32px', async () => {
  const css = await readFile(join(ROOT, 'src', 'client', 'styles.js'), 'utf8');
  /** The declarations of one rule, as a normalised string. */
  const rule = (selector) => {
    const start = css.indexOf(`.${selector}{`);
    assert.equal(start >= 0, true, `${selector} 存在`);
    return css.slice(start, css.indexOf('}', start) + 1);
  };

  const field = rule('skc_marketSearchField');
  assert.match(field, /position:\s*relative/, '容器是定位上下文');
  assert.match(field, /flex:\s*1/, '弹性宽度从搜索框移到容器上');
  assert.match(field, /min-width:\s*120px/, '最小宽度也在容器上');
  assert.match(field, /align-items:\s*center/, '容器是行内 flex，输入框与 × 同高对齐');

  const search = rule('skc_marketSearch');
  assert.match(search, /padding-right:\s*32px/, '搜索框给 × 让出 32px（长关键词不压在按钮下）');
  assert.match(search, /box-sizing:\s*border-box/, 'border-box：32px 不许撑破 100% 宽');
  assert.match(search, /width:\s*100%/, '搜索框填满容器');
  assert.equal(/flex:\s*1/.test(search), false, '搜索框自己不再吃弹性宽度（那是容器的活）');

  const clear = rule('skc_marketClear');
  assert.match(clear, /position:\s*absolute/, '× 绝对定位在框内');
  assert.match(clear, /right:\s*5px/, '右沿 5px（与参考实现同值）');
  assert.match(clear, /top:\s*50%/, '垂直居中');
  assert.match(clear, /transform:\s*translateY\(-50%\)/, '位移一半高度');
  assert.match(clear, /width:\s*24px/, '24×24 点击区');
  assert.match(clear, /height:\s*24px/, '24×24 点击区');
  assert.match(clear, /border:\s*0/, '没有边框');
  assert.match(clear, /background:\s*0 0/, '透明底（不吃侧栏底色）');
  assert.equal(/(#[0-9a-f]{3,8}\b|rgba?\()/i.test(clear), false, '按钮规则里没有颜色字面量（只用令牌）');
});

test('K99 清空：提交空串并同时清掉输入框，且把焦点送回输入框', async () => {
  const store = createStore();
  store.actions.marketBootReady({ source: 'all', sources: [], categories: [], categoriesOk: true, total: 0, countsOk: true });
  store.actions.marketSetInput('ui');
  const calls = [];
  const mounted = mountHooks(MarketFilters, {
    market: store.getSnapshot().market,
    t,
    busy: false,
    onInput: (text) => { calls.push(['input', text]); store.actions.marketSetInput(text); },
    onCommit: (text) => { calls.push(['commit', text]); store.actions.marketCommitKeyword(text); },
    onFilter: () => {},
  });
  const tree = mounted.render();

  // The container's ref is a plain object in this harness: hand it a fake field so the
  // focus call inside `clear` has somewhere to land. The wiring under test is real.
  const fieldNode = find(tree, 'skc_marketSearchField');
  assert.notEqual(fieldNode, null, '找到容器');
  let focused = 0;
  const fakeInput = { focus: () => { focused += 1; } };
  // React keeps `ref` on the element, not in its props (it is not a DOM attribute).
  const fieldRef = fieldNode.ref ?? fieldNode.props.ref;
  assert.equal(typeof fieldRef, 'object', '容器持有的是 ref 对象（useRef）');
  fieldRef.current = { querySelector: (selector) => (selector === 'input' ? fakeInput : null) };

  const clearButton = find(tree, 'skc_marketClear');
  assert.notEqual(clearButton, null, '有文字 ⇒ 有 ×');
  clearButton.props.onClick();

  assert.deepEqual(calls, [['input', ''], ['commit', '']], '先清输入框、再提交空关键词（顺序不能反）');
  const market = store.getSnapshot().market;
  assert.equal(market.input, '', '输入框为空');
  assert.equal(market.keyword, '', '查询也为空');
  assert.equal(focused, 1, '焦点回到输入框（键盘用户不用从头 Tab）');
});

test('K99 Enter：IME 组字中不提交，组字结束才提交；keyCode 229 也算组字', async () => {
  const commits = [];
  const mounted = mountHooks(MarketFilters, {
    market: { ...createStore().getSnapshot().market, input: 'pinyin', bootScope: 'all' },
    t,
    busy: false,
    onInput: () => {},
    onCommit: (text) => commits.push(text),
    onFilter: () => {},
  });
  const tree = mounted.render();
  const input = find(tree, 'skc_marketSearch');
  assert.notEqual(input, null, '找到宿主 Input 的 props');

  input.props.onCompositionStart();
  const enter = (extra = {}) => ({
    key: 'Enter',
    preventDefault: () => {},
    nativeEvent: { isComposing: false },
    keyCode: 13,
    currentTarget: { value: 'pinyin' },
    ...extra,
  });
  input.props.onKeyDown(enter({ nativeEvent: { isComposing: true } }));
  assert.deepEqual(commits, [], '组字中按回车不提交半成品（中国用户必踩的那条）');

  input.props.onCompositionEnd({ currentTarget: { value: '拼音' } });
  input.props.onKeyDown(enter({ currentTarget: { value: '拼音' } }));
  assert.deepEqual(commits, ['拼音'], '组字结束后回车立即提交');

  // Windows IMEs report keyCode 229 with isComposing already false.
  commits.length = 0;
  input.props.onKeyDown(enter({ keyCode: 229 }));
  assert.deepEqual(commits, [], 'keyCode 229 也按组字处理');

  // A different key never commits.
  input.props.onKeyDown(enter({ key: 'a', keyCode: 65 }));
  assert.deepEqual(commits, [], '只有 Enter 提交');
});

/**
 * Mount with the unmount cleanup reachable, so a timer's fate can be observed.
 *
 * `mountHooks` above runs no effects (that is all the other cases need); a leak test has
 * to hold the cleanup returned by `useEffect` and call it when the component goes away.
 * @param {Function} component - the component.
 * @param {object} props - its props.
 * @returns {{render: (next?: object) => object, unmount: () => void}} a handle.
 */
function mountWithLifecycle(component, props) {
  const slots = [];
  const refs = [];
  const cleanups = [];
  const internals = ReactCjs.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const holder = internals.ReactCurrentDispatcher;
  const previous = holder.current;
  let current = props;
  const render = (next) => {
    if (next !== undefined) current = next;
    let index = 0;
    let refIndex = 0;
    holder.current = {
      useEffect(fn) {
        const cleanup = fn();
        if (typeof cleanup === 'function') cleanups.push(cleanup);
      },
      useRef(initial) {
        const at = refIndex;
        refIndex += 1;
        if (!(at in refs)) refs[at] = { current: initial };
        return refs[at];
      },
      useState(initial) {
        const at = index;
        index += 1;
        if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial;
        const set = (value) => { slots[at] = typeof value === 'function' ? value(slots[at]) : value; };
        return [slots[at], set];
      },
    };
    try {
      return component(current);
    } finally {
      holder.current = previous;
    }
  };
  return {
    render,
    unmount: () => {
      while (cleanups.length > 0) cleanups.pop()();
    },
  };
}

/** A store, a mounted toolbar and the handler log, for the debounce cases. */
function debounceRig() {
  const store = createStore();
  store.actions.marketBootReady({ source: 'all', sources: [], categories: [], categoriesOk: true, total: 0, countsOk: true });
  const calls = [];
  const props = {
    market: store.getSnapshot().market,
    t,
    busy: false,
    onInput: (text) => { calls.push(['input', text]); store.actions.marketSetInput(text); },
    onCommit: (text) => { calls.push(['commit', text]); store.actions.marketCommitKeyword(text); },
    onFilter: () => {},
  };
  const mounted = mountWithLifecycle(MarketFilters, props);
  const redraw = () => mounted.render({ ...props, market: store.getSnapshot().market });
  return { store, calls, mounted, redraw };
}

/** Wait long enough for the 250ms debounce to have fired or not. */
const pastDebounce = () => new Promise((resolve) => { setTimeout(resolve, 400); });

test('K99 清空原子性：打字后 250ms 内点 ×，在飞的旧词不许晚到把列表再过滤一遍', async () => {
  const rig = debounceRig();
  const input = find(rig.redraw(), 'skc_marketSearch');
  input.props.onChange({ target: { value: 'abc' }, currentTarget: { value: 'abc' } });

  const fieldNode = find(rig.redraw(), 'skc_marketSearchField');
  const fieldRef = fieldNode.ref ?? fieldNode.props.ref;
  fieldRef.current = { querySelector: () => ({ focus: () => {} }) };
  const clearButton = find(rig.redraw(), 'skc_marketClear');
  assert.notEqual(clearButton, null, '有文字 ⇒ 有 ×');
  clearButton.props.onClick();
  await pastDebounce();

  assert.deepEqual(
    rig.calls,
    [['input', 'abc'], ['input', ''], ['commit', '']],
    '只提交一次，而且提交的是空串（排队的 abc 必须被取消）',
  );
  const market = rig.store.getSnapshot().market;
  assert.equal(market.keyword, '', '查询是空的');
  assert.equal(market.input, '', '输入框也是空的（旧词不许自己填回来）');
});

test('K99 清空后立刻输入新词：上一轮的计时器不许把新词覆盖成旧词', async () => {
  const rig = debounceRig();
  const first = find(rig.redraw(), 'skc_marketSearch');
  first.props.onChange({ target: { value: 'abc' }, currentTarget: { value: 'abc' } });

  const clearButton = find(rig.redraw(), 'skc_marketClear');
  clearButton.props.onClick();
  const second = find(rig.redraw(), 'skc_marketSearch');
  second.props.onChange({ target: { value: 'xy' }, currentTarget: { value: 'xy' } });
  await pastDebounce();

  const commits = rig.calls.filter(([kind]) => kind === 'commit').map(([, text]) => text);
  assert.deepEqual(commits, ['', 'xy'], '提交的是空串与新词，绝没有 abc');
  assert.equal(rig.store.getSnapshot().market.keyword, 'xy', '列表按新词过滤');
});

test('K99 卸载后计时器不触发：切走页签不会拿旧词去打一次查询', async () => {
  const rig = debounceRig();
  const input = find(rig.redraw(), 'skc_marketSearch');
  input.props.onChange({ target: { value: 'abc' }, currentTarget: { value: 'abc' } });
  rig.mounted.unmount();
  await pastDebounce();
  assert.deepEqual(
    rig.calls.filter(([kind]) => kind === 'commit'),
    [],
    '组件卸载后，排队的提交一次都不许发',
  );
});
