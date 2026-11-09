# 源适配器、市场数据流与市场刻度

> 类型：规范
> 读者：加改市场源适配器、上游调用、归一化、安装取包形状，或改市场页视觉刻度的人
> 真源：`lib/market/` 下的十个模块与 `src/client/` 下 `market-` 前缀的文件的实际导出
> 更新触发：加删源适配器、改上游调用/归一化/安装取包形状，或改市场刻度时，同步改 §7 / 附录 F / 附录 G
> 规模上限：400

本文只写市场面（Host 的 `lib/market/**` 与 Client 的 `market-*` 组件）的契约。路由表、安装链路的分阶段与失败码在 `docs/contracts/routes.md` §3.7；类型与纯函数总览在 `docs/contracts/data-model.md` §3.8；调用顺序在 `docs/contracts/flows.md` §4.5 §4.6。

市场面**只连两个 origin**：`https://api.skillhub.cn` 与 `https://clawhub.ai`。浏览器不直连上游（SkillHub 的列表响应没有 `access-control-allow-origin`），一切网络都在 Host 侧的 `lib/market/upstream.js`。

---

## 7 源适配器与市场数据流

### 7.1 `MarketSource` 契约与四条铁律

```js
/**
 * @typedef {Object} SourceCaps
 * @property {boolean} search       支持关键词检索
 * @property {boolean} paged        list/search 能返回下一页
 * @property {boolean} categories   有稳定分类表
 * @property {'files'|'zip'} package 取包形态：逐文件下载，还是整包 zip
 */

/**
 * @typedef {Object} MarketSource
 * @property {string} id                      'skillhub' | 'clawhub'（来源筛选项的机器值）
 * @property {string} labelKey                 'market.source.<id>'（文案只在 locale 里）
 * @property {SourceCaps} caps
 * @property {(q: ListQuery, io: UpstreamIo) => Promise<SourcePage>} list
 * @property {(q: ListQuery, io: UpstreamIo) => Promise<SourcePage>} search
 * @property {(ref: ItemRef, io: UpstreamIo) => Promise<MarketDetail>} detail
 * @property {(ref: ItemRef, io: UpstreamIo) => Promise<SourcePlan>} plan
 * @property {(plan: SourcePlan, path: string, io: UpstreamIo) => Promise<Buffer>} fetchFile
 * @property {(io: UpstreamIo, options: {now: () => number, refresh?: boolean}) => Promise<{items: Category[]}>} [categories]
 * @property {(io: UpstreamIo, options: {now: () => number, refresh?: boolean}) => Promise<{counts: Record<string, number|null>, total: number|null, ok: boolean}>} [counts]
 * @property {(refs: {owner: string, slug: string}[], io: UpstreamIo, options: {now?: () => number}) =>
 *   Promise<{icons: Record<string, string|null>, names: Record<string, string|null>}>} [icons]
 *   // 批量图标与上游标题：两图同键（`sourceId:owner:slug`）、同序；值分别是 MarketItem.iconUrl 的编码与上游 displayName
 */
```

`ListQuery` = `{limit, cursor, sort, category, keyword}`，其中 `cursor` 是**已解码**的我们自己的对象（见 §7.2 的游标形状），`null` 表示第一页。`ItemRef` = `{owner, slug, version|null}`。

四条铁律（破一条就会在「加第三个源」时漏东西）：

1. **适配器不碰 `fetch`、不碰文件系统、不碰时钟。** 网络只经注入的 `io`（`{getJson, getBytes}`，由 `lib/market/upstream.js` 的 `createUpstream()` 产出），时间只经 `options.now`（`categories` / `counts` / `icons` 三个可选方法都收它，缺省回落 `Date.now`，测试可注入假时钟）。QA 用假 `io` 就能跑通整条链路，不必起服务器。
2. **适配器只输出归一化后的形状，字段兜底统一在 `normalize.js`。** 每个适配器只提供 `toItem` 需要的映射；跨源字段一律由 `lib/market/normalize.js` 兜底（缺字段 = `null`，绝不写 `0`/`''` 假装有值）。
3. **适配器不知道「来源筛选」「跨源合并顺序」「分页大小」。** 它只接受 `ListQuery` 并返回 `{items, next, total}`；`next` 是它自己的不透明游标（`null` = 没有下一页）。
4. **安装只认清单。** `plan()` 返回的 `files[{path, size, sha256|null}]` 是唯一合法的取文件集合；客户端永远不传文件路径，`install` 的请求体只有 `{source, owner, slug, version}`。

### 7.2 两源能力对照、游标与 sort 映射

| 能力 | skillhub | clawhub |
| --- | --- | --- |
| `list` | `GET /api/skills?page&pageSize&sortBy&order` | `GET /api/v1/skills?limit&cursor&sort` |
| `search` | 同一端点 + `keyword=`（因此能翻页） | `GET /api/v1/search?q&limit`（**无游标**，`next` 恒 `null`） |
| 游标形状 | `{page: number}`（1 起） | `{cursor: string}`（上游 `nextCursor` 原样装袋） |
| `detail` | `GET /api/v1/skills/<slug>?namespace=&version=` + 清单 + `SKILL.md` | `GET /api/v1/skills/<slug>?ownerHandle=`（`skill.description` 就是 `SKILL.md` 全文）+ 一次 zip（只为列文件） |
| `plan` | `GET …/files?namespace=&version=`（清单） | `GET /api/v1/download?slug=&ownerHandle=&version=`（zip 读中央目录，不算校验和） |
| `fetchFile` | `GET …/file?path=&namespace=&version=`（302 → COS，见 §3.7.3 第 4 条） | 从 `plan` 已取到的 zip buffer 里 inflate（**一包一次下载**） |
| `categories` | `GET /api/v1/categories`，滤 `pay-skill`，10 分钟内存缓存 | 无（`caps.categories = false`） |
| `caps` | `{search:true, paged:true, categories:true, package:'files'}` | `{search:true, paged:true, categories:false, package:'zip'}` |
| `total` | 上游 `data.total`（数字） | 恒 `null` |
| 图标 | `iconUrl`：实测前 100 条约 **八成**有图（COS 的 `/skill-icons/uploads/…` 与 `cloudcache.tencent-cloud.com` 的 `other_external_resource/…` **两者都是该技能自己的图**），其余为空 ⇒ **绝对 `https:` 即接受，不做 host/path 白名单**。列表阶段直接带出，无需二次请求 | **列表端点没有 `icon` 字段**（实测 49 条 0 条有此键），**详情端点有**：`/api/v1/skill-icons/<64 位 hex>` 或 `lucide:<Name>` 或 `null`。实测 35 条里只有 2 条有图（1 上传 / 1 lucide），故列表阶段一律 `null`，由 `POST /market/icons` 渐进补；两种真形状都转成**我方代理 URL**（见 §7.5） |
| 图标补齐 | 市场列表**自带** `iconUrl`；已安装行只有身份 ⇒ 走一次 detail 单查（见 §7.5 第 3 段） | **列表不再等图标**（ClawHub 详情单条实测 2.27–3.02s，等它等于每页白等 1–3s）。改由 `POST /market/icons` 渐进补齐：≤24 条、并发 4、整批 6s、单条 5s、正向 10min / 负向 60s 缓存，键 `clawhub:<owner>:<slug>`；失败只让该条 `null`，**绝不抛** |
| 计数 | `counts`：13 次 `GET /api/skills?page=1&pageSize=1(&category=)` 取 `data.total`（12 个分类 + 1 个「全部」），并发 6、单项 6s、整体 10s 预算、10 分钟缓存；**每个 `count` 是该过滤条件的独立总数，不保证 12 类相加等于 `total`**（实测差几十条，上游按请求时刻统计、且一条技能可归属多个分类），界面不得用「合计」校验它 | 无 |
| 一次 `list` 的上游请求数 | 1 | 1（**不再为图标额外请求**） |
| 一次 `POST icons` 的上游请求数 | 每条一次 detail（**不带 `version`**，实测 0.26s），并发 6，6s 整批预算内 | 每条一次详情，并发 4，6s 整批预算内 |
| 一次 `detail` 的上游请求数 | 3（详情 + 清单 + `SKILL.md`） | 2（详情 + zip） |
| 一次 `bootstrap` 的上游请求数 | 冷缓存 **14**（分类表 1 + 计数 13），10 分钟内 0 | 0（不参与 bootstrap） |

sort 映射（`sort` 只有三个值，路由层已白名单化）：

| `sort` | skillhub | clawhub |
| --- | --- | --- |
| `recommended`（默认） | `sortBy=score&order=desc` | 不带 `sort`（上游默认序 = 最近活跃在前） |
| `updated` | `sortBy=updated_at&order=desc` | 不带 `sort`，页内再按 `updatedAt` 降序 |
| `downloads` | `sortBy=downloads&order=desc` | `sort=downloads` |

**`paged` 的分裂不特殊处理**：clawhub 的 list 能翻、search 不能，统一由「本次 `next` 是否为 `null`」表达。客户端只问一句「还有 next 吗」，不读 `caps.paged`。

**分类只有一个源有表**：`caps.categories === false` 的源收到 `category` 时返回空页（不静默忽略过滤条件，避免「筛了却没生效」的假象）；界面侧由 `visibleCategories` 决定整行是否渲染。

**声明名为什么是硬约束**：安装目录名取包内 `SKILL.md` 的 `name`，而宿主的技能加载器用 `SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`（`EX/dsh-skill/lib/index.js`，与 `lib/names.js` 的 `isSkillName` 同一文法）判定一个目录能不能成为技能。声明 `Design` 的包即使被强行写进 `skills/`，宿主也不会加载它——所以 `422 E_SKILL_NAME_INVALID` 是**对齐宿主**，不是保守：改名或用 slug 顶替只会产出一个"看得见、永远不生效"的目录。

### 7.3 加第三个源要动哪几行

| # | 动什么 | 量级 |
| --- | --- | --- |
| 1 | 在 `lib/market/sources/` 下新增一个 `<id>.js`，实现 §7.1 的六个函数 | 1 个文件 |
| 2 | `lib/market/sources/index.js` 的 `SOURCES` 数组加一项 | **1 行** |
| 3 | `locale/zh.json` 与 `locale/en.json` 各加一条 `market.source.<id>` | **1 键 × 2 文件** |
| 4 | 源的启停与排序（设置面）本轮不做，也不预留占位 UI | 0 |

页面骨架、卡片渲染、合并逻辑、安装流程、路由**一行都不用改**：来源筛选项由 `market/bootstrap` 返回的 `sources[]` 渲染（不是枚举），`caps.categories=false` 的源自动不进分类过滤，包形态由 `caps.package` 决定（`install.js` 里 `files` 与 `zip` 两条路径都已就位）。

### 7.4 归一化字段表与「缺 = null」不变式

`MarketItem`（`market/list` 与 `market/detail` 的渲染输入，也是去重键的来源）：

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `sourceId` | 本地算 | 适配器 id |
| `id` | 本地算 | `${sourceId}:${owner}:${slug}`，去重键与 React key（上游 id 两源不通用） |
| `owner` | 上游 | SkillHub `namespace.handle`（实测含下划线）／ClawHub `ownerHandle` |
| `slug` | 上游 | ClawHub 搜索结果缺 slug 时取 `canonicalUrl` 的最后一段 |
| `displayName` | 上游 | `name`／`displayName`；缺则回落 `slug`，再缺为空串 |
| `iconUrl` | 上游 / 本地算 | 四种合法形态：① **绝对 `https:`**（SkillHub 两个图床都算，不做 host/path 白名单；`http:` 与非字符串归 `null`）；② `lucide:<Name>` → 我方文档相对路径 `api/dsh-skill-center/market/lucide?name=<kebab>`（`FileText`→`file-text`，#10 是唯一实现）；③ ClawHub 上传图标 `/api/v1/skill-icons/<64hex>` → `api/dsh-skill-center/market/clawhub-icon?hash=<64hex>`（#12）；④ `null`。其余（`//host/x`、未知站内路径、裸词、空值）归 `null`。`null` 与**加载失败**都是「回落首字母头像」，破图由浏览器侧 `onError` 兜住 |
| `summary` | 上游 | 折叠成一行、≤ 400 字符（超长截断） |
| `author` | 上游 | 三级回落：`publisher.name/displayName` → `namespace.displayName` → `owner` |
| `version` | 上游 | **缺失如实为 `null`**（ClawHub 搜索结果必为 `null`，因为该端点不给版本号） |
| `downloads` | 上游 | SkillHub `downloads`／ClawHub `stats.downloads`；缺失 `null` |
| `updatedAt` | 上游 | epoch 毫秒，**只用于排序，不上屏** |
| `category` | 上游 | 仅 SkillHub 有；ClawHub 恒 `null` |
| `packageKind` | 本地算 | 来自 `caps.package`，决定详情页「文件」从哪来 |

`MarketDetail`（`market/detail` 的 `data`）：`item`（上表）、`overview`（`stripFrontmatter(SKILL.md)` 的正文，≤ 8000 字符；正文为空时回落 `summary`）、`declaredName`（`parseFrontmatter(SKILL.md).name`，不合规也原样给出）、`nameValid`（`isSkillName(declaredName)`）、`installTo`（`nameValid ? join(skillsRoot, declaredName) : skillsRoot`，由路由补，适配器不碰磁盘）、`files[{path, size}]`（按清单顺序，`sha256` 不下发）、`filesComplete`（zip 读不全时为 `false`）。

`SourcePage`（`list`/`search` 的返回）：`{items: MarketItem[], next: string|null, total: number|null}`。`next` 是 `encodeCursor()` 产出的不透明串，客户端原样回传。

**不变式（逐条可断言）**：

1. 上表每个字段都存在（不出现 `undefined`）；上游没给的一律 `null`，`downloads` 绝不补 `0`、`version` 绝不补 `'latest'`。
2. `id` 全仓库唯一；同一 `id` 出现两次时保留第一次出现的那条。
3. `overview` 不含 frontmatter 分隔行（`---`）与 `name:` 之类的头字段。
4. `files` 里 `path` 一律通过 `isSafeRelativePath`；`path` 与 `size` 是详情页唯一需要的两项。
5. `updatedAt` 只影响排序：卡片、详情、事实表**都不显示任何时间**。

---

### 7.5 图标管道（三段式，列表永不等后两段）

图标分三段拿，**任何列表路径都不许等后两段**：

1. **随列表拿**：SkillHub 的 `iconUrl` 就在列表条目里，直接用。
2. **渐进补齐**：ClawHub 的列表没有 `icon`（实测 49 条 0 条有此键），只有详情有，而详情单条实测 **2.27–3.02s** —— 等它等于每页白等 1–3s，且实测 35 条里只补得出 2 条。所以列表阶段 ClawHub 的 `iconUrl` 一律 `null`，客户端渲染出一页卡片后，把这一页的 `{owner, slug}` 打一次 `POST /market/icons`（≤ 24 条），拿回 `{'clawhub:<owner>:<slug>': iconUrl|null}` 自己 patch 卡片。

3. **已安装行按身份单查**：已安装行手上只有 `_meta.json` 的身份（`Row.upstream`），没有市场列表载荷，所以 SkillHub 那一侧也要一条通道：`skillhub.icons()` 走**同一条 detail** `GET /api/v1/skills/<slug>?namespace=<owner>`（**不带 `version`**——图标与标题都属于技能而非某个版本，还能吃上游 CDN 缓存），只读 `skill.iconUrl` 与 `skill.displayName`，**不拉清单、不拉 `SKILL.md`**（那会变成 3 次请求）。实测单条 **0.26s**，12 条 / 并发 6 ≈ 0.6s。

**标题搭顺风车**：这两个字段在同一条 detail 里，所以 `icons()` 一次返回 `{icons, names}`，`POST market/icons` 的响应也就带出**上游标题**（SkillHub 的 `displayName` 就是市场卡片上那行字，如 `dev-expert-pro` → 「编程专家Pro.Skill」）。缓存一次存 `{at, iconUrl, displayName}`，命中时两个值一起回——不存在「有图无题」的中间态。这条**不新增任何请求**，也不需要新路由。

两源共用 `POST /market/icons`（§3.7.5），各自计时、各自缓存：SkillHub 并发 **6** / 单条 **5s**、ClawHub 并发 **4** / 单条 **5s**，**每源各自 6s 预算**（混合批次 ≈ `max(两源)`，不是相加）；超预算的条目返回 `null`（卡片保持首字母头像），整批仍 `200`；单条失败只让该项 `null`，一个源整体失败只让该源 `null`，**绝不 5xx**。缓存键 `skillhub:<owner>:<slug>` / `clawhub:<owner>:<slug>`，正向 10 分钟、负向 60 秒（负向短，上游补上图标后能很快看见）；命中不打上游。`bootstrap?refresh=1` 清空全部图标缓存。

**一个诚实的量化**：一本 24 条的 ClawHub 批次在 6s 内只补得出约 8–10 条（4 并发 × 2.7s/条），其余 `null` 且本会话不再问；已安装行通常是个位数，命中率反而更高。

### 7.6 图片端点（非信封响应的两条）

`market/lucide`（#10）与 `market/clawhub-icon`（#12）是插件里仅有的不回 `{code,data,message}` 的路由：`<img>` 读不了信封。两者都回**裸图片字节** + `X-Content-Type-Options: nosniff` + `Content-Security-Policy: default-src 'none'`（**不透传上游 CSP**），未命中或上游不可用一律 `404` 空 body。浏览器侧只需要一个 `<img onError>`：这条 URL 失效就退回首字母头像，不必区分「本来没图」和「取不到」。

必须代理而不是直连的理由：ClawHub 的上传图标响应头带 `content-security-policy: … sandbox`，同样字节在页内当 `<img>` 一律 `onerror`（走 `blob:` 却能正常光栅化）；Lucide 给的则根本不是图片地址，而是图标名。

## 附录 F 市场视觉刻度

市场样式全部落在 `src/client/styles.js` 的 `skc_market*` 类里，取值逐字取自宿主插件市场的 `DiscoverSection` 规则体（宿主类名是构建哈希，只作证据，不进选择器）。市场**不新增任何颜色字面量**。

| 类 | 取值（逐字） | 取自宿主哪条 |
| --- | --- | --- |
| `.skc_marketSection` | `flex-direction:column; gap:16px; display:flex` | `.section` |
| `.skc_marketToolbar` | `flex-wrap:wrap; align-items:center; gap:8px; display:flex` | `.toolbar` |
| `.skc_marketSearch` | `flex:1; min-width:120px` | `.search` |
| `.skc_marketSelect` / `Label` | `max-width:240px; margin-left:-8px; font-weight:500` / `text-overflow:ellipsis; white-space:nowrap; overflow:hidden` | `.marketButton` / `.marketName` |
| `.skc_marketChips` | `flex-wrap:wrap; align-items:center; gap:6px; display:flex` | `.categories` |
| `.skc_marketScope` | `color:var(--dsw-alias-label-tertiary); margin:0; font-size:13px; line-height:20px` | `.muted` |
| `.skc_marketNotice` | `border-radius:var(--dsw-radius-md); background:var(--dsw-alias-state-warn-tertiary); align-items:flex-start; gap:8px; margin:0; padding:10px 12px; font-size:12px; line-height:18px; display:flex` | `.notice` |
| `.skc_marketGrid` | `display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:12px; margin:0; padding:0; list-style:none` | **新刻度** |
| `.skc_marketCard` | `border-radius:var(--dsw-radius-xl); align-items:stretch; gap:14px; padding:14px; display:flex; flex-direction:column; position:relative; min-width:0` + hover `background:var(--dsw-alias-interactive-bg-hover)` | `.card`（**无边框**）；column 下必须 `stretch`——`flex-start` 会让骨架条形段与描述收缩包裹 |
| `.skc_marketMain` / `TitleRow` | `flex-direction:column; flex:1; gap:2px; min-width:0; display:flex` / `flex-wrap:wrap; align-items:center; gap:8px; min-width:0; display:flex` | `.main` / `.titleRow` |
| `.skc_marketCardOpen` | `max-width:100%; color:inherit; font:inherit; text-align:left; cursor:pointer; text-overflow:ellipsis; white-space:nowrap; background:0 0; border:0; padding:0; font-size:14px; font-weight:500; line-height:20px; overflow:hidden` | `.cardOpen` |
| `.skc_marketCardOpen::after` | `content:""; border-radius:var(--dsw-radius-xl); position:absolute; inset:0` | `.cardOpen:after`（整卡可点的唯一手段） |
| `.skc_marketCardOpen:focus-visible` | `outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset:2px` | `.cardOpen:focus-visible` |
| `.skc_marketDesc` | `color:var(--dsw-alias-label-tertiary); -webkit-line-clamp:1; -webkit-box-orient:vertical; display:-webkit-box; overflow:hidden; font-size:13px; line-height:18px` | `.description` |
| `.skc_marketMeta` / `FileSize` | `color:var(--dsw-alias-label-tertiary); margin:0; overflow-wrap:anywhere; font-size:12px; line-height:18px` | `.meta` |
| `.skc_marketCardEnd` | `z-index:1; flex:none; align-self:flex-end; align-items:center; gap:8px; display:inline-flex; position:relative` | `.cardEnd`（`z-index:1` 让安装按钮浮在点击层之上，不可省；`align-self:flex-end` 让动作靠右下） |
| `.skc_marketEmpty` / `EmptyTitle` | `text-align:center; flex-direction:column; align-items:center; gap:8px; padding:64px 0; display:flex` / `margin:8px 0 0; font-size:14px; font-weight:500; line-height:20px` | `.empty` / `.emptyTitle` |
| `.skc_marketError` / `Failure` / `More` | `color:var(--dsw-alias-state-error-primary); align-items:center; gap:6px; margin:0; font-size:13px; line-height:20px; display:inline-flex` / `align-items:center; gap:10px; display:flex` / `align-self:center` | `.error` / `.failure` / `.more` |
| `.skc_marketDetail` / `Crumb` / `CrumbIcon` | `flex-direction:column; gap:16px; display:flex` / `color:var(--dsw-alias-label-tertiary); font:inherit; cursor:pointer; background:0 0; border:0; align-self:flex-start; align-items:center; gap:6px; padding:0; font-size:12.5px; display:inline-flex` / `transform:rotate(90deg)` | `.detail` / `.crumb` / `.crumbIcon` |
| `.skc_marketDetailHead` / `DetailTitle` / `DetailDesc` | `align-items:center; gap:14px; display:flex` / `margin:0; font-size:20px; font-weight:500; line-height:28px` / `color:var(--dsw-alias-label-secondary); overflow-wrap:anywhere; margin:0; font-size:14px; line-height:22px` | `.detailHead` / `.detailTitle` / `.detailDescription` |
| `.skc_marketDetailSection` / `SectionTitle` | `flex-direction:column; gap:12px; margin-top:16px; display:flex` / `margin:0; font-size:14px; font-weight:500; line-height:20px` | `.detailSection` / `.sectionTitle` |
| `.skc_marketFacts` | `div`：`border-bottom:.5px solid var(--dsw-alias-border-l2); justify-content:space-between; align-items:center; gap:16px; min-height:44px; padding:8px 2px; display:flex`；`dt`：`color:var(--dsw-alias-label-secondary); flex:none; font-size:13px; line-height:20px`；`dd`：`text-align:end; overflow-wrap:anywhere; min-width:0; margin:0; font-size:13px; line-height:20px`；`code`：`background:var(--dsw-alias-bg-module-platform); font-family:var(--ds-font-family-code); border-radius:4px; padding:2px 6px; font-size:12px` | `.facts` |
| `.skc_marketFiles` | `li`：`border-bottom:.5px solid var(--dsw-alias-border-l2); justify-content:space-between; align-items:center; gap:16px; min-height:32px; padding:6px 2px; display:flex; font-size:13px; line-height:20px` | **新刻度**（行配方取自 `.facts div`，行高与内边距压密） |
| `.skc_marketFileName` | `overflow-wrap:anywhere; min-width:0; font-family:var(--ds-font-family-code); font-size:12px; line-height:18px` | `.facts code` 的字体族 |
| `.skc_marketDialog` / `ConfirmBody` / `ConfirmHead` | `width:min(480px, 100vw - 32px)` / `flex-direction:column; gap:12px; display:flex` / `align-items:center; gap:14px; display:flex` | `.dialog` / `.dialogBody` / `.confirmHead` |
| `.skc_marketSkeletonBar` | `margin:4px 0; display:block`；底色与呼吸动画复用既有 `.skc_skeletonFill`（**不新增色值与动画**） | `.skeletonBar` |
| `.skc_marketSkeletonChip` | `border-radius:var(--dsw-radius-lg); width:64px; height:26px` | 分类 chips 占位（对齐 `Button size="sm"` 的静态尺寸） |
| `.skc_marketSkeletonAction` | `border-radius:var(--dsw-radius-md); width:64px; height:24px` | 安装按钮占位（同上） |
| `.skc_marketToastHint` | `color:var(--dsw-alias-label-secondary); overflow-wrap:anywhere; margin-top:2px; font-size:12px; line-height:18px; display:block` | 安装 toast 的副行（安装路径），12/18 secondary |

**新刻度共六条**（宿主没有对应规则体，逐条给理由；其余全部是宿主规则体转写）：① 网格 `minmax(280px, 1fr)` + `gap:12px`（960px 内容宽正好 3 列、<600px 一行 1 列）；② 卡片改竖向排布、`padding` 8 → 14、`align-items:stretch`（column 下 `flex-start` 会让骨架条形段与描述收缩包裹）；③ 安装按钮行 `align-self:flex-end`（动作靠右下，而不是被拉伸成整行）；④⑤ 两个骨架占位 `SkeletonChip` 64×26、`SkeletonAction` 64×24（对齐 `Button size="sm"`，骨架与真件同宽同高）；⑥ 安装 toast 副行 `ToastHint` 12/18 secondary（与元信息行同刻度）。三条骨架/副行类只在市场页出现，**不碰已安装页签的任何既有类**。

三条不可协商的纪律：

1. 市场**不新增任何颜色字面量**：色值只来自 `--dsw-*` 令牌与 `avatar.js` 的 12 组粉彩。
2. 全仓库**仍然只有 `styles.js` 与 `avatar.js` 两处**有颜色字面量（`test/styles.test.mjs` 会查）。
3. 市场卡片**复用**既有 `.skc_cardIcon`（48×48、`border-box`、`radius-lg`、`background-clip:padding-box`），一条声明都不改——改它会让「已安装」页签 11 行同时回归。

卡片**无描边**：描边只出现在头像框上；卡面靠 `radius-xl` + hover 底色表达可点性（依据见 `docs/contracts/decisions.md` 附录 E）。

**头像位的两种内容**：`iconUrl !== null` 时头像盒里渲染 `<img src={iconUrl}>`——占满盒子（`width:100%; height:100%`）、`object-fit:contain`（图标常带透明边或非正方形，`cover` 会裁掉形状）、圆角 `calc(var(--dsw-radius-lg) - .5px)` 即落在 0.5px 描边**内侧**（与既有 `background-clip:padding-box` 是同一套几何，改错会在描边处露出 1px 白边）；`iconUrl === null` 与**图片加载失败**（`onError`，按 URL 记录、不重试）都回落 `avatar.js` 的首字母头像。两种内容共用同一个 48×48 盒子，切换**不改变**行高、节距与网格列宽——「有图标」只是换盒内内容，不新增容器。ClawHub 的 `lucide:` 代理 SVG 与它自己的 `/skill-icons/…` SVG 也走同一个 `<img>`：`stroke="currentColor"` 在图片文档里落到默认黑色，压在粉彩头像底上深浅两主题都可见，不需要为图标另加一套着色逻辑。

---

## 附录 G 市场半部文件清单

Host 半部（`lib/market/`，纯 node ESM，无构建）：

| 文件 | 职责 |
| --- | --- |
| `lib/market/upstream.js` | 唯一对外出口：`getJson` / `getBytes`（`node:https`）、连接与总超时、响应字节上限、302 白名单跟随、`maxSockets` 与两道并发闸、网络失败映射成 `E_SOURCE_*` |
| `lib/market/query.js` | 参数白名单（`source/sort/category/keyword/limit/cursor` 与 `owner/slug/version`）、游标 `encodeCursor`/`decodeCursor`、`limit` 夹取、`buildUrl` 的 origin 断言 |
| `lib/market/normalize.js` | 两源原始条目 → `MarketItem`、`overviewOf`/`declaredNameOf` 派生、`sortByUpdatedDesc`；「缺 = null」的唯一落点 |
| `lib/market/errors.js` | `MarketError{code,message,detail}`、`code → HTTP status` 表、`asMarketError` 兜底 |
| `lib/market/sources/index.js` | 源注册表（`SOURCES` / `getSource` / `descriptors` / `descriptorsOf`）与 `makeMarketDeps`（装配 io / store / installer，供 `index.js` 注入路由） |
| `lib/market/sources/skillhub.js` | SkillHub 适配器：`list/search/detail/plan/fetchFile/categories/counts/icons` + 分类表与图标缓存各 10 分钟 |
| `lib/market/sources/clawhub.js` | ClawHub 适配器：`list/search/detail/plan/fetchFile/icons`；`skill.description` 即 `SKILL.md` 全文，zip 一包一次 |
| `lib/market/zip.js` | 最小 ZIP 读取器（EOCD → 中央目录 → local header；`store`/`deflate`；zip-slip/符号链接/加密/条目数与体积上限；CRC32） |
| `lib/market/install.js` | 安装编排：解析名字 → 冲突检测 → 临时目录 → 逐文件校验写入 → 原子 rename → 台账 → 失败清理（唯一 `rm -rf` 处） |
| `lib/market/store.js` | 自有台账 `$DSH_HOME/dsh-skill-center/installed.json` 的读/写（临时文件 + fsync + rename；损坏降级为空；形状与 `lib/ledger.js` 的 `own-record` 兼容） |

Client 半部（`src/client/`，纯逻辑模块 node 可直接 import）：

| 文件 | 职责 |
| --- | --- |
| `src/client/market-model.js` | **纯函数**：`marketKeyOf` / `mergeBatches` / `metaSegments` / `visibleCategories` / `chipList` / `installViewOf` / `emptyKindOf` / `detailFacts` / `reasonKeyOf` |
| `src/client/market-panel.jsx` | `MarketPanel`：工具栏 / 分类 chips / 网格 / 尾部（骨架 / 重试 / 没有更多了）/ 整页态 / 详情切换 / 确认弹窗 / 触底预取 |
| `src/client/market-filters.jsx` | 搜索框（250ms 防抖 + 回车立即 + 清空复位）、来源选择、排序选择、分类 chips、分类作用域说明 |
| `src/client/market-card.jsx` | 一张卡：头像（复用 `avatar.js`）+ 标题按钮（`skc_marketCardOpen` 铺满整卡）+ 来源 Tag + 描述 + 元信息行 + 安装动作位 |
| `src/client/market-detail.jsx` | 内嵌详情：面包屑返回 + 头（头像/标题/版本 Tag/动作）+ 事实表 + 概览 + 文件清单 + 三种失败态 |
| `src/client/market-skeleton.jsx` | 首屏 6 张卡骨架 + 分类 chips 占位；尾部 3 张骨架 |
| `src/client/market-confirm.jsx` | 安装确认（primitives `Modal` + 头像 + 名称 + 版本 + 事实表 + 第三方提示） |

三句不变量：

1. **不新增依赖**：`node:https` / `node:zlib` / `node:crypto` / `node:fs/promises` 全是内置；`dependencies` 恒空。
2. **客户端不新增 require**：仍只用平台 seed 的 `react` / `react/jsx-runtime` / primitives，`inject` 仍是 `['slots','locale']`。
3. **不新增座位**：安装成功的 toast 复用既有 `shell.overlay`，市场页仍是 `main` 槽里的同一个全局页。

---

## 验收

市场面的验收不另建表（避免两份口径）：用例编号 K28–K51 与 PRD 的 A1–A17 对照登记在 `docs/contracts/acceptance.md` 的附录 D.5；路由与安装链路的契约面见 `docs/contracts/routes.md` §3.7 与 §8.6。
