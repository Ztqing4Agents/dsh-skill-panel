/**
 * HTTP plumbing shared by the four routes: one response envelope, one bounded
 * body reader.
 *
 * Envelope: `{ code, data, message }`. `code` is 'OK' on success and an `E_*`
 * constant otherwise; `message` is an English developer note for logs, never
 * user-facing text - the browser picks a localized string from `code` alone.
 */

/** Refuse a JSON body larger than this, unchanged from the design's 64 KiB. */
export const MAX_BODY_BYTES = 65536;

/**
 * Keep only plain JSON objects; arrays and scalars are not request bodies.
 * @param {unknown} value - parsed JSON value.
 * @returns {Record<string, unknown>|null} the object, or null.
 */
export function asJsonObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * Read a request body and parse it as a JSON object.
 *
 * Oversized bodies are refused without draining the stream, so a client that
 * keeps sending cannot hold the route open.
 * @param {object} request - node HTTP request.
 * @param {{maxBytes?: number, objectOnly?: boolean}} [options] - size cap and shape rule.
 * @returns {Promise<Record<string, unknown>|null>} the parsed body, or null when empty.
 * @throws {Error} with `code` 'E_BAD_REQUEST' for oversized, malformed, or wrong-shaped bodies.
 */
export function readJsonBody(request, options = {}) {
  const maxBytes = Number.isInteger(options.maxBytes) ? options.maxBytes : MAX_BODY_BYTES;
  const objectOnly = options.objectOnly !== false;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };
    request.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error(`body exceeds ${maxBytes} bytes`);
        error.code = 'E_BAD_REQUEST';
        finish(error);
        return;
      }
      chunks.push(chunk);
    });
    request.on('error', (cause) => {
      const error = new Error(cause instanceof Error ? cause.message : String(cause));
      error.code = 'E_BAD_REQUEST';
      finish(error);
    });
    request.on('end', () => {
      if (settled) return;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (raw === '') {
        finish(null, objectOnly ? null : undefined);
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const error = new Error('body is not valid JSON');
        error.code = 'E_BAD_REQUEST';
        finish(error);
        return;
      }
      if (!objectOnly) {
        finish(null, parsed);
        return;
      }
      const object = asJsonObject(parsed);
      if (object === null) {
        const error = new Error('body must be a JSON object');
        error.code = 'E_BAD_REQUEST';
        finish(error);
        return;
      }
      finish(null, object);
    });
  });
}

/**
 * Write one JSON response.
 * @param {object} response - node HTTP response.
 * @param {number} status - HTTP status code.
 * @param {unknown} body - envelope object.
 * @returns {void}
 */
export function writeJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-length', Buffer.byteLength(payload));
  response.end(payload);
}

/**
 * Success envelope.
 * @param {unknown} data - the route's payload.
 * @returns {{code: string, data: unknown, message: string}} envelope.
 */
export function ok(data) {
  return { code: 'OK', data, message: '' };
}

/**
 * Failure envelope.
 * @param {string} code - `E_*` constant.
 * @param {string} message - English developer note.
 * @returns {{code: string, data: null, message: string}} envelope.
 */
export function fail(code, message) {
  return { code, data: null, message };
}
