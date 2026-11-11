/**
 * Plugin icons for the builtin blocks.
 *
 * A provider-delivered skill carries an `originPath` inside the package that shipped it, and
 * that package's manifest may name an icon relative to its root. The host's own plugin
 * inventory turns the same field into a base64 data URL; the panel does the same read here so
 * the browser never needs a host service (and no `inject` entry has to grow for it).
 *
 * The package is found two ways, in this order: the `node_modules/<pkg>` segment of the
 * origin path (fast and exact), or - for a `link:` install whose package lives outside any
 * `node_modules` - the nearest `package.json` no more than six directories above the skill.
 *
 * Two manifest sources, in the host's own order: the `icon` field, then the `exports["./icon"]`
 * subpath (some packages publish only the latter). Where the host loads that subpath as a
 * module, this reader accepts only *image files* - nothing from a manifest is ever executed.
 *
 * Every failure is `null`: an unreadable manifest, an icon that escapes the package, a
 * symlink, a file over the ceiling, an extension nobody can render. A block without an icon
 * keeps its letter avatar, so no caller has to branch on "did the read work".
 */
import { lstat, readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

import { isSafeRelativePath } from './names.js';

/** Same ceiling the host applies to a plugin icon. */
const MAX_ICON_BYTES = 262144;
const MIME = new Map([
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
]);

/** One read per package root per process; `null` is cached too - a missing icon stays missing. */
const icons = new Map();
/** One walk per origin path: the package root and the name its manifest declares. */
const packages = new Map();
/** How far above a skill a package root may sit. */
const MAX_UP = 6;

/**
 * The package root a skill was read from: everything after the last `node_modules`, with a
 * scoped package keeping its two segments.
 * @param {string} originPath - the row's `originPath`.
 * @returns {string|null} the package root, or null when the path is not inside node_modules.
 */
export function packageRootOf(originPath) {
  if (typeof originPath !== 'string' || originPath === '') return null;
  const at = originPath.lastIndexOf('node_modules/');
  if (at === -1) return null;
  const head = originPath.slice(0, at + 'node_modules/'.length);
  const rest = originPath.slice(at + 'node_modules/'.length).split('/');
  if (rest[0] === undefined || rest[0] === '') return null;
  const name = rest[0].startsWith('@') && rest[1] !== undefined ? `${rest[0]}/${rest[1]}` : rest[0];
  return head + name;
}

/** The package name a manifest declares, when it is usable. */
function nameOf(manifest) {
  return typeof manifest?.name === 'string' && manifest.name !== '' ? manifest.name : null;
}

/**
 * Walk up from a skill directory to the nearest package root - the shape a `link:` install
 * has, where nothing is inside a `node_modules`.
 * @param {string} originPath - the row's `originPath` (a directory inside the package).
 * @returns {Promise<{root: string, name: string}|null>} the package root and name, or null.
 */
async function packageAbove(originPath) {
  let dir = dirname(originPath);
  for (let step = 0; step < MAX_UP; step += 1) {
    try {
      // `lstat`: a symlinked directory is not followed, so the walk cannot escape the tree.
      if ((await lstat(dir)).isDirectory()) {
        const name = nameOf(JSON.parse(await readFile(resolve(dir, 'package.json'), 'utf8')));
        if (name !== null) return { root: dir, name };
      }
    } catch {
      // No manifest here (or an unreadable one): keep climbing.
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

/**
 * The package a skill came from, with its name.
 * @param {string|null|undefined} originPath - the row's `originPath`.
 * @returns {Promise<{root: string, name: string}|null>} the package, or null.
 */
export async function packageInfoOf(originPath) {
  if (typeof originPath !== 'string' || originPath === '') return null;
  if (packages.has(originPath)) return packages.get(originPath);
  const root = packageRootOf(originPath);
  let info = null;
  if (root !== null) {
    let declared = null;
    try {
      declared = nameOf(JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')));
    } catch {
      // A missing manifest still leaves the directory name, which is what npm would use.
    }
    const fallback = root.slice(root.lastIndexOf('/') + 1);
    info = { root, name: declared ?? fallback };
  } else {
    info = await packageAbove(originPath);
  }
  packages.set(originPath, info);
  return info;
}

/**
 * Read one package's icon as a data URL.
 * @param {string} root - absolute package root.
 * @returns {Promise<string|null>} the data URL, or null for any failure.
 */
async function readIcon(root) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
  for (const spec of [manifest?.icon, manifest?.exports?.['./icon']]) {
    // An export may be a path or a `{default: path}` condition object; either way only a
    // path that names an image is taken - a `.js` export is skipped, never imported.
    const raw = typeof spec === 'string' ? spec : spec?.default;
    const data = await imageAt(root, raw);
    if (data !== null) return data;
  }
  return null;
}

/**
 * Read one image inside a package, after every gate.
 * @param {string} root - absolute package root.
 * @param {string|undefined} raw - manifest-written path, possibly `./`-prefixed.
 * @returns {Promise<string|null>} the data URL, or null when this candidate is not an image.
 */
async function imageAt(root, raw) {
  // Manifests write "./icon.svg" and "icon.svg" alike; the guard speaks plain relative paths.
  const icon = typeof raw === 'string' && raw.startsWith('./') ? raw.slice(2) : raw;
  if (typeof icon !== 'string' || !isSafeRelativePath(icon)) return null;
  const file = resolve(root, icon);
  if (!file.startsWith(root + sep)) return null;
  const mime = MIME.get(file.slice(file.lastIndexOf('.')).toLowerCase());
  if (mime === undefined) return null;
  try {
    const stats = await lstat(file);
    // A symlink is not a regular file here: it is not followed, so it cannot smuggle in a
    // file from outside the package.
    if (!stats.isFile() || stats.size === 0 || stats.size > MAX_ICON_BYTES) return null;
    return `data:${mime};base64,${(await readFile(file)).toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * The plugin icon for one origin path, cached by package root.
 * @param {string|null|undefined} originPath - the row's `originPath`.
 * @returns {Promise<string|null>} the data URL, or null when there is no usable icon.
 */
export async function pluginIconOf(originPath) {
  const info = await packageInfoOf(originPath);
  if (info === null) return null;
  if (!icons.has(info.root)) icons.set(info.root, await readIcon(info.root));
  return icons.get(info.root);
}

/**
 * Attach `pluginPackage` and `pluginIcon` to every row that has an origin path.
 * @param {{groups: {key: string, skills: object[]}[]}} catalog - one merge pass.
 * @returns {Promise<object>} the same catalogue with icons attached.
 */
export async function withPluginIcons(catalog) {
  const groups = await Promise.all((catalog?.groups ?? []).map(async (group) => ({
    ...group,
    skills: await Promise.all((group.skills ?? []).map(async (row) => {
      if (typeof row?.originPath !== 'string') return row;
      const info = await packageInfoOf(row.originPath);
      return {
        ...row,
        pluginPackage: info === null ? null : info.name,
        pluginIcon: await pluginIconOf(row.originPath),
      };
    })),
  })));
  return { ...catalog, groups };
}
