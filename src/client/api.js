/**
 * The browser's only door to the host half.
 *
 * URLs are document-relative (`api/dsh-skill-center/list`, no leading slash): the
 * GUI is served from `<base href="./">` and may live under a path prefix, where a
 * root-absolute URL would escape the deployment.
 *
 * The envelope is normalised here, so nothing above this module ever sees an HTTP
 * status: a failure is always an ApiError carrying the route's `E_*` code, which is
 * what the localized inline reason is keyed on.
 */

/** A failed call, carrying the route's error code. */
export class ApiError extends Error {
  /**
   * @param {string} code - `E_*` code from the route, or E_UNKNOWN for a local failure.
   * @param {string} message - English developer note.
   * @param {unknown} [data] - the envelope's `data`, when the route explained itself there
   *   (an install failure names the colliding path, for instance).
   */
  constructor(code, message, data) {
    super(message === '' ? code : message);
    this.name = 'ApiError';
    this.code = code;
    this.data = data ?? null;
  }
}

/** The route prefix, document-relative on purpose. */
const BASE = 'api/dsh-skill-center';

/**
 * Build a query string from the values that are actually present.
 *
 * Empty values are dropped rather than sent as empty parameters: a market page is
 * identified by the absence of a cursor, and `cursor=` would be a different request.
 * @param {Record<string, string|null|undefined>} values - one entry per parameter.
 * @returns {string} `?a=b`, or the empty string when no parameter has a value.
 */
function queryString(values) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === 'string' && value !== '') params.set(name, value);
  }
  const search = params.toString();
  return search === '' ? '' : `?${search}`;
}

/** The client half of the skill center data plane. */
export class SkillCenterApi {
  /**
   * @param {Function} [fetchImpl] - fetch implementation; defaults to the global one.
   */
  constructor(fetchImpl) {
    this.fetchImpl = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  }

  /**
   * Call one route and unwrap the envelope.
   * @param {string} path - document-relative route path.
   * @param {object} [init] - fetch init.
   * @returns {Promise<unknown>} the envelope's `data`.
   * @throws {ApiError} when the transport fails or the route answers a non-OK code.
   */
  async request(path, init) {
    let response;
    try {
      response = await this.fetchImpl(`${BASE}/${path}`, init);
    } catch (cause) {
      throw new ApiError('E_UNKNOWN', cause instanceof Error ? cause.message : String(cause));
    }
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (body === null || typeof body !== 'object' || typeof body.code !== 'string') {
      throw new ApiError('E_UNKNOWN', `unexpected response (${response.status})`);
    }
    if (body.code !== 'OK') {
      throw new ApiError(
        body.code,
        typeof body.message === 'string' ? body.message : '',
        body.data ?? null,
      );
    }
    return body.data;
  }

  /**
   * Read the whole catalogue.
   * @returns {Promise<object>} ListPayload.
   */
  async list() {
    return this.request('list');
  }

  /**
   * Read one installed skill's own text and file list (the detail view's one request).
   * @param {{name: string}} query - the skill's kebab name; never a path.
   * @returns {Promise<object>} SkillContent.
   */
  async skillDetail(query) {
    return this.request(`detail${queryString({ name: query?.name })}`);
  }

  /**
   * Enable or disable one file-backed skill.
   * @param {{name: string, path: string, enabled: boolean}} payload - the row identity and the target state.
   * @returns {Promise<object>} toggle result.
   */
  async toggle(payload) {
    return this.request('toggle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: payload.name, path: payload.path, enabled: payload.enabled === true }),
    });
  }

  /**
   * Enable or disable one provider-backed (built-in) skill.
   * @param {{provider: string, name: string, enabled: boolean}} payload - the identity and the target state.
   * @returns {Promise<object>} provider toggle result.
   */
  async toggleProvider(payload) {
    return this.request('provider-toggle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: payload.provider ?? '', name: payload.name, enabled: payload.enabled === true }),
    });
  }

  /**
   * Read the scope list and the category table of one scope. A failed category read is
   * not an error: the route answers `categoriesOk: false` and the list still works.
   * @param {string} [scope] - the scope whose counts to read (`all`, `skillhub`, `clawhub`).
   * @returns {Promise<object>} `{source, sources, categories, categoriesOk, categoriesStale}`.
   */
  async marketBootstrap(scope) {
    const suffix = typeof scope === 'string' && scope !== '' ? `?source=${encodeURIComponent(scope)}` : '';
    return this.request(`market/bootstrap${suffix}`);
  }

  /**
   * Read one page of one scope. One request per page: the scope picks which catalogue
   * the mirror lists, and the page carries its own cursor.
   * @param {{source: string, sort?: string, category?: string|null, keyword?: string,
   *   cursor?: string|null, limit?: number}} query - the query.
   * @returns {Promise<object>} `{source, sort, keyword, category, items, next, total}`.
   */
  async marketList(query) {
    return this.request(`market/list${queryString({
      source: query?.source,
      sort: query?.sort,
      category: query?.category,
      keyword: typeof query?.keyword === 'string' ? query.keyword.trim() : '',
      cursor: query?.cursor,
      limit: Number.isInteger(query?.limit) && query.limit > 0 ? String(query.limit) : '',
    })}`);
  }

  /**
   * Read one item's detail: overview text, declared name, target directory, file list.
   * @param {{source: string, owner: string, slug: string, version?: string|null}} ref - the item.
   * @returns {Promise<object>} MarketDetail.
   */
  /**
   * Ask the host for the icons of a batch of identities.
   *
   * `source` travels per item: one batch may mix the two sources, and the route groups
   * them itself (at most 12 per source, 24 in total).
   * @param {{items: {source: string, owner: string, slug: string}[]}} query - the batch.
   * @returns {Promise<{icons: Record<string, string|null>, names: Record<string, string|null>}>}
   *   icon URL and upstream title (each maybe null), both keyed by `source:owner:slug` with
   *   one entry per requested identity.
   */
  async marketIcons(query) {
    const items = Array.isArray(query?.items) ? query.items : [];
    return this.request('market/icons', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: items.map((item) => ({
          source: item?.source ?? '',
          owner: item?.owner ?? '',
          slug: item?.slug ?? '',
        })),
      }),
    });
  }
  async marketDetail(ref) {
    return this.request(`market/detail${queryString({
      source: ref?.source,
      owner: ref?.owner,
      slug: ref?.slug,
      version: ref?.version,
    })}`);
  }

  /**
   * Read every version of one skill, newest first.
   *
   * `source` is the identity here (`skillhub` / `clawhub`), not the list's scope: the
   * versions belong to one source's package.
   * @param {{source: string, owner: string, slug: string}} ref - the item.
   * @returns {Promise<object>} `{source, owner, slug, namespace, latest, versions, total}`.
   */
  async marketVersions(ref) {
    return this.request(`market/versions${queryString({
      source: ref?.source,
      owner: ref?.owner,
      slug: ref?.slug,
    })}`);
  }

  /**
   * Overwrite-install one skill over the directory it already occupies.
   *
   * `path` is the row's own `SKILL.md`: the route re-scans and refuses the write unless the
   * file it resolved is the one the panel is showing (AGENTS.md 6).
   * @param {{source: string, owner: string, slug: string, version: string, name: string,
   *   path: string}} ref - the update.
   * @returns {Promise<object>} `{name, path, version, from, source, owner, slug, files, bytes}`.
   */
  async marketUpdate(ref) {
    return this.request('market/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: ref?.source ?? '',
        owner: ref?.owner ?? '',
        slug: ref?.slug ?? '',
        version: ref?.version ?? '',
        name: ref?.name ?? '',
        path: ref?.path ?? '',
      }),
    });
  }

  /**
   * Read which market items this machine already installed, keyed by market item id.
   * @returns {Promise<object>} `{items, readable}`.
   */
  async marketInstalled() {
    return this.request('market/installed');
  }

  /**
   * Install one item. The body carries identity only: the file list and the target
   * path are the host's business, never the browser's.
   * @param {{source: string, owner: string, slug: string, version?: string|null}} ref - the item.
   * @returns {Promise<object>} `{name, path, version, source, owner, slug, files, bytes}`.
   */
  async marketInstall(ref) {
    const body = { source: ref?.source ?? '', owner: ref?.owner ?? '', slug: ref?.slug ?? '' };
    // The route validates `version` with its own grammar, so an unknown version is left
    // out entirely instead of being sent as null ("install this source's current one").
    if (typeof ref?.version === 'string' && ref.version !== '') body.version = ref.version;
    return this.request('market/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
}
