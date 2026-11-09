# 路由、写盘与错误码

> 类型：规范
> 读者：加改路由、错误码、请求围栏或写盘实现的人
> 真源：`lib/routes.js`、`lib/write-skill.js`、`lib/loopback.js`、`lib/http.js` 与 `test/routes.test.mjs`
> 更新触发：改路由表、错误码、body 上限或写盘步骤时，同步改 §3.3 / §3.4 / §8.1
> 规模上限：400

编号 §3.3 / §3.4 / §8.1 保持原值（原件见 `git show a8141eb:docs/system_design.md`）。证据记号定义见 `docs/reference/host-plugin-page.md` §1。

---

## 3.3 Host 路由清单

九条 **exact** 路由（`kind:'exact'`，`ctx.webServer.register(route)` 返回 disposer；重复注册同路径会抛错，见 `EX/dsh-host-webserver/README.md`「Registering routes」）。本地面 4 条（下表 #1–#4），市场面 5 条见 §3.7。

统一信封（§8.1）：成功 `200 {code:'OK', data, message:''}`；失败 `4xx/5xx {code:'E_…', data:null, message}`。

| # | 方法 + 路径 | 入参 | 出参 `data` | 错误码 |
| --- | --- | --- | --- | --- |
| 1 | `GET /api/dsh-skill-center/list` | 无（可选 `?cwd=`，仅用于项目级计数） | `ListPayload`（§3.3.1） | `403 E_FORBIDDEN`、`405 E_METHOD`、`500 E_INTERNAL` |
| 2 | `POST /api/dsh-skill-center/toggle` | `{name, path, enabled}` | `{name, enabled, modelInvocable, path}` | `403`、`405`、`400 E_BAD_REQUEST`、`400 E_BAD_NAME`、`400 E_BAD_PATH`、`404 E_NOT_FOUND`、`409 E_STALE_PATH`、`409 E_SYMLINK_READONLY`、`409 E_FILE_CHANGED`、`409 E_NOT_WRITABLE`、`500 E_WRITE_FAILED`、`500 E_VERIFY_FAILED` |
| 3 | `POST /api/dsh-skill-center/provider-toggle` | `{provider, name, enabled}` | `{provider, name, disabled}` | `403`、`405`、`400`、`400 E_BAD_NAME`、`404 E_NOT_FOUND`（该 (provider,name) 不再是内置行）、`500 E_WRITE_FAILED` |
| 4 | `GET /api/dsh-skill-center/health` | 无 | `{ok, version, dshHome, skillsRoot, counts, ledger:{sources:string[]}, providerToggles:{readable:bool, disabled:int}, complete:bool}` | `403`、`405`、`500` |

body 上限 **64 KiB**（`readBoundedJson(req, 65536)`；超过即 `400`，不 drain）。

#### 3.3.1 `ListPayload`（客户端唯一渲染输入）

```jsonc
{
  "groups": [
    { "key": "builtin",   "skills": [ Row… ] },
    { "key": "local",     "skills": [ Row… ] },
    { "key": "installed", "skills": [ Row… ] }
  ],
  "counts": { "total": 3, "disabled": 1, "excluded": 0 },
  "complete": true,          // 注册表快照是否完整（false ⇒ 仍返回已收集项）
  "diagnostics": [],         // 如 ['ledger-unreadable:dsh-skill-market']
  "cwd": "/Users/…/Plugins"
}
```

`Row`：

```jsonc
{
  "name": "dev-docs-standards",     // 显示名（frontmatter name）
  "description": "开发者文档体系规范…",
  "displayName": "…",               // 仅当 frontmatter 有；P0 只进 title
  "provider": "filesystem",
  "partition": "local",
  "rule": "R4",                     // 便于 QA/P1 tooltip
  "confidence": "high",
  "symlink": false,
  "path": "/Users/…/.dsh/skills/dev-docs-standards/SKILL.md",  // 软链为 null（不可写）
  "realPath": null,                 // 仅软链行给值：realpath(entry)/SKILL.md，用于 tooltip 显示指向
  "enabled": true,                  // = !disable-model-invocation
  "writable": true,                 // false ⇒ 客户端不渲染开关
  "readonlyReason": null            // 'symlink' | 'provider-store' | 'no-file'
}
```

不变式：`writable === false ⇔ readonlyReason !== null`；`partition === 'builtin'` ⇒ `readonlyReason ∈ {'provider-store','no-file'}` 且 `symlink === false`；`symlink === true` ⇒ `path === null && realPath !== null && writable === false && readonlyReason === 'symlink'`；`symlink === false` ⇒ `realPath === null`。

> 软链的 **realpath 解析**发生在扫描层（`lib/scan.js` 对每个条目先 `lstat` 判软链，再 `realpathSync(entry)` 得到真实目录，取 `<realDir>/SKILL.md`）。它只用于**显示**（`row.symlinkTitle` 的 `{path}` 占位），不参与任何写入决策 —— 写入路径根本不存在，见 3.3.2 ②。

#### 3.3.2 `toggle` 的路径身份校验（逐条，不许含糊）

```js
// 伪代码（≤10 行）
const row = (await mergeCatalog(freshScan())).find(r => r.name === name)   // ① 按 name 重新解析
if (!row) return fail(res, 404, 'E_NOT_FOUND')
if (row.symlink) return fail(res, 409, 'E_SYMLINK_READONLY')              // ② 软链永不写（队长决策 2）
if (row.path === null) return fail(res, 409, 'E_NOT_WRITABLE')
if (row.path !== path) return fail(res, 409, 'E_STALE_PATH')              // ③ 同名但换路径 ⇒ 拒绝回退
if (!isWithin(skillsRoot, row.path)) return fail(res, 409, 'E_NOT_WRITABLE') // ④ 纵深防御
```

- **比较用严格字符串相等**（不做 `realpath`、不做大小写折叠）：客户端回传的就是我们刚发出的绝对路径；软链已在 ② 被拒，因此不存在「同一个文件两条路径」的歧义。
- ①②③ 的顺序不可换：先确认「这条还在」，再拒软链，最后比对路径，任何一步先返回都能给出可区分的错误码（前端文案不同）。
- 每次 `toggle` 都**重新扫描**（不查内存缓存）：这是「磁盘是唯一真源」的落地方式，也让「面板打开后有人手改了文件」变成 409 而不是静默改错文件。

---

## 3.4 开关写入实现

本节是「开关改写一张已有的 `SKILL.md`」；市场侧的落盘（新装一个技能目录）是另一条路径，见 §3.7.4。

#### 3.4.1 三类行，两条写入路径（队长决策 2 之后的最终语义）

| 分区 | 写入位置 | 生效 | 失败表现 |
| --- | --- | --- | --- |
| 内置（provider 提供，`rule=R1`） | `$DSH_HOME/dsh-skill-center/provider-toggles.json` | 本面板即读即生效（下一次 `list` 带上停用集）；**注册表不感知**，README/文档必须如实说明「模型是否仍收到取决于 provider，本面板只做面板内视图」 | 开关回弹 + 行内 `.skc_reason` |
| 本地 / 已安装（真目录，`rule=R4..R9`） | 就地改写 `SKILL.md` 的 `disable-model-invocation` | `dsh-skill-filesystem` 的 `watch: true` 热刷新（`EX/dsh-skill-filesystem/README.md`「Change detection」） | 同上，且写前指纹、写后回读 |
| **软链（`symlink === true`）** | **不写**（队长决策 2） | —— | 前端不渲染开关；路由返回 `409 E_SYMLINK_READONLY` |

> **PRD §3.4 的「软链写入 realpath + 首次确认」条款已由队长修订作废**：本插件不修改任何软链指向的文件，也不引入任何确认弹窗。Q4（首次写入确认）随之关闭。

#### 3.4.2 逐字节保真改写（`lib/frontmatter.js`）

只在内存里做字节手术，不做 YAML 重新序列化：

```js
// 伪代码（≤10 行）
const bom = bytes.subarray(0,3).equals(BOM) ? bytes.subarray(0,3) : empty
const body = bom.length ? bytes.subarray(3) : bytes
const block = matchFrontmatterBlock(body)            // 开头 '---'+EOL … '---'，返回 [start,end) 与 lines（含各自行尾）
const eol = block.eol                                 // 由开头分隔行决定：'\r\n' | '\n'
const hit = block.lines.findIndex(l => /^disable-model-invocation[ \t]*:/.test(l.text))
if (hit >= 0) block.lines[hit] = replaceValuePreserving(block.lines[hit], enabled ? 'false' : 'true')
else block.lines.push({ text: `disable-model-invocation: ${enabled ? 'false' : 'true'}`, eol })
return concat(bom, block, body.subarray(block.end))   // 其余字节一个不动
```

- **启用路径写 `false`，不删键**：双向切换幂等（`PRD` §3.4 允许「删除或写 false」，这里取「写 false」——删键会让 `git diff` 在 enable/disable 之间反复增删行，且删掉了作者原本的写入意图）。此为对 PRD 的实现选择，非偏离。
- 目标键已存在且带行尾注释（`disable-model-invocation: true  # 临时关闭`）时，**保留注释**，只换值（正则 `^(\s*disable-model-invocation\s*:\s*)([^\s#]+)(.*)$`）。
- 真实约束：本机 `indiv-guipi--find-skills/SKILL.md` 是 CRLF，现成实现（`PROF/@linxin666/dsh-client-ui-skill-explorer/lib/index.js` 的 `setFrontmatterField`）会把整块换成 LF —— 因此我们不用它，且 QA 必须有一条 CRLF fixture（§6 A3）。

#### 3.4.3 原子落盘 + 指纹 + 回读（`lib/write-skill.js`）

| 步 | 动作 | 失败处理 |
| --- | --- | --- |
| 1 | `lstat(entryDir)`：软链直接 `E_SYMLINK_READONLY`（双保险，路由已拦） | 返回 409 |
| 2 | `open(file)` → `fstat` → 记录 `{size, mtimeMs, ino, dev}` 指纹 → 读完整个文件 | 读失败 → `E_WRITE_FAILED` |
| 3 | 计算 `next`；`changed === false` 则**不写**，直接返回成功（幂等） | —— |
| 4 | 同目录写 `<SKILL.md>.<pid>.<rand>.tmp`（`flag:'wx'`），`fsync`，`close`；`chmod` 成原文件 mode | 失败 → 删 tmp → `E_WRITE_FAILED` |
| 5 | 重取指纹，与第 2 步不等 → 删 tmp → `409 E_FILE_CHANGED`（有人在面板打开期间改了文件） | 已处理 |
| 6 | `rename(tmp, file)`；`fsync` 目录（best-effort） | 失败 → 删 tmp → `E_WRITE_FAILED` |
| 7 | 回读文件与 `next` **逐字节比较**；不一致 → 把原字节写回（再走一次 4–6，仍失败则 `E_VERIFY_FAILED` 并报告「文件可能处于中间状态」） | `E_VERIFY_FAILED` |
| 8 | 用 `parseFrontmatter(回读内容)` 断言 `disableModelInvocation === 目标值` | 同上回滚 |

`rename` 会换 inode：不改 mode 时新文件默认 0666&~umask，因此第 4 步的 `chmod` 是必需的（否则用户 `SKILL.md` 的 0600 会被放大）。

#### 3.4.4 `provider-toggles.json` 格式与降级（`lib/provider-toggles.js`）

```jsonc
{ "version": 1, "disabled": [ { "provider": "runtime", "name": "office" } ] }
```

- **身份**是 `provider#name`（`PRD` §3.4 所说的「键」），磁盘上存成数组而非对象键：name 有文法约束但 provider id 无，用 `#` 拼接作对象键会引入分隔符注入；数组形态也是 `PROF/@linxin666/dsh-client-ui-skill-explorer/lib/types/provider-toggles.d.ts` 的已验证形状。
- 归一化：`name` 必须过 `isSkillName`；`provider` 限 64 字符的可打印 ASCII；`provider` 缺失归一成 `''`。
- 降级（`PRD` A5）：文件缺失 / 非法 JSON / 顶层不是对象 / `version !== 1` / `disabled` 不是数组 / 单条不合规格 / 文件 > 64 KiB ⇒ 视为 **`{version:1, disabled:[]}`（全部启用）**，并在 `diagnostics` 里留一条，**绝不让 list 失败**。
- 写：临时文件 + `fsync` + `rename`；双向幂等（停用两次只留一条；启用不存在的记录则不写盘）。
- 只读别人的存储（`PRD` §3.4 通用规则 5）：`~/.dsh/skills-manager/state.json`、`$DSH_HOME/skill-market/*`、`.skills-lock.json` **只读不写**。

---

## 3.7 市场路由清单

市场面 5 条 **exact** 路由，前缀 `/api/dsh-skill-center/market/*`。它们与 #1–#4 **共用同一个 `guard()`**（loopback 围栏 → 方法），共用 `writeJson` 的 `{code,data,message}` 信封与 `no-store`，但**不共用 `collect()`**：本地扫描是磁盘面，市场是网络面，混在一起会让「市场超时」连累「已安装」页签。

#### 3.7.1 五条路由

| # | 方法 + 路径 | 入参 | 出参 `data` | 错误码（全量） |
| --- | --- | --- | --- | --- |
| 5 | `GET /api/dsh-skill-center/market/bootstrap` | 无（`?refresh=1` 绕过分类缓存，仅调试） | `{sources:[{id,labelKey,hasCategories,packageKind}], categories:[{key,name,nameEn}], categoriesOk:boolean, categoriesStale:boolean}` | `403 E_FORBIDDEN`、`405 E_METHOD`、`500 E_INTERNAL`。分类失败**不报错**：`categoriesOk:false` + 空数组，列表照常可用；`categoriesStale:true` 表示缓存兜底 |
| 6 | `GET /api/dsh-skill-center/market/list` | `source`（必填，单个源）、`sort=recommended\|updated\|downloads`、`category`、`keyword`（≤ 64 字符）、`limit=1..24`（默认 12）、`cursor`（该源自己的不透明游标） | `{sourceId, sort, keyword, category, items:[MarketItem], next:string\|null, total:number\|null}` | `403`、`405`、`400 E_BAD_QUERY`、`502 E_SOURCE_BAD_RESPONSE`、`503 E_SOURCE_UNAVAILABLE`、`504 E_SOURCE_TIMEOUT`、`500 E_INTERNAL` |
| 7 | `GET /api/dsh-skill-center/market/detail` | `source`（必填）、`owner`、`slug`（必填）、`version`（可选） | `MarketDetail`（§3.8.1） | 同 #6 |
| 8 | `GET /api/dsh-skill-center/market/installed` | 无 | `{items:{[id]:{name,version,path,exists:boolean}}, readable:boolean}` | `403`、`405`、`500 E_INTERNAL` |
| 9 | `POST /api/dsh-skill-center/market/install` | `{source, owner, slug, version?}`（`objectOnly`，≤ 64 KiB；**没有 path / files / name 字段**） | `{name, path, version, source, owner, slug, files:number, bytes:number}` | `403`、`405`、`400 E_BAD_REQUEST`、`400 E_BAD_QUERY`、`409 E_ALREADY_INSTALLED`、`422 E_SKILL_NAME_INVALID`、`422 E_PACKAGE_INVALID`、`429 E_INSTALL_BUSY`、`502 E_DOWNLOAD_FAILED`、`502 E_SOURCE_BAD_RESPONSE`、`503 E_SOURCE_UNAVAILABLE`、`504 E_SOURCE_TIMEOUT`、`500 E_INSTALL_IO`、`500 E_INTERNAL` |

body 上限沿用 `MAX_BODY_BYTES = 65536`：install 的请求体只有 4 个短字符串，64 KiB 是「有人乱发」的护栏，不是功能需要。

install 出参里两个数字的口径**不一样，别混**：`files` 是**落盘后去重后的路径数**（包内文件 + 我们补写的 `_meta.json`；包内自带 `_meta.json` 时它的原文另存为 `_meta.upstream.json`，因此只多算这一个，**不会**把被覆盖的那份再算一次）；`bytes` 是**包内文件字节合计**（不含我们补写的元数据，也不含 `_meta.upstream.json` 的副本）。

#### 3.7.2 `market/list` 的语义细则

1. **`source` 是必填的单个源，没有 `all`。** 两源的游标类型不同（SkillHub `page` 数字 / ClawHub 不透明串），一个请求无法定义「双源共用一个游标」。客户端要「全部来源」就按来源各发一次请求，`Promise.allSettled` 收结果。
2. `limit` 是**该源**条数（默认 12 → 双源一页 24 张）。`1..24` 之外**夹取不报错**；非数字才是 `400 E_BAD_QUERY`。
3. `cursor` 是该源自己的不透明游标：不传 = 第一页；传了但解码失败（或不是本插件签发的形状）→ `400 E_BAD_QUERY`，不是 500。客户端只负责原样回传，**不解析、不拼接**。
4. 关键词非空**自动走 `source.search`**，为空走 `source.list`；`keyword` 与 `category` 可同时给。
5. 上游失败**用 HTTP 状态码表达**（502/503/504 + `E_*`），不塞进 200 的响应体：客户端按来源分辨失败，一个源失败不影响另一个源渲染。
6. `total` 只有 SkillHub 给；ClawHub 恒 `null`，**不上屏**（两源口径不同）。
7. **服务端不合并、不交错、不排序跨源项**：路由返回的就是「该源自己的一页」；合并与去重在 `src/client/market-model.js` 的 `mergeBatches` 里（§3.8.2）。

超时、并发与互斥：

| 项 | 值 | 落点 |
| --- | --- | --- |
| 列表 / 搜索 / 详情 | 单源 **10s**（连接 5s + 总 10s） | `upstream.getJson({timeoutMs})` |
| 分类表 | 6s，失败静默降级 | `skillhub.categories()` |
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

1. `owner` / `slug` / `version` 过正则后**还必须检查不含 `..` 子串**（`a..b` 能过字符类，不能过这一条）。
2. URL 一律 `new URL(path, ORIGIN)` + `url.searchParams.set(...)`；**禁止字符串拼接**（`?path=${p}` 会被 `&`/`#`/`%` 打断）。
3. 拼完断言 `url.origin === ORIGIN`（钉死成 `https://api.skillhub.cn` / `https://clawhub.ai`），不成立即 `E_INTERNAL`（编程错误，不是用户错误）。
4. 302 一律**手动处理**：`location` 必须 `https:` 且 host 命中 `^[a-z0-9-]+\.cos\.accelerate\.myqcloud\.com$`，否则 `422 E_PACKAGE_INVALID`；**最多跟 1 跳**。
5. **客户端不传文件路径**：install 的 body 只有 `{source,owner,slug,version}`；清单由 Host 自己取，清单里每个 `path` 再过 `isSafeRelativePath()`（`lib/names.js`：无前导 `/`、无 `\`、无 `:`、无 `..` 段、段长 ≤ 100、整体 ≤ 240），不在清单里的路径永不请求。
6. 上游响应先过形状断言（`Array.isArray(data?.skills)` 等），形状不对 → `502 E_SOURCE_BAD_RESPONSE`：上游改字段时给出可区分的错误，而不是把 `undefined` 灌进 UI。
7. 日志只记 `{route, source, code}`，**永不**记响应正文，也不记 `keyword` 之外的请求细节。

#### 3.7.4 安装链路十四阶段与失败码

| 阶段 | 动作 | 失败 → 错误码 |
| --- | --- | --- |
| S0 入参 | `source/owner/slug/version` 过 §3.7.3 白名单；`source` 必须在注册表 | `400 E_BAD_QUERY` |
| S1 互斥 | 先按 `source:owner:slug` 加锁（进程内 `Set`），全局在跑的超 2 个即拒 | `429 E_INSTALL_BUSY` |
| S2 解析 | `plan()`：拿版本 + 包形态 + 文件清单；包里自带 `_meta.json` 的版本与请求版本不符即拒 | `502/503/504` 透传 / `422 E_PACKAGE_INVALID` |
| S3 清单 | SkillHub 清单；ClawHub 下载 zip 并读中央目录 | `502 E_DOWNLOAD_FAILED` / `422 E_PACKAGE_INVALID`（zip 结构非法、无 `SKILL.md`、条目超限） |
| S4 取 `SKILL.md` | 只下这一个文件并校验（SkillHub `sha256` + `size`；ClawHub CRC32 + `size`） | `502 E_DOWNLOAD_FAILED`（网络）/ `422 E_PACKAGE_INVALID`（校验不符） |
| S5 名字 | `parseFrontmatter(text).name` → `trim()` → `isSkillName()` | `422 E_SKILL_NAME_INVALID`（`data.declaredName` 带原文；**不改名、不用 slug 顶替**。判名文法就是宿主加载器的 `SKILL_NAME`，不合规的目录宿主也不会加载，理由见 `docs/contracts/market.md` §7.2） |
| S6 冲突 | `lstat(skillsRoot/<name>)`：**存在即拒绝**（目录/文件/软链一视同仁）；台账有记录但目录不存在 → 允许 | `409 E_ALREADY_INSTALLED`（`data.path` + `data.existing{name,version}`；version 取自目标目录的 `_meta.json`，读不到为 `null`） |
| S7 临时目录 | `mkdir(skillsRoot/.skc-install-<pid>-<rand6>, 0o755)`（点开头 → `scan.js` 跳过） | `500 E_INSTALL_IO` |
| S8 写其余文件 | 4 路并发，逐文件：`isSafeRelativePath` → 父目录 `mkdir -p` → `open(path,'wx')` → 写 → `fsync` → 逐文件比 `sha256`/CRC 与 `size` | `422 E_PACKAGE_INVALID`（不符/重名条目）/ `500 E_INSTALL_IO` |
| S9 来源元数据 | 写 `_meta.json`：`{source, ownerId, slug, version, name, installedAt}`；包里自带 `_meta.json` 时保留其字段并补 `source`，原文另存 `_meta.upstream.json` | `500 E_INSTALL_IO` |
| S10 fsync | 目录 fsync（best-effort，同 `lib/write-skill.js` 的做法） | —— |
| S11 原子落位 | `mkdir(skillsRoot/<name>)` **占位 claim**（`EEXIST` → 409）→ `rename(tmp, target)` → `fsync(skillsRoot)` | `409 E_ALREADY_INSTALLED` / `500 E_INSTALL_IO`（rename 失败会删掉 claim 空目录） |
| S12 回读 | 读 `<name>/SKILL.md` 重新 `parseFrontmatter` 断言 `name` 一致；读 `_meta.json` 断言 `source` 存在且等于来源 id | `500 E_INSTALL_IO`（此时把刚落位的目录删掉，保证「要么全有、要么全无」） |
| S13 台账 | `store.append({source,owner,slug,name,version,installedAt,files,bytes})`（临时文件 + fsync + rename；同名只保留一条） | `500 E_INSTALL_IO`（**目录不回滚**：见下） |

顺序上有一处刻意的排列：**回读（S12）在写台账（S13）之前**。这样任何失败都停在「无目录、无台账」，而写台账失败是唯一允许「目录在、台账不在」的窗口（后果只是卡片显示未安装，下次安装会被同名检查拦下，不产生坏数据）。

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
{
  "source": "skillhub",        // lib/scan.js 的 metaSource（R6）
  "ownerId": "ake",            // lib/scan.js 的 metaRelease（R7）要求 ownerId + slug 皆非空
  "slug": "dev-god",
  "version": "1.2.4",
  "name": "dev-god",           // 目录名与它一致，回读时断言
  "installedAt": "2026-11-09T06:00:00.000Z"   // ISO 8601 UTC，不上屏
}
```

自有台账 `$DSH_HOME/dsh-skill-center/installed.json` 的形状是 `{version:1, installs:[{source,owner,slug,name,version,installedAt,files,bytes}]}`：`installs[].name` 正是 `lib/ledger.js` 的 `own-record` 读取器要找的字段（`installs[].files` / `bytes` 与 install 出参同口径）。因此装完的技能必然命中 R5，`lib/classify.js` 一行不改。

包内容的安全边界（逐条）：条目数 ≤ 200；单文件 ≤ 5 MiB；解压总量 ≤ 20 MiB；压缩体 ≤ 40 MiB；路径过 `isSafeRelativePath`；**符号链接条目直接拒绝整包**（不「跳过该条目」）；加密条目拒绝；压缩方法只接受 `0`（store）与 `8`（deflate）；可执行位一律不保留（目录 0755、文件 0644）；**永不执行**包内任何文件；只写清单里列出的 `path`。

---

## 8.1 响应格式与错误码

- 信封：`{ code: string, data: T|null, message: string }`。
- `code`：成功恒 `'OK'`；失败为 `E_*` 常量（下表）。`message` 是**给开发者看的英文短句**（日志/排查用），**界面文案由客户端按 `code` 取 i18n 键**，不直接显示 `message`（避免把英文丢给中文用户）。
- HTTP status 与 `code` 双写：status 给网关/调试，`code` 给客户端分支。

| code | HTTP | 含义 | 前端表现 |
| --- | --- | --- | --- |
| `OK` | 200 | 成功 | —— |
| `E_FORBIDDEN` | 403 | 非 loopback（socket / Host / 转发头 / `sec-fetch-site` / Origin 任一不过） | 整页错误态 + 重试 |
| `E_METHOD` | 405 | 方法不对 | 同上（正常不会发生） |
| `E_BAD_REQUEST` | 400 | body 非法 / 超 64 KiB / 字段类型错 | 同上 |
| `E_BAD_NAME` | 400 | 技能名不合文法 | 行内原因 |
| `E_BAD_PATH` | 400 | 路径非绝对或不以 `SKILL.md` 结尾 | 行内原因 |
| `E_NOT_FOUND` | 404 | 重新扫描后该 name 不存在 | 行内原因 + 建议刷新 |
| `E_STALE_PATH` | 409 | 同名但路径变了（拒绝回退） | 行内原因 + 建议刷新 |
| `E_SYMLINK_READONLY` | 409 | 目标行是软链 | 行内原因（正常不可达，双保险） |
| `E_FILE_CHANGED` | 409 | 指纹变化（并发编辑） | 行内原因 + 建议刷新 |
| `E_NOT_WRITABLE` | 409 | 无可写路径 / 越界 / 无 frontmatter | 行内原因 |
| `E_WRITE_FAILED` | 500 | 落盘失败（权限、磁盘、rename） | 行内原因（含系统错误摘要） |
| `E_VERIFY_FAILED` | 500 | 回读不一致，已回滚 | 行内原因 |
| `E_INTERNAL` | 500 | 未预期异常（已 `logger.warn`） | 整页错误态 + 重试 |

市场路由（§3.7）的错误码见 §8.6：那组的语义是「上游不可用 / 包不合规」，与本节「本地写盘失败」分开，客户端按 `code` 取不同文案与不同的重试动作。

---

## 8.6 市场错误码

市场面 5 条路由的 `E_*` 全集。HTTP status 与 `code` 双写，规则同 §8.1；`message` 仍是给开发者看的英文短句，界面文案由客户端按 `code` 取 i18n 键。

| code | HTTP | 含义 | 前端表现 |
| --- | --- | --- | --- |
| `E_BAD_QUERY` | 400 | 参数不过白名单（源未知、`sort`/`limit`/`cursor` 非法、`owner/slug/version` 不合规） | 行内原因；正常不可达（参数源自 bootstrap 与已校验的条目） |
| `E_BAD_REQUEST` | 400 | install 的 body 非法 / 超 64 KiB / 不是对象 | 行内原因 |
| `E_SOURCE_UNKNOWN` | 400 | 来源不再在注册表里 | 客户端兜底文案（列表与详情实际用 `E_BAD_QUERY` 表达同一个事实，见 §3.7.2 第 1 条） |
| `E_SOURCE_UNAVAILABLE` | 503 | 上游连不上 / 5xx / 限流 | 该源失败：部分源提示条；两源都失败才整页错误态 |
| `E_SOURCE_TIMEOUT` | 504 | 连接或总超时（10s / 6s / 30s / 安装 120s 预算） | 同上 |
| `E_SOURCE_BAD_RESPONSE` | 502 | 上游响应不是 JSON，或形状不符（字段改名、缺数组） | 同上（与超时分开，便于排查上游改动） |
| `E_DOWNLOAD_FAILED` | 502 | 安装取包时网络失败（单文件下载阶段把 503/502 归一成这一条） | 卡片行内原因 + 「重试」 |
| `E_PACKAGE_INVALID` | 422 | 包不合规：zip 结构非法、路径越界、符号链接/加密条目、条目数或体积超限、`sha256`/CRC/`size` 不符、无 `SKILL.md`、版本不符 | 行内原因 + 「重试」 |
| `E_SKILL_NAME_INVALID` | 422 | 包内 `SKILL.md` 声明的 `name` 不合 `^[a-z0-9]+(?:-[a-z0-9]+)*$` | 行内原因，回显 `data.declaredName`；**不改名、不用 slug 顶替** |
| `E_ALREADY_INSTALLED` | 409 | 目标目录已存在（手装、别的工具装、本面板装过都算） | 行内原因 + `data.path`；**无覆盖入口** |
| `E_INSTALL_BUSY` | 429 | 同一目标正在安装，或全局安装数已满 | 行内原因，提示稍候 |
| `E_INSTALL_IO` | 500 | 落盘失败（权限、磁盘、rename、台账写失败、回读不一致） | 行内原因 + 「重试」 |
| `E_INTERNAL` | 500 | 未预期异常（已 `logger.warn`） | 整页错误态 + 重试 |

**唯一的信封例外**：市场路由失败时 `data` 可以携带一个小对象（`{path?, existing?, declaredName?, name?, source?, owner?, slug?}`），因为界面要显示「已装在哪」「包声明的是什么名字」。其余路由的失败信封 `data` 恒 `null`（§8.1）。客户端可以忽略 `data`，只按 `code` 分支也不会错。

---

## 验收

K13–K20：`test/write-skill.test.mjs`（原子写与回滚）、`test/provider-toggles.test.mjs`（降级与幂等）、`test/loopback.test.mjs`（围栏）、`test/http.test.mjs`（body 上限）、`test/routes.test.mjs`（身份校验四分支与 §8.1 错误码）。
