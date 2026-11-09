/**
 * The install pipeline: resolve, check, write, verify, land, record.
 *
 * The order is chosen so that the cheapest failure happens first. A SkillHub package
 * can list 72 files; fetching all of them only to discover that the package declares
 * an illegal name, or that this machine already has a skill by that name, would waste
 * a full download and hit the upstream 72 times. So `SKILL.md` is fetched alone, its
 * frontmatter is read, the name is checked, the target is stat-ed, and only then does
 * the rest of the package come down.
 *
 * Failure has one shape: nothing. The only thing that ever exists on disk before the
 * final rename is a dot-prefixed temp directory, which the scanner skips, and the
 * `finally` block removes it on every path. A skill directory is never partially
 * written, never renamed over an existing directory, and the ledger is only appended
 * after the directory has landed and read back clean.
 */
import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { parseFrontmatter } from '../frontmatter.js';
import { isSafeRelativePath, isSkillName, isWithin } from '../names.js';
import { asMarketError, marketError } from './errors.js';
import { mapLimit } from './upstream.js';

/** Total budget for one install, including every file download. */
export const INSTALL_BUDGET_MS = 120000;

/** Concurrent file downloads inside one install. */
export const FILE_CONCURRENCY = 4;

/** Installs allowed at once across the process. */
export const MAX_CONCURRENT_INSTALLS = 2;

/** The file every package must carry. */
export const FIRST_FILE = 'SKILL.md';

/** Prefix of the temp directory; the leading dot keeps the scanner away from it. */
export const TEMP_PREFIX = '.skc-install-';

/**
 * Whether a path exists, without following a final symlink.
 * @param {string} path - absolute path.
 * @returns {Promise<boolean>} true when something is there.
 */
async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a file, or null when it is not there.
 * @param {string} path - absolute path.
 * @returns {Promise<Buffer|null>} the bytes.
 */
async function readIfPresent(path) {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

/**
 * Best-effort directory fsync.
 * @param {string} directory - directory to sync.
 * @returns {Promise<void>} resolves either way.
 */
async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, 'r');
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
 * Create the dot-prefixed temp directory for one install.
 * @param {string} skillsRoot - directory the skill will land in.
 * @returns {Promise<string>} the temp path.
 */
async function makeTempDir(skillsRoot) {
  const name = `${TEMP_PREFIX}${process.pid}-${randomBytes(3).toString('hex')}`;
  const path = join(skillsRoot, name);
  try {
    await mkdir(path, { mode: 0o755 });
  } catch (cause) {
    throw marketError('E_INSTALL_IO', `could not create the staging directory (${describe(cause)})`);
  }
  return path;
}

/**
 * Describe a system error without leaking a stack.
 * @param {unknown} cause - whatever was thrown.
 * @returns {string} a short description.
 */
function describe(cause) {
  if (cause instanceof Error) {
    const code = typeof cause.code === 'string' ? cause.code : '';
    return code === '' ? cause.message : `${code}: ${cause.message}`;
  }
  return String(cause);
}

/**
 * Write one package file inside the staging directory, refusing to overwrite.
 * @param {string} root - staging directory.
 * @param {string} relative - package path, `/` separated.
 * @param {Buffer} bytes - contents.
 * @returns {Promise<void>} resolves once the bytes are durable.
 */
async function writePackageFile(root, relative, bytes) {
  if (!isSafeRelativePath(relative)) {
    throw marketError('E_PACKAGE_INVALID', `package path is not a safe relative path: ${relative}`);
  }
  const target = join(root, ...relative.split('/'));
  if (!isWithin(root, target)) {
    throw marketError('E_PACKAGE_INVALID', `package path escapes the staging directory: ${relative}`);
  }
  try {
    await mkdir(dirname(target), { recursive: true, mode: 0o755 });
  } catch (cause) {
    throw marketError('E_INSTALL_IO', `could not create a package directory (${describe(cause)})`);
  }
  let handle;
  try {
    handle = await open(target, 'wx', 0o644);
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (cause) {
    if (cause?.code === 'EEXIST') {
      throw marketError('E_PACKAGE_INVALID', `the package lists the same path twice: ${relative}`);
    }
    throw marketError('E_INSTALL_IO', `could not write ${relative} (${describe(cause)})`);
  } finally {
    try {
      await handle?.close();
    } catch {
      // Already closed.
    }
  }
}

/**
 * Fetch one package file and verify it against the manifest.
 * @param {object} deps - installer dependencies.
 * @param {object} packagePlan - SourcePlan.
 * @param {string} path - manifest path.
 * @param {number} deadline - epoch milliseconds the whole install must finish by.
 * @returns {Promise<Buffer>} the verified bytes.
 */
async function fetchVerified(deps, packagePlan, path, deadline) {
  if (!isSafeRelativePath(path)) {
    throw marketError('E_PACKAGE_INVALID', `package path is not a safe relative path: ${path}`);
  }
  const entry = packagePlan.files.find((file) => file.path === path);
  if (entry === undefined) throw marketError('E_PACKAGE_INVALID', `the package does not list ${path}`);
  if (deps.now() > deadline) {
    throw marketError('E_SOURCE_TIMEOUT', 'the install exceeded its time budget');
  }
  let bytes;
  try {
    bytes = await deps.source.fetchFile(packagePlan, path, deps.io);
  } catch (error) {
    const failure = asMarketError(error);
    if (failure.code === 'E_SOURCE_UNAVAILABLE' || failure.code === 'E_SOURCE_BAD_RESPONSE') {
      throw marketError('E_DOWNLOAD_FAILED', failure.message, { path });
    }
    throw failure;
  }
  if (!Buffer.isBuffer(bytes)) {
    throw marketError('E_PACKAGE_INVALID', `the package served no bytes for ${path}`);
  }
  if (typeof entry.size === 'number' && entry.size !== null && bytes.length !== entry.size) {
    throw marketError('E_PACKAGE_INVALID', `size mismatch for ${path}`, { path });
  }
  if (typeof entry.sha256 === 'string' && entry.sha256 !== '') {
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== entry.sha256) throw marketError('E_PACKAGE_INVALID', `sha256 mismatch for ${path}`, { path });
  }
  return bytes;
}

/**
 * Write the provenance metadata the partition ladder reads.
 *
 * Two readers depend on the shape: `lib/scan.js` needs a string `source` (R6) and
 * `ownerId` plus `slug` (R7); `lib/ledger.js` reads the ledger, not this file. A
 * package that already shipped a `_meta.json` keeps its fields, and the original is
 * kept beside it as `_meta.upstream.json` so nothing is lost.
 * @param {string} root - staging directory.
 * @param {object} facts - what was installed, and what the package already said.
 * @returns {Promise<string[]>} the relative paths written, so the caller can count
 *   distinct files on disk instead of counting write operations.
 */
async function writeMeta(root, facts) {
  const metaPath = join(root, '_meta.json');
  const original = facts.metaBytes ?? await readIfPresent(metaPath);
  const paths = [];
  if (original !== null && original !== undefined) {
    try {
      await writeFile(join(root, '_meta.upstream.json'), original);
      paths.push('_meta.upstream.json');
    } catch (cause) {
      throw marketError('E_INSTALL_IO', `could not keep the upstream metadata (${describe(cause)})`);
    }
  }
  const base = facts.meta !== null && typeof facts.meta === 'object' ? facts.meta : {};
  const document = {
    ...base,
    source: facts.sourceId,
    ownerId: facts.owner,
    slug: facts.slug,
    version: facts.version,
    name: facts.name,
    installedAt: new Date(facts.now).toISOString(),
  };
  try {
    await writeFile(metaPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  } catch (cause) {
    throw marketError('E_INSTALL_IO', `could not write the install metadata (${describe(cause)})`);
  }
  paths.push('_meta.json');
  return paths;
}

/**
 * Read the version a pre-existing skill directory declares, when it says.
 *
 * A same-name directory can be hand-made or installed by another tool, so its version
 * is often unknown; the error then reports `null` rather than echoing the version the
 * caller asked for, which would be a claim about somebody else's directory.
 * @param {string} directory - existing skill directory.
 * @returns {Promise<string|null>} the declared version, or null.
 */
async function existingVersion(directory) {
  const metaText = await readIfPresent(join(directory, '_meta.json'));
  if (metaText === null) return null;
  try {
    const meta = JSON.parse(metaText.toString('utf8'));
    return typeof meta?.version === 'string' && meta.version !== '' ? meta.version : null;
  } catch {
    return null;
  }
}

/**
 * Read the staged result back and assert it is what the caller is about to report.
 * @param {string} directory - landed skill directory.
 * @param {string} name - declared name.
 * @param {string} sourceId - adapter id.
 * @returns {Promise<void>} resolves when the directory reads back clean.
 */
async function verifyLanded(directory, name, sourceId) {
  const skillText = await readIfPresent(join(directory, FIRST_FILE));
  if (skillText === null) throw marketError('E_INSTALL_IO', 'the installed skill has no SKILL.md');
  let parsedName = '';
  try {
    const declared = parseFrontmatter(skillText.toString('utf8')).name;
    parsedName = typeof declared === 'string' ? declared.trim() : '';
  } catch {
    parsedName = '';
  }
  if (parsedName !== name) {
    throw marketError('E_INSTALL_IO', 'the installed SKILL.md does not declare the name it was installed as');
  }
  const metaText = await readIfPresent(join(directory, '_meta.json'));
  if (metaText === null) throw marketError('E_INSTALL_IO', 'the installed skill has no _meta.json');
  let meta;
  try {
    meta = JSON.parse(metaText.toString('utf8'));
  } catch {
    throw marketError('E_INSTALL_IO', 'the installed _meta.json is not JSON');
  }
  if (typeof meta?.source !== 'string' || meta.source !== sourceId) {
    throw marketError('E_INSTALL_IO', 'the installed _meta.json does not name its source');
  }
}

/**
 * Run one install while holding the per-target lock.
 * @param {object} deps - installer dependencies.
 * @param {{sourceId: string, source: object, owner: string, slug: string, version: string|null}} ref - item reference.
 * @returns {Promise<object>} the install result.
 */
async function installLocked(baseDeps, ref) {
  const deps = { ...baseDeps, source: ref.source };
  const deadline = deps.now() + INSTALL_BUDGET_MS;
  let temp = null;
  try {
    const packagePlan = await deps.source.plan(
      { owner: ref.owner, slug: ref.slug, version: ref.version },
      deps.io,
    );
    if (!Array.isArray(packagePlan?.files) || packagePlan.files.length === 0) {
      throw marketError('E_PACKAGE_INVALID', 'the source returned an empty package manifest');
    }
    const version = typeof packagePlan.version === 'string' && packagePlan.version !== ''
      ? packagePlan.version
      : ref.version;
    if (packagePlan.meta !== null && typeof packagePlan.meta === 'object'
      && typeof packagePlan.meta.version === 'string' && typeof version === 'string'
      && packagePlan.meta.version !== version) {
      throw marketError(
        'E_PACKAGE_INVALID',
        `the package declares version ${packagePlan.meta.version}, the request was ${version}`,
        { path: FIRST_FILE },
      );
    }
    const skillBytes = await fetchVerified(deps, packagePlan, FIRST_FILE, deadline);
    let declaredName = '';
    try {
      const parsed = parseFrontmatter(skillBytes.toString('utf8'));
      declaredName = typeof parsed.name === 'string' ? parsed.name.trim() : '';
    } catch {
      declaredName = '';
    }
    if (!isSkillName(declaredName)) {
      throw marketError(
        'E_SKILL_NAME_INVALID',
        `the package declares an invalid name: ${declaredName === '' ? '(missing)' : declaredName}`,
        { declaredName, source: ref.sourceId, owner: ref.owner, slug: ref.slug },
      );
    }
    const target = join(deps.skillsRoot, declaredName);
    if (!isWithin(deps.skillsRoot, target)) {
      throw marketError('E_SKILL_NAME_INVALID', 'the declared name does not resolve inside the skills root', {
        declaredName,
      });
    }
    if (await pathExists(target)) {
      throw marketError('E_ALREADY_INSTALLED', `a skill named ${declaredName} already exists`, {
        path: target,
        existing: { name: declaredName, version: await existingVersion(target) },
      });
    }

    temp = await makeTempDir(deps.skillsRoot);
    const written = [{ path: FIRST_FILE, size: skillBytes.length }];
    await writePackageFile(temp, FIRST_FILE, skillBytes);
    const rest = packagePlan.files.filter((file) => file.path !== FIRST_FILE);
    await mapLimit(rest, FILE_CONCURRENCY, async (file) => {
      const bytes = await fetchVerified(deps, packagePlan, file.path, deadline);
      await writePackageFile(temp, file.path, bytes);
      written.push({ path: file.path, size: bytes.length });
    });
    const metaPaths = await writeMeta(temp, {
      sourceId: ref.sourceId,
      owner: ref.owner,
      slug: ref.slug,
      version,
      name: declaredName,
      meta: packagePlan.meta,
      metaBytes: packagePlan.metaBytes,
      now: deps.now(),
    });
    await syncDirectory(temp);

    try {
      await mkdir(target, { mode: 0o755 });
    } catch (cause) {
      if (cause?.code === 'EEXIST') {
        throw marketError('E_ALREADY_INSTALLED', `a skill named ${declaredName} already exists`, {
          path: target,
          existing: { name: declaredName, version: await existingVersion(target) },
        });
      }
      throw marketError('E_INSTALL_IO', `could not claim the skill directory (${describe(cause)})`);
    }
    try {
      await rename(temp, target);
      temp = null;
    } catch (cause) {
      await rm(target, { recursive: true, force: true });
      if (cause?.code === 'EEXIST' || cause?.code === 'ENOTEMPTY') {
        throw marketError('E_ALREADY_INSTALLED', `a skill named ${declaredName} already exists`, {
          path: target,
          existing: { name: declaredName, version: await existingVersion(target) },
        });
      }
      throw marketError('E_INSTALL_IO', `could not move the skill into place (${describe(cause)})`);
    }
    await syncDirectory(deps.skillsRoot);

    try {
      await verifyLanded(target, declaredName, ref.sourceId);
    } catch (error) {
      await rm(target, { recursive: true, force: true });
      throw error;
    }

    const totalBytes = written.reduce((sum, file) => sum + file.size, 0);
    /** Distinct paths that now exist on disk: a package `_meta.json` is overwritten,
     * not added, so counting write operations would report one file too many. */
    const paths = new Set(written.map((file) => file.path));
    for (const metaPath of metaPaths) paths.add(metaPath);
    try {
      await deps.store.append({
        source: ref.sourceId,
        owner: ref.owner,
        slug: ref.slug,
        name: declaredName,
        version,
        files: paths.size,
        bytes: totalBytes,
      });
    } catch (cause) {
      throw marketError(
        'E_INSTALL_IO',
        `the skill landed but the ledger was not written (${describe(cause)})`,
        { path: target, name: declaredName },
      );
    }
    return {
      name: declaredName,
      path: target,
      version,
      source: ref.sourceId,
      owner: ref.owner,
      slug: ref.slug,
      files: paths.size,
      bytes: totalBytes,
    };
  } finally {
    if (temp !== null) {
      await rm(temp, { recursive: true, force: true });
    }
  }
}

/**
 * Build the installer for one skills root.
 * @param {{skillsRoot: string, io: object, sourceById: (id: string) => object|undefined,
 *   store: object, now?: () => number}} options - dependencies.
 * @returns {{install: (ref: {sourceId: string, owner: string, slug: string,
 *   version: string|null}) => Promise<object>}} the installer.
 */
export function createInstaller(options) {
  const skillsRoot = typeof options.skillsRoot === 'string' ? options.skillsRoot : '';
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const state = { locks: new Set(), running: 0 };
  return {
    /**
     * Install one market item.
     * @param {{sourceId: string, owner: string, slug: string, version: string|null}} ref - item reference.
     * @returns {Promise<object>} the install result.
     * @throws {import('./errors.js').MarketError} on every failure path.
     */
    async install(ref) {
      const source = options.sourceById(ref.sourceId);
      if (source === undefined) {
        throw marketError('E_BAD_QUERY', `unknown source: ${ref.sourceId}`);
      }
      const lockKey = `${ref.sourceId}:${ref.owner}:${ref.slug}`;
      if (state.locks.has(lockKey)) {
        throw marketError('E_INSTALL_BUSY', 'this skill is already being installed');
      }
      if (state.running >= MAX_CONCURRENT_INSTALLS) {
        throw marketError('E_INSTALL_BUSY', 'too many installs are running');
      }
      state.locks.add(lockKey);
      state.running += 1;
      try {
        return await installLocked({
          skillsRoot,
          io: options.io,
          store: options.store,
          now,
        }, { ...ref, source });
      } finally {
        state.locks.delete(lockKey);
        state.running -= 1;
      }
    },
  };
}
