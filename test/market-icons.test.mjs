/**
 * ClawHub icons: the four shapes that upstream hands out, and the batch that resolves them.
 *
 * Contract: docs/contracts/market.md §7.4 (the `iconUrl` column and its four values) and
 * §7.5 (the icon pipeline: the list carries no icon, the card paints with letters first and
 * the panel fills icons afterwards through `POST market/icons`); docs/contracts/routes.md
 * §3.7.1 route #11; case id K57.
 *
 * Two properties make the pipeline affordable, and both are asserted here: a page of cards
 * costs **exactly one** upstream request (the detail endpoint answers in two to three
 * seconds on this source, so nothing may wait on it), and the batch that does ask is
 * bounded - 24 refs, four at a time, six seconds for the batch, five per lookup.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLAWHUB_ICON_PROXY_PATH,
  LUCIDE_PROXY_PATH,
  clawhubIconUrl,
  lucideNameOf,
  lucideProxyUrl,
} from '../lib/market/normalize.js';
import { clawhubSource, resetIconCache } from '../lib/market/sources/clawhub.js';

/** One upstream list row, shaped like ClawHub's. */
const row = (slug, extra = {}) => ({
  ownerHandle: 'ivangdavila',
  slug,
  displayName: slug,
  summary: 'A fixture skill.',
  latestVersion: { version: '1.0.0' },
  stats: { downloads: 1 },
  updatedAt: 1762000000000,
  ...extra,
});

/**
 * A fake upstream that answers the list, the search endpoint and one detail per slug.
 * @param {{rows?: object[], results?: object[], icons?: Record<string, string|null>,
 *   failSlugs?: string[], detailDelayMs?: number}} [options] - behaviour.
 * @returns {{io: object, calls: string[], peak: () => number}} the client and its log.
 */
function fakeIo(options = {}) {
  const rows = options.rows ?? [row('one'), row('two')];
  const icons = options.icons ?? {};
  const failSlugs = new Set(options.failSlugs ?? []);
  const calls = [];
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
      if (parsed.pathname === '/api/v1/skills' && parsed.searchParams.get('cursor') === null) {
        return { items: rows, nextCursor: null };
      }
      if (parsed.pathname === '/api/v1/search') {
        return { results: options.results ?? [] };
      }
      const slug = decodeURIComponent(parsed.pathname.split('/').at(-1));
      live += 1;
      peak = Math.max(peak, live);
      try {
        if (options.detailDelayMs !== undefined) await new Promise((resolve) => { setTimeout(resolve, options.detailDelayMs); });
        if (failSlugs.has(slug)) throw new Error(`detail ${slug} down`);
        const icon = Object.hasOwn(icons, slug) ? icons[slug] : null;
        return { skill: { slug, displayName: slug, icon } };
      } finally {
        live -= 1;
      }
    },
  };
  return { io, calls, peak: () => peak };
}

/** A normalised list query, the shape the route hands the adapter. */
const QUERY = {
  sourceId: 'clawhub', sort: 'recommended', keyword: '', category: null, limit: 4, cursor: null,
};

/** How many detail requests the log holds. */
const detailCalls = (calls) => calls.filter((call) => call.startsWith('/api/v1/skills/'));

/** A 64-hex hash, the shape ClawHub uses for uploaded icons. */
const HASH = 'ab'.repeat(32);

test('K57 四形态归一：绝对 https / 上传图标走本机代理 / lucide 走本机代理 / 其余 null', () => {
  assert.equal(clawhubIconUrl('https://cdn.example.com/a.png'), 'https://cdn.example.com/a.png', '绝对 https 原样');
  assert.equal(
    clawhubIconUrl(`/api/v1/skill-icons/${HASH}`),
    `${CLAWHUB_ICON_PROXY_PATH}?hash=${HASH}`,
    '上传图标换成同源文档相对代理（远端带 sandbox CSP，<img> 直接加载会白屏）',
  );
  assert.equal(
    clawhubIconUrl(`/api/v1/skill-icons/${HASH}`),
    'api/dsh-skill-center/market/clawhub-icon?hash=' + HASH,
    '代理地址是文档相对路径（带路径前缀的部署也成立）',
  );
  assert.equal(clawhubIconUrl('lucide:Zap'), lucideProxyUrl('zap'), 'lucide token 走另一个本机代理');
  assert.equal(clawhubIconUrl('lucide:Zap'), 'api/dsh-skill-center/market/lucide?name=zap', '同样是文档相对');
  assert.equal(lucideProxyUrl('file-text'), `${LUCIDE_PROXY_PATH}?name=file-text`, '路径常量只有一个定义点');
  for (const url of [clawhubIconUrl(`/api/v1/skill-icons/${HASH}`), clawhubIconUrl('lucide:Zap')]) {
    assert.equal(/^https?:|^\//.test(url), false, '两种代理都不带 origin、不带前导斜杠');
  }
  for (const value of [
    null, undefined, '', '   ', 42, {}, 'just-a-word',
    'http://cdn.example.com/a.png', '//evil.example.com/a.png',
    '/api/v1/skill-icons/not-a-hash', '/some/other/path', '/api/v1/skill-icons/' + HASH.toUpperCase(),
    'lucide:a--b', 'lucide:',
  ]) {
    assert.equal(clawhubIconUrl(value), null, `${JSON.stringify(value)} ⇒ null（卡片留字母头像）`);
  }
});

test('K57 lucideNameOf：PascalCase / kebab / 非法名', () => {
  assert.equal(lucideNameOf('Zap'), 'zap', '单词大写 -> 小写');
  assert.equal(lucideNameOf('FileText'), 'file-text', '驼峰拆成 kebab');
  assert.equal(lucideNameOf('FileTextIcon'), 'file-text-icon', '多段驼峰');
  assert.equal(lucideNameOf('arrow-up-right'), 'arrow-up-right', '已经是 kebab 就原样');
  assert.equal(lucideNameOf('a1'), 'a1', '字母+数字允许');
  // 名字没有长度上限，只有段数上限（≤6 段）。
  assert.equal(lucideNameOf('x'.repeat(40)), 'x'.repeat(40), '单段长度不受限');
  for (const value of ['', '   ', 'a--b', 'a/b', '../../etc/passwd', 'Zap Zap', '-lead', 'a-b-c-d-e-f-g', null, 42]) {
    assert.equal(lucideNameOf(value), null, `${JSON.stringify(value)} 不是合法图标名`);
  }
});

test('K57 列表与搜索**零额外请求**：图标只为「载荷自带」的条目填，其余留 null', async () => {
  resetIconCache();
  const rows = [
    row('carried', { icon: 'lucide:Zap' }),
    row('uploaded', { icon: `/api/v1/skill-icons/${HASH}` }),
    row('nested', { native: { skill: { icon: 'lucide:FileText' } } }),
    row('none'),
    row('nested-null', { native: { skill: { icon: null } } }),
  ];
  const list = fakeIo({ rows, icons: { none: 'lucide:Palette' } });
  const page = await clawhubSource.list({ ...QUERY, limit: 10 }, list.io);
  assert.equal(page.items.length, 5, '五条都回来了');
  assert.equal(page.items[0].iconUrl, 'api/dsh-skill-center/market/lucide?name=zap', '平铺 icon 直接用');
  assert.equal(page.items[1].iconUrl, `api/dsh-skill-center/market/clawhub-icon?hash=${HASH}`, '上传图标直接用');
  assert.equal(page.items[2].iconUrl, 'api/dsh-skill-center/market/lucide?name=file-text', 'native.skill.icon 也算自带');
  assert.equal(page.items[3].iconUrl, null, '没有图标 ⇒ null（等批量补）');
  assert.equal(page.items[4].iconUrl, null, '显式 null ⇒ null');
  assert.deepEqual(list.calls, ['/api/v1/skills?limit=10'], '列表只发一次请求，一条详情都不问');
  assert.equal(list.peak(), 0, '没有任何详情请求在飞');

  const search = fakeIo({ results: [{ ownerHandle: 'o', native: { skill: { slug: 'one', icon: 'lucide:Zap' } } }] });
  const found = await clawhubSource.search({ ...QUERY, keyword: 'one' }, search.io);
  assert.equal(found.items[0].iconUrl, 'api/dsh-skill-center/market/lucide?name=zap', '搜索页同样只认自带的');
  assert.deepEqual(search.calls, ['/api/v1/search?q=one&limit=4'], '搜索也是一次请求');
});

test('K57 批量补齐：并发 ≤4、按请求顺序返回、单条失败只 null、整批不抛', async () => {
  resetIconCache();
  const refs = Array.from({ length: 10 }, (_, index) => ({ owner: 'ivangdavila', slug: `skill-${index}` }));
  const icons = { 'skill-0': 'lucide:Zap', 'skill-1': `/api/v1/skill-icons/${HASH}`, 'skill-2': 'https://cdn.example.com/own.png' };
  const { io, peak, calls } = fakeIo({ icons, failSlugs: ['skill-4'], detailDelayMs: 15 });
  const resolved = await clawhubSource.icons(refs, io);
  assert.deepEqual(Object.keys(resolved), refs.map((ref) => `clawhub:${ref.owner}:${ref.slug}`), '键按请求顺序排列');
  assert.equal(resolved['clawhub:ivangdavila:skill-0'], 'api/dsh-skill-center/market/lucide?name=zap', 'lucide 形态');
  assert.equal(resolved['clawhub:ivangdavila:skill-1'], `api/dsh-skill-center/market/clawhub-icon?hash=${HASH}`, '上传图标形态');
  assert.equal(resolved['clawhub:ivangdavila:skill-2'], 'https://cdn.example.com/own.png', '绝对 https 形态');
  assert.equal(resolved['clawhub:ivangdavila:skill-3'], null, '没有图标 ⇒ null');
  assert.equal(resolved['clawhub:ivangdavila:skill-4'], null, '详情失败的条目 ⇒ null，不是抛错');
  assert.ok(peak() <= 4, `同时在飞的详情请求不超过 4（实测 ${peak()}）`);
  assert.ok(peak() > 1, '确实是并发而不是串行');
  assert.equal(detailCalls(calls).length, 10, '每条都问了一次详情');
});

test('K57 缓存：正向 10 分钟、负向 60 秒；reset 之后重新问', async () => {
  resetIconCache();
  let at = 1_000_000;
  const clock = () => at;
  const refs = [{ owner: 'ivangdavila', slug: 'one' }, { owner: 'ivangdavila', slug: 'two' }];

  const first = fakeIo({ icons: { one: 'https://cdn.example.com/one.png' } });
  const one = await clawhubSource.icons(refs, first.io, { now: clock });
  assert.equal(one['clawhub:ivangdavila:one'], 'https://cdn.example.com/one.png', '第一次拿到');
  assert.equal(one['clawhub:ivangdavila:two'], null, '第一次没有');
  assert.equal(detailCalls(first.calls).length, 2, '两条都问了详情');

  // +5 分钟：one 命中正向缓存（10 分钟），two 的负数缓存（60 秒）已过期 ⇒ 只重问 two
  at += 5 * 60 * 1000;
  const second = fakeIo({ icons: { one: 'https://cdn.example.com/changed.png', two: 'https://cdn.example.com/two-now.png' } });
  const two = await clawhubSource.icons(refs, second.io, { now: clock });
  assert.deepEqual(detailCalls(second.calls), ['/api/v1/skills/two?ownerHandle=ivangdavila'], '只重问了没有图标的那条');
  assert.equal(two['clawhub:ivangdavila:one'], 'https://cdn.example.com/one.png', 'one 仍是缓存里那条');
  assert.equal(two['clawhub:ivangdavila:two'], 'https://cdn.example.com/two-now.png', 'two 这次拿到了');

  // +11 分钟：one 的正向缓存也过期
  at = 1_000_000 + 11 * 60 * 1000;
  const third = fakeIo({ icons: { one: 'https://cdn.example.com/late.png' } });
  const three = await clawhubSource.icons(refs, third.io, { now: clock });
  assert.equal(three['clawhub:ivangdavila:one'], 'https://cdn.example.com/late.png', '正向缓存 10 分钟后过期');

  resetIconCache();
  const fourth = fakeIo({ icons: { one: 'https://cdn.example.com/refreshed.png' } });
  const four = await clawhubSource.icons(refs, fourth.io, { now: clock });
  assert.equal(four['clawhub:ivangdavila:one'], 'https://cdn.example.com/refreshed.png', '清缓存后重新取');
});

test('K57 整批 6 秒预算：超预算的条目留 null，结果照样按顺序返回', async () => {
  resetIconCache();
  let at = 0;
  const refs = Array.from({ length: 8 }, (_, index) => ({ owner: 'ivangdavila', slug: `slow-${index}` }));
  const { io, calls } = fakeIo({ icons: {} });
  // 每次读时钟前进 2.5s ⇒ 第三批之后（>6s）预算耗尽，后面的条目直接 null
  const clock = () => {
    at += 2500;
    return at;
  };
  const resolved = await clawhubSource.icons(refs, io, { now: clock });
  assert.equal(Object.keys(resolved).length, 8, '八条都在结果里（顺序不变）');
  assert.equal(Object.values(resolved).every((value) => value === null), true, '预算耗尽后都是 null');
  assert.ok(detailCalls(calls).length < 8, `没有把八条全问完（实测 ${detailCalls(calls).length} 次）`);
});
