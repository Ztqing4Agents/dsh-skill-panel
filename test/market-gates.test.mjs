/**
 * The gates that must stay green for the market round: the three scripts, the new
 * contract numbers, and the two "never again" rules that only a grep can hold.
 *
 * Contracts: AGENTS.md rules 2 / 4 / 9 / 13 (no CJK in sources, no host hash class
 * names, click affordance boundaries, the browser never calls an upstream), and
 * docs/contracts/acceptance.md 附录 D.5 numbering; case ids K40, K41, K81, K83, K84, K85, K89.
 *
 * The three scripts are executed as subprocesses, exactly as `npm run check` runs
 * them: importing them would skip their `process.exitCode` handling, which is the
 * part that decides whether a red gate stops a release.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { ROOT } from './helpers/ssr.mjs';

const exec = promisify(execFile);

/**
 * Run one gate script in the repository root.
 * @param {string} script - file name under scripts/.
 * @returns {Promise<{code: number, stdout: string, stderr: string}>} the outcome.
 */
async function runGate(script) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [join(ROOT, 'scripts', script)], { cwd: ROOT });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

/**
 * Every markdown file under docs/contracts.
 * @returns {Promise<string[]>} absolute paths.
 */
async function contractFiles() {
  const dir = join(ROOT, 'docs', 'contracts');
  return (await readdir(dir)).filter((name) => name.endsWith('.md')).sort().map((name) => join(dir, name));
}

test('K40 check:i18n 绿：两语键集一致、无 CJK 字面量、入口键存在', async () => {
  const gate = await runGate('check-i18n.mjs');
  assert.equal(gate.code, 0, `check:i18n 必须 exit 0（实际 ${gate.code}）：${gate.stdout}${gate.stderr}`);
  assert.match(gate.stdout, /check-i18n: OK/, '门禁自报 OK');
  assert.match(gate.stdout, /\d+ keys in both dictionaries/, '报出双向键集一致');
  assert.match(gate.stdout, /no CJK literals/, '报出 lib/ 与 src/ 无 CJK');
});

test('K40 check:client 绿：重打一次与 client.js 逐字节相同', async () => {
  const gate = await runGate('check-client.mjs');
  assert.equal(gate.code, 0, `check:client 必须 exit 0（实际 ${gate.code}）：${gate.stdout}${gate.stderr}`);
  assert.match(gate.stdout, /check-client: OK/, '门禁自报 OK');
  assert.match(gate.stdout, /matches src\/client/, '报出与源码一致');
});

test('K40 check:docs 绿：13 份 0 warn', async () => {
  const gate = await runGate('check-docs.mjs');
  assert.equal(gate.code, 0, `check:docs 必须 exit 0（实际 ${gate.code}）：${gate.stdout}${gate.stderr}`);
  assert.match(gate.stdout, /check-docs: OK/, '门禁自报 OK');
  const summary = /check-docs: OK \((\d+) md files, (\d+) warn\)/.exec(gate.stdout);
  assert.ok(summary !== null, '门禁输出里带统计');
  assert.equal(Number(summary[1]), 13, `文档恰好 13 份（实际 ${summary[1]}）`);
  assert.equal(Number(summary[2]), 0, `警告为 0（实际 ${summary[2]}）`);
});

test('K40 本轮新增的市场编号都能在契约里解析，且全仓库只出现一次', async () => {
  const files = await contractFiles();
  const all = await Promise.all(files.map(async (file) => ({ file, text: await readFile(file, 'utf8') })));
  const headings = all.flatMap(({ file, text }) => text
    .split('\n')
    .filter((line) => /^#{2,4} /.test(line))
    .map((line) => ({ file, line })));

  const required = [
    ['§3.7', /^#{2} 3\.7 /],
    ['§3.8', /^#{2} 3\.8 /],
    ['§3.9', /^#{2} 3\.9 /],
    ['§7', /^#{2} 7 /],
    ['§8.6', /^#{2} 8\.6 /],
    ['附录 E', /^#{2} 附录 E /],
    ['附录 F', /^#{2} 附录 F /],
    ['附录 G', /^#{2} 附录 G /],
  ];
  for (const [label, pattern] of required) {
    const hits = headings.filter(({ line }) => pattern.test(line));
    assert.equal(hits.length, 1, `${label} 的章节标题恰好一处（实际 ${hits.length} 处：${hits.map((hit) => hit.line).join(' | ')}）`);
  }

  // 附录 D.5 是本轮验收编号的落点（K28–K51）。
  const acceptance = all.find(({ file }) => file.endsWith('acceptance.md'));
  assert.ok(acceptance !== undefined, 'acceptance.md 在契约目录里');
  assert.match(acceptance.text, /### D\.5 /, 'acceptance.md 有 D.5 小节');
  assert.match(acceptance.text, /K28/, 'D.5 从 K28 起编号');
  assert.match(acceptance.text, /K51/, 'D.5 编到 K51');
});

test('K40 styles.js 里没有宿主构建哈希类名（形如 abc123_）', async () => {
  const text = await readFile(join(ROOT, 'src', 'client', 'styles.js'), 'utf8');
  const hashLike = [...text.matchAll(/[A-Za-z0-9]{6}_/g)].map((match) => match[0]);
  assert.deepEqual(hashLike, [], `样式表里没有 xxxxxx_ 形式的宿主哈希类名（发现：${hashLike.join(', ')}）`);
  assert.equal(/^\.(?!skc_)/m.test(text), false, '没有不带 skc_ 前缀的类选择器');
});

test('K40 市场刻度逐条落地：网格 280/12、卡片竖排 14、cardOpen 铺满、cardEnd 浮起', async () => {
  const css = await readFile(join(ROOT, 'src', 'client', 'styles.js'), 'utf8');
  const ruleOf = (selector) => {
    const index = css.indexOf(`${selector}{`);
    return index === -1 ? '' : css.slice(index, css.indexOf('}', index) + 1);
  };

  const grid = ruleOf('.skc_marketGrid');
  assert.match(grid, /minmax\(280px, 1fr\)/, '网格列宽 280px 起（附录 F 新刻度 ①）');
  assert.match(grid, /gap: 12px/, '网格间距 12px');
  assert.match(grid, /list-style: none/, '网格是 ul，去掉项目符号');

  const card = ruleOf('.skc_marketCard');
  assert.match(card, /padding: 14px/, '卡片内边距 14（新刻度 ②）');
  assert.match(card, /flex-direction: column/, '卡片改竖向排布');
  assert.match(card, /align-items: stretch/, 'column 下必须 stretch（否则骨架收缩包裹）');
  // The head → body separator (①). U15 took it 14 → 12, U16 12 → 8. It is the card's own gap
  // and deliberately *not* the body rhythm below: ① and ③ are two different numbers now
  // (market.md 附录 F ⑪), so neither may be relaxed into a range.
  assert.match(card, /gap: 8px(?!\d)/, '卡片 gap 8：头部 → 正文 ①（U16 由 12 收到 8）');
  assert.equal(/border:/.test(card), false, '卡面无描边（附录 E 决策 E-1）');

  const open = ruleOf('.skc_marketCardOpen::after');
  assert.match(open, /position: absolute/, '整卡可点层的定位');
  assert.match(open, /inset: 0/, '整卡可点层铺满卡片（AGENTS.md 规则 9 的唯一手段）');
  assert.match(open, /border-radius: var\(--dsw-radius-xl\)/, '可点层跟随卡片圆角');

  const end = ruleOf('.skc_marketCardEnd');
  assert.match(end, /z-index: 1/, '动作位浮在可点层之上（不可省）');
  assert.equal(/align-self/.test(end), false, 'U5 起动作位坐在头部行里，不再自己贴边（新刻度 ③ 作废）');
  const head = ruleOf('.skc_marketHead');
  assert.match(head, /align-items: center/, '头部三件垂直居中（与已安装行同配方）');
  assert.match(head, /gap: 12px/, '头部间距 12px');
  assert.match(head, /display: flex/, '头部是一行 flex');
  assert.equal(/z-index/.test(head), false, '头部不带 z-index（只有动作位浮起）');
  const body = ruleOf('.skc_marketBody');
  assert.match(body, /flex-direction: column/, '正文竖排');
  // U15: the body rhythm tightened from 6px to 4px (描述 → 标签 → 三段). It is *not* the
  // card's 12px gap - keeping them separate is the point recorded in market.md 附录 F ⑪.
  assert.match(body, /gap: 4px(?!\d)/, '正文三块共用 4px 节奏（新刻度 ⑪，U15 由 6 收到 4）');
  assert.match(ruleOf('.skc_marketMeta'), /white-space: nowrap/, '作者行单行（换行会让头部高度抖动）');
  assert.match(ruleOf('.skc_marketMeta'), /text-overflow: ellipsis/, '作者行超出省略');

  // U2: the figures row and the two new seats are new ticks of the same table.
  const stats = ruleOf('.skc_marketStats');
  assert.match(stats, /grid-template-columns: repeat\(3, minmax\(0, 72px\)\)/, '三段是三格等宽轨道（新刻度 ⑥）');
  assert.match(stats, /font-variant-numeric: tabular-nums/, '等宽数字（1 与 8 同宽）');
  assert.match(stats, /justify-content: start/, '三段左对齐');
  assert.equal(/z-index/.test(stats), false, '三段不带 z-index：它在点击层下面（点数字 = 进详情）');
  assert.match(ruleOf('.skc_marketStat > svg'), /width: 13px; height: 13px/, '字形 13px');
  assert.match(ruleOf('.skc_marketSourceMark'), /width: 16px; height: 16px/, '来源图形 16×16（新刻度 ⑦）');
  assert.match(ruleOf('.skc_marketSourceMark'), /border-radius: var\(--dsw-radius-sm\)/, '来源图形用 radius-sm');
  assert.match(ruleOf('.skc_marketSkeletonStat'), /width: 56px; height: 12px/, '骨架三段 56×12（新刻度 ⑨）');
  assert.match(ruleOf('.skc_marketSkeletonStat'), /border-radius: var\(--dsw-radius-xs\)/, '骨架三段用 radius-xs');
  assert.match(ruleOf('.skc_marketSkeletonTag'), /width: 48px; height: 19px/, '骨架标签与真件同盒 48×19（新刻度 ⑬）');
  // U14: the clamp is a *value* change, not a new tick (market.md 附录 F: `.skc_marketDesc` 由
  // 1 行 → 2 行（U5）→ 3 行（U14）). The number stays pinned: 3 lines × 18px = the 54px box the
  // real-machine check measures, so a "just check that line-clamp exists" assertion would let a
  // silent 2-line regression through.
  const desc = ruleOf('.skc_marketDesc');
  // Both halves of the margin matter, for two different reasons:
  //   the TOP 0 - U15 root cause: this is a <p> and it never reset the UA's `margin: 1em`, which
  //     at 13px silently added 13px above and below (the tags row and the figures row both carry
  //     their own `margin: 0`; only this one was missing);
  //   the BOTTOM 4px - U16's ②: 描述 → 标签 = 正文 gap 4px + this 4px = 8px, and it lives here
  //     rather than on the tag row so a card with no summary still reads ① = 8px.
  // A bare `/margin: 0/` would accept `margin: 0 0 4px` and let that 4px be deleted silently
  // (② quietly drops back to 4px), so the whole shorthand is pinned.
  assert.match(desc, /margin: 0 0 4px(?!\d)/, '描述 margin: 0 0 4px —— 上边距归零（UA `1em` 会多给 13px）+ 下边距 4px 是 ② 的一半（删了描述→标签退回 4）');
  assert.match(desc, /-webkit-line-clamp: 3(?!\d)/, '描述三行（U14 取值变更；不算新刻度）');
  // U17: 13/18 (leading 1.38) read tight; the card's type scale is {16, 18, 20} and 20 is
  // already on it (the title is 14/20), so the body paragraph moved to 13/20 - three lines
  // ⇒ a 60px box, and the card grew 187 → 193. Both halves stay pinned: the size and the
  // line-height are one scale decision, and dropping the size to a bare line-height check
  // would let 12/20 or 14/20 through.
  assert.match(desc, /font-size: 13px; line-height: 20px/, '描述刻度 13/20（U17；三行 ⇒ 描述盒 60px）');
  assert.match(desc, /display: -webkit-box/, '多行截断走 -webkit-box（不是单行 nowrap）');
  assert.match(desc, /overflow: hidden/, '超出隐藏（第三行末尾省略号）');
  assert.match(desc, /-webkit-box-orient: vertical/, '竖排方向，配合 clamp');
  // The title keeps its own width (grow 0) and still shrinks (shrink 1 + min-width:0), so
  // the source mark stays right after it and a long title ellipsises instead of wrapping.
  const openRule = ruleOf('.skc_marketCardOpen');
  assert.match(openRule, /flex: 0 1 auto/, '标题按内容宽、可收缩（U5 后的写法）');
  assert.match(openRule, /min-width: 0/, '标题可以缩到比内容窄（省略号的前提）');
  const titleRow = ruleOf('.skc_marketTitleRow');
  assert.match(titleRow, /align-self: flex-start/, '标题行不被 column 父级拉满（品牌图紧跟标题）');
  assert.match(titleRow, /max-width: 100%/, '标题行仍关在卡片内');
  assert.match(titleRow, /flex-wrap: nowrap/, '标题行不换行（换行容器会先把长标题换行、把品牌图挤到第二行）');

  assert.match(ruleOf('.skc_marketDialog'), /min\(480px, 100vw - 32px\)/, '确认弹窗宽度用 min()');
  assert.match(ruleOf('.skc_marketSkeletonChip'), /width: 64px; height: 26px/, 'chip 骨架 64×26');
  assert.match(ruleOf('.skc_marketSkeletonAction'), /width: 64px; height: 24px/, '动作骨架 64×24');
  assert.match(ruleOf('.skc_marketFiles li'), /min-height: 32px/, '文件行 32px（新刻度）');
});

test('K41 市场块不新增颜色字面量：色值只来自宿主令牌与 avatar.js', async () => {
  const css = await readFile(join(ROOT, 'src', 'client', 'styles.js'), 'utf8');
  const marketBlock = css.slice(css.indexOf('/* market: toolbar and chips'));
  assert.notEqual(marketBlock, '', '样式表里有市场块');
  const literals = [...marketBlock.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)].map((match) => match[0]);
  assert.deepEqual(literals, [], `市场块里没有颜色字面量（发现：${literals.join(', ')}）`);
  const tokenUses = [...marketBlock.matchAll(/var\(--dsw-[a-z-]+\)/g)].length;
  assert.ok(tokenUses > 20, `市场块用的宿主令牌足够多（实际 ${tokenUses} 处）`);
});

/**
 * Drop block and line comments, so a rule about *code* is not tripped by a doc sentence.
 * @param {string} text - source text.
 * @returns {string} the same text without comments.
 */
const codeOnly = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');

test('K41 上游 origin 的边界：市场面只有一个 origin，浏览器半部零 URL', async () => {
  // U7 之后 `clawhub.ai` 整条退场：目录、详情与安装包都来自 SkillHub 的镜像接口，所以
  //   · `src/client/**` **一个 URL 都没有**（浏览器半部零直连）；
  //   · `lib/market/**` 里认上游主机的文件恰好两个、常量恰好两条：`mirror.js` 的 `ORIGIN`
  //     （唯一出口）与 `upstream.js` 的 `REDIRECT_HOST`（COS 桶白名单，302 用）；
  //   · `normalize.js` **零 origin**，两个适配器只 import 那份 `ORIGIN`，不各写一份。
  const dir = join(ROOT, 'src', 'client');
  const files = (await readdir(dir)).filter((name) => /\.(js|jsx)$/.test(name));
  assert.equal(files.length > 10, true, '确实扫到了客户端源码');
  const sources = new Map();
  for (const name of files) sources.set(name, codeOnly(await readFile(join(dir, name), 'utf8')));
  const offenders = [...sources].filter(([, text]) => /https?:\/\//.test(text)).map(([name]) => name);
  assert.deepEqual(offenders, [], `客户端源码里一个 URL 都没有（发现：${offenders.join(', ')}）`);
  for (const host of ['clawhub.ai', 'skillhub.cn', 'jsdelivr', 'cloudcache', 'myqcloud']) {
    const hits = [...sources].filter(([, text]) => text.includes(host)).map(([name]) => name);
    assert.deepEqual(hits, [], `客户端代码不提 ${host}`);
  }

  // Host half: walk lib/market and list every file that knows an upstream host.
  const libDir = join(ROOT, 'lib', 'market');
  const HOSTS = /api\.skillhub\.cn|clawhub\.ai|jsdelivr|myqcloud/;
  const withOrigin = [];
  const originLines = [];
  const walk = async (walkDir, prefix) => {
    for (const entry of await readdir(walkDir, { withFileTypes: true })) {
      const full = join(walkDir, entry.name);
      if (entry.isDirectory()) await walk(full, `${prefix}${entry.name}/`);
      else if (entry.name.endsWith('.js')) {
        // Strip comments first: a doc sentence may name a host as an example.
        const text = codeOnly(await readFile(full, 'utf8'));
        if (!HOSTS.test(text)) continue;
        withOrigin.push(`${prefix}${entry.name}`);
        for (const line of text.split('\n')) if (HOSTS.test(line)) originLines.push(`${prefix}${entry.name}`);
      }
    }
  };
  await walk(libDir, '');
  assert.deepEqual(
    withOrigin.sort(),
    ['sources/mirror.js', 'upstream.js'],
    '认上游主机的地方恰好两个文件（多一个就是越界）',
  );
  for (const name of ['normalize.js', 'sources/skillhub.js', 'sources/clawhub.js', 'sources/index.js']) {
    assert.equal(withOrigin.includes(name), false, `${name} 自己不写 origin（只 import mirror.js 的）`);
  }
  // Two: the one ORIGIN and the redirect whitelist. A third appears ⇒ red.
  assert.equal(originLines.length, 2, `认上游主机的常量恰好两条，实测 ${originLines.join(', ')}`);

  const mirrorText = await readFile(join(libDir, 'sources', 'mirror.js'), 'utf8');
  const upstreamText = await readFile(join(libDir, 'upstream.js'), 'utf8');
  const normalizeText = await readFile(join(libDir, 'normalize.js'), 'utf8');
  assert.match(mirrorText, /export const ORIGIN = 'https:\/\/api\.skillhub\.cn'/, '唯一的 origin 是导出常量');
  assert.match(upstreamText, /REDIRECT_HOST = \/\^\[a-z0-9-\]\+\\\.cos\\\.accelerate\\\.myqcloud\\\.com\$\//, '下载重定向白名单仍在（COS 桶后缀）');
  assert.equal(/https?:\/\//.test(normalizeText), false, 'normalize.js 里连一个 URL 都没有');
  assert.equal(/getJson|getBytes|fetch\(/.test(normalizeText), false, '归一化自己不发任何请求');
  // The retired half must be gone from the code, not just unused.
  for (const gone of ['lucide', 'skill-icons', 'jsdelivr', 'clawhub.ai']) {
    assert.equal(upstreamText.includes(gone), false, `upstream.js 里不再有 ${gone}`);
  }
  const { lucideProxyUrl } = await import('../lib/market/normalize.js').catch(() => ({}));
  assert.equal(lucideProxyUrl, undefined, '图标代理 URL 构造器已随路由删除');
});

test('K41 包依赖仍然是空的：市场面没有引入第三方库', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.dependencies ?? {}, {}, 'dependencies 为空（zip/https/crypto 全用内置）');
  assert.deepEqual(pkg.exports['./client'], './client.js', 'exports["./client"] 仍是字符串');
});

test('K41 点击边界按页签划：市场页有 cardOpen 手段，已安装行没有', async () => {
  /**
   * Strip comments before grepping, so a comment that *mentions* `<a href>` (the one
   * explaining why it is not used) cannot satisfy a "no anchor" assertion.
   * @param {string} text - source file.
   * @returns {string} the same file without block and line comments.
   */
  const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const client = join(ROOT, 'src', 'client');
  const card = code(await readFile(join(client, 'market-card.jsx'), 'utf8'));
  const row = code(await readFile(join(client, 'row.jsx'), 'utf8'));
  const detail = code(await readFile(join(client, 'market-detail.jsx'), 'utf8'));
  assert.match(card, /marketCardOpen/, '市场卡片用 cardOpen 作为整卡点击锚点');
  assert.equal(/<a[\s>]/.test(card), false, '市场卡片不是链接（实现手段只有 ::after 一层）');
  assert.equal(/<a[\s>]/.test(detail), false, '详情视图也没有链接');
  assert.equal(/marketCardOpen/.test(row), false, '已安装行没有引入市场的可点锚点');
  assert.equal(/role="button"/.test(row), false, '已安装行仍然不是按钮');
});

test('K81 点击层级：一个动作位，其余都在点击层之下', async () => {
  const css = await readFile(join(ROOT, 'src', 'client', 'styles.js'), 'utf8');
  const ruleOf = (selector) => {
    const index = css.indexOf(`${selector}{`);
    return index === -1 ? '' : css.slice(index, css.indexOf('}', index) + 1);
  };

  // Layer 0: the card-wide click target. Layer 1: the one action seat, now in the head.
  assert.match(ruleOf('.skc_marketCardOpen::after'), /inset: 0/, '点击层铺满整卡');
  assert.match(ruleOf('.skc_marketCardEnd'), /z-index: 1/, '安装位是唯一的浮起层');
  assert.equal(ruleOf('.skc_marketCardEnd').includes('align-self'), false, '动作位不再自己贴边（它在头部行里）');
  assert.equal(css.includes('.skc_marketFavorite'), false, '收藏控件整块从样式表里消失（U5）');
  const marketBlock = css.slice(css.indexOf('/* market: toolbar and chips'));
  assert.equal(marketBlock.includes('z-index: 2'), false, '市场块里没有第 2 层（唯一的动作位是安装；页头的 z-index:2 与它无关）');
  assert.match(ruleOf('.skc_marketCard'), /position: relative/, '卡片是定位参照（但自己不建 stacking context）');
  assert.equal(/z-index/.test(ruleOf('.skc_marketCard')), false, '卡片不声明 z-index（否则动作位的层级被关进新上下文）');
  // Tap targets that must fall through to the click layer.
  for (const selector of ['.skc_marketHead', '.skc_marketBody', '.skc_marketTags', '.skc_marketStats']) {
    assert.equal(/z-index/.test(ruleOf(selector)), false, `${selector} 不带 z-index（点它 = 点空白 = 进详情）`);
    assert.equal(/position: absolute/.test(ruleOf(selector)), false, `${selector} 不脱离文档流`);
  }

  const card = await readFile(join(ROOT, 'src', 'client', 'market-card.jsx'), 'utf8');
  const code = card.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/<a[\s>]/.test(code), false, '卡片里没有 <a>（不是链接）');
  assert.equal(/role="button"/.test(code), false, '卡片本身不是按钮');
  assert.equal(/stopPropagation/.test(code), false, '不用 JS 拦冒泡代替层级');
  const literalButtons = [...code.matchAll(/<button/g)].length;
  assert.equal(literalButtons, 1, `源码里只有一个字面 <button>：标题锚点（实际 ${literalButtons}）`);
  const primitiveButtons = [...code.matchAll(/<Button/g)].length;
  assert.equal(primitiveButtons, 2, '安装位是唯一的 primitives Button（四态里两个分支各一处）');
  const listItem = /<li className=\{cn\('marketCard'\)\}([^>]*)>/.exec(code);
  assert.ok(listItem !== null, '找得到卡片的 <li>');
  assert.equal(/onClick|tabIndex|role=/.test(listItem[1]), false, '<li> 上没有 onClick / tabIndex / role');
});

test('K83 标签 chip 的刻度逐字落地（描边、无颜色字面量、可省略）', async () => {
  const css = await readFile(join(ROOT, 'src', 'client', 'styles.js'), 'utf8');
  const ruleOf = (selector) => {
    const index = css.indexOf(`${selector}{`);
    return index === -1 ? '' : css.slice(index, css.indexOf('}', index) + 1);
  };
  const list = ruleOf('.skc_marketTags');
  assert.match(list, /flex-wrap: wrap/, '标签行允许折行（三枚也可能超宽）');
  assert.match(list, /gap: 6px/, 'chip 间距 6px');
  assert.match(list, /list-style: none/, '标签行是 ul，去掉项目符号');
  const tag = ruleOf('.skc_marketTag');
  assert.match(tag, /border: \.5px solid var\(--dsw-alias-border-l2\)/, '描边 chip，且只用宿主令牌');
  assert.match(tag, /border-radius: var\(--dsw-radius-sm\)/, '圆角 radius-sm');
  assert.match(tag, /padding: 1px 6px/, '内边距 1×6（19px 高）');
  assert.match(tag, /font-size: 11px; line-height: 16px/, '11/16 一档小字');
  assert.match(tag, /white-space: nowrap/, '单枚不折行');
  assert.match(tag, /text-overflow: ellipsis/, '超长单枚省略');
  assert.match(tag, /max-width: 100%/, '单枚不得宽过卡片');
  const marketBlock = css.slice(css.indexOf('/* market: toolbar and chips'));
  const literals = [...marketBlock.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)].map((m) => m[0]);
  assert.deepEqual(literals, [], `市场块仍然零颜色字面量（发现：${literals.join(', ')}）`);
});

test('K85 客户端收藏写侧已撤、后端一条未删（负向门禁）', async () => {
  const clientDir = join(ROOT, 'src', 'client');
  const names = (await readdir(clientDir)).filter((name) => /\.(js|jsx)$/.test(name));
  const sources = new Map();
  for (const name of names) sources.set(name, await readFile(join(clientDir, name), 'utf8'));
  const joined = [...sources.values()].join('\n');

  // Gone: the whole write path, from the store actions to the button's own CSS class.
  for (const gone of ['marketFavoriteToggle', 'marketFavoriteOk', 'marketFavoriteFail', 'favorite-failed', 'marketFavoriteOn']) {
    assert.equal(joined.includes(gone), false, `客户端不再有 ${gone}`);
  }
  assert.equal(/marketFavorite\s*\(/.test(sources.get('api.js')), false, 'api.marketFavorite 已删');
  assert.equal(/favoritesGen/.test(joined), false, '不做乐观值就不需要防乱序代次');
  assert.equal((await readFile(join(clientDir, 'market-marks.jsx'), 'utf8')).includes('BookmarkMark'), false, '书签字形已删（三段那枚小书签是 StatMark 的另一支）');

  // Kept on the read side: bootstrap still delivers, the panel still stores.
  assert.equal(joined.includes('favoritesOk'), true, '读侧仍在：favoritesOk');
  for (const [file, expected] of [['state.js', 1], ['market-panel.jsx', 1]]) {
    const hits = sources.get(file).split('marketFavoritesLoaded').length - 1;
    assert.equal(hits, expected, `${file} 里 marketFavoritesLoaded 出现 ${expected} 次（读侧唯一入口）`);
  }
  assert.match(sources.get('state.js'), /favorites: \{\}/, 'initialMarket 仍留 favorites');
  assert.match(sources.get('state.js'), /favoritesOk: true/, 'initialMarket 仍留 favoritesOk');

  // Kept on the Host: store, route, bootstrap keys, both error copies.
  assert.equal(existsSync(join(ROOT, 'lib', 'market', 'favorites.js')), true, 'lib/market/favorites.js 仍在');
  const { ROUTES } = await import('../lib/routes.js');
  assert.equal(ROUTES.marketFavorite, '/api/dsh-skill-center/market/favorite', '第 13 条路由仍在');
  const routes = await readFile(join(ROOT, 'lib', 'routes.js'), 'utf8');
  assert.match(routes, /favorites: bookmarks\.favorites/, 'bootstrap 仍下发 favorites');
  assert.match(routes, /favoritesOk: bookmarks\.readable/, 'bootstrap 仍下发 favoritesOk');
  for (const lang of ['zh', 'en']) {
    const dict = JSON.parse(await readFile(join(ROOT, 'locale', `${lang}.json`), 'utf8'));
    for (const code of ['E_FAVORITE_FULL', 'E_FAVORITE_IO']) {
      assert.equal(typeof dict[`error.${code}`], 'string', `${lang} 仍有 error.${code}（路由仍会返回）`);
    }
  }
  // And the four labels that belonged to the removed control are gone from both dictionaries.
  for (const lang of ['zh', 'en']) {
    const dict = JSON.parse(await readFile(join(ROOT, 'locale', `${lang}.json`), 'utf8'));
    for (const key of ['market.favorite', 'market.unfavorite', 'market.favoriteTitle', 'market.unfavoriteTitle']) {
      assert.equal(key in dict, false, `${lang} 不再有 ${key}`);
    }
  }
});

test('K81 包装层不得掉下点击层：头部/正文/标签/三段都没有 position，动作位必须自带 position', async () => {
  // The click layer is one absolutely positioned `::after` owned by the title button. Any
  // `position` on a sibling wrapper paints that wrapper in the positioned layer, i.e. above
  // the layer - clicks on it would then land on a node with no handler ("looks clickable,
  // does nothing"). `position: relative` is as fatal here as `position: absolute`.
  const css = await readFile(join(ROOT, 'src', 'client', 'styles.js'), 'utf8');
  const ruleOf = (selector) => {
    const index = css.indexOf(`${selector}{`);
    return index === -1 ? '' : css.slice(index, css.indexOf('}', index) + 1);
  };

  for (const selector of ['.skc_marketHead', '.skc_marketBody', '.skc_marketTags', '.skc_marketStats', '.skc_marketMeta']) {
    assert.equal(/position\s*:/.test(ruleOf(selector)), false, `${selector} 不声明 position（否则它盖在点击层上面）`);
  }
  // The one seat must be positioned, or its z-index is inert and the button sits under
  // the layer it is supposed to float above.
  const end = ruleOf('.skc_marketCardEnd');
  assert.match(end, /position: relative/, '动作位自己是定位元素（z-index 才有意义）');
  assert.match(end, /z-index: 1/, '动作位在第 1 层');
  assert.match(end, /flex: none/, '动作位不参与收缩（标题先缩）');

  // nowrap is the flex default: the seat must not be pushed to a second line by state copy.
  for (const selector of ['.skc_marketHead', '.skc_marketCardEnd']) {
    assert.equal(/flex-wrap/.test(ruleOf(selector)), false, `${selector} 不写 flex-wrap（保持 nowrap）`);
  }
  // The title row is the exception that has to say it out loud: it *was* `wrap` once, and a
  // wrapping row breaks on the flex base size before any shrinking, so the mark dropped to a
  // second line on the two longest titles (row height 20px -> 44px on the real machine).
  const titleRowRule = ruleOf('.skc_marketTitleRow');
  assert.match(titleRowRule, /flex-wrap: nowrap/, '标题行显式 nowrap：品牌图永远留在第一行');
  assert.equal(/flex-wrap:\s*wrap/.test(titleRowRule), false, '标题行不允许换行（含 wrap-reverse 一类）');
  const main = ruleOf('.skc_marketMain');
  assert.match(main, /flex: 1(?![\d])/, '两行块吃掉头部剩余宽度（唯一可收缩项）');
  assert.match(main, /min-width: 0/, '两行块可以缩到比内容窄（否则标题的省略号不生效）');
  const title = ruleOf('.skc_marketCardOpen');
  const flexOf = (rule) => {
    const value = /flex:\s*([^;]+);/.exec(rule);
    return value === null ? [] : value[1].trim().split(/\s+/);
  };
  const titleFlex = flexOf(title);
  assert.equal(titleFlex.length >= 2, true, `标题用 flex 简写（实际 ${titleFlex.join(' ')}）`);
  assert.equal(titleFlex[0], '0', 'flex-grow 为 0：标题只占内容宽，品牌图不会被打到最右端');
  assert.notEqual(titleFlex[1], '0', 'flex-shrink 不为 0：长标题必须让位给省略号');
  assert.equal(titleFlex[2], 'auto', 'flex-basis 为 auto：标题按自身内容宽排版（`flex:0 1 100%` 会把块撑满）');
  assert.match(title, /min-width: 0/, '标题可收缩成省略号（min-width:auto 会卡住内容宽）');
  const titleRow = ruleOf('.skc_marketTitleRow');
  assert.match(titleRow, /align-self: flex-start/, '标题行按内容宽排版（不被 column 父级拉满）');
  assert.match(titleRow, /max-width: 100%/, '标题行不超过卡片内容宽');
  assert.match(titleRow, /min-width: 0/, '标题行本身也可以被压窄（它在 column 的 main 里）');
  assert.match(titleRow, /gap: 8px/, '标题与品牌图之间只有一个 8px 的 gap');
});

test('K85 客户端一行都不许提到收藏写入口：连 ROUTES 的字面量也不许出现', async () => {
  const clientDir = join(ROOT, 'src', 'client');
  const names = (await readdir(clientDir)).filter((name) => /\.(js|jsx)$/.test(name));
  for (const name of names) {
    const text = await readFile(join(clientDir, name), 'utf8');
    assert.equal(text.includes('market/favorite'), false, `${name} 里没有 market/favorite 这条字面量（写侧已撤）`);
    assert.equal(/marketFavorite\b/.test(text) && name !== 'state.js' && name !== 'market-panel.jsx', false,
      `${name} 只有读侧的 marketFavoritesLoaded，没有 marketFavorite`);
  }
  const styles = await readFile(join(clientDir, 'styles.js'), 'utf8');
  assert.equal(styles.includes('marketFavorite'), false, '样式表里没有收藏控件的任何类');
  assert.equal(styles.includes('marketFavoriteOn'), false, '已收藏态的 -On 类也一并消失');
});

test('K89 图标管道与分类开关不回归：market/icons、icons()、caps、计数各就各位', async () => {
  // U7 deleted the two image-proxy routes; `market/icons` and `icons()` stay, because an
  // installed row still has an identity and nothing else - they are the only way its tile
  // and upstream title exist at all.
  const { clawhubSource } = await import('../lib/market/sources/clawhub.js');
  assert.equal(typeof clawhubSource.icons, 'function', 'clawhubSource.icons 仍是函数');

  const { ROUTES } = await import('../lib/routes.js');
  assert.equal(typeof ROUTES.marketIcons, 'string', 'market/icons 这条路由仍在');
  assert.equal(ROUTES.marketLucide, undefined, 'market/lucide 已删除（U7）');
  assert.equal(ROUTES.marketClawhubIcon, undefined, 'market/clawhub-icon 已删除（U7）');
  assert.equal(Object.keys(ROUTES).length, 11, '路由 11 条（4 本地 + 7 市场）');
  const indexText = await readFile(join(ROOT, 'index.js'), 'utf8');
  assert.match(indexText, /import \{ makeRoutes \} from '\.\/lib\/routes\.js'/, 'index.js 仍从 routes.js 取路由表');
  assert.match(indexText, /makeRoutes\(ctx, \{/, '仍然一次装配、逐条 register');
  const { makeRoutes } = await import('../lib/routes.js');
  assert.equal(typeof makeRoutes, 'function', '装配函数导出着（路由条数由 routes.test 逐条断言）');

  // Caps: categories stays OFF for ClawHub; the package shape is now 'files' for both.
  const { descriptors } = await import('../lib/market/sources/index.js');
  const clawhub = descriptors().find((entry) => entry.id === 'clawhub');
  assert.equal(clawhub.hasCategories, true, 'U8 起 ClawHub 也有分类表（镜像的同一张）');
  assert.equal(clawhub.packageKind, 'files', '包形态是逐文件清单（U7）');
  const skillhub = descriptors().find((entry) => entry.id === 'skillhub');
  assert.equal(skillhub.hasCategories, true, 'SkillHub 的分类表不受影响');
  // The scope list is a different axis: three entries, `all` first, and no `all` identity.
  const { SCOPES, scopesFor } = await import('../lib/market/sources/index.js');
  assert.deepEqual(SCOPES.map((scope) => scope.id), ['all', 'skillhub', 'clawhub'], '范围轴三项，all 排第一');
  assert.deepEqual(scopesFor().map((scope) => scope.hasCategories), [true, true, true], '三个 scope 都有分类表');
  assert.equal(SCOPES.some((scope) => scope.adapterId === 'all'), false, 'all 没有自己的适配器');

  // Bootstrap counts one scope at a time, and maps the scope to its adapter.
  const routesText = await readFile(join(ROOT, 'lib', 'routes.js'), 'utf8');
  assert.match(routesText, /scopeById/, 'bootstrap 用 scope 解析适配器');
  assert.match(routesText, /sourceParam: scope\.sourceParam/, '计数的 source 参数来自 scope（不串号）');
  assert.match(routesText, /sources: scopesFor\(\)/, 'bootstrap 回三个 scope 描述符');
  assert.match(routesText, /countsOk: counted\.ok === true/, 'countsOk 语义未变');
});


test('K93 单源退场：lib 与 client 里没有 clawhub.ai，退役的模块与路由全为零引用', async () => {
  const libDir = join(ROOT, 'lib');
  const clientDir = join(ROOT, 'src', 'client');

  /** Every .js/.jsx file under one directory, recursively. */
  const collect = async (dir, prefix = '') => {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...await collect(full, `${prefix}${entry.name}/`));
      else if (/\.(js|jsx)$/.test(entry.name)) out.push([`${prefix}${entry.name}`, await readFile(full, 'utf8')]);
    }
    return out;
  };

  const hostFiles = await collect(libDir);
  const clientFiles = await collect(clientDir);
  // `index.js` is the entry, not under lib/: the rule covers the whole Host half.
  const entryText = await readFile(join(ROOT, 'index.js'), 'utf8');
  for (const [name, text] of [...hostFiles, ...clientFiles, ['index.js', entryText]]) {
    assert.equal(text.includes('clawhub.ai'), false, `${name} 里没有 clawhub.ai（U7 之后只有一个上游）`);
  }

  // Retired modules and factories: nothing may reference them any more.
  const all = [...hostFiles, ...clientFiles].map(([, text]) => text).join('\n');
  for (const gone of [
    'readZipEntries', 'readZipEntry', 'ZIP_LIMITS',
    'createLucideIcons', 'createClawhubIconProxy', 'isLucideName', 'isClawhubIconHash',
    'LUCIDE_CDN', 'CLAWHUB_ICON_ORIGIN', 'lucideProxyUrl', 'lucideNameOf', 'clawhubIconUrl',
    'fromClawhubDetail',
  ]) {
    assert.equal(all.includes(gone), false, `${gone} 已随 U7 删除，不能还有引用`);
  }
  assert.equal(existsSync(join(libDir, 'market', 'zip.js')), false, 'zip 读取模块已删除');

  // Routes: eleven, and neither proxy is among them.
  const indexText = await readFile(join(ROOT, 'index.js'), 'utf8');
  const routesText = await readFile(join(ROOT, 'lib', 'routes.js'), 'utf8');
  assert.equal(routesText.includes('market/lucide'), false, '路由表里没有 lucide 代理');
  assert.equal(routesText.includes('market/clawhub-icon'), false, '路由表里没有 clawhub-icon 代理');
  assert.match(indexText, /seven market routes/, 'index.js 的头注说的是七条市场路由');
  const { ROUTES } = await import('../lib/routes.js');
  assert.equal(Object.keys(ROUTES).length, 11, '路由 11 条');

  // Both sources report the same package shape.
  const { descriptors } = await import('../lib/market/sources/index.js');
  assert.deepEqual(descriptors().map((entry) => entry.packageKind), ['files', 'files'], '两源都是逐文件清单');

  // `all` is a scope, never an identity: it must not reach detail/install/icons.
  const { SOURCE_IDS, SCOPES_OF_LIST } = await import('../lib/market/query.js');
  assert.deepEqual([...SOURCE_IDS].sort(), ['clawhub', 'skillhub'], '身份白名单仍只有两个 id');
  assert.equal(SOURCE_IDS.has('all'), false, 'all 不在身份白名单里');
  assert.deepEqual([...SCOPES_OF_LIST].sort(), ['all', 'clawhub', 'skillhub'], '范围白名单是三项');
});
