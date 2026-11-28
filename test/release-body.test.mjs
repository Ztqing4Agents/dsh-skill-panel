/**
 * `scripts/release-body.mjs` 的切法与收尾句。
 *
 * 为什么用子进程而不是 `import`：这个脚本的 CLI 段写在模块顶层，import 时
 * `process.argv[1]` 是测试文件本身、取不到 tag，脚本会打印用法并 `process.exit(2)`——
 * 直接把测试进程带走。这里按 `.github/workflows/publish.yml` 的真实调用方式跑，
 * 第二参数指向临时正文，切法与补句都能验。
 *
 * 体例本身见 `docs/contracts/release-doc-standard.md`：正文从 `# vX.Y.Z` 之后开始，
 * 文末那句「全量变更见 …」缺才补、有则不补。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tempDir } from './helpers/tree.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/release-body.mjs', import.meta.url));
const RELEASES = fileURLToPath(new URL('../docs/releases/', import.meta.url));

/** 收尾句的版本口径由脚本决定，测试只按同一句话断言。 */
const closing = (version) => `全量变更见 \`CHANGELOG.md\` 的 [${version}] 节。`;

/**
 * 跑一次 CLI。
 *
 * @param {string[]} args - 命令行参数。
 * @returns {{status: number, stdout: string, stderr: string}} 退出码与两路输出。
 */
function runCli(args) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    return { status: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

/** 一个临时正文文件的路径。 @param {string} text @returns {Promise<{file: string, cleanup: Function}>} */
async function note(text) {
  const { dir, cleanup } = await tempDir();
  const file = join(dir, 'note.md');
  await writeFile(file, text);
  return { file, cleanup };
}

test('切法：丢掉 `# vX.Y.Z` 标题与紧随空行，标题下那句概览属于正文', async () => {
  const { file, cleanup } = await note('# v9.9.9\n\n一句概览。\n\n## 新增\n\n- 甲。\n');
  try {
    const { status, stdout } = runCli(['v9.9.9', file]);
    assert.equal(status, 0);
    assert.equal(stdout.startsWith('一句概览。'), true, `正文必须从概览句起：${JSON.stringify(stdout.slice(0, 40))}`);
    assert.equal(stdout.includes('# v9.9.9'), false, '标题不该出现在正文里');
    assert.equal(stdout.endsWith(`${closing('9.9.9')}\n`), true, '缺收尾句时补在末尾');
  } finally {
    await cleanup();
  }
});

test('切法：正文首行是空行时，标题仍被剥掉（漏剥会让线上 Release 多一行 `# vX.Y.Z`）', async () => {
  const { file, cleanup } = await note('\n\n# v9.9.9\n\n## 新增\n\n- 甲。\n');
  try {
    const { status, stdout } = runCli(['v9.9.9', file]);
    assert.equal(status, 0);
    assert.equal(stdout.includes('# v9.9.9'), false, `前导空行不该让标题漏进正文：\n${stdout}`);
    assert.equal(stdout.startsWith('## 新增'), true);
    assert.equal(stdout.endsWith(`${closing('9.9.9')}\n`), true);
  } finally {
    await cleanup();
  }
});

test('切法：分类章节、缩进代码块与底部链接逐字保留（不吞正文）', async () => {
  const body = [
    '## 破坏性变更',
    '',
    '- **迁移**：先卸载旧包：',
    '',
    '  ```bash',
    '  dsh plugin --profile <name> remove dsh-skill-panel',
    '  ```',
    '',
    '## 修复',
    '',
    '- **某处塌陷**：宽度不再是 0。',
    '',
    '**完整变更**：[v9.9.8...v9.9.9](https://github.com/Ztqing4Agents/dsh-skill-panel/compare/v9.9.8...v9.9.9) · [CHANGELOG](https://github.com/Ztqing4Agents/dsh-skill-panel/blob/main/CHANGELOG.md#999---2026-11-28)',
  ].join('\n');
  const { file, cleanup } = await note(`# v9.9.9\n\n${body}\n`);
  try {
    const { status, stdout } = runCli(['v9.9.9', file]);
    assert.equal(status, 0);
    // 期望 = 原文去掉标题与空行 + 一个空行 + 收尾句；逐字相等才算「原样输出」。
    assert.equal(stdout, `${body}\n\n${closing('9.9.9')}\n`);
  } finally {
    await cleanup();
  }
});

test('补句：文档已经以收尾句结尾时不再追加第二句', async () => {
  const text = `# v9.9.9\n\n## 新增\n\n- 甲。\n\n${closing('9.9.9')}\n`;
  const { file, cleanup } = await note(text);
  try {
    const { status, stdout } = runCli(['v9.9.9', file]);
    assert.equal(status, 0);
    const hits = stdout.split('\n').filter((line) => line === closing('9.9.9'));
    assert.equal(hits.length, 1, `收尾句只该出现一次：\n${stdout}`);
    assert.equal(stdout.endsWith(`${closing('9.9.9')}\n`), true);
  } finally {
    await cleanup();
  }
});

test('补句：缺收尾句时补在最后一行，不插到中间也不重复', async () => {
  const { file, cleanup } = await note('# v9.9.9\n\n## 新增\n\n- 甲。\n\n## 修复\n\n- 乙。\n');
  try {
    const { status, stdout } = runCli(['v9.9.9', file]);
    assert.equal(status, 0);
    const lines = stdout.trimEnd().split('\n');
    assert.equal(lines[lines.length - 1], closing('9.9.9'));
    assert.equal(lines.filter((line) => line === closing('9.9.9')).length, 1);
  } finally {
    await cleanup();
  }
});

test('换行：CRLF 正文按 LF 输出，不留 \\r', async () => {
  const { file, cleanup } = await note('# v9.9.9\r\n\r\n## 新增\r\n\r\n- 甲。\r\n');
  try {
    const { status, stdout } = runCli(['v9.9.9', file]);
    assert.equal(status, 0);
    assert.equal(stdout.includes('\r'), false, '输出里不该留 CR');
    assert.equal(stdout.startsWith('## 新增'), true);
  } finally {
    await cleanup();
  }
});

test('失败路径：缺参数 exit 2；tag 形态非法、文件不存在、正文为空一律 exit 1', async () => {
  assert.equal(runCli([]).status, 2, '缺参数该按用法退出');

  const { file, cleanup } = await note('# v9.9.9\n\n## 新增\n\n- 甲。\n');
  try {
    const badTag = runCli(['9.9.9', file]);
    assert.equal(badTag.status, 1);
    assert.match(badTag.stderr, /tag 不是 vX\.Y\.Z 形态/);

    const missing = runCli(['v9.9.9', join(file, '..', 'nope.md')]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /找不到逐版正文/);
  } finally {
    await cleanup();
  }

  // 只剩标题：切完是空正文，CI 里建一个空 Release 比失败更糟，所以必须 exit 1。
  const empty = await note('# v9.9.9\n');
  try {
    const run = runCli(['v9.9.9', empty.file]);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /正文为空/);
    assert.equal(run.stdout, '');
  } finally {
    await empty.cleanup();
  }
});

test('对仓库里每一份逐版正文：输出不含标题，去掉末尾补句后与文档正文逐字相同', async () => {
  const files = (await readdir(RELEASES)).filter((name) => name.endsWith('.md')).sort();
  assert.ok(files.length > 0, 'docs/releases/ 里应当有逐版正文');
  for (const name of files) {
    const tag = name.slice(0, -3);
    const version = tag.replace(/^v/, '');
    const doc = await readFile(join(RELEASES, name), 'utf8');
    const { status, stdout } = runCli([tag]);
    assert.equal(status, 0, `${tag} 应当能生成正文`);
    assert.equal(stdout.startsWith('# '), false, `${tag} 的正文不该以一级标题开头`);

    // 按规范算期望，而不是照抄实现：首行标题连同紧随的空行一起去掉，其余原样。
    const lines = doc.replace(/\r\n?/g, '\n').split('\n');
    let start = 1;
    while (start < lines.length && lines[start].trim() === '') start += 1;
    const wantBody = lines.slice(start).join('\n').trimEnd();
    const tail = `\n\n${closing(version)}\n`;
    assert.equal(stdout, `${wantBody}${tail}`, `${tag} 的正文与文档差在切法或补句上`);
  }
});
