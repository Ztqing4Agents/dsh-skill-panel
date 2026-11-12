/**
 * dsh-skill-center - Host half.
 *
 * Serves the skill center data plane under /api/dsh-skill-center/*: one read
 * route that merges a fresh scan of $DSH_HOME/skills with the skill registry and
 * the install ledgers, one write route that rewrites the `disable-model-invocation`
 * field of a local SKILL.md byte for byte, one write route for the panel-owned
 * provider toggle store, one health route, and the nine market routes (bootstrap,
 * list, detail, installed map, install, versions, update, batched icons and the
 * local favourites write) that talk to the one upstream (the SkillHub mirror)
 * through lib/market/upstream.js.
 *
 * The browser half (./client) renders the sidebar entry and the global page; the
 * two halves meet only at the JSON envelope below.
 */
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { makeRoutes } from './lib/routes.js';
import { makeMarketDeps } from './lib/market/sources/index.js';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');

/** Stable cordis plugin name; also the sidebar panel id. */
export const name = 'dsh-skill-center';

/** Services that must be up before the route table can mount. */
export const inject = ['webServer', 'skills', 'sessions'];

/**
 * Guard against a second host apply: re-registering an exact route throws and
 * would take the boot down with it.
 */
let applied = false;

/**
 * Resolve the DSH home directory: explicit config, then $DSH_HOME, then ~/.dsh.
 * @param {object|undefined} config - plugin config.
 * @returns {string} absolute DSH home path.
 */
function resolveDshHome(config) {
  const configured = typeof config?.dshHome === 'string' ? config.dshHome.trim() : '';
  if (configured !== '') return configured;
  const fromEnv = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : '';
  if (fromEnv !== '') return fromEnv;
  return join(homedir(), '.dsh');
}

/**
 * Mount the skill center routes.
 * @param {object} ctx - host plugin context carrying webServer/skills/sessions.
 * @param {object} [config] - plugin config: {dshHome?, skillsRoot?}.
 */
export function apply(ctx, config) {
  if (applied) return;
  applied = true;
  const dshHome = resolveDshHome(config);
  const configuredRoot = typeof config?.skillsRoot === 'string' ? config.skillsRoot.trim() : '';
  const skillsRoot = configuredRoot !== '' ? configuredRoot : join(dshHome, 'skills');
  const logger = { warn: (entry) => ctx.logger.warn(entry) };
  const market = makeMarketDeps({ dshHome, skillsRoot, logger });
  const routes = makeRoutes(ctx, {
    dshHome,
    skillsRoot,
    version: pkg.version,
    registry: ctx.skills,
    sessions: ctx.sessions,
    logger,
    market,
  });
  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.webServer.register(route));
    return () => {
      for (const dispose of disposers) dispose();
      market.dispose();
    };
  }, 'dsh-skill-center: routes');
}
