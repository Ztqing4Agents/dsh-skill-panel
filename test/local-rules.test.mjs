/**
 * `lib/local/rules.js` — the pure criteria behind "add a skill" and "delete a skill":
 * expand a typed path, pick the target name, decide whether a copy would be shadowed,
 * bound what one source directory may cost.
 *
 * Contract: docs/contracts/routes.md §3.3.4 (S1, S5, S7, S9) and
 * docs/contracts/data-model.md §3.2.6 (the six pure functions); case id K126.
 *
 * Everything here is a pure function of its arguments, so every case is a plain table:
 * no temp directory, no clock, no counter, and therefore no cleanup. The numbers are
 * pinned against the contract, not against the implementation's own constants: a limit
 * that drifts (2000 → 2001 entries, 8 MiB → 8 MB) is the regression this file catches.
 */
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { rankOf } from '../lib/classify.js';
import {
  LOCAL_LIMITS,
  MAX_PATH_CHARS,
  checkPlan,
  expandHome,
  isSkippedEntry,
  shadowOf,
  skillNameOf,
} from '../lib/local/rules.js';

/* ------------------------------------------------------------- K126 · expandHome */

test('K126 expandHome：~ / ~/… 按当前用户家目录展开，绝对路径原样', () => {
  const home = homedir();
  assert.equal(expandHome('~'), home, '`~` 就是家目录本身（不是 `~/`）');
  assert.equal(expandHome('~/my-skill'), join(home, 'my-skill'), '`~/x` 展开到家目录下的 x');
  assert.equal(expandHome('~/a/b/c'), join(home, 'a/b/c'), '多级也照展开');
  assert.equal(expandHome(`${home}/typed`), `${home}/typed`, '已经是绝对路径就逐字保留（不 realpath、不折叠）');
  assert.equal(expandHome('/tmp/trailing/'), '/tmp/trailing/', '结尾斜杠原样保留（判定在别处，不在这一层）');
});

test('K126 expandHome：相对路径 / URL / NUL / 空串 / 超长 / 非字符串一律 null', () => {
  const cases = [
    ['my-skill', '相对路径不是可拷贝的源'],
    ['./my-skill', '点开头的相对路径同样不是'],
    ['../my-skill', '上跳一层也不是'],
    ['http://example.com/skill', 'URL 不是路径'],
    ['file:///tmp/skill', 'file:// 也不是（只认裸路径）'],
    ['~someone/skill', '`~user` 形态不支持（只认 `~` 与 `~/`）'],
    ['/tmp/has\u0000nul', '含 NUL 的串不是合法路径'],
    ['', '空串不是路径'],
    [`/${'a'.repeat(MAX_PATH_CHARS)}`, `超 ${MAX_PATH_CHARS} 字符的路径拒绝`],
  ];
  for (const [value, why] of cases) assert.equal(expandHome(value), null, why);
  for (const value of [null, undefined, 42, {}, []]) {
    assert.equal(expandHome(value), null, `非字符串（${JSON.stringify(value) ?? String(value)}）也是 null`);
  }
  // 边界：恰好 1024 字符是允许的（`≤1024`，不是 `<1024`）。
  const exact = `/${'a'.repeat(MAX_PATH_CHARS - 1)}`;
  assert.equal(exact.length, MAX_PATH_CHARS, '构造的路径恰好 1024 字符');
  assert.equal(expandHome(exact), exact, '恰好 1024 字符仍接受');
});

/* ------------------------------------------------------------ K126 · skillNameOf */

test('K126 skillNameOf：声明名优先、空回落目录名、两者都不合规就是 null（不改名）', () => {
  // 声明名优先，且先 trim：frontmatter 里的缩进不算名字的一部分。
  assert.equal(skillNameOf('dev-god', 'whatever-dir'), 'dev-god', '声明名压过目录名');
  assert.equal(skillNameOf('  dev-god  ', 'whatever-dir'), 'dev-god', '声明名先 trim 再判');
  assert.equal(skillNameOf('dev-god', 'Bad'), 'dev-god', '目录名不合规也不影响（声明名合规就够）');

  // 空声明回落目录名——目录本来就叫这个名字，宿主加载器也这么挑。
  assert.equal(skillNameOf('', 'dev-god'), 'dev-god', '空串声明 ⇒ 用目录名');
  assert.equal(skillNameOf('   ', 'dev-god'), 'dev-god', '全空白声明 ⇒ 用目录名');
  assert.equal(skillNameOf(null, 'dev-god'), 'dev-god', '声明缺失 ⇒ 用目录名');
  assert.equal(skillNameOf(undefined, 'dev-god'), 'dev-god', '声明 undefined ⇒ 用目录名');
  assert.equal(skillNameOf(42, 'dev-god'), 'dev-god', '声明不是字符串 ⇒ 当作缺失');

  // 两者都不合规 ⇒ null。**不改名、不用 slug 顶替**（S5 的硬话）。
  assert.equal(skillNameOf('Design', 'Bad'), null, '声明名不合 kebab 且目录名也不合 ⇒ null');
  assert.equal(skillNameOf('Design', ''), null, '声明名不合规、目录名为空 ⇒ null');
  assert.equal(skillNameOf('', ''), null, '两者都空 ⇒ null');
  assert.equal(skillNameOf('a--b', 'a--b'), null, '连续连字符不合规');
  assert.equal(skillNameOf('Upper-Case', 'Upper-Case'), null, '大写不合规（kebab 只收小写）');
  assert.equal(skillNameOf('a_b', 'a_b'), null, '下划线不合规');
  // 目录名回落同样要过文法，否则会把一个不合规目录名当合法名字用。
  assert.equal(skillNameOf('', 'Bad_Dir'), null, '回落名也要过 isSkillName');
});

/* --------------------------------------------------------------- K126 · shadowOf */

test('K126 shadowOf：只有 rank < 400 的同名注册表行才挡（400 / 500 / 600 都放行）', () => {
  const floor = rankOf('user-dsh');
  assert.equal(floor, 400, '地板就是 user-dsh 的 400（九步梯子没被改过）');

  const summary = (rank, name = 'dev-god', provider = 'p') => ({ name, rank, provider });

  // 放行侧：400 是同名裁决里的「平、扫描赢」，500 与 600 都输给它。
  assert.equal(shadowOf([summary(400)], 'dev-god'), null, 'rank 400（user-dsh）放行');
  assert.equal(shadowOf([summary(500)], 'dev-god'), null, 'rank 500（user-agents）放行');
  assert.equal(shadowOf([summary(600)], 'dev-god'), null, 'rank 600（bundled）放行');
  assert.equal(shadowOf([summary(400), summary(500), summary(600)], 'dev-god'), null, '三个都放行');

  // 拒绝侧：250（runtime）、100/200/300（project / custom）都会压掉刚落的目录。
  assert.deepEqual(shadowOf([summary(250, 'dev-god', 'runtime')], 'dev-god'), { rank: 250, provider: 'runtime' },
    'rank 250（runtime provider）挡，并报出 provider');
  assert.deepEqual(shadowOf([summary(300, 'dev-god', 'custom')], 'dev-god'), { rank: 300, provider: 'custom' },
    'rank 300（custom 根）挡');
  assert.deepEqual(shadowOf([summary(100, 'dev-god', 'project-dsh')], 'dev-god'), { rank: 100, provider: 'project-dsh' },
    'rank 100（项目根）挡');

  // 多条同名时取最小（最先压住的那一条），provider 跟着那一条走。
  assert.deepEqual(
    shadowOf([summary(300, 'dev-god', 'custom'), summary(100, 'dev-god', 'project-dsh'), summary(200, 'dev-god', 'project-agents')], 'dev-god'),
    { rank: 100, provider: 'project-dsh' },
    '多条同名取最小 rank（顺序无关）',
  );

  // 同名才算：别的名字再小的 rank 也不挡。
  assert.equal(shadowOf([summary(100, 'other')], 'dev-god'), null, '别的名字不影响');
  assert.equal(shadowOf([], 'dev-god'), null, '空注册表放行');
  assert.equal(shadowOf(null, 'dev-god'), null, '没有注册表（数组外的东西）放行');
  assert.equal(shadowOf([summary(100)], ''), null, '空名字不查（路由在 S5 就拒了）');

  // 缺 rank 的摘要按 600 算（`SkillSummary` 不暴露 rank 时的兜底），即放行。
  assert.equal(shadowOf([{ name: 'dev-god', provider: 'p' }], 'dev-god'), null, '缺 rank 按 bundled（600）算，放行');
  // provider 缺失给空串而不是 undefined，界面拿到的永远是字符串。
  assert.deepEqual(shadowOf([{ name: 'dev-god', rank: 250 }], 'dev-god'), { rank: 250, provider: '' }, '缺 provider 归一成空串');
});

/* -------------------------------------------------------------- K126 · checkPlan */

test('K126 清点上限常量恰为 2000 条目 / 8 MiB 单文件 / 64 MiB 总量', () => {
  assert.deepEqual(
    { ...LOCAL_LIMITS },
    { maxEntries: 2000, maxFileBytes: 8 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024 },
    '三个上限与 routes.md §3.3.4 S9 逐值相等（不是 8 MB / 64 MB 的十进制写法）',
  );
  assert.equal(Math.log2(LOCAL_LIMITS.maxFileBytes), 23, '8 MiB = 2^23 字节');
  assert.equal(Math.log2(LOCAL_LIMITS.maxTotalBytes), 26, '64 MiB = 2^26 字节');
  assert.equal(Object.isFrozen(LOCAL_LIMITS), true, '上限表冻结（运行期改不动）');
});

test('K126 checkPlan：2000 条放行、2001 条拒绝；软链 / 单文件 8 MiB / 总量 64 MiB 各一个边界', () => {
  const file = (size = 10) => ({ path: 'a.md', size, symlink: false });
  const many = (count, size = 1) => Array.from({ length: count }, (_unused, index) => ({
    path: `f${index}.md`,
    size,
    symlink: false,
  }));

  // 条目数：上限是「≤2000」。
  assert.deepEqual(checkPlan(many(2000)), { ok: true }, '恰好 2000 条放行');
  assert.deepEqual(checkPlan(many(2001)), { ok: false, code: 'E_PACKAGE_INVALID' }, '2001 条整次拒绝');

  // 单文件：恰好 8 MiB 放行，多 1 字节拒绝。
  assert.deepEqual(checkPlan([file(LOCAL_LIMITS.maxFileBytes)]), { ok: true }, '单文件恰好 8 MiB 放行');
  assert.deepEqual(
    checkPlan([file(LOCAL_LIMITS.maxFileBytes + 1)]),
    { ok: false, code: 'E_PACKAGE_INVALID' },
    '单文件 8 MiB + 1 字节拒绝',
  );

  // 总量：两个 8 MiB 够不到 64 MiB；八个 8 MiB 恰好够到上限。
  assert.deepEqual(checkPlan(Array.from({ length: 8 }, () => file(LOCAL_LIMITS.maxFileBytes))), { ok: true },
    '总量恰好 64 MiB 放行');
  assert.deepEqual(
    checkPlan([...Array.from({ length: 8 }, () => file(LOCAL_LIMITS.maxFileBytes)), file(1)]),
    { ok: false, code: 'E_PACKAGE_INVALID' },
    '总量 64 MiB + 1 字节拒绝',
  );

  // 软链：内部任何一条软链整次拒绝（不静默丢文件）。
  assert.deepEqual(checkPlan([file(), { path: 'link', size: 0, symlink: true }]),
    { ok: false, code: 'E_PACKAGE_INVALID' }, '任一软链 ⇒ 整次拒绝');
  assert.deepEqual(checkPlan([{ path: 'link', size: 0, symlink: true }]),
    { ok: false, code: 'E_PACKAGE_INVALID' }, '只有一条软链也拒绝');

  // 正常树与退化输入。
  assert.deepEqual(checkPlan([file(), { path: 'docs/a.md', size: 100 }]), { ok: true }, '正常两个文件放行');
  assert.deepEqual(checkPlan([]), { ok: true }, '空清单放行（空目录由 S4 的 SKILL.md 检查拦，不在这里）');
  assert.deepEqual(checkPlan(null), { ok: true }, '非数组当作空清单（纯函数不抛）');
  // 坏 size 不制造假失败：非有限值按 0 算，负数夹到 0。
  assert.deepEqual(checkPlan([{ path: 'a', size: Number.NaN }]), { ok: true }, 'NaN 大小按 0 算');
  assert.deepEqual(checkPlan([{ path: 'a', size: -5 }]), { ok: true }, '负数大小夹到 0');
});

/* ----------------------------------------------------------- K126 · isSkippedEntry */

test('K126 isSkippedEntry：node_modules 与点开头条目跳过，其余照拷', () => {
  assert.equal(isSkippedEntry('node_modules'), true, 'node_modules 是生成物，跳过');
  assert.equal(isSkippedEntry('.git'), true, '点开头的版本库目录跳过');
  assert.equal(isSkippedEntry('.gitignore'), true, '点开头的文件也跳过');
  assert.equal(isSkippedEntry('.'), true, '单个点也算点开头（不是有效条目名，跳过无害）');
  assert.equal(isSkippedEntry('SKILL.md'), false, 'SKILL.md 必须拷');
  assert.equal(isSkippedEntry('scripts'), false, '普通子目录照拷');
  assert.equal(isSkippedEntry('node_modules_backup'), false, '只是名字里含 node_modules 不跳过');
  assert.equal(isSkippedEntry('a.node_modules'), false, '点在中间不跳过（只认开头）');
  assert.equal(isSkippedEntry(null), false, '非字符串不跳过');
  assert.equal(isSkippedEntry(undefined), false, 'undefined 不跳过');
});
