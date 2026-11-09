/**
 * ClawHub icons: where they come from, and the batch that fills in an installed row.
 *
 * Contract: docs/contracts/market.md §7.4 (the `iconUrl` column: an absolute `https`
 * address or `null`), §7.5 (the icon pipeline) and §7.8 (the single-origin mirror);
 * docs/contracts/routes.md §3.7.1 route #7 (`market/icons`); case id K57.
 *
 * Two properties make the pipeline affordable, and both are asserted here: a page of cards
 * costs **exactly one** upstream request, and the batch that resolves icons is bounded -
 * 24 refs, six at a time, six seconds for the batch, five per lookup.
 *
 * The catalogue row carries a real `iconUrl`, so browsing asks for nothing extra. The batch
 * is what an **installed row** needs: `_meta.json` holds an identity and nothing else, so
 * its icon and upstream title can only come from one lookup per skill.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { clawhubSource, resetIconCache } from '../lib/market/sources/clawhub.js';

/** One mirror list row, ClawHub-shaped (`upstream_owner_login` present). */
const row = (slug, extra = {}) => ({
  slug,
  name: slug,
  namespace: { handle: `clawhub_ivangdavila` },
  upstream_owner_login: 'ivangdavila',
  summary: 'A fixture skill.',
  downloads: 1,
  stars: 2,
  score: 3,
  category: 'dev-tools',
  ...extra,
});

/**
 * A fake mirror that answers the list endpoint (which is also the lookup endpoint).
 * @param {{rows?: object[], byKeyword?: Record<string, object[]>, failSlugs?: string[],
 *   delayMs?: number, icons?: Record<string, string|null>,
 *   names?: Record<string, string|null>}} [options] - behaviour.
 * @returns {{io: object, calls: string[], peak: () => number}} the client and its log.
 */
function fakeIo(options = {}) {
  const calls = [];
  const byKeyword = options.byKeyword ?? {};
  const failSlugs = new Set(options.failSlugs ?? []);
  const icons = options.icons ?? {};
  const names = options.names ?? {};
  let live = 0;
  let peak = 0;
  const io = {
    /**
     * Answer one GET.
     * @param {URL|string} url - request URL.
     * @returns {Promise<object>} parsed body.
     */
    async getJson(url) {
      const parsed = new URL(String(url));
      calls.push(parsed.pathname + (parsed.search || ''));
      live += 1;
      peak = Math.max(peak, live);
      try {
        if (options.delayMs !== undefined) await new Promise((resolve) => { setTimeout(resolve, options.delayMs); });
        const keyword = parsed.searchParams.get('keyword') ?? '';
        if (failSlugs.has(keyword)) throw new Error(`lookup ${keyword} down`);
        const rows = byKeyword[keyword]
          ?? options.rows
          ?? [row(keyword || 'one', { iconUrl: `https://cdn.example.com/${keyword || 'one'}.png` })];
        return {
          data: {
            total: rows.length,
            skills: rows.map((entry) => ({
              ...entry,
              ...(Object.hasOwn(icons, entry.slug) ? { iconUrl: icons[entry.slug] } : {}),
              ...(Object.hasOwn(names, entry.slug) ? { name: names[entry.slug] } : {}),
            })),
          },
        };
      } finally {
        live -= 1;
      }
    },
    /**
     * The mirror never answers bytes in these cases.
     * @returns {Promise<never>} always throws.
     */
    async getBytes() {
      throw new Error('the mirror is not a package host in these cases');
    },
  };
  return { io, calls, peak: () => peak };
}

/** A normalised list query, the shape the route hands the adapter. */
const QUERY = {
  sourceId: 'clawhub', sort: 'recommended', keyword: '', category: null, limit: 4, cursor: null,
};

test('K57 图标只剩两形态：绝对 https 上屏，其余 null（工厂统一过 skillhubIconUrl）', async () => {
  const { io } = fakeIo({
    rows: [
      row('plain', { iconUrl: 'https://cdn.example.com/a.png' }),
      row('insecure', { iconUrl: 'http://cdn.example.com/a.png' }),
      row('relative', { iconUrl: '/skill-icons/x.png' }),
      row('none'),
    ],
  });
  const resolved = await clawhubSource.icons(
    [{ owner: 'ivangdavila', slug: 'plain' }, { owner: 'ivangdavila', slug: 'insecure' },
      { owner: 'ivangdavila', slug: 'relative' }, { owner: 'ivangdavila', slug: 'none' }],
    io,
  );
  assert.equal(resolved.icons['clawhub:ivangdavila:plain'], 'https://cdn.example.com/a.png', '绝对 https 原样');
  assert.equal(resolved.icons['clawhub:ivangdavila:insecure'], null, 'http: 不是图片地址');
  assert.equal(resolved.icons['clawhub:ivangdavila:relative'], null, '相对路径不是图片地址');
  assert.equal(resolved.icons['clawhub:ivangdavila:none'], null, '没有图标 ⇒ null（卡片留字母头像）');
});

test('K57 列表与搜索**零额外请求**：图标随镜像条目一起到，一条都不多问', async () => {
  resetIconCache();
  const list = fakeIo({
    rows: [row('one', { iconUrl: 'https://cloudcache.tencent-cloud.com/qcloud/ui/x.png' }), row('two')],
  });
  const page = await clawhubSource.list({ ...QUERY, limit: 10 }, list.io);
  assert.equal(page.items.length, 2, '两条都回来了');
  assert.equal(
    page.items[0].iconUrl,
    'https://cloudcache.tencent-cloud.com/qcloud/ui/x.png',
    '镜像给的绝对 https 图原样上屏',
  );
  assert.equal(page.items[1].iconUrl, null, '没有图标 ⇒ null（已安装行才需要批量补）');
  assert.deepEqual(
    list.calls,
    ['/api/skills?page=1&pageSize=10&source=clawhub&sortBy=score&order=desc'],
    '列表只发一次请求',
  );
  assert.equal(list.peak(), 1, '一条额外请求都没有在飞');

  const search = fakeIo({ rows: [row('one', { iconUrl: 'https://cdn.example.com/one.png' })] });
  const found = await clawhubSource.search({ ...QUERY, keyword: 'one' }, search.io);
  assert.equal(found.items[0].iconUrl, 'https://cdn.example.com/one.png', '搜索结果同样自带图标');
  assert.equal(search.calls.length, 1, '搜索也是一次请求（同一个镜像端点）');
});

test('K57 批量补齐：并发 ≤6、按请求顺序返回、单条失败只 null、整批不抛', async () => {
  resetIconCache();
  const refs = Array.from({ length: 9 }, (unused, index) => ({ owner: 'ivangdavila', slug: `s${index}` }));
  const run = fakeIo({ delayMs: 5, failSlugs: ['s4'] });
  const result = await clawhubSource.icons(refs, run.io);
  assert.equal(Object.keys(result.icons).length, 9, '九条都有答案（失败的也有键、值为 null）');
  assert.deepEqual(Object.keys(result.icons), refs.map((ref) => `clawhub:ivangdavila:${ref.slug}`), '键按请求顺序');
  assert.deepEqual(Object.keys(result.names), Object.keys(result.icons), 'names 与 icons 逐键同序');
  assert.equal(result.icons['clawhub:ivangdavila:s4'], null, '单条失败只让该条 null');
  assert.equal(result.icons['clawhub:ivangdavila:s8'], 'https://cdn.example.com/s8.png', '其余照常补上');
  assert.equal(run.peak() <= 6, true, `并发不超过 6（实测峰值 ${run.peak()}）`);
});

test('K57 缓存：正向 10 分钟、负向 60 秒；reset 之后重新问', async () => {
  resetIconCache();
  let clock = 0;
  const run = fakeIo({});
  const one = [{ owner: 'ivangdavila', slug: 'cached' }];
  await clawhubSource.icons(one, run.io, { now: () => clock });
  assert.equal(run.calls.length, 1, '第一次问一次');

  clock = 9 * 60 * 1000;
  await clawhubSource.icons(one, run.io, { now: () => clock });
  assert.equal(run.calls.length, 1, '9 分钟内命中缓存，不再发请求');

  clock = 11 * 60 * 1000;
  await clawhubSource.icons(one, run.io, { now: () => clock });
  assert.equal(run.calls.length, 2, '过了 10 分钟重新问');

  resetIconCache();
  await clawhubSource.icons(one, run.io, { now: () => clock });
  assert.equal(run.calls.length, 3, 'reset 之后立刻重新问');

  // A miss (no icon, no title) is remembered for 60 seconds only, so a fixed upstream shows up.
  resetIconCache();
  const missRun = fakeIo({ failSlugs: ['gone'] });
  const gone = [{ owner: 'ivangdavila', slug: 'gone' }];
  await clawhubSource.icons(gone, missRun.io, { now: () => 0 });
  await clawhubSource.icons(gone, missRun.io, { now: () => 59 * 1000 });
  assert.equal(missRun.calls.length, 1, '60 秒内负向缓存命中');
  await clawhubSource.icons(gone, missRun.io, { now: () => 61 * 1000 });
  assert.equal(missRun.calls.length, 2, '60 秒后重试');
});

test('K57 缓存分档：只有「整条空答案」才走 60 秒负向 TTL（有标题无图标算正向）', async () => {
  resetIconCache();
  let clock = 0;
  const named = fakeIo({ rows: [row('titled', { name: 'Titled Skill' })] });
  const one = [{ owner: 'ivangdavila', slug: 'titled' }];
  const first = await clawhubSource.icons(one, named.io, { now: () => clock });
  assert.equal(first.icons['clawhub:ivangdavila:titled'], null, '这条没有图标');
  assert.equal(first.names['clawhub:ivangdavila:titled'], 'Titled Skill', '但有上游标题');
  assert.equal(named.calls.length, 1, '第一次问一次');
  clock = 5 * 60 * 1000;
  const again = await clawhubSource.icons(one, named.io, { now: () => clock });
  assert.equal(named.calls.length, 1, '5 分钟后仍是正向缓存（有标题就算命中，不走 60 秒负向档）');
  assert.equal(again.names['clawhub:ivangdavila:titled'], 'Titled Skill', '标题与图标一起缓存，命中时一起回来');
  clock = 61 * 1000;
  await clawhubSource.icons(one, named.io, { now: () => 11 * 60 * 1000 });
  assert.equal(named.calls.length, 2, '过了 10 分钟才重新问（正向 TTL 生效）');
});

test('K57 整批 6 秒预算：超预算的条目留 null，结果照样按顺序返回', async () => {
  resetIconCache();
  const refs = Array.from({ length: 12 }, (unused, index) => ({ owner: 'ivangdavila', slug: `b${index}` }));
  let clock = 0;
  const slow = {
    async getJson(url) {
      clock += 3000;
      const keyword = new URL(String(url)).searchParams.get('keyword') ?? '';
      return { data: { total: 1, skills: [row(keyword, { iconUrl: `https://cdn.example.com/${keyword}.png` })] } };
    },
    async getBytes() { throw new Error('unused'); },
  };
  const result = await clawhubSource.icons(refs, slow, { now: () => clock });
  assert.equal(Object.keys(result.icons).length, 12, '十二条都有键');
  const nulls = Object.values(result.icons).filter((value) => value === null).length;
  assert.equal(nulls > 0, true, `超预算的条目留 null（实测 ${nulls} 条）`);
  assert.deepEqual(Object.keys(result.icons), refs.map((ref) => `clawhub:ivangdavila:${ref.slug}`), '顺序不受预算影响');
});
