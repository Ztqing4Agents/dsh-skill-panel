# 调用流程与未定事项

> 类型：规范
> 读者：要跟一次「打开面板 / 点开关 / 启动初始化」的完整路径，或要判断哪些行为还没定的人
> 真源：`lib/routes.js` + `lib/scan.js` + `src/client/state.js` 的实际调用顺序
> 更新触发：改调用顺序、缓存策略、初始化时机，或某个未定事项有了结论时，同步改 §4 / §5
> 规模上限：400

编号 §4 / §5 保持原值（原件见 `git show a8141eb:docs/system_design.md`）。

---

## 4 调用流程

### 4.1 打开/刷新（list）

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant SH as Shell(SidebarRow/Layout)
    participant PG as SkillsPage
    participant ST as PageStore
    participant API as SkillCenterApi
    participant RT as RouteTable
    participant SC as SkillScanner
    participant LG as InstallLedger
    participant RG as RegistryReader
    participant CL as Classifier

    U->>SH: 点击侧栏「技能」
    SH->>SH: selectPanel('dsh-skill-center')
    SH->>PG: renderSlot('main', {entryKey:'dsh-skill-center'})
    PG->>ST: getSnapshot()
    ST-->>PG: status='idle', payload=undefined
    PG->>ST: actions.loading()
    PG-->>U: 骨架（区标题占位 + 4 行）
    PG->>API: list()
    API->>RT: GET api/dsh-skill-center/list
    RT->>RT: isLoopbackRequest(req)  → false 则 403 E_FORBIDDEN
    RT->>SC: scanUserSkills($DSH_HOME/skills)
    SC-->>RT: ScanCandidate[]（含 symlink / realPath / frontmatter）
    RT->>LG: readLedger(dshHome, skillsRoot)
    LG-->>RT: LedgerFacts（缺失/损坏 → 空 + diagnostics）
    RT->>RG: snapshotRegistry(ctx.skills, cwd)
    RG-->>RT: {summaries(附 rank), complete}
    RT->>CL: mergeCatalog({scanned, registry, ledger})
    CL-->>RT: {groups, excluded, diagnostics}
    RT-->>API: 200 {code:'OK', data:ListPayload}
    API-->>PG: ListPayload
    PG->>ST: actions.ready(payload)
    PG-->>U: 三分区（内置 → 本地 → 已安装）+ 计数 + 页脚
    alt 读取失败且无缓存
        RT-->>API: 500 {code:'E_INTERNAL'}
        API-->>PG: ApiError
        PG->>ST: actions.failed(err)
        PG-->>U: 原位错误（StateDot error + 文案 + 重试）
    else 刷新失败但已有缓存
        PG->>ST: actions.refreshFailed(err)  // 保留 payload
        PG-->>U: 列表不变 + ToastHost 弹「刷新失败，请重试」
    end
```

### 4.2 开关（本地/已安装真目录 + 软链拒绝分支）

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant SW as EnableSwitch
    participant PG as SkillsPage
    participant ST as PageStore
    participant API as SkillCenterApi
    participant RT as RouteTable
    participant SC as SkillScanner
    participant FM as FrontmatterCodec
    participant AW as AtomicWriter
    participant FS as SKILL.md

    U->>SW: 点击开关
    SW->>PG: onToggle(row, !row.enabled)
    PG->>ST: actions.pending(identityKey)   // 不做乐观 UI
    PG-->>U: 开关 disabled + StateDot(ongoing) + aria-live 播报
    PG->>API: toggle({name, path, enabled})
    API->>RT: POST api/dsh-skill-center/toggle
    RT->>RT: isLoopbackRequest → 403 E_FORBIDDEN
    RT->>SC: 重新扫描（磁盘是唯一真源）
    SC-->>RT: row' | undefined
    alt row' 不存在
        RT-->>API: 404 E_NOT_FOUND
    else row'.symlink === true
        RT-->>API: 409 E_SYMLINK_READONLY（不写任何字节）
    else row'.path !== path
        RT-->>API: 409 E_STALE_PATH（拒绝同名回退）
    else 身份通过
        RT->>FM: setDisableModelInvocation(bytes, !enabled)
        FM-->>RT: {next, changed}
        RT->>AW: writeDisableFlag(row'.path, !enabled, fingerprint)
        AW->>FS: lstat / read / fstat
        AW->>FS: 写 tmp → fsync → 指纹复核 → rename
        AW->>FS: 回读逐字节校验
        alt 校验失败
            AW->>FS: 回滚原字节
            AW-->>RT: E_VERIFY_FAILED
            RT-->>API: 500 E_VERIFY_FAILED
        else 成功
            AW-->>RT: {path, disableModelInvocation}
            RT-->>API: 200 {code:'OK', data:{name, enabled, modelInvocable, path}}
        end
    end
    alt 成功
        API-->>PG: ToggleResult
        PG->>ST: actions.commit(identityKey, enabled)
        PG-->>U: 开关新状态（下一次 list 亦一致）
    else 失败
        API-->>PG: ApiError{code}
        PG->>ST: actions.fail(identityKey, code)
        PG-->>U: 开关回弹 + 行内 .skc_reason（按 code 取 i18n 文案）
    end
```

### 4.3 内置技能（provider 开关）与软链行的差异

- **内置行**：`POST provider-toggle` → 归一化 `(provider,name)` → 重新 `mergeCatalog` 断言该身份仍是 `partition:'builtin'` 且 `readonlyReason:'provider-store'` → 写自有存储 → 返回 `{disabled}`。**没有路径可校验，也没有文件被碰**。
- **软链行**：客户端**根本不发请求**（`row.writable === false` ⇒ 不渲染 `EnableSwitch`，渲染 `ReadonlyTag`）；服务端仍保留拒绝（双保险），错误码 `E_SYMLINK_READONLY`，前端文案 `error.E_SYMLINK_READONLY`。

### 4.4 初始化（Host 半部）

```mermaid
sequenceDiagram
    participant L as cordis Loader
    participant H as HostPlugin(index.js)
    participant WS as ctx.webServer
    L->>H: apply(ctx, config)
    H->>H: dshHome = config.dshHome ?? $DSH_HOME ?? ~/.dsh
    H->>H: skillsRoot = dshHome/skills
    H->>H: makeRoutes(ctx, {dshHome, skillsRoot, registry: ctx.skills, sessions: ctx.sessions})
    H->>WS: ctx.effect(() => routes.map(r => ctx.webServer.register(r)))
    WS-->>H: disposer[]
    Note over H,WS: 重复注册同路径会 throw（宿主契约），故 apply 必须幂等
```

单实例守卫：`apply` 里若检测到同名路由已存在（重复加载同一包），第二次注册会抛错并打断启动 —— 因此 `index.js` 用一个模块级 `let applied = false` 做幂等（`PROF/@linxin666/dsh-client-ui-skill-explorer/lib/index.js` 的 `mountOnce(...)` 是同一目的的更完整实现，我们只需要最简单的形态）。

### 4.5 市场浏览与跨源搜索

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant MP as MarketPanel
    participant ST as store.market
    participant API as SkillCenterApi
    participant RT as 路由 market/bootstrap|list
    participant SRC as sources 适配器
    participant IO as upstream(io)
    participant NH as normalize.js
    participant MM as market-model.js

    U->>MP: 切到「技能市场」页签
    MP->>ST: 记 boot=loading
    MP->>API: marketBootstrap()
    API->>RT: GET market/bootstrap
    RT->>SRC: skillhub.categories(io)（10min 缓存，6s 超时）
    alt 分类读不到
        SRC-->>RT: {items:[], ok:false}
        Note over RT: 仍 200：categoriesOk:false，列表照常
    end
    RT-->>API: 200 {sources[], categories[], categoriesOk, total, countsOk}
    API-->>MP: descriptors → 来源筛选项由数据渲染

    MP->>ST: 记 filters（source=skillhub, sort=recommended）
    MP->>API: marketList({source:'skillhub',…})（一次只看一个来源：切换菜单才换源）
    API->>RT: GET market/list?source=…&sort=…&limit=12(&cursor)
    RT->>SRC: search(q) 当 keyword 非空，否则 list(q)
    SRC->>IO: getJson(白名单过的 URL)
    IO-->>SRC: JSON（超时 10s / 体积上限）
    SRC->>NH: 原始条目 → MarketItem
    NH-->>SRC: items（缺 = null）
    SRC-->>RT: {items, next, total}
    RT-->>API: 200 {sourceId, sort, keyword, category, items, next, total}
    API-->>MP: 单源一页
    MP->>MM: mergeBatches([{sourceId,items}…], {existing})
    MM-->>MP: 按源拼接 / 去重后的列表
    MP-->>U: 首屏骨架 → 卡片网格（先画字母头像，不等图标）

    opt 页面上有缺图标的条目（两个页签共用一条循环，非阻塞）
        MP->>ST: iconSeeds(market) 先播种：列表里 iconUrl 非空、图标缓存还没有该键的条目<br/>（marketIconsSeeded，不写 iconsTried）
        MP->>ST: nameSeeds(market) 同步播种标题：列表 displayName 非空、names 还没有该键<br/>（marketNamesSeeded，同样不写 iconsTried）；两者任一非空 ⇒ 播完 return，等下一轮
        Note over MP: 播种是本地动作，写完缓存会再触发一轮 effect，那一轮才走网络<br/>所以「从市场装 SkillHub 技能 → 切已安装」是 0 次请求
        Note over MP: 候选 = iconBatch(payload, market)：市场半边是 ClawHub 无图条目，<br/>已安装半边是 row.upstream 有身份却还没问过的行；坏 owner/slug 跳过；每源 ≤12、总 ≤24
        alt 已安装页签（默认页签，市场面板根本没挂）
            MP->>API: marketIcons({items:[{source,owner,slug}…]})
            API->>RT: POST market/icons（混源，Host 分组分发）
            RT-->>API: { icons: { "source:owner:slug": url|null }, names: { …: title|null } }
            API-->>MP: 每个身份的 url 与上游标题（各自可为 null）
            MP->>ST: marketIconsReady（null 也记 iconsTried）+ marketNamesReady（null 忽略）
            MP-->>U: 已安装行的字母瓦片换成市场那张图；拿不到就保持字母
        end
        MP->>API: marketIcons({source:'clawhub', items:[{owner,slug}…]}) ≤24 条
        API->>RT: POST market/icons
        RT-->>API: { icons: { "clawhub:owner:slug": url|null } }
        API-->>MP: 每个 id 的 url 或 null
        MP->>ST: marketIconsReady（null 也记进 iconsTried，同一 id 只问一次）
        MP-->>U: 有图的卡片把字母换成图；没图的保持字母（失败静默，不弹错）
    end

    alt 该请求 rejected（503/502/504）
        MP->>ST: marketListFailed
        MP-->>U: 整页错误态 + 重试（不显示空态：空 ≠ 失败；单源没有「部分源失败」中间态）
    end

    U->>MP: 输入关键词（250ms 防抖）/ 回车（立即）/ 清空（立即）
    MP->>ST: keyword 变化 → 清分页
    Note over MP,ST: 请求中保留旧 items —— 刷新、搜索、切筛选都一样，不换骨架

    U->>MP: 触底（距底 200px）
    MP->>API: 当前源 cursor !== null 才发一次（cursor 原样回传）
    Note over MP: next === null 即到底，显示「没有更多了」
```

四条分支与两条失败分支的判据：切来源 / 切分类 / 切排序 / 换关键词 / 页头刷新 ⇒ 都清 `pages/cursors/exhausted/detail` 并重拉第一页，且都**保留 `items`**（旧列表直出，不换骨架、不滚回顶部）；答案落地时整表替换（首屏重取不带 `existing`）；首屏失败 ⇒ 整页错误态；追加失败 ⇒ 已有卡片留着，尾部给「重试」（`market/list` 用 HTTP 状态码表达失败，见 `docs/contracts/routes.md` §3.7.2）。市场一次只看一个来源，所以没有「部分源失败」这一支。

### 4.6 市场安装

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant MP as MarketPanel / Confirm
    participant API as SkillCenterApi
    participant RT as 路由 market/install
    participant IN as install.js
    participant SRC as sources 适配器
    participant T as skillsRoot/.skc-install-*
    participant L as market/store.js

    U->>MP: 点「安装」→ 确认弹窗 → 确认
    MP->>API: marketInstall({source, owner, slug, version?})
    API->>RT: POST market/install（≤ 64 KiB）
    RT->>RT: guard → 白名单（§3.7.3）→ source 在注册表
    RT->>IN: install(ref)
    IN->>IN: 加锁 source:owner:slug；全局在跑超 2 个 ⇒ 429
    IN->>SRC: plan(ref)  → 版本 + 包形态 + 清单
    alt 包里 _meta.json 的版本与请求版本不符
        IN-->>RT: 422 E_PACKAGE_INVALID（一个文件都没下）
    end
    IN->>SRC: fetchFile(plan, 'SKILL.md')（只这一个）
    IN->>IN: 校验 sha256/CRC + size ⇒ 422
    IN->>IN: parseFrontmatter → name ⇒ 不合规 422 E_SKILL_NAME_INVALID
    IN->>IN: lstat(skillsRoot/name) 存在 ⇒ 409 E_ALREADY_INSTALLED（不动一个字节）
    IN->>T: mkdir .skc-install-<pid>-<rand>
    IN->>SRC: fetchFile 其余文件（4 路并发）
    IN->>T: 逐文件 wx 写入 + 校验 + fsync
    IN->>T: 写 _meta.json（source/ownerId/slug/version/name/installedAt）
    IN->>IN: mkdir(skillsRoot/name) 占位 claim → rename(tmp, target)
    IN->>IN: 回读 SKILL.md 与 _meta.json 断言一致（不一致则删目录）
    IN->>L: append 安装记录（原子写）
    L-->>IN: ok
    IN-->>RT: {name, path, version, source, owner, slug, files, bytes}
    RT-->>API: 200 OK
    API-->>MP: 结果
    MP-->>U: toast「已安装 name · 新会话生效」+ 卡片转「已安装」+ 已安装页签标脏
    Note over IN,T: 任一步失败 → finally 删临时目录 → 不写台账 →<br/>skillsRoot 条目集合与安装前逐字节相同
```

唯一的例外窗口：台账写失败时目录保留（否则用户装好的技能凭空消失），返回 `500 E_INSTALL_IO` 并在 `message` 里说明「技能已落位、台账未写」——后果只是卡片显示未安装，下次安装会被同名检查拦下，不产生坏数据。分阶段失败码全表见 `docs/contracts/routes.md` §3.7.4。

---

---

### 4.7 更新检测与覆盖安装

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant PG as page.jsx（检测 runner）
    participant API as SkillCenterApi
    participant DV as 路由 market/versions
    participant MV as 路由 market/update
    participant IN as install.js update()
    participant T as skillsRoot/.skc-update-* / .skc-backup-*
    participant L as market/store.js

    Note over PG: 进「已安装」页签 / 打开详情 / 点刷新 / 点「重新检查」<br/>目标 = upstream 非空 ∧ 非软链 ∧ version 非空
    loop 按 identity 串行（2s/行、8s/轮）
        PG->>API: marketVersions({source, owner, slug})
        API->>DV: GET market/versions
        DV-->>API: {namespace, latest, versions[], total}
        API-->>PG: 答案（按 identity 落 checks，失败只影响这一行）
    end
    PG-->>U: 页头一句更新提示（「N 个技能可更新」，宿主 .updatesNote 同形）+ 版本区块五态
    U->>PG: 点「更新」→ 确认弹窗 → 确认
    PG->>API: marketUpdate({source, owner, slug, version, name, path})
    API->>MV: POST market/update
    MV->>MV: P0–P7 前置校验（重新扫描 / 软链 / path / 身份三件套 / 同版本 / 加锁）
    MV->>IN: update(ref, target)
    IN->>T: 暂存全量文件 + 新 _meta.json + 搬运启用状态 + 交换前回读
    IN->>T: rename(target → .skc-backup-*) → rename(temp → target) → syncDirectory
    IN->>IN: verifyLanded → store.append
    IN->>T: rm(备份)
    IN-->>MV: {name, path, version, from, files, bytes}
    MV-->>API: 200 OK
    API-->>PG: 结果
    PG-->>U: Tag 换 {to} + toast「已更新到 {to}」+ 后台重扫/重拉正文
    Note over IN,T: 失败 → R1 暂存失败（旧版本逐字节未动）/ R3·R5 回滚成功（E_UPDATE_RESTORED）/<br/>R4 回滚也失败（E_UPDATE_LOST）/ R6 台账未写（E_UPDATE_UNCONFIRMED）
```

四条回滚路径、十个阶段与三条不变式见 `docs/contracts/market.md` §7.11；前置校验的顺序与失败码见 `docs/contracts/routes.md` §3.7.7；两个页面的落点见 `docs/contracts/installed-detail.md`。与安装（§4.6）的关系：**同一张锁表**（`source:owner:slug` + 全局最多 2 个），所以同一个技能不可能同时在装和在更新。

### 4.8 添加技能（本机目录 → 用户技能根）

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant PG as page.jsx（addGroup + AddSkillDialog）
    participant API as SkillCenterApi
    participant RT as 路由 add（#17）
    participant LS as local/index.js
    participant T as skillsRoot/.skc-install-*
    participant L as market/store.js

    U->>PG: 点「＋ 添加技能」或 chevron 的「从本地目录添加」→ 填路径 → 回车
    PG->>API: addSkill({path})
    API->>RT: POST add（≤ 64 KiB，只有 path）
    RT->>RT: guard → S0/S1（body、`~` 展开后绝对、无 NUL、≤1024）
    RT->>LS: add({path})
    LS->>LS: S2–S4 lstat：存在 / 是目录 / SKILL.md 是普通文件
    LS->>LS: S5 声明名 trim（空则目录名）→ isSkillName
    LS->>LS: S6 lstat(skillsRoot/<name>) 存在即拒
    LS->>RT: S7 rescan() 取同一次新扫描 + 注册表快照 → shadowOf(rank < 400) 命中即拒
    LS->>LS: S8 withWriteLock('local:<name>')（与市场安装同一张锁表）
    LS->>LS: S9 清点（≤2000 条 / 单文件 ≤8 MiB / 总 ≤64 MiB / 内部软链即拒）
    LS->>T: S10 临时目录 → 复制 → 目录 fsync → 占位 mkdir + rename
    LS->>LS: S11 回读 SKILL.md 断言 name 一致（不一致 ⇒ 删目录 + 500）
    LS->>L: S12 store.append({source:'local', name, dirName, fromPath, installedAt})
    LS-->>RT: {name, path, files, bytes}
    RT-->>API: 200 OK
    API-->>PG: 结局屏「已添加」+ 副行给落位路径 + toast「已安装 <name> · 新会话生效」+ 一次 load('refresh')
    Note over LS,T: 任一步失败 → finally 删临时目录 → 不写台账 → skillsRoot 条目集合与添加前逐字节相同
```

唯一的例外窗口与市场安装同款：台账写失败时目录保留、返回 `500 E_INSTALL_IO`（这一行会落「本地」组而不是「已安装」组，下次同名添加被 S6 拦下，不产生坏数据）。守卫顺序、四个新码与不变式见 `docs/contracts/routes.md` §3.3.4 §8.1；弹窗三态见 `docs/contracts/client.md` §3.9.7。

### 4.9 卸载技能（详情页头 → 用户技能根下的真目录）

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant DV as InstalledDetail + DeleteConfirm
    participant PG as page.jsx
    participant API as SkillCenterApi
    participant RT as 路由 remove（#18）
    participant LS as local/index.js
    participant D as skillsRoot/<name>/
    participant L as market/store.js

    U->>DV: 头动作组第 2 位「卸载」（deletable(row) 为 true 才渲染）→ 确认弹窗 → 点「卸载」
    DV->>PG: onConfirm（**先关弹窗**）
    PG->>API: removeSkill({name, path})（path = 这一行的 SKILL.md）
    API->>RT: POST remove
    RT->>LS: remove({name, path})
    LS->>LS: D0–D1 body / isSkillName
    LS->>LS: D2–D5 重扫找行 → 软链 → path===null → 路径不等（各一个码）
    LS->>LS: D6 目标目录的父目录逐字等于 skillsRoot 且本身不是软链
    LS->>LS: D7 withWriteLock('local:<name>')
    LS->>D: D8 rm -r（递归）
    LS->>L: D9 store.remove(name)（临时文件 + fsync + rename；失败仍 200 + ledger:'kept'）
    LS-->>RT: {name, dir, ledger}
    RT-->>API: 200 OK
    API-->>PG: closeDetail() 回列表 + load('refresh') + marketInstalledStale()，**没有成功 toast**
    Note over LS,D: 失败 ⇒ 目录仍在、台账逐字节未变 ⇒ 留详情 + .skc_reason
```

卸载**只有这一个入口**（行与卡片上没有卸载位，硬约束 9）；目的地只有 `skillsRoot` 的直接子目录（D6），软链在扫描层 / 前端 / 路由三层同时被拦（硬约束 5）。成功后的「市场卡片已安装标记」靠 `marketInstalledStale()` 在下一次进市场页签时重读，不用 `installedDirty`（`docs/contracts/decisions.md` 附录 S-9）。

## 5 待明确事项

> 详细取舍与验证方法见文末「待明确 / 假设」。这里只列**影响实现顺序**的三项。

| # | 事项 | 本轮采用 | 影响 |
| --- | --- | --- | --- |
| D1 | `SkillSummary` 不暴露 `rank` | 用 `source`/`provider` 反推（1.4.3），第三方 provider 一律按 600 | 只有当某个 provider 自报 rank ≠ 600 时，同名裁决可能与模型实际拿到的不一致；验证方法见文末 A1/A2 |
| D2 | PRD 两句「rank 小者胜」与「内置永远胜出」在 bundled(600) vs user(400) 时互斥 | 取 **rank 小者胜**（保 G1 的核心承诺：面板显示的必须是模型拿到的那条） | 若用户坚持「内置永远显示为内置」，需要在 `mergeCatalog` 里加一条覆盖规则，改动 1 个函数 |
| D3 | 页头停靠用「克隆量测 + 插值」在真机上是否稳定 | 照 port 宿主实现 | 若抖动，降级阶梯：① 去掉逐部件插值，只保留 sticky + `data-compact` 的 padding/分隔线切换；② 再不行退回纯 `position:sticky` + 静态 28px。每一级都要在真机对着宿主插件页比对后再决定 |

---

---

## 验收

`test/api.test.mjs`（请求形状）、`test/routes.test.mjs`（真实落盘到临时目录）、`test/state.test.mjs`（pending → commit / fail）、`test/index.test.mjs`（初始化与 `ctx.effect` 释放）。
