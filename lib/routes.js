/**
 * The sixteen exact routes: seven for the installed tab (the fifth reads one skill's own
 * SKILL.md and file list for the detail view, the last two copy a local directory into
 * the skills root and delete a skill directory with its ledger record) and nine for the
 * market tab (bootstrap, list, detail, installed, install, versions, update, icons and
 * the local favourites write - see docs/contracts/routes.md 3.7.1).
 *
 * Every route shares one guard: loopback fence first, method second. A write route
 * never trusts the path it is handed - it re-scans, resolves the skill by name, and
 * only writes when the freshly resolved path is byte-identical to the submitted one.
 * That is what turns "the panel showed this skill" into a checkable precondition.
 *
 * The market routes are a network face, so they share the guard and the envelope but
 * not the collector: a market timeout must never make the installed tab slow.
 */
import { dirname, join } from 'node:path';

import { MAX_BODY_BYTES, fail, ok, readJsonBody, writeJson } from './http.js';
import { identityKey, isAbsoluteSkillFile, isSkillName, isWithin } from './names.js';
import { isLoopbackRequest } from './loopback.js';
import { mergeCatalog } from './classify.js';
import { readLedger } from './ledger.js';
import { readSkillContent, scanUserSkills } from './scan.js';
import { snapshotRegistry } from './registry.js';
import { withPluginIcons } from './plugin-icon.js';
import { writeDisableFlag } from './write-skill.js';
import { read as readProviderToggles, setEnabled as setProviderEnabled } from './provider-toggles.js';
import { asLocalError } from './local/errors.js';
import { createLocalSkills } from './local/index.js';
import { asMarketError, marketError, statusOfMarketError } from './market/errors.js';
import {
  parseDetailQuery,
  parseIconRequest,
  parseInstallBody,
  parseListQuery,
  parseUpdateBody,
  parseVersionsQuery,
} from './market/query.js';
import { marketId } from './market/normalize.js';
import { makeMarketDeps, scopeById, scopesFor } from './market/sources/index.js';

/** The route paths, with the leading slash the host server expects. */
export /**
 * The public page of one skill, for the detail view's "open repository" link.
 *
 * Both source ids resolve here: the skillhub image carries the ClawHub catalogue, so the
 * same path shape is correct for either. Nothing upstream this is used to *call* anything -
 * it is a string the user clicks, which is why it may live in the host half.
 * @param {object} row - the catalog row that was opened.
 * @returns {string|null} the page URL, or null when the skill has no upstream identity.
 */
const repoUrlOf = (row) => {
  const up = row?.upstream ?? null;
  if (up === null || typeof up.owner !== 'string' || typeof up.slug !== 'string') return null;
  return `https://skillhub.cn/skills/${up.owner}/${up.slug}`;
};

export const ROUTES = {
  list: '/api/dsh-skill-center/list',
  toggle: '/api/dsh-skill-center/toggle',
  providerToggle: '/api/dsh-skill-center/provider-toggle',
  health: '/api/dsh-skill-center/health',
  detail: '/api/dsh-skill-center/detail',
  marketBootstrap: '/api/dsh-skill-center/market/bootstrap',
  marketList: '/api/dsh-skill-center/market/list',
  marketDetail: '/api/dsh-skill-center/market/detail',
  marketInstalled: '/api/dsh-skill-center/market/installed',
  marketInstall: '/api/dsh-skill-center/market/install',
  marketVersions: '/api/dsh-skill-center/market/versions',
  marketUpdate: '/api/dsh-skill-center/market/update',
  marketIcons: '/api/dsh-skill-center/market/icons',
  marketFavorite: '/api/dsh-skill-center/market/favorite',
  add: '/api/dsh-skill-center/add',
  remove: '/api/dsh-skill-center/remove',
};

/** Provider ids are opaque, but bounded and printable. */
const PROVIDER_ID = /^[\x20-\x7e]{0,64}$/;

/**
 * Build the route table.
 * @param {object} ctx - host plugin context; only used for optional lookups.
 * @param {{dshHome: string, skillsRoot: string, version: string, registry: object,
 *   sessions: object, logger: {warn: Function}, market?: object,
 *   withWriteLock?: (key: string, run: Function) => Promise<unknown>}} deps - resolved host services.
 *   `market` is optional: when absent, `makeMarketDeps` assembles one over the real
 *   upstream client, and a test can pass its own object with a fake `io`.
 *   `withWriteLock` is the installer's write mutex; omitted, it is taken from `market`.
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
   * @returns {Promise<{catalog: object, registry: object[], complete: boolean, diagnostics: string[],
   *   disabled: Set<string>}>} one catalogue pass.
   */
  const collect = async (cwd) => {
    const scanned = await scanUserSkills(skillsRoot);
    const ledger = await readLedger(dshHome, skillsRoot);
    const view = await snapshotRegistry(registry, cwd);
    const toggles = await readProviderToggles(dshHome);
    const providerDisabled = new Set(toggles.disabled.map((entry) => identityKey(entry.provider, entry.name)));
    // The builtin blocks show the plugin's own icon, read off the package that shipped the
    // skill; attaching it here keeps `classify.js` free of I/O.
    const catalog = await withPluginIcons(mergeCatalog({
      scanned,
      registry: view.summaries,
      ledger,
      providerDisabled,
      skillsRoot,
      diagnostics: view.diagnostics,
    }));
    return {
      catalog,
      // The registry half travels with the catalogue because the two writes need it:
      // the add route asks whether a same-name registry row would outrank the copy, and
      // that rank only exists on the annotated summary (`SkillSummary` has no `rank`).
      // `list` and `health` answer their own payloads, so neither forwards this field.
      registry: view.summaries,
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
   * Re-derive the catalogue for a write: the flattened rows plus the registry summary.
   *
   * This is the only way a write learns "which skill is this". It is injected into the
   * local face rather than imported there so the merge keeps exactly one definition,
   * and so a write can never act on a catalogue built by a different rule set.
   * @returns {Promise<{rows: object[], registry: object[]}>} the fresh pass.
   */
  const rescan = async () => {
    const { catalog, registry: summaries } = await collect(panelCwd(undefined));
    return { rows: catalog.groups.flatMap((group) => group.skills), registry: summaries };
  };

  /**
   * Write one local-face failure.
   *
   * Same discipline as `marketFailure`: the log line carries the route and the code,
   * never the path - a path on this machine is the user's business, not log material.
   * @param {object} response - node HTTP response.
   * @param {unknown} error - whatever the handler threw.
   * @param {string} route - route name for the log.
   * @returns {void}
   */
  const localFailure = (response, error, route) => {
    const failure = asLocalError(error);
    if (failure.code === 'E_INTERNAL') logger.warn({ route, code: failure.code, error });
    else logger.warn({ route, code: failure.code });
    const body = fail(failure.code, failure.message);
    writeJson(response, failure.status, failure.detail === null
      ? body
      : { ...body, data: failure.detail });
  };

  /**
   * The write lock every local write takes.
   *
   * It is the installer's own table (`local:<name>` beside `<source>:<owner>:<slug>`),
   * so an add or a delete cannot run inside an install of the same skill. A caller may
   * hand one in; otherwise the market deps supply it, and a test double without an
   * installer simply runs the work uninhibited.
   */
  const withWriteLock = typeof deps.withWriteLock === 'function'
    ? deps.withWriteLock
    : (key, run) => {
      const lock = market.installer?.withWriteLock;
      return typeof lock === 'function' ? lock.call(market.installer, key, run) : run();
    };

  const localSkills = createLocalSkills({
    skillsRoot,
    dshHome,
    store: market.store,
    withWriteLock,
    rescan,
  });

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
   * Resolve one scope to the adapter that answers it.
   *
   * A scope is a filter, not a source: `all` borrows the SkillHub adapter (the one that
   * talks to the mirror) and simply sends no `source` parameter, which is exactly what the
   * site's "all sources" option does.
   * @param {string} id - scope id, already whitelisted by `parseListQuery`.
   * @returns {{scope: object, source: object}} the scope and its adapter.
   * @throws {import('./market/errors.js').MarketError} with code E_BAD_QUERY when unknown.
   */
  const requireScope = (id) => {
    const scope = scopeById(id);
    if (scope === undefined) throw marketError('E_BAD_QUERY', `unknown source: ${id}`);
    return { scope, source: requireSource(scope.adapterId) };
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
      path: ROUTES.detail,
      handler: async (request, response) => {
        if (!guard(request, response, 'GET')) return;
        // One parameter, and only one: the caller names a skill, never a path. The file that
        // gets read is the one this pass resolved by name, so a request cannot point the
        // route at an arbitrary file.
        const name = queryOf(request).get('name');
        if (!isSkillName(name)) {
          writeJson(response, 400, fail('E_BAD_NAME', 'name must be kebab-case'));
          return;
        }
        try {
          const { catalog } = await collect(panelCwd(undefined));
          const row = findRow(catalog, name);
          if (row === undefined) {
            writeJson(response, 404, fail('E_NOT_FOUND', `no skill named ${name}`));
            return;
          }
          // A row with no file (a registry-provided skill) answers an empty body and no file
          // list - that is the honest answer, not a failure: the panel says so in words.
          // The public skill page travels with the answer: the browser half never builds an
          // upstream URL (AGENTS.md 13), so the host hands it over ready to put in an href.
          writeJson(response, 200, ok({ ...await readSkillContent(row), repoUrl: repoUrlOf(row) }));
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
          if (refresh) market.resetIconCache?.();
          // The counts belong to one scope: the same category holds a different number in
          // each, so asking for all three up front would triple the cost and still show two
          // wrong figures. The client sends its current scope and gets that scope's numbers.
          const scopeId = params.get('source') ?? '';
          const scope = scopeId === '' ? scopeById('all') : scopeById(scopeId);
          if (scope === undefined) throw marketError('E_BAD_QUERY', 'source must be a registered source id');
          const source = market.sourceById(scope.adapterId);
          const table = typeof source?.categories === 'function'
            ? await source.categories(market.io, { now: market.now, refresh })
            : { items: [], ok: false, stale: false };
          // Counts are a separate, expensive answer (thirteen upstream requests): a source
          // that cannot count leaves the numbers null and `countsOk` false, but bootstrap
          // still answers 200 with the chips intact.
          const counted = typeof source?.counts === 'function'
            ? await source.counts(market.io, { now: market.now, refresh, sourceParam: scope.sourceParam })
            : { counts: {}, total: null, ok: false };
          const countOf = (key) => {
            const value = counted.counts?.[key];
            return Number.isInteger(value) ? value : null;
          };
          // The bookmarks ride along with bootstrap: they are one global set, and this is
          // the one global round trip the market tab makes, so the first frame can draw
          // the right bookmark state without a second request. A missing file is a first
          // run (`favoritesOk: true`, nothing was ever saved); only an unreadable or
          // corrupt file degrades to an empty list with `favoritesOk: false`, and neither
          // case ever takes the page down.
          const bookmarks = market.favorites === undefined
            ? { favorites: [], readable: false }
            : await market.favorites.read();
          writeJson(response, 200, ok({
            source: scope.id,
            sources: scopesFor(),
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
            favorites: bookmarks.favorites,
            favoritesOk: bookmarks.readable,
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
          const { source } = requireScope(query.scope);
          const page = query.keyword === ''
            ? await source.list(query, market.io)
            : await source.search(query, market.io);
          writeJson(response, 200, ok({
            source: query.scope,
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
    {
      kind: 'exact',
      path: ROUTES.marketVersions,
      handler: async (request, response) => {
        if (!guard(request, response, 'GET')) return;
        try {
          // `source` is an identity here, exactly as it is on detail / install / icons:
          // the versions of one skill belong to one source's package.
          const query = parseVersionsQuery(queryOf(request));
          const source = requireSource(query.sourceId);
          if (typeof source.versions !== 'function') {
            throw marketError('E_BAD_QUERY', `source ${query.sourceId} cannot list versions`);
          }
          const answer = await source.versions({ owner: query.owner, slug: query.slug }, market.io);
          writeJson(response, 200, ok({
            source: query.sourceId,
            owner: query.owner,
            slug: query.slug,
            namespace: typeof answer?.namespace === 'string' ? answer.namespace : query.owner,
            latest: typeof answer?.latest === 'string' ? answer.latest : null,
            versions: Array.isArray(answer?.versions) ? answer.versions : [],
            total: Number.isInteger(answer?.total) ? answer.total : 0,
          }));
        } catch (error) {
          marketFailure(response, error, 'market/versions');
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.marketUpdate,
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
          // P0 - the whitelist. Then the six offline checks, in an order where every early
          // return still gives a code the browser can act on: the skill is not there, it is
          // a symlink, the file moved, the directory is outside the root, the identity is
          // not the one in `_meta.json`, there is nothing to do.
          const ref = parseUpdateBody(body);
          requireSource(ref.sourceId);
          const { catalog } = await collect(panelCwd(undefined));
          const row = findRow(catalog, ref.name);
          if (row === undefined) {
            writeJson(response, 404, fail('E_NOT_FOUND', `no skill named ${ref.name}`));
            return;
          }
          if (row.symlink === true) {
            writeJson(response, 409, fail('E_SYMLINK_READONLY', 'symlinked skills are read-only'));
            return;
          }
          if (row.path === null || typeof row.path !== 'string' || row.path !== ref.path) {
            writeJson(response, 409, fail('E_STALE_PATH', 'skill file moved since the panel loaded'));
            return;
          }
          if (!isWithin(skillsRoot, row.path)) {
            writeJson(response, 409, fail('E_NOT_WRITABLE', 'skill file is outside the skills root'));
            return;
          }
          const upstream = row.upstream ?? null;
          const sameIdentity = upstream !== null
            && upstream.sourceId === ref.sourceId
            && upstream.owner === ref.owner
            && upstream.slug === ref.slug;
          if (!sameIdentity) {
            writeJson(response, 409, fail('E_NOT_MARKET_INSTALLED', 'this directory is not the package the request names'));
            return;
          }
          if (row.version === ref.version) {
            writeJson(response, 409, fail('E_ALREADY_UP_TO_DATE', `the skill is already at ${ref.version}`));
            return;
          }
          const result = await market.installer.update(ref, dirname(row.path));
          writeJson(response, 200, ok({
            name: result.name,
            path: result.path,
            version: result.version,
            from: typeof result.from === 'string' ? result.from : null,
            source: result.source,
            owner: result.owner,
            slug: result.slug,
            files: result.files,
            bytes: result.bytes,
          }));
        } catch (error) {
          marketFailure(response, error, 'market/update');
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.marketFavorite,
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
          // Identity is rebuilt here, never taken from the body: `parseInstallBody` applies
          // the same three whitelists the install route does (and ignores any extra field),
          // and the bookmark key is `marketId(...)` - the key the cards and the ledger use.
          // A request therefore cannot name a key that belongs to no source.
          const ref = parseInstallBody(body);
          requireSource(ref.sourceId);
          if (typeof body.favorited !== 'boolean') {
            throw marketError('E_BAD_REQUEST', 'favorited must be a boolean');
          }
          const result = await market.favorites.toggle(
            marketId(ref.sourceId, ref.owner, ref.slug),
            body.favorited,
          );
          writeJson(response, 200, ok({ favorites: result.favorites, favorited: result.favorited }));
        } catch (error) {
          marketFailure(response, error, 'market/favorite');
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.marketIcons,
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
          const refs = parseIconRequest(body, {
            isKnownSource: (id) => market.sourceById(id) !== undefined,
          });
          // One request per source, in parallel: SkillHub answers in about 0.3s and ClawHub
          // in about 2.7s, so a mixed batch costs max(the two) rather than the sum. A source
          // that fails outright leaves only its own entries null - decoration never turns
          // into an error for the other half of the batch.
          const groups = new Map();
          for (const ref of refs) {
            const list = groups.get(ref.sourceId);
            if (list === undefined) groups.set(ref.sourceId, [ref]);
            else list.push(ref);
          }
          const values = new Map();
          await Promise.all([...groups].map(async ([sourceId, list]) => {
            const source = market.sourceById(sourceId);
            if (typeof source?.icons !== 'function') return;
            // A source only ever sees its own references, in the shape its contract
            // promises: which source an entry belongs to is the router's business.
            const refsOfSource = list.map(({ owner, slug }) => ({ owner, slug }));
            try {
              const answered = await source.icons(refsOfSource, market.io, { now: market.now });
              for (const [key, iconUrl] of Object.entries(answered?.icons ?? {})) {
                values.set(key, {
                  iconUrl: typeof iconUrl === 'string' ? iconUrl : null,
                  displayName: typeof answered?.names?.[key] === 'string' ? answered.names[key] : null,
                });
              }
            } catch {
              // The other source still answers; these entries stay null for both maps.
            }
          }));
          // Filled in request order, so the response cannot shuffle between two identical
          // calls even though the two sources finish in their own time. `names` mirrors
          // `icons` key for key: same order, and a missing title is a null value, not a
          // missing key - the browser walks one map and indexes the other.
          const icons = {};
          const names = {};
          for (const ref of refs) {
            const key = `${ref.sourceId}:${ref.owner}:${ref.slug}`;
            const facts = values.get(key);
            icons[key] = facts?.iconUrl ?? null;
            names[key] = facts?.displayName ?? null;
          }
          writeJson(response, 200, ok({ icons, names }));
        } catch (error) {
          marketFailure(response, error, 'market/icons');
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.add,
      handler: async (request, response) => {
        if (!guard(request, response, 'POST')) return;
        // One field, and only one: the name, the file list and the size are all derived
        // from what the directory says, never from what the caller claims.
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
          writeJson(response, 200, ok(await localSkills.add({ path: body.path })));
        } catch (error) {
          localFailure(response, error, 'add');
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.remove,
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
          const result = await localSkills.remove({ name: body.name, path: body.path });
          // A delete whose ledger record survived is still a success: the row is gone
          // from the panel, and the wording says so instead of failing a finished job.
          writeJson(response, 200, result.ledger === 'kept'
            ? { code: 'OK', data: result, message: 'the skill directory was deleted; its ledger record was kept' }
            : ok(result));
        } catch (error) {
          localFailure(response, error, 'remove');
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
