/**
 * The ClawHub source: the mirror adapter with ClawHub's identity.
 *
 * ClawHub's catalogue, its detail payload and its packages all come from SkillHub's mirror
 * (`source=clawhub`), so the machinery is `./mirror.js` and everything here is the part that
 * differs: the rows are ClawHub's (a native owner instead of a SkillHub namespace), and the
 * namespace a skill lives in cannot be guessed - a claimed ClawHub namespace has no
 * `clawhub_` prefix (measured: `find-skills` lives in `indiv-guipi`).
 */
import { marketError } from '../errors.js';
import {
  finiteOrNull,
  fromClawhubMirrorDetail,
  fromMirrorRow,
  isObject,
  textOrNull,
} from '../normalize.js';
import { buildUrl } from '../query.js';
import { READ_TIMEOUT_MS } from '../upstream.js';
import { ORIGIN, createMirrorAdapter } from './mirror.js';

/** How many mirror rows one lookup may look through; the match is exact, so 20 is plenty. */
const LOOKUP_PAGE = 20;

/**
 * The mirror's own row for one ClawHub skill.
 *
 * Matched on `slug` **and** `upstream_owner_login`: the slug alone is not unique across
 * owners (`find-skills` and `find-skills-robin` both exist), and a row from the wrong owner
 * would put somebody else's numbers - or somebody else's package - on this card.
 * @param {{owner: string, slug: string}} ref - item reference.
 * @param {object} io - upstream client.
 * @param {number} timeoutMs - budget for this one request.
 * @returns {Promise<object|null>} the row, or null when the mirror no longer lists it.
 */
async function lookupRow(ref, io, timeoutMs) {
  const body = await io.getJson(
    buildUrl(ORIGIN, '/api/skills', {
      page: 1,
      pageSize: LOOKUP_PAGE,
      source: 'clawhub',
      keyword: ref.slug,
    }),
    { timeoutMs: timeoutMs ?? READ_TIMEOUT_MS },
  );
  const rows = Array.isArray(body?.data?.skills) ? body.data.skills : [];
  return rows.find((raw) => isObject(raw)
    && textOrNull(raw.slug) === ref.slug
    && textOrNull(raw.upstream_owner_login) === ref.owner) ?? null;
}

/**
 * Translate a ClawHub identity into the namespace the mirror files it under.
 *
 * There is no prefix rule to fall back on: 95 of 100 ClawHub owners live in
 * `clawhub_<owner>`, but the ones that claimed their namespace do not, and those are the
 * ones a user is most likely to open. So the answer is looked up, not derived. A miss is an
 * error rather than a guess - without a namespace the detail request would answer somebody
 * else's package, or nothing at all.
 *
 * The same row also carries the one figure the detail payload lacks (`score`), so the
 * lookup costs one request and answers two questions.
 * @param {{owner: string, slug: string}} ref - item reference.
 * @param {object} io - upstream client.
 * @returns {Promise<{ns: string, score: number|null}>} the namespace and the score, if any.
 * @throws {import('../errors.js').MarketError} E_SOURCE_BAD_RESPONSE when the mirror has
 *   dropped the skill.
 */
async function mirrorLookup(ref, io) {
  const row = await lookupRow(ref, io);
  if (row === null) {
    throw marketError('E_SOURCE_BAD_RESPONSE', 'the mirror no longer lists this skill');
  }
  return {
    ns: textOrNull(row.namespace?.handle) ?? ref.owner,
    score: finiteOrNull(row.score),
  };
}

/**
 * The icon and upstream title of one ClawHub skill, for an installed row.
 *
 * One list page answers both: the mirror row carries `iconUrl` and `name`, where going
 * through the detail endpoint would first need the namespace (two requests).
 * @param {{owner: string, slug: string}} ref - skill identity.
 * @param {object} io - upstream client.
 * @param {number} timeoutMs - budget for this one request.
 * @returns {Promise<{iconUrl: string|null, displayName: string|null}>} the facts.
 */
async function mirrorRowFacts(ref, io, timeoutMs) {
  const row = await lookupRow(ref, io, timeoutMs);
  if (row === null) return { iconUrl: null, displayName: null };
  return {
    iconUrl: textOrNull(row.iconUrl),
    displayName: textOrNull(row.name) ?? textOrNull(row.displayName),
  };
}

/** The ClawHub adapter. */
export const clawhubSource = createMirrorAdapter({
  id: 'clawhub',
  source: 'clawhub',
  normalizeRow: fromMirrorRow,
  normalizeDetail: (raw, ref) => fromClawhubMirrorDetail(raw, ref.owner),
  resolve: mirrorLookup,
  facts: mirrorRowFacts,
  caps: { search: true, paged: true, categories: true, package: 'files' },
  counts: true,
});

/** Forget every remembered ClawHub icon (tests, and bootstrap with `?refresh=1`). */
export function resetIconCache() {
  clawhubSource.resetIconCache();
}
