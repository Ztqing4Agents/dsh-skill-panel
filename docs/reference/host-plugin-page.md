# 宿主「插件」页

> 类型：参考
> 读者：要复刻宿主页面形状的人——改 `src/client/styles.js`、`page.jsx`、`row.jsx` 之前对照本节读数
> 真源：宿主产物本身（`app.asar` 内的 `@deepseek-ai/dsh-client-ui-plugin-manager`）；本文只是它的采集副本
> 更新触发：宿主升级到新的 `0.2.x-rc` 后**整份重采**，不在旧表上打补丁
> 规模上限：600
> 采集日期：2026-11-08
> 二次采集：§7「插件详情页」于 2026-11-10 用 node 读 asar 补采（同日二核，见 `docs/contracts/decisions.md` 附录 Q）
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
| 来源信息 | label / value 均 `13px / 20px`；`dd > code` `12px / 20px`、底 `rgb(245,246,247)`（深色 `rgb(53,54,56)`）、`padding: 2px 6px`、圆角 4 |
| **「包含的组件」区块** | 行高 **74**、图标 **41×41**（圆角 12）、`rowId` **13.5px / 20px / 500**、`rowModule` **11.5px / 16px** 灰 —— **上一轮漏记的整块** |

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
3. **多了标签行与事实表**：分区 / 软链只读 Tag 与「技能文件 / 真实位置 / 提供者 / 只读原因」四行事实，宿主把它压进「来源信息」的几行里。

**已复刻**：正文内滚动盒（60vh）、技术区块间距 32 的单一来源、卸载占位按钮的红色描边环、禁用只降 40% 透明度。

### 7.8 采集坑（下次别再花时间）

1. 隔离 profile 只写 `dsh.profile.bundles` 时，宿主「插件」页**不列**第三方包；必须同时在该 `package.json` 里写 `dependencies: {"dsh-skill-center": "link:<仓库绝对路径>"}`。
2. 该组的卡片常在首屏外（1440×920 下 y≈883），要先滚到底再点。
3. 宿主类名是构建哈希（`w6M7KW_*`），只能按 `[class*="crumb"]` / `[class*="detailTitle"]` 这类语义片段定位。
4. 在 `<html>` 上模拟 `data-platform=darwin` 会让整轮静默挂死（宿主外壳也读它）；要验 darwin 分支只在 `.skc_page` 上打属性。
