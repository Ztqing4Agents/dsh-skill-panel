/**
 * Render the client modules to a string, without a browser and without a build step.
 *
 * Three problems have to be solved to import `src/client/**` from node:
 *
 *   1. the sources are JSX, and node does not parse JSX;
 *   2. they import `@deepseek-ai/dsh-client-ui-primitives`, which only exists as a
 *      browser seed module (its own imports do not resolve outside the GUI);
 *   3. the bundle must share this process's `react`, or the renderer sees a second
 *      copy and hooks throw.
 *
 * So: bundle with the esbuild that the package already depends on, alias the
 * primitives to `primitives-stub.mjs`, keep `react`/`react-dom` external, write the
 * bundle inside the package (so `react` resolves upwards), import it, then delete
 * the build directory. Nothing here mutates the package.
 */
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

/** Package root: this helper lives two levels down, in test/helpers/. */
export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** Where the throwaway bundles live. Removed again after each import. */
const BUILD_ROOT = join(ROOT, 'test', '.build');

/** The client sources a test may ask for, by short name. */
const SOURCES = {
  page: 'page.jsx',
  row: 'row.jsx',
  skeleton: 'skeleton.jsx',
  toast: 'toast.jsx',
  entry: 'index.jsx',
  styles: 'styles.js',
  model: 'model.js',
  state: 'state.js',
  api: 'api.js',
  header: 'header-scroll.js',
  card: 'market-card.jsx',
  iconTile: 'icon-tile.jsx',
  detail: 'market-detail.jsx',
  filters: 'market-filters.jsx',
  installedDetail: 'installed-detail.jsx',
  skillDialogs: 'skill-dialogs.jsx',
  pluginDetail: 'plugin-detail.jsx',
  markdown: 'markdown.jsx',
};

/** Bundles already built in this process, by cache key. */
const cache = new Map();

/**
 * Bundle and import some client modules.
 * @param {string[]} names - keys of `SOURCES` to expose, e.g. ['page','row'].
 * @returns {Promise<Record<string, object>>} one module namespace per name.
 */
export async function loadClientModules(names) {
  const key = [...names].sort().join(',');
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const pending = build(names);
  cache.set(key, pending);
  return pending;
}

/**
 * Build one bundle and import it.
 * @param {string[]} names - module short names.
 * @returns {Promise<Record<string, object>>} imported namespaces.
 */
async function build(names) {
  const unknown = names.filter((name) => SOURCES[name] === undefined);
  if (unknown.length > 0) throw new Error(`unknown client module: ${unknown.join(', ')}`);
  const { build: esbuild } = await import('esbuild');
  await mkdir(BUILD_ROOT, { recursive: true });
  const dir = await mkdtemp(join(BUILD_ROOT, 'bundle-'));
  try {
    const stub = join(dir, 'primitives-stub.mjs');
    await writeFile(stub, await readFile(join(ROOT, 'test', 'helpers', 'primitives-stub.mjs'), 'utf8'));
    const lines = names.map((name) => `export * as ${name} from ${JSON.stringify(join(ROOT, 'src', 'client', SOURCES[name]))};`);
    const entry = join(dir, 'entry.mjs');
    await writeFile(entry, `${lines.join('\n')}\n`);
    const outfile = join(dir, 'bundle.mjs');
    await esbuild({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      jsx: 'automatic',
      external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/server'],
      alias: { '@deepseek-ai/dsh-client-ui-primitives': stub },
      logLevel: 'silent',
    });
    const module = await import(pathToFileURL(outfile).href);
    return module;
  } finally {
    await rm(dir, { recursive: true, force: true });
    // Best effort: drop the container when it happens to be empty. Non-recursive on
    // purpose - a sibling test file may be building into its own subdirectory.
    await rm(BUILD_ROOT, { recursive: false, force: true }).catch(() => {});
  }
}

/**
 * The `t()` the panel is rendered with: the real zh dictionary plus `{name}` interpolation.
 * @param {Record<string, unknown>} dictionary - parsed locale dictionary.
 * @returns {Function} translate function.
 */
export function translator(dictionary) {
  return (key, params = {}) => {
    // `ctx.locale` looks a key up as a literal property of the dictionary: no path
    // walking, no nesting. Any other behaviour here would let a nested dictionary
    // pass the suite and render raw key names in the GUI.
    const value = dictionary[key];
    if (typeof value !== 'string') return key;
    return value.replace(/\{(\w+)\}/g, (whole, name) => (params[name] === undefined ? whole : String(params[name])));
  };
}

/**
 * Read one locale dictionary from the package.
 * @param {'zh'|'en'} language - dictionary to read.
 * @returns {Promise<Record<string, unknown>>} parsed dictionary.
 */
export async function readDictionary(language) {
  const file = join(ROOT, 'locale', `${language}.json`);
  return JSON.parse(await readFile(file, 'utf8'));
}

/**
 * The Chinese `t()` used by the structural tests.
 * @returns {Promise<Function>} translate function over locale/zh.json.
 */
export async function zhTranslator() {
  return translator(await readDictionary('zh'));
}

/**
 * A client root context as strict as cordis.
 *
 * A service may only be read when the plugin declared it in `inject`; any other
 * property read throws the runtime's own error (`cannot get property "X" without
 * inject`). That is the failure that once took the whole web boot down, and a plain
 * object fake can never reproduce it - so this is the only context factory the suite
 * offers, and `declared` comes from the module's own `inject` export.
 * @param {{inject?: string[], apply?: Function}} module - the bundle's exports.
 * @param {Function} [t] - translator the fake locale resolves with.
 * @returns {{ctx: object, registrations: object[], dictionaries: object[], cleanups: Function[]}} the fake.
 */
export function strictContext(module, t = (key) => key) {
  const declared = new Set(Array.isArray(module.inject) ? module.inject : []);
  const registrations = [];
  const dictionaries = [];
  const cleanups = [];
  /** Every `uiWorkspace.startSession(...)` call, so a test can count and read the args. */
  const sessions = [];
  const services = {
    // The shell's session seat: the add menu's second row starts a Creator draft with it.
    // Only declared services exist on the strict ctx, so a page that forgets to declare it
    // fails at boot instead of at click time.
    uiWorkspace: {
      startSession: (...args) => {
        sessions.push(args);
        return {};
      },
    },
    locale: {
      register: (namespace, dictionary) => {
        dictionaries.push({ namespace, dictionary });
        return () => {};
      },
      bind: () => t,
    },
    slots: {
      inject: (seat, callback) => {
        const dispose = callback();
        return typeof dispose === 'function' ? dispose : () => {};
      },
      register: (registration, component) => {
        registrations.push({ registration, component });
        return () => {};
      },
    },
  };
  const ctx = new Proxy({}, {
    get: (_target, key) => {
      if (key === 'effect') {
        return (callback) => {
          const dispose = callback();
          cleanups.push(dispose);
          return () => {};
        };
      }
      if (typeof key === 'symbol') return undefined;
      if (!declared.has(key)) throw new Error(`cannot get property "${String(key)}" without inject`);
      return services[key] ?? (() => {});
    },
    has: (_target, key) => key === 'effect' || declared.has(key),
  });
  return { ctx, registrations, dictionaries, cleanups, sessions };
}

/** Resolve a package dependency path, so tests never guess file locations. */
export const resolveFromPackage = (specifier) => require.resolve(specifier);
