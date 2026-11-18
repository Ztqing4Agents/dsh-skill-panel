# 宿主「插件」页

> 类型：参考
> 读者：要复刻宿主页面形状的人——改 `src/client/styles.js`、`page.jsx`、`row.jsx` 之前对照本节读数
> 真源：宿主产物本身（`app.asar` 内的 `@deepseek-ai/dsh-client-ui-plugin-manager`）；本文只是它的采集副本
> 更新触发：宿主升级到新的 `0.2.x-rc` 后**整份重采**，不在旧表上打补丁
> 规模上限：600
> 采集日期：2026-11-15
> 一次采集：§1–§6 的原始采集日期：2026-11-08（基线宿主 `0.2.2-rc.1`）
> 二次采集：§7「插件详情页」于 2026-11-10 用 node 读 asar 补采（同日二核，见 `docs/contracts/decisions.md` 附录 Q）
> 三次采集：§8「添加插件与卸载两条流程」于 2026-11-12 用 node 读 asar 采集（同源 `0.2.2-rc.1`）
> 四次采集：§8.1「添加插件菜单」于 2026-11-13 复采（**同一版宿主** `0.2.2-rc.1`；这一版装了 `dsh-client-ui-agent-preset`，菜单从一项变两项）
> 五次采集：全文于 2026-11-15 按宿主 `0.2.2-rc.3` 整份重采。rc.3 的 asar 带 TS/TSX/CSS 源码，读数优先取源码声明值；rc.1 留下的「px 未逐值采集」「`cardLink` 待取色」两处在本轮落实
> 来源版本：DeepSeek Harness `0.2.2-rc.3`（`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`）

只描述**宿主长什么样**，不写「我们应该怎么用」——复刻口径在 `docs/contracts/visual.md`。

## 1 怎么采集、怎么验

asar 是「头部 JSON + 拼接内容」的容器，不是目录；整包 `grep -a` 就能命中内部字符串：

```bash
A="/Applications/DeepSeek Harness.app/Contents/Resources/app.asar"
grep -ac updatesNote              "$A"   # 页头状态文案类（本文 3 节）：rc.3 = 8
grep -ac _tabs_1lga9_1            "$A"   # 页签容器的构建哈希（本文 3 节）：rc.3 = 2
grep -ac -- --bundle-progress-size "$A"  # 打开进度占位宽（本文 4 节）：rc.3 = 5
grep -ac AddPluginMenu            "$A"   # 添加菜单组件（本文 8.1）：rc.3 = 3
grep -ac InstallDialog            "$A"   # 安装弹窗（本文 8.2）：rc.3 = 5
```

本文任何一条测量都可用「重跑上面五条 + 重新截同一页」复核。宿主升级后**五条全为 0** 说明整份已失效，按 `来源版本` 重采；只有个别条数变化时按对应节重读。

⚠️ **`grep -a` 只能用来搜 ASCII**：同一份 asar 上 `grep -ac "卸载"` 是 **0**（假阴性），而 `grep -ac "uninstall"` 有 161 —— grep 按字节匹配，对 UTF-8 中文会静默漏检。**搜中文、确认「某界面不存在」一律用 node 读 asar**（切片规则见 1.1 的 `EX/` 行），否则「0 命中」只是采集方法在骗人（2026-11-10 踩过，结论见 `docs/contracts/decisions.md` 附录 Q-2）。

⚠️ **引用宿主内部实现只写不变量，不钉压缩符号名**：`SHELL/` 与 `PM/` 交付的是压缩产物，标识符每版重新编号，同一个字母串换一版可能指向完全不同的模块——所以本文只写「返回什么 / 导出什么 / 挂在哪个钩子上」。要复核时就按它引用的包名在产物里搜：`package.json` 的 `dsh.client.external` 白名单里那些 `@deepseek-ai/*` 名字在压缩中被逐字保留，搜到再读导出形状。压缩名最多作为一行例证出现，不作定位手段。

截图：[宿主插件页首屏](../assets/host-plugins-page.png)（1440×920，2026-11-08；页面骨架本身未变）。

### 1.1 证据记号（全文通用）

原文里出现这些缩写时，指向的都是本机真实产物：

| 记号 | 实际路径 | 说明 |
| --- | --- | --- |
| `EX/` | `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` 内的 `dsh/node_modules/@deepseek-ai/` | asar 是「头部 JSON + 拼接内容」，不是目录：`u32@4 = headerSize`、`u32@12 = jsonLen`、JSON 从 byte 16 起、内容区 = `8 + headerSize` |
| `PM/` | `EX/dsh-client-ui-plugin-manager`（源码在 `PM/src/client/**`，产物是 `PM/lib/client.js`） | 插件页本体：`PluginManagerPage.tsx`、`PluginManagerPage.module.css`（2318 行、50 181 B）、`manager-store.ts`、`locales.ts`、`versions.tsx`、`detail-store.ts`、`header-scroll.ts`、`presentation.ts` |
| `PMK/` | `EX/dsh-client-ui-plugin-market` | 「发现」页签的注册方（`plugins.tab` 的 `discover` 项） |
| `PRESET/` | `EX/dsh-client-ui-agent-preset` | 添加菜单第二项的注入方（`CreatePluginMenuItem`） |
| `THEME/` | `EX/dsh-client-ui-theme`（`THEME/src/styles/base.css`、`design-platform.css`） | 令牌（半径字号）与明暗两套静态色板 |
| `LAYOUT/` | `EX/dsh-client-ui-layout`（`LAYOUT/src/client/AppFrame.module.css`） | 外壳框架；`--dsh-frame-top-clearance` 的声明处 |
| `SRV/` | `EX/dsh-plugin-manager/lib/types/` | 服务端结果类型与拒绝码（`failure.js`、`index.js`、`versions.js` 等） |
| `SHELL/` | `EX/dsh-web-frontend/dist/assets`（`index-Ciz7DZxv.js`、`index-CSAdOBx6.css`） | 前端 shell 与 primitives 产物（`SegmentedTabs`、`Switch`、`Button`、`DetailDocument` 的 CSS 都在这里），单行压缩，按唯一字串 grep |
| `PROF/` | `~/.dsh/profiles/desktop/node_modules/` | 本机已装插件 |
| `HIDDER/` | `~/<plugins-dir>/dsh-hidder/` | 用户自己的插件；`HIDDER/docs/reference/host-selectors.md`、`HIDDER/docs/reference/settings-ui.md`、`HIDDER/spec.md` 有宿主真实取值 |
| `PRD` | `git show a8141eb:docs/PRD.md` | 上游产品规格。2026-11-09 作为过程产物移出工作树，正文里的 `PRD §x` 引用保留以便追溯 |

> 宿主版本双证（2026-11-15 复核）：`/Applications/DeepSeek Harness.app/Contents/Info.plist` 的 `CFBundleShortVersionString` 与 asar 内 `dsh/package.json` 的 `version` 同为 `0.2.2-rc.3`；整包 210 011 763 B。本文所有宿主读数采集于该版本。

## 2 页面骨架

- 入口是侧栏的 `插件` 行（`sidebar.panellist` 槽，图标 `IconPluginPinwheelOutlineRegular`），点开占满主区整页，没有右侧抽屉、没有二级页。
- 页头（`pageHead`）：左 `h1`「插件」（20/28/500）+ 副标题「安装、启用和配置插件」（13/20、secondary）+ ⓘ 按钮（`ghost/sm`，盒 20×20、`IconInfoOutlineRegular` 11、`aria-label`「插件说明」，tooltip 300ms）；右侧操作组（`toolbar`，`gap: 8px 16px`）依次是状态句 `updatesNote`、`刷新`（`outline/sm`，进行中把图标换成 `StateDot state="ongoing" size={13}`，带 `aria-busy`）、`＋ 添加插件 ⌄`（细节见 8.1）。**整条工具条带 `hidden={!onInstalled}`**：它只在「已安装」页签渲染。
- 页签行（`pageTabs`）只在有插件往 `plugins.tab` 槽注册时出现：第一项固定「已安装」（`installedTab`），其后按槽注册顺序排列（本机装了 `dsh-client-ui-plugin-market`，第二项是「发现」）。控件是 primitives 的 `SegmentedTabs size="sm"`。
- 「已安装」页签的主体是竖排**分区**，不是页签：`内置插件配置`（`basicTitle`）/ `实验性插件`（`extensionsTitle`，区标题右侧一枚「更多 ›」）/ `已安装插件`（`bundlesTitle`）；点「更多」进 `moreTitle` 子页（带独立吸顶页头与返回键）。
- 卡片 = `li.card.cardLink`，头部四件：图标盒（48，见 4 节）+ 标题按钮（14/20/500）+ 单行描述（13/18、tertiary、`-webkit-line-clamp: 1`）+ 尾部控件（开关 36×20）。官方条目卡（内置插件配置区）没有尾部控件。
- 卡片列表 `gap: 2px`，卡片圆角 `--dsw-radius-xl`（20），左右各外扩 8px（`margin: 0 -8px`）让 hover 面色比内容列宽一点。
- 内容列：页头与正文都 `max-width: 960px` 居中，左右内缩 `clamp(24px, 4vw, 48px)`（窄于 768 时固定 20px），正文底部 48px。

## 3 类名与稳定钩子

- 页面类名是**构建哈希**：`w6M7KW_*`（page 与全部子模块）、`_tabs_1lga9_1`（页签容器，来自 primitives）、`_switch_1ik0f_5`（开关，来自 primitives）。这三个哈希在 rc.3 与 rc.1 上相同（CSS 模块内容未变），但每次构建都可能变，所以任何选择器里出现它们次日就会失效。
- 真正稳定的钩子是**宿主自己写出来给脚本用的**，rc.3 已有一整套，量几何、写断言都按这套定位：

| 钩子 | 落点 |
| --- | --- |
| `style[data-plugin="<包名>"]` | 插件注入的 `<style>` 标签（宿主 loader 设 `tag.dataset.plugin`） |
| `style[data-plugin-css="<包名>/<模块>.module.css"]` | 同上，按模块去重（`tag.dataset.pluginCss = tagId`） |
| `--dsh-frame-top-clearance` | `html` 级自定义属性，darwin 下 `48px`（由 `LAYOUT` 声明），全屏时 overlay 那一份归零 |
| `[data-plugin-panel]` / `[data-plugin-body]` / `[data-plugin-bar]` | 页面根容器 / 滚动容器 / 吸顶页头容器 |
| `[data-plugin-header-part="title\|intro\|toolbar\|tabs"]` | 页头四段，收拢动画按这四段插值（见 5 节） |
| `[data-plugin-group]` + `[data-plugin-scope]` | 分区（`basic` / `extensions` / `bundles` / `more`） |
| `[data-plugin-package="<包名>"]` + `[data-plugin-status]` + `[data-plugin-highlight]` | 包卡片、它的状态档（`running` / `disabled` / `not-running` / `problem`）、刚被启用时的闪烁标记 |
| `[data-plugin-item="<id>"]` / `[data-plugin-item-detail]` | 官方条目卡 / 条目详情页 |
| `[data-plugin-detail="<包名>"]` / `[data-plugin-row-detail]` | 包详情页 / 组件行详情页 |
| `[data-plugin-rows]` / `[data-plugin-row]` / `[data-state="off\|failed"]` | 「包含的组件」区、单行、行的两档视觉 |
| `[data-plugin-source]` / `[data-plugin-versions]` / `[data-plugin-config]` | 来源信息区 / 版本区 / 配置表单区 |
| `[data-plugin-name]` | 标题组里那行包名（`<code>`） |
| `[data-plugin-loading]` / `[data-plugin-versions]` | 首读骨架 |
| `[data-package-meta-error]` / `[data-plugin-runtime-error]` | 卡片与行上的两类诊断句 |
| `[data-install-phase]` / `[data-install-subject]` / `[data-install-guide]` / `[data-install-registry]` / `[data-install-approval]` | 安装弹窗的相位、主体卡、引导、安装源面板、脚本授权块 |
| `[data-detail-document]` | 详情正文（宿主 primitives 的 `DetailDocument`，见 7.6） |
| `[data-window-drag]` | 承担窗口拖拽的头部盒（页头、详情头、更多页头） |
| `[data-natural]` / `[data-compact]` / `[data-scrolled]` / `[data-measuring]` | 吸顶页头的四个状态位，见 5 节 |

- 页头状态句的类名是 `.updatesNote`（12/18、tertiary），另有 `data-tone="info"`（business 主色）/ `data-tone="error"`（error 色）。`.status` 是页内状态段（`partsEmpty` / `installChecking` / `unavailable`）用的，两者不是一回事。

## 4 度量刻度（宿主自用值，源码声明值优先）

| 项 | 值 |
| --- | --- |
| 页面左右内缩 | `clamp(24px, 4vw, 48px)`；`max-width: 767px` 时固定 20px |
| 页头顶部内缩 | `--plugin-page-top-inset: 28px`；darwin 再加 `--dsh-frame-top-clearance`（48px） |
| 内容列宽 | `max-width: 960px`（页头、正文、更多页头各自居中） |
| 滚动容器 | `overflow-y: auto`、`padding: 0 <内缩> 48px`、`gap: 32px`；`scroll-padding-top: var(--plugin-header-scroll-padding)` |
| 吸顶页头 | 静止高 `--plugin-header-rest-height`、收拢高 `--plugin-header-compact-height`、可滚行程 `--plugin-header-travel` = 两者之差 |
| 页签（`SegmentedTabs size="sm"`） | 总高 **34px** = 30px tab + 2px×2 内衬；容器圆角 `calc(12px + 2px)`；容器底 `bg-module-platform` |
| 页签文字 | 14/20，左右 padding 12，选中 `font-weight: 500`（默认尺寸才是 600） |
| 卡片头部 | 内衬 8、图标后 gap 14、图标盒 48（content-box，加 0.5 边框实际 49）、卡片外扩 -8 |
| 卡片列表 | `gap: 2px`，卡片圆角 20 |
| 行内控件 | 开关 36×20（padding 2、圆角 999）；开关左侧预留 `--bundle-progress-size: 14px`，与开关间距 `--bundle-toggle-gap: 8px` |
| 工具条 | `gap: 8px 16px`；`刷新` 用 primitives `outline/sm`（高 28） |
| 添加组（主按钮 + chevron） | 高 **32**、`13/20`、`padding: 0 12px`、圆角 `--dsw-radius-md`（12）；chevron 段宽 32、左描边 `.5px` `color-mix(label-primary-foreground 30%, transparent)` |
| `IconButton`（工具条图标位） | 28×28、圆角 8 |
| darwin 标题栏安全区 | `--dsh-frame-top-clearance: 48px`（`html[data-platform="darwin"]`，由 `LAYOUT` 声明）；`--dsh-frame-overlay-top` = 它 + 20px |
| 半径令牌 | xs 4 / sm 8 / md 12 / lg 16 / xl 20 / panel 28（`THEME` 的 `base.css`） |

## 5 交互与状态形状

- **行本身是链接**：`li.card.cardLink` 带 `position: relative`，标题按钮用 `::after { inset: 0 }` 铺满整张卡当点击面，尾部控件单独 `z-index: 1` 浮在上层。
  - 按下：`.cardLink:active` → `--dsw-alias-interactive-bg-active`（亮 `rgba(38, 49, 72, 0.1)` / 暗 `rgba(255, 255, 255, 0.14)`）。
  - 悬停：`@media (hover: hover)` 里 `.cardLink:hover` → `--dsw-alias-interactive-bg-hover`（亮 `rgba(38, 49, 72, 0.06)` = `#2631480f` / 暗 `rgba(255, 255, 255, 0.08)` = `#ffffff14`）。**两个态是两个不同令牌**，不是同一个色上下调。
  - 可用下限：`--dsw-alias-interactive-bg-active` 自 `0.1.5-rc.3` 起就在 theme 包里，`0.2.0-rc.2` / `0.2.1-rc.1` / `0.2.2-rc.1` 与 rc.3 的值完全一致（亮 `#2631481a` / 暗 `#ffffff24`），`:hover` 同；宿主 `@deepseek-ai/dsh` 与这批 `dsh-client-ui-*` 包版本锁步。
  - 焦点：`.cardOpen:focus-visible::after` 用 `--dsw-focus-ring-color` 画环、`outline-offset: 2px`；`.cardOpen` 自己 `outline: none`。
- **页头收拢**（`header-scroll.ts`）：页面滚动时页头不换布局，只做几何插值。`measure()` 把页头克隆一份、打 `data-measuring` 塞进滚动容器里量出「静止」与「收拢」两套盒，再给 `title` / `intro` / `toolbar` / `tabs` 四段写 `--plugin-part-x/-y/-width`；滚动时按 `scrollTop` 对每段 `translate` + `width` 插值，`intro` 过了行程用 `clipPath: inset(N% 0 0)` 收掉并置 `inert`。`data-compact` 在 `scrollTop >= 行程` 时出现，`data-scrolled` 在 `> 0` 时出现；`--plugin-header-paint-height` 给吸顶层的实底高度。窗口变化、字体加载完、页头内容变化都会重测。
- **状态句**（`.updatesNote`）：只有「已安装」页签有它，三态文案取自 locale（`updatesAvailable`「{count} 个插件可更新」带 **计数**、`updatesNone`「所有插件均为最新版本」、`updatesFailed`「部分插件检查更新失败」）；**任一检测还在 `checking` 时整句返回 `undefined`（不渲染）**，没有「保持上一轮」这一说。
- **可配置项**用受控 `Switch`；开关位左侧是 `role="status"` 的 14×14 占位，进行中换 `StateDot state="ongoing"`，并有一句只给读屏的 `applyingChange`。
- **错误态容器** `.failure{color: error}`，但内部 `<p>` 被 `.failure p` 覆盖成 `label-tertiary`——**文字不红，红色由 `StateDot state="error"` 承担**，`<p>` 另带 `role="alert"`，右侧一枚「重试」（`outline/sm`）。
- **卡片状态标签** `.statusTag`：高 18、左右 padding 7、`10px / 1`、`tone="danger"` 用于 `statusProblem`「异常」/ `statusNotRunning`「未运行」，`tone="info"` 用于 `statusBeta`「实验性」与 `statusUpdateAvailable`「可更新」。
- **骨架行**：一个 `group` + 4 张卡；标题条 `48px`、描述条 `min(280px, 85%)`、尾部占位 `36 + 8 + 14 = 58` × 20；条高 12、圆角 4、`bg-skeleton` 底，2s 呼吸动画，`prefers-reduced-motion` 时停。
- **页内提示**走 `Toast`，显示时长 `clamp(3000, 文字长度 × 80, 8000)` ms。

## 6 控件由浏览器 seed 提供

`SegmentedTabs` / `Switch` / `Button` / `Tooltip` / `Toast` / `StateDot` / `Tag` / `Modal` / `Menu` / `MenuItemButton` / `Input` / `Checkbox` / `TerminalBlock` / `DetailDocument` / 全部图标都是 `@deepseek-ai/dsh-client-ui-primitives` 的导出，运行时由宿主注入的 seed 提供；node 侧 import 不到（产物在 `SHELL/` 里），测试需要替身。

## 7 插件详情页（采集 2026-11-10，二次采集；五次采集按 rc.3 源码整份复核）

> 采集环境（二次采集）：`app.asar` 内 `dsh/lib/bin.js` + `ELECTRON_RUN_AS_NODE` 起 `dsh web --no-open --port 0`，隔离 `DSH_HOME`；视口 **1440×920**、`Emulation.setDeviceMetricsOverride` 强制 **DPR 1**（像素与 CSS px 一一对应）。读数用 `getComputedStyle` + `getBoundingClientRect`，深色用 `Emulation.setEmulatedMedia` 切换后同一元素再读。宿主升级后按 1 节的采集环境整份重采。
> 目标文件：`PM/lib/client.js`（`@deepseek-ai/dsh-client-ui-plugin-manager` 的客户端产物），rc.3 实测 **357 239 B**（二次采集时同一文件在 `0.2.2-rc.1` 上是 438 450 B；两次都是 node 读 asar 的字节数，**不要用 grep 搜中文**，理由见 1 节的警告）。rc.3 起详情页的 markdown 正文由 primitives 的 `DetailDocument` 渲染，刻度落在 `SHELL/` 的 CSS 里。
> 五次采集的读数有两套来源：**声明值**（`PM/PluginManagerPage.module.css` 与 `SHELL/` 的 CSS，逐字）与**真机值**（二次采集的 `getComputedStyle`，标注「真机」）。两者不冲突时以声明值为准。

区块顺序（自上而下，真机截图与产物一致）：

1. 面包屑 `‹ 插件`（键 `crumbRoot`；列表侧的返回键是 `backToList`「返回插件」，从「更多」子页进来的那一层是 `backToPackage`「返回 {name}」，三个都不是同一个字符串）
2. 头行：左图标（48 content-box，实际 49）+ 右侧动作组，顺序是 **插槽 → 更新（若有）→ 更新到 {version}（若有）→ 卸载（若有）→ 开关**
3. 标题组 `detailMain`：`h3` 标题 + 版本 Tag `versionTag`（`v{version}`）+ 状态标签族（`statusBeta` / `statusProblem` / `statusNotRunning` / 包不可用 / 可更新）+ 包名行 `p.detailName` + 描述
4. 正文区：`DetailDocument` 渲染的详细介绍，关在一个内滚动盒里（**紧接描述、前面没有区块标题**；读不到时给骨架 / 失败句 + 重试）
5. 技术区 `detailSections`，固定次序：「包含的组件」（`partsLabel`）→「版本」（`versionsTitle`，仅 registry 来源）→「来源信息」（`sourceTitle`，页尾）

locale 键值（逐字，来自该包的 zh 表）：

| 键 | zh |
| --- | --- |
| `crumbRoot` / `backToList` / `backToPackage` | 插件 / 返回插件 / 返回 {name} |
| `openDetail` / `configureRow` | 查看 {name} / 配置 {name} |
| `uninstall` / `uninstallLabel` | 卸载 / 卸载 {name} |
| `update` / `updateLabel` / `versionsUpdateLabel` | 更新 / 更新 {name} / 更新到 {version} |
| `versionTag` / `statusBeta` / `statusProblem` / `statusNotRunning` / `statusUpdateAvailable` | v{version} / 实验性 / 异常 / 未运行 / 可更新 |
| `partsLabel` / `partsCountTotal` / `partsCountRunning` / `partsCountOff` / `partsCountFailed` / `partsFilter` | 包含的组件 / 共 {count} 个 / {count} 运行中 / {count} 已停用 / {count} 异常 / 筛选组件 |
| `versionsTitle` / `versionsRecheck` / `versionsAvailable` / `versionsLatest` / `versionsCheckedAt` | 版本 / 重新检查 / 可更新到 {version} / 已是最新版本 / 上次检查于 {time} |
| `sourceTitle` / `sourceSpec` / `sourceVersion` / `sourceBuiltIn` | 来源信息 / 代码来源 / 当前版本 / 内置 |

上一版这一节「只记结构与键值、px 一个都没有」（那时类名是构建哈希、样式在另一份产物里）；rc.3 的 asar 带 CSS 模块源码，本节读数因此逐值可复核。推断只保留 7.6 那条「视口高 / 60vh」的换算，且已标为算式而不是猜的。

### 7.1 页面骨架

| 角色 | 读数 |
| --- | --- |
| `pageBody` 滚动容器 | `padding: 0 clamp(24px, 4vw, 48px) 48px`（1440 视口下 4vw 超上限，落到 48）；`overflow-y: auto` |
| 内容列 | `max-width: 960px` 居中（1440 视口、侧栏 280 时左边界 **380**） |
| 顶部留白 | `detailTop { padding-top: var(--plugin-page-top-inset) }` = **28**（darwin 再加 `--dsh-frame-top-clearance` 48） |
| 面包屑 → 头行 | **32**（`detailHead { margin: 32px 0 0 }`） |
| 头行 → 标题组 | **20**（`detailMain { margin-top: 20px }`） |
| 标题组内部 | `gap: 8` |
| 标题组 → 技术区 | **32**（`detailSections { margin-top: 32px }`） |
| 区块之间 | **32**（`detailSections { gap: 32 }`，区块自身 `margin: 0` —— **单一来源**，不是两层叠出来的） |
| 区块内部 | `gap: 12`（标题 → 内容） |

### 7.2 面包屑

| 角色 | 读数 |
| --- | --- |
| 按钮 | `12.5px`、继承字重、`label-tertiary`（亮 `rgb(129, 133, 140)` / 暗 `rgb(173, 178, 184)`）；盒高 18（真机） |
| hover | 字色 → `label-primary`（亮 `rgb(15, 17, 21)` / 暗 `rgb(249, 250, 251)`），`text-decoration: none`，只在 `@media (hover: hover)` 里 |
| focus | `--dsw-focus-ring-color` 环、`outline-offset: 2px` |
| 箭头 | 一枚 `IconChevronDownOutlineRegular` 旋转 90° 当返回箭头（真机 14×14），与文字 `column-gap: 6px` |

### 7.3 头行（图标 + 动作组）

| 角色 | 读数 |
| --- | --- |
| 图标盒 | **48** content-box（加 `.5px` 边框实际 49）、圆角 `--dsw-radius-lg`（16）、`border: .5px solid` `border-l3`（亮 `rgba(0,0,0,.12)` / 暗 `rgba(255,255,255,.16)`）、背景透明；内部 `<img>` **36×36** 居中。**详情与列表同尺寸**（详情不放大） |
| 图标来源 | `iconOf()` 把 `package.json` 的 `icon`（**包内相对路径**，只认 SVG / PNG / JPEG / WebP，单文件 **≤256 KiB**）读成 `data:<media>;base64,…` 交给 `<img>` 承载 ⇒ 图内**不能依赖 `currentColor` 或外部样式**（在 `<img>` 里解析成默认黑，深色主题下等于看不见），必须自着色；卡片内 `<img>` 固定 **36×36**（行内图标 30）⇒ **图标文件必须铺满自身 `viewBox`**，图内留白会直接缩小图形（首版底板只占 86.7%，实测只有 32 CSS）；官方内置插件由组件绘制、能画到 40，文件型图标的上限就是 36 |
| 图标缺失 / 解码失败 | `PackageArtwork` 的 `src === undefined \|\| src === failedSource` 分支 ⇒ 画 `Fallback`，而 `Fallback = row ? PluginArtworkSubagent : PluginArtworkDefault`、`size = row ? 30 : 36`。**两张不是同一张**：· 已安装列表行（`<PackageArtwork src={row.meta?.icon} row />`）⇒ **`PluginArtworkSubagent`**，size **30**（两个偏移圆角方块 + 四段渐变 `#45E7A4→#05909D` / `#69B9FF→#324DE2`）；· 包卡片（`CardHead`）与包详情页头（`DetailTop`）⇒ **`PluginArtworkDefault`**，size **36**（`viewBox="0 0 36 36"`、固定 `#54ECE7 → #658EFF` 渐变）；两者都**不用 `currentColor`**。来源：`PM/PluginManagerPage.tsx` 的 `PackageArtwork({src, row = false, size = row ? 30 : 36})` 与上面三个调用点；两个组件本体读自 `node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js`（`const PluginArtworkDefault` / `PluginArtworkSubagent` 的签名都是 `({size = 36, className})`——默认 36，30 由 `PackageArtwork` 显式传入），宿主前端 bundle 同样导出它们 |
| 布局 | `display: flex` + `justify-content: space-between` + `align-items: center` + `gap: 12`；图标贴内容左沿（x=380）、动作组贴右沿（right=1340） |
| 动作组内 `gap` | **16** |
| 更新按钮（包级） | `Button outline/sm` + `IconRefreshOutlineRegular` 13，`aria-label` = `updateLabel` |
| 版本更新按钮 | `Button primary/sm` + `IconRefreshOutlineRegular` 13，文案与 `aria-label` 都是 `versionsUpdateLabel`（带目标版本号） |
| 卸载按钮 | `Button outline/sm` + `className=danger`，高 **28**、`padding: 0 10px`、`12px/18px`、圆角 **8**（`radius-sm`）；文字 `state-error-primary`（亮 `rgb(236, 19, 19)` / 暗 `rgb(242, 90, 90)`）；描边是 `box-shadow: inset 0 0 0 .5px` 同色 **30%** 的环（`border: .5px solid transparent`，**不是** border 画红）；svg **13×13**（图标盒 16），图标 ↔ 文字 **4** |
| 卸载按钮禁用态 | `Button` 的 `:disabled` 只有 `opacity: .4` + `cursor: not-allowed`，颜色不变 |
| 开关 | 36×20（与列表行同一个控件） |

宿主写法（`PM/PluginManagerPage.tsx` 的 `PackageDetail`，逐字）：`Button` + `variant="outline"` + `size="sm"` + `className: css.danger` + `icon: IconTrashOutlineRegular size 13` + `aria-label: t('uninstallLabel', {name})` + `disabled: busy || !pkg.removable || pkg.readOnlyReason !== undefined`。`danger` 类只做三件事：`color: var(--dsw-alias-state-error-primary)`、把 primitives 的 `--dsh-button-outline-color` 设成同色 30%（`color-mix`）、把 `--dsw-alias-interactive-bg-hover` 改绑成同色 8% 的淡红（这样 outline 按钮的 hover 是红雾不是灰雾）。

### 7.4 标题组（h3 + 版本 + **包名** + 描述）

| 角色 | 读数 |
| --- | --- |
| `h3` 标题 | `20px / 28px / 500` |
| 标题行 | `.titleRow`：`flex-wrap: wrap`、`gap: 8`；版本 Tag 与状态标签都在这行 |
| 版本 Tag | primitives `Tag tone="neutral"` + `font-variant-numeric: tabular-nums`；与标题 `gap: 8`；键 `versionTag` = `v{version}`，无版本不画；`Tag` 的尺寸由 primitives 给（真机 11/17/500、`padding: 1px 8px`、圆角 999、底 `bg-module-platform` = 亮 `rgb(245,246,247)` / 暗 `rgb(53,54,56)`） |
| **包名行** `p.detailName` | **`12px / 18px`**、`label-tertiary`、`overflow-wrap: anywhere`；内容 `<code data-plugin-name>` 走 `--dsw-font-mono`（缺省 `ui-monospace, SFMono-Regular, Menlo, monospace`） |
| 描述 | **`14px / 22px`**、`label-secondary`（亮 `rgb(97,102,107)`）、**不截断** |
| 间距 | 标题行 / 包名 / 描述三者之间全是 `detailMain { gap: 8 }` |
| 诊断句 | `p.reason` 落在标题组与技术区之间：包元信息错误、`reasonLabel`「原因」+ 拒绝码人话、只读原因，都带 `role="status"` |

### 7.5 技术区：事实行、来源信息、「包含的组件」、版本区

| 角色 | 读数 |
| --- | --- |
| 区块标题 | `14px / 20px / 500`；标题行 `align-items: baseline`、`gap: 10` |
| 区块计数 | `12px / 18px`、`label-secondary`（「共 12 个 · 5 运行中」由 `partsSummary` 拼，只列出现的态） |
| 事实行（来源信息） | `min-height: **44**`、`padding: 8px 2px`、两端对齐 `gap: 16`、每行都有 `.5px` 分隔线 `border-l2`（亮 `rgba(0,0,0,.1)` / 暗 `rgba(255,255,255,.12)`，**最后一行也有**） |
| 事实行左右 | 左 `dt` `13px/20px/400` `label-secondary`；右 `dd` `13px/20px/400`、右对齐、`overflow-wrap: anywhere`；`dd > code` `12px`、`padding: 2px 6px`、圆角 4、底 `bg-module-platform` |
| 来源信息行数 | 「代码来源」（`sourceSpec`，`<code>`；不可用时给 `sourceBuiltIn`「内置」或 `statusMissingFiles`）+「当前版本」（`sourceVersion`）+（有目标版本时）「当前 DSH 对应来源」「当前 DSH 对应版本」 |
| **「包含的组件」行** | 行 `padding: 12px 2px`、`.5px` 分隔线、**最后一行的分隔线被去掉**；行盒高 **64.5**（12 + 40 + 12 + 0.5）；图标盒 **40×40**、圆角 `radius-md`（12）、`.5px` `border-l3`、内部图案默认 30；行内 `gap: 16`；`rowId`（名字）**13.5px / 20px / 500**，关闭态降成 `label-secondary`；副行 `11.5px / 16px` mono `label-tertiary`；右端是 `StateDot` + `12.5px / 18px` 状态句（`gap: 6`）再跟开关 |
| **组件筛选** | 组件数 **> 10** 时才出现一枚 `Input type="search"`（`partsFilter`「筛选组件」），命中为空给「没有匹配的组件」 |
| 组件的可配行 | 有配置页的行把名字换成 `button.rowOpen`（名字 + 右箭头 `IconChevronRightOutlineRegular`），hover 时名字下划线 + 箭头变主色；无配置页的行就是纯文本 |
| **版本区块** | 圆角卡：`border: .5px solid` `settings-card-stroke`、圆角 `--dsw-radius-xl`（20）、底 `settings-card-fill`、`overflow: hidden`；区块标题右侧一枚「重新检查」（`ghost/sm` + `IconRefreshOutlineRegular` 13，检查未结束前 `disabled`） |
| 版本摘要行 | `min-height: **64**`、`padding: 12px 16px`、`gap: 12`；左侧 32×32 圆形图标（底 `bg-module-platform`，四档 tone 用 business / success / warn / error 的 10%–12% 淡底）；标题 `14px/20px/500`、副行 `12.5px/18px` `label-tertiary`；右端 `12.5px` + chevron（展开时旋转 180°）；展开后摘要行底变 `bg-module-platform` |
| 版本行 | 网格 `minmax(0,1fr) max-content 56px`、`gap: 16`、`min-height: 28`、`padding: 12px 0`、行间 `.5px` `border-l2`（最后一行去掉）；版本号 `13px/20px/500` mono + `tabular-nums`（被挡住的版本降 tertiary）；标签是 `Tag tone="outline"`/`danger`/`warning`；日期 `12.5px/18px` `label-tertiary`；动作位固定 56 宽，可装的版本给「更新」 |
| 版本尾注 | `padding: 12px 0` + 上分隔线：`versionsRegistry`「安装源」、`versionsCheckedAtLabel`「检查于」、可选「显示预发布版本」勾选框；失败态改列每个安装源的名次与失败原因（`versionsPrimaryTag` / `versionsFallbackTag`） |
| 更新弹窗 | 点版本行的「更新」或页头的「更新到 {version}」开启，四步按宿主顺序：`updateStepChecking` 检查 → `updateStepRemoving` 停止并移除 → `updateStepInstalling` 安装 → `updateStepRestoring`（失败回滚时才有）|
| 页尾可变段 | 技术区最后一位是 `plugins.detail.section` 插槽，由插件自己往里放内容；`dsh-client-ui-plugin-manager` 自己不渲染任何外链（旧记的「查看仓库」在 rc.3 这一版里已找不到，只可能来自该插槽） |

### 7.6 正文 Markdown 与内滚动盒

| 角色 | 读数 |
| --- | --- |
| **正文滚动区** | 容器 `section[data-detail-document]`（`display: flex; flex-direction: column; gap: 12`）里的 `div[role="region"]`：`max-height: min(560px, 60vh)`、`overflow-y: auto`、上下各 `.5px` `border-l1` 边、`scrollbar-gutter: stable`、`padding: 12px 0`、`overflow-wrap: anywhere`、可聚焦（`tabIndex: 0`，focus 环 offset 3） |
| 视口换算 | 920 高的视口下 `60vh = 552`，取 `min(560, 552)` 得 **552**——二次采集量到的 552 就是这一支，不是写死的数；视口高超过 933 时封顶 560 |
| 段落 / 标题 | 排版走字体令牌 `--dsw-font-markdown-*`：正文 `14px / 24px / 400`、`h1` `700 21/30`、`h2` `700 19/28`；段落 `margin: 16px 0`，`h1`–`h3` 统一 `margin: 32px 0 16px`（**不是**旧记的 `h1` 零上边距） |
| 代码块 / 行内 `code` | 由 primitives 的代码块组件渲染，**真机读数**（二次采集）：代码块底 `bg-layer-1` 一档、圆角 16、标题条盒高 42、`padding: 10px 18px 8px 22px`、`11px/18px`；行内 `code` `12.25px/19px`、`padding: 0 5px`、圆角 8 |
| 读不到时 | 骨架（三条 12 高圆角 4 的条，2s 呼吸）或失败句 + 「重试」；失败档是 `detailTooLarge` / `detailNetwork` / `detailInvalid` / `detailFailed` |
| 深色 | 正文底 `rgb(27,27,28)`、代码块同色；页面底色 `rgb(21,21,23)` |

### 7.7 复刻口径不在本文

「哪些照抄、哪些有意不追」写在契约里：整行可点与 `cardLink` 取色、详情页的 `.skc_detail*` 刻度见 `docs/contracts/visual.md` A.5 / A.6，详情页结构与删除入口见 `docs/contracts/installed-detail.md`，两次采集之间的取舍见 `docs/contracts/decisions.md` 附录 Q。本文只记宿主原样。

### 7.8 采集坑（下次别再花时间）

1. 隔离 profile 只写 `dsh.profile.bundles` 时，宿主「插件」页**不列**第三方包；必须同时在该 `package.json` 里写 `dependencies: {"dsh-skill-panel": "link:<仓库绝对路径>"}`。
2. 该组的卡片常在首屏外（1440×920 下 y≈883），要先滚到底再点；刚装完的包会被 `data-plugin-highlight` 闪一下，别把它当成常态样式。
3. 宿主类名是构建哈希（`w6M7KW_*`），语义片段（`[class*="crumb"]`）能凑合，但 3 节那套 `data-plugin-*` 钩子才是正确入口。
4. 在 `<html>` 上模拟 `data-platform=darwin` 会让整轮静默挂死（宿主外壳也读它）；要验 darwin 分支只在 `.skc_page` 上打属性。
5. 页头是**吸顶 + 几何插值**的：截图前先 `scrollTop = 0`，否则量到的 `title`/`intro` 位置是插值中间态。

## 8 添加插件与卸载两条流程（采集 2026-11-12，**§8.1 于 2026-11-13 复采、全文于 2026-11-15 按 rc.3 复核**）

> 采集方法：**node 逐字节读 asar**（1 节那条「`grep` 搜中文会静默漏检」的警告在这儿一样成立）。来源文件都在包里、且都是 TS 源码：`PM/src/client/PluginManagerPage.tsx`（94 051 B）、`PM/src/client/manager-store.ts`（78 429 B）、`PM/src/client/locales.ts`（173 664 B）、`PM/src/client/versions.tsx`（23 475 B）；服务端拒绝码在 `SRV/` 的 `failure.js`（990 B）与 `index.js`（96 905 B）。本节只写符号名与键名，不写行号坐标（坐标换一版构建就失效）。

### 8.1 添加入口：工具条第三位的 `AddPluginMenu`

- 工具条顺序：状态句 `updatesNote` → 刷新（`variant="outline"`，进行中换 `StateDot state="ongoing" size={13}`）→ **`AddPluginMenu`**。
- **「添加」与「看进度」共用一个位置**：`state.install.requestId === undefined` 时渲染 `AddPluginMenu`，否则换成一枚 `variant="primary"` 的「查看安装任务」（`installViewTask`）。
- `AddPluginMenu` 是**主按钮 + chevron** 两枚，包在 `span.addGroup` 里（`role="group"` + `aria-label="添加插件"`）：主按钮 `variant="primary" size="sm"` + `IconPlusOutlineRegular size={13}` + `aria-label={t('addPlugin')}`，**点击直接开弹窗**；chevron 带 `aria-haspopup="menu"` + `aria-expanded`，点它或按 **`ArrowDown`** 开菜单。两枚都 32 高、圆角 `radius-md`（12），但各自的相邻两角是直角——拼起来是一枚胶囊；chevron 段宽 32，与主按钮之间一条 `.5px` 分隔描边。
- 菜单是 **children 模式**（不是 `items` 数组）：`Menu open/onClose align="end" portal autoFocus listClassName={css.addMenu} anchor={chevron}`，子节点是 primitives 的 **`MenuItemButton`**（`icon` + `onSelect` + 可选 `disabled`）。这一版渲染**两项**：
  1. `installExisting`「安装第三方插件」+ 副行 `installExistingDescription`「支持 npm 包、Git 仓库和本地目录」，`icon={<IconDownloadOutlineRegular size={14} />}`，`onSelect` = 关菜单 + 开安装弹窗；
  2. **由 `PRESET` 的 `CreatePluginMenuItem` 注入 `plugins.add.actions` 槽**：「让 Agent 创建插件」（`createPlugin`）+ 副行「进入创造模式，制作属于你的 DSH 插件」（`createPluginDescription`），`icon={<IconAgentPresetOutlineRegular size={14} />}`；`disabled` 由 **agent preset roster** 决定（`status === 'ready'` ∧ 有 `id === 'cordis'` 才可用），副行按 roster 四态换 `createPluginChecking` / `createPluginUnavailable` / `createPluginMissing`；`onSelect` = 关菜单 + `startCreatorDraft()`，其末尾是 **`scope.uiWorkspace.startSession(undefined, { clearPreviousDraft: false, agentPreset: 'cordis' })`**。
- **四条刻度**（`PM/PluginManagerPage.module.css`，逐字）：`.addMenu{width:320px; max-width:calc(100vw - 48px)}`；`.addMenu [role='menuitem']{height:72px; box-sizing:border-box; gap:10px; padding:6px 12px}`；`.addMenuItem{display:flex; flex-direction:column; gap:2px; white-space:normal}`；`.addMenuDescription{display:-webkit-box; max-height:36px; overflow:hidden; overflow-wrap:anywhere; font-size:12px; line-height:18px; color:var(--dsw-alias-label-secondary); -webkit-box-orient:vertical; -webkit-line-clamp:2}`（**两行截断**）。
- **DOM 层次按项而分**：第一项是 `MenuItemButton`（`role="menuitem"` 的按钮 + 图标位）→ `.addMenuItem`（`flex column` + `gap:2`）→ 两行文字（第二行 `.addMenuDescription`）；第二项来自另一个包，自己的模块类（`.copy` = `flex column` + `gap:2`，`.description` = `12px/18px`、两行截断、`max-height:36px`），**取值与第一项一致但类名不共享**——按 `.addMenuDescription` 去量第二项会量空。
- chevron 的图标是 **`IconChevronDownOutlineRegular size={12}`**（不是 13），`aria-label={t('chooseAddMethod')}`「选择添加插件方式」。
- ⚠️ **采集坑（2026-11-13 QA 踩到）**：宿主页上 `button[aria-haspopup="menu"]` **有 4 枚**——侧栏「更多」、工作区操作、账号菜单、添加插件。**必须按 `aria-label="选择添加插件方式"` 定位**；用 `[0]` 或 nth 索引会量到别的菜单，量出 288 / 34 / `6px 8px` / 13·20 那一组假值（与本节四个刻度全不一致，看到这组数就是选错了元素）。
- 键位：第一项在 `PM/locales.ts` 的 zh 表（`addPlugin` / `chooseAddMethod` / `installExisting` / `installExistingDescription`）；第二项的键在 `PRESET` 的 `settings.agentPreset` 命名空间（`createPlugin` / `createPluginDescription` / `createPluginChecking` / `createPluginUnavailable` / `createPluginMissing`）。

### 8.2 安装弹窗（`InstallDialog`）：一屏表单 + 一屏确认 + 一屏向导

同一个组件按 `install.phase` 切三种壳（`[data-install-phase]` 标出相位）：

1. **表单屏**（`idle` / `checking`，且没有 `confirmed`）：`Modal` + `title=installTitle`「添加插件」+ `description=installDescription`（镜像恢复态不传 description）+ 关闭键 `close`。
   - **只有一个输入框**：`type="text"`、`placeholder=installSpecPlaceholder`、`aria-label` 取 `installSpecLabel`（镜像恢复态取 `installPackageLabel`）、`aria-invalid` + `aria-describedby` 指向字段下面那一行、回车提交、**IME 组字期间回车不提交**（组字结束后还留 10ms 窗口）。骨架模板值（`https://github.com/author/dsh-plugin` 与 `/Users/name/my-plugin`）会额外提示「请替换成实际地址 / 路径」。
   - 字段下面那一行是**就地报因**（`installProblemInvalid` / `installProblemInstalled` / `installProblemShipped` / `installProblemNotFound` / `installProblemNotPackage` / `installProblemNotBundle` / `installProblemNetwork` / `installProblemUnknown`），不是 toast。
   - 再往下 `optionsRow` 两枚文字按钮：「插件安装引导和示例」折叠面板（一例：npm 包名 + 填入示例按钮）、「安装源」选择器（`aria-haspopup="dialog"`，浮层用 CSS `anchor-name`/`position-anchor` 挂在按钮上、**不撑高弹窗**；面板是 `fieldset` + 单选：默认安装源 / npm 官方源 / 中国大陆镜像源 / 自定义地址，自定义址非法时就地报「请输入以 http:// 或 https:// 开头的地址」）。
   - `footer` 是两句话的安全提示 `installGuideSafety` + `installUpgradeNotice`，右边一枚 `wide` 主按钮（文案两态 `installRun` / `installChecking`，`aria-busy`）。
2. **确认屏**（`idle` / `checking` 且已有 `confirmed`）：标题 `installConfirmedTitle`「安装插件」，或报因时 `installConfirmedRefused`「无法安装此插件」；主体是 `SubjectBlock`（名字 / 描述 / 版本 / spec）+ 检查中的状态句或报因；`footer` 是「关闭」+ 主按钮（`installRun` / `retry`）。
3. **向导屏**（`starting` / `running` / `cancelling` / `applying` / `unconfirmed` / `unknown` / `done` / `failed`）：`Modal` 带 `headless`（标题条自己画），标题由 `SCREEN_TITLE_KEYS` 一张表定（`installStarting` / `installingTitle` / `installCancelling` / `installApplying` / `installUnconfirmedTitle` / `installUnknownTitle` / `installedTitle` / `installFailedTitle`），随附「随 DSH 提供」时改用 `installBundledTitle`。结构：头部（返回编辑 / 取消并编辑 + 关闭键）→ 图标 + 标题 + 副句（失败分类 `FAILURE_KIND_KEYS` 一张表、多源重试句 `installAttempt`、不确定句）→ 主体卡 → （需要授权时）脚本授权块 → 结局句 → 页脚动作 → 可折叠的安装详情（`TerminalBlock` 每源一段，默认只显示首末各 6 行，合计上限 12 行；含「安装位置」「完整日志」）。

- 结局句：`installDoneNothing`、`installDoneRestart`、`installDoneApproved`，以及 `installDoneOtherVersion`（因 pnpm 供应链策略装到了别的版本，**只在单源时解释**）。
- 授权块 `[data-install-approval]`：标题 `installApprovalTitle` + 说明 + 待放行的包名列表 + 后果句 + 警示句 + 主按钮 `installApproveAndRetry`「允许这些脚本并重试」。
- 「GitHub 不通」有独立恢复屏：标题 `installGithubFailedTitle` / `installGithubTimeoutTitle`，主按钮 `installUseGithubMirror`「改用国内镜像」或 `installTryAnotherWay`「试试其他方式」。
- 失败面：`FAILURE_KIND_KEYS` 十档（`pnpm-missing` / `timeout` / `not-found` / `no-matching-version` / `network` / `disk-full` / `permission` / `build-blocked` / `integrity` / `unknown`）；`build-blocked` 且没有待放行清单时给 `installFailureBuildBlockedManual`；`failedAt === 'spec-host'` 时给带 host 的 `installFailureNetworkHost`；多源全败给 `installFailureNetworkAll`。

### 8.3 校验顺序：**先在本地列表里裁决，再问远端**

`runInstall`（`PM/manager-store.ts`）的顺序是本节最值得复用的一条：

1. 空输入 / 正在跑 ⇒ 直接返回。
2. **先在已读到的包列表里按 name 命中**：`state.packages.find(pkg => pkg.name === spec)`——这一步**完全不打远端**。
3. 随 DSH 提供、默认隐藏且未启用的 bundle 直接进 done 屏（`subject.bundled`，标题 `installBundledTitle`「插件已随 DSH 提供」、副句 `installBundledDescription`），不跑 pnpm。
4. 命中且 `availability !== 'missing'` ⇒ **退回表单、在字段下就地报因**（不是结局屏）：`shipped`（随 DSH 提供）或 `already-installed`（已装过）。**这不是「谁优先」，是同一件事的两种来源**。
5. 命中但 `availability === 'missing'` 且有 `installTarget` 时，用目录里记的目标版本**直接进入安装**（`saveExact`，跳过解析）。
6. 以上都没命中才 `inspect()`（远端解析），之后才是真正的安装；自定义安装源地址不合法时更早一步就退回表单并在安装源面板上报错。

结论：「这个包装过没装过」**在本地列表里就裁决完**，远端只负责「怎么装」；而「已装过」的表达方式是**字段下的一句话**，不是一屏结论。

### 8.4 卸载入口与顺序

- 卸载**只有一处**：插件详情页头的动作组。顺序是 **插槽 `plugins.detail.actions` → 更新（包级，`outline/sm`）→ 更新到 {version}（`primary/sm`）→ 卸载 → 开关**。
- 两层可见性：外层条件 `pkg.installed || pkg.removable`，内层 `disabled = busy || !pkg.removable || pkg.readOnlyReason !== undefined`——**可见的不可点**与「不出现」是两件事，宿主用的是前者。
- **行/卡片上没有卸载位**：卡片尾部只有开关，「查看」是标题按钮铺满整卡。
- 落点：`uninstall` action 只把 `pendingConfirm` 挂上并 `patch({ confirm })`；真正的请求在确认之后走 `removeBundle(name)`（服务端 `SRV/index.js`）。
- 包级「更新」是**先移除再安装**（`application === 'stop-profile'` 时改走目录安装），失败时宿主自己把 `from` 版本装回来（结局句 `updateRestored` / `updateKept` / `updateBroken`）。

### 8.5 卸载确认与三条行为结论

`ConfirmDialog` 是 `Modal` + 标题 `confirmUninstallTitle`（zh「卸载「{name}」？」）+ 正文 `confirmUninstallDescription`「卸载后它提供的功能会消失。」+ 两枚按钮 `confirmUninstall`「卸载」（`primary` + `dangerButton`）/ `cancel`「取消」；**没有事实表、没有勾选框**。三条可直接照抄的行为：

1. **先关弹窗再发请求**：`confirm()` 取出 `pendingConfirm` → 清空 → `patch({ confirm: null })`，**然后**才 `await pending()`。
2. **成功静默，没有「已卸载」toast**：`applied()` 的 `application: 'applied'` 分支直接 `return`——表达方式是「行消失 + 详情退回」。其余三档才出提示：`cancelled`、`restart-required`（`restartNotice` 带原因）、`overridden`（`overriddenNotice`「已保存，但被更高优先级的配置覆盖」）。
3. **失败才有文案**：`failedUninstall`「卸载失败：{reason}」。

### 8.6 服务端拒绝码面：没有 `E_*` 一族，也没有 per-refusal HTTP 状态

- 拒绝走 `ManagementFailure(code)`（`SRV/failure.js`）：只有 `code` 与可选的 `incompatible`，**没有任何 HTTP 状态字段**（该文件全文 990 B，`statusCode` / `httpStatus` 零出现）。
- 卸载相关四码：`not-removable`、`stop-profile`、`bundle-in-use`、`unknown-plugin`（四者在 `SRV/index.js` 各出现一次）。
- 码到人话的映射在**客户端**：`reasonManagementRequired` / `reasonUnaddressable` / `reasonUnknownPlugin` / `reasonAlreadyInstalled` / `reasonNotRemovable` / `reasonStopProfile` / `reasonBundleInUse` / `reasonStaleApproval` / `reasonIncompatibleVersion` …（`PM/locales.ts`）。所以「一码一 HTTP + 一码一文案键」是本插件更强的口径；宿主只保证「一码一句人话」。
- 版本检查另有一套结果类型（`SRV/versions.js`）与失败面（`network` / `not-found` / `unknown`），同样不带 HTTP 状态。

### 8.7 我们照做了什么：只留指针

本节只记宿主形状；**我们的口径与差异**都在契约里，使用者能感知到什么在 `CHANGELOG.md`，别在这儿复述：

| 宿主事实 | 我们的落点 |
| --- | --- |
| 添加是「检查 → 安装」两段（`inspect()` 之后才装） | 合并成一段式，理由见 `docs/contracts/decisions.md` 附录 S-1 |
| 收 npm 包名 / Git 地址 / 本地绝对路径三类 spec，另有安装源选择与 pnpm 脚本授权 | 只收本机目录与 GitHub 链接；放宽 `~` 前缀已登记偏离，见附录 S-3 |
| 卸载成功静默、先关弹窗 | 照抄（删除成功无 toast），见附录 S-5；先关弹窗再发请求写在 `docs/contracts/client.md` §3.9.7 |
| 卸载前不问「本会话正在使用」（宿主靠 loader 持有判 `bundle-in-use`） | 这两层不搬，理由见附录 S-4；真机观察项写在 `docs/contracts/acceptance.md` 的「真机才能验证的项」 |
| 卸载入口只在详情页头、行上没有 | 同构：`docs/contracts/installed-detail.md` 的「删除技能」一节；点击边界见 `AGENTS.md` 硬约束 9 |
| 校验顺序里「先按 name 命中本地列表」 | 对应我们的 S6（`lstat` 同名即拒）+ S7（影子判据），见 `docs/contracts/routes.md` §3.3.4 与附录 S-6 |
| 弹窗单输入 + 字段下报因 + 结局屏 | `docs/contracts/client.md` §3.9.7 |
| 菜单尾部的 `plugins.add.actions` 插槽 | 只保留一项（本插件没有第二种添加方式） |
| pnpm 日志 / 安装任务页 / 镜像恢复 / 版本区与更新弹窗 | 不复刻（技能包不经过 pnpm，也没有 npm 版本族；版本区只保留「来源信息 → 当前版本」） |
