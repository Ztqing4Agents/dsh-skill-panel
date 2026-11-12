/**
 * The GitHub front half: clone (G2/G3), locate (G4/G5) and the shared back half (G6–G12).
 *
 * Contract: `docs/contracts/routes.md` §3.3.4 (G0–G12 + S5–S12), §8.1 (the eleven local
 * codes), `docs/contracts/decisions.md` 附录 T; case ids K142–K146
 * (`docs/contracts/acceptance.md` D.9).
 *
 * How a clone is faked: `lib/local/git.js` starts `git` from `PATH`, so the rig writes a
 * **fake `git` executable** into a temp bin directory and puts it first on `PATH`. That
 * keeps the real module in the loop — argv, the hand-built environment, the exit-state
 * classification and the cleanup are all the production code, not a stand-in. What the
 * fake adds is control over *what* git answers (a 404, a network error, a tree to lay
 * down). The one thing it cannot fake is being killed after 60 s, so the timeout is
 * pinned twice: the constant itself, and the mapping of an injected `timedOut` error.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, lstat, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readLedger } from '../lib/ledger.js';
import { asLocalError } from '../lib/local/errors.js';
import { CLONE_PREFIX, GIT_OUTPUT_LIMIT, GIT_TIMEOUT_MS } from '../lib/local/git.js';
import { createLocalSkills } from '../lib/local/index.js';
import { locateSkillDir } from '../lib/local/rules.js';
import { makeMarketDeps } from '../lib/market/sources/index.js';
import { storeFile } from '../lib/market/store.js';

/** One 40-hex commit id, shaped like the real thing. */
const COMMIT = 'a'.repeat(40);

/** What the fake `git` does when it is not told otherwise: lay down a one-skill repo. */
const DEFAULT_CONFIG = {
  commit: COMMIT,
  branch: 'main',
  tree: [{ path: 'SKILL.md', text: '---\nname: cloned-skill\ndescription: A cloned skill.\n---\n\n# cloned\n' }],
};

/**
 * Write the fake `git` executable: log every call, then answer from `config.json`.
 * @param {string} bin - directory to put it in.
 * @returns {Promise<void>} resolves when the file is executable.
 */
async function writeFakeGit(bin) {
  const source = `#!/usr/bin/env node
const { appendFileSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const dir = __dirname;
const args = process.argv.slice(2);
appendFileSync(join(dir, 'calls.jsonl'), JSON.stringify({ argv: args, env: process.env }) + '\\n');
const config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
if (args[0] === 'rev-parse') {
  process.stdout.write((args.includes('--abbrev-ref') ? config.branch : config.commit) + '\\n');
  process.exit(0);
}
if (config.fail !== null && config.fail !== undefined) {
  process.stderr.write(config.fail + '\\n');
  process.exit(config.failCode === undefined ? 128 : config.failCode);
}
const target = args[args.length - 1];
mkdirSync(target, { recursive: true });
for (const entry of config.tree ?? []) {
  const file = join(target, entry.path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, entry.text ?? '');
}
if (config.bulk !== null && config.bulk !== undefined) {
  const bulk = join(target, config.bulk.dir);
  mkdirSync(bulk, { recursive: true });
  for (let index = 0; index < config.bulk.count; index += 1) {
    writeFileSync(join(bulk, 'entry-' + index + '.txt'), 'x');
  }
}
process.exit(0);
`;
  const file = join(bin, 'git');
  await writeFile(file, source);
  await chmod(file, 0o755);
}

/**
 * Build one throwaway home with a fake `git` on `PATH` and the two writes mounted.
 * @param {{config?: object, rescan?: Function, store?: Function, git?: object}} [options] -
 *   what the fake git answers, the registry half of `rescan`, a store override, and an
 *   extra `git` injection (used for the one failure a PATH cannot produce).
 * @returns {Promise<object>} the rig.
 */
async function rig(options = {}) {
  const home = await mkdtemp(join(tmpdir(), 'skc-git-'));
  const skillsRoot = join(home, 'skills');
  const bin = join(home, 'bin');
  await mkdir(skillsRoot, { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFakeGit(bin);
  const config = { ...DEFAULT_CONFIG, ...(options.config ?? {}) };
  await writeFile(join(bin, 'config.json'), `${JSON.stringify(config)}\n`);

  const previous = { PATH: process.env.PATH, GITHUB_TOKEN: process.env.GITHUB_TOKEN };
  process.env.PATH = `${bin}:${previous.PATH ?? ''}`;
  // Two variables a public clone must never see: one looks like a token, one redirects git.
  process.env.GITHUB_TOKEN = 'ghp_must_not_travel';
  process.env.GIT_DIR = '/tmp/must-not-travel';

  const market = makeMarketDeps({ dshHome: home, skillsRoot });
  const store = options.store === undefined ? market.store : options.store(market.store);
  const face = createLocalSkills({
    skillsRoot,
    dshHome: home,
    store,
    rescan: options.rescan ?? (async () => ({ rows: [], registry: [] })),
    ...(options.git === undefined ? {} : { git: options.git }),
  });

  return {
    home,
    skillsRoot,
    bin,
    config,
    face,
    market,
    /**
     * Every git call the fake logged so far.
     * @returns {Promise<{argv: string[], env: Record<string, string>}[]>} the calls.
     */
    calls: async () => {
      try {
        const text = await readFile(join(bin, 'calls.jsonl'), 'utf8');
        return text.trim().split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
      } catch {
        return [];
      }
    },
    /** @returns {Promise<string[]>} dot-directories left in the skills root. */
    clones: async () => (await readdir(skillsRoot)).filter((name) => name.startsWith(CLONE_PREFIX)),
    /** @returns {Promise<string[]>} staging directories left in the skills root. */
    staging: async () => (await readdir(skillsRoot)).filter((name) => name.startsWith('.skc-install-')),
    /** @returns {Promise<Buffer|null>} the ledger file's bytes. */
    ledgerBytes: async () => {
      try {
        return await readFile(storeFile(home));
      } catch {
        return null;
      }
    },
    /** @returns {Promise<object[]>} the ledger's records. */
    records: async () => {
      try {
        return (JSON.parse(await readFile(storeFile(home), 'utf8'))).installs;
      } catch {
        return [];
      }
    },
    close: async () => {
      process.env.PATH = previous.PATH;
      if (previous.GITHUB_TOKEN === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = previous.GITHUB_TOKEN;
      delete process.env.GIT_DIR;
      market.dispose?.();
      await rm(home, { recursive: true, force: true });
    },
  };
}

/**
 * Assert one refusal's code and status.
 * @param {Promise<unknown>} promise - the call under test.
 * @param {string} code - expected code.
 * @param {number} status - expected HTTP status.
 * @returns {Promise<void>} resolves when both match.
 */
async function refuses(promise, code, status) {
  await assert.rejects(promise, (error) => {
    const failure = asLocalError(error);
    assert.deepEqual({ code: failure.code, status: failure.status }, { code, status });
    return true;
  });
}

/* --------------------------------------------- K142 · G3 克隆：四条失败映射 + 加固 */

test('K142 E_GIT_MISSING：PATH 里没有 git ⇒ 500，且不留下任何目录', async () => {
  const bench = await rig();
  try {
    const empty = join(bench.home, 'empty-bin');
    await mkdir(empty, { recursive: true });
    const saved = process.env.PATH;
    process.env.PATH = empty;
    try {
      await refuses(bench.face.add({ spec: 'github:anthropics/skills' }), 'E_GIT_MISSING', 500);
    } finally {
      process.env.PATH = saved;
    }
    assert.deepEqual(await bench.clones(), [], '没有 .skc-clone-* 残留');
    assert.deepEqual(await bench.staging(), [], '没有 .skc-install-* 残留');
    assert.deepEqual(await bench.records(), [], '台账一个字都没写');
  } finally {
    await bench.close();
  }
});

test('K142 E_GIT_TIMEOUT：被杀掉的克隆 ⇒ 504（常量与映射各钉一次）', async () => {
  assert.equal(GIT_TIMEOUT_MS, 60000, '超时上限是一分钟');
  assert.equal(GIT_OUTPUT_LIMIT, 16384, '子进程输出只留 16 KB');
  const bench = await rig({
    git: {
      cloneRepo: async () => {
        const error = new Error('killed');
        error.killed = true;
        error.timedOut = true;
        throw error;
      },
    },
  });
  try {
    await refuses(bench.face.add({ spec: 'github:anthropics/skills' }), 'E_GIT_TIMEOUT', 504);
    assert.deepEqual(await bench.clones(), [], '被杀的克隆也会被清掉');
    assert.deepEqual(await bench.records(), [], '台账没动');
  } finally {
    await bench.close();
  }
});

test('K142 E_GIT_REPO_NOT_FOUND：404 / 认证 / 分支不存在都归 404，且不泄漏 git 的原话', async () => {
  const stderrs = [
    'remote: Repository not found. 404',
    'fatal: could not read Username for \'https://github.com\': terminal prompts disabled',
    'fatal: Authentication failed for \'https://github.com/o/r.git/\'',
    'fatal: Remote branch nope not found in upstream origin',
  ];
  for (const stderr of stderrs) {
    const bench = await rig({ config: { fail: stderr } });
    try {
      await refuses(bench.face.add({ spec: 'github:anthropics/skills' }), 'E_GIT_REPO_NOT_FOUND', 404);
      assert.deepEqual(await bench.clones(), [], `${stderr.slice(0, 24)}… ⇒ 克隆目录已清`);
      assert.deepEqual(await bench.staging(), [], '没有落位残留');
      assert.deepEqual(await bench.records(), [], '台账没动');
    } finally {
      await bench.close();
    }
  }
});

test('K142 E_GIT_UNREACHABLE：网络族的 stderr 与任意其它 stderr 都归 502', async () => {
  for (const stderr of [
    'fatal: unable to access: Could not resolve host: github.com',
    'fatal: the remote end hung up unexpectedly ECONNRESET',
    'error: SSL certificate problem: unable to get local issuer certificate',
    'fatal: something nobody has seen before',
  ]) {
    const bench = await rig({ config: { fail: stderr } });
    try {
      await refuses(bench.face.add({ spec: 'github:anthropics/skills' }), 'E_GIT_UNREACHABLE', 502);
      assert.deepEqual(await bench.clones(), [], '克隆目录已清');
    } finally {
      await bench.close();
    }
  }
});

test('K142 argv 与 env：只 clone 一个分支、URL 由 owner/repo 重建、父环境的凭据不外传', async () => {
  const bench = await rig();
  try {
    // 点名的子目录不存在 ⇒ 克隆发生、定位失败。这条只借它证明「失败路径也真的起过 git」；
    // 成功路径的 argv 在下面逐项比。
    await refuses(bench.face.add({ spec: 'github:anthropics/skills#path:no-such-dir' }), 'E_ADD_NOT_SKILL_DIR', 422);
    const calls = await bench.calls();
    assert.equal(calls.length >= 1, true, '至少发起过一次 git');
  } finally {
    await bench.close();
  }

  const ok = await rig();
  try {
    const result = await ok.face.add({ spec: 'github:anthropics/skills' });
    assert.equal(result.name, 'cloned-skill', '落位名取 SKILL.md 的声明名');

    const calls = await ok.calls();
    const clone = calls[0];
    assert.deepEqual(
      clone.argv,
      ['clone', '--depth', '1', '--single-branch', '--no-recurse-submodules', '--',
        'https://github.com/anthropics/skills.git', join(ok.skillsRoot, clone.argv[clone.argv.length - 1].split('/').pop())],
      'argv 逐项：浅克隆 + 单分支 + 不递归子模块 + `--` 之后才是 URL 与目标目录',
    );
    assert.equal(clone.argv[clone.argv.length - 2], 'https://github.com/anthropics/skills.git',
      'URL 由 owner/repo 重建（输入里的 scheme/host 一律不进命令行）');
    assert.equal(clone.argv[clone.argv.length - 1].includes(CLONE_PREFIX), true, '目标目录带 .skc-clone- 前缀');

    // env：自建、不带父环境。`GITHUB_TOKEN` / `GIT_DIR` 父里有，子进程里必须没有。
    const keys = Object.keys(clone.env).sort();
    const expected = [
      'GCM_INTERACTIVE', 'GIT_ASKPASS', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0',
      'GIT_TERMINAL_PROMPT', 'HOME', 'LC_ALL', 'PATH', 'SSH_ASKPASS', 'SSH_ASKPASS_REQUIRE',
    ];
    const withTmp = process.env.TMPDIR === undefined ? expected : [...expected, 'TMPDIR'].sort();
    assert.deepEqual(keys.filter((key) => !key.startsWith('__')), withTmp,
      'env 是自建的白名单（不含父环境里的任何凭据/重定向变量）');
    assert.equal('GITHUB_TOKEN' in clone.env, false, '父环境的 token 不传给孩子');
    assert.equal('GIT_DIR' in clone.env, false, '父环境的 GIT_DIR 也不传');
    assert.equal(clone.env.LC_ALL, 'C', '输出语言固定，便于分类 stderr');
    assert.equal(clone.env.GIT_TERMINAL_PROMPT, '0', '一切提示都关掉');
    assert.equal(clone.env.GIT_ASKPASS, '', 'askpass 置空');
    assert.equal(clone.env.SSH_ASKPASS, '', 'ssh askpass 置空');
    assert.equal(clone.env.SSH_ASKPASS_REQUIRE, 'never', 'ssh 不许问');
    assert.equal(clone.env.GCM_INTERACTIVE, 'never', '凭据管理器不许弹');
    assert.equal(clone.env.GIT_CONFIG_COUNT, '1', '只覆盖一条 git 配置');
    assert.equal(clone.env.GIT_CONFIG_KEY_0, 'credential.helper', '覆盖的是凭据助手');
    assert.equal(clone.env.GIT_CONFIG_VALUE_0, '', '凭据助手被清空（私有库不会静默成功）');

    // 带 ref 时多两个参数；rev-parse 两次（HEAD 与分支名）。
    const refRun = await rig({ config: { ...DEFAULT_CONFIG, branch: 'dev' } });
    try {
      const added = await refRun.face.add({ spec: 'https://github.com/anthropics/skills/tree/v1.2.3' });
      assert.equal(added.ref, 'v1.2.3', '用户给的 ref 原样记账');
      const refCalls = await refRun.calls();
      assert.deepEqual(refCalls[0].argv.slice(0, 7), ['clone', '--depth', '1', '--single-branch', '--branch', 'v1.2.3', '--no-recurse-submodules'],
        '带 ref 时补 --branch <ref>');
      assert.deepEqual(refCalls.slice(1).map((call) => call.argv), [['rev-parse', 'HEAD'], ['rev-parse', '--abbrev-ref', 'HEAD']],
        '克隆后读两个事实：提交 id 与分支名');
    } finally {
      await refRun.close();
    }

    // 没给 ref 时接线是 `rev-parse --abbrev-ref HEAD` 的答案。
    assert.equal(result.ref, 'main', '未指定 ref ⇒ 记 HEAD 的分支名');
    assert.equal(result.commit, COMMIT, 'commit 是 40 位 sha');
  } finally {
    await ok.close();
  }
});

/* ------------------------------------------------- K143 · G4/G5 定位三级与多候选 */

/**
 * Build one tree with the given `SKILL.md` placements.
 * @param {string[]} dirs - directories (relative) that hold a SKILL.md.
 * @returns {Promise<string>} the root.
 */
async function tree(dirs) {
  const root = await mkdtemp(join(tmpdir(), 'skc-locate-'));
  for (const dir of dirs) {
    const target = dir === '.' ? root : join(root, dir);
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'SKILL.md'), `---\nname: ${dir === '.' ? 'root-skill' : dir.split('/').pop()}\ndescription: d\n---\n\n# x\n`);
  }
  return root;
}

test('K143 给了 subdir ⇒ 只认那一个目录，不再往下探测', async () => {
  const root = await tree(['skills/pdf', 'other/elsewhere']);
  try {
    const named = await locateSkillDir(root, 'skills/pdf');
    assert.equal(named.dir, join(root, 'skills/pdf'), '用户点名的目录就是它');
    // 点名的目录里没有 SKILL.md ⇒ 直接拒，即使别处有。
    await refuses(locateSkillDir(root, 'other'), 'E_ADD_NOT_SKILL_DIR', 422);
    // 越界：`..` 与非目录。
    await refuses(locateSkillDir(root, '../outside'), 'E_ADD_NOT_SKILL_DIR', 422);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('K143 没给 subdir：根有就用根；一个命中就用它；零个拒；多个给候选', async () => {
  const atRoot = await tree(['.']);
  try {
    assert.equal((await locateSkillDir(atRoot, null)).dir, atRoot, '仓库根自己就是技能');
  } finally {
    await rm(atRoot, { recursive: true, force: true });
  }

  const one = await tree(['skills/only']);
  try {
    assert.equal((await locateSkillDir(one, null)).dir, join(one, 'skills/only'), '恰好一个命中 ⇒ 静默用它');
  } finally {
    await rm(one, { recursive: true, force: true });
  }

  const none = await tree([]);
  try {
    await refuses(locateSkillDir(none, null), 'E_ADD_NOT_SKILL_DIR', 422);
  } finally {
    await rm(none, { recursive: true, force: true });
  }

  const many = await tree(['b/two', 'a/one', 'a/one', 'skills/z/pad']);
  try {
    await assert.rejects(locateSkillDir(many, null), (error) => {
      const failure = asLocalError(error);
      assert.equal(failure.code, 'E_ADD_AMBIGUOUS_SKILL', '多个候选 ⇒ 让用户挑');
      assert.equal(failure.status, 422, '422');
      assert.deepEqual(failure.detail.candidates, ['a/one', 'b/two', 'skills/z/pad'],
        '候选是目录相对路径、去重、按字符串排序');
      assert.equal(failure.detail.candidateTotal, 3, '总数单独给（候选列表有上限）');
      return true;
    });
  } finally {
    await rm(many, { recursive: true, force: true });
  }
});

test('K143 探测的边界：跳过 .git / node_modules / 点开头、不跟随软链', async () => {
  const root = await tree(['keep/me']);
  const outside = await tree(['outside']);
  try {
    for (const skipped of ['.git/x', 'node_modules/x', '.hidden/x']) {
      const target = join(root, skipped);
      await mkdir(target, { recursive: true });
      await writeFile(join(target, 'SKILL.md'), '---\nname: nope\ndescription: d\n---\n');
    }
    // 一个指向树外的软链目录：跟过去就会「装到仓库之外」。
    await symlink(join(outside, 'outside'), join(root, 'linked'), 'dir');
    const located = await locateSkillDir(root, null);
    assert.equal(located.dir, join(root, 'keep/me'),
      '被跳过/软链的三个目录都不进候选，唯一合法命中就是 keep/me');

    // 反面：把唯一合法命中拿掉，剩下三个「看起来有 SKILL.md」的目录一个都不算。
    await rm(join(root, 'keep', 'me'), { recursive: true, force: true });
    await refuses(locateSkillDir(root, null), 'E_ADD_NOT_SKILL_DIR', 422);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('K143 探测深度有上限：第 5 层的 SKILL.md 不算候选，第 4 层算', async () => {
  // `probeSkillDirs` 的深度口径是「仓库根 = 1」，且在 `depth + 1 < MAX_PROBE_DEPTH` 处停，
  // 所以能看见的是第 2/3/4 层（`a`、`a/b`、`a/b/c`），第 5 层（`a/b/c/d`）看不到。
  const root = await tree(['a/b/c/d']);
  try {
    await refuses(locateSkillDir(root, null), 'E_ADD_NOT_SKILL_DIR', 422);
    await mkdir(join(root, 'a/b/c'), { recursive: true });
    await writeFile(join(root, 'a/b/c/SKILL.md'), '---\nname: three\ndescription: d\n---\n');
    const located = await locateSkillDir(root, null);
    assert.equal(located.dir, join(root, 'a/b/c'), '第 4 层命中；第 5 层那个不参与');
    // 点名的子目录不受探测深度限制（用户说了要哪个就认哪个）。
    const named = await locateSkillDir(root, 'a/b/c/d');
    assert.equal(named.dir, join(root, 'a/b/c/d'), '点名时第 5 层也认');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------- K144 · G6–G9 复用 S5–S9，一处不改 */

test('K144 目录名兜底取源子目录名；同名已存在 409；影子命中 409', async () => {
  // 「不是仓库名」这一半：仓库叫 `skills`，落位名取子目录/声明名。
  const named = await rig({
    config: { ...DEFAULT_CONFIG, tree: [{ path: 'skills/foo/SKILL.md', text: '---\nname: foo\ndescription: d\n---\n\n# x\n' }] },
  });
  try {
    const added = await named.face.add({ spec: 'github:anthropics/skills#path:skills/foo' });
    assert.equal(added.name, 'foo', '落位名取声明名（不是仓库名 `skills`）');
  } finally {
    await named.close();
  }

  // **现状（缺陷候选，已报工程师）**：SKILL.md 不写 `name:` 时，S5 的兜底会说「用目录名 foo」，
  // 但 S11 的回读比拿落盘文件的声明名（空串）和 `foo` 比 ⇒ 500 `E_INSTALL_IO`。
  // 也就是说 S5 的目录名兜底在这条管线里**永远走不到成功**。这条用例把现状钉住，
  // 不是把契约放宽：契约 K144 说兜底取源目录名，实现与它对不上，取舍见交付说明。
  const noName = await rig({
    config: { ...DEFAULT_CONFIG, tree: [{ path: 'skills/foo/SKILL.md', text: '---\ndescription: no name here\n---\n\n# x\n' }] },
  });
  try {
    await refuses(noName.face.add({ spec: 'github:anthropics/skills#path:skills/foo' }), 'E_INSTALL_IO', 500);
    assert.deepEqual(await noName.clones(), [], '这条失败路径不留克隆');
    assert.deepEqual(await noName.staging(), [], '也不留 staging');
    assert.deepEqual(await noName.records(), [], '台账没动');
    assert.equal(await stat(join(noName.skillsRoot, 'foo')).then(() => 'landed').catch(() => 'absent'), 'absent',
      '落位目录也被清掉（S11 的一致处理）');
  } finally {
    await noName.close();
  }

  const occupied = await rig();
  try {
    await mkdir(join(occupied.skillsRoot, 'cloned-skill'), { recursive: true });
    await refuses(occupied.face.add({ spec: 'github:anthropics/skills' }), 'E_ALREADY_INSTALLED', 409);
  } finally {
    await occupied.close();
  }

  const shadowed = await rig({
    // 影子判据读的是摘要上的 `rank`（`SkillSummary` 本身不暴露它，生产里由 registry
    // 反推后挂上），所以这里必须显式给 rank：100 = project-dsh，压过 user-root 的 400。
    rescan: async () => ({ rows: [], registry: [{ name: 'cloned-skill', rank: 100, provider: 'project-dsh' }] }),
  });
  try {
    await refuses(shadowed.face.add({ spec: 'github:anthropics/skills' }), 'E_ADD_SHADOWED', 409);
  } finally {
    await shadowed.close();
  }
});

test('K144 清点对象是「落位的子目录」：整仓库再大也不影响（2001 条目在兄弟目录里）', async () => {
  const bench = await rig({
    config: {
      ...DEFAULT_CONFIG,
      tree: [
        { path: 'skills/foo/SKILL.md', text: '---\nname: small\ndescription: tiny skill\n---\n' },
        { path: 'skills/foo/notes.md', text: '# notes\n' },
        { path: 'skills/foo/extra.md', text: '# extra\n' },
      ],
      bulk: { dir: 'big', count: 2001 },
    },
  });
  try {
    const added = await bench.face.add({ spec: 'github:anthropics/skills#path:skills/foo' });
    assert.equal(added.name, 'small', '落位成功');
    assert.equal(added.files, 3, 'files 只数落位子目录里的清单条目（SKILL.md + 两个 md）');
    assert.equal(added.bytes > 0, true, 'bytes 是子目录的真实字节');
    assert.deepEqual(await bench.clones(), [], '克隆目录已清');
    assert.deepEqual(await bench.staging(), [], '没有 staging 残留');
  } finally {
    await bench.close();
  }
});

/* ------------------------------------------- K145 · G10–G12 与台账 / 白名单 */

test('K145 成功：副本没有 .git、台账三字段可读回、克隆与 staging 都清干净', async () => {
  const bench = await rig({
    config: {
      ...DEFAULT_CONFIG,
      tree: [
        { path: 'SKILL.md', text: '---\nname: cloned-skill\ndescription: A cloned skill.\n---\n\n# cloned\n' },
        { path: 'docs/guide.md', text: '# guide\n' },
        { path: '.git/config', text: '[core]\n' },
        { path: 'node_modules/x/index.js', text: 'nope\n' },
      ],
    },
  });
  try {
    const added = await bench.face.add({ spec: 'https://github.com/anthropics/skills/tree/main' });
    const landed = join(bench.skillsRoot, 'cloned-skill');
    assert.equal(added.path, landed, '落位路径');
    assert.equal(await lstat(join(landed, 'SKILL.md')).then((entry) => entry.isFile()), true, 'SKILL.md 在');
    assert.deepEqual((await readdir(landed)).sort(), ['SKILL.md', 'docs'], '只复制清单内的文件（.git 与 node_modules 不在）');
    await assert.rejects(lstat(join(landed, '.git')), /ENOENT/, '副本里没有 .git（这是拷贝，不是 checkout）');

    const records = await bench.records();
    assert.equal(records.length, 1, '台账一条');
    const record = records[0];
    assert.deepEqual(
      {
        source: record.source,
        owner: record.owner,
        slug: record.slug,
        repo: record.repo,
        ref: record.ref,
        commit: record.commit,
        fromPath: record.fromPath,
        version: record.version,
        name: record.name,
      },
      {
        source: 'github',
        owner: 'anthropics',
        slug: 'skills',
        repo: 'github.com/anthropics/skills',
        ref: 'main',
        commit: COMMIT,
        fromPath: '',
        version: null,
        name: 'cloned-skill',
      },
      '台账记下来源三件套（白名单已扩容）',
    );

    // 重新读一遍台账：三个字段必须还在（normalizeRecord 的白名单）。
    const reread = JSON.parse(await readFile(storeFile(bench.home), 'utf8')).installs[0];
    assert.deepEqual({ repo: reread.repo, ref: reread.ref, commit: reread.commit },
      { repo: 'github.com/anthropics/skills', ref: 'main', commit: COMMIT },
      '读回台账时三个字段仍在（没被白名单洗掉）');
    const facts = await readLedger(bench.home, bench.skillsRoot);
    assert.equal(facts.entries.has('cloned-skill'), true, 'lib/ledger.js 也认这条记录');

    assert.deepEqual(await bench.clones(), [], '∄ .skc-clone-*');
    assert.deepEqual(await bench.staging(), [], '∄ .skc-install-*');
  } finally {
    await bench.close();
  }
});

test('K145 台账写失败 ⇒ 500 E_INSTALL_IO，目录保留（与 U20 同一条例外）', async () => {
  const bench = await rig({
    store: (real) => ({
      ...real,
      file: real.file,
      read: real.read,
      append: async () => { throw new Error('ledger is read-only'); },
      remove: real.remove,
      installed: real.installed,
    }),
  });
  try {
    await refuses(bench.face.add({ spec: 'github:anthropics/skills' }), 'E_INSTALL_IO', 500);
    assert.equal(await stat(join(bench.skillsRoot, 'cloned-skill')).then((entry) => entry.isDirectory()), true,
      '目录保留（唯一的半状态）');
    assert.deepEqual(await bench.clones(), [], '克隆目录仍然被清掉');
  } finally {
    await bench.close();
  }
});

/* --------------------------------------------- K146 · 出参形状与两种形态同构 */

test('K146 出参恒为 {name,path,files,bytes,source,repo,ref,commit}：path 形态三个 null，github 形态有值', async () => {
  const bench = await rig();
  try {
    const local = await bench.face.add({ spec: join(bench.home, 'local-skill') }).catch((error) => error);
    // 本地目录不存在 ⇒ 先造一个再试（这条用例要的是**成功**出参的形状）。
    assert.equal(asLocalError(local).code, 'E_ADD_NOT_FOUND', '不存在的本地目录仍走 S2');
    const sourceDir = join(bench.home, 'local-skill');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, 'SKILL.md'), '---\nname: local-skill\ndescription: d\n---\n');
    const localAdded = await bench.face.add({ spec: sourceDir });
    assert.deepEqual(Object.keys(localAdded).sort(),
      ['bytes', 'commit', 'files', 'name', 'path', 'ref', 'repo', 'source'],
      'path 形态的出参是这八个键');
    assert.equal(localAdded.source, 'local', 'path 形态 source=local');
    assert.deepEqual([localAdded.repo, localAdded.ref, localAdded.commit], [null, null, null],
      'path 形态的三个 git 字段恒 null');

    const remote = await bench.face.add({ spec: 'github:anthropics/skills' });
    assert.deepEqual(Object.keys(remote).sort(),
      ['bytes', 'commit', 'files', 'name', 'path', 'ref', 'repo', 'source'],
      'github 形态的出参键完全相同');
    assert.equal(remote.source, 'github', 'github 形态 source=github');
    assert.deepEqual([remote.repo, remote.ref, remote.commit],
      ['github.com/anthropics/skills', 'main', COMMIT], '三个字段都有值');
  } finally {
    await bench.close();
  }
});

/* ------------------------------- K143/K147 接缝：候选列表要的三件事实由谁给 */

test('K143/K147 失败信封里必须带 owner/repo：客户端靠它把候选改写成 `github:<o>/<r>#path:<sub>`', async () => {
  // 真实链路：`anthropics/skills` 有 20 个 SKILL.md ⇒ 422 E_ADD_AMBIGUOUS_SKILL。
  const bench = await rig({
    config: {
      ...DEFAULT_CONFIG,
      tree: [
        { path: 'skills/a/SKILL.md', text: '---\nname: a\ndescription: d\n---\n' },
        { path: 'skills/b/SKILL.md', text: '---\nname: b\ndescription: d\n---\n' },
      ],
    },
  });
  try {
    await assert.rejects(bench.face.add({ spec: 'github:anthropics/skills' }), (error) => {
      const failure = asLocalError(error);
      assert.equal(failure.code, 'E_ADD_AMBIGUOUS_SKILL', '码对');
      assert.deepEqual(failure.detail.candidates, ['skills/a', 'skills/b'], '候选在');
      assert.equal(failure.detail.candidateTotal, 2, '总数在');
      // 这两项是客户端拼 `github:<o>/<r>#path:<sub>` 用的；没有它们，弹窗只能显示一句话、
      // 画不出任何可点条目（真机 ③ 就是这么失败的）。
      assert.equal(failure.detail.owner, 'anthropics', '信封里要有 owner');
      assert.equal(failure.detail.repo, 'skills', '信封里要有 repo');
      return true;
    });
  } finally {
    await bench.close();
  }
});
