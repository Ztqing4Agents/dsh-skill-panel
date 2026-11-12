/**
 * The pure criteria behind "add a skill" and "delete a skill": expand a typed path,
 * pick the target name, decide whether an added copy would be shadowed, and bound
 * what one source directory may cost.
 *
 * Nothing here touches disk, a clock, or a counter, so every rule in this file is
 * directly testable and the orchestration below (`index.js`) stays readable as the
 * guard table it implements. The one table this module reads is `rankOf`'s - the
 * nine-step ladder is not edited here, only consulted.
 */
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { rankOf } from '../classify.js';
import { isSkillName } from '../names.js';

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
