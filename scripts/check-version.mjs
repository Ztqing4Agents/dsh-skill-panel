#!/usr/bin/env node
/**
 * 发布前的四条断言：`prepublishOnly` 的最后一关（不联网、不装依赖）。
 *
 *   1. tag ↔ 版本号：HEAD 上有 tag 时，它必须逐字等于 `v<package.json.version>`（没有 tag 就跳过并说明）；
 *   2. 宿主声明：`engines.dsh` 与七条 `@deepseek-ai/dsh-*` peer 同串、peer 集合无增无减，
 *      且 `supportedHosts` 的每一版都被该区间匹配——**默认模式与 `includePrerelease` 两种都测**，
 *      因为 npm 走默认模式、宿主走 `includePrerelease: true`，一侧绿不代另一侧绿（`AGENTS.md` 硬约束 18）；
 *   3. 发布通道：版本号带 `-` 时只接受 `npm publish --tag beta`——`npm_config_tag` 不是 `beta`
 *      （空、`latest`、`next`、`alpha`、大小写变体）一律红，与 `docs/contracts/decisions.md` 附录 Z-13 同口径；
 *   4. Release 文档：`git tag -l` 里每个 `vX.Y.Z` tag 都要有 `docs/releases/<tag>.md`（文件名与 tag 逐字一致）；
 *      git 不可用 / 没有这类 tag 时与第 1 条同口径——跳过并说明，不当成硬失败。
 *
 * semver 实现按 `scripts/semver-lite.mjs` 的顺序取用：仓库 `node_modules/semver` → 宿主
 * `app.asar` 里的 `dsh/node_modules/semver` → 本仓库最小实现（走兜底会显式打印告警）。
 *
 * 用法：node scripts/check-version.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertHostPeers, peerRange, requiredHostPeers, supportedHosts } from './hosts.mjs';
import { compareVersions, loadSemver, SEMVER_LITE_NOTE } from './semver-lite.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const failures = [];
const say = (line = '') => console.log(line);

/* ------------------------------------------------------------ 1. tag ↔ 版本号 */

const expectedTag = `v${pkg.version}`;

/**
 * 跑一条只读 git 命令，失败（不是仓库 / 没有匹配）返回 `null`。
 *
 * @param {string[]} args - git 子命令与参数。
 * @returns {string[]|null} 按行切好的输出。
 */
function gitLines(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * HEAD 上指向的 tag 全集。
 *
 * `git describe --exact-match --tags HEAD` 只回一个（多个 tag 指向同一提交时按优先级挑一个），
 * 而这条断言要的是「全集里有没有 `v<version>`」，所以先用 describe 判「有没有 tag」，
 * 再用 `git tag --points-at HEAD` 取全集。
 *
 * @returns {string[]} tag 列表；没有 tag（或不在 git 仓库里）返回空数组。
 */
function headTags() {
  const described = gitLines(['describe', '--exact-match', '--tags', 'HEAD']);
  if (described === null) return [];
  const pointsAt = gitLines(['tag', '--points-at', 'HEAD']);
  return pointsAt === null || pointsAt.length === 0 ? described : pointsAt;
}

const tags = headTags();

if (tags.length === 0) {
  say('1. tag ↔ 版本号：无 tag，跳过');
} else if (tags.includes(expectedTag)) {
  say(`1. tag ↔ 版本号：${tags.join('、')} = ${expectedTag}  ✓`);
  const extra = tags.filter((tag) => tag !== expectedTag);
  if (extra.length > 0) say(`   注意：HEAD 上还有别的 tag（${extra.join('、')}），确认不是手滑`);
} else {
  failures.push(`1. tag ↔ 版本号：HEAD 上的 tag 是 ${tags.join('、')}，package.json 的版本是 ${pkg.version}，要求逐字相等 ${expectedTag}`);
}

/* --------------------------------------------------------- 2. 宿主声明同串且覆盖 */

const enginesDsh = pkg.engines?.dsh;
if (enginesDsh !== peerRange) {
  failures.push(`2. engines.dsh：期望 "${peerRange}"，实际 ${enginesDsh === undefined ? '(缺失)' : `"${enginesDsh}"`}`);
}
for (const name of requiredHostPeers) {
  const actual = pkg.peerDependencies?.[name];
  if (actual !== peerRange) {
    failures.push(`2. peerDependencies["${name}"]：期望 "${peerRange}"，实际 ${actual === undefined ? '(缺失)' : `"${actual}"`}`);
  }
}
try {
  assertHostPeers(pkg.peerDependencies);
} catch (error) {
  failures.push(`2. 宿主 peer 集合：${error.message}`);
}

const semver = loadSemver(ROOT);
say(`2. 宿主声明：engines.dsh 与 ${requiredHostPeers.length} 条 peer 须同为 "${peerRange}"`);
say(`   semver 实现：${semver.source}`);
if (!semver.reference) say(`   ⚠ ${SEMVER_LITE_NOTE}`);

/** 兜底实现遇到不支持的写法会抛错，这里统一收成一条失败（而不是让脚本崩在半路）。 */
let rows = [];
try {
  rows = supportedHosts.map((host) => ({
    host,
    strict: semver.satisfies(host, peerRange) === true,
    loose: semver.satisfies(host, peerRange, { includePrerelease: true }) === true,
  }));
} catch (error) {
  failures.push(`2. 区间判定不可用：${error.message}`);
}

if (rows.length > 0) {
  const label = 'host';
  const width = Math.max(label.length, ...rows.map((row) => row.host.length));
  say(`   ${label.padEnd(width)}  默认模式  includePrerelease`);
  for (const row of rows) {
    say(`   ${row.host.padEnd(width)}  ${String(row.strict).padEnd(8)}  ${row.loose}`);
    if (!row.strict || !row.loose) {
      failures.push(`2. supportedHosts 里的 ${row.host} 未被 "${peerRange}" 覆盖（默认 ${row.strict} / includePrerelease ${row.loose}）`);
    }
  }
  say('   ─ 负向对照（信息项，不该被覆盖的版本）：');
  for (const host of ['0.2.2-rc.5', '0.2.1-rc.5', '0.2.0-rc.2', '0.3.0-rc.1']) {
    say(`   ${host.padEnd(width)}  ${String(semver.satisfies(host, peerRange) === true).padEnd(8)}  ${semver.satisfies(host, peerRange, { includePrerelease: true }) === true}`);
  }
}

/* ------------------------------------------------------------ 3. 预发布发布通道 */

if (pkg.version.includes('-')) {
  const npmTag = (process.env.npm_config_tag ?? '').trim();
  // 发布纪律只有一个通道：预发布版本只发 beta（docs/contracts/decisions.md 附录 Z-13）。
  if (npmTag === 'beta') {
    say(`3. 发布通道：${pkg.version} 是预发布版本，npm_config_tag=beta  ✓`);
  } else {
    failures.push(`3. 发布通道：${pkg.version} 是预发布版本，本项目发布纪律只发 \`npm publish --tag beta\``
      + `（当前 npm_config_tag=${npmTag === '' ? '空' : `"${npmTag}"`}）；`
      + '若确需新通道，先改 docs/contracts/decisions.md Z-13 与本断言同轮');
  }
} else {
  say(`3. 发布通道：${pkg.version} 不带预发布标记，跳过`);
}

/* ------------------------------------------------- 4. 每版 tag 都有 Release 文档 */

/** Release 日志的 tag 形状：与 `git tag` 逐字一致的 `vX.Y.Z`（预发布 tag 不进这条）。 */
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

say('4. release 文档：每个形如 vX.Y.Z 的 tag 都要有 docs/releases/<tag>.md');
const allTags = gitLines(['tag', '-l']);
if (allTags === null) {
  say('   git 不可用（不是 git 仓库或 git 不在 PATH），跳过');
} else {
  const releaseTags = allTags
    .filter((tag) => RELEASE_TAG.test(tag))
    .sort((left, right) => compareVersions(left, right));
  if (releaseTags.length === 0) {
    say('   没有形如 vX.Y.Z 的 tag，跳过');
  } else {
    for (const tag of releaseTags) {
      const relative = `docs/releases/${tag}.md`;
      if (existsSync(join(ROOT, relative))) {
        say(`   ${relative}  ✓`);
      } else {
        say(`   ${relative}  缺失`);
        failures.push(`4. release 文档：缺 ${relative}——先写它（Release 正文五段式见 docs/contracts/decisions.md 附录 W-4，`
          + '文件名与 tag 必须逐字一致）');
      }
    }
  }
}

/* ------------------------------------------------------------------ 结论 */

if (failures.length > 0) {
  console.error(`\ncheck-version: ${failures.length} 条断言失败`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
say('\ncheck-version: 四条断言通过');
