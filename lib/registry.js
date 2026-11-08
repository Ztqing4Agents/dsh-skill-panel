/**
 * Registry projection: what the skill registry says, with the rank the registry
 * does not expose.
 *
 * `SkillSummary` carries `source` and `provider` but never `rank`, so rank is
 * reconstructed from the root-priority table the filesystem provider documents
 * (100 project-dsh, 200 project-agents, 300 custom, 400 user-dsh, 500 user-agents,
 * 600 bundled) plus the runtime provider's fixed 250. This is the design's known
 * approximation: a third-party provider that reports its own rank is treated as
 * 600.
 */
import { rankOf } from './classify.js';

/**
 * @typedef {Object} RegistryView
 * @property {object[]} summaries    skill summaries annotated with `rank`
 * @property {boolean} complete      whether discovery finished within a stable revision
 * @property {string[]} diagnostics  degradation notes
 */

/**
 * Map one skill summary to its precedence rank.
 * @param {object} summary - a SkillSummary from the registry.
 * @returns {number} the precedence rank.
 */
export function rankOfSummary(summary) {
  const source = summary?.source;
  if (typeof source === 'string' && source !== '') {
    if (source === 'runtime') return rankOf('runtime');
    if (source === 'project-dsh' || source === 'project-agents' || source === 'custom'
      || source === 'user-dsh' || source === 'user-agents' || source === 'bundled') {
      return rankOf(source);
    }
  }
  if (summary?.provider === 'runtime') return rankOf('runtime');
  return rankOf('bundled');
}

/**
 * Snapshot the skill registry for one workspace.
 *
 * A registry that is absent, throwing, or incomplete degrades to what it did
 * return: the panel still lists the directory scan, so a broken provider can
 * never blank the page.
 * @param {object|undefined} registry - ctx.skills.
 * @param {string} cwd - workspace directory the project-level roots hang off.
 * @returns {Promise<RegistryView>} annotated summaries and completeness.
 */
export async function snapshotRegistry(registry, cwd) {
  if (registry === undefined || registry === null || typeof registry.snapshot !== 'function') {
    return { summaries: [], complete: false, diagnostics: ['registry-unavailable'] };
  }
  let snapshot;
  try {
    snapshot = await registry.snapshot({ cwd });
  } catch {
    return { summaries: [], complete: false, diagnostics: ['registry-failed'] };
  }
  const skills = Array.isArray(snapshot?.skills) ? snapshot.skills : [];
  const summaries = skills
    .filter((summary) => typeof summary?.name === 'string' && summary.name !== '')
    .map((summary) => ({ ...summary, rank: rankOfSummary(summary) }));
  return { summaries, complete: snapshot?.complete === true, diagnostics: [] };
}
