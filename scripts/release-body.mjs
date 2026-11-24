#!/usr/bin/env node
/**
 * GitHub Release 正文生成器：把 `docs/releases/<tag>.md` 变成 Release notes。
 *
 * 一条规则、两个调用点：
 *   - `scripts/publish.yml` 的建 Release 步骤（`node scripts/release-body.mjs "$TAG" | gh release create … --notes-file -`）；
 *   - 事后手工补建（同一条命令，别在网页上粘）。
 *
 * 变换只有三步，任何一步变化都会让「文档正文」与「线上 Release」重新分叉：
 *   1. 丢掉首个 `## ` 章节之前的全部行——那是仓库侧门禁要的标题与五行注记
 *      （类型 / 读者 / 真源 / 更新触发 / 规模上限），不对外；
 *   2. 保留其后的正文原样（只清掉末尾空行）；
 *   3. 末尾要有那句「全量变更见 `CHANGELOG.md` 的 [x.y.z] 节。」——**文档里已经有了就不补**，
 *      免得线上 Release 出现两遍（1.1.3 / 1.1.4 的逐版正文本来就以它收尾）。
 *
 * 为什么不用 `--generate-notes`：那是把提交标题堆成正文，与逐版正文的体例（附录 W-4
 * 五段式）无关；这里要的是文档本身。
 *
 * 用法：node scripts/release-body.mjs <tag> [docs/releases/<tag>.md]
 *   缺参数、tag 不是 `vX.Y.Z`、文件不存在、找不到 `## ` 章节 —— 一律非零退出，
 *   免得 CI 建出一个正文为空的 Release。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根；CLI 的默认文档路径从它拼。 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * 末尾那句的版本口径：`1.1.4`（不带 `v`，与 `CHANGELOG.md` 的 `## [1.1.4]` 对齐）。
 *
 * @param {string} version - 不带 `v` 的版本号。
 * @returns {string} 收尾句。
 */
export function closingLine(version) {
  return `全量变更见 \`CHANGELOG.md\` 的 [${version}] 节。`;
}

/**
 * `v1.1.4` → `1.1.4`。只接受三段号，可选预发布后缀（`v1.2.0-rc.1`）。
 *
 * @param {string} tag - git tag 名。
 * @returns {string} 版本号。
 * @throws {Error} tag 不是 `vX.Y.Z` 形态。
 */
export function versionOfTag(tag) {
  const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?)$/.exec(tag);
  if (match === null) throw new Error(`tag 不是 vX.Y.Z 形态：${JSON.stringify(tag)}`);
  return match[1];
}

/**
 * 把逐版 Release 文档切成 GitHub Release 正文。
 *
 * @param {string} docText - `docs/releases/<tag>.md` 的全文。
 * @param {string} version - 不带 `v` 的版本号（决定收尾句）。
 * @returns {string} Release 正文，末尾带一个换行。
 * @throws {Error} 文档里没有二级章节。
 */
export function releaseBodyOf(docText, version) {
  const lines = docText.split('\n');
  const at = lines.findIndex((line) => line.startsWith('## '));
  if (at < 0) throw new Error('文档里没有二级章节（`## 定位` 起才算正文）');
  const body = lines.slice(at).join('\n').trimEnd();
  const closing = closingLine(version);
  if (body.endsWith(closing)) return `${body}\n`;
  return `${body}\n\n${closing}\n`;
}

/* ------------------------------------------------------------------ CLI */

const [tagArg, fileArg] = process.argv.slice(2);
if (tagArg === undefined) {
  console.error('用法：node scripts/release-body.mjs <tag> [docs/releases/<tag>.md]');
  process.exit(2);
}

try {
  const version = versionOfTag(tagArg);
  const file = fileArg ?? join(ROOT, 'docs', 'releases', `${tagArg}.md`);
  if (!existsSync(file)) throw new Error(`找不到逐版正文：${file}`);
  process.stdout.write(releaseBodyOf(readFileSync(file, 'utf8'), version));
} catch (error) {
  console.error(`release-body: ${error.message}`);
  process.exit(1);
}
