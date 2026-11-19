/**
 * semver 的取用顺序 + 一份刻意做小的兜底实现。
 *
 * 为什么需要这个文件：`scripts/check-version.mjs` 要在 `prepublishOnly` 里断言
 * 「`supportedHosts` 每一版都被 `peerRange` 覆盖」，而这一步不联网、不许装依赖。
 * 于是按可信度取用现成的实现：
 *   1. `<repo>/node_modules/semver` —— 本地装过就用，与 npm 自己的解析器同源；
 *   2. 宿主 `app.asar` 里的 `dsh/node_modules/semver` —— 与本包真实运行环境同源，
 *      这台机器上跑 `prepublishOnly` 就必然有宿主，所以它是常见路径；
 *   3. 本文件的 {@link satisfiesLite} —— 裸机兜底，保证脚本永远跑得动。
 *
 * {@link satisfiesLite} **只支持本包实际用到的那点语法**，其余一律抛错：
 *   支持：`||` 备选；比较子 `>=` `>` `<=` `<` `=`（可省略）配**完整版本**；
 *        `^` 与 `~` 也配完整版本；版本允许前导 `v` 与 `-预发布` 后缀；
 *        操作符与版本之间的空格会被消掉。
 *   不支持（**解析到就抛 `Error`，绝不静默返回 false** —— 静默判错的危害比不支持更大）：
 *        `x` / `X` / `*` 通配与 `1.x` / `1.2.x` 这类 x-range；部分版本（`1`、`1.2`）；
 *        连字符区间（`1.2.3 - 2.3.4`）；空区间（等价于 `*`）。
 *   抛错信息里会给出补救办法：让仓库 `node_modules` 里有 semver，或装宿主（宿主 asar 自带一份）。
 *   另外未覆盖 semver 的 loose 模式写法（`=v1.2.3` 一类）——本实现只保证上面那点语法与 semver 同判，
 *   这也是它只在「没有 semver 可用」时才顶上的原因。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { HOST_ASAR, listAsarEntries, readAsarFile } from './asar-read.mjs';

/** 走兜底路径时打印给维护者看的说明（由 `check-version.mjs` 引用，避免两处措辞漂移）。 */
export const SEMVER_LITE_NOTE = '本机没有可用的 semver（仓库 node_modules 与宿主 app.asar 都没有），'
  + '已退回 scripts/semver-lite.mjs 的最小实现；它只覆盖本包用到的区间写法，遇到不支持的说法会直接抛错。';

/** 兜底实现遇到不支持的区间时，给调用者的补救说明。 */
const INSTALL_HINT = '把 semver 装进仓库 node_modules（或装上宿主，宿主 asar 自带一份）即可。';

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const OPERATOR_RE = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/;

/**
 * 解析一个完整版本号。
 *
 * @param {string} text - 形如 `0.2.2-rc.5`（允许前导 `v`）。
 * @returns {{major: number, minor: number, patch: number, prerelease: string[]}|null} 解析结果；非法返回 `null`。
 */
export function parseVersion(text) {
  if (typeof text !== 'string') return null;
  const match = VERSION_RE.exec(text.trim());
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  };
}

/**
 * 比较两个预发布标识（数字段按数值、其余按 ASCII，数字段优先级更低）。
 *
 * @param {string} left - 左标识。
 * @param {string} right - 右标识。
 * @returns {number} -1 / 0 / 1。
 */
function compareIdentifiers(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) return Math.sign(Number(left) - Number(right));
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * 按 semver 2.0.0 的优先级比较两个解析后的版本。
 *
 * @param {{major: number, minor: number, patch: number, prerelease: string[]}} left - 左版本。
 * @param {{major: number, minor: number, patch: number, prerelease: string[]}} right - 右版本。
 * @returns {number} -1 / 0 / 1。
 */
function compareParsed(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  const leftPre = left.prerelease;
  const rightPre = right.prerelease;
  if (leftPre.length === 0 && rightPre.length === 0) return 0;
  if (leftPre.length === 0) return 1;
  if (rightPre.length === 0) return -1;
  const shared = Math.min(leftPre.length, rightPre.length);
  for (let i = 0; i < shared; i += 1) {
    const verdict = compareIdentifiers(leftPre[i], rightPre[i]);
    if (verdict !== 0) return verdict;
  }
  if (leftPre.length === rightPre.length) return 0;
  return leftPre.length < rightPre.length ? -1 : 1;
}

/**
 * 比较两个版本号（字符串或解析结果均可）。
 *
 * @param {string|object} left - 左版本。
 * @param {string|object} right - 右版本。
 * @returns {number} -1 / 0 / 1；任一侧非法时抛 `TypeError`。
 */
export function compareVersions(left, right) {
  const a = typeof left === 'string' ? parseVersion(left) : left;
  const b = typeof right === 'string' ? parseVersion(right) : right;
  if (a === null || a === undefined || b === null || b === undefined) {
    throw new TypeError(`compareVersions: 无法解析版本号 ${JSON.stringify(left)} / ${JSON.stringify(right)}`);
  }
  return compareParsed(a, b);
}

/**
 * 造一个 `x.y.z-0` 上界（预发布 `0` 是 semver 判「不含下一段」的标准写法）。
 *
 * @param {number} major - 主版本。
 * @param {number} minor - 次版本。
 * @param {number} patch - 修订号。
 * @returns {{major: number, minor: number, patch: number, prerelease: string[]}} 版本对象。
 */
function minusZero(major, minor, patch) {
  return { major, minor, patch, prerelease: ['0'] };
}

/**
 * 抛「不支持的区间写法」错。宁可让调用方炸掉，也不给一个可能判错的布尔值。
 *
 * @param {string} token - 出问题的片段。
 * @param {string} why - 为什么不支持。
 * @returns {never} 总是抛出。
 */
function unsupported(token, why) {
  throw new Error(`semver-lite: 不支持区间片段 ${JSON.stringify(token)}——${why}。${INSTALL_HINT}`);
}

/**
 * 把一个比较子展开成若干 `>=` / `<` 比较（`^`、`~` 要展开成上下两条）。
 *
 * @param {string} token - 如 `>=0.2.2-0`、`^0.2.2-rc.1`。
 * @returns {Array<{op: string, version: object}>} 比较子列表。
 * @throws {Error} 片段不是「操作符 + 完整版本」时抛出（`x` / `*` / 部分版本都走这里）。
 */
function expandToken(token) {
  const match = OPERATOR_RE.exec(token.trim());
  if (match === null) unsupported(token, '认不出比较子');
  const op = match[1] ?? '=';
  const raw = match[2].trim();
  const version = parseVersion(raw);
  if (version === null) {
    const wildcard = /(^|[.\-])[xX*]($|[.\-])/.test(raw) || raw === '*' || raw === 'x' || raw === 'X';
    unsupported(token, wildcard ? '不支持 x / * 通配（x-range）' : '只接受完整版本 x.y.z（可带 -预发布 后缀）');
  }

  switch (op) {
    case '^':
      // caret：主版本非零时放宽到下一个主版本，`0.x` 按次版本、`0.0.x` 按修订号收。
      if (version.major > 0) return [{ op: '>=', version }, { op: '<', version: minusZero(version.major + 1, 0, 0) }];
      if (version.minor > 0) return [{ op: '>=', version }, { op: '<', version: minusZero(0, version.minor + 1, 0) }];
      return [{ op: '>=', version }, { op: '<', version: minusZero(0, 0, version.patch + 1) }];
    case '~':
      // tilde：只放开修订号。
      return [{ op: '>=', version }, { op: '<', version: minusZero(version.major, version.minor + 1, 0) }];
    case '>=':
    case '>':
    case '<=':
    case '<':
      return [{ op, version }];
    default:
      return [{ op: '=', version }];
  }
}

/**
 * 判一个比较子是否成立。
 *
 * @param {{op: string, version: object}} comparator - 比较子。
 * @param {object} version - 解析后的版本。
 * @returns {boolean} 是否成立。
 */
function testComparator(comparator, version) {
  const verdict = compareParsed(version, comparator.version);
  switch (comparator.op) {
    case '>=':
      return verdict >= 0;
    case '>':
      return verdict > 0;
    case '<=':
      return verdict <= 0;
    case '<':
      return verdict < 0;
    default:
      return verdict === 0;
  }
}

/**
 * 最小 semver 区间匹配（只覆盖文件头列出的那点语法）。
 *
 * @param {string} versionText - 待判版本，如 `0.2.2-rc.1`。
 * @param {string} rangeText - 区间，如 `>=0.2.2-0 <0.3.0-0`。
 * @param {{includePrerelease?: boolean}} [options] - 与 semver 的同名选项对齐。
 * @returns {boolean} 是否满足。
 * @throws {Error} 区间用了不支持的写法（x-range、部分版本、连字符区间、空区间）时抛出。
 */
export function satisfiesLite(versionText, rangeText, options = {}) {
  const version = parseVersion(versionText);
  if (version === null) throw new Error(`semver-lite: 版本号 ${JSON.stringify(versionText)} 不是合法的 x.y.z`);
  const includePrerelease = options.includePrerelease === true;
  const range = String(rangeText ?? '').trim();
  if (range === '') unsupported(range, '空区间等价于 `*`');
  const sets = range.split('||');

  for (const rawSet of sets) {
    const normalized = rawSet.trim().replace(/(>=|<=|>|<|=|~|\^)\s+/g, '$1');
    const tokens = normalized.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) unsupported(rawSet, '这一段是空的');
    const comparators = tokens.flatMap((token) => expandToken(token));
    if (!comparators.every((comparator) => testComparator(comparator, version))) continue;
    if (version.prerelease.length > 0 && !includePrerelease) {
      // semver 的预发布门槛：同 tuple 的比较子里没有预发布标识，就不放行。
      const gateOpen = comparators.some((comparator) => comparator.version.prerelease.length > 0
        && comparator.version.major === version.major
        && comparator.version.minor === version.minor
        && comparator.version.patch === version.patch);
      if (!gateOpen) continue;
    }
    return true;
  }
  return false;
}

/**
 * 把宿主 asar 里的 `semver` 解到临时目录并加载（加载完就删目录，模块已在内存里）。
 *
 * @returns {{satisfies: Function, compare: Function, source: string}|null} 加载结果；宿主不可用返回 `null`。
 */
function loadHostSemver() {
  const prefix = 'dsh/node_modules/semver';
  const entries = listAsarEntries(HOST_ASAR).filter((path) => path.startsWith(`${prefix}/`));
  if (entries.length === 0) return null;
  const dir = mkdtempSync(join(tmpdir(), 'skc-semver-'));
  try {
    for (const inner of entries) {
      const content = readAsarFile(HOST_ASAR, inner);
      if (content === null) continue;
      const target = join(dir, 'node_modules', 'semver', inner.slice(prefix.length + 1));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    const manifestPath = join(dir, 'node_modules', 'semver', 'package.json');
    if (!existsSync(manifestPath)) return null;
    const { version } = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const semver = createRequire(join(dir, 'noop.cjs'))('semver');
    return {
      satisfies: semver.satisfies,
      compare: semver.compare,
      source: `宿主 app.asar 的 dsh/node_modules/semver@${version}`,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 取一份可用的 semver 实现（真实现优先，最小实现兜底）。
 *
 * @param {string} root - 仓库根目录。
 * @returns {{satisfies: Function, compare: Function, source: string, reference: boolean}} 实现与来源。
 *   `reference` 为 `true` 表示是真 semver，可信度等同 npm。
 */
export function loadSemver(root) {
  const localDir = join(root, 'node_modules', 'semver');
  if (existsSync(join(localDir, 'package.json'))) {
    const { version } = JSON.parse(readFileSync(join(localDir, 'package.json'), 'utf8'));
    const semver = createRequire(join(root, 'package.json'))('semver');
    return { satisfies: semver.satisfies, compare: semver.compare, source: `node_modules/semver@${version}`, reference: true };
  }
  const host = loadHostSemver();
  if (host !== null) return { ...host, reference: true };
  return { satisfies: satisfiesLite, compare: compareVersions, source: 'scripts/semver-lite.mjs（最小实现）', reference: false };
}
