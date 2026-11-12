/**
 * `src/client/model.js` — the pure view-model, including the symlink rule.
 *
 * Contract: docs/contracts/data-model.md §3.2.5 and docs/contracts/flows.md §4.3; case ids K26 and the
 * "switchMode 对软链返回 null" half of the three-layer fence.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHECK_BUDGET_MS,
  CHECK_TIMEOUT_MS,
  CHECK_TTL_MS,
  TAB_INSTALLED,
  TAB_MARKET,
  VERSION_ROWS,
  checkPhaseOf,
  clockText,
  dateText,
  detectionTargets,
  groupEmptyKey,
  headerUpdateNote,
  identityOf,
  needsCheck,
  newerVersions,
  verdictOf,
  isPending,
  reasonText,
  rowKey,
  rowViewState,
  switchMode,
  toGroups,
  packageOf,
  toPluginBlocks,
} from '../src/client/model.js';
import { readDictionary, translator } from './helpers/ssr.mjs';

/** The Chinese translator the panel is rendered with. */
const dictionaryPromise = readDictionary('zh');

/** One payload row. */
function row(overrides = {}) {
  return {
    name: 'hand-written',
    description: 'A local skill.',
    provider: 'filesystem',
    partition: 'local',
    rule: 'R9',
    confidence: 'high',
    symlink: false,
    path: '/skills/hand-written/SKILL.md',
    realPath: null,
    enabled: true,
    writable: true,
    readonlyReason: null,
    ...overrides,
  };
}

test('rowKey 用 provider#name 作为开关的身份', () => {
  assert.equal(rowKey(row()), 'filesystem#hand-written', '身份键是 provider#name');
  assert.equal(rowKey({ name: 'x' }), '#x', '缺 provider 时以 # 开头');
  assert.equal(rowKey(undefined), '#', '空输入也给出字符串');
});

test('switchMode：软链行返回 null（三层拦截的第二层：不渲染开关）', () => {
  const linked = row({
    name: 'dev-docs-standards',
    symlink: true,
    path: null,
    realPath: '/Users/me/Skills/dev-docs-standards/SKILL.md',
    writable: false,
    readonlyReason: 'symlink',
  });
  assert.equal(switchMode(linked), null, '软链行没有开关');
});

test('switchMode：内置行走 provider 存储，文件行走文件写入', () => {
  const builtin = row({ partition: 'builtin', provider: 'runtime', path: null, writable: false, readonlyReason: 'provider-store' });
  assert.equal(switchMode(builtin), 'provider', '内置行走 provider-toggle');
  assert.equal(switchMode(row()), 'file', '可写文件行走向文件写入');
  const noFile = row({ path: null, writable: false, readonlyReason: 'no-file' });
  assert.equal(switchMode(noFile), null, '没有可写文件的普通行也没有开关');
});

test('toGroups 恒返回三个分区，缺失与乱序都被纠正', () => {
  const groups = toGroups({ groups: [
    { key: 'installed', skills: [{ name: 'b' }] },
    { key: 'local', skills: [{ name: 'a' }] },
  ] });
  assert.deepEqual(groups.map((group) => group.key), ['builtin', 'local', 'installed'], '顺序被纠正成三分区');
  assert.deepEqual(groups[0].skills, [], '缺失的分区是空数组');
  assert.deepEqual(groups[2].skills.map((entry) => entry.name), ['b'], '已有分区的内容保留');
  assert.deepEqual(toGroups(undefined), [
    { key: 'builtin', skills: [] },
    { key: 'local', skills: [] },
    { key: 'installed', skills: [] },
  ], '没有 payload 时三个分区都是空的');
});

test('rowViewState 区分 idle / pending / failed', () => {
  const target = row();
  assert.equal(rowViewState(target, new Map()), 'idle', '没有运行时状态时是 idle');
  assert.equal(rowViewState(target, new Map([[rowKey(target), { pending: true, reason: null }]])), 'pending', '写入中是 pending');
  assert.equal(rowViewState(target, new Map([[rowKey(target), { pending: false, reason: '写入失败' }]])), 'failed', '有原因时是 failed');
});

test('isPending 只看真正在飞的那一行', () => {
  const rows = new Map([['filesystem#a', { pending: true }]]);
  assert.equal(isPending(rows, 'filesystem#a'), true, '在飞的行被认出');
  assert.equal(isPending(rows, 'filesystem#b'), false, '别的行不受影响');
  assert.equal(isPending(new Map(), 'filesystem#a'), false, '没有状态时不是 pending');
});

test('groupEmptyKey 拼出三个分区的空态文案键', () => {
  assert.equal(groupEmptyKey('builtin'), 'group.builtinEmpty', 'builtin 的空态键');
  assert.equal(groupEmptyKey('local'), 'group.localEmpty', 'local 的空态键');
  assert.equal(groupEmptyKey('installed'), 'group.installedEmpty', 'installed 的空态键');
});

test('reasonText 用错误码取行内文案，未知码回落 E_UNKNOWN', async () => {
  const t = translator(await dictionaryPromise);
  assert.equal(reasonText('E_STALE_PATH', 'moved', t), '技能文件位置已变化，请刷新后重试', '已知码取对应文案');
  assert.equal(reasonText('E_WRITE_FAILED', 'EACCES', t), '写入技能文件失败：EACCES', '带 {reason} 占位符的文案被填充');
  assert.equal(reasonText('E_SOMETHING_NEW', 'boom', t), '操作失败：boom', '未知码回落 E_UNKNOWN 文案');
});

test('KI-1 已修：E_BAD_NAME / E_BAD_PATH 各有专属文案，不再走 E_UNKNOWN 兜底', async () => {
  const t = translator(await dictionaryPromise);
  assert.equal(reasonText('E_BAD_NAME', 'name must be kebab-case', t), '技能名不合规范，未做任何修改', 'E_BAD_NAME 取专属文案');
  assert.equal(reasonText('E_BAD_PATH', 'path must be absolute', t), '技能文件路径不合规范，未做任何修改', 'E_BAD_PATH 取专属文案');
});

test('页签常量与设计一致', () => {
  assert.equal(TAB_INSTALLED, 'installed', '已安装页签的机器值是 installed');
  assert.equal(TAB_MARKET, 'market', '市场页签的机器值是 market');
});

/* ------------- toPluginBlocks：内置区按 provider 折块（本轮） ------------- */

/** One builtin row of a given provider. */
function builtinOf(provider, name) {
  return row({ name, provider, partition: 'builtin', path: null, writable: false, readonlyReason: 'provider-store' });
}

test('toPluginBlocks：同 provider 合并成一块，块里保持原有顺序', () => {
  const blocks = toPluginBlocks({
    key: 'builtin',
    skills: [builtinOf('univer', 'sheet'), builtinOf('dsh-office', 'docx'), builtinOf('univer', 'slide')],
  });
  assert.equal(blocks.length, 2, '两个 provider 两块');
  assert.deepEqual(blocks.map((block) => block.provider), ['dsh-office', 'univer'], '按 provider 升序');
  assert.deepEqual(blocks[1].skills.map((item) => item.name), ['sheet', 'slide'], '同 provider 的技能合在一块且顺序不变');
  assert.equal(blocks[0].skills.length, 1, '单个技能的块也是块');
});

test('toPluginBlocks：只有一个 provider 时仍是一块；没有内置技能时是空数组', () => {
  const single = toPluginBlocks({ key: 'builtin', skills: [builtinOf('univer', 'sheet'), builtinOf('univer', 'docx')] });
  assert.equal(single.length, 1, '一个 provider 一块');
  assert.equal(single[0].skills.length, 2, '块里两个技能');
  assert.deepEqual(toPluginBlocks({ key: 'builtin', skills: [] }), [], '没有内置技能就没有块');
  assert.deepEqual(toPluginBlocks(undefined), [], '没有分组也不炸');
});

test('toPluginBlocks：升序是字符串序（dsh-office 在 univer 前，clawhub 也在前面）', () => {
  const blocks = toPluginBlocks({
    key: 'builtin',
    skills: [builtinOf('univer', 'a'), builtinOf('runtime', 'b'), builtinOf('clawhub', 'c'), builtinOf('dsh-office', 'd')],
  });
  assert.deepEqual(blocks.map((block) => block.provider), ['clawhub', 'dsh-office', 'runtime', 'univer'], '纯字符串升序');
});

/* ------------- packageOf：块按插件包分组（本轮） ------------- */

test('packageOf：取 originPath 里最后一个 node_modules/ 之后的一段', () => {
  assert.equal(packageOf({ provider: 'univer', originPath: '/Users/me/.dsh/profiles/desktop/node_modules/dsh-univer-office/skills/office/SKILL.md' }), 'dsh-univer-office', '普通包名');
  assert.equal(packageOf({ provider: 'univer', originPath: '/a/node_modules/outer/node_modules/inner/skills/x/SKILL.md' }), 'inner', '取最后一个 node_modules/');
});

test('packageOf：scoped 包取两段；没有 node_modules/ 或没有 originPath 退回 provider', () => {
  assert.equal(packageOf({ provider: 'univer', originPath: '/p/node_modules/@scope/pkg/skills/x/SKILL.md' }), '@scope/pkg', 'scoped 取 @scope/pkg');
  assert.equal(packageOf({ provider: 'univer', originPath: '/skills/office/SKILL.md' }), 'univer', '没有 node_modules/ 就用 provider');
  assert.equal(packageOf({ provider: 'univer', originPath: null }), 'univer', 'originPath 为 null 就用 provider');
  assert.equal(packageOf({ provider: 'univer' }), 'univer', '字段缺失也是 provider');
  assert.equal(packageOf({ provider: 'univer', originPath: '/p/node_modules//x/SKILL.md' }), 'univer', '空段也退回 provider');
});

test('toPluginBlocks：按包名分组与排序（不是 provider），provider 留在块上供开关写盘', () => {
  const rows = [
    { ...builtinOf('univer', 'sheet'), originPath: '/p/node_modules/dsh-univer-office/skills/sheet/SKILL.md' },
    { ...builtinOf('univer', 'docx'), originPath: '/p/node_modules/dsh-univer-office/skills/docx/SKILL.md' },
    { ...builtinOf('univer', 'zz'), originPath: '/p/node_modules/@other/pkg/skills/zz/SKILL.md' },
    builtinOf('univer', 'loose'),
  ];
  const blocks = toPluginBlocks({ key: 'builtin', skills: rows });
  assert.deepEqual(blocks.map((block) => block.key), ['@other/pkg', 'dsh-univer-office', 'univer'], '包名升序；取不到包名的用 provider 当键');
  assert.deepEqual(blocks[1].skills.map((item) => item.name), ['sheet', 'docx'], '同一个包的技能合在一块');
  assert.equal(blocks[0].provider, 'univer', '块上仍带 provider（开关要它）');
  assert.equal(blocks[2].provider, 'univer', '退回 provider 的那块也带 provider');
});

test('toPluginBlocks：块带包图标（同一包的行共用一个 iconUrl），没有图标时是 null', () => {
  const withIcon = toPluginBlocks({
    key: 'builtin',
    skills: [
      { ...builtinOf('univer', 'a'), originPath: '/p/node_modules/pkg-a/skills/a/SKILL.md', pluginIcon: 'data:image/svg+xml;base64,AAA' },
      { ...builtinOf('univer', 'b'), originPath: '/p/node_modules/pkg-a/skills/b/SKILL.md', pluginIcon: 'data:image/svg+xml;base64,AAA' },
      builtinOf('univer', 'c'),
    ],
  });
  assert.equal(withIcon[0].key, 'pkg-a', '按包名成块');
  assert.equal(withIcon[0].iconUrl, 'data:image/svg+xml;base64,AAA', '块的 iconUrl 来自行的 pluginIcon');
  assert.equal(withIcon[1].key, 'univer', '取不到包名的行自成一户');
  assert.equal(withIcon[1].iconUrl, null, '没有 pluginIcon 就是 null（回退首字母）');
});

test('packageOf 三层优先级：pluginPackage > originPath 的 node_modules 段 > provider id', () => {
  // 1) 宿主给了包名（含 link: 安装）：直接信它，不再从路径猜。
  assert.equal(
    packageOf({ provider: 'univer', pluginPackage: 'my-link-plug', originPath: '/p/node_modules/other-pkg/skills/a/SKILL.md' }),
    'my-link-plug',
    'pluginPackage 优先',
  );
  // 2) 没有 pluginPackage 但有 node_modules 段：按路径解析（老口径）。
  assert.equal(
    packageOf({ provider: 'univer', pluginPackage: null, originPath: '/p/node_modules/dsh-univer-office/skills/a/SKILL.md' }),
    'dsh-univer-office',
    '回退 originPath',
  );
  // 3) 两者都没有：退回 provider id。
  assert.equal(packageOf({ provider: 'univer', pluginPackage: null, originPath: '/p/skills/a/SKILL.md' }), 'univer', '再回退 provider');
  assert.equal(packageOf({ provider: 'univer' }), 'univer', '字段缺失也是 provider');
  assert.equal(packageOf({ provider: 'univer', pluginPackage: '' }), 'univer', '空串不算给了包名');
  assert.equal(packageOf({ provider: 'univer', pluginPackage: 42 }), 'univer', '非字符串不算给了包名');
});

/* --------------------- K118 · 检测对象、缓存与预算（纯函数半边，D1/D2/D3） --------------------- */

/** An installed row with an upstream identity, a version, and whatever else the case needs. */
function marketRow(overrides = {}) {
  return row({
    name: 'dev-god',
    partition: 'installed',
    rule: 'R7',
    upstream: { sourceId: 'skillhub', owner: 'ake', slug: 'dev-god' },
    version: '1.2.4',
    ...overrides,
  });
}

test('K118 identityOf：source:owner:slug，缺一项就是空串（空串不进缓存）', () => {
  assert.equal(identityOf({ sourceId: 'skillhub', owner: 'ake', slug: 'dev-god' }), 'skillhub:ake:dev-god', '标准形态');
  for (const bad of [null, undefined, {}, { sourceId: 'skillhub' }, { sourceId: 'skillhub', owner: 'ake' }, { sourceId: 'skillhub', owner: 'ake', slug: '' }]) {
    assert.equal(identityOf(bad), '', `不完整 ⇒ 空串（${JSON.stringify(bad)}）`);
  }
});

test('K118 detectionTargets 只收「市场装 ∧ 非软链 ∧ 有版本」，同 identity 去重', () => {
  const rows = [
    marketRow(),
    marketRow({ name: 'copy-of-dev-god' }),
    marketRow({ name: 'no-version', version: null }),
    marketRow({ name: 'empty-version', version: '' }),
    marketRow({ name: 'linked', symlink: true }),
    row({ name: 'hand-made' }),
    row({ name: 'builtin', provider: 'runtime', partition: 'builtin', path: null }),
  ];
  assert.deepEqual(detectionTargets(rows), [
    { key: 'skillhub:ake:dev-god', source: 'skillhub', owner: 'ake', slug: 'dev-god' },
  ], '两个目录装同一个技能只查一次；软链 / 手工 / 内置 / 无版本一次都不查');
  assert.deepEqual(detectionTargets([]), [], '空数组安全');
  assert.deepEqual(detectionTargets(undefined), [], '非数组安全');
  const twoSources = detectionTargets([
    marketRow(),
    marketRow({ name: 'claw', upstream: { sourceId: 'clawhub', owner: 'ake', slug: 'dev-god' } }),
  ]);
  assert.equal(twoSources.length, 2, '同 owner/slug 的两个源是两个 identity（两份包）');
});

test('K118 needsCheck：TTL 10 分钟，skipped 必重试，busy 不重入', () => {
  assert.equal(CHECK_TTL_MS, 600000, 'TTL 是 10 分钟');
  const now = 1_000_000_000_000;
  assert.equal(needsCheck(null, now), true, '没有条目 ⇒ 要查');
  assert.equal(needsCheck(undefined, now), true, 'undefined 也一样');
  assert.equal(needsCheck({ phase: 'ready', at: now - 1, busy: false }, now), false, '刚查过 ⇒ 不查');
  assert.equal(needsCheck({ phase: 'ready', at: now - 599_999, busy: false }, now), false, 'TTL 内 ⇒ 不查');
  assert.equal(needsCheck({ phase: 'ready', at: now - 600_000, busy: false }, now), true, '满 10 分钟 ⇒ 重查');
  assert.equal(needsCheck({ phase: 'offline', at: now - 1, busy: false }, now), false, '失败答案同样缓存一个 TTL');
  assert.equal(needsCheck({ phase: 'skipped', at: now - 1, busy: false }, now), true, '预算截断的没有答案 ⇒ 下次必重试');
  assert.equal(needsCheck({ phase: 'running', at: null, busy: false }, now), true, 'running 但没人持有 ⇒ 可以开始');
  assert.equal(needsCheck({ phase: 'ready', at: now - 600_000, busy: true }, now), false, '有请求在飞时不重入');
  assert.equal(needsCheck({ phase: 'ready', at: null, busy: false }, now), true, '没有 at 就当没有答案');
});

test('K118 预算常量与契约一致：单行 2s、整轮 8s', () => {
  assert.equal(CHECK_TIMEOUT_MS, 2000, '单行 2s');
  assert.equal(CHECK_BUDGET_MS, 8000, '整轮 8s');
});

test('K118 checkPhaseOf：只有「连不上源」的码落 offline，其余落 failed', () => {
  for (const code of ['E_SOURCE_UNAVAILABLE', 'E_SOURCE_TIMEOUT', 'E_SOURCE_BAD_RESPONSE']) {
    assert.equal(checkPhaseOf(code), 'offline', `${code} ⇒ offline`);
  }
  for (const code of ['E_BAD_QUERY', 'E_INSTALL_IO', 'E_UNKNOWN', '', 'E_NO_VERSIONS']) {
    assert.equal(checkPhaseOf(code), 'failed', `${code || '(空)'} ⇒ failed`);
  }
});

test('K118 verdictOf 五态：答案按「与这一行自己的 version 相等吗」判', () => {
  const ready = (candidate) => ({ phase: 'ready', candidate });
  assert.equal(verdictOf(null, '1.2.4'), 'checking', '没有答案 ⇒ checking（区块挂载即此态）');
  assert.equal(verdictOf(ready('1.2.4'), '1.2.4'), 'upToDate', '相等 ⇒ 最新');
  assert.equal(verdictOf(ready('9.9.9'), '1.2.4'), 'available', '不等 ⇒ 可更新（不比较大小）');
  assert.equal(verdictOf(ready('1.0.0'), '1.2.4'), 'available', '更小的上游版本也算「不等」（只比相等）');
  assert.equal(verdictOf(ready(''), '1.2.4'), 'failed', '没有 candidate 的答案算失败（不是「最新」）');
  assert.equal(verdictOf({ phase: 'offline' }, '1.2.4'), 'offline', 'offline');
  assert.equal(verdictOf({ phase: 'failed' }, '1.2.4'), 'failed', 'failed');
  assert.equal(verdictOf({ phase: 'skipped' }, '1.2.4'), 'failed', 'skipped 在区块里同样说「无法检查更新」');
  assert.equal(verdictOf({ phase: 'running' }, '1.2.4'), 'checking', 'running 也是 checking');
});

/* ------------------------- K121 · 展开列表的窗口与日期（纯函数半边） ------------------------- */

test('K121 newerVersions：count 是当前版本之前的条数，当前不在列表时回落 total', () => {
  const versions = [
    { version: '3.0.0' }, { version: '2.5.0' }, { version: '2.0.0' }, { version: '1.2.4' }, { version: '1.0.0' },
  ];
  const three = newerVersions(versions, '1.2.4', 5);
  assert.equal(three.count, 3, '排在已安装版本之前的条数就是「N 个新版本」');
  assert.deepEqual(three.items.map((entry) => entry.version), ['3.0.0', '2.5.0', '2.0.0', '1.2.4', '1.0.0'], '窗口是列表前 5 条');
  assert.equal(three.more, 0, '刚好 5 行，没有「另有」');

  const absent = newerVersions(versions, '9.9.9', 12);
  assert.equal(absent.count, 12, '当前版本不在列表 ⇒ count = total（上游说有几条就是几条）');
  assert.equal(absent.more, 7, 'more = count - 打印行数');

  const empty = newerVersions([], '1.2.4', 0);
  assert.deepEqual(empty, { count: 0, items: [], more: 0 }, '空列表安全');
  assert.deepEqual(newerVersions(undefined, '1.2.4', 0), { count: 0, items: [], more: 0 }, '非数组安全');
  assert.equal(newerVersions([{ version: '' }, { version: 42 }, null], '1.2.4', 3).count, 3,
    '坏条目被丢掉，但 count 仍按上游 total（drop 只影响能打印的行）');
});

test('K121 newerVersions：最多 5 行，超出的进「另有 N 个」', () => {
  assert.equal(VERSION_ROWS, 5, '展示上限是 5 行');
  const versions = Array.from({ length: 10 }, (unused, index) => ({ version: `2.0.${10 - index}` }));
  const window = newerVersions([...versions, { version: '1.0.0' }], '1.0.0', 11);
  assert.equal(window.items.length, 5, '只打印 5 行');
  assert.equal(window.count, 10, '当前版本之前有 10 条');
  assert.equal(window.more, 5, '另有 5 条没列出来');
});

test('K121 dateText / clockText：日期是 YYYY-MM-DD，时间是 HH:MM，坏输入给空串', () => {
  const at = Date.UTC(2026, 10, 12, 6, 5);
  assert.match(dateText(at), /^\d{4}-\d{2}-\d{2}$/, '日期格式固定（不用相对时间）');
  assert.equal(dateText(at), `${new Date(at).getFullYear()}-${String(new Date(at).getMonth() + 1).padStart(2, '0')}-${String(new Date(at).getDate()).padStart(2, '0')}`, '本地时区的日历日');
  assert.equal(dateText(null), '', 'null ⇒ 空串（渲染层据此不画日期）');
  assert.equal(dateText(Number.NaN), '', 'NaN ⇒ 空串');
  assert.match(clockText(at), /^\d{2}:\d{2}$/, '时间是 24 小时制 HH:MM');
  assert.equal(clockText(null), '', 'null ⇒ 空串');
});
