/**
 * The letter avatar: a skill's first letter on a pastel tile.
 *
 * A skill has no artwork of its own, so it gets the "app icon" treatment instead: one
 * uppercase initial, centred, on a 48px tile with a large corner radius. The colour
 * is derived from the name, which makes a row recognisable long before it is read.
 *
 * Two properties are load-bearing:
 *   1. the palette does not follow the theme. The twelve pairs below are pastel tiles
 *      with a darker letter of the same hue, and they are used verbatim in light and
 *      dark mode alike - a tile that inverted would stop being the same tile, and the
 *      look being copied keeps its pastels in both themes. The hues are quantised to
 *      30 degrees apart and every letter clears 4.5:1 against its own tile.
 *   2. the tile is a pure function of the name. FNV-1a over the name's code units
 *      (case sensitive, no clock, no randomness, no insertion order) means the same
 *      skill keeps the same colour in every session and on every machine.
 *
 * No React, no DOM: node can import this module and test it directly.
 */

/** The twelve pastel tiles, 30 degrees of hue apart. `bg` is the tile, `ink` is the letter. */
export const SKC_AVATAR_TONES = Object.freeze([
  { bg: '#FFDEDB', ink: '#BC2015' },
  { bg: '#FFF0DB', ink: '#935A10' },
  { bg: '#FDFFDB', ink: '#6C730D' },
  { bg: '#EBFFDB', ink: '#3C7A0E' },
  { bg: '#DBFFDE', ink: '#0E7C15' },
  { bg: '#DBFFF0', ink: '#0E7A4B' },
  { bg: '#DBFDFF', ink: '#0E757C' },
  { bg: '#DBEBFF', ink: '#1560C1' },
  { bg: '#DEDBFF', ink: '#2719E6' },
  { bg: '#F0DBFF', ink: '#8919DF' },
  { bg: '#FFDBFD', ink: '#AC13A2' },
  { bg: '#FFDBEB', ink: '#B8145B' },
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
