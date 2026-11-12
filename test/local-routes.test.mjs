/**
 * `lib/local/**` over the real route table — add a local directory, delete a skill
 * directory, and the invariant that neither can leave a half-state behind.
 *
 * Contract: docs/contracts/routes.md §3.3 (the two rows), §3.3.4 (S0–S12 / D0–D9 and the
 * two invariants) and §8.1 / §8.6 (the codes); case ids K127–K132.
 *
 * Everything runs against a throwaway `DSH_HOME` + `skillsRoot` under `os.tmpdir()` and
 * through `makeRoutes`, so the guards are exercised in the order the contract numbers
 * them, on the same lock table the market installer uses. Nothing here touches
 * `~/.dsh/skills`: a test that wrote there would corrupt the machine it runs on.
 *
 * The last five cases take the `copy` seam instead of `makeRoutes` (`mountFace`): S10 and
 * S11 are the two failures no real filesystem produces on demand, so the landing stage has
 * to be replaced. Same tree, same ledger file, same guard order; the status comes from
 * `asLocalError`, which is the mapping the route itself uses.
 *
 * The upstream face is never reached: `api.skillhub.cn` is only touched by install /
 * update / icons, and no case below calls those routes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { chmod, lstat, mkdir, readdir, readFile, realpath, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { readLedger } from '../lib/ledger.js';
import { asLocalError } from '../lib/local/errors.js';
import { createLocalSkills } from '../lib/local/index.js';
import { makeMarketDeps } from '../lib/market/sources/index.js';
import { storeFile } from '../lib/market/store.js';
import { ROUTES, makeRoutes } from '../lib/routes.js';
import { LOOPBACK_HEADERS, callRoute } from './helpers/http.mjs';
import { customTree, skillFile } from './helpers/tree.mjs';

/** Entries the installer's staging directories use (`lib/market/install.js`). */
const TEMP_PREFIX = '.skc-install-';

/**
 * Mount the real route table over one throwaway tree.
 * @param {{entries?: Record<string, Buffer|string>, tree?: object, registry?: object, market?: object}} [options] -
 *   seed rows, a prebuilt tree, a fake skill registry, and an optional replacement for the market deps.
 * @returns {Promise<{tree: object, market: object, route: Function, call: Function,
 *   close: () => Promise<void>}>} the harness.
 */
async function mount(options = {}) {
  const tree = options.tree ?? await customTree(options.entries ?? {});
  const market = options.market ?? makeMarketDeps({ dshHome: tree.dshHome, skillsRoot: tree.skillsRoot });
  const routes = makeRoutes({}, {
    dshHome: tree.dshHome,
    skillsRoot: tree.skillsRoot,
    version: '9.9.9-test',
    registry: options.registry,
    sessions: null,
    logger: { warn: () => {} },
    market,
  });
  const byName = Object.fromEntries(routes.map((route) => [route.path, route]));
  return {
    tree,
    market,
    byPath: byName,
    /**
     * One POST to one of the two write routes.
     * @param {'add'|'remove'} name - route key.
     * @param {unknown} body - JSON body, already shaped (or a raw string to send as-is).
     * @param {object} [overrides] - request overrides.
     * @returns {Promise<object>} the recorded response.
     */
    call: (name, body, overrides = {}) => callRoute(byName[ROUTES[name]], {
      method: 'POST',
      url: ROUTES[name],
      headers: LOOPBACK_HEADERS,
      body: typeof body === 'string' ? body : JSON.stringify(body),
      ...overrides,
    }),
    close: async () => {
      market.dispose?.();
      await tree.cleanup();
    },
  };
}

/**
 * Mount the two writes on a throwaway tree **with the copy stages replaceable**.
 *
 * `makeRoutes` builds `createLocalSkills` without forwarding a `copy` dep, and S10/S11 are
 * exactly the two failures no real filesystem produces on demand (a landing that throws, and
 * a landed SKILL.md that declares another name). Everything else here is the real thing: the
 * same skills root, the same ledger file on disk, the same guard order up to S9.
 * `asLocalError` is the mapping the route itself uses, so `status` below is the status the
 * browser would get (500 `E_INSTALL_IO`, also pinned end-to-end by K129's ledger case).
 * @param {{entries?: object, copy?: object}} [options] - seed rows and the copy seam.
 * @returns {Promise<{tree: object, market: object, face: object, close: () => Promise<void>}>} the harness.
 */
async function mountFace(options = {}) {
  const tree = await customTree(options.entries ?? {});
  const market = makeMarketDeps({ dshHome: tree.dshHome, skillsRoot: tree.skillsRoot });
  const face = createLocalSkills({
    skillsRoot: tree.skillsRoot,
    dshHome: tree.dshHome,
    store: market.store,
    // S7 only: a fake registry with no rows shadows nothing.
    rescan: async () => ({ rows: [], registry: [] }),
    ...(options.copy === undefined ? {} : { copy: options.copy }),
  });
  return {
    tree,
    market,
    face,
    close: async () => {
      market.dispose?.();
      await tree.cleanup();
    },
  };
}

/**
 * Create a source directory outside the skills root.
 * @param {string} dshHome - temp home (the sources live beside `skills/`).
 * @param {string} dirName - directory name (and the fallback skill name).
 * @param {{declared?: string|null, files?: Record<string, string>}} [options] - declaration and extra files.
 * @returns {Promise<string>} absolute source path.
 */
async function sourceDir(dshHome, dirName, options = {}) {
  const dir = join(dshHome, 'sources', dirName);
  await mkdir(dir, { recursive: true });
  const declared = options.declared === null ? null : (options.declared ?? dirName);
  const text = declared === null
    ? '---\ndescription: no name declared\n---\n\n# body\n'
    : skillFile({ name: declared }).toString('utf8');
  await writeFile(join(dir, 'SKILL.md'), text);
  for (const [rel, body] of Object.entries(options.files ?? {})) {
    const file = join(dir, rel);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, body);
  }
  return dir;
}

/**
 * Create an empty file and hand back its path (so `truncate` can size it).
 *
 * A sized-but-unwritten file is sparse on APFS/ext4, so a 64 MiB tree costs no real
 * disk and no measurable time - which is what makes the package budget testable at all.
 * @param {string} file - absolute path.
 * @returns {Promise<string>} the same path.
 */
async function touch(file) {
  await writeFile(file, '');
  return file;
}

/**
 * Entry names inside the skills root.
 * @param {string} skillsRoot - directory to list.
 * @returns {Promise<string[]>} sorted names, `[]` when the root is missing.
 */
async function entriesOf(skillsRoot) {
  try {
    return (await readdir(skillsRoot)).sort();
  } catch {
    return [];
  }
}

/**
 * Staging directories left behind by the copy pipeline.
 * @param {string} skillsRoot - directory to list.
 * @returns {Promise<string[]>} the leftovers (the added-skill invariant wants none).
 */
async function leftovers(skillsRoot) {
  return (await entriesOf(skillsRoot)).filter((name) => name.startsWith(TEMP_PREFIX));
}

/**
 * The ledger file's bytes, or null when the file does not exist.
 * @param {string} dshHome - temp home.
 * @returns {Promise<Buffer|null>} the bytes.
 */
async function ledgerBytes(dshHome) {
  try {
    return await readFile(storeFile(dshHome));
  } catch {
    return null;
  }
}

/** A fake skill registry whose summaries carry the `source` the rank table reads. */
function registryOf(summaries) {
  return { snapshot: async () => ({ skills: summaries, complete: true }) };
}

/**
 * A store double that fails one method, over the real one.
 * @param {object} real - the real store client.
 * @param {'append'|'remove'} method - which call throws.
 * @returns {object} the store.
 */
function failingStore(real, method) {
  return {
    ...real,
    file: real.file,
    read: real.read,
    append: method === 'append' ? async () => { throw new Error('ledger is read-only'); } : real.append,
    remove: method === 'remove' ? async () => { throw new Error('ledger is read-only'); } : real.remove,
    installed: real.installed,
  };
}

/* ---------------------------------------------------------------- K127 · S0–S5 */

test('K127 S0 请求形状：body 非对象 / path 不是非空字符串 ⇒ 400 E_BAD_REQUEST', async () => {
  const mounted = await mount();
  try {
    for (const [label, body] of [
      ['JSON 数组', '[]'],
      ['JSON 字符串', '"a"'],
      ['不是 JSON', 'not json'],
      ['空 body', ''],
      ['path 是数字', '{"path":42}'],
      ['path 是对象', '{"path":{"a":1}}'],
      ['没有 path 字段', '{}'],
    ]) {
      const response = await mounted.call('add', body);
      assert.equal(response.status, 400, `${label} ⇒ 400`);
      assert.equal(response.json.code, 'E_BAD_REQUEST', `${label} ⇒ E_BAD_REQUEST（S0）`);
      assert.deepEqual(await entriesOf(mounted.tree.skillsRoot), [], `${label} 一个字节都没写`);
    }
  } finally {
    await mounted.close();
  }
});

test('K127 S1 坏路径 ⇒ 400 E_BAD_PATH（相对 / 点开头 / URL / NUL / 超 1024），~ 前缀不走这个码', async () => {
  const mounted = await mount();
  try {
    for (const [label, path] of [
      ['相对路径', 'my-skill'],
      ['点开头的相对路径', './my-skill'],
      ['上跳一层', '../my-skill'],
      ['URL', 'https://example.com/skill'],
      ['file: URL', 'file:///tmp/skill'],
      ['含 NUL', '/tmp/has\u0000nul'],
      ['超 1024 字符', `/${'a'.repeat(1024)}`],
    ]) {
      const response = await mounted.call('add', { path });
      assert.equal(response.status, 400, `${label} ⇒ 400`);
      assert.equal(response.json.code, 'E_BAD_PATH', `${label} ⇒ E_BAD_PATH（S1）`);
      assert.equal(response.json.data, null, `${label} 的失败信封 data 为 null`);
    }

    // 空串 / 全空白落在 S0（"path 是非空字符串"，E_BAD_REQUEST），不是 S1。
    // 契约两处措辞不一致：routes.md §3.3.4 S0 说 E_BAD_REQUEST，acceptance.md K127 把
    // 「空串」并进了 E_BAD_PATH。**状态码两处都是 400**，这里钉守则表（S0）那一条，
    // 差异见交付说明的 Known Issue（文档侧，归架构师）。
    for (const [label, path] of [['空串', ''], ['全空白', '   ']]) {
      const response = await mounted.call('add', { path });
      assert.equal(response.status, 400, `${label} ⇒ 400`);
      assert.equal(response.json.code, 'E_BAD_REQUEST', `${label} 在 S0 就被拒（非空字符串那条）`);
    }

    // `~` / `~/…` 是合法输入：它们不会落 E_BAD_PATH，而是展开后继续走 S2 之后的守卫。
    const shorthand = await mounted.call('add', { path: '~/skc-qa-does-not-exist-xyz' });
    assert.equal(shorthand.status, 404, '不存在的 `~/…` ⇒ 404（证明它过了 S1）');
    assert.equal(shorthand.json.code, 'E_ADD_NOT_FOUND', '停在 S2（lstat 不成功）');
    // 裸 `~` 指向家目录本身：它存在、是目录、但没有 SKILL.md ⇒ S4 的那一支。
    const home = await mounted.call('add', { path: '~' });
    assert.equal(home.status, 422, '裸 `~` ⇒ 422（家目录不是技能目录）');
    assert.equal(home.json.code, 'E_ADD_NOT_SKILL_DIR', '同样证明 `~` 过了 S1');
  } finally {
    await mounted.close();
  }
});

test('K127 S2–S4：源不存在 ⇒ 404；普通文件 / 空目录 / SKILL.md 是软链 ⇒ 422 E_ADD_NOT_SKILL_DIR', async () => {
  const mounted = await mount();
  try {
    const missing = await mounted.call('add', { path: join(mounted.tree.dshHome, 'no-such-dir') });
    assert.equal(missing.status, 404, '不存在的路径 ⇒ 404');
    assert.equal(missing.json.code, 'E_ADD_NOT_FOUND', '码是 E_ADD_NOT_FOUND（不是 E_NOT_FOUND）');
    assert.equal(missing.json.data, null, '失败信封 data 为 null');

    // 普通文件
    const plainFile = join(mounted.tree.dshHome, 'plain.md');
    await writeFile(plainFile, '# not a skill\n');
    const fileResponse = await mounted.call('add', { path: plainFile });
    assert.equal(fileResponse.status, 422, '普通文件 ⇒ 422');
    assert.equal(fileResponse.json.code, 'E_ADD_NOT_SKILL_DIR', '普通文件不是技能目录');

    // 空目录（没有 SKILL.md）
    const emptyDir = join(mounted.tree.dshHome, 'empty-dir');
    await mkdir(emptyDir, { recursive: true });
    const emptyResponse = await mounted.call('add', { path: emptyDir });
    assert.equal(emptyResponse.status, 422, '空目录 ⇒ 422');
    assert.equal(emptyResponse.json.code, 'E_ADD_NOT_SKILL_DIR', '没有 SKILL.md 不是技能目录');

    // SKILL.md 是软链（用 lstat 判，不跟随）
    const linked = join(mounted.tree.dshHome, 'linked-skill-md');
    await mkdir(linked, { recursive: true });
    const target = join(mounted.tree.dshHome, 'real-skill-md');
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'SKILL.md'), skillFile({ name: 'linked-skill-md' }));
    await symlink(join(target, 'SKILL.md'), join(linked, 'SKILL.md'));
    const symlinkResponse = await mounted.call('add', { path: linked });
    assert.equal(symlinkResponse.status, 422, 'SKILL.md 是软链 ⇒ 422');
    assert.equal(symlinkResponse.json.code, 'E_ADD_NOT_SKILL_DIR', 'SKILL.md 必须是普通文件（不跟随软链）');

    assert.deepEqual(await entriesOf(mounted.tree.skillsRoot), [], '四条失败路径一条都没落盘');
    assert.deepEqual(await leftovers(mounted.tree.skillsRoot), [], '也没有临时目录残留');
  } finally {
    await mounted.close();
  }
});

test('K127 S5 声明名不合规 ⇒ 422 E_SKILL_NAME_INVALID + data.declaredName（不改名、不顶替）', async () => {
  const mounted = await mount();
  try {
    const src = await sourceDir(mounted.tree.dshHome, 'Bad', { declared: 'Design' });
    const response = await mounted.call('add', { path: src });
    assert.equal(response.status, 422, '名字不合规 ⇒ 422');
    assert.equal(response.json.code, 'E_SKILL_NAME_INVALID', '复用市场面的那个码');
    assert.equal(response.json.data.declaredName, 'Design', 'data 回显声明名（界面要显示它）');
    assert.deepEqual(await entriesOf(mounted.tree.skillsRoot), [], '没有用别的名字顶上');

    // 声明名缺失 ⇒ 回落目录名；目录名也不合规 ⇒ 同一个码、declaredName 是空串。
    const fallback = await sourceDir(mounted.tree.dshHome, 'Bad_Dir', { declared: null });
    const fallbackResponse = await mounted.call('add', { path: fallback });
    assert.equal(fallbackResponse.json.code, 'E_SKILL_NAME_INVALID', '目录名不合规同样拒');
    assert.equal(fallbackResponse.json.data.declaredName, '', '声明名缺失时回显空串（不是 null）');
  } finally {
    await mounted.close();
  }
});

test('K127 围栏：非 loopback ⇒ 403 且零磁盘改动；GET ⇒ 405', async () => {
  const mounted = await mount();
  try {
    const src = await sourceDir(mounted.tree.dshHome, 'qa-locked', {});
    const forbidden = await mounted.call('add', { path: src }, { remoteAddress: '10.1.2.3' });
    assert.equal(forbidden.status, 403, '非 loopback ⇒ 403');
    assert.equal(forbidden.json.code, 'E_FORBIDDEN', '码是 E_FORBIDDEN');
    assert.deepEqual(await entriesOf(mounted.tree.skillsRoot), [], '403 一个字节都没写');
    assert.equal(await ledgerBytes(mounted.tree.dshHome), null, '403 连台账都没建');

    const wrongMethod = await mounted.call('add', { path: src }, { method: 'GET' });
    assert.equal(wrongMethod.status, 405, 'GET ⇒ 405');
    assert.equal(wrongMethod.json.code, 'E_METHOD', '码是 E_METHOD');
    assert.deepEqual(await entriesOf(mounted.tree.skillsRoot), [], '405 也没写盘');
  } finally {
    await mounted.close();
  }
});

/* ----------------------------------------------------------------- K128 · S6/S7 */

test('K128 S6 目标被占：目录 / 普通文件 / 软链一视同仁 ⇒ 409 E_ALREADY_INSTALLED + data.path', async () => {
  const mounted = await mount();
  try {
    const src = await sourceDir(mounted.tree.dshHome, 'probe', {});
    const target = join(mounted.tree.skillsRoot, 'probe');
    const ledgerBefore = await ledgerBytes(mounted.tree.dshHome);

    // 三种占位：目录、普通文件、软链（含断链）。lstat 判存在，所以断链也算被占。
    for (const [label, occupy] of [
      ['同名目录', async () => mkdir(target, { recursive: true })],
      ['同名普通文件', async () => writeFile(target, 'not a dir\n')],
      ['同名软链（断链）', async () => symlink(join(mounted.tree.dshHome, 'elsewhere'), target)],
    ]) {
      await rm(target, { recursive: true, force: true });
      await occupy();
      const response = await mounted.call('add', { path: src });
      assert.equal(response.status, 409, `${label} ⇒ 409`);
      assert.equal(response.json.code, 'E_ALREADY_INSTALLED', `${label} ⇒ E_ALREADY_INSTALLED`);
      assert.equal(response.json.data.path, target, `${label} 的 data.path 就是那个占位`);
      assert.equal((await lstat(target)).isSymbolicLink(), label.includes('软链'), `${label} 的占位没有被覆盖`);
      assert.deepEqual(await leftovers(mounted.tree.skillsRoot), [], `${label} 之后没有临时目录`);
      assert.deepEqual(await ledgerBytes(mounted.tree.dshHome), ledgerBefore, `${label} 之后台账逐字节未变`);
      await rm(target, { recursive: true, force: true });
    }

    // 台账有记录但目录不存在 ⇒ 允许（S6 容忍残留，见 §3.3.4 的顺序理由）。
    await mounted.market.store.append({
      source: 'local', owner: '', slug: '', name: 'probe', dirName: 'probe', fromPath: src,
    });
    assert.deepEqual(await entriesOf(mounted.tree.skillsRoot), [], '目录确实不在（只有台账残留）');
    const allowed = await mounted.call('add', { path: src });
    assert.equal(allowed.status, 200, '台账有记录、目录不在 ⇒ 照装');
    assert.equal((await lstat(target)).isDirectory(), true, '目录这次真的落位了');
  } finally {
    await mounted.close();
  }
});

test('K128 S7 影子：rank 250 / 300 的同名注册表行 ⇒ 409 + data.provider；rank 400 / 600 放行', async () => {
  // rank 250 是 runtime provider（R1 ⇒ builtin），300 是 custom 根（R3 ⇒ 整行被排除）：
  // 两者都会让刚落位的目录「加成功但看不见」，所以 S7 直接拒。
  for (const [label, summary, provider] of [
    ['runtime（250）', { name: 'probe', source: 'runtime', provider: 'runtime' }, 'runtime'],
    ['custom（300）', { name: 'probe', source: 'custom', provider: 'filesystem' }, 'filesystem'],
    ['project-dsh（100）', { name: 'probe', source: 'project-dsh', provider: 'filesystem' }, 'filesystem'],
  ]) {
    const mounted = await mount({ registry: registryOf([summary]) });
    try {
      const src = await sourceDir(mounted.tree.dshHome, 'probe', {});
      const response = await mounted.call('add', { path: src });
      assert.equal(response.status, 409, `${label} ⇒ 409`);
      assert.equal(response.json.code, 'E_ADD_SHADOWED', `${label} ⇒ E_ADD_SHADOWED`);
      assert.equal(response.json.data.provider, provider, `${label} 的 data.provider 是那条注册表行的 provider`);
      assert.equal(typeof response.json.data.rank, 'number', `${label} 的 data 还带 rank（设计 A-5）`);
      assert.deepEqual(await entriesOf(mounted.tree.skillsRoot), [], `${label} 之后没有落盘`);
      assert.deepEqual(await leftovers(mounted.tree.skillsRoot), [], `${label} 之后没有临时目录`);
      assert.equal(await ledgerBytes(mounted.tree.dshHome), null, `${label} 之后台账没建`);
    } finally {
      await mounted.close();
    }
  }

  // 放行侧：400（user-dsh 平局，扫描赢）与 600（bundled 输给扫描）。
  for (const [label, summary] of [
    ['user-dsh（400）', { name: 'probe', source: 'user-dsh', provider: 'filesystem' }],
    ['bundled（600）', { name: 'probe', source: 'bundled', provider: 'filesystem' }],
    ['user-agents（500）', { name: 'probe', source: 'user-agents', provider: 'filesystem' }],
  ]) {
    const mounted = await mount({ registry: registryOf([summary]) });
    try {
      const src = await sourceDir(mounted.tree.dshHome, 'probe', {});
      const response = await mounted.call('add', { path: src });
      assert.equal(response.status, 200, `${label} 放行（扫描行在同名裁决里不输）`);
      assert.equal(response.json.code, 'OK', `${label} 成功`);
    } finally {
      await mounted.close();
    }
  }
});

/* ------------------------------------------------------------------- K129 · 落盘 */

test('K129 成功落盘：目录 + 台账一条 + R5 + 没有临时目录', async () => {
  const mounted = await mount();
  try {
    const src = await sourceDir(mounted.tree.dshHome, 'probe', {
      declared: 'qa-probe',
      files: { 'docs/guide.md': '# guide\n', 'node_modules/x/index.js': 'nope\n', '.gitignore': 'dist\n' },
    });
    const response = await mounted.call('add', { path: src });
    assert.equal(response.status, 200, '成功 ⇒ 200');
    assert.equal(response.json.code, 'OK', '信封 code 是 OK');
    const data = response.json.data;
    const landed = join(mounted.tree.skillsRoot, 'qa-probe');
    assert.equal(data.name, 'qa-probe', '落位名取声明名');
    assert.equal(data.path, landed, 'path 是落位后的目录');
    assert.equal(data.files, 2, 'files 是落盘的去重路径数（SKILL.md + docs/guide.md，跳过 node_modules 与点文件）');
    assert.equal(
      data.bytes,
      (await stat(join(landed, 'SKILL.md'))).size + (await stat(join(landed, 'docs', 'guide.md'))).size,
      'bytes 是真实写入的字节合计',
    );

    assert.equal((await lstat(join(landed, 'SKILL.md'))).isFile(), true, '<skillsRoot>/<name>/SKILL.md 在');
    assert.deepEqual(await entriesOf(landed), ['SKILL.md', 'docs'], 'node_modules 与 .gitignore 没有被复制');
    assert.deepEqual(await leftovers(mounted.tree.skillsRoot), [], '没有 .skc-install-* 残留');

    const records = (await mounted.market.store.read()).doc.installs;
    assert.equal(records.length, 1, '台账多了一条');
    assert.deepEqual(
      { source: records[0].source, name: records[0].name, dirName: records[0].dirName, fromPath: records[0].fromPath },
      { source: 'local', name: 'qa-probe', dirName: 'qa-probe', fromPath: await realpath(src) },
      '台账记录带 source/name/dirName/fromPath（S7 的四个新字段）',
    );

    // lib/ledger.js 认得这条记录 ⇒ 分类走 R5（own-record）⇒ 分区 installed。
    const facts = await readLedger(mounted.tree.dshHome, mounted.tree.skillsRoot);
    assert.equal(facts.entries.has('qa-probe'), true, 'ledger.js 读出了这个名字');
    const listed = await callRoute(mounted.byPath[ROUTES.list], { headers: LOOPBACK_HEADERS });
    const row = listed.json.data.groups.flatMap((group) => group.skills).find((entry) => entry.name === 'qa-probe');
    assert.ok(row !== undefined, 'list 里有这一行');
    assert.equal(row.partition, 'installed', '台账命中 ⇒ 分区 installed');
    assert.equal(row.rule, 'R5', '判据是 R5（own-record）');
  } finally {
    await mounted.close();
  }
});

test('K129 不变式：每条失败路径之后 ∄ 目录 ∧ ∄ .skc-install-* ∧ 台账逐字节未变', async () => {
  const mounted = await mount();
  try {
    // 先放一条无关记录，这样「逐字节未变」不是「两个 null 相等」。
    await mounted.market.store.append({ source: 'skillhub', owner: 'ake', slug: 'other', name: 'other' });
    const before = await ledgerBytes(mounted.tree.dshHome);

    const cases = [
      ['S4 源不是技能目录', { path: join(mounted.tree.dshHome, 'not-a-skill') }, 'E_ADD_NOT_SKILL_DIR'],
      ['S5 声明名不合规', { path: await sourceDir(mounted.tree.dshHome, 'Bad2', { declared: 'Design' }) }, 'E_SKILL_NAME_INVALID'],
      ['S9 源内有软链', { path: await sourceDir(mounted.tree.dshHome, 'probe-link', { files: {} }) }, 'E_PACKAGE_INVALID'],
      ['S1 坏路径', { path: 'relative/path' }, 'E_BAD_PATH'],
    ];
    // 给 S9 那条造一个内部软链。
    const linked = join(mounted.tree.dshHome, 'sources', 'probe-link');
    await symlink(join(linked, 'SKILL.md'), join(linked, 'mirror.md'));
    await mkdir(join(mounted.tree.dshHome, 'not-a-skill'), { recursive: true });

    for (const [label, body, code] of cases) {
      const response = await mounted.call('add', body);
      assert.equal(response.json.code, code, `${label} 的码`);
      assert.equal((await entriesOf(mounted.tree.skillsRoot)).includes('probe'), false, `${label} 之后没有 probe 目录`);
      assert.deepEqual(await leftovers(mounted.tree.skillsRoot), [], `${label} 之后没有临时目录`);
      assert.deepEqual(await ledgerBytes(mounted.tree.dshHome), before, `${label} 之后台账逐字节未变`);
    }

    // S6 与 S7 各再造一次（这两条在 K128 里已逐项验过，这里只要不变式）。
    await mkdir(join(mounted.tree.skillsRoot, 'probe'), { recursive: true });
    const occupied = await mounted.call('add', { path: await sourceDir(mounted.tree.dshHome, 'probe', {}) });
    assert.equal(occupied.json.code, 'E_ALREADY_INSTALLED', 'S6 的码');
    assert.deepEqual(await leftovers(mounted.tree.skillsRoot), [], 'S6 之后没有临时目录');
    assert.deepEqual(await ledgerBytes(mounted.tree.dshHome), before, 'S6 之后台账逐字节未变');
  } finally {
    await mounted.close();
  }
});

test('K129 台账写失败 ⇒ 500 E_INSTALL_IO，但目录保留（唯一允许的半状态）', async () => {
  const tree = await customTree({});
  const base = makeMarketDeps({ dshHome: tree.dshHome, skillsRoot: tree.skillsRoot });
  const mounted = await mount({ tree, market: { ...base, store: failingStore(base.store, 'append') } });
  try {
    const src = await sourceDir(mounted.tree.dshHome, 'probe', {});
    const response = await mounted.call('add', { path: src });
    assert.equal(response.status, 500, '台账写失败 ⇒ 500');
    assert.equal(response.json.code, 'E_INSTALL_IO', '码是 E_INSTALL_IO（§3.7.4 S13 的同一处例外）');
    assert.equal((await lstat(join(mounted.tree.skillsRoot, 'probe', 'SKILL.md'))).isFile(), true,
      '目录**没有**回滚（用户能看见一次装好的技能胜过静默丢弃）');
    assert.deepEqual(await leftovers(mounted.tree.skillsRoot), [], '临时目录还是清掉了');
  } finally {
    base.dispose?.();
    await mounted.close();
  }
});

test('K129 并发同名两次 ⇒ 一次 200、一次 429 E_INSTALL_BUSY（只落一份）', async () => {
  const mounted = await mount();
  try {
    const src = await sourceDir(mounted.tree.dshHome, 'probe', {});
    const [first, second] = await Promise.all([
      mounted.call('add', { path: src }),
      mounted.call('add', { path: src }),
    ]);
    const statuses = [first.status, second.status].sort((left, right) => left - right);
    assert.deepEqual(statuses, [200, 429], '一次成功、一次被锁挡（实测两侧顺序会变，所以比多重集）');
    const busy = first.status === 429 ? first : second;
    assert.equal(busy.json.code, 'E_INSTALL_BUSY', '被挡的那一次是 E_INSTALL_BUSY（S8，不是 S6）');
    assert.deepEqual(await entriesOf(mounted.tree.skillsRoot), ['probe'], '只落了一份');
    assert.equal((await mounted.market.store.read()).doc.installs.length, 1, '台账也只有一条');
    assert.deepEqual(await leftovers(mounted.tree.skillsRoot), [], '没有临时目录残留');
  } finally {
    await mounted.close();
  }
});

test('K129 S8 共用一把锁：锁被占时 add / remove 都回 429，别的名字不受影响', async () => {
  const mounted = await mount();
  try {
    const src = await sourceDir(mounted.tree.dshHome, 'probe', {});
    let release;
    const held = mounted.market.installer.withWriteLock('local:probe', () => new Promise((resolve) => { release = resolve; }));
    // 让锁真的进了表（一次性微任务即可）。
    await new Promise((resolve) => setImmediate(resolve));

    const blocked = await mounted.call('add', { path: src });
    assert.equal(blocked.status, 429, '锁被占时 add ⇒ 429');
    assert.equal(blocked.json.code, 'E_INSTALL_BUSY', '码是 E_INSTALL_BUSY（与市场安装共用同一张表）');

    // 换个名字不受影响：锁的键是 `local:<name>`，不是全局一把。
    const other = await sourceDir(mounted.tree.dshHome, 'probe-two', { declared: 'probe-two' });
    const allowed = await mounted.call('add', { path: other });
    assert.equal(allowed.status, 200, '别的名字照常写');

    // remove 走同一把锁：先放一个 probe 目录，再占锁，删除同样被挡。
    await mkdir(join(mounted.tree.skillsRoot, 'probe'), { recursive: true });
    await writeFile(join(mounted.tree.skillsRoot, 'probe', 'SKILL.md'), skillFile({ name: 'probe' }));
    const blockedRemove = await mounted.call('remove', {
      name: 'probe',
      path: join(mounted.tree.skillsRoot, 'probe', 'SKILL.md'),
    });
    assert.equal(blockedRemove.status, 429, '锁被占时 remove ⇒ 429');
    assert.equal(blockedRemove.json.code, 'E_INSTALL_BUSY', '删除与安装共用同一张锁表（D7）');
    assert.equal((await lstat(join(mounted.tree.skillsRoot, 'probe', 'SKILL.md'))).isFile(), true, '被挡的删除没动目录');

    release();
    await held;
    // 锁放掉之后同一个名字可以写（`local:probe` 已经从表里摘掉）。
    const third = await sourceDir(mounted.tree.dshHome, 'probe-three', { declared: 'probe-again' });
    const afterRelease = await mounted.call('add', { path: third });
    assert.equal(afterRelease.status, 200, '锁放掉之后可以写');
  } finally {
    await mounted.close();
  }
});

/* ------------------------------------------------------------------- K130 · 包闸 */

test('K130 包闸：2001 条目 / 单文件 9 MiB / 总量超 64 MiB ⇒ 422 E_PACKAGE_INVALID', async () => {
  const mounted = await mount();
  try {
    // 2001 条目：上限是「≤2000」。
    const many = await sourceDir(mounted.tree.dshHome, 'many-entries', {});
    for (let start = 0; start < 2001; start += 100) {
      await Promise.all(Array.from({ length: Math.min(100, 2001 - start) }, (_unused, offset) => (
        writeFile(join(many, `f${start + offset}.txt`), 'x')
      )));
    }
    const manyResponse = await mounted.call('add', { path: many });
    assert.equal(manyResponse.status, 422, '2001 条目 ⇒ 422');
    assert.equal(manyResponse.json.code, 'E_PACKAGE_INVALID', '码是 E_PACKAGE_INVALID');
    assert.equal((await entriesOf(mounted.tree.skillsRoot)).includes('many-entries'), false, '没有落盘');
    assert.deepEqual(await leftovers(mounted.tree.skillsRoot), [], '没有临时目录');

    // 单文件 9 MiB（稀疏文件：大小真实、不占盘）。
    const big = await sourceDir(mounted.tree.dshHome, 'big-file', {});
    await truncate(await touch(join(big, 'big.bin')), 9 * 1024 * 1024);
    const bigResponse = await mounted.call('add', { path: big });
    assert.equal(bigResponse.status, 422, '单文件 9 MiB ⇒ 422');
    assert.equal(bigResponse.json.code, 'E_PACKAGE_INVALID', '同一个码');

    // 总量超 64 MiB：八个 8 MiB 恰好 64 MiB（放行），再加 1 字节就拒。
    const exact = await sourceDir(mounted.tree.dshHome, 'exact-total', {});
    // SKILL.md 自己也在这棵树里，所以「恰好 64 MiB」要把它那几十字节算进去。
    const skillBytes = (await stat(join(exact, 'SKILL.md'))).size;
    for (let index = 0; index < 7; index += 1) {
      await truncate(await touch(join(exact, `blob${index}.bin`)), 8 * 1024 * 1024);
    }
    await truncate(await touch(join(exact, 'last.bin')), 8 * 1024 * 1024 - skillBytes);
    const exactResponse = await mounted.call('add', { path: exact });
    assert.equal(exactResponse.status, 200, '总量恰好 64 MiB 放行（上限是「≤」）');

    const over = await sourceDir(mounted.tree.dshHome, 'over-total', {});
    for (let index = 0; index < 8; index += 1) {
      await truncate(await touch(join(over, `blob${index}.bin`)), 8 * 1024 * 1024);
    }
    await truncate(await touch(join(over, 'one-more.bin')), 1);
    const overResponse = await mounted.call('add', { path: over });
    assert.equal(overResponse.status, 422, '总量 64 MiB + 1 字节 ⇒ 422');
    assert.equal(overResponse.json.code, 'E_PACKAGE_INVALID', '同一个码');
    assert.equal((await entriesOf(mounted.tree.skillsRoot)).includes('over-total'), false, '超限的那份没有落盘');
  } finally {
    await mounted.close();
  }
});

test('K130 源目录内部软链（文件或目录）⇒ 整次拒绝且不静默丢文件', async () => {
  const mounted = await mount();
  try {
    // 文件软链
    const fileLink = await sourceDir(mounted.tree.dshHome, 'link-file', {});
    await symlink(join(fileLink, 'SKILL.md'), join(fileLink, 'mirror.md'));
    const fileResponse = await mounted.call('add', { path: fileLink });
    assert.equal(fileResponse.status, 422, '文件软链 ⇒ 422');
    assert.equal(fileResponse.json.code, 'E_PACKAGE_INVALID', '码是 E_PACKAGE_INVALID（不是「跳过」）');

    // 目录软链
    const dirLink = await sourceDir(mounted.tree.dshHome, 'link-dir', {});
    const outside = join(mounted.tree.dshHome, 'outside');
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'secret.md'), 'not yours\n');
    await symlink(outside, join(dirLink, 'docs'));
    const dirResponse = await mounted.call('add', { path: dirLink });
    assert.equal(dirResponse.status, 422, '目录软链 ⇒ 422');
    assert.equal(dirResponse.json.code, 'E_PACKAGE_INVALID', '同一个码');

    assert.deepEqual(await entriesOf(mounted.tree.skillsRoot), [], '两条都被整次拒掉（没有半份技能）');
    assert.deepEqual(await leftovers(mounted.tree.skillsRoot), [], '没有临时目录');
  } finally {
    await mounted.close();
  }
});

test('K130 源目录顶层是软链 ⇒ 照装，落位的是真实目录', async () => {
  const mounted = await mount();
  try {
    const real = await sourceDir(mounted.tree.dshHome, 'linked-top', {});
    const link = join(mounted.tree.dshHome, 'sources', 'linked-top-link');
    await symlink(real, link, 'dir');
    const response = await mounted.call('add', { path: link });
    assert.equal(response.status, 200, '顶层软链指向真目录 ⇒ 照装（S3 允许）');
    const landed = join(mounted.tree.skillsRoot, 'linked-top');
    assert.equal((await lstat(landed)).isSymbolicLink(), false, '落位的是真目录，不是把软链搬过去');
    assert.equal((await lstat(join(landed, 'SKILL.md'))).isFile(), true, '文件真的在');
  } finally {
    await mounted.close();
  }
});

/* --------------------------------------------------------------- K131 · 删除守卫 */

test('K131 D0/D1：body 非对象 ⇒ 400 E_BAD_REQUEST；坏名 ⇒ 400 E_BAD_NAME 且不触盘', async () => {
  const mounted = await mount({ entries: { probe: skillFile({ name: 'probe' }) } });
  try {
    const before = await entriesOf(mounted.tree.skillsRoot);
    for (const [label, body] of [['JSON 数组', '[]'], ['不是 JSON', '{'], ['JSON 字符串', '"x"']]) {
      const response = await mounted.call('remove', body);
      assert.equal(response.status, 400, `${label} ⇒ 400`);
      assert.equal(response.json.code, 'E_BAD_REQUEST', `${label} ⇒ E_BAD_REQUEST（D0：body 不是对象）`);
    }
    // 空对象过 D0（它**是**对象），停在 D1 的名字文法上 —— 两个 400 的码不同，别混。
    const emptyObject = await mounted.call('remove', '{}');
    assert.equal(emptyObject.status, 400, '空对象 ⇒ 400');
    assert.equal(emptyObject.json.code, 'E_BAD_NAME', '空对象停在 D1（没有 name ⇒ 不合文法）');
    for (const name of ['Bad', 'a_b', 'a--b', '', 42, null]) {
      const response = await mounted.call('remove', { name, path: join(mounted.tree.skillsRoot, 'probe', 'SKILL.md') });
      assert.equal(response.status, 400, `${JSON.stringify(name)} ⇒ 400`);
      assert.equal(response.json.code, 'E_BAD_NAME', `${JSON.stringify(name)} ⇒ E_BAD_NAME（D1）`);
    }
    assert.deepEqual(await entriesOf(mounted.tree.skillsRoot), before, '坏名一次都没触盘');
    assert.deepEqual(await leftovers(mounted.tree.skillsRoot), [], '没有临时目录');
  } finally {
    await mounted.close();
  }
});

test('K131 D2–D5：未知名 404 / 软链行 409 E_SYMLINK_READONLY / path 不符 409 E_STALE_PATH', async () => {
  const mounted = await mount({ entries: { probe: skillFile({ name: 'probe' }) } });
  try {
    const probePath = join(mounted.tree.skillsRoot, 'probe', 'SKILL.md');

    const unknown = await mounted.call('remove', { name: 'ghost', path: probePath });
    assert.equal(unknown.status, 404, '未知名 ⇒ 404');
    assert.equal(unknown.json.code, 'E_NOT_FOUND', '码是 E_NOT_FOUND（D2）');
    assert.equal(unknown.json.data, null, '4xx 的 data 为 null');

    // 软链行：扫描层给 symlink 事实，D3 是三层拦截的第三层。
    const realDir = join(mounted.tree.dshHome, 'real-repo');
    await mkdir(realDir, { recursive: true });
    await writeFile(join(realDir, 'SKILL.md'), skillFile({ name: 'linked-probe' }));
    await symlink(realDir, join(mounted.tree.skillsRoot, 'linked-probe'), 'dir');
    const linked = await mounted.call('remove', { name: 'linked-probe', path: join(mounted.tree.skillsRoot, 'linked-probe', 'SKILL.md') });
    assert.equal(linked.status, 409, '软链行 ⇒ 409');
    assert.equal(linked.json.code, 'E_SYMLINK_READONLY', '码是 E_SYMLINK_READONLY（D3）');
    assert.equal((await lstat(join(realDir, 'SKILL.md'))).isFile(), true, '软链指向的源仓库一个字节都没动');
    assert.equal((await lstat(join(mounted.tree.skillsRoot, 'linked-probe'))).isSymbolicLink(), true, '软链本身也还在');

    // path 与重扫结果不等 ⇒ E_STALE_PATH（硬约束 6）。
    const stale = await mounted.call('remove', { name: 'probe', path: join(mounted.tree.skillsRoot, 'other', 'SKILL.md') });
    assert.equal(stale.status, 409, 'path 不符 ⇒ 409');
    assert.equal(stale.json.code, 'E_STALE_PATH', '码是 E_STALE_PATH（D5）');
    assert.equal((await lstat(probePath)).isFile(), true, '目录还在');

    // 不带 path ⇒ 无路径，也是「无可写路径」那一支。
    const noPath = await mounted.call('remove', { name: 'probe' });
    assert.equal(noPath.status, 409, '没有 path ⇒ 409');
    assert.equal(noPath.json.code, 'E_NOT_WRITABLE', '缺 path 归 E_NOT_WRITABLE（不是 E_STALE_PATH）');
  } finally {
    await mounted.close();
  }
});

test('K131 D4/D6：内置行（path === null）与越界行（<skillsRoot>/a/b/SKILL.md）⇒ 409 E_NOT_WRITABLE', async () => {
  const builtin = await mount({
    registry: registryOf([{ name: 'prov-skill', source: 'runtime', provider: 'runtime', path: '/elsewhere/prov-skill/SKILL.md' }]),
  });
  try {
    const response = await builtin.call('remove', { name: 'prov-skill', path: '/elsewhere/prov-skill/SKILL.md' });
    assert.equal(response.status, 409, '内置行 ⇒ 409');
    assert.equal(response.json.code, 'E_NOT_WRITABLE', '码是 E_NOT_WRITABLE（D4）');
  } finally {
    await builtin.close();
  }

  // 越界行：注册表摘要给出一个两层深的 path（扫描层只看根的直接子目录，碰不到这条），
  // 所以只能这样造出 D6 要拦的那种行。
  const deepTree = await customTree({});
  const crafted = await mount({
    tree: deepTree,
    registry: registryOf([{ name: 'deep-skill', source: 'user-dsh', provider: 'filesystem', path: join(deepTree.skillsRoot, 'a', 'b', 'SKILL.md') }]),
  });
  try {
    const deepPath = join(deepTree.skillsRoot, 'a', 'b', 'SKILL.md');
    const response = await crafted.call('remove', { name: 'deep-skill', path: deepPath });
    assert.equal(response.status, 409, '越界行 ⇒ 409');
    assert.equal(response.json.code, 'E_NOT_WRITABLE', '码是 E_NOT_WRITABLE（D6 的纵深防御）');
  } finally {
    await crafted.close();
  }
});

test('K131 围栏：非 loopback ⇒ 403 且目录仍在；GET ⇒ 405', async () => {
  const mounted = await mount({ entries: { probe: skillFile({ name: 'probe' }) } });
  try {
    const path = join(mounted.tree.skillsRoot, 'probe', 'SKILL.md');
    const forbidden = await mounted.call('remove', { name: 'probe', path }, { remoteAddress: '10.1.2.3' });
    assert.equal(forbidden.status, 403, '非 loopback ⇒ 403');
    assert.equal(forbidden.json.code, 'E_FORBIDDEN', '码是 E_FORBIDDEN');
    assert.equal((await lstat(path)).isFile(), true, '403 之后目录仍在');

    const wrongMethod = await mounted.call('remove', { name: 'probe', path }, { method: 'GET' });
    assert.equal(wrongMethod.status, 405, 'GET ⇒ 405');
    assert.equal(wrongMethod.json.code, 'E_METHOD', '码是 E_METHOD');
    assert.equal((await lstat(path)).isFile(), true, '405 之后目录仍在');
  } finally {
    await mounted.close();
  }
});

/* --------------------------------------------------------------- K132 · 删除成功 */

test('K132 成功：目录整体消失、data.dir 对、台账 cleared、再装可以', async () => {
  const mounted = await mount();
  try {
    const src = await sourceDir(mounted.tree.dshHome, 'probe', { declared: 'qa-probe' });
    const added = await mounted.call('add', { path: src });
    assert.equal(added.status, 200, '先加一个');
    const dir = added.json.data.path;
    assert.equal((await lstat(dir)).isDirectory(), true, '加完目录在');

    const removed = await mounted.call('remove', { name: 'qa-probe', path: join(dir, 'SKILL.md') });
    assert.equal(removed.status, 200, '删除 ⇒ 200');
    assert.equal(removed.json.code, 'OK', '信封 code 是 OK');
    assert.equal(removed.json.data.dir, dir, 'data.dir 是刚删掉的目录');
    assert.equal(removed.json.data.ledger, 'cleared', '台账清掉了');
    assert.equal((await entriesOf(mounted.tree.skillsRoot)).includes('qa-probe'), false, '目录整体不存在');
    assert.equal((await mounted.market.store.read()).doc.installs.some((entry) => entry.name === 'qa-probe'), false,
      '台账里没有这个 name 了');
    assert.deepEqual(await leftovers(mounted.tree.skillsRoot), [], '没有临时目录');

    // 删完之后同名再装 ⇒ 成功（残留不拦）。
    const again = await mounted.call('add', { path: src });
    assert.equal(again.status, 200, '同名再装成功');
  } finally {
    await mounted.close();
  }
});

test('K132 台账写失败 ⇒ 仍是 200 + ledger:kept + message 提到台账（目录已删）', async () => {
  const tree = await customTree({ probe: skillFile({ name: 'probe' }) });
  const base = makeMarketDeps({ dshHome: tree.dshHome, skillsRoot: tree.skillsRoot });
  const mounted = await mount({ tree, market: { ...base, store: failingStore(base.store, 'remove') } });
  try {
    const dir = join(mounted.tree.skillsRoot, 'probe');
    const response = await mounted.call('remove', { name: 'probe', path: join(dir, 'SKILL.md') });
    assert.equal(response.status, 200, '台账没清掉仍是成功（用户看到的结果已正确）');
    assert.equal(response.json.code, 'OK', '信封 code 仍是 OK');
    assert.equal(response.json.data.ledger, 'kept', 'data.ledger 是 kept');
    assert.match(response.json.message, /ledger/i, 'message 提到台账（给开发者看的那句）');
    assert.equal((await entriesOf(mounted.tree.skillsRoot)).includes('probe'), false, '目录已经删掉');
  } finally {
    base.dispose?.();
    await mounted.close();
  }
});

test('K132 目录删不掉 ⇒ 500 E_DELETE_IO，台账一点没动（可重试）', async () => {
  const mounted = await mount({ entries: { probe: skillFile({ name: 'probe' }) } });
  try {
    await mounted.market.store.append({ source: 'local', owner: '', slug: '', name: 'probe', dirName: 'probe', fromPath: '/x' });
    const before = await ledgerBytes(mounted.tree.dshHome);
    // 去掉根目录的写权限：删子目录要先改父目录的条目 ⇒ EACCES。
    await chmod(mounted.tree.skillsRoot, 0o555);
    try {
      const response = await mounted.call('remove', { name: 'probe', path: join(mounted.tree.skillsRoot, 'probe', 'SKILL.md') });
      assert.equal(response.status, 500, '删目录失败 ⇒ 500');
      assert.equal(response.json.code, 'E_DELETE_IO', '码是 E_DELETE_IO（D8）');
      assert.equal(response.json.data, null, 'E_DELETE_IO 的 data 为 null');
    } finally {
      await chmod(mounted.tree.skillsRoot, 0o755);
    }
    assert.deepEqual(await ledgerBytes(mounted.tree.dshHome), before, '台账逐字节未变（先删目录后清台账的顺序意义）');
    assert.equal((await lstat(join(mounted.tree.skillsRoot, 'probe', 'SKILL.md'))).isFile(), true, '目录还在');

    // 权限还回来之后同一条请求成功（无副作用、可重试）。
    const retry = await mounted.call('remove', { name: 'probe', path: join(mounted.tree.skillsRoot, 'probe', 'SKILL.md') });
    assert.equal(retry.status, 200, '重试成功');
  } finally {
    await mounted.close();
  }
});

/* ------------------------------------------- K129 · S10/S11：注入缝造失败点（落位 / 回读） */

test('K129 S10 落位抛错 ⇒ 500 E_INSTALL_IO，且 <name> 未落位、无临时目录、台账逐字节未变', async () => {
  const mounted = await mountFace({
    copy: {
      landSkill: async () => {
        throw new Error('boom');
      },
    },
  });
  try {
    const src = await sourceDir(mounted.tree.dshHome, 'probe', { declared: 'qa-probe' });
    const root = mounted.tree.skillsRoot;
    const before = await ledgerBytes(mounted.tree.dshHome);

    await assert.rejects(mounted.face.add({ path: src }), (error) => {
      const failure = asLocalError(error);
      assert.deepEqual(
        { code: failure.code, status: failure.status },
        { code: 'E_INSTALL_IO', status: 500 },
        '未知异常归一成 500 E_INSTALL_IO（不是 E_INTERNAL）',
      );
      assert.match(failure.message, /boom/, '原始原因留在开发者消息里（说得出坏在哪一步）');
      return true;
    });

    assert.equal(existsSync(join(root, 'qa-probe')), false, '不落半份（S10 失败清掉占位目录）');
    assert.deepEqual(await leftovers(root), [], '临时目录被清掉');
    assert.deepEqual(await ledgerBytes(mounted.tree.dshHome), before, '台账逐字节未变');
    assert.equal(existsSync(join(src, 'SKILL.md')), true, '源目录原样保留（不搬、不删）');
  } finally {
    await mounted.close();
  }
});

test('K129 S11 回读名不一致 ⇒ 500 E_INSTALL_IO，且刚落位的目录被清掉、台账未变', async () => {
  const mounted = await mountFace({
    copy: {
      // 真实落位成功，但落下去的 SKILL.md 声明的是另一个名字：这正是 S11 要抓的那一手。
      landSkill: async (_tempDir, target) => {
        await mkdir(target, { recursive: true, mode: 0o755 });
        await writeFile(join(target, 'SKILL.md'), skillFile({ name: 'other-skill' }));
      },
    },
  });
  try {
    const src = await sourceDir(mounted.tree.dshHome, 'probe', { declared: 'qa-probe' });
    const root = mounted.tree.skillsRoot;
    const before = await ledgerBytes(mounted.tree.dshHome);

    await assert.rejects(mounted.face.add({ path: src }), (error) => {
      const failure = asLocalError(error);
      assert.deepEqual(
        { code: failure.code, status: failure.status },
        { code: 'E_INSTALL_IO', status: 500 },
        '码与状态',
      );
      assert.match(failure.message, /different name/, '消息点明是「落下来的名字不对」');
      return true;
    });

    assert.equal(existsSync(join(root, 'qa-probe')), false, '刚落位的目录被清掉（不留在磁盘上）');
    assert.deepEqual(await entriesOf(root), [], 'skills 根里什么都不多');
    assert.deepEqual(await leftovers(root), [], '临时目录也清掉了');
    assert.deepEqual(await ledgerBytes(mounted.tree.dshHome), before, '台账逐字节未变');
  } finally {
    await mounted.close();
  }
});

test('K129 S11 回读抛错（SKILL.md 读不出来）⇒ 同样删掉刚落位的目录并报 500 E_INSTALL_IO', async () => {
  const mounted = await mountFace({
    copy: {
      // 落一个名字叫 SKILL.md 的**目录**：readFile 会 EISDIR，回读这一步抛错。
      landSkill: async (_tempDir, target) => {
        await mkdir(join(target, 'SKILL.md'), { recursive: true, mode: 0o755 });
      },
    },
  });
  try {
    const src = await sourceDir(mounted.tree.dshHome, 'probe', { declared: 'qa-probe' });
    const root = mounted.tree.skillsRoot;
    const before = await ledgerBytes(mounted.tree.dshHome);

    await assert.rejects(mounted.face.add({ path: src }), (error) => {
      const failure = asLocalError(error);
      assert.deepEqual({ code: failure.code, status: failure.status }, { code: 'E_INSTALL_IO', status: 500 }, '码与状态');
      assert.match(failure.message, /read back/, '消息点明是回读这一步');
      return true;
    });

    assert.equal(existsSync(join(root, 'qa-probe')), false, '回读失败也要清掉刚落位的目录（不留半份）');
    assert.deepEqual(await leftovers(root), [], '临时目录被清掉');
    assert.deepEqual(await ledgerBytes(mounted.tree.dshHome), before, '台账逐字节未变');
  } finally {
    await mounted.close();
  }
});

test('K129 反证：注入缝不改变成功路径——真实 copy（不传）时 add → remove 仍能往返', async () => {
  // 往返要走真的 `rescan()`（remove 靠它按名字重新找到那一行），所以这条用**路由层**的
  // `mount()`：不传 copy 就是原样，证明上面那个注入缝只是「可替换」而不是「被替换过」。
  const mounted = await mount();
  try {
    const src = await sourceDir(mounted.tree.dshHome, 'probe', {
      declared: 'qa-probe',
      files: { 'docs/guide.md': '# guide\n' },
    });
    const root = mounted.tree.skillsRoot;

    const added = await mounted.call('add', { path: src });
    assert.equal(added.status, 200, '真实 copy 仍然落位（缝不传就等于原样）');
    assert.equal(added.json.data.name, 'qa-probe', '名字取声明名');
    assert.deepEqual(await entriesOf(join(root, 'qa-probe')), ['SKILL.md', 'docs'], '文件照旧按清单复制');
    assert.deepEqual(await leftovers(root), [], '成功路径不留临时目录');
    assert.equal((await mounted.market.store.read()).doc.installs.length, 1, '台账写了一条');

    // 面板删的时候发的是 list 里那一行的 path（不是 add 回给它的），照原样学一遍：
    // /var 与 /private/var 这种别名差异在真机上就是 D5 的 E_STALE_PATH。
    const listed = await callRoute(mounted.byPath[ROUTES.list], { headers: LOOPBACK_HEADERS });
    const row = listed.json.data.groups.flatMap((group) => group.skills).find((entry) => entry.name === 'qa-probe');
    assert.ok(row !== undefined, 'list 里有这一行（往返的前置）');
    const removed = await mounted.call('remove', { name: row.name, path: row.path });
    assert.equal(removed.status, 200, '接着删掉 ⇒ 200');
    assert.equal(removed.json.data.ledger, 'cleared', '台账清掉');
    assert.equal(existsSync(join(root, 'qa-probe')), false, '目录删掉');
    assert.deepEqual(await entriesOf(root), [], 'skills 根回到空');
    assert.equal((await mounted.market.store.read()).doc.installs.length, 0, '台账回到空');
  } finally {
    await mounted.close();
  }
});

test('K129 tempDirOf 注入：前缀仍是 .skc-install-，失败后照样清干净', async () => {
  const made = [];
  const mounted = await mountFace({
    copy: {
      tempDirOf: (root) => {
        const temp = join(root, `${TEMP_PREFIX}probe`);
        made.push(temp);
        return temp;
      },
      landSkill: async () => {
        throw new Error('boom after staging');
      },
    },
  });
  try {
    const src = await sourceDir(mounted.tree.dshHome, 'probe', { declared: 'qa-probe' });
    const root = mounted.tree.skillsRoot;
    const before = await ledgerBytes(mounted.tree.dshHome);

    await assert.rejects(mounted.face.add({ path: src }), (error) => {
      assert.equal(asLocalError(error).code, 'E_INSTALL_IO', '码仍是 E_INSTALL_IO');
      return true;
    });

    assert.equal(made.length, 1, '注入的 tempDirOf 真的被调用了一次');
    assert.equal(made[0].startsWith(join(root, TEMP_PREFIX)), true, '临时目录前缀仍是 .skc-install-（真机清理靠这个名字）');
    assert.equal(existsSync(made[0]), false, '注入的临时目录在失败后被删掉');
    assert.deepEqual(await leftovers(root), [], '根目录里没有任何 .skc-install-* 残留');
    assert.deepEqual(await ledgerBytes(mounted.tree.dshHome), before, '台账逐字节未变');
  } finally {
    await mounted.close();
  }
});
