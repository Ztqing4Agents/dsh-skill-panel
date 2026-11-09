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
 * The path fragment every real SkillHub icon carries.
 *
 * `iconUrl` on this source is a mixed bag: about four in ten entries point at an
 * uploaded icon under `/skill-icons/`, roughly as many point at a site-wide placeholder
 * on `cloudcache.tencent-cloud.com/qcloud/ui/static/other_external_resource/...` (one of
 * them is SkillHub's own 256x64 banner), and the rest are empty. A placeholder drawn as
 * if it were the skill's own icon is worse than the letter avatar it replaces, so the
 * path is the test: only a URL under `/skill-icons/` describes this skill, everything
 * else normalises to null and the card falls back to the avatar.
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
  if (!url.pathname.includes('/skill-icons/')) return null;
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
    updatedAt: timestampOrNull(skill.updated_at) ?? timestampOrNull(latest.createdAt) ?? timestampOrNull(skill.updatedAt),
    category: textOrNull(skill.category),
    packageKind,
  });
}

/**
 * A ClawHub list item.
 *
 * The version comes from `latestVersion.version`; `tags.latest` is only a fallback,
 * because on this source it is a version *id* rather than a version number.
 * @param {unknown} raw - upstream item.
 * @param {'files'|'zip'} [packageKind] - the source's package shape.
 * @returns {object|null} the MarketItem, or null for a non-object.
 */
export function fromClawhubListItem(raw, packageKind = 'zip') {
  if (!isObject(raw)) return null;
  const stats = isObject(raw.stats) ? raw.stats : {};
  const latest = isObject(raw.latestVersion) ? raw.latestVersion : {};
  const tags = isObject(raw.tags) ? raw.tags : {};
  const publisher = isObject(raw.publisher) ? raw.publisher : {};
  return marketItem({
    sourceId: 'clawhub',
    owner: textOrNull(raw.ownerHandle) ?? textOrNull(raw.owner?.handle),
    slug: textOrNull(raw.slug),
    displayName: textOrNull(raw.displayName) ?? textOrNull(raw.name),
    // ClawHub's `icon` is a Lucide icon token (`lucide:Zap`), not an image address,
    // and /api/v1/skill-icons/<token> answers 404 - so this source has no picture to
    // point at. Null here means "fall back to the letter avatar", never a broken img.
    iconUrl: null,
    summary: textOrNull(raw.summary) ?? '',
    author: textOrNull(publisher.displayName) ?? textOrNull(raw.ownerHandle),
    version: textOrNull(latest.version) ?? versionLike(textOrNull(tags.latest)),
    downloads: numberOrNull(stats.downloads) ?? numberOrNull(raw.downloads),
    updatedAt: timestampOrNull(raw.updatedAt) ?? timestampOrNull(raw.metrics?.updatedAt),
    category: null,
    packageKind,
  });
}

/**
 * A ClawHub search result.
 *
 * The search endpoint answers a shallower shape than the list endpoint: no version,
 * no category, and sometimes no slug. The version is `null` here on purpose - a
 * guessed version would be worse than an absent one.
 * @param {unknown} raw - upstream result.
 * @param {'files'|'zip'} [packageKind] - the source's package shape.
 * @returns {object|null} the MarketItem, or null for a non-object.
 */
export function fromClawhubSearchItem(raw, packageKind = 'zip') {
  if (!isObject(raw)) return null;
  const native = isObject(raw.native) ? raw.native : {};
  const skill = isObject(native.skill) ? native.skill : {};
  const publisher = isObject(raw.publisher) ? raw.publisher : {};
  const metrics = isObject(raw.metrics) ? raw.metrics : {};
  return marketItem({
    sourceId: 'clawhub',
    owner: textOrNull(raw.ownerHandle) ?? textOrNull(raw.owner?.handle),
    slug: textOrNull(raw.slug) ?? textOrNull(skill.slug) ?? slugFromUrl(raw.canonicalUrl ?? raw.canonical_url),
    displayName: textOrNull(raw.displayName) ?? textOrNull(skill.displayName),
    iconUrl: null, // no image address on this source (see fromClawhubListItem)
    summary: textOrNull(skill.summary) ?? textOrNull(raw.summary) ?? '',
    author: textOrNull(publisher.displayName) ?? textOrNull(raw.ownerHandle),
    version: null,
    downloads: numberOrNull(raw.downloads) ?? numberOrNull(raw.stats?.downloads),
    updatedAt: timestampOrNull(metrics.updatedAt) ?? timestampOrNull(raw.updatedAt),
    category: null,
    packageKind,
  });
}

/**
 * A ClawHub detail payload (`{skill, latestVersion, owner, publisher}`).
 * @param {unknown} raw - upstream body.
 * @param {'files'|'zip'} [packageKind] - the source's package shape.
 * @returns {object|null} the MarketItem, or null when the body carries no skill.
 */
export function fromClawhubDetail(raw, packageKind = 'zip') {
  if (!isObject(raw) || !isObject(raw.skill)) return null;
  const skill = raw.skill;
  const stats = isObject(skill.stats) ? skill.stats : (isObject(raw.stats) ? raw.stats : {});
  const latest = isObject(raw.latestVersion) ? raw.latestVersion : {};
  const owner = isObject(raw.owner) ? raw.owner : {};
  return marketItem({
    sourceId: 'clawhub',
    owner: textOrNull(owner.handle) ?? textOrNull(skill.ownerHandle),
    slug: textOrNull(skill.slug),
    displayName: textOrNull(skill.displayName) ?? textOrNull(skill.name),
    iconUrl: null, // no image address on this source (see fromClawhubListItem)
    summary: textOrNull(skill.summary) ?? '',
    author: textOrNull(raw.publisher?.displayName) ?? textOrNull(owner.displayName) ?? textOrNull(owner.handle),
    version: textOrNull(latest.version) ?? versionLike(textOrNull(skill.tags?.latest)),
    downloads: numberOrNull(stats.downloads) ?? numberOrNull(skill.downloads),
    updatedAt: timestampOrNull(skill.updatedAt) ?? timestampOrNull(raw.updatedAt),
    category: null,
    packageKind,
  });
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
 * Last path segment of a URL.
 * @param {unknown} value - absolute URL.
 * @returns {string|null} the segment, or null when there is none.
 */
export function slugFromUrl(value) {
  if (typeof value !== 'string' || value === '') return null;
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter((part) => part !== '');
    return parts.length === 0 ? null : decodeURIComponent(parts[parts.length - 1]);
  } catch {
    return null;
  }
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
