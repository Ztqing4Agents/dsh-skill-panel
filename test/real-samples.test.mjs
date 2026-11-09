/**
 * The five real-machine samples (collected 2026-11-08), asserted against the trees
 * committed as fixtures - never against this machine's `~/.dsh/skills`.
 *
 * Why fixture-only (R9): the earlier version also read the live directory and asserted
 * on whatever was there. That turned the user's skill inventory into a test input: when
 * `ui-design` / `indiv-guipi--find-skills` were uninstalled the suite went red for a
 * reason no code change could fix, and on a box without the directory the same cases
 * quietly asserted the fallback instead. The committed fixtures are byte copies of those
 * samples (`skills-plain`, `skills-crlf`, `target-repo`), so nothing is lost by dropping
 * the live half - and the result no longer depends on the machine.
 *
 * Contract: docs/contracts/data-model.md §3.2.3 invariant 4, docs/contracts/acceptance.md 附录 D.4 A1.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { mergeCatalog } from '../lib/classify.js';
import { readLedger } from '../lib/ledger.js';
import { scanUserSkills } from '../lib/scan.js';
import { setDisableModelInvocation } from '../lib/frontmatter.js';
import { ROOT } from './helpers/ssr.mjs';
import { countBareLf, FIXTURES, linesOf, sampleTree } from './helpers/tree.mjs';

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

test('A1 五条样本的判定与机器无关：临时目录里的 fixture 树给出同样的 5/5', async (t) => {
  const tree = await sampleTree();
  try {
    // 这一步同时证明「结果只取决于树里的字节」：树在 mkdtemp 出来的临时目录里，
    // 不碰 ~/.dsh，也没有任何本机状态参与。
    assert.equal(tree.skillsRoot.includes('.dsh'), false, '技能根在临时目录里（本条读数不来自本机 ~/.dsh）');
    t.diagnostic(`fixture tree: ${tree.skillsRoot}`);
    const { byName, scanned } = await catalogueOf(tree.skillsRoot, tree.dshHome);
    for (const [name, partition, rule, confidence, symlink] of EXPECTED) {
      const row = byName.get(name);
      assert.ok(row !== undefined, `${name} 出现在列表里`);
      assert.equal(row.partition, partition, `${name} 归入 ${partition}`);
      assert.equal(row.rule, rule, `${name} 由 ${rule} 判定`);
      assert.equal(row.confidence, confidence, `${name} 的置信度是 ${confidence}`);
      assert.equal(row.symlink, symlink, `${name} 的软链事实是 ${symlink}`);
    }
    const names = scanned.map((candidate) => candidate.declaredName).sort();
    assert.deepEqual(
      names,
      ['dev-docs-standards', 'dev-expert-pro', 'find-skills', 'frontend-design', 'ui-design'],
      '扫描出的正好是这五条（.DS_Store 与别的目录没有变成幽灵行）',
    );
  } finally {
    await tree.cleanup();
  }
});

test('A1 软链样本的真实路径指向链接目标（而不是技能根下的一份副本）', async (t) => {
  const tree = await sampleTree();
  try {
    t.diagnostic(`fixture 软链树: ${tree.skillsRoot}`);
    const { byName } = await catalogueOf(tree.skillsRoot, tree.dshHome);
    const row = byName.get('dev-docs-standards');
    assert.equal(row.symlink, true, '样本是软链');
    assert.equal(row.path, null, '软链行没有可写路径');
    assert.equal(row.writable, false, '软链行不可写');
    // macOS 的 /var 是 /private/var 的软链，临时目录会因此有两种写法：两边都过一遍 realpath 再比。
    assert.equal(realpathSync(row.realPath), realpathSync(join(tree.targetRepo, 'SKILL.md')), 'realPath 是链接目标里的 SKILL.md，不是根下的副本');
    // 反例守卫：这个路径必须真的在技能根之外（真机 bug 就是「以为在根下」）
    assert.equal(row.realPath.startsWith(tree.skillsRoot), false, 'realPath 不在技能根之下');
  } finally {
    await tree.cleanup();
  }
});

test('A3 CRLF 样本改写后行尾不变、只改开关键一行', async (t) => {
  // fixture 是那份真机样本的逐字节副本（skills-crlf），所以这条既确定又不丢覆盖：
  // 真机样本被用户移走后，测试不该跟着红。
  const file = join(FIXTURES, 'skills-crlf', 'indiv-guipi--find-skills', 'SKILL.md');
  t.diagnostic(`CRLF 样本: ${file}`);
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

test('KI-2 回归：折叠标量折成正文（三句 + 一个换行），单行描述原样保留', async (t) => {
  // 真机样本被用户移走后这条不该跟着红，所以两份样本都用提交在 fixture 里的副本：
  //   - skills-messy/folded-desc 是 `description: >` 的三句折叠块（KI-2 的原始现场）
  //   - skills-plain/clawhub-wpank--ui-design 是同一批样本里的单行描述
  const messy = await scanUserSkills(join(FIXTURES, 'skills-messy'));
  const folded = messy.find((candidate) => candidate.dirName === 'folded-desc');
  t.diagnostic(`折叠标量样本: ${join(FIXTURES, 'skills-messy', 'folded-desc')}`);
  assert.equal(
    folded.description,
    'Folded first sentence. Folded second sentence. Folded third sentence.\n',
    '三句正文折成一句话、末尾一个换行',
  );
  assert.notEqual(folded.description, '>', '指示符本身不再被当成描述');
  assert.equal(folded.description.startsWith('Folded first sentence.'), true, '原始候选就已经是正文');

  const fixtureRoot = join(FIXTURES, 'skills-plain');
  const scanned = await scanUserSkills(fixtureRoot);
  const uiDesign = scanned.find((candidate) => candidate.dirName === 'clawhub-wpank--ui-design');
  assert.ok(uiDesign !== undefined, 'ui-design 样本出现在扫描结果里');
  assert.equal(
    uiDesign.description,
    'Comprehensive UI design skill covering fundamentals, patterns, and anti-patterns.',
    '单行描述原样保留（这条样本本身只有一句话，不要再被折一次）',
  );
});
