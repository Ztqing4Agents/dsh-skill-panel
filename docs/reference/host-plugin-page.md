# 宿主「插件」页

> 类型：参考
> 读者：要复刻宿主页面形状的人——改 `src/client/styles.js`、`page.jsx`、`row.jsx` 之前对照本节读数
> 真源：宿主产物本身（`app.asar` 内的 `@deepseek-ai/dsh-client-ui-plugin-manager`）；本文只是它的采集副本
> 更新触发：宿主升级到新的 `0.2.x-rc` 后**整份重采**，不在旧表上打补丁
> 规模上限：600
> 采集日期：2026-11-08
> 二次采集：§7「插件详情页」于 2026-11-10 用 node 读 asar 补采（同日二核，见 `docs/contracts/decisions.md` 附录 Q）
> 三次采集：§8「添加插件与卸载两条流程」于 2026-11-12 用 node 读 asar 采集、并逐条验签行号（同源 `0.2.2-rc.1`；宿主升级后与 §7 一起整份重采）
> 四次采集：§8.1「添加插件菜单」于 2026-11-13 复采（**同一版宿主** `0.2.2-rc.1`；这一版装了 `dsh-client-ui-agent-preset`，菜单从一项变两项——旧值不适用，按复采结果整条重写）
> 来源版本：DeepSeek Harness `0.2.2-rc.1`（`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`）

只描述**宿主长什么样**，不写「我们应该怎么用」——复刻口径在 `docs/contracts/visual.md`。

## 1 怎么采集、怎么验

asar 是「头部 JSON + 拼接内容」的容器，不是目录；整包 `grep -a` 就能命中内部字符串：

```bash
A="/Applications/DeepSeek Harness.app/Contents/Resources/app.asar"
grep -ac updatesNote           "$A"   # 页头状态文案类（本文 §3）
grep -ac _tabs_1lga9_1         "$A"   # 页签容器的构建哈希（本文 §3）
grep -ac -- --bundle-progress-size "$A"   # 打开进度占位宽（本文 §4）
```

本文任何一条测量都可用「重跑上面三条 + 重新截同一页」复核。宿主升级后三项若为 0，说明整份已失效，按 `来源版本` 重采。

⚠️ **`grep -a` 只能用来搜 ASCII**：同一份 asar 上 `grep -ac "卸载"` 是 **0**（假阴性），而 `grep -ac "uninstall"` 有 111 —— grep 按字节匹配，对 UTF-8 中文会静默漏检。**搜中文/确认「某界面不存在」一律用 node 读 asar**（切片规则见 §1.1 的 `EX/` 行），否则「0 命中」只是采集方法在骗人（2026-11-10 踩过，结论见 `docs/contracts/decisions.md` 附录 Q-2）。

截图：[宿主插件页首屏](../assets/host-plugins-page.png)（1440×920，2026-11-08）。

### 1.1 证据记号（全文通用）

原文里出现这些缩写时，指向的都是本机真实产物：

**证据记号**（本文所有「依据」列的缩写，全部为本机真实产物）：

| 记号 | 实际路径 | 说明 |
| --- | --- | --- |
| `EX/` | `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` 内的 `dsh/node_modules/@deepseek-ai/` | asar 是「头部 JSON + 拼接内容」，不是目录：`u32@4 = headerSize`、`u32@12 = jsonLen`、JSON 从 byte 16 起、内容区 = `8 + headerSize` |
| `SHELL/` | `EX/dsh-web-frontend/dist/assets`（`index-BgUyXZcc.js`、`index-lh_YM6sT.css`） | 前端 shell 产物，单行压缩，按唯一字串 grep |
| `PROF/` | `~/.dsh/profiles/desktop/node_modules/` | 本机已装插件 |
| `HIDDER/` | `~/Documents/Agents/Plugins/dsh-hidder/` | 用户自己的插件；`HIDDER/docs/reference/host-selectors.md`、`HIDDER/docs/reference/settings-ui.md`、`HIDDER/spec.md` 有宿主真实取值 |
| `PRD` | `git show a8141eb:docs/PRD.md` | 上游产品规格。2026-11-09 作为过程产物移出工作树，正文里的 `PRD §x` 引用保留以便追溯 |

> 宿主版本：`0.2.2-rc.1`（`HIDDER/docs/reference/host-selectors.md` 头部的双证采集记录）。本文所有宿主读数采集于 2026-11-08，同一版本。

## 2 页面骨架

- 入口是侧栏的 `插件` 行，点开占满主区整页，没有右侧抽屉、没有二级页。
- 页头：大标题「插件」+ 副标题「安装、启用和配置插件」+ ⓘ 按钮 + 右侧操作组（`刷新` 按钮、`＋ 添加插件 ⌄` 主按钮）。
- 主体是竖排**分区**，不是页签：`内置插件配置` / `实验性插件`（区标题右侧带 `更多 ›`）/ `已安装插件`。
- 行 = 48×48 圆角图标 + 名称（14/20/500）+ 单行描述（13/18、tertiary、溢出裁切）+ 右侧控件（开关，或禁用态按钮）。

## 3 类名与稳定钩子

- 页面类名是**构建哈希**：`w6M7KW_*`（page）、`_tabs_1lga9_1`（页签容器）、`_switch_1ik0f_5`（开关）。每次构建都可能变，所以任何选择器里出现它们次日就会失效。
- 真正稳定的钩子只有两个：`style[data-plugin-css="<plugin>/client.css"]`（宿主 loader 用 `tag.dataset.pluginCss = tagId` 去重），以及 `html` 级自定义属性 `--dsh-frame-top-clearance`。
- 页头状态文案的类名是 `.updatesNote`（12/18、tertiary）；`.status` 是页内状态段（`partsEmpty` / `installChecking` / `unavailable`）用的，两者不是一回事。

## 4 度量刻度（宿主自用值）

| 项 | 值 |
| --- | --- |
| 页签（`SegmentedTabs size="sm"`）总高 | 34px = 30px tab + 2px×2 |
| 页签文字 | 14/20，选中 500 |
| 行内 gap / 行 padding | 14px / 8px（icon 48 + padding 8×2 ⇒ 行高 64px） |
| 图标盒 | 48×48，0.5px `border-l3`，`radius-lg` |
| 开关 | 36×20 |
| 开关进度占位 | `--bundle-progress-size: 14px` |
| 开关与文字间距 | `--bundle-toggle-gap: 8px` |
| darwin 标题栏安全区 | `--dsh-frame-top-clearance: 48px`（`html` 级，始终存在） |

## 5 交互与状态形状

- 行本身是链接：`.cardLink:hover` / `:active` 有底色反馈。
- 可配置项用受控 `Switch`；按钮位在「进行中」时换 `StateDot state="ongoing" size={13}`。
- 错误态容器 `.failure{color:error}`，但内部 `<p>` 被 `.failure p` 覆盖成 `label-tertiary`——**文字不红，红色由 `StateDot state="error"` 承担**，另带 `role="alert"`。
- 骨架行结构：图标位 + 两条文字位 + 尾部控件位。

## 6 控件由浏览器 seed 提供

`SegmentedTabs` / `Switch` / `Button` / `Tooltip` / `Toast` / `StateDot` / 全部图标都是 `@deepseek-ai/dsh-client-ui-primitives` 的导出，运行时由宿主注入的 seed 提供；node 侧 import 不到，测试需要替身。

## 7 插件详情页（采集 2026-11-10，二次采集；本节整份重采）

> 采集环境：`app.asar` 内 `dsh/lib/bin.js` + `ELECTRON_RUN_AS_NODE` 起 `dsh web --no-open --port 0`，隔离 `DSH_HOME`；视口 **1440×920**、`Emulation.setDeviceMetricsOverride` 强制 **DPR 1**（像素与 CSS px 一一对应）。读数用 `getComputedStyle` + `getBoundingClientRect`，深色用 `Emulation.setEmulatedMedia` 切换后同一元素再读。原始读数在 `.agents/work/scratch/host-detail-metrics.md`。
> 目标文件：`EX/dsh/node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js`，**438 450 B**（node 读 asar 实测；**不要用 grep 搜中文**，理由见 §1 的警告）。

区块顺序（自上而下，用户真机截图与产物一致）：

1. 面包屑 `‹ 插件`（键 `crumbRoot`；列表侧的返回键是 `backToList`「返回插件」，不是同一个字符串）
2. 头行：左图标（49×49）＋ 右侧动作组（有更新时先一个更新按钮 → 卸载 → 开关 `EnableSwitch`）
3. 标题组 `detailMain`：`h3` 标题 + 版本 Tag `versionTag`（`v{version}`）+ 包名行 `p.detailName` + 描述
4. 正文区：README，关在一个内滚动盒里（**紧接描述、前面没有区块标题**；正文之后依次是「包含的组件」「版本」「来源信息」等技术区）
5. 技术区 `detailSections`：「包含的组件」块 → 「来源信息」块（页尾）

locale 键值（逐字，来自该包的 zh 表）：

| 键 | zh |
| --- | --- |
| `crumbRoot` / `backToList` | 插件 / 返回插件 |
| `openDetail` | 查看 {name} |
| `uninstall` / `uninstallLabel` | 卸载 / 卸载 {name} |
| `versionTag` | v{version} |
| `sourceTitle` / `sourceSpec` / `sourceVersion` / `sourceBuiltIn` | 来源信息 / 代码来源 / 当前版本 / 内置 |

上一版这一节「只记结构与键值、px 一个都没有」（那时类名是构建哈希、样式在另一份产物里）；本次二次采集已把读数补齐——**各小节的每个数字都是 `getComputedStyle` / `getBoundingClientRect` 的原始值**，推断只出现在 7.6 那一条（552 ≈ 60vh），且已明确标为推断。

### 7.1 页面骨架

| 角色 | 读数 |
| --- | --- |
| `pageBody` 滚动容器 | `padding: 0 48px 48px`；视口 1440 下 `x=280 w=1160`，`overflow-y:auto`，`scrollHeight 1236` / `clientHeight 920` |
| 内容列 | `max-width: 960px` 居中（1440 视口左边界 **380**） |
| 顶部留白 | `detailTop { padding-top: 28px }` —— 与我们 `--skc-page-top-inset` 同值 |
| 面包屑 → 头行 | **32**（`detailHead { margin-top: 32px }`） |
| 头行 → 标题组 | **20**（`detailMain { margin-top: 20px }`） |
| 标题组内部 | `gap: 8` |
| 标题组 → 技术区 | **32**（`detailSections { margin-top: 32px }`） |
| 区块之间 | **32**（`detailSections { gap: 32 }`，区块自身 `margin: 0` —— **单一来源**，不是两层叠出来的） |
| 区块内部 | `gap: 12`（标题 → 内容）；条目之间 0（靠 `.5px` 分隔线 + `padding: 8px 2px`） |

### 7.2 面包屑

| 角色 | 读数 |
| --- | --- |
| 按钮 | `12.5px / normal`（盒高 18）、`400`、`rgb(129,133,140)`（深色 `rgb(173,178,184)`） |
| hover | `rgb(15,17,21)`（深色 `rgb(249,250,251)`），`text-decoration: none` |
| 箭头 | **14×14**（svg `width="14"`），与文字 `column-gap: 6px` |

### 7.3 头行（图标 + 动作组）

| 角色 | 读数 |
| --- | --- |
| 图标盒 | **49×49**、圆角 16、`border: .5px solid rgba(0,0,0,.12)`（深色 `rgba(255,255,255,.16)`）、背景透明；内部 `<img>` **36×36** 居中。**详情与列表同尺寸**（详情不放大） |
| 布局 | `display:flex` + `justify-content: space-between` + `align-items: center`；图标贴内容左沿（x=380）、动作组贴右沿（right=1340），组中心与图标中心同为 102.5 |
| 动作组内 `gap` | **16** |
| 卸载按钮 | 高 **28**、`padding: 0 10px`、`12px/18px/400`、圆角 **8**、背景透明；文字 `rgb(236,19,19)`（深色 `rgb(242,90,90)`）；描边是 `box-shadow: inset 0 0 0 1px` 同色 **30%** 的环（`border: .5px solid transparent`，**不是** border 画红）；svg **13×13**（图标盒 16），图标 ↔ 文字 **4** |
| 卸载按钮禁用态 | **只降 `opacity: .4`**，三个颜色不变（`cursor: not-allowed`） |
| 开关 | 36×20（与列表行同一个控件） |

按钮的宿主写法（`client.js` 内 `react_jsx_runtime` 调用参数，逐字）：`Button` + `variant:"outline"` + `size:"sm"` + `className: danger` + `icon: IconTrashOutlineRegular size 13` + `aria-label: t("uninstallLabel", {name})` + `disabled: busy || !pkg.removable || pkg.readOnlyReason !== undefined`。其 `danger` 类只做两件事：`color: var(--dsw-alias-state-error-primary)` 与把 primitives 的 `--dsh-button-outline-color` 设成同色 30%（`color-mix`）。

### 7.4 标题组（h3 + 版本 + **包名** + 描述）

| 角色 | 读数 |
| --- | --- |
| `h3` 标题 | `20px / 28px / 500` |
| 版本 Tag | `11px / 17px / 500`、`padding: 1px 8px`、`border-radius: 999px`、底 `#F5F6F7`（深色 `#353638`）；与标题 `gap: 8`；键 `versionTag` = `v{version}`，无版本不画 |
| **包名行** `p.detailName` | **`12px / 18px`**、`rgb(129,133,140)`、内容 `<code>` 走 `ui-monospace, SFMono-Regular, Menlo, monospace` —— **上一轮漏记的一行** |
| 描述 | **`14px / 22px`**、`rgb(97,102,107)`、**不截断** |
| 间距 | 标题/包名/描述三者之间全是 `detailMain { gap: 8 }` |

### 7.5 技术区：事实行、来源信息、「包含的组件」

| 角色 | 读数 |
| --- | --- |
| 区块标题 | `14px / 20px / 500` |
| 事实行 | 高 **60.5**、`padding: 8px 2px`、**无 `min-height`**（长路径自己折到 ~60）、分隔线 `.5px rgba(0,0,0,.1)`（深色 `rgba(255,255,255,.12)`，最后一行也有） |
| 来源信息 | 行盒高**由内容决定**（本条实测 60.5，无 `min-height`）、`padding: 8px 2px`、两端对齐；左 `dt` `13px/20px/400` `rgb(97,102,107)`、右 `dd` `13px/20px/400` `rgb(15,17,21)`；`dd > code` `12px / 20px`、底 `rgb(245,246,247)`（深色 `rgb(53,54,56)`）、`padding: 2px 6px`、圆角 4；每行都有 `.5px` 分隔线 |
| **版本区块**（截图可见，**px 未逐值采集**） | `h4` 标题（`14/20/500`，与其它区块标题同阶）+ 右侧「重新检查」小按钮；下面一张圆角卡：✓ 圆底 + 「已是最新版本 / 上次检查于 HH:MM」。区块自身服从技术区规则（`detailSections{gap:32}`、区块内 `gap:12`、`margin:0`），**卡内 px 与按钮刻度尚未量**，这一条是余项（我们的取值见 `docs/contracts/visual.md` A.5） |
| **本地插件**（截图 2026-11-10，px 未逐值采） | 底部**没有版本区块**——「来源信息」只有两行：`代码来源` = `link:/Users/…/dsh-skill-center`（本地 `link:` 依赖就是这个形状）、`当前版本` = `0.1.0`（npm 包的包版本）。**本地技能按此办理**：不显示更新检查，代码来源给目录 / `link:` |
| **查看仓库** | 页尾右下角一个带外链图标的小链接（`tertiary` 一档，hover 变主色）；同样**未逐值采集** |
| **「包含的组件」区块**（**已用于我们的「调用名」区块**） | 行高 **74**、图标 **41×41**（圆角 12）、`rowId` **13.5px / 20px / 500**、`rowModule` **11.5px / 16px** 灰、区块标题 14/20/500 且带「共 N 个 · M 运行中」计数（我们**不照搬计数**）。我们把这一行的形状用在「调用名」上（名字＝调用名、副行＝技能描述两行裁切、右侧挂复制按钮） |

### 7.6 正文 Markdown 与内滚动盒

| 角色 | 读数 |
| --- | --- |
| **正文滚动区** | 文档容器 **`height: 552px`**（`clientHeight 576`、`scrollHeight 3647`）、`overflow-y: auto`、`padding: 12px 0`；所在 section 总高 **577**；页面本身继续滚（`scrollHeight 1236` vs `clientHeight 920`）—— **上一轮记成「整页铺开」是错的** |
| 段落 | `14px`、行高 `24px`、`margin: 16px 0` |
| `h1` / `h2` | `21/30/700` `margin: 0 0 16px`；`19/28/700` `margin: 32px 0 16px` |
| 代码块 | 底 `rgb(249,250,251)`、圆角 16、`margin: 16px 0 11px`；标题条盒高 42、`padding: 10px 18px 8px 22px`、`11px/18px`、字色 `rgb(97,102,107)` |
| 行内 `code` | 底 `rgb(250,250,250)`、`padding: 0 5px`、圆角 8、`12.25px/19px` |
| 深色 | 正文底 `rgb(27,27,28)`、代码块同色；页面底色 `rgb(21,21,23)` |

`552 / 920 = 0.6`：552 **很可能是 `max-height: 60vh`** 算出来的，不是写死的 552。这是**推断**（宿主产物里读到的是计算值，没有声明值）。我们在实现里取 `60vh`，若在第二个视口高度（如 800 高）验出不是 60vh，再改回写死。

### 7.7 我们刻意保留的差异（对齐结构，不追这些）

1. **用「调用名 + 复制」代替包名行**：宿主那行是不可点的包名文本（`p.detailName`，12/18 mono）；我们同一位置放 kebab 调用名 + 复制按钮（同字号同 mono），信息更全且可一键复制。
2. **没有「包含的组件」区块**：本面板只读 `SKILL.md`，没有组件概念；宿主那个区块对应的是插件包内的 bundle 清单。

**已复刻**：正文内滚动盒（60vh）、技术区块间距 32 的单一来源、卸载占位按钮的红色描边环、禁用只降 40% 透明度。

### 7.8 采集坑（下次别再花时间）

1. 隔离 profile 只写 `dsh.profile.bundles` 时，宿主「插件」页**不列**第三方包；必须同时在该 `package.json` 里写 `dependencies: {"dsh-skill-center": "link:<仓库绝对路径>"}`。
2. 该组的卡片常在首屏外（1440×920 下 y≈883），要先滚到底再点。
3. 宿主类名是构建哈希（`w6M7KW_*`），只能按 `[class*="crumb"]` / `[class*="detailTitle"]` 这类语义片段定位。
4. 在 `<html>` 上模拟 `data-platform=darwin` 会让整轮静默挂死（宿主外壳也读它）；要验 darwin 分支只在 `.skc_page` 上打属性。

## 8 添加插件与卸载两条流程（采集 2026-11-12，**§8.1 于 2026-11-13 复采**；本节整份重采）

> 采集方法：**node 逐字节读 asar**（§1 那条「`grep` 搜中文会静默漏检」的警告在这儿一样成立）。三个来源文件都在包里、且都是 TS 源码：`PluginManagerPage.tsx`（94 051 B）、`manager-store.ts`（78 429 B）、`locales.ts`（173 664 B）；服务端拒绝码在**另一个包**的 `dsh-plugin-manager/lib/types/index.js`（96 905 B）与 `failure.js`（990 B）。本节行号都是当轮对着产物验签过的；`file:line` 形态一律不写（`check-docs` 的 R9 禁止），坐标读作「该文件内的绝对行号」。

### 8.1 添加入口：工具条第三位的 `AddPluginMenu`

- 工具条顺序：状态位 `updatesNote` → 刷新（`variant="outline"`，进行中换 `StateDot state="ongoing" size={13}`）→ **`AddPluginMenu`**（`PluginManagerPage.tsx` `:1712-1722`）。
- **「添加」与「看进度」共用一个位置**：`state.install.requestId === undefined` 时渲染 `AddPluginMenu`，否则换成一枚 `variant="primary"` 的「查看安装任务」（`:1720-1722`）。
- `AddPluginMenu` 是**主按钮 + chevron** 两枚（`:60-97`）：主按钮 `variant="primary" size="sm"` + `IconPlusOutlineRegular size={13}` + `aria-label={t('addPlugin')}`，**点击直接开弹窗**（`:70-73`）；chevron 带 `aria-haspopup="menu"` + `aria-expanded`，点它或按 `ArrowDown` 开菜单（`:78-85`）。
- 菜单是 **children 模式**（不是 `items` 数组）：`Menu open/onClose align="end" portal autoFocus listClassName={css.addMenu} anchor={chevron}`（`:75-96`），子节点是 primitives 的 **`MenuItemButton`**（`icon` + `onSelect` + 可选 `disabled`）。这一版渲染**两项**：
  1. `installExisting`「安装第三方插件」+ 副行 `installExistingDescription`「支持 npm 包、Git 仓库和本地目录」，`icon={<IconDownloadOutlineRegular size={14} />}`，`onSelect` = 关菜单 + 开安装弹窗；
  2. **由 `dsh-client-ui-agent-preset` 的 `CreatePluginMenuItem` 注入同一个插槽**：「让 Agent 创建插件」(`createPlugin`) + 副行「进入创造模式，制作属于你的 DSH 插件」(`createPluginDescription`)，`icon={<IconAgentPresetOutlineRegular size={14} />}`；`disabled` 由 **agent preset roster** 决定（`status==='ready'` ∧ 有 `id==='cordis'` 才可用），副行按 roster 四态换 `createPluginChecking` / `createPluginUnavailable` / `createPluginMissing`；`onSelect` = 关菜单 + `startCreatorDraft()`，其末尾是 **`scope.uiWorkspace.startSession(undefined, { clearPreviousDraft: false, agentPreset: 'cordis' })`**（`dsh-client-ui-agent-preset/src/client/index.ts` `:216-222`）。
- **DOM 三层**（量几何、写断言都按这个层次看）：`MenuItemButton`（primitives 渲染成 `role="menuitem"` 的按钮，带图标位）→ `.addMenuItem`（`flex column` + `gap:2`）→ 两行文字，第二行 `.addMenuDescription`。
- **四条刻度**（`PluginManagerPage.module.css` `:225-254`，逐字）：`.addMenu{width:320px; max-width:calc(100vw - 48px)}`；`.addMenu [role='menuitem']{height:72px; box-sizing:border-box; gap:10px; padding:6px 12px}`；`.addMenuItem{display:flex; flex-direction:column; gap:2px; white-space:normal}`；`.addMenuDescription{display:-webkit-box; max-height:36px; overflow:hidden; overflow-wrap:anywhere; font-size:12px; line-height:18px; color:var(--dsw-alias-label-secondary); -webkit-box-orient:vertical; -webkit-line-clamp:2}`（**两行截断**）。
- chevron 是菜单的 **anchor**，图标 **`IconChevronDownOutlineRegular size={12}`**（不是 13），`aria-label={t('chooseAddMethod')}`「选择添加插件方式」+ `aria-haspopup="menu"` + `aria-expanded`，点它或按 **`ArrowDown`** 开菜单（`:78-85`）。
- ⚠️ **采集坑（2026-11-13 QA 踩到）**：宿主页上 `button[aria-haspopup="menu"]` **有 4 枚**——侧栏「更多」、工作区操作、账号菜单、添加插件。**必须按 `aria-label="选择添加插件方式"` 定位**；用 `[0]` 或 nth 索引会量到别的菜单，量出 288 / 34 / `6px 8px` / 13·20 那一组假值（与本节四个刻度全不一致，看到这组数就是选错了元素）。
- 键位：第一项在 `locales.ts` `:22-25`（`addPlugin` / `chooseAddMethod` / `installExisting` / `installExistingDescription`）；第二项的键在 `dsh-client-ui-agent-preset` 的 `settings.agentPreset` 命名空间（`createPlugin` / `createPluginDescription` / `createPluginChecking` / `createPluginUnavailable` / `createPluginMissing`）。

### 8.2 弹窗形状（`InstallDialog`）

- 外壳是 `Modal`：`title={t('installTitle')}`、`description={t('installDescription')}`、`closeLabel={t('close')}`（`:1159-1163`；`mirrorRecovery` 态不传 description）。
- **只有一个输入框**：`type="text"`、`placeholder={t('installSpecPlaceholder')}`、`aria-label` 取 `installSpecLabel`（镜像恢复态取 `installPackageLabel`）、`aria-invalid` + `aria-describedby` 指向字段下面那一行、回车提交、**IME 组字期间回车不提交**（Safari 的 10 ms 后置窗口也处理了）（`:1185-1203`，组字 `:1017-1027`）。
- 字段下面那一行是**就地报因**（`INPUT_PROBLEM_KEYS` `:869-878`），不是 toast；底部 `footer` 是安全提示 `installGuideSafety`；按钮文案两态切换：`installRun` / `installChecking`。
- 结局屏标题由一张表决定（`SCREEN_TITLE_KEYS` `:911-920`，含 `installingTitle` / `installedTitle` / `installFailedTitle` / `installUnconfirmedTitle` 等），失败分类 `FAILURE_KIND_KEYS` `:894-905`、正文组装 `failureText` `:955-975`。

### 8.3 校验顺序：**先在本地列表里裁决，再问远端**

`runInstall`（`manager-store.ts` `:1202-1282`）的顺序是本节最值得复用的一条：

1. 空输入 / 正在跑 ⇒ 直接返回（`:1206`）。
2. **先在已读到的包列表里按 name 命中**：`state.packages.find(pkg => pkg.name === spec)`（`:1207`）——这一步**完全不打远端**。
3. 命中且 `availability !== 'missing'` ⇒ 直接进「已装」结局，并按 `availability === 'installation'` 分叉成两种说法：`shipped`（随 DSH 提供）或 `already-installed`（`:1234-1237`）。**这不是「谁优先」，是同一件事的两种来源**。
4. 随 DSH 提供、默认隐藏且未启用的 bundle 直接进 done 屏（`:1222-1233`）。
5. 以上都没命中才 `inspect()`（远端解析），之后才是真正的安装。

结论：「这个包装过没装过」**在本地列表里就裁决完**，远端只负责「怎么装」。

### 8.4 卸载入口与顺序

- 卸载**只有一处**：插件详情页头的动作组（`PluginManagerPage.tsx` `:767-799`），顺序 **更新 → 卸载 → 开关**（`:782-796`）；动作组开头先 `renderSlot('plugins.detail.actions')`（`:768`）。
- 两层可见性：外层条件 `installed || removable`，内层 `disabled`（busy 时）——**可见的不可点**与「不出现」是两件事，宿主用的是前者。
- **行/卡片上没有卸载位**：`openInstall` 只被工具条与菜单调用，行内只有开关与「查看」。
- 落点：`uninstall` action（`manager-store.ts` `:859-865`）→ 服务端 `removeBundle(name)`（`dsh-plugin-manager/lib/types/index.js` `:1194-1230`）。

### 8.5 卸载确认与三条行为结论

`ConfirmDialog`（`:1535-1559`）是 `Modal` + 标题 `confirmUninstallTitle`（zh「卸载「{name}」？」）+ 正文 `confirmUninstallDescription` + 两枚按钮 `confirmUninstall` / 取消；**没有事实表、没有勾选框**（`:1542-1556`）。三条可直接照抄的行为：

1. **先关弹窗再发请求**：`confirm()` 取出 `pendingConfirm` → 清空 → `patch({ confirm: null })`，**然后**才 `await pending()`（`manager-store.ts` `:1156-1161`）。
2. **成功静默，没有「已卸载」toast**：`applied()` 里 `application: 'applied'` 的分支直接 `return`（`:1527-1546`）——表达方式是「行消失 + 详情退回」。
3. **失败才有文案**：`failedUninstall`（`locales.ts` `:275`）。

### 8.6 服务端拒绝码面：没有 `E_*` 一族，也没有 per-refusal HTTP 状态

- 拒绝走 `ManagementFailure(code)`（`dsh-plugin-manager/lib/types/failure.js`）：只有 `code` 与可选的 `incompatible`，**没有任何 HTTP 状态字段**（该文件全文 990 B，`statusCode` / `httpStatus` 零出现）。
- 卸载相关四码：`not-removable`（`:1199`）、`stop-profile`（`:1203`）、`bundle-in-use`（`:1212`）、`unknown-plugin`（`:950`，该码也在别处复用）。
- 码到人话的映射在**客户端**：`reasonManagementRequired` / `reasonUnaddressable` / `reasonUnknownPlugin` / `reasonAlreadyInstalled` …（`locales.ts` `:278-283`）。所以「一码一 HTTP + 一码一文案键」是本插件更强的口径；宿主只保证「一码一句人话」。

### 8.7 我们照做了什么：只留指针

本节只记宿主形状；**我们的口径与差异**都在契约里，使用者能感知到什么在 `CHANGELOG.md`，别在这儿复述：

| 宿主事实 | 我们的落点 |
| --- | --- |
| 添加是「检查 → 安装」两段（`inspect()` 之后才装） | 合并成一段式，理由见 `docs/contracts/decisions.md` 附录 S-1 |
| 只收绝对路径（`install-spec.js` 的路径分支） | 我们也收 `~` / `~/…`（有意放宽，已登记偏离），见附录 S-3 |
| 卸载成功静默、先关弹窗 | 照抄（删除成功无 toast），见附录 S-5；先关弹窗再发请求写在 `docs/contracts/client.md` §3.9.7 |
| 卸载前不问「本会话正在使用」（宿主靠 loader 持有判 `bundle-in-use`） | 这两层不搬，理由见附录 S-4；真机观察项写在 `docs/contracts/acceptance.md` 的「真机才能验证的项」 |
| 卸载入口只在详情页头、行上没有 | 同构：`docs/contracts/installed-detail.md` 的「删除技能」一节；点击边界见 `AGENTS.md` 硬约束 9 |
| 校验顺序里「先按 name 命中本地列表」 | 对应我们的 S6（`lstat` 同名即拒）+ S7（影子判据），见 `docs/contracts/routes.md` §3.3.4 与附录 S-6 |
| 弹窗单输入 + 字段下报因 + 结局屏 | `docs/contracts/client.md` §3.9.7 |
| 菜单尾部的 `plugins.add.actions` 插槽 | 不做（没有第二种添加方式） |
| pnpm 日志 / 安装任务页 / 镜像恢复 | 不复刻（技能包不经过 pnpm） |
