# 已安装详情页（内嵌：本地事实 + 当场读盘的正文）

> 类型：规范
> 读者：改「已安装」页签详情页（`src/client/installed-detail.jsx`）、它的第 12 条路由或它那 23 个文案键的人
> 真源：`src/client/installed-detail.jsx`、`src/client/state.js` 的 `detail`、`lib/routes.js` 的 detail 路由与 `lib/scan.js` 的 `readSkillContent`
> 更新触发：改区块顺序、状态机、返回口径、读盘围栏或这 23 个键时，本文件与 `docs/contracts/routes.md` §3.3.3 一起改
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
- 身份与版本（`upstream` / `version` / `name`）来自列表里的 `Row`：打开详情**不重扫列表、不重拉 `list`**。**整页以宿主为准**：分区 Tag、软链 Tag、技能文件/真实位置/提供者/只读原因那张事实表都不渲染（宿主没有这些块）；软链只读只靠头部的「软链·只读」标记说明，`no-file` 行不解释原因——这两条是有意的。
- 正文与文件清单来自第 12 条路由 `GET /api/dsh-skill-center/detail?name=<kebab>` → `SkillContent{name,path,size,truncated,body,files,filesTruncated}`；围栏见 `docs/contracts/routes.md` §3.3.3。
- `body === null` 是「这条没有可读文件」（内置行）⇒ `detail.noBody` 文案，**不是错误**；`files === null` 时文件段整段不渲染。
- `Row.version` 是展示字段（`_meta.json` 的 `version`，0 次新增磁盘读），**不进任何判据**；为空时版本 Tag 整块不渲染，不写「未知」。

## 页面结构（自上而下）

**整页替换**：详情打开时**页头整块不渲染**（标题 / 介绍 / 计数 / 刷新 / 添加技能 / 页签全部不可见），详情从面包屑开始，`pageBody` 里只有一个详情容器；容器顶端有一条**仅用于拖窗口的空条**（`.skc_detailDrag`，`data-window-drag` 只挂在这一条上——整块当拖动区会吃掉文字选择与按钮点击；高度 = 页头的顶部内边距，darwin 再叠加安全区，所以进出详情头部不跳）。市场详情不是这样：它仍就地替换网格、页头保留（宿主只对插件详情覆盖整页，我们只对齐已安装详情）。

| # | 区块 | 内容 |
| --- | --- | --- |
| 1 | 面包屑 | `detail.back`（值「技能」/`Skills`，与宿主的 `crumbRoot` 同义），唯一返回入口（`.skc_marketCrumb` 配方） |
| 2 | 头行 | `.skc_detailTop`（`space-between` + `align-items:center`）：左 `IconTile` 加 **`.skc_detailIcon`**（**49×49**，宿主详情页的值；列表行仍是 48）；右侧 `.skc_detailActions`（`gap:16`）= **卸载占位按钮 + 开关**。卸载 = `Button variant="outline" size="sm" className=detailDanger disabled title=detail.uninstallSoon` + `IconTrashOutlineRegular size={13}` + 文案 `detail.uninstall`，**没有 onClick**（真实卸载见看板 M6；可见的不可点，与 `＋ 添加技能` 的 C-3 同一处置）。开关：`switchMode(row)` 非空 → `EnableSwitch`；软链行 → `ReadonlyTag`；其余不渲染 |
| 3 | 标题组 | `.skc_detailIntro`（图标下方纵向，`gap:8`；到图标行 20 = 列 gap 32 − 12）——**三段，顺序固定**：① 标题行 `.skc_marketTitleRow`：标题 `h3.skc_marketDetailTitle`（20/28/500）+ 版本 Tag（复用 `market.metaVersion` = `v{version}`，有值才画）；② **调用名行** `.skc_detailAuthor`（作者行那条刻度：**12/18 tertiary mono**，纯文本块）：`<code>{kebab 名}</code>`，**只有文字、没有复制按钮**——所以行高就是 18（不再被 22 高的按钮撑到 22），intro 三段总高 = 28 + 8 + 18 + 8 + 22 = **84**，文字级间距 ≈13/13，正好落到宿主的 13.0/12.5（这是去掉按钮的附带收益）；③ 描述（**`.skc_marketDetailDesc` 14/22 不截断**，空串整块不渲染）。**作者行不再显示**——`upstream` 仍供「代码来源 / 版本检查 / 查看仓库」用，只是不露在人眼前 |
| 4 | 失效原因（可选） | `reason` 非空时一行 `.skc_reason`（`role="alert"`），紧跟在标题组之后 |
| 5 | 正文盒 | **紧跟描述**，**前面没有区块标题**（宿主也是描述下面直接是 README，`market.detailOverview` 只给市场详情用）：`.skc_detailBodyBox`（`max-height:60vh; padding:12px 0; overflow-y:auto`，宿主 1440×920 实测 552px = 60vh；**上下各一条 0.5px 发丝线、左右无、圆角 0**——宿主就是这样，颜色取标签主色 5% 以随主题翻转；不加 `tabindex`、不拦 `wheel`）。**三态与空态都在盒内就地呈现**：`loading` → 一行 `detail.loading`；`error` → 一行 `detail.error` + 「重试」按钮；`ready` 但无正文 → 一行 `detail.noBody`；`ready` 有正文 → `MarkdownBlock`（必须传 `labels`：6 个 `markdown.*`，缺了它宿主渲染代码围栏时抛错、整段回落纯文本）；`truncated === true` 时正文**下方**再加一行 `detail.truncated` |
| 6 | 版本（**条件块：仅 `row.upstream !== null`，即市场装的技能**） | 本地技能（手工装 / 软链指向的技能目录 / 内置）**整块不渲染**——宿主对本地插件就没有这块，不再显示「无法检查更新」。块内：`detail.sectionVersion` 标题 + 右侧小按钮（`detail.checkAgain` / `detail.checking`，检查中禁用）；下面是圆角卡：`upToDate` 显示 ✓ 圆底 + `detail.upToDate` + `detail.checkedAt`（`HH:MM`）；`newer` 显示 `detail.newerVersion`（带上游版本号）+ `detail.checkedAt`；其余四态在卡内各一行文案（见「检查更新」）。**`unavailable` 只剩「有 upstream 但没有本地 version」这一条路径** |
| 7 | 来源信息（**1–2 行，恒渲染**） | `detail.sectionSource` 标题 + 复用事实表样式（`.skc_marketFacts`，左 label / 右值、`.5px` 分隔线）。**调用名那一行已移出**（见上一条区块）。**第一行** `detail.factCodeSource`：四种取值（都在客户端由 `Row` 拼，纯字符串）——①`upstream !== null` ⇒ `owner/slug@version`（无 version 就 `owner/slug`）；②`upstream === null` 且 `row.symlink === true` ⇒ `link:` + `realPath` 的目录（`realPath` 是 `<dir>/SKILL.md`，取 dirname，与宿主那条 `link:/Users/…` 同形状）；③`upstream === null` 且非软链、`row.path` 有值 ⇒ `path` 的目录；④`row.path === null`（内置 / provider-store 行）⇒ 文案 `detail.sourceBuiltin`（「内置」/`Built-in`），**不用等宽**。前三种值等宽。**第二行** `detail.factVersion`：`row.version`（等宽），仅 version 非空渲染——本地技能大概率没有 version，**这一行整行不渲染是允许的**（宿主那台有 `0.1.0` 是因为它是 npm 包）。**整块恒渲染**：市场装两行（代码来源 / 当前版本）、本地技能一行（代码来源，`link:` 或目录）、内置行一行（代码来源＝「内置」）；标题仍叫「来源信息」 |
| 8 | 查看仓库 | 仅详情出参带 `repoUrl` 时（= 有 upstream 身份）：右下角 `<a href={data.repoUrl} target="_blank" rel="noopener noreferrer">` + `detail.viewRepo` + 外链图标；13/20 tertiary、hover 变主色。**URL 由宿主拼好**（`https://skillhub.cn/skills/<owner>/<slug>`，见 `docs/contracts/routes.md` §3.3.3）：浏览器半部不造上游 URL、不发请求（硬约束 13）。**详情页内的普通链接**，不属于「整区可点」（硬约束 9），`target=_blank` 只有这一处 |
| 9 | 失效态 | 按 `detail.key` 在 `payload` 里取不到行 ⇒ 只渲染面包屑 + `error.E_NOT_FOUND` 一行，不抛异常 |

顺序一句话：**面包屑 → 头行（49 图标 + 卸载占位 + 开关 / 软链只读）→ 标题行（标题+版本）→ 调用名行（kebab + 复制）→ 描述 → [reason] → 正文盒 → [版本（仅市场装的技能）] → 来源信息（代码来源 / 当前版本）→ 查看仓库**。正文紧跟描述，其余技术区全在盒下；盒内滚正文，盒外跟页面滚。技能页**不再有「包含的技能」这一节**（调用名已升到标题下那一行）；同一套组件式行样式仍由插件页复用来列它包含的技能。

**文件清单已整块删除**（U1e）：宿主详情页没有文件清单，底部的技术区是「版本 / 来源信息 / 查看仓库」。`market.detailFiles` 与 `detail.filesTruncated` 两个键**留着**——市场详情仍用前者，后者留给以后真需要时；本页不再渲染它们。

区块骨架逐字复用 `.skc_marketDetail*` 族（**详情族，两个页签共用**，不改名）。已安装详情新增刻度共 23 条，规则体只有一处真源：`docs/contracts/visual.md` A.5（`.skc_detailPage` / `.skc_detailDrag` / `.skc_detailIcon` / `.skc_detailTop` / `.skc_detailActions` / `.skc_detailIntro` / `.skc_detailAuthor` / `.skc_detailDanger` / `.skc_detailBodyBox` / `.skc_detailVersionHead` / `.skc_detailVersionCard` / `.skc_detailVersionRow` / `.skc_detailVersionMark` / `.skc_detailVersionText` / `.skc_detailVersionTitle` / `.skc_detailRepoLink` / `.skc_detailBody`）＋调用名区块 5 条（`.skc_callRow` / `.skc_callIcon` / `.skc_callBody` / `.skc_callName` / `.skc_callDesc`），实现逐字相同，在 `src/client/styles.js`。

## 插件详情（内置 provider）

「内置」分区在列表里**不单列技能**，而是每个**提供它的插件包**折成一个块（见 `docs/contracts/client.md` §3.9.2）；点块进这一页。只有 `partition === 'builtin'` 的行进块，`local` / `installed` 行照旧是列表行；块按**包名**升序。

**块与插件页头的图标**按宿主的来源顺序取两处：① `package.json` 的 `icon`；② 没有可用 `icon` 时看 `exports["./icon"]` 指向的**图片文件**（值可能是字符串，也可能是 `{default: …}` 条件对象）。两处都过同一套闸：相对包根、`resolve` 后不出包根、`lstat` 普通文件（不跟随软链）、只认 `.svg/.png/.jpg/.jpeg/.webp`、≤ **256 KiB**（与宿主一致）；都拿不到就回退**首字母头像**——两种块在样式上没有区别，`IconTile` 只是多一张图。由 Host 半部读成 base64 data URL 随行下发为 `Row.pluginIcon`。

与宿主的两处**已知差异**：① 宿主在拿不到图时用内置的通用插件插画（`PluginArtworkDefault`），我们用首字母头像；② 宿主会把 `exports["./icon"]` 当模块**加载**（所以 `.js` 形态也能出图），我们**只认图片文件、绝不执行别人的模块**（副作用风险）——指向 `.js/.mjs/.cjs` 的导出就当没有。

**分组键与块标题都是包名**，不是 provider id：`dsh-univer-office` 这个包在它自己的注册代码里把 provider 名注册成 `univer`，它的 12 个技能（`office` / `office-docx` / `univer-sheet` …）同属一个包，标题写 `univer` 会让人以为「office 被塞进了 univer」。包名按**三层优先级**取：① `Row.pluginPackage`（Host 读该包 `package.json` 的 `name`，`link:` 安装也覆盖——包不在 `node_modules` 下时从技能目录向上**最多 6 层**找最近的 manifest，不跟随软链）；② `originPath` 里**最后一个 `node_modules/`** 之后的一段，`@scope/name` 取两段；③ 都取不到才退回 provider id。`provider` id 仍留在块数据里——它是开关写存储时的身份（`data-skc-plugin` 仍写 provider，另加 `data-skc-plugin-pkg` 写包名）。

结构与返回（**与技能详情页同一套刻度**，不另立样式族）：

| # | 区块 | 内容 |
| --- | --- | --- |
| 1 | 面包屑 | 复用 `DetailCrumb`（`detail.back`），返回**列表** |
| 2 | 头行 | 复用 `.skc_detailTop` + `.skc_detailIcon`：**49×49** 的 `IconTile`（插件包自己的图标，见上），**右侧留空**——内置没有卸载、也没有属于这个包的开关 |
| 3 | 标题组 | 与技能详情**同一套 intro 刻度**：`.skc_detailIntro` + `.skc_marketTitleRow` 里放包名 `.skc_marketDetailTitle`（**20/28/500**）+ **`v{pluginVersion}` Tag**（复用 `market.metaVersion`，有版本才画）；副行 `.skc_marketDetailDesc` + **`.skc_pluginDesc`**（14/22、margin 0，**2 行裁切**——裁切只加在这个修饰类上，技能页的描述故意不裁）= 插件包 `package.json.description`（`Row.pluginDescription`，≤200 字），**没有描述整行不渲染** |
| 4 | 包含的技能 | `.skc_sectionHead`（`flex; align-items:baseline; gap:8`）：`plugin.skills` 标题（14/20/500）**紧跟**一个 `.skc_pluginCount`（secondary 13/20）「共 {N} 个 · {M} 运行中」（`plugin.countRunning`，M = 该块里 `enabled === true` 的行数）——宿主就是贴着标题放，**不贴右缘**；标题区不再写「N 个技能」。正文是 `.skc_cards` 容器，行间靠 `border-top: .5px`（`--dsw-alias-border-l2` 那一族）分隔，**第一行没有**。每行是**只读信息行**（`.skc_callRow`：`gap:12`、`padding:10px 0`、`align-items:center`；`10` 是宿主组件行的拆分：41 图标 + 20 名称 + 2 + 32 描述 + 10×2）：**不可点、无 hover**——名称是纯文本 `<p class="skc_callName">`（13.5/20/500），没有 `cardOpen` 点击层、没有 `.skc_callRowOpen`、没有外扩负边距；内置技能没有下一级页面，插件页的行不提供详情入口（详情入口只在「已安装」列表里）。行内顺序固定：**名称** + **描述**（`.skc_callDesc`，11.5/16 tertiary、两行裁切、空串不渲染）+ **行底等宽调用名** `<p class="skc_callMeta"><code>{kebab}</code></p>`（`.skc_callMeta` 12/18 mono tertiary，对应宿主那行的模块名；**只有文字、没有复制按钮**，行高因此是 18，整行 = 10 + 20 + 2 + 32 + 2 + 18 + 10 = **~76**）；**没有包名行**（一块就是一包，属页级信息）。右 `.skc_cardEnd`（本体 28 高、垂直居中）里：`.skc_pluginState`（绿点 + `plugin.running` / 灰点 + `plugin.stopped`，13/20 secondary）**+ 开关**（软链行放 `ReadonlyTag`），状态与开关同一水平线、行内垂直居中 |
| 5 | 来源信息 | `detail.sectionSource` 标题 + 复用事实表样式（`.skc_marketFacts`，dd 行盒 22）：`detail.factCodeSource` = **`<pkg>@<version>`**（等宽；**三件套全缺时 fallback 成包名 `<code>{pkg}</code>`**，有 version 才拼 `@` 并多出下面那行）、`detail.factVersion` = `<version>`（等宽；**没有 version 这一行整行不渲染**） |

**没有**正文盒、版本区块与查看仓库：内置技能不检查更新，也没有上游仓库。

**风险注记**：「共 N 个 · M 运行中」的 **M 依赖 `row.enabled === true`**——某个 provider 若把 `enabled` 返回成 `undefined`，那一行会被算成「未运行」；改这个判据时这里要一起改。

**两页唯一允许的纵向差异**：技能页有正文盒（45）+ 盒后间距（32），合计 85px 是结构差；再叠加副行行数差（每行 22px，插件页固定 1 行「N 个技能」、技能页是技能描述可能 1–3 行），所以首个区块通常低 **85 + 22×n**（n≥0，实测典型 99px）。面包屑、头行（49 图标）、intro 起点、标题 20/28/500、副行 14/22 `margin 0`、区块标题、组件式行（74/41）两页逐项相同（实测 Δ0）。这些差值都是**内容差异不是错位**，别当 bug 再「修」。返回链是**两级**：`列表 → 插件详情 → 技能详情`。**离开技能页签再回来会复位**（列表页、插件页与两个滚动偏移全清，等价于重新进入）；页签**内部**的返回仍还原偏移——两条规则不冲突，只有跨页签才复位。

整页替换口径与技能详情一致：页头整块不渲染，`pageBody` 里只有一个 `.skc_detailPage`（含那条拖窗口的空条）；详情页通常没有滚动条，靠 `.skc_pageBody` 的 `scrollbar-gutter: stable` 与列表页保持**同一内容宽度**（否则整宽元素右边缘会差一个滚动条宽度）。

## 状态与返回

```text
store.detail = null | {key, status: 'loading'|'ready'|'error', data, code}
store.detailScrollTop = number      // 打开详情前记下的 .skc_pageBody 偏移
```

| action | 做什么 |
| --- | --- |
| `openDetail(row)` | `detail = {key: rowKey(row), status:'loading', data:null, code:null}`（不碰列表） |
| `openDetail(row, data)` | 带文本进详情：`data.error` 存在 ⇒ `status:'error'` + `code`；否则 `status:'ready'` + `data`。**首帧即终态** |
| `detailLoading(key)` | 只在 `detail.key === key` 时回到 `loading`（重试用） |
| `detailReady(key, data)` / `detailFailed(key, error)` | 只在 `detail.key === key` 时落地；晚到的旧响应因此被丢弃 |
| `closeDetail()` | `detail = null`（滚动位置由页面的 paint effect 写回） |

**打开详情先取正文、最多等 150 ms**：点行（或插件页里的行）后页面先发 `skillDetail`，用 `Promise.race` 与 150 ms 计时器比速度——数据先到就 `openDetail(row, data)`，详情**首帧就是终态**；超时才 `openDetail(row)` 走上面那条 `loading` 路径，并把同一笔在飞的请求交给 `loadDetail(row, inFlight)` 复用（不发第二遍）。取数失败同样立刻带着 `error` 进详情，不让用户白等。理由是去抖：`loading` 占位（一行 `detail.loading`）与实体正文高度不同，先画占位再换正文会把正文盒下面的**包含的技能 / 版本 / 来源信息**整体下推（QA 实测 50px、`LayoutShift` 0.0074–0.0122）。**不给行加 `onPointerDown` 之类的旁路**：每行仍只有一个 `onClick`（硬约束 9）。
| `rememberDetailScroll(top)` | 只记 `detailScrollTop`（打开前调一次，此时行还在屏幕上） |

- **打开时把滚动归零**：`detailKey !== null` 的 paint effect 写 `scrollTop = 0`——页头一撤，沿用列表那个偏移会让详情从中间开始。
- 返回：`closeDetail()` + 同一个 paint effect 把 `detailScrollTop` 写回 `.skc_pageBody`，**不重拉 `list`**。
- **详情打开时页签不可见**，所以不存在「切页签」这条路径（`detail` 仍留在 store 里，返回后回到列表与页签，数据不丢）。
- **详情打开时刷新按钮不可见**，所以「页头刷新 = 关详情 + 重扫」这条路径**不可达**；返回列表后再刷新即可（`load('refresh')` 仍只在列表态执行）。
- **检查更新**（新区块，手动触发，不自动发请求）：状态记在 store 的 `check = {key, busy, status, latestVersion, at}`，**按 `detail.key` 归属**——`openDetail` 与 `closeDetail` 都清空，晚到的答案按 key 丢弃。
  - **前置判定**：`openDetail(row)` 时就判一次——`upstream === null` ⇒ `check = null`（**没有区块，不判 `unavailable`**）；`upstream` 非空但 `row.version` 为空 ⇒ `{status:'unavailable'}`（唯一可达的 `unavailable`，按钮禁用、**不发请求**）；两者都齐 ⇒ `null`（= `idle`，按钮可点）。
  - 判据：点按钮后同一套判据再守一次（`unavailable` ⇒ 直接落地、不起请求）；可比就调 `api.marketDetail({source, owner, slug})`（`clawhub` 原样传，其余按 `skillhub`）。
  - 上游没给 `version` ⇒ `unavailable`；**相等 ⇒ `upToDate`；不等 ⇒ `newer`**——只比相等，**不排序**（不判「谁的版本更高」：预发布、日期式版本号都会骗人，宿主也只报「不同」）。
  - 请求抛错 ⇒ `error`（按钮可重试）。
  - 五态：`idle`（`detail.checkIdle`）/ `loading`（按钮 `detail.checking` 且禁用，**卡内保留上一次结论**）/ `upToDate` / `newer` / `unavailable`（`detail.checkUnavailable`，**按钮禁用**）/ `error`（`detail.checkFailed`）。`at` 用 `Date.now()`，显示时格式化成 `HH:MM`。
- **不支持 Esc**（与市场详情一致：加全局 keydown 会让两个详情页行为分叉）。
- 开关：详情头里就是行内那一个 `EnableSwitch`，读同一份 `state.rows`；失败原因 `.skc_reason` 照旧显示在头下。

## 文案（`locale/*.json`，单层扁平点号键，23 个）

`detail.{back,copy,copied,loading,error,retry,noBody,truncated,filesTruncated,uninstall,uninstallSoon}`、版本与底部四个键组 `detail.{sectionVersion,checkAgain,checking,checkIdle,upToDate,checkedAt,newerVersion,checkUnavailable,checkFailed,factCodeSource,factVersion,viewRepo}`（`detail.back` = 「技能」/`Skills`，头部的面包屑根）、`detail.{sectionSource,sourceBuiltin}`（来源信息标题、「内置」）。

复用而不造同义词：`row.{enable,disable,applying,symlinkReadonly,symlinkTitle}`、`market.{detailOverview,detailFiles,factSource}` + `market.source.*`、`error.E_NOT_FOUND`。另加 6 个 `markdown.*`（`codeCopy`/`codeCopied`/`codePlain`/`codeWrap`/`codeUnwrap`/`footnotes`）：它们不是本页文案，而是宿主 `MarkdownText` 的**代码围栏与脚注 chrome**，`labels` 缺了它宿主读 `labels.code.copyLabel` 直接抛错、整篇正文回落成纯文本，所以两个详情页共用这一段。全字典 117 → 136 → 142 → 144 → 156 → 148 → 149 → **150**（`check-i18n` 口径：148 个扁平键 + `meta` 两项；`detail.callName` 因区块改名「包含的技能」而零引用，已删）。`detail.filesTruncated` 与 `market.detailFiles` 不再上屏（文件清单已删），键留着。版本 Tag 与作者行不新增键：分别复用 `market.metaVersion`（`v{version}`）与 `market.metaAuthor`（`@{author}`）。

## 点击边界与复制

- 行可点只用 `AGENTS.md` 硬约束 9 的那一个手段：标题 `<button class="skc_cardTitle skc_cardOpen">` 的 `::after{inset:0}` 铺满整行 + `.skc_cardEnd{z-index:1}` 浮起；`<li>` 上不加 `onClick` / `role` / `tabIndex`，也不加 `<a>` 与第二可点区域。
- 可点的行才给 hover / active 底色（hover 只在 `@media (hover:hover)`，`:active` 是触屏唯一可靠证据），键盘走 `:focus-visible::after`；**不加 chevron、不加「点开详情」文案**。
- 详情页内部的面包屑、开关、重新检查是普通按钮，不开第二套点击层（复制入口已全部去掉）。
- 复制：`navigator.clipboard.writeText`；成功把图标换成对勾、1.5 s 后换回，并用 `aria-live` 播报 `detail.copied`；clipboard 不可用时**静默什么都不做**（文本本身可选中），不新增 toast kind。

## 不做

卸载与重装：**头部有一个 disabled 的「卸载」占位按钮**（可见的不可点，无 onClick、无写路由），真实卸载见看板 M6，重装见 M2、检查更新与「已是最新版本」（M6）、`查看仓库 ↗`（`_meta.json` 里没有仓库地址）、收藏入口（M8）、编辑正文 / 重命名 / 移动（写侧只改一行 frontmatter，见 `docs/contracts/routes.md` §3.4）。

---

## 验收

- `npm run check:client` 逐字节通过；`npm run check:i18n` 报 **144** 键且 zh/en 键集一致、`lib/**` 与 `src/client/**` 无 CJK。
- K110–K115（`docs/contracts/acceptance.md` 附录 D.5 尾部）逐条绿。
- 真机三项：面包屑返回落点与打开前一致、40 KB 正文可滚且 Markdown 正常、触屏 `:active` 有底色。
