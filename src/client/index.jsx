/**
 * dsh-skill-panel - Client half.
 *
 * Registers three seats and one stylesheet:
 *   - the sidebar entry (`sidebar.panellist`), with a label that is only a locale
 *     key, so renaming the entry is a JSON edit and never a code edit;
 *   - the global page (`main`, keyed by the same id), so the shell owns the row
 *     box, the selected state, and the "open a conversation and go back to it"
 *     behaviour - none of which this plugin implements;
 *   - the refresh-failure toast (`shell.overlay`), which survives leaving the page.
 *
 * The locale dictionaries are the only place user-facing text exists; this file
 * and every other module under `src/client` are free of literal copy.
 */
import { IconSkillOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';

import en from '../../locale/en.json';
import zh from '../../locale/zh.json';
import { SkillCenterApi } from './api.js';
import { SkillsPage } from './page.jsx';
import { store } from './state.js';
import { injectStyles } from './styles.js';
import { ToastHost } from './toast.jsx';

/** Locale namespace this plugin owns. */
export const NS = 'dsh-skill-panel';

/** The id shared by the sidebar entry and the page it opens. */
export const PANEL_ID = 'dsh-skill-panel';

/** Where the entry sits among the other sidebar rows. */
export const PANEL_ORDER = 40;

/**
 * Services this plugin reads off the client context.
 *
 * Declaring them is not documentation: cordis resolves a service through the fiber's
 * inject declaration and throws `cannot get property "<name>" without inject` on any
 * undeclared read, so a missing entry here fails the whole web boot instead of one
 * panel. `effect` is a core capability and must not be listed.
 *
 * `uiWorkspace` is the shell's session seat: the add menu's second row starts a Creator
 * draft with it (`startSession`), the same call the host's own plugin menu makes.
 */
export const inject = ['slots', 'locale', 'uiWorkspace'];

/**
 * Wrap the shell's session seat into the one call the add menu makes.
 *
 * The menu has to know, before it opens, whether the row can work, so availability is
 * decided once here instead of per click. A shell without the seat - or a `startSession`
 * that throws - leaves `ready` false; the row then renders disabled with its own hint and
 * nothing bubbles up to the page (a menu row must never take the panel down).
 * @param {object} ctx - client root context (declares `uiWorkspace`).
 * @returns {{ready: boolean, start: Function}} the seat, reduced to what the menu needs.
 */
function agentCreatorOf(ctx) {
  let workspace = null;
  try {
    workspace = ctx.uiWorkspace ?? null;
  } catch {
    workspace = null;
  }
  const ready = typeof workspace?.startSession === 'function';
  return {
    ready,
    start: () => {
      if (!ready) return false;
      try {
        // The host's own Creator draft: no draft replacement, the Cordis preset.
        workspace.startSession(undefined, { clearPreviousDraft: false, agentPreset: 'cordis' });
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * The sidebar glyph, at whatever size the shell asks for.
 * @param {{size?: number}} props - the sidebar's icon share.
 * @returns {import('react').ReactElement} the icon.
 */
function SkillsPanelIcon({ size }) {
  return <IconSkillOutlineRegular size={size} />;
}

/**
 * Register the sidebar entry and the global page it opens.
 *
 * Both seats belong to shell plugins this package does not depend on at runtime, so
 * each registration is wrapped in `slots.inject`: the callback runs only once the
 * owning entry declares the seat, and a shell that never declares it leaves the panel
 * merely absent instead of breaking the boot.
 * @param {object} ctx - client root context (slots, locale, uiWorkspace).
 * @param {{store: object, api: object, t: Function, agent: object}} shared - store, API client,
 *   the bound translate, and the Creator seat the add menu may use.
 * @returns {Function[]} disposers releasing both registrations.
 */
function registerPanel(ctx, { store, api, t, agent }) {
  return [
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: PANEL_ORDER,
      label: () => t('panel.label'),
      locale: NS,
    }, SkillsPanelIcon)),
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: PANEL_ID,
      locale: NS,
      inject: () => ({ store, api, agent }),
    }, SkillsPage)),
  ];
}

/**
 * Register the refresh-failure toast in the shell overlay, where it outlives the page.
 * @param {object} ctx - client root context (slots).
 * @param {{store: object}} shared - the page store.
 * @returns {Function[]} disposers releasing the registration.
 */
function registerToast(ctx, { store }) {
  return [
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: `${PANEL_ID}.refresh-toast`,
      locale: NS,
      inject: () => ({ store }),
    }, ToastHost)),
  ];
}

/**
 * Strip the host-facing metadata block before the dictionary reaches `ctx.locale`.
 *
 * `locale/*.json` carries two things: the flat dotted keys the panel renders, and one
 * nested `meta` block that only the Host reads (it names the plugin in the plugin
 * list). `ctx.locale` looks a key up as a literal property of the dictionary it was
 * given, so `meta` would be a dictionary entry holding an object - never a string,
 * never a legal template. Keep it out of the runtime dictionary.
 * @param {Record<string, unknown>} dictionary - a locale file's contents.
 * @returns {Record<string, string>} the UI keys only, all strings.
 */
function uiDictionary(dictionary) {
  return Object.fromEntries(
    Object.entries(dictionary).filter(([key, value]) => key !== 'meta' && typeof value === 'string'),
  );
}

/**
 * Mount the skill center surfaces.
 * @param {object} ctx - client root context carrying slots and locale.
 * @returns {void}
 */
export function apply(ctx) {
  ctx.effect(
    () => ctx.locale.register(NS, { zh: uiDictionary(zh), en: uiDictionary(en) }),
    'dsh-skill-panel: dictionaries',
  );
  injectStyles();
  const t = ctx.locale.bind(NS);
  const api = new SkillCenterApi();
  const disposers = [];
  disposers.push(...registerPanel(ctx, { store, api, t, agent: agentCreatorOf(ctx) }));
  disposers.push(...registerToast(ctx, { store }));
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) dispose();
  }, 'dsh-skill-panel: ui mounts');
}
