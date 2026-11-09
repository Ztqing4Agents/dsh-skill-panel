/**
 * Naming and path predicates shared by every host module.
 *
 * The skill name grammar is the host's own (`EX/dsh-skill/lib/index.js`,
 * `SKILL_NAME`), so a name this module accepts is a name the registry can
 * resolve, and vice versa.
 */
import { basename, isAbsolute, relative, resolve } from 'node:path';

/** The host's skill name grammar. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The file name every skill entry point carries. */
const SKILL_FILE = 'SKILL.md';

/**
 * Whether a string is a legal skill name.
 * @param {unknown} value - candidate name.
 * @returns {boolean} true for kebab-case names such as `dev-docs-standards`.
 */
export function isSkillName(value) {
  return typeof value === 'string' && SKILL_NAME.test(value);
}

/**
 * Whether a path is an absolute path ending in SKILL.md.
 * @param {unknown} value - candidate path.
 * @returns {boolean} true when the path could name a skill entry point.
 */
export function isAbsoluteSkillFile(value) {
  return typeof value === 'string' && value.trim() !== '' && isAbsolute(value) && basename(value) === SKILL_FILE;
}

/** Longest single segment of a package path; upstream samples stay far below it. */
const MAX_SEGMENT = 100;

/** Longest whole package path. */
const MAX_RELATIVE = 240;

/**
 * Whether a string is a path that stays inside the package it came from.
 *
 * This is the rule that keeps a downloaded archive from writing anywhere except the
 * directory the installer created: no leading slash, no drive letter, no backslash,
 * no empty or `.`/`..` segment, and bounded lengths. A dot-prefixed segment is
 * allowed (a package may ship `.gitignore`); only `.` and `..` are refused.
 * @param {unknown} value - candidate path, using `/` as the separator.
 * @returns {boolean} true when the path is a safe relative path.
 */
export function isSafeRelativePath(value) {
  if (typeof value !== 'string') return false;
  if (value === '' || value.length > MAX_RELATIVE) return false;
  if (value.startsWith('/') || value.includes('\\') || value.includes(':')) return false;
  if (/[\u0000-\u001f]/.test(value)) return false;
  return value.split('/').every((segment) => (
    segment !== ''
    && segment !== '.'
    && segment !== '..'
    && segment.length <= MAX_SEGMENT
  ));
}

/**
 * Whether `target` sits inside `root` (and is not `root` itself).
 * @param {string} root - directory that must contain the target.
 * @param {string} target - path to test.
 * @returns {boolean} true when the target is a strict descendant of the root.
 */
export function isWithin(root, target) {
  if (typeof root !== 'string' || typeof target !== 'string') return false;
  const rel = relative(resolve(root), resolve(target));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/** A registered source id, as it may appear in `_meta.json`. */
export const UPSTREAM_SOURCE_ID = /^[a-z][a-z0-9-]{0,31}$/;

/** An upstream owner handle; real handles contain underscores and dots. */
export const UPSTREAM_OWNER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** An upstream slug. */
export const UPSTREAM_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Whether one identifier is a shape this plugin will put into an upstream URL.
 *
 * The character classes are the ones `lib/market/query.js` forwards to the sources, and
 * the `..` check is the reason they are worth sharing: `a..b` matches every class here,
 * so a value that only passed the class is not yet a value that is safe to append to a
 * path. One definition, two consumers (the route whitelist and the identity check below).
 * @param {RegExp} pattern - one of the three patterns above.
 * @param {unknown} value - candidate identifier.
 * @returns {boolean} true when the value is a shape that may reach an upstream URL.
 */
function isUpstreamPart(pattern, value) {
  return typeof value === 'string' && pattern.test(value) && !value.includes('..');
}

/**
 * Whether three values together name one skill on one upstream.
 *
 * All three or nothing: a records file that carries an owner but no slug describes no
 * fetchable skill, and half an identity would grow a branch in every consumer.
 * @param {unknown} sourceId - source id, e.g. `clawhub`.
 * @param {unknown} owner - owner handle.
 * @param {unknown} slug - skill slug.
 * @returns {boolean} true when all three are shaped like upstream identifiers.
 */
export function isUpstreamIdentity(sourceId, owner, slug) {
  return isUpstreamPart(UPSTREAM_SOURCE_ID, sourceId)
    && isUpstreamPart(UPSTREAM_OWNER, owner)
    && isUpstreamPart(UPSTREAM_SLUG, slug);
}

/**
 * The in-memory identity of one switchable skill: provider plus name.
 * @param {string} provider - provider id, may be empty.
 * @param {string} name - skill name.
 * @returns {string} identity key such as `filesystem#ui-design`.
 */
export function identityKey(provider, name) {
  return `${provider ?? ''}#${name}`;
}
