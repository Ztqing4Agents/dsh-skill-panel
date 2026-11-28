# 市场路由与错误码

> 类型：规范
> 读者：加改市场路由、安装阶段或市场错误码的人
> 真源：`lib/routes.js`（市场九条）、`lib/market/**`（安装链路与源适配器）与 `test/market-routes.test.mjs` / `test/market-install.test.mjs`
> 更新触发：改市场九条路由、安装阶段、参数白名单或 §8.6 错误码时，同步改本文件的 §3.7 与 §8.6
> 规模上限：400

本文件是市场面的路由契约：9 条 `/api/dsh-skill-panel/market/*` 路由（§3.7.1 的表 + §3.7.2–§3.7.7 的细则，含安装链路十四阶段）与它们的错误码全集（§8.6）。本地面 7 条路由、写盘实现与 §8.1 的统一信封见 `docs/contracts/routes.md` §3.3 / §3.4；两处编号在全仓库唯一，拆分前后未重排。

## 3.7 市场路由清单

市场面 9 条 **exact** 路由，前缀 `/api/dsh-skill-panel/market/*`。它们与 #1–#4、#14 **共用同一个 `guard()`**（loopback 围栏 → 方法），共用 `writeJson` 的 `{code,data,message}` 信封与 `no-store`，但**不共用 `collect()`**：本地扫描是磁盘面，市场是网络面，混在一起会让「市场超时」连累「已安装」页签。访问策略也不在此处另立：九条与其余七条一起逐条声明 `auth`，取值、理由与两道闸只有一处真源——`docs/contracts/routes.md` §3.3.5。

#### 3.7.1 九条路由

| # | 方法 + 路径 | 入参 | 出参 `data` | 错误码（全量） |
| --- | --- | --- | --- | --- |
| 5 | `GET /api/dsh-skill-panel/market/bootstrap` | `source`（可选，`all`（缺省）/`skillhub`/`clawhub`——只算这一档的计数）；`?refresh=1` 绕过分类表与计数的缓存，仅调试 | `{source, sources:[{id,labelKey,hasCategories,packageKind}], categories:[{key,name,nameEn,count:number\|null}], categoriesOk:boolean, categoriesStale:boolean, total:number\|null, countsOk:boolean, favorites:string[], favoritesOk:boolean}`；`sources` 是**三个 scope**（`all` 排第一），`source` 回显这三个数字属于哪一档 | `403 E_FORBIDDEN`、`405 E_METHOD`、`400 E_BAD_QUERY`、`500 E_INTERNAL`。分类表失败**不报错**：`categoriesOk:false` + 空数组；计数失败**也不报错**：那一项 `count:null`、`countsOk:false`（`total:null`），两者都不影响列表；`categoriesStale:true` 表示缓存兜底 |
| 6 | `GET /api/dsh-skill-panel/market/list` | `source`（可选，**scope**：缺省 = `all`，取值 `all`/`skillhub`/`clawhub`；`all` 与缺省都不给上游传 `source`，`skillhub`→`community`，`clawhub`→`clawhub`）、`sort=recommended\|updated\|downloads\|stars`、`category`、`keyword`（≤ 64 字符）、`limit=1..24`（默认 12）、`cursor`（该 scope 自己的不透明游标） | `{source, sort, keyword, category, items:[MarketItem], next:string\|null, total:number\|null}` | `403`、`405`、`400 E_BAD_QUERY`、`502 E_SOURCE_BAD_RESPONSE`、`503 E_SOURCE_UNAVAILABLE`、`504 E_SOURCE_TIMEOUT`、`500 E_INTERNAL` |
| 7 | `GET /api/dsh-skill-panel/market/detail` | `source`（必填）、`owner`、`slug`（必填）、`version`（可选） | `MarketDetail`（§3.8.1） | 同 #6 |
| 8 | `GET /api/dsh-skill-panel/market/installed` | 无 | `{items:{[id]:{name,version,path,skillFile,exists:boolean}}, readable:boolean}`——`path` 是目录、`skillFile` 是其中的 `SKILL.md`（客户端拿它去 #16，不自己拼） | `403`、`405`、`500 E_INTERNAL` |
| 9 | `POST /api/dsh-skill-panel/market/install` | `{source, owner, slug, version?}`（`objectOnly`，≤ 64 KiB；**没有 path / files / name 字段**） | `{name, path, version, source, owner, slug, files:number, bytes:number}` | `403`、`405`、`400 E_BAD_REQUEST`、`400 E_BAD_QUERY`、`409 E_ALREADY_INSTALLED`、`422 E_SKILL_NAME_INVALID`、`422 E_PACKAGE_INVALID`、`429 E_INSTALL_BUSY`、`502 E_DOWNLOAD_FAILED`、`502 E_SOURCE_BAD_RESPONSE`、`503 E_SOURCE_UNAVAILABLE`、`504 E_SOURCE_TIMEOUT`、`500 E_INSTALL_IO`、`500 E_INTERNAL` |
| 11 | `POST /api/dsh-skill-panel/market/icons` | body `{items:[{source?, owner, slug}], source?}`：`items` ≤ **24**，每条 `source`/`owner`/`slug` 走 §3.7.3 的上游白名单；`source` 逐条给，顶层 `source` 只是**兼容默认值**（item 优先，详见 §3.7.5） | `{icons:{'<source>:<owner>:<slug>': iconUrl\|null}, names:{同键→上游标题\|null}}`——两图的**键集合与顺序逐键相同**，缺名也是「键在、值 `null`」 | `403 E_FORBIDDEN`、`405 E_METHOD`、`400 E_BAD_REQUEST`（`items` 缺失/为空/超 24）、`400 E_BAD_QUERY`（标识符不合白名单，或 `source` 未注册）、`500 E_INTERNAL`。单条失败只让该项 `null`，**单源失败只让该源 `null`**，整体仍 `200` |
| 13 | `POST /api/dsh-skill-panel/market/favorite` | `{source, owner, slug, favorited:boolean}`（`objectOnly`，≤ 64 KiB；**没有 id / path / version 生效位**） | `{favorites:string[], favorited:boolean}`（权威全量列表，最新在前；`favorited` 是实际生效的状态） | `403 E_FORBIDDEN`、`405 E_METHOD`、`400 E_BAD_REQUEST`（body 非对象 / `favorited` 非布尔）、`400 E_BAD_QUERY`（身份不合白名单或源未注册）、`409 E_FAVORITE_FULL`、`500 E_FAVORITE_IO`、`500 E_INTERNAL` |
| 15 | `GET /api/dsh-skill-panel/market/versions` | `source`（**必填**，身份 id：`skillhub`/`clawhub`；`all` ⇒ `400`）、`owner`、`slug`（必填，§3.7.3 白名单；`version` 不参与，传了忽略） | `MarketVersions`（§3.8.1）：`{source, owner, slug, namespace, latest:string\|null, versions:[{version, publishedAt:number\|null}], total:number}`——`versions` 新的在前（**上游顺序，不重排**）、保留前 **50** 条，`total` 是上游返回的原始条数；`changelog`/`versionId`/`securityReports` **不下发** | `403 E_FORBIDDEN`、`405 E_METHOD`、`400 E_BAD_QUERY`（源未知 / 传 `all` / `owner`/`slug` 不合规）、`502 E_SOURCE_BAD_RESPONSE`（`versions` 不是数组）、`503 E_SOURCE_UNAVAILABLE`、`504 E_SOURCE_TIMEOUT`、`500 E_INTERNAL` |
| 16 | `POST /api/dsh-skill-panel/market/update` | `{source, owner, slug, version, name, path}`（`objectOnly`，≤ 64 KiB；`parseUpdateBody`：前四个走 §3.7.3 白名单，`name` 过 `isSkillName`，`path` 过 `isAbsoluteSkillFile`；**没有 files / 目标目录 / 新名字**字段） | `{name, path, version, from, source, owner, slug, files, bytes}`——`from` 是更新前的版本（旧 `_meta.json` 读不到为 `null`），`files`/`bytes` 口径与 #9 逐字相同 | `403`、`405`、`400 E_BAD_REQUEST`、`400 E_BAD_QUERY`、`404 E_NOT_FOUND`、`409 E_STALE_PATH`、`409 E_SYMLINK_READONLY`、`409 E_NOT_WRITABLE`、`409 E_NOT_MARKET_INSTALLED`、`409 E_ALREADY_UP_TO_DATE`、`422 E_SKILL_NAME_INVALID`、`422 E_PACKAGE_INVALID`、`429 E_INSTALL_BUSY`、`502 E_DOWNLOAD_FAILED`、`502 E_SOURCE_BAD_RESPONSE`、`503 E_SOURCE_UNAVAILABLE`、`504 E_SOURCE_TIMEOUT`、`500 E_UPDATE_RESTORED`、`500 E_UPDATE_LOST`、`500 E_UPDATE_UNCONFIRMED`、`500 E_INSTALL_IO`、`500 E_INTERNAL`（前置校验顺序与三个「动过磁盘之后」的新码见 §3.7.7） |

**表里的 `#` 是历史编号，不重排也不复用**：`#10 market/lucide` 与 `#12 market/clawhub-icon` 已随 `clawhub.ai` 退场（`decisions.md` 附录 N 的 N-11），所以编号在 9 与 11、11 与 13 之间各有一个空位。**现在没有任何非信封路由**：图标是上游绝对 `https`，由浏览器 `<img>` 直连，`onError` 退回首字母头像。 #13 的 body 里**没有 id / path**：收藏键由 Host 用 `marketId(source, owner, slug)` 重拼（同 `normalize.js`、同 #9），所以一个请求无法指认不属于任何源的键，多余字段（如 `version`）一律忽略。install 的请求体只有 4 个短字符串，64 KiB 只是「有人乱发」的护栏而不是功能需要（上限声明见 §3.3）。

install 出参里两个数字的口径**不一样，别混**：`files` 是**落盘后去重后的路径数**（包内文件 + 我们补写的 `_meta.json`；包内自带 `_meta.json` 时它的原文另存为 `_meta.upstream.json`，因此只多算这一个，**不会**把被覆盖的那份再算一次）；`bytes` 是**包内文件字节合计**（不含我们补写的元数据，也不含 `_meta.upstream.json` 的副本）。

#### 3.7.2 `market/list` 的语义细则

1. **`source` 是可缺省的 scope，不是身份 id。** 取值 `all`（缺省）/`skillhub`/`clawhub`；`all` 与缺省都不给上游传 `source`（站点「所有来源」就是这个意思，224,219 条已混排），`skillhub` 传 `community`、`clawhub` 传 `clawhub`。**`all` 只在 `list`/`bootstrap` 合法**：`detail`/`install`/`icons` 的白名单只有两个身份 id，传 `all` ⇒ `400 E_BAD_QUERY`。三者共用 `{page}` 游标，一次请求一页。
2. `limit` 是**这一页**条数（默认 12）。`1..24` 之外**夹取不报错**；非数字才是 `400 E_BAD_QUERY`。
3. `cursor` 是该 scope 自己的不透明游标：不传 = 第一页；传了但解码失败（或不是本插件签发的形状）→ `400 E_BAD_QUERY`，不是 500。客户端只负责原样回传，**不解析、不拼接**；**scope / category / sort / keyword 任一变化都必须清游标**（游标只有页码，不带筛选签名）。
4. 关键词非空**自动走 `source.search`**，为空走 `source.list`；`keyword` 与 `category` 可同时给。5. 上游失败**用 HTTP 状态码表达**（502/503/504 + `E_*`），不塞进 200 的响应体：一次请求就是一个 scope 的一页，失败即整页失败（可重试）。6. `total` 三个 scope 都给（`data.total`），是**该 scope 的**总数，`all` 是两源之和，末页判定沿用 `page*limit >= total`；**服务端不合并、不交错、不排序跨源项**（返回的就是「这一档的一页」，混排顺序由上游给；追加与去重在 `src/client/market-model.js` 的 `mergeBatches`，见 §3.8.2）。

超时、并发与互斥：

| 项 | 值 | 落点 |
| --- | --- | --- |
| 列表 / 搜索 / 详情 | 单源 **10s**（连接 5s + 总 10s） | `upstream.getJson({timeoutMs})` |
| 分类表 | 6s，失败静默降级 | `skillhub.categories()` |
| 分类计数 | 单项 **6s**、整体 **10s** 预算、并发 **6**、10 分钟缓存；任一项失败只让该 `count:null`（`countsOk:false`），不影响 bootstrap 的 200 | `skillhub.counts()` |
| 批量图标 · SkillHub（#11） | 每条一次 detail（**不带 `version`**，实测 0.26s）、并发 **6**、整批 **6s**、单条 **5s**；正向 10 分钟 / 负向 60 秒，键 `skillhub:<owner>:<slug>` | `skillhub.icons()` |
| 批量图标 · ClawHub（#11） | 每条一次 `GET /api/skills?keyword=<slug>&pageSize=20&source=clawhub`（列表行同时带图与标题）、并发 **6**、整批 **6s**（与 SkillHub **各自计时、互不挤占**）、单条 **5s**；正向 10 分钟 / 负向 60 秒，键 `clawhub:<owner>:<slug>` | `clawhub.icons()` |
| 批量图标 · 清缓存 | `bootstrap?refresh=1` 同时清两源的图标缓存。**列表与搜索从不等图标** | `resetIconCache()` |
| 安装整包 | **120s** 总预算（每次取文件前检查 deadline） | `install.js` |
| 安装单文件 | 30s | `upstream.getBytes({timeoutMs})` |
| 上游并发 | 全局 6、单 origin 3（`upstream.js` 的两道计数闸） | 一次扇出 = 每源 1 个 |
| 安装单文件并发 | 4 | `install.js` 的 `mapLimit` |
| 安装互斥 | 同一 `source:owner:slug` 同时只允许一个；全局同时最多 2 个 → 否则 `429 E_INSTALL_BUSY` | `install.js` 的进程内 `Set` |
| socket 复用 | `Agent({keepAlive:true, maxSockets:8})` | `upstream.js` |

不做令牌桶：本插件只服务本机单用户；限流做多了会让「刷新」在弱网下自己怼自己。

#### 3.7.3 参数白名单与 URL 拼接的注入防护

```js
const SOURCE_ID = /^[a-z][a-z0-9-]{0,31}$/;
const OWNER     = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;   // 实测 handle 含下划线：user_90d58900
const SLUG      = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const VERSION   = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/;
const CATEGORY  = /^[a-z0-9][a-z0-9-]{0,63}$/;
const KEYWORD   = /^[\p{L}\p{N}\p{Zs}\p{P}]{0,64}$/u;    // 只做长度与字符类护栏
const SORTS     = new Set(['recommended', 'updated', 'downloads']);
```

七条硬规则（每条都对应一次真会发生的失败）：

1. `owner` / `slug` / `version` 过正则后**还必须检查不含 `..` 子串**（`a..b` 能过字符类，不能过这一条）。2. URL 一律 `new URL(path, ORIGIN)` + `url.searchParams.set(...)`；**禁止字符串拼接**（`?path=${p}` 会被 `&`/`#`/`%` 打断）。
3. 拼完断言 `url.origin === ORIGIN`（钉死成 `https://api.skillhub.cn` / `https://clawhub.ai`），不成立即 `E_INTERNAL`（编程错误，不是用户错误）。
4. 302 一律**手动处理**：`location` 必须 `https:` 且 host 命中 `^[a-z0-9-]+\.cos\.accelerate\.myqcloud\.com$`，否则 `422 E_PACKAGE_INVALID`；**最多跟 1 跳**。
5. **客户端不传文件路径**：install 的 body 只有 `{source,owner,slug,version}`；清单由 Host 自己取，清单里每个 `path` 再过 `isSafeRelativePath()`（`lib/names.js`：无前导 `/`、无 `\`、无 `:`、无 `..` 段、段长 ≤ 100、整体 ≤ 240），不在清单里的路径永不请求。
6. 上游响应先过形状断言（`Array.isArray(data?.skills)` 等），形状不对 → `502 E_SOURCE_BAD_RESPONSE`：上游改字段时给出可区分的错误，而不是把 `undefined` 灌进 UI。
7. 日志只记 `{route, source, code}`，**永不**记响应正文，也不记 `keyword` 之外的请求细节。

#### 3.7.4 安装链路十四阶段与失败码

| 阶段 | 动作 | 失败 → 错误码 |
| --- | --- | --- |
| I0 入参 | `source/owner/slug/version` 过 §3.7.3 白名单；`source` 必须在注册表 | `400 E_BAD_QUERY` |
| I1 互斥 | 先按 `source:owner:slug` 加锁（进程内 `Set`），全局在跑的超 2 个即拒 | `429 E_INSTALL_BUSY` |
| I2 解析 | `plan()`：拿版本 + 包形态 + 文件清单；包里自带 `_meta.json` 的版本与请求版本不符即拒 | `502/503/504` 透传 / `422 E_PACKAGE_INVALID` |
| I3 清单 | 两源同一套：`GET …/files` 取清单（只有 `files` 一种包形态，没有 zip 读取链路） | `502 E_DOWNLOAD_FAILED` / `422 E_PACKAGE_INVALID`（空清单） |
| I4 取 `SKILL.md` | 只下这一个文件，按清单比 `size` 与 `sha256`（镜像的 `sha256` 为 `null` 时只比 `size`） | `502 E_DOWNLOAD_FAILED`（网络）/ `422 E_PACKAGE_INVALID`（校验不符、清单没列 `SKILL.md`） |
| I5 名字 | `parseFrontmatter(text).name` → `trim()` → `isSkillName()` | `422 E_SKILL_NAME_INVALID`（`data.declaredName` 带原文；**不改名、不用 slug 顶替**。判名文法就是宿主加载器的 `SKILL_NAME`，不合规的目录宿主也不会加载，理由见 `docs/contracts/market.md` §7.2） |
| I6 冲突 | `lstat(skillsRoot/<name>)`：**存在即拒绝**（目录/文件/软链一视同仁）；台账有记录但目录不存在 → 允许 | `409 E_ALREADY_INSTALLED`（`data.path` + `data.existing{name,version}`；version 取自目标目录的 `_meta.json`，读不到为 `null`） |
| I7 临时目录 | `mkdir(skillsRoot/.skc-install-<pid>-<rand6>, 0o755)`（点开头 → `scan.js` 跳过） | `500 E_INSTALL_IO` |
| I8 写其余文件 | 4 路并发，逐文件：`isSafeRelativePath` → 父目录 `mkdir -p` → `open(path,'wx')` → 写 → `fsync` → 逐文件比 `sha256`/CRC 与 `size` | `422 E_PACKAGE_INVALID`（不符/重名条目）/ `500 E_INSTALL_IO` |
| I9 来源元数据 | 写 `_meta.json`：`{source, ownerId, slug, version, name, installedAt}`；包里自带 `_meta.json` 时保留其字段并补 `source`，原文另存 `_meta.upstream.json` | `500 E_INSTALL_IO` |
| I10 fsync | 目录 fsync（best-effort，同 `lib/write-skill.js` 的做法） | —— |
| I11 原子落位 | `mkdir(skillsRoot/<name>)` **占位 claim**（`EEXIST` → 409）→ `rename(tmp, target)` → `fsync(skillsRoot)` | `409 E_ALREADY_INSTALLED` / `500 E_INSTALL_IO`（rename 失败会删掉 claim 空目录） |
| I12 回读 | 读 `<name>/SKILL.md` 重新 `parseFrontmatter` 断言 `name` 一致；读 `_meta.json` 断言 `source` 存在且等于来源 id | `500 E_INSTALL_IO`（此时把刚落位的目录删掉，保证「要么全有、要么全无」） |
| I13 台账 | `store.append({source,owner,slug,name,version,installedAt,files,bytes})`（临时文件 + fsync + rename；同名只保留一条） | `500 E_INSTALL_IO`（**目录不回滚**：见下） |

§3.7.4 的阶段编号是 **`I0–I13`**（install），与 `docs/contracts/routes.md` §3.3.4 本地守卫的 `S0–S12` 不是同一套——两套编号同名不同义，不因为它们现在分居两个文件就可以混着读。顺序上有一处刻意的排列：**回读（I12）在写台账（I13）之前**。这样任何失败都停在「无目录、无台账」，而写台账失败是唯一允许「目录在、台账不在」的窗口（后果只是卡片显示未安装，下次安装会被同名检查拦下，不产生坏数据）。

「不留半成品」的可执行判据：

```
ok    ⇔ ∃ skillsRoot/<name>/SKILL.md
        ∧ ∃ skillsRoot/<name>/_meta.json 且 parsed.source 是字符串
        ∧ ledger.installs 里有 {source,owner,slug,name,version}
        ∧ ∄ skillsRoot/.skc-install-*

fail(k) ⇔ ∄ skillsRoot/<name>
        ∧ ∄ skillsRoot/.skc-install-*              // 临时目录必删
        ∧ 台账与安装前逐字节相同                     // 台账不写
        ∧ readdir(skillsRoot) 的条目集合 === 安装前集合
```

三条实现约束保证上式成立：`install.js` 只有一个 `try/finally`（`finally` 里删临时目录，失败路径不得绕过它）；落位之前磁盘上唯一的痕迹是点开头目录（扫描层跳过，已安装页签看不到半成品）；台账写失败时保留已落位的目录并返回 `500 E_INSTALL_IO`，`message` 说明「技能已落位、台账未写」。

`_meta.json` 的形状必须**同时**满足两处读取器（最容易写错的地方）：

```jsonc
{ "source": "skillhub", "ownerId": "ake", "slug": "dev-god",   // source 走 lib/scan.js 的 metaSource（R6）；ownerId + slug 皆非空才认 metaRelease（R7）
  "version": "1.2.4", "name": "dev-god", "installedAt": "2026-11-09T06:00:00.000Z" }   // name 与目录名一致、回读时断言；installedAt 是 ISO 8601 UTC，不上屏
```

自有台账 `$DSH_HOME/dsh-skill-panel/installed.json` 的形状是 `{version:1, installs:[{source,owner,slug,name,version,installedAt,files,bytes}]}`：`installs[].name` 正是 `lib/ledger.js` 的 `own-record` 读取器要找的字段（`installs[].files` / `bytes` 与 install 出参同口径）。因此装完的技能必然命中 R5，`lib/classify.js` 一行不改。 包内容的安全边界（逐条，`files` 形态下没有压缩包要解）：清单非空且含 `SKILL.md`；路径过 `isSafeRelativePath` 且落在临时目录内（`isWithin`）；同一路径两次 ⇒ 拒绝整包；逐文件比 `size`（清单给了 `sha256` 再比摘要）；**永不执行**包内任何文件；只写清单里列出的 `path`；落位前磁盘上唯一的痕迹是点开头的临时目录（目录 0755、文件 0644）。

#### 3.7.5 `market/icons` 的双源分发

一条端点覆盖两个源：已安装行只有身份、没有市场列表载荷，而两源查图标的方式差一次请求（SkillHub 的 owner 就是 namespace，一次 detail；ClawHub 先按 `keyword=<slug>` 找那一行，见 `docs/contracts/market.md` §7.8 第 2 条）。`MarketSource.icons?(refs, io, {now})` 是**可选能力**（今天两源都有）：有它的源按自己的并发/预算/缓存实现，没有它的源整批条目 `null`（不进错误分支）。

- **分发与出参**：路由按 `source` 分组、**各组并行**（两源各 6s ⇒ 混合批次 ≈ `max(两源耗时)`，不是相加）；`data` 是 `{icons, names}` 两张同键图，`names[key]` 是**上游标题**（SkillHub 的 `data.skill.displayName`、ClawHub 列表行的 `name`），与图标同一条请求带出、**零额外请求**，归一规则一致（非空字符串才收，否则 `null`），**键序列由同一个循环产出、逐键相同**（缺名是 `null` 不是缺键）。
- **回填与失败隔离**：各源结果先收进一张 `Map`，再按 `items` **原序**写入两张图（并发完成顺序不影响出参顺序，两次相同请求逐字节可比）；一个源整体失败只让**该源**的条目 `null`（图标与标题一起），另一个源照常、`200` 不变——**任何图标失败都不升级成路由错误**（标题缺失只是显示 slug）。- **`source` 优先级与额度**：每条的 `source` 优先、缺省用顶层 `source`（**兼容默认值**，旧页面握旧 `client.js` 只会发 `{source:'clawhub', items:[{owner,slug}]}`，保留它等于「永不为此 400」），两者都缺 ⇒ `400 E_BAD_QUERY`；**每源每批 12 是客户端的选批口径**，服务端只认合计 ≤ 24（24 条的旧批次依然被接受）；`market/installed`（#7）不返回图标、也不为图标加请求。

#### 3.7.6 `market/favorite` 的幂等与上限

1. **幂等**：`favorited` 与现状一致 ⇒ 不写盘、直接回当前列表；取消一个不存在的 id 也算成功——页面状态猜错时再点一次即可自愈，且不产生无意义的 mtime 变化。**上限 500**：满时新增 ⇒ `409 E_FAVORITE_FULL`，取消永远允许（上限只拦增长，不拦减少）。2. **进程内串行化**：两个并发 POST 在 `lib/market/favorites.js` 里被一条 Promise 链排队，读-改-写整体排他，不会互相覆盖。跨进程并发不处理（与 `install.js` 同一档次的本机单宿主假设，见 `docs/contracts/market.md` §7.7）。
3. **响应永远是权威全量** `favorites[]`（最新在前）：客户端整份替换，不做增量合并。4. **写失败** ⇒ `500 E_FAVORITE_IO`，`message` 带系统错误摘要；日志只记 `{route, code}`，**永不**记 owner / slug。**没有 UI 入口**：卡片上的收藏按钮已按用户决定撤除（`docs/contracts/decisions.md` 附录 L），本路由与 `bootstrap` 的 `favorites` / `favoritesOk` 原样保留（接回入口时零 Host 改动，当前不排期；决策见 `docs/contracts/decisions.md` L-5）；K76 仍守着它。

#### 3.7.7 `market/update` 的覆盖安装契约

- **前置校验（路由层，顺序不许换）**：P0 `parseUpdateBody` 白名单 → P1 按 `name` **重新扫描**定位行（`404 E_NOT_FOUND`）→ P2 软链 `409 E_SYMLINK_READONLY` → P3 `row.path !== path` `409 E_STALE_PATH`（客户端这个 `path` 取自 #8 的 `skillFile`：台账行给的是目录，`SKILL.md` 这一层由 Host 拼、由浏览器原样回传——硬约束 6 的「先认路径再写」，客户端不拼字符串） → P4 越界 `409 E_NOT_WRITABLE` → P5 `_meta.json` 的 `source`/`ownerId`/`slug` 与请求**逐字相等**，否则 `409 E_NOT_MARKET_INSTALLED`（这一码有自己的文案与下一步：去「已安装」页卸载后重装，见 §8.6） → P6 `row.version === version` `409 E_ALREADY_UP_TO_DATE`（只比相等，不排序）→ P7 与 `install` **共用同一张锁表**与 `MAX_CONCURRENT_INSTALLS`（`429 E_INSTALL_BUSY`）。
- **落盘十个阶段（U1–U10）、四条回滚路径与三条不变式见 `docs/contracts/market.md` §7.11**：实现在 `lib/market/install.js` 的 `update(ref, target)`，复用安装的暂存/元数据/回读/台账内部件。
- **三个新码只描述「动过磁盘之后」的结局**：`E_UPDATE_RESTORED`（回滚成功，旧版本逐字节完整）/ `E_UPDATE_LOST`（目录已不在，旧版本留在 `.skc-backup-*`）/ `E_UPDATE_UNCONFIRMED`（新版本已落位回读通过，台账未写）。动手之前失败一律走 `E_INSTALL_IO` 与上游码——不许拿 `E_INSTALL_IO` 糊「已回滚」这种结论。

## 8.6 市场错误码

市场面 9 条路由的 `E_*` 全集。HTTP status 与 `code` 双写，规则同 §8.1；`message` 仍是给开发者看的英文短句，界面文案由客户端按 `code` 取 i18n 键。#11 用 `E_BAD_REQUEST` 表示「形状不对」，用 `E_BAD_QUERY` 表示「这个源没有图标可补」。

| code | HTTP | 含义 | 前端表现 |
| --- | --- | --- | --- |
| `E_BAD_QUERY` | 400 | 参数不过白名单（源未知、`sort`/`limit`/`cursor` 非法、`owner/slug/version` 不合规） | **有自己的文案** `error.E_BAD_QUERY`（#17/#18 与 #16 共用这一句）；下一步是刷新页面再看这张卡，正常不可达（参数源自 bootstrap 与已校验的条目） |
| `E_BAD_REQUEST` | 400 | install 的 body 非法 / 超 64 KiB / 不是对象 | 行内原因 |
| `E_SOURCE_UNKNOWN` | 400 | 来源不再在注册表里 | 客户端兜底文案（列表与详情实际用 `E_BAD_QUERY` 表达同一个事实，见 §3.7.2 第 1 条） |
| `E_SOURCE_UNAVAILABLE` | 503 | 上游连不上 / 5xx / 限流 | 该源失败：部分源提示条；两源都失败才整页错误态 |
| `E_SOURCE_TIMEOUT` | 504 | 连接或总超时（10s / 6s / 30s / 安装 120s 预算） | 同上 |
| `E_SOURCE_BAD_RESPONSE` | 502 | 上游响应不是 JSON，或形状不符（字段改名、缺数组） | 同上（与超时分开，便于排查上游改动） |
| `E_DOWNLOAD_FAILED` | 502 | 安装取包时网络失败（单文件下载阶段把 503/502 归一成这一条） | 卡片行内原因 + 「重试」 |
| `E_PACKAGE_INVALID` | 422 | 包不合规：清单为空 / 没有 `SKILL.md` / 路径不安全（`..`、绝对路径、逃逸临时目录、同一路径两次）/ `size` 或 `sha256` 不符 / 版本不符 | 行内原因 + 「重试」 |
| `E_SKILL_NAME_INVALID` | 422 | 包内 `SKILL.md` 声明的 `name` 不合 `^[a-z0-9]+(?:-[a-z0-9]+)*$` | 行内原因，回显 `data.declaredName`；**不改名、不用 slug 顶替** |
| `E_ALREADY_INSTALLED` | 409 | 目标目录已存在（手装、别的工具装、本面板装过都算） | 行内原因 + `data.path`；**无覆盖入口** |
| `E_INSTALL_BUSY` | 429 | 同一目标正在安装，或全局安装数已满 | 行内原因，提示稍候 |
| `E_INSTALL_IO` | 500 | 落盘失败（权限、磁盘、rename、台账写失败、回读不一致） | 行内原因 + 「重试」 |
| `E_FAVORITE_FULL` | 409 | 收藏已达上限（500 条），且这次是新增 | toast 说明上限，按钮回滚到点击前的状态 |
| `E_FAVORITE_IO` | 500 | 收藏写盘失败（权限、磁盘、rename） | toast 说明写盘失败（带原因），按钮回滚 |
| `E_NOT_MARKET_INSTALLED` | 409 | 目标行不是市场装：`_meta.json` 的 `source`/`ownerId`/`slug` 与请求不逐字相等，或这一行没有可写路径 | **有自己的文案** `error.E_NOT_MARKET_INSTALLED`（用户真会遇到：本机这份不是市场装的、或来源元数据被改过——下一步是去「已安装」页卸载后重装）；行内原因，不落兜底句 |
| `E_ALREADY_UP_TO_DATE` | 409 | 请求的目标版本与本地版本**逐字相等**（没有可做的事；只比相等、不排序） | 不作错误提示：客户端把卡面直接落回「已是最新版本」 |
| `E_UPDATE_RESTORED` | 500 | 更新在交换或落位回读阶段失败、**已回滚**（旧版本逐字节完整，`data` 带 `from`） | 卡面回「可更新到 {to}」+ 行内原因「更新失败，已恢复到 {from}」；可再点更新（幂等） |
| `E_UPDATE_LOST` | 500 | 更新失败且回滚也失败：目录已不在，旧版本留在 `.skc-backup-*`（`data` 带 `from`） | 详情转 `E_NOT_FOUND` 态 + 「更新失败，技能未安装」+ 触发重扫 |
| `E_UPDATE_UNCONFIRMED` | 500 | 新版本已落位并回读通过，但台账未写（`data` 带 `from`/`to`；目录**不回滚**） | 「无法确认更新结果，请刷新查看」+ 卡面转「无法检查更新」+ 触发重扫 |
| `E_INTERNAL` | 500 | 未预期异常（已 `logger.warn`） | 整页错误态 + 重试 |

**唯一的信封例外**：市场路由失败时 `data` 可以携带一个小对象（`{path?, existing?, declaredName?, name?, source?, owner?, slug?}`），因为界面要显示「已装在哪」「包声明的是什么名字」。**#13 的失败不带 `data`**：它的界面只有一句 toast，不需要回传任何东西。其余路由的失败信封 `data` 恒 `null`（§8.1）。客户端可以忽略 `data`，只按 `code` 分支也不会错。

## 验收

- 九条路由的围栏、查询白名单、信封与 `market/favorite` 的幂等：`test/market-routes.test.mjs`（K35 / K36 / K76 / K77）。
- 安装链路十四阶段与「不留半成品」的不变式：`test/market-install.test.mjs`（K34 / K123 / K124）。
- 上游超时与字节上限、镜像单源三链路：`test/market-upstream.test.mjs`（K43）、`test/market-clawhub-mirror.test.mjs`（K88 / K90–K92）。
- 契约自洽（两张表合计十六条、§8.6 二十个码、§3.7 头注条数）：`test/market-gates.test.mjs`（K115 / K125）；错误码表与 `MARKET_STATUS` 逐条对表：`test/market-errors.test.mjs`（K30）。
- 用例编号与分层见 `docs/contracts/acceptance.md` 附录 D.5 / D.6。
