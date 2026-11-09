/**
 * The ClawHub source is the mirror - one origin, one package shape - and the gate that
 * keeps an empty package off the disk.
 *
 * Contract: docs/contracts/market.md §7.8 (the single-origin mirror, the four hard rules),
 * §7.2 (per-method endpoints) and §7 (the `E_PACKAGE_INVALID` table); docs/contracts/
 * routes.md §3.7.4 (the install pipeline); case ids K88 (superseded by the mirror-only
 * boundary, kept as the file's anchor), K90, K91, K92.
 *
 * Four failure modes are worth this much text because all four are silent:
 * a package taken from a stale shape installs a skeleton and records a success; a guessed
 * namespace installs somebody else's package; a `fetchFile` that follows an arbitrary
 * redirect pulls bytes from anywhere; an icon lookup that throws takes a whole batch of
 * decorations down with it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { createInstaller } from '../lib/market/install.js';
import { clawhubSource, resetIconCache } from '../lib/market/sources/clawhub.js';
import { createStore } from '../lib/market/store.js';
import { tempDir } from './helpers/tree.mjs';

/** One mirror list row for a skill, as the live endpoint publishes it. */
const mirrorRow = (slug, owner, extra = {}) => ({
  slug,
  name: `${slug} upstream title`,
  namespace: { handle: `clawhub_${owner}` },
  upstream_owner_login: owner,
  summary: 'A fixture skill.',
  downloads: 50034,
  stars: 12,
  score: 80000,
  iconUrl: 'https://cloudcache.tencent-cloud.com/qcloud/ui/static/x.png',
  category: 'dev-tools',
  version: '1.0.0',
  subCategories: [{ key: 'a', name: 'dev tools' }],
  ...extra,
});

/**
 * A fake mirror that answers every endpoint the adapter uses, and logs the paths.
 *
 * `files` is the manifest this skill is supposed to have (null means "answer an array that
 * is not an array"), and `bytes` decides what a file download returns.
 * @param {{rows?: object[], files?: object[]|null, detail?: object|null, bytes?: Buffer,
 *   fileFails?: 'redirect-foreign'|'redirect-twice'|'timeout'|'empty'|null,
 *   lookupMiss?: boolean}} [options] - behaviour.
 * @returns {{io: object, calls: string[], hosts: (name: string) => number}} the client and log.
 */
function fakeIo(options = {}) {
  const calls = [];
  const files = options.files === undefined
    ? [{ path: 'SKILL.md', size: 40 }, { path: '_meta.json', size: 12 }]
    : options.files;
  const rows = options.rows ?? [mirrorRow('cad-viewer', 'pskoett')];
  const io = {
    /**
     * Answer one JSON GET.
     * @param {URL|string} url - request URL.
     * @returns {Promise<object>} the body.
     */
    async getJson(url) {
      const parsed = new URL(String(url));
      calls.push(parsed.pathname);
      if (parsed.pathname === '/api/skills') {
        if (options.lookupMiss === true) return { data: { total: 0, skills: [] } };
        const keyword = parsed.searchParams.get('keyword') ?? '';
        // Without an explicit `rows`, the fake answers for whatever slug was asked for - a
        // lookup that always returns the same row would hide a miss.
        const answered = options.rows ?? (keyword === ''
          ? rows
          : [mirrorRow(keyword, 'pskoett', { iconUrl: `https://cdn.example.com/${keyword}.png` })]);
        return { data: { total: answered.length, skills: answered } };
      }
      if (parsed.pathname.endsWith('/files')) {
        return { files };
      }
      if (options.detail !== undefined) return options.detail;
      const slug = decodeURIComponent(parsed.pathname.split('/').at(-1));
      const row = rows.find((entry) => entry.slug === slug) ?? mirrorRow(slug, 'pskoett');
      return {
        skill: {
          slug,
          displayName: row.name,
          summary: 'From the mirror.',
          description: `---\nname: ${slug}\n---\n\nBody text.\n`,
          stats: { downloads: 50034, stars: 12 },
          category: 'dev-tools',
          updatedAt: 1762000000000,
        },
        latestVersion: { version: '1.0.0' },
        namespace: row.namespace,
      };
    },
    /**
     * Answer one file GET, or fail the way the real client would.
     * @param {URL|string} url - request URL.
     * @returns {Promise<{body: Buffer}>} the bytes.
     */
    async getBytes(url) {
      const parsed = new URL(String(url));
      calls.push(parsed.pathname);
      const failure = options.fileFails ?? null;
      if (failure === 'redirect-foreign') {
        throw Object.assign(new Error('refusing to follow a redirect to an unknown host'), { code: 'E_PACKAGE_INVALID' });
      }
      if (failure === 'redirect-twice') {
        throw Object.assign(new Error('more than one redirect'), { code: 'E_PACKAGE_INVALID' });
      }
      if (failure === 'timeout') {
        throw Object.assign(new Error('upstream did not answer in time'), { code: 'E_SOURCE_TIMEOUT' });
      }
      if (failure === 'empty') return { body: Buffer.alloc(0) };
      return { body: options.bytes ?? Buffer.from('---\nname: cad-viewer\n---\n\nBody text.\n') };
    },
  };
  return { io, calls, hosts: (name) => calls.filter((call) => call.includes(name)).length };
}

/** A reference, the shape the routes build. */
const REF = { owner: 'pskoett', slug: 'cad-viewer', version: null };

test('K88 三个方法都只打镜像：detail / plan / fetchFile 零 clawhub.ai 调用', async () => {
  const run = fakeIo();
  const page = await clawhubSource.list({ sourceId: 'clawhub', sort: 'recommended', keyword: '', category: null, limit: 4, cursor: null }, run.io);
  assert.equal(page.items.length, 1, '列表照常归一');
  assert.equal(run.hosts('clawhub.ai'), 0, 'list 不碰 clawhub.ai');

  const detail = await clawhubSource.detail(REF, run.io);
  assert.equal(detail.item.sourceId, 'clawhub', '详情来自镜像');
  const built = await clawhubSource.plan(REF, run.io);
  assert.equal(built.packageKind, 'files', '包形态是逐文件清单');
  await clawhubSource.fetchFile(built, 'SKILL.md', run.io);
  assert.equal(run.hosts('clawhub.ai'), 0, 'detail / plan / fetchFile 全在镜像上');
  for (const path of run.calls) {
    assert.equal(path.startsWith('/api/'), true, `${path} 是镜像的端点`);
  }
});

test('K88 detail 的上游请求数是 4：解析 + 详情 + 清单 + SKILL.md', async () => {
  const run = fakeIo();
  const payload = await clawhubSource.detail(REF, run.io);
  assert.deepEqual(run.calls, [
    '/api/skills',
    '/api/v1/skills/cad-viewer',
    '/api/v1/skills/cad-viewer/files',
    '/api/v1/skills/cad-viewer/file',
  ], '一次详情 = 解析 + 详情 + 清单 + 取回 SKILL.md');
  assert.equal(payload.filesComplete, true, 'files 形态恒为完整清单');
  assert.equal(payload.overview.includes('Body text.'), true, 'overview 来自 SKILL.md 正文');
  assert.equal(payload.declaredName, 'cad-viewer', '声明名从 SKILL.md 的 frontmatter 读');
  assert.deepEqual(payload.files.map((file) => file.path), ['SKILL.md', '_meta.json'], '清单原样上屏');
});

test('K88 身份与 namespace 解耦：认领过的 namespace（无 clawhub_ 前缀）照样命中', async () => {
  const rows = [mirrorRow('find-skills', 'guipi888', { namespace: { handle: 'indiv-guipi' } })];
  const run = fakeIo({ rows });
  const payload = await clawhubSource.detail({ owner: 'guipi888', slug: 'find-skills', version: null }, run.io);
  assert.equal(payload.item.owner, 'guipi888', '身份仍是原生 owner');
  assert.equal(payload.item.id, 'clawhub:guipi888:find-skills', 'id 用原生 owner 拼');
  assert.equal(payload.item.owner, 'guipi888', '身份是原生 owner，不是镜像的 namespace');
  assert.equal(payload.item.id, 'clawhub:guipi888:find-skills', 'id 用原生 owner 拼（已安装行与图标缓存同键）');
  assert.equal(payload.item.slug, 'find-skills', '条目照常归一');
});

test('K88 零命中 ⇒ E_SOURCE_BAD_RESPONSE：宁可不给详情，也不猜 namespace', async () => {
  const run = fakeIo({ lookupMiss: true });
  await assert.rejects(
    () => clawhubSource.detail(REF, run.io),
    (error) => error.code === 'E_SOURCE_BAD_RESPONSE',
    '镜像不再列这条技能 ⇒ 502',
  );
  assert.deepEqual(run.calls, ['/api/skills'], '解析失败就停手：没有再发详情或清单请求');
  await assert.rejects(
    () => clawhubSource.plan(REF, run.io),
    (error) => error.code === 'E_SOURCE_BAD_RESPONSE',
  );
});

test('K90 空清单 / 无 SKILL.md ⇒ E_PACKAGE_INVALID，且磁盘上一片纸都不留', async () => {
  for (const [label, files] of [
    ['空清单', []],
    ['没有 SKILL.md', [{ path: '_meta.json', size: 12 }]],
  ]) {
    const run = fakeIo({ files });
    await assert.rejects(
      () => clawhubSource.plan(REF, run.io),
      (error) => {
        assert.equal(error.code, 'E_PACKAGE_INVALID', `${label} ⇒ E_PACKAGE_INVALID`);
        return true;
      },
    );
  }

  // And the installer refuses the same package even if a plan somehow got past the adapter:
  // nothing lands under skills/, no temp directory survives.
  const { dir, cleanup } = await tempDir();
  try {
    const skillsRoot = join(dir, 'skills');
    const io = fakeIo({ files: [{ path: '_meta.json', size: 12 }] });
    const store = createStore({ dshHome: dir, skillsRoot, now: () => 0 });
    const source = {
      id: 'clawhub',
      caps: { search: true, paged: true, categories: false, package: 'files' },
      // A plan that skipped the adapter's own guard, on purpose.
      plan: async () => ({ sourceId: 'clawhub', owner: 'pskoett', slug: 'cad-viewer', version: '1.0.0', packageKind: 'files', files: [], meta: null, metaBytes: null }),
      fetchFile: async () => Buffer.from(''),
    };
    const installer = createInstaller({ skillsRoot, io, sourceById: () => source, store, now: () => 0 });
    await assert.rejects(() => installer.install({ sourceId: 'clawhub', owner: 'pskoett', slug: 'cad-viewer', version: null }));
    assert.equal(existsSync(skillsRoot) ? (await readdir(skillsRoot)).length : 0, 0, 'skills/ 下一个目录都没有');
    const left = (await readdir(dir)).filter((name) => name.startsWith('.skc-install-'));
    assert.deepEqual(left, [], '没有 .skc-install-* 残留');
  } finally {
    await cleanup();
  }
});

test('K90 路径不安全（../x / 绝对路径）⇒ 清单照收，安装阶段拒绝', async () => {
  // The manifest is upstream data; a path that escapes is refused where it would be written,
  // not silently dropped from the list (dropping it would make the file count lie).
  const run = fakeIo({ files: [{ path: '../evil.txt', size: 4 }, { path: 'SKILL.md', size: 40 }] });
  const plan = await clawhubSource.plan(REF, run.io);
  assert.deepEqual(plan.files.map((file) => file.path), ['../evil.txt', 'SKILL.md'], '清单原样（不做上游侧过滤）');

  const { dir, cleanup } = await tempDir();
  try {
    const skillsRoot = join(dir, 'skills');
    const store = createStore({ dshHome: dir, skillsRoot, now: () => 0 });
    const installer = createInstaller({ skillsRoot, io: run.io, sourceById: () => clawhubSource, store, now: () => 0 });
    await assert.rejects(
      () => installer.install({ sourceId: 'clawhub', owner: 'pskoett', slug: 'cad-viewer', version: '1.0.0' }),
      (error) => error.code === 'E_PACKAGE_INVALID',
      '../evil.txt 在写盘这一层被拦下',
    );
    assert.equal(existsSync(join(dir, 'evil.txt')), false, '包外没有被写出来');
    assert.equal(existsSync(skillsRoot) ? (await readdir(skillsRoot)).length : 0, 0, 'skills/ 下没有半成品');
  } finally {
    await cleanup();
  }
});

test('K91 fetchFile：清单内才发请求，302 越界 / 两次 302 / 超时 / 0 字节各有其码', async () => {
  const built = await clawhubSource.plan(REF, fakeIo().io);
  const before = fakeIo();
  await assert.rejects(
    () => clawhubSource.fetchFile(built, 'not-in-manifest.txt', before.io),
    (error) => error.code === 'E_PACKAGE_INVALID',
  );
  assert.deepEqual(before.calls, [], '清单外的路径连请求都不发');

  const ok = fakeIo();
  const bytes = await clawhubSource.fetchFile(built, 'SKILL.md', ok.io);
  assert.equal(Buffer.isBuffer(bytes), true, '清单内的路径拿到字节');
  assert.equal(bytes.toString('utf8').includes('name: cad-viewer'), true, '就是上游那份内容');

  for (const [failure, code, label] of [
    ['redirect-foreign', 'E_PACKAGE_INVALID', '302 到非白名单域'],
    ['redirect-twice', 'E_PACKAGE_INVALID', '连续两次 302'],
    ['timeout', 'E_SOURCE_TIMEOUT', '下载超时'],
  ]) {
    const run = fakeIo({ fileFails: failure });
    await assert.rejects(
      () => clawhubSource.fetchFile(built, 'SKILL.md', run.io),
      (error) => {
        assert.equal(error.code, code, `${label} ⇒ ${code}`);
        return true;
      },
    );
  }

  const empty = fakeIo({ fileFails: 'empty' });
  const zero = await clawhubSource.fetchFile(built, 'SKILL.md', empty.io);
  assert.equal(zero.length, 0, '0 字节在适配器这一层照实返回（由安装器按 E_PACKAGE_INVALID 拒绝）');
});

test('K92 icons()：双匹配、坏行降级、按请求顺序、并发 ≤6、缓存分档', async () => {
  resetIconCache();
  const rows = [
    mirrorRow('find-skills', 'robin', { iconUrl: 'https://cdn.example.com/robin.png' }),
    mirrorRow('find-skills', 'guipi888', { iconUrl: 'https://cdn.example.com/guipi.png', namespace: { handle: 'indiv-guipi' } }),
  ];
  const run = fakeIo({ rows });
  const first = await clawhubSource.icons([{ owner: 'guipi888', slug: 'find-skills' }], run.io);
  assert.equal(
    first.icons['clawhub:guipi888:find-skills'],
    'https://cdn.example.com/guipi.png',
    '只认 upstream_owner_login 相同的那条（slug 单独不唯一）',
  );
  assert.equal(first.names['clawhub:guipi888:find-skills'], 'find-skills upstream title', '标题一起回来');
  assert.equal(run.calls.length, 1, '一条查询同时出图与标题');

  // A miss is a null value, not a missing key, and never throws.
  resetIconCache();
  const miss = fakeIo({ lookupMiss: true });
  const missing = await clawhubSource.icons([{ owner: 'pskoett', slug: 'gone' }], miss.io);
  assert.deepEqual(Object.keys(missing.icons), ['clawhub:pskoett:gone'], '键在');
  assert.equal(missing.icons['clawhub:pskoett:gone'], null, '值是 null');
  assert.equal(missing.names['clawhub:pskoett:gone'], null, '标题也是 null');

  // Concurrency and ordering over a batch of nine.
  resetIconCache();
  const refs = Array.from({ length: 9 }, (unused, index) => ({ owner: 'pskoett', slug: `s${index}` }));
  let live = 0;
  let peak = 0;
  const slow = {
    async getJson(url) {
      live += 1;
      peak = Math.max(peak, live);
      try {
        await new Promise((resolve) => { setTimeout(resolve, 2); });
        const keyword = new URL(String(url)).searchParams.get('keyword') ?? '';
        return { data: { total: 1, skills: [mirrorRow(keyword, 'pskoett', { iconUrl: `https://cdn.example.com/${keyword}.png` })] } };
      } finally {
        live -= 1;
      }
    },
  };
  const batch = await clawhubSource.icons(refs, slow);
  assert.equal(peak <= 6, true, `并发不超过 6（实测峰值 ${peak}）`);
  assert.deepEqual(Object.keys(batch.icons), refs.map((ref) => `clawhub:pskoett:${ref.slug}`), '按请求顺序返回');
  assert.deepEqual(Object.keys(batch.names), Object.keys(batch.icons), 'names 与 icons 同序');

  // Positive cache: ten minutes. Negative: sixty seconds.
  resetIconCache();
  let clock = 0;
  const cached = fakeIo({});
  const one = [{ owner: 'pskoett', slug: 'cached' }];
  await clawhubSource.icons(one, cached.io, { now: () => clock });
  clock = 5 * 60 * 1000;
  await clawhubSource.icons(one, cached.io, { now: () => clock });
  assert.equal(cached.calls.length, 1, '10 分钟内命中');
  clock = 11 * 60 * 1000;
  await clawhubSource.icons(one, cached.io, { now: () => clock });
  assert.equal(cached.calls.length, 2, '过了 10 分钟重问');
});

/**
 * Install one skill through the real adapter and the real installer.
 * @param {{files: object[], bytes: string, rows?: object[]}} options - manifest and bytes.
 * @returns {Promise<{outcome: object|null, error: any, calls: {path: string, query: string}[],
 *   skillsRoot: string, dir: string, close: Function}>} the attempt and its tree.
 */
async function installThrough({ files, bytes, rows, owner = 'pskoett', slug = 'cad-viewer' }) {
  const { dir, cleanup } = await tempDir();
  const skillsRoot = join(dir, 'skills');
  await mkdir(skillsRoot, { recursive: true });
  const calls = [];
  const io = {
    async getJson(url) {
      const parsed = new URL(String(url));
      calls.push({ path: parsed.pathname, query: parsed.search });
      if (parsed.pathname === '/api/skills') {
        const keyword = parsed.searchParams.get('keyword') ?? '';
        const answered = rows ?? [mirrorRow(keyword, 'pskoett')];
        return { data: { total: answered.length, skills: answered } };
      }
      if (parsed.pathname.endsWith('/files')) return { files };
      const slug = decodeURIComponent(parsed.pathname.split('/').at(-1));
      return {
        skill: {
          slug,
          displayName: slug,
          summary: 'From the mirror.',
          description: '---\nname: cad-viewer\n---\n\nBody text.\n',
          stats: { downloads: 50034, stars: 12 },
          category: 'dev-tools',
        },
        latestVersion: { version: '1.0.0' },
        namespace: { handle: 'clawhub_pskoett' },
      };
    },
    async getBytes() {
      return { body: Buffer.from(bytes, 'utf8') };
    },
  };
  const store = createStore({ dshHome: dir, skillsRoot, now: () => 0 });
  const installer = createInstaller({ skillsRoot, io, sourceById: () => clawhubSource, store, now: () => 0 });
  let outcome = null;
  let error = null;
  try {
    outcome = await installer.install({ sourceId: 'clawhub', owner, slug, version: null });
  } catch (caught) {
    error = caught;
  }
  return { outcome, error, calls, skillsRoot, dir, close: cleanup };
}

test('K90 清单的三条边：无 sha256 就跳过校验、sha256 不符就拒、0 字节装不出空壳', async () => {
  const skillText = '---\nname: cad-viewer\n---\n\nBody.\n';

  // A1: the mirror usually omits `sha256`. Its absence is "no checksum to check", not a
  // failure - the install must still land (2 files: SKILL.md + _meta.json).
  const plain = await installThrough({ files: [{ path: 'SKILL.md', size: Buffer.byteLength(skillText) }], bytes: skillText });
  try {
    assert.equal(plain.error, null, `无 sha256 时照装（实际 ${plain.error?.code ?? 'OK'}）`);
    assert.equal(plain.outcome.files, 2, 'SKILL.md + _meta.json');
    assert.equal(plain.outcome.bytes, Buffer.byteLength(skillText), '字节数是包内文件的合计');
  } finally {
    await plain.close();
  }

  const mismatch = await installThrough({
    files: [{ path: 'SKILL.md', size: Buffer.byteLength(skillText), sha256: 'f'.repeat(64) }],
    bytes: skillText,
  });
  try {
    assert.equal(mismatch.error?.code, 'E_PACKAGE_INVALID', '清单给了 sha256 就必须核对上');
    assert.deepEqual(await readdir(mismatch.skillsRoot), [], 'skills/ 下没有半成品');
    assert.deepEqual(
      (await readdir(mismatch.dir)).filter((name) => name.startsWith('.skc-install-')),
      [],
      '没有 .skc-install-* 残留',
    );
  } finally {
    await mismatch.close();
  }

  // A file endpoint that answers 200 with zero bytes must not install an empty shell. The
  // name comes from SKILL.md, so an empty one is a 422 rather than a directory that loads
  // nothing (the `size: null` here is what stops the size check from catching it first).
  const hollow = await installThrough({ files: [{ path: 'SKILL.md', size: null }], bytes: '' });
  try {
    assert.equal(hollow.error?.code, 'E_SKILL_NAME_INVALID', '0 字节的 SKILL.md ⇒ 声明名缺失，422');
    assert.deepEqual(await readdir(hollow.skillsRoot), [], 'skills/ 下一个目录都没有（没有空壳）');
    assert.deepEqual(
      (await readdir(hollow.dir)).filter((name) => name.startsWith('.skc-install-')),
      [],
      '临时目录也清掉了',
    );
  } finally {
    await hollow.close();
  }
});

test('K90 同名不同 owner 并存时，安装请求用的是匹配那一行的 namespace（不装错人的包）', async () => {
  const rows = [
    mirrorRow('find-skills', 'robin', { namespace: { handle: 'clawhub_robin' } }),
    mirrorRow('find-skills', 'guipi888', { namespace: { handle: 'indiv-guipi' } }),
  ];
  const text = '---\nname: find-skills\n---\n\nB\n';
  const run = await installThrough({
    files: [{ path: 'SKILL.md', size: Buffer.byteLength(text) }],
    bytes: text,
    rows,
    owner: 'guipi888',
    slug: 'find-skills',
  });
  try {
    const manifestCall = run.calls.find((call) => call.path.endsWith('/files'));
    assert.ok(manifestCall !== undefined, '清单请求发出去了');
    const namespace = new URL(`https://api.skillhub.cn${manifestCall.query}`).searchParams.get('namespace');
    assert.equal(namespace, 'indiv-guipi', '用 guipi888 那一行的 namespace（认领过的，没有 clawhub_ 前缀）');
    assert.notEqual(namespace, 'clawhub_robin', '另一个 owner 的 namespace 一个字母都不许混进来');
  } finally {
    await run.close();
  }
});

test('K92 icons() 批内部分失败只让那一项为 null，其余照常返回', async () => {
  resetIconCache();
  const refs = [
    { owner: 'pskoett', slug: 'ok-one' },
    { owner: 'pskoett', slug: 'boom' },
    { owner: 'pskoett', slug: 'ok-two' },
  ];
  const io = {
    async getJson(url) {
      const keyword = new URL(String(url)).searchParams.get('keyword') ?? '';
      if (keyword === 'boom') throw Object.assign(new Error('timed out'), { code: 'E_SOURCE_TIMEOUT' });
      return { data: { total: 1, skills: [mirrorRow(keyword, 'pskoett', { iconUrl: `https://cdn.example.com/${keyword}.png` })] } };
    },
  };
  const batch = await clawhubSource.icons(refs, io);
  assert.deepEqual(Object.keys(batch.icons), refs.map((ref) => `clawhub:pskoett:${ref.slug}`), '三键都在、顺序同请求');
  assert.equal(batch.icons['clawhub:pskoett:ok-one'], 'https://cdn.example.com/ok-one.png', '前一项正常');
  assert.equal(batch.icons['clawhub:pskoett:boom'], null, '失败那一项只是 null（不抛、不拖累别人）');
  assert.equal(batch.icons['clawhub:pskoett:ok-two'], 'https://cdn.example.com/ok-two.png', '后一项不受影响');
});
