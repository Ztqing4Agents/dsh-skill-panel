/**
 * Byte-faithful frontmatter surgery.
 *
 * Rewriting `disable-model-invocation` must not touch a single other byte: no
 * YAML round-trip, no line-ending normalization, no BOM loss. A real skill on
 * this machine (`indiv-guipi--find-skills/SKILL.md`) is CRLF, so a line-oriented
 * string rewrite that rejoins with '\n' would corrupt it.
 *
 * Everything here is a pure function over bytes or strings: no I/O, no clock.
 */

/** UTF-8 byte order mark. */
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** The one field this panel writes. */
const FIELD = 'disable-model-invocation';

/** A frontmatter fence. */
const FENCE = '---';

/** The alternative frontmatter terminator. */
const FENCE_ALT = '...';

/**
 * Whether a string names this module's "no frontmatter" failure.
 * @param {unknown} error - thrown value.
 * @returns {boolean} true when the error carries code NO_FRONTMATTER.
 */
export function isNoFrontmatterError(error) {
  return Boolean(error && typeof error === 'object' && error.code === 'NO_FRONTMATTER');
}

/**
 * Build the module's "no frontmatter" error.
 * @param {string} detail - what was wrong.
 * @returns {Error} an error carrying code NO_FRONTMATTER.
 */
function noFrontmatter(detail) {
  const error = new Error(detail);
  error.code = 'NO_FRONTMATTER';
  return error;
}

/**
 * Read a YAML-ish scalar: strip a trailing `#` comment and one layer of quotes.
 * @param {string} raw - text after the colon.
 * @returns {string} the scalar value.
 */
function scalarOf(raw) {
  const text = raw.replace(/\s+#.*$/, '').trim();
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return text.slice(1, -1);
  }
  return text;
}

/**
 * Parse a frontmatter boolean using the spellings the host accepts.
 * @param {string} raw - scalar text.
 * @returns {boolean|undefined} parsed value, or undefined when not a boolean.
 */
function booleanOf(raw) {
  const text = scalarOf(raw).toLowerCase();
  if (text === 'true' || text === 'yes' || text === 'on' || text === '1') return true;
  if (text === 'false' || text === 'no' || text === 'off' || text === '0') return false;
  return undefined;
}

/** A block scalar indicator: `|` or `>`, an optional chomping sign, an optional indent digit. */
const BLOCK_INDICATOR = /^[ \t]*([|>])([+-]?)(\d?)[ \t]*(?:#.*)?$/;

/**
 * Collect the lines that belong to a block scalar body.
 *
 * The body runs until a line that is neither blank nor indented: a sibling key or
 * the closing fence. Blank lines inside the body belong to the scalar, because the
 * chomping indicator decides what happens to them.
 * @param {string[]} lines - the block's lines, endings removed.
 * @param {number} start - index of the first line after the key line.
 * @returns {{body: string[], lastIndex: number}} body lines and the last consumed index.
 */
function readBlockBody(lines, start) {
  const body = [];
  let index = start;
  while (index < lines.length) {
    const raw = lines[index];
    if (raw.trim() === '') {
      body.push('');
      index += 1;
      continue;
    }
    if (!/^[ \t]/.test(raw)) break;
    body.push(raw);
    index += 1;
  }
  return { body, lastIndex: index - 1 };
}

/**
 * Count the indentation of one non-blank line.
 * @param {string} raw - source line.
 * @returns {number} leading whitespace width.
 */
function indentOf(raw) {
  return raw.length - raw.trimStart().length;
}

/**
 * Fold the content lines of a `>` scalar.
 *
 * A single break between two lines at the content indent becomes a space; n blank
 * lines become n-1 newlines. A line indented deeper than the content keeps its own
 * break, which is the one rule that makes inline lists and code survive.
 * @param {string[]} core - content lines; an empty string stands for a blank line.
 * @param {number} indent - the scalar's content indentation.
 * @returns {string} the folded text, without trailing breaks.
 */
function foldLines(core, indent) {
  let out = '';
  let blanks = 0;
  let started = false;
  let previousDeeper = false;
  for (const raw of core) {
    if (raw === '') {
      blanks += 1;
      continue;
    }
    const text = raw.slice(indent);
    const deeper = indentOf(raw) > indent;
    if (!started) {
      out = text;
      started = true;
    } else {
      const breaks = blanks + 1;
      if (deeper || previousDeeper) out += '\n'.repeat(breaks);
      else out += breaks === 1 ? ' ' : '\n'.repeat(breaks - 1);
      out += text;
    }
    previousDeeper = deeper;
    blanks = 0;
  }
  return out;
}

/**
 * Resolve a block scalar body into its string value.
 * @param {string[]} body - collected body lines; '' stands for a blank line.
 * @param {'|'|'>'} style - literal or folded.
 * @param {'+'|'-'|''} chomp - keep, strip, or clip.
 * @returns {string} the scalar value, trailing breaks per the chomping indicator.
 */
function blockScalarValue(body, style, chomp) {
  const content = body.filter((line) => line !== '');
  if (content.length === 0) return '';
  const indent = Math.min(...content.map(indentOf));
  let trailing = 0;
  for (let index = body.length - 1; index >= 0 && body[index] === ''; index -= 1) trailing += 1;
  const core = body.slice(0, body.length - trailing);
  const text = style === '|'
    ? core.map((line) => (line === '' ? '' : line.slice(indent))).join('\n')
    : foldLines(core, indent);
  if (chomp === '-') return text;
  if (chomp === '+') return `${text}${'\n'.repeat(trailing + 1)}`;
  return `${text}\n`;
}

/**
 * Locate the frontmatter block in a text.
 * @param {string} text - whole file text, BOM allowed.
 * @returns {{lines: string[], eol: string, closeStart: number, closeEnd: number, bodyStart: number}|null}
 *   block facts, or null when the text does not open with a closed frontmatter block.
 */
function locateBlock(text) {
  const offset = text.startsWith('\ufeff') ? 1 : 0;
  const opening = text.slice(offset);
  if (!opening.startsWith(`${FENCE}\n`) && !opening.startsWith(`${FENCE}\r\n`)) return null;
  const firstBreak = opening.indexOf('\n');
  const eol = firstBreak > 0 && opening[firstBreak - 1] === '\r' ? '\r\n' : '\n';
  const lines = [];
  let cursor = firstBreak + 1;
  while (cursor <= opening.length) {
    const breakAt = opening.indexOf('\n', cursor);
    const lineEnd = breakAt === -1 ? opening.length : breakAt;
    const line = opening.slice(cursor, lineEnd);
    const bare = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (bare === FENCE || bare === FENCE_ALT) {
      const closeStart = offset + cursor;
      const closeEnd = breakAt === -1 ? offset + opening.length : offset + breakAt + 1;
      return { lines, eol, closeStart, closeEnd, bodyStart: offset + firstBreak + 1 };
    }
    lines.push(bare);
    if (breakAt === -1) return null;
    cursor = breakAt + 1;
  }
  return null;
}

/**
 * Parse the frontmatter fields this panel reads.
 * @param {string} text - whole file text.
 * @returns {{name?: string, description?: string, displayName?: string, disableModelInvocation: boolean, present: boolean}}
 *   the fields this panel uses, plus whether a closed block was found.
 */
export function parseFrontmatter(text) {
  const result = { disableModelInvocation: false, present: false };
  if (typeof text !== 'string') return result;
  const block = locateBlock(text);
  if (block === null) return result;
  for (let index = 0; index < block.lines.length; index += 1) {
    const line = block.lines[index];
    const match = /^([A-Za-z][A-Za-z0-9_-]*)[ \t]*:(.*)$/.exec(line);
    if (match === null) continue;
    const key = match[1];
    const raw = match[2];
    if (key !== 'name' && key !== 'description' && key !== 'display-name' && key !== FIELD) continue;
    const indicator = BLOCK_INDICATOR.exec(raw);
    let value;
    if (indicator !== null) {
      const { body, lastIndex } = readBlockBody(block.lines, index + 1);
      value = blockScalarValue(body, indicator[1], indicator[2]);
      index = lastIndex;
    } else {
      value = scalarOf(raw);
    }
    if (key === 'name') result.name = value;
    else if (key === 'description') result.description = value;
    else if (key === 'display-name') result.displayName = value;
    else result.disableModelInvocation = typeof value === 'string' && booleanOf(value) === true;
  }
  result.present = true;
  return result;
}

/**
 * Drop the frontmatter block and return the body text, endings intact.
 * @param {string} text - whole file text.
 * @returns {string} the body, or the input unchanged when there is no closed block.
 */
export function stripFrontmatter(text) {
  if (typeof text !== 'string') return '';
  const block = locateBlock(text);
  if (block === null) return text;
  return text.slice(block.closeEnd);
}

/**
 * Replace the value of one line, keeping its leading whitespace, the spacing
 * before the value, and any trailing comment.
 * @param {string} line - one frontmatter line, no ending.
 * @param {string} value - new scalar text.
 * @returns {string} the rewritten line.
 */
function replaceValue(line, value) {
  const withValue = /^([ \t]*)(disable-model-invocation[ \t]*:[ \t]*)([^\s#]+)(.*)$/.exec(line);
  if (withValue !== null) return `${withValue[1]}${withValue[2]}${value}${withValue[4]}`;
  const empty = /^([ \t]*)(disable-model-invocation[ \t]*:)([ \t]*)(.*)$/.exec(line);
  if (empty !== null) return `${empty[1]}${empty[2]} ${value}${empty[4] === '' ? '' : ` ${empty[4]}`}`;
  return line;
}

/**
 * Scan a byte block into lines that remember their own ending.
 * @param {Buffer} bytes - block bytes, starting at the opening fence.
 * @returns {{end: number, eol: string, lines: {text: string, eol: string}[]}} block scan result.
 */
function scanBlock(bytes) {
  const firstBreak = bytes.indexOf(0x0a);
  if (firstBreak === -1) return { end: -1, eol: '\n', lines: [] };
  const eol = firstBreak > 0 && bytes[firstBreak - 1] === 0x0d ? '\r\n' : '\n';
  const lines = [];
  let cursor = firstBreak + 1;
  while (cursor <= bytes.length) {
    const breakAt = bytes.indexOf(0x0a, cursor);
    const lineEnd = breakAt === -1 ? bytes.length : breakAt;
    const lineBytes = bytes.subarray(cursor, lineEnd);
    const hasCr = lineBytes.length > 0 && lineBytes[lineBytes.length - 1] === 0x0d;
    const text = lineBytes.subarray(0, hasCr ? lineBytes.length - 1 : lineBytes.length).toString('utf8');
    const lineEol = breakAt === -1 ? '' : hasCr ? '\r\n' : '\n';
    lines.push({ text, eol: lineEol });
    if (text === FENCE || text === FENCE_ALT) return { end: breakAt === -1 ? bytes.length : breakAt + 1, eol, lines };
    if (breakAt === -1) break;
    cursor = breakAt + 1;
  }
  return { end: -1, eol, lines };
}

/**
 * Set `disable-model-invocation` and leave every other byte alone.
 *
 * A missing key is appended as the last line of the block, using the block's own
 * ending; an existing key keeps its prefix spacing and trailing comment. Enabling
 * writes `false` instead of deleting the key, so repeated toggles do not churn
 * the file's diff.
 * @param {Buffer} original - the whole file.
 * @param {boolean} disabled - the value to write: true for disabled.
 * @returns {{next: Buffer, changed: boolean, inserted: boolean, disableModelInvocation: boolean}} rewrite result.
 * @throws {Error} with `code` 'NO_FRONTMATTER' when the file has no closed frontmatter block.
 */
export function setDisableModelInvocation(original, disabled) {
  const bytes = Buffer.isBuffer(original) ? original : Buffer.from(original);
  const hasBom = bytes.length >= 3 && bytes.subarray(0, 3).equals(BOM);
  const body = hasBom ? bytes.subarray(3) : bytes;
  const value = disabled ? 'true' : 'false';
  if (body.length === 0) throw noFrontmatter('file is empty');
  const block = scanBlock(body);
  if (block.end === -1) throw noFrontmatter('frontmatter block is missing or not closed');
  const headEnd = body.indexOf(0x0a) + 1;
  const hit = block.lines.findIndex((line) => /^disable-model-invocation[ \t]*:/.test(line.text));
  const nextLines = block.lines.map((line) => ({ text: line.text, eol: line.eol }));
  let inserted = false;
  if (hit >= 0) {
    nextLines[hit] = { text: replaceValue(nextLines[hit].text, value), eol: nextLines[hit].eol };
  } else {
    inserted = true;
    nextLines.splice(nextLines.length - 1, 0, { text: `${FIELD}: ${value}`, eol: block.eol });
  }
  const changed = inserted || nextLines.some((line, index) => line.text !== block.lines[index].text);
  const rebuilt = Buffer.from(
    nextLines.map((line) => `${line.text}${line.eol}`).join(''),
    'utf8',
  );
  const next = Buffer.concat([
    hasBom ? BOM : Buffer.alloc(0),
    body.subarray(0, headEnd),
    rebuilt,
    body.subarray(block.end),
  ]);
  return { next, changed, inserted, disableModelInvocation: disabled };
}
