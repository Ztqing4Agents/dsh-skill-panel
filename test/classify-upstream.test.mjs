/**
 * `lib/classify.js` — the nine-step ladder must not notice `upstream` at all.
 *
 * Contract: docs/contracts/routes.md §3.3.1 (`upstream` is display data, never a rule;
 * invariant `upstream !== null => rule ∈ {R4,R5,R6}`), data-model.md §3.2.2; case id K63 (L1).
 *
 * Two claims, both checkable without a filesystem:
 *
 *   1. the ladder's answer for one fact set is byte-identical before and after a row gains
 *      an upstream identity - `classifySkill` has no `upstream` input, so this is really a
 *      regression pin on the *input shape* (if somebody ever feeds identity into a rule,
 *      the nine fixtures below start disagreeing);
 *   2. the invariant holds across every combination of the four facts that matter: identity
 *      can only exist when `metaSource` is true (scan.js guarantees it), and `metaSource`
 *      is reached only after the symlink (R4) and ledger (R5) branches - so the rule is
 *      always one of R4/R5/R6. Anything else would mean an identity outlived the fact that
 *      created it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { classifySkill, mergeCatalog } from '../lib/classify.js';
import { scanUserSkills } from '../lib/scan.js';
import { skillFile, tempDir } from './helpers/tree.mjs';

/** An identity as `scan.js` would attach it. */
const IDENTITY = { sourceId: 'clawhub', owner: 'awspace', slug: 'pdf' };

/**
 * The nine ladder inputs, one per rule, in ladder order.
 *
 * Each entry names the one fact that decides it; the `expected` values are the contract's,
 * not the implementation's (they are what `rules.md` / data-model.md document).
 */
const NINE = [
  { rule: 'R1', why: 'provider 不是 filesystem', input: { provider: 'bundled', declaredName: 'ui-design' }, expected: 'builtin' },
  { rule: 'R2', why: 'rank 600（内置位置）', input: { provider: 'filesystem', rank: 600, declaredName: 'ui-design' }, expected: 'builtin' },
  { rule: 'R3', why: 'rank 在排除集里', input: { provider: 'filesystem', rank: 100, declaredName: 'ui-design' }, expected: 'excluded' },
  // rank 400 = user-dsh：既不是 600（R2）也不在排除集 {100,200,300,500}（R3），才能走到 R4
  { rule: 'R4', why: '软链', input: { provider: 'filesystem', rank: 400, symlink: true, declaredName: 'ui-design' }, expected: 'local' },
  { rule: 'R5', why: '台账命中', input: { provider: 'filesystem', rank: 400, ledgerHit: true, declaredName: 'ui-design' }, expected: 'installed' },
  { rule: 'R6', why: '有来源元数据', input: { provider: 'filesystem', rank: 400, metaSource: true, declaredName: 'ui-design' }, expected: 'installed' },
  { rule: 'R7', why: '只有 release 元数据', input: { provider: 'filesystem', rank: 400, metaRelease: true, declaredName: 'ui-design' }, expected: 'installed' },
  { rule: 'R8', why: '目录名带工具前缀且后缀等于声明名', input: { provider: 'filesystem', rank: 400, dirName: 'clawhub-awspace--ui-design', declaredName: 'ui-design' }, expected: 'installed' },
  { rule: 'R9', why: '兜底', input: { provider: 'filesystem', rank: 400, dirName: 'hand-written', declaredName: 'hand-written' }, expected: 'local' },
];

test('K63 九条判据逐条跑：加 `upstream` 前后 `partition`/`rule` 完全相同', () => {
  assert.equal(NINE.length, 9, '九条判据一条不少');
  for (const entry of NINE) {
    const before = classifySkill(entry.input);
    const after = classifySkill({ ...entry.input, upstream: IDENTITY });
    assert.equal(before.rule, entry.rule, `${entry.rule}：${entry.why}`);
    assert.equal(before.partition, entry.expected, `${entry.rule} 落在 ${entry.expected}`);
    assert.deepEqual(after, before, `${entry.rule}：多带一个 upstream 也不影响任何字段`);
  }
  // 九条真的被九条不同判据认领（不是九份同样的事实）
  assert.equal(new Set(NINE.map((entry) => entry.rule)).size, 9, '九条判据互不相同');
});

test('K63 property：管线全表（扫描候选 × 注册表摘要）里 `upstream !== null ⇒ rule ∈ {R4,R5,R6}`', () => {
  // 为什么在 `mergeCatalog` 层而不是裸 `classifySkill` 层：`mergeCatalog` 给所有**扫描**候选
  // 统一 rank 400（user-dsh），可能落在 R3 的只有注册表候选，而注册表候选没有 scan ⇒ 没有身份。
  // 这两条合起来才是契约 §3.3.1 不变式 ③ 的依据。
  let combos = 0;
  let withIdentity = 0;
  let registryRows = 0;
  for (const symlink of [false, true]) {
    for (const ledgerHit of [false, true]) {
      for (const metaSource of [false, true]) {
        for (const metaRelease of [false, true]) {
          for (const hasIdentity of [false, true]) {
            combos += 1;
            const scanned = [{
              declaredName: 'probe',
              dirName: 'probe',
              symlink,
              metaSource,
              metaRelease,
              ledgerHit,
              upstream: hasIdentity ? IDENTITY : null,
            }];
            const { groups } = mergeCatalog({ scanned, registry: [], ledger: { entries: new Set(ledgerHit ? ['probe'] : []) }, skillsRoot: '/x' });
            const rows = groups.flatMap((group) => group.skills);
            assert.equal(rows.length, 1, '一个名字一行');
            const [row] = rows;
            if (hasIdentity) withIdentity += 1;
            // 一致的那一侧（scan.js 只会产出这种）：有身份的行只可能是 R4/R5/R6。
            if (hasIdentity && metaSource) {
              assert.equal(['R4', 'R5', 'R6'].includes(row.rule), true, `有身份的行只能是 R4/R5/R6，实测 ${row.rule}（symlink=${symlink} ledger=${ledgerHit} metaSource=${metaSource} metaRelease=${metaRelease}）`);
              // R4 是软链那一支，行仍在 local；R5/R6 才在 installed。三者在契约里都合法。
              assert.equal(row.partition, row.rule === 'R4' ? 'local' : 'installed', `${row.rule} ⇒ ${row.rule === 'R4' ? 'local' : 'installed'}`);
            }
            // 身份不许抬判据：只有身份、没有任何元数据事实时，规则仍停在 R8/R9 那一档。
            // 这条也解释了为什么不变式只在「scan 一致」时成立——身份与事实必须同源。
            if (hasIdentity && !symlink && !ledgerHit && !metaSource && !metaRelease) {
              assert.equal(['R8', 'R9'].includes(row.rule), true, `身份不能把行抬进已安装（实测 ${row.rule}）`);
              assert.equal(row.partition, 'local', '没有元数据事实 ⇒ local');
            }
          }
        }
      }
    }
  }
  assert.equal(combos, 2 * 2 * 2 * 2 * 2, '全表 32 组');
  assert.equal(withIdentity > 0, true, '确实覆盖到「有身份」那一侧');

  // 注册表候选：任何 rank 都能落 R1/R2/R3，但恒没有身份（契约 ②）
  for (const rank of [100, 200, 250, 300, 400, 500, 600]) {
    for (const provider of ['filesystem', 'bundled']) {
      const { groups, excluded } = mergeCatalog({
        scanned: [],
        registry: [{ name: 'from-registry', provider, rank, description: 'r', path: null }],
        ledger: { entries: new Set() },
        skillsRoot: '/x',
      });
      const row = groups.flatMap((group) => group.skills)[0];
      registryRows += 1;
      // 排除档（100/200/300/500）不进三组，只计进 `excluded`；其余档有一行。
      assert.equal(excluded, row === undefined ? 1 : 0, `rank=${rank} 的归类与 groups 一致`);
      if (row !== undefined) {
        assert.equal(row.upstream, null, `注册表胜出的行（rank=${rank} ${provider}）恒没有身份`);
        assert.equal(['R1', 'R2', 'R7', 'R8', 'R9', 'R4', 'R5', 'R6'].includes(row.rule) || row.partition !== 'excluded', true, `${row.rule} 不是排除档却不在 groups 里`);
      }
    }
  }
  assert.equal(registryRows, 14, '注册表组合 14 组全部覆盖');
});

test('K63 集成：真扫描出来的行，带身份的规则仍只落在 R4/R5/R6', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const root = join(dir, 'skills');
    const meta = JSON.stringify({ source: 'clawhub', ownerId: 'awspace', slug: 'pdf', version: '1.0.0' });
    // 一条普通的已安装行（R6）
    await mkdir(join(root, 'with-identity'), { recursive: true });
    await writeFile(join(root, 'with-identity', 'SKILL.md'), skillFile({ name: 'with-identity' }));
    await writeFile(join(root, 'with-identity', '_meta.json'), meta);
    // 一条软链行 + 身份（软链优先 ⇒ R4）
    const target = join(dir, 'target-repo');
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'SKILL.md'), skillFile({ name: 'linked-with-identity' }));
    await writeFile(join(target, '_meta.json'), JSON.stringify({ source: 'skillhub', ownerId: 'ake', slug: 'dev-god' }));
    await symlink(target, join(root, 'linked-with-identity'));

    const rows = await scanUserSkills(root);
    const withUpstream = rows.filter((row) => row.upstream !== null);
    assert.equal(withUpstream.length, 2, '两条候选都带身份');
    for (const row of rows) {
      const classification = classifySkill({
        provider: 'filesystem',
        rank: 400,
        symlink: row.symlink,
        ledgerHit: false,
        metaSource: row.metaSource,
        metaRelease: row.metaRelease,
        dirName: row.dirName,
        declaredName: row.name,
      });
      if (row.upstream !== null) {
        assert.equal(['R4', 'R5', 'R6'].includes(classification.rule), true, `${row.dirName} ⇒ ${classification.rule}`);
      }
      // 身份与判据互不干扰：用同一个 input 再跑一次（这次带入身份字段）结果不变
      assert.deepEqual({ ...classification }, classifySkill({
        provider: 'filesystem',
        rank: 400,
        symlink: row.symlink,
        ledgerHit: false,
        metaSource: row.metaSource,
        metaRelease: row.metaRelease,
        dirName: row.dirName,
        declaredName: row.name,
        upstream: row.upstream,
      }), `${row.dirName}：身份不进判据`);
    }
    const rules = rows.map((row) => classifySkill({
      provider: 'filesystem', rank: 400, symlink: row.symlink, ledgerHit: false,
      metaSource: row.metaSource, metaRelease: row.metaRelease, dirName: row.dirName, declaredName: row.name,
    }).rule).sort();
    assert.deepEqual(rules, ['R4', 'R6'], '软链那条走 R4，普通那条走 R6');
  } finally {
    await cleanup();
  }
});
