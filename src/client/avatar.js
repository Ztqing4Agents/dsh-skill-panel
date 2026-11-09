/**
 * The letter avatar: a skill's first letter on a tinted tile, aligned with skillhub.cn.
 *
 * A skill has no artwork of its own, so it gets the "app icon" treatment instead: one
 * uppercase initial, centred, on the host's 48px tile. The colour is derived from the
 * name, which makes a row recognisable long before it is read.
 *
 * Three properties are load-bearing:
 *   1. the six pairs below are transcribed value-for-value from the tiles skillhub.cn
 *      draws for entries without an icon (measured off the live site: six pairs across
 *      hundreds of rows, no seventh appeared in 25 screens of scrolling). Each tile is
 *      its accent colour at 10-12% alpha with the accent itself as the letter - except
 *      the sky pair, whose 12% bed is deliberately not the letter's value. They are used
 *      verbatim and never follow the theme.
 *   2. contrast is a deliberate trade: these letters sit at roughly 2-3:1 against their
 *      own tile, below the 4.5:1 the previous twelve-tone pastel palette held. That is
 *      the point of this change - matching the site the user compares us against - so the
 *      old rule was retired rather than satisfied (see `docs/contracts/decisions.md`
 *      appendix H).
 *   3. the tile is a pure function of the name. FNV-1a over the name's code units
 *      (case sensitive, no clock, no randomness, no insertion order) means the same
 *      skill keeps the same colour in every session and on every machine.
 *
 * No React, no DOM: node can import this module and test it directly.
 */

/**
 * The six tiles, copied from skillhub.cn. `bg` is the tile (10-12% accent), `ink` the letter.
 * The sky pair is the one whose bed and letter are not the same value: that is what the
 * site does, so that is what we do.
 */
export const SKC_AVATAR_TONES = Object.freeze([
  { bg: 'rgba(255, 45, 85, .1)', ink: '#FF2D55' },
  { bg: 'rgba(255, 149, 0, .1)', ink: '#FF9500' },
  { bg: 'rgba(90, 200, 250, .12)', ink: '#32ADE6' },
  { bg: 'rgba(175, 82, 222, .1)', ink: '#AF52DE' },
  { bg: 'rgba(52, 199, 89, .1)', ink: '#34C759' },
  { bg: 'rgba(0, 122, 255, .1)', ink: '#007AFF' },
]);

/** FNV-1a 32-bit offset basis. */
const FNV_OFFSET_BASIS = 0x811c9dc5;

/** FNV-1a 32-bit prime. */
const FNV_PRIME = 0x01000193;

/** The letter a name is not expected to yield, used for empty and non-string names. */
const FALLBACK_LETTER = '#';

/**
 * FNV-1a over the UTF-16 code units of a string, as an unsigned 32-bit integer.
 *
 * `Math.imul` keeps the 32-bit multiply exact (a plain `*` would overflow into a
 * float and drop the low bits the hash depends on).
 * @param {string} text - the skill name.
 * @returns {number} an integer in [0, 2^32).
 */
function hashName(text) {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * The letter drawn on the tile: the first letter or digit of the name, uppercased.
 *
 * A Chinese or other non-Latin name yields its first character; a name that starts
 * with punctuation falls back to that punctuation rather than to `#`, so something
 * from the name is always shown.
 * @param {string} name - the skill name.
 * @returns {string} one character, uppercased.
 */
function initialOf(name) {
  if (typeof name !== 'string') return FALLBACK_LETTER;
  const letter = /[\p{L}\p{N}]/u.exec(name);
  if (letter !== null) return letter[0].toUpperCase();
  const other = /\S/u.exec(name);
  if (other !== null) return other[0].toUpperCase();
  return FALLBACK_LETTER;
}

/**
 * The avatar of one skill: its letter plus the tile colours that carry it.
 * @param {string} name - the skill name, as listed in the panel.
 * @returns {{letter: string, bg: string, ink: string}} the letter and its tile colours.
 */
export function avatarOf(name) {
  const index = hashName(typeof name === 'string' ? name : '') % SKC_AVATAR_TONES.length;
  const tone = SKC_AVATAR_TONES[index];
  return { letter: initialOf(name), bg: tone.bg, ink: tone.ink };
}
