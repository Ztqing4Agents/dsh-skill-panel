/**
 * Fake node HTTP request/response pairs for the four routes.
 *
 * The routes only use `request.method`, `request.url`, `request.headers`,
 * `request.socket.remoteAddress` and the stream events, so a Readable with those
 * properties attached is a faithful stand-in for `IncomingMessage`. The response
 * records the status, the headers, and the JSON body it was given.
 */
import { Readable } from 'node:stream';

/** Headers a browser on this machine sends to the host webserver. */
export const LOOPBACK_HEADERS = { host: '127.0.0.1:5173', 'sec-fetch-site': 'same-origin' };

/**
 * Build a request.
 * @param {{method?: string, url?: string, headers?: object, body?: string|Buffer,
 *   remoteAddress?: string}} [options] - request shape.
 * @returns {import('node:stream').Readable} the fake request.
 */
export function fakeRequest(options = {}) {
  const {
    method = 'GET',
    url = '/',
    headers = LOOPBACK_HEADERS,
    body,
    remoteAddress = '127.0.0.1',
  } = options;
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  stream.method = method;
  stream.url = url;
  stream.headers = headers;
  stream.socket = { remoteAddress };
  return stream;
}

/**
 * Build a response that records what the handler wrote.
 * @returns {{res: object, done: Promise<{status: number, headers: object, body: string, json: unknown}>}}
 *   the fake response and a promise for its result.
 */
export function fakeResponse() {
  const out = { status: 0, headers: {}, body: '', json: null };
  let settle;
  const done = new Promise((resolve) => { settle = resolve; });
  const response = {
    statusCode: 200,
    setHeader(name, value) {
      out.headers[name.toLowerCase()] = value;
    },
    end(payload) {
      out.status = response.statusCode;
      out.body = typeof payload === 'string' ? payload : String(payload ?? '');
      try {
        out.json = out.body === '' ? null : JSON.parse(out.body);
      } catch {
        out.json = null;
      }
      settle(out);
    },
  };
  return { res: response, done };
}

/**
 * Call one route handler once and return the recorded response.
 * @param {object} route - a route from `makeRoutes`.
 * @param {object} [options] - request options.
 * @returns {Promise<{status: number, headers: object, body: string, json: unknown}>} the response.
 */
export async function callRoute(route, options = {}) {
  const { res, done } = fakeResponse();
  await route.handler(fakeRequest(options), res);
  return done;
}
