/**
 * Query parameter whitelists, cursor codec, and URL construction.
 *
 * Every value that reaches an upstream URL passes one of the literals below first.
 * The reason is not stylistic: `owner`, `slug`, `version` and `category` end up in a
 * path or a query string, and a value that is merely "URL encoded" can still change
 * the shape of the request once the upstream decodes it. A closed character class
 * plus a `..` check plus `URL.searchParams.set` plus an origin assertion is the only
 * combination that survives a hostile value.
 *
 * The cursor is our own opaque token: base64url of a small JSON object. The browser
 * never builds one, it only hands back what an adapter gave it, so a token that does
 * not decode is a 400 rather than a 500.
 */
import { marketError } from './errors.js';

/** A registered source id. */
const SOURCE_ID = /^[a-z][a-z0-9-]{0,31}$/;
/** An upstream owner handle; real handles contain underscores. */
const OWNER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** An upstream slug. */
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** An upstream version string. */
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/;
/** A category key. */
const CATEGORY = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** A search keyword: length and character class only, no semantic filtering. */
const KEYWORD = /^[\p{L}\p{N}\p{Zs}\p{P}]{0,64}$/u;

/** The three sort orders the panel offers. */
export const SORTS = new Set(['recommended', 'updated', 'downloads']);

/** Page size bounds; an out-of-range number is clamped, a non-number is refused. */
export const LIMIT = { min: 1, max: 24, fallback: 12 };

/** Longest keyword the panel forwards. */
export const MAX_KEYWORD = 64;

/** Longest cursor token accepted. */
const MAX_CURSOR = 512;

/** Largest batch of icon lookups one request may carry. */
export const MAX_ICON_ITEMS = 24;

/**
 * Read one parameter as a string.
 * @param {URLSearchParams|Record<string, unknown>} params - query source.
 * @param {string} key - parameter name.
 * @returns {string|null} the raw text, or null when absent.
 */
function textOf(params, key) {
  if (params instanceof URLSearchParams) return params.get(key);
  const value = params?.[key];
  return typeof value === 'string' ? value : null;
}

/**
 * Validate one value against a whitelist.
 *
 * `..` is checked separately: `a..b` matches the character class of every identifier
 * here, and only the explicit check keeps it out of a path segment.
 * @param {RegExp} pattern - the whitelist.
 * @param {string|null} value - candidate.
 * @param {string} field - field name for the error message.
 * @returns {string} the accepted value.
 * @throws {import('./errors.js').MarketError} with code E_BAD_QUERY.
 */
function requirePattern(pattern, value, field) {
  if (typeof value !== 'string' || !pattern.test(value) || value.includes('..')) {
    throw marketError('E_BAD_QUERY', `${field} is not a value this panel forwards`);
  }
  return value;
}

/**
 * Encode an opaque cursor.
 * @param {Record<string, unknown>} value - small JSON object.
 * @returns {string} base64url token.
 */
export function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/**
 * Decode an opaque cursor.
 * @param {string} text - token previously issued by encodeCursor.
 * @returns {Record<string, unknown>} the decoded object.
 * @throws {import('./errors.js').MarketError} with code E_BAD_QUERY when the token is not ours.
 */
export function decodeCursor(text) {
  if (typeof text !== 'string' || text === '' || text.length > MAX_CURSOR) {
    throw marketError('E_BAD_QUERY', 'cursor is not a token this panel issued');
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
  } catch {
    throw marketError('E_BAD_QUERY', 'cursor is not a token this panel issued');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw marketError('E_BAD_QUERY', 'cursor is not a token this panel issued');
  }
  const keys = Object.keys(parsed);
  if (keys.length === 0 || keys.length > 8) {
    throw marketError('E_BAD_QUERY', 'cursor is not a token this panel issued');
  }
  for (const key of keys) {
    const value = parsed[key];
    if (!['string', 'number'].includes(typeof value)) {
      throw marketError('E_BAD_QUERY', 'cursor is not a token this panel issued');
    }
  }
  return parsed;
}

/**
 * Read a page size.
 * @param {string} text - raw parameter text.
 * @returns {number} the clamped page size.
 * @throws {import('./errors.js').MarketError} with code E_BAD_QUERY when not a number.
 */
function readLimit(text) {
  if (!/^\d{1,4}$/.test(text)) throw marketError('E_BAD_QUERY', 'limit must be a number');
  return Math.min(LIMIT.max, Math.max(LIMIT.min, Number(text)));
}

/**
 * Parse a list or search request.
 * @param {URLSearchParams|Record<string, unknown>} params - query source.
 * @returns {{sourceId: string, sort: string, category: string|null, keyword: string,
 *   limit: number, cursor: Record<string, unknown>|null}} the normalised query.
 * @throws {import('./errors.js').MarketError} with code E_BAD_QUERY on any bad field.
 */
export function parseListQuery(params) {
  const sourceId = textOf(params, 'source');
  if (sourceId === null || !SOURCE_ID.test(sourceId)) {
    throw marketError('E_BAD_QUERY', 'source must be a registered source id');
  }
  const sortText = textOf(params, 'sort');
  const sort = sortText === null || sortText === '' ? 'recommended' : sortText;
  if (!SORTS.has(sort)) throw marketError('E_BAD_QUERY', 'sort must be one of recommended/updated/downloads');
  const categoryText = textOf(params, 'category');
  const category = categoryText === null || categoryText.trim() === ''
    ? null
    : requirePattern(CATEGORY, categoryText.trim(), 'category');
  const keywordText = textOf(params, 'keyword');
  const keyword = keywordText === null ? '' : keywordText.trim();
  if (keyword.length > MAX_KEYWORD) throw marketError('E_BAD_QUERY', 'keyword is longer than 64 characters');
  if (keyword !== '' && !KEYWORD.test(keyword)) {
    throw marketError('E_BAD_QUERY', 'keyword contains characters this panel does not forward');
  }
  const limitText = textOf(params, 'limit');
  const limit = limitText === null || limitText === '' ? LIMIT.fallback : readLimit(limitText.trim());
  const cursorText = textOf(params, 'cursor');
  const cursor = cursorText === null || cursorText === '' ? null : decodeCursor(cursorText);
  return { sourceId, sort, category, keyword, limit, cursor };
}

/**
 * Parse a detail request.
 * @param {URLSearchParams|Record<string, unknown>} params - query source.
 * @returns {{sourceId: string, owner: string, slug: string, version: string|null}} the item reference.
 * @throws {import('./errors.js').MarketError} with code E_BAD_QUERY on any bad field.
 */
export function parseDetailQuery(params) {
  const sourceId = textOf(params, 'source');
  if (sourceId === null || !SOURCE_ID.test(sourceId)) {
    throw marketError('E_BAD_QUERY', 'source must be a registered source id');
  }
  const owner = requirePattern(OWNER, textOf(params, 'owner'), 'owner');
  const slug = requirePattern(SLUG, textOf(params, 'slug'), 'slug');
  const versionText = textOf(params, 'version');
  const version = versionText === null || versionText.trim() === ''
    ? null
    : requirePattern(VERSION, versionText.trim(), 'version');
  return { sourceId, owner, slug, version };
}

/**
 * Parse an install request body.
 *
 * The body carries no path and no file list: the package manifest is fetched by the
 * host, so a request can never widen the set of files that get written.
 * @param {Record<string, unknown>} body - parsed JSON body.
 * @returns {{sourceId: string, owner: string, slug: string, version: string|null}} the item reference.
 * @throws {import('./errors.js').MarketError} with code E_BAD_QUERY on any bad field.
 */
export function parseInstallBody(body) {
  const record = typeof body === 'object' && body !== null ? body : {};
  const sourceId = typeof record.source === 'string' ? record.source : null;
  if (sourceId === null || !SOURCE_ID.test(sourceId)) {
    throw marketError('E_BAD_QUERY', 'source must be a registered source id');
  }
  const owner = requirePattern(OWNER, typeof record.owner === 'string' ? record.owner : null, 'owner');
  const slug = requirePattern(SLUG, typeof record.slug === 'string' ? record.slug : null, 'slug');
  const version = typeof record.version === 'string' && record.version.trim() !== ''
    ? requirePattern(VERSION, record.version.trim(), 'version')
    : null;
  return { sourceId, owner, slug, version };
}

/**
 * Parse a batch icon request.
 *
 * The body names skills, never URLs: the host decides which upstream to ask, so a request
 * cannot widen what this plugin talks to. A malformed body is `E_BAD_REQUEST` - the caller
 * sent the wrong shape; asking for icons from a source that has none is `E_BAD_QUERY`.
 * @param {Record<string, unknown>} body - parsed JSON body.
 * @returns {{owner: string, slug: string}[]} deduplicated references.
 * @throws {import('./errors.js').MarketError} E_BAD_QUERY for a wrong source, E_BAD_REQUEST otherwise.
 */
export function parseIconRequest(body) {
  const record = typeof body === 'object' && body !== null ? body : {};
  const sourceId = typeof record.source === 'string' ? record.source : '';
  if (sourceId !== 'clawhub') {
    throw marketError('E_BAD_QUERY', 'icons are only served for the clawhub source');
  }
  const items = record.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ICON_ITEMS) {
    throw marketError('E_BAD_REQUEST', `items must be an array of 1..${MAX_ICON_ITEMS} entries`);
  }
  const refs = [];
  const seen = new Set();
  for (const entry of items) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw marketError('E_BAD_REQUEST', 'every item must be an object with owner and slug');
    }
    const owner = requirePattern(OWNER, typeof entry.owner === 'string' ? entry.owner : null, 'owner');
    const slug = requirePattern(SLUG, typeof entry.slug === 'string' ? entry.slug : null, 'slug');
    const key = `${owner}:${slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ owner, slug });
  }
  return refs;
}

/**
 * Build an upstream URL with the origin pinned.
 *
 * Parameters are set one by one through `searchParams.set`, never concatenated: a
 * keyword containing `&` or `#` would otherwise splice extra parameters into the
 * request. The origin is asserted after construction, so a path that escapes the
 * source origin is a programming error, not a silent call to somebody else's host.
 * @param {string} origin - `https://host` of the source.
 * @param {string} path - absolute path on that origin.
 * @param {Record<string, string|number|null|undefined>} [params] - query parameters.
 * @returns {string} the absolute URL.
 * @throws {import('./errors.js').MarketError} with code E_INTERNAL when the origin escaped.
 */
export function buildUrl(origin, path, params = {}) {
  const url = new URL(path, origin);
  assertOrigin(url, origin);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  assertOrigin(url, origin);
  return url.toString();
}

/**
 * Assert that a constructed URL still points at the source origin.
 * @param {URL} url - constructed URL.
 * @param {string} origin - expected origin.
 * @returns {void}
 * @throws {import('./errors.js').MarketError} with code E_INTERNAL on mismatch.
 */
function assertOrigin(url, origin) {
  if (url.origin !== origin || url.protocol !== 'https:') {
    throw marketError('E_INTERNAL', 'refusing to call an origin outside the source registry');
  }
}
