/**
 * `lib/classify.js` — the nine-step ladder, the rank table, and the same-name merge.
 *
 * Contracts: docs/contracts/data-model.md §3.2.2, §3.2.3; case ids K2, K3, K4, K5, K21.
 * PRD §3.1.2 (priority) and §3.1.3 (real samples) are the acceptance source.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGroups, classifySkill, mergeCatalog, rankOf } from '../lib/classify.js';

/** A ClassifyInput with every signal switched off. */
const quiet = {
  provider: 'filesystem',
  rank: 400,
  symlink: false,
  ledgerHit: false,
  metaSource: false,
  metaRelease: false,
  dirName: 'plain',
  declaredName: 'plain',
};

/** One scanned candidate (rank is always 400 for a directory scan). */
function scanned(name, overrides = {}) {
  return {
    dirName: name,
    declaredName: name,
    description: `${name} description`,
    displayName: '',
    instructionPath: `/skills/${name}/SKILL.md`,
    realPath: null,
    symlink: false,
    disableModelInvocation: false,
    metaSource: false,
    metaRelease: false,
    metaEvidence: '',
    ...overrides,
  };
}

/** One registry summary, already annotated with the rank the registry hides. */
function registry(name, rank, overrides = {}) {
  return { name, description: `${name} from registry`, provider: 'filesystem', rank, ...overrides };
}

test('rankOf 复刻官方根优先级表 100/200/250/300/400/500/600', () => {
  assert.equal(rankOf('project-dsh'), 100, 'project-dsh 的 rank 是 100');
  assert.equal(rankOf('project-agents'), 200, 'project-agents 的 rank 是 200');
  assert.equal(rankOf('runtime'), 250, 'runtime provider 的 rank 是 250');
  assert.equal(rankOf('custom'), 300, 'custom 根的 rank 是 300');
  assert.equal(rankOf('user-dsh'), 400, 'user-dsh 根的 rank 是 400');
  assert.equal(rankOf('user-agents'), 500, 'user-agents 根的 rank 是 500');
  assert.equal(rankOf('bundled'), 600, 'bundled 根的 rank 是 600');
});

test('rankOf 对未知档位回落 600，而不是 Infinity 或 NaN', () => {
  assert.equal(rankOf('third-party'), 600, '未知档位回落 600');
  assert.equal(rankOf(undefined), 600, '缺省档位回落 600');
  assert.equal(Number.isNaN(rankOf('x')), false, '回落值不是 NaN');
});

test('K2 九级阶梯逐级命中，rule 与 partition 一一对应', () => {
  const cases = [
    ['R1', { ...quiet, provider: 'runtime' }, 'builtin', 'high'],
    ['R2', { ...quiet, provider: 'filesystem', rank: 600 }, 'builtin', 'high'],
    ['R3-100', { ...quiet, rank: 100 }, 'excluded', 'high'],
    ['R3-200', { ...quiet, rank: 200 }, 'excluded', 'high'],
    ['R3-300', { ...quiet, rank: 300 }, 'excluded', 'high'],
    ['R3-500', { ...quiet, rank: 500 }, 'excluded', 'high'],
    ['R4', { ...quiet, symlink: true }, 'local', 'high'],
    ['R5', { ...quiet, ledgerHit: true }, 'installed', 'high'],
    ['R6', { ...quiet, metaSource: true }, 'installed', 'high'],
    ['R7', { ...quiet, metaRelease: true }, 'installed', 'high'],
    ['R9', { ...quiet }, 'local', 'high'],
  ];
  for (const [label, input, partition, confidence] of cases) {
    const result = classifySkill(input);
    const expectedRule = label.startsWith('R3') ? 'R3' : label;
    assert.equal(result.rule, expectedRule, `${label} 的 rule 是 ${expectedRule}`);
    assert.equal(result.partition, partition, `${label} 的 partition 是 ${partition}`);
    assert.equal(result.confidence, confidence, `${label} 的 confidence 是 ${confidence}`);
    assert.equal(typeof result.evidence, 'string', `${label} 给出 evidence 文案键`);
  }
});

test('K2 R8 只在目录名 <handle>--<slug> 且 slug 等于声明名时命中，置信度为 medium', () => {
  const hit = classifySkill({ ...quiet, dirName: 'indiv-guipi--find-skills', declaredName: 'find-skills' });
  assert.equal(hit.rule, 'R8', '目录名结构命中时 rule 是 R8');
  assert.equal(hit.partition, 'installed', 'R8 归入已安装');
  assert.equal(hit.confidence, 'medium', 'R8 是中置信，不单独可信');

  const mismatch = classifySkill({ ...quiet, dirName: 'clawhub-a--b', declaredName: 'c' });
  assert.equal(mismatch.rule, 'R9', 'slug 段与声明名不同时不命中 R8');
  assert.equal(mismatch.partition, 'local', '未命中 R8 时回落到本地');

  const noPrefix = classifySkill({ ...quiet, dirName: 'find-skills', declaredName: 'find-skills' });
  assert.equal(noPrefix.rule, 'R9', '没有 -- 前缀的目录名不命中 R8');
});

test('K3 软链优先于任何来源元数据：R4 胜 R6/R7', () => {
  const result = classifySkill({ ...quiet, symlink: true, metaSource: true, metaRelease: true, ledgerHit: true });
  assert.equal(result.rule, 'R4', '软链 + 台账 + 元数据时命中的是 R4');
  assert.equal(result.partition, 'local', '软链技能归入本地');
});

test('判定优先级：R1 先于 R3，R3 先于 R4', () => {
  assert.equal(classifySkill({ ...quiet, provider: 'runtime', rank: 100 }).rule, 'R1', '非 filesystem provider 先命中 R1');
  assert.equal(classifySkill({ ...quiet, rank: 500, symlink: true }).rule, 'R3', '被排除的根即使真是软链也先命中 R3');
});

test('K5 同名跨分区裁决：rank 小者胜，输出里只出现一次', () => {
  const catalog = mergeCatalog({
    scanned: [scanned('dup')],
    registry: [registry('dup', 600)],
    ledger: { entries: new Set() },
    skillsRoot: '/skills',
  });
  const names = catalog.groups.flatMap((group) => group.skills.map((row) => row.name));
  assert.equal(names.filter((name) => name === 'dup').length, 1, '同名技能在三分区合计只出现一次');

  const row = catalog.groups.flatMap((group) => group.skills).find((entry) => entry.name === 'dup');
  assert.equal(row.partition, 'local', 'bundled(600) 与 user-dsh(400) 同名时胜出的是 rank 更小的本地区');
  assert.equal(row.rule, 'R9', '胜出者是磁盘扫描那条，因此命中 R9');
  assert.equal(catalog.groups[0].skills.length, 0, '内置分区里没有这条被遮蔽的 600');
});

test('K5 runtime(250) 与 user-dsh(400) 同名时内置行胜出', () => {
  const catalog = mergeCatalog({
    scanned: [scanned('office')],
    registry: [registry('office', 250, { provider: 'runtime' })],
    ledger: { entries: new Set() },
    skillsRoot: '/skills',
  });
  const rows = catalog.groups.flatMap((group) => group.skills);
  assert.equal(rows.length, 1, '同名技能只产生一行');
  assert.equal(rows[0].partition, 'builtin', 'rank 250 胜出后归入内置技能配置');
  assert.equal(rows[0].rule, 'R1', '胜出者是 runtime provider，命中 R1');
});

test('K5 并列 rank 时磁盘扫描那条胜出（它带着开关需要的路径事实）', () => {
  const catalog = mergeCatalog({
    scanned: [scanned('tie')],
    registry: [registry('tie', 400)],
    ledger: { entries: new Set() },
    skillsRoot: '/skills',
  });
  const row = catalog.groups.flatMap((group) => group.skills)[0];
  assert.equal(row.path, '/skills/tie/SKILL.md', '并列时采用扫描到的绝对路径');
  assert.equal(row.writable, true, '并列时该行可写，因为路径在技能根之内');
});

test('K21 excluded + Σgroups 等于输入里不同 name 的个数', () => {
  const catalog = mergeCatalog({
    scanned: [scanned('a'), scanned('b'), scanned('c')],
    registry: [registry('b', 400), registry('proj', 100), registry('agents', 500)],
    ledger: { entries: new Set() },
    skillsRoot: '/skills',
  });
  const inGroups = catalog.groups.reduce((total, group) => total + group.skills.length, 0);
  const distinct = 5; // a, b, c, proj, agents
  assert.equal(catalog.excluded, 2, '两个被排除的根各贡献一条 excluded');
  assert.equal(inGroups, 3, '三分区合计留下 a、b、c 三条');
  assert.equal(catalog.excluded + inGroups, distinct, 'excluded 加三分区合计等于不同 name 的个数');
});

test('buildGroups 恒产出 builtin/local/installed 三键，且按 name 码点排序', () => {
  const groups = buildGroups([
    { name: 'zeta', partition: 'local' },
    { name: 'alpha', partition: 'local' },
    { name: 'mid', partition: 'installed' },
  ]);
  assert.deepEqual(groups.map((group) => group.key), ['builtin', 'local', 'installed'], '三个分区的顺序恒定');
  assert.deepEqual(groups[1].skills.map((row) => row.name), ['alpha', 'zeta'], '分区内按 name 升序');
  assert.equal(groups[0].skills.length, 0, '没有行的分区仍然存在，只是为空');
});

test('Row 不变式：writable 与 readonlyReason 互为反面', () => {
  const catalog = mergeCatalog({
    scanned: [scanned('hand-written'), scanned('linked', { symlink: true, realPath: '/elsewhere/SKILL.md', instructionPath: '/elsewhere/SKILL.md' })],
    registry: [registry('office', 250, { provider: 'runtime', path: null })],
    ledger: { entries: new Set() },
    skillsRoot: '/skills',
  });
  for (const row of catalog.groups.flatMap((group) => group.skills)) {
    assert.equal(row.writable === false, row.readonlyReason !== null, `${row.name} 的 writable 与 readonlyReason 互为反面`);
    if (row.symlink) {
      assert.equal(row.path, null, `${row.name} 是软链，path 为 null`);
      assert.equal(row.realPath, '/elsewhere/SKILL.md', `${row.name} 的 realPath 指向链接目标`);
      assert.equal(row.readonlyReason, 'symlink', `${row.name} 的只读原因是 symlink`);
    }
    if (row.partition === 'builtin') {
      assert.equal(row.symlink, false, `${row.name} 是内置行，不会是软链`);
      assert.ok(['provider-store', 'no-file'].includes(row.readonlyReason), `${row.name} 的内置只读原因在允许集合内`);
    }
  }
});

test('内置行的开关状态来自面板自有存储，而不是文件', () => {
  const enabled = mergeCatalog({
    scanned: [],
    registry: [registry('office', 250, { provider: 'runtime' })],
    ledger: { entries: new Set() },
    skillsRoot: '/skills',
  }).groups[0].skills[0];
  assert.equal(enabled.enabled, true, '存储里没有记录时内置行显示为启用');

  const disabled = mergeCatalog({
    scanned: [],
    registry: [registry('office', 250, { provider: 'runtime' })],
    ledger: { entries: new Set() },
    providerDisabled: new Set(['runtime#office']),
    skillsRoot: '/skills',
  }).groups[0].skills[0];
  assert.equal(disabled.enabled, false, '面板存储里登记过停用时内置行显示为停用');
  assert.equal(disabled.readonlyReason, 'provider-store', '内置行的只读原因标明它写面板存储');
});

test('台账命中优先于目录名结构（R5 在 R8 之前）', () => {
  const catalog = mergeCatalog({
    scanned: [scanned('indiv-a--b-skill')],
    registry: [],
    ledger: { entries: new Set(['indiv-a--b-skill']) },
    skillsRoot: '/skills',
  });
  const row = catalog.groups.flatMap((group) => group.skills)[0];
  assert.equal(row.rule, 'R5', '台账命中时命中的是 R5');
  assert.equal(row.partition, 'installed', 'R5 归入已安装');
});

test('台账按扫描到的目录名也能命中（声明名与目录名不同时）', () => {
  const catalog = mergeCatalog({
    scanned: [scanned('clawhub-a--b', { declaredName: 'b' })],
    registry: [],
    ledger: { entries: new Set(['clawhub-a--b']) },
    skillsRoot: '/skills',
  });
  const row = catalog.groups.flatMap((group) => group.skills)[0];
  assert.equal(row.name, 'b', '行名用 frontmatter 里的声明名');
  assert.equal(row.rule, 'R5', '台账用目录名命中，因此是 R5');
});
