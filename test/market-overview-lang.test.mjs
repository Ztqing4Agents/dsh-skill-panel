/**
 * The overview channel: a translated `SKILL.md` can be *read*, and must never be *installed*.
 *
 * Contract: docs/contracts/market.md §7.4 (the `MarketDetail.overview` row: which of the two
 * texts the overview reads, and the rule that `declaredName` only ever comes from the
 * author's own file) and §7.8 硬规矩 5 (`lang` belongs to reading, never to installing);
 * case id K151.
 *
 * Why this file exists at all: `lang=zh` makes the mirror's `/file` endpoint answer 302 to
 * `<version>/skill_zh.md` - a platform translation that is **not one of the manifest paths**
 * (verified against the live endpoint: the original redirects to `files/SKILL.md`, the
 * `lang=zh` one to `skill_zh.md`). So the two texts differ in body language and can differ
 * in frontmatter, which is why a translated byte written into `skills/<name>/` would not be
 * a display bug but data pollution: the user would own a machine translation filed under a
 * name the author never wrote.
 *
 * The structural argument ("`fetchFile` takes no fifth argument") is not what is tested
 * here. What is tested is the *observable* promise, three ways:
 *
 * 1. every URL the install path hands to the upstream carries no `lang` (a URL recorder);
 * 2. an upstream that **throws on any `lang` request** still lets a whole install finish -
 *    so the guarantee survives somebody hoisting `lang` into `buildUrl`, `getBytes`, or a
 *    default parameter on `readFile`;
 * 3. the bytes on disk are the author's file (frontmatter head + body language), not the
 *    translation that the same adapter demonstrably fetched moments earlier.
 *
 * Fixtures are the real shapes from `api.skillhub.cn` (2026-11-21): `fpt-cli`
 * (`contentZhAvailable: true`, four manifest paths: `SKILL.md`, `_meta.json`,
 * `references/install-and-auth.md`, `references/query-patterns.md`) and
 * `plant-care-expert` (`contentZhAvailable: false`, five paths). File bodies are trimmed
 * heads of the real ones; no network is used.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { createInstaller } from '../lib/market/install.js';
import { createStore } from '../lib/market/store.js';
import { skillhubSource } from '../lib/market/sources/skillhub.js';
import { tempDir } from './helpers/tree.mjs';

/** The author's own `SKILL.md` - frontmatter first, English body (the real head, trimmed). */
const ORIGINAL_MD = [
  '---',
  'name: fpt-cli',
  'description: This skill should be used when OpenClaw needs to install, configure, inspect, or operate `fpt-cli` for Autodesk Flow Production Tracking / ShotGrid workflows.',
  '---',
  '',
  '## Purpose',
  'Provide a stable, agent-optimized workflow for using `fpt-cli` from OpenClaw.',
  '',
].join('\n');

/**
 * What `?lang=zh` answers: the same frontmatter, a Chinese body. The real file keeps the
 * author's `name:` too - the translated-name variant below is the risk case, kept separate
 * so this fixture stays verbatim.
 */
const TRANSLATED_MD = [
  '---',
  'name: fpt-cli',
  'description: This skill should be used when OpenClaw needs to install, configure, inspect, or operate `fpt-cli` for Autodesk Flow Production Tracking / ShotGrid workflows.',
  '---',
  '',
  '',
  '',
  '## 目的',
  '',
  '为从 OpenClaw 使用 `fpt-cli` 提供一个稳定的、面向 Agent 优化的的工作流程。',
  '',
].join('\n');

/** A translation whose frontmatter disagrees with the author's file (machine-translated title). */
const TRANSLATED_RENAMED_MD = TRANSLATED_MD.replace('name: fpt-cli', 'name: 流程跟踪助手');

/** The real four manifest paths of `fpt-cli`, with the bytes the fake upstream serves. */
const FILE_BYTES = new Map([
  ['SKILL.md', Buffer.from(ORIGINAL_MD)],
  ['_meta.json', Buffer.from('{"slug":"fpt-cli","version":"1.0.4"}\n')],
  ['references/install-and-auth.md', Buffer.from('# Install and auth\n\nSet FPT_HOST, then `fpt auth login`.\n')],
  ['references/query-patterns.md', Buffer.from('# Query patterns\n\n`schema entities list` before composing a search.\n')],
]);

/**
 * A manifest shaped like the live one, sized and hashed from the bytes actually served -
 * the installer verifies both, so a hand-written size would fail for the wrong reason.
 * @param {Map<string, Buffer>} bytes - path to content.
 * @returns {object[]} the manifest.
 */
function manifestOf(bytes) {
  return [...bytes].map(([path, content]) => ({
    path,
    size: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
  }));
}

/** A detail body shaped like the live `fpt-cli` one. */
const FPT_DETAIL = {
  contentZhAvailable: true,
  latestVersion: { version: '1.0.4', createdAt: 1777596728275 },
  namespace: { handle: 'user_07c3fda9', displayName: 'user_07c3fda9' },
  owner: { displayName: 'Hal', handle: 'user_07c3fda9' },
  skill: {
    slug: 'fpt-cli',
    displayName: 'Fpt Cli',
    summary: 'This skill should be used when OpenClaw needs to install, configure, inspect, or operate `fpt-cli`.',
    summary_zh: '需要在 OpenClaw 中安装、配置或操作 `fpt-cli` 时使用本技能。',
    category: 'professional',
    iconUrl: 'https://cloudcache.tencent-cloud.com/qcloud/ui/static/other_external_resource/x.png',
    stats: { downloads: 993, stars: 0 },
    subCategories: [{ key: 'pro-industry-research', name: '行业研究' }],
    updatedAt: 1795237382690,
  },
  slug: 'fpt-cli',
};

/** The same body with the flag off - the `plant-care-expert` shape (five manifest paths). */
const PLANT_DETAIL = {
  contentZhAvailable: false,
  latestVersion: { version: '1.0.2' },
  namespace: { handle: 'user_883a3f62', displayName: 'user_883a3f62' },
  owner: { displayName: 'Phal studio', handle: 'user_883a3f62' },
  skill: {
    slug: 'plant-care-expert',
    displayName: 'Plant Care Expert',
    summary: '',
    summary_zh: '植物养护专家，按品种给出浇水、光照与病虫害处理建议。',
    stats: { downloads: 1200, stars: 8 },
    updatedAt: 1795000000000,
  },
  slug: 'plant-care-expert',
};

/** The five real manifest paths of `plant-care-expert`, and the `SKILL.md` it ships. */
const PLANT_FILES = new Map([
  ['SKILL.md', Buffer.from('---\nname: plant-care-expert\n---\n\n## 什么时候用\n\n用户问浇水、光照、换盆时用本技能。\n')],
  ['README.md', Buffer.from('# Plant care expert\n')],
  ['references/plant_database.md', Buffer.from('# Plants\n')],
  ['references/plant_database_extended.md', Buffer.from('# More plants\n')],
  ['references/troubleshooting.md', Buffer.from('# Troubleshooting\n')],
]);

/** The installer writes `skills/<declaredName>` under a temp root. */
const REF = { owner: 'user_07c3fda9', slug: 'fpt-cli', version: null };

/**
 * A fake upstream that records every URL it is asked for, and can be told to fail or to
 * refuse translations outright.
 *
 * `phase` exists so the refusal can be armed for the install leg only: `detail` is *supposed*
 * to ask for `lang=zh`, and a stub that rejected it there would test the wrong thing.
 * @param {{detail?: object, files?: Map<string, Buffer>, translation?: 'ok'|'renamed'|'throws'|'empty'|'blank',
 *   plant?: boolean}} [options] - behaviour.
 * @returns {{io: object, calls: object[], setPhase: (p: string) => void,
 *   langRequests: () => object[], paths: () => string[]}} the client and its log.
 */
function upstreamStub(options = {}) {
  const files = options.files ?? FILE_BYTES;
  const calls = [];
  let phase = 'read';
  const record = (url) => {
    const parsed = new URL(String(url));
    const entry = {
      phase,
      url: parsed.toString(),
      path: parsed.pathname,
      query: Object.fromEntries(parsed.searchParams),
    };
    calls.push(entry);
    return { parsed, entry };
  };
  const io = {
    /**
     * Answer one JSON GET: the detail body or the manifest.
     * @param {URL|string} url - request URL.
     * @returns {Promise<object>} the body.
     */
    async getJson(url) {
      const { entry } = record(url);
      if (entry.path.endsWith('/files')) return { files: manifestOf(files) };
      return options.detail ?? FPT_DETAIL;
    },
    /**
     * Answer one file GET, honouring `lang` the way the live endpoint does.
     * @param {URL|string} url - request URL.
     * @returns {Promise<{body: Buffer}>} the bytes.
     */
    async getBytes(url) {
      const { parsed, entry } = record(url);
      const marked = parsed.searchParams.get('lang');
      if (phase === 'install' && marked !== null) {
        throw Object.assign(
          new Error('an install must never ask the upstream for a translation'),
          { code: 'E_PACKAGE_INVALID' },
        );
      }
      if (marked !== null) {
        if (options.translation === 'throws') {
          throw Object.assign(new Error('404 from the translation channel'), { code: 'E_SOURCE_BAD_RESPONSE' });
        }
        if (options.translation === 'empty') return { body: Buffer.alloc(0) };
        if (options.translation === 'blank') return { body: Buffer.from('\n\n\n') };
        return { body: Buffer.from(options.translation === 'renamed' ? TRANSLATED_RENAMED_MD : TRANSLATED_MD) };
      }
      const wanted = parsed.searchParams.get('path') ?? '';
      if (!files.has(wanted)) throw new Error(`the fake has no bytes for ${wanted}`);
      return { body: files.get(wanted) };
    },
  };
  return {
    io,
    calls,
    setPhase: (next) => { phase = next; },
    langRequests: () => calls.filter((call) => 'lang' in call.query),
    paths: () => calls.map((call) => call.path),
  };
}

test('K151 概览通道：contentZhAvailable 为真 ⇒ detail 共 4 次请求，第 4 次带 lang=zh，overview 是译本', async () => {
  const run = upstreamStub({ translation: 'ok' });
  const payload = await skillhubSource.detail(REF, run.io);

  assert.deepEqual(run.paths(), [
    '/api/v1/skills/fpt-cli',
    '/api/v1/skills/fpt-cli/files',
    '/api/v1/skills/fpt-cli/file',
    '/api/v1/skills/fpt-cli/file',
  ], '详情 + 清单 + 原文 + 译本：正好 4 次请求（SkillHub 的 namespace 解析免费，不计请求）');
  assert.deepEqual(
    run.calls.map((call) => call.query.lang ?? null),
    [null, null, null, 'zh'],
    '只有最后一次带 lang，前三次一次都不带',
  );
  assert.equal(run.calls[3].query.path, 'SKILL.md', '译本读的仍是 SKILL.md 这个路径（302 由上游改答 skill_zh.md）');
  assert.equal(run.calls[3].query.namespace, 'user_07c3fda9', 'namespace 照旧带上');

  assert.match(payload.overview, /## 目的/, 'overview 是译本正文');
  assert.equal(payload.overview.includes('## Purpose'), false, '不是原文正文');
  assert.equal(payload.declaredName, 'fpt-cli', '声明名照旧从原文 frontmatter 读');
  assert.equal(payload.files.length, 4, '清单四项原样上屏');
});

test('K151 译本 404 ⇒ overview 回落原文，不抛错，files / declaredName 照常', async () => {
  const run = upstreamStub({ translation: 'throws' });
  const payload = await skillhubSource.detail(REF, run.io);

  assert.equal(run.langRequests().length, 1, '确实试过译本（失败的正是那一次）');
  assert.match(payload.overview, /## Purpose/, 'overview 回落到作者原文');
  assert.equal(payload.overview.includes('## 目的'), false, '没有半段译文混进来');
  assert.equal(payload.declaredName, 'fpt-cli', 'declaredName 不受影响');
  assert.equal(payload.nameValid, true, '名字合规判定照常');
  assert.deepEqual(payload.files.map((file) => file.path), [...FILE_BYTES.keys()], 'files 四项照常');
  assert.equal(payload.filesComplete, true, '包形态仍是完整清单');
});

test('K151 空正文回落：译本 0 字节与「只有空白」都不算译本，两份都空时回落 summary', async () => {
  for (const [label, variant] of [['0 字节', 'empty'], ['只有空白', 'blank']]) {
    const run = upstreamStub({ translation: variant });
    const payload = await skillhubSource.detail(REF, run.io);
    assert.equal(run.langRequests().length, 1, `${label}：也试过译本`);
    assert.match(payload.overview, /## Purpose/, `${label}：回落作者原文（不是空概览）`);
    assert.notEqual(payload.overview.trim(), '', `${label}：概览没有变成空串`);
    assert.equal(payload.declaredName, 'fpt-cli', `${label}：declaredName 照常`);
  }

  // Both texts empty: the overview falls back to the summary, as the contract's tail says.
  const emptyFiles = new Map(FILE_BYTES);
  emptyFiles.set('SKILL.md', Buffer.alloc(0));
  const both = upstreamStub({ files: emptyFiles, translation: 'empty' });
  const payload = await skillhubSource.detail(REF, both.io);
  // The fallback is `MarketItem.summary`, which since K149 reads the localized slot first -
  // so a Chinese overview can come from `summary_zh` even when both files are empty.
  assert.equal(payload.overview, FPT_DETAIL.skill.summary_zh, '两份都空 ⇒ overview 回落 summary（本地化优先那一格）');
  assert.notEqual(payload.overview, FPT_DETAIL.skill.summary, '不是英文的 summary（K149 的链在这里也生效）');
  assert.equal(payload.declaredName, '', '没有原文 frontmatter ⇒ 声明名为空');
  assert.equal(payload.nameValid, false, '空声明名判不合规（安装会落 E_SKILL_NAME_INVALID）');
});

test('K151 标志不是 true 就不读译本：缺失 / "true" 字符串 / 1 / false 各一条，且 3 次请求里没有任何 lang', async () => {
  const variants = [
    ['标志缺失', { ...FPT_DETAIL, contentZhAvailable: undefined }],
    ['字符串 "true"', { ...FPT_DETAIL, contentZhAvailable: 'true' }],
    ['数字 1', { ...FPT_DETAIL, contentZhAvailable: 1 }],
    ['false', { ...FPT_DETAIL, contentZhAvailable: false }],
  ];
  for (const [label, detail] of variants) {
    const run = upstreamStub({ detail, translation: 'ok' });
    const payload = await skillhubSource.detail(REF, run.io);
    assert.equal(run.calls.length, 3, `${label}：只 3 次请求（详情 + 清单 + 原文）`);
    assert.deepEqual(run.langRequests(), [], `${label}：任何 URL 都不含 lang`);
    assert.match(payload.overview, /## Purpose/, `${label}：overview 是原文`);
    assert.equal(payload.overview.includes('## 目的'), false, `${label}：没有去读译本`);
  }

  // The real `plant-care-expert` body (flag false) behaves the same way, one row earlier.
  const run = upstreamStub({ detail: PLANT_DETAIL, files: PLANT_FILES });
  const payload = await skillhubSource.detail({ owner: 'user_883a3f62', slug: 'plant-care-expert', version: null }, run.io);
  assert.equal(run.langRequests().length, 0, 'plant-care-expert（contentZhAvailable:false）零次 lang 请求');
  assert.equal(run.calls.length, 3, '3 次请求');
  assert.equal(payload.item.slug, 'plant-care-expert', '条目照常归一');
  assert.match(payload.overview, /## 什么时候用/, 'overview 来自它自己的 SKILL.md');
  assert.equal(payload.declaredName, 'plant-care-expert', '声明名照常');
});

test('K151 declaredName 恒取原文：译文 frontmatter 的 name 不同也不采纳', async () => {
  const run = upstreamStub({ translation: 'renamed' });
  const payload = await skillhubSource.detail(REF, run.io);

  assert.match(payload.overview, /## 目的/, '前提：译本确实被读了');
  assert.equal(payload.declaredName, 'fpt-cli', 'declaredName 取原文的 name');
  assert.notEqual(payload.declaredName, '流程跟踪助手', '不是译文 frontmatter 里那个名字');

  // The install check depends on that name: an author who declares an invalid name must not
  // be rescued by a translation that happens to be valid.
  const badOrigin = new Map(FILE_BYTES);
  badOrigin.set('SKILL.md', Buffer.from(ORIGINAL_MD.replace('name: fpt-cli', 'name: Fpt Cli')));
  const renamed = upstreamStub({ files: badOrigin, translation: 'ok' });
  const payload2 = await skillhubSource.detail(REF, renamed.io);
  assert.equal(payload2.declaredName, 'Fpt Cli', '原文的名字原样给出（不做规整）');
  assert.equal(payload2.nameValid, false, '名字不合规就判不合规（译本里的 fpt-cli 不能把它救回来）');
});

test('K151 安装取件：fetchFile 发出的每一个 URL 都不含 lang，字节是作者原文', async () => {
  const run = upstreamStub({ translation: 'ok' });
  const plan = await skillhubSource.plan(REF, run.io);
  run.setPhase('install');
  run.calls.length = 0;

  const fetched = [];
  for (const file of plan.files) {
    const bytes = await skillhubSource.fetchFile(plan, file.path, run.io);
    fetched.push({ path: file.path, bytes });
  }

  assert.deepEqual(run.langRequests(), [], '安装取件没有任何一次带 lang');
  for (const call of run.calls) {
    assert.equal(call.url.includes('lang='), false, `${call.url} 不含 lang=`);
    assert.equal(call.path, '/api/v1/skills/fpt-cli/file', '安装只读 /file 这一个端点');
  }
  assert.deepEqual(fetched.map((entry) => entry.path).sort(), [...FILE_BYTES.keys()].sort(), '清单四项各取一次');

  const skill = fetched.find((entry) => entry.path === 'SKILL.md').bytes.toString('utf8');
  assert.equal(skill.startsWith('---\nname:'), true, '落盘字节以原文 frontmatter 开头');
  assert.equal(skill, ORIGINAL_MD, '与作者原文逐字相同');
  assert.equal(skill.includes('## 目的'), false, '不是译文');
});

test('K151 安装整条链路（咬住版）：上游对任何 lang 取件抛错，install 仍然成功且落盘是原文', async () => {
  const run = upstreamStub({ translation: 'ok' });
  // Warm the adapter first: this is what proves the same instance *does* ask for `lang=zh`
  // when it is reading, so the silent install leg below is not a coincidence.
  await skillhubSource.detail(REF, run.io);
  assert.equal(run.langRequests().length, 1, '前提：读概览时确实发过带 lang 的请求');

  const { dir, cleanup } = await tempDir();
  try {
    const skillsRoot = join(dir, 'skills');
    await mkdir(skillsRoot, { recursive: true });
    const store = createStore({ dshHome: dir, skillsRoot, now: () => 0 });
    const installer = createInstaller({
      skillsRoot,
      io: run.io,
      sourceById: () => skillhubSource,
      store,
      now: () => Date.now(),
    });

    run.setPhase('install');
    run.calls.length = 0;
    const result = await installer.install({ sourceId: 'skillhub', owner: REF.owner, slug: REF.slug, version: null });

    // ① 装成了，而且装的是原文
    assert.equal(result.name, 'fpt-cli', '目录名取自原文 frontmatter 的 name');
    const landed = await readFile(join(skillsRoot, 'fpt-cli', 'SKILL.md'), 'utf8');
    assert.equal(landed, ORIGINAL_MD, '落盘的 SKILL.md 与作者原文逐字相同');
    assert.equal(landed.startsWith('---\nname:'), true, '以原文 frontmatter 开头');
    assert.equal(landed.includes('## 目的'), false, '盘上没有译文正文');
    assert.equal(landed.includes('流程跟踪助手'), false, '盘上没有译文的 name');

    // ② 安装腿上的每一个 URL 都不带 lang（桩在这一腿对 lang 直接抛错，装成功即证明）
    assert.deepEqual(run.langRequests(), [], '安装腿零次 lang 请求');
    for (const call of run.calls) {
      assert.equal(call.url.includes('lang='), false, `${call.url} 不含 lang=`);
    }

    // ③ 只写清单里的文件：四项取件、盘上四个正文文件 + 两份元数据
    const installPaths = run.calls
      .filter((call) => call.path === '/api/v1/skills/fpt-cli/file')
      .map((call) => call.query.path)
      .sort();
    assert.deepEqual(installPaths, [...FILE_BYTES.keys()].sort(), '取件集合与清单逐项相同（没有 skill_zh.md 这种额外项）');
    const landing = (await readdir(join(skillsRoot, 'fpt-cli'), { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => relative(join(skillsRoot, 'fpt-cli'), join(entry.parentPath ?? entry.path, entry.name)))
      .sort();
    assert.deepEqual(landing, [
      'SKILL.md',
      '_meta.json',
      '_meta.upstream.json',
      'references/install-and-auth.md',
      'references/query-patterns.md',
    ], '盘上只有清单里的文件 + 两份元数据，没有任何译文文件（skill_zh.md）');
    assert.equal(result.files, landing.length, '上报的文件数与盘上实际一致');
    const references = await readFile(join(skillsRoot, 'fpt-cli', 'references', 'query-patterns.md'), 'utf8');
    assert.match(references, /# Query patterns/, 'references 也按原文落盘');
  } finally {
    await cleanup();
  }
});
