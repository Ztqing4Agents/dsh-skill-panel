/**
 * The market error vocabulary.
 *
 * One `E_*` code per failure the market routes can report, each pinned to one HTTP
 * status so the route layer never has to guess. Codes that describe the upstream
 * (unavailable / timed out / unreadable answer) are kept apart from codes that
 * describe the package (invalid / checksum mismatch) because the browser shows a
 * different sentence and offers a different retry for each.
 *
 * A failure may carry a small `detail` object: the market routes are the only
 * routes in this plugin that put anything other than `null` in `data` on failure,
 * because the browser needs the existing path or the declared name to explain
 * itself. See docs/contracts/routes.md section 8.6.
 *
 * The three update codes are a partition of the outcomes that happen *after* the
 * skill directory has been touched: restored (the old version is whole again),
 * lost (the directory is gone and the old version waits in a backup) and
 * unconfirmed (the new version landed and read back, the ledger did not). A failure
 * before that point reports `E_INSTALL_IO` or an upstream code - reporting
 * `E_INSTALL_IO` for "already rolled back" would hide which disk state the user has.
 */

/** HTTP status for every market error code. */
export const MARKET_STATUS = {
  E_BAD_QUERY: 400,
  E_BAD_REQUEST: 400,
  E_SOURCE_UNKNOWN: 400,
  E_ALREADY_INSTALLED: 409,
  E_SKILL_NAME_INVALID: 422,
  E_PACKAGE_INVALID: 422,
  E_DOWNLOAD_FAILED: 502,
  E_SOURCE_BAD_RESPONSE: 502,
  E_SOURCE_UNAVAILABLE: 503,
  E_SOURCE_TIMEOUT: 504,
  E_INSTALL_BUSY: 429,
  E_INSTALL_IO: 500,
  E_NOT_MARKET_INSTALLED: 409,
  E_ALREADY_UP_TO_DATE: 409,
  E_UPDATE_RESTORED: 500,
  E_UPDATE_LOST: 500,
  E_UPDATE_UNCONFIRMED: 500,
  E_FAVORITE_FULL: 409,
  E_FAVORITE_IO: 500,
  E_INTERNAL: 500,
};

/**
 * An error that already knows its route code.
 */
export class MarketError extends Error {
  /**
   * @param {string} code - one of MARKET_STATUS' keys.
   * @param {string} message - English developer note, never user-facing text.
   * @param {Record<string, unknown>|null} [detail] - optional payload for the browser.
   */
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'MarketError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Build a market error.
 * @param {string} code - one of MARKET_STATUS' keys.
 * @param {string} message - English developer note.
 * @param {Record<string, unknown>|null} [detail] - optional payload for the browser.
 * @returns {MarketError} the error.
 */
export function marketError(code, message, detail = null) {
  return new MarketError(code, message, detail);
}

/**
 * Whether a value is already a market error.
 * @param {unknown} value - candidate.
 * @returns {boolean} true for a MarketError.
 */
export function isMarketError(value) {
  return value instanceof MarketError;
}

/**
 * Coerce anything thrown into a market error.
 *
 * A system error that happens to carry a known `E_*` code keeps it; everything else
 * becomes `E_INTERNAL`, so a route never leaks a stray `ENOENT` to the browser.
 * @param {unknown} value - whatever was thrown.
 * @returns {MarketError} the coerced error.
 */
export function asMarketError(value) {
  if (value instanceof MarketError) return value;
  const message = value instanceof Error ? value.message : String(value);
  const code = typeof value?.code === 'string' && Object.hasOwn(MARKET_STATUS, value.code) ? value.code : 'E_INTERNAL';
  const detail = typeof value?.detail === 'object' && value.detail !== null ? value.detail : null;
  return new MarketError(code, message, detail);
}

/**
 * HTTP status for whatever was thrown.
 * @param {unknown} value - whatever was thrown.
 * @returns {number} the status to send.
 */
export function statusOfMarketError(value) {
  return MARKET_STATUS[asMarketError(value).code] ?? 500;
}
