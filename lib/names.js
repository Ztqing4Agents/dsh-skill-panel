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

/**
 * The in-memory identity of one switchable skill: provider plus name.
 * @param {string} provider - provider id, may be empty.
 * @param {string} name - skill name.
 * @returns {string} identity key such as `filesystem#ui-design`.
 */
export function identityKey(provider, name) {
  return `${provider ?? ''}#${name}`;
}
