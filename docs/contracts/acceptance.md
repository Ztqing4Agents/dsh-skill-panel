# 验收：分层、夹具、用例编号与口径

> 类型：规范
> 读者：验收人（人或 agent）——回答「怎样算通过」
> 真源：`npm test` 的 279 条用例与 `npm run check` 的三道门；本文件只是它们的分层说明与编号索引
> 更新触发：新增门禁、改用例编号、改验收口径时同步改本文件（D.3 的编号被 26 个测试头注锚定，不许重排）
> 规模上限：400

编号 附录 D.1–D.4 保持原值（原件见 `git show a8141eb:docs/system_design.md`）。

---

## 附录 D 验收：分层、夹具与用例骨架

### D.1 三层分类：什么能被自动断言

| 层 | 判定标准 | 模块 | 测试手段 |
| --- | --- | --- | --- |
| **L1 纯函数** | 无 I/O、无 `Date`、无 `Math.random`、无 DOM | `lib/names.js`、`lib/loopback.js`、`lib/http.js`（`asJsonObject`）、`lib/frontmatter.js`、`lib/classify.js`、`lib/ledger.js`（解析半）、`lib/provider-toggles.js`（序列化半）、`src/client/model.js`、`src/client/header-scroll.js`（`interpolateParts`） | `node --test`，直接 import ESM，**不需要构建、不需要浏览器** |
| **L2 需临时目录 / 假请求** | 真实读写临时文件，或手工构造 `{socket, headers}` 对象 | `lib/scan.js`、`lib/write-skill.js`、`lib/routes.js`、`lib/provider-toggles.js`（读写半） | `node --test` + `fs.mkdtemp(os.tmpdir())`，每个用例自建 fixture 树，结束时 `rm -rf` |
| **L3 需假 DOM** | 组件树结构（不是几何） | `src/client/page.jsx`、`row.jsx`、`skeleton.jsx`、`toast.jsx` | **`renderToStaticMarkup`**（`react-dom/server`）把组件渲染成字符串再断言结构；**不用 jsdom**：我们只验 DOM 结构与 ARIA，不验样式计算 |
| **L4 只能真机** | 像素几何、令牌解析、滚动停靠、深色模式、热刷新 | —— | 见文末「真机才能验证的项」清单，人工按 `docs/contracts/visual.md` A.9 的度量表逐项量 |

> `renderToStaticMarkup` 能覆盖的边界：组件必须接受显式 props（不允许在组件里直接 `fetch` 或读 `window`）。因此 `SkillsPage` 只从 `store` + `api` props 取数据，`HeaderScroll` 的 DOM 量测放在 `attachHeader` 内部（渲染时返回 `null`，不参与 SSR）。

### D.2 `test/fixtures/` 需要的四棵树

```
fixtures/skills-plain/       ← 本机五条真实样本的最小复刻（含 _meta.json 两种写法，采集于 2026-11-08）
fixtures/skills-crlf/        ← 一个 CRLF 的 SKILL.md（照抄本机 indiv-guipi--find-skills 的首两行）
fixtures/skills-symlink/     ← 一个指向 fixtures/target-repo/ 的软链（git 仓库形态，只读）
fixtures/skills-messy/       ← .DS_Store、点文件、无 frontmatter 目录、非法 name、超长描述、
                               带 `disable-model-invocation: true  # 注释` 的技能、无 frontmatter 但合法目录
```

### D.3 用例编号（测试头注按此编号锚定）

| ID | 目标 | 断言（可直接写成 `assert`） | 层 |
| --- | --- | --- | --- |
| **K1** | 名称文法 | `isSkillName('dev-docs-standards') === true`；`isSkillName('a--b') === false`；`isSkillName('A') === false` | L1 |
| **K2** | 9 级阶梯逐级命中 | 9 组 `classifySkill(input)` 分别返回 `rule === 'R1'…'R9'`；R8 命中时 `confidence === 'medium'` | L1 |
| **K3** | 软链优先于来源元数据 | `{symlink:true, metaRelease:true, metaSource:true}` ⇒ `partition === 'local'`、`rule === 'R4'` | L1 |
| **K4** | 档位排序 | `rankOf('bundled') === 600`、`rankOf('runtime-ish') === 600`、`rankOf('user-dsh') === 400` | L1 |
| **K5** | 同名裁决与去重 | 同名 `bundled(600)` + `user-dsh(400)` ⇒ 输出 1 条且 `rank === 400`；`excluded + Σgroups === 输入去重后数量` | L1 |
| **K6** | 本机五条真机样本 | 用 `fixtures/skills-plain` 跑 `mergeCatalog`：`dev-docs-standards → local/R4`、两个 `clawhub-* → installed/R7`、两个 `indiv-* → installed/R8` | L2 |
| **K7** | CRLF 保真 | 对 `fixtures/skills-crlf` 的字节跑 `setDisableModelInvocation(b, true)`：输出**包含** `\r\n` 且**不含**裸 `\n`（除原文件已有的）；再跑一次 `changed === false` | L1 |
| **K8** | 逐字保真 | 只改一行：`diff(原, 新)` 的行集合恰为 `['disable-model-invocation: true']` 一条新增/替换；BOM 仍在首位 | L1 |
| **K9** | 保留注释与间距 | `disable-model-invocation: true  # 临时关闭` → `disable-model-invocation: false  # 临时关闭` | L1 |
| **K10** | 无 frontmatter 拒绝 | 抛 `NO_FRONTMATTER`；路由映射 409 `E_NOT_WRITABLE` | L1/L2 |
| **K11** | 扫描跳过噪声 | `fixtures/skills-messy` 扫描结果不含 `.DS_Store`、不含无 `name`/`description` 的条目、不含非法 name | L2 |
| **K12** | 软链识别 | `fixtures/skills-symlink` 条目 `symlink === true`、`path === null`、`realPath` 指向 target | L2 |
| **K13** | 原子写 + 回滚 | 写入后内容等于 `next`；把 rename 目标设为不可写目录 ⇒ `E_WRITE_FAILED` 且原文件字节不变 | L2 |
| **K14** | 指纹变化 | 写入过程中改文件（mock 或在 step 间 touch）⇒ 409 `E_FILE_CHANGED`，原文件不变 | L2 |
| **K15** | provider 存储损坏降级 | `provider-toggles.json` 内容为 `{`、`[]`、`{"version":9}`、超 64 KiB ⇒ `read()` 返回空集且不抛 | L1/L2 |
| **K16** | provider 存储幂等 | 连续两次停用同一身份 ⇒ 文件里 1 条；启用不存在的身份 ⇒ 文件字节不变 | L2 |
| **K17** | loopback 围栏 | `{socket:{remoteAddress:'127.0.0.1'}, headers:{host:'127.0.0.1:5173'}}` ⇒ true；改成 `10.0.0.2` / `host:'evil.com'` / 带 `x-forwarded-for` / `sec-fetch-site:'cross-site'` ⇒ false | L1 |
| **K18** | 路由身份校验四分支 | 404（name 不在）/ 409 `E_SYMLINK_READONLY`（软链）/ 409 `E_STALE_PATH`（同名换路径）/ 200（身份一致），且**软链那条的 `SKILL.md` 字节前后完全相同** | L2 |
| **K19** | 路由方法与围栏 | `GET /toggle` ⇒ 405；非 loopback ⇒ 403 且**不触盘**（用一个会记账的 mock deps 证明没调用 `scan`） | L2 |
| **K20** | body 上限 | 70 KiB body ⇒ 400 `E_BAD_REQUEST` | L2 |
| **K21** | list payload 形状 | `groups` 三个 key 顺序恒为 `builtin/local/installed`；`counts.excluded` 等于被 R3 排除数 | L2 |
| **K22** | 行结构 | `renderToStaticMarkup(<SkillRow …/>)` 含 `skc_cardIcon`、`skc_cardTitle`、`skc_cardDesc`；**可写行**含 `role="switch"` 且 `aria-label` = `启用 <name>`；**软链行**不含 `role="switch"`、含 `skc_roTag` | L3 |
| **K23** | 分区顺序与空态 | 三个 `skc_group` 的标题顺序 = 内置/本地/已安装；空分区仍渲染区标题 + `group.*Empty` 文案 | L3 |
| **K24** | 加载/错误态 | `status='loading'` ⇒ 4 个 `skc_skeletonBar` 且存在 `正在读取技能…`；`status='error'` ⇒ `role="alert"` + 重试按钮 | L3 |
| **K25** | 页签 | `SegmentedTabs` 渲染两个 `role="tab"`，默认选中「已安装」；切到市场 ⇒ 只渲染 `market.placeholder`，工具栏 `hidden` | L3 |
| **K26** | 计数文案 | `statusLine({total:5,disabled:1}) === '共 5 个技能，1 个已停用'`；`{total:5,disabled:0} === '共 5 个技能'` | L1 |
| **K27** | 不硬编码中文 | `scripts/check-i18n.mjs`：`src/client/**` 与 `lib/**` 的 CJK 计数为 0；`zh.json`/`en.json` 键集相等；`panel.label` 存在 | 门禁 |

### D.4 验收口径（A 组：通过标准，每条都能现场执行）

| 编号 | 验收动作 | 通过标准 | 由谁保证 |
| --- | --- | --- | --- |
| A1 | 打开面板，对照本机 5 条真实样本 | 三分区归属 5/5 命中 | 自动：K6 |
| A2 | 造一个手写目录 + 一个假 `clawhub-a--b` 空目录 + 一个软链，刷新 | 手写 → 本地；空 `clawhub-a--b` → 已安装（中置信）；软链 → 本地 | 自动：K6 + K11 + K12 |
| A3 | 停用本地技能后 `git diff` 该 `SKILL.md` | 只多 `disable-model-invocation: true` 一行，其余字节（含 CRLF/BOM/注释）不变 | 自动：K7 + K8 + K9 |
| A4 | 停用后重启 DSH | 面板仍显示为停用 | 真机抽检 1 次（磁盘是唯一真源，重启读的就是同一字节） |
| A5 | 把 `provider-toggles.json` 改成非法 JSON | 面板正常打开、全部显示为启用、不报错 | 自动：K15 |
| A6 | 读取期制造权限不足 | 首次失败 → 原位错误 + 重试；有缓存 → 列表保留 + toast | 自动：K24 + 真机注入 |
| A7 | 窗口从 1200px 拖到 560px | ≤767px 内边距 20px；<600px 时页签与图标操作同行（页签在左），600–767px 页签独占下一行 | 真机（L4，容器查询只能在浏览器里看） |
| A8 | `prefers-reduced-motion: reduce` | 骨架不呼吸、页签指示块无位移过渡 | 真机（CSS 层已写 `animation:none`，字符串渲染断言不到） |
| A9 | `npm test && npm run check` | 全绿 | 门禁 |

补充验收点：K17–K20 覆盖围栏、方法、body 上限与路由身份校验；K18 是「软链零写入」的验收点（队长决策 2）。
真机逐项清单（几何、深色模式、页头停靠、标题栏安全区、页面切换、热刷新）见文末「真机才能验证的项」。

---

---

### 真机才能验证的项（不进自动化测试）

1. 像素几何：内边距、页签 34px、行高 64px、图标 48×48、开关 36×20（`HIDDER/AGENTS.md` 的教训：几何只能由真实浏览器量）。
2. 深色模式：所有 `--dsw-*` 解析成功（失败表现为「透明边框 / 看不见的文字」，`HIDDER/docs/reference/settings-ui.md` §9）。
3. 页头停靠在滚到紧凑态时**列表滚动范围不变**、反向滚动沿同一坐标返回。
4. darwin 标题栏安全区（含侧栏收起时的 8px 特例）。
5. 打开任意会话 → 主区回到会话正文；回到「技能」→ 页签保持。
6. 改完 frontmatter 后模型目录热刷新（`skill-filesystem` 的 `watch`）：停用一个技能后，下一轮会话的可用技能列表减少。
7. `prefers-reduced-motion: reduce` 下骨架不呼吸、页签指示块无位移过渡。
