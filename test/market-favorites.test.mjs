/**
 * `lib/market/favorites.js` — the panel's own bookmark list.
 *
 * Contract: docs/contracts/market.md §7.7 (identity key, file shape, cap, idempotency,
 * degradation, atomicity) and docs/contracts/routes.md §3.7.6 (`market/favorite`'s
 * idempotency and cap); case id K75.
 *
 * Every case here is about one promise the file makes to the rest of the plugin:
 * a corrupt file never breaks the page, a repeated write changes nothing, the cap only
 * blocks growth, a failed write leaves the previous bytes alone, and two clicks in the
 * same tick cannot overwrite each other. The file is a *local* store: it is written with
 * the same temp-file + fsync + rename path as the install ledger.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  MAX_FAVORITES,
  createFavoritesStore,
  deserializeFavorites,
  favoritesFile,
  isFavoriteId,
  serializeFavorites,
} from '../lib/market/favorites.js';
import { tempDir } from './helpers/tree.mjs';

/** One identity of each source, in the shape the Host builds. */
const A = 'skillhub:ake:dev-god';
const B = 'clawhub:ivangdavila:design';

/**
 * A store bound to a fresh temp home.
 * @returns {Promise<{store: object, dshHome: string, file: string, close: Function}>} the store and its paths.
 */
async function tempStore() {
  const { dir, cleanup } = await tempDir();
  return { store: createFavoritesStore({ dshHome: dir }), dshHome: dir, file: favoritesFile(dir), close: cleanup };
}

/**
 * Read the raw bytes of the bookmark file.
 * @param {string} file - absolute path.
 * @returns {Promise<string>} the text.
 */
const textOf = (file) => readFile(file, 'utf8');

/**
 * Temp files a failed write could have left behind.
 * @param {string} dshHome - the home the file lives under.
 * @returns {Promise<string[]>} leftover `.favorites.*.tmp` names.
 */
async function tempLeftovers(dshHome) {
  try {
    const names = await readdir(join(dshHome, 'dsh-skill-panel'));
    return names.filter((name) => name.includes('.tmp'));
  } catch {
    return [];
  }
}

test('K75 收藏键的形状就是三元组：两冒号、三段都是上游白名单', () => {
  assert.equal(isFavoriteId(A), true, 'source:owner:slug 合法');
  assert.equal(isFavoriteId(B), true, '两源都是同一个形状');
  assert.equal(isFavoriteId('skillhub:ake'), false, '少一段不算');
  assert.equal(isFavoriteId('skillhub:ake:dev-god:extra'), false, '多一段不算');
  assert.equal(isFavoriteId('skillhub::dev-god'), false, '空 owner 不算');
  assert.equal(isFavoriteId('skillhub:../x:dev-god'), false, '路径片段不算');
  assert.equal(isFavoriteId('SKILLHUB:ake:dev-god'), false, '源 id 小写开头');
  assert.equal(isFavoriteId(''), false, '空串不算');
  assert.equal(isFavoriteId(null), false, '非字符串不算');
  assert.equal(isFavoriteId(`skillhub:${'a'.repeat(200)}:x`), false, '超长条目不算');
});

test('K75 序列化与反序列化：最新在前、去重、丢坏条目、超上限截断', () => {
  const text = serializeFavorites([A, A, B]);
  assert.equal(text.endsWith('\n'), true, '文件以换行结尾（与台账一致）');
  assert.deepEqual(JSON.parse(text), { version: 1, favorites: [A, A, B] }, '序列化不替调用方去重');

  assert.deepEqual(deserializeFavorites(text), { favorites: [A, B], readable: true }, '读侧去重且保留首次位置');

  const dirty = JSON.stringify({ version: 1, favorites: [A, '', 42, null, 'not-a-key', A, B] });
  assert.deepEqual(
    deserializeFavorites(dirty),
    { favorites: [A, B], readable: true },
    '逐条丢坏条目，好的照留（手改坏了只该丢坏行）',
  );

  const many = Array.from({ length: MAX_FAVORITES + 10 }, (_, i) => `skillhub:ake:id-${i}`);
  const parsed = deserializeFavorites(JSON.stringify({ version: 1, favorites: many }));
  assert.equal(parsed.favorites.length, MAX_FAVORITES, `超过 ${MAX_FAVORITES} 条时截断`);
  assert.equal(parsed.favorites[0], many[0], '截断保留前 500 条（最新在前）');
});

test('K75 损坏降级：非 JSON / 顶层非对象 / favorites 非数组 ⇒ 空集 + readable:false，不抛', () => {
  for (const raw of ['{', '[]', '"text"', 'null', '3', '{"favorites":3}', '{"favorites":{}}', '{"version":1}']) {
    const parsed = deserializeFavorites(raw);
    assert.deepEqual(parsed.favorites, [], `${JSON.stringify(raw)} ⇒ 空集`);
    assert.equal(parsed.readable, false, `${JSON.stringify(raw)} ⇒ readable:false`);
  }
});

test('K75 文件缺失是首启，不是损坏：空集 + readable:true，且读不建文件', async () => {
  const { store, dshHome, close } = await tempStore();
  try {
    const { favorites, readable } = await store.read();
    assert.deepEqual(favorites, [], '没有文件 ⇒ 空集');
    assert.equal(readable, true, '缺失 ≠ 损坏：全新安装不该报「你的书签可能丢了」');
    assert.deepEqual(await readdir(dshHome), [], '读只读：不顺手创建目录或空文件（否则下次就分不清首启与损坏）');

    // The first real save has to work on that same never-written home (mkdir -p layer).
    const saved = await store.toggle(A, true);
    assert.deepEqual(saved, { favorites: [A], favorited: true }, '首次收藏在没有任何目录时也能落盘');
    assert.deepEqual((await store.read()).favorites, [A], '写完立刻读得到');
  } finally {
    await close();
  }
});

test('K75 不可读与损坏才报 readable:false（EISDIR 与坏 JSON 两条路）', async () => {
  const { store, dshHome, close } = await tempStore();
  try {
    // A directory where the file should be: the read fails for a reason that is not ENOENT.
    await mkdir(favoritesFile(dshHome), { recursive: true });
    const unreadable = await store.read();
    assert.deepEqual(unreadable.favorites, [], '读不出来 ⇒ 空集');
    assert.equal(unreadable.readable, false, '不可读（EISDIR）⇒ readable:false');
  } finally {
    await close();
  }
});

test('K75 幂等：状态与现状一致时不写盘，回包仍是当前列表', async () => {
  const { store, dshHome, close } = await tempStore();
  try {
    await store.toggle(A, true);
    const before = await stat(favoritesFile(dshHome));
    const text = await textOf(favoritesFile(dshHome));

    const again = await store.toggle(A, true);
    assert.deepEqual(again, { favorites: [A], favorited: true }, '重复收藏回当前列表 + 生效状态');
    const after = await stat(favoritesFile(dshHome));
    assert.equal(await textOf(favoritesFile(dshHome)), text, '文件字节不变（幂等不写盘）');
    assert.equal(after.mtimeMs, before.mtimeMs, '连 mtime 都不变（没有无意义的写）');

    const missing = await store.toggle(B, false);
    assert.deepEqual(missing, { favorites: [A], favorited: false }, '取消一个不存在的 id 也算成功');
    assert.equal(await textOf(favoritesFile(dshHome)), text, '同样不写盘');
  } finally {
    await close();
  }
});

test('K75 最新在前：后收藏的排在最前，取消只删那一条', async () => {
  const { store, dshHome, close } = await tempStore();
  try {
    await store.toggle(A, true);
    await store.toggle(B, true);
    assert.deepEqual((await store.read()).favorites, [B, A], '最新收藏在最前');
    assert.equal(await textOf(favoritesFile(dshHome)), serializeFavorites([B, A]), '落盘顺序与回包一致');

    await store.toggle(B, false);
    assert.deepEqual((await store.read()).favorites, [A], '取消只删那一条');
  } finally {
    await close();
  }
});

test('K75 上限 500：满时新增 409 E_FAVORITE_FULL，取消永远允许', async () => {
  const { store, dshHome, file, close } = await tempStore();
  try {
    await mkdir(join(dshHome, 'dsh-skill-panel'), { recursive: true });
    const full = Array.from({ length: MAX_FAVORITES }, (_, i) => `skillhub:ake:id-${i}`);
    await writeFile(file, serializeFavorites(full), 'utf8');

    await assert.rejects(
      () => store.toggle('skillhub:ake:one-more', true),
      (error) => error.code === 'E_FAVORITE_FULL',
      '满 500 再加一条 ⇒ E_FAVORITE_FULL（HTTP 409 由路由层映射）',
    );
    assert.deepEqual((await store.read()).favorites.length, MAX_FAVORITES, '失败时清单一条不多');

    const removed = await store.toggle(full[0], false);
    assert.equal(removed.favorited, false, '满的时候取消仍然允许（上限只拦增长）');
    assert.equal(removed.favorites.length, MAX_FAVORITES - 1, '少了一条');
    const readded = await store.toggle('skillhub:ake:one-more', true);
    assert.equal(readded.favorited, true, '腾出位置后能再收一条');
    assert.equal(readded.favorites[0], 'skillhub:ake:one-more', '新收的排最前');
  } finally {
    await close();
  }
});

test('K75 原子写失败：旧文件字节不变、没有 .tmp 残留、错误码是 E_FAVORITE_IO', async () => {
  const { store, dshHome, file, close } = await tempStore();
  try {
    await store.toggle(A, true);
    const before = await textOf(file);
    const dir = join(dshHome, 'dsh-skill-panel');
    // A read-only directory is the cheapest real I/O failure: the temp file cannot be
    // created, so the old bytes must survive untouched.
    await chmod(dir, 0o555);
    try {
      await assert.rejects(
        () => store.toggle(B, true),
        (error) => error.code === 'E_FAVORITE_IO',
        '写盘失败 ⇒ E_FAVORITE_IO（HTTP 500 由路由层映射）',
      );
      assert.equal(await textOf(file), before, '旧文件字节不变（临时文件 + rename 的意义）');
      assert.deepEqual(await tempLeftovers(dshHome), [], '没有 .favorites.*.tmp 残留');
    } finally {
      await chmod(dir, 0o755);
    }
    // And the store still works after the transient failure.
    const recovered = await store.toggle(B, true);
    assert.deepEqual(recovered.favorites, [B, A], '目录恢复可写后照常工作（失败的 toggle 不毒化队列）');
  } finally {
    await close();
  }
});

test('K75 进程内串行化：同一 tick 两次 toggle 都落盘，不互相覆盖', async () => {
  const { store, dshHome, close } = await tempStore();
  try {
    const [first, second] = await Promise.all([store.toggle(A, true), store.toggle(B, true)]);
    assert.deepEqual(first, { favorites: [A], favorited: true }, '第一次看到的是空集 + 自己');
    assert.deepEqual(second, { favorites: [B, A], favorited: true }, '第二次在自己的结果里看到前一条');
    assert.deepEqual((await store.read()).favorites, [B, A], '文件里两条都在（后写覆盖先写 = 失败）');
    assert.equal(
      await textOf(favoritesFile(dshHome)),
      serializeFavorites([B, A]),
      '落盘内容与最后一次回包逐字节相同',
    );
  } finally {
    await close();
  }
});

test('K75 文件位置就是本插件自己的目录，不碰别人的存储', async () => {
  const { store, dshHome, file, close } = await tempStore();
  try {
    assert.equal(file, join(dshHome, 'dsh-skill-panel', 'favorites.json'), '落在 $DSH_HOME/dsh-skill-panel/');
    await store.toggle(A, true);
    assert.deepEqual(
      (await readdir(dshHome)).sort(),
      ['dsh-skill-panel'],
      '除了自己的目录什么都不创建（不写 skills-manager / skill-market / lock 文件）',
    );
  } finally {
    await close();
  }
});

test('K75 同名不同源是两个键：skillhub:x:y 与 clawhub:x:y 互不影响', async () => {
  const { store, close } = await tempStore();
  try {
    const skillhub = 'skillhub:ake:dev-god';
    const clawhub = 'clawhub:ake:dev-god';
    const otherSlug = 'clawhub:ake:dev-god-2';

    await store.toggle(skillhub, true);
    assert.deepEqual((await store.read()).favorites, [skillhub], '先只有 SkillHub 那一条');

    const both = await store.toggle(clawhub, true);
    assert.deepEqual(both.favorites, [clawhub, skillhub], '两源的同名条目各占一条，不是同一个键');

    const slugVariant = await store.toggle(otherSlug, true);
    assert.deepEqual(slugVariant.favorites, [otherSlug, clawhub, skillhub], 'slug 也是身份的一部分（a:b:c ≠ a:b:d）');

    const removed = await store.toggle(skillhub, false);
    assert.deepEqual(removed.favorites, [otherSlug, clawhub], '取消一个源的收藏不动另一个源的同名条目');
    assert.equal(removed.favorited, false, '取消生效');
  } finally {
    await close();
  }
});

test('K75 同一 tick 一收一取同一个 id：排队后两条都生效，最终是空的', async () => {
  const { store, dshHome, close } = await tempStore();
  try {
    // Two clicks in the same tick are two intentions; the queue decides their order, so
    // the second one must see the first one's list rather than a stale empty file.
    const [first, second] = await Promise.all([store.toggle(A, true), store.toggle(A, false)]);
    assert.deepEqual(first, { favorites: [A], favorited: true }, '第一条收藏先落地');
    assert.deepEqual(second, { favorites: [], favorited: false }, '第二条在第一条的结果上取消');
    assert.deepEqual((await store.read()).favorites, [], '文件里也是空的（没有谁把谁盖回去）');
    assert.equal(await textOf(favoritesFile(dshHome)), serializeFavorites([]), '落盘内容等于最后一条回包');
  } finally {
    await close();
  }
});

test('K75 满 500 时重复收藏已有条目仍然成功：上限只拦增长，不误拦幂等', async () => {
  const { store, dshHome, file, close } = await tempStore();
  try {
    await mkdir(join(dshHome, 'dsh-skill-panel'), { recursive: true });
    const full = Array.from({ length: MAX_FAVORITES }, (_, i) => `skillhub:ake:id-${i}`);
    await writeFile(file, serializeFavorites(full), 'utf8');
    const before = await textOf(file);

    const again = await store.toggle(full[7], true);
    assert.equal(again.favorited, true, '已经在收藏里 ⇒ 幂等成功（不是 409）');
    assert.equal(again.favorites.length, MAX_FAVORITES, '列表不增不减');
    assert.equal(await textOf(file), before, '也不写盘');
  } finally {
    await close();
  }
});

test('K75 失败发生在临时文件建好之后：rename 目标不可替换 ⇒ E_FAVORITE_IO 且 .tmp 被清掉', async () => {
  const { store, dshHome, file, close } = await tempStore();
  try {
    // A directory sitting on the file's own path: `readFile` says EISDIR, and the write
    // path gets past `open(temp)` / `writeFile` / `sync` and only fails at the rename.
    // That is the one failure mode where a half-written temp file could be left behind,
    // so it is the one that proves the cleanup branch.
    await mkdir(file, { recursive: true });
    await assert.rejects(
      () => store.toggle(A, true),
      (error) => error.code === 'E_FAVORITE_IO',
      'rename 失败也映射成 E_FAVORITE_IO（不是 E_INSTALL_IO，也不是 E_INTERNAL）',
    );
    assert.deepEqual(await tempLeftovers(dshHome), [], '目录里没有 .favorites.*.tmp 残留（rm 清理分支生效）');
    assert.equal((await stat(file)).isDirectory(), true, '原物没被动过（既没被替换也没被删）');
  } finally {
    await close();
  }
});
