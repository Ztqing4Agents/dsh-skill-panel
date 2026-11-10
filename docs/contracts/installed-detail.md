# 已安装详情页（内嵌：本地事实 + 当场读盘的正文）

> 类型：规范
> 读者：改「已安装」页签详情页（`src/client/installed-detail.jsx`）、它的第 12 条路由或它那 33 个文案键的人
> 真源：`src/client/installed-detail.jsx`、`src/client/state.js` 的 `detail`、`lib/routes.js` 的 detail 路由与 `lib/scan.js` 的 `readSkillContent`
> 更新触发：改区块顺序、状态机、返回口径、读盘围栏或这 33 个键时，本文件与 `docs/contracts/routes.md` §3.3.3 一起改
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

**整页替换**：详情打开时**页头整块不渲染**（标题 / 介绍 / 计数 / 刷新 / 添加技能 / 页签全部不可见），详情从面包屑开始，`pageBody` 里只有一个详情容器；容器顶端有一条**仅用于拖窗口的空条**（`.skc_detailDrag`，`data-window-drag` 只挂在这一条上——整块当拖动区会吃掉文字选择与按钮点击；高度 = 页头的顶部内边距，darwin 再叠加安全区，所以进出详情头部不跳）。市场详情不是这样：它仍就地替换网格、页头保留（宿主只对插件详情覆盖整页，我们只对齐已安装详情）。

| # | 区块 | 内容 |
| --- | --- | --- |
| 1 | 面包屑 | `detail.back`（值「技能」/`Skills`，与宿主的 `crumbRoot` 同义），唯一返回入口（`.skc_marketCrumb` 配方） |
| 2 | 头行 | `.skc_detailTop`（`space-between` + `align-items:center`）：左 `IconTile` 加 **`.skc_detailIcon`**（**49×49**，宿主详情页的值；列表行仍是 48）；右侧 `.skc_detailActions`（`gap:16`）= **卸载占位按钮 + 开关**。卸载 = `Button variant="outline" size="sm" className=detailDanger disabled title=detail.uninstallSoon` + `IconTrashOutlineRegular size={13}` + 文案 `detail.uninstall`，**没有 onClick**（真实卸载见看板 M6；可见的不可点，与 `＋ 添加技能` 的 C-3 同一处置）。开关：`switchMode(row)` 非空 → `EnableSwitch`；软链行 → `ReadonlyTag`；其余不渲染 |
| 3 | 标题组 | `.skc_detailIntro`（图标下方纵向，`gap:8`；到图标行 20 = 列 gap 32 − 12）——**四段，顺序固定**：标题 `h3.skc_marketDetailTitle`（20/28/500）+ 版本 Tag（复用 `market.metaVersion` = `v{version}`，有值才画）→ **作者行** `.skc_detailAuthor`（复用 `market.metaAuthor` = `@owner/slug`，**12/18 tertiary mono**，仅 `row.upstream !== null` 渲染）→ **调用名 + 复制**（`detail.callName` 标签 + 等宽 kebab + `detail.copy`；它顶替宿主的包名行）→ 描述（**`.skc_marketDetailDesc` 14/22 不截断**，空串整块不渲染） |
| 4 | 失效原因（可选） | `reason` 非空时一行 `.skc_reason`（`role="alert"`），紧跟在标题组之后 |
| 5 | 正文盒 | **紧跟描述**，**前面没有区块标题**（宿主也是描述下面直接是 README，`market.detailOverview` 只给市场详情用）：`.skc_detailBodyBox`（`max-height:60vh; padding:12px 0; overflow-y:auto`，宿主 1440×920 实测 552px = 60vh；不加 `tabindex`、不拦 `wheel`）。**三态与空态都在盒内就地呈现**：`loading` → 一行 `detail.loading`；`error` → 一行 `detail.error` + 「重试」按钮；`ready` 但无正文 → 一行 `detail.noBody`；`ready` 有正文 → `MarkdownBlock`（必须传 `labels`：6 个 `markdown.*`，缺了它宿主渲染代码围栏时抛错、整段回落纯文本）；`truncated === true` 时正文**下方**再加一行 `detail.truncated` |
| 6 | 标签行 | 分区 Tag（`detail.partition.*`）+ 软链只读 Tag（仅软链行），`.skc_marketTags` 配方；**在正文盒下方** |
| 7 | 事实表 | 技能文件（等宽）/ 真实位置（仅软链）/ 提供者（原样，不翻译）/ 只读原因（无开关的行：软链复用 `row.symlinkReadonly`，`no-file` 用 `detail.readonlyNoFile`；`provider-store` 有开关，不写原因）；**在正文盒下方** |
| 8 | 版本（**新区块**） | `detail.sectionVersion` 标题 + 右侧小按钮（`detail.checkAgain` / `detail.checking`，检查中禁用）；下面是圆角卡：`upToDate` 显示 ✓ 圆底 + `detail.upToDate` + `detail.checkedAt`（`HH:MM`）；`newer` 显示 `detail.newerVersion`（带上游版本号）+ `detail.checkedAt`；其余四态在卡内各一行文案（见「检查更新」）。**本地技能（没有 upstream）也渲染本区块**，落在 `unavailable` |
| 9 | 来源信息（**两行**） | 仅 `row.upstream !== null`：`detail.sectionSource` 标题 + 复用事实表样式（`.skc_marketFacts`，左 label / 右值、`.5px` 分隔线）——`detail.factCodeSource`：`owner/slug@version`（无 version 就 `owner/slug`，**值等宽**）；`detail.factVersion`：`row.version`（等宽），**没有 version 时这一行整行不渲染** |
| 10 | 查看仓库 | 仅详情出参带 `repoUrl` 时（= 有 upstream 身份）：右下角 `<a href={data.repoUrl} target="_blank" rel="noopener noreferrer">` + `detail.viewRepo` + 外链图标；13/20 tertiary、hover 变主色。**URL 由宿主拼好**（`https://skillhub.cn/skills/<owner>/<slug>`，见 `docs/contracts/routes.md` §3.3.3）：浏览器半部不造上游 URL、不发请求（硬约束 13）。**详情页内的普通链接**，不属于「整区可点」（硬约束 9），`target=_blank` 只有这一处 |
| 11 | 失效态 | 按 `detail.key` 在 `payload` 里取不到行 ⇒ 只渲染面包屑 + `error.E_NOT_FOUND` 一行，不抛异常 |

顺序一句话：**面包屑 → 头行 → 标题组（标题+版本 / 作者 / 调用名+复制 / 描述）→ [reason] → 正文盒 → 标签行 → 事实表 → 版本 → 来源信息 → 查看仓库**。正文紧跟描述、其余技术区全在盒下；盒内滚正文，盒外跟页面滚。

**文件清单已整块删除**（U1e）：宿主详情页没有文件清单，底部的技术区是「版本 / 来源信息 / 查看仓库」。`market.detailFiles` 与 `detail.filesTruncated` 两个键**留着**——市场详情仍用前者，后者留给以后真需要时；本页不再渲染它们。

区块骨架逐字复用 `.skc_marketDetail*` 族（**详情族，两个页签共用**，不改名）。已安装详情新增刻度共 19 条，规则体只有一处真源：`docs/contracts/visual.md` A.5（`.skc_detailPage` / `.skc_detailDrag` / `.skc_detailIcon` / `.skc_detailTop` / `.skc_detailActions` / `.skc_detailIntro` / `.skc_detailAuthor` / `.skc_detailDanger` / `.skc_detailBodyBox` / `.skc_detailVersionHead` / `.skc_detailVersionCard` / `.skc_detailVersionRow` / `.skc_detailVersionMark` / `.skc_detailVersionText` / `.skc_detailVersionTitle` / `.skc_detailRepoLink` / `.skc_detailIdentity` / `.skc_detailCallName` / `.skc_detailBody`），实现逐字相同，在 `src/client/styles.js`。

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

- **打开时把滚动归零**：`detailKey !== null` 的 paint effect 写 `scrollTop = 0`——页头一撤，沿用列表那个偏移会让详情从中间开始。
- 返回：`closeDetail()` + 同一个 paint effect 把 `detailScrollTop` 写回 `.skc_pageBody`，**不重拉 `list`**。
- **详情打开时页签不可见**，所以不存在「切页签」这条路径（`detail` 仍留在 store 里，返回后回到列表与页签，数据不丢）。
- **详情打开时刷新按钮不可见**，所以「页头刷新 = 关详情 + 重扫」这条路径**不可达**；返回列表后再刷新即可（`load('refresh')` 仍只在列表态执行）。
- **检查更新**（新区块，手动触发，不自动发请求）：状态记在 store 的 `check = {key, busy, status, latestVersion, at}`，**按 `detail.key` 归属**——`openDetail` 与 `closeDetail` 都清空，晚到的答案按 key 丢弃。
  - **前置判定**：`openDetail(row)` 时就判一次——`upstream === null` 或 `row.version` 不是非空字符串 ⇒ `check` 直接置 `{status:'unavailable'}`（卡内立刻说「无法检查」，按钮禁用，**不发请求**）；可比的技能才置 `null`（= `idle`，按钮可点）。
  - 判据：点按钮后同一套判据再守一次（`unavailable` ⇒ 直接落地、不起请求）；可比就调 `api.marketDetail({source, owner, slug})`（`clawhub` 原样传，其余按 `skillhub`）。
  - 上游没给 `version` ⇒ `unavailable`；**相等 ⇒ `upToDate`；不等 ⇒ `newer`**——只比相等，**不排序**（不判「谁的版本更高」：预发布、日期式版本号都会骗人，宿主也只报「不同」）。
  - 请求抛错 ⇒ `error`（按钮可重试）。
  - 五态：`idle`（`detail.checkIdle`）/ `loading`（按钮 `detail.checking` 且禁用，**卡内保留上一次结论**）/ `upToDate` / `newer` / `unavailable`（`detail.checkUnavailable`，**按钮禁用**）/ `error`（`detail.checkFailed`）。`at` 用 `Date.now()`，显示时格式化成 `HH:MM`。
- **不支持 Esc**（与市场详情一致：加全局 keydown 会让两个详情页行为分叉）。
- 开关：详情头里就是行内那一个 `EnableSwitch`，读同一份 `state.rows`；失败原因 `.skc_reason` 照旧显示在头下。

## 文案（`locale/*.json`，单层扁平点号键，33 个）

`detail.{back,callName,copy,copied,loading,error,retry,noBody,truncated,filesTruncated,uninstall,uninstallSoon}`、版本与底部四个键组 `detail.{sectionVersion,checkAgain,checking,checkIdle,upToDate,checkedAt,newerVersion,checkUnavailable,checkFailed,factCodeSource,factVersion,viewRepo}`（`detail.back` = 「技能」/`Skills`，头部的面包屑根）、`detail.partition.{builtin,local,installed}`、`detail.{factPath,factRealPath,factProvider,factReadonly,readonlyNoFile,sectionSource}`。

复用而不造同义词：`row.{enable,disable,applying,symlinkReadonly,symlinkTitle}`、`market.{detailOverview,detailFiles,factSource}` + `market.source.*`、`error.E_NOT_FOUND`。另加 6 个 `markdown.*`（`codeCopy`/`codeCopied`/`codePlain`/`codeWrap`/`codeUnwrap`/`footnotes`）：它们不是本页文案，而是宿主 `MarkdownText` 的**代码围栏与脚注 chrome**，`labels` 缺了它宿主读 `labels.code.copyLabel` 直接抛错、整篇正文回落成纯文本，所以两个详情页共用这一段。全字典 117 → 136 → 142 → 144 → **156**。`detail.filesTruncated` 与 `market.detailFiles` 不再上屏（文件清单已删），键留着。版本 Tag 与作者行不新增键：分别复用 `market.metaVersion`（`v{version}`）与 `market.metaAuthor`（`@{author}`）。

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
