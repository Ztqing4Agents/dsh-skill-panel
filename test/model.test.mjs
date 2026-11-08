/**
 * `src/client/model.js` — the pure view-model, including the symlink rule.
 *
 * Contract: docs/contracts/data-model.md §3.2.5 and docs/contracts/flows.md §4.3; case ids K26 and the
 * "switchMode 对软链返回 null" half of the three-layer fence.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TAB_INSTALLED,
  TAB_MARKET,
  groupEmptyKey,
  isPending,
  reasonText,
  rowKey,
  rowViewState,
  statusLine,
  switchMode,
  toGroups,
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

test('K26 计数文案：有停用与没有停用两种形态', async () => {
  const t = translator(await dictionaryPromise);
  assert.equal(statusLine({ total: 5, disabled: 1 }, t), '共 5 个技能，1 个已停用', '有停用时追加停用计数');
  assert.equal(statusLine({ total: 5, disabled: 0 }, t), '共 5 个技能', '没有停用时只有总数');
});

test('K26 计数缺失或非整数时按 0 处理，不抛错', async () => {
  const t = translator(await dictionaryPromise);
  assert.equal(statusLine(undefined, t), '共 0 个技能', '没有 counts 时按 0');
  assert.equal(statusLine({ total: '5', disabled: null }, t), '共 0 个技能', '非整数字段按 0');
});

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
