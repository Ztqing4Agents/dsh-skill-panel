/**
 * The five real-machine samples (collected 2026-11-08), twice: once against the trees
 * committed as fixtures, once against this machine's real `~/.dsh/skills`.
 *
 * Which half is real: `realSkillsRoot()` prefers `$DSH_HOME/skills` and falls back to
 * `~/.dsh/skills`. When that directory exists the cases assert on the machine's own
 * bytes; when it does not (a clean CI box), the same cases run against
 * `test/fixtures/skills-plain` + `target-repo` and say so through `t.diagnostic`, so
 * the count never changes between machines and nothing is silently skipped.
 *
 * Contract: docs/contracts/data-model.md §3.2.3 invariant 4, docs/contracts/acceptance.md 附录 D.4 A1.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { mergeCatalog } from '../lib/classify.js';
import { readLedger } from '../lib/ledger.js';
import { scanUserSkills } from '../lib/scan.js';
import { setDisableModelInvocation } from '../lib/frontmatter.js';
import { ROOT } from './helpers/ssr.mjs';
import { countBareLf, linesOf, sampleTree } from './helpers/tree.mjs';

/**
 * The skills root of this machine, or null when it is absent.
 * @returns {string|null} absolute path.
 */
function realSkillsRoot() {
  const candidates = [
    process.env.DSH_HOME === undefined ? null : join(process.env.DSH_HOME, 'skills'),
    join(process.env.HOME ?? '/nonexistent', '.dsh', 'skills'),
  ].filter((candidate) => candidate !== null && existsSync(candidate));
  return candidates[0] ?? null;
}

/**
 * Merge one skills tree the way the list route does.
 * @param {string} skillsRoot - absolute root.
 * @param {string} dshHome - DSH home for the ledgers.
 * @returns {Promise<object>} the catalogue plus a name → row index.
 */
async function catalogueOf(skillsRoot, dshHome) {
  const scanned = await scanUserSkills(skillsRoot);
  const ledger = await readLedger(dshHome, skillsRoot);
  const catalog = mergeCatalog({ scanned, registry: [], ledger, skillsRoot });
  const byName = new Map(catalog.groups.flatMap((group) => group.skills).map((row) => [row.name, row]));
  return { catalog, byName, scanned };
}

/** The one frontmatter key the switch writes. */
const SWITCH_KEY = 'disable-model-invocation';

/**
 * Assert the A3 invariant on one rewrite: exactly the switch line changed, it reads
 * `true`, and every line ending is still CRLF.
 *
 * A byte-count direction is deliberately *not* part of it. The live sample already
 * carries the key as `false`, so enabling it replaces five bytes with four and the file
 * shrinks by one; "at least one byte more" was an assumption about the sample that the
 * sample no longer satisfies, not a property of the writer. What the writer exists to
 * preserve - the line endings and every other line's bytes - is asserted line by line.
 * @param {Buffer} before - the sample's original bytes.
 * @param {{changed: boolean, next: Buffer}} rewrite - the writer's result.
 * @returns {void}
 */
function assertOnlySwitchLineChanged(before, rewrite) {
  const after = rewrite.next;
  assert.equal(rewrite.changed, true, '改写确实发生');
  assert.equal(countBareLf(after), 0, '改写后仍然没有裸换行（CRLF 没有被洗成 LF）');
  const beforeLines = linesOf(before);
  const afterLines = linesOf(after);
  const withoutSwitch = (lines) => lines.filter((line) => !line.startsWith(`${SWITCH_KEY}: `));
  assert.deepEqual(
    withoutSwitch(afterLines),
    withoutSwitch(beforeLines),
    '除开关那一行外，其余行逐行不变（注释、间距、正文都在）',
  );
  const switchLines = afterLines.filter((line) => line.startsWith(`${SWITCH_KEY}: `));
  assert.equal(switchLines.length, 1, '开关只有一条');
  assert.match(
    switchLines[0],
    new RegExp(`^${SWITCH_KEY}: true(\\s+#.*)?$`),
    '开关写成 true（原样本若带行内注释则原样保留，见 K9）',
  );
  const beforeHadSwitch = beforeLines.some((line) => line.startsWith(`${SWITCH_KEY}: `));
  assert.equal(
    afterLines.length - beforeLines.length,
    beforeHadSwitch ? 0 : 1,
    beforeHadSwitch ? '原样本已有该键：只换值，行数不变' : '原样本没有该键：正好插一行',
  );
}

/** The expected verdict for each of the five samples. */
const EXPECTED = [
  ['dev-docs-standards', 'local', 'R4', 'high', true],
  ['frontend-design', 'installed', 'R7', 'high', false],
  ['ui-design', 'installed', 'R7', 'high', false],
  ['find-skills', 'installed', 'R8', 'medium', false],
  ['dev-expert-pro', 'installed', 'R8', 'medium', false],
];

test('A1 五条真机样本在 fixture 树上 5/5 命中三分区', async (t) => {
  const tree = await sampleTree();
  try {
    t.diagnostic(`fixture tree: ${tree.skillsRoot}`);
    const { byName } = await catalogueOf(tree.skillsRoot, tree.dshHome);
    for (const [name, partition, rule, confidence, symlink] of EXPECTED) {
      const row = byName.get(name);
      assert.ok(row !== undefined, `${name} 出现在列表里`);
      assert.equal(row.partition, partition, `${name} 归入 ${partition}`);
      assert.equal(row.rule, rule, `${name} 由 ${rule} 判定`);
      assert.equal(row.confidence, confidence, `${name} 的置信度是 ${confidence}`);
      assert.equal(row.symlink, symlink, `${name} 的软链事实是 ${symlink}`);
    }
    assert.equal(byName.size, 5, 'fixture 树里正好五条技能，没有幽灵行');
  } finally {
    await tree.cleanup();
  }
});

test('A1 本机真实 ~/.dsh/skills 同样 5/5（无该目录时用 fixture 等价树，并如实标注）', async (t) => {
  const real = realSkillsRoot();
  if (real === null) {
    const tree = await sampleTree();
    try {
      t.diagnostic('本机没有 ~/.dsh/skills，本条改用 fixture 等价树断言（结论只覆盖 fixture）');
      const { byName } = await catalogueOf(tree.skillsRoot, tree.dshHome);
      for (const [name, partition, rule] of EXPECTED) {
        assert.equal(byName.get(name)?.partition, partition, `${name} 归入 ${partition}（fixture）`);
        assert.equal(byName.get(name)?.rule, rule, `${name} 由 ${rule} 判定（fixture）`);
      }
    } finally {
      await tree.cleanup();
    }
    return;
  }
  t.diagnostic(`真实样本目录: ${real}`);
  const { byName, scanned } = await catalogueOf(real, join(real, '..'));
  for (const [name, partition, rule, confidence, symlink] of EXPECTED) {
    const row = byName.get(name);
    assert.ok(row !== undefined, `真实目录里的 ${name} 出现在列表里`);
    assert.equal(row.partition, partition, `真实 ${name} 归入 ${partition}`);
    assert.equal(row.rule, rule, `真实 ${name} 由 ${rule} 判定`);
    assert.equal(row.confidence, confidence, `真实 ${name} 的置信度是 ${confidence}`);
    assert.equal(row.symlink, symlink, `真实 ${name} 的软链事实是 ${symlink}`);
  }
  const names = scanned.map((candidate) => candidate.declaredName).sort();
  assert.deepEqual(names, ['dev-docs-standards', 'dev-expert-pro', 'find-skills', 'frontend-design', 'ui-design'], '真实目录扫描出的正好是这五条（.DS_Store 没有变成幽灵行）');
});

test('A1 软链样本给出的真实路径指向本机 git 仓库（而不是技能根下的副本）', async (t) => {
  const real = realSkillsRoot();
  if (real === null) {
    const tree = await sampleTree();
    try {
      t.diagnostic('本机没有 ~/.dsh/skills，本条改用 fixture 软链树断言');
      const { byName } = await catalogueOf(tree.skillsRoot, tree.dshHome);
      const row = byName.get('dev-docs-standards');
      assert.equal(row.path, null, '软链行没有可写路径（fixture）');
      assert.ok(row.realPath.endsWith(join('target-repo', 'SKILL.md')), 'realPath 指向链接目标（fixture）');
    } finally {
      await tree.cleanup();
    }
    return;
  }
  const { byName } = await catalogueOf(real, join(real, '..'));
  const row = byName.get('dev-docs-standards');
  assert.equal(row.symlink, true, '真实样本是软链');
  assert.equal(row.path, null, '软链行没有可写路径');
  assert.equal(row.writable, false, '软链行不可写');
  assert.ok(row.realPath.endsWith(join('Agents', 'Skills', 'dev-docs-standards', 'SKILL.md')), 'realPath 指向 ~/Documents/Agents/Skills 下的仓库');
});

test('A3 真实 CRLF 样本改写后行尾不变、只改开关键一行（无该样本时用 CRLF fixture）', async (t) => {
  const real = realSkillsRoot();
  const crlfFile = real === null ? null : join(real, 'indiv-guipi--find-skills', 'SKILL.md');
  const hasRealCrlf = crlfFile !== null && existsSync(crlfFile);
  const file = hasRealCrlf ? crlfFile : join(ROOT, 'test', 'fixtures', 'skills-crlf', 'indiv-guipi--find-skills', 'SKILL.md');
  t.diagnostic(hasRealCrlf ? `真实 CRLF 样本: ${file}` : '本机没有 CRLF 样本，本条改用 fixture');
  const before = await readFile(file);
  assert.equal(countBareLf(before), 0, '样本本身没有裸换行');
  const rewrite = setDisableModelInvocation(before, true);
  // The live sample may already carry the key as `false`: enabling it then *shrinks*
  // the file by a byte. Byte count is not the invariant; the line endings and every
  // other line's bytes are. The helper is shared with the mutant guard below, so this
  // test cannot drift away from "what a regression looks like".
  assertOnlySwitchLineChanged(before, rewrite);
  const again = setDisableModelInvocation(rewrite.next, true);
  assert.equal(again.changed, false, '重复写入不改字节');
});

test('A3 反例守卫：CRLF 被洗成 LF、开关没被改写、或顺带改了别的行，都会被 A3 的断言抓住', () => {
  const before = Buffer.from('---\r\nname: x\r\ndisable-model-invocation: false\r\n---\r\nbody\r\n', 'utf8');
  const rewritten = setDisableModelInvocation(before, true);
  assertOnlySwitchLineChanged(before, rewritten);
  const text = before.toString('utf8');
  assert.throws(
    () => assertOnlySwitchLineChanged(before, { changed: true, next: Buffer.from(text.replaceAll('\r\n', '\n'), 'utf8') }),
    /裸换行/,
    '只写回时把 CRLF 洗成 LF ⇒ 必须红',
  );
  assert.throws(
    () => assertOnlySwitchLineChanged(before, { changed: false, next: before }),
    /改写确实发生/,
    '该字段根本没被改写 ⇒ 必须红',
  );
  assert.throws(
    () => assertOnlySwitchLineChanged(before, { changed: true, next: Buffer.from(text.replace('name: x', 'name: y'), 'utf8') }),
    /其余行逐行不变/,
    '顺带改了别的行 ⇒ 必须红',
  );
});

test('KI-2 回归：真机 ui-design 的行描述是三句完整正文，末尾一个换行', async (t) => {
  const real = realSkillsRoot();
  if (real === null) {
    const tree = await sampleTree();
    try {
      t.diagnostic('本机没有 ~/.dsh/skills，本条改用 fixture 的折叠标量技能断言');
      const scanned = await scanUserSkills(join(ROOT, 'test', 'fixtures', 'skills-messy'));
      const folded = scanned.find((candidate) => candidate.dirName === 'folded-desc');
      assert.equal(
        folded.description,
        'Folded first sentence. Folded second sentence. Folded third sentence.\n',
        '折叠标量被折成一句话（fixture）',
      );
    } finally {
      await tree.cleanup();
    }
    return;
  }
  t.diagnostic(`真实样本目录: ${real}`);
  const { byName, scanned } = await catalogueOf(real, join(real, '..'));
  const uiDesign = byName.get('ui-design');
  assert.equal(
    uiDesign.description,
    'Comprehensive UI design skill covering fundamentals, patterns, and anti-patterns. '
      + 'Layout, typography, color, spacing, accessibility, motion, and component design. '
      + 'Use when building any web interface, reviewing design quality, or creating distinctive UIs.\n',
    '真机 ui-design 的行描述是三句正文 + 一个 clip 换行（与宿主 yaml.parse 读同一文件的结果一致）',
  );
  assert.notEqual(uiDesign.description, '>', '指示符本身不再被当成描述');
  const raw = scanned.find((candidate) => candidate.dirName === 'clawhub-wpank--ui-design');
  assert.equal(raw.description.startsWith('Comprehensive UI design skill'), true, '扫描层的原始候选就已经是正文');
});
