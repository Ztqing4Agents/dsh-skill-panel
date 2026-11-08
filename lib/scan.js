/**
 * Scan `$DSH_HOME/skills` for skill directories.
 *
 * The registry cannot answer the two questions this panel needs most: is the
 * entry a symlink, and does it carry install metadata? So the panel scans the
 * directory itself. Every skip rule here exists because a real file on this
 * machine would otherwise surface as a phantom row (`.DS_Store` appears both in
 * the skills root and inside two skill directories).
 */
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';

import { isSkillName } from './names.js';
import { parseFrontmatter } from './frontmatter.js';

/** Directory names that never hold a skill. */
const SKIP_DIRS = new Set(['.system']);

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
 * @param {string} dir - absolute skill directory.
 * @returns {Promise<{metaSource: boolean, metaRelease: boolean, metaEvidence: string}>} metadata facts.
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
  return { metaSource: source, metaRelease: release, metaEvidence: evidence };
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
