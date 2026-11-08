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
   */
  constructor(code, message) {
    super(message === '' ? code : message);
    this.name = 'ApiError';
    this.code = code;
  }
}

/** The route prefix, document-relative on purpose. */
const BASE = 'api/dsh-skill-center';

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
      throw new ApiError(body.code, typeof body.message === 'string' ? body.message : '');
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
}
