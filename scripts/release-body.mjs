#!/usr/bin/env node
/**
 * GitHub Release 正文生成器：把 `docs/releases/<tag>.md` 转为 GitHub Release 正文。
 *
 * 一条规则、两个调用点：
 *   - `.github/workflows/publish.yml` 的建 Release 步骤（`node scripts/release-body.mjs "$TAG" | gh release create … --notes-file -`）；
 *   - 事后手工补建（同一条命令，别在网页上粘）。
 *
 * 变换只有三步，任何一步变化都会让「文档正文」与「线上 Release」重新分叉：
 *   1. 丢掉首行 `# vX.Y.Z` 标题与紧随的空行（首行若是空行，先跳过再判标题）——GitHub Release
 *      页面自带标题；标题下那句可选的版本概览属于正文，保留（`vX.Y.Z.md` 的体例见
 *      `docs/contracts/release-doc-standard.md`，正文没有仓库侧的五行头注要剥）；
 *   2. 保留其余正文原样（含分类变更与文末的单行完整变更链接），仅清理末尾多余空行；
 *   3. 末尾要有那句「全量变更见 `CHANGELOG.md` 的 [x.y.z] 节。」——**文档里已经有了就不补**，
 *      免得线上 Release 出现两遍；缺了才补一句，手工补建的 Release 才不会丢掉 CHANGELOG 指向。
 *
 * 为什么不用 `--generate-notes`：那是把提交标题堆成正文，与本仓的逐版正文体例无关；
 * 这里要的是文档本身。
 *
 * 用法：node scripts/release-body.mjs <tag> [docs/releases/<tag>.md]
 *   缺参数、tag 不是 `vX.Y.Z`、文件不存在、正文为空 —— 一律非零退出，
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
 * @throws {Error} 去掉标题后正文为空。
 */
export function releaseBodyOf(docText, version) {
  const lines = docText.replace(/\r\n?/g, '\n').split('\n');
  // 前导空行不算正文：先跳过再判标题，否则首行为空时 `# vX.Y.Z` 会留在正文里。
  let start = 0;
  while (start < lines.length && lines[start].trim() === '') start += 1;
  if (lines[start]?.startsWith('# ')) start += 1;
  while (start < lines.length && lines[start].trim() === '') start += 1;
  const body = lines.slice(start).join('\n').trimEnd();
  if (body === '') throw new Error('Release 文档正文为空');
  const closing = closingLine(version);
  // 正文本来就以收尾句结尾（体例允许写进文档）时不再追加，免得线上出现两遍。
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
