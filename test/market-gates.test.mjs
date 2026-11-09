/**
 * The gates that must stay green for the market round: the three scripts, the new
 * contract numbers, and the two "never again" rules that only a grep can hold.
 *
 * Contracts: AGENTS.md rules 2 / 4 / 9 / 13 (no CJK in sources, no host hash class
 * names, click affordance boundaries, the browser never calls an upstream), and
 * docs/contracts/acceptance.md 附录 D.3 numbering; case ids K40, K41.
 *
 * The three scripts are executed as subprocesses, exactly as `npm run check` runs
 * them: importing them would skip their `process.exitCode` handling, which is the
 * part that decides whether a red gate stops a release.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
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
  assert.equal(/border:/.test(card), false, '卡面无描边（附录 E 决策 E-1）');

  const open = ruleOf('.skc_marketCardOpen::after');
  assert.match(open, /position: absolute/, '整卡可点层的定位');
  assert.match(open, /inset: 0/, '整卡可点层铺满卡片（AGENTS.md 规则 9 的唯一手段）');
  assert.match(open, /border-radius: var\(--dsw-radius-xl\)/, '可点层跟随卡片圆角');

  const end = ruleOf('.skc_marketCardEnd');
  assert.match(end, /z-index: 1/, '动作位浮在可点层之上（不可省）');
  assert.match(end, /align-self: flex-end/, '动作位靠右下（新刻度 ③）');

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

test('K41 浏览器半部不直连上游：src/client/** 里没有两个源的 origin', async () => {
  const dir = join(ROOT, 'src', 'client');
  const files = (await readdir(dir)).filter((name) => /\.(js|jsx)$/.test(name));
  assert.equal(files.length > 10, true, '确实扫到了客户端源码');
  const offenders = [];
  for (const name of files) {
    const text = await readFile(join(dir, name), 'utf8');
    if (/api\.skillhub\.cn|clawhub\.ai/.test(text)) offenders.push(name);
  }
  assert.deepEqual(offenders, [], `客户端源码里没有上游 origin（发现：${offenders.join(', ')}）`);

  // 递归扫 lib/market：两个 origin 分别住在 sources/skillhub.js 与 sources/clawhub.js。
  const libDir = join(ROOT, 'lib', 'market');
  const withOrigin = [];
  const walk = async (dir, prefix) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, `${prefix}${entry.name}/`);
      else if (entry.name.endsWith('.js')) {
        const text = await readFile(full, 'utf8');
        if (/api\.skillhub\.cn|clawhub\.ai/.test(text)) withOrigin.push(`${prefix}${entry.name}`);
      }
    }
  };
  await walk(libDir, '');
  assert.equal(withOrigin.length > 0, true, '上游 origin 出现在 Host 半部（否则这条断言等于没测）');
  assert.equal(withOrigin.includes('install.js'), false, '安装编排本身不认识任何 origin');
  assert.equal(withOrigin.includes('zip.js'), false, 'zip 读取器不认识任何 origin');
  assert.equal(withOrigin.includes('normalize.js'), false, '归一化不认识任何 origin');
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
