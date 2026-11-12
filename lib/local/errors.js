/**
 * The local write face's error vocabulary: the four codes that describe adding a
 * directory to the skills root and deleting one from it.
 *
 * Those four are registered here and nowhere else. `lib/market/errors.js` stays at
 * exactly twenty codes, because that table is read as "one row per market code" by
 * both the contract and the gate; a fifth kind of failure living inside it would
 * change a count the market face is pinned on. Codes the two faces share
 * (`E_BAD_REQUEST`, `E_BAD_NAME`, `E_BAD_PATH`, `E_NOT_FOUND`, `E_NOT_WRITABLE`,
 * `E_SYMLINK_READONLY`, `E_STALE_PATH`, `E_ALREADY_INSTALLED`, `E_SKILL_NAME_INVALID`,
 * `E_PACKAGE_INVALID`, `E_INSTALL_BUSY`, `E_INSTALL_IO`, `E_INTERNAL`) keep the status
 * they already have.
 *
 * `MARKET_STATUS` and `FACE_STATUS` are consulted before falling back to
 * `E_INTERNAL`: those codes are reused on purpose (routes.md 8.1), and turning a
 * reused `409 E_STALE_PATH` into a `500 E_INTERNAL` would hide which disk state the
 * user is in.
 */
import { MARKET_STATUS } from '../market/errors.js';

/**
 * The four codes this face introduces, each pinned to one HTTP status.
 *
 * The delete codes stay apart from the add codes because the browser shows a
 * different sentence and a different retry for each: "that path does not exist"
 * is a typo the user can fix in the field, "a skill shipped under this name" is a
 * verdict about the machine, and a delete that failed on disk needs a refresh.
 * @type {Readonly<Record<string, number>>}
 */
export const LOCAL_STATUS = {
  E_ADD_NOT_FOUND: 404,
  E_ADD_NOT_SKILL_DIR: 422,
  E_ADD_SHADOWED: 409,
  E_DELETE_IO: 500,
};

/**
 * Statuses for the barrier codes the local face reuses from the installed tab.
 *
 * Kept out of `LOCAL_STATUS` on purpose: that object is the record of the four new
 * codes, and this table is the read-only half of "which status does a reused code
 * have". The values match `docs/contracts/routes.md` 8.1.
 */
const FACE_STATUS = {
  E_BAD_REQUEST: 400,
  E_BAD_PATH: 400,
  E_BAD_NAME: 400,
  E_NOT_FOUND: 404,
  E_SYMLINK_READONLY: 409,
  E_NOT_WRITABLE: 409,
  E_STALE_PATH: 409,
  E_INTERNAL: 500,
};

/**
 * An error that already knows its route code.
 */
export class LocalError extends Error {
  /**
   * @param {string} code - one of LOCAL_STATUS' keys, or a reused face code.
   * @param {string} message - English developer note, never user-facing text.
   * @param {Record<string, unknown>|null} [detail] - optional payload for the browser.
   */
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'LocalError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Build a local error.
 * @param {string} code - one of LOCAL_STATUS' keys, or a reused face code.
 * @param {string} message - English developer note.
 * @param {Record<string, unknown>|null} [detail] - optional payload for the browser.
 * @returns {LocalError} the error.
 */
export function localError(code, message, detail = null) {
  return new LocalError(code, message, detail);
}

/**
 * Whether a code is one this face knows how to answer.
 * @param {string} code - candidate code.
 * @returns {boolean} true when LOCAL_STATUS, MARKET_STATUS or FACE_STATUS carries it.
 */
function isKnownCode(code) {
  return Object.hasOwn(LOCAL_STATUS, code)
    || Object.hasOwn(MARKET_STATUS, code)
    || Object.hasOwn(FACE_STATUS, code);
}

/**
 * Coerce anything thrown into a local failure description.
 *
 * A system error that happens to carry a known `E_*` code keeps it; everything else
 * becomes `E_INTERNAL`, so a route never leaks a stray `ENOENT` to the browser.
 * @param {unknown} value - whatever was thrown.
 * @returns {{code: string, message: string, detail: object|null, status: number}} the failure.
 */
export function asLocalError(value) {
  const message = value instanceof Error ? value.message : String(value);
  const raw = typeof value?.code === 'string' ? value.code : '';
  const code = isKnownCode(raw) ? raw : 'E_INTERNAL';
  const status = LOCAL_STATUS[code] ?? MARKET_STATUS[code] ?? FACE_STATUS[code] ?? 500;
  const detail = typeof value?.detail === 'object' && value.detail !== null ? value.detail : null;
  return { code, message, detail, status };
}
