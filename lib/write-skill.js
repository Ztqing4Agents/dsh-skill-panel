/**
 * Atomic, verified writes of the `disable-model-invocation` field.
 *
 * Order of operations: fingerprint the file, compute the new bytes, write a temp
 * file in the same directory with `wx`, fsync it, re-check the fingerprint, rename
 * over the original, then read the result back and compare byte for byte. A rename
 * swaps the inode, so the original mode is copied onto the temp file first - without
 * that step a 0600 SKILL.md would come back as 0666 & ~umask.
 *
 * A SKILL.md that is itself a symlink is refused up front, and both fingerprint
 * readings come from `lstat`: mixing `fstat` (the opened handle, which follows the
 * link) with `lstat` (the path, which describes the link) made a symlinked entry
 * look like a concurrent edit, and reported E_FILE_CHANGED for what is really a
 * read-only target.
 *
 * Every failure that leaves the file untouched is reported with the route's own
 * error code; every failure after the rename rolls the original bytes back.
 */
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { isNoFrontmatterError, parseFrontmatter, setDisableModelInvocation } from './frontmatter.js';

/**
 * Build an error carrying a route error code.
 * @param {string} code - `E_*` constant.
 * @param {string} message - English developer note.
 * @returns {Error} the error.
 */
function writeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Describe a file's identity for change detection.
 * @param {import('node:fs').Stats} info - stat result.
 * @returns {{size: number, mtimeMs: number, ino: number, dev: number}} fingerprint.
 */
function fingerprint(info) {
  return { size: info.size, mtimeMs: info.mtimeMs, ino: info.ino, dev: info.dev };
}

/**
 * Whether two fingerprints describe the same unchanged file.
 * @param {{size: number, mtimeMs: number, ino: number, dev: number}} left - first.
 * @param {{size: number, mtimeMs: number, ino: number, dev: number}} right - second.
 * @returns {boolean} true when nothing changed.
 */
function sameFingerprint(left, right) {
  return left.size === right.size && left.mtimeMs === right.mtimeMs && left.ino === right.ino && left.dev === right.dev;
}

/**
 * Write bytes to a temp file beside the target, fsync it, and keep the target's mode.
 * @param {string} file - target file.
 * @param {Buffer} bytes - bytes to write.
 * @param {number} mode - mode to carry over from the original file.
 * @returns {Promise<string>} the temp path.
 */
async function writeTemp(file, bytes, mode) {
  const temp = join(dirname(file), `${basename(file)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  const handle = await open(temp, 'wx', mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return temp;
}

/**
 * Best-effort directory fsync, so the rename itself survives a crash.
 * @param {string} dir - directory holding the renamed file.
 * @returns {Promise<void>} resolves whether or not the platform allows it.
 */
async function syncDirectory(dir) {
  let handle;
  try {
    handle = await open(dir, 'r');
    await handle.sync();
  } catch {
    // Directory fsync is not portable; the rename already landed.
  } finally {
    try {
      await handle?.close();
    } catch {
      // Already closed.
    }
  }
}

/**
 * Rewrite one SKILL.md's `disable-model-invocation` field.
 * @param {string} file - absolute path of the SKILL.md.
 * @param {boolean} disabled - the value to write: true for disabled.
 * @returns {Promise<{path: string, disableModelInvocation: boolean, changed: boolean}>} write result.
 * @throws {Error} with `code` 'E_SYMLINK_READONLY' | 'E_WRITE_FAILED' | 'E_FILE_CHANGED'
 *   | 'E_VERIFY_FAILED' | 'E_NOT_WRITABLE'.
 */
export async function writeDisableFlag(file, disabled) {
  const dir = dirname(file);
  let entry;
  try {
    entry = await lstat(dir);
  } catch {
    throw writeError('E_NOT_WRITABLE', 'skill directory is not readable');
  }
  if (entry.isSymbolicLink()) throw writeError('E_SYMLINK_READONLY', 'skill directory is a symlink');
  let fileInfo;
  try {
    fileInfo = await lstat(file);
  } catch {
    throw writeError('E_WRITE_FAILED', 'skill file is not readable');
  }
  if (fileInfo.isSymbolicLink()) throw writeError('E_SYMLINK_READONLY', 'skill file is a symlink');
  if (!fileInfo.isFile()) throw writeError('E_NOT_WRITABLE', 'skill file is not a regular file');
  /** Both readings of the fingerprint use lstat, so they describe the same object. */
  const before = fingerprint(fileInfo);
  const mode = fileInfo.mode & 0o777;
  let original;
  try {
    const handle = await open(file, 'r');
    try {
      original = await handle.readFile();
    } finally {
      await handle.close();
    }
  } catch {
    throw writeError('E_WRITE_FAILED', 'skill file is not readable');
  }
  let rewrite;
  try {
    rewrite = setDisableModelInvocation(original, disabled);
  } catch (cause) {
    if (isNoFrontmatterError(cause)) {
      throw writeError('E_NOT_WRITABLE', 'skill file has no frontmatter block');
    }
    throw writeError('E_WRITE_FAILED', cause instanceof Error ? cause.message : String(cause));
  }
  if (!rewrite.changed) return { path: file, disableModelInvocation: disabled, changed: false };
  let temp;
  try {
    temp = await writeTemp(file, rewrite.next, mode);
  } catch (cause) {
    throw writeError('E_WRITE_FAILED', cause instanceof Error ? cause.message : String(cause));
  }
  try {
    const after = fingerprint(await lstat(file));
    if (!sameFingerprint(before, after)) {
      await discard(temp);
      throw writeError('E_FILE_CHANGED', 'skill file changed while the panel was open');
    }
    await rename(temp, file);
    temp = undefined;
    await syncDirectory(dir);
  } catch (cause) {
    if (temp !== undefined) await discard(temp);
    if (cause && typeof cause === 'object' && cause.code === 'E_FILE_CHANGED') throw cause;
    throw writeError('E_WRITE_FAILED', cause instanceof Error ? cause.message : String(cause));
  }
  const problem = await verify(file, rewrite.next, disabled);
  if (problem !== null) {
    await restore(file, original, mode);
    throw writeError('E_VERIFY_FAILED', problem);
  }
  return { path: file, disableModelInvocation: disabled, changed: true };
}

/**
 * Remove a temp file, ignoring the case where it never existed.
 * @param {string} file - temp path.
 * @returns {Promise<void>} resolves either way.
 */
async function discard(file) {
  try {
    await unlink(file);
  } catch {
    // Nothing to clean up.
  }
}

/**
 * Read a written file back and check both bytes and parsed field.
 * @param {string} file - written file.
 * @param {Buffer} expected - the bytes that should be on disk.
 * @param {boolean} disabled - the field value that should parse back.
 * @returns {Promise<string|null>} a description of the mismatch, or null when clean.
 */
async function verify(file, expected, disabled) {
  let actual;
  try {
    actual = await readFile(file);
  } catch {
    return 'written file is not readable';
  }
  if (!actual.equals(expected)) return 'written file does not match the intended bytes';
  const parsed = parseFrontmatter(actual.toString('utf8'));
  if (parsed.disableModelInvocation !== disabled) return 'written field does not read back as written';
  return null;
}

/**
 * Put the original bytes back after a failed verification.
 * @param {string} file - file to repair.
 * @param {Buffer} original - bytes to restore.
 * @param {number} mode - mode to keep.
 * @returns {Promise<void>} resolves whether or not the repair landed.
 */
async function restore(file, original, mode) {
  let temp;
  try {
    temp = await writeTemp(file, original, mode);
    await rename(temp, file);
  } catch {
    if (temp !== undefined) await discard(temp);
  }
}
