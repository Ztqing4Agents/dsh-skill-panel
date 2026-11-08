/**
 * `lib/frontmatter.js` — byte-faithful rewriting of one frontmatter field.
 *
 * Contract: docs/contracts/data-model.md §3.2.4 and docs/contracts/routes.md §3.4.2; case ids K7, K8, K9, K10.
 * The CRLF sample is the one this machine actually ships
 * (`~/.dsh/skills/indiv-guipi--find-skills/SKILL.md`, first two bytes `2d 2d 2d 0d 0a`).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isNoFrontmatterError,
  parseFrontmatter,
  setDisableModelInvocation,
  stripFrontmatter,
} from '../lib/frontmatter.js';

/** A CRLF skill file: every line, including the fences, ends with CRLF. */
const CRLF = Buffer.from([
  '---',
  'name: find-skills',
  'slug: find-skills',
  'description: A CRLF fixture.',
  '---',
  '# find-skills',
  '',
  'body line',
  '',
].join('\r\n'), 'utf8');

/** An LF skill file that already carries the field, plus a trailing comment. */
const LF_COMMENTED = Buffer.from([
  '---',
  'name: commented',
  'description: A fixture with a comment on the rewritten field.',
  'disable-model-invocation: true  # 临时关闭',
  '---',
  '# body',
  '',
].join('\n'), 'utf8');

/** An LF skill file with no such field. */
const LF_PLAIN = Buffer.from(['---', 'name: plain', 'description: A plain fixture.', '---', '# body', ''].join('\n'), 'utf8');

/** The BOM fixture. */
const WITH_BOM = Buffer.concat([
  Buffer.from([0xef, 0xbb, 0xbf]),
  Buffer.from(['---', 'name: bom', 'description: BOM fixture.', '---', '# body', ''].join('\n'), 'utf8'),
]);

test('parseFrontmatter 读出 name/description 与 disable-model-invocation', () => {
  const parsed = parseFrontmatter(LF_PLAIN.toString('utf8'));
  assert.equal(parsed.name, 'plain', 'name 被读出');
  assert.equal(parsed.description, 'A plain fixture.', 'description 被读出');
  assert.equal(parsed.disableModelInvocation, false, '没有该键时视为启用');
  assert.equal(parsed.present, true, '闭合成对的 frontmatter 被识别为存在');
});

test('parseFrontmatter 认 yes/on/1 等宿主同款布尔拼写', () => {
  for (const spelling of ['true', 'yes', 'on', '1', 'TRUE', 'Yes']) {
    const text = ['---', 'name: x', `disable-model-invocation: ${spelling}`, '---', ''].join('\n');
    assert.equal(parseFrontmatter(text).disableModelInvocation, true, `"${spelling}" 被解析为停用`);
  }
  for (const spelling of ['false', 'no', 'off', '0']) {
    const text = ['---', 'name: x', `disable-model-invocation: ${spelling}`, '---', ''].join('\n');
    assert.equal(parseFrontmatter(text).disableModelInvocation, false, `"${spelling}" 被解析为启用`);
  }
});

test('parseFrontmatter 会去掉标量外的一层引号与行尾注释', () => {
  const text = ['---', 'name: "quoted-name"', 'description: "quoted description"', '---', ''].join('\n');
  const parsed = parseFrontmatter(text);
  assert.equal(parsed.name, 'quoted-name', '双引号被去掉');
  assert.equal(parsed.description, 'quoted description', '引号内的空格保留');
});

test('parseFrontmatter 没有 frontmatter 块时 present 为 false', () => {
  const parsed = parseFrontmatter('# heading only\n\nbody\n');
  assert.equal(parsed.present, false, '没有 --- 块时 present 为 false');
  assert.equal(parsed.disableModelInvocation, false, '没有块时按启用处理');
});

test('KI-2 折叠标量：缩进正文按空格折成一句话，clip 保留一个末尾换行', () => {
  // 真实样本 ~/.dsh/skills/clawhub-wpank--ui-design/SKILL.md 的 description 是
  // `description: >` + 三行缩进正文；修复前解析器把指示符 ">" 当成了正文。
  const text = ['---', 'name: ui-design', 'description: >', '  Comprehensive UI design skill.', '  Second line.', '---', ''].join('\n');
  assert.equal(
    parseFrontmatter(text).description,
    'Comprehensive UI design skill. Second line.\n',
    '折叠标量解析成正文：行间以空格连接，默认 chomping 保留一个末尾换行',
  );
});

test('K7 改写 CRLF 文件后每一行仍是 CRLF，没有出现裸换行', () => {
  const result = setDisableModelInvocation(CRLF, true);
  assert.equal(result.changed, true, '缺键时发生改写');
  assert.equal(result.inserted, true, '缺键时是插入而不是替换');
  const text = result.next.toString('utf8');
  assert.ok(text.includes('\r\n'), '输出仍然含有 CRLF');
  assert.equal(/[^\r]\n/.test(text), false, '输出里没有裸 \\n');
  assert.match(text, /^---\r\n/, '开头分隔行仍是 CRLF');
});

test('K7 幂等：再写一次同样的值不改字节', () => {
  const first = setDisableModelInvocation(CRLF, true);
  const second = setDisableModelInvocation(first.next, true);
  assert.equal(second.changed, false, '第二次写入报告未变更');
  assert.equal(second.next.equals(first.next), true, '第二次写入输出与第一次逐字节相同');
});

test('K8 逐字保真：只插入一行，插入点前后的所有行原样后移', () => {
  const before = LF_PLAIN.toString('utf8').split('\n');
  const after = setDisableModelInvocation(LF_PLAIN, true).next.toString('utf8').split('\n');
  assert.equal(after.length, before.length + 1, '只多出一行');
  const at = after.findIndex((line, index) => line !== before[index]);
  assert.equal(at, 3, '插入点在第一处差异，即闭合分隔符之前');
  assert.equal(after[at], 'disable-model-invocation: true', '新行就是被写的字段');
  assert.deepEqual(after.slice(0, at), before.slice(0, at), '插入点之前的行逐字不变');
  assert.deepEqual(after.slice(at + 1), before.slice(at), '插入点之后的行原样后移一行');
  assert.equal(before[at], '---', '插入点原本是闭合分隔符（新字段落在块内最后一个顶层键之后）');
});

test('K8 BOM 保留在首位，位置不变', () => {
  const result = setDisableModelInvocation(WITH_BOM, true);
  assert.deepEqual([...result.next.subarray(0, 3)], [0xef, 0xbb, 0xbf], '前三个字节仍是 BOM');
  assert.equal(result.next.toString('utf8').replace('\ufeff', '').startsWith('---\n'), true, 'BOM 之后紧接开头分隔行');
});

test('K9 目标键已存在时只换值，保留行尾注释与缩进', () => {
  const result = setDisableModelInvocation(LF_COMMENTED, false);
  const text = result.next.toString('utf8');
  assert.ok(text.includes('disable-model-invocation: false  # 临时关闭'), '值换成 false，注释原样保留');
  assert.equal(result.inserted, false, '已有键时是替换而不是插入');
  assert.equal(text.split('\n').length, LF_COMMENTED.toString('utf8').split('\n').length, '行数不变');
});

test('缩进的同名键不是顶层键：不被改写，改写落在顶层', () => {
  const indented = Buffer.from(['---', 'name: x', 'metadata:', '  disable-model-invocation: true', '---', ''].join('\n'), 'utf8');
  const text = setDisableModelInvocation(indented, false).next.toString('utf8');
  assert.ok(text.includes('  disable-model-invocation: true'), '嵌套键的字节原样保留');
  assert.ok(text.includes('\ndisable-model-invocation: false'), '顶层写入新值，宿主按顶层键解析');
});

test('启用路径写 false 而不是删键（双向切换不churn diff）', () => {
  const off = setDisableModelInvocation(LF_PLAIN, true).next;
  const on = setDisableModelInvocation(off, false).next;
  assert.equal(on.toString('utf8').includes('disable-model-invocation: false'), true, '启用后键值为 false');
  assert.equal(setDisableModelInvocation(on, false).changed, false, '再启用一次不改字节');
});

test('混排行尾逐行保留：只改目标行，别的行尾风格不动', () => {
  const mixed = Buffer.from('---\r\nname: mixed\ndescription: Mixed endings.\r\n---\nbody\r\n', 'utf8');
  const text = setDisableModelInvocation(mixed, true).next.toString('utf8');
  assert.ok(text.startsWith('---\r\nname: mixed\n'), '开头两行的行尾保持原样');
  assert.ok(text.includes('disable-model-invocation: true\r\n'), '插入行沿用块内首行风格 CRLF');
  assert.ok(text.endsWith('---\nbody\r\n'), '分隔符与正文的行尾保持原样');
});

test('K10 没有 frontmatter 时抛 NO_FRONTMATTER，绝不新建块', () => {
  assert.throws(
    () => setDisableModelInvocation(Buffer.from('# only a heading\n', 'utf8'), true),
    (error) => isNoFrontmatterError(error),
    '无 frontmatter 时抛出 code=NO_FRONTMATTER 的错误',
  );
  assert.throws(
    () => setDisableModelInvocation(Buffer.from([0xef, 0xbb, 0xbf]), 'utf8'),
    (error) => isNoFrontmatterError(error),
    '只有 BOM 的空文件同样抛出 NO_FRONTMATTER',
  );
  assert.throws(
    () => setDisableModelInvocation(Buffer.from('---\nname: x\n', 'utf8'), true),
    (error) => isNoFrontmatterError(error),
    '没有闭合分隔符时抛出 NO_FRONTMATTER',
  );
});

test('分隔符也接受 YAML 的 "..." 终止符', () => {
  const text = ['---', 'name: dots', 'description: Uses the ... terminator.', '...', 'body', ''].join('\n');
  const result = setDisableModelInvocation(Buffer.from(text, 'utf8'), true);
  assert.ok(result.next.toString('utf8').includes('disable-model-invocation: true'), '写入落在 ... 之前');
});

test('stripFrontmatter 返回正文并在无块时原样返回', () => {
  const body = stripFrontmatter(LF_PLAIN.toString('utf8'));
  assert.equal(body, '# body\n', '去掉块之后只剩正文');
  assert.equal(stripFrontmatter('no block here\n'), 'no block here\n', '没有块时原样返回');
  assert.equal(stripFrontmatter(undefined), '', '非字符串输入返回空串');
});

test('frontmatter 里的多字节字符（中文、组合符、emoji）逐字节保留', () => {
  const bytes = Buffer.from('---\nname: x\ndescription: 中文描述 · emoji 🚀 ünïcode\n---\n正文中文\n', 'utf8');
  const result = setDisableModelInvocation(bytes, true);
  const text = result.next.toString('utf8');
  assert.ok(text.includes('description: 中文描述 · emoji 🚀 ünïcode'), '描述行的多字节字符原样保留');
  assert.ok(text.endsWith('---\n正文中文\n'), '正文的多字节字符原样保留');
  assert.equal(text.startsWith('---\nname: x\n'), true, '开头两行字节不变');
});

// ---------------------------------------------------------------------------
// 设计 §3.2.4「读侧契约」逐行验收（KI-2 修复新增的规则表）
// 期望值都与我用宿主自己的 yaml@2.9.1（app.asar 内）跑同一份文本的结果核对过。
// ---------------------------------------------------------------------------

/** 拼一份只含 frontmatter 的 SKILL.md 文本。 */
const doc = (frontmatter) => ['---', ...frontmatter, '---', ''].join('\n');

test('读侧契约·折叠块标量：一行间隔折成空格，n 个空行折成 n 个换行', () => {
  assert.equal(
    parseFrontmatter(doc(['name: x', 'description: >', '  aaa.', '  bbb.'])).description,
    'aaa. bbb.\n',
    '相邻两行折成一个空格',
  );
  assert.equal(
    parseFrontmatter(doc(['name: x', 'description: >', '  aaa.', '', '  bbb.'])).description,
    'aaa.\nbbb.\n',
    '一个空行折成一个换行（空行成段）',
  );
  assert.equal(
    parseFrontmatter(doc(['name: x', 'description: >', '  aaa.', '', '', '  bbb.'])).description,
    'aaa.\n\nbbb.\n',
    '两个空行折成两个换行',
  );
});

test('读侧契约·字面块标量 |：正文行之间保留换行，空行保留为空行', () => {
  assert.equal(
    parseFrontmatter(doc(['name: x', 'description: |', '  aaa.', '', '  bbb.'])).description,
    'aaa.\n\nbbb.\n',
    '字面标量保留换行与空行',
  );
});

test('读侧契约·缩进更深的续行不被折叠，行内额外缩进原样保留', () => {
  assert.equal(
    parseFrontmatter(doc(['name: x', 'description: >', '  aaa.', '    code line', '  bbb.'])).description,
    'aaa.\n  code line\nbbb.\n',
    '深缩进行的换行不被折成空格，且保留自身两个空格缩进',
  );
});

test('读侧契约·公共缩进取非空行的最小缩进，块可以整体更靠右', () => {
  assert.equal(
    parseFrontmatter(doc(['name: x', 'description: >', '    aaa.', '    bbb.'])).description,
    'aaa. bbb.\n',
    '四空格缩进的块整块剥离，不留前导空格',
  );
});

test('读侧契约·chomping：- 去掉末尾换行，缺省 clip 留一个，+ 保留全部', () => {
  assert.equal(
    parseFrontmatter(doc(['name: x', 'description: >-', '  aaa.', '  bbb.'])).description,
    'aaa. bbb.',
    '>- 不留末尾换行',
  );
  assert.equal(
    parseFrontmatter(doc(['name: x', 'description: >', '  aaa.', '  bbb.'])).description,
    'aaa. bbb.\n',
    '缺省 clip 留一个末尾换行',
  );
  assert.equal(
    parseFrontmatter(doc(['name: x', 'description: >+', '  aaa.', ''])).description,
    'aaa.\n\n',
    '>+ 保留正文后的空行',
  );
});

test('读侧契约·标量边界：同级键或闭合分隔符结束块，指示符后允许注释与缩进数字', () => {
  assert.equal(
    parseFrontmatter(doc(['name: x', 'description: >', '  aaa.', 'metadata:', '  slug: y'])).description,
    'aaa.\n',
    '遇到同级键时块结束，后续缩进行不进入描述',
  );
  assert.equal(
    parseFrontmatter(doc(['name: x', 'description: > # trailing comment', '  aaa.'])).description,
    'aaa.\n',
    '指示符后的行尾注释被忽略',
  );
  assert.equal(
    parseFrontmatter(doc(['name: x', 'description: |2', '    aaa.', '  bbb.'])).description,
    '  aaa.\nbbb.\n',
    '缩进数字被接受，正文按实际公共缩进剥离',
  );
});

test('读侧契约·空正文给出空串（扫描层据此把条目当作没有 description）', () => {
  assert.equal(parseFrontmatter(doc(['name: x', 'description: >'])).description, '', '空正文是空串');
  assert.equal(parseFrontmatter(doc(['name: x', 'description: >', 'slug: y'])).description, '', '紧跟同级键也是空串');
});

test('读侧契约·布尔字段同样接受块标量形式', () => {
  const parsed = parseFrontmatter(doc(['name: x', 'description: d', 'disable-model-invocation: >', '  true']));
  assert.equal(parsed.disableModelInvocation, true, '块标量形式的 true 被读成停用');
});

test('接入解耦：写完 disable 位之后，折叠描述的解析值一个字都不变', () => {
  const source = Buffer.from('---\nname: x\ndescription: >\n  aaa.\n  bbb.\n---\nbody\n', 'utf8');
  const before = parseFrontmatter(source.toString('utf8'));
  const rewrite = setDisableModelInvocation(source, true);
  const after = parseFrontmatter(rewrite.next.toString('utf8'));
  assert.equal(after.description, before.description, '写入器（字节手术）不改变读侧结果');
  assert.equal(after.disableModelInvocation, true, '写入的字段读回来是 true');
  assert.equal(rewrite.next.length - source.length, 'disable-model-invocation: true\n'.length, '只多出那一行');
});

test('空值的 disable 行被补成显式布尔，而不是留空', () => {
  const empty = Buffer.from(['---', 'name: x', 'description: d', 'disable-model-invocation:', '---', ''].join('\n'), 'utf8');
  const text = setDisableModelInvocation(empty, true).next.toString('utf8');
  assert.ok(text.includes('disable-model-invocation: true'), '空值行被写成 true');
  assert.equal(parseFrontmatter(text).disableModelInvocation, true, '回读是停用');
});
