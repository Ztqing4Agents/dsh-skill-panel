/**
 * The two writes the installed tab owns: copy a directory from this machine into the
 * skills root, and delete a skill directory plus its ledger record.
 *
 * This module is the guard table and nothing else - every predicate lives in
 * `rules.js`, every byte of I/O in `copy.js` and `market/store.js`. The steps are
 * numbered exactly as `docs/contracts/routes.md` 3.3.4 numbers them (S0-S12, D0-D9),
 * so a reviewer can read this file against that table line by line.
 *
 * Two boundaries are deliberate:
 *
 * - The fresh scan is **injected** (`rescan`), not imported. `mergeCatalog` is the
 *   router's business; a write module that merges its own catalogue would be a second
 *   definition of "which skill is this", and the two could disagree.
 * - The lock is **injected** too (`withWriteLock`), because the market installer
 *   already holds the only write mutex this plugin has. Adding a skill and installing
 *   one are the same kind of write to the same directory, so they queue on one table.
 */
import { lstat, mkdir, readFile, rm, realpath, rmdir, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { parseFrontmatter } from '../frontmatter.js';
import { isSkillName } from '../names.js';
import { copyPlan, landSkill, planCopy, tempDirOf } from './copy.js';
import { localError } from './errors.js';
import { expandHome, shadowOf, skillNameOf } from './rules.js';

/** The file every skill directory must carry. */
const SKILL_FILE = 'SKILL.md';

/**
 * The codes a copy or landing failure is allowed to keep.
 *
 * Everything else that comes out of the staged write is `E_INSTALL_IO`: the cause is
 * the disk, and the browser's sentence for it asks the user to refresh rather than to
 * change the input. Keeping the three listed codes matters because they are answers
 * ("this name is taken", "this tree cannot be copied") the user can act on.
 */
const COPY_CODES = new Set(['E_INSTALL_IO', 'E_ALREADY_INSTALLED', 'E_PACKAGE_INVALID']);

/**
 * Describe a system error without leaking a stack.
 * @param {unknown} cause - whatever was thrown.
 * @returns {string} a short description.
 */
function describe(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Whether a failed `lstat` means "nothing there" rather than "cannot look".
 * @param {unknown} cause - the system error.
 * @returns {boolean} true for a plain absence.
 */
function isAbsent(cause) {
  return cause?.code === 'ENOENT' || cause?.code === 'ENOTDIR';
}

/**
 * Build the local write face for one skills root.
 * @param {{skillsRoot: string, dshHome?: string, store: object,
 *   withWriteLock?: (key: string, run: Function) => Promise<unknown>,
 *   rescan: () => Promise<{rows: object[], registry: object[]}>,
 *   copy?: {planCopy?: Function, copyPlan?: Function, landSkill?: Function, tempDirOf?: Function}}} options - dependencies.
 *   `dshHome` is part of the shared dependency set (the ledger is already bound to it);
 *   `rescan` is required - a write must re-derive which skill the name means.
 *   `copy` is the substitution seam for the copy stages: a test replaces `landSkill` to
 *   make S10 or S11 fail, which cannot be produced on a real filesystem from node.
 * @returns {{add: Function, remove: Function}} the two writes.
 */
export function createLocalSkills(options) {
  const skillsRoot = resolve(typeof options?.skillsRoot === 'string' ? options.skillsRoot : '');
  const store = options?.store;
  const rescan = options?.rescan;
  if (typeof rescan !== 'function') {
    throw new TypeError('createLocalSkills needs a rescan() to re-derive the skill by name');
  }
  // A caller without a lock table still gets a working write; the lock is the
  // installer's, so only the process that has one can serialise against installs.
  const withWriteLock = typeof options?.withWriteLock === 'function'
    ? options.withWriteLock
    : async (_key, run) => run();
  // Every copy stage goes through this object so the whole staged write can be replaced
  // in one place. The defaults are the real pipeline: a caller that passes nothing gets
  // exactly the disk behaviour described in docs/contracts/routes.md 3.3.4.
  const io = { planCopy, copyPlan, landSkill, tempDirOf, ...(options?.copy ?? {}) };

  /**
   * Read the declared name out of one SKILL.md.
   * @param {string} file - absolute path of the SKILL.md.
   * @returns {Promise<string>} the trimmed declared name, empty when absent.
   * @throws {import('./errors.js').LocalError} `E_INSTALL_IO` when the file cannot be read.
   */
  const declaredNameOf = async (file) => {
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch (cause) {
      throw localError('E_INSTALL_IO', `could not read SKILL.md (${describe(cause)})`);
    }
    const declared = parseFrontmatter(text).name;
    return typeof declared === 'string' ? declared.trim() : '';
  };

  /**
   * S2-S4: prove the source is a directory with a regular SKILL.md inside it.
   *
   * The source directory itself may be a symlink - a link to a directory is a
   * perfectly ordinary way to keep one skill in a repository - so it is resolved to
   * its real directory here. Nothing *inside* the tree is resolved: `copy.js` refuses
   * the copy when it meets a link there.
   * @param {string} sourcePath - absolute path as typed.
   * @returns {Promise<string>} the real source directory.
   */
  const resolveSource = async (sourcePath) => {
    try {
      await lstat(sourcePath);
    } catch (cause) {
      if (isAbsent(cause)) throw localError('E_ADD_NOT_FOUND', 'the source path does not exist');
      throw localError('E_INSTALL_IO', `could not inspect the source path (${describe(cause)})`);
    }
    let sourceDir;
    let sourceStat;
    try {
      sourceDir = await realpath(sourcePath);
      sourceStat = await stat(sourceDir);
    } catch (cause) {
      if (isAbsent(cause)) throw localError('E_ADD_NOT_FOUND', 'the source path leads nowhere');
      throw localError('E_INSTALL_IO', `could not resolve the source path (${describe(cause)})`);
    }
    if (!sourceStat.isDirectory()) {
      throw localError('E_ADD_NOT_SKILL_DIR', 'the source path is not a directory');
    }
    let fileStat;
    try {
      fileStat = await lstat(join(sourceDir, SKILL_FILE));
    } catch {
      throw localError('E_ADD_NOT_SKILL_DIR', 'the source directory has no SKILL.md');
    }
    // `lstat`, not `stat`: a SKILL.md that is itself a link is not a file this copy
    // can vouch for, and the contract refuses it under the same code.
    if (!fileStat.isFile()) {
      throw localError('E_ADD_NOT_SKILL_DIR', 'SKILL.md in the source directory is not a regular file');
    }
    return sourceDir;
  };

  /**
   * S9-S12: stage a copy, land it, read it back, then record it.
   * @param {{sourceDir: string, name: string, target: string}} facts - resolved paths.
   * @returns {Promise<{name: string, path: string, files: number, bytes: number}>} the result.
   */
  const copyAndRecord = async ({ sourceDir, name, target }) => {
    const plan = await io.planCopy(sourceDir);
    if (!plan.ok) {
      throw localError(plan.code ?? 'E_PACKAGE_INVALID', 'the source directory cannot be copied as a skill package');
    }
    const tempDir = io.tempDirOf(skillsRoot);
    let copied;
    try {
      try {
        await mkdir(skillsRoot, { recursive: true, mode: 0o755 });
        await mkdir(tempDir, { mode: 0o755 });
      } catch (cause) {
        throw localError('E_INSTALL_IO', `could not create the staging directory (${describe(cause)})`);
      }
      const staged = await io.copyPlan(sourceDir, tempDir, plan);
      await io.landSkill(tempDir, target);
      // Report what was written, not what was measured: the two agree unless the source
      // changed under us, and the written total is the honest one.
      copied = staged;
    } catch (error) {
      // A landing that failed may already have claimed the final name. Removing it only
      // while it is still empty keeps the invariant (no half-written <name> on disk)
      // without ever deleting content somebody else put there.
      await rmdir(target).catch(() => {});
      if (typeof error?.code === 'string' && COPY_CODES.has(error.code)) throw error;
      throw localError('E_INSTALL_IO', `the copy or the landing failed (${describe(error)})`);
    } finally {
      // Every path out of here drops the staging directory: after a successful rename
      // it is already gone, and after a failure it must not survive as a half copy.
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }

    // S11: the directory that landed must still declare the name it was planned under.
    // Both a wrong name and an unreadable SKILL.md are the same failure: what landed is
    // not the skill that was planned, so it is removed rather than left half-verified.
    let landedName;
    try {
      landedName = await declaredNameOf(join(target, SKILL_FILE));
    } catch {
      await rm(target, { recursive: true, force: true }).catch(() => {});
      throw localError('E_INSTALL_IO', 'the landed skill could not be read back');
    }
    if (landedName !== name) {
      await rm(target, { recursive: true, force: true }).catch(() => {});
      throw localError('E_INSTALL_IO', 'the copied skill declares a different name than the one it landed under');
    }

    // S12: the ledger is written last. Its failure is the one exception in the whole
    // pipeline that keeps the directory: a skill the user can see beats a rollback
    // that silently throws away a finished copy.
    try {
      await store.append({
        source: 'local',
        owner: '',
        slug: '',
        name,
        dirName: name,
        fromPath: sourceDir,
        version: null,
        installedAt: new Date().toISOString(),
        files: copied.files,
        bytes: copied.bytes,
      });
    } catch (cause) {
      throw localError('E_INSTALL_IO', `the skill is in place but its ledger record could not be written (${describe(cause)})`);
    }
    return { name, path: target, files: copied.files, bytes: copied.bytes };
  };

  return {
    /**
     * Copy one directory from this machine into the skills root.
     *
     * The request carries a path and nothing else: the name, the file list and the
     * size are all derived here, so a caller cannot dress one skill up as another.
     * @param {{path: string}} input - the path as typed by the user.
     * @returns {Promise<{name: string, path: string, files: number, bytes: number}>} the result.
     * @throws {import('./errors.js').LocalError|import('../market/errors.js').MarketError} on every refusal.
     */
    async add(input) {
      // S0 (the path half; the body shape is the route's) and S1.
      const typed = typeof input?.path === 'string' ? input.path : '';
      if (typed.trim() === '') throw localError('E_BAD_REQUEST', 'path must be a non-empty string');
      const sourcePath = expandHome(typed);
      if (sourcePath === null) {
        throw localError('E_BAD_PATH', 'path must be absolute or start with a home shorthand');
      }
      const sourceDir = await resolveSource(sourcePath);

      // S5: the declared name wins; the directory name is only a fallback.
      const declared = await declaredNameOf(join(sourceDir, SKILL_FILE));
      const name = skillNameOf(declared, basename(sourceDir));
      if (name === null) {
        throw localError('E_SKILL_NAME_INVALID', 'the skill name does not match the kebab-case grammar', {
          declaredName: declared,
        });
      }
      const target = join(skillsRoot, name);

      // S6: occupied means occupied. `lstat`, so a dangling link still counts - the
      // panel's own scan would see that entry, and overwriting it would be a lie.
      let occupied = false;
      try {
        await lstat(target);
        occupied = true;
      } catch (cause) {
        if (!isAbsent(cause)) {
          throw localError('E_INSTALL_IO', `could not inspect the target name (${describe(cause)})`);
        }
      }
      if (occupied) {
        throw localError('E_ALREADY_INSTALLED', 'a skill directory already occupies that name', { path: target });
      }

      // S7: a registry row that outranks the scan would swallow the copy.
      const view = await rescan();
      const shadow = shadowOf(view?.registry, name);
      if (shadow !== null) {
        throw localError('E_ADD_SHADOWED', `a registry skill named ${name} outranks a copy in the user root`, {
          provider: shadow.provider,
          rank: shadow.rank,
        });
      }

      // S8 onwards, under the installer's lock: `local:<name>` cannot run beside an
      // install or an update of the same name.
      return withWriteLock(`local:${name}`, () => copyAndRecord({ sourceDir, name, target }));
    },

    /**
     * Delete one skill directory from the skills root and clear its ledger record.
     *
     * The request carries a name and the path the panel showed. Neither is trusted:
     * the name is re-resolved by a fresh scan, and the submitted path only has to
     * agree with what that scan found - so a request can never aim the delete at a
     * directory of its choosing.
     * @param {{name: string, path: string}} input - the skill name and the SKILL.md the panel showed.
     * @returns {Promise<{name: string, dir: string, ledger: 'cleared'|'kept'}>} the result.
     * @throws {import('./errors.js').LocalError|import('../market/errors.js').MarketError} on every refusal.
     */
    async remove(input) {
      // D1 (the body shape is the route's).
      const name = typeof input?.name === 'string' ? input.name : '';
      if (!isSkillName(name)) throw localError('E_BAD_NAME', 'name must be kebab-case');
      const submitted = typeof input?.path === 'string' ? input.path : '';

      // D2: the row the panel showed, found again by name.
      const view = await rescan();
      const rows = Array.isArray(view?.rows) ? view.rows : [];
      const row = rows.find((entry) => entry?.name === name);
      if (row === undefined) throw localError('E_NOT_FOUND', `no skill named ${name}`);

      // D3: a symlinked skill is read-only, which is the third of the three layers.
      if (row.symlink === true) throw localError('E_SYMLINK_READONLY', 'symlinked skills are read-only');
      // D4: no file at all (a provider-delivered row).
      if (row.path === null || typeof row.path !== 'string' || row.path === '') {
        throw localError('E_NOT_WRITABLE', 'the skill has no writable file');
      }
      // The submitted path is absent rather than different: the contract files that
      // under "no writable path", not under "the path moved".
      if (submitted === '') throw localError('E_NOT_WRITABLE', 'the request carries no path for this skill');
      // D5: the path the panel showed must be byte-identical to the fresh one.
      if (row.path !== submitted) throw localError('E_STALE_PATH', 'the skill file moved since the panel loaded');

      // D6: depth check - `row.path` is `<root>/<dir>/SKILL.md`, so the directory it
      // names is a direct child of the root only when *its* parent is the root.
      const dir = dirname(row.path);
      if (dirname(dir) !== skillsRoot) {
        throw localError('E_NOT_WRITABLE', 'the skill directory is not a direct child of the skills root');
      }
      let dirStat;
      try {
        dirStat = await lstat(dir);
      } catch (cause) {
        throw localError('E_NOT_WRITABLE', `the skill directory cannot be inspected (${describe(cause)})`);
      }
      if (dirStat.isSymbolicLink()) {
        throw localError('E_NOT_WRITABLE', 'the skill directory is a symlink');
      }

      // D7 onwards.
      return withWriteLock(`local:${name}`, async () => {
        // D8: the directory first. A failure here leaves the ledger untouched, so the
        // user can retry the whole write without a cleanup step.
        try {
          await rm(dir, { recursive: true });
        } catch (cause) {
          throw localError('E_DELETE_IO', `could not delete the skill directory (${describe(cause)})`);
        }
        // D9: the ledger second, and its failure is not the user's problem: the row is
        // already gone from the panel, so the answer stays a success that says so.
        let ledger = 'cleared';
        try {
          await store.remove(name);
        } catch {
          ledger = 'kept';
        }
        return { name, dir, ledger };
      });
    },
  };
}
