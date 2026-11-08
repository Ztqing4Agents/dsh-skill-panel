# 路由、写盘与错误码

> 类型：规范
> 读者：加改路由、错误码、请求围栏或写盘实现的人
> 真源：`lib/routes.js`、`lib/write-skill.js`、`lib/loopback.js`、`lib/http.js` 与 `test/routes.test.mjs`
> 更新触发：改路由表、错误码、body 上限或写盘步骤时，同步改 §3.3 / §3.4 / §8.1
> 规模上限：400

编号 §3.3 / §3.4 / §8.1 保持原值（原件见 `git show a8141eb:docs/system_design.md`）。证据记号定义见 `docs/reference/host-plugin-page.md` §1。

---

## 3.3 Host 路由清单

四条 **exact** 路由（`kind:'exact'`，`ctx.webServer.register(route)` 返回 disposer；重复注册同路径会抛错，见 `EX/dsh-host-webserver/README.md`「Registering routes」）。

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

---

## 验收

K13–K20：`test/write-skill.test.mjs`（原子写与回滚）、`test/provider-toggles.test.mjs`（降级与幂等）、`test/loopback.test.mjs`（围栏）、`test/http.test.mjs`（body 上限）、`test/routes.test.mjs`（身份校验四分支与 §8.1 错误码）。
