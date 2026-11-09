/**
 * Build ZIP archives in memory, and corrupt exactly one field of them.
 *
 * `lib/market/zip.js` is a defence boundary: every branch it has exists because a
 * real archive tried something. Reaching those branches needs archives that are
 * *almost* valid, so the builder below takes per-entry overrides (declared sizes,
 * declared CRC, flags, compression method, unix mode) and per-archive overrides
 * (entry count, central-directory offset). Defaults produce a well-formed archive.
 *
 * Nothing here is shipped: it is test scaffolding, and it deliberately duplicates the
 * format knowledge that the reader under test also contains. Two independent
 * implementations of the same header layout is the point - a shared one would agree
 * with any mistake.
 */
import { deflateRawSync } from 'node:zlib';

/** Local file header signature. */
const LOCAL = 0x04034b50;
/** Central directory header signature. */
const CENTRAL = 0x02014b50;
/** End of central directory signature. */
const EOCD = 0x06054b50;

/**
 * CRC32, so a fixture can declare a checksum the reader will disagree with.
 * @param {Buffer} buffer - bytes to checksum.
 * @returns {number} unsigned 32-bit checksum.
 */
export function crc32Of(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

/**
 * Build one ZIP archive.
 *
 * Per-entry options (all optional):
 *   `method` 0 (store, default) or 8 (deflate)
 *   `crc` declared checksum (defaults to the real one)
 *   `size` / `compSize` declared sizes (default to the real ones)
 *   `flags` extra general-purpose bits (bit 0 = encrypted)
 *   `unixMode` the unix mode placed in the external attributes (0o120777 = symlink)
 *   `dir` emit a directory entry (trailing slash, no payload)
 *   `offset` override the local header offset
 *
 * Per-archive options: `count` (declared entry count), `directoryOffset`,
 * `comment` (EOCD comment, to exercise the backwards scan).
 * @param {{path: string, data?: Buffer|string, method?: number, crc?: number, size?: number,
 *   compSize?: number, flags?: number, unixMode?: number, dir?: boolean, offset?: number}[]} entries - files.
 * @param {{count?: number, directoryOffset?: number, comment?: string}} [options] - archive overrides.
 * @returns {Buffer} the archive.
 */
export function buildZip(entries, options = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const isDir = entry.dir === true || entry.path.endsWith('/');
    const body = isDir ? Buffer.alloc(0) : Buffer.from(entry.data ?? '', 'utf8');
    const method = entry.method ?? 0;
    const payload = isDir || method === 0 ? body : deflateRawSync(body);
    const crc = entry.crc ?? crc32Of(body);
    const size = entry.size ?? body.length;
    const compSize = entry.compSize ?? payload.length;
    const flags = entry.flags ?? 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compSize, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    // The central directory stores the offset of the *local header*, not of the payload.
    const localOffset = entry.offset ?? offset;
    locals.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(0o031755, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compSize, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(((entry.unixMode ?? (isDir ? 0o040755 : 0o100644)) << 16) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + payload.length;
  }

  const directory = Buffer.concat(centrals);
  const directoryOffset = options.directoryOffset ?? offset;
  const comment = Buffer.from(options.comment ?? '', 'utf8');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(options.count ?? entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(directoryOffset, 16);
  eocd.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...locals, directory, eocd, comment]);
}
