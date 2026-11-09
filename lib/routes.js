/**
 * The nine exact routes: four for the installed tab, five for the market tab.
 *
 * Every route shares one guard: loopback fence first, method second. A write route
 * never trusts the path it is handed - it re-scans, resolves the skill by name, and
 * only writes when the freshly resolved path is byte-identical to the submitted one.
 * That is what turns "the panel showed this skill" into a checkable precondition.
 *
 * The market routes are a network face, so they share the guard and the envelope but
 * not the collector: a market timeout must never make the installed tab slow.
 */
import { join } from 'node:path';

import { MAX_BODY_BYTES, fail, ok, readJsonBody, writeJson } from './http.js';
import { identityKey, isAbsoluteSkillFile, isSkillName, isWithin } from './names.js';
import { isLoopbackRequest } from './loopback.js';
import { mergeCatalog } from './classify.js';
import { readLedger } from './ledger.js';
import { scanUserSkills } from './scan.js';
import { snapshotRegistry } from './registry.js';
import { writeDisableFlag } from './write-skill.js';
import { read as readProviderToggles, setEnabled as setProviderEnabled } from './provider-toggles.js';
import { asMarketError, marketError, statusOfMarketError } from './market/errors.js';
import { parseDetailQuery, parseInstallBody, parseListQuery } from './market/query.js';
import { descriptorsOf, makeMarketDeps } from './market/sources/index.js';

/** The route paths, with the leading slash the host server expects. */
export const ROUTES = {
  list: '/api/dsh-skill-center/list',
  toggle: '/api/dsh-skill-center/toggle',
  providerToggle: '/api/dsh-skill-center/provider-toggle',
  health: '/api/dsh-skill-center/health',
  marketBootstrap: '/api/dsh-skill-center/market/bootstrap',
  marketList: '/api/dsh-skill-center/market/list',
  marketDetail: '/api/dsh-skill-center/market/detail',
  marketInstalled: '/api/dsh-skill-center/market/installed',
  marketInstall: '/api/dsh-skill-center/market/install',
};

/** Provider ids are opaque, but bounded and printable. */
const PROVIDER_ID = /^[\x20-\x7e]{0,64}$/;

/**
 * Build the route table.
 * @param {object} ctx - host plugin context; only used for optional lookups.
 * @param {{dshHome: string, skillsRoot: string, version: string, registry: object,
 *   sessions: object, logger: {warn: Function}, market?: object}} deps - resolved host services.
 *   `market` is optional: when absent, `makeMarketDeps` assembles one over the real
 *   upstream client, and a test can pass its own object with a fake `io`.
 * @returns {{kind: string, path: string, handler: Function}[]} routes for ctx.webServer.register.
 */
export function makeRoutes(ctx, deps) {
  const { dshHome, skillsRoot, version, registry, sessions } = deps;
  const logger = deps.logger ?? ctx?.logger ?? { warn: () => {} };
  const market = deps.market ?? makeMarketDeps({ dshHome, skillsRoot, logger });

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

  /**
   * Read the query string of one market request.
   * @param {object} request - node HTTP request.
   * @returns {URLSearchParams} the parameters; empty when the URL is unparsable.
   */
  const queryOf = (request) => {
    try {
      return new URL(request.url ?? '/', 'http://localhost').searchParams;
    } catch {
      return new URLSearchParams();
    }
  };

  /**
   * Resolve one registered source.
   * @param {string} id - source id.
   * @returns {object} the adapter.
   * @throws {import('./market/errors.js').MarketError} with code E_BAD_QUERY when unknown.
   */
  const requireSource = (id) => {
    const source = market.sourceById(id);
    if (source === undefined) throw marketError('E_BAD_QUERY', `unknown source: ${id}`);
    return source;
  };

  /**
   * Write one market failure.
   *
   * The log line carries the route and the code only: owner, slug and keyword are user
   * input and the response body belongs to the upstream, so neither is ever logged.
   * @param {object} response - node HTTP response.
   * @param {unknown} error - whatever the handler threw.
   * @param {string} route - route name for the log.
   * @returns {void}
   */
  const marketFailure = (response, error, route) => {
    const failure = asMarketError(error);
    if (failure.code === 'E_INTERNAL') logger.warn({ route, code: failure.code, error });
    else logger.warn({ route, code: failure.code });
    const body = fail(failure.code, failure.message);
    writeJson(response, statusOfMarketError(failure), failure.detail === null
      ? body
      : { ...body, data: failure.detail });
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
    {
      kind: 'exact',
      path: ROUTES.marketBootstrap,
      handler: async (request, response) => {
        if (!guard(request, response, 'GET')) return;
        try {
          const params = queryOf(request);
          const refresh = params.get('refresh') === '1';
          const source = market.sourceById('skillhub');
          const table = typeof source?.categories === 'function'
            ? await source.categories(market.io, { now: market.now, refresh })
            : { items: [], ok: false, stale: false };
          // Counts are a separate, expensive answer (thirteen upstream requests): a source
          // that cannot count leaves the numbers null and `countsOk` false, but bootstrap
          // still answers 200 with the chips intact.
          const counted = typeof source?.counts === 'function'
            ? await source.counts(market.io, { now: market.now, refresh })
            : { counts: {}, total: null, ok: false };
          const countOf = (key) => {
            const value = counted.counts?.[key];
            return Number.isInteger(value) ? value : null;
          };
          writeJson(response, 200, ok({
            sources: descriptorsOf(market.sources),
            categories: table.items.map((entry) => ({
              key: entry.key,
              name: entry.name,
              nameEn: entry.nameEn,
              count: countOf(entry.key),
            })),
            categoriesOk: table.ok,
            categoriesStale: table.stale,
            total: Number.isInteger(counted.total) ? counted.total : null,
            countsOk: counted.ok === true,
          }));
        } catch (error) {
          marketFailure(response, error, 'market/bootstrap');
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.marketList,
      handler: async (request, response) => {
        if (!guard(request, response, 'GET')) return;
        try {
          const query = parseListQuery(queryOf(request));
          const source = requireSource(query.sourceId);
          const page = query.keyword === ''
            ? await source.list(query, market.io)
            : await source.search(query, market.io);
          writeJson(response, 200, ok({
            sourceId: query.sourceId,
            sort: query.sort,
            keyword: query.keyword,
            category: query.category,
            items: Array.isArray(page?.items) ? page.items : [],
            next: typeof page?.next === 'string' ? page.next : null,
            total: typeof page?.total === 'number' ? page.total : null,
          }));
        } catch (error) {
          marketFailure(response, error, 'market/list');
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.marketDetail,
      handler: async (request, response) => {
        if (!guard(request, response, 'GET')) return;
        try {
          const query = parseDetailQuery(queryOf(request));
          const source = requireSource(query.sourceId);
          const detail = await source.detail({
            owner: query.owner,
            slug: query.slug,
            version: query.version,
          }, market.io);
          const nameValid = detail?.nameValid === true;
          writeJson(response, 200, ok({
            item: detail?.item ?? null,
            iconUrl: typeof detail?.item?.iconUrl === 'string' ? detail.item.iconUrl : null,
            overview: typeof detail?.overview === 'string' ? detail.overview : '',
            declaredName: typeof detail?.declaredName === 'string' ? detail.declaredName : '',
            nameValid,
            installTo: nameValid ? join(skillsRoot, String(detail.declaredName)) : skillsRoot,
            files: Array.isArray(detail?.files) ? detail.files : [],
            filesComplete: detail?.filesComplete === true,
          }));
        } catch (error) {
          marketFailure(response, error, 'market/detail');
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.marketInstalled,
      handler: async (request, response) => {
        if (!guard(request, response, 'GET')) return;
        try {
          const view = await market.store.installed();
          writeJson(response, 200, ok({ items: view.items, readable: view.readable }));
        } catch (error) {
          marketFailure(response, error, 'market/installed');
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.marketInstall,
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
        try {
          const ref = parseInstallBody(body);
          requireSource(ref.sourceId);
          const result = await market.installer.install(ref);
          writeJson(response, 200, ok({
            name: result.name,
            path: result.path,
            version: result.version,
            source: result.source,
            owner: result.owner,
            slug: result.slug,
            files: result.files,
            bytes: result.bytes,
          }));
        } catch (error) {
          marketFailure(response, error, 'market/install');
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
