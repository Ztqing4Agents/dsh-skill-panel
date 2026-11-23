/**
 * Reading a stylesheet from a test: specificity doubling, rule blocks, and the set of
 * `skc_` classes handed to a host primitive.
 *
 * Why the reading helpers exist: rules that override a host primitive are written with the
 * class twice (`.skc_x.skc_x`, specificity 0,2,0 — docs/contracts/visual.md A.9). A test that
 * looks for the literal `.skc_x{` then only matches because the *second* half of the doubled
 * selector happens to end in that substring; add a third class or an attribute to the same
 * rule and the same test silently reads the wrong block. `flattenDoubling` collapses the
 * doubling first, so every caller expresses the thing it means ("the declarations of
 * .skc_x") instead of a string accident.
 *
 * `ruleBlocks` / `specificityOf` / `primitiveClassNames` exist for the K154 guard: a rule that
 * sizes or colours a host primitive's own element must not sit at the host's own specificity
 * — see the header note in test/styles.test.mjs.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Collapse `.skc_x.skc_x` (any number of repeats) into `.skc_x`.
 *
 * The doubling only raises specificity; values are identical by contract, so every assertion
 * about declarations can read the flattened text.
 *
 * @param {string} css - stylesheet or source text.
 * @returns {string} the same text with repeated same-class compounds collapsed.
 */
export function flattenDoubling(css) {
  return css.replace(/(\.skc_[A-Za-z0-9_]+)(?:\.\1)+/g, '$1');
}

/**
 * Split a stylesheet into `{selector, body}` pairs, descending into at-rule blocks
 * (`@media`, `@container`) so the rules inside them are returned too.
 *
 * Comments are stripped first: a brace inside a comment would otherwise move the boundaries.
 *
 * @param {string} css - stylesheet text.
 * @returns {{selector: string, body: string}[]} rules in source order.
 */
export function ruleBlocks(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const walk = (chunk) => {
    let depth = 0;
    let start = 0;
    for (let i = 0; i < chunk.length; i += 1) {
      const ch = chunk[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const block = chunk.slice(start, i);
          const brace = block.indexOf('{');
          if (brace >= 0) {
            const selector = block.slice(0, brace).trim();
            const body = block.slice(brace + 1);
            if (selector.startsWith('@')) walk(body);
            else out.push({ selector, body });
          }
          start = i + 1;
        }
      }
    }
  };
  walk(text);
  return out;
}

/**
 * Specificity `[ids, classes]` of one selector.
 *
 * Type selectors are ignored on purpose: every candidate here is beaten or not beaten by the
 * class part, and the host's rules are single-class, so `[0, 2]` is the bar.
 *
 * @param {string} selector - one selector (no top-level comma).
 * @returns {[number, number]} `[ids, classes]` where classes counts classes, attributes and
 *   pseudo-classes.
 */
export function specificityOf(selector) {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+/g) ?? []).length
    + (selector.match(/\[[^\]]*\]/g) ?? []).length
    + (selector.match(/:(?!:)[\w-]+/g) ?? []).length;
  return [ids, classes];
}

/**
 * The simple selectors a rule's every selector-list member ends in, with pseudo parts removed.
 *
 * `body` is what a declaration block is attached to, and only the *last* compound decides
 * whether our class sits on the host's element (`.skc_scope input::after` styles an input
 * inside our class, not our class's own element).
 *
 * @param {string} selectorList - a rule prelude, possibly comma separated.
 * @returns {string[]} one trimmed compound per selector-list member.
 */
export function subjectCompounds(selectorList) {
  return selectorList
    .split(',')
    .map((one) => one.trim().split(/\s+/).at(-1) ?? '')
    .map((compound) => compound.replace(/(::?[A-Za-z-]+(\([^)]*\))?)+$/, ''));
}

/**
 * The `skc_` classes handed to a host primitive in `src/client/*.jsx`.
 *
 * Derivation, not a hand-kept list: an opening tag whose name was imported from
 * `@deepseek-ai/dsh-client-ui-primitives`, plus the string literals inside its own
 * `className={cn(...)}` (or a literal `className="…"`). The tag body is walked with brace and
 * quote tracking so `=>` and nested JSX (`anchor={(<Button className={...}/>)}`) do not end
 * the tag early; only the attribute at brace depth 0 is read, so a child element's class is
 * not attributed to its parent (the first version of this scan did exactly that).
 *
 * @param {string} dir - directory to scan (normally `src/client`).
 * @returns {string[]} sorted class names, `skc_` prefix included.
 */
export function primitiveClassNames(dir) {
  const findTagEnd = (text, from) => {
    let depth = 0;
    let quote = null;
    for (let i = from; i < text.length; i += 1) {
      const ch = text[i];
      if (quote !== null) {
        if (ch === quote && text[i - 1] !== '\\') quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) return i;
    }
    return -1;
  };

  const ownClassName = (text, from, to) => {
    let depth = 0;
    let quote = null;
    for (let i = from; i < to; i += 1) {
      const ch = text[i];
      if (quote !== null) {
        if (ch === quote && text[i - 1] !== '\\') quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '{') { depth += 1; continue; }
      if (ch === '}') { depth -= 1; continue; }
      if (depth !== 0 || !text.startsWith('className=', i)) continue;
      const valueAt = i + 'className='.length;
      if (text[valueAt] === '"') return { kind: 'literal', text: text.slice(valueAt + 1, text.indexOf('"', valueAt + 1)) };
      if (text[valueAt] !== '{') return null;
      let braces = 0;
      let innerQuote = null;
      for (let k = valueAt; k < to; k += 1) {
        const c = text[k];
        if (innerQuote !== null) {
          if (c === innerQuote && text[k - 1] !== '\\') innerQuote = null;
          continue;
        }
        if (c === '"' || c === "'" || c === '`') { innerQuote = c; continue; }
        if (c === '{') braces += 1;
        else if (c === '}') {
          braces -= 1;
          if (braces === 0) return { kind: 'expression', text: text.slice(valueAt + 1, k) };
        }
      }
      return null;
    }
    return null;
  };

  const found = new Set();
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.jsx'))) {
    const text = readFileSync(join(dir, file), 'utf8');
    const imported = [...text.matchAll(/import\s*\{([^{}]*)\}\s*from\s*'@deepseek-ai\/dsh-client-ui-primitives'/g)]
      .flatMap((match) => match[1].split(',').map((part) => part.trim().split(/\s+as\s+/).pop()).filter(Boolean));
    if (imported.length === 0) continue;
    const tag = new RegExp(`<(${imported.join('|')})(?=[\\s/>])`, 'g');
    for (const match of text.matchAll(tag)) {
      const start = match.index;
      const end = findTagEnd(text, start + match[0].length);
      if (end < 0) continue;
      const value = ownClassName(text, start + match[0].length, end);
      if (value === null) continue;
      // A literal attribute (`className="skc_x"`) is the whole list; an expression is searched
      // for its string literals only, so a pass-through `className={className}` contributes
      // nothing (an earlier version invented a class named `skc_className`).
      const names = value.kind === 'literal'
        ? value.text.split(/\s+/)
        : [...value.text.matchAll(/'([^']*)'|"([^"]*)"/g)].map((literal) => literal[1] ?? literal[2]).flatMap((one) => one.split(/\s+/));
      for (const name of names) if (name !== '' && /^[A-Za-z][\w-]*$/.test(name)) found.add(`skc_${name}`);
    }
  }
  return [...found].sort();
}
