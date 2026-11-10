/**
 * Scan `$DSH_HOME/skills` for skill directories.
 *
 * The registry cannot answer the two questions this panel needs most: is the
 * entry a symlink, and does it carry install metadata? So the panel scans the
 * directory itself. Every skip rule here exists because a real file on this
 * machine would otherwise surface as a phantom row (`.DS_Store` appears both in
 * the skills root and inside two skill directories).
 */
import { lstat, open, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { isSkillName, isUpstreamIdentity } from './names.js';
import { parseFrontmatter, stripFrontmatter } from './frontmatter.js';

/** Directory names that never hold a skill. */
const SKIP_DIRS = new Set(['.system']);

/** Bytes of one SKILL.md the detail route reads before it stops and flags the body. */
const MAX_TEXT_BYTES = 262144;

/** Entries the detail route lists inside one skill directory before it stops. */
const MAX_FILES = 200;

/** Path segments below the skill directory the file list walks. */
const MAX_DEPTH = 4;

/** Directory names the file list never descends into. */
const SKIP_LIST_DIRS = new Set(['node_modules']);

/**
 * @typedef {Object} ScanCandidate
 * @property {string} dirName              directory entry name
 * @property {string} declaredName         frontmatter `name`
 * @property {string} description          frontmatter `description`
 * @property {string} displayName          frontmatter `display-name`, empty when absent
 * @property {string} instructionPath      absolute path of the entry's SKILL.md
 * @property {string|null} realPath        realpath( SKILL.md ) for a symlinked entry, otherwise null
 * @property {boolean} symlink             lstat(entry).isSymbolicLink()
 * @property {boolean} disableModelInvocation  frontmatter flag
 * @property {boolean} metaSource          `_skillhub_meta.json` or `_meta.json` carries a source
 * @property {boolean} metaRelease         `_meta.json` carries ownerId + slug
 * @property {string} metaEvidence         evidence key for tooltips, empty when none
 * @property {{sourceId: string, owner: string, slug: string}|null} upstream
 *   upstream identity, when `_meta.json` carries `source` + `ownerId` + `slug` and all
 *   three are shaped like upstream identifiers. Display data only: it never enters a
 *   partition rule, and `null` means "this row has no upstream identity we can trust".
 * @property {string|null} version  `_meta.json`'s `version` when it is a 1-64 character
 *   string. Display data only, same rule as `upstream`.
 */

/**
 * Read one JSON metadata file, degrading every failure to undefined.
 * @param {string} file - absolute path.
 * @returns {Promise<Record<string, unknown>|undefined>} parsed object, or undefined.
 */
async function readMeta(file) {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    return /** @type {Record<string, unknown>} */ (parsed);
  } catch {
    return undefined;
  }
}

/**
 * Gather the install-metadata facts for one skill directory.
 *
 * Only `_meta.json` can name an upstream: that file is the one this plugin's installer
 * writes (`{...base, source, ownerId, slug, version, name, installedAt}`, our keys last),
 * so its `source` marks a record we wrote. `_skillhub_meta.json` is somebody else's shape
 * and only ever counts as "there is a source" for the R6 rule.
 *
 * `ownerId` is not a universal handle: our installer writes the upstream handle (`ake`), but
 * another tool may write whatever id it uses internally (`kn77z49x…`), and nothing about
 * that value says it can be resolved upstream. So identity comes from records whose `source`
 * is a known source id, and never from the directory name (`clawhub-wpank--ui-design` has
 * the tool prefix baked in).
 * @param {string} dir - absolute skill directory.
 * @returns {Promise<{metaSource: boolean, metaRelease: boolean, metaEvidence: string,
 *   upstream: {sourceId: string, owner: string, slug: string}|null, version: string|null}>}
 *   metadata facts.
 */
async function readMetaFacts(dir) {
  const skillhub = await readMeta(join(dir, '_skillhub_meta.json'));
  const plain = await readMeta(join(dir, '_meta.json'));
  const source = [skillhub, plain].some((meta) => meta !== undefined && typeof meta.source === 'string' && meta.source !== '');
  const release = plain !== undefined
    && typeof plain.ownerId === 'string'
    && plain.ownerId !== ''
    && typeof plain.slug === 'string'
    && plain.slug !== '';
  let evidence = '';
  if (source) evidence = 'evidence.metaSource';
  else if (release) evidence = 'evidence.metaRelease';
  // Shape only: whether that source id is registered is a question for the market half,
  // and this module is the local-disk half (it must not depend on the source registry).
  const upstream = plain !== undefined
    && isUpstreamIdentity(plain.source, plain.ownerId, plain.slug)
    ? {
      sourceId: /** @type {string} */ (plain.source),
      owner: /** @type {string} */ (plain.ownerId),
      slug: /** @type {string} */ (plain.slug),
    }
    : null;
  // The installer writes `version` next to the identity; a hand-copied skill has none. Only a
  // plausible label is passed on (1-64 characters): anything else would be printed as-is.
  const version = plain !== undefined
    && typeof plain.version === 'string'
    && plain.version !== ''
    && plain.version.length <= 64
    ? plain.version
    : null;
  return { metaSource: source, metaRelease: release, metaEvidence: evidence, upstream, version };
}

/**
 * Read one directory entry into a candidate.
 * @param {string} root - skills root directory.
 * @param {string} dirName - entry name inside the root.
 * @returns {Promise<ScanCandidate|undefined>} the candidate, or undefined for a non-skill entry.
 */
async function readCandidate(root, dirName) {
  const dir = join(root, dirName);
  let entry;
  try {
    entry = await lstat(dir);
  } catch {
    return undefined;
  }
  const symlink = entry.isSymbolicLink();
  if (!symlink && !entry.isDirectory()) return undefined;
  let instructionPath = join(dir, 'SKILL.md');
  let realPath = null;
  if (symlink) {
    try {
      const realDir = await realpath(dir);
      instructionPath = join(realDir, 'SKILL.md');
      realPath = instructionPath;
    } catch {
      return undefined;
    }
  }
  let text;
  try {
    text = await readFile(instructionPath, 'utf8');
  } catch {
    return undefined;
  }
  const frontmatter = parseFrontmatter(text);
  const declaredName = frontmatter.name ?? '';
  const description = frontmatter.description ?? '';
  if (!isSkillName(declaredName) || description === '') return undefined;
  const meta = await readMetaFacts(dir);
  return {
    dirName,
    declaredName,
    description,
    displayName: frontmatter.displayName ?? '',
    instructionPath,
    realPath,
    symlink,
    disableModelInvocation: frontmatter.disableModelInvocation,
    metaSource: meta.metaSource,
    metaRelease: meta.metaRelease,
    metaEvidence: meta.metaEvidence,
    upstream: meta.upstream,
    version: meta.version,
  };
}

/**
 * Scan the user skills root.
 *
 * The scan is unconditional and cheap (a handful of file reads): disk is the only
 * source of truth, and a cache would turn "someone edited a SKILL.md" into stale
 * data the panel then refuses to write.
 * @param {string} skillsRoot - absolute skills root.
 * @returns {Promise<ScanCandidate[]>} candidates in directory order; noise entries are gone.
 */
export async function scanUserSkills(skillsRoot) {
  let entries;
  try {
    entries = await readdir(skillsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates = [];
  for (const dirent of entries) {
    const dirName = dirent.name;
    if (dirName.startsWith('.') || SKIP_DIRS.has(dirName)) continue;
    if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue;
    const candidate = await readCandidate(skillsRoot, dirName);
    if (candidate !== undefined) candidates.push(candidate);
  }
  return candidates;
}

/**
 * Read up to `limit` bytes of one text file.
 *
 * The body of a SKILL.md is user content and can be arbitrarily large (the longest real
 * sample on this machine is 39 618 B), so the read is bounded: an answer the panel cannot
 * render is worse than a truncated one that says so.
 * @param {string} file - absolute path.
 * @param {number} limit - maximum bytes to read.
 * @returns {Promise<{text: string, size: number, truncated: boolean}>} the text, the real
 *   size, and whether the text is shorter than the file.
 */
async function readBoundedText(file, limit) {
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    const size = stat.size;
    const wanted = Math.min(size, limit);
    const buffer = Buffer.alloc(wanted);
    let filled = 0;
    while (filled < wanted) {
      const { bytesRead } = await handle.read(buffer, filled, wanted - filled, filled);
      if (bytesRead <= 0) break;
      filled += bytesRead;
    }
    return { text: buffer.subarray(0, filled).toString('utf8'), size, truncated: size > filled };
  } finally {
    await handle.close();
  }
}

/**
 * List the files a skill directory carries, best-effort and bounded.
 *
 * Skipping dot entries, `node_modules` and every symlink follows hard constraint 14 (never
 * follow a link inside a package): a listing is decoration, a link traversal is a hole.
 * A subdirectory that disappears mid-walk is skipped rather than failing the whole answer.
 * @param {string} directory - absolute skill directory.
 * @returns {Promise<{files: {path: string, size: number}[], filesTruncated: boolean}>} the
 *   entries in path order, and whether the walk stopped at a limit.
 */
async function listSkillFiles(directory) {
  const files = [];
  let truncated = false;
  /**
   * @param {string} dir - absolute directory to read.
   * @param {string} prefix - slash-joined path of `dir` relative to the skill directory.
   * @param {number} depth - segment count of the entries inside `dir`.
   * @returns {Promise<void>}
   */
  const walk = async (dir, prefix, depth) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      if (truncated) return;
      if (entry.isSymbolicLink()) continue;
      if (entry.name.startsWith('.') || SKIP_LIST_DIRS.has(entry.name)) continue;
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH) await walk(join(dir, entry.name), path, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      let size;
      try {
        size = (await lstat(join(dir, entry.name))).size;
      } catch {
        continue;
      }
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      files.push({ path, size });
    }
  };
  await walk(directory, '', 1);
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return { files, filesTruncated: truncated };
}

/**
 * Read one skill's content for the installed detail view.
 *
 * Identity comes from the row the caller just re-scanned: a symlinked row is read through
 * its `realPath` (the scan layer already resolved the directory), and a row without a file
 * has no body at all - that is an answer, not an error. The leaf is checked with `lstat`
 * once more, so a SKILL.md that is itself a symlink is not followed.
 * @param {object} row - one `ListPayload.Row` from a fresh merge pass.
 * @returns {Promise<{name: string, path: string|null, size: number|null, truncated: boolean,
 *   body: string|null, files: {path: string, size: number}[]|null, filesTruncated: boolean}>}
 *   the SkillContent payload.
 * @throws {Error} when the file exists but cannot be read (the caller answers 500).
 */
export async function readSkillContent(row) {
  const name = typeof row?.name === 'string' ? row.name : '';
  const file = row?.symlink === true ? row.realPath : row.path;
  if (typeof file !== 'string' || file === '') {
    return {
      name, path: null, size: null, truncated: false, body: null, files: null, filesTruncated: false,
    };
  }
  const stat = await lstat(file);
  const listed = await listSkillFiles(dirname(file));
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return {
      name, path: file, size: null, truncated: false, body: null, ...listed,
    };
  }
  const { text, size, truncated } = await readBoundedText(file, MAX_TEXT_BYTES);
  return {
    name, path: file, size, truncated, body: stripFrontmatter(text), ...listed,
  };
}
