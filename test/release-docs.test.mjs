/**
 * 逐版 Release 正文（`docs/releases/*.md`）的结构对账。
 *
 * 体例见 `docs/contracts/release-doc-standard.md`：文件与 tag 逐字同名、一级标题只写纯版本号、
 * 章节按固定顺序、文末单行 Compare 链接 + 带版本锚点的 `CHANGELOG.md` 链接。这几条都能机械
 * 判定，所以钉成用例——「首尾相接的 Compare 链」与「锚点对着 `## [x.y.z] - YYYY-MM-DD`」一旦
 * 写错，读者点到的就是 404 或错误的那一节，而门禁不会替人看一眼。
 *
 * 这里只断言形状与引用，不断言正文措辞：体例的取舍（一句一条、分类归属）靠 review。
 *
 * 底部链接有两种合法形态（体例见该规范 9.3 的「底部链接」）：常见的
 * `compare/v<上一版>...v<本版>`，以及**首版例外**——没有上一版时链首指向 tag 页
 * `releases/tag/<tag>`。首版之外的版本一律走 Compare，且链首必须是上一版。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RELEASES = join(ROOT, 'docs', 'releases');

/** 章节顺序（缺失的章节跳过，出现即须按此顺序）。 */
const CHAPTERS = ['破坏性变更', '新增', '改进', '修复', '移除', '注意事项'];

/** 文末那一行（常规形态）：Compare 链接 + 带锚点的 CHANGELOG 链接。 */
const BOTTOM_COMPARE = /^\*\*完整变更\*\*：\[v([0-9.]+)\.\.\.v([0-9.]+)\]\(https:\/\/github\.com\/Ztqing4Agents\/dsh-skill-panel\/compare\/v([0-9.]+)\.\.\.v([0-9.]+)\) · \[CHANGELOG\]\(https:\/\/github\.com\/Ztqing4Agents\/dsh-skill-panel\/blob\/main\/CHANGELOG\.md#([0-9]+---\d{4}-\d{2}-\d{2})\)$/;

/** 文末那一行（首版例外）：链首是没有上一版时指向的 tag 页 + 同一个 CHANGELOG 锚点。 */
const BOTTOM_TAG = /^\*\*完整变更\*\*：\[v([0-9.]+)\]\(https:\/\/github\.com\/Ztqing4Agents\/dsh-skill-panel\/releases\/tag\/v([0-9.]+)\) · \[CHANGELOG\]\(https:\/\/github\.com\/Ztqing4Agents\/dsh-skill-panel\/blob\/main\/CHANGELOG\.md#([0-9]+---\d{4}-\d{2}-\d{2})\)$/;

/**
 * 解析文末那一行。
 *
 * @param {string} line - 文档最后一行。
 * @returns {{from: string|null, to: string, urlFrom: string|null, urlTo: string, fragment: string}|null}
 *   `from` 为 `null` 表示走的是首版例外形态。
 */
function parseBottom(line) {
  const compare = BOTTOM_COMPARE.exec(line);
  if (compare !== null) {
    const [, from, to, urlFrom, urlTo, fragment] = compare;
    return { from, to, urlFrom, urlTo, fragment };
  }
  const tag = BOTTOM_TAG.exec(line);
  if (tag !== null) {
    const [, text, url, fragment] = tag;
    return { from: null, to: text, urlFrom: null, urlTo: url, fragment };
  }
  return null;
}

/** 版本号排序用：`v1.10.0` 要排在 `v1.9.0` 之后，不能按字符串比。 */
const byVersion = (a, b) => {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
};

/**
 * GitHub 对标题生成的锚点：小写、去掉标点、空格换连字符。
 *
 * @param {string} version - 不带 `v` 的版本号。
 * @param {string} date - `YYYY-MM-DD`。
 * @returns {string} `## [1.1.5] - 2026-11-28` 的锚点。
 */
const anchorOf = (version, date) => (`[${version}] - ${date}`).toLowerCase().replace(/[^\w\- ]/g, '').replace(/ /g, '-');

/** 读 CHANGELOG 的版本节日期。 @returns {Promise<Map<string, string>>} 版本 → 日期 */
async function changelogDates() {
  const text = await readFile(join(ROOT, 'CHANGELOG.md'), 'utf8');
  const dates = new Map();
  for (const m of text.matchAll(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/gm)) dates.set(m[1], m[2]);
  return dates;
}

/** 逐版正文的文件名（按版本升序）。 */
async function releaseFiles() {
  const names = (await readdir(RELEASES)).filter((name) => name.endsWith('.md'));
  assert.ok(names.length > 0, 'docs/releases/ 里应当有逐版正文');
  return names.map((name) => name.slice(0, -3)).sort(byVersion);
}

test('命名与标题：文件与 tag 逐字同名，一级标题只写 `# vX.Y.Z`', async () => {
  for (const tag of await releaseFiles()) {
    assert.match(tag, /^v\d+\.\d+\.\d+$/, `${tag} 不是 vX.Y.Z 形态的 tag 名`);
    const lines = (await readFile(join(RELEASES, `${tag}.md`), 'utf8')).split('\n');
    assert.equal(lines[0], `# ${tag}`, `${tag}.md 的首行必须是纯版本号标题`);
    const h1 = lines.filter((line) => /^# /.test(line));
    assert.equal(h1.length, 1, `${tag}.md 只该有一个一级标题`);
  }
});

test('头注不进正文：前 10 行没有五行注记，也没有 `## 验收` 章节', async () => {
  for (const tag of await releaseFiles()) {
    const lines = (await readFile(join(RELEASES, `${tag}.md`), 'utf8')).split('\n');
    const head = lines.slice(0, 10).join('\n');
    assert.equal(/^> *(类型|读者|真源|更新触发|规模上限) *[:：]/m.test(head), false, `${tag}.md 的仓库侧头注会漏进发布正文`);
    assert.equal(lines.some((line) => /^## .*验收/.test(line)), false, `${tag}.md 不该有验收章节`);
  }
});

test('章节顺序：出现的二级章节都在体例内且次序固定', async () => {
  for (const tag of await releaseFiles()) {
    const lines = (await readFile(join(RELEASES, `${tag}.md`), 'utf8')).split('\n');
    const titles = lines.filter((line) => /^## /.test(line)).map((line) => line.slice(3).trim());
    assert.ok(titles.length > 0, `${tag}.md 至少要有一个分类章节`);
    const positions = titles.map((title) => {
      const at = CHAPTERS.indexOf(title);
      assert.notEqual(at, -1, `${tag}.md 出现了体例外的章节「${title}」`);
      return at;
    });
    const sorted = [...positions].sort((a, b) => a - b);
    assert.deepEqual(positions, sorted, `${tag}.md 的章节次序与体例不符：${titles.join(' → ')}`);
  }
});

test('底部链接：单行收尾，Compare 版本首尾相接（首版指 tag 页），锚点对着 CHANGELOG 的版本节', async () => {
  const dates = await changelogDates();
  const tags = await releaseFiles();
  let previous = null;
  for (const [index, tag] of tags.entries()) {
    const lines = (await readFile(join(RELEASES, `${tag}.md`), 'utf8')).trimEnd().split('\n');
    const bottom = parseBottom(lines[lines.length - 1]);
    assert.ok(bottom, `${tag}.md 的末行不是约定的完整变更链接：${JSON.stringify(lines[lines.length - 1])}`);

    const version = tag.replace(/^v/, '');
    assert.equal(bottom.to, version, `${tag}.md 的链接终点写成了 v${bottom.to}`);
    assert.equal(bottom.urlTo, version, `${tag}.md 的链接 URL 终点与链接文字不一致`);

    if (index === 0) {
      // 首版例外：没有上一版可比，链首指向 tag 页——拿一个不存在的 tag 当链首就是必然 404。
      assert.equal(
        bottom.from,
        null,
        `${tag} 是首版，链首该是 releases/tag/${tag}，不该是 compare/v${bottom.from}...`,
      );
    } else {
      assert.notEqual(bottom.from, null, `${tag} 不是首版，链首必须是上一版 ${previous} 的 Compare 区间`);
      assert.equal(bottom.urlFrom, bottom.from, `${tag}.md 的 Compare URL 起点与链接文字不一致`);
      assert.equal(`v${bottom.from}`, previous, `${tag}.md 的 Compare 起点该是上一版 ${previous}（现为 v${bottom.from}）`);
    }
    previous = tag;

    const date = dates.get(version);
    assert.ok(date, `CHANGELOG.md 里没有 [${version}] 版本节，锚点无处可指`);
    assert.equal(bottom.fragment, anchorOf(version, date), `${tag}.md 的 CHANGELOG 锚点与 [${version}] - ${date} 不匹配`);
  }
});
