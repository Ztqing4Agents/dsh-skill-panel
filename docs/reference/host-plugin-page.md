# 宿主「插件」页

> 类型：参考
> 读者：要复刻宿主页面形状的人——改 `src/client/styles.js`、`page.jsx`、`row.jsx` 之前对照本节读数
> 真源：宿主产物本身（`app.asar` 内的 `@deepseek-ai/dsh-client-ui-plugin-manager`）；本文只是它的采集副本
> 更新触发：宿主升级到新的 `0.2.x-rc` 后**整份重采**，不在旧表上打补丁
> 规模上限：600
> 采集日期：2026-11-08
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
