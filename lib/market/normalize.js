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

/** The slug shape the icon proxy route accepts (mirrors upstream.js LUCIDE_NAME). */
const LUCIDE_PROXY_NAME = /^[a-z0-9]+(?:-[a-z0-9]+){0,5}$/;

/** Summary length kept on a card (the card draws one line). */
export const SUMMARY_MAX = 400;

/** Overview length kept in the detail view. */
export const OVERVIEW_MAX = 8000;

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
 * SkillHub names its labels (`subCategories[].name`, Chinese) and keeps their case, because
 * `Bug` and `API` mean something different from `bug` and `api`. ClawHub publishes topic
 * slugs mixed with Title Case (`Marketing` next to `mcp`), and those are lower-cased so one
 * source's chips look like one set; they are not title-cased either, or `mcp` would become
 * `Mcp`. Neither source promises an array, so anything that is not one is an empty list -
 * never null: this is a list field, and the card only ever asks for its length.
 * @param {unknown} value - `subCategories` (objects with a `name`) or `topics` (strings).
 * @param {'name'|'topic'} kind - read `.name` off each entry, or take the string itself.
 * @returns {string[]} zero to three labels, in upstream order.
 */
export function tagListOf(value, kind) {
  const entries = Array.isArray(value) ? value : [];
  const tags = [];
  const seen = new Set();
  for (const entry of entries) {
    const source = kind === 'name'
      ? (isObject(entry) ? textOrNull(entry.name) : null)
      : textOrNull(entry);
    if (source === null) continue;
    const text = clampLine(source, TAG_MAX);
    if (text === '') continue;
    const tag = kind === 'topic' ? text.toLowerCase() : text;
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

/** Prefix ClawHub uses when the icon is a named Lucide glyph rather than an image. */
const LUCIDE_PREFIX = 'lucide:';

/** The path ClawHub serves uploaded icons from, and the shape of its hash. */
const CLAWHUB_ICON_PATH = /^\/api\/v1\/skill-icons\/([a-f0-9]{64})$/;

/** Path of this plugin's proxy for ClawHub's uploaded icons, document-relative like the rest. */
export const CLAWHUB_ICON_PROXY_PATH = 'api/dsh-skill-center/market/clawhub-icon';

/**
 * Path of this plugin's own icon proxy, document-relative on purpose.
 *
 * Same rule as `src/client/api.js`: the GUI is served from `<base href="./">` and may sit
 * under a path prefix, where a root-absolute `/api/...` would escape the deployment.
 */
export const LUCIDE_PROXY_PATH = 'api/dsh-skill-center/market/lucide';

/**
 * Turn a ClawHub icon name into our own icon URL.
 * @param {string} name - kebab-case slug.
 * @returns {string} the proxy URL.
 */
export function lucideProxyUrl(name) {
  return `${LUCIDE_PROXY_PATH}?name=${name}`;
}

/**
 * URL of our proxy for one uploaded ClawHub icon.
 * @param {string} hash - 64 lower-case hex characters.
 * @returns {string} the document-relative URL.
 */
export function clawhubIconProxyUrl(hash) {
  return `${CLAWHUB_ICON_PROXY_PATH}?hash=${hash}`;
}

/**
 * Whether a value is one of ClawHub's icon hashes.
 * @param {unknown} value - candidate.
 * @returns {boolean} true for 64 lower-case hex characters.
 */
export function isClawhubIconHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

/**
 * Kebab-case slug of a Lucide icon name, or null when it is not one.
 *
 * ClawHub hands out `lucide:Zap` and `lucide:FileText` (PascalCase) next to names that
 * are already kebab-case. The proxy route accepts kebab only, so the conversion happens
 * here: split camel humps, lower-case, and reject anything that would not survive the
 * route's whitelist (at most six segments, `[a-z0-9-]`).
 * @param {unknown} value - icon name, with or without the `lucide:` prefix.
 * @returns {string|null} the slug, or null.
 */
export function lucideNameOf(value) {
  if (typeof value !== 'string') return null;
  const text = textOrNull(value);
  if (text === null) return null;
  if (LUCIDE_PROXY_NAME.test(text)) return text;
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(text)) return null;
  const kebab = text
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
  return LUCIDE_PROXY_NAME.test(kebab) ? kebab : null;
}

/**
 * The icon of a ClawHub skill, in the form the card can render.
 *
 * Three shapes come out of that upstream: an uploaded image (`/api/v1/skill-icons/<hash>`),
 * a named Lucide glyph (`lucide:Zap`), or nothing. Both real shapes go through this
 * plugin's own proxies and come back as document-relative URLs: ClawHub's icon responses
 * carry a `sandbox` CSP that kills an in-page `<img>`, and a Lucide token is not an image
 * address at all. Anything else (http:, protocol-relative, unknown paths, bare words) is
 * null and the card keeps its letter avatar.
 * @param {unknown} value - upstream `icon`.
 * @returns {string|null} a document-relative proxy URL, an absolute https URL, or null.
 */
export function clawhubIconUrl(value) {
  const text = textOrNull(value);
  if (text === null) return null;
  if (text.startsWith(LUCIDE_PREFIX)) {
    const name = lucideNameOf(text.slice(LUCIDE_PREFIX.length));
    return name === null ? null : lucideProxyUrl(name);
  }
  const uploaded = CLAWHUB_ICON_PATH.exec(text);
  if (uploaded !== null) {
    // ClawHub answers these with a `sandbox` CSP, which makes an in-page <img> fail
    // outright, so the bytes have to come back through this plugin (see the
    // `market/clawhub-icon` route). The proxy URL is document-relative, like every other
    // path the browser half calls.
    return clawhubIconProxyUrl(uploaded[1]);
  }
  try {
    const url = new URL(text);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
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
    tags: tagListOf(raw.subCategories, 'name'),
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
    tags: tagListOf(skill.subCategories ?? raw.subCategories, 'name'),
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
    saves: null, // this source reports no stars (see docs/contracts/market.md 7.4)
    score: null, // and no popularity score either
    // `tags` on this source is `{latest: version}`, not a label list - the topics are.
    tags: tagListOf(raw.topics, 'topic'),
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
    saves: null, // no stars on this source either
    score: null,
    tags: tagListOf(native.skill?.topics ?? raw.topics, 'topic'),
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
    saves: null, // no stars on this source either
    score: null,
    tags: tagListOf(skill.topics ?? raw.topics, 'topic'),
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
