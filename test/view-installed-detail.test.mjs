/**
 * L3 — `src/client/installed-detail.jsx` and `src/client/markdown.jsx` on their own:
 * the three states of the body, the two truncation notices, the version tag, and the
 * read-only shape of a symlinked skill.
 *
 * Contract: `docs/contracts/installed-detail.md` (page structure, states, 19 keys),
 * `docs/contracts/acceptance.md` 附录 D.5 K112 (the two flags on screen), K113 (body
 * rendering and its fallback), K114 (the version tag).
 *
 * Rendering is string-only, plus one structural pass: the component holds no hooks of its
 * own (`CopyName` is a child element, never invoked here), so `InstalledDetail(props)`
 * can be called directly to reach a handler - that is how "point it, it asks again" is
 * asserted without a DOM.
 */
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ROOT, loadClientModules, zhTranslator } from './helpers/ssr.mjs';

/** Bundled modules under test. */
let modules;
/** Chinese translator. */
let t;

before(async () => {
  modules = await loadClientModules(['installedDetail', 'markdown']);
  t = await zhTranslator();
});

/** The file section's heading, matched as markup: the bare word also occurs inside other labels. */
const FILES_HEADING = `<h4 class="skc_marketSectionTitle">${'文件'}</h4>`;

/** One installed row, with the fields the detail view reads. */
function row(overrides = {}) {
  return {
    name: 'ui-design',
    description: 'Comprehensive UI design skill.',
    displayName: null,
    provider: 'filesystem',
    partition: 'installed',
    rule: 'R7',
    confidence: 'high',
    symlink: false,
    path: '/skills/ui-design/SKILL.md',
    realPath: null,
    enabled: true,
    writable: true,
    readonlyReason: null,
    upstream: null,
    version: null,
    ...overrides,
  };
}

/** A `SkillContent` as the route answers it. */
function content(overrides = {}) {
  return {
    name: 'ui-design',
    path: '/skills/ui-design/SKILL.md',
    size: 26,
    truncated: false,
    body: '# Heading\n\nOne paragraph.\n',
    files: [{ path: 'SKILL.md', size: 26 }],
    filesTruncated: false,
    ...overrides,
  };
}

/**
 * The props the page hands the detail view.
 * @param {{row?: object, status?: string, data?: object|null, title?: string}} [setup] - overrides.
 * @returns {object} props.
 */
function props(setup = {}) {
  const target = setup.row ?? row();
  const status = setup.status ?? 'ready';
  return {
    detail: {
      key: `${target.provider}#${target.name}`,
      status,
      data: status === 'ready' ? (setup.data ?? content()) : null,
      code: status === 'error' ? 'E_INTERNAL' : null,
    },
    row: setup.row === undefined ? target : setup.row,
    rows: new Map(),
    t,
    status,
    iconUrl: null,
    title: setup.title ?? 'UI 设计规范',
    onBack: () => {},
    onRetry: () => {},
    onToggle: () => {},
  };
}

/**
 * Render the detail view.
 * @param {object} [setup] - overrides for `props()`.
 * @returns {string} markup.
 */
function render(setup = {}) {
  return renderToStaticMarkup(createElement(modules.installedDetail.InstalledDetail, props(setup)));
}

/**
 * Every element of a rendered tree, depth first.
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
  elementsOf(node.props?.children, found);
  return found;
}

/* ---------------------------------------------------------------- K113 · 三态与兜底 */

test('K113 loading：正文段只说「正在读取」，没有正文、没有重试', () => {
  const html = render({ status: 'loading' });
  assert.ok(html.includes('正在读取技能正文…'), '正文段显示 detail.loading');
  assert.equal(html.includes('data-stub-markdown'), false, '加载中没有正文渲染器');
  assert.equal(html.includes('role="alert"'), false, '加载中不是错误态');
  assert.equal(html.includes('>重试<'), false, '加载中没有重试按钮');
});

test('K113 error：alert 一行 + 重试按钮，点它重新发一次请求', () => {
  const html = render({ status: 'error' });
  assert.ok(/<p class="skc_marketError" role="alert">/.test(html), '失败原因是 alert');
  assert.ok(html.includes('读不到这个技能的正文'), '文案是 detail.error');
  assert.equal(html.includes('data-stub-markdown'), false, '失败时不渲染正文');

  // 直接调用组件拿到元素树（这个组件本体不含 hook），再点那个重试按钮。
  let retried = 0;
  const base = props({ status: 'error' });
  const tree = modules.installedDetail.InstalledDetail({ ...base, onRetry: () => { retried += 1; } });
  const retry = elementsOf(tree).find((element) => element.props?.children === t('detail.retry'));
  assert.ok(retry !== undefined, '树里有 detail.retry 按钮');
  assert.equal(typeof retry.props.onClick, 'function', '重试是普通按钮（宿主 Button，带自己的 onClick）');
  assert.equal(retry.props.variant, 'outline', '重试沿用详情页的次要按钮样式');
  retry.props.onClick();
  assert.equal(retried, 1, '点重试触发一次 onRetry（页面据此重新发请求）');
});

test('K113 body === null：detail.noBody 纯文案，不是错误态、没有重试', () => {
  const html = render({ data: content({ body: null, size: null, path: null }) });
  assert.ok(html.includes('这个技能没有可读的正文文件'), '显示 detail.noBody');
  assert.equal(html.includes('role="alert"'), false, '没有可读文件不是错误');
  assert.equal(html.includes('>重试<'), false, '也不给重试');
  assert.equal(html.includes('data-stub-markdown'), false, '没有正文就不过渲染器');
});

test('K113 正文非空：走 MarkdownText，兜底是同文本的纯段落', () => {
  const html = render({ data: content({ body: '## 小标题\n\n- 一项\n' }) });
  assert.ok(html.includes('data-stub-markdown="body"'), '正文进了宿主 markdown 渲染器');
  assert.ok(html.includes('## 小标题'), '渲染器拿到的是原文（node 里 stub 不做语法，只证明接线）');
  assert.ok(/<div class="skc_detailBody">/.test(html), '正文外层是详情族的正文刻度');

  // 兜底段落：结构上是一段纯文本，类名由调用方给（每个调用方守自己的字阶）。
  const block = modules.markdown.MarkdownBlock({ text: '## x', fallbackClassName: 'detailBody' });
  const fallback = block.props.fallback;
  assert.equal(fallback.type, 'p', '兜底是段落');
  assert.equal(fallback.props.className, 'skc_detailBody', '兜底沿用详情正文的类名');
  assert.equal(fallback.props.children, '## x', '兜底显示原文，不做任何解析');
});

test('K113 渲染器抛错：边界换成兜底，面板不跟着炸', () => {
  const { MarkdownBoundary } = modules.markdown;
  assert.equal(typeof MarkdownBoundary, 'function', 'markdown.jsx 导出 MarkdownBoundary');
  assert.deepEqual(MarkdownBoundary.getDerivedStateFromError(), { failed: true }, '错误一律落到 failed');

  const found = new MarkdownBoundary({ fallback: 'FALLBACK', children: 'BODY' });
  assert.equal(found.render(), 'BODY', '正常时渲染 children');
  found.state = { failed: true };
  assert.equal(found.render(), 'FALLBACK', '失败之后渲染兜底');
});

test('K113 两页共用一个实现：两个详情都 import markdown.jsx，市场页不再自带边界', async () => {
  const installed = await readFile(join(ROOT, 'src', 'client', 'installed-detail.jsx'), 'utf8');
  const market = await readFile(join(ROOT, 'src', 'client', 'market-detail.jsx'), 'utf8');
  const markdown = await readFile(join(ROOT, 'src', 'client', 'markdown.jsx'), 'utf8');
  for (const [name, source] of [['installed-detail.jsx', installed], ['market-detail.jsx', market]]) {
    assert.match(source, /import \{ MarkdownBlock \} from '\.\/markdown\.jsx'/, `${name} 从 markdown.jsx 取 MarkdownBlock`);
    assert.equal(source.includes('getDerivedStateFromError'), false, `${name} 不再自己定义容错边界`);
    assert.equal(source.includes('componentDidCatch'), false, `${name} 没有第二套错误边界`);
  }
  assert.match(markdown, /export class MarkdownBoundary/, '边界只有 markdown.jsx 一份');
  assert.match(markdown, /MarkdownText/, '共享单元渲染的就是宿主 MarkdownText');
  // 两个调用点都必须把 `t` 交进去：漏了不会崩（identity 回落），但代码卡会显示
  // `markdown.codeCopy` 这种原始键名——静默退化成「界面里冒出键」。
  for (const [name, source] of [['installed-detail.jsx', installed], ['market-detail.jsx', market]]) {
    const call = /<MarkdownBlock[^>]*\/>/.exec(source);
    assert.ok(call !== null, `${name} 里有一处 MarkdownBlock 调用`);
    assert.match(call[0], /\st=\{t\}/, `${name} 把 t 交给 MarkdownBlock（否则 labels 回落成键名）`);
  }
});

/* ------------------------------------------------- K112 · 两个截断标志上屏 */

test('K112 truncated 上屏：正文之后的纯文案，正文段以内', () => {
  const html = render({ data: content({ truncated: true, size: 480_079 }) });
  const at = html.indexOf('正文过长，只显示前 256 KiB');
  assert.notEqual(at, -1, 'detail.truncated 出现在页面上');
  assert.ok(html.indexOf('class="skc_detailBody"') < at, '这句在正文之后');
  assert.ok(at < html.indexOf(FILES_HEADING), '这句仍在正文段内（文件段标题之前）');
  assert.ok(html.includes('data-stub-markdown'), '被截断的正文照样渲染（只是前 256 KiB）');
});

test('K112 truncated 不上屏：没有截断就没有这句', () => {
  const html = render({ data: content() });
  assert.equal(html.includes('正文过长'), false, 'truncated:false 时不出现提示');
});

test('K112 filesTruncated 上屏：文件列表之后的纯文案', () => {
  const html = render({ data: content({ filesTruncated: true }) });
  const at = html.indexOf('文件过多，只列出前 200 个');
  assert.notEqual(at, -1, 'detail.filesTruncated 出现在页面上');
  assert.ok(html.indexOf('class="skc_marketFiles"') < at, '这句在文件列表之后');
  assert.ok(at < html.indexOf('</section>', html.indexOf(FILES_HEADING)), '这句在文件段之内');
});

test('K112 files 为空：文件段整段不渲染，那句也不出现', () => {
  const html = render({ data: content({ files: [], filesTruncated: true }) });
  assert.equal(html.includes(FILES_HEADING), false, '没有清单就没有文件段标题');
  assert.equal(html.includes('class="skc_marketFiles"'), false, '也没有列表');
  assert.equal(html.includes('文件过多'), false, '没有清单就无从截断，这句不出现');
});

/* ---------------------------------------------------------- K114 · 版本 Tag */

test('K114 有版本才画 Tag：值原样，位置在标题之后', () => {
  const html = render({ row: row({ version: '2.1.0' }) });
  assert.ok(html.includes('<span data-tone="neutral">2.1.0</span>'), '版本原样进 Tag');
  const titleAt = html.indexOf('class="skc_marketDetailTitle"');
  assert.ok(titleAt !== -1 && titleAt < html.indexOf('>2.1.0<'), 'Tag 跟标题同一行、在标题之后');
});

test('K114 无版本不画 Tag：不写「未知」，也不留空壳', () => {
  for (const version of [null, undefined, '']) {
    const html = render({ row: row({ version }) });
    assert.equal(html.includes('data-tone="neutral"'), false, `version=${String(version)} 时没有版本 Tag`);
    assert.equal(html.includes('未知'), false, '不写「未知」');
  }
});

test('K114 非字符串版本不画：渲染层只认字符串（扫描层已把坏值归一成 null）', () => {
  for (const version of [42, 0, { major: 1 }, ['1.0.0']]) {
    const html = render({ row: row({ version }) });
    assert.equal(html.includes('data-tone="neutral"'), false, `version=${JSON.stringify(version)} 时没有版本 Tag`);
  }
  // `>64` 字符的归一发生在扫描层（`test/scan.test.mjs` 的 K114 用例），页面只负责
  // 「有字符串就画、没有就不画」，所以这里不重复钉那条边界。
});

/* ------------------------------------------------- 页面结构（installed-detail.md） */

test('详情页头：软链行只读、没有开关，事实表里有真实位置', () => {
  const html = render({
    row: row({
      symlink: true,
      path: null,
      realPath: '/Users/me/Skills/ui-design/SKILL.md',
      writable: false,
      readonlyReason: 'symlink',
      partition: 'local',
    }),
  });
  assert.equal(html.includes('role="switch"'), false, '软链行的详情头没有开关（硬约束 5 的第二层）');
  assert.ok(html.includes('<span class="skc_roTag"'), '只读标记是 span，不是控件');
  assert.ok(html.includes('软链·只读'), '标记文案');
  assert.ok(html.includes('<dt>真实位置</dt>'), '事实表有「真实位置」一行');
  assert.ok(html.includes('<code>/Users/me/Skills/ui-design/SKILL.md</code>'), '真实位置是等宽路径');
  assert.ok(html.includes('本地'), '分区 Tag 是「本地」');
});

test('详情页头：行没了只渲染面包屑 + E_NOT_FOUND，不抛异常', () => {
  const html = render({ row: null, status: 'ready' });
  assert.ok(html.includes('data-skc-detail-missing'), '失效态有它自己的挂点');
  assert.ok(html.includes('返回已安装'), '面包屑仍在（唯一返回入口）');
  assert.ok(/role="alert"/.test(html), '失效信息是 alert');
  assert.ok(html.includes(t('error.E_NOT_FOUND')), '文案是 error.E_NOT_FOUND');
  assert.equal(html.includes('data-stub-markdown'), false, '失效态不渲染正文');
});

test('详情页的调用名可选中、等宽，复制按钮是普通按钮（不开第二套点击层）', () => {
  const html = render();
  assert.ok(/<code class="skc_detailCallName">ui-design<\/code>/.test(html), '调用名是 code');
  const copy = /<button type="button" aria-label="复制调用名" title="复制调用名">/.exec(html);
  assert.ok(copy !== null, '复制是一个带 aria-label 的普通按钮');
  assert.equal(/skc_cardOpen/.test(html), false, '详情页内部复用行的整行点击层');
  assert.equal(/<a\b/.test(html), false, '详情页没有链接');
  assert.equal((html.match(/role="switch"/g) ?? []).length, 1, '可写行的详情头恰好一个开关');
});

test('K113 宿主的 MarkdownText 必须拿到 labels：代码围栏读 `labels.code`，缺了就整段回落', async () => {
  // 真机证据（2026-11-10，隔离 DSH_HOME + CDP）：正文里只要有一个 ``` 围栏，宿主渲染器就在
  // `context.labels.code.copyLabel` 上抛 `TypeError: Cannot read properties of undefined
  // (reading 'code')`，边界接住后整段变成纯文本——表格、列表、代码块一起消失（截图见
  // `.agents/work/scratch/qa-u1-detail.png`）。纯表格 / 列表的正文正常渲染，所以这条只能靠
  // 「传了 labels」来钉：node 里的 stub 不做语法解析，测不出这个崩溃。
  const markdown = await readFile(join(ROOT, 'src', 'client', 'markdown.jsx'), 'utf8');
  const call = /<MarkdownText[^>]*\/>/.exec(markdown);
  assert.ok(call !== null, 'markdown.jsx 里有一处 MarkdownText 调用');
  assert.match(call[0], /\slabels=\{/, 'MarkdownText 收到 labels（宿主渲染代码块要读 labels.code）');
  assert.equal(/labels=\{undefined\}/.test(call[0]), false, 'labels 不是 undefined');
});
