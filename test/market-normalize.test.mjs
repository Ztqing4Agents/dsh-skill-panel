/**
 * `lib/market/normalize.js` — raw upstream payloads to the one shape the page renders.
 *
 * Contract: docs/contracts/market.md §7.4 (the field table, the five-item invariant
 * list, and the `saves`/`score`/`tags` rows) and §7.2 (per-source capability table);
 * case ids K31, K78, K82, K86, K149 (the localized-first description chain, §7.4), K150
 * (the four-step author chain and its two spellings, §7.4).
 *
 * U6: ClawHub's catalogue now arrives through the SkillHub mirror, so the ClawHub list and
 * search mappings were deleted and `fromClawhubMirrorItem` took their place (it reuses the
 * SkillHub field reading - the mirror *is* SkillHub's API). Since U7 the detail payload comes
 * from the same mirror, so that mapping is `fromClawhubMirrorDetail(raw, owner)`: the fields
 * are SkillHub's, and only the identity is ClawHub's.
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
  fromClawhubMirrorDetail,
  fromClawhubMirrorItem,
  fromMirrorRow,
  fromSkillhubDetail,
  fromSkillhubListItem,
  isObject,
  marketId,
  marketItem,
  nameIsValid,
  numberOrNull,
  overviewOf,
  mirrorOwnerOf,
  skillhubIconUrl,
  sortByUpdatedDesc,
  summaryTextOf,
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

test('K31 author 回落：publisher → namespace.displayName → namespace.handle（ownerName / owner.displayName 那两格见 K150）', () => {
  const base = { slug: 'x', namespace: { handle: 'h', displayName: 'Handle' } };
  assert.equal(fromSkillhubListItem({ ...base, publisher: { name: 'Pub' } }).author, 'Pub', 'publisher.name 在场 ⇒ 用它');
  assert.equal(fromSkillhubListItem(base).author, 'Handle', '缺 ⇒ namespace.displayName');
  assert.equal(fromSkillhubListItem({ slug: 'x', namespace: { handle: 'h' } }).author, 'h', '再缺 ⇒ namespace.handle');
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

test('K31 ClawHub 详情：字段同 SkillHub，身份用调用方解析出的原生 owner', () => {
  const body = {
    skill: {
      slug: 'design',
      displayName: 'Design',
      summary: 'S',
      iconUrl: 'https://cloudcache.tencent-cloud.com/qcloud/ui/x.png',
      category: 'design',
      stats: { downloads: 9, stars: 4 },
      updatedAt: 1762000000001,
    },
    latestVersion: { version: '1.0.2' },
    // The mirror files a ClawHub skill under *its* namespace, which is not our identity.
    namespace: { handle: 'indiv-design' },
  };
  const fromDetail = fromClawhubMirrorDetail(body, 'ivangdavila');
  assertItemShape(fromDetail, 'clawhub detail');
  assert.equal(fromDetail.id, 'clawhub:ivangdavila:design', 'id 用调用方给的原生 owner 拼');
  assert.equal(fromDetail.owner, 'ivangdavila', '不是镜像的 namespace');
  assert.equal(fromDetail.packageKind, 'files', 'U7 起包形态是清单');
  assert.equal(fromDetail.downloads, 9, 'downloads 取 skill.stats.downloads');
  assert.equal(fromDetail.saves, 4, '收藏数同字段读得到');
  assert.equal(fromDetail.iconUrl, 'https://cloudcache.tencent-cloud.com/qcloud/ui/x.png', '图标直接来自镜像');
  assert.equal(fromDetail.category, 'design', '分类也来自镜像');
  assert.equal(fromDetail.version, '1.0.2', 'version 取 latestVersion.version');

  assert.equal(fromClawhubMirrorDetail(body, null), null, 'owner 缺失 ⇒ null（拼不出身份）');
  assert.equal(fromClawhubMirrorDetail({ skill: 'x' }, 'ake'), null, 'skill 不是对象 ⇒ null');
});

test('K31 已删除的映射与图标构造函数不再导出：两源只有镜像一种形状', async () => {
  const module = await import('../lib/market/normalize.js');
  for (const gone of [
    'fromClawhubListItem', 'fromClawhubSearchItem', 'slugFromUrl',
    'fromClawhubDetail', 'clawhubIconUrl', 'lucideProxyUrl', 'lucideNameOf',
    'CLAWHUB_ICON_PROXY_PATH', 'LUCIDE_PROXY_PATH',
  ]) {
    assert.equal(gone in module, false, `${gone} 已退场（U6 的 clawhub.ai 列表 / U7 的 zip 与图标代理）`);
  }
  assert.equal(typeof module.fromClawhubMirrorItem, 'function', '列表行映射仍在');
  assert.equal(typeof module.fromClawhubMirrorDetail, 'function', '详情映射仍在（detail() 用）');
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

  // `slugFromUrl` retired with the search mapping it existed for (U6): the mirror always
  // carries a slug, so no code path derives one from a URL any more.
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

test('K78 收藏数两端都有，评分只有列表行有（详情页的 score 由适配器补）', () => {
  // U7 moved the detail payload to the mirror too, so `stats.stars` now reaches `saves`.
  // `score` is still absent (the mirror's stats stop at
  // {comments, downloads, installs, stars, versions}); `detail()` fills it from the row it
  // already looked up for the namespace (market.md §7.8 rule 3).
  const detail = fromClawhubMirrorDetail({ skill: { slug: 'design' }, stats: { stars: 5 } }, 'design');
  assert.equal(detail.saves, 5, '详情端点的 stars 就是收藏数');
  assert.equal(detail.score, null, '详情端点没有评分：映射不猜（由适配器补）');

  const mirror = fromClawhubMirrorItem({
    slug: 'design',
    namespace: { handle: 'clawhub_ivangdavila' },
    stars: 5,
    score: 9,
    downloads: 3,
  });
  assert.equal(mirror.saves, 5, '镜像的 stars 就是收藏数（与卡片「收藏 N」同口径）');
  assert.equal(mirror.score, 9, '镜像的 score 是评分原料（客户端 ratingOf 折算）');
  assert.equal(mirror.downloads, 3, '下载数同理');

  for (const item of [detail, mirror]) {
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

  const clawhubDetail = fromClawhubMirrorDetail({
    skill: { slug: 'buzzmark', subCategories: [{ key: 'design', name: 'Design' }, { key: 'api', name: 'API 调用' }] },
  }, 'ake');
  assert.deepEqual(clawhubDetail.tags, ['Design', 'API 调用'], 'ClawHub 详情也取 subCategories[].name 并保留大小写');

  // The mirror's labels ride the SkillHub mapping: `subCategories[].name`, case kept.
  const mirror = fromClawhubMirrorItem({
    slug: 'buzzmark',
    namespace: { handle: 'clawhub_ivangdavila' },
    subCategories: [{ key: 'design', name: '设计' }, { key: 'api', name: 'API 调用' }],
  });
  assert.deepEqual(mirror.tags, ['设计', 'API 调用'], '镜像条目保留大小写（与 SkillHub 同一读取）');
});

test('K82 标签的脏输入：大写、连字符、非字符串元素、去重发生在截断之后', () => {
  const mixed = fromClawhubMirrorDetail({
    skill: {
      slug: 'buzzmark',
      subCategories: [{ name: 'MCP' }, { name: 'Social-Media' }, 42, null, { key: 'no-name' }, { name: '' }, { name: '   ' }, { name: 'LinkedIn' }],
    },
  }, 'ake');
  assert.deepEqual(mixed.tags, ['MCP', 'Social-Media', 'LinkedIn'], '保留大小写、连字符原样、畸形元素逐条丢');

  // Two topics that only differ after the 24-character cut are the same chip once clamped.
  const longA = `${'k'.repeat(30)}-alpha`;
  const longB = `${'k'.repeat(30)}-beta`;
  const collapsed = fromClawhubMirrorDetail({
    skill: { slug: 'x', subCategories: [{ name: longA }, { name: longB }, { name: 'tail' }] },
  }, 'ake');
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

  const clawSkill = fromClawhubMirrorDetail({
    skill: { slug: 'buzzmark', subCategories: [{ name: 'MCP' }, { name: 'Marketing' }] },
  }, 'ake');
  assert.deepEqual(clawSkill.tags, ['MCP', 'Marketing'], '详情取 skill.subCategories，保留大小写');

  const clawTop = fromClawhubMirrorDetail({ skill: { slug: 'y' }, subCategories: [{ name: 'MCP' }] }, 'ake');
  assert.deepEqual(clawTop.tags, ['MCP'], 'skill 上没有 subCategories 时回落响应顶层的');
});

test('K86 镜像条目：owner 取 upstream_owner_login，id / 包型 / 版本 / 图标按契约', () => {
  const raw = {
    slug: 'cad-viewer',
    name: 'CAD Viewer',
    summary: 'A fixture skill.',
    upstream_owner_login: 'pskoett',
    namespace: { handle: 'clawhub_somebody-else' },
    downloads: 50034,
    stars: 12,
    score: 80000,
    iconUrl: 'https://cloudcache.tencent-cloud.com/qcloud/ui/static/x.png',
    category: 'dev-tools',
    subCategories: [{ key: 'design', name: '设计' }],
    version: '1.2.3',
  };
  const item = fromClawhubMirrorItem(raw);
  assertItemShape(item, 'clawhub mirror');
  assert.equal(item.sourceId, 'clawhub', '源是 clawhub（虽然走 SkillHub 的形状）');
  assert.equal(item.owner, 'pskoett', '原生的 upstream_owner_login 优先于 namespace.handle');
  assert.equal(item.id, 'clawhub:pskoett:cad-viewer', 'id 与 marketKeyOf / 图标缓存键逐字相同');
  assert.equal(item.packageKind, 'files', '包型恒 files（U7 起包走镜像的清单）');
  assert.equal(item.downloads, 50034, '下载数不再是 null');
  assert.equal(item.saves, 12, '收藏数来自镜像的 stars');
  assert.equal(item.score, 80000, '评分原料来自镜像');
  assert.equal(item.category, 'dev-tools', '分类不再是 null');
  assert.equal(item.iconUrl, raw.iconUrl, '绝对 https 的图标原样保留');
  assert.deepEqual(item.tags, ['设计'], '标签走 subCategories[].name（保留大小写）');
  assert.equal(item.version, '1.2.3', '像版本的串照留');

  const idLike = fromClawhubMirrorItem({ ...raw, version: 'a1b2c3d4e5' });
  assert.equal(idLike.version, null, '版本 id 形（非数字开头）⇒ null，卡片不印 v a1b2c3…');
  assert.equal(fromClawhubMirrorItem({ ...raw, version: undefined }).version, null, '镜像不给版本 ⇒ null');
  assert.equal(fromClawhubMirrorItem({ ...raw, iconUrl: 'http://x/y.png' }).iconUrl, null, 'http: 图标 ⇒ null');
  assert.equal(fromClawhubMirrorItem({ ...raw, iconUrl: 'lucide:Zap' }).iconUrl, null, 'lucide: 是 clawhub.ai 的形态，镜像条目里不接受');
});

test('K86 身份的兜底与丢条目：空串、clawhub_ 前缀、前缀后为空、无前缀、slug 空', () => {
  assert.equal(mirrorOwnerOf({ upstream_owner_login: '  pskoett  ' }), 'pskoett', '两端空白被修掉');
  assert.equal(mirrorOwnerOf({ upstream_owner_login: '', namespace: { handle: 'clawhub_x' } }), 'x', '空串不是值：继续走兜底');
  assert.equal(mirrorOwnerOf({ namespace: { handle: 'clawhub_guipi888' } }), 'guipi888', '剥掉镜像前缀');
  assert.equal(mirrorOwnerOf({ namespace: { handle: 'clawhub_' } }), null, '前缀后为空 ⇒ 拼不出身份');
  assert.equal(mirrorOwnerOf({ namespace: { handle: 'indiv-guipi' } }), null, '认领过的 namespace 没有前缀，不猜');
  assert.equal(mirrorOwnerOf({ upstream_owner_login: 42 }), null, '非字符串不是身份');
  assert.equal(mirrorOwnerOf(null), null, 'null 不抛');

  const base = { slug: 'cad-viewer', name: 'Cad', downloads: 1 };
  assert.equal(
    fromClawhubMirrorItem({ ...base, upstream_owner_login: '', namespace: { handle: 'clawhub_pskoett' } }).owner,
    'pskoett',
    '空串 + 可剥前缀 ⇒ 仍然得到条目',
  );
  for (const [label, raw] of [
    ['空串 + 前缀后为空', { ...base, upstream_owner_login: '', namespace: { handle: 'clawhub_' } }],
    ['空串 + 无前缀', { ...base, upstream_owner_login: '', namespace: { handle: 'guessable' } }],
    ['slug 为空', { ...base, slug: '', upstream_owner_login: 'pskoett' }],
    ['既无 slug 也无 owner', { slug: '', name: 'x' }],
  ]) {
    assert.equal(fromClawhubMirrorItem(raw), null, `${label} ⇒ 丢掉整条（宁可少一张卡，不多一张装不上的卡）`);
  }
  assert.equal(fromClawhubMirrorItem(null), null, '非对象 ⇒ null，不抛');
});

test('K86 脏数字与 stats 兜底：字符串不隐式转换、非有限数是 null、负数不补 0', () => {
  const base = { slug: 'x', name: 'X', upstream_owner_login: 'o' };
  const strings = fromClawhubMirrorItem({ ...base, downloads: '50034', stars: '12', score: '80000' });
  assert.equal(strings.downloads, null, '数字位置的字符串不隐式转换（只映射，不解释）');
  assert.equal(strings.saves, null, '同上');
  assert.equal(strings.score, null, '同上');

  const infinite = fromClawhubMirrorItem({ ...base, downloads: Number.POSITIVE_INFINITY, stars: Number.NaN });
  assert.equal(infinite.downloads, null, '非有限数 ⇒ null');
  assert.equal(infinite.saves, null, 'NaN ⇒ null');

  const negative = fromClawhubMirrorItem({ ...base, downloads: -3, stars: -2, score: -5 });
  assert.equal(negative.downloads, -3, '负数原样保留（不补 0、不夹到 0：不伪造数字）');
  assert.equal(negative.saves, -2, '同上');
  assert.equal(negative.score, -5, '同上；评分的 4.0–5.0 显示由客户端 ratingOf 决定（score<=0 ⇒ 整段不出现）');

  const statsOnly = fromClawhubMirrorItem({ ...base, stats: { downloads: 99, stars: 7, score: 12345.6 } });
  assert.equal(statsOnly.downloads, 99, '镜像把数字放在 stats 下时同样读得到（与 SkillHub 同形）');
  assert.equal(statsOnly.saves, 7, '收藏数同理');
  assert.equal(statsOnly.score, 12345.6, '评分不截断');
});

test('K95 身份轴：按上游行折叠（community / enterprise → skillhub，clawhub → clawhub），缺或未知 ⇒ 丢条目', async () => {
  const base = { slug: 'dev-god', name: 'Dev God', namespace: { handle: 'ake' }, upstream_owner_login: 'ivangdavila' };

  assert.equal(fromMirrorRow({ ...base, source: 'community' }).sourceId, 'skillhub', 'community 折成 skillhub');
  assert.equal(fromMirrorRow({ ...base, source: 'enterprise' }).sourceId, 'skillhub', 'enterprise 也是 skillhub（站点把它当子筛选）');
  assert.equal(fromMirrorRow({ ...base, source: 'clawhub' }).sourceId, 'clawhub', 'clawhub 折成 clawhub');

  // The owner comes from the row's own shape, not from the scope that asked for it.
  assert.equal(fromMirrorRow({ ...base, source: 'enterprise' }).owner, 'ake', 'SkillHub 行的 owner 是 namespace.handle');
  assert.equal(fromMirrorRow({ ...base, source: 'clawhub' }).owner, 'ivangdavila', 'ClawHub 行的 owner 是 upstream_owner_login');

  for (const raw of [{ ...base }, { ...base, source: '' }, { ...base, source: 'bogus' }, { ...base, source: 42 }, null, 'text']) {
    assert.equal(fromMirrorRow(raw), null, `${JSON.stringify(raw?.source)} ⇒ 丢条目（宁可不显示，也不猜身份）`);
  }

  // Key space: the same skill has the same id no matter which scope asked for it.
  const viaAll = fromMirrorRow({ ...base, source: 'community' });
  const viaHub = fromMirrorRow({ ...base, source: 'community', downloads: 999 });
  assert.equal(viaAll.id, viaHub.id, '同一技能在 all 与 skillhub 两档下键逐字相同');
  assert.equal(viaAll.id, 'skillhub:ake:dev-god', '键是 sourceId:owner:slug');

  // And no fold ever produces an identity the registry does not have (no `all`).
  const { SOURCE_IDS } = await import('../lib/market/query.js');
  for (const row of [{ ...base, source: 'community' }, { ...base, source: 'enterprise' }, { ...base, source: 'clawhub' }]) {
    assert.equal(SOURCE_IDS.has(fromMirrorRow(row).sourceId), true, `${row.source} 折出来的身份必须在白名单里`);
  }

  // M9: a row with no owner anywhere is dropped, not shown as a card that fails on click.
  // `marketId()` would produce `skillhub::<slug>`, which the detail/install routes reject.
  const ownerless = { slug: 'ghost', name: 'Ghost', source: 'community' };
  assert.equal(fromMirrorRow(ownerless), null, '三种 owner 来源全空 ⇒ 丢条目');
  assert.equal(
    fromMirrorRow({ ...ownerless, namespace: { handle: '   ' }, ownerHandle: '', owner: { handle: '' } }),
    null,
    '空白串也不算 owner',
  );
  // …while every shape the upstream really uses still identifies the row.
  const viaNamespace = fromMirrorRow({ ...ownerless, namespace: { handle: 'indiv-ake' } });
  assert.equal(viaNamespace.owner, 'indiv-ake', 'namespace.handle 是第一位');
  assert.equal(viaNamespace.id, 'skillhub:indiv-ake:ghost', 'id 拼得出来');
  const viaOwnerHandle = fromMirrorRow({ ...ownerless, ownerHandle: 'ake' });
  assert.equal(viaOwnerHandle.owner, 'ake', '只有 ownerHandle 也认');
  assert.equal(viaOwnerHandle.id, 'skillhub:ake:ghost', 'id 用 ownerHandle 拼');
  const viaOwner = fromMirrorRow({ ...ownerless, owner: { handle: 'ake-h' } });
  assert.equal(viaOwner.owner, 'ake-h', '只有 owner.handle 也认');
  assert.equal(viaOwner.id, 'skillhub:ake-h:ghost', 'id 用 owner.handle 拼');
  // The ClawHub side has always dropped these; the fold is what makes both sides agree.
  assert.equal(fromMirrorRow({ slug: 'ghost', source: 'clawhub' }), null, 'ClawHub 无 owner 仍丢');
});

test('K95 all 档是混排：一批行折出两种身份，键仍按行而不是按档', async () => {
  const batch = [
    { source: 'community', slug: 'dev-god', name: 'Dev God', namespace: { handle: 'ake' }, downloads: 5 },
    { source: 'enterprise', slug: 'corp-tool', name: 'Corp', namespace: { handle: 'acme' }, downloads: 7 },
    { source: 'clawhub', slug: 'design', name: 'Design', namespace: { handle: 'indiv-guipi' }, upstream_owner_login: 'ivangdavila' },
  ];
  const folded = batch.map((row) => fromMirrorRow(row)).filter(Boolean);
  assert.deepEqual(folded.map((item) => item.sourceId), ['skillhub', 'skillhub', 'clawhub'], '一次 all 里两种身份并存');
  assert.deepEqual(
    folded.map((item) => item.id),
    ['skillhub:ake:dev-god', 'skillhub:acme:corp-tool', 'clawhub:ivangdavila:design'],
    'enterprise 行的 owner 也是 namespace.handle；clawhub 行用原生 owner',
  );
  assert.equal(new Set(folded.map((item) => item.id)).size, 3, '三条互不撞键');

  // The folded identity is what the panel sends to `install` - and the identity whitelist
  // must accept it verbatim, so the enterprise row installs under `skillhub` (not `enterprise`,
  // not `all`). That is the whole chain from a mixed page to `_meta.source`.
  const { parseInstallBody } = await import('../lib/market/query.js');
  const body = parseInstallBody({ source: folded[1].sourceId, owner: folded[1].owner, slug: folded[1].slug });
  assert.deepEqual(body, { sourceId: 'skillhub', owner: 'acme', slug: 'corp-tool', version: null }, '企业版行装成 skillhub:acme:corp-tool');

  // The same rows asked for by a single-scope list produce byte-identical keys.
  const single = batch.slice(0, 2).map((row) => fromMirrorRow({ ...row, source: 'community' }));
  assert.deepEqual(
    single.map((item) => item.id),
    ['skillhub:ake:dev-god', 'skillhub:acme:corp-tool'],
    'all 与 skillhub 两档下，同一条技能键逐字相同（已安装记录不用迁移）',
  );
});

test('K95 折叠守卫的边界：空白 owner / 空 handle 也算「没有 owner」，但别名来源仍能出键', async () => {
  const base = { source: 'community', slug: 'ghost', name: 'Ghost' };

  // Whitespace is not an owner: it trims to nothing and would build `skillhub:   :ghost`,
  // a key nothing downstream can resolve.
  for (const raw of [
    { ...base, namespace: { handle: '   ' } },
    { ...base, namespace: {}, ownerHandle: '  ', owner: { handle: '\t' } },
    { ...base, namespace: {}, ownerHandle: '', owner: { handle: '' } },
    { ...base, namespace: {}, ownerHandle: '   ' },
  ]) {
    assert.equal(fromMirrorRow(raw), null, `${JSON.stringify(raw)} ⇒ 丢条目（空白不算身份）`);
  }

  // The two alias shapes the SkillHub catalogue actually publishes still build keys:
  // `ownerHandle` on bare rows, `owner.handle` on nested ones.
  assert.equal(fromMirrorRow({ ...base, ownerHandle: 'ake' }).id, 'skillhub:ake:ghost', 'ownerHandle ⇒ 键用它');
  assert.equal(
    fromMirrorRow({ ...base, owner: { handle: 'bob' } }).id,
    'skillhub:bob:ghost',
    'owner.handle ⇒ 键用它',
  );
  // A namespace wins over the aliases when both are present (the mirror's own filing).
  assert.equal(
    fromMirrorRow({ ...base, namespace: { handle: 'ns' }, ownerHandle: 'ake' }).id,
    'skillhub:ns:ghost',
    'namespace.handle 优先',
  );

  // The detail normaliser is out of scope on purpose: it is fed a payload the route already
  // addresses by `ref`, and the fold is the only place a list row loses its identity.
  const detail = fromSkillhubDetail({ skill: { slug: 'ghost', displayName: 'Ghost', description: '' } });
  assert.notEqual(detail, null, '同一条数据在详情路径上仍返回对象（守卫不越界）');
  assert.equal(detail.owner, null, '详情路径的 owner 仍为空（这一轮没动它）');
});

test('K95 all 混排里一条坏行不打断整页：其余行照出，末页判定也不受影响', () => {
  const rows = [
    { source: 'community', slug: 'a', name: 'A', namespace: { handle: 'ake' } },
    { source: 'community', slug: 'ghost', name: 'Ghost', namespace: {} },
    { source: 'clawhub', slug: 'b', name: 'B', upstream_owner_login: 'ivangdavila' },
    { source: 'enterprise', slug: 'c', name: 'C', namespace: { handle: 'acme' } },
    { source: 'bogus', slug: 'd', name: 'D', namespace: { handle: 'ake' } },
  ];
  const folded = rows.map((row) => fromMirrorRow(row)).filter(Boolean);
  assert.deepEqual(
    folded.map((entry) => entry.id),
    ['skillhub:ake:a', 'clawhub:ivangdavila:b', 'skillhub:acme:c'],
    '坏行只丢自己，前后行照常出（3 出来、2 丢掉）',
  );
});

/* ------------------------------- K149 · 描述取值链：本地化优先、原文兜底（U23） */

/**
 * The chain this block pins: `summaryTextOf()` resolves `description_zh → summary_zh →
 * description → summary → ''`, and `clampLine(…, SUMMARY_MAX)` runs **after** that choice
 * (`docs/contracts/market.md` §7.4).
 *
 * Two key sets, two chains, one function: a list row spells the pair `description` /
 * `description_zh`, a detail body's `skill` spells it `summary` / `summary_zh` - the
 * upstream's own site resolves `description_zh || description` and `summary_zh ||
 * summary`. Fixing one chain and forgetting the other leaves the detail page blank for the
 * same skill, so every order test below runs both.
 *
 * The payloads are **verbatim captures** (2026-11-21) of
 * `GET /api/skills?keyword=ppt-generator-skill` and
 * `GET /api/v1/skills/ppt-generator-skill?namespace=user_3b34947d`, trimmed to the keys the
 * mapper reads. They are frozen here on purpose: the bug is a *shape* - an empty original
 * slot next to a filled localized one - and this skill is its live specimen (`description`
 * is `''` while `description_zh` carries the whole sentence), which is exactly what made
 * the card draw no description line at all.
 *
 * The three payloads keep their double quotes because they were dumped straight out of the
 * capture: hand-retyping a 155-char Chinese sentence is how a fixture stops being real.
 */
const K149_ZH = "智能 PPT 生成助手。根据用户描述的主题、行业、风格，自动生成漂亮的 PPT 文件。支持所有行业（商务、教育、科技、医疗、金融、创意等），支持中英文双语，支持用户提供的模板或 AI 自动配色。触发词：做PPT、生成PPT、制作幻灯片、make ppt、create presentation、帮我做个PPT。";

/** The real list row whose `description` is empty and whose `description_zh` is full. */
const K149_ROW = {
  "slug": "ppt-generator-skill",
  "name": "ppt-generator-skill",
  "description": "",
  "description_zh": "智能 PPT 生成助手。根据用户描述的主题、行业、风格，自动生成漂亮的 PPT 文件。支持所有行业（商务、教育、科技、医疗、金融、创意等），支持中英文双语，支持用户提供的模板或 AI 自动配色。触发词：做PPT、生成PPT、制作幻灯片、make ppt、create presentation、帮我做个PPT。",
  "category": "office-efficiency",
  "iconUrl": "https://cloudcache.tencent-cloud.com/qcloud/ui/static/other_external_resource/62f73a9b-1aca-4f8e-921d-6102e258c768.png",
  "version": "1.0.2",
  "downloads": 906369,
  "stars": 377,
  "score": 100000,
  "subCategories": [
    {
      "key": "office-ppt",
      "name": "PPT 生成"
    }
  ],
  "updated_at": 1795236444888,
  "source": "community",
  "namespace": {
    "canonicalName": "@user_3b34947d/ppt-generator-skill",
    "displayName": "user_3b34947d",
    "handle": "user_3b34947d",
    "publicSlug": "ppt-generator-skill"
  }
};

/** A real row where **both** slots are filled, with different wording (442 / 77 chars). */
const K149_PRO_ROW = {
  "slug": "ppt-generator-skill-pro",
  "name": "ppt-generator-skill-pro",
  "description": "智能 PPT 生成助手，致力于帮用户生成高质量PPT。触发词：做PPT、生成PPT、制作幻灯片、make ppt、create presentation。",
  "description_zh": "全网最稳定，最不吃模型的智能 PPT 生成助手，致力于帮用户生成高质量PPT。产品亮点：\n【1】 完美解决文本布局溢出，布局错乱问题；\n【2】弱模型友好：不依赖模型生成代码，仅需要生成文本content.json即可输出稳定的PPT；\n【3】PPT布局支持15种不同的页面风格，10多种主题风格，覆盖科技、商务、办公等10几个主题场景；\n【4】用户友好：支持封面、目录、双栏对比、文本款列表、时间轴卡片、数据卡片、图表显示、动态曲线、大型数据卡片、总结页面、状态看板等罕见元素，生成的PPT支持图表二次编辑；\n【5】稳定性显著提高，一般CLAW驱动下均可生成稳定的PPT，亲测有效。\n【6】生成的PPT效果参见github: https://github.com/Yazooliu/ppt-generator-skill/tree/main 欢迎Star\n\\n\n想知道生成的效果如何，非常简单。下载技能包后直接运行 python generate.py content.json即可！",
  "category": "office-efficiency",
  "iconUrl": "https://cloudcache.tencent-cloud.com/qcloud/ui/static/other_external_resource/c5e5faab-b8e1-489d-a489-8b56ffc52c07.png",
  "version": "1.0.3",
  "downloads": 12105,
  "stars": 1,
  "score": 60331.679631123014,
  "subCategories": [
    {
      "key": "office-ppt",
      "name": "PPT 生成"
    }
  ],
  "updated_at": 1795237665823,
  "source": "community",
  "namespace": {
    "canonicalName": "@user_aefa3102/ppt-generator-skill-pro",
    "displayName": "user_aefa3102",
    "handle": "user_aefa3102",
    "publicSlug": "ppt-generator-skill-pro"
  }
};

/** The real detail body of `K149_ROW.slug` - note `contentZhAvailable: false` next to a full `summary_zh`. */
const K149_DETAIL = {
  "contentZhAvailable": false,
  "namespace": {
    "canonicalName": "@user_3b34947d/ppt-generator-skill",
    "displayName": "user_3b34947d",
    "handle": "user_3b34947d",
    "publicSlug": "ppt-generator-skill"
  },
  "latestVersion": {
    "changelog": "Initial release",
    "createdAt": 1775118549508,
    "version": "1.0.2"
  },
  "skill": {
    "slug": "ppt-generator-skill",
    "displayName": "ppt-generator-skill",
    "summary": "",
    "summary_zh": "智能 PPT 生成助手。根据用户描述的主题、行业、风格，自动生成漂亮的 PPT 文件。支持所有行业（商务、教育、科技、医疗、金融、创意等），支持中英文双语，支持用户提供的模板或 AI 自动配色。触发词：做PPT、生成PPT、制作幻灯片、make ppt、create presentation、帮我做个PPT。",
    "category": "office-efficiency",
    "iconUrl": "https://cloudcache.tencent-cloud.com/qcloud/ui/static/other_external_resource/62f73a9b-1aca-4f8e-921d-6102e258c768.png",
    "stats": {
      "comments": 0,
      "downloads": 906369,
      "installs": 1378,
      "stars": 377,
      "versions": 3
    },
    "subCategories": [
      {
        "key": "office-ppt",
        "name": "PPT 生成"
      }
    ],
    "updatedAt": 1795236444888,
    "hasOverview": false,
    "overviewMd": ""
  }
};

test('K149 列表路径：description 为空、description_zh 有值 ⇒ 取中文槽位（真实行 ppt-generator-skill）', () => {
  // The shape that opened this case: the original slot is an empty string, not a missing key.
  assert.equal(K149_ROW.description, '', '夹具前提：原文槽位是空串（本次 bug 的形态）');
  assert.equal(K149_ROW.description_zh, K149_ZH, '夹具前提：中文槽位有整句');

  const item = fromSkillhubListItem(K149_ROW);
  assert.equal(item.summary, K149_ZH, 'summary 逐字取 description_zh（不是空串，也不是 name）');
  assert.equal(item.summary.length > 0, true, '卡片因此画得出描述行');
  assert.equal(typeof item.summary, 'string', '仍是字符串（渲染侧据此决定整行渲染与否）');
});

test('K149 详情路径：skill.summary 为空、summary_zh 有值 ⇒ 取中文槽位（同一条技能的真实详情）', () => {
  assert.equal(K149_DETAIL.skill.summary, '', '夹具前提：详情侧原文槽位也是空串');
  assert.equal(K149_DETAIL.skill.summary_zh, K149_ZH, '夹具前提：详情侧中文槽位有同一句');
  assert.equal('description' in K149_DETAIL.skill, false, '详情侧没有 description* 键（只测列表就漏了详情页）');

  const item = fromSkillhubDetail(K149_DETAIL);
  assert.equal(item.summary, K149_ZH, 'summary 逐字取 summary_zh');
  // The flag sitting next to those two slots is *not* an availability signal: it reads false
  // here while `summary_zh` holds the full sentence, so keying off it would blank the card.
  assert.equal(K149_DETAIL.contentZhAvailable, false, '夹具前提：contentZhAvailable 为 false 而中文槽位是满的');
  assert.notEqual(item.summary, '', '那个标志为 false 时描述照样有值（拿它判可用性会把卡片再打空一次）');
});

test('K149 两条链对同一条技能给出同一句：列表与详情逐字相等', () => {
  const viaList = fromSkillhubListItem(K149_ROW);
  const viaDetail = fromSkillhubDetail(K149_DETAIL);
  assert.equal(viaList.summary, viaDetail.summary, '同一技能、两套键名 ⇒ 同一个 summary');
  assert.equal(viaList.summary, K149_ZH, '两路都是那句中文');
  assert.equal(viaList.id, viaDetail.id, '两条链的身份也一致（同一张卡片）');
});

test('K149 两槽位都有值 ⇒ 取 *_zh（中文优先，本次有意改变的行为）', () => {
  const en = 'The author wrote this sentence in English.';
  const zh = '作者用中文写的同一句话。';

  // List spelling.
  assert.equal(
    fromSkillhubListItem({ slug: 'both', description: en, description_zh: zh, namespace: { handle: 'ake' } }).summary,
    zh,
    '列表：两个槽位都有值 ⇒ 中文槽位',
  );
  // Detail spelling - same rule, different keys.
  assert.equal(
    fromSkillhubDetail({ skill: { slug: 'both', summary: en, summary_zh: zh }, namespace: { handle: 'ake' } }).summary,
    zh,
    '详情：两个槽位都有值 ⇒ 中文槽位',
  );
  // Not "original first, localized as a fallback": the original is present and loses.
  assert.notEqual(
    fromSkillhubListItem({ slug: 'both', description: en, description_zh: zh }).summary,
    en,
    '原文槽位在场也不会被选中（顺序写反这条会红）',
  );

  // Real specimen: both slots filled with different wording, so the order is visible.
  const pro = fromSkillhubListItem(K149_PRO_ROW);
  assert.equal(K149_PRO_ROW.description.length > 0, true, '夹具前提：真实行的原文槽位也有值');
  assert.notEqual(K149_PRO_ROW.description, K149_PRO_ROW.description_zh, '夹具前提：两槽位措辞不同');
  assert.equal(pro.summary.startsWith('全网最稳定'), true, `中文槽位胜出（开头是「${pro.summary.slice(0, 6)}」）`);
  assert.equal(pro.summary.includes('致力于帮用户生成高质量PPT。触发词'), false, '不是原文槽位那一句');
});

test('K149 只有原文槽位有值 ⇒ 取它（两套拼法共用一条链，链尾也认）', () => {
  const fromList = (raw) => fromSkillhubListItem({ slug: 's', namespace: { handle: 'ake' }, ...raw }).summary;

  assert.equal(fromList({ description: '原文仅此一份', description_zh: '' }), '原文仅此一份', '列表：description 有值、description_zh 空 ⇒ 取 description');
  assert.equal(fromList({ description: '原文仅此一份', description_zh: '   ' }), '原文仅此一份', '空白不算值（与 textOrNull 同一条口径）');
  assert.equal(fromList({ description_zh: '', summary_zh: '', description: '  ', summary: '纯原文' }), '纯原文', '链尾的 summary 在列表行上同样认（同一函数、两套拼法）');

  // The detail side's tail: an enterprise row whose `summary_zh` is empty because `summary`
  // itself already reads as Chinese - keeping `summary` in the chain is for this branch.
  assert.equal(
    fromSkillhubDetail({ skill: { slug: 'ent', summary: '提供跨引擎检索，无需 API Key', summary_zh: '' } }).summary,
    '提供跨引擎检索，无需 API Key',
    '详情：summary 有值、summary_zh 空 ⇒ 取 summary',
  );
  assert.equal(
    fromSkillhubDetail({ skill: { slug: 'ent', description: '跨键名兜底', summary_zh: '' } }).summary,
    '跨键名兜底',
    '详情：只有 description 时也认（详情侧没有这个键的真实形态，但链是同一串）',
  );

  // Both slots filled with the same wording (the common enterprise shape): no visible change.
  const same = '提供16个搜索引擎(7国内直连+9国际)跨引擎检索、自动去重与多源交叉验证,无需API Key,附零依赖脚本';
  assert.equal(
    fromSkillhubDetail({ skill: { slug: 'ent', summary: same, summary_zh: same } }).summary,
    same,
    '两槽位逐字相同时取谁都一样（企业行最常见的形态，改序对它们零影响）',
  );
});

test('K149 四个槽位全空 ⇒ 严格空串（不是 null / undefined，卡片据此整段不渲染）', () => {
  const empty = { description: '', description_zh: '', summary: '', summary_zh: '' };
  const viaList = fromSkillhubListItem({ slug: 'bare', namespace: { handle: 'ake' }, ...empty });
  assert.equal(viaList.summary, '', '列表：四槽全空 ⇒ 空串');
  assert.equal(typeof viaList.summary, 'string', '是字符串而不是 null');
  assert.notEqual(viaList.summary, null, '不是 null');
  assert.notEqual(viaList.summary, undefined, '不是 undefined');

  const viaDetail = fromSkillhubDetail({ skill: { slug: 'bare', ...empty } });
  assert.equal(viaDetail.summary, '', '详情：四槽全空 ⇒ 空串');
  assert.equal(typeof viaDetail.summary, 'string', '详情侧同样是字符串');

  const blank = { description: '  ', description_zh: '\t', summary: '\n', summary_zh: '   ' };
  assert.equal(fromSkillhubListItem({ slug: 'bare', namespace: { handle: 'ake' }, ...blank }).summary, '', '只有空白 ⇒ 空串');
});

test('K149 不回落 name / slug：displayName 缺失时名字走 slug，summary 不跟着兜', () => {
  const item = fromSkillhubListItem({ slug: 'a-very-descriptive-skill-name', namespace: { handle: 'ake' } });
  assert.equal(item.displayName, 'a-very-descriptive-skill-name', '名字仍然回落 slug（既有口径不变）');
  assert.equal(item.summary, '', 'summary 不拿 slug 兜（照搬 slug 当描述是编出来的文案）');

  const named = fromSkillhubListItem({ slug: 's', name: '一句话讲完的技能名', namespace: { handle: 'ake' } });
  assert.equal(named.displayName, '一句话讲完的技能名', '有 name 时名字用它');
  assert.equal(named.summary, '', 'name 在场也不进 summary（两者是不同字段）');
});

test('K149 先选后截：中文槽位超长、原文很短 ⇒ 截断落在中文串上（真实行 ppt-generator-skill-pro）', () => {
  // 442 chars of Chinese next to a 77-char original: the budget must be spent on the string
  // the card actually shows. Truncating first and choosing after (or truncating the
  // original slot) would hand back the short 77-char sentence instead.
  assert.equal(K149_PRO_ROW.description_zh.length > SUMMARY_MAX, true, '夹具前提：中文槽位超过 400');
  assert.equal(K149_PRO_ROW.description.length < 100, true, '夹具前提：原文槽位很短');

  const pro = fromSkillhubListItem(K149_PRO_ROW);
  assert.equal(pro.summary.length, SUMMARY_MAX, `截断到 ${SUMMARY_MAX} 字符`);
  assert.equal(pro.summary.endsWith('...'), true, '超长以 ASCII ... 结尾');
  assert.equal(pro.summary.startsWith('全网最稳定'), true, '截的是中文槽位开头那一句');
  assert.equal(pro.summary.includes('\n'), false, '换行先折成空格再算长度');
  assert.equal(pro.summary.length > K149_PRO_ROW.description.length, true, '结果不是那条短原文（先选后截）');
  assert.notEqual(pro.summary, clampLine(K149_PRO_ROW.description, SUMMARY_MAX), '与「只读原文槽位」的结果不同');

  // A marker makes the same point without depending on which real row is at hand: the
  // original is short *and* identifiable, so any leak of it into the result shows up.
  const marked = fromSkillhubListItem({
    slug: 'long-zh',
    description: 'ORIGINAL-MARKER',
    description_zh: '中'.repeat(600),
    namespace: { handle: 'ake' },
  });
  assert.equal(marked.summary.startsWith('中'), true, '取的是中文槽位');
  assert.equal(marked.summary.includes('ORIGINAL-MARKER'), false, '原文槽位没有混进结果');
  assert.equal(marked.summary.length, SUMMARY_MAX, '预算花在中文串上');

  // Boundary: exactly at the budget nothing is cut, one past it something is.
  const atLimit = fromSkillhubListItem({ slug: 'at', description_zh: 'x'.repeat(SUMMARY_MAX) });
  assert.equal(atLimit.summary.length, SUMMARY_MAX, '正好 400 ⇒ 不截断');
  assert.equal(atLimit.summary.endsWith('...'), false, '没有省略号');
  const pastLimit = fromSkillhubListItem({ slug: 'past', description_zh: 'x'.repeat(SUMMARY_MAX + 1) });
  assert.equal(pastLimit.summary.endsWith('...'), true, '401 ⇒ 截断');
  assert.equal(pastLimit.summary.length <= SUMMARY_MAX, true, `永不超 ${SUMMARY_MAX}`);
});

test('K149 相邻字段零回归：真实行的 tags / downloads / saves / score / category / updatedAt / version / 包型 / 键全不动', () => {
  // `MarketItem` carries no `priceKind` (this upstream publishes no price field at all), so
  // the neighbours the summary change could have disturbed are the ones asserted here.
  const item = fromSkillhubListItem(K149_ROW);
  assertItemShape(item, 'K149 列表');
  assert.equal(item.sourceId, 'skillhub', 'sourceId 仍按行折叠');
  assert.equal(item.id, 'skillhub:user_3b34947d:ppt-generator-skill', 'id 三元组不变');
  assert.equal(item.owner, 'user_3b34947d', 'owner 取 namespace.handle');
  assert.equal(item.slug, 'ppt-generator-skill', 'slug 原样');
  assert.equal(item.displayName, 'ppt-generator-skill', 'displayName 取 name');
  assert.equal(item.iconUrl, K149_ROW.iconUrl, 'iconUrl 原样透传');
  assert.equal(item.version, '1.0.2', 'version 取 raw.version');
  assert.equal(item.downloads, 906369, 'downloads 原样');
  assert.equal(item.saves, 377, 'saves 取 stars');
  assert.equal(item.score, 100000, 'score 原样');
  assert.deepEqual(item.tags, ['PPT 生成'], 'tags 取 subCategories[].name');
  assert.equal(item.updatedAt, 1795236444888, 'updated_at 转 epoch 毫秒');
  assert.equal(item.category, 'office-efficiency', 'category 原样');
  assert.equal(item.packageKind, 'files', 'SkillHub 是逐文件包');

  const detail = fromSkillhubDetail(K149_DETAIL);
  assertItemShape(detail, 'K149 详情');
  assert.equal(detail.id, item.id, '详情与列表是同一张卡片的键');
  assert.equal(detail.downloads, 906369, '详情 downloads 取 skill.stats.downloads');
  assert.equal(detail.saves, 377, '详情 saves 取 skill.stats.stars');
  assert.equal(detail.version, '1.0.2', '详情 version 取 latestVersion.version');
  // The detail chain prefers `latestVersion.createdAt` over `skill.updatedAt`, so the value here
  // is the release date, not the row's own update stamp. That order predates the description
  // fix (this case only proves the field is still a filled epoch ms, not which slot won).
  assert.equal(typeof detail.updatedAt, 'number', '详情 updatedAt 仍是 epoch 毫秒');
  assert.notEqual(detail.updatedAt, null, '详情 updatedAt 没有掉成 null');
  assert.deepEqual(detail.tags, ['PPT 生成'], '详情 tags 同形');
  assert.equal(detail.category, 'office-efficiency', '详情 category 同形');
  assert.equal(detail.iconUrl, item.iconUrl, '详情图标与列表同一张');
});

test('K149 summaryTextOf 自身：非对象不抛、恒返回字符串', () => {
  for (const raw of [null, undefined, 'text', 42, true, [], [1, 2]]) {
    assert.equal(summaryTextOf(raw), '', `${JSON.stringify(raw)} ⇒ 空串，不抛`);
  }
  assert.equal(summaryTextOf({}), '', '没有描述键 ⇒ 空串');
  assert.equal(summaryTextOf({ unrelated: 'x' }), '', '无关键不受影响');
  assert.equal(summaryTextOf({ description_zh: '中文' }), '中文', '对象就按链取');
  assert.equal(typeof summaryTextOf({ description: 42, summary: {} }), 'string', '非字符串值被跳过，返回值仍是字符串');
});

/* --------------------------- K150 · 署名四级回落：ownerName / owner.displayName（U24） */

/**
 * The chain this block pins (`docs/contracts/market.md` §7.4): `publisher.name` →
 * **list `ownerName` / detail `raw.owner.displayName`** → `namespace.displayName` →
 * `namespace.handle`, i.e. the order the site itself prints:
 *
 * - list: `publisher?.name || ownerName` (the site's own `skillAuthor`)
 * - detail: `publisher?.name || owner.displayName` (its stats card)
 *
 * Why the second slot had to be added: `publisher` exists on enterprise rows only (77 of
 * 400 sampled - re-counted 2026-11-21: all 77 sit on `source: enterprise` rows, while the
 * 123 community rows and 200 clawhub rows of the same sample carry no `publisher` key at
 * all; "123/400" in an earlier note was that community row count, not a `publisher` count),
 * so every other row was named by `namespace` - which for a clawhub or
 * community row is an account id (`user_07c3fda9`), not a person. Reading `ownerName`
 * first prints the GitHub handle the upstream actually carries (`loonghao`), and the detail
 * side prints the account's display name (`Hal`) instead of the id.
 *
 * The two endpoints name the same author **differently** and that is not a bug to
 * "unify": `fpt-cli` is `loonghao` in the list and `Hal` on the detail page, exactly as the
 * site shows it. Each path therefore reads its own slot - sharing one chain would have to
 * pick one of the two and print something the site never prints.
 *
 * Payloads are verbatim captures (2026-11-21) of
 * `GET /api/skills?keyword=fpt-cli`, `GET /api/skills?page=1&pageSize=100&sortBy=downloads`
 * and the two detail bodies, trimmed to the keys the mapper reads. Double quotes are kept
 * because they were dumped out of the capture.
 */
const K150_ROW = {
  "slug": "fpt-cli",
  "name": "Fpt Cli",
  "ownerName": "loonghao",
  "namespace": {
    "canonicalName": "@user_07c3fda9/fpt-cli",
    "displayName": "user_07c3fda9",
    "handle": "user_07c3fda9",
    "publicSlug": "fpt-cli"
  },
  "category": "professional",
  "iconUrl": "https://cloudcache.tencent-cloud.com/qcloud/ui/static/other_external_resource/e9a58ede-ead5-43fd-9523-d1ba7f1b78cd.png",
  "version": "1.0.4",
  "downloads": 993,
  "stars": 0,
  "score": 100000,
  "subCategories": [
    {
      "key": "pro-industry-research",
      "name": "行业研究"
    }
  ],
  "updated_at": 1795237382690,
  "source": "clawhub",
  "description": "This skill should be used when OpenClaw needs to install, configure, inspect, or operate `fpt-cli` for Autodesk Flow Production Tracking / ShotGrid workflows...",
  "description_zh": "此技能用于在 OpenClaw 需要安装、配置、检查或操作 `fpt-cli` 以完成 Autodesk Flow Production Tracking / ShotGrid 工作流时。"
};

/** `fpt-cli` in detail: no `publisher`, `owner.displayName` is the human name. */
const K150_DETAIL = {
  "contentZhAvailable": true,
  "slug": "fpt-cli",
  "owner": {
    "displayName": "Hal",
    "handle": "user_07c3fda9",
    "image": null
  },
  "namespace": {
    "canonicalName": "@user_07c3fda9/fpt-cli",
    "displayName": "user_07c3fda9",
    "handle": "user_07c3fda9",
    "publicSlug": "fpt-cli"
  },
  "latestVersion": {
    "changelog": "Synced by skillhub pipeline",
    "createdAt": 1777596728275,
    "version": "1.0.4"
  },
  "skill": {
    "slug": "fpt-cli",
    "displayName": "Fpt Cli",
    "summary": "This skill should be used when OpenClaw needs to install, configure, inspect, or operate `fpt-cli` for Autodesk Flow Production Tracking / ShotGrid workflows...",
    "summary_zh": "此技能用于在 OpenClaw 需要安装、配置、检查或操作 `fpt-cli` 以完成 Autodesk Flow Production Tracking / ShotGrid 工作流时。",
    "category": "professional",
    "iconUrl": "https://cloudcache.tencent-cloud.com/qcloud/ui/static/other_external_resource/e9a58ede-ead5-43fd-9523-d1ba7f1b78cd.png",
    "stats": {
      "comments": 0,
      "downloads": 993,
      "installs": 25,
      "stars": 0,
      "versions": 1
    },
    "subCategories": [
      {
        "key": "pro-industry-research",
        "name": "行业研究"
      }
    ],
    "updatedAt": 1795237382690,
    "overviewMd": "",
    "hasOverview": false
  }
};

/** An enterprise row: `publisher.name` is present, so both paths stop at the first slot. */
const K150_PUB_ROW = {
  "slug": "dev-god",
  "name": "编程大神.Skill",
  "ownerName": "u_42bbb65f",
  "publisher": {
    "name": "阿客实验室",
    "logoUrl": null,
    "verified": true,
    "certifiedName": "阿客（北京）科技有限公司",
    "orgId": "org-m3rw44qx"
  },
  "namespace": {
    "canonicalName": "@ake/dev-god",
    "displayName": "ake",
    "handle": "ake",
    "publicSlug": "dev-god"
  },
  "category": "dev-programming",
  "iconUrl": "https://skillhub-1388575217.cos.accelerate.myqcloud.com/skill-icons/uploads/783809/35df42ddf263488b8514c8dc45d1edd7.png",
  "version": "1.2.4",
  "downloads": 12167508,
  "stars": 140,
  "score": 100000,
  "subCategories": [
    {
      "key": "dev-code-gen",
      "name": "代码生成"
    },
    {
      "key": "dev-bug-fix",
      "name": "Bug 修复"
    },
    {
      "key": "dev-backend",
      "name": "后端开发"
    }
  ],
  "updated_at": 1795248527835,
  "source": "enterprise",
  "description": "【全栈能力】编程大神.Skill：面向复杂真实项目的高阶全栈编程助手。不止生成代码，而是从一句目标接手陌生代码库，拆解需求、补齐实现、追到根因、完成重构、联调前后端，并把结果推进到能运行、能验证、能交付。覆盖 Web、后端、脚本、iOS、安卓、鸿蒙 ArkUI、微信小程序及其他技术栈，支持中英文工程、疑难 Bug、跨模块任务和长任务续做；用构建、日志、真实入口、设备或接口证据说明结果。仅问概念时直接回答，要求落地时持续推进到验收或明确阻塞。",
  "description_zh": "【全栈能力】编程大神.Skill：面向复杂真实项目的高阶全栈编程助手。不止生成代码，而是从一句目标接手陌生代码库，拆解需求、补齐实现、追到根因、完成重构、联调前后端，并把结果推进到能运行、能验证、能交付。覆盖 Web、后端、脚本、iOS、安卓、鸿蒙 ArkUI、微信小程序及其他技术栈，支持中英文工程、疑难 Bug、跨模块任务和长任务续做；用构建、日志、真实入口、设备或接口证据说明结果。仅问概念时直接回答，要求落地时持续推进到验收或明确阻塞。"
};

/** The same enterprise skill in detail - `publisher.name` again, `owner.displayName` never reached. */
const K150_PUB_DETAIL = {
  "contentZhAvailable": false,
  "slug": "dev-god",
  "owner": {
    "displayName": "客叔",
    "handle": "u_42bbb65f",
    "image": null
  },
  "publisher": {
    "name": "阿客实验室",
    "logoUrl": null,
    "verified": true,
    "certifiedName": "阿客（北京）科技有限公司",
    "orgId": "org-m3rw44qx"
  },
  "namespace": {
    "canonicalName": "@ake/dev-god",
    "displayName": "ake",
    "handle": "ake",
    "publicSlug": "dev-god"
  },
  "latestVersion": {
    "changelog": "New version",
    "createdAt": 1791925342870,
    "version": "1.2.4"
  },
  "skill": {
    "slug": "dev-god",
    "displayName": "编程大神.Skill",
    "summary": "【全栈能力】编程大神.Skill：面向复杂真实项目的高阶全栈编程助手。不止生成代码，而是从一句目标接手陌生代码库，拆解需求、补齐实现、追到根因、完成重构、联调前后端，并把结果推进到能运行、能验证、能交付。覆盖 Web、后端、脚本、iOS、安卓、鸿蒙 ArkUI、微信小程序及其他技术栈，支持中英文工程、疑难 Bug、跨模块任务和长任务续做；用构建、日志、真实入口、设备或接口证据说明结果。仅问概念时直接回答，要求落地时持续推进到验收或明确阻塞。",
    "summary_zh": "【全栈能力】编程大神.Skill：面向复杂真实项目的高阶全栈编程助手。不止生成代码，而是从一句目标接手陌生代码库，拆解需求、补齐实现、追到根因、完成重构、联调前后端，并把结果推进到能运行、能验证、能交付。覆盖 Web、后端、脚本、iOS、安卓、鸿蒙 ArkUI、微信小程序及其他技术栈，支持中英文工程、疑难 Bug、跨模块任务和长任务续做；用构建、日志、真实入口、设备或接口证据说明结果。仅问概念时直接回答，要求落地时持续推进到验收或明确阻塞。",
    "category": "dev-programming",
    "iconUrl": "https://skillhub-1388575217.cos.accelerate.myqcloud.com/skill-icons/uploads/783809/35df42ddf263488b8514c8dc45d1edd7.png",
    "stats": {
      "comments": 0,
      "downloads": 12167508,
      "installs": 0,
      "stars": 140,
      "versions": 0
    },
    "subCategories": [
      {
        "key": "dev-code-gen",
        "name": "代码生成"
      },
      {
        "key": "dev-bug-fix",
        "name": "Bug 修复"
      },
      {
        "key": "dev-backend",
        "name": "后端开发"
      }
    ],
    "updatedAt": 1795248527835,
    "overviewMd": "",
    "hasOverview": false
  }
};

test('K150 列表：只有 ownerName ⇒ 取它（真实行 fpt-cli：loonghao，不是 user_07c3fda9）', () => {
  assert.equal('publisher' in K150_ROW, false, '夹具前提：clawhub 行没有 publisher');
  assert.equal(K150_ROW.ownerName, 'loonghao', '夹具前提：ownerName 是 GitHub handle');
  assert.notEqual(K150_ROW.ownerName, K150_ROW.namespace.displayName, '夹具前提：两格不同（否则这条测不出东西）');

  const item = fromSkillhubListItem(K150_ROW);
  assert.equal(item.author, 'loonghao', 'author 取 ownerName');
  assert.notEqual(item.author, 'user_07c3fda9', '不再是 namespace 里那个账号 id（修前的样子）');
  assert.equal(item.author, K150_ROW.ownerName, '与上游那一格逐字相等');
});

test('K150 详情：raw.owner.displayName ⇒ 取它（真实 fpt-cli：Hal，修前是 user_07c3fda9）', () => {
  assert.equal('publisher' in K150_DETAIL, false, '夹具前提：详情没有 publisher');
  assert.equal(K150_DETAIL.owner.displayName, 'Hal', '夹具前提：owner.displayName 是人名');
  assert.equal('ownerName' in K150_DETAIL.skill, false, '夹具前提：ownerName 是列表专属键，详情没有');

  const item = fromSkillhubDetail(K150_DETAIL);
  assert.equal(item.author, 'Hal', 'author 取 raw.owner.displayName');
  assert.notEqual(item.author, 'user_07c3fda9', '不再是 namespace 里那个账号 id（修前的样子）');
});

test('K150 publisher.name 压过第二格：enterprise 行列表与详情各一路（真实 dev-god）', () => {
  // publisher wins even though both later slots are filled with something else.
  assert.equal('publisher' in K150_PUB_ROW, true, '夹具前提：企业行带 publisher');
  const viaList = fromSkillhubListItem(K150_PUB_ROW);
  assert.equal(viaList.author, K150_PUB_ROW.publisher.name, '列表：author 取 publisher.name');
  assert.notEqual(viaList.author, K150_PUB_ROW.ownerName, '不是 ownerName（那是账号 id）');
  assert.notEqual(viaList.author, K150_PUB_ROW.namespace.displayName, '也不是 namespace.displayName');

  const viaDetail = fromSkillhubDetail(K150_PUB_DETAIL);
  assert.equal(viaDetail.author, K150_PUB_DETAIL.publisher.name, '详情：author 取 publisher.name');
  assert.notEqual(viaDetail.author, K150_PUB_DETAIL.owner.displayName, '不是 owner.displayName');
  assert.notEqual(viaDetail.author, K150_PUB_DETAIL.namespace.displayName, '也不是 namespace.displayName');

  // A blank publisher is not a name: the chain keeps walking.
  assert.equal(
    fromSkillhubListItem({ slug: 'x', publisher: { name: '   ' }, ownerName: 'loonghao', namespace: { handle: 'ake' } }).author,
    'loonghao',
    'publisher.name 只有空白 ⇒ 落到 ownerName',
  );
  assert.equal(
    fromSkillhubDetail({ skill: { slug: 'x' }, publisher: { name: '' }, owner: { displayName: 'Hal' }, namespace: { handle: 'ake' } }).author,
    'Hal',
    '详情侧同理：空的 publisher.name 不拦住 owner.displayName',
  );
});

test('K150 列表后两格：ownerName 缺 ⇒ namespace.displayName，再缺 ⇒ namespace.handle', () => {
  const of = (raw) => fromSkillhubListItem({ slug: 'x', ...raw }).author;

  assert.equal(of({ ownerName: 'loonghao', namespace: { displayName: 'Ake', handle: 'ake' } }), 'loonghao', 'ownerName 在场 ⇒ 用它');
  assert.equal(of({ namespace: { displayName: 'Ake', handle: 'ake' } }), 'Ake', 'ownerName 缺 ⇒ namespace.displayName');
  assert.equal(of({ namespace: { handle: 'ake' } }), 'ake', 'displayName 也缺 ⇒ namespace.handle');
  assert.equal(of({ ownerName: '   ', namespace: { displayName: 'Ake', handle: 'ake' } }), 'Ake', 'ownerName 只有空白 ⇒ 继续往下走');
  assert.equal(of({ ownerName: 42, namespace: { handle: 'ake' } }), 'ake', 'ownerName 非字符串 ⇒ 跳过');
});

test('K150 详情后两格：owner.displayName 缺 ⇒ namespace.displayName，再缺 ⇒ namespace.handle', () => {
  const of = (raw) => fromSkillhubDetail({ skill: { slug: 'x' }, ...raw }).author;

  assert.equal(of({ owner: { displayName: 'Hal', handle: 'user_07c3fda9' }, namespace: { displayName: 'user_07c3fda9', handle: 'user_07c3fda9' } }), 'Hal', 'owner.displayName 在场 ⇒ 用它');
  assert.equal(of({ namespace: { displayName: 'user_07c3fda9', handle: 'user_07c3fda9' } }), 'user_07c3fda9', 'owner 缺 ⇒ namespace.displayName');
  assert.equal(of({ owner: { displayName: '  ' }, namespace: { displayName: 'Ake', handle: 'ake' } }), 'Ake', 'owner.displayName 只有空白 ⇒ 继续往下走');
  assert.equal(of({ owner: { handle: 'u_1' }, namespace: { handle: 'ake' } }), 'ake', '详情不读 owner.handle（那不是署名格）');
  assert.equal(of({ owner: 'text', namespace: { handle: 'ake' } }), 'ake', 'owner 不是对象 ⇒ 跳过，不抛');
});


test('K150 两路各认自己那一格：列表 ownerName / 详情 owner.displayName 不互串', () => {
  // The same skill, two endpoints: the list prints the GitHub handle, the detail page the
  // account's display name. Both are what the site shows, so both are pinned as they are.
  const viaList = fromSkillhubListItem(K150_ROW);
  const viaDetail = fromSkillhubDetail(K150_DETAIL);
  assert.equal(viaList.author, 'loonghao', '列表：ownerName');
  assert.equal(viaDetail.author, 'Hal', '详情：owner.displayName');
  assert.notEqual(viaList.author, viaDetail.author, '同一技能两处署名本来就不一样（合并成一条链必然改掉其中一个）');

  // Each chain ignores the other's slot, so a payload carrying the wrong key falls through
  // instead of borrowing it.
  assert.equal(
    fromSkillhubListItem({ slug: 'x', owner: { displayName: '列表不该读到这一格' }, namespace: { handle: 'ake' } }).author,
    'ake',
    '列表不读 owner.displayName ⇒ 落到 namespace.handle',
  );
  assert.equal(
    fromSkillhubDetail({ skill: { slug: 'x' }, ownerName: '详情不该读到这一格', namespace: { displayName: 'Ake', handle: 'ake' } }).author,
    'Ake',
    '详情不读顶层 ownerName ⇒ 落到 namespace.displayName',
  );

  // K149's description chain is untouched by this one: it still reads the localized slot on
  // both real payloads of this block.
  assert.equal(viaList.summary, K150_ROW.description_zh, '列表描述仍走 K149 的链（不受署名改动影响）');
  assert.equal(viaDetail.summary, K150_DETAIL.skill.summary_zh, '详情描述仍走 K149 的链（不受署名改动影响）');
  assert.notEqual(viaList.summary, '', '列表描述不是空串');
  assert.notEqual(viaDetail.summary, '', '详情描述不是空串');
});

test('K150 四格全空 ⇒ author === null（不是空串，也不是 undefined）', () => {
  // `null` is the contract: the card drops the clause when there is no name, and an empty
  // string would read as "named with nothing".
  for (const raw of [
    { slug: 'anon' },
    { slug: 'anon', namespace: {} },
    { slug: 'anon', publisher: {} },
    { slug: 'anon', ownerName: '   ', namespace: { displayName: '', handle: '  ' } },
  ]) {
    const item = fromSkillhubListItem(raw);
    assert.equal(item.author, null, `列表 ${JSON.stringify(raw)} ⇒ author 为 null`);
    assert.notEqual(item.author, '', '列表：不是空串');
    assert.equal('author' in item, true, '列表：字段在（缺如为 null，不是缺席）');
    assert.notEqual(item.author, undefined, '列表：不是 undefined');
  }

  for (const raw of [{ skill: { slug: 'anon' } }, { skill: { slug: 'anon' }, owner: {}, namespace: {} }]) {
    const item = fromSkillhubDetail(raw);
    assert.equal(item.author, null, `详情 ${JSON.stringify(raw)} ⇒ author 为 null`);
    assert.notEqual(item.author, '', '详情：不是空串');
    assert.notEqual(item.author, undefined, '详情：不是 undefined');
  }

  // Field set unchanged: `author` keeps its slot in the §7.4 table.
  assert.equal(ITEM_FIELDS.includes('author'), true, '§7.4 的字段表里仍有 author');
  assert.equal(fromSkillhubListItem({ slug: 'anon' }).author, null, '空对象仍然给出 null（不抛）');
});
