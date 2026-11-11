/**
 * Self-test for the documentation gate (`scripts/check-docs.mjs`).
 *
 * A gate that is only ever seen green rots: every check here breaks the tree on
 * purpose and asserts the gate turns red, so a silently no-op rule cannot survive.
 * The lint logic under test is structural only — no real repo files are touched.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tempDir } from './helpers/tree.mjs';

const GATE = fileURLToPath(new URL('../scripts/check-docs.mjs', import.meta.url));

const CONTRACT = `# 示例契约

> 类型：规范
> 读者：改代码的人
> 真源：代码本身
> 更新触发：改代码时同步改本节
> 规模上限：400

## 3.2.4 读侧契约

条款正文。

## 验收

\`npm test\` 全绿。
`;

const REFERENCE = `# 示例参考

> 类型：参考
> 读者：要复刻外部形状的人
> 真源：外部产物本身
> 更新触发：外部升级后整份重采
> 规模上限：600
> 采集日期：2026-11-01
> 来源版本：demo/1.0.0

正文。
`;

const CHANGELOG = `# Changelog

## [Unreleased]

## [0.1.0] - 2026-11-09

### Added

- 某功能。
`;

/**
 * Broken anchors are built at run time: this file lives under `test/`, and the docs gate
 * scans test headers for `§x.y` references — a literal broken ref here would make the gate
 * red on its own self-test.
 */
const badRef = (major, minor) => `§${major}.${minor}`;

const BASELINE = {
  'AGENTS.md': '# AGENTS\n\n命令见下。\n',
  'CHANGELOG.md': CHANGELOG,
  'docs/contracts/example.md': CONTRACT,
  'docs/reference/example.md': REFERENCE,
};

/** Materialise a temp tree. @param {Record<string,string>} files path → content */
async function tree(files) {
  const { dir, cleanup } = await tempDir();
  for (const [path, content] of Object.entries(files)) {
    const abs = join(dir, path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  return { dir, cleanup };
}

/** Run the gate against a temp tree. @returns {{status: number, out: string}} */
function runGate(dir) {
  try {
    const out = execFileSync(process.execPath, [GATE, '--root', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, out };
  } catch (error) {
    return { status: error.status ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

test('基线树：干净的文档体系应当全绿', async () => {
  const { dir, cleanup } = await tree(BASELINE);
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 0, out);
    assert.match(out, /check-docs: OK/);
  } finally {
    await cleanup();
  }
});

test('R1 白名单：根目录多出一份没人登记过的 md 必须红', async () => {
  const { dir, cleanup } = await tree({ ...BASELINE, 'notes.md': '# 随手记\n' });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /R1 notes\.md/);
  } finally {
    await cleanup();
  }
});

test('R1 白名单：test/ 下的数据夹具不算文档（新增 SKILL.md 不该红）', async () => {
  const { dir, cleanup } = await tree({
    ...BASELINE,
    'test/fixtures/some-skill/SKILL.md': '---\nname: some-skill\ndescription: fixture\n---\n',
  });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 0, out);
  } finally {
    await cleanup();
  }
});

test('R2/R3 头注：缺「规模上限」或取值与类型不符都必须红', async () => {
  const noLimit = CONTRACT.replace('> 规模上限：400\n', '');
  const wrongLimit = CONTRACT.replace('> 规模上限：400', '> 规模上限：600');

  for (const [variant, pattern] of [
    [{ 'docs/contracts/example.md': noLimit }, /R(2|3) docs\/contracts\/example\.md/],
    [{ 'docs/contracts/example.md': wrongLimit }, /R3 docs\/contracts\/example\.md/],
  ]) {
    const { dir, cleanup } = await tree({ ...BASELINE, ...variant });
    try {
      const { status, out } = runGate(dir);
      assert.equal(status, 1, out);
      assert.match(out, pattern);
    } finally {
      await cleanup();
    }
  }
});

test('R4 章节：类型 规范 必须有一个含「验收」的二级章节', async () => {
  const files = { ...BASELINE, 'docs/contracts/example.md': CONTRACT.replace('## 验收\n\n`npm test` 全绿。\n', '') };
  const { dir, cleanup } = await tree(files);
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /R4 docs\/contracts\/example\.md/);
  } finally {
    await cleanup();
  }
});

test('R5 时效：参考类缺采集日期红；超过 180 天只告警', async () => {
  const noDate = REFERENCE.replace('> 采集日期：2026-11-01\n', '');
  {
    const { dir, cleanup } = await tree({ ...BASELINE, 'docs/reference/example.md': noDate });
    try {
      const { status, out } = runGate(dir);
      assert.equal(status, 1, out);
      assert.match(out, /R5 docs\/reference\/example\.md/);
    } finally {
      await cleanup();
    }
  }

  const stale = REFERENCE.replace('> 采集日期：2026-11-01', '> 采集日期：2024-01-01');
  {
    const { dir, cleanup } = await tree({ ...BASELINE, 'docs/reference/example.md': stale });
    try {
      const { status, out } = runGate(dir);
      assert.equal(status, 0, out);
      assert.match(out, /warn R5 .*已 \d+ 天/);
    } finally {
      await cleanup();
    }
  }
});

test('R7 锚点：指向不存在的 §编号 / 附录 必须红', async () => {
  const dangling = CONTRACT.replace('条款正文。', `条款正文（见 ${badRef(9, 9)}）。`);
  const { dir, cleanup } = await tree({ ...BASELINE, 'docs/contracts/example.md': dangling });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /R7 .*§9\.9/);
  } finally {
    await cleanup();
  }
});

test('R7 锚点：跨文件引用必须落到目标文件里真实存在的编号', async () => {
  const other = CONTRACT.replace('# 示例契约', '# 另一份契约').replace('条款正文。', `见 \`docs/contracts/example.md\` ${badRef(7, 7)}。`);
  const { dir, cleanup } = await tree({ ...BASELINE, 'docs/contracts/other.md': other });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /R7 .*§7\.7/);
  } finally {
    await cleanup();
  }
});

test('R8 引用可达：反引号里的仓库路径不存在必须红', async () => {
  const broken = CONTRACT.replace('条款正文。', '实现在 `lib/nope.js` 里。');
  const { dir, cleanup } = await tree({ ...BASELINE, 'docs/contracts/example.md': broken });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /R8 .*lib\/nope\.js/);
  } finally {
    await cleanup();
  }
});

test('R9 零行号：file:line 与「第 N 行」都必须红', async () => {
  for (const sentence of ['实现在 `lib/classify.js:12` 里。', '见 §3.2.4 的第 5 行。']) {
    const { dir, cleanup } = await tree({ ...BASELINE, 'docs/contracts/example.md': CONTRACT.replace('条款正文。', sentence) });
    try {
      const { status, out } = runGate(dir);
      assert.equal(status, 1, out);
      assert.match(out, /R9/);
    } finally {
      await cleanup();
    }
  }
});

test('R6 CHANGELOG：非官方类目与坏版本号都必须红', async () => {
  for (const changelog of [CHANGELOG.replace('### Added', '### Misc'), CHANGELOG.replace('## [0.1.0] - 2026-11-09', '## [0.1.0] 2026-11-09')]) {
    const { dir, cleanup } = await tree({ ...BASELINE, 'CHANGELOG.md': changelog });
    try {
      const { status, out } = runGate(dir);
      assert.equal(status, 1, out);
      assert.match(out, /R6 CHANGELOG\.md/);
    } finally {
      await cleanup();
    }
  }
});

test('R10 体量：AGENTS.md 超 100 行只告警，不判红', async () => {
  const long = `# AGENTS\n\n${Array.from({ length: 120 }, (_, i) => `- 行 ${i + 1}`).join('\n')}\n`;
  const { dir, cleanup } = await tree({ ...BASELINE, 'AGENTS.md': long });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 0, out);
    assert.match(out, /warn R10 AGENTS\.md: \d+ lines/);
  } finally {
    await cleanup();
  }
});

test('R12 体量：README.md 超 120 行只告警，不判红', async () => {
  const long = `# README\n\n${Array.from({ length: 120 }, (_, i) => `- 行 ${i + 1}`).join('\n')}\n`;
  const { dir, cleanup } = await tree({ ...BASELINE, 'README.md': long });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 0, out);
    assert.match(out, /warn R12 README\.md: \d+ lines/);
  } finally {
    await cleanup();
  }
});


test('R5 参考类：缺「来源版本」必须红（外部升级是第一过期触发器，不能只有采集日期）', async () => {
  const noVersion = REFERENCE.replace('> 来源版本：demo/1.0.0\n', '');
  assert.notEqual(noVersion, REFERENCE, 'R5 用例没有删到来源版本');
  const { dir, cleanup } = await tree({ ...BASELINE, 'docs/reference/example.md': noVersion });
  try {
    const { status, out } = runGate(dir);
    assert.equal(status, 1, out);
    assert.match(out, /RED\s+R5 .*来源版本/);
  } finally {
    await cleanup();
  }
});
