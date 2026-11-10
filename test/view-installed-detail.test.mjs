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

test('K114 有版本才画 Tag：文本是 v{version}（走 market.metaVersion，不自拼 v）', async () => {
  const html = render({ row: row({ version: '2.1.0' }) });
  // H1 起版本写成宿主的 `v{version}` 形态，并且必须复用字典键：手拼 `"v" + version` 会让
  // 英文界面与本地化脱钩，所以这里同时钉「渲染结果」和「用的是哪个键」。
  assert.ok(html.includes('<span data-tone="neutral">v2.1.0</span>'), '版本 Tag 的文本是 v2.1.0');
  assert.equal(html.includes('>2.1.0<'), false, '不是裸版本号（前缀不是手拼丢掉的）');
  const titleAt = html.indexOf('class="skc_marketDetailTitle"');
  assert.ok(titleAt !== -1 && titleAt < html.indexOf('>v2.1.0<'), 'Tag 跟标题同一行、在标题之后');

  const source = await readFile(join(ROOT, 'src', 'client', 'installed-detail.jsx'), 'utf8');
  assert.match(source, /t\('market\.metaVersion', \{ version: row\.version \}\)/, '版本 Tag 走 market.metaVersion（不是 "v" + row.version）');
  assert.equal(/"v" \+|`v\$\{/.test(source), false, '源码里没有手拼的 v 前缀');
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
  assert.ok(html.includes('>技能<'), '面包屑仍在（唯一返回入口，文案是 detail.back =「技能」）');
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

/* ------------------------------- H1 头排：按宿主「插件详情页」的结构重排（2026-11-10） */

/** An installed row with an upstream identity, version and author line. */
function marketRow(overrides = {}) {
  return row({
    name: 'dev-god',
    partition: 'installed',
    rule: 'R7',
    upstream: { sourceId: 'skillhub', owner: 'ake', slug: 'dev-god' },
    version: '1.2.4',
    ...overrides,
  });
}

test('H1 头排顺序：detailTop（图标 + 动作组）在 detailIntro（标题/作者/描述）之前', () => {
  const html = render({ row: marketRow(), title: '编程大神' });
  const top = html.indexOf('class="skc_detailTop"');
  const intro = html.indexOf('class="skc_detailIntro"');
  assert.notEqual(top, -1, '头排有 detailTop');
  assert.notEqual(intro, -1, '第二组有 detailIntro');
  assert.ok(top < intro, 'detailTop 在 detailIntro 之前');
  // detailTop 里是图标 + 动作组，且顺序也是图标在前。
  const topBlock = html.slice(top, intro);
  // 详情头用 49 的修饰类（宿主读数 49×49）；列表行仍是 48，不带这个类。
  const iconTag = /<span class="skc_cardIcon skc_detailIcon"/.exec(topBlock);
  assert.ok(iconTag !== null, 'detailTop 里的图标带 .skc_detailIcon（49）');
  assert.equal((html.match(/skc_detailIcon/g) ?? []).length, 1, '整页只有详情头这一个 49 图标');
  assert.ok(topBlock.indexOf('skc_detailIcon') < topBlock.indexOf('class="skc_detailActions"'), '图标在动作组左边');
  // detailIntro 里是 标题行 → 作者 → 描述。
  const introBlock = html.slice(intro);
  const titleRow = introBlock.indexOf('class="skc_marketTitleRow"');
  const author = introBlock.indexOf('class="skc_detailAuthor"');
  const desc = introBlock.indexOf('class="skc_marketDetailDesc"');
  assert.ok(titleRow !== -1 && titleRow < author && author < desc, '标题行 → 作者 → 描述');
});

test('H1 动作组：卸载在前、开关在后，开关仍是 role="switch"', () => {
  const html = render({ row: marketRow() });
  const actions = /<div class="skc_detailActions">([\s\S]*?)<\/div><\/div>/.exec(html);
  assert.ok(actions !== null, '有动作组');
  const block = actions[1];
  const uninstall = block.indexOf('title="卸载功能尚未支持"');
  const toggle = block.indexOf('skc_bundleToggle');
  assert.notEqual(uninstall, -1, '动作组里有卸载');
  assert.notEqual(toggle, -1, '动作组里有开关');
  assert.ok(uninstall < toggle, '卸载在开关左边（与宿主同序）');
  assert.equal((html.match(/role="switch"/g) ?? []).length, 1, '整页只有一个开关，且在动作组里');
});

test('H1 软链行：动作组里是只读标记，没有开关', () => {
  const html = render({
    row: row({
      name: 'linked-demo',
      partition: 'local',
      symlink: true,
      path: null,
      realPath: '/Users/me/Skills/linked-demo/SKILL.md',
      writable: false,
      readonlyReason: 'symlink',
    }),
  });
  const block = /<div class="skc_detailActions">([\s\S]*?)<\/div><\/div>/.exec(html);
  assert.ok(block !== null, '软链行也有动作组');
  assert.ok(block[1].includes('class="skc_roTag"'), '动作组里是 roTag');
  assert.equal(/role="switch"/.test(block[1]), false, '动作组里没有开关');
  assert.ok(block[1].includes('title="卸载功能尚未支持"'), '卸载占位仍在（对所有行都画）');
});

test('H1 卸载是 disabled 占位：type=button、title=卸载功能尚未支持、没有 onClick', () => {
  const html = render({ row: marketRow() });
  // 宿主那支卸载按钮是「红字 + 30% 红内环」，走 .skc_detailDanger 这条修饰类；仍然没有 handler。
  const tag = /<button type="button" class="[^"]*skc_detailDanger[^"]*" disabled="" title="卸载功能尚未支持">/.exec(html);
  assert.ok(tag !== null, '卸载渲染成 type=button + disabled + 那句 title + .skc_detailDanger');
  assert.ok(html.includes('>卸载</button>'), '按钮文字是 detail.uninstall =「卸载」');
  // SSR 会把 handler 丢掉，所以「没有 onClick」只能在元素树上验。
  const tree = modules.installedDetail.InstalledDetail(props({ row: marketRow() }));
  const uninstall = elementsOf(tree).find((element) => element.props?.children === t('detail.uninstall'));
  assert.ok(uninstall !== undefined, '元素树里有卸载按钮');
  assert.equal(uninstall.props.disabled, true, '是 disabled');
  assert.equal(uninstall.props.onClick, undefined, '没有 onClick（点了什么都不会发生）');
  assert.equal(uninstall.props.title, '卸载功能尚未支持', 'title 说明它还没做');
  assert.equal(uninstall.props['aria-label'], undefined, '没有额外的 aria-label（文案就是按钮文字）');
});

test('H1 作者行：upstream 非空时是 @owner/slug，为空时整段不渲染', () => {
  const withUpstream = render({ row: marketRow() });
  assert.ok(withUpstream.includes('<p class="skc_detailAuthor">@ake/dev-god</p>'), '作者行是 @owner/slug');
  assert.equal(withUpstream.includes('>@undefined'), false, '不会拼出 undefined');

  const bare = render({ row: marketRow({ upstream: null }) });
  assert.equal(bare.includes('skc_detailAuthor'), false, '没有 upstream 就没有作者行');
  assert.equal(bare.includes('@ake'), false, '不写作者');
  assert.equal(bare.includes('未知'), false, '也不写「未知」');
});

test('H1 来源信息在文件清单之后（页尾），upstream 为空时整块不渲染', () => {
  const html = render({ row: marketRow() });
  const filesAt = html.indexOf('class="skc_marketFiles"');
  const sourceAt = html.indexOf(t('detail.sectionSource'));
  assert.notEqual(filesAt, -1, '有文件清单');
  assert.notEqual(sourceAt, -1, '有来源信息');
  assert.ok(filesAt < sourceAt, '来源信息在文件清单之后');
  assert.ok(sourceAt < html.lastIndexOf('</section>'), '来源信息是最后一段');
  assert.ok(html.includes('SkillHub · ake/dev-god'), '来源信息写的是「来源 · owner/slug」');

  const bare = render({ row: marketRow({ upstream: null }) });
  assert.equal(bare.includes(t('detail.sectionSource')), false, '没有 upstream 就没有来源信息整块');
});

test('H1 可交互元素清单：面包屑 / 复制 / 开关（错误态再加重试），卸载不在其中', () => {
  const html = render({ row: marketRow() });
  const enabled = [...html.matchAll(/<button(?![^>]*\sdisabled="")[^>]*>/g)].map((match) => match[0]);
  assert.equal(enabled.length, 3, `就绪态恰好三个可点的按钮（实测 ${enabled.length}）`);
  assert.match(enabled[0], /class="skc_marketCrumb"/, '面包屑');
  assert.match(enabled[1], /role="switch"/, '开关');
  assert.match(enabled[2], /aria-label="复制调用名"/, '复制调用名');
  assert.equal(enabled.some((tag) => /卸载/.test(tag)), false, '卸载不在可交互清单里（它是 disabled）');

  const errorHtml = render({ row: marketRow(), status: 'error' });
  const errorEnabled = [...errorHtml.matchAll(/<button(?![^>]*\sdisabled="")[^>]*>/g)];
  assert.equal(errorEnabled.length, 4, '错误态四个：面包屑 / 开关 / 复制 / 重试');
  assert.ok(/重试<\/button>/.test(errorHtml), '重试按钮在场');
});

/* ------------- H1 本轮（按宿主读数）：正文盒 / 区块节奏单源 / 卸载红环 ------------- */

test('H1 正文装在 .skc_detailBodyBox 里：文件清单与来源信息在盒外', () => {
  const tree = modules.installedDetail.InstalledDetail(props({ row: marketRow() }));
  const box = elementsOf(tree).find((element) => element.props?.className === 'skc_detailBodyBox');
  assert.ok(box !== undefined, '有正文盒 .skc_detailBodyBox');
  const inside = elementsOf(box).map((element) => String(element.props?.className ?? ''));
  assert.ok(inside.some((cls) => cls.includes('skc_detailBody')), '盒里有正文');
  // 宿主只把 README 关进盒子；文件清单与「来源信息」跟着页面滚，不在盒内。
  assert.equal(inside.some((cls) => cls.includes('skc_marketFiles')), false, '文件清单不在盒内');
  assert.equal(inside.some((cls) => cls.includes('skc_marketDetailSection')), false, '区块（含来源信息）不在盒内');
  assert.equal(inside.some((cls) => cls.includes('skc_marketSectionTitle')), false, '盒子不吞区块标题');
  // 盒子里只有正文这一块内容（多包一层就会多出第二个 div）
  const kids = Array.isArray(box.props.children) ? box.props.children : [box.props.children];
  assert.equal(kids.length, 1, '盒内只有正文一层');
});

test('H1 区块节奏单一来源：.skc_marketDetail gap 32、区块自己不留 margin', async () => {
  const css = await readFile(join(ROOT, 'src', 'client', 'styles.js'), 'utf8');
  const detailRule = /\.skc_marketDetail\{([^}]*)\}/.exec(css);
  assert.ok(detailRule !== null, '有 .skc_marketDetail 规则');
  assert.match(detailRule[1], /gap:\s*32px/, '父级 gap 32（与宿主的 detailSections 同值）');

  const sectionRule = /\.skc_marketDetailSection\{([^}]*)\}/.exec(css);
  assert.ok(sectionRule !== null, '有区块规则');
  // 上一轮是 margin-top:16 叠在 gap:16 上，现在 32 只能有一个来源：区块自己不许再带外边距。
  assert.equal(/margin/.test(sectionRule[1]), false, `区块规则里没有 margin（实测「${sectionRule[1].trim()}」）`);
  assert.match(sectionRule[1], /gap:\s*12px/, '区块内仍是 12（标题→内容）');

  // 「图标行 → 标题组 = 20」靠把这一组上提 12（32 − 12）；真机那条 20 由真机脚本钉。
  const introRule = /\.skc_detailIntro\{([^}]*)\}/.exec(css);
  assert.ok(introRule !== null, '有标题组规则');
  assert.match(introRule[1], /gap:\s*8px/, '标题组 gap 8');
  assert.match(introRule[1], /margin-top:\s*-12px/, '标题组上提 12');
});

test('H1 卸载红环不是 border：红字 + 1px 内环走 primitives 的两个 knob', async () => {
  const css = await readFile(join(ROOT, 'src', 'client', 'styles.js'), 'utf8');
  const block = /\.skc_detailDanger\{([^}]*)\}/.exec(css);
  assert.ok(block !== null, '有 .skc_detailDanger 规则');
  const body = block[1];
  // 宿主用 inset ring（0 0 0 1px）而不是 border——border 会多占 2px 盒宽，把按钮撑到 30。
  assert.equal(/(^|[\s;])border(?!-radius)(-[a-z]+)?\s*:/.test(body), false, '没有 border 声明（border-radius 不算）');
  assert.match(body, /--dsh-button-outline-color/, '红环走 outline 色 knob');
  assert.match(body, /--dsh-hairline-width:\s*1px/, '环宽走 1px 发丝 knob');
  assert.match(body, /color:\s*var\(--dsw-alias-state-error-primary\)/, '红字走 error token');
  assert.match(body, /height:\s*28px/, '高 28');
  assert.match(body, /padding:\s*0 10px/, '左右 10');
  assert.match(body, /line-height:\s*18px/, '行高 18');
  assert.match(body, /font-size:\s*12px/, '字号 12');
  assert.match(body, /border-radius:\s*8px/, '圆角 8');
  assert.match(body, /gap:\s*4px/, '图标与文字 4');
  assert.match(css, /\.skc_detailDanger:disabled\{[^}]*opacity:\s*\.4/, '禁用态只降透明度到 .4');
});

/* ------------- H1 本轮（结构回归）：正文盒紧跟描述，其余内容下移 ------------- */

test('H1 正文盒紧跟描述：中间不夹标签/事实/文件，盒前没有「概览」小标题', () => {
  const html = render({ row: marketRow(), title: '编程大神' });
  const desc = html.indexOf('class="skc_marketDetailDesc"');
  const box = html.indexOf('class="skc_detailBodyBox"');
  assert.notEqual(desc, -1, '有描述');
  assert.notEqual(box, -1, '有正文盒');
  assert.ok(desc < box, '正文盒在描述之后');
  const between = html.slice(desc, box);
  // 描述与正文盒之间只允许出现 reason（错误原因）；标签/事实/文件/区块一律不许插进来。
  for (const cls of ['skc_marketTags', 'skc_marketFacts', 'skc_marketFiles', 'skc_marketDetailSection', 'skc_marketSectionTitle']) {
    assert.equal(between.includes(cls), false, `描述与正文盒之间没有 .${cls}（实测夹了 ${cls}）`);
  }
  // 「概览」这个区块标题在已安装详情里已经不画了（market.detailOverview 只给市场详情）。
  assert.equal(html.includes(t('market.detailOverview')), false, '没有「概览」小标题');
  assert.equal((html.match(/skc_marketDetailSection/g) ?? []).length <= 2, true, '区块只剩文件与来源两段');
});

test('H1 盒后顺序：标签 → 事实表 → 文件 → 来源信息（后两者在盒外）', () => {
  const html = render({ row: marketRow(), title: '编程大神' });
  const box = html.indexOf('class="skc_detailBodyBox"');
  const tags = html.indexOf('class="skc_marketTags"');
  const facts = html.indexOf('class="skc_marketFacts"');
  const files = html.indexOf('class="skc_marketFiles"');
  const source = html.indexOf(t('detail.sectionSource'));
  assert.ok(box < tags, '标签行在正文盒之后');
  assert.ok(tags < facts, '事实表在标签行之后');
  assert.ok(facts < files, '文件清单在事实表之后');
  assert.ok(files < source, '来源信息在文件清单之后');

  // 盒里只有正文：标签、事实表、文件、来源都不在盒内。
  const tree = modules.installedDetail.InstalledDetail(props({ row: marketRow() }));
  const boxElement = elementsOf(tree).find((element) => element.props?.className === 'skc_detailBodyBox');
  const insideClasses = elementsOf(boxElement).map((element) => String(element.props?.className ?? ''));
  for (const cls of ['skc_marketTags', 'skc_marketFacts', 'skc_marketFiles', 'skc_marketDetailSection']) {
    assert.equal(insideClasses.some((value) => value.includes(cls)), false, `${cls} 不在正文盒内`);
  }
});
