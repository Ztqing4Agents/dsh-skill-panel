# 视觉实现规格（页面外壳 / 页头 / 分区 / 行 / 骨架）

> 类型：规范
> 读者：改 `src/client/styles.js`、`page.jsx`、`row.jsx`、`skeleton.jsx`、`header-scroll.js` 的人
> 真源：`src/client/styles.js` 的取值是最终真源，本文件与它逐条对应；宿主侧的原始取值见 `../reference/host-plugin-page.md`
> 更新触发：宿主改版（先重采 reference）或改任何 px / 令牌 / 类名时，同时改 `styles.js` 与本文件
> 规模上限：400

原为 `docs/system_design.md` 的附录 A，2026-11-09 拆出成独立契约。**编号 A.1–A.9 保持原值**——`test/styles.test.mjs`、`test/view-skeleton.test.mjs` 的头注按 `A.x` 锚定本文件。

> **唯一允许的取值来源**：`--dsw-*` 令牌 + 宿主 primitive 组件。本文件里的 px 是**字号/行高/尺寸刻度**（DSH 没有 typography token，见 `HIDDER/docs/reference/settings-ui.md` §6），不是颜色。
> 所有规则体逐字来自 `[PM-CSS]`（`EX/dsh-client-ui-plugin-manager/lib/client.js` 内 `PluginManagerPage.module.css` 的 `css` 字符串）或 `SHELL/index-lh_YM6sT.css`，只把类名前缀换成 `skc_`、把局部变量换成 `--skc-*`。**不允许在别处再声明同名 `--dsw-*` 变量。**

## A.1 页面外壳

```css
/* [PM-CSS] .page —— 页面根；--plugin-page-inset/top-inset 换成 --skc-*，其余逐字 */
.skc_page{
  --skc-page-inset: clamp(24px, 4vw, 48px);
  --skc-page-top-inset: 28px;
  --skc-progress-size: 14px;      /* = 宿主 --bundle-progress-size */
  --skc-toggle-gap: 8px;          /* = 宿主 --bundle-toggle-gap */
  box-sizing: border-box; height: 100%; padding: 0 var(--skc-page-inset);
  color: var(--dsw-alias-label-primary);
  display: flex; flex-direction: column; align-items: center;
}
@media (width <= 767px){ .skc_page{ --skc-page-inset: 20px } }
.skc_page > *{ flex: none; width: 100%; max-width: 960px }
```

## A.2 滚动容器与页头条（含停靠机制）

```css
/* [PM-CSS] .pageBody */
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

/* [PM-CSS] .pageBar —— 页头条：宽度吃掉滚动条宽度，左右外扩到页面边距外 */
.skc_pageBar{
  width: calc(100% + 2 * var(--skc-page-inset) + var(--skc-page-scrollbar-width, 0px));
  max-width: none; margin-inline: calc(-1 * var(--skc-page-inset));
  box-sizing: border-box; padding-inline: var(--skc-page-inset);
  display: flex; flex-direction: column; align-self: flex-start;
  position: relative; container: skc-page-bar / inline-size;
}
.skc_pageBar > .skc_pageHead{ align-self: center; width: 100%; max-width: 960px }

/* 量测副本（隐藏、脱离流） */
.skc_pageBody > .skc_pageBar[data-measuring]{
  visibility: hidden; pointer-events: none; margin: 0; position: absolute; top: 0; left: 0;
}
/* 停靠本体 */
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
/* 不透明底：滚过的内容不能透到页头下面 */
.skc_pageBar[data-natural]:before{
  content: ""; height: var(--skc-header-paint-height, var(--skc-header-rest-height));
  background: var(--dsw-alias-bg-base); pointer-events: none; position: absolute; inset: 0 0 auto;
}
/* 紧凑态：横跨整行页面的 .5px 分隔线 */
.skc_pageBar[data-natural][data-compact]:after{
  content: ""; inset-inline: 0; height: var(--skc-header-compact-height);
  box-sizing: border-box; border-bottom: .5px solid var(--dsw-alias-border-l3);
  position: absolute; top: 0;
}
```

## A.3 页头（标题 / 副标题 / ⓘ / 操作组 / 页签）

```css
/* [PM-CSS] .pageHead —— macOS 额外让出框架标题栏安全区 */
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

/* 状态文案：宿主页头用的是 .updatesNote（12/18 tertiary），不是 .status（13/20）——见附录 B-1 */
.skc_status{ color: var(--dsw-alias-label-tertiary); margin: 0; font-size: 12px; line-height: 18px }

/* 按钮尺寸：宿主 .addButton / .addPrimary / .addMore 共用 */
.skc_addButton, .skc_addPrimary, .skc_addMore{
  border-radius: var(--dsw-radius-md); height: 32px; padding: 0 12px; font-size: 13px; line-height: 20px;
}

/* 「＋ 添加技能 ⌄」分裂按钮（P0 禁用态，队长决策 3） */
.skc_addGroup{ flex: none; align-items: stretch; display: inline-flex }
.skc_addPrimary{ border-top-right-radius: 0; border-bottom-right-radius: 0 }
.skc_addMore{
  border-left: .5px solid color-mix(in srgb, var(--dsw-alias-label-primary-foreground) 30%, transparent);
  border-top-left-radius: 0; border-bottom-left-radius: 0; width: 32px; padding: 0;
}

/* 页签容器 */
.skc_pageTabs{ flex: 100%; order: 3; display: flex }
.skc_pageTabList{ width: fit-content; min-width: 240px }
```

## A.4 分区

```css
/* [PM-CSS] .installedPanel / .tabPanel / .group / .groupHead / .groupTitle */
.skc_installedPanel{ flex-direction: column; gap: 32px; display: flex }
.skc_tabPanel{ flex-direction: column; gap: 24px; display: flex }
.skc_group{ flex-direction: column; gap: 8px; display: flex }
.skc_groupHead{ align-items: center; gap: 8px; display: flex }
.skc_groupTitle{ flex: 1; margin: 0; font-size: 14px; font-weight: 500; line-height: 22px }
```

> 「更多 ›」(`.groupMore`) **P0 不实现**：三个分区都没有可展开的更多页（`PRD` §3.3.7）。

## A.5 行

```css
/* [PM-CSS] .cards / .card / .cardHead / .cardIcon / .cardMain / .titleRow / .cardTitle / .cardDesc / .cardEnd */
.skc_cards{ flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; display: flex }
.skc_card{ border-radius: var(--dsw-radius-xl); min-width: 0; margin: 0 -8px }
.skc_cardHead{ align-items: center; gap: 14px; padding: 8px; display: flex }
.skc_cardIcon{
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
```

> **不实现** `.cardLink:hover` / `:active`（宿主行是链接，我们的行不可点击，见附录 B-4）。行高恒 64px（48 图标 + 8×2 padding）。

## A.6 开关位、软链只读标记、骨架

```css
/* [PM-CSS] .bundleToggle / .toggleProgress / .progressAnnouncement —— 开关左侧 22px 预留 */
.skc_bundleToggle{ align-items: center; gap: var(--skc-toggle-gap); display: inline-flex }
.skc_toggleProgress{ width: var(--skc-progress-size); height: var(--skc-progress-size); display: inline-flex }
.skc_toggleProgress > svg{ width: 100%; height: 100% }
.skc_progressAnnouncement{
  clip-path: inset(50%); white-space: nowrap; width: 1px; height: 1px; position: absolute; overflow: hidden;
}

/* 软链只读标记（队长决策 2）：配方抄宿主 .attemptBadge，位置在 .skc_cardEnd（原开关座位） */
.skc_roTag{
  border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-secondary); height: 18px; padding: 0 6px;
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; line-height: 18px; white-space: nowrap;
}
.skc_roTag > svg{ width: 12px; height: 12px; flex: none }

/* [PM-CSS] .skeleton* —— 加载骨架 */
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
.skc_skeletonIcon{ border-color: #0000 }        /* 唯一保留的透明字面量，宿主原文 */
.skc_skeletonActions{ width: calc(36px + var(--skc-toggle-gap) + var(--skc-progress-size)); height: 20px }
```

## A.7 空态 / 错误态 / 行内原因 / 页脚

```css
/* [PM-CSS] .empty / .status / .failure / .failure p / .statusWithDot / .reason / .updatesNote */
.skc_empty{ color: var(--dsw-alias-label-tertiary); margin: 0; font-size: 13px; line-height: 20px }
.skc_failure{ color: var(--dsw-alias-state-error-primary); align-items: center; gap: 10px; display: flex }
.skc_failure p{ color: var(--dsw-alias-label-tertiary); margin: 0; font-size: 13px; line-height: 20px }
.skc_statusWithDot{ align-items: center; gap: 6px; display: inline-flex }
.skc_reason{
  color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; white-space: pre-wrap;
  margin: 0; font-size: 12px; line-height: 18px;
}
/* 页脚「另有 N 个…」：取 .empty 的配方，位置在 installedPanel 末尾（PRD §3.3.7 已登记为偏离） */
.skc_footer{ color: var(--dsw-alias-label-tertiary); margin: 0; font-size: 13px; line-height: 20px }
```

## A.8 响应式与收拢顺序（容器查询，逐字）

```css
/* [PM-CSS] 紧凑态（非停靠路径的兜底外观） */
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

/* 容器查询：< 600px —— 页签与图标操作共用一行，标签退化，按钮收成 32px 方图标 */
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
```

## A.9 关键度量速查（验收：直接量这些）

| 元素 | 值 | 来源 |
| --- | --- | --- |
| 页内边距 | `clamp(24px,4vw,48px)`；≤767px 时 20px | `.skc_page` |
| 内容最大宽 | 960px（`page` 与 `pageBody` 的直接子元素） | `.skc_page>*` |
| 页头顶部留白 | 28px；darwin 加 `--dsh-frame-top-clearance`（=48px） | `.skc_pageHead` |
| 大标题 | 20px / 28px / 500 | `.skc_pageTitle` |
| 副标题 | 13px / 20px / `label-secondary` | `.skc_pageIntro` |
| ⓘ | 20×20 盒，图标 11px，与副标题 gap 4px | `.skc_infoButton` |
| 状态文案 | **12px / 18px** / `label-tertiary` | `.skc_status`（= 宿主 `.updatesNote`） |
| 刷新按钮 | 高 32px，padding 0 12px，13px/20px，`radius-md` | `.skc_addButton` |
| 页签总高 | **34px** = 30px tab + 2px×2（`SegmentedTabs size="sm"`） | `SHELL` `._tabs_1lga9_1[data-size=sm]` |
| 页签文字 | 14px / 20px，选中 500（sm 档） | `._tab_1lga9_1` |
| 区标题 | 14px / 22px / 500 | `.skc_groupTitle` |
| 列表 gap / 行外扩 | 2px / `margin:0 -8px` | `.skc_cards` / `.skc_card` |
| 行内 gap / padding | 14px / 8px → 行高 64px | `.skc_cardHead` |
| 图标 | 48×48，`.5px` `border-l3`，`radius-lg` | `.skc_cardIcon` |
| 名称 / 描述 | 14/20/500 · 13/18 tertiary 单行 | `.skc_cardTitle` / `.skc_cardDesc` |
| 开关 | 36×20（`Switch`），左侧预留 14px + 8px | `.skc_bundleToggle` |
| 软链标记 | 高 18px，padding 0 6px，11/18，`bg-layer-3`，图标 12px | `.skc_roTag` |
| 骨架条 | 高 12px，`radius-xs`；`48px` / `min(144px,60%)` / `min(280px,85%)` / `58px×20px` | `.skc_skeleton*` |
| 骨架动画 | 2s `cubic-bezier(.36,0,.64,1)` infinite，1 → .6 → 1 | `@keyframes skc-skeleton` |
| 错误行 | `StateDot state="error"` + 13/20 tertiary 文字 + `role="alert"` + outline 重试按钮 | `.skc_failure`（宿主结构） |
| 行内失败原因 | 12px / 18px / error 色 / `pre-wrap` | `.skc_reason` |

---
