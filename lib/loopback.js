/**
 * The loopback fence every route shares.
 *
 * A request may enter the skill center only when it came from this machine. The
 * socket address is authoritative for a direct connection; a request carrying a
 * forwarding header is refused outright, because a proxy in front of the host
 * makes both the socket address and the Host header describe the proxy rather
 * than the client. `X-Forwarded-For` is therefore never evidence *for* loopback.
 */

/**
 * Whether an IPv4 dotted quad names the 127/8 range.
 * @param {string} value - four decimal octets.
 * @returns {boolean} true for 127.0.0.0/8 addresses.
 */
function isIPv4Loopback(value) {
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== '127') return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/**
 * Whether a socket remote address names the loopback range.
 * @param {string|undefined} address - socket remote address.
 * @returns {boolean} true for 127/8, ::1, and IPv4-mapped loopback.
 */
export function isLoopbackAddress(address) {
  if (typeof address !== 'string' || address === '') return false;
  const normalized = address.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized.startsWith('::ffff:')) return isIPv4Loopback(normalized.slice(7));
  return isIPv4Loopback(normalized);
}

/**
 * Whether a hostname names the loopback authority.
 * @param {string} hostname - URL hostname, brackets intact for IPv6.
 * @returns {boolean} true for localhost, [::1], and 127/8.
 */
export function isLoopbackHostname(hostname) {
  if (typeof hostname !== 'string') return false;
  if (hostname === 'localhost' || hostname === '[::1]') return true;
  return isIPv4Loopback(hostname);
}

/**
 * Whether a proxy stood between the client and this host.
 * @param {object} request - node HTTP request.
 * @returns {boolean} true when either forwarding header is present.
 */
export function isProxiedRequest(request) {
  const headers = request?.headers ?? {};
  return headers['cf-connecting-ip'] !== undefined || headers['x-forwarded-for'] !== undefined;
}

/**
 * Request-level trust fence: loopback socket, loopback Host header, no
 * forwarding header, and browser same-origin markers.
 * @param {object} request - node HTTP request.
 * @returns {boolean} true when the request may reach a skill center route.
 */
export function isLoopbackRequest(request) {
  const socket = request?.socket;
  if (!isLoopbackAddress(socket?.remoteAddress)) return false;
  if (isProxiedRequest(request)) return false;
  const headers = request.headers ?? {};
  const host = headers.host;
  if (typeof host !== 'string' || host === '') return false;
  let hostUrl;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (!isLoopbackHostname(hostUrl.hostname)) return false;
  if (headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}
