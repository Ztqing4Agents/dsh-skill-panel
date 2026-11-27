/**
 * The detail overview's first channel: the author's own short copy.
 *
 * Contract: docs/contracts/market.md §7.4 (the `MarketDetail.overview` row and the
 * "未对齐处" note ③) and §7.8 硬规矩 5 (the request count of one `detail`, and `lang` never
 * reaching an install); case ids K157–K160.
 *
 * Why the short copy is first: the site's own detail view is
 * `skill.hasOverview ? CustomOverview : SkillFileOverview`, so a skill that publishes one
 * shows that document *instead of* `SKILL.md`. Two shapes of a live answer (2026-11-27) drive
 * the code below: `content` is empty and the text lives at the `url` the body carries - a COS
 * object on a *different* origin from the API - and `skill.hasOverview` is the only flag that
 * says whether to look. So the interesting failures are "the URL points somewhere else" and
 * "the short copy is missing": both must leave the detail view with the `SKILL.md` it would
 * have shown before, which is exactly what K158 / K159 pin.
 *
 * Fixtures are the real shapes: `shibo-bid-project-matcher` (`hasOverview: true`,
 * `contentZhAvailable: false`, the COS host and the `aa/bb/<md5>.md` path), the `fpt-cli`
 * `SKILL.md` head, and the same body with the flag off. No network is used.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { skillhubSource } from '../lib/market/sources/skillhub.js';
import { overviewOf } from '../lib/market/normalize.js';

/** The skill the live samples were taken from. */
const SLUG = 'shibo-bid-project-matcher';
const NS = 'user_0a88731f';
const REF = { owner: NS, slug: SLUG, version: null };

/** The author's own `SKILL.md` (frontmatter first, so `declaredName` has something to read). */
const ORIGINAL_MD = [
  '---',
  'name: shibo-bid-project-matcher',
  'description: Match a company profile against projects that are currently being tendered.',
  '---',
  '',
  '## Purpose',
  'Screen public tender data for projects a company can actually bid on.',
  '',
].join('\n');

/** What the short-copy document holds - not the file, and not the summary. */
const SHORT_MD = [
  '## Listing details',
  '',
  '- directory name: `shibo-bid-project-matcher`',
  '- version: 1.0.0',
  '',
  '## Position',
  '',
  'From "one company" to "which tenders fit it", with a 100-point fit score.',
  '',
].join('\n');

/** The platform's Chinese translation of `SKILL.md` (only read when nothing else has a body). */
const TRANSLATED_MD = ORIGINAL_MD.replace('## Purpose', '## 目的').replace(
  'Screen public tender data for projects a company can actually bid on.',
  '从公开招投标数据里筛出这家公司真正能投的项目。',
);

/** The md5 the live answer carried, and the COS object it points at. */
const MD5 = 'a0c38175b4803473be41d451b041fefa';
const COS_HOST = 'skillhub-1388575217.cos.accelerate.myqcloud.com';
const COS_URL = `https://${COS_HOST}/skill-overviews/a0/c3/${MD5}.md`;

/** A detail body shaped like the live one for this skill. */
function detailBody(options = {}) {
  const hasOverview = options.hasOverview === true;
  return {
    contentZhAvailable: options.zh === true,
    latestVersion: { version: '1.0.0', createdAt: 1795142069607 },
    namespace: { handle: NS, displayName: NS },
    owner: { handle: NS, displayName: NS },
    skill: {
      slug: SLUG,
      displayName: 'Bid Project Matcher',
      summary: 'Match a company profile against projects that are currently being tendered.',
      summary_zh: '把公司画像与正在招标的项目对上。',
      category: 'office-efficiency',
      hasOverview,
      // The live body carries the short copy here as well; the adapter deliberately reads the
      // document over its own route instead, which is what the site does.
      overviewMd: hasOverview ? SHORT_MD : '',
      stats: { downloads: 1200, stars: 8 },
      subCategories: [],
      updatedAt: 1795142069607,
    },
    slug: SLUG,
  };
}

/** The manifest of the package. */
const MANIFEST = [{ path: 'SKILL.md', size: Buffer.byteLength(ORIGINAL_MD), sha256: null }];

/**
 * A fake upstream that records every URL and answers the four shapes this case needs.
 * @param {{detail?: object, overview?: 'ok'|'throws', url?: string, translation?: 'ok'|'throws',
 *   short?: string}} [options] - behaviour overrides.
 * @returns {{io: object, calls: object[], paths: () => string[], hosts: () => string[]}} the client and its log.
 */
function upstreamStub(options = {}) {
  const calls = [];
  const record = (url) => {
    const parsed = new URL(String(url));
    const entry = {
      url: parsed.toString(),
      host: parsed.hostname,
      path: parsed.pathname,
      query: Object.fromEntries(parsed.searchParams),
    };
    calls.push(entry);
    return entry;
  };
  const short = options.short ?? SHORT_MD;
  const io = {
    /**
     * Answer one JSON GET: detail, manifest, or the short-copy descriptor.
     * @param {URL|string} url - request URL.
     * @returns {Promise<object>} the body.
     */
    async getJson(url) {
      const entry = record(url);
      if (entry.path.endsWith('/files')) return { files: MANIFEST };
      if (entry.path.endsWith('/overview')) {
        if (options.overview === 'throws') {
          throw Object.assign(new Error('404 from the short-copy route'), { code: 'E_SOURCE_BAD_RESPONSE' });
        }
        return {
          bytes: Buffer.byteLength(short),
          content: '',
          hasOverview: true,
          md5: MD5,
          skillId: 327891,
          updatedAt: 1795142069607,
          url: options.url ?? COS_URL,
          version: '1.0.0',
          versionId: 533158,
        };
      }
      return options.detail ?? detailBody();
    },
    /**
     * Answer one byte GET: the COS object, a translation, or the author's `SKILL.md`.
     * @param {URL|string} url - request URL.
     * @returns {Promise<{body: Buffer}>} the bytes.
     */
    async getBytes(url) {
      const entry = record(url);
      if (entry.host === COS_HOST) return { body: Buffer.from(short) };
      if (entry.path.endsWith('/file')) {
        if (entry.query.lang !== undefined) {
          if (options.translation === 'throws') {
            throw Object.assign(new Error('404 from the translation channel'), { code: 'E_SOURCE_BAD_RESPONSE' });
          }
          return { body: Buffer.from(TRANSLATED_MD) };
        }
        return { body: Buffer.from(ORIGINAL_MD) };
      }
      throw new Error(`the fake has no bytes for ${entry.url}`);
    },
  };
  return {
    io,
    calls,
    paths: () => calls.map((call) => call.path),
    hosts: () => calls.map((call) => call.host),
  };
}

test('K157 hasOverview 为真 ⇒ 多两次请求（/overview + 短稿对象），overview 就是短稿正文', async () => {
  // `contentZhAvailable: true` on purpose: the short copy still wins, so the translation is
  // not read at all - that is the priority the site encodes in `TabOverview`.
  const run = upstreamStub({ detail: detailBody({ hasOverview: true, zh: true }) });
  const payload = await skillhubSource.detail(REF, run.io);

  assert.deepEqual(run.paths(), [
    `/api/v1/skills/${SLUG}`,
    `/api/v1/skills/${SLUG}/files`,
    `/api/v1/skills/${SLUG}/file`,
    `/api/v1/skills/${SLUG}/overview`,
    `/skill-overviews/a0/c3/${MD5}.md`,
  ], '详情 + 清单 + 原文 + /overview + 短稿对象：5 次（有短稿时比原链路多 2 次）');
  assert.equal(run.calls.length, 5, '总数就是 5');
  assert.deepEqual(
    run.calls.map((call) => call.query.lang ?? null),
    [null, null, null, null, null],
    '短稿拿到了，译本一次都没读（优先级高于 contentZhAvailable）',
  );
  assert.equal(run.calls[3].query.namespace, NS, '/overview 带 namespace');
  assert.equal(run.calls[4].host, COS_HOST, '短稿正文从 url 指的那个对象读');
  assert.equal(run.calls[3].query.path ?? null, null, '短稿请求没有 path 参数');

  assert.equal(payload.overview, overviewOf(SHORT_MD), 'overview 逐字等于短稿正文');
  assert.match(payload.overview, /## Position/, '是短稿那一份');
  assert.equal(payload.overview.includes('## Purpose'), false, '不是 SKILL.md 正文');
  assert.equal(payload.declaredName, 'shibo-bid-project-matcher', '声明名仍从作者原文的 frontmatter 读');
  assert.equal(payload.nameValid, true, '名字合规判定照常');
  assert.deepEqual(payload.files.map((file) => file.path), ['SKILL.md'], 'files 不受短稿影响');
  assert.equal(payload.filesComplete, true, 'filesComplete 不变');
});

test('K158 短稿 url 不在白名单 ⇒ 一次都不去取，回落 SKILL.md', async () => {
  for (const [label, url] of [
    ['别的域名', 'https://evil.example.com/skill-overviews/a0/c3/deadbeef.md'],
    ['同域但 http', `http://${COS_HOST}/skill-overviews/a0/c3/${MD5}.md`],
    ['桶后缀形似', 'https://skillhub-1388575217.cos.accelerate.myqcloud.com.evil.test/x.md'],
  ]) {
    const run = upstreamStub({ detail: detailBody({ hasOverview: true }), url });
    const payload = await skillhubSource.detail(REF, run.io);

    assert.deepEqual(
      run.hosts(),
      ['api.skillhub.cn', 'api.skillhub.cn', 'api.skillhub.cn', 'api.skillhub.cn'],
      `${label}：四个请求全在 API 主机上，那个 url 一次都没去`,
    );
    assert.equal(run.calls.length, 4, `${label}：详情 + 清单 + 原文 + /overview（多的一次是描述符，不是对象）`);
    assert.equal(run.paths().at(-1), `/api/v1/skills/${SLUG}/overview`, `${label}：最后一个是描述符请求`);
    assert.match(payload.overview, /## Purpose/, `${label}：回落作者原文`);
    assert.equal(payload.overview.includes('## Listing details'), false, `${label}：没有半段短稿混进来`);
    assert.equal(payload.declaredName, 'shibo-bid-project-matcher', `${label}：声明名照常`);
  }
});

test('K159 /overview 404 ⇒ 回落现有链路（有译本读译本），不抛错', async () => {
  const plain = upstreamStub({ detail: detailBody({ hasOverview: true }), overview: 'throws' });
  const payload = await skillhubSource.detail(REF, plain.io);
  assert.equal(plain.calls.length, 4, '详情 + 清单 + 原文 + 失败的那次 /overview');
  assert.deepEqual(plain.calls.map((call) => call.query.lang ?? null), [null, null, null, null], '没有译本可读时一次都不读');
  assert.match(payload.overview, /## Purpose/, '回落作者原文');
  assert.equal(payload.declaredName, 'shibo-bid-project-matcher', '声明名照常');

  // With a translation available the fallback continues down the chain it always had.
  const translated = upstreamStub({ detail: detailBody({ hasOverview: true, zh: true }), overview: 'throws' });
  const withZh = await skillhubSource.detail(REF, translated.io);
  assert.equal(translated.calls.length, 5, '详情 + 清单 + 原文 + 失败的 /overview + 译本（回落最多 6 次的那一档）');
  assert.equal(translated.calls.at(-1).query.lang, 'zh', '回落时读的正是译本');
  assert.match(withZh.overview, /## 目的/, 'overview 是译本正文');
});

test('K160 hasOverview 为假 ⇒ 与原链路逐字相同（请求清单一致，且没有任何 /overview 请求）', async () => {
  for (const [label, options] of [
    ['无译本', { detail: detailBody({ hasOverview: false }) }],
    ['有译本', { detail: detailBody({ hasOverview: false, zh: true }), translation: 'ok' }],
  ]) {
    const run = upstreamStub(options);
    const payload = await skillhubSource.detail(REF, run.io);

    assert.equal(
      run.calls.some((call) => call.path.endsWith('/overview')),
      false,
      `${label}：标志为假就不去问短稿（多一次请求也是回归）`,
    );
    const expected = label === '有译本' ? 4 : 3;
    assert.equal(run.calls.length, expected, `${label}：${expected} 次请求，与 M15 之前的链逐字相同`);
    const expectOverview = label === '有译本' ? /## 目的/ : /## Purpose/;
    assert.match(payload.overview, expectOverview, `${label}：overview 走原来那条链`);
    assert.equal(payload.declaredName, 'shibo-bid-project-matcher', `${label}：声明名照常`);
  }

  // The flag is read as data, not as truthiness: a string or a number is not `true`.
  for (const [label, flag] of [['字符串 "true"', 'true'], ['数字 1', 1]]) {
    const body = detailBody({ hasOverview: true });
    body.skill.hasOverview = flag;
    const run = upstreamStub({ detail: body });
    await skillhubSource.detail(REF, run.io);
    assert.equal(run.calls.some((call) => call.path.endsWith('/overview')), false, `${label}：不算有短稿`);
    assert.equal(run.calls.length, 3, `${label}：仍是 3 次`);
  }
});
