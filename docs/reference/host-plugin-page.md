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

## 7 插件详情页（采集 2026-11-10）

> 采集方式：node 读 asar（不是 grep，理由见 §1 的警告）。目标文件 `EX/dsh/node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js`，实测 438 450 B，含 zh / en / ja 三份 locale 表。**本轮只采到结构与文案键，px 一个都没有**（类名是构建哈希、样式在另一份产物里），所以本节不写任何尺寸。

区块顺序（自上而下，用户真机截图与产物一致）：

1. 面包屑：`crumbRoot`（「插件」）；列表侧的返回键是 `backToList`（「返回插件」），两者不是同一个字符串。
2. 头行：左图标；右侧动作组 = 版本检查/更新按钮（有更新时）→ **卸载按钮** → 开关 `EnableSwitch`。
3. 标题行：`h3`（详情标题）+ `versionTag`（`v{version}`，无版本就不画）+ 可选的状态 Tag（`statusBeta` / problem）。
4. 描述 / 说明；再往下是 README 正文。
5. 页尾「来源信息」技术区：`sourceTitle`（来源信息）、`sourceSpec`（代码来源）、`sourceVersion`（当前版本）、`sourceBuiltIn`（内置）。

关键键值（逐字，来自该包的 locale 表）：

| 键 | zh |
| --- | --- |
| `crumbRoot` / `backToList` | 插件 / 返回插件 |
| `openDetail` | 查看 {name} |
| `uninstall` / `uninstallLabel` | 卸载 / 卸载 {name} |
| `versionTag` | v{version} |
| `sourceTitle` / `sourceSpec` / `sourceVersion` / `sourceBuiltIn` | 来源信息 / 代码来源 / 当前版本 / 内置 |

卸载按钮的形态（`react_jsx_runtime` 里的调用参数，逐字）：`Button` + `variant:"outline"` + `size:"sm"` + `className: danger` + `icon: IconTrashOutlineRegular size 13` + `aria-label: t("uninstallLabel", {name})` + `disabled: busy || !pkg.removable || pkg.readOnlyReason !== undefined` + `children: t("uninstall")` —— 即「用户不可卸载时按钮**在但禁用**」，与我们 `＋ 添加技能` 的处置一致。

**余项**：详情页的 px 刻度（间距、字号、图标尺寸）与 hover 色值尚未逐值采集；要补就整份重采本节，不在旧值上打补丁。
