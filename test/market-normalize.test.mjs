/**
 * `lib/market/normalize.js` — raw upstream payloads to the one shape the page renders.
 *
 * Contract: docs/contracts/market.md §7.4 (the field table, the five-item invariant
 * list, and the `saves`/`score`/`tags` rows) and §7.2 (per-source capability table);
 * case ids K31, K78, K82.
 *
 * Fixtures here are *shaped like the real responses* but synthetic: the real endpoints
 * change, and a test that quotes a live payload breaks when they do. What must not
 * change is the mapping and the "a missing field is null, never 0 and never ''" rule.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OVERVIEW_MAX,
  SUMMARY_MAX,
  clampBlock,
  clampLine,
  declaredNameOf,
  finiteOrNull,
  fromClawhubDetail,
  fromClawhubListItem,
  fromClawhubSearchItem,
  fromSkillhubDetail,
  fromSkillhubListItem,
  isObject,
  marketId,
  marketItem,
  nameIsValid,
  numberOrNull,
  overviewOf,
  skillhubIconUrl,
  slugFromUrl,
  sortByUpdatedDesc,
  textOrNull,
  timestampOrNull,
} from '../lib/market/normalize.js';

/** Every field a MarketItem must carry, from the §7.4 table. */
const ITEM_FIELDS = [
  'sourceId', 'id', 'owner', 'slug', 'displayName', 'iconUrl', 'summary',
  'author', 'version', 'downloads', 'saves', 'score', 'tags', 'updatedAt', 'category', 'packageKind',
];

/** A real-looking SkillHub icon address (the `/skill-icons/` prefix is the rule). */
const ICON = 'https://cdn.skillhub.cn/skill-icons/ake/dev-god.png';

/**
 * A `SKILL.md` with frontmatter and a body.
 * @param {{name?: string, body?: string}} [options] - overrides.
 * @returns {string} the file text.
 */
function skillText({ name = 'dev-god', body = 'First line.\n\n## Usage\n\n- one\n- two\n' } = {}) {
  return `---\nname: ${name}\ndescription: A fixture skill.\n---\n\n${body}`;
}

/**
 * Assert the §7.4 invariants on one item.
 * @param {object} item - the MarketItem.
 * @param {string} hint - case label.
 * @returns {void}
 */
function assertItemShape(item, hint) {
  assert.equal(typeof item, 'object', `${hint}: 归一化结果是对象`);
  assert.deepEqual(Object.keys(item).sort(), [...ITEM_FIELDS].sort(), `${hint}: 字段集与 §7.4 完全一致`);
  for (const field of ITEM_FIELDS) {
    assert.notEqual(item[field], undefined, `${hint}: ${field} 不是 undefined（缺就是 null）`);
  }
  assert.equal(item.id, `${item.sourceId}:${item.owner ?? ''}:${item.slug ?? ''}`, `${hint}: id 由本地按三元组拼`);
  assert.equal(typeof item.displayName, 'string', `${hint}: displayName 必是字符串（缺则回落 slug 或空串）`);
}

test('K31 SkillHub 列表条目：字段全、缺的下发 null，author 三级回落', () => {
  const item = fromSkillhubListItem({
    slug: 'dev-god',
    name: 'Dev God',
    summary: 'Line one\nline two',
    version: '1.2.4',
    downloads: 1200,
    updated_at: '2026-11-01T10:00:00.000Z',
    category: 'dev-tools',
    iconUrl: ICON,
    namespace: { handle: 'ake', displayName: 'Ake' },
    publisher: { name: 'Ake Studio' },
  });
  assertItemShape(item, 'skillhub list');
  assert.equal(item.sourceId, 'skillhub', 'sourceId 是适配器 id');
  assert.equal(item.id, 'skillhub:ake:dev-god', 'id 三元组');
  assert.equal(item.owner, 'ake', 'owner 取 namespace.handle');
  assert.equal(item.author, 'Ake Studio', 'author 优先 publisher.name');
  assert.equal(item.summary, 'Line one line two', 'summary 折叠成一行');
  assert.equal(item.version, '1.2.4', 'version 取 raw.version');
  assert.equal(item.downloads, 1200, 'downloads 原样');
  assert.equal(item.updatedAt, Date.parse('2026-11-01T10:00:00.000Z'), 'updated_at 转 epoch 毫秒');
  assert.equal(item.category, 'dev-tools', 'category 只有 SkillHub 有');
  assert.equal(item.iconUrl, ICON, 'SkillHub 的 /skill-icons/ 图标原样透传');
  assert.equal(item.packageKind, 'files', 'SkillHub 是逐文件包');
});

test('K31 SkillHub 列表条目缺字段：downloads/version/category 都是 null，不补 0 也不补 latest', () => {
  const item = fromSkillhubListItem({ slug: 'bare', namespace: { handle: 'someone' } });
  assertItemShape(item, 'skillhub 缺字段');
  assert.equal(item.downloads, null, 'downloads 缺 ⇒ null（绝不是 0）');
  assert.equal(item.version, null, 'version 缺 ⇒ null（绝不是 latest）');
  assert.equal(item.category, null, 'category 缺 ⇒ null');
  assert.equal(item.updatedAt, null, 'updatedAt 缺 ⇒ null');
  assert.equal(item.iconUrl, null, 'iconUrl 缺 ⇒ null（回落首字母头像，绝不半张图）');
  assert.equal(item.author, 'someone', 'author 回落到 owner');
  assert.equal(item.displayName, 'bare', 'displayName 回落到 slug');
  assert.equal(item.summary, '', 'summary 是唯一的空串字段（卡片整段不渲染）');
});

test('K31 author 三级回落：publisher → namespace.displayName → owner', () => {
  const base = { slug: 'x', namespace: { handle: 'h', displayName: 'Handle' } };
  assert.equal(fromSkillhubListItem({ ...base, publisher: { name: 'Pub' } }).author, 'Pub', '第一级 publisher.name');
  assert.equal(fromSkillhubListItem(base).author, 'Handle', '第二级 namespace.displayName');
  assert.equal(fromSkillhubListItem({ slug: 'x', namespace: { handle: 'h' } }).author, 'h', '第三级 owner');
});

test('K31 SkillHub 详情：stats/latestVersion 落在正确字段上，形不对的条目返回 null', () => {
  const item = fromSkillhubDetail({
    skill: { slug: 'dev-god', name: 'Dev God', summary: 'S', category: 'dev-tools', iconUrl: ICON },
    stats: { downloads: 42 },
    namespace: { handle: 'ake' },
    latestVersion: { version: '2.0.0' },
  });
  assertItemShape(item, 'skillhub detail');
  assert.equal(item.version, '2.0.0', 'version 取 latestVersion.version');
  assert.equal(item.downloads, 42, 'downloads 取 stats.downloads');
  assert.equal(item.iconUrl, ICON, '详情里的图标也透传（卡片与详情同一张图）');
  for (const raw of [null, {}, { skill: 'x' }, []]) {
    assert.equal(fromSkillhubDetail(raw), null, `${JSON.stringify(raw)} 没有 skill 对象 ⇒ null`);
  }
  assert.equal(fromSkillhubListItem('text'), null, '非对象一律 null（形状不符由适配器报 502）');
});

test('K31 ClawHub 列表与详情：packageKind 是 zip，category 恒 null', () => {
  const fromList = fromClawhubListItem({
    ownerHandle: 'ivangdavila',
    slug: 'design',
    displayName: 'Design',
    summary: 'Design skill',
    latestVersion: { version: '1.0.1' },
    stats: { downloads: 7 },
    updatedAt: 1762000000000,
    publisher: { displayName: 'Ivan' },
  });
  assertItemShape(fromList, 'clawhub list');
  assert.equal(fromList.packageKind, 'zip', 'ClawHub 整包 zip');
  assert.equal(fromList.category, null, 'ClawHub 没有分类表，category 恒 null');
  assert.equal(fromList.iconUrl, null, 'ClawHub 的 icon 是 Lucide token 不是图片地址 ⇒ 恒 null');
  assert.equal(fromList.version, '1.0.1', 'version 取 latestVersion.version');
  assert.equal(fromList.downloads, 7, 'downloads 取 stats.downloads');
  assert.equal(fromList.updatedAt, 1762000000000, '数值时间戳原样');
  assert.equal(fromList.author, 'Ivan', 'author 取 publisher.displayName');

  const fromDetail = fromClawhubDetail({
    skill: { slug: 'design', displayName: 'Design', summary: 'S', stats: { downloads: 9 }, updatedAt: 1762000000001 },
    latestVersion: { version: '1.0.2' },
    owner: { handle: 'ivangdavila', displayName: 'Ivan' },
  });
  assertItemShape(fromDetail, 'clawhub detail');
  assert.equal(fromDetail.id, 'clawhub:ivangdavila:design', '详情也能拼出 id');
  assert.equal(fromDetail.downloads, 9, 'downloads 取 skill.stats.downloads');
  assert.equal(fromDetail.version, '1.0.2', 'version 取 latestVersion.version');
  assert.equal(fromDetail.iconUrl, null, '详情同样 null（两个源不会一半有图一半没图地混排）');
});

test('K31 ClawHub 列表的 tags.latest 只是兜底：像 id 的不当版本号用', () => {
  const withId = fromClawhubListItem({ ownerHandle: 'o', slug: 's', tags: { latest: 'a1b2c3d4e5f6' } });
  assert.equal(withId.version, null, '不以数字开头的 tags.latest 是版本 id，不当版本号');
  const withSemver = fromClawhubListItem({ ownerHandle: 'o', slug: 's', tags: { latest: '2.3.4' } });
  assert.equal(withSemver.version, '2.3.4', '像版本号的 tags.latest 才兜底');
});

test('K31 ClawHub 搜索结果是浅形状：无版本号（恒 null），slug 可从 canonicalUrl 取', () => {
  const item = fromClawhubSearchItem({
    ownerHandle: 'ivangdavila',
    displayName: 'Design',
    canonicalUrl: 'https://clawhub.ai/ivangdavila/design',
    native: { skill: { summary: 'Design skill' } },
    metrics: { updatedAt: 1762000000002 },
    tags: { latest: '9.9.9' },
    latestVersion: { version: '9.9.9' },
  });
  assertItemShape(item, 'clawhub search');
  assert.equal(item.version, null, '搜索端点不给版本号 —— 即便响应里混进 latestVersion 也不采用');
  assert.equal(item.slug, 'design', 'slug 缺时取 canonicalUrl 的最后一段');
  assert.equal(item.summary, 'Design skill', 'summary 取 native.skill.summary');
  assert.equal(item.category, null, '搜索结果没有分类');
  assert.equal(item.iconUrl, null, '搜索结果同样没有图片地址');
  assert.equal(item.downloads, null, '搜索结果没有下载数 ⇒ null');
});

test('K31 skillhubIconUrl 只要求「绝对 https 且能解析」：两个图床都收，其余一律 null', () => {
  // 上一版按 `/skill-icons/` 路径过滤，把 cloudcache 那个图床当成了站点占位图 —— 判断错了：
  // 它是逐技能的真图（覆盖率因此从 ~82% 掉到 ~41%）。现在没有 host / path 白名单，
  // 坏地址交给浏览器的 onError 兜（K52 ③）。详见 market.md §7.4 与决策记录。
  for (const value of [
    ICON,
    // 另一个图床：宽幅 logo（256×64 这类）就来自这里
    'https://cloudcache.tencent-cloud.com/qcloud/ui/static/other_external_resource/a1b2c3.png',
    'https://skillhub-1388575217.cos.accelerate.myqcloud.com/skill-icons/uploads/783809/35df42.png',
    'https://cdn.skillhub.cn/covers/123.png',
    'https://example.com/any/path.jpg?v=2',
  ]) {
    assert.equal(skillhubIconUrl(value), value, `${value} 原样透传`);
  }
  for (const value of [
    'http://cdn.skillhub.cn/skill-icons/a.png',
    'http://cloudcache.tencent-cloud.com/qcloud/ui/static/other_external_resource/a.png',
    '/skill-icons/a.png',
    'skill-icons/a.png',
    'not a url',
    '',
    '   ',
    null,
    undefined,
    42,
    { url: ICON },
  ]) {
    assert.equal(skillhubIconUrl(value), null, `${JSON.stringify(value)} ⇒ null（非 https / 相对 / 空 / 非字符串）`);
  }
});

test('K31 overview 由 SKILL.md 派生：不含 frontmatter 的分隔行与头字段', () => {
  const overview = overviewOf(skillText());
  assert.equal(overview.startsWith('First line.'), true, `overview 从正文第一行开始（实际：${JSON.stringify(overview.slice(0, 20))}）`);
  assert.equal(overview.includes('---'), false, 'overview 里没有 frontmatter 分隔行');
  assert.equal(/\bname:\s/.test(overview), false, 'overview 里没有 name: 之类的头字段');
  assert.equal(overview.includes('## Usage'), true, '正文的标题保留（细节页自己渲染 markdown）');
});

test('K31 overview 正文为空时回落 summary，超长截断到 8000', () => {
  assert.equal(overviewOf('---\nname: x\n---\n', 'fallback text'), 'fallback text', '正文空 ⇒ 回落 summary');
  assert.equal(overviewOf(null, 'fallback'), 'fallback', '非字符串源文本也回落');
  assert.equal(overviewOf(skillText(), 'ignored').includes('ignored'), false, '有正文时不用回落值');
  const long = overviewOf(`---\nname: x\n---\n\n${'a'.repeat(OVERVIEW_MAX + 50)}`);
  assert.equal(long.endsWith('...'), true, '超长以 ... 结尾');
  assert.equal(long.length <= OVERVIEW_MAX + 4, true, '截断后不超过上限（+4 是换行与省略号）');
  assert.equal(OVERVIEW_MAX, 8000, '细节页上限 8000 字符');
});

test('K31 declaredNameOf 与 nameIsValid：声明名不合规也原样给出，判定交给 nameIsValid', () => {
  assert.equal(declaredNameOf(skillText({ name: 'dev-god' })), 'dev-god', '合规声明名读出');
  assert.equal(declaredNameOf(skillText({ name: 'Design' })), 'Design', '不合规声明名原样给出（不改写）');
  assert.equal(declaredNameOf('no frontmatter here'), '', '没有 frontmatter 时是空串');
  assert.equal(declaredNameOf(undefined), '', '非字符串返回空串');
  assert.equal(nameIsValid('dev-god'), true, 'kebab-case 可落目录');
  assert.equal(nameIsValid('Design'), false, '大写不可落目录（宿主加载器同样不收）');
  assert.equal(nameIsValid(''), false, '空名不可落目录');
});

test('K31 工具函数：null 家族、单行折叠、slug 提取', () => {
  assert.equal(isObject({}), true, '普通对象是对象');
  for (const value of [null, [], 'x', 1]) assert.equal(isObject(value), false, `${JSON.stringify(value)} 不是对象`);

  assert.equal(textOrNull('  a  '), 'a', '两端空白被裁');
  assert.equal(textOrNull('   '), null, '纯空白 ⇒ null');
  assert.equal(textOrNull(42), null, '非字符串 ⇒ null');

  assert.equal(numberOrNull(3.9), 3, '小数被截断');
  assert.equal(numberOrNull(Number.NaN), null, 'NaN ⇒ null');
  assert.equal(numberOrNull('12'), null, '字符串数字 ⇒ null（上游该给数字）');

  assert.equal(timestampOrNull('2026-11-01T00:00:00Z'), Date.parse('2026-11-01T00:00:00Z'), 'ISO 串转毫秒');
  assert.equal(timestampOrNull('not a date'), null, '解析不了 ⇒ null');
  assert.equal(timestampOrNull(undefined), null, '缺 ⇒ null');

  assert.equal(clampLine('a\n\nb', SUMMARY_MAX), 'a b', '换行折成空格');
  assert.equal(clampLine('x'.repeat(500), SUMMARY_MAX).length <= SUMMARY_MAX, true, `summary 不超过 ${SUMMARY_MAX}`);
  assert.equal(clampLine('x'.repeat(500), SUMMARY_MAX).endsWith('...'), true, '超长以 ... 结尾');
  assert.equal(clampBlock('a\r\nb', 100), 'a\nb', 'CRLF 归一成 LF');
  assert.equal(clampBlock(null, 100), '', '非字符串 ⇒ 空串');

  assert.equal(slugFromUrl('https://clawhub.ai/ivangdavila/design'), 'design', '取最后一段');
  assert.equal(slugFromUrl('https://clawhub.ai/one/'), 'one', '忽略尾部斜杠');
  assert.equal(slugFromUrl('https://clawhub.ai'), null, '没有路径段 ⇒ null');
  assert.equal(slugFromUrl('/relative/path'), null, '相对路径解析失败 ⇒ null');
  assert.equal(slugFromUrl(''), null, '空串 ⇒ null');
});

test('K31 marketItem 本身兜底：非字符串 displayName 回落 slug，packageKind 只认 zip', () => {
  const item = marketItem({ sourceId: 'clawhub', owner: 'o', slug: 's', displayName: 42, packageKind: 'tar' });
  assertItemShape(item, 'marketItem 兜底');
  assert.equal(item.displayName, 's', 'displayName 非字符串 ⇒ 回落 slug');
  assert.equal(item.packageKind, 'files', '未知包形态回落 files（只有显式 zip 才是 zip）');
  assert.equal(item.iconUrl, null, '非字符串 iconUrl 归一成 null（不会渲染 src="42"）');
  assert.equal(marketItem({ slug: 's', iconUrl: '' }).iconUrl, null, '空串 iconUrl 等同没有');
  assert.equal(marketId('skillhub', null, null), 'skillhub::', '三元组缺值也拼得出 id');
});

test('K31 sortByUpdatedDesc：时间降序、未知排最后、相等时保持原顺序（稳定）', () => {
  const a = { id: 'a', updatedAt: 100 };
  const b = { id: 'b', updatedAt: 300 };
  const c = { id: 'c', updatedAt: null };
  const d = { id: 'd', updatedAt: 100 };
  const sorted = sortByUpdatedDesc([a, c, b, d]);
  assert.deepEqual(sorted.map((item) => item.id), ['b', 'a', 'd', 'c'], '新的在前，未知的最后，相等的保持原序');
  assert.notEqual(sorted, [a, c, b, d], '返回新数组');
  assert.deepEqual([a, c, b, d].map((item) => item.id), ['a', 'c', 'b', 'd'], '不改动入参');
});

test('K78 SkillHub 的 stars/score 两个取数位：raw 优先，stats 兜底；缺失即 null', () => {
  const fromRaw = fromSkillhubListItem({ slug: 'a', namespace: { handle: 'ake' }, stars: 99, score: 95757.41562195931 });
  assert.equal(fromRaw.saves, 99, 'saves 取 raw.stars（整数值照留）');
  assert.equal(fromRaw.score, 95757.41562195931, 'score 原样保留：不截断（截断是解释，不是映射）');

  const fromStats = fromSkillhubListItem({ slug: 'b', namespace: { handle: 'ake' }, stats: { stars: 158, score: 55385 } });
  assert.equal(fromStats.saves, 158, 'saves 回落 stats.stars');
  assert.equal(fromStats.score, 55385, 'score 回落 stats.score');

  const zero = fromSkillhubListItem({ slug: 'c', namespace: { handle: 'ake' }, stars: 0, score: 0 });
  assert.equal(zero.saves, 0, '上游真给 0 就是 0（不是缺值，不补也不吞）');
  assert.equal(zero.score, 0, 'score 的 0 也照留——「0 分不显示」是客户端的判据，不是数据层的');

  const missing = fromSkillhubListItem({ slug: 'd', namespace: { handle: 'ake' } });
  assert.equal(missing.saves, null, '没给 ⇒ null');
  assert.equal(missing.score, null, '没给 ⇒ null');

  const junk = fromSkillhubListItem({ slug: 'e', namespace: { handle: 'ake' }, stars: '99', score: Infinity });
  assert.equal(junk.saves, null, '非数字 ⇒ null');
  assert.equal(junk.score, null, '非有限数 ⇒ null');

  const detail = fromSkillhubDetail({
    skill: { slug: 'dev-god', name: 'Dev God', stars: 7, score: 12345.6 },
    stats: { stars: 99, score: 95757.41562195931 },
  });
  assert.equal(detail.saves, 99, '详情同口径：stats 优先，skill 兜底');
  assert.equal(detail.score, 95757.41562195931, '详情的 score 两处都读得到');
});

test('K78 ClawHub 的五条映射恒 null：saves 与 score 都不猜', () => {
  const items = [
    fromClawhubListItem({ slug: 'design', ownerHandle: 'ivangdavila', stats: { downloads: 3, stars: 5 }, score: 9 }),
    fromClawhubSearchItem({ slug: 'design', ownerHandle: 'ivangdavila', stats: { stars: 5 }, score: 9 }),
    fromClawhubDetail({ skill: { slug: 'design', stars: 5, score: 9 }, stats: { stars: 5, score: 9 } }),
  ];
  for (const item of items) {
    assert.equal(item.saves, null, '这个源报不报 stars 都不收：口径写死在映射里');
    assert.equal(item.score, null, '同上（ClawHub 没有评分）');
    assert.equal('rating' in item, false, 'rating 不是数据层字段（由客户端 ratingOf 算）');
  }
  const listItem = fromSkillhubListItem({ slug: 'a', namespace: { handle: 'ake' }, stars: 1, score: 1 });
  assert.equal('rating' in listItem, false, 'SkillHub 的条目也没有 rating：payload 里只有原料 score');
});

test('K78 finiteOrNull 与 numberOrNull 的分工：一个不截断，一个取整', () => {
  assert.equal(finiteOrNull(95757.41562195931), 95757.41562195931, 'finiteOrNull 原样返回');
  assert.equal(numberOrNull(95757.41562195931), 95757, 'numberOrNull 取整（计数是整数）');
  for (const value of [NaN, Infinity, -Infinity, '3', null, undefined, {}]) {
    assert.equal(finiteOrNull(value), null, `finiteOrNull(${String(value)}) ⇒ null`);
  }
});

test('K82 tags：SkillHub 取 subCategories[].name 且保留大小写', () => {
  const item = fromSkillhubListItem({
    slug: 'dev-god',
    namespace: { handle: 'ake' },
    subCategories: [
      { key: 'code-gen', name: '代码生成' },
      { key: 'bugfix', name: 'Bug 修复' },
      { key: 'api', name: 'API' },
      { key: 'fourth', name: '第四枚不该出现' },
    ],
  });
  assert.deepEqual(item.tags, ['代码生成', 'Bug 修复', 'API'], '取 .name（不是 key）、最多三枚、大小写原样');
  assert.equal(Array.isArray(item.tags), true, 'tags 是数组');

  const byKeyOnly = fromSkillhubListItem({
    slug: 'x',
    namespace: { handle: 'ake' },
    subCategories: [{ key: 'dev-tools' }],
  });
  assert.deepEqual(byKeyOnly.tags, [], '只有 key 没有 name ⇒ 不拿 key 顶替');
});

test('K82 tags：ClawHub 取 topics 前 3、转小写、去重；tags:{latest} 不是标签', () => {
  const item = fromClawhubListItem({
    slug: 'buzzmark',
    ownerHandle: 'ivangdavila',
    topics: ['social-media', 'Marketing', 'linkedin', 'instagram', 'mcp'],
    tags: { latest: '1.4.0' },
  });
  assert.deepEqual(item.tags, ['social-media', 'marketing', 'linkedin'], '前 3 且转小写（不做 title-case）');

  const dedupe = fromClawhubListItem({
    slug: 'x',
    ownerHandle: 'ake',
    topics: ['Marketing', 'marketing', 'MCP'],
  });
  assert.deepEqual(dedupe.tags, ['marketing', 'mcp'], '归一后同值只留一条');

  const versionOnly = fromClawhubListItem({ slug: 'y', ownerHandle: 'ake', tags: { latest: '2.0.0' } });
  assert.deepEqual(versionOnly.tags, [], 'tags 是 {latest: version}，不是标签清单');
});

test('K82 tags 的边界：≤24 字符截断、丢空与畸形、非数组 ⇒ []、恒不是 null', () => {
  const long = 'x'.repeat(40);
  const item = fromSkillhubListItem({
    slug: 'x',
    namespace: { handle: 'ake' },
    subCategories: [{ name: long }],
  });
  assert.equal(item.tags.length, 1, '超长标签仍保留一条');
  assert.equal(item.tags[0].length, 24, '单条截到 24 字符');
  assert.ok(item.tags[0].endsWith('...'), '截断用 ASCII 省略号（与 clampLine 同口径）');

  const junk = fromSkillhubListItem({
    slug: 'x',
    namespace: { handle: 'ake' },
    subCategories: [{ name: '   ' }, { name: 42 }, null, { name: 'ok' }],
  });
  assert.deepEqual(junk.tags, ['ok'], '空串 / 非字符串 / null 元素逐条丢弃');

  for (const raw of [undefined, null, 'nope', {}, 3]) {
    const bare = fromSkillhubListItem({ slug: 'x', namespace: { handle: 'ake' }, subCategories: raw });
    assert.deepEqual(bare.tags, [], `非数组（${String(raw)}）⇒ 空数组`);
    assert.notEqual(bare.tags, null, 'tags 永远不是 null（列表型字段的缺值是 []）');
  }
});

test('K82 tags：详情与列表同形，两源详情的兜底路径都覆盖', () => {
  const skillhubDetail = fromSkillhubDetail({
    skill: { slug: 'dev-god', subCategories: [{ key: 'a', name: '代码生成' }] },
  });
  assert.deepEqual(skillhubDetail.tags, ['代码生成'], 'SkillHub 详情取 skill.subCategories');

  const clawhubDetail = fromClawhubDetail({
    skill: { slug: 'buzzmark', topics: ['Marketing'] },
  });
  assert.deepEqual(clawhubDetail.tags, ['marketing'], 'ClawHub 详情取 skill.topics 并转小写');

  const search = fromClawhubSearchItem({ slug: 'buzzmark', ownerHandle: 'ivangdavila', topics: ['MCP'] });
  assert.deepEqual(search.tags, ['mcp'], '搜索结果也带标签（同一口径）');
});

test('K82 标签的脏输入：大写、连字符、非字符串元素、去重发生在截断之后', () => {
  const mixed = fromClawhubListItem({
    slug: 'buzzmark',
    ownerHandle: 'ake',
    topics: ['MCP', 'Social-Media', 42, null, { name: 'nope' }, '', '   ', 'LinkedIn'],
  });
  assert.deepEqual(mixed.tags, ['mcp', 'social-media', 'linkedin'], '大写转小写、连字符原样、畸形元素逐条丢');

  // Two topics that only differ after the 24-character cut are the same chip once clamped.
  const longA = `${'k'.repeat(30)}-alpha`;
  const longB = `${'k'.repeat(30)}-beta`;
  const collapsed = fromClawhubListItem({ slug: 'x', ownerHandle: 'ake', topics: [longA, longB, 'tail'] });
  assert.equal(collapsed.tags.length, 2, '截断后同值的两条合并成一条');
  assert.equal(collapsed.tags[0].length, 24, '每条仍 ≤24 字符');
  assert.equal(collapsed.tags[1], 'tail', '去重后把后面的好条目补上来');

  // `marketItem` itself never lets a non-array through, whoever calls it.
  assert.deepEqual(marketItem({ sourceId: 'skillhub', owner: 'ake', slug: 'x', tags: null }).tags, [], 'null ⇒ []');
  assert.deepEqual(marketItem({ sourceId: 'skillhub', owner: 'ake', slug: 'x', tags: 'nope' }).tags, [], '非数组 ⇒ []');
  assert.deepEqual(
    marketItem({ sourceId: 'skillhub', owner: 'ake', slug: 'x' }).tags,
    [],
    '没给 tags 的调用方也拿到 []（字段恒存在）',
  );
});

test('K82 详情的两层兜底：skill 上没有就用响应的顶层，空数组不再兜底', () => {
  const fromTop = fromSkillhubDetail({
    skill: { slug: 'dev-god' },
    subCategories: [{ key: 'a', name: '代码生成' }],
  });
  assert.deepEqual(fromTop.tags, ['代码生成'], 'skill.subCategories 缺失时回落 raw.subCategories');

  const emptyStaysEmpty = fromSkillhubDetail({
    skill: { slug: 'dev-god', subCategories: [] },
    subCategories: [{ key: 'a', name: '不该被用到' }],
  });
  assert.deepEqual(emptyStaysEmpty.tags, [], '空数组不是「缺失」：不再回落顶层（?? 的语义）');

  const clawNative = fromClawhubSearchItem({
    slug: 'buzzmark',
    ownerHandle: 'ivangdavila',
    native: { skill: { topics: ['MCP', 'Marketing'] } },
    topics: ['ignored'],
  });
  assert.deepEqual(clawNative.tags, ['mcp', 'marketing'], '搜索结果优先取 native.skill.topics，再转小写');

  const clawTop = fromClawhubSearchItem({ slug: 'y', ownerHandle: 'ake', topics: ['MCP'] });
  assert.deepEqual(clawTop.tags, ['mcp'], '没有 native 时回落 raw.topics');
});
