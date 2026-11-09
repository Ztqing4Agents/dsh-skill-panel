/**
 * A minimal, defensive ZIP reader.
 *
 * ClawHub hands out packages as zip archives, and the plugin has no dependencies, so
 * this module reads the format itself: end-of-central-directory, then the central
 * directory, then each local header. Only the two compression methods that need no
 * library are accepted (`0` stored, `8` deflate).
 *
 * Every limit exists because the archive is third-party input:
 *
 * - 200 entries, 5 MiB per file, 20 MiB expanded, 40 MiB compressed (a bomb needs
 *   volume, and the expanded total is the only honest bound);
 * - path safety through `isSafeRelativePath` (zip-slip, drive letters, `..` segments);
 * - symbolic-link entries are refused outright rather than skipped: a package that
 *   loses a file silently is worse than a package that fails loudly;
 * - encrypted entries are refused - this reader will never implement decryption;
 * - zip64 is refused: no supported upstream produces it, and guessing at the extra
 *   fields would be guesswork inside a security boundary.
 */
import { inflateRawSync } from 'node:zlib';

import { marketError } from './errors.js';
import { isSafeRelativePath } from '../names.js';

/** Hard bounds on one archive. */
export const ZIP_LIMITS = {
  entries: 200,
  file: 5 * 1024 * 1024,
  total: 20 * 1024 * 1024,
  archive: 40 * 1024 * 1024,
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const SYMLINK_MODE = 0xa000;

/**
 * Build the one error this module throws.
 * @param {string} message - what is wrong with the archive.
 * @returns {import('./errors.js').MarketError} an E_PACKAGE_INVALID error.
 */
function invalid(message) {
  return marketError('E_PACKAGE_INVALID', message);
}

/** CRC32 lookup table, built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/**
 * CRC32 of a buffer, as stored in a zip entry header.
 * @param {Buffer} buffer - bytes to checksum.
 * @returns {number} unsigned 32-bit checksum.
 */
export function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

/**
 * Find the end-of-central-directory record.
 * @param {Buffer} buffer - whole archive.
 * @returns {number} its offset.
 * @throws {import('./errors.js').MarketError} when the archive has no such record.
 */
function findEndOfDirectory(buffer) {
  const floor = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= floor; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw invalid('not a zip archive: the end-of-central-directory record is missing');
}

/**
 * Read the central directory of a package.
 * @param {Buffer} buffer - whole archive.
 * @returns {{path: string, size: number, compressedSize: number, method: number,
 *   crc32: number, localOffset: number}[]} the file entries.
 * @throws {import('./errors.js').MarketError} when the archive breaks any rule.
 */
export function readZipEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw invalid('the archive is empty');
  if (buffer.length > ZIP_LIMITS.archive) {
    throw invalid(`the archive is larger than ${ZIP_LIMITS.archive} bytes`);
  }
  const eocd = findEndOfDirectory(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (count === 0) throw invalid('the archive lists no entries');
  if (count > ZIP_LIMITS.entries) {
    throw invalid(`the archive lists ${count} entries, the limit is ${ZIP_LIMITS.entries}`);
  }
  const entries = [];
  const seen = new Set();
  let cursor = directoryOffset;
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > buffer.length) throw invalid('the central directory is truncated');
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw invalid('a central directory entry has the wrong signature');
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const checksum = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.length) throw invalid('a central directory entry name is truncated');
    const path = buffer.toString('utf8', nameStart, nameEnd);
    cursor = nameEnd + extraLength + commentLength;
    if (path.endsWith('/')) continue;
    if ((flags & 0x1) !== 0) throw invalid(`the archive contains an encrypted entry: ${path}`);
    if (method !== 0 && method !== 8) {
      throw invalid(`the archive uses an unsupported compression method (${method}): ${path}`);
    }
    if (compressedSize === 0xffffffff || size === 0xffffffff) {
      throw invalid('zip64 entries are not supported');
    }
    if (!isSafeRelativePath(path)) {
      throw invalid(`the archive contains a path outside the package: ${path}`);
    }
    if (((externalAttributes >>> 16) & 0xf000) === SYMLINK_MODE) {
      throw invalid(`the archive contains a symbolic link: ${path}`);
    }
    if (seen.has(path)) throw invalid(`the archive lists the same path twice: ${path}`);
    seen.add(path);
    if (size > ZIP_LIMITS.file) throw invalid(`the archive entry is larger than ${ZIP_LIMITS.file} bytes: ${path}`);
    total += size;
    if (total > ZIP_LIMITS.total) {
      throw invalid(`the archive expands beyond ${ZIP_LIMITS.total} bytes`);
    }
    if (localOffset + 30 > buffer.length) throw invalid('a local header offset is outside the archive');
    entries.push({ path, size, compressedSize, method, crc32: checksum, localOffset });
  }
  return entries;
}

/**
 * Read one entry's bytes and verify them.
 * @param {Buffer} buffer - whole archive.
 * @param {object} entry - entry returned by readZipEntries.
 * @returns {Buffer} the entry contents.
 * @throws {import('./errors.js').MarketError} when the entry cannot be read or fails verification.
 */
export function readZipEntry(buffer, entry) {
  const nameLength = buffer.readUInt16LE(entry.localOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > buffer.length) throw invalid(`the archive entry is truncated: ${entry.path}`);
  const raw = buffer.subarray(start, end);
  let body;
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.size) {
      throw invalid(`a stored entry declares two different sizes: ${entry.path}`);
    }
    body = Buffer.from(raw);
  } else {
    try {
      body = inflateRawSync(raw, { maxOutputLength: Math.max(entry.size, 1) });
    } catch {
      throw invalid(`the archive entry does not inflate to its declared size: ${entry.path}`);
    }
  }
  if (body.length !== entry.size) {
    throw invalid(`the archive entry size does not match its header: ${entry.path}`);
  }
  if (crc32(body) !== entry.crc32) {
    throw invalid(`the archive entry failed its checksum: ${entry.path}`);
  }
  return body;
}

/**
 * Read one entry by path.
 * @param {Buffer} buffer - whole archive.
 * @param {{path: string}[]} entries - entries returned by readZipEntries.
 * @param {string} path - entry path.
 * @returns {Buffer} the entry contents.
 * @throws {import('./errors.js').MarketError} when the archive has no such entry.
 */
export function readZipEntryAt(buffer, entries, path) {
  const entry = entries.find((candidate) => candidate.path === path);
  if (entry === undefined) throw invalid(`the archive does not contain ${path}`);
  return readZipEntry(buffer, entry);
}
