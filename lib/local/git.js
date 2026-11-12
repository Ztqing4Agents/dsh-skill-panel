/**
 * The one module that starts a process: a shallow, single-branch clone of a public
 * GitHub repository, and the two `rev-parse` reads that say what landed.
 *
 * Three rules shape it:
 *
 * - **Nothing interactive can happen.** The child process gets a hand-built
 *   environment (no inherited secrets), every prompt is disabled, the credential
 *   helper is emptied, stdin is closed, and the call is killed after a minute. A
 *   clone that would wait for a password must fail instead of hanging a route.
 * - **Nothing it prints leaves this module.** Git writes remote-controlled text to
 *   stderr (branch names, host answers); the caller gets a code, never that text. The
 *   raw output is classified here and discarded.
 * - **Only https.** The URL is rebuilt from the owner and repository name, so no
 *   scheme, credential or host from the input can reach the command line.
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

/** Prefix of the temp clone directory; the dot keeps the scanner away from it. */
export const CLONE_PREFIX = '.skc-clone-';

/** How long one clone may run before it is killed. */
export const GIT_TIMEOUT_MS = 60000;

/** Most bytes of child output kept in memory; the rest is truncated. */
export const GIT_OUTPUT_LIMIT = 16384;

/**
 * Name one dot-prefixed clone directory inside the skills root, without creating it.
 *
 * It has to sit inside the skills root (same filesystem as the final name, or the
 * later rename would hit EXDEV) and it has to start with a dot (the scanner skips dot
 * entries, so a half-written clone is never listed).
 * @param {string} skillsRoot - directory the skill will eventually land in.
 * @returns {string} the clone path.
 */
export function cloneDirOf(skillsRoot) {
  return join(skillsRoot, `${CLONE_PREFIX}${process.pid}-${randomBytes(3).toString('hex')}`);
}

/**
 * The environment one git call runs under.
 *
 * It is built from scratch rather than extended: an inherited `GIT_*` or `SSH_*`
 * variable could redirect the transport, and an inherited token must never reach a
 * public clone. Only what git genuinely needs to run is passed through.
 * @returns {Record<string, string>} the whole environment.
 */
function gitEnvironment() {
  const env = {
    PATH: typeof process.env.PATH === 'string' ? process.env.PATH : '/usr/local/bin:/usr/bin:/bin',
    HOME: typeof process.env.HOME === 'string' ? process.env.HOME : '',
    LC_ALL: 'C',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    SSH_ASKPASS_REQUIRE: 'never',
    GCM_INTERACTIVE: 'never',
    // `credential.helper=` expressed through the environment: a stored keychain
    // credential must not be able to turn a private repository into a silent success.
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'credential.helper',
    GIT_CONFIG_VALUE_0: '',
  };
  if (typeof process.env.TMPDIR === 'string' && process.env.TMPDIR !== '') {
    env.TMPDIR = process.env.TMPDIR;
  }
  return env;
}

/**
 * Run one git command and collect its output.
 * @param {string[]} argv - arguments after the executable.
 * @param {string|undefined} cwd - working directory; the clone root for `rev-parse`.
 * @returns {Promise<{stdout: string, stderr: string}>} the captured streams.
 * @throws {Error} the child-process error, annotated with `timedOut` when the kill was ours.
 */
function runGit(argv, cwd) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', argv, {
      cwd,
      env: gitEnvironment(),
      timeout: GIT_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      maxBuffer: GIT_OUTPUT_LIMIT,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
        return;
      }
      // The child-process error object is the only place the exit state exists; the
      // streams are attached to it so the classifier can read them in one place.
      error.stdout = String(stdout ?? '');
      error.stderr = String(stderr ?? '');
      if (error.killed === true) error.timedOut = true;
      reject(error);
    });
    // git must never wait on a terminal: closing stdin makes a prompt fail immediately.
    child.stdin?.end();
  });
}

/**
 * Clone one public repository, shallowly and single-branch.
 *
 * The clone is what makes "add from a link" the same write as "add from a directory":
 * after this call the caller has a real directory tree, and every later guard reads it.
 * @param {{owner: string, repo: string, ref: string|null, dir: string}} request - what to
 *   clone and where; `dir` must not exist yet.
 * @returns {Promise<{commit: string|null, branch: string|null}>} the commit id and the
 *   branch `HEAD` points at (null when detached).
 * @throws {Error} the raw child-process error; map it with `gitFailureOf`.
 */
export async function cloneRepo({ owner, repo, ref, dir }) {
  const url = `https://github.com/${owner}/${repo}.git`;
  const argv = ['clone', '--depth', '1', '--single-branch'];
  if (typeof ref === 'string' && ref !== '') argv.push('--branch', ref);
  argv.push('--no-recurse-submodules', '--', url, dir);
  await runGit(argv, undefined);

  const head = await runGit(['rev-parse', 'HEAD'], dir);
  const current = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], dir);
  const commit = head.stdout.trim();
  const branch = current.stdout.trim();
  return {
    commit: commit === '' ? null : commit,
    branch: branch === '' || branch === 'HEAD' ? null : branch,
  };
}

/**
 * Map whatever the clone threw onto the seven route codes.
 *
 * The classification reads the child's own words, because that is the only place the
 * difference between "no such repository" and "no network" exists. The words never
 * travel further: the caller only ever sees the code and its fixed sentence.
 * @param {unknown} error - the child-process error, or an injected stand-in.
 * @returns {{code: string, message: string}} the route code and an English developer note.
 */
export function gitFailureOf(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (code === 'ENOENT') {
    return { code: 'E_GIT_MISSING', message: 'git is not installed on this machine' };
  }
  if (error?.timedOut === true || error?.killed === true) {
    return { code: 'E_GIT_TIMEOUT', message: `the clone did not finish within ${GIT_TIMEOUT_MS} milliseconds` };
  }
  const text = `${typeof error?.stderr === 'string' ? error.stderr : ''} ${typeof error?.stdout === 'string' ? error.stdout : ''}`;
  // "not found" in any of git's shapes (missing repository, missing branch, a 404 from
  // the mirror) and every prompt-refusal belong together: the user asked for something
  // that is not there or not readable without a login. Everything else - including
  // "Could not resolve host" - is a reachability answer and gets the wider sentence.
  if (/\b404\b|not found|does not exist|authentication|could not read|terminal prompts disabled/i.test(text)) {
    return { code: 'E_GIT_REPO_NOT_FOUND', message: 'the repository, branch or tag does not exist, or it needs a login' };
  }
  return { code: 'E_GIT_UNREACHABLE', message: 'the repository could not be reached' };
}
