/**
 * The pure criteria behind "add a skill" and "delete a skill": classify what the user
 * pasted, expand a typed path, pick the target name, decide whether an added copy
 * would be shadowed, locate the skill directory inside a clone, and bound what one
 * source directory may cost.
 *
 * `classifyAddSpec` and `checkPlan` never touch disk; `locateSkillDir` reads a tree
 * once (which directory is the skill is a filesystem fact, not a string rule). The one
 * decision table this module reads is `rankOf`'s - the nine-step ladder is not edited
 * here, only consulted.
 */
import { lstat, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';

import { rankOf } from '../classify.js';
import { isSkillName, isWithin } from '../names.js';
import { localError } from './errors.js';

/** Longest path the add route accepts after `~` expansion (characters). */
export const MAX_PATH_CHARS = 1024;

/**
 * What one source directory may carry before a copy is refused.
 *
 * The numbers are the market installer's own package budget restated as a whole-tree
 * budget: a local directory has no manifest to check, so the tree itself is the only
 * thing that can be measured, and it has to be measured before anything is written.
 */
export const LOCAL_LIMITS = Object.freeze({
  maxEntries: 2000,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
});

/**
 * Expand `~` / `~/...` against the current user's home directory.
 *
 * The panel accepts the shorthand because that is what people paste; the copy itself
 * only ever runs on an absolute path, because `lstat`, `isWithin` and the ledger all
 * speak in absolute paths.
 * @param {unknown} value - the path as typed.
 * @returns {string|null} the absolute path, or null when it cannot be one.
 */
export function expandHome(value) {
  if (typeof value !== 'string') return null;
  let expanded = value;
  if (expanded === '~') expanded = homedir();
  else if (expanded.startsWith('~/')) expanded = join(homedir(), expanded.slice(2));
  if (expanded === '') return null;
  if (expanded.includes('\u0000')) return null;
  if (expanded.length > MAX_PATH_CHARS) return null;
  if (!isAbsolute(expanded)) return null;
  return expanded;
}

/**
 * Pick the name an added directory lands under.
 *
 * The declared name wins after trimming; an empty declaration falls back to the
 * directory name, because a skill directory is already named for its skill and that
 * is what the host loader would have used. There is no third option: when the chosen
 * name breaks the kebab-case grammar the answer is null, not a sanitized variant -
 * renaming would land the directory under a name the user did not ask for.
 * @param {unknown} declaredName - `name` from the source SKILL.md.
 * @param {unknown} dirName - the source directory's own name.
 * @returns {string|null} the name, or null when neither candidate is legal.
 */
export function skillNameOf(declaredName, dirName) {
  const declared = typeof declaredName === 'string' ? declaredName.trim() : '';
  if (declared !== '') return isSkillName(declared) ? declared : null;
  const fallback = typeof dirName === 'string' ? dirName.trim() : '';
  return isSkillName(fallback) ? fallback : null;
}

/**
 * Find a registry row that would outrank a freshly added copy.
 *
 * Only rows strictly inside the user root's precedence may shadow: rank 400 is the
 * directory scan itself (a tie, which the scan wins), rank 500 is another user root
 * and rank 600 is DSH's own bundle (both lose to the scan). Anything *below* 400 -
 * the runtime provider at 250, and the project / custom roots at 100, 200 and 300 -
 * wins the same-name arbitration, so the added directory would either be listed as
 * that provider's skill or dropped entirely: the user adds a skill and cannot see it.
 * @param {object[]} summaries - registry summaries annotated with `rank`.
 * @param {unknown} name - the name the copy would land under.
 * @returns {{rank: number, provider: string}|null} the shadowing row, or null.
 */
export function shadowOf(summaries, name) {
  if (!Array.isArray(summaries) || typeof name !== 'string' || name === '') return null;
  const floor = rankOf('user-dsh');
  let shadow = null;
  for (const summary of summaries) {
    if (summary?.name !== name) continue;
    const rank = typeof summary.rank === 'number' ? summary.rank : rankOf('bundled');
    if (rank >= floor) continue;
    if (shadow === null || rank < shadow.rank) {
      shadow = { rank, provider: typeof summary.provider === 'string' ? summary.provider : '' };
    }
  }
  return shadow;
}

/**
 * Whether a directory entry is left out of a copy instead of failing it.
 *
 * `node_modules` is generated content that no skill reads at runtime, and a leading
 * dot is this plugin's own convention for work in progress (the installer's temp
 * directories are dot-prefixed for exactly that reason). Both are skipped, not
 * refused: skipping is what "copy the skill" means for a working directory that
 * happens to contain them.
 * @param {unknown} name - one entry name.
 * @returns {boolean} true when the entry is skipped.
 */
export function isSkippedEntry(name) {
  return typeof name === 'string' && (name === 'node_modules' || name.startsWith('.'));
}

/**
 * Decide whether one source tree is small enough and plain enough to copy.
 *
 * A symlink anywhere inside the tree refuses the whole copy: a link is not content,
 * it is a pointer out of the directory, and following it would copy bytes the user
 * did not choose (or loop forever). Sizes are measured on the entries the caller
 * already listed, so this stays a pure function.
 * @param {{path: string, size: number, symlink: boolean}[]} entries - listed entries.
 * @returns {{ok: boolean, code?: string}} the verdict, `E_PACKAGE_INVALID` when refused.
 */
export function checkPlan(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (list.length > LOCAL_LIMITS.maxEntries) return { ok: false, code: 'E_PACKAGE_INVALID' };
  let total = 0;
  for (const entry of list) {
    if (entry?.symlink === true) return { ok: false, code: 'E_PACKAGE_INVALID' };
    const size = Number.isFinite(entry?.size) ? Math.max(0, entry.size) : 0;
    if (size > LOCAL_LIMITS.maxFileBytes) return { ok: false, code: 'E_PACKAGE_INVALID' };
    total += size;
    if (total > LOCAL_LIMITS.maxTotalBytes) return { ok: false, code: 'E_PACKAGE_INVALID' };
  }
  return { ok: true };
}

/**
 * Longest whole repository reference this face accepts (characters).
 *
 * The host has no such gate; we add one because a pasted blob of text must not become
 * a URL that gets cloned. 2048 is far past any real link and far short of anything
 * that could carry a payload.
 */
export const MAX_SPEC_CHARS = 2048;

/** Longest branch or tag name this face accepts (characters). */
const MAX_REF_CHARS = 200;

/** A commit id. `--branch` cannot take one, so pasting one is refused, not guessed at. */
const COMMIT_SHA = /^[0-9a-f]{40}$/i;

/** Shape of a GitHub owner or repository name. */
const OWNER_OR_REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Archive attachments are packages, not repositories: this face does not fetch those. */
const TARBALL = /\.(?:tgz|tar\.gz|tar|zip)$/i;

/** The file every skill directory must carry. */
export const SKILL_FILE_NAME = 'SKILL.md';

/** How deep the probe looks for a SKILL.md, counting the clone root as level one. */
const MAX_PROBE_DEPTH = 4;

/** Most candidates a refusal lists; the count travels beside them. */
const MAX_CANDIDATES = 10;

/**
 * Sort two strings by code point, so a candidate list is stable across machines.
 * @param {string} left - first value.
 * @param {string} right - second value.
 * @returns {number} the comparison.
 */
function byCodePoint(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Split a `#path:<subdir>` fragment off one reference.
 * @param {string} value - the reference without its scheme prefix.
 * @returns {{rest: string, subdirText: string|null}} the reference and the raw subdirectory.
 * @throws {import('./errors.js').LocalError} `E_GIT_SPEC_INVALID` for an unknown fragment.
 */
function splitFragment(value) {
  const hash = value.indexOf('#');
  if (hash === -1) return { rest: value, subdirText: null };
  const fragment = value.slice(hash + 1);
  if (!/^path:/i.test(fragment)) {
    throw localError('E_GIT_SPEC_INVALID', 'only a #path:<subdirectory> fragment is understood');
  }
  return { rest: value.slice(0, hash), subdirText: fragment.slice('path:'.length) };
}

/**
 * Validate one subdirectory written by the user.
 * @param {string|null} text - the raw subdirectory, or null when none was given.
 * @returns {string|null} the normalized relative subdirectory.
 * @throws {import('./errors.js').LocalError} `E_GIT_SPEC_INVALID` when it cannot be one.
 */
function normalizeSubdir(text) {
  if (text === null) return null;
  if (text.includes('\u0000')) {
    throw localError('E_GIT_SPEC_INVALID', 'the subdirectory contains an unprintable character');
  }
  const segments = text.split('/').filter((segment) => segment !== '');
  if (segments.length === 0) {
    throw localError('E_GIT_SPEC_INVALID', 'the #path: fragment names no subdirectory');
  }
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw localError('E_GIT_SPEC_INVALID', 'the subdirectory may not step outside the repository');
  }
  return segments.join('/');
}

/**
 * Validate one branch or tag name.
 * @param {string} ref - the raw ref.
 * @returns {string} the ref.
 * @throws {import('./errors.js').LocalError} `E_GIT_SPEC_INVALID` when it cannot be one.
 */
function checkedRef(ref) {
  if (ref === '' || ref.length > MAX_REF_CHARS || /[\s#]/.test(ref)) {
    throw localError('E_GIT_SPEC_INVALID', 'the branch or tag name is not usable');
  }
  if (COMMIT_SHA.test(ref)) {
    throw localError('E_GIT_SPEC_INVALID', 'a commit id cannot be used as a branch or tag');
  }
  return ref;
}

/**
 * Turn the segments of one repository reference into a github result.
 *
 * The segment rules are the whole reason this is a rule and not a regex: `owner/repo`
 * is the minimum, a third segment may only be `tree` (a file link is not a repository),
 * the segment after `tree` is the ref, and everything after that is the subdirectory.
 * @param {{spec: string, segments: string[], treeAllowed: boolean, subdirText: string|null}} input -
 *   the trimmed reference and its parsed parts.
 * @returns {{kind: 'github', owner: string, repo: string, ref: string|null, subdir: string|null, spec: string}} the result.
 * @throws {import('./errors.js').LocalError} `E_GIT_SPEC_INVALID` on any rule break.
 */
function repositoryOf({ spec, segments, treeAllowed, subdirText }) {
  if (segments.length < 2) {
    throw localError('E_GIT_SPEC_INVALID', 'a repository reference needs an owner and a repository name');
  }
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, '');
  if (!OWNER_OR_REPO.test(owner) || !OWNER_OR_REPO.test(repo)) {
    throw localError('E_GIT_SPEC_INVALID', 'the owner or repository name is not a GitHub name');
  }
  let ref = null;
  let treeSubdir = null;
  if (segments.length > 2) {
    if (!treeAllowed) {
      throw localError('E_GIT_SPEC_INVALID', 'only a bare owner/repository is understood after github:');
    }
    if (segments[2] !== 'tree') {
      throw localError('E_GIT_SPEC_INVALID', 'only a /tree/ link is understood; a file link is not a repository');
    }
    if (segments.length < 4) {
      throw localError('E_GIT_SPEC_INVALID', 'a /tree/ link needs a branch or tag after it');
    }
    ref = checkedRef(segments[3]);
    if (segments.length > 4) treeSubdir = normalizeSubdir(segments.slice(4).join('/'));
  }
  if (subdirText !== null && treeSubdir !== null) {
    throw localError('E_GIT_SPEC_INVALID', 'the subdirectory is named twice: once in /tree/ and once after #path:');
  }
  const subdir = treeSubdir !== null ? treeSubdir : normalizeSubdir(subdirText);
  return { kind: 'github', owner, repo, ref, subdir, spec };
}

/**
 * Classify what the user pasted into the add field.
 *
 * One input produces exactly one kind, and the order is fixed: an absolute or `~`
 * path is the local shape (it is handed to the path guards unchanged, so the U20
 * behaviour cannot drift); everything repository-shaped must be an https GitHub
 * reference; a recognisable but unsupported transport (ssh, another host, an archive)
 * says so with its own sentence instead of "not understood". Nothing is expanded or
 * fetched here - this is a string rule.
 * @param {string} spec - the raw field value.
 * @returns {{kind: 'path', path: string}|{kind: 'github', owner: string, repo: string,
 *   ref: string|null, subdir: string|null, spec: string}} the classified reference.
 * @throws {import('./errors.js').LocalError} `E_BAD_REQUEST` for empty input,
 *   `E_GIT_SPEC_INVALID` when it cannot be read, `E_GIT_NOT_SUPPORTED` when it is a
 *   transport this face does not speak.
 */
export function classifyAddSpec(spec) {
  const text = typeof spec === 'string' ? spec.trim() : '';
  if (text === '') throw localError('E_BAD_REQUEST', 'spec must be a non-empty string');
  if (text.startsWith('/') || text.startsWith('~')) return { kind: 'path', path: text };
  if (text.length > MAX_SPEC_CHARS) {
    throw localError('E_GIT_SPEC_INVALID', `a repository reference must stay under ${MAX_SPEC_CHARS} characters`);
  }

  const shorthand = /^github:(.*)$/is.exec(text);
  if (shorthand !== null) {
    const { rest, subdirText } = splitFragment(shorthand[1]);
    return repositoryOf({
      spec: text,
      segments: rest.split('/').filter((segment) => segment !== ''),
      treeAllowed: false,
      subdirText,
    });
  }

  const url = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/is.exec(text);
  if (url !== null) {
    const scheme = url[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      throw localError('E_GIT_NOT_SUPPORTED', 'only an https GitHub link is supported');
    }
    const authorityEnd = url[2].indexOf('/');
    const authority = authorityEnd === -1 ? url[2] : url[2].slice(0, authorityEnd);
    const pathPart = authorityEnd === -1 ? '' : url[2].slice(authorityEnd + 1);
    if (authority.includes('@')) {
      throw localError('E_GIT_NOT_SUPPORTED', 'a link carrying a username or token is not supported');
    }
    if (authority.includes(':')) {
      throw localError('E_GIT_NOT_SUPPORTED', 'a link carrying a port is not supported');
    }
    const host = authority.toLowerCase();
    if (host !== 'github.com' && !host.endsWith('.github.com')) {
      throw localError('E_GIT_NOT_SUPPORTED', 'only github.com repositories are supported');
    }
    const { rest, subdirText } = splitFragment(pathPart);
    if (TARBALL.test(rest)) {
      throw localError('E_GIT_NOT_SUPPORTED', 'an archive attachment is a package, not a repository');
    }
    return repositoryOf({
      spec: text,
      segments: rest.split('/').filter((segment) => segment !== ''),
      treeAllowed: true,
      subdirText,
    });
  }

  // An scp-style remote (`git@host:owner/repo`) is an ssh transport without a scheme.
  if (/^[^\s/@]+@[^\s/]+:\S*/.test(text)) {
    throw localError('E_GIT_NOT_SUPPORTED', 'an ssh remote is not supported; paste an https link');
  }
  // Any other known transport prefix (`gitlab:`, `bitbucket:`, `gist:`, `git+ssh:`).
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    throw localError('E_GIT_NOT_SUPPORTED', 'only github.com is supported');
  }
  throw localError('E_GIT_SPEC_INVALID', 'not a local path and not a GitHub repository reference');
}

/**
 * Whether one path names a regular SKILL.md, without following a final symlink.
 * @param {string} file - absolute path.
 * @returns {Promise<boolean>} true when it is a plain file.
 */
async function isRegularSkillFile(file) {
  try {
    const entry = await lstat(file);
    return entry.isFile();
  } catch {
    return false;
  }
}

/**
 * Walk one clone and collect the directories that carry a SKILL.md.
 * @param {string} root - the clone root, used to build relative candidate paths.
 * @param {string} dir - directory to list.
 * @param {number} depth - `dir`'s depth, the root being one.
 * @param {string[]} found - collected directories, relative to the root.
 * @returns {Promise<void>} resolves when the walk is done.
 */
async function probeSkillDirs(root, dir, depth, found) {
  let dirents;
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const dirent of dirents) {
    // A symlinked directory is not followed: `isDirectory()` is false for a link, so a
    // repository cannot point the probe at a tree it does not contain.
    if (!dirent.isDirectory() || isSkippedEntry(dirent.name)) continue;
    const child = join(dir, dirent.name);
    if (await isRegularSkillFile(join(child, SKILL_FILE_NAME))) {
      found.push(relativeOf(root, child));
    }
    if (depth + 1 < MAX_PROBE_DEPTH) await probeSkillDirs(root, child, depth + 1, found);
  }
}

/**
 * Name one directory relative to the clone root, always with `/` separators.
 * @param {string} root - the clone root.
 * @param {string} dir - a directory inside it.
 * @returns {string} the relative path.
 */
function relativeOf(root, dir) {
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return dir.startsWith(prefix) ? dir.slice(prefix.length) : basename(dir);
}

/**
 * Locate the one directory inside a clone that is the skill.
 *
 * The user's own answer wins: a named subdirectory is used as-is and never
 * second-guessed, because probing after an explicit choice would silently install a
 * different skill than the one that was asked for. Without a name, the clone root is
 * tried first (a repository that *is* a skill), then a bounded probe - one hit is
 * used silently, many hits are handed back so the user can pick, none is a refusal.
 * @param {string} root - the clone root.
 * @param {string|null} subdir - the subdirectory the user named, when they named one.
 * @returns {Promise<{dir: string}>} the skill directory, inside `root`.
 * @throws {import('./errors.js').LocalError} `E_ADD_NOT_SKILL_DIR` when there is no
 *   usable directory, `E_ADD_AMBIGUOUS_SKILL` when there are several.
 */
export async function locateSkillDir(root, subdir) {
  const base = resolve(root);
  const named = typeof subdir === 'string' && subdir !== '' ? resolve(base, subdir) : null;
  if (named !== null) {
    if (!isWithin(base, named) && named !== base) {
      throw localError('E_ADD_NOT_SKILL_DIR', 'the named subdirectory lies outside the repository');
    }
    if (!(await isRegularSkillFile(join(named, SKILL_FILE_NAME)))) {
      throw localError('E_ADD_NOT_SKILL_DIR', 'the named subdirectory holds no SKILL.md');
    }
    return { dir: named };
  }
  if (await isRegularSkillFile(join(base, SKILL_FILE_NAME))) return { dir: base };
  const found = [];
  await probeSkillDirs(base, base, 1, found);
  const candidates = [...new Set(found)].sort(byCodePoint);
  if (candidates.length === 0) {
    throw localError('E_ADD_NOT_SKILL_DIR', 'the repository holds no SKILL.md');
  }
  if (candidates.length === 1) return { dir: join(base, candidates[0]) };
  throw localError('E_ADD_AMBIGUOUS_SKILL', 'the repository holds more than one SKILL.md', {
    candidates: candidates.slice(0, MAX_CANDIDATES),
    candidateTotal: candidates.length,
  });
}
