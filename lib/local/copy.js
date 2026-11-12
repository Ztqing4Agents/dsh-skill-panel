/**
 * The copy pipeline: look at a directory, stage a byte-for-byte copy of it inside the
 * skills root, then move the staged copy into place under its skill name.
 *
 * Three rules shape every line here:
 *
 * - **Nothing is followed.** A symlink anywhere inside the source tree refuses the
 *   whole copy (it points outside the directory the user chose), and the copy itself
 *   is opened with `wx` so it cannot land on top of an existing file. The source
 *   directory itself may be a symlink - the caller resolves it first, which is what
 *   turns "copy this link" into "copy the real directory".
 * - **Nothing is executed and nothing leaves the staging directory.** Only regular
 *   files and subdirectories are copied; every target path is checked against the
 *   staging directory it was joined from.
 * - **The visible moment is one rename.** The scanner skips dot-prefixed entries, so
 *   a half-written copy is never listed; the claim directory is created at the final
 *   name and the staged copy is renamed onto it.
 */
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, rename, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { isWithin } from '../names.js';
import { marketError } from '../market/errors.js';
import { TEMP_PREFIX } from '../market/install.js';
import { LOCAL_LIMITS, checkPlan, isSkippedEntry } from './rules.js';

/**
 * Describe a system error without leaking a stack.
 * @param {unknown} cause - whatever was thrown.
 * @returns {string} a short description.
 */
function describe(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Best-effort directory fsync.
 *
 * A copy is only as durable as the directory entry that names it, so every directory
 * the copy created is synced before the rename. Failure is ignored: this is an
 * extra durability step, not a precondition.
 * @param {string} directory - directory to sync.
 * @returns {Promise<void>} resolves either way.
 */
async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch {
    // Directory fsync is not portable; the bytes are already written.
  } finally {
    try {
      await handle?.close();
    } catch {
      // Already closed.
    }
  }
}

/**
 * Name one dot-prefixed staging directory inside the skills root, without creating it.
 * @param {string} skillsRoot - directory the copy will eventually land in.
 * @returns {string} the staging path.
 */
export function tempDirOf(skillsRoot) {
  return join(skillsRoot, `${TEMP_PREFIX}${process.pid}-${randomBytes(3).toString('hex')}`);
}

/**
 * List everything one source directory would copy, and refuse it when it cannot be
 * copied safely.
 *
 * The listing is the whole plan: the copy stage never reads the source directory
 * again, so what was measured is exactly what is written. `node_modules` and
 * dot-prefixed entries are skipped, not refused (a working directory may hold both);
 * a symlink, a special file, or a tree over the limits refuses the whole copy with
 * `E_PACKAGE_INVALID`.
 * @param {string} sourceDir - absolute source directory.
 * @returns {Promise<{ok: boolean, code?: string, entries: {rel: string, size: number}[], bytes: number}>} the plan.
 * @throws {import('../market/errors.js').MarketError} with `E_INSTALL_IO` when the tree cannot be read.
 */
export async function planCopy(sourceDir) {
  const scanned = [];
  let bytes = 0;

  /**
   * Walk one directory level and recurse.
   * @param {string} relativeDir - directory relative to the source root, `''` at the top.
   * @returns {Promise<boolean>} true when the tree must be refused.
   */
  const walk = async (relativeDir) => {
    const directory = relativeDir === '' ? sourceDir : join(sourceDir, relativeDir);
    let dirents;
    try {
      dirents = await readdir(directory, { withFileTypes: true });
    } catch (cause) {
      throw marketError('E_INSTALL_IO', `could not read ${relativeDir === '' ? 'the source directory' : relativeDir} (${describe(cause)})`);
    }
    for (const dirent of dirents) {
      if (isSkippedEntry(dirent.name)) continue;
      const rel = relativeDir === '' ? dirent.name : `${relativeDir}/${dirent.name}`;
      let stat;
      try {
        stat = await lstat(join(sourceDir, rel));
      } catch (cause) {
        throw marketError('E_INSTALL_IO', `could not inspect ${rel} (${describe(cause)})`);
      }
      if (stat.isSymbolicLink()) return true;
      if (stat.isDirectory()) {
        if (await walk(rel)) return true;
        continue;
      }
      // A fifo, socket or device node is not content a skill can run on: refusing the
      // whole copy is the only answer that does not silently drop part of the skill.
      if (!stat.isFile()) return true;
      scanned.push({ path: rel, size: stat.size, symlink: false });
      bytes += stat.size;
      // The tree is refused the moment it is provably too big, so a pathological
      // directory is not walked to the end just to be told so. The verdict itself is
      // still `checkPlan`'s: same code, one rule.
      if (scanned.length > LOCAL_LIMITS.maxEntries) return true;
    }
    return false;
  };

  const refused = await walk('');
  if (refused) return { ok: false, code: 'E_PACKAGE_INVALID', entries: [], bytes: 0 };
  const verdict = checkPlan(scanned);
  if (!verdict.ok) return { ok: false, code: verdict.code, entries: [], bytes: 0 };
  return {
    ok: true,
    entries: scanned.map((entry) => ({ rel: entry.path, size: entry.size })),
    bytes,
  };
}

/**
 * Write one plan into the staging directory.
 *
 * Every file is created with `wx`, so a duplicate entry inside the plan (which the
 * listing makes impossible, but which a future caller could hand over) fails instead
 * of overwriting. Each directory the copy creates is fsynced before the parent is
 * handed to the rename stage.
 * @param {string} sourceDir - absolute source directory the plan was measured from.
 * @param {string} tempDir - absolute staging directory, already created.
 * @param {{entries: {rel: string, size: number}[]}} plan - the plan from `planCopy`.
 * @returns {Promise<{files: number, bytes: number}>} what was written.
 * @throws {import('../market/errors.js').MarketError} with `E_INSTALL_IO` on a write failure.
 */
export async function copyPlan(sourceDir, tempDir, plan) {
  const entries = Array.isArray(plan?.entries) ? plan.entries : [];
  const directories = new Set([tempDir]);
  let written = 0;
  for (const entry of entries) {
    const rel = typeof entry?.rel === 'string' ? entry.rel : '';
    if (rel === '') throw marketError('E_PACKAGE_INVALID', 'the copy plan holds an entry with no path');
    const target = join(tempDir, rel);
    if (!isWithin(tempDir, target)) {
      throw marketError('E_PACKAGE_INVALID', 'the copy plan leaves the staging directory');
    }
    const parent = dirname(target);
    try {
      await mkdir(parent, { recursive: true, mode: 0o755 });
    } catch (cause) {
      throw marketError('E_INSTALL_IO', `could not create ${rel} (${describe(cause)})`);
    }
    directories.add(parent);
    let bytes;
    try {
      bytes = await readFile(join(sourceDir, rel));
    } catch (cause) {
      throw marketError('E_INSTALL_IO', `could not read ${rel} (${describe(cause)})`);
    }
    let handle;
    try {
      handle = await open(target, 'wx', 0o644);
      await handle.writeFile(bytes);
      await handle.sync();
      written += bytes.length;
    } catch (cause) {
      throw marketError('E_INSTALL_IO', `could not write ${rel} (${describe(cause)})`);
    } finally {
      try {
        await handle?.close();
      } catch {
        // Already closed.
      }
    }
  }
  // Deepest first: a parent is only durable once its children are.
  for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
    await syncDirectory(directory);
  }
  return { files: entries.length, bytes: written };
}

/**
 * Move the staged copy onto its final name.
 *
 * The claim directory is created first so the final name is taken before anything is
 * moved; `rename` then swaps an empty directory for a whole one, which is atomic. If
 * the rename fails, the claim is removed **only when still empty** - deleting a
 * directory somebody else filled would be worse than leaving an empty one behind.
 * @param {string} tempDir - absolute staging directory holding the copy.
 * @param {string} targetDir - absolute destination directory, not yet occupied.
 * @returns {Promise<string>} `targetDir`.
 * @throws {import('../market/errors.js').MarketError} `E_ALREADY_INSTALLED` / `E_INSTALL_IO`.
 */
export async function landSkill(tempDir, targetDir) {
  try {
    await mkdir(targetDir, { mode: 0o755 });
  } catch (cause) {
    if (cause?.code === 'EEXIST') {
      throw marketError('E_ALREADY_INSTALLED', 'a skill directory already occupies that name', { path: targetDir });
    }
    throw marketError('E_INSTALL_IO', `could not claim the skill directory (${describe(cause)})`);
  }
  try {
    await rename(tempDir, targetDir);
  } catch (cause) {
    try {
      await rmdir(targetDir);
    } catch {
      // Not empty (or already gone): leave it alone.
    }
    throw marketError('E_INSTALL_IO', `could not move the copy into place (${describe(cause)})`);
  }
  await syncDirectory(dirname(targetDir));
  return targetDir;
}
