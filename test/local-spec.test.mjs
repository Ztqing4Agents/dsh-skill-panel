/**
 * The import spec classifier — one pure function that decides which front half of an
 * add runs, before anything touches a disk or a process.
 *
 * Contract: `docs/contracts/data-model.md` §3.2.6 (the rule), `docs/contracts/routes.md`
 * §3.3.4 (G0–G5 sit in front of U20's S5–S12) and §8.1 (the eleven local codes);
 * case ids K138–K141 (`docs/contracts/acceptance.md` D.9).
 *
 * Why this file is separate from `local-routes.test.mjs`: nothing here needs a route, a
 * temp tree or a child process. The classifier is a string rule, and pinning it at that
 * level is what keeps "an unreadable input never starts a clone" true by construction —
 * the last case below proves that from the outside with a counting fake `git`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { asLocalError } from '../lib/local/errors.js';
import { createLocalSkills } from '../lib/local/index.js';
import { MAX_SPEC_CHARS, classifyAddSpec } from '../lib/local/rules.js';
import { makeMarketDeps } from '../lib/market/sources/index.js';

/**
 * Classify one spec and reduce whatever it threw to `{code, status}`.
 * @param {unknown} spec - the raw field value.
 * @returns {{code: string, status: number}} the refusal.
 */
function failureOf(spec) {
  try {
    const classified = classifyAddSpec(spec);
    throw new Error(`${JSON.stringify(spec)} 应当被拒，却解析成 ${JSON.stringify(classified)}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('应当被拒')) throw error;
    return asLocalError(error);
  }
}

/**
 * The code one spec classifies to.
 * @param {unknown} spec - the raw field value.
 * @returns {string} the `E_*` code.
 */
function codeOf(spec) {
  return failureOf(spec).code;
}

/**
 * The `{owner, repo, ref, subdir}` a GitHub spec resolves to.
 * @param {string} spec - the raw field value.
 * @returns {{owner: string, repo: string, ref: string|null, subdir: string|null}} the parts.
 */
function repoOf(spec) {
  const classified = classifyAddSpec(spec);
  assert.equal(classified.kind, 'github', `${spec} 应当被读成仓库引用`);
  return {
    owner: classified.owner,
    repo: classified.repo,
    ref: classified.ref,
    subdir: classified.subdir,
  };
}

/* ------------------------------------------------- K138 · path 形态零回归 */

test('K138 path 形态零回归：`/…` 与 `~/…` 仍归 path，空输入仍是 S0 的 400', () => {
  // U20 的两种 path 写法原样保留：分类器只认前缀，不展开、不校验存在性。
  for (const spec of ['/Users/me/my-skill', '/', '~/skills/x', '~/skills', '~']) {
    const classified = classifyAddSpec(spec);
    assert.deepEqual(classified, { kind: 'path', path: spec }, `${spec} 是 path 形态，且原样透传给 S1`);
  }

  // 空 / 全空白仍是 S0：`400 E_BAD_REQUEST`（不是「看不懂的链接」）。
  for (const spec of ['', '   ', '\t\n']) {
    assert.equal(codeOf(spec), 'E_BAD_REQUEST', `${JSON.stringify(spec)} ⇒ 空输入`);
  }

  // 相对路径不再落 S1 的 `E_BAD_PATH`：它既不是 path 也不是仓库引用（附录 T-2）。
  for (const spec of ['./rel/path', 'rel/path', '../up', 'o/r']) {
    assert.equal(codeOf(spec), 'E_GIT_SPEC_INVALID', `${spec} ⇒ 认不出是什么`);
  }
});

/* ------------------------------------------------- K139 · 接受面矩阵 */

test('K139 接受面：host 的几种链接形状、简写、`.git`、尾斜杠、`/tree/` 与 `#path:`', () => {
  const cases = [
    // 最朴素的仓库链接：没有 ref、没有子目录。
    ['https://github.com/anthropics/skills', { owner: 'anthropics', repo: 'skills', ref: null, subdir: null }],
    // `.git` 归一（git 自己的习惯写法）。
    ['https://github.com/anthropics/skills.git', { owner: 'anthropics', repo: 'skills', ref: null, subdir: null }],
    // 尾斜杠归一（宿主实测会拒，我们收）。
    ['https://github.com/anthropics/skills/', { owner: 'anthropics', repo: 'skills', ref: null, subdir: null }],
    // `/tree/<ref>/<subdir>`：链接里就带着「哪个分支的哪个目录」。
    ['https://github.com/anthropics/skills/tree/main/skills/pdf', { owner: 'anthropics', repo: 'skills', ref: 'main', subdir: 'skills/pdf' }],
    // 标签名同样能当 ref。
    ['https://github.com/anthropics/skills/tree/v1.2.3/x', { owner: 'anthropics', repo: 'skills', ref: 'v1.2.3', subdir: 'x' }],
    // `/tree/main` 只有 ref，没有子目录。
    ['https://github.com/anthropics/skills/tree/main', { owner: 'anthropics', repo: 'skills', ref: 'main', subdir: null }],
    // 子目录尾斜杠归一。
    ['https://github.com/anthropics/skills/tree/main/x/', { owner: 'anthropics', repo: 'skills', ref: 'main', subdir: 'x' }],
    // 简写两种：裸 owner/repo 与带 `#path:` 的。
    ['github:anthropics/skills', { owner: 'anthropics', repo: 'skills', ref: null, subdir: null }],
    ['github:anthropics/skills#path:skills/foo', { owner: 'anthropics', repo: 'skills', ref: null, subdir: 'skills/foo' }],
    // 链接 + `#path:`：没有 ref，只有子目录。
    ['https://github.com/anthropics/skills#path:skills/foo', { owner: 'anthropics', repo: 'skills', ref: null, subdir: 'skills/foo' }],
    // `*.github.com` 也算 github（企业版子域）。
    ['https://www.github.com/anthropics/skills', { owner: 'anthropics', repo: 'skills', ref: null, subdir: null }],
    // scheme 与 host 大小写折叠，owner/repo 的大小写原样保留（GitHub 不区分，但别改写用户输入）。
    ['HTTPS://GitHub.COM/Anthropics/Skills', { owner: 'Anthropics', repo: 'Skills', ref: null, subdir: null }],
    // 首尾空白 trim（粘贴常带换行）。
    ['  https://github.com/anthropics/skills \n', { owner: 'anthropics', repo: 'skills', ref: null, subdir: null }],
    ['  github:anthropics/skills  ', { owner: 'anthropics', repo: 'skills', ref: null, subdir: null }],
  ];
  for (const [spec, expected] of cases) {
    assert.deepEqual(repoOf(spec), expected, `${spec} ⇒ ${JSON.stringify(expected)}`);
  }

  // 分类结果把 spec 原样带回来（出参与错误文案都要用到）。
  assert.equal(classifyAddSpec('github:anthropics/skills').spec, 'github:anthropics/skills', 'spec 原样带回');
});

/* ------------------------------------------------- K140 · 认不出 ⇒ E_GIT_SPEC_INVALID */

test('K140 认不出的 12 种 ⇒ 400 E_GIT_SPEC_INVALID，且一个子进程都不起', () => {
  const rejected = [
    ['裸 owner/repo', 'anthropics/skills'],
    ['带版本的裸写法', 'anthropics/skills@v1'],
    ['相对路径', './rel/path'],
    ['没有 scheme 的域名', 'github.com/anthropics/skills'],
    ['文件链接（不是仓库）', 'https://github.com/anthropics/skills/blob/main/SKILL.md'],
    ['issue 链接', 'https://github.com/anthropics/skills/issues/1'],
    ['releases 页面', 'https://github.com/anthropics/skills/releases'],
    ['tree 后面挂 40 位 sha（提交不能当 ref）', `https://github.com/anthropics/skills/tree/${'a'.repeat(40)}/x`],
    ['tree 与 #path: 同时给子目录', 'https://github.com/anthropics/skills/tree/main/x#path:y'],
    ['段数不足（只有 owner）', 'https://github.com/anthropics'],
    ['空段（只有域名斜杠）', 'https://github.com/'],
    ['超 2048 字符的 git 形态', `github:${'a'.repeat(MAX_SPEC_CHARS)}`],
  ];
  for (const [label, spec] of rejected) {
    const failure = failureOf(spec);
    assert.equal(failure.code, 'E_GIT_SPEC_INVALID', `${label} ⇒ E_GIT_SPEC_INVALID`);
    assert.equal(failure.status, 400, `${label} ⇒ 400`);
  }

  // `/blob/...` 单独再说一句：**绝对路径形态**下它是 path，会走 S2（404），
  // 只有挂在仓库链接后面才是「读不懂的链接」——这条注释防止有人把它当成反例。
  assert.equal(classifyAddSpec('/blob/main/SKILL.md').kind, 'path', '裸 `/blob/...` 是 path 形态');
});

test('K140 认不出时绝不启动 git：注入的假 cloneRepo 调用计数为 0', async () => {
  const home = await mkdtemp(join(tmpdir(), 'skc-spec-'));
  const skillsRoot = join(home, 'skills');
  await mkdir(skillsRoot, { recursive: true });
  const market = makeMarketDeps({ dshHome: home, skillsRoot });
  const calls = [];
  const face = createLocalSkills({
    skillsRoot,
    dshHome: home,
    store: market.store,
    rescan: async () => ({ rows: [], registry: [] }),
    git: {
      cloneRepo: async (request) => {
        calls.push(request);
        throw new Error('must not be called');
      },
      cloneDirOf: () => join(skillsRoot, '.skc-clone-probe'),
    },
  });
  try {
    for (const spec of ['anthropics/skills', './rel', 'https://github.com/anthropics', 'x'.repeat(MAX_SPEC_CHARS + 1)]) {
      await assert.rejects(face.add({ spec }), (error) => {
        assert.equal(asLocalError(error).code, 'E_GIT_SPEC_INVALID', `${spec} 的码`);
        return true;
      }, `${spec} 应当被分类器挡下`);
    }
    assert.deepEqual(calls, [], '一次 clone 都没发起（分类在克隆之前）');
    assert.deepEqual(await (await import('node:fs/promises')).readdir(skillsRoot), [], 'skills 根里没多出任何目录');
  } finally {
    market.dispose?.();
    await rm(home, { recursive: true, force: true });
  }
});

/* ------------------------------------------------- K141 · 不在支持面 ⇒ E_GIT_NOT_SUPPORTED */

test('K141 形态对但不在支持面 ⇒ 400 E_GIT_NOT_SUPPORTED（自己的一句话，不是「读不懂」）', () => {
  const unsupported = [
    ['别的 host 简写', 'gitlab:anthropics/skills'],
    ['bitbucket 简写', 'bitbucket:anthropics/skills'],
    ['gist', 'gist:abc123'],
    ['别的 host 的 https 链接', 'https://gitlab.com/anthropics/skills'],
    ['别的 host 的 *.github.com 伪装', 'https://notgithub.com/anthropics/skills'],
    ['scp 形态（ssh 传输，没有 scheme）', 'git@github.com:anthropics/skills.git'],
    ['ssh scheme', 'ssh://git@github.com/anthropics/skills'],
    ['git scheme', 'git://github.com/anthropics/skills.git'],
    ['git+ssh scheme', 'git+ssh://git@github.com/anthropics/skills'],
    ['tarball 附件', 'https://github.com/anthropics/skills/releases/download/v1/x.tgz'],
    ['tar.gz 附件', 'https://github.com/anthropics/skills/releases/download/v1/x.tar.gz'],
    ['URL 带凭据', 'https://user:tok@github.com/anthropics/skills'],
    ['URL 带端口', 'https://github.com:8443/anthropics/skills'],
  ];
  for (const [label, spec] of unsupported) {
    const failure = failureOf(spec);
    assert.equal(failure.code, 'E_GIT_NOT_SUPPORTED', `${label} ⇒ E_GIT_NOT_SUPPORTED`);
    assert.equal(failure.status, 400, `${label} ⇒ 400`);
  }

  // 两条「看着像但其实是别的东西」的边界，写清楚它们落在哪一边。
  assert.equal(codeOf('file:///tmp/skill'), 'E_GIT_NOT_SUPPORTED', 'file: 是 scheme 但不是 https');
  assert.equal(codeOf('mailto:x@y.z'), 'E_GIT_NOT_SUPPORTED', '任何 scheme 但非 https 都不收');
});

test('K141 空段的 `#path:` 与 `..` 越界属于形状问题（E_GIT_SPEC_INVALID）', () => {
  for (const [label, spec] of [
    ['#path: 后面是空的', 'github:anthropics/skills#path:'],
    ['#path: 只有斜杠', 'github:anthropics/skills#path:///'],
    ['#path: 里上跳', 'github:anthropics/skills#path:../x'],
    ['#path: 里有 .', 'github:anthropics/skills#path:./x'],
    ['fragment 不是 path:', 'https://github.com/anthropics/skills#readme'],
    ['ref 里有空格', 'https://github.com/anthropics/skills/tree/ma in/x'],
    ['tree 后面再加一个空的 #path:', 'https://github.com/anthropics/skills/tree/main#path:'],
  ]) {
    assert.equal(codeOf(spec), 'E_GIT_SPEC_INVALID', `${label} ⇒ E_GIT_SPEC_INVALID`);
  }
});
