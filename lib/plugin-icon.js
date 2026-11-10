/**
 * Plugin icons for the builtin blocks.
 *
 * A provider-delivered skill carries an `originPath` inside the package that shipped it, and
 * that package's manifest may name an icon relative to its root. The host's own plugin
 * inventory turns the same field into a base64 data URL; the panel does the same read here so
 * the browser never needs a host service (and no `inject` entry has to grow for it).
 *
 * Every failure is `null`: an unreadable manifest, an icon that escapes the package, a
 * symlink, a file over the ceiling, an extension nobody can render. A block without an icon
 * keeps its letter avatar, so no caller has to branch on "did the read work".
 */
import { lstat, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import { isSafeRelativePath } from './names.js';

/** Icons are decoration: anything big is a mistake, not a feature. */
const MAX_ICON_BYTES = 16384;
const MIME = new Map([
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.jpg', 'image/jpeg'],
]);

/** One read per package root per process; `null` is cached too - a missing icon stays missing. */
const icons = new Map();

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
  const raw = manifest?.icon;
  // Manifests write "./icon.svg" and "icon.svg" alike; the guard speaks plain relative paths.
  const icon = typeof raw === 'string' && raw.startsWith('./') ? raw.slice(2) : raw;
  if (typeof icon !== 'string' || !isSafeRelativePath(icon)) return null;
  const file = resolve(root, icon);
  if (!file.startsWith(root + sep)) return null;
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
  const mime = MIME.get(ext);
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
  const root = packageRootOf(originPath);
  if (root === null) return null;
  if (!icons.has(root)) icons.set(root, await readIcon(root));
  return icons.get(root);
}

/**
 * Attach `pluginIcon` to every row that has an origin path.
 * @param {{groups: {key: string, skills: object[]}[]}} catalog - one merge pass.
 * @returns {Promise<object>} the same catalogue with icons attached.
 */
export async function withPluginIcons(catalog) {
  const groups = await Promise.all((catalog?.groups ?? []).map(async (group) => ({
    ...group,
    skills: await Promise.all((group.skills ?? []).map(async (row) => {
      if (typeof row?.originPath !== 'string') return row;
      return { ...row, pluginIcon: await pluginIconOf(row.originPath) };
    })),
  })));
  return { ...catalog, groups };
}
