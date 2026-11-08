/**
 * The four exact routes.
 *
 * Every route shares one guard: loopback fence first, method second. A write route
 * never trusts the path it is handed - it re-scans, resolves the skill by name, and
 * only writes when the freshly resolved path is byte-identical to the submitted one.
 * That is what turns "the panel showed this skill" into a checkable precondition.
 */
import { MAX_BODY_BYTES, fail, ok, readJsonBody, writeJson } from './http.js';
import { identityKey, isAbsoluteSkillFile, isSkillName, isWithin } from './names.js';
import { isLoopbackRequest } from './loopback.js';
import { mergeCatalog } from './classify.js';
import { readLedger } from './ledger.js';
import { scanUserSkills } from './scan.js';
import { snapshotRegistry } from './registry.js';
import { writeDisableFlag } from './write-skill.js';
import { read as readProviderToggles, setEnabled as setProviderEnabled } from './provider-toggles.js';

/** The route paths, with the leading slash the host server expects. */
export const ROUTES = {
  list: '/api/dsh-skill-center/list',
  toggle: '/api/dsh-skill-center/toggle',
  providerToggle: '/api/dsh-skill-center/provider-toggle',
  health: '/api/dsh-skill-center/health',
};

/** Provider ids are opaque, but bounded and printable. */
const PROVIDER_ID = /^[\x20-\x7e]{0,64}$/;

/**
 * Build the route table.
 * @param {object} ctx - host plugin context; only used for optional lookups.
 * @param {{dshHome: string, skillsRoot: string, version: string, registry: object,
 *   sessions: object, logger: {warn: Function}}} deps - resolved host services.
 * @returns {{kind: string, path: string, handler: Function}[]} routes for ctx.webServer.register.
 */
export function makeRoutes(ctx, deps) {
  const { dshHome, skillsRoot, version, registry, sessions } = deps;
  const logger = deps.logger ?? ctx?.logger ?? { warn: () => {} };

  /**
   * Guard one request: loopback first, then the method.
   * @param {object} request - node HTTP request.
   * @param {object} response - node HTTP response.
   * @param {string} method - the only method this route answers.
   * @returns {boolean} true when the handler may run.
   */
  const guard = (request, response, method) => {
    if (!isLoopbackRequest(request)) {
      writeJson(response, 403, fail('E_FORBIDDEN', 'loopback access only'));
      return false;
    }
    if (request.method !== method) {
      writeJson(response, 405, fail('E_METHOD', `method not allowed: ${request.method}`));
      return false;
    }
    return true;
  };

  /**
   * The workspace the panel is showing: an explicit override, then the first active
   * session's cwd, then the process cwd.
   * @param {string|undefined} override - `?cwd=` value.
   * @returns {string} absolute directory.
   */
  const panelCwd = (override) => {
    if (typeof override === 'string' && override.trim() !== '') return override.trim();
    try {
      const list = typeof sessions?.list === 'function' ? sessions.list() : [];
      for (const session of list) {
        const cwd = session?.header?.cwd;
        if (typeof cwd === 'string' && cwd !== '') return cwd;
      }
    } catch {
      // A registry that cannot answer leaves the process cwd in charge.
    }
    return process.cwd();
  };

  /**
   * Collect every fact the panel needs, from scratch.
   * @param {string} cwd - workspace directory.
   * @returns {Promise<{catalog: object, complete: boolean, diagnostics: string[], disabled: Set<string>}>} one catalogue pass.
   */
  const collect = async (cwd) => {
    const scanned = await scanUserSkills(skillsRoot);
    const ledger = await readLedger(dshHome, skillsRoot);
    const view = await snapshotRegistry(registry, cwd);
    const toggles = await readProviderToggles(dshHome);
    const providerDisabled = new Set(toggles.disabled.map((entry) => identityKey(entry.provider, entry.name)));
    const catalog = mergeCatalog({
      scanned,
      registry: view.summaries,
      ledger,
      providerDisabled,
      skillsRoot,
      diagnostics: view.diagnostics,
    });
    return {
      catalog,
      complete: view.complete,
      diagnostics: [...new Set([
        ...catalog.diagnostics,
        ...ledger.diagnostics,
        ...view.diagnostics,
        ...toggles.diagnostics,
      ])],
      disabled: providerDisabled,
    };
  };

  /**
   * Find the row the panel would be showing for one skill name.
   * @param {object} catalog - one merge pass.
   * @param {string} name - skill name.
   * @returns {object|undefined} the row, when the catalogue still lists it.
   */
  const findRow = (catalog, name) => catalog.groups
    .flatMap((group) => group.skills)
    .find((row) => row.name === name);

  /**
   * Count what the payload reports.
   * @param {{key: string, skills: object[]}[]} groups - the three partitions.
   * @param {number} excluded - rows left out of the partitions.
   * @returns {{total: number, disabled: number, excluded: number}} counts.
   */
  const countOf = (groups, excluded) => {
    let total = 0;
    let disabled = 0;
    for (const group of groups) {
      total += group.skills.length;
      disabled += group.skills.filter((row) => row.enabled === false).length;
    }
    return { total, disabled, excluded };
  };

  /**
   * Read the `cwd` query parameter.
   * @param {object} request - node HTTP request.
   * @returns {string|undefined} the parameter, when present.
   */
  const queryCwd = (request) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const value = url.searchParams.get('cwd');
      return value === null ? undefined : value;
    } catch {
      return undefined;
    }
  };

  return [
    {
      kind: 'exact',
      path: ROUTES.list,
      handler: async (request, response) => {
        if (!guard(request, response, 'GET')) return;
        try {
          const cwd = panelCwd(queryCwd(request));
          const { catalog, complete, diagnostics } = await collect(cwd);
          writeJson(response, 200, ok({
            groups: catalog.groups,
            counts: countOf(catalog.groups, catalog.excluded),
            complete,
            diagnostics,
            cwd,
          }));
        } catch (error) {
          logger.warn(error);
          writeJson(response, 500, fail('E_INTERNAL', error instanceof Error ? error.message : String(error)));
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.toggle,
      handler: async (request, response) => {
        if (!guard(request, response, 'POST')) return;
        let body;
        try {
          body = await readJsonBody(request, { maxBytes: MAX_BODY_BYTES, objectOnly: true });
        } catch (error) {
          writeJson(response, 400, fail('E_BAD_REQUEST', error instanceof Error ? error.message : 'invalid body'));
          return;
        }
        if (body === null) {
          writeJson(response, 400, fail('E_BAD_REQUEST', 'body must be a JSON object'));
          return;
        }
        const { name, path, enabled } = body;
        if (!isSkillName(name)) {
          writeJson(response, 400, fail('E_BAD_NAME', 'name must be kebab-case'));
          return;
        }
        if (!isAbsoluteSkillFile(path)) {
          writeJson(response, 400, fail('E_BAD_PATH', 'path must be an absolute SKILL.md path'));
          return;
        }
        if (typeof enabled !== 'boolean') {
          writeJson(response, 400, fail('E_BAD_REQUEST', 'enabled must be a boolean'));
          return;
        }
        try {
          const { catalog } = await collect(panelCwd(undefined));
          const row = findRow(catalog, name);
          if (row === undefined) {
            writeJson(response, 404, fail('E_NOT_FOUND', `no skill named ${name}`));
            return;
          }
          if (row.symlink === true) {
            writeJson(response, 409, fail('E_SYMLINK_READONLY', 'symlinked skills are read-only'));
            return;
          }
          if (row.path === null || typeof row.path !== 'string') {
            writeJson(response, 409, fail('E_NOT_WRITABLE', 'skill has no writable file'));
            return;
          }
          if (row.path !== path) {
            writeJson(response, 409, fail('E_STALE_PATH', 'skill file moved since the panel loaded'));
            return;
          }
          if (!isWithin(skillsRoot, row.path)) {
            writeJson(response, 409, fail('E_NOT_WRITABLE', 'skill file is outside the skills root'));
            return;
          }
          const result = await writeDisableFlag(row.path, !enabled);
          writeJson(response, 200, ok({
            name,
            enabled,
            modelInvocable: enabled,
            path: result.path,
          }));
        } catch (error) {
          const code = typeof error?.code === 'string' ? error.code : 'E_INTERNAL';
          const message = error instanceof Error ? error.message : String(error);
          if (code === 'E_INTERNAL') {
            logger.warn(error);
            writeJson(response, 500, fail('E_INTERNAL', message));
            return;
          }
          writeJson(response, statusOf(code), fail(code, message));
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.providerToggle,
      handler: async (request, response) => {
        if (!guard(request, response, 'POST')) return;
        let body;
        try {
          body = await readJsonBody(request, { maxBytes: MAX_BODY_BYTES, objectOnly: true });
        } catch (error) {
          writeJson(response, 400, fail('E_BAD_REQUEST', error instanceof Error ? error.message : 'invalid body'));
          return;
        }
        if (body === null) {
          writeJson(response, 400, fail('E_BAD_REQUEST', 'body must be a JSON object'));
          return;
        }
        const { provider, name, enabled } = body;
        if (!isSkillName(name)) {
          writeJson(response, 400, fail('E_BAD_NAME', 'name must be kebab-case'));
          return;
        }
        if (typeof provider !== 'string' || !PROVIDER_ID.test(provider)) {
          writeJson(response, 400, fail('E_BAD_REQUEST', 'provider must be a printable string of at most 64 characters'));
          return;
        }
        if (typeof enabled !== 'boolean') {
          writeJson(response, 400, fail('E_BAD_REQUEST', 'enabled must be a boolean'));
          return;
        }
        try {
          const { catalog } = await collect(panelCwd(undefined));
          const row = findRow(catalog, name);
          const switchable = row !== undefined
            && row.partition === 'builtin'
            && row.readonlyReason === 'provider-store'
            && (row.provider ?? '') === provider;
          if (!switchable) {
            writeJson(response, 404, fail('E_NOT_FOUND', `no built-in skill ${provider}#${name}`));
            return;
          }
          await setProviderEnabled(dshHome, { provider, name }, enabled);
          writeJson(response, 200, ok({ provider, name, disabled: !enabled }));
        } catch (error) {
          logger.warn(error);
          writeJson(response, 500, fail('E_WRITE_FAILED', error instanceof Error ? error.message : String(error)));
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.health,
      handler: async (request, response) => {
        if (!guard(request, response, 'GET')) return;
        try {
          const cwd = panelCwd(queryCwd(request));
          const scanned = await scanUserSkills(skillsRoot);
          const ledger = await readLedger(dshHome, skillsRoot);
          const toggles = await readProviderToggles(dshHome);
          const view = await snapshotRegistry(registry, cwd);
          const catalog = mergeCatalog({
            scanned,
            registry: view.summaries,
            ledger,
            skillsRoot,
            diagnostics: view.diagnostics,
          });
          writeJson(response, 200, ok({
            ok: true,
            version,
            dshHome,
            skillsRoot,
            counts: countOf(catalog.groups, catalog.excluded),
            ledger: { sources: ledger.sources },
            providerToggles: { readable: toggles.diagnostics.length === 0, disabled: toggles.disabled.length },
            complete: view.complete,
          }));
        } catch (error) {
          logger.warn(error);
          writeJson(response, 500, fail('E_INTERNAL', error instanceof Error ? error.message : String(error)));
        }
      },
    },
  ];
}

/**
 * HTTP status for a route error code.
 * @param {string} code - `E_*` constant.
 * @returns {number} the status to send.
 */
function statusOf(code) {
  switch (code) {
    case 'E_SYMLINK_READONLY':
    case 'E_STALE_PATH':
    case 'E_FILE_CHANGED':
    case 'E_NOT_WRITABLE':
      return 409;
    case 'E_VERIFY_FAILED':
    case 'E_WRITE_FAILED':
      return 500;
    default:
      return 500;
  }
}
