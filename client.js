window.__ModuleLoader__.load({
	id: "dsh-skill-center",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.jsx
var index_exports = {};
__export(index_exports, {
  NS: () => NS,
  PANEL_ID: () => PANEL_ID,
  PANEL_ORDER: () => PANEL_ORDER,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_dsh_client_ui_primitives4 = require("@deepseek-ai/dsh-client-ui-primitives");

// locale/en.json
var en_default = {
  meta: {
    title: "Skills",
    description: "Tell built-in, local, and market-installed skills apart at a glance, and switch each one on or off."
  },
  "panel.label": "Skills",
  "page.title": "Skills",
  "page.intro": "Turn skills on or off and see where they come from",
  "page.infoLabel": "About skills",
  "page.infoDescription": "Turn skills on or off here. Built-in skills, local skills, and skills installed from the market appear in three groups.",
  "page.refresh": "Refresh",
  "page.loading": "Reading skills...",
  "page.error": "Some skills could not be read. This may be a network problem.",
  "page.retry": "Retry",
  "page.refreshError": "Refresh failed. Please try again.",
  "tabs.label": "Skill partitions",
  "tabs.installed": "Installed",
  "tabs.market": "Skill market",
  "group.builtin": "Built-in skills",
  "group.local": "Local skills",
  "group.installed": "Installed skills",
  "group.builtinEmpty": "This deployment has no built-in skills.",
  "group.localEmpty": "No local skills yet. Put a skill directory in ~/.dsh/skills/ and it appears here.",
  "group.installedEmpty": "No skills installed from the market yet.",
  "footer.excluded": "{count} more skills live in project-level or other directories and are not shown in this version",
  "status.count": "{total} skills",
  "status.offSuffix": ", {count} turned off",
  "market.placeholder": "The skill market will be available in a later version.",
  "row.enable": "Enable {name}",
  "row.disable": "Disable {name}",
  "row.applying": "Applying the change to {name}",
  "row.symlinkReadonly": "Symlink - read-only",
  "row.symlinkTitle": "This is a symlink (to {path}); this panel never modifies it",
  "add.label": "Add skill",
  "add.comingSoon": "Coming soon",
  "error.E_NOT_FOUND": "This skill no longer exists. Please refresh.",
  "error.E_BAD_NAME": "That skill name is not valid; nothing was changed.",
  "error.E_BAD_PATH": "That skill file path is not valid; nothing was changed.",
  "error.E_STALE_PATH": "The skill file moved. Please refresh and try again.",
  "error.E_SYMLINK_READONLY": "A symlinked skill is read-only; nothing was changed.",
  "error.E_FILE_CHANGED": "The skill file changed while you were working. Please refresh and try again.",
  "error.E_NOT_WRITABLE": "This skill has no writable local file.",
  "error.E_WRITE_FAILED": "Could not write the skill file: {reason}",
  "error.E_VERIFY_FAILED": "The file did not read back as written and was rolled back.",
  "error.E_FORBIDDEN": "Request refused (local access only).",
  "error.E_UNKNOWN": "The action failed: {reason}"
};

// locale/zh.json
var zh_default = {
  meta: {
    title: "技能",
    description: "一眼分清内置、本地与市场安装的技能，逐行启用或停用。"
  },
  "panel.label": "技能",
  "page.title": "技能",
  "page.intro": "启用、停用和查看技能来源",
  "page.infoLabel": "关于技能",
  "page.infoDescription": "在这里启用或停用技能。内置技能、本地技能和从市场安装的技能分三组展示。",
  "page.refresh": "刷新",
  "page.loading": "正在读取技能…",
  "page.error": "可能由于网络问题，无法读取全部技能",
  "page.retry": "重试",
  "page.refreshError": "刷新失败，请重试",
  "tabs.label": "技能分区",
  "tabs.installed": "已安装",
  "tabs.market": "技能市场",
  "group.builtin": "内置技能配置",
  "group.local": "本地技能",
  "group.installed": "已安装技能",
  "group.builtinEmpty": "这个部署没有内置技能。",
  "group.localEmpty": "还没有本地技能。把技能目录放进 ~/.dsh/skills/ 就会出现。",
  "group.installedEmpty": "还没有从市场安装技能。",
  "footer.excluded": "另有 {count} 个技能位于项目级或其他目录，首版不展示",
  "status.count": "共 {total} 个技能",
  "status.offSuffix": "，{count} 个已停用",
  "market.placeholder": "技能市场将在后续版本提供。",
  "row.enable": "启用 {name}",
  "row.disable": "停用 {name}",
  "row.applying": "正在应用 {name} 的更改",
  "row.symlinkReadonly": "软链·只读",
  "row.symlinkTitle": "这是一个软链（指向 {path}），本面板不会修改它",
  "add.label": "添加技能",
  "add.comingSoon": "即将支持",
  "error.E_NOT_FOUND": "这个技能已不存在，请刷新",
  "error.E_BAD_NAME": "技能名不合规范，未做任何修改",
  "error.E_BAD_PATH": "技能文件路径不合规范，未做任何修改",
  "error.E_STALE_PATH": "技能文件位置已变化，请刷新后重试",
  "error.E_SYMLINK_READONLY": "软链技能只读，未做任何修改",
  "error.E_FILE_CHANGED": "技能文件在你操作期间被修改，请刷新后重试",
  "error.E_NOT_WRITABLE": "这个技能没有可写的本地文件",
  "error.E_WRITE_FAILED": "写入技能文件失败：{reason}",
  "error.E_VERIFY_FAILED": "写入后回读不一致，已回滚",
  "error.E_FORBIDDEN": "请求被拒绝（仅限本机访问）",
  "error.E_UNKNOWN": "操作失败：{reason}"
};

// src/client/api.js
var ApiError = class extends Error {
  /**
   * @param {string} code - `E_*` code from the route, or E_UNKNOWN for a local failure.
   * @param {string} message - English developer note.
   */
  constructor(code, message) {
    super(message === "" ? code : message);
    this.name = "ApiError";
    this.code = code;
  }
};
var BASE = "api/dsh-skill-center";
var SkillCenterApi = class {
  /**
   * @param {Function} [fetchImpl] - fetch implementation; defaults to the global one.
   */
  constructor(fetchImpl) {
    this.fetchImpl = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  }
  /**
   * Call one route and unwrap the envelope.
   * @param {string} path - document-relative route path.
   * @param {object} [init] - fetch init.
   * @returns {Promise<unknown>} the envelope's `data`.
   * @throws {ApiError} when the transport fails or the route answers a non-OK code.
   */
  async request(path, init) {
    let response;
    try {
      response = await this.fetchImpl(`${BASE}/${path}`, init);
    } catch (cause) {
      throw new ApiError("E_UNKNOWN", cause instanceof Error ? cause.message : String(cause));
    }
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (body === null || typeof body !== "object" || typeof body.code !== "string") {
      throw new ApiError("E_UNKNOWN", `unexpected response (${response.status})`);
    }
    if (body.code !== "OK") {
      throw new ApiError(body.code, typeof body.message === "string" ? body.message : "");
    }
    return body.data;
  }
  /**
   * Read the whole catalogue.
   * @returns {Promise<object>} ListPayload.
   */
  async list() {
    return this.request("list");
  }
  /**
   * Enable or disable one file-backed skill.
   * @param {{name: string, path: string, enabled: boolean}} payload - the row identity and the target state.
   * @returns {Promise<object>} toggle result.
   */
  async toggle(payload) {
    return this.request("toggle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: payload.name, path: payload.path, enabled: payload.enabled === true })
    });
  }
  /**
   * Enable or disable one provider-backed (built-in) skill.
   * @param {{provider: string, name: string, enabled: boolean}} payload - the identity and the target state.
   * @returns {Promise<object>} provider toggle result.
   */
  async toggleProvider(payload) {
    return this.request("provider-toggle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: payload.provider ?? "", name: payload.name, enabled: payload.enabled === true })
    });
  }
};

// src/client/page.jsx
var import_react = require("react");
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/styles.js
var PREFIX = "skc_";
var STYLE_ID = "dsh-skill-center/client.css";
function cn(...names) {
  return names.map((name) => `${PREFIX}${name}`).join(" ");
}
var CSS = `
/* page shell */
.skc_page{
  --skc-page-inset: clamp(24px, 4vw, 48px);
  --skc-page-top-inset: 28px;
  --skc-progress-size: 14px;
  --skc-toggle-gap: 8px;
  box-sizing: border-box; height: 100%; padding: 0 var(--skc-page-inset);
  color: var(--dsw-alias-label-primary);
  display: flex; flex-direction: column; align-items: center;
}
@media (width <= 767px){ .skc_page{ --skc-page-inset: 20px } }
.skc_page > *{ flex: none; width: 100%; max-width: 960px }

/* scroll container and header bar */
.skc_pageBody{
  min-height: 0;
  width: calc(100% + 2 * var(--skc-page-inset));
  max-width: none; margin-inline: calc(-1 * var(--skc-page-inset));
  box-sizing: border-box; padding: 0 var(--skc-page-inset) 48px;
  scroll-padding-top: var(--skc-header-scroll-padding, 0px);
  display: flex; flex: 1; flex-direction: column; align-items: center; gap: 32px;
  position: relative; overflow: hidden auto;
}
.skc_pageBody > *{ flex: none; width: 100%; max-width: 960px }
.skc_pageBar{
  width: calc(100% + 2 * var(--skc-page-inset) + var(--skc-page-scrollbar-width, 0px));
  max-width: none; margin-inline: calc(-1 * var(--skc-page-inset));
  box-sizing: border-box; padding-inline: var(--skc-page-inset);
  display: flex; flex-direction: column; align-self: flex-start;
  position: relative; container: skc-page-bar / inline-size;
}
.skc_pageBar > .skc_pageHead{ align-self: center; width: 100%; max-width: 960px }
.skc_pageBody > .skc_pageBar[data-measuring]{
  visibility: hidden; pointer-events: none; margin: 0; position: absolute; top: 0; left: 0;
}
.skc_pageBody > .skc_pageBar[data-natural]{ z-index: 2; pointer-events: none; position: sticky; top: 0 }
.skc_pageBar[data-natural] .skc_pageHead{
  height: var(--skc-header-rest-height);
  clip-path: inset(0 0 max(0px, calc(var(--skc-header-rest-height) - var(--skc-header-paint-height))) 0);
  pointer-events: auto; position: relative;
}
.skc_pageBar[data-natural] .skc_pageHeading{ display: contents }
.skc_pageBar[data-natural] [data-skc-header-part]{
  left: var(--skc-part-x); top: var(--skc-part-y); width: var(--skc-part-width);
  pointer-events: auto; margin: 0; position: absolute;
}
.skc_pageBar[data-natural] .skc_pageTabs{ z-index: 2; pointer-events: none }
.skc_pageBar[data-natural] .skc_pageTabList{ pointer-events: auto }
.skc_pageBar[data-natural]:before{
  content: ""; height: var(--skc-header-paint-height, var(--skc-header-rest-height));
  background: var(--dsw-alias-bg-base); pointer-events: none; position: absolute; inset: 0 0 auto;
}
.skc_pageBar[data-natural][data-compact]:after{
  content: ""; inset-inline: 0; height: var(--skc-header-compact-height);
  box-sizing: border-box; border-bottom: .5px solid var(--dsw-alias-border-l3);
  position: absolute; top: 0;
}

/* page head */
.skc_pageHead{
  box-sizing: border-box; padding-top: var(--skc-page-top-inset);
  display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 16px;
}
[data-platform=darwin] .skc_pageHead{
  padding-top: calc(var(--skc-page-top-inset) + var(--dsh-frame-top-clearance, 0px));
}
.skc_pageHeading{ order: 1; min-width: 0; max-width: 100% }
.skc_pageTitle{ margin: 0; font-size: 20px; font-weight: 500; line-height: 28px }
.skc_pageIntro{
  color: var(--dsw-alias-label-secondary);
  align-items: center; gap: 4px; margin: 4px 0 0; font-size: 13px; line-height: 20px; display: flex;
}
.skc_infoButton{ width: 20px; height: 20px; color: var(--dsw-alias-label-caption); flex: none; padding: 0 }
.skc_toolbar{
  white-space: nowrap; flex-wrap: wrap; flex: 0 auto; order: 2;
  justify-content: flex-end; align-items: center; gap: 8px 16px; min-width: 0; display: flex;
}
.skc_toolbar[hidden]{ display: none }
.skc_status{ color: var(--dsw-alias-label-tertiary); margin: 0; font-size: 12px; line-height: 18px }
.skc_addButton, .skc_addPrimary, .skc_addMore{
  border-radius: var(--dsw-radius-md); height: 32px; padding: 0 12px; font-size: 13px; line-height: 20px;
}
.skc_addGroup{ flex: none; align-items: stretch; display: inline-flex }
.skc_addPrimary{ border-top-right-radius: 0; border-bottom-right-radius: 0 }
.skc_addMore{
  border-left: .5px solid color-mix(in srgb, var(--dsw-alias-label-primary-foreground) 30%, transparent);
  border-top-left-radius: 0; border-bottom-left-radius: 0; width: 32px; padding: 0;
}
.skc_pageTabs{ flex: 100%; order: 3; display: flex }
.skc_pageTabList{ width: fit-content; min-width: 240px }

/* partitions */
.skc_installedPanel{ flex-direction: column; gap: 32px; display: flex }
.skc_tabPanel{ flex-direction: column; gap: 24px; display: flex }
.skc_group{ flex-direction: column; gap: 8px; display: flex }
.skc_groupHead{ align-items: center; gap: 8px; display: flex }
.skc_groupTitle{ flex: 1; margin: 0; font-size: 14px; font-weight: 500; line-height: 22px }

/* rows */
.skc_cards{ flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; display: flex }
.skc_card{ border-radius: var(--dsw-radius-xl); min-width: 0; margin: 0 -8px }
.skc_cardHead{ align-items: center; gap: 14px; padding: 8px; display: flex }
.skc_cardIcon{
  box-sizing: border-box;
  border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-lg);
  width: 48px; height: 48px; color: var(--dsw-alias-label-secondary); flex: none;
  justify-content: center; align-items: center; display: inline-flex;
}
.skc_cardMain{ flex-direction: column; flex: 1; gap: 4px; min-width: 0; display: flex }
.skc_titleRow{ flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; display: flex }
.skc_cardTitle{
  text-overflow: ellipsis; white-space: nowrap;
  font-size: 14px; font-weight: 500; line-height: 20px; overflow: hidden;
}
.skc_cardDesc{
  color: var(--dsw-alias-label-tertiary); display: -webkit-box;
  -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;
  font-size: 13px; line-height: 18px;
}
.skc_cardEnd{ z-index: 1; flex: none; align-items: center; gap: 8px; display: inline-flex; position: relative }

/* switch seat, read-only tag, skeleton */
.skc_bundleToggle{ align-items: center; gap: var(--skc-toggle-gap); display: inline-flex }
.skc_toggleProgress{ width: var(--skc-progress-size); height: var(--skc-progress-size); display: inline-flex }
.skc_toggleProgress > svg{ width: 100%; height: 100% }
.skc_progressAnnouncement{
  clip-path: inset(50%); white-space: nowrap; width: 1px; height: 1px; position: absolute; overflow: hidden;
}
.skc_roTag{
  border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-secondary); height: 18px; padding: 0 6px;
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; line-height: 18px; white-space: nowrap;
}
.skc_roTag > svg{ width: 12px; height: 12px; flex: none }
.skc_skeletonFill{
  background: var(--dsw-alias-bg-skeleton);
  animation: 2s cubic-bezier(.36, 0, .64, 1) infinite skc-skeleton;
}
@keyframes skc-skeleton{ 0%{opacity:1} 40%{opacity:.6} 80%,100%{opacity:1} }
@media (prefers-reduced-motion: reduce){ .skc_skeletonFill{ animation: none } }
.skc_skeletonText{ align-items: center; height: 1lh; display: flex }
.skc_skeletonBar{ border-radius: var(--dsw-radius-xs); width: 100%; height: 12px }
.skc_skeletonHeading{ width: 48px }
.skc_skeletonTitle{ width: min(144px, 60%) }
.skc_skeletonDescription{ width: min(280px, 85%) }
.skc_skeletonIcon{ border-color: #0000 }
.skc_skeletonActions{ width: calc(36px + var(--skc-toggle-gap) + var(--skc-progress-size)); height: 20px }

/* empty, failure, inline reason, footer */
.skc_empty{ color: var(--dsw-alias-label-tertiary); margin: 0; font-size: 13px; line-height: 20px }
.skc_failure{ color: var(--dsw-alias-state-error-primary); align-items: center; gap: 10px; display: flex }
.skc_failure p{ color: var(--dsw-alias-label-tertiary); margin: 0; font-size: 13px; line-height: 20px }
.skc_statusWithDot{ align-items: center; gap: 6px; display: inline-flex }
.skc_reason{
  color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; white-space: pre-wrap;
  margin: 0; font-size: 12px; line-height: 18px;
}
.skc_footer{ color: var(--dsw-alias-label-tertiary); margin: 0; font-size: 13px; line-height: 20px }

/* compact state without the sticky path */
.skc_pageBar[data-compact]:not([data-natural]){ --skc-page-top-inset: 16px; padding-bottom: 16px }
[data-platform=darwin] .skc_pageBar[data-compact]:not([data-natural]) .skc_pageHead{
  padding-top: var(--skc-page-top-inset);
}
[data-platform=darwin] [data-sidebar-collapsed] .skc_pageBar[data-compact]:not([data-natural]) .skc_pageHead{
  --skc-page-top-inset: 8px;
  padding-top: calc(var(--skc-page-top-inset) + var(--dsh-frame-top-clearance, 0px));
}
.skc_pageBar[data-compact]:not([data-natural]):after{
  content: ""; inset-inline: 0; border-bottom: .5px solid var(--dsw-alias-border-l3);
  pointer-events: none; position: absolute; bottom: 0;
}
.skc_pageBar[data-compact]:not([data-natural]) .skc_pageHead{ align-items: center }
.skc_pageBar[data-compact]:not([data-natural]) .skc_pageIntro{ display: none }
.skc_pageBarWithTabs[data-compact]:not([data-natural]) .skc_pageHeading{
  clip: rect(0 0 0 0); white-space: nowrap; width: 1px; height: 1px; position: absolute; overflow: hidden;
}
.skc_pageBarWithTabs[data-compact]:not([data-natural]) .skc_pageTabs{ flex: none; order: 1 }

/* narrow pages */
@container skc-page-bar (width < 600px){
  .skc_pageBarWithTabs .skc_pageHead{ align-items: center }
  .skc_pageBarWithTabs .skc_pageHeading{ flex-basis: 100% }
  .skc_pageBarWithTabs .skc_pageTabs{ flex: none; order: 2 }
  .skc_pageBarWithTabs .skc_toolbar{ order: 3 }
  .skc_toolbarLabel{ display: none }
  .skc_pageHead .skc_addButton, .skc_pageHead .skc_addPrimary{
    width: 32px; min-width: 32px; padding-inline: 0;
  }
  .skc_toolbar{ flex-shrink: 0; max-width: 100% }
}
@container skc-page-bar (width < 372px){ .skc_pageTabList{ min-width: 0 } }
`;
function injectStyles() {
  if (typeof document === "undefined") return;
  const selector = `style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`;
  if (document.querySelector(selector) !== null) return;
  const tag = document.createElement("style");
  tag.dataset.pluginCss = STYLE_ID;
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

// src/client/header-scroll.js
var PARTS = ["title", "intro", "toolbar", "tabs"];
function interpolateParts(parts, offset) {
  const clamped = Number.isFinite(offset) && offset > 0 ? offset : 0;
  return parts.map((part) => {
    const distance = Math.max(1, part.distance);
    const progress = Math.min(1, clamped / distance);
    const translateX = (part.to.x - part.from.x) * progress;
    const translateY = (part.to.y - part.from.y) * progress;
    const width = part.from.width + (part.to.width - part.from.width) * progress;
    let clipPath = null;
    if (part.clipStart !== void 0 && part.clipEnd !== void 0) {
      const span = Math.max(1, part.clipEnd - part.clipStart);
      const clip = Math.max(0, Math.min(1, (clamped - part.clipStart) / span));
      clipPath = `inset(${clip * 100}% 0 0)`;
    }
    const inert = part.clipEnd !== void 0 && clamped >= part.clipEnd;
    return {
      translate: `${translateX}px ${translateY}px`,
      width: `${width}px`,
      clipPath,
      inert
    };
  });
}
function measure(bar) {
  const body = bar.parentElement;
  if (body === null) return null;
  const clone = (
    /** @type {HTMLElement} */
    bar.cloneNode(true)
  );
  clone.removeAttribute("data-natural");
  clone.removeAttribute("data-compact");
  clone.removeAttribute("data-scrolled");
  clone.setAttribute("data-measuring", "");
  clone.setAttribute("aria-hidden", "true");
  clone.style.width = `${bar.getBoundingClientRect().width}px`;
  for (const element of clone.querySelectorAll("[id], [data-skc-header-part]")) {
    element.removeAttribute("id");
    if (element.hasAttribute("data-skc-header-part")) element.removeAttribute("style");
  }
  body.append(clone);
  const snapshot = () => {
    const head = clone.querySelector("header");
    if (head === null) return { height: clone.getBoundingClientRect().height, boxes: /* @__PURE__ */ new Map() };
    const headBox = head.getBoundingClientRect();
    const boxes = /* @__PURE__ */ new Map();
    for (const name of PARTS) {
      const element = clone.querySelector(`[data-skc-header-part="${name}"]`);
      if (element === null) continue;
      const box = element.getBoundingClientRect();
      boxes.set(name, {
        x: box.x - headBox.x,
        y: box.y - headBox.y,
        width: box.width,
        height: box.height
      });
    }
    return { height: clone.getBoundingClientRect().height, boxes };
  };
  let resting;
  let compact;
  try {
    resting = snapshot();
    clone.setAttribute("data-compact", "");
    compact = snapshot();
  } finally {
    clone.remove();
  }
  return {
    height: resting.height,
    compactHeight: compact.height,
    boxes: resting.boxes,
    compactBoxes: compact.boxes
  };
}
function attachHeader(bar) {
  const body = bar.parentElement;
  if (body === null) return () => {
  };
  const parts = [];
  const state = { distance: 1, restHeight: 0, compactHeight: 0, disposed: false };
  const scroll = () => {
    const offset = Math.max(0, body.scrollTop);
    bar.toggleAttribute("data-compact", offset >= state.distance);
    bar.toggleAttribute("data-scrolled", offset > 0);
    const frames = interpolateParts(parts, offset);
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const frame = frames[index];
      part.element.style.translate = frame.translate;
      part.element.style.width = frame.width;
      if (frame.clipPath === null) part.element.style.removeProperty("clip-path");
      else part.element.style.clipPath = frame.clipPath;
      if (part.element.dataset.skcHeaderPart === "intro") part.element.inert = frame.inert;
    }
    bar.style.setProperty("--skc-header-paint-height", `${Math.max(state.compactHeight, state.restHeight - offset)}px`);
  };
  const remeasure = () => {
    if (state.disposed) return;
    body.style.setProperty("--skc-page-scrollbar-width", `${body.offsetWidth - body.clientWidth}px`);
    const measured = measure(bar);
    if (measured === null) return;
    state.restHeight = measured.height;
    state.compactHeight = measured.compactHeight;
    state.distance = Math.max(1, state.restHeight - state.compactHeight);
    parts.length = 0;
    const hasTabs = measured.boxes.has("tabs");
    const compactTitle = measured.compactBoxes.get("title");
    for (const name of PARTS) {
      const from = measured.boxes.get(name);
      if (from === void 0) continue;
      const element = bar.querySelector(`[data-skc-header-part="${name}"]`);
      if (element === null) continue;
      let to = measured.compactBoxes.get(name);
      let clipStart;
      let clipEnd;
      if (name === "intro" || name === "title" && hasTabs) {
        to = { ...from, y: -from.height };
        if (name === "intro" && !hasTabs && compactTitle !== void 0) {
          clipStart = Math.max(0, from.y - compactTitle.y - compactTitle.height);
          clipEnd = clipStart + from.height;
          to = { ...from, y: from.y - clipEnd };
        }
      }
      if (to === void 0) continue;
      const travel = Math.max(1, Math.abs(to.y - from.y));
      state.distance = Math.max(state.distance, travel);
      element.style.setProperty("--skc-part-x", `${from.x}px`);
      element.style.setProperty("--skc-part-y", `${from.y}px`);
      element.style.setProperty("--skc-part-width", `${from.width}px`);
      parts.push({
        element,
        from,
        to,
        distance: travel,
        clipStart,
        clipEnd
      });
    }
    bar.style.setProperty("--skc-header-rest-height", `${state.restHeight}px`);
    bar.style.setProperty("--skc-header-compact-height", `${state.compactHeight}px`);
    bar.style.setProperty("--skc-header-travel", `${state.distance}px`);
    body.style.setProperty("--skc-header-scroll-padding", `${state.compactHeight + 8}px`);
    bar.setAttribute("data-natural", "");
    scroll();
  };
  remeasure();
  const head = bar.querySelector("header");
  const resize = new ResizeObserver(remeasure);
  resize.observe(body);
  const mutation = head === null ? null : new MutationObserver(remeasure);
  mutation?.observe(head, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden"]
  });
  body.addEventListener("scroll", scroll, { passive: true });
  const fonts = typeof document !== "undefined" ? document.fonts : void 0;
  fonts?.addEventListener("loadingdone", remeasure);
  return () => {
    state.disposed = true;
    resize.disconnect();
    mutation?.disconnect();
    body.removeEventListener("scroll", scroll);
    fonts?.removeEventListener("loadingdone", remeasure);
    body.style.removeProperty("--skc-header-scroll-padding");
    body.style.removeProperty("--skc-page-scrollbar-width");
  };
}

// src/client/skeleton.jsx
var import_jsx_runtime = require("react/jsx-runtime");
var ROWS = [0, 1, 2, 3];
function ListSkeleton({ label }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: cn("group"), role: "status", "aria-label": label, "data-skc-loading": "", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: cn("groupHead"), "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cn("groupTitle", "skeletonText", "skeletonHeading"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cn("skeletonFill", "skeletonBar") }) }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: cn("cards"), "aria-hidden": "true", children: ROWS.map((index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { className: cn("card"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: cn("cardHead"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cn("cardIcon", "skeletonFill", "skeletonIcon") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: cn("cardMain"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: cn("titleRow"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cn("cardTitle", "skeletonText", "skeletonTitle"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cn("skeletonFill", "skeletonBar") }) }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cn("cardDesc", "skeletonText", "skeletonDescription"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cn("skeletonFill", "skeletonBar") }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: cn("cardEnd", "skeletonActions") })
    ] }) }, index)) })
  ] });
}

// src/client/row.jsx
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/model.js
var TAB_INSTALLED = "installed";
var TAB_MARKET = "market";
var ROW_ERRORS = /* @__PURE__ */ new Set([
  "E_NOT_FOUND",
  "E_BAD_NAME",
  "E_BAD_PATH",
  "E_STALE_PATH",
  "E_SYMLINK_READONLY",
  "E_FILE_CHANGED",
  "E_NOT_WRITABLE",
  "E_WRITE_FAILED",
  "E_VERIFY_FAILED"
]);
var PARTITION_KEYS = ["builtin", "local", "installed"];
function rowKey(row) {
  return `${row?.provider ?? ""}#${row?.name ?? ""}`;
}
function switchMode(row) {
  if (row?.readonlyReason === "provider-store" && row.partition === "builtin") return "provider";
  if (row?.writable === true && row.symlink !== true) return "file";
  return null;
}
function toGroups(payload) {
  const source = Array.isArray(payload?.groups) ? payload.groups : [];
  return PARTITION_KEYS.map((key) => {
    const group = source.find((candidate) => candidate?.key === key);
    return { key, skills: Array.isArray(group?.skills) ? group.skills : [] };
  });
}
function statusLine(counts, t) {
  const total = Number.isInteger(counts?.total) ? counts.total : 0;
  const disabled = Number.isInteger(counts?.disabled) ? counts.disabled : 0;
  const head = t("status.count", { total });
  if (disabled <= 0) return head;
  return `${head}${t("status.offSuffix", { count: disabled })}`;
}
function rowViewState(row, rows) {
  const state = rows?.get?.(rowKey(row));
  if (state === void 0 || state === null) return "idle";
  if (state.pending === true) return "pending";
  if (typeof state.reason === "string" && state.reason !== "") return "failed";
  return "idle";
}
function isPending(rows, key) {
  return rows?.get?.(key)?.pending === true;
}
function groupEmptyKey(key) {
  return `group.${key}Empty`;
}
function reasonText(code, reason, t) {
  const known = ROW_ERRORS.has(code) ? code : "E_UNKNOWN";
  return t(`error.${known}`, { reason: reason ?? "" });
}

// src/client/row.jsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var GLYPH_SIZE = 36;
function ReadonlyTag({ row, t }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: cn("roTag"), title: t("row.symlinkTitle", { path: row.realPath ?? "" }), children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.IconLinkOutlineRegular, { size: 12, "aria-hidden": "true" }),
    t("row.symlinkReadonly")
  ] });
}
function EnableSwitch({ row, t, pending, onToggle }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: cn("bundleToggle"), children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: cn("toggleProgress"), role: "status", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: cn("progressAnnouncement"), children: pending ? t("row.applying", { name: row.name }) : "" }),
      pending ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.StateDot, { state: "ongoing" }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      import_dsh_client_ui_primitives.Switch,
      {
        checked: row.enabled,
        label: t("row.enable", { name: row.name }),
        title: t(row.enabled ? "row.disable" : "row.enable", { name: row.name }),
        disabled: pending,
        onChange: (next) => onToggle(row, next)
      }
    )
  ] });
}
function SkillRow({ row, t, rows, onToggle }) {
  const key = rowKey(row);
  const view = rowViewState(row, rows);
  const reason = rows?.get?.(key)?.reason ?? null;
  const mode = switchMode(row);
  const end = mode === null ? row.readonlyReason === "symlink" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ReadonlyTag, { row, t }) : null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(EnableSwitch, { row, t, pending: isPending(rows, key), onToggle });
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { className: cn("card"), "data-skc-row": key, "data-skc-state": view, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: cn("cardHead"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: cn("cardIcon"), "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.IconSkillOutlineRegular, { size: GLYPH_SIZE }) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: cn("cardMain"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: cn("titleRow"), children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: cn("cardTitle"), title: row.displayName ?? void 0, children: row.name }) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: cn("cardDesc"), title: row.description, children: row.description })
      ] }),
      end === null ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: cn("cardEnd"), children: end })
    ] }),
    reason === null ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: cn("reason"), role: "alert", children: reason })
  ] });
}

// src/client/page.jsx
var import_jsx_runtime3 = require("react/jsx-runtime");
var MIN_INDICATOR_MS = 400;
var identityTranslate = (key) => key;
function SkillsPage({ t = identityTranslate, store: store2, api }) {
  const state = (0, import_react.useSyncExternalStore)(store2.subscribe, store2.getSnapshot, store2.getSnapshot);
  const tabsId = (0, import_react.useId)();
  const [refreshing, setRefreshing] = (0, import_react.useState)(false);
  const busy = (0, import_react.useRef)(false);
  const disposeHeader = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => () => {
    disposeHeader.current?.();
    disposeHeader.current = null;
  }, []);
  const headerRef = (0, import_react.useCallback)((element) => {
    disposeHeader.current?.();
    disposeHeader.current = null;
    if (element !== null && element !== void 0) disposeHeader.current = attachHeader(element);
  }, []);
  const load = (0, import_react.useCallback)(async (mode) => {
    if (busy.current) return;
    busy.current = true;
    const previous = store2.getSnapshot().payload;
    if (mode === "refresh") setRefreshing(true);
    store2.actions.loading();
    const startedAt = Date.now();
    let failed = null;
    try {
      const payload = await api.list();
      store2.actions.ready(payload);
    } catch (error) {
      failed = { code: error?.code ?? "E_UNKNOWN", message: error?.message ?? "" };
      if (mode === "refresh" && previous !== null) store2.actions.refreshFailed(failed);
      else store2.actions.failed(failed);
    } finally {
      const elapsed = Date.now() - startedAt;
      if (mode === "refresh" && elapsed < MIN_INDICATOR_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_INDICATOR_MS - elapsed));
      }
      setRefreshing(false);
      busy.current = false;
    }
    return failed;
  }, [api, store2]);
  (0, import_react.useEffect)(() => {
    if (store2.getSnapshot().status !== "idle") return;
    void load("initial");
  }, [load, store2]);
  const onToggle = (0, import_react.useCallback)(async (row, enabled) => {
    const key = rowKey(row);
    store2.actions.pending(key);
    try {
      if (switchMode(row) === "provider") {
        await api.toggleProvider({ provider: row.provider ?? "", name: row.name, enabled });
      } else {
        await api.toggle({ name: row.name, path: row.path, enabled });
      }
      store2.actions.commit(key, enabled);
    } catch (error) {
      const code = error?.code ?? "E_UNKNOWN";
      store2.actions.fail(key, reasonText(code, error?.message ?? "", t));
    }
  }, [api, store2, t]);
  const groups = toGroups(state.payload);
  const counts = state.payload?.counts;
  const excluded = Number.isInteger(counts?.excluded) ? counts.excluded : 0;
  const showsInstalled = state.tab === TAB_INSTALLED;
  const loadingFirst = state.status === "loading" && state.payload === null;
  const failedFirst = state.status === "error" && state.payload === null;
  const renderGroup = (group) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: cn("group"), "data-skc-group": group.key, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: cn("groupHead"), children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { className: cn("groupTitle"), children: t(`group.${group.key}`) }) }),
    group.skills.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: cn("empty"), children: t(groupEmptyKey(group.key)) }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("ul", { className: cn("cards"), children: group.skills.map((row) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(SkillRow, { row, t, rows: state.rows, onToggle }, rowKey(row))) })
  ] }, group.key);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("section", { className: cn("page"), "data-skc-panel": "", "aria-busy": state.status === "loading" || refreshing, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: cn("pageBody"), "data-skc-body": "", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "div",
      {
        className: cn("pageBar", "pageBarWithTabs"),
        "data-skc-bar": "",
        ref: headerRef,
        children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("header", { className: cn("pageHead"), "data-window-drag": "", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: cn("pageHeading"), children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h1", { className: cn("pageTitle"), "data-skc-header-part": "title", children: t("page.title") }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: cn("pageIntro"), "data-skc-header-part": "intro", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: t("page.intro") }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                import_dsh_client_ui_primitives2.Tooltip,
                {
                  label: t("page.infoDescription"),
                  side: "bottom",
                  delayMs: 300,
                  maxWidth: 300,
                  portal: true,
                  openOnClick: true,
                  children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                    import_dsh_client_ui_primitives2.Button,
                    {
                      variant: "ghost",
                      size: "sm",
                      className: cn("infoButton"),
                      "aria-label": t("page.infoLabel"),
                      children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconInfoOutlineRegular, { size: 11, "aria-hidden": "true" })
                    }
                  )
                }
              )
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
            "div",
            {
              className: cn("toolbar"),
              "data-skc-header-part": "toolbar",
              hidden: !showsInstalled,
              children: [
                state.payload === null ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: cn("status"), children: statusLine(counts, t) }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                  import_dsh_client_ui_primitives2.Tooltip,
                  {
                    label: t("page.refresh"),
                    delayMs: 500,
                    focusDelayMs: 500,
                    side: "bottom",
                    portal: true,
                    disabled: refreshing,
                    children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                      import_dsh_client_ui_primitives2.Button,
                      {
                        variant: "outline",
                        size: "sm",
                        className: cn("addButton"),
                        "aria-label": t("page.refresh"),
                        "aria-busy": refreshing,
                        disabled: refreshing,
                        onClick: () => void load("refresh"),
                        icon: refreshing ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.StateDot, { state: "ongoing", size: 13 }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconRefreshOutlineRegular, { size: 13 }),
                        children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: cn("toolbarLabel"), children: t("page.refresh") })
                      }
                    )
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: cn("addGroup"), role: "group", "aria-label": t("add.label"), title: t("add.comingSoon"), children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                    import_dsh_client_ui_primitives2.Button,
                    {
                      variant: "primary",
                      size: "sm",
                      className: cn("addPrimary"),
                      "aria-label": t("add.label"),
                      disabled: true,
                      icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconPlusOutlineRegular, { size: 13 }),
                      children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: cn("toolbarLabel"), children: t("add.label") })
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                    import_dsh_client_ui_primitives2.Button,
                    {
                      variant: "primary",
                      size: "sm",
                      className: cn("addMore"),
                      "aria-label": t("add.comingSoon"),
                      disabled: true,
                      children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconChevronDownOutlineRegular, { size: 13, "aria-hidden": "true" })
                    }
                  )
                ] })
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: cn("pageTabs"), "data-skc-header-part": "tabs", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            import_dsh_client_ui_primitives2.SegmentedTabs,
            {
              size: "sm",
              className: cn("pageTabList"),
              label: t("tabs.label"),
              value: state.tab,
              onChange: (next) => store2.actions.setTab(next),
              items: [
                {
                  value: TAB_INSTALLED,
                  label: t("tabs.installed"),
                  id: `${tabsId}-${TAB_INSTALLED}`,
                  panelId: `${tabsId}-${TAB_INSTALLED}-panel`
                },
                {
                  value: TAB_MARKET,
                  label: t("tabs.market"),
                  id: `${tabsId}-${TAB_MARKET}`,
                  panelId: `${tabsId}-${TAB_MARKET}-panel`
                }
              ]
            }
          ) })
        ] })
      }
    ),
    showsInstalled ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
      "div",
      {
        className: cn("installedPanel"),
        role: "tabpanel",
        id: `${tabsId}-${TAB_INSTALLED}-panel`,
        "aria-labelledby": `${tabsId}-${TAB_INSTALLED}`,
        children: [
          loadingFirst ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ListSkeleton, { label: t("page.loading") }) : null,
          failedFirst ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: cn("failure"), role: "alert", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.StateDot, { state: "error" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: t("page.error") }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Button, { variant: "outline", size: "sm", onClick: () => void load("initial"), children: t("page.retry") })
          ] }) : null,
          state.payload === null ? null : groups.map(renderGroup),
          excluded > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: cn("footer"), children: t("footer.excluded", { count: excluded }) }) : null
        ]
      }
    ) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "div",
      {
        className: cn("tabPanel"),
        role: "tabpanel",
        id: `${tabsId}-${TAB_MARKET}-panel`,
        "aria-labelledby": `${tabsId}-${TAB_MARKET}`,
        children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: cn("empty"), children: t("market.placeholder") })
      }
    )
  ] }) });
}

// src/client/state.js
function initialState() {
  return {
    tab: TAB_INSTALLED,
    status: "idle",
    payload: null,
    error: null,
    rows: /* @__PURE__ */ new Map(),
    notice: null
  };
}
function withEnabled(payload, key, enabled) {
  if (payload === null || payload === void 0) return payload;
  const groups = Array.isArray(payload.groups) ? payload.groups : [];
  let disabled = 0;
  const nextGroups = groups.map((group) => {
    const skills = Array.isArray(group.skills) ? group.skills : [];
    return {
      ...group,
      skills: skills.map((row) => {
        if (rowKey(row) !== key) return row;
        return { ...row, enabled };
      })
    };
  });
  for (const group of nextGroups) {
    for (const row of group.skills) if (row.enabled === false) disabled += 1;
  }
  const counts = payload.counts ?? {};
  return { ...payload, groups: nextGroups, counts: { ...counts, disabled } };
}
function createStore() {
  let state = initialState();
  const listeners = /* @__PURE__ */ new Set();
  let seq = 0;
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  const set = (patch) => {
    state = { ...state, ...patch };
    emit();
  };
  const setRow = (key, entry) => {
    const rows = new Map(state.rows);
    if (entry === null) rows.delete(key);
    else rows.set(key, entry);
    set({ rows });
  };
  const actions = {
    /**
     * Select a tab. Survives leaving the panel because the store does.
     * @param {string} tab - tab id.
     * @returns {void}
     */
    setTab: (tab) => {
      set({ tab });
    },
    /**
     * A list request is in flight.
     * @returns {void}
     */
    loading: () => {
      set({ status: "loading", error: null });
    },
    /**
     * A list request succeeded.
     * @param {object} payload - ListPayload.
     * @returns {void}
     */
    ready: (payload) => {
      set({ status: "ready", payload, error: null });
    },
    /**
     * A list request failed and there is nothing to show.
     * @param {{code: string, message: string}} error - failure code and note.
     * @returns {void}
     */
    failed: (error) => {
      set({ status: "error", error });
    },
    /**
     * A refresh failed while a payload is still on screen.
     * @param {{code: string, message: string}} error - failure code and note.
     * @returns {void}
     */
    refreshFailed: (error) => {
      seq += 1;
      set({
        status: "ready",
        error,
        notice: { kind: "refresh-failed", code: error.code, message: error.message, seq }
      });
    },
    /**
     * Dismiss the current notice, if it is still the one on screen.
     * @param {number} at - the notice sequence that finished.
     * @returns {void}
     */
    dismissNotice: (at) => {
      if (state.notice === null || at !== void 0 && state.notice.seq !== at) return;
      set({ notice: null });
    },
    /**
     * A row's write started.
     * @param {string} key - identity key.
     * @returns {void}
     */
    pending: (key) => {
      setRow(key, { pending: true, reason: null });
    },
    /**
     * A row's write was confirmed by the host.
     * @param {string} key - identity key.
     * @param {boolean} enabled - the state the host confirmed.
     * @returns {void}
     */
    commit: (key, enabled) => {
      set({ payload: withEnabled(state.payload, key, enabled) });
      setRow(key, null);
    },
    /**
     * A row's write failed: keep the old value and show why.
     * @param {string} key - identity key.
     * @param {string} reason - localized reason.
     * @returns {void}
     */
    fail: (key, reason) => {
      setRow(key, { pending: false, reason });
    }
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    actions
  };
}
var store = createStore();

// src/client/toast.jsx
var import_react2 = require("react");
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime4 = require("react/jsx-runtime");
var identityTranslate2 = (key) => key;
function ToastHost({ t = identityTranslate2, store: store2 }) {
  const read = () => store2.getSnapshot().notice;
  const notice = (0, import_react2.useSyncExternalStore)(store2.subscribe, read, read);
  if (notice === null || notice.kind !== "refresh-failed") return null;
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
    import_dsh_client_ui_primitives3.Toast,
    {
      text: t("page.refreshError"),
      icon: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.IconWarningOutlineRegular, {}),
      onDone: () => store2.actions.dismissNotice(notice.seq)
    },
    notice.seq
  );
}

// src/client/index.jsx
var import_jsx_runtime5 = require("react/jsx-runtime");
var NS = "dsh-skill-center";
var PANEL_ID = "dsh-skill-center";
var PANEL_ORDER = 40;
var inject = ["slots", "locale"];
function SkillsPanelIcon({ size }) {
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives4.IconSkillOutlineRegular, { size });
}
function registerPanel(ctx, { store: store2, api, t }) {
  return [
    ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
      name: "sidebar.panellist",
      id: PANEL_ID,
      order: PANEL_ORDER,
      label: () => t("panel.label"),
      locale: NS
    }, SkillsPanelIcon)),
    ctx.slots.inject("main", () => ctx.slots.register({
      name: "main",
      key: PANEL_ID,
      locale: NS,
      inject: () => ({ store: store2, api })
    }, SkillsPage))
  ];
}
function registerToast(ctx, { store: store2 }) {
  return [
    ctx.slots.inject("shell.overlay", () => ctx.slots.register({
      name: "shell.overlay",
      id: `${PANEL_ID}.refresh-toast`,
      locale: NS,
      inject: () => ({ store: store2 })
    }, ToastHost))
  ];
}
function uiDictionary(dictionary) {
  return Object.fromEntries(
    Object.entries(dictionary).filter(([key, value]) => key !== "meta" && typeof value === "string")
  );
}
function apply(ctx) {
  ctx.effect(
    () => ctx.locale.register(NS, { zh: uiDictionary(zh_default), en: uiDictionary(en_default) }),
    "dsh-skill-center: dictionaries"
  );
  injectStyles();
  const t = ctx.locale.bind(NS);
  const api = new SkillCenterApi();
  const disposers = [];
  disposers.push(...registerPanel(ctx, { store, api, t }));
  disposers.push(...registerToast(ctx, { store }));
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) dispose();
  }, "dsh-skill-center: ui mounts");
}
		return module.exports;
	}
});
