/**
 * Raw upstream payloads to the one shape the page renders.
 *
 * Two rules hold for every function here:
 *
 * 1. **A missing field is `null`, never `0` and never `''`.** A card that shows
 *    "0 downloads" for a source that does not report downloads is a lie; the page
 *    drops the whole clause when the value is null.
 * 2. **Only mapping, no interpretation.** Whether an item is installable, which
 *    sort order to use, how to merge two sources - none of that belongs here.
 *
 * The overview text of a skill comes from its own `SKILL.md`, for both sources:
 * SkillHub leaves `overviewMd` empty and ClawHub puts the whole file into
 * `skill.description`. One derivation, two callers.
 */
import { parseFrontmatter, stripFrontmatter } from '../frontmatter.js';
import { isSkillName } from '../names.js';


/** Summary length kept on a card (the card draws one line). */
export const SUMMARY_MAX = 400;

/** Overview length kept in the detail view. */
export const OVERVIEW_MAX = 8000;

/** Prefix the mirror puts in front of a ClawHub owner it has not claimed. */
const CLAWHUB_MIRROR_NAMESPACE_PREFIX = 'clawhub_';

/** The most labels a card shows. */
export const MAX_TAGS = 3;

/** The longest label kept, in characters (a chip ellipsises past this). */
export const TAG_MAX = 24;

/**
 * Whether a value is a plain object.
 * @param {unknown} value - candidate.
 * @returns {boolean} true for a non-array object.
 */
export function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Trimmed non-empty string, or null.
 * @param {unknown} value - candidate.
 * @returns {string|null} the text.
 */
export function textOrNull(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

/**
 * Integer, or null. Fractions are truncated; non-finite values are dropped.
 * @param {unknown} value - candidate.
 * @returns {number|null} the number.
 */
export function numberOrNull(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

/**
 * A finite number kept exactly as it arrived, or null.
 *
 * `numberOrNull` truncates, which is right for counts and wrong for a score: the
 * upstream's popularity score is a continuous number (`95757.41562195931`), and cutting
 * it here would be an interpretation rather than a mapping. Truncation happens where the
 * number is turned into a reading, not where it is read.
 * @param {unknown} value - candidate.
 * @returns {number|null} the number, untouched.
 */
export function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Epoch milliseconds, or null.
 * @param {unknown} value - milliseconds, or an ISO 8601 string.
 * @returns {number|null} epoch milliseconds.
 */
export function timestampOrNull(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

/**
 * One-line text, truncated on a character boundary.
 *
 * The cut is ASCII-only on purpose: an ellipsis character would travel through the
 * dictionary-free host half, and this module must stay free of display copy.
 * @param {unknown} value - candidate text.
 * @param {number} max - maximum length kept.
 * @returns {string} the flattened text, possibly empty.
 */
export function clampLine(value, max) {
  if (typeof value !== 'string') return '';
  const flat = value.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 3).trimEnd()}...`;
}

/**
 * Multi-line text, truncated.
 * @param {unknown} value - candidate text.
 * @param {number} max - maximum length kept.
 * @returns {string} the text with its line breaks, possibly empty.
 */
export function clampBlock(value, max) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\r\n/g, '\n').trim();
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}\n...`;
}

/**
 * The tag list of one item: at most three labels, no blanks, no duplicates.
 *
 * Both sources publish their labels the same way since U7 (ClawHub's catalogue comes from
 * the SkillHub mirror), and both keep the case: `Bug` and `API` mean something different
 * from `bug` and `api`, and a Chinese category name has no case at all. Neither source
 * promises an array, so anything that is not one is an empty list - never null: this is a
 * list field, and the card only ever asks for its length.
 * @param {unknown} value - `subCategories`, an array of objects carrying a `name`.
 * @returns {string[]} zero to three labels, in upstream order.
 */
export function tagListOf(value) {
  const entries = Array.isArray(value) ? value : [];
  const tags = [];
  const seen = new Set();
  for (const entry of entries) {
    const source = isObject(entry) ? textOrNull(entry.name) : null;
    if (source === null) continue;
    const tag = clampLine(source, TAG_MAX);
    if (tag === '') continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

/**
 * The dedupe key and render key of one market item.
 *
 * Upstream ids are not comparable across sources, so the key is assembled locally:
 * `${sourceId}:${owner}:${slug}`. One skill appears once even when two batches of the
 * same source overlap.
 * @param {string} sourceId - adapter id.
 * @param {string|null} owner - upstream owner handle.
 * @param {string|null} slug - upstream slug.
 * @returns {string} the market key.
 */
export function marketId(sourceId, owner, slug) {
  return `${sourceId}:${owner ?? ''}:${slug ?? ''}`;
}

/**
 * The icon address of a SkillHub item, when there is one.
 *
 * The upstream serves icons from two hosts: its own COS bucket
 * (`...cos.accelerate.myqcloud.com/skill-icons/uploads/...`) and a shared CDN
 * (`cloudcache.tencent-cloud.com/qcloud/ui/static/other_external_resource/...`). Both
 * are real per-skill pictures - the second one was mistaken for a site placeholder once,
 * and filtering it out dropped the icon coverage from about eight items in ten to four.
 * So there is no host or path whitelist: an absolute `https:` address is accepted as it
 * is, and a broken one is handled where it can actually be judged - the browser's
 * `onError`, which falls back to the letter avatar.
 *
 * Only values that cannot be an image address at all become null: empty strings,
 * non-strings, relative paths and anything that is not `https:`.
 * @param {unknown} value - upstream `iconUrl`.
 * @returns {string|null} an absolute https URL, or null.
 */
export function skillhubIconUrl(value) {
  const text = textOrNull(value);
  if (text === null) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  return url.toString();
}

/**
 * Assemble one item, filling every field so the browser never sees `undefined`.
 * @param {object} fields - mapped fields.
 * @returns {object} the MarketItem.
 */
export function marketItem(fields) {
  const owner = textOrNull(fields.owner);
  const slug = textOrNull(fields.slug);
  return {
    sourceId: fields.sourceId,
    id: marketId(fields.sourceId, owner, slug),
    owner,
    slug,
    displayName: textOrNull(fields.displayName) ?? slug ?? '',
    iconUrl: typeof fields.iconUrl === 'string' && fields.iconUrl !== '' ? fields.iconUrl : null,
    summary: clampLine(fields.summary, SUMMARY_MAX),
    author: textOrNull(fields.author),
    version: textOrNull(fields.version),
    downloads: numberOrNull(fields.downloads),
    saves: numberOrNull(fields.saves),
    score: finiteOrNull(fields.score),
    tags: Array.isArray(fields.tags) ? fields.tags : [],
    updatedAt: timestampOrNull(fields.updatedAt),
    category: textOrNull(fields.category),
    packageKind: fields.packageKind === 'zip' ? 'zip' : 'files',
  };
}

/**
 * A SkillHub list item.
 * @param {unknown} raw - upstream item.
 * @param {'files'|'zip'} [packageKind] - the source's package shape.
 * @returns {object|null} the MarketItem, or null for a non-object.
 */
export function fromSkillhubListItem(raw, packageKind = 'files') {
  if (!isObject(raw)) return null;
  const namespace = isObject(raw.namespace) ? raw.namespace : {};
  const publisher = isObject(raw.publisher) ? raw.publisher : {};
  const stats = isObject(raw.stats) ? raw.stats : {};
  const latest = isObject(raw.latestVersion) ? raw.latestVersion : {};
  return marketItem({
    sourceId: 'skillhub',
    owner: textOrNull(namespace.handle) ?? textOrNull(raw.ownerHandle) ?? textOrNull(raw.owner?.handle),
    slug: textOrNull(raw.slug),
    displayName: textOrNull(raw.name) ?? textOrNull(raw.displayName),
    iconUrl: skillhubIconUrl(raw.iconUrl),
    summary: textOrNull(raw.summary) ?? textOrNull(raw.description) ?? '',
    author: textOrNull(publisher.name) ?? textOrNull(namespace.displayName) ?? textOrNull(namespace.handle),
    version: textOrNull(raw.version) ?? textOrNull(latest.version),
    downloads: numberOrNull(raw.downloads) ?? numberOrNull(stats.downloads),
    saves: numberOrNull(raw.stars) ?? numberOrNull(stats.stars),
    score: finiteOrNull(raw.score) ?? finiteOrNull(stats.score),
    tags: tagListOf(raw.subCategories),
    updatedAt: timestampOrNull(raw.updated_at) ?? timestampOrNull(raw.updatedAt),
    category: textOrNull(raw.category),
    packageKind,
  });
}

/**
 * A SkillHub detail payload (`{skill, stats, namespace, owner, publisher, latestVersion}`).
 * @param {unknown} raw - upstream body.
 * @param {'files'|'zip'} [packageKind] - the source's package shape.
 * @returns {object|null} the MarketItem, or null when the body carries no skill.
 */
export function fromSkillhubDetail(raw, packageKind = 'files') {
  if (!isObject(raw) || !isObject(raw.skill)) return null;
  const skill = raw.skill;
  const stats = isObject(raw.stats) ? raw.stats : (isObject(skill.stats) ? skill.stats : {});
  const namespace = isObject(raw.namespace) ? raw.namespace : (isObject(skill.namespace) ? skill.namespace : {});
  const publisher = isObject(raw.publisher) ? raw.publisher : (isObject(skill.publisher) ? skill.publisher : {});
  const latest = isObject(raw.latestVersion) ? raw.latestVersion : {};
  return marketItem({
    sourceId: 'skillhub',
    owner: textOrNull(namespace.handle) ?? textOrNull(raw.owner?.handle) ?? textOrNull(skill.namespaceHandle),
    slug: textOrNull(skill.slug),
    displayName: textOrNull(skill.name) ?? textOrNull(skill.displayName),
    iconUrl: skillhubIconUrl(skill.iconUrl),
    summary: textOrNull(skill.summary) ?? textOrNull(skill.description) ?? '',
    author: textOrNull(publisher.name) ?? textOrNull(namespace.displayName) ?? textOrNull(namespace.handle),
    version: textOrNull(latest.version) ?? textOrNull(skill.version),
    downloads: numberOrNull(stats.downloads) ?? numberOrNull(skill.downloads),
    saves: numberOrNull(stats.stars) ?? numberOrNull(skill.stars),
    score: finiteOrNull(stats.score) ?? finiteOrNull(skill.score),
    tags: tagListOf(skill.subCategories ?? raw.subCategories),
    updatedAt: timestampOrNull(skill.updated_at) ?? timestampOrNull(latest.createdAt) ?? timestampOrNull(skill.updatedAt),
    category: textOrNull(skill.category),
    packageKind,
  });
}

/**
 * The native ClawHub owner of one mirror row.
 *
 * The SkillHub mirror publishes ClawHub items through SkillHub's own shape, adding the
 * native handle as `upstream_owner_login` and keeping its `namespace.handle` as
 * `clawhub_<owner>`. Only the native handle is usable as an identity: it is the one an
 * installed row's `_meta.json` and the icon cache have always carried, so nothing has to
 * be migrated, and it is what the ClawHub API itself calls the owner.
 *
 * When `upstream_owner_login` is missing the prefixed namespace is unwrapped. When it
 * cannot be unwrapped the item is dropped rather than guessed: a row that cannot be
 * installed is worse than a row that is not shown (see docs/contracts/market.md 7.8).
 * @param {unknown} raw - one mirror list row.
 * @returns {string|null} the native owner, or null when it cannot be derived.
 */
export function mirrorOwnerOf(raw) {
  const native = textOrNull(raw?.upstream_owner_login);
  if (native !== null) return native;
  const handle = textOrNull(raw?.namespace?.handle);
  if (handle === null) return null;
  const stripped = handle.startsWith(CLAWHUB_MIRROR_NAMESPACE_PREFIX)
    ? handle.slice(CLAWHUB_MIRROR_NAMESPACE_PREFIX.length)
    : '';
  return stripped === '' ? null : stripped;
}

/** Upstream row source -> the identity id this panel uses. `enterprise` is SkillHub's own. */
const SOURCE_ID_BY_ROW = { community: 'skillhub', enterprise: 'skillhub', clawhub: 'clawhub' };

/**
 * One row of the mirror list, whichever scope it was asked for.
 *
 * The unfiltered list returns ClawHub rows next to SkillHub's, so the row decides its own
 * identity: the brand mark, the icon key, the bookmark key and the install route all follow
 * `sourceId`, and a wrong answer installs one catalogue's package under the other
 * catalogue's name. This is the only place the fold happens - a second copy would drift and
 * make an installed skill look uninstalled. A row from a source this panel does not know is
 * dropped rather than guessed.
 * @param {unknown} raw - upstream item.
 * @returns {object|null} the MarketItem, or null when the row has no identity we can use.
 */
export function fromMirrorRow(raw) {
  const upstream = textOrNull(raw?.source);
  const sourceId = upstream === null ? null : (SOURCE_ID_BY_ROW[upstream] ?? null);
  if (sourceId === null) return null;
  return sourceId === 'clawhub' ? fromClawhubMirrorItem(raw) : fromSkillhubListItem(raw);
}

/**
 * A ClawHub item as the SkillHub mirror publishes it.
 *
 * The mirror *is* SkillHub's own API (`?source=clawhub`), so the field reading happens
 * in exactly one place - `fromSkillhubListItem` - and this mapping only replaces what
 * the source owns: the id, the owner, and a version that is a version rather than a
 * version id. The default `packageKind` is `files` like every other mirror row - the
 * package is the mirror's own manifest.
 * @param {unknown} raw - one mirror list row.
 * @param {'files'|'zip'} [packageKind] - the source's package shape.
 * @returns {object|null} the MarketItem, or null when the row cannot be identified.
 */
export function fromClawhubMirrorItem(raw, packageKind = 'files') {
  const base = fromSkillhubListItem(raw, packageKind);
  if (base === null) return null;
  const owner = mirrorOwnerOf(raw);
  if (owner === null) return null;
  const slug = base.slug;
  if (slug === null || slug === '') return null;
  return {
    ...base,
    sourceId: 'clawhub',
    owner,
    id: marketId('clawhub', owner, slug),
    // The mirror may carry ClawHub's version *id* in `version`; a card must not print it.
    version: versionLike(base.version),
  };
}

/**
 * A ClawHub detail payload, as the SkillHub mirror publishes it.
 *
 * The body has SkillHub's shape (`{skill, stats, namespace, latestVersion}`), so the field
 * reading is `fromSkillhubDetail`'s. The owner is the one thing that cannot come from it:
 * the mirror files a ClawHub skill under *its* namespace (`clawhub_<owner>`, or a claimed
 * one like `indiv-guipi`), while this plugin's identity is the native ClawHub handle the
 * row was matched on. So the caller passes the owner it already resolved.
 * @param {unknown} raw - upstream body.
 * @param {unknown} owner - the native ClawHub owner.
 * @returns {object|null} the MarketItem, or null when the body or the owner is unusable.
 */
export function fromClawhubMirrorDetail(raw, owner) {
  const base = fromSkillhubDetail(raw, 'files');
  if (base === null) return null;
  const native = textOrNull(owner);
  if (native === null) return null;
  const slug = base.slug;
  if (slug === null || slug === '') return null;
  return {
    ...base,
    sourceId: 'clawhub',
    owner: native,
    id: marketId('clawhub', native, slug),
  };
}

/**
 * Keep a version-like token, drop anything that is clearly an id.
 * @param {string|null} value - candidate.
 * @returns {string|null} the value when it starts with a digit.
 */
function versionLike(value) {
  return value !== null && /^\d/.test(value) ? value : null;
}

/**
 * Derive the overview text from a `SKILL.md`.
 * @param {unknown} sourceText - the whole file, frontmatter included.
 * @param {unknown} [fallback] - text to use when the body is empty.
 * @returns {string} the overview, possibly empty.
 */
export function overviewOf(sourceText, fallback = '') {
  const body = typeof sourceText === 'string' ? stripFrontmatter(sourceText) : '';
  const text = clampBlock(body, OVERVIEW_MAX);
  if (text !== '') return text;
  return clampBlock(typeof fallback === 'string' ? fallback : '', OVERVIEW_MAX);
}

/**
 * The name a package declares for itself.
 * @param {unknown} sourceText - the whole `SKILL.md`.
 * @returns {string} the declared name, empty when absent.
 */
export function declaredNameOf(sourceText) {
  if (typeof sourceText !== 'string') return '';
  try {
    const name = parseFrontmatter(sourceText).name;
    return typeof name === 'string' ? name.trim() : '';
  } catch {
    return '';
  }
}

/**
 * Whether a declared name can become a directory under the skills root.
 * @param {unknown} name - declared name.
 * @returns {boolean} true for kebab-case names.
 */
export function nameIsValid(name) {
  return isSkillName(name);
}

/**
 * Sort items newest first, leaving unknown timestamps last and the order stable.
 * @param {object[]} items - MarketItems.
 * @returns {object[]} a new array.
 */
export function sortByUpdatedDesc(items) {
  return [...items].sort((left, right) => {
    const a = left.updatedAt;
    const b = right.updatedAt;
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return b - a;
  });
}
