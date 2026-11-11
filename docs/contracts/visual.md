# 视觉实现规格（页面外壳 / 页头 / 分区 / 行 / 骨架）

> 类型：规范
> 读者：改 `src/client/styles.js`、`page.jsx`、`row.jsx`、`skeleton.jsx`、`header-scroll.js` 的人
> 真源：`src/client/styles.js` 的取值是最终真源，本文件与它逐条对应；宿主侧的原始取值见 `../reference/host-plugin-page.md`
> 更新触发：宿主改版（先重采 reference）或改任何 px / 令牌 / 类名时，同时改 `styles.js` 与本文件
> 规模上限：400

2026-11-09 从原单文件契约拆出（`git show a8141eb:docs/system_design.md`），编号 A.1–A.9 保持原值。**编号 A.1–A.9 保持原值**——`test/styles.test.mjs`、`test/view-skeleton.test.mjs` 的头注按 `A.x` 锚定本文件。市场页的刻度不在本文件：`A.10` 空着不用，市场刻度（筛选栏 / 网格 / 卡片 / 详情 / 确认弹窗）统一放在 `docs/contracts/market.md` 附录 F（本文件行数上限所致）。

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
/* [PM-CSS] .pageBody —— scrollbar-gutter:stable 预留沟槽：否则有无滚动条时整宽元素右边缘差一个滚动条宽（无头 5px / macOS 常显 15px）；右侧恒留空沟槽是代价，不是 bug */
.skc_pageBody{
  min-height: 0;
  width: calc(100% + 2 * var(--skc-page-inset));
  max-width: none; margin-inline: calc(-1 * var(--skc-page-inset));
  box-sizing: border-box; padding: 0 var(--skc-page-inset) 48px;
  scroll-padding-top: var(--skc-header-scroll-padding, 0px);
  display: flex; flex: 1; flex-direction: column; align-items: center; gap: 32px;
  position: relative; overflow: hidden auto; scrollbar-gutter: stable;
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
.skc_card{ border-radius: var(--dsw-radius-xl); min-width: 0; margin: 0 -8px; position: relative }
/* 可点的行才给底色：hover 只在真有悬停的设备上，:active 是触屏唯一的可靠证据 */
@media (hover: hover){ .skc_card:hover{ background: var(--dsw-alias-interactive-bg-hover) } }
.skc_card:active{ background: var(--dsw-alias-interactive-bg-hover) }
.skc_cardHead{ align-items: center; gap: 14px; padding: 8px; display: flex }
/* .cardIcon —— 容器逐字回归 [PM-CSS]（边框、圆角、尺寸、盒模型都是宿主的）；
   `background` / `background-clip` / `color` / `font-*` 是本插件新增的**内容层**：
   底与字色由行内 `--skc-avatar-bg` / `--skc-avatar-ink` 传入（见 A.5 下方注），
   两个 fallback 供骨架态与缺值兜底。`background-clip: padding-box` 不可省：
   宿主边框是半透明的（`.5px` `border-l3`），不裁到 padding box 就会被粉彩底盖掉 */
.skc_cardIcon{
  box-sizing: border-box;
  border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-lg);
  width: 48px; height: 48px; flex: none;
  background: var(--skc-avatar-bg, transparent); background-clip: padding-box;
  color: var(--skc-avatar-ink, var(--dsw-alias-label-secondary));
  font-size: 26px; font-weight: 500; line-height: 1; text-transform: uppercase; user-select: none;
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
.skc_cardEnd{ z-index: 1; flex: none; align-items: center; justify-content: flex-end; gap: 8px;
min-width: 58px; height: 28px; display: inline-flex; position: relative }
/* 整行可点 = 标题按钮铺 inset:0 的 ::after + 动作位 z-index:1 浮起；font:inherit 会冲掉字阶，故后三条必需 */
.skc_cardOpen{ flex: 0 1 auto; min-width: 0; max-width: 100%; padding: 0; border: 0; background: 0 0; color: inherit; font: inherit; text-align: left; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 500; line-height: 20px }
.skc_cardOpen::after{ content: ""; border-radius: var(--dsw-radius-xl); position: absolute; inset: 0 }
.skc_cardOpen:focus-visible{ outline: none }
.skc_cardOpen:focus-visible::after{
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}

/* 详情族（.skc_marketDetail / Crumb / DetailHead / DetailTitle / DetailSection / SectionTitle /
   Facts / Files）的语义是「详情页骨架，两个页签共用」，**不改名**；已安装详情只补这些。
   以下刻度全部对照宿主「插件详情页」真机读数（1440×920、DPR 1，见
   `docs/reference/host-plugin-page.md` §7 与 `.agents/work/scratch/host-detail-metrics.md`） */
/* 整页替换时 pageBody 里只有这一个详情容器；空条只承载窗口拖动（页头没了这段不能丢），高度 =
   页头预留的同一顶部内边距 + darwin 安全区，进出详情头部不跳；拖动区挂整块会吃掉选择与点击 */
.skc_detailPage{ display: flex; flex-direction: column; min-width: 0 }
.skc_detailDrag{ flex: none; height: var(--skc-page-top-inset) }
[data-platform=darwin] .skc_detailDrag{ height: calc(var(--skc-page-top-inset) + var(--dsh-frame-top-clearance, 0px)) }
/* 详情头图标 49×49 = 宿主实测（.5px 描边 + 48 内容）；**列表行仍是 48**（64 = 48 + 8×2 是行高来源），只加修饰类 */
.skc_detailIcon{ width: 49px; height: 49px }
/* 头行：宿主实测图标贴左沿、动作组贴右沿、两者垂直居中（中心同为 102.5）⇒ space-between + center */
.skc_detailTop{ display: flex; justify-content: space-between; align-items: center }
/* 动作组内 gap 16 = 宿主实测；margin-left:auto 在 space-between 下是冗余保险 */
.skc_detailActions{ margin-left: auto; display: inline-flex; align-items: center; gap: 16px }
/* 图标行 → 标题组 = 20（宿主 detailMain 的 margin-top）：列 gap 32 减 12，一处来源；组内 gap 8 */
.skc_detailIntro{ display: flex; flex-direction: column; gap: 8px; margin-top: -12px }
/* 作者行 = 宿主的包名行：12/18、tertiary、mono（宿主那行用 ui-monospace 一族） */
.skc_detailAuthor{ margin: 0; color: var(--dsw-alias-label-tertiary); font-family: var(--ds-font-family-code); font-size: 12px; line-height: 18px }
/* 卸载占位：红字 + inset 1px 红环（不是 border，会让高度多 2px），红用 error 令牌 */
.skc_detailDanger{ --dsh-button-outline-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent); --dsh-hairline-width: 1px; color: var(--dsw-alias-state-error-primary); height: 28px; padding: 0 10px; border-radius: 8px; gap: 4px; font-size: 12px; line-height: 18px }
.skc_detailDanger:disabled{ opacity: .4 }
/* 正文盒只有上下两条 0.5px 发丝线（左右 none、圆角 0、背景透明）；色取标签主色 5%：浅 ≈4% 黑、深 ≈5% 白，
   随主题翻转（--dsw-alias-border-l3 约 12%，重 3 倍不用） */
.skc_detailBodyBox{ max-height: 60vh; padding: 12px 0; overflow-y: auto; border-top: .5px solid color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent); border-bottom: .5px solid color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent) }
/* 版本区块只在市场装的技能上渲染：标题 14/20/500 + Button size=sm；卡片 1px 描边 + 16 内边距（卡内
   px 未采）；✓ 圆底 32。「来源信息」复用 .skc_marketFacts（market.md 附录 F） */
.skc_detailVersionHead{ display: flex; align-items: center; justify-content: space-between; gap: 12px }
.skc_detailVersionCard{ border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); padding: 16px; display: flex; align-items: flex-start }
.skc_detailVersionRow{ display: flex; align-items: flex-start; gap: 12px; min-width: 0 }
.skc_detailVersionMark{ width: 32px; height: 32px; border-radius: 999px; flex: none; align-items: center; justify-content: center; display: inline-flex; color: var(--dsw-alias-state-success-primary); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent) }
.skc_detailVersionText{ display: flex; flex-direction: column; gap: 2px; min-width: 0 }
/* 卡内结论 14/22（与描述同阶）；时间那行沿用 .skc_marketScope */
.skc_detailVersionTitle{ margin: 0; font-size: 14px; line-height: 22px }
/* 「查看仓库」是页内普通链接（不是点击层）：右下角、13/20 tertiary、hover 变主色 */
.skc_detailRepoLink{ align-self: flex-end; display: inline-flex; align-items: center; gap: 4px; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; text-decoration: none }
@media (hover: hover){ .skc_detailRepoLink:hover{ color: var(--dsw-alias-label-primary) } }
/* 组件式行（宿主「包含的组件」实测 74 / 41 / 13.5·20·500 / 11.5·16 两行）用在内置块与插件页，不新增类：
   块 = .skc_card + .skc_cardOpen；插件页 = .skc_detailTop/.skc_detailIcon(49) + .skc_detailIntro（标题
   20/28/500 带 min-width:0 + overflow-wrap:anywhere 换行不裁；副行 14/22 margin 0；dd 行盒 22、其中
   `<code>` 芯片 18 + 上下 padding 2 = 同高） */
.skc_callRow{ display: flex; align-items: center; gap: 12px; height: 74px; position: relative }
/* hover 只给可点的行：插件页的行加 .skc_callRowOpen 才有反馈（硬约束 9），技能页那行不可点故不加 */
@media (hover: hover){ .skc_callRowOpen:hover{ background: var(--dsw-alias-interactive-bg-hover) } }
.skc_callRowOpen{ border-radius: var(--dsw-radius-xl) }
.skc_callRowOpen:active{ background: var(--dsw-alias-interactive-bg-hover) }
.skc_callIcon{ width: 41px; height: 41px; border-radius: 12px }
.skc_callBody{ display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 }
.skc_callName{ margin: 0; font-size: 13.5px; line-height: 20px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.skc_callDesc{ margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 11.5px; line-height: 16px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden }
.skc_detailBody{ font-size: 13px; line-height: 20px }
```

> **行可点（U1 起）**：已安装行点标题即进本地详情页，实现只有上一条 `.skc_cardOpen::after` + `.skc_cardEnd{z-index:1}`（见 `AGENTS.md` 硬约束 9 与 `docs/contracts/installed-detail.md`）；不要 `<a href>`、不要第二个可点区域。行高恒 64px（48 图标 + 8×2 padding）。
> 宿主 `.cardLink:hover` 的**确切色值我们没采到**（`docs/reference/host-plugin-page.md` §5 只记「有底色反馈」）⇒ 暂用市场卡同一个 `--dsw-alias-interactive-bg-hover`，**待真机取色**（`docs/contracts/decisions.md` 附录 Q）。
> 市场卡片**复用** `.skc_cardIcon`（48×48 同一条规则），其声明一字不改——改它会让「已安装」页签 11 行同时回归。来源品牌图标**不是**头像色板的第七组：它是 `src/client/market-marks.jsx` 里两段 `data:image/png;base64` 位图（16×16 显示），只在市场卡片上出现，「已安装」页签不渲染它，也不参与 `avatar.js` 的散列。

头像的两种颜色**不走样式表常量，走行内自定义属性**：`row.jsx` 渲染
`<span class="skc_cardIcon" style="--skc-avatar-bg:…;--skc-avatar-ink:…">首字母</span>`，
本规则用 `var()` 取值——同一套规则因此能画六种颜色，且不新增类名、不动容器样式。
色板与「技能名 → 色板下标」的 FNV-1a 散列在 `src/client/avatar.js`；
字母取名字里第一个 `\p{L}` 或 `\p{N}` 并大写（中文取首字），空名回落 `#`。
头像纯装饰（`aria-hidden`），读屏只念名字；**色板不随主题变化**，深浅两套主题用的是同六个固定值。

**配色与排印对齐 skillhub.cn（2026-11-09 用户要求「除圆角外都对齐」）**，六组是站点实测值，
不是我们选的：底色是该 accent 的 10%（天空那组 12%），字色是该 accent 的实色——

| # | `--skc-avatar-bg` | `--skc-avatar-ink` |
| --- | --- | --- |
| 1 | `rgba(255, 45, 85, .1)` | `#FF2D55` |
| 2 | `rgba(255, 149, 0, .1)` | `#FF9500` |
| 3 | `rgba(90, 200, 250, .12)` | `#32ADE6` |
| 4 | `rgba(175, 82, 222, .1)` | `#AF52DE` |
| 5 | `rgba(52, 199, 89, .1)` | `#34C759` |
| 6 | `rgba(0, 122, 255, .1)` | `#007AFF` |

字号与字重按站点 14/40 的比例投到 48px 盒：**17px / 700**（舍入自 16.8）。站点瓦片本身是 40×40、
圆角 8px；**我们只保留自己的 48×48 与 `radius-lg`（16px）**——用户明确「除了圆角外，其他都对齐」。
⚠️ **对比度判据已主动放弃**：这六组的字母对底色约 2–3:1，低于原「≥4.5:1」，这是对齐站点换来的
（登记在 `docs/contracts/decisions.md` 附录 H），不要再按 4.5:1 去「修」它。

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
/* 骨架图标：`border-color: #0000` 是宿主原文（唯一保留的透明字面量）。
   `background` / `background-clip` 是本面板补的（[PM-CSS] 里没有）：`.skc_cardIcon`
   现在画 `--skc-avatar-bg` 的粉彩色块，骨架态必须保持灰色、且灰底与头像一样裁到
   padding box（宿主边框半透明）；这两条排在 `.skc_skeletonFill` 之后，规则顺序被改动
   也漏不出彩色块 */
.skc_skeletonIcon{ border-color: #0000; background: var(--dsw-alias-bg-skeleton); background-clip: padding-box }
.skc_skeletonActions{ width: calc(36px + var(--skc-toggle-gap) + var(--skc-progress-size)); height: 20px }
```

## A.7 空态 / 错误态 / 行内原因 / 页脚

```css
/* [PM-CSS] .empty / .status / .failure / .failure p / .statusWithDot / .reason / .updatesNote */
.skc_empty{ color: var(--dsw-alias-label-tertiary); margin: 0; font-size: 13px; line-height: 20px }
.skc_failure{ color: var(--dsw-alias-state-error-primary); align-items: center; gap: 10px; display: flex }
.skc_failure p{ color: var(--dsw-alias-label-tertiary); margin: 0; font-size: 13px; line-height: 20px }
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
| 图标 | 外框 48×48、底色 47×47（`background-clip: padding-box`），`.5px` `border-l3`，`radius-lg`（16px）；**17px / 700** 大写首字母居中；**6 组** accent 10%（天空 12%）底 + accent 实色字按技能名散列，对齐 skillhub.cn，**字母对比度约 2–3:1（刻意放弃原 ≥4.5:1）** | `.skc_cardIcon`（色板与散列见 `src/client/avatar.js`，理由见 A.5 与 `decisions.md` 附录 H） |
| 名称 / 描述 | 14/20/500 · 13/18 tertiary 单行（**已安装行**；市场卡描述三行，刻度在 `docs/contracts/market.md` 附录 F） | `.skc_cardTitle` / `.skc_cardDesc` |
| 开关 | 36×20（`Switch`），左侧预留 14px + 8px | `.skc_bundleToggle` |
| 软链标记 | 高 18px，padding 0 6px，11/18，`bg-layer-3`，图标 12px | `.skc_roTag` |
| 骨架条 | 高 12px，`radius-xs`；`48px` / `min(144px,60%)` / `min(280px,85%)` / `58px×20px` | `.skc_skeleton*` |
| 骨架动画 | 2s `cubic-bezier(.36,0,.64,1)` infinite，1 → .6 → 1 | `@keyframes skc-skeleton` |
| 错误行 | `StateDot state="error"` + 13/20 tertiary 文字 + `role="alert"` + outline 重试按钮 | `.skc_failure`（宿主结构） |
| 行内失败原因 | 12px / 18px / error 色 / `pre-wrap` | `.skc_reason` |
| **市场页** | 筛选栏 / 网格 / 卡片 / 详情 / 确认弹窗的刻度 | 见 `docs/contracts/market.md` 附录 F（本表不重复维护市场行） |

> **固定尺寸的盒子必须显式写 `box-sizing: border-box`**（宿主那套 CSS 是逐条声明的，没有全局 reset）。
> 2026-11-09 真机验收量到过 50×50 / 行高 66px：`.skc_cardIcon` 带 0.5px 边框、又是 content-box，盒子被撑大了 2px。
> 该规则现在**逐字回归宿主原件**（边框回来、圆角用 `radius-lg`），所以 `box-sizing: border-box` 比以往更必要：
> 少了它，48px 会立刻变成 50px、行高 66px
> （锚点：`src/client/styles.js` 的 `.skc_cardIcon`，回归见 `test/styles.test.mjs`）。
