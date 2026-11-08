/**
 * `lib/names.js` — the grammar and path predicates every other module trusts.
 *
 * Contract: docs/contracts/data-model.md §3.2.1; case id K1.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { identityKey, isAbsoluteSkillFile, isSkillName, isWithin } from '../lib/names.js';

test('isSkillName 接受宿主的 kebab-case 文法', () => {
  for (const name of ['dev-docs-standards', 'a1', 'ui-design', 'dev-expert-pro']) {
    assert.equal(isSkillName(name), true, `"${name}" 是合法技能名`);
  }
});

test('isSkillName 拒绝单段为空、大写、空格与空串', () => {
  for (const name of ['-a', 'a-', 'a--b', 'A', '', 'a b', 'a_b', '技能']) {
    assert.equal(isSkillName(name), false, `"${name}" 不是合法技能名`);
  }
});

test('isSkillName 对非字符串输入返回 false 而不抛错', () => {
  for (const value of [undefined, null, 42, {}, []]) {
    assert.equal(isSkillName(value), false, `${JSON.stringify(value)} 不是字符串，因此不是技能名`);
  }
});

test('isAbsoluteSkillFile 只认绝对路径且以 SKILL.md 结尾', () => {
  assert.equal(isAbsoluteSkillFile('/Users/x/.dsh/skills/a/SKILL.md'), true, '绝对 SKILL.md 路径被接受');
  assert.equal(isAbsoluteSkillFile('skills/a/SKILL.md'), false, '相对路径被拒绝');
  assert.equal(isAbsoluteSkillFile('/Users/x/.dsh/skills/a/README.md'), false, 'basename 不是 SKILL.md 时被拒绝');
  assert.equal(isAbsoluteSkillFile('/Users/x/SKILL.md.bak'), false, '后缀不是 SKILL.md 时被拒绝');
  assert.equal(isAbsoluteSkillFile('   '), false, '纯空白的路径被拒绝');
});

test('isWithin 判严格后代，根自身不算在内', () => {
  assert.equal(isWithin('/a/b', '/a/b/c/SKILL.md'), true, '/a/b 包含 /a/b/c/SKILL.md');
  assert.equal(isWithin('/a/b', '/a/b'), false, '根自身不是严格后代');
  assert.equal(isWithin('/a/b', '/a/bc/SKILL.md'), false, '/a/bc 不在 /a/b 之内');
  assert.equal(isWithin('/a/b', '/a/other/SKILL.md'), false, '兄弟目录不在 /a/b 之内');
  assert.equal(isWithin('/a/b', '/a/b/../c/SKILL.md'), false, '用 .. 逃出根之后不算在内');
});

test('identityKey 用 provider#name 拼身份，缺 provider 时用空串', () => {
  assert.equal(identityKey('filesystem', 'ui-design'), 'filesystem#ui-design', '身份键是 provider#name');
  assert.equal(identityKey('', 'ui-design'), '#ui-design', 'provider 为空时身份键以 # 开头');
  assert.equal(identityKey(undefined, 'ui-design'), '#ui-design', 'provider 缺失按空串处理');
});
