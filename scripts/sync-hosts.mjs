#!/usr/bin/env node
/**
 * 宿主声明的校验器 / 回写器：`scripts/hosts.mjs` 是唯一真源，这里是唯一的落地口。
 *
 * 默认模式 **只校验**（`npm run check` 的第五门）：`package.json` 的 `engines.dsh` 与七条
 * `@deepseek-ai/dsh-*` peer 必须逐字等于 `peerRange`、宿主 peer 集合必须等于
 * `requiredHostPeers`、两条 README 的 **DSH 徽标必须**与 `supportedHosts[0]` 一致。
 * 文字版兼容行是**可选锚点**：存在时必须一致，缺失视为该 README 不再声明文字版兼容要求，跳过不报。
 * 任何一处不一致 → 打印「期望 vs 实际 + 修法」并 exit 1。
 *
 * `--write` 模式先按锚点定位、再回写：**徽标锚点找不到就报错**并列出它在找哪一行，绝不静默跳过
 * （上一代项目就是这么腐化的）；文字版兼容行只在自己命中时回写，缺失不补。徽标锚点缺失时整批不落盘，
 * 避免半套改动。
 *
 * 用法：node scripts/sync-hosts.mjs [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertHostPeers, developmentHost, peerRange, requiredHostPeers, supportedHosts } from './hosts.mjs';
import { compareVersions } from './semver-lite.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WRITE = process.argv.includes('--write');
const FIX = 'node scripts/sync-hosts.mjs --write';

/** README 的兼容下限：受支持宿主里最低的一版，数组本身必须升序。 */
const MIN_HOST = supportedHosts[0];
const WANTED_LINE_VALUE = `>= ${MIN_HOST}`;

/** 兼容行（**可选锚点**）：`- **DSH**：` 后面跟一个反引号包住的版本下限（全角与半角冒号都认）。 */
const COMPAT_LINE = /^- \*\*DSH\*\*[:：][ \t]*`([^`]+)`[ \t]*$/;

/** DSH 徽标：`![DSH](https://img.shields.io/badge/DSH-<encoded>-<color>)`。 */
const BADGE = () => /!\[DSH\]\(https:\/\/img\.shields\.io\/badge\/DSH-([^)\s]*)\)/g;

/** 要同步的两条 README，条目数必须相等（`docs/contracts/decisions.md` 附录 W-2）。 */
const READMES = ['README.md', 'README.en.md'];

/**
 * 按 shields.io 的静态徽标规则编码 message：字面 `-` 要写成 `--`，其余按 URL 编码。
 *
 * @param {string} message - 徽标正文，如 `>=0.2.2-rc.1`。
 * @returns {string} 可直接拼进 `badge/` 路径的片段，如 `%3E%3D0.2.2--rc.1`。
 */
function encodeBadgeMessage(message) {
  return encodeURIComponent(message.replace(/-/g, '--'));
}

/**
 * 打印一条「这一关过不去」的诊断并退出：哪份文件、什么问题、期望形状、怎么修。
 *
 * 用于脚本自己修不好的情况（文件缺失、JSON 坏了）。这类问题不走 `problems` 清单，
 * 因为清单末尾那句「跑 --write」会误导人。
 *
 * @param {string} where - 哪份文件 + 什么问题。
 * @param {string} expected - 期望的形状。
 * @param {string} actual - 实测到的错误。
 * @param {string} fix - 怎么修。
 * @returns {never} 总是退出（exit 1）。
 */
function fatal(where, expected, actual, fix) {
  console.error(`sync-hosts: ${where}`);
  console.error(`     期望: ${expected}`);
  console.error(`     实际: ${actual}`);
  console.error(`     修法: ${fix}`);
  process.exit(1);
}

/**
 * 读一份必须存在的文本文件，缺失时给出「从哪来 / 怎么恢复」。
 *
 * @param {string} file - 相对仓库根的文件名。
 * @returns {string} 文件内容。
 */
function readText(file) {
  try {
    return readFileSync(join(ROOT, file), 'utf8');
  } catch (error) {
    fatal(
      `${file} 读不到`,
      `${file} 是仓库根下的普通文本文件`,
      `${error.code ?? error.message}`,
      `从 git 恢复这份文件（git checkout -- ${file}），或按另一语言版本重建后重跑`,
    );
  }
}

/**
 * 读 `package.json` 并解析成对象，坏 JSON 直接报「哪坏、期望什么样、手工修」。
 *
 * @returns {Record<string, unknown>} 解析后的 package.json。
 */
function readManifest() {
  const text = readText('package.json');
  try {
    return JSON.parse(text);
  } catch (error) {
    fatal(
      'package.json 不是合法 JSON',
      '2 空格缩进的 JSON 对象（顶层含 name / version / peerDependencies / engines）',
      error.message,
      '手工修好这份 JSON（本脚本连 --write 也不回写坏掉的 JSON），再跑 node scripts/sync-hosts.mjs',
    );
  }
}

/**
 * 采集当前状态并给出不一致项与回写计划。
 *
 * @returns {{problems: Array<{where: string, expected: string, actual: string, fixable: boolean}>,
 *   rewrites: Array<{file: string, next: string}>}} 校验结果与计划写回的文件内容。
 */
function inspect() {
  const problems = [];
  const rewrites = [];
  /** 记一处不一致；`fixable` 为 false 表示 `--write` 修不了（锚点找不到、取值无法推导），必须手工改。 */
  const report = (where, expected, actual, fixable = true) => problems.push({ where, expected, actual, fixable });

  /* ---------------------------------------------------------- 真源自检 */

  if (supportedHosts.length === 0) {
    report('scripts/hosts.mjs 的 supportedHosts', '至少一版', '空数组', false);
  }
  for (let i = 1; i < supportedHosts.length; i += 1) {
    let verdict;
    try {
      verdict = compareVersions(supportedHosts[i - 1], supportedHosts[i]);
    } catch (error) {
      report('scripts/hosts.mjs 的 supportedHosts', '每一项都是合法的语义化版本', error.message, false);
      break;
    }
    if (verdict >= 0) {
      report('scripts/hosts.mjs 的 supportedHosts 顺序', '严格升序', `${supportedHosts[i - 1]} → ${supportedHosts[i]}`, false);
    }
  }
  if (!supportedHosts.includes(developmentHost)) {
    report('scripts/hosts.mjs 的 developmentHost', `supportedHosts 之一（${supportedHosts.join('、')}）`, developmentHost, false);
  }

  /* ------------------------------------------------------- package.json */

  const pkg = readManifest();
  let pkgTouched = false;

  if (pkg.engines?.dsh !== peerRange) {
    report('package.json engines.dsh', `"${peerRange}"`, pkg.engines?.dsh === undefined ? '(缺失)' : `"${pkg.engines.dsh}"`);
    pkg.engines = { ...(pkg.engines ?? {}), dsh: peerRange };
    pkgTouched = true;
  }

  for (const name of requiredHostPeers) {
    const actual = pkg.peerDependencies?.[name];
    if (actual !== peerRange) {
      report(`package.json peerDependencies["${name}"]`, `"${peerRange}"`, actual === undefined ? '(缺失)' : `"${actual}"`);
      pkg.peerDependencies = { ...(pkg.peerDependencies ?? {}), [name]: peerRange };
      pkgTouched = true;
    }
  }

  try {
    assertHostPeers(pkg.peerDependencies);
  } catch (error) {
    report('package.json 宿主 peer 集合', `恰好 ${requiredHostPeers.length} 条，与 requiredHostPeers 逐字相等`, error.message);
  }

  if (pkgTouched) rewrites.push({ file: 'package.json', next: `${JSON.stringify(pkg, null, 2)}\n` });

  /* ------------------------------------------------------------ README */

  for (const file of READMES) {
    const text = readText(file);
    let next = text;

    // 兼容行是三态：1 行 → 比对取值；≥2 行 → 仍是错（多处锚点是歧义，不是可选）；0 行 → 跳过不报。
    const compatHits = text.split('\n').filter((line) => COMPAT_LINE.test(line));
    if (compatHits.length > 1) {
      report(
        `${file} 的兼容行`,
        `至多一行形如 "- **DSH**：\`${WANTED_LINE_VALUE}\`"（正则 ${COMPAT_LINE.source}；多处锚点有歧义，不是可选）`,
        `匹配到 ${compatHits.length} 行`,
        false,
      );
    } else if (compatHits.length === 1) {
      const [line] = compatHits;
      const actual = COMPAT_LINE.exec(line)[1].trim();
      if (actual !== WANTED_LINE_VALUE) {
        const wanted = line.replace(/`[^`]+`/, `\`${WANTED_LINE_VALUE}\``);
        report(`${file} 的兼容行`, wanted, line);
        next = next.replace(line, wanted);
      }
    }

    const badgeHits = [...text.matchAll(BADGE())];
    if (badgeHits.length !== 1) {
      report(
        `${file} 的 DSH 徽标`,
        '恰好一处匹配 ![DSH](https://img.shields.io/badge/DSH-…)',
        `匹配到 ${badgeHits.length} 处`,
        false,
      );
    } else {
      const [hit] = badgeHits;
      const inner = hit[1];
      const color = inner.split('-').pop();
      const wantedInner = `${encodeBadgeMessage(`>=${MIN_HOST}`)}-${color}`;
      if (!/^[0-9A-Fa-f]{3,8}$/.test(color)) {
        report(
          `${file} 的 DSH 徽标颜色`,
          `末段是十六进制颜色（如 4B6EF5），整枚徽标形如 ![DSH](https://img.shields.io/badge/DSH-${encodeBadgeMessage(`>=${MIN_HOST}`)}-4B6EF5)`,
          hit[0],
          false,
        );
      } else if (inner !== wantedInner) {
        report(`${file} 的 DSH 徽标`, `![DSH](https://img.shields.io/badge/DSH-${wantedInner})`, hit[0]);
        next = next.replace(hit[0], `![DSH](https://img.shields.io/badge/DSH-${wantedInner})`);
      }
    }

    if (next !== text) rewrites.push({ file, next });
  }

  return { problems, rewrites };
}

/**
 * 打印不一致清单（期望 / 实际 / 修法）。
 *
 * @param {Array<{where: string, expected: string, actual: string, fixable: boolean}>} problems - 不一致项。
 * @param {number} unfixable - 其中 `--write` 修不了的条数（锚点缺失、取值无法推导）。
 * @param {boolean} [withFixHint] - 是否打印「跑 --write」的提示（回写后的复查不再提示，免得自相矛盾）。
 * @returns {void}
 */
function printProblems(problems, unfixable, withFixHint = true) {
  console.error(`sync-hosts: ${problems.length} 处与真源不一致`);
  for (const [index, problem] of problems.entries()) {
    console.error(`  ${index + 1}. ${problem.where}`);
    console.error(`     期望: ${problem.expected}`);
    console.error(`     实际: ${problem.actual}`);
  }
  if (unfixable > 0) {
    console.error(`\n其中 ${unfixable} 处不是 \`--write\` 能修的（锚点找不到，或取值不在脚本能推导的范围内）——`
      + '按上面的「期望」手工改那几处，再跑 node scripts/sync-hosts.mjs 复查');
    return;
  }
  if (withFixHint) console.error(`\n修法：${FIX}`);
}

const first = inspect();

if (first.problems.length === 0) {
  console.log(`sync-hosts: 一致（${supportedHosts.length} 个宿主，区间 ${peerRange}，下限 ${MIN_HOST}）`);
  process.exit(0);
}

const unfixable = first.problems.filter((problem) => !problem.fixable).length;
if (!WRITE || unfixable > 0) {
  printProblems(first.problems, unfixable);
  process.exit(1);
}

for (const { file, next } of first.rewrites) {
  writeFileSync(join(ROOT, file), next);
  console.log(`sync-hosts: 已回写 ${file}`);
}

const second = inspect();
if (second.problems.length > 0) {
  console.error('sync-hosts: 回写后仍不一致——回写只补不删（多出来的宿主 peer 要手工删），或者真源本身有问题：');
  printProblems(second.problems, second.problems.filter((problem) => !problem.fixable).length, false);
  process.exit(1);
}
console.log(`sync-hosts: 回写完成（${supportedHosts.length} 个宿主，区间 ${peerRange}，下限 ${MIN_HOST}）`);
