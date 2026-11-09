/**
 * The SkillHub source: the mirror adapter with SkillHub's own identity.
 *
 * There is nothing here but configuration, because `api.skillhub.cn` *is* the implementation
 * (`./mirror.js`). The owner in a SkillHub row is the upstream namespace, so resolution is
 * free; the list row already carries `iconUrl`, and an installed row is answered by one
 * detail call.
 */
import { fromMirrorRow, fromSkillhubDetail } from '../normalize.js';
import { buildUrl } from '../query.js';
import { READ_TIMEOUT_MS } from '../upstream.js';
import { ORIGIN, createMirrorAdapter } from './mirror.js';

/**
 * The icon and upstream title of one SkillHub skill, for an installed row.
 *
 * One detail call - the same endpoint the hover view uses, minus the manifest and
 * `SKILL.md` - answers in about 0.26s with both facts. `version` is deliberately absent:
 * an icon and a title belong to the skill, not to a release, and leaving it out keeps the
 * upstream CDN cache warm.
 * @param {{owner: string, slug: string}} ref - skill identity.
 * @param {object} io - upstream client.
 * @param {number} timeoutMs - budget for this one request.
 * @returns {Promise<{iconUrl: string|null, displayName: string|null}>} the facts.
 */
async function detailFacts(ref, io, timeoutMs) {
  const body = await io.getJson(
    buildUrl(ORIGIN, `/api/v1/skills/${encodeURIComponent(ref.slug)}`, { namespace: ref.owner }),
    { timeoutMs: timeoutMs ?? READ_TIMEOUT_MS },
  );
  const skill = body?.skill !== null && typeof body?.skill === 'object' ? body.skill : {};
  return {
    iconUrl: skill.iconUrl ?? null,
    displayName: skill.displayName ?? null,
  };
}

/** The SkillHub adapter. */
export const skillhubSource = createMirrorAdapter({
  id: 'skillhub',
  source: null,
  normalizeRow: fromMirrorRow,
  normalizeDetail: (raw) => fromSkillhubDetail(raw),
  resolve: (ref) => ({ ns: ref.owner }),
  facts: detailFacts,
  caps: { search: true, paged: true, categories: true, package: 'files' },
  counts: true,
});

/** Forget every remembered SkillHub icon (tests, and bootstrap with `?refresh=1`). */
export function resetSkillhubIconCache() {
  skillhubSource.resetIconCache();
}

/** Forget the cached category table (tests and `?refresh=1`). */
export function resetCategoryCache() {
  skillhubSource.resetCategoryCache();
}

/** Forget the cached category counts (tests, and `?refresh=1` through `counts`). */
export function resetCountCache() {
  skillhubSource.resetCountCache();
}
