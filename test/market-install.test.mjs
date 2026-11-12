/**
 * `lib/market/install.js` + `lib/market/store.js` — the install pipeline, end to end.
 *
 * Contract: docs/contracts/routes.md §3.7.4 (the fourteen stages and the "no half a
 * skill" predicate) and docs/contracts/market.md §7.4 (`_meta.json` shape); case id K34.
 *
 * Every case runs against a throwaway `dshHome` and `skillsRoot` under `os.tmpdir()`.
 * Nothing in this file may touch `~/.dsh/skills`: a test that writes there would
 * corrupt the machine it runs on, and the whole point of the temp roots is that the
 * pipeline cannot tell the difference.
 *
 * The upstream is a fake adapter, not a mock of `fetch`: the adapter contract (§7.1)
 * says a source never touches the network itself, so injecting one is exactly what the
 * production wiring does.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { readLedger } from '../lib/ledger.js';
import { MAX_CONCURRENT_INSTALLS, createInstaller, INSTALL_BUDGET_MS } from '../lib/market/install.js';
import { createStore, storeFile } from '../lib/market/store.js';
import { tempDir } from './helpers/tree.mjs';

/** The source id every fake adapter answers to. */
const SOURCE = 'faketest';

/** A `SKILL.md` declaring the given name. */
function skillText(name, extra = '') {
  return `---\nname: ${name}\ndescription: A fixture package.\n---\n\n# ${name}\n\n${extra}`;
}

/**
 * A deferred promise, for holding one install inside `fetchFile`.
 * @returns {{promise: Promise<void>, resolve: Function}} the handle.
 */
function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

/**
 * Wait until a predicate holds, or fail after a bounded number of turns.
 *
 * The concurrency cases need "both installs are inside the gate" before the third
 * call is meaningful; a fixed sleep is a coin flip under a parallel test runner.
 * @param {() => boolean} predicate - condition to reach.
 * @param {string} hint - what we were waiting for.
 * @returns {Promise<void>} resolves once it holds.
 */
async function waitFor(predicate, hint) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${hint}`);
}

/**
 * Build a fake source adapter around one package.
 *
 * @param {{files?: Record<string, string>, meta?: object|null, metaBytes?: string,
 *   version?: string, fail?: {at: 'plan'|'fetch', code: string, path?: string},
 *   gate?: Promise<void>}} [options] - package shape and injected failures.
 * @returns {object} the adapter, with a `calls` log of every fetched path.
 */
function fakeSource(options = {}) {
  const files = options.files ?? { 'SKILL.md': skillText('dev-god') };
  const calls = [];
  const meta = options.meta === undefined ? null : options.meta;
  const metaBytes = options.metaBytes === undefined ? undefined : options.metaBytes;
  return {
    id: SOURCE,
    labelKey: `market.source.${SOURCE}`,
    caps: { search: false, paged: false, categories: false, package: 'files' },
    calls,
    /**
     * Return the package manifest.
     * @returns {Promise<object>} SourcePlan.
     */
    async plan() {
      if (options.fail?.at === 'plan') {
        throw Object.assign(new Error('upstream said no'), { code: options.fail.code });
      }
      const plan = {
        version: options.version ?? '1.0.0',
        files: Object.keys(files).map((path) => ({ path, size: Buffer.byteLength(files[path]) })),
        meta,
      };
      if (metaBytes !== undefined) plan.metaBytes = Buffer.from(metaBytes, 'utf8');
      return plan;
    },
    /**
     * Serve one file of the package, logging the request.
     * @param {object} plan - manifest.
     * @param {string} path - package path.
     * @returns {Promise<Buffer>} the bytes.
     */
    async fetchFile(plan, path) {
      calls.push(path);
      if (options.gate !== undefined) await options.gate;
      if (options.fail?.at === 'fetch' && (options.fail.path === undefined || options.fail.path === path)) {
        throw Object.assign(new Error('connection reset'), { code: options.fail.code });
      }
      if (files[path] === undefined) throw Object.assign(new Error(`no ${path}`), { code: 'E_SOURCE_BAD_RESPONSE' });
      return Buffer.from(files[path], 'utf8');
    },
  };
}

/**
 * Build a temp DSH home, its skills root, the store and an installer.
 * @param {object} source - the fake adapter.
 * @param {{now?: () => number, store?: object}} [options] - clock and ledger overrides.
 * @returns {Promise<{dshHome: string, skillsRoot: string, store: object, install: Function,
 *   cleanup: () => Promise<void>}>} the rig.
 */
async function rig(source, options = {}) {
  const { dir, cleanup } = await tempDir();
  const skillsRoot = join(dir, 'skills');
  await mkdir(skillsRoot, { recursive: true });
  const now = options.now ?? (() => Date.parse('2026-11-09T06:00:00.000Z'));
  const store = options.store ?? createStore({ dshHome: dir, skillsRoot, now });
  // A holder, not a bound reference: an update test installs 1.0.0 from one package and
  // then hands the same source id a different package (2.0.0), which is exactly what the
  // market does between two versions of one skill.
  const holder = { source };
  const installer = createInstaller({
    skillsRoot,
    io: {},
    sourceById: (id) => (id === SOURCE ? holder.source : undefined),
    store,
    now,
  });
  return {
    dshHome: dir,
    skillsRoot,
    store,
    install: installer.install,
    update: installer.update,
    /** Point the source id at another package (the next version). */
    useSource: (next) => { holder.source = next; },
    cleanup,
  };
}

/** The ref every case installs. */
const REF = { sourceId: SOURCE, owner: 'ake', slug: 'dev-god', version: '1.0.0' };

/**
 * Names under a directory, sorted; missing directories answer `[]`.
 * @param {string} dir - directory.
 * @returns {Promise<string[]>} entry names.
 */
async function entriesOf(dir) {
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}

/**
 * The staging directories an install may leave behind.
 * @param {string} dir - skills root.
 * @returns {Promise<string[]>} leftovers (must always be empty).
 */
async function stagingLeftovers(dir) {
  return (await entriesOf(dir)).filter((entry) => entry.startsWith('.skc-install-'));
}

/**
 * Every dot-prefixed working directory an install or an update may leave behind.
 * @param {string} dir - skills root.
 * @returns {Promise<string[]>} leftovers (must be empty after both success and failure).
 */
async function workLeftovers(dir) {
  return (await entriesOf(dir)).filter((entry) => entry.startsWith('.skc-install-')
    || entry.startsWith('.skc-update-') || entry.startsWith('.skc-backup-'));
}

test('K34 成功路径：SKILL.md + _meta.json{source,ownerId,slug,version} + 台账，且台账被 lib/ledger.js 读出', async () => {
  const source = fakeSource({
    files: {
      'SKILL.md': skillText('dev-god'),
      'scripts/run.md': '# run\n',
      'docs/guide.md': '# guide\n',
    },
  });
  const card = await rig(source);
  try {
    const result = await card.install(REF);
    assert.equal(result.name, 'dev-god', '落盘名取包内声明名');
    assert.equal(result.path, join(card.skillsRoot, 'dev-god'), '落点是 skillsRoot/<name>');
    assert.equal(result.version, '1.0.0', '版本回传给调用方');
    assert.equal(result.source, SOURCE, '来源回传');
    assert.equal(result.owner, 'ake', 'owner 回传');
    assert.equal(result.slug, 'dev-god', 'slug 回传');
    assert.equal(result.files, 4, '三个包内文件 + 一个 _meta.json');
    assert.equal(result.bytes, Buffer.byteLength(skillText('dev-god')) + Buffer.byteLength('# run\n') + Buffer.byteLength('# guide\n'),
      'bytes 只算包内文件');

    assert.equal(await readFile(join(result.path, 'SKILL.md'), 'utf8'), skillText('dev-god'), 'SKILL.md 逐字节落盘');
    assert.equal(await readFile(join(result.path, 'scripts', 'run.md'), 'utf8'), '# run\n', '子目录文件也落盘（父目录自动建）');
    assert.equal((await stat(join(result.path, 'scripts'))).isDirectory(), true, '父目录真的是目录');

    const meta = JSON.parse(await readFile(join(result.path, '_meta.json'), 'utf8'));
    assert.equal(meta.source, SOURCE, '_meta.json 的 source 是来源 id（scan 的 R6）');
    assert.equal(meta.ownerId, 'ake', 'ownerId 非空（scan 的 R7 要求 ownerId + slug）');
    assert.equal(meta.slug, 'dev-god', 'slug 非空');
    assert.equal(meta.version, '1.0.0', 'version 是解析出的版本');
    assert.equal(meta.name, 'dev-god', 'name 与目录名一致（回读会断言）');
    assert.equal(meta.installedAt, '2026-11-09T06:00:00.000Z', 'installedAt 是注入时钟的 ISO 串');

    const ledger = await card.store.read();
    assert.equal(ledger.readable, true, '台账可读');
    assert.equal(ledger.doc.installs.length, 1, '台账一条记录');
    assert.deepEqual(
      { ...ledger.doc.installs[0], installedAt: undefined },
      {
        source: SOURCE,
        owner: 'ake',
        slug: 'dev-god',
        name: 'dev-god',
        version: '1.0.0',
        files: 4,
        bytes: result.bytes,
        installedAt: undefined,
      },
      '台账记录形状与 §3.7.4 一致',
    );

    const facts = await readLedger(card.dshHome, card.skillsRoot);
    assert.equal(facts.sources.includes('own-record'), true, `lib/ledger.js 认得这份台账（实际 ${facts.sources.join(',')}）`);
    assert.equal(facts.entries.has('dev-god'), true, 'own-record 读出了技能名（因此 classify 判 R5）');
    assert.deepEqual(facts.diagnostics, [], '台账没有降级诊断');
    assert.deepEqual(await stagingLeftovers(card.skillsRoot), [], '落位成功后没有临时目录');
  } finally {
    await card.cleanup();
  }
});

test('K34 同名已存在：409 E_ALREADY_INSTALLED，带 data.path 与 data.existing', async () => {
  const source = fakeSource();
  const card = await rig(source);
  try {
    await card.install(REF);
    await assert.rejects(() => card.install(REF), (error) => {
      assert.equal(error.code, 'E_ALREADY_INSTALLED', '第二次安装报 E_ALREADY_INSTALLED');
      assert.equal(error.detail.path, join(card.skillsRoot, 'dev-god'), 'data.path 指出已装在哪');
      assert.deepEqual(error.detail.existing, { name: 'dev-god', version: '1.0.0' }, 'data.existing 报出版本');
      return true;
    });
    assert.equal(source.calls.filter((path) => path === 'SKILL.md').length, 2, '冲突判定只花了 1 次 SKILL.md 请求（第二次安装一次）');
    assert.equal(source.calls.includes('scripts/run.md'), false, '冲突时不下载其余文件');
  } finally {
    await card.cleanup();
  }
});

test('K34 同名目录若由别的工具写（无 _meta.json）：existing.version 是 null，不是请求里的版本', async () => {
  const source = fakeSource();
  const card = await rig(source);
  try {
    await mkdir(join(card.skillsRoot, 'dev-god'), { recursive: true });
    await writeFile(join(card.skillsRoot, 'dev-god', 'SKILL.md'), skillText('dev-god'));
    await assert.rejects(() => card.install(REF), (error) => {
      assert.equal(error.code, 'E_ALREADY_INSTALLED', '目录已存在即拒绝');
      assert.equal(error.detail.existing.version, null, '读不到别人目录的版本就报 null');
      return true;
    });
  } finally {
    await card.cleanup();
  }
});

test('K34 同名目标是文件或软链也拒绝（目录 / 文件 / 软链一视同仁）', async () => {
  const source = fakeSource();
  const card = await rig(source);
  try {
    await writeFile(join(card.skillsRoot, 'dev-god'), 'not a directory');
    await assert.rejects(() => card.install(REF), (error) => {
      assert.equal(error.code, 'E_ALREADY_INSTALLED', '同名文件同样算「已存在」');
      return true;
    });
  } finally {
    await card.cleanup();
  }
});

test('K34 非法声明名：422 E_SKILL_NAME_INVALID，只取 1 个文件，skillsRoot 条目集合不变', async () => {
  for (const declared of ['Design', 'Bad_Name', 'a--b', '']) {
    const source = fakeSource({
      files: {
        'SKILL.md': declared === '' ? 'no frontmatter at all\n' : skillText(declared),
        'scripts/run.md': '# run\n',
        'README.md': '# readme\n',
      },
    });
    const card = await rig(source);
    try {
      const before = await entriesOf(card.skillsRoot);
      await assert.rejects(() => card.install(REF), (error) => {
        assert.equal(error.code, 'E_SKILL_NAME_INVALID', `声明名 ${JSON.stringify(declared)} 应 422`);
        assert.equal(error.detail.declaredName, declared, 'data.declaredName 回显原文（不改名）');
        return true;
      });
      assert.deepEqual(source.calls, ['SKILL.md'], '判名阶段只花了 1 次文件请求（不下载整包）');
      assert.deepEqual(await entriesOf(card.skillsRoot), before, 'skillsRoot 条目集合逐条相同');
      assert.deepEqual(await stagingLeftovers(card.skillsRoot), [], '没有留下 .skc-install-*');
      assert.deepEqual(await card.store.read(), { doc: { version: 1, installs: [] }, readable: false }, '台账没有写');
    } finally {
      await card.cleanup();
    }
  }
});

test('K34 上游失败：plan 阶段原样上抛 502/503/504；取文件阶段按 §8.6 归一', async () => {
  // §3.7.4 S2 说 plan 阶段「502/503/504 透传」；§8.6 说「单文件下载阶段把 503/502 归一成
  // E_DOWNLOAD_FAILED」，而超时不在归一之列（120s 预算与 30s 单文件各报各的）。
  const expected = [
    { at: 'plan', code: 'E_SOURCE_UNAVAILABLE', expect: 'E_SOURCE_UNAVAILABLE' },
    { at: 'plan', code: 'E_SOURCE_TIMEOUT', expect: 'E_SOURCE_TIMEOUT' },
    { at: 'plan', code: 'E_SOURCE_BAD_RESPONSE', expect: 'E_SOURCE_BAD_RESPONSE' },
    { at: 'fetch', code: 'E_SOURCE_UNAVAILABLE', expect: 'E_DOWNLOAD_FAILED' },
    { at: 'fetch', code: 'E_SOURCE_BAD_RESPONSE', expect: 'E_DOWNLOAD_FAILED' },
    { at: 'fetch', code: 'E_SOURCE_TIMEOUT', expect: 'E_SOURCE_TIMEOUT' },
  ];
  for (const { at, code, expect } of expected) {
    const source = fakeSource({ files: { 'SKILL.md': skillText('dev-god'), 'a.md': 'a' }, fail: { at, code } });
    const card = await rig(source);
    try {
      const before = await entriesOf(card.skillsRoot);
      await assert.rejects(() => card.install(REF), (error) => {
        assert.equal(error.code, expect, `${code}@${at} 应报 ${expect}`);
        return true;
      });
      assert.deepEqual(await entriesOf(card.skillsRoot), before, `${code}@${at}：目录集合逐条相同`);
      assert.deepEqual(await stagingLeftovers(card.skillsRoot), [], `${code}@${at}：没有留下 .skc-install-*`);
      assert.equal(existsSync(storeFile(card.dshHome)), false, `${code}@${at}：台账文件不存在（没写）`);
      assert.deepEqual(await card.store.read(), { doc: { version: 1, installs: [] }, readable: false }, '读出来仍是空台账');
    } finally {
      await card.cleanup();
    }
  }
});

test('K34 取单文件时的上游失败归一成 502 E_DOWNLOAD_FAILED（不是 503）', async () => {
  const source = fakeSource({
    files: { 'SKILL.md': skillText('dev-god'), 'scripts/run.md': '# run\n' },
    fail: { at: 'fetch', code: 'E_SOURCE_UNAVAILABLE', path: 'scripts/run.md' },
  });
  const card = await rig(source);
  try {
    await assert.rejects(() => card.install(REF), (error) => {
      assert.equal(error.code, 'E_DOWNLOAD_FAILED', '安装中取文件失败是 E_DOWNLOAD_FAILED（§8.6）');
      assert.equal(error.detail.path, 'scripts/run.md', 'data.path 指出是哪个文件');
      return true;
    });
    assert.deepEqual(await stagingLeftovers(card.skillsRoot), [], '临时目录被删掉');
    assert.deepEqual(await entriesOf(card.skillsRoot), [], 'skillsRoot 为空');
  } finally {
    await card.cleanup();
  }
});

test('K34 并发同名：第二次 429 E_INSTALL_BUSY，且只落一份', async () => {
  const gate = deferred();
  const source = fakeSource({
    files: { 'SKILL.md': skillText('dev-god'), 'scripts/run.md': '# run\n' },
    gate: gate.promise,
  });
  const card = await rig(source);
  try {
    const first = card.install(REF);
    // 等第一个安装走到 fetchFile 并停住（此时锁已经拿到）。
    await waitFor(() => source.calls.includes('SKILL.md'), 'the first install to reach fetchFile');
    await assert.rejects(() => card.install(REF), (error) => {
      assert.equal(error.code, 'E_INSTALL_BUSY', '同一目标的第二个安装报 429');
      return true;
    });
    gate.resolve();
    const result = await first;
    assert.equal(result.name, 'dev-god', '第一个安装照常完成');
    assert.deepEqual(await entriesOf(card.skillsRoot), ['dev-god'], '只落了一份目录');
    const ledger = await card.store.read();
    assert.equal(ledger.doc.installs.length, 1, '台账只有一条');
  } finally {
    gate.resolve();
    await card.cleanup();
  }
});

test('K34 全局并发上限 2：第三个不同目标的安装 429', async () => {
  assert.equal(MAX_CONCURRENT_INSTALLS, 2, '全局同时最多两个安装（§3.7.2）');
  const gate = deferred();
  const source = fakeSource({
    files: { 'SKILL.md': skillText('dev-god'), 'scripts/run.md': '# run\n' },
    gate: gate.promise,
  });
  const card = await rig(source);
  try {
    // 两个后台安装都可能各自失败（第二个会撞同名），所以一创建就挂上 catch，
    // 免得测试跑完时留下未处理的 rejection。
    const first = card.install(REF).catch((error) => error);
    const second = card.install({ ...REF, slug: 'other', version: '1.0.0' }).catch((error) => error);
    // 两个安装都必须在闸里（fetchFile 已调用），第三个才有确定的结果。
    await waitFor(
      () => source.calls.filter((path) => path === 'SKILL.md').length >= 2,
      'both installs to reach fetchFile',
    );
    // 同一个包声明同一个名字，所以第二个会撞同名；这里只关心第三个被并发闸挡下。
    await assert.rejects(
      () => card.install({ ...REF, owner: 'second', slug: 'third' }),
      (error) => {
        assert.equal(error.code, 'E_INSTALL_BUSY', '第三个安装报 429');
        return true;
      },
    );
    gate.resolve();
    await first;
    await second;
  } finally {
    gate.resolve();
    await card.cleanup();
  }
});

test('K34 安装预算 120s：预算耗尽报 504 E_SOURCE_TIMEOUT', async () => {
  assert.equal(INSTALL_BUDGET_MS, 120000, '整包预算 120 秒（§3.7.2）');
  let tick = 0;
  const source = fakeSource({ files: { 'SKILL.md': skillText('dev-god'), 'a.md': 'a' } });
  const card = await rig(source, { now: () => (tick++ === 0 ? 0 : 200000) });
  try {
    await assert.rejects(() => card.install(REF), (error) => {
      assert.equal(error.code, 'E_SOURCE_TIMEOUT', '预算耗尽报 E_SOURCE_TIMEOUT');
      return true;
    });
    assert.deepEqual(await entriesOf(card.skillsRoot), [], '预算耗尽后没落盘');
  } finally {
    await card.cleanup();
  }
});

test('K34 包内 _meta.json：保留原字段，原文另存 _meta.upstream.json', async () => {
  const upstreamMeta = { schema: 'v2', channel: 'beta', version: '1.0.0' };
  const source = fakeSource({
    files: {
      'SKILL.md': skillText('dev-god'),
      '_meta.json': `${JSON.stringify(upstreamMeta, null, 2)}\n`,
    },
    meta: upstreamMeta,
    metaBytes: `${JSON.stringify(upstreamMeta, null, 2)}\n`,
  });
  const card = await rig(source);
  try {
    const result = await card.install(REF);
    const kept = await readFile(join(result.path, '_meta.upstream.json'), 'utf8');
    assert.equal(kept, `${JSON.stringify(upstreamMeta, null, 2)}\n`, '包内原件逐字节保留');
    const meta = JSON.parse(await readFile(join(result.path, '_meta.json'), 'utf8'));
    assert.equal(meta.schema, 'v2', '包自身字段被保留');
    assert.equal(meta.channel, 'beta', '包自身字段被保留（第二个）');
    assert.equal(meta.source, SOURCE, '补充了 source（R6 要它）');
    assert.equal(meta.ownerId, 'ake', '补充了 ownerId（R7 要它）');
    assert.equal(meta.slug, 'dev-god', '补充了 slug（R7 要它）');
    // 口径（routes.md §3.7.1）：`files` 是**落盘去重后的路径数**，`bytes` 是**包内字节合计**。
    // 包里自带 _meta.json 时它被我们覆盖（原文另存 _meta.upstream.json），因此磁盘上只有
    // 三个路径：SKILL.md、_meta.json、_meta.upstream.json —— 被覆盖的那份不再重复计。
    const onDisk = (await entriesOf(result.path)).sort();
    assert.deepEqual(onDisk, ['SKILL.md', '_meta.json', '_meta.upstream.json'], '磁盘上三个路径');
    assert.equal(result.files, 3, 'files = 落盘去重路径数（3）');
    assert.equal(result.files, onDisk.length, 'files 与磁盘条目数逐条对得上（口径一致）');
    assert.equal(
      result.bytes,
      Buffer.byteLength(skillText('dev-god')) + Buffer.byteLength(`${JSON.stringify(upstreamMeta, null, 2)}\n`),
      'bytes = 包内文件字节合计（不含 _meta.upstream.json 的副本）',
    );
  } finally {
    await card.cleanup();
  }
});

test('K34 包声明的版本与请求版本不符：422 E_PACKAGE_INVALID', async () => {
  const source = fakeSource({ meta: { version: '9.9.9' }, version: '1.0.0' });
  const card = await rig(source);
  try {
    await assert.rejects(() => card.install(REF), (error) => {
      assert.equal(error.code, 'E_PACKAGE_INVALID', '版本不符是包不合规');
      return true;
    });
    assert.deepEqual(await entriesOf(card.skillsRoot), [], '没有落盘');
  } finally {
    await card.cleanup();
  }
});

test('K34 清单里出现包外路径：422 E_PACKAGE_INVALID，且不会去请求那个路径', async () => {
  const source = fakeSource({ files: { 'SKILL.md': skillText('dev-god'), '../escape.md': 'x' } });
  const card = await rig(source);
  try {
    await assert.rejects(() => card.install(REF), (error) => {
      assert.equal(error.code, 'E_PACKAGE_INVALID', '越界路径整包拒绝');
      return true;
    });
    assert.equal(source.calls.includes('../escape.md'), false, '越界路径从未被请求');
    assert.deepEqual(await entriesOf(card.skillsRoot), [], '包外没有写出任何东西');
    assert.equal(existsSync(join(card.dshHome, 'escape.md')), false, '包外目录里也没有多出文件');
  } finally {
    await card.cleanup();
  }
});

test('K34 清单为空或返回非数组：422 E_PACKAGE_INVALID', async () => {
  for (const plan of [{ files: [] }, { files: 'nope' }, {}]) {
    const source = fakeSource();
    source.plan = async () => ({ version: '1.0.0', meta: null, ...plan });
    const card = await rig(source);
    try {
      await assert.rejects(() => card.install(REF), (error) => {
        assert.equal(error.code, 'E_PACKAGE_INVALID', '空清单 / 非数组一律拒绝');
        return true;
      });
      assert.deepEqual(await entriesOf(card.skillsRoot), [], '没有落盘');
    } finally {
      await card.cleanup();
    }
  }
});

test('K34 台账写失败：目录保留（唯一允许「目录在、台账不在」的窗口），报 500 E_INSTALL_IO', async () => {
  const source = fakeSource();
  const failingStore = {
    append: async () => { throw new Error('disk full'); },
    installed: async () => ({ items: {}, readable: false }),
    read: async () => ({ doc: { version: 1, installs: [] }, readable: false }),
  };
  const card = await rig(source, { store: failingStore });
  try {
    await assert.rejects(() => card.install(REF), (error) => {
      assert.equal(error.code, 'E_INSTALL_IO', '台账写失败报 E_INSTALL_IO');
      assert.equal(error.message.includes('landed'), true, 'message 说明技能已落位');
      assert.equal(error.detail.name, 'dev-god', 'data.name 说明落的是哪一个');
      return true;
    });
    assert.equal(existsSync(join(card.skillsRoot, 'dev-god', 'SKILL.md')), true, '目录按约定保留（不产生坏数据）');
    assert.deepEqual(await stagingLeftovers(card.skillsRoot), [], '临时目录仍被清掉');
  } finally {
    await card.cleanup();
  }
});

test('K34 未知来源：400 E_BAD_QUERY（安装器自己判，不靠路由）', async () => {
  const card = await rig(fakeSource());
  try {
    await assert.rejects(
      () => card.install({ ...REF, sourceId: 'nope' }),
      (error) => {
        assert.equal(error.code, 'E_BAD_QUERY', '未注册的源报 E_BAD_QUERY');
        return true;
      },
    );
  } finally {
    await card.cleanup();
  }
});

test('K34 同一次安装不会把同一路径写两遍（清单去重由写入层兜底）', async () => {
  const source = fakeSource({ files: { 'SKILL.md': skillText('dev-god'), 'dup.md': 'a' } });
  const originalPlan = source.plan;
  source.plan = async () => {
    const plan = await originalPlan();
    plan.files.push({ path: 'dup.md', size: 1 });
    return plan;
  };
  const card = await rig(source);
  try {
    await assert.rejects(() => card.install(REF), (error) => {
      assert.equal(error.code, 'E_PACKAGE_INVALID', '同一路径出现两次 ⇒ 包不合规');
      return true;
    });
    assert.deepEqual(await entriesOf(card.skillsRoot), [], '失败后目录不残留');
  } finally {
    await card.cleanup();
  }
});

test('K34 _meta.json 的目录权限是 0755、文件 0644（不保留包内可执行位）', async () => {
  const source = fakeSource({ files: { 'SKILL.md': skillText('dev-god'), 'run.sh': '#!/bin/sh\necho hi\n' } });
  const card = await rig(source);
  try {
    const result = await card.install(REF);
    const fileMode = (await lstat(join(result.path, 'run.sh'))).mode & 0o777;
    assert.equal(fileMode, 0o644, '文件一律 0644（可执行位不保留）');
    const dirMode = (await lstat(result.path)).mode & 0o777;
    assert.equal(dirMode & 0o111, 0o111, '目录带执行位（0755 语义，受 umask 影响只看 x 位）');
  } finally {
    await card.cleanup();
  }
});

test('K34 安装失败的清理是可重复的：连续失败三次后目录仍然是空的', async () => {
  const source = fakeSource({ fail: { at: 'fetch', code: 'E_SOURCE_TIMEOUT' } });
  const card = await rig(source);
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await assert.rejects(() => card.install(REF));
    }
    assert.deepEqual(await entriesOf(card.skillsRoot), [], 'skillsRoot 仍为空');
    assert.equal(existsSync(storeFile(card.dshHome)), false, '台账仍未创建');
  } finally {
    await card.cleanup();
  }
});

/* ------------------- K123/K124 · 覆盖安装：成功、启用状态往返、四条回滚 ------------------- */

/** The 2.0.0 package every update test installs over 1.0.0. */
const UPDATE_REF = { sourceId: SOURCE, owner: 'ake', slug: 'dev-god', version: '2.0.0', name: 'dev-god' };

/**
 * Install 1.0.0 and point the source at 2.0.0, the way the market moves between releases.
 * @param {object} card - the rig.
 * @param {object} next - the 2.0.0 package.
 * @returns {Promise<string>} the installed directory.
 */
async function installThenStage(card, next) {
  await card.install(REF);
  card.useSource(next);
  return join(card.skillsRoot, 'dev-god');
}

test('K123 更新成功：全量文件 + _meta.json version=to + 台账一次 + 无任何点开头残留', async () => {
  const v1 = fakeSource({ files: { 'SKILL.md': skillText('dev-god'), 'scripts/old.md': 'old\n' } });
  const v2 = fakeSource({
    version: '2.0.0',
    files: { 'SKILL.md': skillText('dev-god', 'v2 body'), 'scripts/new.md': '# new\n' },
  });
  const card = await rig(v1);
  try {
    const target = await installThenStage(card, v2);
    const result = await card.update(UPDATE_REF, target);
    assert.equal(result.name, 'dev-god', '名字不变（包内声明名逐字相等才允许更新）');
    assert.equal(result.path, target, '落点就是原目录');
    assert.equal(result.version, '2.0.0', '版本是目标版本');
    assert.equal(result.from, '1.0.0', 'from 读出更新前的版本');
    assert.equal(result.files, 3, '两个包内文件 + 一个 _meta.json');
    assert.equal(result.bytes, Buffer.byteLength(skillText('dev-god', 'v2 body')) + Buffer.byteLength('# new\n'),
      'bytes 只算包内文件（口径与 install 逐字相同）');

    const skillAfter = await readFile(join(target, 'SKILL.md'), 'utf8');
    // 新包的字节 + 一行显式的启用状态（U5 把「缺 = 启用」写成 `false`，让状态在文件里可见）。
    assert.equal(
      skillAfter,
      skillText('dev-god', 'v2 body').replace('description: A fixture package.\n', 'description: A fixture package.\ndisable-model-invocation: false\n'),
      'SKILL.md 换成新包的字节（只多一行搬运过来的启用状态）',
    );
    assert.equal(await readFile(join(target, 'scripts', 'new.md'), 'utf8'), '# new\n', '新包的文件都在');
    assert.equal(existsSync(join(target, 'scripts', 'old.md')), false, '旧版本独有的文件不残留（整目录替换，不是覆盖合并）');
    const meta = JSON.parse(await readFile(join(target, '_meta.json'), 'utf8'));
    assert.equal(meta.version, '2.0.0', '_meta.json 的 version 是 to');
    assert.equal(meta.source, SOURCE, 'source 不变');
    assert.equal(meta.ownerId, 'ake', 'ownerId 不变');
    assert.equal(meta.slug, 'dev-god', 'slug 不变');

    const ledger = await card.store.read();
    assert.equal(ledger.doc.installs.length, 1, '台账一条：同名覆盖（append 按 source:owner:slug:name 覆盖，不追加第二条）');
    assert.equal(ledger.doc.installs[0].version, '2.0.0', '覆盖后记的是新版本');
    assert.equal(ledger.doc.installs[0].name, 'dev-god', '记的是被更新的名字');
    assert.equal(ledger.doc.installs[0].owner, 'ake', 'owner 不变');
    assert.equal(ledger.doc.installs[0].slug, 'dev-god', 'slug 不变');
    assert.deepEqual(await workLeftovers(card.skillsRoot), [], '成功之后既没有 .skc-update-* 也没有 .skc-backup-*');
  } finally {
    await card.cleanup();
  }
});

test('K123 启用状态往返：停用 → 更新 → 仍停用；启用 → 更新 → 仍启用', async () => {
  // 停用方向：用户在这一页关掉了开关，覆盖安装必须把那一行搬到新包上。
  const disabledAtSource = skillText('dev-god').replace(
    'description: A fixture package.\n',
    'description: A fixture package.\ndisable-model-invocation: true\n',
  );
  const v1 = fakeSource({ files: { 'SKILL.md': skillText('dev-god') } });
  const v2 = fakeSource({ version: '2.0.0', files: { 'SKILL.md': skillText('dev-god', 'v2') } });
  const card = await rig(v1);
  try {
    const target = await installThenStage(card, v2);
    await writeFile(join(target, 'SKILL.md'), disabledAtSource);
    const result = await card.update(UPDATE_REF, target);
    assert.equal(result.from, '1.0.0', 'from 仍从 _meta.json 读（不是从新包猜）');
    const after = await readFile(join(target, 'SKILL.md'), 'utf8');
    assert.ok(after.includes('v2'), '确实是新包的正文');
    assert.ok(after.includes('disable-model-invocation: true'), '停用状态被搬到新包上');
    assert.equal(
      after.split('\n').filter((line) => line.startsWith('disable-model-invocation')).length,
      1,
      '只有一行（不追加第二行）',
    );
  } finally {
    await card.cleanup();
  }

  // 启用方向：旧版本启用，新包自己写着 true（上游带的）⇒ 更新后必须变成 false。
  const v2Disabled = fakeSource({
    version: '2.0.0',
    files: { 'SKILL.md': disabledAtSource.replace('# dev-god\n', '# dev-god\n\nv2\n') },
  });
  const enabledV1 = fakeSource({ files: { 'SKILL.md': skillText('dev-god') } });
  const other = await rig(enabledV1);
  try {
    const target = await installThenStage(other, v2Disabled);
    await other.update(UPDATE_REF, target);
    const after = await readFile(join(target, 'SKILL.md'), 'utf8');
    assert.ok(after.includes('disable-model-invocation: false'), '启用态覆盖新包里的 true（用户状态优先于上游）');
    assert.equal(after.includes('disable-model-invocation: true'), false, '不再有停用那一行');
  } finally {
    await other.cleanup();
  }
});

test('K123 CRLF 夹具：状态搬运只做字节手术，新包自己的行尾与 BOM 原样', async () => {
  const crlf = (name, extraHeader = '') => `---\r\nname: ${name}\r\ndescription: A fixture package.\r\n${extraHeader}---\r\n\r\n# ${name}\r\n`;
  const v1 = fakeSource({ files: { 'SKILL.md': crlf('dev-god') } });
  const v2 = fakeSource({ version: '2.0.0', files: { 'SKILL.md': crlf('dev-god') } });
  const card = await rig(v1);
  try {
    const target = await installThenStage(card, v2);
    await writeFile(join(target, 'SKILL.md'), crlf('dev-god', 'disable-model-invocation: true\r\n'));
    await card.update(UPDATE_REF, target);
    const text = (await readFile(join(target, 'SKILL.md'))).toString('utf8');
    assert.ok(text.includes('disable-model-invocation: true'), '状态搬过来了');
    assert.equal(/[^\r]\n/.test(text), false, '没有一行被洗成裸 LF（硬约束 7 / K73）');
    assert.equal(text.startsWith('\ufeff'), false, '没有凭空多出 BOM');
  } finally {
    await card.cleanup();
  }

  // 反方向：旧文件是 CRLF、新包是 LF ⇒ 新包仍是 LF（旧文件的行尾不属于新文件）。
  const lfV2 = fakeSource({ version: '2.0.0', files: { 'SKILL.md': skillText('dev-god', 'v2') } });
  const crlfV1 = fakeSource({ files: { 'SKILL.md': crlf('dev-god') } });
  const mixed = await rig(crlfV1);
  try {
    const target = await installThenStage(mixed, lfV2);
    await writeFile(join(target, 'SKILL.md'), crlf('dev-god', 'disable-model-invocation: true\r\n'));
    await mixed.update(UPDATE_REF, target);
    const text = (await readFile(join(target, 'SKILL.md'))).toString('utf8');
    assert.ok(text.includes('disable-model-invocation: true'), '状态搬过来了');
    assert.equal(text.includes('\r'), false, '新包自己的 LF 没有被旧文件的 CRLF 污染');
  } finally {
    await mixed.cleanup();
  }
});

test('K124 预取阶段失败：旧版本逐字节不变、无残留、台账不变', async () => {
  const v1 = fakeSource({ files: { 'SKILL.md': skillText('dev-god'), 'scripts/keep.md': 'keep\n' } });
  const v2 = fakeSource({
    version: '2.0.0',
    files: { 'SKILL.md': skillText('dev-god', 'v2') },
    fail: { at: 'fetch', code: 'E_DOWNLOAD_FAILED' },
  });
  const card = await rig(v1);
  try {
    const target = await installThenStage(card, v2);
    const before = {
      skill: await readFile(join(target, 'SKILL.md'), 'utf8'),
      meta: await readFile(join(target, '_meta.json'), 'utf8'),
      keep: await readFile(join(target, 'scripts', 'keep.md'), 'utf8'),
    };
    await assert.rejects(() => card.update(UPDATE_REF, target), (error) => {
      assert.equal(error.code, 'E_DOWNLOAD_FAILED', '取包失败沿用安装阶段的码（动盘之前不报新码）');
      return true;
    });
    assert.equal(await readFile(join(target, 'SKILL.md'), 'utf8'), before.skill, 'SKILL.md 逐字节不变');
    assert.equal(await readFile(join(target, '_meta.json'), 'utf8'), before.meta, '_meta.json 逐字节不变');
    assert.equal(await readFile(join(target, 'scripts', 'keep.md'), 'utf8'), before.keep, '其余文件也都在');
    assert.deepEqual(await workLeftovers(card.skillsRoot), [], '没有 .skc-update-* / .skc-backup-*');
    const ledger = await card.store.read();
    assert.equal(ledger.doc.installs.length, 1, '台账与更新前逐字节相同（还是只有那条 install）');
  } finally {
    await card.cleanup();
  }
});

test('K124 暂存目录已建之后失败：暂存被删、目标仍零改动', async () => {
  const v1 = fakeSource({ files: { 'SKILL.md': skillText('dev-god') } });
  // SKILL.md 放行、第二个文件失败 ⇒ 此时 .skc-update-* 已经建好了。
  const v2 = fakeSource({
    version: '2.0.0',
    files: { 'SKILL.md': skillText('dev-god', 'v2'), 'scripts/new.md': '# new\n' },
    fail: { at: 'fetch', code: 'E_DOWNLOAD_FAILED', path: 'scripts/new.md' },
  });
  const card = await rig(v1);
  try {
    const target = await installThenStage(card, v2);
    await assert.rejects(() => card.update(UPDATE_REF, target), (error) => error.code === 'E_DOWNLOAD_FAILED');
    assert.deepEqual(await workLeftovers(card.skillsRoot), [], 'finally 删掉了暂存目录，一个字节都没落到目标上');
    const meta = JSON.parse(await readFile(join(target, '_meta.json'), 'utf8'));
    assert.equal(meta.version, '1.0.0', '目标仍是旧版本');
  } finally {
    await card.cleanup();
  }
});

test('K124 台账失败 ⇒ E_UPDATE_UNCONFIRMED：目录是新版本、备份保留、台账是旧的', async () => {
  const v1 = fakeSource({ files: { 'SKILL.md': skillText('dev-god') } });
  const v2 = fakeSource({ version: '2.0.0', files: { 'SKILL.md': skillText('dev-god', 'v2') } });
  let failAppend = false;
  let realStore = null;
  const store = {
    /**
     * Append to the real ledger unless the test has broken it.
     * @param {object} entry - one ledger record.
     * @returns {Promise<object>} the store's answer.
     */
    append: (entry) => (failAppend ? Promise.reject(new Error('ledger down')) : realStore.append(entry)),
    /** @returns {Promise<object>} the ledger as it is on disk. */
    read: () => realStore.read(),
  };
  const card = await rig(v1, { store });
  realStore = createStore({ dshHome: card.dshHome, skillsRoot: card.skillsRoot, now: () => Date.parse('2026-11-09T06:00:00.000Z') });
  try {
    const target = await installThenStage(card, v2);
    failAppend = true;
    await assert.rejects(() => card.update(UPDATE_REF, target), (error) => {
      assert.equal(error.code, 'E_UPDATE_UNCONFIRMED', '新版本落地了但台账没写：只报未确认');
      assert.equal(error.detail.from, '1.0.0', 'data.from 让客户端说得出「已恢复到哪个版本」');
      assert.equal(error.detail.path, target, 'data.path 指出目录在哪');
      return true;
    });

    const text = await readFile(join(target, 'SKILL.md'), 'utf8');
    assert.ok(text.includes('v2'), '目录是**新版本完整**（不回滚目录，契约 §7.11 R6）');
    const meta = JSON.parse(await readFile(join(target, '_meta.json'), 'utf8'));
    assert.equal(meta.version, '2.0.0', '_meta.json 也是新版本');

    const leftovers = await workLeftovers(card.skillsRoot);
    assert.equal(leftovers.length, 1, '备份目录保留（它是唯一的一份旧版本）');
    assert.match(leftovers[0], /^\.skc-backup-/, '留下的是 .skc-backup-*');
    assert.equal(existsSync(join(card.skillsRoot, leftovers[0], 'SKILL.md')), true, '备份里就是旧版本');
    assert.equal(await readFile(join(card.skillsRoot, leftovers[0], 'SKILL.md'), 'utf8'), skillText('dev-god'),
      '备份里是更新前的字节');

    const ledger = await (failAppend ? realStore.read() : card.store.read());
    assert.equal(ledger.doc.installs.length, 1, '台账仍是旧的（只有那条 install）');
    assert.equal(ledger.doc.installs[0].version, '1.0.0', '旧版本号还在台账里');
  } finally {
    await card.cleanup();
  }
});

test('K124 E_UPDATE_RESTORED / E_UPDATE_LOST 只做代码级断言（rename 失败注入不了）', async () => {
  // 限制：交换是两次 rename，注入「第二次 rename 失败」需要在两次调用之间改变文件系统
  // 权限/占用，node 没有 hook 点；用 chmod 会把两个 rename 一视同仁地弄挂。所以这三条
  // 只能钉「代码里确实这么接的」，行为由真机抽查（D16）之外的契约文本保证。
  const source = await readFile(new URL('../lib/market/install.js', import.meta.url), 'utf8');
  assert.match(source, /E_UPDATE_RESTORED/, '交换失败且回滚成功 ⇒ E_UPDATE_RESTORED');
  assert.match(source, /E_UPDATE_LOST/, '回滚也失败 ⇒ E_UPDATE_LOST');
  assert.equal(
    (source.match(/await restoreBackup\(backup, target\)/g) ?? []).length,
    2,
    '两条失败分支（交换失败、落位回读失败）都走 restoreBackup',
  );
  assert.equal(
    (source.match(/keepBackup = !restored/g) ?? []).length,
    2,
    '回滚没成功时保留备份（它是唯一副本）',
  );
  assert.match(source, /E_UPDATE_UNCONFIRMED/, '台账失败 ⇒ E_UPDATE_UNCONFIRMED');
  assert.match(source, /keepBackup = true;[\s\S]{0,200}E_UPDATE_UNCONFIRMED/, '台账失败也保留备份');

  const { MARKET_STATUS } = await import('../lib/market/errors.js');
  assert.equal(MARKET_STATUS.E_UPDATE_RESTORED, 500, '码表里 E_UPDATE_RESTORED ⇒ 500');
  assert.equal(MARKET_STATUS.E_UPDATE_LOST, 500, '码表里 E_UPDATE_LOST ⇒ 500');
  assert.equal(MARKET_STATUS.E_UPDATE_UNCONFIRMED, 500, '码表里 E_UPDATE_UNCONFIRMED ⇒ 500');
});
