/**
 * `iconBatch()` — one selector for both halves of the page.
 *
 * Contract: docs/contracts/client.md §3.9.6 (who is picked: market cards from
 * `iconCandidates()`, installed rows from `Row.upstream`; per-source 12, total 24, dedupe
 * by `source:owner:slug`, market entries first), routes.md §3.7.5 (the server only enforces
 * the total, so the per-source split is the *client's* rule); case id K67 (L1).
 *
 * The per-source limit is not cosmetic: one slow source must not eat the whole batch, and
 * a ClawHub batch of 24 would otherwise spend its entire six-second budget on the first
 * twelve entries. The order matters too - market cards are the ones the user is looking at.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { iconBatch } from '../src/client/market-model.js';

/**
 * One market item.
 * @param {string} slug - skill slug.
 * @param {object} [extra] - overrides.
 * @returns {object} the item.
 */
const marketItem = (slug, extra = {}) => ({
  sourceId: 'clawhub',
  id: `clawhub:awspace:${slug}`,
  owner: 'awspace',
  slug,
  displayName: slug,
  iconUrl: null,
  summary: '',
  author: 'awspace',
  version: null,
  downloads: null,
  updatedAt: null,
  category: null,
  packageKind: 'zip',
  ...extra,
});

/**
 * One installed row, `upstream` included when asked for.
 * @param {string} slug - skill slug.
 * @param {{sourceId?: string, owner?: string, upstream?: object|null}} [extra] - overrides.
 * @returns {object} the row.
 */
const installedRow = (slug, extra = {}) => {
  const sourceId = extra.sourceId ?? 'skillhub';
  const owner = extra.owner ?? 'ake';
  const upstream = extra.upstream === undefined ? { sourceId, owner, slug } : extra.upstream;
  return {
    name: slug,
    description: 'Fixture row.',
    displayName: null,
    provider: 'filesystem',
    partition: 'installed',
    rule: 'R6',
    confidence: 'high',
    symlink: false,
    path: `/skills/${slug}/SKILL.md`,
    realPath: null,
    enabled: true,
    writable: true,
    readonlyReason: null,
    upstream,
  };
};

/**
 * Build the two inputs of the selector.
 * @param {{items?: object[], rows?: object[], icons?: object, iconsTried?: object}} spec - page state.
 * @returns {{payload: object, market: object}} the selector inputs.
 */
const page = (spec = {}) => ({
  payload: {
    groups: [{ key: 'installed', skills: spec.rows ?? [] }],
    counts: { total: (spec.rows ?? []).length, disabled: 0, excluded: 0 },
    complete: true,
    diagnostics: [],
    cwd: '/x',
  },
  market: { items: spec.items ?? [], icons: spec.icons ?? {}, iconsTried: spec.iconsTried ?? {} },
});

/** The keys a batch asked for, in order. */
const keysOf = (batch) => batch.map((entry) => `${entry.sourceId}:${entry.owner}:${entry.slug}`);

test('K67 市场条目在前、已装行在后；两半都去重', () => {
  const state = page({
    items: [marketItem('pdf'), marketItem('ui-design')],
    rows: [installedRow('pdf', { sourceId: 'clawhub', owner: 'awspace' }), installedRow('dev-god')],
  });
  const batch = iconBatch(state.payload, state.market);
  assert.deepEqual(keysOf(batch), ['clawhub:awspace:pdf', 'clawhub:awspace:ui-design', 'skillhub:ake:dev-god'], '市场先、已装后；pdf 两边同键只出现一次');
  assert.equal(batch[0].key, 'clawhub:awspace:pdf', '每项带 `key`（写回 market.icons 用）');
});

test('K67 每源 ≤12、总 ≤24：一个慢源不许吃掉整批额度', () => {
  const manyClawhub = Array.from({ length: 20 }, (_, index) => marketItem(`c-${index}`));
  const manySkills = Array.from({ length: 20 }, (_, index) => installedRow(`s-${index}`));
  const batch = iconBatch(...Object.values(page({ items: manyClawhub, rows: manySkills })));
  const perSource = new Map();
  for (const entry of batch) perSource.set(entry.sourceId, (perSource.get(entry.sourceId) ?? 0) + 1);
  assert.equal(batch.length, 24, '总计上限 24');
  assert.equal(perSource.get('clawhub'), 12, 'ClawHub 12（市场那半边本来就只挑 clawhub）');
  assert.equal(perSource.get('skillhub'), 12, 'SkillHub 12');
  // 市场条目先挑满 12 个 clawhub，已装行的 clawhub 就排不上了
  assert.equal(batch.filter((entry) => entry.sourceId === 'clawhub').every((entry) => entry.owner === 'awspace'), true, 'ClawHub 那 12 条都来自市场');
});

test('K67 跳过：已有图标 / 已问过 / 未知源 / 没有身份 / owner-slug 缺失', () => {
  const state = page({
    items: [
      marketItem('already'),
      marketItem('tried'),
      marketItem('fresh'),
    ],
    rows: [
      installedRow('has-icon', { sourceId: 'skillhub' }),
      installedRow('was-tried', { sourceId: 'skillhub' }),
      installedRow('no-identity', { upstream: null }),
      installedRow('unknown-source', { sourceId: 'nope' }),
      installedRow('missing-owner', { upstream: { sourceId: 'skillhub', owner: '', slug: 'x' } }),
      installedRow('fresh-row', { sourceId: 'skillhub' }),
    ],
    icons: {
      'clawhub:awspace:already': 'https://cdn.example.com/zap.png',
      'skillhub:ake:has-icon': 'https://cdn.skillhub.cn/x.png',
    },
    iconsTried: {
      'clawhub:awspace:tried': true,
      'skillhub:ake:was-tried': true,
    },
  });
  const batch = iconBatch(state.payload, state.market);
  // 坏三元组一律跳过：路由是按请求整批校验参数的，一条空 owner 会把**整批**打成 400，
  // 客户端再把整批记成 tried（好条目也一起失去图标），所以在选择器这一层就丢掉它。
  assert.deepEqual(
    keysOf(batch),
    ['clawhub:awspace:fresh', 'skillhub:ake:fresh-row'],
    '真正还需要问的那两条（空 owner 那条已被跳过）',
  );
  // 逐条确认每一种跳过理由都单独生效（不是被别的条件顺带挡掉的）
  const only = (spec) => keysOf(iconBatch(...Object.values(page(spec))));
  assert.deepEqual(only({ rows: [installedRow('a', { upstream: null })] }), [], '没有身份 ⇒ 不问');
  assert.deepEqual(
    only({ rows: [installedRow('a', { upstream: { sourceId: 'skillhub', owner: '', slug: 'x' } })] }),
    [],
    '空 owner ⇒ 跳过',
  );
  assert.deepEqual(only({ rows: [installedRow('a', { sourceId: 'nope' })] }), [], '未知源 ⇒ 不问');
  assert.deepEqual(
    only({ rows: [installedRow('a', { upstream: { sourceId: 'skillhub', owner: 'ake', slug: '' } })] }),
    [],
    '空 slug ⇒ 跳过',
  );
  assert.deepEqual(only({ items: [marketItem('a', { iconUrl: 'https://cdn.example.com/a.png' })] }), [], '市场条目自带图标 ⇒ 不问');
  assert.deepEqual(only({ rows: [installedRow('a')], icons: { 'skillhub:ake:a': 'https://cdn.skillhub.cn/a.png' } }), [], '会话缓存已有 ⇒ 不问');
  assert.deepEqual(only({ rows: [installedRow('a')], iconsTried: { 'skillhub:ake:a': true } }), [], '问过（哪怕结果 null）⇒ 不问');
});

test('K67 两源都有身份时各算各的额度，互不占用', () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, index) => installedRow(`hub-${index}`, { sourceId: 'skillhub' })),
    ...Array.from({ length: 10 }, (_, index) => installedRow(`claw-${index}`, { sourceId: 'clawhub', owner: 'awspace' })),
  ];
  const batch = iconBatch(...Object.values(page({ rows })));
  assert.equal(batch.length, 20, '两源各 10 条都在额度内');
  assert.equal(batch.filter((entry) => entry.sourceId === 'skillhub').length, 10, 'skillhub 10');
  assert.equal(batch.filter((entry) => entry.sourceId === 'clawhub').length, 10, 'clawhub 10');
});

test('K67 空输入与坏输入不抛', () => {
  assert.deepEqual(iconBatch(undefined, undefined), [], '两个都缺 ⇒ 空批次');
  assert.deepEqual(iconBatch({ groups: null }, { items: null }), [], 'null 字段 ⇒ 空批次');
  assert.deepEqual(iconBatch({ groups: [{ skills: null }] }, { items: [] }), [], 'group.skills 不是数组 ⇒ 空批次');
  assert.deepEqual(iconBatch(...Object.values(page({ rows: [{ ...installedRow('a'), upstream: 'nope' }] }))), [], 'upstream 不是对象 ⇒ 空批次');
});
