/**
 * 只读的 asar 读取器（零依赖）：从宿主 `app.asar` 里取一个内嵌文件。
 *
 * 用途只有两个，都在「验宿主」这件事上：
 *   - `scripts/test-compat.mjs` 读 `dsh/package.json` 的版本，确认验的是声明的那代宿主；
 *   - `scripts/semver-lite.mjs` 兜底时把宿主自带的 `semver` 解出来用。
 *
 * asar 的布局（与 `@electron/asar` 的读法一致）：
 *   0–7 是 pickle 头：偏移 4 处是 `headerSize`（目录表那一块的总长）；
 *   8–15 是目录表的 pickle 头：偏移 12 处是 JSON 文本的字节长度；
 *   目录表从偏移 16 开始；**数据区起点 = `8 + headerSize`**（= `align4(16 + jsonLength)`，
 *   因为 `headerSize` = `align4(8 + jsonLength)`，含两个 u32 与末尾的 4 字节对齐填充）；
 *   普通文件的 `offset` 是相对数据区起点的偏移。
 *
 * 数据区起点**必须**这样算，不能用 `16 + jsonLength`：后者少掉了末尾的对齐填充，
 * `jsonLength % 4 !== 0` 时整份偏移就差 1–3 字节，于是读出来的是错位的字节。
 * 这个 bug 只在 `jsonLength % 4 !== 0` 时暴露——1.1.3 那会儿 `check-version` 还是绿的，
 * 说明当时的 `jsonLength` 恰好是 4 的倍数；0.2.3-alpha.2 不是。
 *
 * 版本不同的机器可以把宿主换成别的路径（`DSH_APP_ASAR`），默认是 macOS 的安装位置。
 */
import { existsSync, readFileSync } from 'node:fs';

/** 宿主 asar 的默认位置，可用环境变量覆盖（非 macOS 或自定义安装时用）。 */
export const HOST_ASAR = process.env.DSH_APP_ASAR ?? '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';

/** 每个 asar 只解析一次目录表（宿主 asar 两百多 MB，重复读代价明显）。 */
const opened = new Map();

/**
 * 解析并缓存一个 asar 的目录表。
 *
 * @param {string} asarPath - asar 文件路径。
 * @returns {{buffer: Buffer, dataStart: number, index: Map<string, {offset: number, size: number}>}|null}
 *   文件不存在时返回 `null`。
 */
function open(asarPath) {
  if (opened.has(asarPath)) return opened.get(asarPath);
  if (!existsSync(asarPath)) {
    opened.set(asarPath, null);
    return null;
  }
  const buffer = readFileSync(asarPath);
  const jsonLength = buffer.readUInt32LE(12);
  const headerSize = buffer.readUInt32LE(4);
  const header = JSON.parse(buffer.subarray(16, 16 + jsonLength).toString('utf8'));
  const index = new Map();
  /** 递归收集普通文件；`unpacked` 的内容不在 asar 里，直接跳过。 */
  const walk = (node, prefix) => {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      const path = prefix === '' ? name : `${prefix}/${name}`;
      if (entry.files !== undefined) walk(entry, path);
      else if (entry.unpacked !== true) index.set(path, { offset: Number(entry.offset), size: Number(entry.size) });
    }
  };
  walk(header, '');
  const result = { buffer, dataStart: 8 + headerSize, index };
  opened.set(asarPath, result);
  return result;
}

/**
 * 列出 asar 里的全部普通文件路径（以 `/` 分隔，不带前导斜杠）。
 *
 * @param {string} asarPath - asar 文件路径。
 * @returns {string[]} 路径列表；asar 不存在时返回空数组。
 */
export function listAsarEntries(asarPath) {
  const archive = open(asarPath);
  return archive === null ? [] : [...archive.index.keys()];
}

/**
 * 读 asar 里的一个文件。
 *
 * @param {string} asarPath - asar 文件路径。
 * @param {string} innerPath - asar 内路径，可带前导 `/`（如 `/dsh/package.json`）。
 * @returns {Buffer|null} 文件内容；文件或 asar 不存在时返回 `null`。
 */
export function readAsarFile(asarPath, innerPath) {
  const archive = open(asarPath);
  if (archive === null) return null;
  const key = innerPath.replace(/^\/+|\/+$/g, '');
  const entry = archive.index.get(key);
  if (entry === undefined) return null;
  const start = archive.dataStart + entry.offset;
  return archive.buffer.subarray(start, start + entry.size);
}

/**
 * 读 asar 里的一个 JSON 文件。
 *
 * @param {string} asarPath - asar 文件路径。
 * @param {string} innerPath - asar 内路径。
 * @returns {unknown|null} 解析结果；文件缺失或不是合法 JSON 时返回 `null`。
 */
export function readAsarJson(asarPath, innerPath) {
  const buffer = readAsarFile(asarPath, innerPath);
  if (buffer === null) return null;
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    return null;
  }
}
