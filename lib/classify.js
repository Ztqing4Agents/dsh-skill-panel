/**
 * The pure core: precedence rank, the nine-step partition ladder, and the merge
 * that decides which of two same-named skills the panel shows.
 *
 * Order matters and is the only self-consistent one: decide first, classify
 * second. Classifying before the rank arbitration would let a skill the model
 * never receives be displayed in a partition of its own.
 *
 * Nothing here touches the filesystem, the clock, or the environment.
 */
import { identityKey, isWithin } from './names.js';

/**
 * The nine steps of the ladder, first hit wins.
 * R1 non-filesystem provider, R2 filesystem at bundled rank, R3 a root this
 * version does not list, R4 symlink, R5 ledger, R6 metadata source, R7 metadata
 * release, R8 directory-name structure, R9 everything else.
 */
const EXCLUDED_RANKS = new Set([100, 200, 300, 500]);

/** Directory names that carry install provenance: `<handle>--<slug>`. */
const PREFIXED_DIR = /^[a-z0-9][a-z0-9-]*--[a-z0-9][a-z0-9-]*$/;

/** Partition keys, in the order the page renders them. */
const PARTITIONS = ['builtin', 'local', 'installed'];

/**
 * @typedef {Object} ClassifyInput
 * @property {string} provider       where the skill came from ('filesystem' for a directory scan)
 * @property {number} rank           precedence rank, reconstructed for registry rows
 * @property {boolean} symlink       lstat().isSymbolicLink() on the directory entry
 * @property {boolean} ledgerHit     any install ledger names this skill
 * @property {boolean} metaSource    `_skillhub_meta.json` or `_meta.json` carries a source
 * @property {boolean} metaRelease   `_meta.json` carries ownerId + slug
 * @property {string} [dirName]      directory entry name
 * @property {string} [declaredName] frontmatter name
 */

/**
 * @typedef {Object} Classification
 * @property {'builtin'|'local'|'installed'|'excluded'} partition
 * @property {'R1'|'R2'|'R3'|'R4'|'R5'|'R6'|'R7'|'R8'|'R9'} rule
 * @property {'high'|'medium'} confidence
 * @property {string} evidence tooltip key, e.g. 'evidence.metaRelease'
 */

/**
 * Precedence rank for a filesystem root level.
 * @param {string} level - root level or the runtime pseudo-level.
 * @returns {number} the rank; unknown levels fall back to 600 rather than Infinity.
 */
export function rankOf(level) {
  switch (level) {
    case 'project-dsh': return 100;
    case 'project-agents': return 200;
    case 'runtime': return 250;
    case 'custom': return 300;
    case 'user-dsh': return 400;
    case 'user-agents': return 500;
    case 'bundled': return 600;
    default: return 600;
  }
}

/**
 * Classify one skill against the nine-step ladder.
 * @param {ClassifyInput} input - facts about one candidate.
 * @returns {Classification} partition, the rule that decided it, confidence, and evidence key.
 */
export function classifySkill(input) {
  const provider = typeof input.provider === 'string' ? input.provider : '';
  const rank = typeof input.rank === 'number' ? input.rank : 600;
  if (provider !== 'filesystem') return { partition: 'builtin', rule: 'R1', confidence: 'high', evidence: 'evidence.builtinProvider' };
  if (rank === 600) return { partition: 'builtin', rule: 'R2', confidence: 'high', evidence: 'evidence.builtinRank' };
  if (EXCLUDED_RANKS.has(rank)) return { partition: 'excluded', rule: 'R3', confidence: 'high', evidence: 'evidence.otherRoot' };
  if (input.symlink === true) return { partition: 'local', rule: 'R4', confidence: 'high', evidence: 'evidence.symlink' };
  if (input.ledgerHit === true) return { partition: 'installed', rule: 'R5', confidence: 'high', evidence: 'evidence.ledger' };
  if (input.metaSource === true) return { partition: 'installed', rule: 'R6', confidence: 'high', evidence: 'evidence.metaSource' };
  if (input.metaRelease === true) return { partition: 'installed', rule: 'R7', confidence: 'high', evidence: 'evidence.metaRelease' };
  const dirName = typeof input.dirName === 'string' ? input.dirName : '';
  const declaredName = typeof input.declaredName === 'string' ? input.declaredName : '';
  if (PREFIXED_DIR.test(dirName) && dirName.slice(dirName.indexOf('--') + 2) === declaredName) {
    return { partition: 'installed', rule: 'R8', confidence: 'medium', evidence: 'evidence.dirName' };
  }
  return { partition: 'local', rule: 'R9', confidence: 'high', evidence: 'evidence.fallback' };
}

/**
 * Compare two strings by code point, matching the registry's ordering.
 * @param {string} left - first string.
 * @param {string} right - second string.
 * @returns {number} negative, zero, or positive.
 */
function compareCodePoints(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Turn classified rows into the three ordered partitions.
 * @param {object[]} rows - rows carrying `partition` and `name`.
 * @returns {{key: string, skills: object[]}[]} the three partitions, each name-sorted.
 */
export function buildGroups(rows) {
  return PARTITIONS.map((key) => ({
    key,
    skills: rows.filter((row) => row.partition === key).sort((left, right) => compareCodePoints(left.name, right.name)),
  }));
}

/**
 * @typedef {Object} MergeInput
 * @property {object[]} scanned     directory scan candidates (rank is always 400)
 * @property {object[]} registry    registry summaries annotated with rank
 * @property {{entries: Set<string>, sources?: string[], diagnostics?: string[]}} ledger
 * @property {Set<string>} [providerDisabled] identities disabled in the panel-owned store
 * @property {string} skillsRoot    directory a file write must stay inside
 * @property {string[]} [diagnostics] notes collected before the merge
 */

/**
 * Merge the directory scan with the registry, arbitrate same-name collisions, and
 * classify the winners into the three partitions.
 *
 * Same-name arbitration: the smallest rank wins, because the panel must show the
 * skill the model actually receives; on a tie the scanned entry wins, because it
 * carries the symlink and path facts the panel needs to offer a switch.
 * @param {MergeInput} input - the three fact sources.
 * @returns {{groups: {key: string, skills: object[]}[], excluded: number, diagnostics: string[]}} the catalogue.
 */
export function mergeCatalog(input) {
  const scanned = Array.isArray(input.scanned) ? input.scanned : [];
  const registry = Array.isArray(input.registry) ? input.registry : [];
  const ledgerEntries = input.ledger?.entries instanceof Set ? input.ledger.entries : new Set();
  const providerDisabled = input.providerDisabled instanceof Set ? input.providerDisabled : new Set();
  const skillsRoot = typeof input.skillsRoot === 'string' ? input.skillsRoot : '';
  const diagnostics = [...(input.ledger?.diagnostics ?? []), ...(input.diagnostics ?? [])];
  const candidates = new Map();
  const add = (candidate) => {
    const bucket = candidates.get(candidate.name);
    if (bucket === undefined) candidates.set(candidate.name, [candidate]);
    else bucket.push(candidate);
  };
  for (const scan of scanned) {
    add({
      name: scan.declaredName,
      rank: rankOf('user-dsh'),
      provider: 'filesystem',
      origin: 'scan',
      scan,
    });
  }
  for (const summary of registry) {
    add({
      name: summary.name,
      rank: typeof summary.rank === 'number' ? summary.rank : rankOf('bundled'),
      provider: typeof summary.provider === 'string' ? summary.provider : '',
      origin: 'registry',
      summary,
    });
  }
  const rows = [];
  let excluded = 0;
  for (const [name, bucket] of candidates) {
    const winner = bucket.reduce((best, candidate) => {
      if (candidate.rank !== best.rank) return candidate.rank < best.rank ? candidate : best;
      if (candidate.origin === 'scan' && best.origin !== 'scan') return candidate;
      return best;
    }, bucket[0]);
    const scan = winner.scan;
    const summary = winner.summary;
    const classification = classifySkill({
      provider: winner.provider,
      rank: winner.rank,
      symlink: scan?.symlink === true,
      ledgerHit: ledgerEntries.has(name) || (scan !== undefined && ledgerEntries.has(scan.dirName)),
      metaSource: scan?.metaSource === true,
      metaRelease: scan?.metaRelease === true,
      dirName: scan?.dirName ?? '',
      declaredName: scan?.declaredName ?? name,
    });
    if (classification.partition === 'excluded') {
      excluded += 1;
      continue;
    }
    rows.push(buildRow({ name, winner, scan, summary, classification, skillsRoot, providerDisabled }));
  }
  return { groups: buildGroups(rows), excluded, diagnostics };
}

/**
 * Build one display row from an arbitrated winner.
 * @param {object} facts - winner, its scan/summary form, classification, and panel state.
 * @returns {object} the row contract the browser renders.
 */
function buildRow(facts) {
  const { name, winner, scan, summary, classification, skillsRoot, providerDisabled } = facts;
  const symlink = scan?.symlink === true;
  const provider = winner.provider;
  const filePath = symlink ? null : (scan?.instructionPath ?? (typeof summary?.path === 'string' ? summary.path : null));
  const fileWritable = !symlink
    && typeof filePath === 'string'
    && filePath !== ''
    && skillsRoot !== ''
    && isWithin(skillsRoot, filePath);
  let readonlyReason = null;
  if (symlink) readonlyReason = 'symlink';
  else if (classification.partition === 'builtin') readonlyReason = 'provider-store';
  else if (!fileWritable) readonlyReason = 'no-file';
  const storeDisabled = providerDisabled.has(identityKey(provider, name));
  const invocationDisabled = summary?.invocation?.modelInvocable === false;
  const enabled = classification.partition === 'builtin'
    ? !storeDisabled && !invocationDisabled
    : scan?.disableModelInvocation !== true;
  const description = scan?.description ?? (typeof summary?.description === 'string' ? summary.description : '');
  const displayName = scan?.displayName !== undefined && scan.displayName !== '' ? scan.displayName : null;
  return {
    name,
    description,
    displayName,
    provider,
    partition: classification.partition,
    rule: classification.rule,
    confidence: classification.confidence,
    evidence: classification.evidence,
    symlink,
    path: classification.partition === 'builtin' ? null : filePath,
    realPath: symlink ? (scan?.realPath ?? null) : null,
    enabled,
    writable: readonlyReason === null,
    readonlyReason,
    // Display data, not a decision: a row won by the registry has no scan (and so no
    // `_meta.json`), which is exactly why it is null there.
    upstream: scan?.upstream ?? null,
  };
}
