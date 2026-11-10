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
    repoUrl: 'https://skillhub.cn/skills/ake/dev-god',
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
    check: setup.check ?? null,
    onCheck: () => {},
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

test('K112 truncated 上屏：正文之后的纯文案，正文盒以内', () => {
  const html = render({ data: content({ truncated: true, size: 480_079 }) });
  const at = html.indexOf('正文过长，只显示前 256 KiB');
  assert.notEqual(at, -1, 'detail.truncated 出现在页面上');
  assert.ok(html.indexOf('class="skc_detailBody"') < at, '这句在正文之后');
  // 「文件」区块已经删掉，判据换成「仍在正文盒内」：截断提示属于正文这一块。
  const boxStart = html.indexOf('class="skc_detailBodyBox"');
  const boxEnd = html.indexOf('</div>', html.lastIndexOf('class="skc_marketScope"', at) + 1);
  assert.ok(boxStart !== -1 && boxStart < at, '这句在正文盒里');
  assert.equal(html.includes(FILES_HEADING), false, '页面上没有「文件」区块标题');
  assert.ok(html.includes('data-stub-markdown'), '被截断的正文照样渲染（只是前 256 KiB）');
});

test('K112 truncated 不上屏：没有截断就没有这句', () => {
  const html = render({ data: content() });
  assert.equal(html.includes('正文过长'), false, 'truncated:false 时不出现提示');
});

test('K112 filesTruncated 不再上屏：页面上没有这句，但键仍在字典里', () => {
  const html = render({ data: content({ filesTruncated: true }) });
  // 「文件」区块整块删除：清单不再上屏，截断提示自然也没有落点；字典里的键保留（回滚要用）。
  assert.equal(html.includes('文件过多，只列出前 200 个'), false, 'detail.filesTruncated 不再出现在页面上');
  assert.equal(html.includes('class="skc_marketFiles"'), false, '页面上没有文件清单');
  assert.equal(html.includes(FILES_HEADING), false, '也没有文件段标题');
  assert.equal(typeof t('detail.filesTruncated'), 'string', '键还在字典里（不报原始键名）');
  assert.notEqual(t('detail.filesTruncated'), 'detail.filesTruncated', '字典里取得到这句文案');
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
  // 标题行里不许出现裸版本号；来源信息「当前版本」那一行的 dd 本来就是裸版本号（宿主同款）。
  const titleRowHtml = html.slice(html.indexOf('class="skc_marketTitleRow"'), html.indexOf('</h3>') + 5);
  assert.equal(titleRowHtml.includes('>2.1.0<'), false, '标题行里不是裸版本号（前缀不是手拼丢掉的）');
  assert.equal(html.includes(`<dt>${t('detail.factVersion')}</dt><dd><code>2.1.0</code></dd>`), true, '来源信息那句「当前版本」是裸版本号');
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

test('详情页头：软链行只读、没有开关，头部 roTag 是唯一说明（没有事实表）', () => {
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
  // 整页以宿主为准：技术事实表删掉了，软链只读只由这个标记说明。
  // 来源信息复用 `.skc_marketFacts` 那套刻度，所以这里合法的 1 个不判死，改成钉标签行。
  assert.equal(html.includes('class="skc_marketTags"'), false, '没有标签行');
  assert.equal(html.includes('真实位置'), false, '不出现「真实位置」文案');
  assert.equal(html.includes(`<dt>${t('detail.factProvider')}</dt>`), false, '不出现「提供者」行');
  // 路径只留在 roTag 的 title 里（宿主同款 tooltip），不再作为可见文本上屏。
  const realPath = '/Users/me/Skills/ui-design/SKILL.md';
  assert.equal(html.includes(`>${realPath}<`), false, '真实路径不作为可见文本出现');
  assert.equal(html.includes(`<code>${realPath}</code>`), false, '也不是等宽路径行（事实表已删）');
  assert.ok(html.includes(t('row.symlinkTitle', { path: realPath })), '只出现在 roTag 的 title 里');
  assert.equal(html.includes('本地'), false, '分区 Tag 行也删了，不再出现「本地」');
});

test('详情页头：行没了只渲染面包屑 + E_NOT_FOUND，不抛异常', () => {
  const html = render({ row: null, status: 'ready' });
  assert.ok(html.includes('data-skc-detail-missing'), '失效态有它自己的挂点');
  assert.ok(html.includes('>技能<'), '面包屑仍在（唯一返回入口，文案是 detail.back =「技能」）');
  assert.ok(/role="alert"/.test(html), '失效信息是 alert');
  assert.ok(html.includes(t('error.E_NOT_FOUND')), '文案是 error.E_NOT_FOUND');
  assert.equal(html.includes('data-stub-markdown'), false, '失效态不渲染正文');
});

test('详情页的调用名按宿主「包含的组件」行渲染：普通 <p>（不是等宽 code），复制仍是普通按钮', () => {
  const html = render();
  assert.ok(/<p class="skc_callName">ui-design<\/p>/.test(html), '名字是 <p class="skc_callName">');
  assert.equal(html.includes('skc_detailCallName'), false, '旧的等宽调用名类已删除');
  assert.equal(/<code>ui-design<\/code>/.test(html), false, '名字不再是 <code>（宿主那行是常规字体）');
  const copy = /<button type="button" aria-label="复制调用名" title="复制调用名">/.exec(html);
  assert.ok(copy !== null, '复制是一个带 aria-label 的普通按钮');
  assert.equal(/skc_cardOpen/.test(html), false, '详情页内部复用行的整行点击层');
  // 整行点击层仍然不是链接：详情里唯一的 <a> 是页尾那个「查看仓库」外链。
  const links = [...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]);
  assert.equal(links.length, 1, '详情页只有一个链接');
  assert.match(links[0], /class="skc_detailRepoLink"/, '那个链接就是查看仓库');
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

test('H1 页尾：正文盒 → 调用名 → 版本 → 来源信息 → 查看仓库；本地行没有版本区块与仓库链接', () => {
  const html = render({ row: marketRow() });
  const boxAt = html.indexOf('class="skc_detailBodyBox"');
  const callAt = html.indexOf('class="skc_callRow"');
  const versionAt = html.indexOf(t('detail.sectionVersion'));
  const sourceAt = html.indexOf(t('detail.sectionSource'));
  const repoAt = html.indexOf('class="skc_detailRepoLink"');
  assert.notEqual(callAt, -1, '有「调用名」区块');
  assert.notEqual(versionAt, -1, '有「版本」区块');
  assert.notEqual(sourceAt, -1, '有「来源信息」');
  assert.notEqual(repoAt, -1, '有「查看仓库」链接');
  assert.ok(boxAt < callAt, '调用名在正文盒之后');
  assert.ok(callAt < versionAt, '版本在调用名之后');
  assert.ok(versionAt < sourceAt, '来源信息在版本区块之后');
  assert.ok(sourceAt < repoAt, '查看仓库在来源信息之后（页尾最后一行）');
  assert.equal(html.includes('class="skc_marketFiles"'), false, '页面上没有文件清单');
  // 来源信息改成两行事实表
  assert.ok(html.includes(t('detail.factCodeSource')), '有「代码来源」行');
  assert.ok(html.includes(t('detail.factVersion')), '有「当前版本」行');

  // 路由对没有 upstream 的行给 repoUrl:null（客户端只透传，不自己拼），所以这里喂 null 看渲染。
  const bare = render({ row: marketRow({ upstream: null }), data: content({ repoUrl: null }) });
  // 来源信息恒渲染：本地行只剩代码来源一行（调用名已经独立成块）。
  assert.notEqual(bare.indexOf(t('detail.sectionSource')), -1, '没有 upstream 也有来源信息这一段');
  assert.equal(bare.includes(`<dt>${t('detail.callName')}</dt>`), false, '来源信息里不再有调用名那行');
  assert.notEqual(bare.indexOf('class="skc_callRow"'), -1, '调用名有自己的区块');
  assert.ok(bare.includes(`<dt>${t('detail.factCodeSource')}</dt><dd><code>/skills/ui-design</code></dd>`), '代码来源是目录（path 去掉文件名）');
  assert.equal(bare.includes('class="skc_detailRepoLink"'), false, 'repoUrl 是 null 就不渲染查看仓库');
  // 版本区块只属于市场装的行：本地/软链/内置整块不渲染，也不再出现「无法检查更新」。
  // 注意用标记而不是文案：「当前版本」里也含「版本」两个字。
  assert.equal(bare.includes(`<h4 class="skc_marketSectionTitle">${t('detail.sectionVersion')}</h4>`), false, '没有 upstream 就没有版本区块');
  assert.equal(bare.includes('skc_detailVersionHead'), false, '连版本区块的表头都没有');
  assert.equal(bare.includes(t('detail.checkUnavailable')), false, '页面里不出现「无法检查更新」');
});

test('H1 可交互元素清单：面包屑 / 复制 / 开关 / 重新检查（错误态加重试），卸载不在其中', () => {
  const html = render({ row: marketRow() });
  const enabled = [...html.matchAll(/<button(?![^>]*\sdisabled="")[^>]*>/g)].map((match) => match[0]);
  assert.equal(enabled.length, 4, `就绪态四个可点按钮（实测 ${enabled.length}）`);
  assert.match(enabled[0], /class="skc_marketCrumb"/, '面包屑');
  assert.match(enabled[1], /role="switch"/, '开关');
  // 顺序：复制按钮随调用名挪进「调用名」区块的行尾，DOM 上排在「重新检查」之前。
  assert.match(enabled[2], /aria-label="复制调用名"/, '第三个是行尾的复制');
  assert.ok(html.includes('>重新检查</button>'), '第四个是重新检查');
  // 复制按钮在 .skc_callRow 里、且在名字与描述之后（行尾）。
  const rowBlock = html.slice(html.indexOf('class="skc_callRow"'), html.indexOf('</section>', html.indexOf('class="skc_callRow"')));
  assert.ok(rowBlock.includes('aria-label="复制调用名"'), '复制按钮在调用名这一行里');
  assert.ok(rowBlock.indexOf('skc_callName') < rowBlock.indexOf('aria-label="复制调用名"'), '在名字之后');
  assert.ok(rowBlock.indexOf('skc_callDesc') < rowBlock.indexOf('aria-label="复制调用名"'), '在描述之后（行尾）');
  const introBlock = html.slice(html.indexOf('class="skc_detailIntro"'), html.indexOf('class="skc_detailBodyBox"'));
  assert.equal(introBlock.includes('aria-label="复制调用名"'), false, '标题组里不再有复制按钮');
  assert.ok(html.includes('>重新检查</button>'), '重新检查按钮带文案');
  assert.equal(/<button[^>]*disabled=""[^>]*>[^<]*重新检查/.test(html), false, '空闲时重新检查可点');
  assert.equal(enabled.some((tag) => /卸载/.test(tag)), false, '卸载不在可交互清单里（它是 disabled）');
  // 有 upstream 时页尾多一个外链——它是 <a>，不是按钮。
  assert.equal((html.match(/<a /g) ?? []).length, 1, '就绪态恰好一个链接（查看仓库）');

  const errorHtml = render({ row: marketRow(), status: 'error' });
  const errorEnabled = [...errorHtml.matchAll(/<button(?![^>]*\sdisabled="")[^>]*>/g)];
  assert.equal(errorEnabled.length, 5, '错误态五个：面包屑 / 开关 / 复制 / 重新检查 / 重试');
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
  // 正文盒之后的区块：市场装是 调用名 + 版本 + 来源信息 三段。
  assert.equal((html.match(/class="skc_marketDetailSection"/g) ?? []).length, 3, '区块恰好三段（调用名/版本/来源）');
});

test('H1 盒后顺序：标签 → 事实表 → 文件 → 来源信息（后两者在盒外）', () => {
  const html = render({ row: marketRow(), title: '编程大神' });
  const box = html.indexOf('class="skc_detailBodyBox"');
  const tags = html.indexOf('class="skc_marketTags"');
  const facts = html.indexOf('class="skc_marketFacts"');
  const version = html.indexOf(t('detail.sectionVersion'));
  const source = html.indexOf(t('detail.sectionSource'));
  const repo = html.indexOf('class="skc_detailRepoLink"');
  assert.ok(box < version, '版本区块在正文盒之后');
  assert.ok(version < source, '来源信息在版本区块之后');
  assert.ok(source < repo, '查看仓库在最后');

  // 盒里只有正文：标签、事实表、文件、来源都不在盒内。
  const tree = modules.installedDetail.InstalledDetail(props({ row: marketRow() }));
  const boxElement = elementsOf(tree).find((element) => element.props?.className === 'skc_detailBodyBox');
  const insideClasses = elementsOf(boxElement).map((element) => String(element.props?.className ?? ''));
  for (const cls of ['skc_marketTags', 'skc_marketFacts', 'skc_marketFiles', 'skc_marketDetailSection']) {
    assert.equal(insideClasses.some((value) => value.includes(cls)), false, `${cls} 不在正文盒内`);
  }
});

/* ---------------------- 版本区块 / 来源信息两行 / 查看仓库（本轮） ---------------------- */

/** The key the component uses to decide whether a verdict belongs to this row. */
const CHECK_KEY = 'filesystem#dev-god';
/** A fixed timestamp: the card prints HH:MM in the reader's zone, so the test formats it the same way. */
const CHECKED_AT = Date.UTC(2026, 10, 10, 6, 5);
/**
 * The version card's button element (it is the only button whose onClick is `onCheck`).
 * @param {object} setup - `props()` overrides.
 * @returns {object} the element.
 */
function checkButtonOf(setup) {
  const tree = modules.installedDetail.InstalledDetail(props(setup));
  const found = elementsOf(tree).filter((element) => element.type !== undefined
    && ['重新检查', '正在检查…'].includes(element.props?.children)
    && element.props?.onClick !== undefined);
  assert.equal(found.length, 1, '版本区块里恰好一个检查按钮');
  return found[0];
}

/** The same instant formatted with the implementation's own options (24-hour, no seconds). */
const checkedAtText = (at) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

test('版本区块：标题 + 重新检查，位置在事实表之后、来源信息之前', () => {
  const html = render({ row: marketRow() });
  const box = html.indexOf('class="skc_detailBodyBox"');
  const version = html.indexOf(t('detail.sectionVersion'));
  const source = html.indexOf(t('detail.sectionSource'));
  assert.notEqual(version, -1, '有「版本」区块');
  assert.ok(box < version, '版本区块在正文盒之后');
  assert.ok(version < source, '版本区块在来源信息之前');
  assert.ok(html.includes(`>${t('detail.checkAgain')}</button>`), '有「重新检查」按钮');
  assert.equal(html.includes(FILES_HEADING), false, '「文件」区块已经不存在');
  // 表头是标题 + 按钮同一行
  assert.ok(/class="skc_detailVersionHead"/.test(html), '表头是一个 detailVersionHead');
});

test('版本区块空闲态：写「尚未检查更新」，没有时间戳也没有 ✓', () => {
  const html = render({ row: marketRow() });
  assert.ok(html.includes(t('detail.checkIdle')), '卡内文案是 detail.checkIdle');
  assert.equal(html.includes(t('detail.checkedAt', { time: '9' }).slice(0, 4)), false, '没有「上次检查于」');
  assert.equal(html.includes('skc_detailVersionMark'), false, '没有 ✓ 圆底');
});

test('版本区块 upToDate：✓ 圆底 + 已是最新版本 + 上次检查于 HH:MM（24 小时制）', () => {
  const html = render({ row: marketRow(), check: { key: CHECK_KEY, status: 'upToDate', at: CHECKED_AT } });
  assert.ok(html.includes(t('detail.upToDate')), '卡内文案是 detail.upToDate');
  assert.ok(html.includes('class="skc_detailVersionMark"'), '有 ✓ 圆底');
  const shown = checkedAtText(CHECKED_AT);
  assert.match(shown, /^\d{2}:\d{2}$/, '时间是 24 小时制 HH:MM');
  assert.ok(html.includes(t('detail.checkedAt', { time: shown })), `显示「上次检查于 ${shown}」`);
});

test('版本区块 newer：写「有新版本 {version}」，不画 ✓', () => {
  const html = render({ row: marketRow(), check: { key: CHECK_KEY, status: 'newer', latestVersion: '9.9.9', at: CHECKED_AT } });
  assert.ok(html.includes(t('detail.newerVersion', { version: '9.9.9' })), '卡内文案带上游版本号');
  assert.equal(html.includes('class="skc_detailVersionMark"'), false, '有新版本时不画 ✓（不是「最新」）');
  assert.ok(html.includes(t('detail.checkedAt', { time: checkedAtText(CHECKED_AT) })), '仍然显示检查时间');
});

test('版本区块 error：写「检查失败，请重试」，按钮仍可点', () => {
  const html = render({ row: marketRow(), check: { key: CHECK_KEY, status: 'error', at: CHECKED_AT } });
  assert.ok(html.includes(t('detail.checkFailed')), '卡内文案是 detail.checkFailed');
  assert.ok(html.includes(`>${t('detail.checkAgain')}</button>`), '按钮回到「重新检查」');
  assert.equal(/<button[^>]*disabled=""[^>]*>[^<]*重新检查/.test(html), false, '失败后可以再点');
});

test('版本区块 unavailable：按钮禁用（没有来源或没有版本就没什么可查）', () => {
  const setup = { row: marketRow(), check: { key: CHECK_KEY, status: 'unavailable' } };
  assert.ok(render(setup).includes(t('detail.checkUnavailable')), '卡内文案是 detail.checkUnavailable');
  const button = checkButtonOf(setup);
  assert.equal(button.props.children, t('detail.checkAgain'), '按钮文字仍是「重新检查」');
  assert.equal(button.props.disabled, true, '按钮是 disabled');
});

test('版本区块 busy：按钮「正在检查…」并禁用，卡内保留上次结论', () => {
  const setup = {
    row: marketRow(),
    check: { key: CHECK_KEY, status: 'upToDate', at: CHECKED_AT, busy: true },
  };
  const button = checkButtonOf(setup);
  assert.equal(button.props.children, t('detail.checking'), '按钮文案变 detail.checking');
  assert.equal(button.props.disabled, true, '检查中按钮禁用');
  assert.ok(render(setup).includes(t('detail.upToDate')), '卡内仍是上一次的结论（不清空）');
});

test('版本区块不串台：结论的 key 不是这一行就不画', () => {
  const html = render({ row: marketRow(), check: { key: 'filesystem#other-skill', status: 'upToDate', at: CHECKED_AT } });
  assert.ok(html.includes(t('detail.checkIdle')), '别人的结论不落到这一页');
  assert.equal(html.includes(t('detail.upToDate')), false, '没有「已是最新版本」');
});

test('查看仓库：href 逐字等于路由给的 repoUrl，target=_blank + rel noopener', () => {
  const html = render({ row: marketRow() });
  const link = /<a class="skc_detailRepoLink" href="([^"]*)" target="([^"]*)" rel="([^"]*)">/.exec(html);
  assert.ok(link !== null, '页尾有一个 .skc_detailRepoLink 的 <a>');
  assert.equal(link[1], 'https://skillhub.cn/skills/ake/dev-god', 'href 就是路由给的 repoUrl（客户端不拼）');
  assert.equal(link[2], '_blank', '新窗口打开');
  assert.match(link[3], /noopener/, 'rel 含 noopener');
  assert.match(link[3], /noreferrer/, 'rel 含 noreferrer');
  assert.ok(html.includes(t('detail.viewRepo')), '链接文字是 detail.viewRepo');
});

test('来源信息两行：代码来源 owner/slug@version（等宽），当前版本单独一行', () => {
  const html = render({ row: marketRow() });
  const source = html.slice(html.indexOf(t('detail.sectionSource')));
  assert.ok(source.includes(`<dt>${t('detail.factCodeSource')}</dt><dd><code>ake/dev-god@1.2.4</code></dd>`), '代码来源是 owner/slug@version');
  assert.ok(source.includes(`<dt>${t('detail.factVersion')}</dt><dd><code>1.2.4</code></dd>`), '当前版本是 version');
  assert.ok(source.includes('class="skc_marketFacts"'), '两行复用事实表那套刻度');
});

test('来源信息：没有 version 时代码来源只有 owner/slug，当前版本整行不渲染', () => {
  const html = render({ row: marketRow({ version: null }) });
  const source = html.slice(html.indexOf(t('detail.sectionSource')));
  assert.ok(source.includes(`<dt>${t('detail.factCodeSource')}</dt><dd><code>ake/dev-god</code></dd>`), '没有 @version 尾巴');
  assert.equal(source.includes(t('detail.factVersion')), false, '没有版本就不画「当前版本」这一行');
});

/* ------------- 整页以宿主为准：分区 Tag 行与事实表整块删除（负向钉住） ------------- */

/** Every row shape that used to paint the tag row and the facts table. */
const DELETED_BLOCK_ROWS = [
  ['从市场安装', () => marketRow()],
  ['本地未分区', () => row({ partition: null })],
  ['软链只读', () => row({ symlink: true, path: null, realPath: '/Users/me/Skills/ui-design/SKILL.md', writable: false, readonlyReason: 'symlink', partition: 'local' })],
  ['no-file', () => row({ path: null, writable: false, readonlyReason: 'no-file', partition: 'local' })],
  ['内置', () => row({ provider: 'runtime', partition: 'builtin', path: null, writable: false, readonlyReason: 'provider-store' })],
];

test('不再出现标签行与事实表：.skc_marketTags / .skc_marketFacts / 文件区块全为 0', () => {
  for (const [shape, build] of DELETED_BLOCK_ROWS) {
    const html = render({ row: build() });
    assert.equal(html.includes('class="skc_marketTags"'), false, `${shape}：没有标签行`);
    assert.equal(html.includes('class="skc_marketTag"'), false, `${shape}：连单个 tag 也没有`);
    // `.skc_marketFacts` 现在只属于「来源信息」这一段，而且**恒渲染**：行数看有没有上游 / 版本。
    const factsCount = (html.match(/class="skc_marketFacts"/g) ?? []).length;
    assert.equal(factsCount, 1, `${shape}：来源信息恒渲染，事实表类恰好 1 个（实测 ${factsCount}）`);
    const factsBlock = html.slice(html.indexOf('class="skc_marketFacts"'), html.indexOf('</dl>', html.indexOf('class="skc_marketFacts"')));
    const rows = (factsBlock.match(/<dt>/g) ?? []).length;
    // 市场装：代码来源 + 当前版本 = 2；其余：代码来源 1 行（调用名已独立成块）。
    const expectedRows = shape === '从市场安装' ? 2 : 1;
    assert.equal(rows, expectedRows, `${shape}：来源信息 ${expectedRows} 行（实测 ${rows}）`);
    assert.equal(factsBlock.includes(`<dt>${t('detail.callName')}</dt>`), false, '来源信息里没有调用名那行');
    assert.ok(factsBlock.includes(t('detail.factCodeSource')), '第一行恒是代码来源');
    assert.equal(factsBlock.includes(t('detail.factPath')), false, '没有「技能文件」这一行');
    assert.equal(factsBlock.includes(t('detail.factProvider')), false, '没有「提供者」这一行');
    assert.equal(html.includes(FILES_HEADING), false, `${shape}：没有「文件」区块`);
    assert.equal(html.includes('class="skc_marketFiles"'), false, `${shape}：没有文件清单`);
    // 市场装三段（调用名 + 版本 + 来源信息）；本地/软链/内置两段（调用名 + 来源信息）。
    const sections = (html.match(/class="skc_marketDetailSection"/g) ?? []).length;
    assert.equal(sections, shape === '从市场安装' ? 3 : 2, `${shape}：区块 ${shape === '从市场安装' ? 3 : 2} 段（实测 ${sections}）`);
  }
});

test('两块被删后，那五句文案一句都不出现（分区名 / 事实表四个标签）', () => {
  const gone = ['技能文件', '提供者', '真实位置', '只读原因', '从市场安装', '这个技能没有可写的本地文件'];
  for (const [shape, build] of DELETED_BLOCK_ROWS) {
    const html = render({ row: build() });
    for (const text of gone) {
      // 「本地」只许出现在别的措辞里不受影响：这两块删掉后整页没有它。
      assert.equal(html.includes(text), false, `${shape}：不出现「${text}」`);
    }
  }
});

/* ------------- 来源信息恒渲染（调用名当第一行）与正文盒上下发丝线 ------------- */

test('来源信息恒渲染：无 upstream 无 version 只剩代码来源一行（调用名已独立成块）', () => {
  const html = render({ row: row({ upstream: null, version: null }), data: content({ repoUrl: null }) });
  const block = html.slice(html.indexOf('class="skc_marketFacts"'), html.indexOf('</dl>', html.indexOf('class="skc_marketFacts"')));
  assert.equal((block.match(/<dt>/g) ?? []).length, 1, '只剩代码来源一行');
  assert.equal(block.includes(`<dt>${t('detail.callName')}</dt>`), false, '来源信息里没有调用名');
  assert.ok(block.includes(`<dt>${t('detail.factCodeSource')}</dt><dd><code>/skills/ui-design</code></dd>`), '那一行是技能目录');
  // 调用名（含复制按钮）搬到了独立区块里。
  const callBlock = html.slice(html.indexOf('class="skc_callRow"'), html.indexOf('</section>', html.indexOf('class="skc_callRow"')));
  assert.ok(callBlock.includes('aria-label="复制调用名"'), '复制按钮在调用名行尾');
});

test('来源信息行数：市场装有 version = 2 行；市场装无 version / 本地 / 软链 / 内置 = 1 行', () => {
  const rowsOf = (html) => {
    const block = html.slice(html.indexOf('class="skc_marketFacts"'), html.indexOf('</dl>', html.indexOf('class="skc_marketFacts"')));
    return { count: (block.match(/<dt>/g) ?? []).length, block };
  };

  // 市场装、没有 version：调用名 + 代码来源（owner/slug），没有「当前版本」。
  const noVersion = rowsOf(render({ row: marketRow({ version: null }) }));
  assert.equal(noVersion.count, 1, '只有代码来源');
  assert.equal(noVersion.block.includes(t('detail.factVersion')), false, '没有 version 就没有「当前版本」');
  assert.ok(noVersion.block.includes(`<code>ake/dev-god</code>`), '代码来源是没有 @version 的 owner/slug');

  // 本地行：调用名 + 代码来源（目录）。
  const local = rowsOf(render({ row: row({ upstream: null, version: null }) }));
  assert.equal(local.count, 1, '本地行：只有代码来源目录');
  assert.ok(local.block.includes(t('detail.factCodeSource')), '代码来源这一行恒在');
  assert.equal(local.block.includes(t('detail.factVersion')), false, '本地行没有「当前版本」');

  const market = rowsOf(render({ row: marketRow() }));
  assert.equal(market.count, 2, '代码来源 + 当前版本');
  const labels = [...market.block.matchAll(/<dt>([^<]*)<\/dt>/g)].map((match) => match[1]);
  assert.deepEqual(labels, [t('detail.factCodeSource'), t('detail.factVersion')], '顺序：代码来源 → 当前版本');
});

test('标题组只剩三段：标题+版本 → 作者 → 描述（没有调用名行）', () => {
  const html = render({ row: marketRow() });
  const intro = html.slice(html.indexOf('class="skc_detailIntro"'), html.indexOf('class="skc_detailBodyBox"'));
  assert.equal(intro.includes('skc_detailIdentity'), false, '标题组里没有 detailIdentity');
  const order = ['skc_marketTitleRow', 'skc_detailAuthor', 'skc_marketDetailDesc'].map((cls) => intro.indexOf(cls));
  assert.ok(order.every((at) => at !== -1), '三段都在');
  assert.ok(order[0] < order[1] && order[1] < order[2], '标题 → 作者 → 描述');
  assert.equal(intro.includes('detailCallName'), false, '调用名等宽值不在标题组');
});

/* ------------- 代码来源四种取值 + 版本区块「只有市场装才有」 ------------- */

/** The `<dd>` that follows the 「代码来源」 label. */
const codeSourceDdOf = (html) => {
  const at = html.indexOf(`<dt>${t('detail.factCodeSource')}</dt>`);
  assert.notEqual(at, -1, '有「代码来源」这一行');
  const dd = html.slice(html.indexOf('<dd>', at));
  return dd.slice(0, dd.indexOf('</dd>') + 5);
};

test('代码来源四种取值逐字：owner/slug@version / owner/slug / link:<目录> / <目录> / 内置（纯文本）', () => {
  assert.equal(codeSourceDdOf(render({ row: marketRow() })), '<dd><code>ake/dev-god@1.2.4</code></dd>', '市场装：包规格带版本');
  assert.equal(codeSourceDdOf(render({ row: marketRow({ version: null }) })), '<dd><code>ake/dev-god</code></dd>', '市场装无版本：只有 owner/slug');

  const linked = render({ row: row({ symlink: true, path: null, realPath: '/Users/me/Skills/ui-design/SKILL.md', writable: false, readonlyReason: 'symlink' }) });
  assert.equal(codeSourceDdOf(linked), '<dd><code>link:/Users/me/Skills/ui-design</code></dd>', '软链：link: + 链接目标目录（不是链接本身）');

  const local = render({ row: row({}) });
  assert.equal(codeSourceDdOf(local), '<dd><code>/skills/ui-design</code></dd>', '本地目录：path 去掉文件名');

  const builtin = render({ row: row({ provider: 'runtime', partition: 'builtin', path: null, realPath: null, writable: false, readonlyReason: 'provider-store' }) });
  assert.equal(codeSourceDdOf(builtin), `<dd>${t('detail.sourceBuiltin')}</dd>`, '内置：纯文案，不是 <code>');
  assert.equal(codeSourceDdOf(builtin).includes('<code>'), false, '内置那一格没有 <code>');
});

test('`link:` 前缀只出现在软链行；目录末尾不带斜杠、也不含文件名', () => {
  const shapes = [
    render({ row: marketRow() }),
    render({ row: row({}) }),
    render({ row: row({ provider: 'runtime', partition: 'builtin', path: null, realPath: null, writable: false, readonlyReason: 'provider-store' }) }),
  ];
  for (const html of shapes) {
    assert.equal(codeSourceDdOf(html).includes('link:'), false, '非软链行没有 link: 前缀');
  }
  for (const html of [render({ row: row({}) }), render({ row: row({ symlink: true, path: null, realPath: '/Users/me/Skills/ui-design/SKILL.md' }) })]) {
    const value = codeSourceDdOf(html).replace(/<\/?[^>]+>/g, '');
    assert.equal(value.endsWith('/'), false, '目录末尾不带斜杠');
    assert.equal(value.endsWith('SKILL.md'), false, '不是 SKILL.md 的完整路径');
  }
});

test('版本区块只有市场装才渲染；upstream 为空时页面里连表头都没有', () => {
  const market = render({ row: marketRow() });
  assert.ok(market.includes('class="skc_detailVersionHead"'), '市场装有版本区块');
  assert.ok(market.includes(`<h4 class="skc_marketSectionTitle">${t('detail.sectionVersion')}</h4>`), '有「版本」标题');

  for (const shape of [
    row({ upstream: null }),
    row({ symlink: true, path: null, realPath: '/Users/me/Skills/ui-design/SKILL.md' }),
    row({ provider: 'runtime', partition: 'builtin', path: null, realPath: null }),
  ]) {
    const html = render({ row: shape, data: content({ repoUrl: null }) });
    assert.equal(html.includes('skc_detailVersionHead'), false, '没有版本区块表头');
    assert.equal(html.includes('skc_detailVersionCard'), false, '没有版本卡');
    assert.equal(html.includes(t('detail.checkUnavailable')), false, '不出现「无法检查更新」');
    assert.equal(html.includes(`>${t('detail.checkAgain')}</button>`), false, '也没有「重新检查」按钮');
  }
});

test('市场装无版本：版本区块仍在，卡内写「无法检查更新」且按钮禁用', () => {
  const html = render({ row: marketRow({ version: null }), check: { key: 'filesystem#dev-god', status: 'unavailable' } });
  assert.ok(html.includes('class="skc_detailVersionHead"'), '版本区块在（有 upstream）');
  assert.ok(html.includes(t('detail.checkUnavailable')), '卡内文案是 detail.checkUnavailable');
  const button = checkButtonOf({ row: marketRow({ version: null }), check: { key: 'filesystem#dev-god', status: 'unavailable' } });
  assert.equal(button.props.disabled, true, '按钮禁用');
});

/* ------------- 「调用名」区块：宿主「包含的组件」行样式（本轮） ------------- */

test('区块恒渲染且标题是「包含的技能」：本地/软链/内置/市场装四种行都有（无计数）', () => {
  for (const [shape, target] of [
    ['市场装', marketRow()],
    ['本地', row({})],
    ['软链', row({ symlink: true, path: null, realPath: '/Users/me/Skills/ui-design/SKILL.md' })],
    ['内置', row({ provider: 'runtime', partition: 'builtin', path: null, realPath: null })],
  ]) {
    const html = render({ row: target, data: content({ repoUrl: null }) });
    assert.ok(html.includes('class="skc_callRow"'), `${shape}：有调用名行`);
    assert.ok(html.includes(`<h4 class="skc_marketSectionTitle">${t('plugin.skills')}</h4>`), `${shape}：标题是「包含的技能」`);
    assert.equal(/<h4 class="skc_marketSectionTitle">包含的技能\s*\d+/.test(html), false, `${shape}：标题不带计数`);
    // 复制按钮的无障碍名仍是「复制调用名」（这轮只改了区块标题），所以只钉住 h4 那一层。
    assert.equal(/<h4[^>]*>调用名/.test(html), false, `${shape}：旧区块标题「调用名」已不再出现`);
  }
});

test('调用名行结构：图标 + 名字（普通 p）+ 描述，复制按钮在最右', () => {
  const html = render({ row: row({ name: 'ui-design', description: 'Comprehensive UI design skill.' }) });
  const start = html.indexOf('class="skc_callRow"');
  const block = html.slice(start, html.indexOf('</section>', start));
  assert.ok(block.includes('class="skc_cardIcon skc_callIcon"'), '图标是 41 的修饰类');
  assert.ok(block.includes('<p class="skc_callName">ui-design</p>'), '名字是普通 <p>');
  assert.ok(block.includes('<p class="skc_callDesc">Comprehensive UI design skill.</p>'), '描述是 <p class="skc_callDesc">');
  const order = ['skc_callIcon', 'skc_callName', 'skc_callDesc', 'aria-label="复制调用名"'].map((needle) => block.indexOf(needle));
  assert.ok(order.every((at) => at !== -1), '四个部件都在');
  assert.ok(order[0] < order[1] && order[1] < order[2] && order[2] < order[3], '顺序：图标 → 名字 → 描述 → 复制');
});

test('调用名行：描述为空时不渲染那一行（名字仍是 13.5/20 的单行）', () => {
  const html = render({ row: row({ name: 'ui-design', description: '' }) });
  const start = html.indexOf('class="skc_callRow"');
  const block = html.slice(start, html.indexOf('</section>', start));
  assert.equal(block.includes('skc_callDesc'), false, '没有描述就不渲染 <p class="skc_callDesc">');
  assert.ok(block.includes('<p class="skc_callName">ui-design</p>'), '名字照旧');
});

test('调用名行尾的复制按钮：aria-label 与 title 都是 detail.copy，且不是 code', () => {
  const html = render({ row: row({ name: 'ui-design' }) });
  const start = html.indexOf('class="skc_callRow"');
  const block = html.slice(start, html.indexOf('</section>', start));
  const button = /<button type="button" aria-label="([^"]*)" title="([^"]*)"/.exec(block);
  assert.ok(button !== null, '行尾有一个带 aria-label 的按钮');
  assert.equal(button[1], t('detail.copy'), 'aria-label 是 detail.copy');
  assert.equal(button[2], t('detail.copy'), 'title 也是 detail.copy');
  assert.equal(block.includes('role="switch"'), false, '调用名行里没有开关');
});
