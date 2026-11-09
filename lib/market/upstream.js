/**
 * The only outbound door of this plugin.
 *
 * `node:https` and nothing else: whether the host runtime exposes a global `fetch` is
 * not something a plugin may assume, and the two origins we talk to are plain HTTPS
 * with no streaming needs.
 *
 * Four behaviours live here so that no adapter has to repeat them:
 *
 * - **Deadlines.** A connect budget and a total budget per call; whichever expires
 *   first tears the socket down and reports `E_SOURCE_TIMEOUT`.
 * - **A byte ceiling.** A response larger than the caller's ceiling is aborted, never
 *   buffered.
 * - **One-hop redirects, whitelisted.** SkillHub answers file downloads with a 302 to
 *   its COS bucket. We follow exactly one hop, and only to a host that matches the
 *   bucket pattern; anything else is `E_PACKAGE_INVALID` rather than a download from
 *   wherever the header points.
 * - **Two concurrency gates.** Six calls in flight overall, three per origin. A fan-out
 *   is one call per source, so the gates only bite during installs.
 *
 * Network failures are mapped, not propagated: a caller always receives one of the
 * `E_SOURCE_*` codes and never a bare `ENOTFOUND`.
 */
import { Agent, request } from 'node:https';

import { marketError, MarketError } from './errors.js';

/** Default budget for one market call. */
export const READ_TIMEOUT_MS = 10000;

/** Default connect budget. */
export const CONNECT_TIMEOUT_MS = 5000;

/** Budget for the category table, which may fail silently. */
export const CATEGORY_TIMEOUT_MS = 6000;

/** Budget for one package file inside an install. */
export const FILE_TIMEOUT_MS = 30000;

/** Largest JSON body accepted from an upstream. */
export const MAX_JSON_BYTES = 2 * 1024 * 1024;

/** Largest binary body accepted from an upstream (one package or one file). */
export const MAX_BINARY_BYTES = 40 * 1024 * 1024;

/** Redirect hops allowed for a download. */
export const MAX_REDIRECTS = 1;

/** The only hosts a download redirect may point at. */
export const REDIRECT_HOST = /^[a-z0-9-]+\.cos\.accelerate\.myqcloud\.com$/;

/** Socket errors that mean "too slow" rather than "not there". */
const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ERR_SOCKET_TIMEOUT', 'ABORT_ERR']);

/** What we tell an upstream about ourselves. */
const USER_AGENT = 'dsh-skill-center';

/**
 * Whether a download redirect may be followed.
 * @param {string} location - the `location` header value, absolute or relative.
 * @param {string} base - the URL that answered.
 * @returns {boolean} true when the target is https and on the bucket host pattern.
 */
export function isAllowedRedirect(location, base) {
  if (typeof location !== 'string' || location.trim() === '') return false;
  let target;
  try {
    target = new URL(location, base);
  } catch {
    return false;
  }
  if (target.protocol !== 'https:') return false;
  return REDIRECT_HOST.test(target.hostname);
}

/**
 * A counting gate: at most `limit` holders at a time, granted in arrival order.
 * @param {number} limit - maximum concurrent holders.
 * @returns {{acquire: () => Promise<() => void>}} the gate.
 */
function createSemaphore(limit) {
  let active = 0;
  const waiters = [];
  const release = () => {
    active -= 1;
    const next = waiters.shift();
    if (next !== undefined) next();
  };
  return {
    acquire() {
      return new Promise((resolve) => {
        const grant = () => {
          active += 1;
          resolve(release);
        };
        if (active < limit) grant();
        else waiters.push(grant);
      });
    },
  };
}

/**
 * Map a socket-level failure onto the market vocabulary.
 * @param {unknown} cause - whatever node threw.
 * @returns {MarketError} the mapped error.
 */
function mapNetworkError(cause) {
  if (cause instanceof MarketError) return cause;
  const code = typeof cause?.code === 'string' ? cause.code : '';
  const message = cause instanceof Error ? cause.message : String(cause);
  if (TIMEOUT_CODES.has(code)) return marketError('E_SOURCE_TIMEOUT', `upstream did not answer in time (${code})`);
  return marketError('E_SOURCE_UNAVAILABLE', `upstream is unreachable (${code || message || 'network error'})`);
}

/**
 * Map a non-2xx upstream status onto the market vocabulary.
 * @param {number} status - upstream status.
 * @returns {MarketError} the mapped error.
 */
function mapStatus(status) {
  if (status === 429 || status >= 500) {
    return marketError('E_SOURCE_UNAVAILABLE', `upstream answered ${status}`);
  }
  return marketError('E_SOURCE_BAD_RESPONSE', `upstream answered ${status}`);
}

/**
 * Perform one HTTPS call, without following redirects.
 * @param {string} target - absolute URL.
 * @param {{agent: object, headers?: object, timeoutMs: number, connectTimeoutMs: number,
 *   maxBytes: number}} options - call options.
 * @returns {Promise<{status: number, headers: object, body: Buffer|null}>} the response.
 */
function perform(target, options) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let totalTimer = null;
    let connectTimer = null;
    let req = null;
    const stopTimers = () => {
      if (totalTimer !== null) clearTimeout(totalTimer);
      if (connectTimer !== null) clearTimeout(connectTimer);
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      stopTimers();
      if (error) reject(error);
      else resolve(value);
    };
    try {
      req = request(target, {
        method: 'GET',
        agent: options.agent,
        headers: { accept: '*/*', 'user-agent': USER_AGENT, ...options.headers },
      });
    } catch (cause) {
      reject(mapNetworkError(cause));
      return;
    }
    totalTimer = setTimeout(() => {
      req.destroy();
      finish(marketError('E_SOURCE_TIMEOUT', `no complete response within ${options.timeoutMs} ms`));
    }, options.timeoutMs);
    connectTimer = setTimeout(() => {
      req.destroy();
      finish(marketError('E_SOURCE_TIMEOUT', `connect timed out after ${options.connectTimeoutMs} ms`));
    }, options.connectTimeoutMs);
    req.on('socket', (socket) => {
      if (socket.connecting !== true) {
        if (connectTimer !== null) clearTimeout(connectTimer);
        return;
      }
      socket.once('connect', () => {
        if (connectTimer !== null) clearTimeout(connectTimer);
      });
    });
    req.on('error', (cause) => finish(mapNetworkError(cause)));
    req.on('response', (res) => {
      if (connectTimer !== null) clearTimeout(connectTimer);
      const status = res.statusCode ?? 0;
      const headers = res.headers;
      res.on('error', (cause) => finish(mapNetworkError(cause)));
      if (status >= 300 && status < 400) {
        res.resume();
        finish(null, { status, headers, body: null });
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        finish(mapStatus(status));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        if (settled) return;
        size += chunk.length;
        if (size > options.maxBytes) {
          req.destroy();
          finish(marketError('E_SOURCE_BAD_RESPONSE', `response exceeds ${options.maxBytes} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => finish(null, { status, headers, body: Buffer.concat(chunks) }));
    });
    req.end();
  });
}

/**
 * Read one JSON document.
 * @param {string} target - absolute URL.
 * @param {object} options - perform options.
 * @returns {Promise<object|null>} the parsed document.
 */
async function readJson(target, options) {
  const result = await perform(target, { ...options, maxBytes: options.maxBytes ?? MAX_JSON_BYTES });
  if (result.body === null) throw marketError('E_SOURCE_BAD_RESPONSE', 'expected JSON, the upstream redirected');
  let parsed;
  try {
    parsed = JSON.parse(result.body.toString('utf8'));
  } catch {
    throw marketError('E_SOURCE_BAD_RESPONSE', 'the upstream body is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw marketError('E_SOURCE_BAD_RESPONSE', 'the upstream body is not a JSON document');
  }
  return parsed;
}

/**
 * Read one binary document, following at most one whitelisted redirect.
 * @param {string} target - absolute URL.
 * @param {object} options - perform options.
 * @returns {Promise<{body: Buffer, headers: object, url: string}>} the download.
 */
async function readBytes(target, options) {
  let current = target;
  let hops = 0;
  for (;;) {
    const result = await perform(current, options);
    const location = result.body === null ? result.headers?.location : undefined;
    if (location === undefined) {
      if (result.body === null) throw marketError('E_SOURCE_BAD_RESPONSE', 'the upstream sent an empty body');
      return { body: result.body, headers: result.headers, url: current };
    }
    if (hops >= MAX_REDIRECTS) {
      throw marketError('E_PACKAGE_INVALID', 'the download redirected more than once');
    }
    if (!isAllowedRedirect(location, current)) {
      throw marketError('E_PACKAGE_INVALID', 'the download redirects off the allowed bucket host');
    }
    current = new URL(String(location), current).toString();
    hops += 1;
  }
}

/**
 * Build the upstream client the adapters talk to.
 * @param {{maxSockets?: number, globalLimit?: number, hostLimit?: number}} [options] - agent and gate sizing.
 * @returns {{getJson: Function, getBytes: Function, agent: object, dispose: Function}} the client.
 */
export function createUpstream(options = {}) {
  const agent = new Agent({ keepAlive: true, maxSockets: options.maxSockets ?? 8 });
  const globalGate = createSemaphore(options.globalLimit ?? 6);
  const hostGates = new Map();
  const hostLimit = options.hostLimit ?? 3;
  const gateFor = (target) => {
    let origin = 'unknown';
    try {
      origin = new URL(target).origin;
    } catch {
      origin = 'unknown';
    }
    let gate = hostGates.get(origin);
    if (gate === undefined) {
      gate = createSemaphore(hostLimit);
      hostGates.set(origin, gate);
    }
    return gate;
  };
  const limited = async (target, task) => {
    const releaseGlobal = await globalGate.acquire();
    const releaseHost = await gateFor(target).acquire();
    try {
      return await task();
    } finally {
      releaseHost();
      releaseGlobal();
    }
  };
  const budget = (call = {}) => {
    const timeoutMs = Number.isInteger(call.timeoutMs) ? call.timeoutMs : READ_TIMEOUT_MS;
    const connectTimeoutMs = Number.isInteger(call.connectTimeoutMs)
      ? Math.min(call.connectTimeoutMs, timeoutMs)
      : Math.min(CONNECT_TIMEOUT_MS, timeoutMs);
    return { agent, headers: call.headers, timeoutMs, connectTimeoutMs };
  };
  return {
    agent,
    getJson(target, callOptions = {}) {
      return limited(target, () => readJson(target, { ...budget(callOptions), maxBytes: callOptions.maxBytes }));
    },
    getBytes(target, callOptions = {}) {
      return limited(target, () => readBytes(target, {
        ...budget(callOptions),
        maxBytes: callOptions.maxBytes ?? MAX_BINARY_BYTES,
      }));
    },
    dispose() {
      agent.destroy();
    },
  };
}
