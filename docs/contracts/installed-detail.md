# 已安装详情页（内嵌：本地事实 + 当场读盘的正文）

> 类型：规范
> 读者：改「已安装」页签详情页（`src/client/installed-detail.jsx`）、它的第 12 条路由或它那 21 个文案键的人
> 真源：`src/client/installed-detail.jsx`、`src/client/state.js` 的 `detail`、`lib/routes.js` 的 detail 路由与 `lib/scan.js` 的 `readSkillContent`
> 更新触发：改区块顺序、状态机、返回口径、读盘围栏或这 21 个键时，本文件与 `docs/contracts/routes.md` §3.3.3 一起改
> 规模上限：400

`docs/contracts/client.md` §3.9.2 只留指针（那张表已到 400 行档位）。点击边界见 `AGENTS.md` 硬约束 9，刻度见 `docs/contracts/visual.md` A.5。

---

## 定位：与市场详情不是同一个东西

| 项 | 已安装详情（本页） | 市场详情 |
| --- | --- | --- |
| 数据 | `ListPayload.Row`（列表快照）+ 打开时读一次的本地正文 | `market/detail` 的上游事实 |
| 回答 | 我磁盘上这一份是什么、在哪、能不能改 | 这一份值不值得装 |
| 可用性 | 事实同步可渲染，正文一次本地读盘（有三态） | 网络三态 |

`upstream === null` 是常态，所以**不**拿市场数据兜底：同一个技能在两个页签允许不一致。

## 数据：Row 快照 + 第 12 条路由
- 事实（路径 / 真实位置 / 提供者 / 只读原因 / 版本）全部来自列表里的 `Row`：打开详情**不重扫列表、不重拉 `list`**。
- 正文与文件清单来自第 12 条路由 `GET /api/dsh-skill-center/detail?name=<kebab>` → `SkillContent{name,path,size,truncated,body,files,filesTruncated}`；围栏见 `docs/contracts/routes.md` §3.3.3。
- `body === null` 是「这条没有可读文件」（内置行）⇒ `detail.noBody` 文案，**不是错误**；`files === null` 时文件段整段不渲染。
- `Row.version` 是展示字段（`_meta.json` 的 `version`，0 次新增磁盘读），**不进任何判据**；为空时版本 Tag 整块不渲染，不写「未知」。

## 页面结构（自上而下）

| # | 区块 | 内容 |
| --- | --- | --- |
| 1 | 面包屑 | `detail.back`（值「技能」/`Skills`，与宿主的 `crumbRoot` 同义），唯一返回入口（`.skc_marketCrumb` 配方） |
| 2 | 头行 | `.skc_detailTop`：左 `IconTile`（48，与行同源）；右侧 `.skc_detailActions`（`margin-left:auto`）= **卸载占位按钮 + 开关**，两者同一行、`align-items:flex-start`。卸载 = `Button variant="outline" size="sm" disabled title=detail.uninstallSoon` + `IconTrashOutlineRegular size={13}` + 文案 `detail.uninstall`，**没有 onClick**（真实卸载见看板 M6；可见的不可点，与本项目 `＋ 添加技能` 的 C-3 同一处置）。开关：`switchMode(row)` 非空 → `EnableSwitch`；软链行 → `ReadonlyTag`；其余不渲染 |
| 3 | 介绍组 | `.skc_detailIntro`（图标下方纵向，`gap:6`；到图标行的间距由父级 `gap:16px` 给，自己不加外边距）：标题 `h3.skc_marketDetailTitle`（`rowTitleOf` 三级优先）+ 版本 Tag（复用 `market.metaVersion` = `v{version}`，有值才画）→ **作者行** `.skc_detailAuthor`（复用 `market.metaAuthor` = `@owner/slug`，13/20 tertiary，**仅 `row.upstream !== null` 时渲染**）→ 描述（`row.description`，三行裁切 `.skc_marketDesc` 配方，空串整块不渲染） |
| 4 | 身份行 | `detail.callName` 标签 + 等宽 kebab 调用名（`.skc_detailCallName`，可选中）+ 复制按钮（`detail.copy`） |
| 5 | 徽章行 | 分区 Tag（`detail.partition.*`）+ 软链只读 Tag（仅软链行），`.skc_marketTags` 配方 |
| 6 | 事实表 | 技能文件（等宽）/ 真实位置（仅软链）/ 提供者（原样，不翻译）/ 只读原因（无开关的行：软链复用 `row.symlinkReadonly`，`no-file` 用 `detail.readonlyNoFile`；`provider-store` 有开关，不写原因） |
| 7 | 正文 | `market.detailOverview` 标题 + `MarkdownBlock`（必须传 `labels`：6 个 `markdown.*` —— 缺了它宿主渲染代码围栏时抛错，整段回落纯文本）；三态见「状态与返回」；`truncated === true` 时正文**下面**再加一行 `detail.truncated`（纯文案） |
| 8 | 文件清单 | `market.detailFiles` 标题 + 复用 `.skc_marketFiles`（路径 + `fileSizeText`）；`filesTruncated === true` 时列表**后面**再加一行 `detail.filesTruncated`；`files` 为 `null` 或空数组时整段不渲染（没有清单就无从截断） |
| 9 | 来源信息（**页尾**） | 仅 `row.upstream !== null`：`detail.sectionSource` 标题 + `market.source.<sourceId>` + `owner/slug`，三段纯文本、**不可点**；位置在文件清单之后（宿主也把「来源信息」放在正文下方的技术区） |
| 10 | 失效态 | 按 `detail.key` 在 `payload` 里取不到行 ⇒ 只渲染面包屑 + `error.E_NOT_FOUND` 一行，不抛异常 |

区块骨架逐字复用 `.skc_marketDetail*` 族（**详情族，两个页签共用**，不改名）。已安装详情新增刻度共 7 条，规则体只有一处真源：`docs/contracts/visual.md` A.5（`.skc_detailIdentity` / `.skc_detailCallName` / `.skc_detailBody` / `.skc_detailTop` / `.skc_detailActions` / `.skc_detailIntro` / `.skc_detailAuthor`），实现逐字相同，在 `src/client/styles.js`。

## 状态与返回

```text
store.detail = null | {key, status: 'loading'|'ready'|'error', data, code}
store.detailScrollTop = number      // 打开详情前记下的 .skc_pageBody 偏移
```

| action | 做什么 |
| --- | --- |
| `openDetail(row)` | `detail = {key: rowKey(row), status:'loading', data:null, code:null}`（不碰列表） |
| `detailLoading(key)` | 只在 `detail.key === key` 时回到 `loading`（重试用） |
| `detailReady(key, data)` / `detailFailed(key, error)` | 只在 `detail.key === key` 时落地；晚到的旧响应因此被丢弃 |
| `closeDetail()` | `detail = null`（滚动位置由页面的 paint effect 写回） |
| `rememberDetailScroll(top)` | 只记 `detailScrollTop`（打开前调一次，此时行还在屏幕上） |

- 返回：`closeDetail()` + `useLayoutEffect` 把 `detailScrollTop` 写回 `.skc_pageBody`，**不重拉 `list`**。
- 切页签：`detail` 在模块级 store 里，切回来还在详情（与市场详情的同一条规则）。
- 页头刷新：详情打开时 = 关详情 + `load('refresh')`（与 `marketReload` 关详情同一条规则）。
- **不支持 Esc**（与市场详情一致：加全局 keydown 会让两个详情页行为分叉）。
- 开关：详情头里就是行内那一个 `EnableSwitch`，读同一份 `state.rows`；失败原因 `.skc_reason` 照旧显示在头下。

## 文案（`locale/*.json`，单层扁平点号键，21 个）

`detail.{back,callName,copy,copied,loading,error,retry,noBody,truncated,filesTruncated,uninstall,uninstallSoon}`（`detail.back` = 「技能」/`Skills`，头部的面包屑根）、`detail.partition.{builtin,local,installed}`、`detail.{factPath,factRealPath,factProvider,factReadonly,readonlyNoFile,sectionSource}`。

复用而不造同义词：`row.{enable,disable,applying,symlinkReadonly,symlinkTitle}`、`market.{detailOverview,detailFiles,factSource}` + `market.source.*`、`error.E_NOT_FOUND`。另加 6 个 `markdown.*`（`codeCopy`/`codeCopied`/`codePlain`/`codeWrap`/`codeUnwrap`/`footnotes`）：它们不是本页文案，而是宿主 `MarkdownText` 的**代码围栏与脚注 chrome**，`labels` 缺了它宿主读 `labels.code.copyLabel` 直接抛错、整篇正文回落成纯文本，所以两个详情页共用这一段。全字典 117 → 136 → 142 → **144**。版本 Tag 与作者行不新增键：分别复用 `market.metaVersion`（`v{version}`）与 `market.metaAuthor`（`@{author}`）。

## 点击边界与复制

- 行可点只用 `AGENTS.md` 硬约束 9 的那一个手段：标题 `<button class="skc_cardTitle skc_cardOpen">` 的 `::after{inset:0}` 铺满整行 + `.skc_cardEnd{z-index:1}` 浮起；`<li>` 上不加 `onClick` / `role` / `tabIndex`，也不加 `<a>` 与第二可点区域。
- 可点的行才给 hover / active 底色（hover 只在 `@media (hover:hover)`，`:active` 是触屏唯一可靠证据），键盘走 `:focus-visible::after`；**不加 chevron、不加「点开详情」文案**。
- 详情页内部的面包屑、复制按钮、开关、重试是普通按钮，不开第二套点击层。
- 复制：`navigator.clipboard.writeText`；成功把图标换成对勾、1.5 s 后换回，并用 `aria-live` 播报 `detail.copied`；clipboard 不可用时**静默什么都不做**（文本本身可选中），不新增 toast kind。

## 不做

卸载与重装：**头部有一个 disabled 的「卸载」占位按钮**（可见的不可点，无 onClick、无写路由），真实卸载见看板 M6，重装见 M2、检查更新与「已是最新版本」（M6）、`查看仓库 ↗`（`_meta.json` 里没有仓库地址）、收藏入口（M8）、编辑正文 / 重命名 / 移动（写侧只改一行 frontmatter，见 `docs/contracts/routes.md` §3.4）。

---

## 验收

- `npm run check:client` 逐字节通过；`npm run check:i18n` 报 **144** 键且 zh/en 键集一致、`lib/**` 与 `src/client/**` 无 CJK。
- K110–K115（`docs/contracts/acceptance.md` 附录 D.5 尾部）逐条绿。
- 真机三项：面包屑返回落点与打开前一致、40 KB 正文可滚且 Markdown 正常、触屏 `:active` 有底色。
