/**
 * Throwaway skill trees for the tests that have to touch a real filesystem.
 *
 * Every builder works under `fs.mkdtemp(os.tmpdir())` and hands the caller the
 * cleanup function, so no test can mutate the fixtures it reads: the write tests
 * always write to a copy.
 */
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The committed fixture trees. */
export const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

/** A skill file with a minimal, valid frontmatter block. */
export function skillFile({ name, description = 'A fixture skill.', extra = [], eol = '\n', bom = false, body = '# body\n' }) {
  const lines = ['---', `name: ${name}`, `description: ${description}`, ...extra, '---', ''];
  const text = `${lines.join(eol)}${body}`;
  return bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]) : Buffer.from(text, 'utf8');
}

/**
 * Create a temporary directory and its cleanup.
 * @returns {Promise<{dir: string, cleanup: () => Promise<void>}>} the directory.
 */
export async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'skc-test-'));
  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Copy a committed fixture tree into a temporary skills root.
 *
 * A symlinked fixture (`skills-symlink/dev-docs-standards -> ../target-repo`)
 * keeps its relative target, so `target-repo` is copied to the sibling position
 * the link expects.
 * @param {string} tree - fixture directory name, e.g. 'skills-plain'.
 * @returns {Promise<{dshHome: string, skillsRoot: string, cleanup: () => Promise<void>}>} the copy.
 */
export async function copyFixtureTree(tree) {
  const { dir, cleanup } = await tempDir();
  const skillsRoot = join(dir, 'skills');
  await cp(join(FIXTURES, tree), skillsRoot, { recursive: true, verbatimSymlinks: true });
  if (tree === 'skills-symlink') {
    await cp(join(FIXTURES, 'target-repo'), join(dir, 'target-repo'), { recursive: true, verbatimSymlinks: true });
  }
  return { dshHome: dir, skillsRoot, cleanup };
}

/**
 * The five real-machine samples (collected 2026-11-08) as a fixture tree: four directories plus the symlink
 * whose target lives beside the root.
 * @returns {Promise<{dshHome: string, skillsRoot: string, targetRepo: string, cleanup: () => Promise<void>}>} the tree.
 */
export async function sampleTree() {
  const { dshHome, skillsRoot, cleanup } = await copyFixtureTree('skills-plain');
  const targetRepo = join(dshHome, 'target-repo');
  await cp(join(FIXTURES, 'target-repo'), targetRepo, { recursive: true, verbatimSymlinks: true });
  await symlink('../target-repo', join(skillsRoot, 'dev-docs-standards'), 'dir');
  return { dshHome, skillsRoot, targetRepo, cleanup };
}

/**
 * Build a skills root from scratch.
 * @param {Record<string, Buffer|string>} entries - directory name → SKILL.md bytes.
 * @returns {Promise<{dshHome: string, skillsRoot: string, write: Function, cleanup: () => Promise<void>}>} the tree.
 */
export async function customTree(entries) {
  const { dir, cleanup } = await tempDir();
  const skillsRoot = join(dir, 'skills');
  await mkdir(skillsRoot, { recursive: true });
  for (const [dirName, bytes] of Object.entries(entries)) {
    const target = join(skillsRoot, dirName);
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'SKILL.md'), bytes);
  }
  return {
    dshHome: dir,
    skillsRoot,
    /**
     * Add one more skill after the tree was already read.
     * @param {string} dirName - directory name.
     * @param {Buffer|string} bytes - SKILL.md bytes.
     * @returns {Promise<void>} resolves when the file is on disk.
     */
    write: async (dirName, bytes) => {
      const target = join(skillsRoot, dirName);
      await mkdir(target, { recursive: true });
      await writeFile(join(target, 'SKILL.md'), bytes);
    },
    cleanup,
  };
}

/** Read a file's bytes, for before/after comparisons. */
export const readBytes = (file) => readFile(file);

/**
 * Whether a buffer contains a line feed that is not part of a CRLF pair.
 * @param {Buffer} bytes - buffer to inspect.
 * @returns {number} count of bare line feeds.
 */
export function countBareLf(bytes) {
  let count = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0x0a && bytes[index - 1] !== 0x0d) count += 1;
  }
  return count;
}

/**
 * Split a buffer into its lines, keeping the endings, so a diff can be position-wise.
 * @param {Buffer} bytes - buffer to split.
 * @returns {string[]} lines without endings.
 */
export function linesOf(bytes) {
  return bytes.toString('utf8').split(/\r\n|\n/);
}
