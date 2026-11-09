/**
 * The ClawHub adapter's two upstreams: catalogue facts come from the SkillHub mirror,
 * package facts come from `clawhub.ai` - and never the other way round.
 *
 * Contract: docs/contracts/market.md §7.8 (the hybrid adapter, its four hard rules, and
 * the overlay rule for a detail view) and §7.2 (per-method origins); case id K88.
 *
 * Why this file exists separately from `market-sources.test.mjs`: those cases assert what a
 * *page* looks like, these assert which host was called and when. The two failure modes they
 * guard are both silent - a package taken from the mirror installs a skeleton and records a
 * success, and a detail view that skips the overlay shows a download count 290 times smaller
 * than the card the user just clicked.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { clawhubSource, resetIconCache } from '../lib/market/sources/clawhub.js';
import { buildZip } from './helpers/zip.mjs';

/** A mirror row for one skill, as the live endpoint publishes it. */
const mirrorRow = (slug, owner, extra = {}) => ({
  slug,
  name: slug,
  namespace: { handle: `clawhub_${owner}` },
  upstream_owner_login: owner,
  summary: 'A fixture skill.',
  downloads: 50034,
  stars: 12,
  score: 80000,
  iconUrl: 'https://cloudcache.tencent-cloud.com/qcloud/ui/static/x.png',
  category: 'dev-tools',
  subCategories: [{ key: 'a', name: '开发工具' }],
  ...extra,
});

/** A `clawhub.ai` detail body for one skill. */
const detailBody = (slug, owner, extra = {}) => ({
  skill: {
    slug,
    displayName: slug,
    summary: 'From clouhub.ai.',
    description: `---\nname: ${slug}\n---\n\nBody text.\n`,
    stats: { downloads: 4347 },
    updatedAt: 1762000000000,
    ...extra,
  },
  latestVersion: { version: '1.2.3' },
  owner: { handle: owner },
});

/**
 * A fake upstream pair that logs every request and can fail selected ones.
 *
 * `clawhub.ai`'s download endpoint answers a tiny, *invalid* zip on purpose: these cases are
 * about which host was called, not about package parsing (that is `market-clawhub-icon`'s
 * and `market-install`'s job), and an empty buffer still proves the call happened.
 * @param {{rows?: object[], detail?: object, detailFails?: boolean, mirrorFails?: boolean,
 *   downloadFails?: boolean, rowsFor?: (slug: string) => object[]}} [options] - behaviour.
 * @returns {{io: object, calls: {host: string, path: string, query: string}[],
 *   hosts: (name: string) => number}} the client and its log.
 */
function fakeIo(options = {}) {
  const calls = [];
  const rowsFor = options.rowsFor ?? ((slug) => options.rows ?? [mirrorRow(slug, 'pskoett')]);
  const io = {
    /**
     * Answer one GET.
     * @param {URL|string} url - request URL.
     * @returns {Promise<object>} parsed body.
     */
    async getJson(url) {
      const parsed = new URL(String(url));
      calls.push({ host: parsed.host, path: parsed.pathname, query: parsed.search });
      if (parsed.host === 'api.skillhub.cn') {
        if (options.mirrorFails === true) throw new Error('mirror down');
        const keyword = parsed.searchParams.get('keyword') ?? '';
        return { data: { skills: rowsFor(keyword), total: 63381 } };
      }
      if (parsed.pathname === '/api/v1/skills') {
        return { items: [], nextCursor: null };
      }
      if (options.detailFails === true) throw new Error('detail down');
      return options.detail ?? detailBody(decodeURIComponent(parsed.pathname.split('/').at(-1)), 'pskoett');
    },
    /**
     * Answer one GET of bytes.
     * @param {URL|string} url - request URL.
     * @returns {Promise<{body: Buffer}>} an (invalid on purpose) archive buffer.
     */
    async getBytes(url) {
      const parsed = new URL(String(url));
      calls.push({ host: parsed.host, path: parsed.pathname, query: parsed.search });
      if (options.downloadFails === true) throw new Error('download down');
      return { body: Buffer.alloc(0) };
    },
  };
  return {
    io,
    calls,
    hosts: (name) => calls.filter((call) => call.host === name).length,
  };
}

/** The query the route hands the adapter. */
const QUERY = {
  sourceId: 'clawhub', sort: 'recommended', keyword: '', category: null, limit: 4, cursor: null,
};

/** A reference, the shape `market/detail` and `market/install` build. */
const REF = { owner: 'pskoett', slug: 'cad-viewer', version: null };

test('K88 list / search 只打镜像：零次 clawhub.ai 调用', async () => {
  resetIconCache();
  const listed = fakeIo();
  await clawhubSource.list(QUERY, listed.io);
  assert.equal(listed.hosts('api.skillhub.cn'), 1, 'list 一次镜像请求');
  assert.equal(listed.hosts('clawhub.ai'), 0, 'list 一次都不打 clawhub.ai');

  const searched = fakeIo();
  await clawhubSource.search({ ...QUERY, keyword: 'cad' }, searched.io);
  assert.equal(searched.hosts('api.skillhub.cn'), 1, 'search 一次镜像请求');
  assert.equal(searched.hosts('clawhub.ai'), 0, 'search 同样不碰 clawhub.ai');
});

test('K88 plan 的每一次调用都只打 clawhub.ai（镜像的包不完整）', async () => {
  const run = fakeIo({ downloadFails: true });
  await assert.rejects(() => clawhubSource.plan(REF, run.io), /download down/, '下载失败照实向上抛');
  assert.equal(run.hosts('api.skillhub.cn'), 0, '安装包里不许出现镜像主机');
  assert.deepEqual(
    run.calls.map((call) => call.path),
    ['/api/v1/skills/cad-viewer', '/api/v1/download'],
    '两次调用都是 clawhub.ai 的路径',
  );
});

test('K88 plan 不信 ref.version：恒向 clawhub.ai 解析真实版本', async () => {
  const pinned = fakeIo({ downloadFails: true });
  await assert.rejects(() => clawhubSource.plan({ ...REF, version: '9.9.9' }, pinned.io));
  assert.equal(pinned.hosts('clawhub.ai'), 2, '即便调用方带了版本，仍然先问一次详情');
  assert.equal(pinned.calls[0].path, '/api/v1/skills/cad-viewer', '解析版本的那次查询');
  assert.equal(pinned.calls[1].path, '/api/v1/download', '然后才下载');

  // The version that reaches the download is the one clawhub.ai reported, not the mirror's.
  const downloaded = fakeIo({ detail: detailBody('cad-viewer', 'pskoett', {}) });
  downloaded.io.getBytes = async (url) => {
    const parsed = new URL(String(url));
    downloaded.calls.push({ host: parsed.host, path: parsed.pathname, query: parsed.search });
    return { body: Buffer.alloc(0) };
  };
  await assert.rejects(() => clawhubSource.plan({ ...REF, version: 'deadbeef00' }, downloaded.io));
  const download = new URL(`https://clawhub.ai${downloaded.calls.at(-1).path}${downloaded.calls.at(-1).query}`);
  assert.equal(download.searchParams.get('version'), '1.2.3', '下载用的是 clawhub.ai 的 latestVersion');
  assert.equal(download.searchParams.get('ownerHandle'), 'pskoett', 'owner 也是原生的那个');
});

test('K88 detail 的第 2 个请求是镜像的列表查询（不是它的 detail 端点）', async () => {
  const run = fakeIo();
  await clawhubSource.detail(REF, run.io).catch(() => {});
  assert.equal(run.calls[0].host, 'clawhub.ai', '第 1 个请求：详情仍在 clawhub.ai');
  assert.equal(run.calls[1].host, 'api.skillhub.cn', '第 2 个请求：镜像');
  assert.equal(run.calls[1].path, '/api/skills', '是列表端点（镜像的 detail 端点在 namespace 上会漏 5%）');
  const query = new URL(`https://api.skillhub.cn${run.calls[1].path}${run.calls[1].query}`);
  assert.equal(query.searchParams.get('keyword'), 'cad-viewer', '按 slug 搜');
  assert.equal(query.searchParams.get('pageSize'), '20', '只看一页 20 条');
  assert.equal(query.searchParams.get('source'), 'clawhub', '只要 ClawHub 目录');
  assert.equal(query.searchParams.get('namespace'), null, '绝不按 namespace 猜');
});

test('K88 detail 用镜像的数字覆盖五个字段（卡片与详情同数），其余字段仍来自 clawhub.ai', async () => {
  const run = fakeIo({ rows: [mirrorRow('cad-viewer', 'pskoett')] });
  // The package step is failed on purpose: it is a separate, already-covered path
  // (`filesComplete: false` never takes the view down) and it would otherwise hide the item.
  void run;
  const view = fakeIo({
    rows: [mirrorRow('cad-viewer', 'pskoett')],
    downloadFails: true,
  });
  const payload = await clawhubSource.detail(REF, view.io);
  assert.equal(payload.item.downloads, 50034, '下载数换成镜像口径（不是详情端点的 4,347）');
  assert.equal(payload.item.saves, 12, '收藏数来自镜像的 stars（之前恒 null）');
  assert.equal(payload.item.score, 80000, '评分原料来自镜像（之前恒 null）');
  assert.equal(payload.item.category, 'dev-tools', '分类来自镜像（之前恒 null）');
  assert.equal(payload.item.iconUrl, 'https://cloudcache.tencent-cloud.com/qcloud/ui/static/x.png', '图标也来自镜像');
  assert.deepEqual(
    payload.item.tags,
    [],
    '标签不在这 5 个覆盖字段里：详情端点没有 topics 就是空数组（卡片那侧的标签是镜像的 subCategories）',
  );
  assert.equal(payload.item.version, '1.2.3', '版本仍来自 clawhub.ai（镜像的不上详情）');
  assert.equal(payload.filesComplete, false, '包没下来只让文件段不完整，不抛');
  assert.equal(payload.overview.includes('Body text.'), true, 'overview 仍是 SKILL.md 正文');
});

test('K88 双匹配：同名不同 owner 的两条并存时只认 owner 相同的那条', async () => {
  const rows = [
    mirrorRow('find-skills', 'robin', { downloads: 1, stars: 1, score: 1 }),
    mirrorRow('find-skills', 'guipi888', { downloads: 999, stars: 88, score: 90000 }),
  ];
  const run = fakeIo({ rowsFor: () => rows, downloadFails: true });
  const payload = await clawhubSource.detail({ owner: 'guipi888', slug: 'find-skills', version: null }, run.io);
  assert.equal(payload.item.downloads, 999, '取 owner 匹配的那一条');
  assert.equal(payload.item.saves, 88, '收藏数同样只认自己那条');

  const other = fakeIo({ rowsFor: () => rows, downloadFails: true });
  const first = await clawhubSource.detail({ owner: 'robin', slug: 'find-skills', version: null }, other.io);
  assert.equal(first.item.downloads, 1, '另一个 owner 拿到另一条（slug 单独不唯一）');
});

test('K88 零命中、镜像失败、镜像缺字段：一律保留 clawhub.ai 的原值且不抛', async () => {
  for (const [label, behaviour] of [
    ['零命中', { rowsFor: () => [] }],
    ['镜像抛错', { mirrorFails: true }],
    ['命中但字段全缺', { rows: [{ slug: 'cad-viewer', upstream_owner_login: 'pskoett' }] }],
  ]) {
    const run = fakeIo({ ...behaviour, downloadFails: true });
    const payload = await clawhubSource.detail(REF, run.io);
    assert.equal(payload.item.downloads, 4347, `${label}：保留下载原值，不覆盖成 null`);
    assert.equal(payload.item.saves, null, `${label}：没有收藏数就仍是 null`);
    assert.equal(payload.item.iconUrl, null, `${label}：没有图标仍是 null`);
    assert.equal(payload.item.category, null, `${label}：没有分类仍是 null`);
  }
});

test('K88 detail 的请求数恒为 3（详情 + 镜像列表 + zip），镜像那次失败也不重试', async () => {
  const run = fakeIo({ mirrorFails: true, downloadFails: true });
  await clawhubSource.detail(REF, run.io);
  assert.equal(run.hosts('clawhub.ai'), 2, '详情 + zip');
  assert.equal(run.hosts('api.skillhub.cn'), 1, '镜像只问一次，失败不重试、不放大小 pageSize');
});

test('K88 plan 的文件数来自 clawhub.ai 的 zip 条目（镜像那侧一个文件都不参与）', async () => {
  // The mirror is famous for packages with zero files. `plan` never asks it, so the file
  // list must be the archive's own entries - not 0, and not the two-file skeleton either.
  const zip = buildZip([
    { path: 'SKILL.md', data: '---\nname: cad-viewer\n---\n\nBody.\n' },
    { path: 'guide.md', data: 'guide' },
    { path: '_meta.json', data: '{"slug":"cad-viewer","version":"1.2.3"}' },
  ]);
  const run = fakeIo();
  run.io.getBytes = async (url) => {
    const parsed = new URL(String(url));
    run.calls.push({ host: parsed.host, path: parsed.pathname, query: parsed.search });
    return { body: zip };
  };
  const built = await clawhubSource.plan(REF, run.io);
  assert.equal(run.hosts('api.skillhub.cn'), 0, '安装包这条路上零次镜像调用');
  assert.deepEqual(
    run.calls.map((call) => call.host),
    ['clawhub.ai', 'clawhub.ai'],
    '版本来自 clawhub.ai 的详情，包也来自 clawhub.ai',
  );
  assert.deepEqual(
    built.files.map((file) => file.path).sort(),
    ['SKILL.md', '_meta.json', 'guide.md'],
    '文件清单 = zip 的条目（3 条，不是镜像的 0 条）',
  );
  assert.equal(built.version, '1.2.3', '计划里的版本是 clawhub.ai 解析出来的');
  assert.deepEqual(built.meta, { slug: 'cad-viewer', version: '1.2.3' }, '包内的 _meta.json 也读出来了');
});

test('K88 覆盖的两条边：镜像把数字放在 stats 下照样覆盖；镜像答坏载荷不覆盖也不抛', async () => {
  // A mirror row with `stats.*` only (SkillHub's other shape) must still overlay, and a
  // malformed mirror body must fall back to what clawhub.ai already said.
  const withStats = fakeIo({
    rows: [{
      slug: 'cad-viewer',
      upstream_owner_login: 'pskoett',
      stats: { downloads: 777, stars: 7, score: 70000 },
      category: 'dev-tools',
    }],
    downloadFails: true,
  });
  const overlaid = await clawhubSource.detail(REF, withStats.io);
  assert.equal(overlaid.item.downloads, 777, 'stats.downloads 也被读到');
  assert.equal(overlaid.item.saves, 7, 'stats.stars 也被读到');
  assert.equal(overlaid.item.score, 70000, 'stats.score 也被读到');

  const malformed = fakeIo({ downloadFails: true });
  malformed.io.getJson = async (url) => {
    const parsed = new URL(String(url));
    malformed.calls.push({ host: parsed.host, path: parsed.pathname, query: parsed.search });
    if (parsed.host === 'api.skillhub.cn') return { data: { skills: 'not-an-array' } };
    return detailBody('cad-viewer', 'pskoett');
  };
  const kept = await clawhubSource.detail(REF, malformed.io);
  assert.equal(kept.item.downloads, 4347, '镜像答坏形状 ⇒ 保留 clawhub.ai 的原值');
  assert.equal(kept.item.saves, null, '没覆盖就是原来的 null（不补 0）');
});

test('K88 镜像的「带错误码的失败」也被吞掉：E_SOURCE_TIMEOUT 只让覆盖不发生，不拖垮详情', async () => {
  // The mirror overlay is decoration: even a classified upstream error (the shape the real
  // client throws) must end as "no override", not as a failed detail view.
  const run = fakeIo({ downloadFails: true });
  run.io.getJson = async (url) => {
    const parsed = new URL(String(url));
    run.calls.push({ host: parsed.host, path: parsed.pathname, query: parsed.search });
    if (parsed.host === 'api.skillhub.cn') {
      throw Object.assign(new Error('mirror timed out'), { code: 'E_SOURCE_TIMEOUT' });
    }
    return detailBody('cad-viewer', 'pskoett');
  };
  const payload = await clawhubSource.detail(REF, run.io);
  assert.equal(payload.item.downloads, 4347, '镜像超时 ⇒ 保留下载原值');
  assert.equal(payload.item.saves, null, '不会被伪造成 0');
  assert.equal(run.hosts('api.skillhub.cn'), 1, '失败不重试');
});
