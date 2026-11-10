# 源适配器、市场数据流与市场刻度

> 类型：规范
> 读者：加改市场源适配器、上游调用、归一化、安装取包形状，或改市场页视觉刻度的人
> 真源：`lib/market/` 下的十一个模块与 `src/client/` 下 `market-` 前缀的文件的实际导出
> 更新触发：加删源适配器、改上游调用/归一化/安装取包形状，或改市场刻度时，同步改 §7 / 附录 F / 附录 G
> 规模上限：400

本文只写市场面（Host 的 `lib/market/**` 与 Client 的 `market-*` 组件）的契约。路由表、安装链路的分阶段与失败码在 `docs/contracts/routes.md` §3.7；类型与纯函数总览在 `docs/contracts/data-model.md` §3.8；调用顺序在 `docs/contracts/flows.md` §4.5 §4.6。

市场面**只连一个 origin**：`https://api.skillhub.cn`（ClawHub 的目录、详情与安装包都由它的镜像接口 `source=clawhub` 提供）。浏览器不直连上游（SkillHub 的列表响应没有 `access-control-allow-origin`），一切网络都在 Host 侧的 `lib/market/upstream.js`。

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
 *   （当前两源都是 'files'：ClawHub 的整包 zip 分支于 U7 退役（实现模块一并删除），
 *   联合类型保留，是为了「将来加一个真 zip 源」时这份契约仍然成立）
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

### 7.2 三个 scope 的能力对照、游标与 sort 映射

| 能力 | `all`（默认） | `skillhub` | `clawhub` |
| --- | --- | --- | --- |
| `list` | `GET /api/skills?page&pageSize&sortBy&order`（**不带 `source`** = 站点的「所有来源」，实测 224,219） | 同端点 + `source=community`（实测 160,838，**含 `enterprise`**） | 同端点 + `source=clawhub`（实测 63,381） |
| `search` | 同一端点 + `keyword=` | 同一端点 + `keyword=` | 同一端点 + `keyword=` |
| 游标形状 | `{page: number}`（1 起） | 同上（三档共用 `query.js` 的 `pageOf`） | 同上 |
| `detail` | `GET /api/v1/skills/<slug>?namespace=&version=` + 清单 + `SKILL.md`（**身份按行判定**，与 scope 无关；见 §7.9） | 同左（`namespace` = 行的 `namespace.handle`） | 同左，`namespace` 由一次 `keyword=<slug>` 的列表查询按 `slug`+`upstream_owner_login` 双匹配解析（**不猜前缀**；评分也用那一行补，见 §7.8） |
| `plan` / `fetchFile` | `GET …/files?namespace=&version=` + `GET …/file?path=`（302 → COS，见 §3.7.3 第 4 条） | 同左 | 同左（version 由镜像 detail 解析；清单无 `SKILL.md` ⇒ `E_PACKAGE_INVALID`） |
| `categories` | `GET /api/v1/categories`（不带 `source`），滤 `pay-skill`，10 分钟内存缓存 | 同一张表 | 同一张表（U8 起 `caps.categories = true`） |
| `caps` | `{search:true, paged:true, categories:true, package:'files'}` | 同左 | 同左 |
| `total` | `data.total`（实测 224,219） | `data.total`（实测 160,838） | `data.total`（实测 63,381） |
| 图标 | `iconUrl`：实测前 100 条约 **八成**有图（COS 的 `/skill-icons/uploads/…` 与 `cloudcache.tencent-cloud.com` 的 `other_external_resource/…` **两者都是该技能自己的图**），其余为空 ⇒ **绝对 `https:` 即接受，不做 host/path 白名单**；列表阶段直接带出 | **镜像列表行的 `iconUrl`（cloudcache 的绝对 `https:`，与 SkillHub 同一判据）**；`icons()` 只服务已安装行（§7.5） |
| 图标补齐 | 市场列表**自带** `iconUrl`；已安装行只有身份 ⇒ 走一次 detail 单查（§7.5） | 市场列表**自带** `iconUrl`；已安装行 ⇒ 每条一次 `keyword=<slug>` 列表查询（§7.5、§7.8） |
| 计数 | **每个 scope 各算各的**：13 次 `GET /api/skills?page=1&pageSize=1(&category=)[&source=]` 取 `data.total`（12 分类 + 1 个「全部」），并发 6、单项 6s、整体 10s、10 分钟缓存，**缓存 key = `sourceParam`（`all` 用空串）**；同一分类三档数字天然不同（`ai-agent` → 23,193 / 10,145 / 13,048），共用一份必有一处是假的。**每个 `count` 是该过滤条件的独立总数，不保证 12 类相加等于 `total`**（一条技能可归属多个分类），界面不得用「合计」校验它 | 同左，`source=community` | 同左，`source=clawhub` |
| 一次 `list` 的上游请求数 | 1 | 1 | 1 |
| 一次 `POST icons` 的上游请求数 | 每条一次 detail（**不带 `version`**，实测 0.26s）或一次列表查询，并发 6、6s 整批 | 同左（detail） | 同左（列表查询，行同时带图与标题） |
| 一次 `detail` 的上游请求数 | 3（详情 + 清单 + `SKILL.md`） | 3 | **4**（解析 namespace + 详情 + 清单 + `SKILL.md`） |
| 一次 `bootstrap?source=<scope>` 的上游请求数 | 冷缓存 **14**（分类表 1 + 计数 13），10 分钟内 0；**只算被问的那一档** | 同左 | 同左 |

sort 映射（`sort` 四个值，路由层已白名单化；**默认仍是 `recommended`**，即站点的 `score`）：

| `sort` | 三档共用一张表（`query.js` 的 `SORT_PARAMS` 一处定义） |
| --- | --- |
| `recommended`（默认，显示「默认排序」） | `sortBy=score&order=desc` |
| `updated` | `sortBy=updated_at&order=desc`（页内再按 `updatedAt` 降序） |
| `downloads`（显示「下载量」） | `sortBy=downloads&order=desc` |
| `stars`（显示「收藏量」） | `sortBy=stars&order=desc` |

**`paged` 的分裂不特殊处理**：clawhub 的 list 与 search **都能翻页**（镜像同一端点），统一由「本次 `next` 是否为 `null`」表达；客户端只问一句「还有 next 吗」，不读 `caps.paged`。

**三个 scope 都有分类表**（同一张：**12 类**——上游 `/api/v1/categories` 给 13 个 key，商业档 `pay-skill` 被 `HIDDEN_CATEGORIES` 滤掉；表本身不带 `source`），计数按 scope 各自算；`caps.categories` 恒 `true`，chips 行恒渲染（U8 之前 ClawHub 那一档没有类别，用户问的就是这句）。

**声明名为什么是硬约束**：安装目录名取包内 `SKILL.md` 的 `name`，而宿主的技能加载器用 `SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`（`EX/dsh-skill/lib/index.js`，与 `lib/names.js` 的 `isSkillName` 同一文法）判定一个目录能不能成为技能。声明 `Design` 的包即使被强行写进 `skills/`，宿主也不会加载它——所以 `422 E_SKILL_NAME_INVALID` 是**对齐宿主**，不是保守：改名或用 slug 顶替只会产出一个"看得见、永远不生效"的目录。

### 7.3 加第三个源要动哪几行

| # | 动什么 | 量级 |
| --- | --- | --- |
| 1 | 在 `lib/market/sources/` 下新增一个 `<id>.js`：**配置** `createMirrorAdapter(config)`（`id` / `source` / 归一化 / `resolve` / `facts` / `caps` / `counts`），不用重写 HTTP 那半 | 1 个文件，约 60–130 行 |
| 2 | `lib/market/sources/index.js` 的 `SOURCES` 数组加一项 | **1 行** |
| 3 | `locale/zh.json` 与 `locale/en.json` 各加一条 `market.source.<id>` | **1 键 × 2 文件** |
| 4 | （只在要加**筛选范围**时）`SCOPES` 加一项 + 一个文案键；`all` 这类跨身份的范围**永远不进 `SOURCES`**（它没有身份） | **1 行 + 1 键 × 2 文件** |
| 5 | 源的启停与排序（设置面）本轮不做，也不预留占位 UI | 0 |

页面骨架、卡片渲染、合并逻辑、安装流程、路由**一行都不用改**：来源筛选项由 `market/bootstrap` 返回的 `sources[]`（三个 scope）渲染，`caps.categories` 恒 `true`，包形态由 `caps.package` 决定（当前两源都是 `files`；`zip` 分支已于 U7 退役，`install.js` 只走清单那条路）。

### 7.4 归一化字段表与「缺 = null」不变式

`MarketItem`（`market/list` 与 `market/detail` 的渲染输入，也是去重键的来源）：

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `sourceId` | 本地算（**按行折叠**） | `community`/`enterprise` → `skillhub`，`clawhub` → `clawhub`，缺/不认识 ⇒ **丢条目**（`fromMirrorRow`）；它是 `marketKeyOf`、图标缓存、收藏与已安装 `_meta.source` 的键，**跨 scope 必须逐字相同**（§7.9） |
| `id` | 本地算 | `${sourceId}:${owner}:${slug}`，去重键与 React key（上游 id 两源不通用） |
| `owner` | 上游 | SkillHub `namespace.handle`（实测含下划线）／ClawHub **镜像行的 `upstream_owner_login`**（原生 handle；缺则剥 `clawhub_` 前缀，剥不出来整条丢弃，见 §7.8） |
| `slug` | 上游 | 两源的 `slug`；ClawHub 为空即**丢弃该条**（拼不出身份就装不上） |
| `displayName` | 上游 | `name`／`displayName`；缺则回落 `slug`，再缺为空串 |
| `iconUrl` | 上游 / 本地算 | 两种合法形态：① **绝对 `https:`**（可解析即接受，不做 host/path 白名单；`http:`、相对路径与非字符串归 `null`）；② `null`。`null` 与**加载失败**都是「回落首字母头像」，破图由浏览器侧 `onError` 兜住。`lucide:` 与 `/api/v1/skill-icons/<hash>` 两种形态随 `clawhub.ai` 于 U7 退场 |
| `summary` | 上游 | 折叠成一行、≤ 400 字符（超长截断） |
| `author` | 上游 | 三级回落：`publisher.name/displayName` → `namespace.displayName` → `owner` |
| `version` | 上游 | **缺失如实为 `null`**。ClawHub 卡片用列表行的 `version` 过 `versionLike()`（像 id 的串 ⇒ `null`）；**卡片 / 详情 / 安装三处都取镜像口径**，代价是可能滞后上游真最新（`decisions.md` 附录 N 的 N-10） |
| `downloads` | 上游 | SkillHub `downloads`／ClawHub **镜像 `downloads`**（口径见 §7.8 第 2 条）；缺失 `null` |
| `saves` | 上游 | SkillHub `stars`（小整数，实测 37 / 99 / 158）／ClawHub **镜像 `stars`**（同一列，不另立字段）。**卡片把它显示成「收藏」**——这是上游的收藏数，与本地书签（§7.7）不是一个东西；缺失 `null`，绝不补 `0`，上游真给 `0` 就显示 `0` |
| `score` | 上游 | SkillHub `score`（0–100000 连续分，实测 `95757.41562195931`）／ClawHub **镜像 `score`**（同口径）。**只作原料**：卡上的 4.0–5.0 是客户端 `ratingOf()` 的折算，Host 不解释、不格式化 |
| `tags` | 上游 | **`string[]`，≤ 3 条、单条 ≤ 24 字符**；两源都取 `subCategories[].name`（保留大小写，中文分类名照用）；不保证有 ⇒ **`[]`**（列表型字段的缺值是空数组，不是 `null`） |
| `updatedAt` | 上游 | epoch 毫秒，**只用于排序，不上屏** |
| `category` | 上游 | 两源都有：SkillHub 自带；ClawHub 来自镜像（详情端点没有，由适配器那次覆盖补上，见 §7.8） |
| `packageKind` | 本地算 | 来自 `caps.package`，决定详情页「文件」从哪来 |

`MarketDetail`（`market/detail` 的 `data`）：`item`（上表）、`overview`（`stripFrontmatter(SKILL.md)` 的正文，≤ 8000 字符；正文为空时回落 `summary`）、`declaredName`（`parseFrontmatter(SKILL.md).name`，不合规也原样给出）、`nameValid`（`isSkillName(declaredName)`）、`installTo`（`nameValid ? join(skillsRoot, declaredName) : skillsRoot`，由路由补，适配器不碰磁盘）、`files[{path, size}]`（按清单顺序，`sha256` 不下发）、`filesComplete`（`files` 形态恒 `true`；zip 读不全的 `false` 分支于 U7 随 zip 读取模块退役，客户端的既有分支保留不动）。

`SourcePage`（`list`/`search` 的返回）：`{items: MarketItem[], next: string|null, total: number|null}`。`next` 是 `encodeCursor()` 产出的不透明串，客户端原样回传。

**不变式（逐条可断言）**：

1. 上表每个字段都存在（不出现 `undefined`）；上游没给的一律 `null`，`downloads`、`saves`、`score` 绝不补 `0`、`version` 绝不补 `'latest'`、**`tags` 是 `[]`（列表型字段的缺值是空数组，不是 `null`）**。
2. `id` 全仓库唯一；同一 `id` 出现两次时保留第一次出现的那条。
3. `overview` 不含 frontmatter 分隔行（`---`）与 `name:` 之类的头字段。
4. `files` 里 `path` 一律通过 `isSafeRelativePath`；`path` 与 `size` 是详情页唯一需要的两项。
5. `updatedAt` 只影响排序：卡片、详情、事实表**都不显示任何时间**。

---

### 7.5 图标管道（两段式，列表永不等补齐）

图标分两段拿，**任何列表路径都不许等第二段**：

1. **随列表拿**：两个源的列表条目都自带 `iconUrl`（SkillHub 是 COS/cloudcache 的绝对 `https`，ClawHub 是镜像同样是绝对 `https`），直接用，零额外请求。
2. **已安装行按身份查**：已安装行手上只有 `_meta.json` 的身份（`Row.upstream`），没有市场列表载荷，所以 `POST /market/icons` 是它唯一的补图通道：SkillHub 每条一次 detail（`namespace=<owner>`，实测 0.26s），ClawHub 每条一次 `keyword=<slug>` 的列表查询（按 `slug` + `upstream_owner_login` 双匹配取那一行）。并发 6、整批 6s、单条 5s、正向 10min / 负向 60s 缓存，键 `<sourceId>:<owner>:<slug>`；失败只让该条 `null`，**绝不抛**。

**没有第三段**：U7 之后两张图标代理路由（`market/lucide` #10 与 `market/clawhub-icon` #12）与它们的上游 `clawhub.ai` 一起退场——镜像给的是可直连的绝对 `https`，`<img>` 能画，不需要本机转发。

### 7.7 收藏（本地书签）

**身份键与文件**：收藏键 = `MarketItem.id` = `marketId(source, owner, slug)`（与图标缓存、上游标题、安装台账同一个键）。落本插件自己的文件 `$DSH_HOME/dsh-skill-center/favorites.json`：`{version:1, favorites:[id…]}`，**最新在前**（将来「我的收藏」列表天然是收藏时间倒序）。数组而不是对象键，理由同 `provider-toggles.json`：id 里含 `:`，用它当对象键会把分隔符歧义写进文件格式。**不碰** `~/.dsh/skills-manager/state.json`、其他市场插件的 `skill-market/*`、`.skills-lock.json`（AGENTS.md 硬约束 10）。

**读侧只有一处**：`market/bootstrap` 的 `favorites` 与 `favoritesOk`。**不新增 GET**——收藏是全局集合，而 `bootstrap` 正是「全局一次」的那条，同一往返拿齐、首帧书签就对；新开一条只读端点，等于为「bootstrap 挂了还能读收藏」这一个代价多一份 `guard()` / 错误码 / 测试，却不减少任何一次往返。`bootstrap` 失败时书签态未知，由 #13 的权威回包自愈（点一下无论方向，响应里的 `favorites` 就是真值，且 `toggle` 幂等）。`bootstrap?refresh=1` **不清**收藏（收藏不是缓存）。

**两条同名不同源**：卡片上的「收藏 N」是上游 `stars`（别人收藏了多少），你自己的书签（**U5 起卡片上没有入口**，见 `docs/contracts/decisions.md` 附录 L；这份集合与写路由原样保留）。界面**不合并、不互相修正**，数字段的 `aria-label` 说清它是上游收藏数——否则「我收藏了它为什么显示 0」是一定的投诉。

**降级 / 上限 / 幂等 / 并发**：文件**缺失** ⇒ 空集 + `readable:true`（全新安装没写过这个文件，**缺失 ≠ 损坏**，`favoritesOk` 的唯一语义是「书签可能丢了」）；**只有**解析失败或不可读（非 JSON、顶层非对象、`favorites` 非数组、EACCES/EISDIR…）才 `readable:false`，此时 `bootstrap` 照常 `200`（`favoritesOk:false`），**绝不让市场页失败**；读侧逐条丢弃「不是 `sourceId:owner:slug` 三元组或超过 200 字符」的条目与重复项，手改坏了只丢坏行；上限 **500**，满时新增 `409 E_FAVORITE_FULL`，取消永远允许；与现状一致的写入不落盘（幂等）；写盘复用 `store.js` 的 `writeAtomic`（临时文件 + fsync + rename，临时名带 `favorites` 前缀），进程内一条 Promise 链把读-改-写串行化。跨进程并发不处理：与 `install.js` 一样按「本机单宿主」设计。路由细节见 `docs/contracts/routes.md` §3.7.6。

### 7.8 ClawHub 全部走 SkillHub 镜像（单源）

ClawHub 的**目录、详情、安装包**三条链路都由 SkillHub 的镜像接口提供（`api.skillhub.cn`），`clawhub.ai` 不再出现在任何代码路径上。两个源共用 `lib/market/sources/mirror.js` 的同一份实现，只差四个钩子：`source` 查询参数、列表行归一化、`namespace` 解析、图标事实来源（见附录 G）。

| 方法 | 端点（两源同形，ClawHub 多 `source=clawhub`） | 备注 |
| --- | --- | --- |
| `list` / `search` | `GET /api/skills?page&pageSize&sortBy&order&category&keyword[&source=]` | 同一端点带 `keyword` ⇒ 搜索也能翻页 |
| `detail` | `GET /api/v1/skills/<slug>?namespace=&version=` + `/files` + `/file?path=SKILL.md` | `SKILL.md` 的正文就是概览，与 SkillHub 同一条路 |
| `plan` / `fetchFile` | `GET /api/v1/skills/<slug>/files?namespace=&version=` + `/file?path=&namespace=&version=`（302 → COS） | `package: 'files'`，与 SkillHub 同一套安装链路 |

四条硬规矩（破一条就是事故或撒谎）：

1. **安装只认清单，四道闸都得在**：空清单 / 无 `SKILL.md` / 路径不安全（`..`、绝对路径、逃逸临时目录）/ 同一路径两次 ⇒ 一律 `E_PACKAGE_INVALID`（422），绝不许装出空壳目录。上游 `files` 不是数组属**上游违约**，报 `E_SOURCE_BAD_RESPONSE`（502）。`sha256` 为 `null` 时跳过校验（镜像目前不给）。
2. **`namespace` 不能猜**：认领过的 ClawHub namespace 没有 `clawhub_` 前缀（实测 `find-skills` 在 `indiv-guipi` 里）。`detail`/`plan` 先做**一次** `keyword=<slug>&pageSize=20&source=clawhub` 的列表查询，按 **`slug` 与 `upstream_owner_login` 同时相等**取第一条，读它的 `namespace.handle`；零命中报 `E_SOURCE_BAD_RESPONSE`（502）——**宁可不给详情，也不把别人的包装到自己名下**。
3. **`score` 只有列表有**：镜像 detail 的 `stats` 是 `{comments, downloads, installs, stars, versions}`。详情页的 `score` 用第 2 条那次查询的同一行补上（0 额外请求）；事实表不显示评分。
4. **`version` 三处同源**：卡片用列表行的版本、详情用 detail 的版本、安装用 `plan()` 解析的版本，全部来自镜像。代价是可能**滞后上游真最新**（`decisions.md` 附录 N 的 N-10）；一致性优先于新鲜度。

**U8 补上了这一半**：ClawHub 也有分类与计数——`bootstrap?source=<scope>` 只算被问的那一档（14 次请求，与今天同一价钱），缓存按 `sourceParam` 分开（§7.9 第 3 条）；切 scope 才补算，首屏成本零回归。

**本轮仍不做**：「不限 API Key」过滤（站点有，用户明确排除，也不预留占位 UI）。

### 7.9 三条轴：范围 / 身份 / 目录查询

筛选与请求里有三个**不同**的东西，混用就是错的：

| 轴 | 取值 | 出现在哪 | 谁决定 |
| --- | --- | --- | --- |
| **范围** scope | `all`（默认，= 站点「所有来源」）/ `skillhub` / `clawhub` | `market/list`、`market/bootstrap` 的 `?source=` | 用户的下拉选择 |
| **身份** `sourceId` | `skillhub` / `clawhub`（**两个，不含 `all`**） | `MarketItem.sourceId`、`marketKeyOf`、图标/收藏键、`market/detail`、`market/install` | **上游每一行的 `source` 字段**（按行折叠） |
| **目录查询** `sourceParam` | 不传 / `community` / `clawhub` | 只出现在上游 URL 里 | scope 映射 |

四条规矩：

1. **`all` 只属于范围轴**：它到不了 `detail`/`install`/`icons`（那三处的白名单只有两个身份 id，传 `all` 就是 `400 E_BAD_QUERY`）。
2. **身份按行折叠、只在一处**：`community`/`enterprise` → `skillhub`，`clawhub` → `clawhub`（`normalize.js` 的 `fromMirrorRow`）。折叠写两处 = 键空间漂移 = 装过的技能显示成未安装。
3. **计数按 scope 算、缓存按 `sourceParam` 存**（`all` 用空串）：三个 scope 的同一个分类计数天然不同（`ai-agent` → 23,193 / 10,145 / 13,048），共用一份必然有一处是假数字。
4. **任何让结果集合变化的输入（scope / category / sort / keyword）都必须清 `cursor` 与 `items`**：游标只有页码，不带筛选签名；跨筛选复用属于客户端 bug。

## 附录 F 市场视觉刻度

市场样式全部落在 `src/client/styles.js` 的 `skc_market*` 类里，取值逐字取自宿主插件市场的 `DiscoverSection` 规则体（宿主类名是构建哈希，只作证据，不进选择器）；**三处例外**（搜索框容器 / 搜索框 / 框内清除按钮）取自 `dsh-market` 的 `SearchInput`，每行都标了理由。市场**不新增任何颜色字面量**。

| 类 | 取值（逐字） | 取自宿主哪条 |
| --- | --- | --- |
| `.skc_marketSection` | `flex-direction:column; gap:16px; display:flex` | `.section` |
| `.skc_marketToolbar` | `flex-wrap:wrap; align-items:center; gap:8px; display:flex` | `.toolbar` |
| `.skc_marketSearchField` | `min-width:120px; flex:1; align-items:center; display:flex; position:relative` | **新刻度**：`dsh-market` 的 `SearchInput`（非宿主），理由：× 在框外会挤动工具栏（真机实测框短 44px、按钮落在 1052–1088 即框外） |
| `.skc_marketSearch` | `padding-right:32px; box-sizing:border-box; width:100%; min-width:0` | **新刻度**：`dsh-market` 的 `SearchInput`（非宿主）——给框内的 × 让位，`border-box` 保证 32px 不撑破 100% 宽 |
| `.skc_marketClear` | `display:flex; position:absolute; top:50%; right:5px; transform:translateY(-50%); align-items:center; justify-content:center; width:24px; height:24px; padding:0; border:0; border-radius:var(--dsw-radius-sm); background:0 0; cursor:pointer; color:var(--dsw-alias-label-secondary); font:inherit`；hover `label-primary` + `interactive-bg-hover`；`:focus-visible` 用 `--dsw-focus-ring-width` | **新刻度**：`dsh-market` 的 `SearchInput`（非宿主）；不改颜色字面量，全部走令牌 |
| `.skc_marketSearch input::-webkit-search-cancel-button` | `-webkit-appearance:none; appearance:none; display:none` | **新刻度**：`type=search` 的原生取消按钮会在有词时与自绘的清空按钮并排出现，只留后者（见 `docs/contracts/decisions.md` 附录 K） |
| `.skc_marketSelect` / `Label` | `max-width:240px; font-weight:500` / `text-overflow:ellipsis; white-space:nowrap; overflow:hidden` | `.marketButton` / `.marketName`：宿主的 `margin-left:-8px` 不抄到这一层（全抄会把搜索框边框与第一个菜单贴成 0、有词时清空按钮也贴上去），负边距改由下一行只落一次；两个菜单同带此类 |
| `.skc_marketSelectTrailing` | `margin-left:-8px` | `.marketButton` 的同一条负边距，**只给排序菜单**：ghost 按钮不画盒子，两个菜单之间的空隙会被读成 `gap 8 + 排序菜单自己的 10px 内边距 = 18px`，正好是搜索框那一段（它画边框，读作 8px）的两倍；详见 `docs/contracts/decisions.md` 附录 K K-4 |
| `.skc_marketChips` | `flex-wrap:wrap; align-items:center; gap:6px; display:flex` | `.categories` |
| `.skc_marketScope` | `color:var(--dsw-alias-label-tertiary); margin:0; font-size:13px; line-height:20px` | `.muted` |
| `.skc_marketMore` | `align-self:center` | **新刻度**：列表页脚（「没有更多了」与「加载失败，点此重试」两处 `<p>`），取自面板里那两处的既有实现——U10 之前一直没登记 |
| `.skc_marketLoadMore` | `align-items:center; justify-content:center; gap:6px; padding-top:8px; display:flex; color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:18px` | **新刻度**：列表底部的「正在加载更多」一行（圆点 + 文案）。U10 之前它是工具栏的第 4 个子元素，出现时把搜索框挤窄 21px（13px 圆点 + 8px gap）——真机量到空态 739px、无圆点 760px |
| `.skc_marketNotice` | `border-radius:var(--dsw-radius-md); background:var(--dsw-alias-state-warn-tertiary); align-items:flex-start; gap:8px; margin:0; padding:10px 12px; font-size:12px; line-height:18px; display:flex` | `.notice` |
| `.skc_marketGrid` | `display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:12px; margin:0; padding:0; list-style:none` | **新刻度** |
| `.skc_marketCard` | `border-radius:var(--dsw-radius-xl); align-items:stretch; gap:14px; padding:14px; display:flex; flex-direction:column; position:relative; min-width:0` + hover `background:var(--dsw-alias-interactive-bg-hover)` | `.card`（**无边框**）；column 下必须 `stretch`——`flex-start` 会让骨架条形段与描述收缩包裹 |
| `.skc_marketMain` / `TitleRow` | `flex-direction:column; flex:1; gap:2px; min-width:0; display:flex` / `flex-wrap:nowrap; align-items:center; gap:8px; min-width:0; align-self:flex-start; max-width:100%; display:flex` | `.main` / `.titleRow`。`align-self:flex-start` 让标题行按**内容宽**排版（不被 column 父级拉满），所以来源品牌图紧跟标题、只隔一个 8px 的 `gap`；`max-width:100%` 把长标题关在卡片内。**`flex-wrap:nowrap` 不可省**：换行容器按 flex base size 先分行、收缩只在同一行内生效，长标题会先把品牌图挤到第二行（实测两张卡：行高 20 → 44px）而不是自己省略；这一行只有「标题 + 品牌图」两个子项，永远不需要换行 |
| `.skc_marketCardOpen` | `max-width:100%; color:inherit; font:inherit; text-align:left; cursor:pointer; text-overflow:ellipsis; white-space:nowrap; background:0 0; border:0; padding:0; flex:0 1 auto; min-width:0; font-size:14px; font-weight:500; line-height:20px; overflow:hidden` | `.cardOpen`。`flex:0 1 auto` = **grow 0 / shrink 1**：标题只占自己的内容宽（品牌图因此紧跟），长标题靠 `shrink:1` + `min-width:0` 缩成省略号，绝不把品牌图或安装位挤到第二行（`flex:1` 会把品牌图推到文本块最右端，与草图不符） |
| `.skc_marketCardOpen::after` | `content:""; border-radius:var(--dsw-radius-xl); position:absolute; inset:0` | `.cardOpen:after`（整卡可点的唯一手段） |
| `.skc_marketCardOpen:focus-visible` | `outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset:2px` | `.cardOpen:focus-visible` |
| `.skc_marketDesc` | `color:var(--dsw-alias-label-tertiary); -webkit-line-clamp:2; -webkit-box-orient:vertical; display:-webkit-box; overflow:hidden; font-size:13px; line-height:18px` | `.description` |
| `.skc_marketMeta` / `FileSize` | `color:var(--dsw-alias-label-tertiary); margin:0; text-overflow:ellipsis; white-space:nowrap; overflow:hidden; font-size:12px; line-height:18px` | `.meta`。作者行**单行省略**：`@owner/slug` 可到 129 字符，允许换行会让头部从 48px 长到 66px、卡片高度随 owner 长度抖动 |
| `.skc_marketCardEnd` | `z-index:1; flex:none; align-items:center; gap:8px; display:inline-flex; position:relative` | `.cardEnd`（`z-index:1` 让安装按钮浮在点击层之上，**不可省**；U5 起它坐在**头部右侧**，原来的 `align-self:flex-end` 随底行一起作废） |
| `.skc_marketEmpty` / `EmptyTitle` | `text-align:center; flex-direction:column; align-items:center; gap:8px; padding:64px 0; display:flex` / `margin:8px 0 0; font-size:14px; font-weight:500; line-height:20px` | `.empty` / `.emptyTitle` |
| `.skc_marketError` / `Failure` / `More` | `color:var(--dsw-alias-state-error-primary); align-items:center; gap:6px; margin:0; font-size:13px; line-height:20px; display:inline-flex` / `align-items:center; gap:10px; display:flex` / `align-self:center` | `.error` / `.failure` / `.more` |
| `.skc_marketDetail` / `Crumb` / `CrumbIcon` | `flex-direction:column; gap:16px; display:flex` / `color:var(--dsw-alias-label-tertiary); font:inherit; cursor:pointer; background:0 0; border:0; align-self:flex-start; align-items:center; gap:6px; padding:0; font-size:12.5px; display:inline-flex` / `transform:rotate(90deg)` | `.detail` / `.crumb` / `.crumbIcon` |
| `.skc_marketDetailHead` / `DetailTitle` / `DetailDesc` | `align-items:center; gap:14px; display:flex` / `margin:0; font-size:20px; font-weight:500; line-height:28px` / `color:var(--dsw-alias-label-secondary); overflow-wrap:anywhere; margin:0; font-size:14px; line-height:22px` | `.detailHead` / `.detailTitle` / `.detailDescription` |
| `.skc_marketDetailSection` / `SectionTitle` | `flex-direction:column; gap:12px; margin-top:16px; display:flex` / `margin:0; font-size:14px; font-weight:500; line-height:20px` | `.detailSection` / `.sectionTitle` |
| `.skc_marketFacts` | `div`：`border-bottom:.5px solid var(--dsw-alias-border-l2); justify-content:space-between; align-items:center; gap:16px; min-height:44px; padding:8px 2px; display:flex`；`dt`：`color:var(--dsw-alias-label-secondary); flex:none; font-size:13px; line-height:20px`；`dd`：`text-align:end; overflow-wrap:anywhere; min-width:0; margin:0; font-size:13px; line-height:20px`；`code`：`background:var(--dsw-alias-bg-module-platform); font-family:var(--ds-font-family-code); border-radius:4px; padding:2px 6px; font-size:12px` | `.facts` |
| `.skc_marketFiles` | `li`：`border-bottom:.5px solid var(--dsw-alias-border-l2); justify-content:space-between; align-items:center; gap:16px; min-height:32px; padding:6px 2px; display:flex; font-size:13px; line-height:20px` | **新刻度**（行配方取自 `.facts div`，行高与内边距压密） |
| `.skc_marketFileName` | `overflow-wrap:anywhere; min-width:0; font-family:var(--ds-font-family-code); font-size:12px; line-height:18px` | `.facts code` 的字体族 |
| `.skc_marketDialog` / `ConfirmBody` / `ConfirmHead` | `width:min(480px, 100vw - 32px)` / `flex-direction:column; gap:12px; display:flex` / `align-items:center; gap:14px; display:flex` | `.dialog` / `.dialogBody` / `.confirmHead` |
| `.skc_marketSkeletonChip` | `border-radius:var(--dsw-radius-lg); width:64px; height:26px` | 分类 chips 占位（对齐 `Button size="sm"` 的静态尺寸） |
| `.skc_marketSkeletonAction` | `border-radius:var(--dsw-radius-md); width:64px; height:24px` | 安装按钮占位（同上） |
| `.skc_marketToastHint` | `color:var(--dsw-alias-label-secondary); overflow-wrap:anywhere; margin-top:2px; font-size:12px; line-height:18px; display:block` | 安装 toast 的副行（安装路径），12/18 secondary |
| `.skc_marketStats` / `.skc_marketStat` / `StatValue` | **顺序是 评分 · 下载 · 收藏**（`MARKET_STAT_SLOTS`；三格轨道与 `tabular-nums` 与顺序无关，对齐照旧）`grid-template-columns:repeat(3, minmax(0, 72px)); gap:8px; justify-content:start; margin:0; color:var(--dsw-alias-label-tertiary); font-variant-numeric:tabular-nums; font-size:12px; line-height:18px; display:grid` / `align-items:center; gap:3px; min-width:0; white-space:nowrap; text-overflow:ellipsis; overflow:hidden; display:inline-flex`（`> svg` 13×13、`opacity:.75`）/ `min-width:0; overflow:hidden; text-overflow:ellipsis` | **新刻度** ⑦（见下） |
| `.skc_marketSourceMark` | `border-radius:var(--dsw-radius-sm); width:16px; height:16px; flex:none; display:block` | **新刻度** ⑧（见下） |
| `.skc_marketHead` | `align-items:center; gap:12px; min-width:0; display:flex` | **新刻度** ③（就地改写，见下：安装位坐在头部右侧；`nowrap` 是 flex 默认） |
| `.skc_marketBody` | `flex-direction:column; gap:6px; min-width:0; display:flex` | **新刻度** ⑪（描述/标签/三段共用 6px 节奏；头部到正文的 14px 由卡片自身的 `gap` 给） |
| `.skc_marketSkeletonStat` | `border-radius:var(--dsw-radius-xs); width:56px; height:12px`；底色复用既有 `.skc_skeletonFill` | **新刻度** ⑩（见下） |
| `.skc_marketTags` / `Tag` | `flex-wrap:wrap; gap:6px; min-width:0; margin:0; padding:0; display:flex; list-style:none` / `border:.5px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-sm); color:var(--dsw-alias-label-tertiary); max-width:100%; padding:1px 6px; font-size:11px; line-height:16px; white-space:nowrap; text-overflow:ellipsis; overflow:hidden` | **新刻度** ⑫（19px 描边 chip；与 `.skc_roTag` 同档字号、不同材质） |
| `.skc_marketSkeletonTag` | `border-radius:var(--dsw-radius-sm); width:48px; height:19px`；底色复用既有 `.skc_skeletonFill` | **新刻度** ⑬（与真件同盒 48×19） |

**新刻度共十二条在用**（编号只增不复用；**⑨ 已退役**——U5 按用户决定撤掉了卡片上的收藏按钮，见 `docs/contracts/decisions.md` 附录 L）：① 网格 `minmax(280px, 1fr)` + `gap:12px`（960px 内容宽正好 3 列、<600px 一行 1 列）；② 卡片竖向排布、`padding` 8 → 14、`align-items:stretch`（column 下 `flex-start` 会让骨架条形段与描述收缩包裹）；**③ 头部行 `.skc_marketHead`**（`align-items:center; gap:12px`，`nowrap` 是 flex 默认——安装四态文案变宽只让标题收缩成省略号，动作位永不换行；原「动作靠右下」随底行作废）；④ 骨架占位 `SkeletonChip` 64×26；⑤ 骨架占位 `SkeletonAction` 64×24（④⑤ 都对齐 `Button size="sm"`，骨架与真件同宽同高）；⑥ 安装 toast 副行 `ToastHint` 12/18 secondary（与元信息行同刻度）；⑦ 三段 `marketStats`：三格轨道恒为 `repeat(3, minmax(0,72px))`、左对齐、`tabular-nums`、**槽位顺序 评分·下载·收藏**，缺值的格留空——**三格固定宽度是三段在任何两张卡上落到同一 x 的唯一办法**，`tabular-nums` 让 `1` 与 `8` 同宽；⑧`.skc_marketSourceMark` 16×16 品牌位图 + `radius-sm`（与标题 14/20 同一视觉重量，再大就抢标题）；⑩`.skc_marketSkeletonStat` 56×12 + `radius-xs`（与真件三段同节奏）；**⑪** `.skc_marketBody` 6px 节奏；**⑫** `.skc_marketTags`/`Tag` 19px 描边 chip（`border-l2` 令牌，零色值；单条 `max-width:100%` + 省略，长 topic 撑不宽卡片）；**⑬** `.skc_marketSkeletonTag` 48×19（与真件同盒）。骨架/副行/图形/标签类只在市场页出现，**不碰已安装页签的任何既有类**；`.skc_marketDesc` 由 1 行改 2 行是**改值**（见上表那一行），不算新刻度。

三条不可协商的纪律：

1. 市场**不新增任何颜色字面量**：色值只来自 `--dsw-*` 令牌与 `avatar.js` 的 12 组粉彩。
2. 全仓库**仍然只有 `styles.js` 与 `avatar.js` 两处**有颜色字面量（`test/styles.test.mjs` 会查）；两枚来源品牌图形是**位图**（`src/client/market-marks.jsx` 的两段 `data:image/png;base64`），其颜色是品牌自带的像素、不是可写的样式值——不得据此在样式表里补任何色值。
3. 市场卡片**复用**既有 `.skc_cardIcon`（48×48、`border-box`、`radius-lg`、`background-clip:padding-box`），一条声明都不改——改它会让「已安装」页签 11 行同时回归。

卡片**无描边**：描边只出现在头像框上；卡面靠 `radius-xl` + hover 底色表达可点性（依据见 `docs/contracts/decisions.md` 附录 E）。

**头像位的两种内容**：`iconUrl !== null` 时头像盒里渲染 `<img src={iconUrl}>`——占满盒子（`width:100%; height:100%`）、`object-fit:contain`（图标常带透明边或非正方形，`cover` 会裁掉形状）、圆角 `calc(var(--dsw-radius-lg) - .5px)` 即落在 0.5px 描边**内侧**（与既有 `background-clip:padding-box` 是同一套几何，改错会在描边处露出 1px 白边）；`iconUrl === null` 与**图片加载失败**（`onError`，按 URL 记录、不重试）都回落 `avatar.js` 的首字母头像。两种内容共用同一个 48×48 盒子，切换**不改变**行高、节距与网格列宽——「有图标」只是换盒内内容，不新增容器。两个源的 `iconUrl` 都是上游的绝对 `https` 图片，走同一个 `<img>`；`lucide:` 与 `/skill-icons/…` 两种旧形态随 `clawhub.ai` 与两条代理路由于 U7 退场，图标不再需要本机转发或额外着色逻辑。

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
| `lib/market/sources/skillhub.js` | SkillHub 的**配置**：身份（owner 即 namespace）、SkillHub 行归一化、图标事实（一次 detail）、`caps`、`counts: true`；另有 `resetSkillhubIconCache` / `resetCategoryCache` / `resetCountCache` 三个转发 |
| `lib/market/sources/clawhub.js` | ClawHub 的**配置**：身份（`upstream_owner_login`）、镜像行归一化、`namespace` 解析（`keyword=<slug>` 双匹配）、图标事实（同一次查询）、`caps`；HTTP 那半在 `mirror.js` |
| `lib/market/sources/mirror.js` | 市场面唯一的 HTTP 实现：`createMirrorAdapter(config)`（列表 / 详情 / 清单 / 单文件 / 分类 / 计数 / 图标缓存），只连 `api.skillhub.cn`；两个适配器都是它的配置 |
| `lib/market/install.js` | 安装编排：解析名字 → 冲突检测 → 临时目录 → 逐文件校验写入 → 原子 rename → 台账 → 失败清理（唯一 `rm -rf` 处） |
| `lib/market/store.js` | 自有台账 `$DSH_HOME/dsh-skill-center/installed.json` 的读/写（临时文件 + fsync + rename；损坏降级为空；形状与 `lib/ledger.js` 的 `own-record` 兼容）；`writeAtomic(file, text, tempPrefix)` 供收藏复用 |
| `lib/market/favorites.js` | 自有收藏集合 `$DSH_HOME/dsh-skill-center/favorites.json` 的读/写（复用 `store.js` 的 `writeAtomic`；进程内串行化；损坏降级为空；上限 500；幂等不写盘） |

Client 半部（`src/client/`，纯逻辑模块 node 可直接 import）：

| 文件 | 职责 |
| --- | --- |
| `src/client/market-model.js` | **纯函数**：`marketKeyOf` / `mergeBatches` / `metaSegments` / `visibleCategories` / `chipList` / `installViewOf` / `emptyKindOf` / `detailFacts` / `reasonKeyOf` |
| `src/client/market-panel.jsx` | `MarketPanel`：工具栏 / 分类 chips / 网格 / 尾部（骨架 / 重试 / 没有更多了）/ 整页态 / 详情切换 / 确认弹窗 / 触底预取 |
| `src/client/market-filters.jsx` | 搜索框（250ms 防抖 + 回车立即 + 清空复位）、来源选择、排序选择、分类 chips、分类作用域说明 |
| `src/client/market-card.jsx` | 一张卡：头像（复用 `avatar.js`）+ 标题按钮（`skc_marketCardOpen` 铺满整卡）+ 来源品牌图 + 收藏按钮 + 作者行 + 描述（2 行）+ 三段等宽数字 + 安装动作位 |
| `src/client/market-detail.jsx` | 内嵌详情：面包屑返回 + 头（头像/标题/版本 Tag/动作）+ 事实表 + 概览 + 文件清单 + 三种失败态 |
| `src/client/market-skeleton.jsx` | 首屏 6 张卡骨架 + 分类 chips 占位；尾部 3 张骨架 |
| `src/client/market-confirm.jsx` | 安装确认（primitives `Modal` + 头像 + 名称 + 版本 + 事实表 + 第三方提示） |
| `src/client/market-marks.jsx` | 两枚来源品牌位图（data URI 常量）+ 三段字形 + 书签字形；无 hook、无状态 |

三句不变量：

1. **不新增依赖**：`node:https` / `node:zlib` / `node:crypto` / `node:fs/promises` 全是内置；`dependencies` 恒空。
2. **客户端不新增 require**：仍只用平台 seed 的 `react` / `react/jsx-runtime` / primitives，`inject` 仍是 `['slots','locale']`。
3. **不新增座位**：安装成功的 toast 复用既有 `shell.overlay`，市场页仍是 `main` 槽里的同一个全局页。

---

## 验收

市场面的验收不另建表（避免两份口径）：用例编号 K28–K51 与 K75–K81 与 PRD 的 A1–A17 对照登记在 `docs/contracts/acceptance.md` 的附录 D.5；路由与安装链路的契约面见 `docs/contracts/routes.md` §3.7 与 §8.6。
