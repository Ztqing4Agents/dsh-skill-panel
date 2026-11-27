# 路由、写盘与错误码

> 类型：规范
> 读者：加改路由、错误码、请求围栏或写盘实现的人
> 真源：`lib/routes.js`、`lib/write-skill.js`、`lib/loopback.js`、`lib/http.js` 与 `test/routes.test.mjs`
> 更新触发：改路由表、访问策略、错误码、body 上限或写盘步骤时，同步改 §3.3 / §3.4 / §8.1
> 规模上限：400

编号 §3.3 / §3.4 / §8.1 保持原值（原件见 `git show a8141eb:docs/system_design.md`）。证据记号定义见 `docs/reference/host-plugin-page.md` §1。

## 3.3 Host 路由清单

十六条 **exact** 路由（`kind:'exact'`，`ctx.webServer.register(route)` 返回 disposer；重复注册同路径会抛错，见 `EX/dsh-host-webserver/README.md`「Registering routes」）。本地面 7 条（下表 #1–#4、#14、#17、#18；`#` 是历史编号，不重排也不复用，两条退役的图片端点不回收），市场面 9 条见 `docs/contracts/market-routes.md` §3.7。

统一信封（§8.1）：成功 `200 {code:'OK', data, message:''}`；失败 `4xx/5xx {code:'E_…', data:null, message}`。**没有例外**：市场面的两条图片代理路由（`market/lucide` 与 `market/clawhub-icon`）已随 `clawhub.ai` 一起退场，图标改为上游绝对 `https` 直连（`decisions.md` 附录 N 的 N-11），所以每条路由都回信封。

| # | 方法 + 路径 | 入参 | 出参 `data` | 错误码 |
| --- | --- | --- | --- | --- |
| 1 | `GET /api/dsh-skill-panel/list` | 无（可选 `?cwd=`，仅用于项目级计数） | `ListPayload`（§3.3.1） | `403 E_FORBIDDEN`、`405 E_METHOD`、`500 E_INTERNAL` |
| 2 | `POST /api/dsh-skill-panel/toggle` | `{name, path, enabled}` | `{name, enabled, modelInvocable, path}` | `403`、`405`、`400 E_BAD_REQUEST`、`400 E_BAD_NAME`、`400 E_BAD_PATH`、`404 E_NOT_FOUND`、`409 E_STALE_PATH`、`409 E_SYMLINK_READONLY`、`409 E_FILE_CHANGED`、`409 E_NOT_WRITABLE`、`500 E_WRITE_FAILED`、`500 E_VERIFY_FAILED` |
| 3 | `POST /api/dsh-skill-panel/provider-toggle` | `{provider, name, enabled}` | `{provider, name, disabled}` | `403`、`405`、`400`、`400 E_BAD_NAME`、`404 E_NOT_FOUND`（该 (provider,name) 不再是内置行）、`500 E_WRITE_FAILED` |
| 4 | `GET /api/dsh-skill-panel/health` | 无 | `{ok, version, dshHome, skillsRoot, counts, ledger:{sources:string[]}, providerToggles:{readable:bool, disabled:int}, complete:bool}` | `403`、`405`、`500` |
| 14 | `GET /api/dsh-skill-panel/detail` | `?name=<kebab>`（必填，`isSkillName` 校验；**只收 name，没有任何路径 / 目录参数**） | `SkillContent`（§3.3.3） | `403 E_FORBIDDEN`、`405 E_METHOD`、`400 E_BAD_NAME`、`404 E_NOT_FOUND`、`500 E_INTERNAL` |
| 17 | `POST /api/dsh-skill-panel/add` | `{spec}`（`objectOnly`，≤ 64 KiB；**只有这一个字段**：没有 name、没有目录参数、没有文件清单。字段名是 `spec` 而不是 `path`——一个字段一个分类器，见 §3.3.4） | `{name, path, files, bytes, source, repo, ref, commit}`——`path` 是落位后的 `<skillsRoot>/<name>`，`files`/`bytes` 与 #9 同口径；`source` 是 `'local'`/`'github'`，后三个**非 git 形态恒 `null`**（形状统一，客户端不需要分支） | `403 E_FORBIDDEN`、`405 E_METHOD`、`400 E_BAD_REQUEST`、`400 E_BAD_PATH`、`404 E_ADD_NOT_FOUND`、`422 E_ADD_NOT_SKILL_DIR`、`422 E_SKILL_NAME_INVALID`、`422 E_PACKAGE_INVALID`、`409 E_ALREADY_INSTALLED`、`409 E_ADD_SHADOWED`、`429 E_INSTALL_BUSY`、`500 E_INSTALL_IO`（顺序见 §3.3.4） |
| 18 | `POST /api/dsh-skill-panel/remove` | `{name, path}`（`objectOnly`，≤ 64 KiB；`path` 是这一行**当场扫描出来的 `SKILL.md` 路径**，硬约束 6） | `{name, dir, ledger:'cleared'\|'kept'}`——`dir` 是刚删掉的目录，`ledger:'kept'` 表示目录已删、台账那条没清掉（§3.3.4 D9） | `403 E_FORBIDDEN`、`405 E_METHOD`、`400 E_BAD_REQUEST`、`400 E_BAD_NAME`、`404 E_NOT_FOUND`、`409 E_SYMLINK_READONLY`、`409 E_NOT_WRITABLE`、`409 E_STALE_PATH`、`429 E_INSTALL_BUSY`、`500 E_DELETE_IO`（顺序见 §3.3.4） |

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
  "rule": "R4", "confidence": "high",   // 便于 QA/P1 tooltip
  "symlink": false,
  "path": "/Users/…/.dsh/skills/dev-docs-standards/SKILL.md",  // 软链为 null（不可写）
  "realPath": null,                 // 仅软链行给值：realpath(entry)/SKILL.md，用于 tooltip 显示指向
  "enabled": true, "writable": true, // enabled = !disable-model-invocation；writable=false ⇒ 客户端不渲染开关
  "readonlyReason": null,           // 'symlink' | 'provider-store' | 'no-file'
  "upstream": { "sourceId": "clawhub", "owner": "awspace", "slug": "pdf" }, // 或 null：上游身份，见下
  "version": "1.2.4",                // 或 null：_meta.json 的 version（≤64 字符），展示字段
  "originPath": null, "pluginPackage": null, "pluginVersion": null, "pluginDescription": null, "pluginIcon": null  // 展示字段
}
```

`originPath` / `pluginPackage` / `pluginVersion` / `pluginDescription` / `pluginIcon` 也是**展示字段**，不进 `classifySkill`（后三个都由同一个包根的那份 manifest 推导）：`originPath` 是宿主 `SkillSummary.resourceBase.path`（provider 送来的技能才有），内置块用它算「提供者的包名」；`pluginIcon` 由 `lib/plugin-icon.js` 读 `<包根>/package.json` 的 `icon`（没有则 `exports["./icon"]` 的图片）生成（≤256 KiB、`.svg/.png/.jpg/.jpeg/.webp`、不跟随软链、不出包根、不加载模块），任何一步不满足就是 `null`，客户端在插件位画宿主给这个面的默认图形（`PluginArtworkDefault` 36；列表块与插件页头两处同图同尺寸）。`version` 同样只做展示：来源只有本插件安装器写的 `_meta.json` 的那一份，非字符串、空串或长度 >64 一律 `null`；它不进 `classifySkill`，也不参与同名裁决，界面上为空时整块不渲染（不写「未知」）。

不变式：`writable === false ⇔ readonlyReason !== null`；`partition === 'builtin'` ⇒ `readonlyReason ∈ {'provider-store','no-file'}` 且 `symlink === false`；`symlink === true` ⇒ `path === null && realPath !== null && writable === false && readonlyReason === 'symlink'`；`symlink === false` ⇒ `realPath === null`。

`upstream` 是**展示字段**，不是判据：它只用于去市场取图标（`marketKeyOf(upstream)` = `source:owner:slug`，与市场条目 id、台账键逐字相同），**从不进入 `classifySkill`**。三条硬规矩：① 只由 `_meta.json` 的 `source`/`ownerId`/`slug` 三件套（过 `isUpstreamIdentity`）给出，其余一律 `null`；② registry 胜出的行（`partition === 'builtin'`）**恒 `null`**（它没有 `_meta.json`，也无 `path`）；③ 不变式 `upstream !== null ⇒ rule ∈ {'R4','R5','R6'}`（有 `_meta.json.source` 的行只可能落在软链、台账或来源元数据这三条判据上）。`sourceId` 在这里只做**形状**校验，是不是已注册的源由客户端按 `MARKET_SOURCE_IDS` 兜最后一道——本地磁盘面不该依赖市场注册表。

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
- ①②③ 的顺序不可换：先确认「这条还在」，再拒软链，最后比对路径，任何一步先返回都能给出可区分的错误码（前端文案不同）；每次 `toggle` 都**重新扫描**（不查内存缓存）——这是「磁盘是唯一真源」的落地方式，也让「面板打开后有人手改了文件」变成 409 而不是静默改错文件。

#### 3.3.3 `detail` 的读盘围栏与出参

```js
if (!isSkillName(name)) return fail(res, 400, 'E_BAD_NAME')            // ① 请求里只有 name
const row = (await mergeCatalog(freshScan())).find(r => r.name === name)
if (!row) return fail(res, 404, 'E_NOT_FOUND')                        // ② 每次请求都重扫
const file = row.symlink ? row.realPath : row.path                     // ③ 软链行读链路末端
if (file === null) return ok({ ...blank, body: null, files: null })    // ④ 内置行不是错误
const st = await lstat(file)                                           // ⑤ 末端仍是软链就不再跟随
```

- **入参白名单**：只有 `name`。没有 `path` / `dir` / `cwd`；`name` 不在扫描结果里就没有第二次磁盘访问，请求也读不到 `skillsRoot` 之外的文件（软链目标除外——那是 `realPath` 解析出来的合法目标）。
- **`lstat` 末端**：扫描层已经把软链目录解析成 `realPath`，这里再看一次是为了拦住「`SKILL.md` 自己也是软链」的那一层；仍是软链 ⇒ **不再跟随**，按「没有可读文件」返回（`body: null`、`size: null`），不是错误。
- **`MAX_TEXT_BYTES = 262144`（256 KiB）**：超限只读前 256 KiB，`truncated: true`、`size` 仍是截断前的真实大小。真样本最长 39 618 B（`decisions.md` 附录 E-2），上限是护栏不是功能需要。
- **frontmatter 只走读侧解析器**：正文 = `stripFrontmatter` 的结果，实现只在 `lib/frontmatter.js`；**不许**手写正则切 `---`。
- **文件清单**：`readdir` 递归，深度 ≤4（以技能目录里的条目为第 1 层）、条目 ≤200，跳过点开头、`node_modules` 与 `dirent.isSymbolicLink()`（与硬约束 14「不跟随包内软链」同一条线）；超限置 `filesTruncated: true` 并停，不报错；子目录在遍历期间消失按「读不到」跳过（清单是尽力而为，正文读失败才是 500）。文案与顺序按路径字符串稳定排序，路径是相对技能目录的 `/` 分隔串；**正文读失败 = `500 E_INTERNAL`**（`readCandidate` 刚成功读过同一个文件，否则这一行根本不存在），清单读不到只是「尽力而为」，不新增错误码——§8.1 的表零改动。

出参 `SkillContent`：

```jsonc
{ "name": "dev-docs-standards",
  "path": "/…/.dsh/skills/dev-docs-standards/SKILL.md", // 本次实际读的那个文件（软链行给 realPath）
  "size": 12345,            // 文件字节数（截断前）；无可读文件时为 null
  "truncated": false,       // 正文是否被 MAX_TEXT_BYTES 截断
  "body": "…",              // stripFrontmatter 之后的正文；null = 这条没有可读文件
  "files": [{ "path": "SKILL.md", "size": 12345 }],     // null = 没有可列目录（内置行）
  "filesTruncated": false,
  "repoUrl": "https://skillhub.cn/skills/<owner>/<slug>" } // 详情页「查看仓库」的 href；
                            // 没有 upstream 身份时为 null。**由宿主拼好**——浏览器半部不造
                            // 上游 URL（硬约束 13），客户端只把它放进 href，不发任何请求。
```

#### 3.3.4 add（#17）与 remove（#18）的守卫与不变式

- **`add`**：S0 body 是对象且 ≤ 64 KiB（这两件在**路由层**），`path` 是非空字符串（这一件在**编排层**，码不变，仍 `400 E_BAD_REQUEST`；**空串与全空白归 S0**，S0 之后先由分类器判形态：**相对路径与裸 `o/r` 落 `400 E_GIT_SPEC_INVALID`（不是 `E_BAD_PATH`）**，只有「以 `/` 或 `~` 开头」的才进 S1，S1 判它展开后是否是可用的绝对路径）→ S1 `~` / `~/…` 按当前用户家目录展开后须绝对、无 NUL、≤1024（`400 E_BAD_PATH`；展开同样在编排层）→ S2 `lstat(path)` 成功（`404 E_ADD_NOT_FOUND`）→ S3 是目录（**顶层软链允许**，按 `realpath` 取真实目录再判）→ S4 该目录下 `SKILL.md` 是普通文件（`lstat`，不跟随软链；S3/S4 同为 `422 E_ADD_NOT_SKILL_DIR`）→ S5 目标名 = `parseFrontmatter` 的 `name` `trim()`，空则退回目录名，须过 `isSkillName`（`422 E_SKILL_NAME_INVALID` + `data.declaredName`，**不改名、不用别的名字顶替**）→ S6 `lstat(skillsRoot/<name>)` 存在即拒，目录/文件/软链一视同仁（`409 E_ALREADY_INSTALLED` + `data.path`）→ S7 重扫后同名候选里存在 `rank < rankOf('user-dsh')` 的注册表行即拒（`409 E_ADD_SHADOWED` + `data.provider`：那条会在同名裁决里压掉刚落位的目录，用户会「加成功但看不见」）→ S8 复用 `docs/contracts/market-routes.md` §3.7.4 的 I1 **同一张锁表**与全局上限 2（`429 E_INSTALL_BUSY`）→ S9 源目录清点：条目 ≤2000、单文件 ≤8 MiB、总计 ≤64 MiB、**内部任一条目是软链即整次拒**，`node_modules` 与点开头条目跳过不复制（`422 E_PACKAGE_INVALID`）→ S10 建 `.skc-install-*` 临时目录 → 复制 → 目录 fsync → `mkdir` 占位 + `rename` 原子落位（`500 E_INSTALL_IO`）→ S11 回读 `<name>/SKILL.md` 重新断言 `name` 一致（不一致则删掉刚落位的目录，`500 E_INSTALL_IO`）→ S12 写自有台账一条（`500 E_INSTALL_IO`，**目录不回滚**，与 `docs/contracts/market-routes.md` §3.7.4 的 I13 同一处例外）。 **同一个路由装两种形态**：`spec` 先过纯函数 `classifyAddSpec`（`docs/contracts/data-model.md` §3.2.6）——以 `/` 或 `~` 开头的 path 形态**从 S1 起原样走**，GitHub 形态走 G1–G5 后再**并入 S5–S12**（`S` 编号与码一字不改）：G0 = S0 那一层（body 对象 / ≤64 KiB / `spec` 非空）→ G1 分类（`400 E_GIT_SPEC_INVALID` / `400 E_GIT_NOT_SUPPORTED`）→ G2 仓库级锁 `github:<owner>/<repo>`（切子目录不改锁，`429 E_INSTALL_BUSY`）→ G3 浅克隆到 `<skillsRoot>/.skc-clone-*`（argv = `clone --depth 1 --single-branch [--branch <ref>] --no-recurse-submodules -- <https://github.com/o/r.git> <dir>`；**env 自建、不带父环境**：`PATH`/`HOME`/可选 `TMPDIR` + `LC_ALL=C` + `GIT_TERMINAL_PROMPT=0` + 空 `GIT_ASKPASS`/`SSH_ASKPASS` + `SSH_ASKPASS_REQUIRE=never` + `GCM_INTERACTIVE=never`，并用 `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0` 表达 `credential.helper=''`（共 11–12 个键，`TMPDIR` 视父环境有无）；60s 超时、`SIGKILL`、输出 ≤16384 只进内存后按 stderr 分类即丢弃、**不落日志**；失败映射见 `docs/contracts/flows.md` §4.8）→ G4 定位 `422 E_ADD_AMBIGUOUS_SKILL` / `422 E_ADD_NOT_SKILL_DIR` → G5 `SKILL.md` 是普通文件（同 S4 那句）→ **S5–S7 名字 / 同名即拒 / 影子**（`S5` 的目录名兜底取**源目录名**，不是仓库名）→ **S9 清点对象是要复制的那个子目录**（不是整个克隆）→ **S10–S12 落位 / 回读 / 台账**。`finally` 两条清理，G3 起任何分支都不许绕过：删 `.skc-clone-*`、删 `.skc-install-*`。不变式：`ok ⇔ ∃ <skillsRoot>/<name>/SKILL.md ∧ 台账有该条 ∧ ∄ .skc-clone-* ∧ ∄ .skc-install-* ∧ 副本里没有 .git`；`fail ⇔ ∄ <skillsRoot>/<name> ∧ 两条都在 ∄ 里 ∧ 台账逐字节未变`。
- **`remove`**：D0 body 是对象（`400 E_BAD_REQUEST`）→ D1 `isSkillName(name)`（`400 E_BAD_NAME`）→ D2 重扫后按 name 找到行（`404 E_NOT_FOUND`）→ D3 该行软链（`409 E_SYMLINK_READONLY`，硬约束 5 第三层）→ D4 `row.path === null`（builtin / provider-store 行，`409 E_NOT_WRITABLE`）→ D4b 请求**根本没带** `path`（空串）⇒ `409 E_NOT_WRITABLE`（「没有可写路径」而不是「路径变了」）→ D5 带了但不相等：`row.path !== path`（严格字符串相等，不 `realpath`、不折叠大小写；`409 E_STALE_PATH`，硬约束 6）→ D6 纵深防御：`dirname(row.path)` 的父目录**逐字等于** `skillsRoot` 且该目录本身不是软链（`409 E_NOT_WRITABLE`）→ D7 共用同一把锁（`429 E_INSTALL_BUSY`）→ D8 递归删目录（`500 E_DELETE_IO`，`data:null`）→ D9 清台账里同名那一条（临时文件 + fsync + rename），**失败仍是 `200`**（`data.ledger:'kept'` + `message` 记「目录已删、台账未清」）。
- **顺序理由与不变式**：D2→D3→D4→D5 与 §3.3.2 的 toggle 四步是同一套语义（任何一步先返回都能给出可区分的码），D6 是「kind 校验」不是身份校验所以排在 D5 之后。**先删目录（D8）后清台账（D9）**：目录删不掉时台账一点没动（无副作用、可重试），台账没清掉时用户看到的结果已正确（行消失），且残留被 S6 的「台账有记录但目录不存在 ⇒ 允许」容忍。`ok ⇔ ∃ <skillsRoot>/<name>/SKILL.md ∧ 台账有 {source:'local', name} ∧ ∄ .skc-install-*`；`fail ⇔ ∄ <skillsRoot>/<name> ∧ ∄ .skc-install-* ∧ 台账逐字节未变`；删除侧 `ok ⇔ ∄ <skillsRoot>/<name>`。四个新码（`E_ADD_NOT_FOUND` / `E_ADD_NOT_SKILL_DIR` / `E_ADD_SHADOWED` / `E_DELETE_IO`）登记在 §8.1，其余复用的码见 `docs/contracts/market-routes.md` §8.6。阶段时序图见 `docs/contracts/flows.md` §4.8、§4.9。

#### 3.3.5 访问策略：十六条路由逐条显式 `auth: 'anonymous'`

宿主 `0.2.3` 起 `ctx.webServer.register` 的路由对象新增 `auth?: WebAuthenticationRule`（`WebAuthPolicy = 'anonymous' | 'required' | 'deny'`，也可以是「按请求返回策略」的函数），**缺省值是 `required`**：宿主会索要一个活着的 Peer，请求未带凭据时由鉴权层回 `401`（宿主里没有任何鉴权提供方时回 `503`）。十六条路由（本地面 7 条见上表，市场面 9 条见 `docs/contracts/market-routes.md` §3.7）因此逐条写 `auth: 'anonymous'`——把 `1.1.3` 的事实行为写下来，既不放宽也不收紧。

- **不是放行，是把旧行为写清**：`anonymous` 只表示「本路由自己管授权」，宿主不再额外索要 Peer。真正的闸仍是两道，且都在业务代码之前：① `guard()` 的 loopback 围栏（`lib/loopback.js`：socket 回环、无转发头、`Host` 回环、`Sec-Fetch-Site` 非 `cross-site`、`Origin` 与 `Host` 同源），② 宿主自 `0.2.3` 起由 `dsh-client-connection` 注册的 `webserver/authorize` 监听器——它**先**判来源（`Host` 属本机／绑定地址／已声明可信，浏览器标记同源），来源不可信直接 `403`，**然后**才读这条策略。`anonymous` 拿到的仍是「来源可信 + 本机」这一层，不是「谁都行」。
- **旧宿主上该字段被忽略**：`0.2.2` 的 `WebRoute` 没有这个成员，多出来的属性不读也不校验，行为与 `1.1.3` 逐字相同。换代际前后接口的可达性没有变化，这条由 `scripts/test-compat.mjs` 的 H7 在隔离实例上按「无凭据请求逐条回 4xx／2xx 而不是 401／403／503」守着。
- **为什么不写 `required`**：那会把「打开面板」变成「必须先拿到宿主 Peer」，本脚本与非浏览器消费者、隔离冒烟全要另配凭据；安全策略升级应当单独一轮做、单独配判据，不夹在宿主适配里。

## 3.4 开关写入实现

本节是「开关改写一张已有的 `SKILL.md`」；市场侧的落盘（新装一个技能目录）是另一条路径，见 `docs/contracts/market-routes.md` §3.7.4。

#### 3.4.1 三类行，两条写入路径（队长决策 2 之后的最终语义）

| 分区 | 写入位置 | 生效 | 失败表现 |
| --- | --- | --- | --- |
| 内置（provider 提供，`rule=R1`） | `$DSH_HOME/dsh-skill-panel/provider-toggles.json` | 本面板即读即生效（下一次 `list` 带上停用集）；**注册表不感知**，README/文档必须如实说明「模型是否仍收到取决于 provider，本面板只做面板内视图」 | 开关回弹 + 行内 `.skc_reason` |
| 本地 / 已安装（真目录，`rule=R4..R9`） | 就地改写 `SKILL.md` 的 `disable-model-invocation` | `dsh-skill-filesystem` 的 `watch: true` 热刷新（`EX/dsh-skill-filesystem/README.md`「Change detection」） | 同上，且写前指纹、写后回读 |
| **软链（`symlink === true`）** | **不写**（队长决策 2） | —— | 前端不渲染开关；路由返回 `409 E_SYMLINK_READONLY` |

> **软链只读**：本插件不修改任何软链指向的文件，也没有首次确认弹窗。

#### 3.4.2 逐字节保真改写（`lib/frontmatter.js`）

只在内存里做字节手术，不做 YAML 重新序列化（逐条规则与读侧解析见 `docs/contracts/data-model.md` §3.2.4）：

```js
// 伪代码：BOM 与每行行尾原样保留
const bom = bytes.subarray(0,3).equals(BOM) ? bytes.subarray(0,3) : empty
const block = matchFrontmatterBlock(bom.length ? bytes.subarray(3) : bytes)  // 返回 [start,end) 与 lines（含行尾）；eol 由开头分隔行决定
const hit = block.lines.findIndex(l => /^disable-model-invocation[ \t]*:/.test(l.text))
if (hit >= 0) block.lines[hit] = replaceValuePreserving(block.lines[hit], enabled ? 'false' : 'true')
else block.lines.push({ text: `disable-model-invocation: ${enabled ? 'false' : 'true'}`, eol })
return concat(bom, block, body.subarray(block.end))   // 其余字节一个不动
```

- **启用路径写 `false`，不删键**：双向切换幂等（`PRD` §3.4 允许「删除或写 false」，这里取「写 false」——删键会让 `git diff` 在 enable/disable 之间反复增删行，且删掉了作者原本的写入意图）。此为对 PRD 的实现选择，非偏离。目标键已存在且带行尾注释（`disable-model-invocation: true  # 临时关闭`）时，**保留注释**，只换值（正则 `^(\s*disable-model-invocation\s*:\s*)([^\s#]+)(.*)$`）。
- 真实约束：本机 `indiv-guipi--find-skills/SKILL.md` 是 CRLF，现成实现（`PROF/@linxin666/dsh-client-ui-skill-explorer/lib/index.js` 的 `setFrontmatterField`）会把整块换成 LF —— 因此我们不用它，且 QA 必须有一条 CRLF fixture（§6 A3）。

#### 3.4.3 原子落盘 + 指纹 + 回读（`lib/write-skill.js`）

| 步 | 动作 | 失败处理 |
| --- | --- | --- |
| 1 | `lstat(entryDir)`：软链直接 `E_SYMLINK_READONLY`（双保险，路由已拦） | 返回 409 |
| 2 | `lstat(file)` 记下 `{size, mtimeMs, ino, dev}` 指纹（第 5 步同口径；`fstat` 会跟随软链，软链下两值天然不同）→ `open(file)` 读完整个文件 | 读失败 → `E_WRITE_FAILED` |
| 3 | 计算 `next`；`changed === false` 则**不写**，直接返回成功（幂等） | —— |
| 4 | 同目录写 `<SKILL.md>.<pid>.<rand>.tmp`（`flag:'wx'`，mode 取原文件 mode）→ 写入 → `fsync` → `close`；**不改 mode**：新 inode 的 mode 为 `mode & ~umask`，umask 022 下 0666 / 0664 落成 0644 | 失败 → 删 tmp → `E_WRITE_FAILED` |
| 5 | 重取指纹，与第 2 步不等 → 删 tmp → `409 E_FILE_CHANGED`（有人在面板打开期间改了文件；测试从这个窗口唯一的注入口 `beforeVerify` 造改动，见 K14） | 已处理 |
| 6 | `rename(tmp, file)`；`fsync` 目录（best-effort） | 失败 → 删 tmp → `E_WRITE_FAILED` |
| 7 | 回读文件与 `next` **逐字节比较**；不一致 → 把原字节写回（再走一次 4–6，仍失败则 `E_VERIFY_FAILED` 并报告「文件可能处于中间状态」） | `E_VERIFY_FAILED` |
| 8 | 用 `parseFrontmatter(回读内容)` 断言 `disableModelInvocation === 目标值` | 同上回滚 |

`rename` 会换 inode，所以写回后的 mode 就是临时文件创建时的 `mode & ~umask`：`open` 的 mode 要先过进程 umask，而 **umask 只清位、不加位**，`0600` 既不会被放大，`0664` / `0666` 的 group/other 写位则会被清掉。本仓**刻意不做** mode 保真（不 `chmod`），取舍与生态参照见 `docs/contracts/decisions.md` 附录 X——宿主本地 FS 后端的原子写会补这一步，我们不对齐它。代价如实说：umask 022 下共享技能目录里原本 group 可写的 `SKILL.md`，一次停用或启用后变成 0644，同组用户写不进去且没有任何报错；`0600` / `0640` / `0755` 这类不含 group/other 写位的值不受影响，所以常见场景看不出差别。写入窗口内临时文件的 mode 同样是 `mode & ~umask`（不是 owner-only），这一点一并认下。

#### 3.4.4 `provider-toggles.json` 格式与降级（`lib/provider-toggles.js`）

```jsonc
{ "version": 1, "disabled": [ { "provider": "runtime", "name": "office" } ] }
```

- **身份**是 `provider#name`（`PRD` §3.4 所说的「键」），磁盘上存成数组而非对象键：name 有文法约束但 provider id 无，用 `#` 拼接作对象键会引入分隔符注入；数组形态也是 `PROF/@linxin666/dsh-client-ui-skill-explorer/lib/types/provider-toggles.d.ts` 的已验证形状。
- 归一化：`name` 必须过 `isSkillName`；`provider` 限 64 字符的可打印 ASCII；`provider` 缺失归一成 `''`。
- 降级（`PRD` A5）：文件缺失 / 非法 JSON / 顶层不是对象 / `version !== 1` / `disabled` 不是数组 / 单条不合规格 / 文件 > 64 KiB ⇒ 视为 **`{version:1, disabled:[]}`（全部启用）**，并在 `diagnostics` 里留一条，**绝不让 list 失败**。
- 写：临时文件 + `fsync` + `rename`；双向幂等（停用两次只留一条；启用不存在的记录则不写盘）。只读别人的存储（`PRD` §3.4 通用规则 5）：`~/.dsh/skills-manager/state.json`、`$DSH_HOME/skill-market/*`、`.skills-lock.json` **只读不写**。

市场面的 9 条 `market/*` 路由、安装链路十四阶段与市场错误码已拆到 `docs/contracts/market-routes.md`（§3.7 / §8.6）；本节只留本地面 7 条。

## 8.1 响应格式与错误码

- 信封：`{ code: string, data: T|null, message: string }`。
- `code`：成功恒 `'OK'`；失败为 `E_*` 常量（下表）。`message` 是**给开发者看的英文短句**（日志/排查用），**界面文案由客户端按 `code` 取 i18n 键**，不直接显示 `message`（避免把英文丢给中文用户）。HTTP status 与 `code` 双写：status 给网关/调试，`code` 给客户端分支。

| code | HTTP | 含义 | 前端表现 |
| --- | --- | --- | --- |
| `OK` | 200 | 成功 | —— |
| `E_FORBIDDEN` | 403 | 非 loopback（socket / Host / 转发头 / `sec-fetch-site` / Origin 任一不过） | 整页错误态 + 重试 |
| `E_METHOD` | 405 | 方法不对 | 同上（正常不会发生） |
| `E_BAD_REQUEST` | 400 | body 非法 / 超 64 KiB / 字段类型错 | 同上 |
| `E_BAD_NAME` | 400 | 技能名不合文法 | 行内原因 |
| `E_BAD_PATH` | 400 | 路径不合规：非绝对 / 不以 `SKILL.md` 结尾（#2、#14）。**#17 只覆盖「看起来是路径（`/` 或 `~` 开头）却不合法」**（含 NUL / 展开后超 1024 / 展开后仍非绝对）；**相对路径（`rel/path`、`./x`、`../x`）与裸 `o/r` 归 `E_GIT_SPEC_INVALID`**，不落这个码（见 §3.3.4 与 `docs/contracts/decisions.md` 附录 T-11） | 行内原因 |
| `E_NOT_FOUND` | 404 | 重新扫描后该 name 不存在 | 行内原因 + 建议刷新 |
| `E_STALE_PATH` | 409 | 同名但路径变了（拒绝回退） | 行内原因 + 建议刷新 |
| `E_SYMLINK_READONLY` | 409 | 目标行是软链 | 行内原因（正常不可达，双保险） |
| `E_FILE_CHANGED` | 409 | 指纹变化（并发编辑） | 行内原因 + 建议刷新 |
| `E_NOT_WRITABLE` | 409 | 无可写路径 / 越界 / 无 frontmatter / 目标目录不是技能根的直接子目录（#18 D4·D6） | 行内原因 |
| `E_WRITE_FAILED` | 500 | 落盘失败（权限、磁盘、rename） | 行内原因（含系统错误摘要） |
| `E_VERIFY_FAILED` | 500 | 回读不一致，已回滚 | 行内原因 |
| `E_ADD_NOT_FOUND` | 404 | #17 的源目录 `lstat` 不成（`~` 已展开） | 弹窗字段下那一行 + 保留输入 |
| `E_ADD_NOT_SKILL_DIR` | 422 | #17 的源不是目录 / 没有 `SKILL.md` / `SKILL.md` 不是普通文件 | 同上 |
| `E_ADD_SHADOWED` | 409 | #17 的目标名已有一条 rank 更小的注册表行（`data.provider`），加进去会被同名裁决压掉 | 同上 |
| `E_DELETE_IO` | 500 | #18 删目录失败（权限 / 被占用 / 磁盘），目录可能不完整 | 详情页 `.skc_reason` + 建议刷新 |
| `E_INTERNAL` | 500 | 未预期异常（已 `logger.warn`） | 整页错误态 + 重试 |

市场路由（§3.7）的错误码见 `docs/contracts/market-routes.md` §8.6：那组的语义是「上游不可用 / 包不合规」，与本节「本地写盘失败」分开，客户端按 `code` 取不同文案与不同的重试动作。#17/#18 复用 `docs/contracts/market-routes.md` §8.6 的 `E_ALREADY_INSTALLED` / `E_SKILL_NAME_INVALID` / `E_PACKAGE_INVALID` / `E_INSTALL_BUSY`。**#17 的 git 形态另加 7 码**（全部一句中英、**不带 `{reason}`**，界面永不出现英文系统信息，因此单列一段而不占上表的行）：`E_GIT_SPEC_INVALID` 400（认不出这个输入——裸 `o/r`、相对路径、无 scheme、`/blob/`、`tree` 以外的第 3 段、超 2048、40 位 sha、`#path:` 与 `tree` 同时给）、`E_GIT_NOT_SUPPORTED` 400（形态对但不在支持面——非 `github.com`、SSH、tarball、URL 带凭据）、`E_GIT_REPO_NOT_FOUND` 404（仓库 / 分支 / 标签不存在，或需要登录）、`E_GIT_UNREACHABLE` 502（连不上 / 代理 / 证书 / 磁盘 / 权限 / 其它一切兜底——**文案必须是宽句**）、`E_GIT_TIMEOUT` 504（克隆 60s 超时）、`E_GIT_MISSING` 500（本机没有 git）、`E_ADD_AMBIGUOUS_SKILL` 422（仓库里有多个 `SKILL.md`：`data.candidates` 是**目录相对路径**数组，去重排序后 ≤10 条，另给 `data.candidateTotal`、**`data.owner` 与 `data.repo`**（客户端靠后两个把输入改写成 `github:<o>/<r>#path:<sub>`））。`LOCAL_STATUS` 因此由 4 键变 **11 键**（`asLocalError` 的三级查表不变，见 `docs/contracts/decisions.md` 附录 S-11） / `E_INSTALL_IO` 五个码（词表只有一份，`statusOfMarketError()` 直接用），**四个新码只登记在本表**——`docs/contracts/market-routes.md` §8.6 的二十个单码行保持不变，市场码表与 `MARKET_STATUS` 逐条对应的判据因此不受影响。


## 验收

K13–K20：`test/write-skill.test.mjs`（原子写与回滚）、`test/provider-toggles.test.mjs`（降级与幂等）、`test/loopback.test.mjs`（围栏）、`test/http.test.mjs`（body 上限）、`test/routes.test.mjs`（身份校验四分支与 §8.1 错误码）。
