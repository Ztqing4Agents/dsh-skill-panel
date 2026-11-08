/**
 * `lib/registry.js` — the registry projection and the rank the registry hides.
 *
 * Contract: AGENTS.md "SkillSummary 不暴露 rank" and docs/contracts/architecture.md §1.4.3.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { rankOfSummary, snapshotRegistry } from '../lib/registry.js';

test('rankOfSummary 用 source 反推官方档位', () => {
  const cases = [
    ['project-dsh', 100],
    ['project-agents', 200],
    ['custom', 300],
    ['user-dsh', 400],
    ['user-agents', 500],
    ['bundled', 600],
    ['runtime', 250],
  ];
  for (const [source, rank] of cases) {
    assert.equal(rankOfSummary({ source }), rank, `source=${source} 的 rank 是 ${rank}`);
  }
});

test('rankOfSummary 在 source 缺失时按 provider 兜底，最后兜底到 600', () => {
  assert.equal(rankOfSummary({ provider: 'runtime' }), 250, 'provider=runtime 的 rank 是 250');
  assert.equal(rankOfSummary({ provider: 'some-plugin' }), 600, '未知 provider 兜底为 600');
  assert.equal(rankOfSummary({ source: 'third-party' }), 600, '未知 source 兜底为 600');
  assert.equal(rankOfSummary(undefined), 600, '完全空输入兜底为 600');
});

test('snapshotRegistry 在注册表缺失时降级为空快照', async () => {
  const view = await snapshotRegistry(undefined, '/work');
  assert.deepEqual(view.summaries, [], '没有注册表时没有任何条目');
  assert.equal(view.complete, false, '没有注册表时 complete 为 false');
  assert.deepEqual(view.diagnostics, ['registry-unavailable'], '诊断点名 registry-unavailable');
});

test('snapshotRegistry 在注册表抛错时降级为空快照', async () => {
  const view = await snapshotRegistry({ snapshot: () => { throw new Error('boom'); } }, '/work');
  assert.deepEqual(view.summaries, [], '抛错时没有任何条目');
  assert.deepEqual(view.diagnostics, ['registry-failed'], '诊断点名 registry-failed');
});

test('snapshotRegistry 给每个条目补 rank，并过滤掉没有 name 的条目', async () => {
  const calls = [];
  const view = await snapshotRegistry({
    snapshot: async (options) => {
      calls.push(options);
      return {
        complete: true,
        skills: [
          { name: 'office', provider: 'runtime', source: 'runtime', description: 'd' },
          { name: 'proj', provider: 'filesystem', source: 'project-dsh' },
          { name: '', provider: 'filesystem', source: 'user-dsh' },
          { provider: 'filesystem' },
        ],
      };
    },
  }, '/work');
  assert.deepEqual(calls, [{ cwd: '/work' }], '快照按工作目录请求');
  assert.deepEqual(view.summaries.map((summary) => summary.name), ['office', 'proj'], '没有 name 的条目被过滤');
  assert.deepEqual(view.summaries.map((summary) => summary.rank), [250, 100], 'rank 按 source 补上');
  assert.equal(view.complete, true, '注册表自报完整时透传 complete');
  assert.deepEqual(view.diagnostics, [], '正常路径没有诊断');
});
