/**
 * K71 - the `names` half of the icon batch: both adapters answer `{icons, names}` with the
 * same keys, a title is only collected when it is a non-empty string, a title-less skill
 * still gets its key (with `null`), and the icon cache carries the title with the image so
 * a cache hit never asks upstream twice for the same skill.
 *
 * Contract: docs/contracts/market.md §7.1 §7.5, docs/contracts/routes.md §3.7.5,
 * docs/contracts/acceptance.md 附录 D.6 K71.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { resetIconCache, clawhubSource } from '../lib/market/sources/clawhub.js';
import { resetSkillhubIconCache, skillhubSource } from '../lib/market/sources/skillhub.js';

/**
 * One source under test: its adapter, its cache reset, and the path its detail endpoint
 * lives on (the fake io answers anything that is not a list/search).
 */
const SOURCES = [
  {
    name: 'skillhub',
    source: skillhubSource,
    reset: resetSkillhubIconCache,
    key: (owner, slug) => `skillhub:${owner}:${slug}`,
    // SkillHub answers a detail payload; its owner *is* the namespace.
    reply: (slug, facts) => ({ skill: { slug, displayName: facts.displayName, iconUrl: facts.icon } }),
  },
  {
    name: 'clawhub',
    source: clawhubSource,
    reset: resetIconCache,
    key: (owner, slug) => `clawhub:${owner}:${slug}`,
    // ClawHub is answered by the mirror's *list*: the row carries both facts, and the
    // namespace it lives in has nothing to do with the owner we matched on.
    reply: (slug, facts) => ({
      data: {
        total: 1,
        skills: [{
          slug,
          name: facts.displayName,
          iconUrl: facts.icon,
          upstream_owner_login: 'ake',
          namespace: { handle: `clawhub_${'ake'}` },
        }],
      },
    }),
  },
];

/**
 * A fake upstream whose answers are driven by slug.
 *
 * The slug is read from the path (SkillHub's detail endpoint) or from the `keyword`
 * parameter (ClawHub's lookup), so one fake serves both shapes.
 * @param {Record<string, {displayName?: unknown, icon?: unknown}>} details - per slug facts.
 * @param {(slug: string, facts: object) => object} reply - the body shape for one source.
 * @returns {{io: {getJson: Function}, calls: string[]}} the io and the slugs asked for.
 */
function fakeIo(details, reply) {
  const calls = [];
  return {
    calls,
    io: {
      /**
       * Answer one GET.
       * @param {URL|string} url - request URL.
       * @returns {Promise<object>} the body.
       */
      async getJson(url) {
        const parsed = new URL(String(url));
        const slug = parsed.searchParams.get('keyword')
          ?? decodeURIComponent(parsed.pathname.split('/').at(-1));
        calls.push(slug);
        return reply(slug, details[slug] ?? {});
      },
    },
  };
}

for (const entry of SOURCES) {
  test(`K71 ${entry.name}：icons/names 同键同序，只有非空字符串标题才收`, async () => {
    entry.reset();
    const { io } = fakeIo({
      titled: { displayName: 'Titled Skill', icon: 'https://cdn.example.com/titled.png' },
      plain: { icon: 'https://cdn.example.com/plain.png' },
      empty: { displayName: '', icon: null },
      spaced: { displayName: '   ', icon: null },
      number: { displayName: 42, icon: null },
      object: { displayName: { text: 'x' }, icon: null },
      both: { displayName: 'Both Skill', icon: 'https://cdn.example.com/both.png' },
    }, entry.reply);
    const refs = ['titled', 'plain', 'empty', 'spaced', 'number', 'object', 'both'].map((slug) => ({ owner: 'ake', slug }));
    const { icons, names } = await entry.source.icons(refs, io);

    assert.deepEqual(Object.keys(names), Object.keys(icons), '两张图逐键同序');
    assert.deepEqual(Object.keys(icons), refs.map((ref) => entry.key(ref.owner, ref.slug)), '键按请求顺序，带源前缀');

    assert.equal(names[entry.key('ake', 'titled')], 'Titled Skill', '正常标题收下');
    assert.equal(names[entry.key('ake', 'both')], 'Both Skill', '有图有题两条都在');
    assert.equal(names[entry.key('ake', 'plain')], null, '上游没给标题 ⇒ 键在、值 null');
    assert.equal(names[entry.key('ake', 'empty')], null, '空串不算有标题');
    assert.equal(names[entry.key('ake', 'spaced')], null, '纯空白不算有标题');
    assert.equal(names[entry.key('ake', 'number')], null, '非字符串不算有标题');
    assert.equal(names[entry.key('ake', 'object')], null, '对象不算有标题');
    for (const key of Object.keys(names)) {
      const value = names[key];
      assert.equal(value === null || (typeof value === 'string' && value !== ''), true, `${key} 的值只有「非空字符串」或 null`);
    }
    // 图标那一侧不受标题影响（归一失败只影响自己）
    assert.equal(icons[entry.key('ake', 'both')], 'https://cdn.example.com/both.png', '有图的仍是图的地址');
    assert.equal(icons[entry.key('ake', 'empty')], null, '没图的仍是 null');
  });

  test(`K71 ${entry.name}：缓存命中时图标与标题一起命中，不为标题再问一次`, async () => {
    entry.reset();
    let at = 1_000_000;
    const clock = () => at;
    const first = fakeIo({ dev: { displayName: 'Dev Pro', icon: 'https://cdn.example.com/dev.png' } }, entry.reply);
    const one = await entry.source.icons([{ owner: 'ake', slug: 'dev' }], first.io, { now: clock });
    assert.equal(one.icons[entry.key('ake', 'dev')], 'https://cdn.example.com/dev.png', '第一次拿到图');
    assert.equal(one.names[entry.key('ake', 'dev')], 'Dev Pro', '第一次拿到标题');
    assert.equal(first.calls.length, 1, '一条 detail 同时出两个值（没有第二条请求）');

    at += 60 * 1000;
    const second = fakeIo({ dev: { displayName: 'Changed Name', icon: 'https://cdn.example.com/other.png' } }, entry.reply);
    const two = await entry.source.icons([{ owner: 'ake', slug: 'dev' }], second.io, { now: clock });
    assert.equal(second.calls.length, 0, '缓存命中 ⇒ 一个上游请求都不发');
    assert.equal(two.icons[entry.key('ake', 'dev')], 'https://cdn.example.com/dev.png', '图是缓存里那张');
    assert.equal(two.names[entry.key('ake', 'dev')], 'Dev Pro', '标题也是缓存里那个（与图标同一份条目）');

    // `?refresh=1` 会调 reset：图标与标题一起清空
    entry.reset();
    const third = fakeIo({ dev: { displayName: 'Changed Name', icon: 'https://cdn.example.com/other.png' } }, entry.reply);
    const three = await entry.source.icons([{ owner: 'ake', slug: 'dev' }], third.io, { now: clock });
    assert.equal(third.calls.length, 1, '清缓存后重新问一条');
    assert.equal(three.icons[entry.key('ake', 'dev')], 'https://cdn.example.com/other.png', '图标换成新的');
    assert.equal(three.names[entry.key('ake', 'dev')], 'Changed Name', '标题也换成新的（两个缓存一起清）');
  });
}
