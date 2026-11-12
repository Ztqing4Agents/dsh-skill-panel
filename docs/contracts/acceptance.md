# 验收：分层、夹具、用例编号与口径

> 类型：规范
> 读者：验收人（人或 agent）——回答「怎样算通过」
> 真源：`npm test` 与 `npm run check` 的四道门；本文件只解释它们的分层与编号，**不记用例数**——数字每加一条就漂，以 `npm test` 的输出为准
> 更新触发：新增门禁、改用例编号、改验收口径时同步改本文件（D.3 / D.5 的编号被测试头注锚定，不许重排）
> 规模上限：400

编号 附录 D.1–D.4 保持原值（原件见 `git show a8141eb:docs/system_design.md`）；D.5 为技能市场轮新增，编号接着 K27 往后。

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
| **K26** | 页头不渲染计数 | 页头状态位只承载更新提示（宿主 `.updatesNote` 同位也只有这一句）：没有检测对象时 `.skc_status` 不渲染；渲染时只有一个 `<span>`、HTML 里不出现「共 N 个技能」「个已停用」 | L3 · `test/view-page.test.mjs` |
| **K27** | 不硬编码中文 | `scripts/check-i18n.mjs`：`src/client/**` 与 `lib/**` 的 CJK 计数为 0；`zh.json`/`en.json` 键集相等；`panel.label` 存在 | 门禁 |

### D.4 验收口径（A 组：通过标准，每条都能现场执行）

| 编号 | 验收动作 | 通过标准 | 由谁保证 |
| --- | --- | --- | --- |
| A1 | 打开面板，对照本机 5 条真实样本 | 三分区归属 5/5 命中 | 自动：K6 |
| A2 | 造一个手写目录 + 一个假 `clawhub-a--b` 空目录 + 一个软链，刷新 | 手写 → 本地；空 `clawhub-a--b` → 已安装（中置信）；软链 → 本地 | 自动：K6 + K11 + K12 |
| A3 | 停用本地技能后 `git diff` 该 `SKILL.md` | 只有 `disable-model-invocation` 这一行变成 `true`（原无该键时表现为多一行，原为 `false` 时只换值），其余字节（含 CRLF/BOM/注释）不变；**字节总数不是判据**（`false`→`true` 少 1 字节） | 自动：K7 + K8 + K9 |
| A4 | 停用后重启 DSH | 面板仍显示为停用 | 真机抽检 1 次（磁盘是唯一真源，重启读的就是同一字节） |
| A5 | 把 `provider-toggles.json` 改成非法 JSON | 面板正常打开、全部显示为启用、不报错 | 自动：K15 |
| A6 | 读取期制造权限不足 | 首次失败 → 原位错误 + 重试；有缓存 → 列表保留 + toast | 自动：K24 + 真机注入 |
| A7 | 窗口从 1200px 拖到 560px | ≤767px 内边距 20px；<600px 时页签与图标操作同行（页签在左），600–767px 页签独占下一行 | 真机（L4，容器查询只能在浏览器里看） |
| A8 | `prefers-reduced-motion: reduce` | 骨架不呼吸、页签指示块无位移过渡 | 真机（CSS 层已写 `animation:none`，字符串渲染断言不到） |
| A9 | `npm test && npm run check` | 全绿 | 门禁 |

补充验收点：K17–K20 覆盖围栏、方法、body 上限与路由身份校验；K18 是「软链零写入」的验收点（队长决策 2）。
真机逐项清单（几何、深色模式、页头停靠、标题栏安全区、页面切换、热刷新）见文末「真机才能验证的项」。

### D.5 市场轮用例编号（K28–K61）

技能市场（双源发现 / 跨源搜索 / 筛选 / 排序 / 懒加载 / 内嵌详情 / 一键安装）的验收编号。K28 接 D.3 的 K27 往后排，全仓库唯一；每一行的「落点」就是跑它的测试文件（或真机），编号也写在该文件的头注里。

| ID | 目标 | 夹具 | 断言要点 | 层 / 落点 |
| --- | --- | --- | --- | --- |
| **K28** | 市场页签挂载 | 一个 `ListPayload` + `setTab('market')` | 占位文案消失、`skc_marketSection` 挂载、已安装面整块退场（无分区 / 无状态行 / 无添加按钮），工具栏保留 | L3 · `test/view-page.test.mjs` |
| **K29** | 查询白名单与游标 | 手工构造的 `URLSearchParams` / 记录对象 | `sort` 三档白名单、`source` 必填且只过文法、`limit` 夹 1..24（非数字才 400）、`keyword ≤ 64`、`owner/slug/version` 过正则且拒 `..`、游标往返一致且坏游标 400、`buildUrl` 用 `searchParams` 且 origin 逃逸走 500 | L1 · `test/market-query.test.mjs` |
| **K30** | 错误码 → 状态表 | `MARKET_STATUS` 与 `routes.md` §8.6 的表格 | 十三条逐条一致、`asMarketError` 兜底成 `E_INTERNAL`、已知 code 保留、`detail` 透传、契约文本与代码对表 | L1 · `test/market-errors.test.mjs` |
| **K31** | 归一化与「缺 = null」 | 两源六种上游形状（列表 / 详情 / 搜索）+ 四类 `iconUrl` 样例 | 十三个字段恒存在且无 `undefined`、`id` 三元组、`downloads` 缺不补 0、`version` 缺不补 latest、ClawHub 也从镜像拿版本与分类（缺值才是 `null`，不再「恒无版本 / 恒 null」）、`iconUrl` 只要求「绝对 `https` 且可解析」（两个图床都收，没有 host / path 白名单；非 https / 相对 / 空串 / 非字符串 ⇒ null，坏地址交给 `onError`）、`overview` 由 `SKILL.md` 派生且不含 frontmatter、`sortByUpdatedDesc` 稳定 | L1 · `test/market-normalize.test.mjs` |
| **K32** | 包内路径闸 | 真 / 假路径样例 | `isSafeRelativePath` 接受 `SKILL.md` / `a/b/c.md` / `.gitignore`，拒绝 `/x`、`C:`、`\`、`..`、`.`、`//`、控制字符、单段 >100、整体 >240 | L1 · `test/names.test.mjs` |
| **K33**（**已退役 2026-11-09**） | ZIP 读取器 | —— | ClawHub 的包形态从 `zip` 改成 `files`（U7：全部走镜像）后，原来的 zip 读取模块无消费者，整模块与其夹具辅助模块一并删除；**编号不复用** | 退役 · 无落点 |
| **K34** | 安装链路十四阶段 | 临时 `dshHome` / `skillsRoot` + 假适配器 + 假 io | 成功（`SKILL.md` + `_meta.json{source,ownerId,slug,version}` + 台账被 `lib/ledger.js` 读成 `own-record`）；同名 409 带 `data.path` / `existing`；坏声明名 422 且只取 1 个文件、目录集合不变；上游失败 502/503/504 且无 `.skc-install-*`、无台账；并发同名 429；包内 `_meta.json` 原文另存 `_meta.upstream.json` | L2 · `test/market-install.test.mjs` |
| **K35** | 五条路由的围栏 | 两个假适配器 + 临时 DSH home | 每条只认一个方法（错方法 405 `E_METHOD`）、非 loopback 403 `E_FORBIDDEN` 且零上游调用、`bootstrap` 恰好六键（`sources`/`categories`/`categoriesOk`/`categoriesStale`/`total`/`countsOk`）、`categories[].count` 逐项透传、分类失败不报错（`categoriesOk:false`） | L2 · `test/market-routes.test.mjs` |
| **K36** | 四条数据路由的参数围栏与信封 | 同上 | `list` 七键、未知 `source` / `all` / 缺参 / 坏游标 / 非数字 `limit` 均 400 `E_BAD_QUERY`、上游失败用 502/503/504 且 `data:null`、`detail` 八键且顶层 `iconUrl` 与 `item.iconUrl` 恒等、`detail` 补 `installTo`、`installed` 无台账 `readable:false`、install body >64 KiB 400、body 里的 `path/files/name` 不生效、失败信封的 `data` 例外只属于市场 | L2 · `test/market-routes.test.mjs` |
| **K37** | 市场纯函数 | 手造 `MarketItem` 与 market 子状态 | `mergeBatches` **按来源顺序分块拼接**（第 1 轮 `[a1 a2 a3｜b1 b2 b3]`、第 2 轮尾部接 `[a4 a5｜b4]`），`existing` 恒在前、按 id 去重保留首次出现、**客户端不跨源重排**（传不传 `sort` 输出逐字相同）、短页照收；**短页 + `next !== null` 不算耗尽**；`installViewOf` 四态且运行时优先于台账；`emptyKindOf` 三分类；`metaSegments` 缺项少段；`visibleCategories` 选 ClawHub 整行隐藏；`chipList` / `detailFacts` | L1 · `test/market-model.test.mjs` |
| **K38** | 市场首屏与卡片 | 页面 + 播种 store（骨架 / 卡片 / 三类失败 / 三种空态 / 工具栏） | 骨架 6 卡 6 chip + `role=status`；卡片头像 / 标题锚点 / 来源 Tag / 描述 / 元信息 / 安装按钮；安装四态文案；整页失败 / 追加失败 / 空态各就各位；工具栏来源锚点显示当前**范围**（默认「所有来源」，「所有来源」就是菜单第一项，范围共三项）；chips 数字位随 `total`/`count` 出现；到底与追加互斥 | L3 · `test/market-view.test.mjs` |
| **K39** | 内嵌详情与确认弹窗 | 同上 + `marketDetailReady` / `marketInstallConfirm` | 返回面包屑、标题与版本 Tag、事实表六行（未知写「未知」、`installTo` 用 `code`）、概览交给宿主 `MarkdownText`、文件清单配 `fileSizeText`；详情加载 / 失败 / 空概览 / 空文件 / 坏声明名五种；确认弹窗 `role=dialog` + `aria-modal` + 三项事实 + 第三方提示 + 两按钮 | L3 · `test/market-view.test.mjs` |
| **K40** | 三道门禁与市场刻度 | 仓库本身 | `check:i18n` / `check:client` / `check:docs` 全 exit 0（13 份 0 warn）、`§3.7` `§3.8` `§3.9` `§7` `§8.6` `附录 E` `附录 F` `附录 G` 各恰好一处、`styles.js` 无 `xxxxxx_` 形式的宿主哈希类名、附录 F 的十条新刻度逐条落在 `skc_market*` 上 | 门禁 · `test/market-gates.test.mjs` |
| **K41** | 三条「不许再犯」+ 上游 origin 的边界 | 源码与产物 | 市场块无颜色字面量、`dependencies` 为空、点击边界按页签划（市场用 `cardOpen`，已安装行仍不是按钮）；**`src/client/**` 代码里一个 URL 都没有**（浏览器半部零直连，注释里提站点名不算）；**`lib/market/**` 里认上游主机的文件恰好两个、常量恰好两条**：`sources/mirror.js` 的 `ORIGIN = api.skillhub.cn`（市场面唯一 origin）与 `upstream.js` 的 COS 重定向白名单；`clawhub.ai` / `cdn.jsdelivr.net` 在 `lib/**` 与 `src/client/**` 里**零出现**；两个适配器只 import 那份 `ORIGIN`、不各写一份；`normalize.js` 零 origin | 门禁 · `test/market-gates.test.mjs` |
| **K42** | 源注册表与装配 | 注册表本身 + 注入的假 io | 注册顺序 `skillhub → clawhub`、六个函数与 caps 齐备、描述符形状与 §7.2 一致、`makeMarketDeps` 注入 io 时不自建客户端；**两源 `packageKind` 都是 `files`**、**三个 scope 都是 `hasCategories: true`**，两个适配器都有 `categories`/`counts`（U8 起 ClawHub 也有分类与计数） | L1 · `test/market-sources.test.mjs` |
| **K43** | 上游出口与 302 白名单 | 常量 + 手工构造的 `location` | 四个超时与两个字节上限逐条对齐、只跟一跳、只跟 `*.cos.accelerate.myqcloud.com` 的 https、`createUpstream` 的四个键 | L1 · `test/market-upstream.test.mjs` |
| **K44** | 客户端 api 六个市场方法（含 `marketIcons`，批量的语义细节见 K57；`marketFavorite` 随 U5 的写侧撤除一并下线） | 记录调用的 fetch 桩 | URL 文档相对且带 `market/` 前缀、空参数不发送、`version` 缺省不传、install 正文只有 `source/owner/slug/version`、`marketIcons` 正文是 `{items:[{source,owner,slug}]}`、失败信封的 `data` 交给调用方 | L1 · `test/api.test.mjs` |
| **K45** | store 的 market 子状态与 33 个 action | `createStore()` | 初始筛选（`source:'skillhub'`、`total:null`、`countsOk:true`）、`marketSetFilter` 空操作过滤、关键词落定不闪骨架、`reload` 只清分页不清列表（重取期间旧列表直出）、首屏失败与追加失败语义不同、详情四步不丢列表、安装四步幂等、滚动值归一、boot 兜底、一源失败不影响另一源 | L1 · `test/state.test.mjs` |
| **K46** | 安装成功复用浮层座位 | `marketInstallOk` 之后渲染 `ToastHost` | 顶层 `notice{kind:'install-ok'}` 存在 → 主行「已安装 <name> · 新会话生效」+ 副行 `skc_marketToastHint` 给路径；与 `refresh-failed` 按 `kind` 分流；`dismissNotice(seq)` 只关当前那一条 | L3 · `test/view-toast.test.mjs` |
| **K47** | 详情往返不丢已加载页数 | 两页已加载 + 打开详情再返回 | 返回后 `items` / `cursors` / `pages` 不变、`scrollTop` 留在 store、卡片数不退回第一页 | L3 · `test/market-view.test.mjs` |
| **K48** | 已安装页签零回归 | 两个页签各渲染一次 | 已安装页签有状态行与「添加技能」、不挂市场面板、行仍不可点（K22 照旧）；市场页签反之 | L3 · `test/market-view.test.mjs` |
| **K49** | 「技能市场」页签**没有**页头刷新，`store.actions` 里**也没有** `marketReload`（已删除） | 市场页签渲染 + `store.actions` 键集 | 市场页签**整行不渲染** `.skc_toolbar`（状态位 / 刷新 / 添加组三件都不在，宿主 `hidden={!onInstalled}` 同形）；`store.actions` 里**没有** `marketReload`（零调用方的 action 不留，见 `docs/contracts/decisions.md` 附录 S-16），市场重取**只有四条路**（切回页签的面板 effect / 搜索落定 / 筛选变化 / 整页错误态的「重试」，见 `docs/contracts/client.md` §3.9.1），这四条路的清分页口径仍是「保留 `items` 与 `icons`/`iconsTried`/`names`、只清 `pages`/`cursors`/`exhausted` 与详情」；已安装页签的刷新不受影响 | L3 · `test/market-view.test.mjs` |
| **K50** | 真机：当前范围的卡片与深色 | 隔离 `DSH_HOME` + 真机 host + 无头 Chrome | 市场页签只渲染**当前范围**的卡片（三个范围轮换时外观一致）、每张卡带**来源标记**与来源 Tag、分类 chips 正常；浅色与深色各截一张，令牌全部解析（无透明边框 / 看不见的文字） | L4 · 真机抽查（不进 `npm test`：像素级命中与真实上游要真机，做法同 K51） |
| **K51** | 真机：装一个真实技能 + 断网降级 | 同一个隔离实例 | 确认弹窗 → 安装成功 toast 给路径 → `DSH_HOME/skills/<name>` 出现 `SKILL.md` 与 `_meta.json` → 刷新已安装页签后出现在「已安装技能」组；把上游域名黑洞后市场页签报错而**已安装页签照常** | L4 · 真机抽查（A 级端到端判据） |
| **K52** | 市场头像三态（`MarketIcon`） | 有效 `iconUrl` / `null` / 404 三种 + 卡片·详情·确认弹窗三处 | ① 有效 → `<img class="skc_marketIconImg">`，`src` 原样、`alt=""`、`loading=lazy`、`decoding=async`、`referrerPolicy=no-referrer`；样式里 `width/height:100%` + `object-fit`（取值见 K56）+ 同心内圆角，`.skc_cardIcon` 的 48px 盒与 0.5px 描边一字未动 ② `null` / 非字符串 → 首字母头像，无 `<img>`、无空瓦片 ③ **同一实例遇到 404**（`onError` 触发）→ 回落首字母、盒子几何不变；失败按 URL 记，换一张图能重新尝试；卡片 / 详情头 / 确认弹窗三处同一组件，同一条目不会一处有图一处没图 | L3 · `test/market-view.test.mjs` |
| **K53** | 分类计数（chips 的数字从哪来） | 假 io（13 个 `pageSize=1` 请求）+ 路由级假适配器 | 适配器：恰好 13 个请求（每类一次 + 「全部」一次）、并发 ≤ 6、10 分钟缓存且**不完整的一轮不进缓存**、单项失败/超预算 ⇒ 该项 `null`、`data.total` 缺失不猜 0、`resetCountCache` 可清；路由：`categories[].count` 与 `total` 逐项透传、`countsOk` 反映齐不齐、计数失败仍 200 且列表可用、非整数/字符串一律 `null` | L1 + L2 · `test/market-counts.test.mjs` + `test/market-routes.test.mjs` |
| **K54** | chips 数量与格式 | `countText` 四态 + `chipList(categories,{total,countsOk})` + 渲染 | `Intl.NumberFormat(undefined,{notation:'compact'})`（中文 `254万` / 英文 `2.5M`）、真实 `0` 照常显示、`null`/非有限/负数 ⇒ 不渲染数字；`没有 total 时「全部」不带数字；`countsOk:false` ⇒ 一个数字都不渲染而 chips 仍可点；数字在 pill 内不换行（真机量高度） | L1 + L3 · `test/market-model.test.mjs` + `test/market-view.test.mjs` |
| **K55** | 单范围：默认「所有来源」、菜单三项、一次仍只问一个范围 | `queriedSources` / `pagedSources` + 工具栏渲染 | 缺省 `filters.source === 'all'`、菜单三项（`所有来源` / `SkillHub` / `ClawHub`）、`queriedSources` 恒为一个 scope（`all` 走「不带 `source`」的那次请求，不是扇出）、游标为 `null` 才不翻；来源锚点显示 `所有来源`；ClawHub 档**有**分类行（`hasCategories: true`），三个 scope 都渲染，只是数字按 scope 各算 | L1 + L3 · `test/market-model.test.mjs` + `test/market-view.test.mjs` |
| **K56** | 图标 `object-fit: contain`（宽幅 logo 不裁切） | 样式表 + 宽幅图条目 | `.skc_marketIconImg` 的声明逐条等于 `border-radius: calc(var(--dsw-radius-lg) - .5px)` / `width: 100%` / `height: 100%` / `object-fit: contain` / `display: block`（只把 `cover` 换成 `contain`，没顺手加东西）；整个样式表不再出现 `cover`；真机上 256×64 这类宽幅 logo 完整可见且不撑破 48px 盒 | L3 + L4 · `test/market-view.test.mjs` + 真机专项 |
| **K57** | ClawHub 图标：列表零额外请求 + 批量补齐 | 假 io（镜像列表即查询端点）+ 两种 `iconUrl` 形态 + 路由层批量 | 归一只有两种形态：绝对 `https` 原样／其余 `null`（`lucide:` 与上传图标形态已随 U7 退场）；`list`/`search` 各**一次**请求、`items[i].iconUrl` 等于镜像给的值、**零额外请求**；`icons()` 每条一次列表查询、并发 ≤6、整批 6s、单条失败只 `null`、`icons`/`names` 逐键同序；正向 10min / 负向 60s 缓存与 `reset` | L3 + L2 · `test/market-icons.test.mjs` + `test/market-icons-names.test.mjs` |
| **K58**（**已退役 2026-11-09**） | Lucide 图标代理（第 10 条 exact） | —— | `clawhub.ai` 的 `lucide:<Name>` 形态随它退场，路由与 `LUCIDE_*` 常量、`createLucideIcons` 一并删除（U7）；**编号不复用** | 退役 · 无落点 |
| **K59** | 六组色板不随主题走 | `src/client/avatar.js` 与 `styles.js` 源码 | 色板六组是字面量（`rgba()` / `#RRGGBB`），不含 `--dsw-*`、`var()`、`currentColor`、`prefers-color-scheme`，也不读 DOM/计算样式；样式侧只通过 `--skc-avatar-bg` / `--skc-avatar-ink` 两个自定义属性接住，`.skc_cardIcon` 没有深色覆盖、也不自己定义这两个属性；`avatarOf` 传不传主题参数结果相同 | L1 + 门禁 · `test/avatar.test.mjs` |
| **K60**（**已退役 2026-11-09**） | `clawhub-icon` 代理（第 12 条 exact） | —— | 镜像给的是可直连的绝对 `https`，那条代理与 `CLAWHUB_ICON_*` 一并删除（U7）；**编号不复用** | 退役 · 无落点 |
| **K61** | 客户端渐进补齐（先字母后换图） | `market-model.js` 纯函数 + 真 store | 取值优先级 `item.iconUrl` → `market.icons[id]` → null（空串按「无」）；`iconCandidates` 只挑「ClawHub + 没图标 + 没问过 + owner/slug 齐全」，默认 ≤24、顺序随列表；`marketIconsReady` 只把非空值写进 `icons` 但**每个 id 都记 `iconsTried`（null 也记）**；`marketIconsAttempted` 整批失败只记 tried、`icons`／分页态／列表态一动不动；切来源/搜索/追加页（原 `marketReload` 是同口径路径，已按 S-16 删除）一样**保留**已拿到的 `icons`/`iconsTried`（只清分页）；空 batch 不改状态对象 | L1 · `test/market-icons-client.test.mjs` |
| **K75** | 收藏 store（`lib/market/favorites.js`） | 临时 `DSH_HOME` + 直接调 `createFavoritesStore` | 幂等：`favorited` 与现状一致 ⇒ 文件字节与 mtime 都不变、回包是当前列表；上限 500：第 501 条 ⇒ `E_FAVORITE_FULL`（409），取消永远允许（500 条时删一条成功）；损坏降级：`{` / `[]` / `{"favorites":3}` / 超长条目 ⇒ 空集 + `readable:false` 且**不抛**；原子写：写入失败时旧文件字节不变、目录里没有 `.favorites.*.tmp` 残留；串行化：并发两次 `toggle` 两条都在、不丢；读侧逐条丢坏条目（非字符串 / 空 / 重复 / 非三元组），同一批里好的照样留下 | L2 · `test/market-favorites.test.mjs` |
| **K76** | `POST market/favorite`（第 13 条 exact 路由） | 已挂载的 13 条路由 + 临时 `DSH_HOME` | 只认 POST（错方法 405 `E_METHOD`）；非 loopback ⇒ 403 `E_FORBIDDEN` 且**零 store 调用**；body 非对象 / `favorited` 非布尔 ⇒ 400 `E_BAD_REQUEST`；`owner:'../x'` 或未注册源 ⇒ 400 `E_BAD_QUERY`；成功出参恰好 `{favorites, favorited}` 且列表最新在前；重复收藏不写盘；满 500 ⇒ 409 `E_FAVORITE_FULL`；写盘失败 ⇒ 500 `E_FAVORITE_IO` 且失败信封不带 `data`；body 里额外塞 `id` / `path` 不生效（键由 Host 重拼） | L2 · `test/market-routes.test.mjs` |
| **K77** | `bootstrap` 的 `favorites` / `favoritesOk` | 同上 + 三种收藏文件（正常 / 损坏 / 缺失） | `bootstrap` 恰好**八**键；三种文件：正常 ⇒ 列表透传（最新在前）+ `favoritesOk:true`；损坏 ⇒ `[]` + `favoritesOk:false` 且**仍是 200**（市场页不失败）；**缺失（全新安装）⇒ `[]` + `favoritesOk:true`**（缺失 ≠ 损坏，首启不误报）；`?refresh=1` 不清收藏（刷新只清缓存） | L2 · `test/market-routes.test.mjs` |
| **K78** | `saves` / `score` 的两源取数与缺值口径 | 两源原始条目的四种形状 | SkillHub 的 `raw.stars`/`raw.score` 与 `stats.stars`/`stats.score` 两个取数位都生效；ClawHub 从镜像拿 `stars`/`score`（列表与详情都有，缺值才是 `null`）；非有限数 ⇒ `null`；上游真给 `0` ⇒ `0`（不是缺值）；`score` **不截断**（`95757.41562195931` 原样）；`rating` **不在** payload 里（Host 只给原料） | L1 · `test/market-normalize.test.mjs` |
| **K79** | 卡片结构与三段刻度 | 纯函数 + 渲染两半 | 纯函数：`statSegments` 恒三元素且**顺序是 `rating·downloads·saves`**、`present` 由 `Number.isFinite` 决定、`ratingOf` 四例不变（`100000⇒5.0` / `95757.4⇒5.0` / `55385⇒4.6` / `0⇒null`）、`authorTextOf` 三级回落（`owner/slug` → `owner` → `author`）、`metaSegments` 只剩作者与版本。渲染：头部是 `skc_marketHead`（`cardIcon` + `marketMain`[标题行 + 作者行] + `marketCardEnd`）、来源 `<img class="skc_marketSourceMark" alt="" title="SkillHub">`、作者行 `@ake/dev-god · v1.0.0`、三段 `aria-label` 依次「评分 4.6」「下载 12」「收藏 99」、`<button>` **恰好两个**（详情锚点 + 安装）、`skc_cardIcon` 仍在 | L1 + L3 · `test/market-model.test.mjs` + `test/market-view.test.mjs` |
| **K80**（**已退役 2026-11-09**） | 收藏的乐观翻转与代次防乱序 | —— | U5 按用户决定撤掉了卡片上的收藏入口：客户端 `marketFavoriteToggle/Ok/Fail`、代次与回滚一并删除，本用例**不再有落点**；后端收藏链路仍由 K75（store）/ K76（路由）/ K77（bootstrap）覆盖，将来接回 UI 时按 `docs/contracts/decisions.md` 附录 L 重开新号 | 退役 · 无落点（原 `test/state.test.mjs`） |
| **K81** | 点击层级门禁（一个动作位） | `src/client/**` 源码 + 样式表 | `.skc_marketCardOpen::after` 有 `inset: 0`；`.skc_marketCardEnd` 有 `z-index: 1` **且没有 `align-self`**；**整个样式表里没有 `.skc_marketFavorite`**；`.skc_marketTags` 与 `.skc_marketStats` 都不带 `z-index`（点标签/点数字 = 进详情）；卡片里没有 `<a>`、没有第二个动作位类、`<li>` 上没有 `onClick` / `role="button"` / `tabindex`、`stopPropagation` 零 | 门禁 · `test/market-gates.test.mjs` |
| **K82** | `tags` 的两源取数与归一化 | 两源六种上游形状（列表 / 搜索 / 详情，各缺/有 tags） | SkillHub 取 `subCategories[].name`（**不是 `key`**）且**保留大小写**（`Bug` / `API` 有意义）；ClawHub 也取 `subCategories[].name` 且**保留大小写**（U8 起两源同一张分类表，`topic` 转小写那一档已随 U7 删除）；ClawHub 的 `tags:{latest}` **不是标签**；≤3 条、单条 ≤24 字符（`clampLine` 的 ASCII `...`）、同值去重（逐字相同才合并）、空串/非字符串元素丢弃、非数组 ⇒ `[]`；`tags` 恒存在且**不是 `null`**；详情里的 `item.tags` 与列表同形 | L1 · `test/market-normalize.test.mjs` |
| **K83** | 标签行渲染与刻度 | 有 3 枚 / 有 1 枚 / `[]` 三张卡 | 有 tag ⇒ `<ul class="skc_marketTags">` + 每枚 `<li class="skc_marketTag" title="…">`（纯文本，**不是** button / a）；`[]` ⇒ 整行不渲染（`marketTags` 不出现）；标签在 `marketBody` 内、在描述之后三段之前；样式表逐字：`.skc_marketTags` 的 `flex-wrap:wrap; gap:6px; list-style:none`、`.skc_marketTag` 的 `border:.5px solid var(--dsw-alias-border-l2)` / `border-radius:var(--dsw-radius-sm)` / `padding:1px 6px` / `font-size:11px; line-height:16px` / `white-space:nowrap; text-overflow:ellipsis; overflow:hidden`；市场块零颜色字面量（K41 照旧） | L3 + 门禁 · `test/market-view.test.mjs` + `test/market-gates.test.mjs` |
| **K84** | 卡片新结构：头部两行块 + 单一动作位 + 三段新顺序 | 一张 SkillHub 卡 + 一张 ClawHub 卡（三段缺两格）；安装四态各一版 | 头部 DOM 顺序 = `cardIcon` → `marketMain`（内含 `marketTitleRow`[标题 + 来源图] + `marketMeta`）→ `marketCardEnd`（内含安装）；描述 / 标签 / 三段在 `marketBody` 内、是卡片的**直接子块**（不在 `marketMain` 里）；`<button>` **恰好 2 个**（详情锚点 + 安装）；三段顺序 `rating·downloads·saves`（ClawHub 卡渲染成「空 / 下载 / 空」且空格无文本）；安装四态文案与 `disabled` 与 U2 一致（K38 既有四态断言保留）；`.skc_marketCardEnd` 有 `z-index:1`、`.skc_marketHead` 无 `z-index`、`<li>` 无 `role` / `tabindex` / `onClick` | L3 + 门禁 · `test/market-view.test.mjs` + `test/market-gates.test.mjs` |
| **K85** | 撤掉客户端收藏、保住后端（负向门禁） | `src/client/**`、`locale/*.json`、`lib/**`、样式表 | **客户端已撤（逐条为 0）**：`marketFavoriteToggle` / `marketFavoriteOk` / `marketFavoriteFail` 三个 action 名、`api.marketFavorite`、`market/favorite` 这条字面量、`toast.jsx` 的 `favorite-failed`、样式表的 `.skc_marketFavorite`、两份字典的 4 个 `market.favorite*` 键；**读侧仍在（逐条为真）**：`marketFavoritesLoaded` 在 `state.js` 与 `market-panel.jsx` 各出现一次、`initialMarket()` 里仍有 `favorites:{}` 与 `favoritesOk:true`；**后端仍在**：`lib/market/favorites.js` 存在、`ROUTES.marketFavorite === '/api/dsh-skill-panel/market/favorite'`、`bootstrap` 仍返回 `favorites` / `favoritesOk`、两份字典仍有 `error.E_FAVORITE_FULL` / `error.E_FAVORITE_IO` | 门禁 · `test/market-gates.test.mjs` |

| **K86** | 镜像条目的归一化与身份兜底 | 假 `io` 返回 SkillHub 形状的 `source=clawhub` 页（含 `upstream_owner_login`、`clawhub_` 前缀、两者皆缺、`slug` 空四类） | `owner` 取 `upstream_owner_login`；缺则剥 `clawhub_` 前缀；剥不出来或 `slug` 空 ⇒ **丢条目**（`items` 里没有它、也不抛）；`id` = `clawhub:<owner>:<slug>`（与图标缓存键、已安装行 `_meta.json` 逐字相同）；`downloads` / `saves`(stars) / `score` **不再是 `null`**；`iconUrl` 是绝对 `https`（`skillhubIconUrl` 判据）；`tags` = `subCategories[].name`（保留大小写）；`category` 非 `null`；`version` 只接受 `versionLike`（`a1b2c3…` 这类 id ⇒ `null`）；`packageKind` 恒 `files` | L1 · `test/market-normalize.test.mjs` |
| **K87** | 镜像分页、游标与末页判定 | 假 `io` 记录 URL | `list` 只打一次 `GET {镜像}/api/skills`，参数含 `page`、`pageSize`、`sortBy`/`order`、`source=clawhub`、`keyword`（搜索时）、`category`（有值时）；游标是 `{page}`；`page*limit >= total` ⇒ `next === null`；**丢条目造成的短页仍给下一页**（12 条里丢 2 条、total 100 ⇒ `next` 非 `null`）；空页 ⇒ `next === null`；非法游标（`{cursor:"x"}` / `{page:0}`）⇒ `E_BAD_QUERY`；`data.skills` 不是数组 ⇒ `E_SOURCE_BAD_RESPONSE`；`total` 透传数字；空关键词的 `search` 本端拒绝（`E_BAD_QUERY`，不发请求） | L2 · `test/market-sources.test.mjs` |
| **K88** | 单源边界：目录 / 详情 / 安装包全部只走 `api.skillhub.cn` | 假 `io` 分别记录 URL 与失败注入 | `list`/`search`/`detail`/`plan`/`fetchFile` 的每一次上游调用**主机只有 `api.skillhub.cn`**（出现 `clawhub.ai` 即红，`lib/**` 里也零出现）；`detail` 的第 1 个请求是 `GET /api/skills?...keyword=<slug>&pageSize=20&source=clawhub`，它**同时**解析出 `namespace` 与 `score`，第 2 个才是 `GET /api/v1/skills/<slug>?namespace=`；一次 detail 的上游请求数恒为 **4**（解析 + 详情 + 清单 + `SKILL.md`），`item` 的 `downloads`/`saves`/`category`/`iconUrl` 来自镜像自己的详情载荷；**同名不同 owner 的两条并存时只认 `upstream_owner_login` 相同的那条**（slug 单独不唯一）；**零命中 ⇒ `E_SOURCE_BAD_RESPONSE`（502）且不再发详情/清单请求**（宁可不给详情，也不猜 namespace）；**仍不抛、键在值 `null` 的只有 `icons()` 的坏行/零命中**（见 K92） | L2 · `test/market-clawhub-mirror.test.mjs` |
| **K89** | 图标管道与分类开关不回归（负向门禁） | `lib/market/sources/clawhub.js` / `index.js` 文本 + `descriptors()` | `clawhubSource.icons` 仍是函数、`icons()` 仍按 `clawhub:<owner>:<slug>` 出 `{icons, names}`（K57 第二段的既有断言照跑）；`ROUTES.marketIcons` 仍在、`marketLucide` / `marketClawhubIcon` 已删（U7）、路由共 12 条（U1 起含 `detail`）；`descriptors()` 里两源 `hasCategories === true`、`packageKind === 'files'`，`SCOPES` 三项且 `all` 无适配器；`bootstrap` 只算**被问的那一档**（`sourceParam` 参与 `pageSize=1`，缓存按档分开，`countsOk` 语义不变） | 门禁 · `test/market-gates.test.mjs` |

| **K90** | 镜像包的完整性闸（`E_PACKAGE_INVALID` 全表） | 假 `io`：`files` 为非数组 / 空数组 / 无 `SKILL.md` / 含 `../x` / 同一路径两次 | 非数组 ⇒ `E_SOURCE_BAD_RESPONSE`（上游违约）；空清单与无 `SKILL.md` ⇒ `E_PACKAGE_INVALID`（`plan()` 与 `install.js` 各拦一次）；`../x` 与重复路径 ⇒ 安装阶段 `E_PACKAGE_INVALID`（`isSafeRelativePath` / 去重）；**任何一条路径都不得在 `skills/` 下留目录、也不得留 `.skc-install-*`**；`plan().packageKind === 'files'`、`meta === null` | L2 · `test/market-clawhub-mirror.test.mjs` |
| **K91** | `fetchFile` 的 302 白名单与失败面 | 假 `getBytes`：白名单域 / 非白名单域 / 连续两次 302 / 超时 / 0 字节 / 清单外路径 | 白名单域 ⇒ 返回字节；非白名单与两次 302 ⇒ `E_PACKAGE_INVALID`；超时 ⇒ `E_SOURCE_TIMEOUT`；0 字节照实返回（由安装器按 `E_PACKAGE_INVALID` 拒）；**清单外的 `path` 连请求都不发** | L2 · `test/market-clawhub-mirror.test.mjs` |
| **K92** | `icons()` 的双匹配、并发、缓存与降级 | 假 `io`：同名不同 owner 两行、零命中、缺 `iconUrl`、24 条批量、按时钟 | 只认 `slug` 与 `upstream_owner_login` **同时相等**的那行；零命中 ⇒ 键在、两张图都 `null`、**不抛**；并发 ≤6、按请求顺序返回、`icons`/`names` 逐键同序；正向 10min 命中不重发、负向 60s（空答案才走负向档） | L2 · `test/market-clawhub-mirror.test.mjs` |
| **K93** | 单源退场（负向门禁） | `lib/**`、`src/client/**`、`index.js`、`descriptors()` | `lib/**` 与 `src/client/**` 文本里 **`clawhub.ai` 零出现**；`readZipEntries` / `readZipEntry` / `createLucideIcons` / `createClawhubIconProxy` / `lucideProxyUrl` / `clawhubIconUrl` / `fromClawhubDetail` **全为零引用**；`index.js` 注册 **11** 条且不含 `market/lucide` / `market/clawhub-icon`；`descriptors()` 两源都是 `packageKind:'files'` | 门禁 · `test/market-gates.test.mjs` |

| **K94** | 范围轴：`source` 的缺省与映射 | `parseListQuery` 直喂（无 / `all` / `skillhub` / `clawhub` / `bogus` / `community`） | 缺省与 `all` ⇒ `scope:'all'`、`sourceParam:null`；`skillhub` ⇒ `community`；`clawhub` ⇒ `clawhub`；`bogus`/`community` ⇒ `E_BAD_QUERY`；**`all` 传给 `detail`/`install`/`icons` ⇒ `E_BAD_QUERY`（三个白名单必须分开）**；`bootstrap` 的 `sources[]` 三项且第一项是 `all`、回显 `source` | L1/L2 · `test/market-query.test.mjs` + `test/market-routes.test.mjs` |
| **K95** | 身份轴：按行折叠与键空间 | `fromMirrorRow` 直喂混合行（`community` / `enterprise` / `clawhub` / 缺 / `''` / 未知 / 非字符串） | 折叠成 `skillhub`/`skillhub`/`clawhub`；缺与未知 ⇒ **丢条目**；`enterprise` 行 owner 取 `namespace.handle`、`clawhub` 行取 `upstream_owner_login`；**同一技能跨 scope 的 `id` 逐字相同**；折出来的身份必在 `SOURCE_IDS` 里（永不为 `all`） | L1 · `test/market-normalize.test.mjs` |
| **K96** | 按 scope 的计数与缓存 | 假 `io` 记录 URL；三档三个不同数 | 三档的 `pageSize=1` 请求分别带 `source` 空 / `community` / `clawhub`；同一分类三个不同数字；**缓存按 `sourceParam` 分开**（切回上一档 0 请求）；一档失败不污染别档；`refresh=1` 清该档 | L2 · `test/market-counts.test.mjs` |
| **K97** | 排序四项与映射 | `SORT_PARAMS` + `buildUrl` | `stars` ⇒ `sortBy=stars&order=desc`；四档逐个对齐；`sort=bogus` ⇒ `E_BAD_QUERY`；`source`+`category`+`sort` 三参数同时在 URL 里，`all` 那档不带 `source` | L1 · `test/market-query.test.mjs` |
| **K98** | 客户端：三个 scope + 四个排序 | 纯函数 + store | `MARKET_DEFAULT_SOURCE === 'all'`；`MARKET_FALLBACK_SOURCES` 三项且 `clawhub.hasCategories === true`；`MARKET_SORTS` 四项含 `stars`；`visibleCategories` 三档都可见；`emptyKindOf('all')` **永不**返回 `'source'`；切 scope ⇒ `cursors` 清空、**`items` 保留**（重取期间旧卡直出，M10）+ `categoriesLoading` 置位 + `bootScope` 未换时补一次 bootstrap，新数字到达后 `bootScope`/`total` 跟着换 | L1/L3 · `test/market-model.test.mjs` + `test/market-view.test.mjs` + `test/state.test.mjs` |

| **K99** | 搜索框：× 在框内、清空即提交、IME 不误提交 | 字符串渲染 + hooks 直驱（无 DOM） | `.skc_marketSearchField` 在工具栏里、宿主 `Input` 与 `button` 都是它的子节点、按钮在容器闭合之前（不是工具栏的兄弟）；× 只在有文字时渲染、`type=button` + `aria-label`/`title`；样式断言：容器 `position:relative`/`flex:1`/`min-width:120px`、搜索框 `padding-right:32px`+`box-sizing:border-box`+`width:100%`（且不再自己吃 `flex:1`）、按钮 `position:absolute;right:5px;top:50%;translateY(-50%)`+24×24+`border:0`+无颜色字面量；点 × ⇒ `onInput('')` 后 `onCommit('')`，store 的 `input` 与 `keyword` 同时为空，且焦点回到输入框（`querySelector('input').focus()`）；组字中回车不提交、`onCompositionEnd` 后回车立即提交、`keyCode 229` 也算组字、非 Enter 键永不提交 | L3 · `test/market-search.test.mjs` |

| **K100** | 工具栏恒三子元素；加载更多提示在列表底部 | 字符串渲染（同一 store 的加载 / 空闲两态） | 工具栏的子元素恰好 3 个（搜索框 + 来源菜单 + 排序菜单）；工具栏里**没有**状态圆点、也没有加载提示；**加载态与空闲态的工具栏逐字相同**（搜索框不再被挤窄 21px）；`.skc_marketLoadMore` 出现在 `</ul>` 之后、带 `aria-hidden="true"`、文案复用 `market.loadingMore`；同一状态下 `role="status"` 只比空闲态多一条（sr-only 播报，视觉件不重复朗读）；`items` 为空的首屏加载**不画**这一行（那是骨架的事） | L3 · `test/market-view.test.mjs` |

| **K101** | 市场重取期间不换骨架、不插尾部占位卡 | 字符串渲染（真 store：已加载一页 → `marketSetFilter({source:'clawhub'})`——面板重取的 driver，`marketReload` 已删除见 K49；它同样只清分页、保留 `items` → `marketListLoading`） | `items` 留 1 条、`listStatus='loading'`（**不是 idle**）、`page.status='loading'`、`pages=0`；真卡片 1 张、**占位卡 0 张**（`skc_marketSkeletonAction` 计数）、没有带 `role="status"` 的 `ul.skc_marketGrid`（不是整页骨架）、没有 `.skc_marketLoadMore`、也没有到底/重试页脚；`ul.skc_marketGrid` 与 `.skc_marketSection` 都 `aria-busy="true"`；播报只有一条「正在读取技能市场…」 | L3 · `test/market-view.test.mjs` |

| **K102** | 追加下一页仍画尾部 3 张占位卡与「加载更多」行（U10 不回退） | 同上：`pages=1` + `marketPageStart` | 真卡 1 张 + 尾部占位 **3 张**（`skc_marketSkeletonAction` 计数，挂在 `ul.skc_marketGrid` 内、真卡之后）、**不是**整页骨架；`.skc_marketLoadMore` 恰好 1 条且在 `</ul>` 之后；「正在加载更多」出现 2 次（视觉行 + sr-only，视觉行 `aria-hidden`） | L3 · `test/market-view.test.mjs` |

| **K103** | 重取与追加互斥：任何一刻 `role="status"` 最多一条 | 字符串渲染，四态（首屏 / 重取第一页 / 追加 / 空闲） | 首屏（列表为空）：6 张骨架 + **只有骨架那一条** status（叠加的 `skc_progressAnnouncement` 为 0，改前是 2 条）；重取第一页（列表还在）：恰好 1 条、是 sr-only 播报器、文案「正在读取」、不说「加载更多」；追加：恰好 1 条、文案「正在加载更多」、播报器在视觉行之前；空闲：0 条 | L3 · `test/market-view.test.mjs` |

| **K104** | 搜索重取（关键词落定）期间同样只留旧列表 | 同上：两页已加载 → `marketCommitKeyword('ui')` → `marketListLoading` | `keyword='ui'`、`items` 2 条留着、`pages=0`、`page.status='loading'`；真卡 2 张、**尾部占位卡 0 张**（改前这里是让文档长高一行 ≈206px 的原因）、没有 `.skc_marketLoadMore`、不换整页骨架；只有一条「正在读取」播报、不混用「正在加载更多」 | L3 · `test/market-view.test.mjs` |

| **K105** | 切筛选（来源 / 分类 / 排序）保留列表、只清分页（M10） | 真 store：一页卡 + 详情已开，三条路径各打一次补丁 | 三条路径都：`items` **同一数组引用**（卡片不重挂）、`listStatus='ready'`、`pages=0`、`cursors={}`、`exhausted={}`、`page.status='idle'`、`detail=null`；`categoriesLoading` **只在换 scope 时**置位（换分类/排序不碰 chips）；随后 `marketListLoading()` ⇒ `listStatus='loading'` 而 `items` 仍 2 条（骨架判据「loading + 空列表」不成立）；三个筛选都是原值时状态对象一动不动 | L1 · `test/state.test.mjs` |

| **K106** | 换来源的等待期不换骨架、不插尾部占位；答案落地整表替换（M10） | 字符串渲染（真 store：一页卡 + boot 已答 → `marketSetFilter({source})` → `marketListLoading`） | 等待期：真卡 1 张、**占位卡 0 张**（`skc_marketSkeletonAction` 计数）、没有带 `role="status"` 的 `ul.skc_marketGrid`、没有 `.skc_marketLoadMore`、网格 `aria-busy="true"`、`role="status"` 恰好 1 条且不是「加载更多」；答案落地后只有 1 张卡、是新 scope 的 id、旧 scope 的 id 不在 DOM 里（`loadFirst` 不带 `existing`，旧卡不串进新查询） | L3 · `test/market-view.test.mjs` |

| **K107** | 换来源时 chips 行只有一行：旧数字就地换新，不叠占位行 | 字符串渲染（`categoriesLoading` 两态：已有 chips 行 / 首屏还没有） | `categoriesLoading && chips 行在` ⇒ `skc_marketSkeletonChip` **0 根**、`skc_marketChips` 恰好 1 行且是 `role="group"` 的真 chip 行、旧计数仍在（「全部」+ 各分类各一个 `skc_marketChipCount`）；首屏（没有 chips 行）⇒ 仍画 **6 根** `skc_marketSkeletonChip` 且没有真 chip 行 | L3 · `test/market-view.test.mjs` |

| **K108** | 落点键（`source\|category\|sort\|keyword`）只被筛选与搜索改动 | 真 store（面板 paint effect 的依赖面） | 默认键 `all\|null\|recommended\|`；**刷新 / 第一页在飞 / 追加在飞 / 一页落地 / 开详情 / 详情落地 / 关详情 / 记滚动 / 安装成功** 九个动作后键一字不变（所以「刷新保住原位置」成立）；换分类、搜索、换来源+排序各自改键。落点本身（写 `scrollTop=0`）要真 DOM，归 K50 那类真机验证 | L1 · `test/state.test.mjs` |

| **K109** | 描述三行真的画出来、块内三处间距对不对、卡片没被撑歪（U14 / U15 / U16 / U17 / U18） | 真机：1320×940 隔离实例，三列网格、24 张卡 | `.skc_marketDesc` 的描述盒高 ≤ **60px**（3 × 20px，U17 行距 13/20；短摘要 1/2 行 ⇒ **20 / 40**，**80 从不出现**）且 **上下 `margin` 都是 **0**（UA `margin:1em` 没漏回来，间距只由 `gap` 给）**，长描述在**第三行末尾**截断（省略号、不溢出卡片、不出现第四行）；块内三处间距实测（U18 定稿 **8 / 8 / 8**，各自只有一个来源）：**头→描述 8px**（卡片 `gap`）、**描述→标签 8px**、**标签→三段 8px**（后两条都来自正文 `gap`；描述 `margin` 上下都是 0，U16 那套「4 + 描述下边距 4」已拆掉）；**`summary` 为空的卡片头→标签也是 8px**（现在完全靠正文 `gap`，不依赖描述的下边距）；同一行卡片等高、卡高 **197px**（U18：③ 4→8 两次各 +4；U17 时 193）；标签行与三段数字都在卡片内、三段三格仍对齐同一 x（14/94/174）；工具栏恒 3 子元素宽 944px、网格恒 3 列、搜索框 768px。**取值本身**（`-webkit-line-clamp: 3` + **13/20** + `margin:0` + 卡片 `gap:8px` + 正文 `gap:8px`）由 K40 在门禁里钉死，本条只验几何 | L4 · 真机抽查（不进 `npm test`：几何要真机，做法同 K50/K51） |

| **K110** | 已安装行可点，且与开关互不触发（U1） | `view-row`：可写行 / 软链行 / 内置行各一版 | 标题是 `<button type="button" class="skc_cardTitle skc_cardOpen" title="<kebab>">`（软链行也一样，`title` 属性仍是 kebab 调用名）；`<li>` 上**没有** `onClick` / `role` / `tabindex`；整行**没有** `<a href>`；源码里 `stopPropagation` 零出现；行内 `<button>` 恰好 2 个（标题 + 开关；内置行同样是标题 + provider 开关，见 `routes.md` §3.4.1）、1 个或无（软链行 / 无文件行只有标题，`roTag` 是 `<span>`，右侧整块不渲染）；样式表里 `.skc_card` 有 `position:relative`、`.skc_cardOpen::after` 有 `inset: 0`、`.skc_cardEnd` 有 `z-index: 1`，hover 只在 `@media (hover:hover)` 内、`:active` 与 `:focus-visible::after` 都在 | L3 + 门禁 · `test/view-row.test.mjs` + `test/styles.test.mjs` |
| **K111** | 详情就地替换、返回不重拉、跨页签存活、刷新关详情（U1） | 真 store：`openDetail(row, top)` → `detailLoading/detailReady` → `closeDetail`；切页签；点刷新 | `openDetail` 后 `detail={key,status:'loading'}` 且 `detailScrollTop` = 传入值，**`payload` 与 `market.pages` 一字不动**；`detailReady(key,data)` 落地为 `ready`，**旧 key 的响应被丢弃**（`detail.key !== key` 时状态不变）；`closeDetail()` 后 `detail=null` 而 `payload` 引用不变（不重拉）；`setTab('market')` 再切回，`detail` 仍在；详情打开时点页头刷新 = `detail=null` + `load('refresh')` 走一次 `list` | L1 · `test/state.test.mjs` + `test/view-page.test.mjs` |
| **K112** | 第 12 条路由的围栏与出参（U1） | 假 deps + 六种入参（正常 / 软链 / 内置行 / 未知名 / 坏名 / 带多余 `path` 参数） | `ROUTES.detail === '/api/dsh-skill-panel/detail'` 且 `Object.keys(ROUTES).length === 12`；`GET` 正常 ⇒ 200 `{name,path,size,truncated,body,files,filesTruncated}`，`body` 已去 frontmatter、`files` 含 `SKILL.md` 且路径是相对路径；软链行 `path` = `realPath`；内置行 200 且 `body === null`、`files === null`（**不是错误**）；未知名 404 `E_NOT_FOUND`；坏名 400 `E_BAD_NAME`（且**不触盘**）；`?name=x&path=/etc/passwd` 的 `path` 被忽略（结果与只带 `name` 逐字相同）；非 loopback 403、`POST` 405；256 KiB 以上的文件 `truncated === true` 且 `size` 是原大小；目录里点文件 / `node_modules` / 软链不算条目，超 200 条 `filesTruncated === true`；两个标志都**上屏**——`truncated:true` ⇒ 正文下出现 `detail.truncated`、`filesTruncated:true` ⇒ 文件列表后出现 `detail.filesTruncated`（`files` 为空时文件段整段不渲染、那句也不出现） | L2 · `test/routes.test.mjs` |
| **K113** | 正文渲染与兜底：两页共用一段实现（U1） | `installed-detail` 三态 + `markdown.jsx` | `status='loading'` ⇒ `detail.loading`；`status='error'` ⇒ `role="alert"` + 重试按钮（点它重新发一次请求）；`body === null` ⇒ `detail.noBody`（**不是**错误样式、没有重试）；正文非空 ⇒ `MarkdownText`（`markdown.jsx` 的 `MarkdownBlock`）且它的兜底段落是纯文本；`MarkdownText` 必须收到 `labels`（`code.{copyLabel,copiedLabel,toolbarLabels:{codeLabel,wrapLabel,unwrapLabel}}` + `footnotes`，6 个 `markdown.*` 键、按 `t` 记忆化）——缺了它宿主渲染围栏代码块时抛 `TypeError`，整篇正文回落成纯文本（含市场详情的上游概述）；**含围栏代码块的正文也必须走 `MarkdownText`**（宿主的代码块渲染读 `labels.code`，`MarkdownBlock` 不传 `labels` 会让整段回落成纯文本——真机 2026-11-10 复现）；`market-detail.jsx` 不再自己定义 boundary 类，两处 `import` 自同一个 `markdown.jsx` | L3 · `test/*.test.mjs` 的新增用例（QA 落地）+ `test/market-view.test.mjs` |
| **K114** | `Row.version` 透出与条件渲染（U1） | `scan`/`classify` 夹具 + 三版头 | `_meta.json` 的 `version` 是 1–64 字符的字符串 ⇒ `row.version` 原样；缺失 / 非字符串 / 空串 / 超 64 字符 ⇒ `null`；registry 胜出的行恒 `null`；`version` 不进 `classifySkill`（同一夹具加不加版本，`partition`/`rule` 完全相同）；头里有值画 Tag、无值**整块不渲染**（不出现「未知」） | L1/L3 · `test/scan.test.mjs` + `test/classify.test.mjs` + 详情页用例（QA 新增） |
| **K115** | 契约自洽门禁（U1） | 仓库文本 | `docs/contracts/routes.md` §3.3 头注说十六条、两张路由表合计 16 行（#1–#4、#14、#17、#18 + 市场九条，含 #15 `market/versions` 与 #16 `market/update`）、有 #14 行与 §3.3.3 §3.3.4 §3.7.7，§8.1 有 `E_ADD_NOT_FOUND`/`E_ADD_NOT_SKILL_DIR`/`E_ADD_SHADOWED`/`E_DELETE_IO` 四个新码，§8.6 有 `E_NOT_MARKET_INSTALLED`/`E_ALREADY_UP_TO_DATE`/`E_UPDATE_RESTORED`/`E_UPDATE_LOST`/`E_UPDATE_UNCONFIRMED` 五个新码，且 §3.7 头注的条数与共用 `guard()` 的名单跟表格一致；`docs/contracts/decisions.md` 有附录 Q 与附录 R（R-1 发布于上屏 / R-2 候选判据 / R-3 宿主四分支删除）；`docs/reference/host-plugin-page.md` 已有 §7 详情页读数与 §8 添加/卸载两条流程；`docs/contracts/visual.md` A.5 有 `.skc_cardOpen` 与「待真机取色」；`test/bundle-contract.test.mjs` 上限已抬到 **180000**（1.0.0 实测产物 **177491 B**，余 2509；U22 时为 177498 B，U19 是 160041 B，抬档理由见 `docs/contracts/decisions.md`）；`npm run check:i18n` 报 **197** 键（U20：+19 −2；U21：再 +11，字典 193 = 191 扁平 + `meta` 两项） | 门禁 · `test/market-gates.test.mjs` + `test/bundle-contract.test.mjs` + `npm run check` |


**红绿口径**：K28–K115 全部绿（**K33 / K58 / K60 / K80 已退役、号不复用**；K94–K109 的落点见上表末十六行）。编号是**增量**——K101–K104 为 U13、K105–K108 为 M10、K109 为 U14，接在前一个之后、未重排也未复用。**改值不改号**：U8、U13、M10、U14–U18 都只是就地改写原有的那条断言（K29/K35/K36/K37/K38/K42/K45/K55/K89/K93 与 K40/K45/K61/K72/K98），编号不动，**现行判据只以测试文件为准**（本表不复述断言细节，写在这里就会与代码打架）。**不进 `npm test` 的三条**是 K50 / K51 / K109（像素命中、真实上游、滚动容器与几何），由 agent 驱动无头浏览器在隔离 `DSH_HOME` 上验。用例总数与通过率**不写在这里**（每加一条就漂）；产物体积上限也不是 K 号，它是门禁（`test/bundle-contract.test.mjs`）。

---

### D.7 更新检测与覆盖安装用例编号（K116–K125）

「已安装」页签的自动更新检测与详情页的「更新」动作（覆盖安装 + 失败回滚）。设计见 `.agents/work/wip/U19-update-design.md`，规范见 `docs/contracts/routes.md` §3.7.7 §8.6、`docs/contracts/market.md` §7.10 §7.11 与 `docs/contracts/installed-detail.md`。K116 接 K115 往后排、全仓库唯一；**K33 / K58 / K60 / K80 已退役、号不复用**。

| 编号 | 目标 | 断言 | 层 |
| --- | --- | --- | --- |
| **K116** | `versions()` 适配器（§7.10） | 只打 `GET …/versions?namespace=`（SkillHub 的 namespace 就是 owner ⇒ 0 额外请求；ClawHub 首次那次 `keyword=` 解析照跑、之后命中缓存）；`publishedAt` 由 `createdAt` 归一（不可解析 ⇒ `null`，绝不补 0 / now）；`total` 是上游原始条数、`versions` 保留前 50 条；新在前**不重排**；`changelog`/`versionId`/`securityReports` 不出现在出参；`body.versions` 不是数组 ⇒ `E_SOURCE_BAD_RESPONSE`；两源同一实现 | L1 · `test/market-sources.test.mjs` |
| **K117** | `market/versions` 路由（§3.7.1 #15） | `ROUTES.marketVersions` 路径逐字；`source` 必填、传 `all` ⇒ `400 E_BAD_QUERY`、坏 `owner`/`slug` ⇒ `400`；正常 ⇒ 200 + `{source, owner, slug, namespace, latest, versions, total}`；上游 502/503/504 透传；非 loopback 403、`POST` 405 | L2 · `test/market-routes.test.mjs` |
| **K118** | 检测对象、缓存与预算 | `detectionTargets` 只收「`upstream !== null` ∧ `symlink !== true` ∧ `version` 非空」；同 identity 去重；`needsCheck` 的 TTL = 600000、`skipped` 下次必重试；一轮串行（并发恒 1）；单行 2s / 整轮 8s ⇒ 截断行落 `skipped`；一行 5xx 只让该行 `offline`、其余照落；刷新与「重新检查」忽略 TTL；同一 identity 多目录只发一次请求 | L1 · `test/model.test.mjs` |
| **K119** | 页头四态（D4） | `.skc_status` 里**一个** `<span>`（宿主同位只有这一句，`data-tone` 只做 info/error 换色）；可更新（`info`）/ 部分失败（`error`）/ 全最新（无色）/ 未 done 与**无检测对象**时不渲染；优先级 1>3>2；状态位里不出现计数文案（K26） | L3 · `test/view-page.test.mjs` |
| **K120** | 版本区块五态（D5） | 挂载即 `detail.checking` 且按钮禁用；一致 ⇒ `detail.upToDate` + `.skc_detailVersionMark` + 副行 `detail.checkedAt`；不一致 ⇒ `detail.newerVersion`；`E_SOURCE_*` ⇒ `detail.checkOffline`；形状不符 / 无本地版本 ⇒ `detail.checkFailed` 且**不发请求**；重查中保留上次主文案；软链行整块不渲染 | L3 · `test/view-installed-detail.test.mjs` |
| **K121** | 展开列表（D6） | `count` = 当前版本之前的条数（不在列表时 = `total`）；最多 5 行 + 尾行 `detail.moreNewVersions`；**只有候选行**有 `detail.updateTo`；当前行挂 `market.installed`；`detail.publishedAt` 是 `YYYY-MM-DD`；不出现 changelog | L3 · 同上 |
| **K122** | 更新按钮与确认弹窗（D7） | 非「不一致」态**不渲染**更新按钮（不是 disabled）；动作组顺序 更新 → 卸载 → 开关；弹窗 `role="dialog"` + `aria-modal`、标题 `detail.updateTitle`、正文含 `{from}`/`{to}`、事实区三行、取消**零请求**且回「不一致」 | L3 · 同上 |
| **K123** | 更新成功与启用状态往返（D8/D13） | 成功后版本 Tag = `{to}`、卡面「已是最新版本」、展开器收起、正文重拉一次、列表后台重扫一次（两件事失败不报错）；停用 → 更新 → 新版 `SKILL.md` 仍停用、开关仍关；启用同理；CRLF/BOM 样本按 `lib/frontmatter.js` 保真 | L1/L2 · `test/market-install.test.mjs` + `test/model.test.mjs` |
| **K124** | 回滚四路与不变式（D9–D12/D14） | 暂存失败 ⇒ `SKILL.md`/`_meta.json`/台账逐字节等于更新前、无 `.skc-update-*`；交换失败回滚成功 ⇒ `E_UPDATE_RESTORED` 且旧版本完整；回滚也失败 ⇒ `E_UPDATE_LOST` 且目录不在、`.skc-backup-*` 保留；台账失败 ⇒ `E_UPDATE_UNCONFIRMED` 且目录是**新版本**；软链 409 `E_SYMLINK_READONLY`、身份不符 409 `E_NOT_MARKET_INSTALLED`、同版本 409 `E_ALREADY_UP_TO_DATE`、坏 path 409 `E_STALE_PATH`，四种都字节零改动 | L2 · `test/market-install.test.mjs` + `test/market-routes.test.mjs` |
| **K125** | 门禁同步（D15） | `Object.keys(ROUTES).length === 16`；§3.3 说十六条、§3.7.1 九条、§8.6 仍是二十个单码行（四个新码在 §8.1）；`check:i18n` 报 **197** 且 zh/en 键集相等；`check:client` 逐字节；产物 ≤ **180000** B（1.0.0 实测 **177491 B**，余 2509）；`check:docs`/`check:board` 0 warn | 门禁 · `test/market-gates.test.mjs` + `test/bundle-contract.test.mjs` |

**D16（真机）不新增 K 号**：端到端（装旧版 → 页头出「N 个技能可更新」→ 更新 → Tag/卡面/停用状态都对 → 断网时区块说「无法连接安装源」而已安装列表照常）按 K50 / K51 / K109 的先例留在真机抽查、不进 `npm test`。

### D.6 已安装行图标与标题用例编号（K62–K74）

已安装行的图标与市场卡片共用一条端点、一套缓存、一个视觉单元（`icon-tile.jsx`）。这一组用例守的是「身份只从 `_meta.json` 来、判据零改动、失败不升级」三条线；设计见 `docs/contracts/client.md` §3.9.6 与 `routes.md` §3.3.1 / §3.7.5。

| 编号 | 目标 | 断言 | 层 |
| --- | --- | --- | --- |
| **K62** | 身份透出：`ScanCandidate.upstream` | 我们写的 `_meta.json`（`source`+`ownerId`+`slug` 齐备）⇒ `upstream` 三元组逐字等于文件里的值且只有三个键；缺 `source`（外来记录 / Convex id）⇒ `null`；`owner:'../../x'`、`slug:'../etc'`、`a..b`、大写 `source`、`owner` 是数字、缺 `slug`、超长 ⇒ `null`（形状闸）；只有 `_skillhub_meta.json` ⇒ `null`（但 `metaSource` 仍为真）；`_meta.json` 是坏 JSON ⇒ `null` 且扫描不挂；真实 handle（含 `.` `_` `-`）与 slug 仍可信；`isUpstreamIdentity` 本体逐条（`..` 即使过字符类也拒） | L2 · `test/scan-upstream.test.mjs` |
| **K63** | R1–R7 判据零回归 | 九条判据各一条 fixture：加 `upstream` 前后 `partition`/`rule`/`confidence`/`evidence` 逐字段相同；**管线全表 32 组**（`mergeCatalog` 里 symlink×ledgerHit×metaSource×metaRelease×有身份）里 `upstream !== null ⇒ rule ∈ {R4,R5,R6}`（R4 落 local、R5/R6 落 installed）；身份单独存在（无任何元数据事实）时规则停在 R8/R9，不许把行抬进已安装；注册表胜出的行（14 组 provider×rank）恒 `upstream === null` | L1 · `test/classify-upstream.test.mjs` |
| **K64** | `POST icons` 收 per-item source | 混合批次（skillhub+clawhub）⇒ 两源的键都在、**按请求顺序**、完整键 `source:owner:slug` 去重；每源只看到自己那几条；顶层 `source` 作缺省值生效、item 覆盖它；未注册源（顶层或条目上）⇒ `400 E_BAD_QUERY`；合计 >24 ⇒ `400 E_BAD_REQUEST`；一条坏条目会让整批 400（KI-R7-1 的现场，Host 侧目前由 K62 保证不会发出） | L2 · `test/market-routes.test.mjs` |
| **K65** | SkillHub `icons()` | 每条 1 次 detail、`namespace`=owner、**不带 `version`**；并发 ≤6；键按请求顺序；正向 10min / 负向 60s 缓存，命中不打上游、`resetSkillhubIconCache()` 清空；单条失败只 `null`、空 owner/slug 不发请求；`iconUrl` 只收绝对 `https`（`http:`/相对/协议相对/数字/对象/空串/空白 ⇒ null）；整批 6s 预算耗尽后剩余条目 `null` 且结果齐全 | L1 · `test/market-icons-skillhub.test.mjs` |
| **K66** | 单源失败不连坐 | SkillHub 适配器整体抛错 ⇒ 仍 `200`、`code:'OK'`、skillhub 的键全 `null`、clawhub 的键照常有值、键序不变 | L2 · `test/market-routes.test.mjs` |
| **K67** | `iconBatch` 选择器 | 市场条目先于已装行、按 `source:owner:slug` 去重；每源 ≤12、总 ≤24；未知源/无身份/空 owner-slug 之外的各种跳过（已有 `icons`、`iconsTried` 命中、市场条目自带 `iconUrl`）逐条生效；两源各算各的额度；空/坏输入不抛。**注**：客户端不校验 owner/slug 非空（Host 已保证形状，见 KI-R7-1） | L1 · `test/market-icons-batch.test.mjs` |
| **K68** | 渲染与容器零回归 | `SkillRow` 传 `iconUrl` ⇒ 盒内有 `<img class="skc_marketIconImg">`、`alt=""`、整行**只有一个**可交互元素、无 `<a>`/无 `tabindex`/无内联 `onclick`；不传（或空串）⇒ 与改动前的字母瓦片逐字节相同、且等于 `IconTile` 的字母形态；`MarketIcon` 与 `IconTile` 对同一 `iconUrl` 输出逐字节相同；`.skc_cardIcon` 六条容器声明（`box-sizing`/48×48/`.5px`/`radius-lg`/`padding-box`）与 `.skc_marketIconImg` 五条声明逐字未变；客户端只有一套上色/画图路径 | L3 · `test/view-icon-tile.test.mjs` |
| **K69** | 图标播种（`iconSeeds` / `marketIconsSeeded`） | `iconSeeds(market)`：只收 `iconUrl` 是非空字符串的市场条目，产出 `{[source:owner:slug]: url}`；空串/缺键/非字符串 ⇒ 不收；`market.icons` 已有该键 ⇒ 不再播（幂等：连调第二次返回 `null`，且缓存里已有的值不被覆盖）；`iconsTried` **不挡**播种；无任何可播种项 ⇒ `null`（不是 `{}`）。`marketIconsSeeded(icons)`：只写 `icons`、**不写 `iconsTried`**、不覆盖已有键、空/坏输入不改状态对象 | L1 · `test/market-icons-client.test.mjs` |
| **K70** | 瓦片任何一帧都不空 | `IconTile` 有 `iconUrl` 时：首帧瓦片内**必有内容**（字母文本，探测图不可见）；`onLoad` 后**只剩可见图**、字母消失；`onError` 后**只剩字母**、`<img>` 消失；无 URL（`null`/`''`/省略）⇒ 与改动前逐字节相同、连探测图都没有。探测图与可见图 **同 `src`**（只发一次请求的结构保证），探测图 `loading="eager"` + `style.display === 'none'`，可见图 `lazy` + `skc_marketIconImg`；容器四条几何（48×48 / `radius-lg` / `.5px` / `padding-box`）逐字未变，样式表里没有为探测图新增类 | L3 · `test/view-icon-tile.test.mjs` |
| **K71** | `names` 契约（两源同形） | `icons()` 出参 `{icons, names}` 且**逐键同序**（键按请求顺序、带源前缀）；`displayName` 只收非空字符串，空串/纯空白/数字/对象/缺失 ⇒ 该键**存在但值 `null``；标题与图标在同一份缓存条目里 ⇒ 命中时**零上游请求**且两者同时命中；`?refresh=1`（`reset*IconCache()`）把图标与标题一起清空 | L1 · `test/market-icons-names.test.mjs` |
| **K72** | 标题优先级 `rowTitleOf` | ①`market.names[key]` 命中 ⇒ 上游标题；②无上游标题、`row.displayName` 非空 ⇒ 本地 `metadata.displayName`；③两者都无 ⇒ kebab `row.name`；④`row.upstream === null` 时**一次都不读缓存**（Proxy 记录零访问）；⑤空串/非字符串不算有值。配套 `nameFor`（只认非空字符串）、`nameSeeds`（无可播种 ⇒ `null`、幂等、不覆盖、**不写 `iconsTried`**）、`marketNamesReady`（可覆盖种子、`null` 不落键）、切来源/搜索保留 `names` 与图标（只清分页；原 `marketReload` 同口径，已按 S-16 删除） | L1 · `test/market-names.test.mjs` |
| **K73** | 嵌套 `metadata.displayName` | 块内带引号/不带引号都读；**顶层 `display-name` 优先**（谁在前都算）；`metadata` 块里没有该键 ⇒ `undefined`；`metadata.summary: >` 块标量正文里的 `displayName:` 行**不得**被当成真键；BOM+CRLF 文件照读（读侧接字符串）；完全没有 `metadata` 块 ⇒ `undefined`；同一文件跑 `setDisableModelInvocation` 后仍只改开关那一行、行尾仍是纯 CRLF、嵌套标题与块标量原样 | L1 · `test/frontmatter.test.mjs` |
| **K74** | 行标题渲染 | 传 `title` ⇒ 可见文字是 `title`、tooltip 是 `row.name`，且不新增可点区域；**不传 `title` 时与改动前逐字节相同**（tooltip 仍是本地 `displayName`）；长标题整串渲染、单行省略（`nowrap`/`ellipsis`/`hidden`），`.skc_cardTitle` 的字号/行高逐字未变、没有多行截断一类新声明；标题里的 HTML 元字符被转义 | L3 · `test/view-row.test.mjs` |

---

---

### D.8 添加/卸载技能用例编号（K126–K137）

「已安装」页签的「添加技能」（只吃本机目录路径）与「卸载技能」（只删用户技能根下的真目录 + 清自有台账）。规范见 `docs/contracts/routes.md` §3.3.4 §8.1、`docs/contracts/client.md` §3.9.7 与 `docs/contracts/installed-detail.md` 的「卸载技能」一节；实现时的取舍与偏离见 `docs/contracts/decisions.md` 附录 S。K126 接 K125 往后排、全仓库唯一；**K33 / K58 / K60 / K80 已退役、号不复用**。

| 编号 | 目标 | 断言 | 层 |
| --- | --- | --- | --- |
| **K126** | 添加侧的纯判据（`lib/local/rules.js`） | `expandHome('~')` / `'~/a'` 按 `homedir()` 展开、绝对路径原样、相对路径与 `http://…` 与含 NUL 的串 ⇒ `null`；`skillNameOf(declaredName, dirName)` 声明名优先、空则目录名、两者都不合规 ⇒ `null`；清点上限常量恰为 `2000 / 8 MiB / 64 MiB`；`shadowOf(summaries, name)` 只在存在 `rank < rankOf('user-dsh')` 的同名摘要时给出 `{rank, provider}`（`rank === 400` 与 `rank === 600` 都返回 `null`） | L1 · test/local-rules.test.mjs |
| **K127** | 添加路由 S0–S5 | body 非对象 / `path` 不是非空字符串（含空串与全空白）⇒ 400 `E_BAD_REQUEST`；相对路径、点开头、URL、含 NUL、超 1024 ⇒ 400 `E_BAD_PATH`（`~` / `~/…` 前缀**不**报此码，展开后继续走 S2 之后）；不存在的路径 ⇒ 404 `E_ADD_NOT_FOUND`；普通文件 / 空目录 / `SKILL.md` 是软链 ⇒ 422 `E_ADD_NOT_SKILL_DIR`；声明名 `Design` 且目录名 `Bad` ⇒ 422 `E_SKILL_NAME_INVALID` 且 `data.declaredName === 'Design'`；非 loopback ⇒ 403 且**零磁盘改动**；`GET` ⇒ 405 | L2 · test/local-routes.test.mjs |
| **K128** | 同名与影子 | 目标名已有目录 / 普通文件 / 软链占位 ⇒ 409 `E_ALREADY_INSTALLED` 且 `data.path` 是那个占位路径，源目录与台账零改动；台账有记录但目录不存在 ⇒ **允许**（照装）；同名已有 `rank 250`（runtime）或 `rank 300`（custom，会被 R3 排除）的注册表行 ⇒ 409 `E_ADD_SHADOWED` 且 `data.provider` 是那条的 provider；同名只有 `rank 600`（bundled）或 `rank 400`（user-dsh）⇒ 照装成功（扫描行 400 在同名裁决里不输） | L2 · test/local-routes.test.mjs |
| **K129** | 添加落盘与不变式 | 成功 ⇒ `<skillsRoot>/<name>/SKILL.md` 存在、`files`/`bytes` 与实际复制数一致、台账多一条 `{source:'local', name, dirName, fromPath}`、`lib/ledger.js` 把该目录读成 R5（`partition === 'installed'`）、`∄ .skc-install-*`；**每条失败路径后**（S4/S5/S6/S7/S9/S10/S11 各造一次；其中 **S10 落位失败**与 **S11 回读名不一致**由 `createLocalSkills` 的可选 `copy` 依赖注入造失败点——`planCopy` / `copyPlan` / `landSkill` / `tempDirOf` 四个注入点，缺省走真实实现，注入不改变守卫顺序与错误码，所以这两条**由 L2 覆盖、不再算只能真机**〔QA 同轮落〕）⇒ `∄ <skillsRoot>/<name>`、`∄ .skc-install-*`、台账逐字节未变；台账写失败 ⇒ 500 `E_INSTALL_IO` 但目录**保留**；并发同名两次 ⇒ 一次 200 一次 429 `E_INSTALL_BUSY` | L2 · test/local-routes.test.mjs |
| **K130** | 源目录清点与包内软链 | 2001 条目 ⇒ 422 `E_PACKAGE_INVALID`；单个 9 MiB 文件 ⇒ 同码；总计 >64 MiB ⇒ 同码；源目录**内部**任一软链（文件或目录）⇒ 整次拒绝且**不静默丢文件**；`node_modules/` 与 `.gitignore` 这类点开头条目**不复制**但不算失败；源目录**顶层**是软链（指向真目录）⇒ 照装，落位的是真实目录（`lstat(skillsRoot/<name>).isSymbolicLink() === false`） | L2 · test/local-routes.test.mjs |
| **K131** | 卸载路由 D0–D7 | body 非对象 ⇒ 400 `E_BAD_REQUEST`；坏名 ⇒ 400 `E_BAD_NAME`（且**不触盘**）；未知名 ⇒ 404 `E_NOT_FOUND`；软链行 ⇒ 409 `E_SYMLINK_READONLY`（三层拦截的第三层，且目标目录零改动）；`path` 与重扫结果不等 ⇒ 409 `E_STALE_PATH`；内置行（`path === null`）⇒ 409 `E_NOT_WRITABLE`；`path` 指向 `skillsRoot` 直接子目录之外的层级（手工构造 `<skillsRoot>/a/b/SKILL.md` 的行）⇒ 409 `E_NOT_WRITABLE`；非 loopback ⇒ 403 且目录仍在；`GET` ⇒ 405 | L2 · test/local-routes.test.mjs |
| **K132** | 卸载成功与台账 | 200 ⇒ 目录整体不存在、`data.dir` 是那个目录、`data.ledger === 'cleared'`、台账里没有该 name；台账写失败 ⇒ **仍是 200** 且 `data.ledger === 'kept'`、`message` 提到台账（目录已删）；删完之后同名再装 ⇒ 成功（残留不拦）；软链指向的**源仓库**在任何一条卸载路径上都不被触碰（比对 `realpath` 目标的 mtime 与内容） | L2 · test/local-routes.test.mjs |
| **K133** | `deletable` 与详情头动作组 | `deletable(row)` 四条件逐条（`builtin` / `symlink` / `path===null` / `readonlyReason!==null` 各造一行 → false；普通已安装行 → true）；`InstalledDetail` 的 `.skc_detailActions` 顺序 更新 → 卸载 → 开关；`deletable` 为 false 时**整枚不渲染**（软链行仍是 `roTag`、内置行没有卸载位）；卸载请求在飞（`deleting`）⇒ 三枚一起 `disabled`、文案不变、无 `StateDot`；行内与卡片上**零新增可点元素**（仍是标题 `::after` + `.skc_cardEnd`） | L3 · `test/view-installed-detail.test.mjs` + `test/view-row.test.mjs` |
| **K134** | 添加弹窗三态 | 工具条：主按钮 + chevron 都渲染、`payload === null` 时两枚 `disabled`；点主按钮与点菜单项都打开同一个弹窗（`Menu` 只有一项 `add.fromPath`）；`idle` ⇒ 输入可编辑 + `add.run`；空输入时主按钮 `disabled`；提交后 `busy` ⇒ 输入 `readOnly`、按钮 `add.busy`、整块 `aria-busy`；失败回 `idle` ⇒ 字段下一行 `role="alert"` 显示 `error.E_*`、**输入内容保留**；成功 ⇒ `done` 屏（`add.done` + `market.installOkHint` + `add.close`）；IME 组字期间回车不提交（`keyCode 229` 同） | L3 · test/view-skill-dialogs.test.mjs |
| **K135** | 卸载确认与结局 | 确认弹窗 `role="dialog"` + `aria-modal`、标题 `delete.title`「卸载「{name}」？」、正文 `delete.body`「卸载后这个技能的文件会被永久移除，本机不再加载它。」、事实区**一行**（`delete.factDir`「目录」 + 目录、等宽；不复用 `market.factInstallTo`）、两枚按钮 `market.confirmCancel` / `delete.confirm`「卸载」；**没有勾选框**；取消 ⇒ **零请求**且回详情；点卸载 ⇒ **先关弹窗再发请求**（记录调用顺序）；成功 ⇒ `detail === null`（回列表）+ 一次 `load('refresh')` + `marketInstalledStale()` + **notice 仍是原来那一条/无新 toast**；失败 ⇒ `detail` 仍在、`.skc_reason` 有 `reasonKeyOf(code)` 的文案、`E_NOT_FOUND`/`E_STALE_PATH` 触发重扫 | L3/L1 · `test/view-installed-detail.test.mjs` + `test/state.test.mjs` |
| **K136** | 门禁同步（U20） | `Object.keys(ROUTES).length === 16`；§3.3 说十六条、本地面七条（#1–#4 #14 #17 #18）、市场面九条；§8.1 四个新码在表、§8.6 仍是二十个单码行；`check:i18n` 报 **197**；产物 ≤ **180000** B（1.0.0 实测 **177491 B**，余 2509；U22 时 177498 B）；`styles.js` **零新增**（四个挂点仍各有规则，条数逐点钉死：`.skc_addGroup` **1** / `.skc_addPrimary` **3** / `.skc_addMore` **2** / `.skc_detailDanger` **2**——`.skc_addPrimary` 本来就有三条〔基础形状 / 圆角修正 / 页头内修正〕，所以**不要求「每挂点只出现一次」**；`.skc_` 类名总数 **134**（U20 当时的基线；**U22 的添加菜单 +3 ⇒ 现为 137**，见 K148），多一个就是有人顺手加了新类；弹窗复用 `.skc_marketDialog` / `.skc_marketConfirmBody` / `.skc_detailActions`）；`check:docs`/`check:board` 0 warn | 门禁 · `test/market-gates.test.mjs` + `test/bundle-contract.test.mjs` + `test/styles.test.mjs` |
| **K137** | 页头状态位两段式（U20 验收后修订） | `headerUpdateNote` 纯函数语义不动；`done` 且无检测目标 ⇒ 不渲染 `.skc_status`；**首轮进行中**（没有任何一轮 `done`）⇒ 不渲染；**已有上一轮结论 + 新一轮进行中** ⇒ `.skc_status` 里那一句的**文本与 `data-tone` 与上一轮逐字相同**（不回退成空白、不换成「检查中」）；新一轮 `done` ⇒ **就地替换**成新结论（可更新 / 部分失败 / 全部最新三态按优先级）；新一轮结论为空 ⇒ 按「无对象」消失；刷新按钮的 `aria-busy` 只跟列表重扫，不因状态位保持而延长（列表重扫结束即恢复）；**页头工具条整行只在「已安装」页签渲染**——切到「技能市场」后 `.skc_toolbar`（状态位 + 刷新 + 添加组）**整行不渲染**，市场页签只有它自己的工具栏（搜索 / 范围 / 排序 / 分类）与整页错误态的「重试」 | L3 · test/view-page.test.mjs + L1 · test/model.test.mjs |

**红绿口径**：K126–K137 全部进 `npm test`（含 L3 的字符串渲染半边）；真机项是上面清单的第 9、10 两条，不进 `npm test`。

### D.9 GitHub 添加用例编号（K138–K147）

「添加技能」第二个输入形态（GitHub 仓库链接与 `github:o/r` 简写）：分类器是纯函数（`docs/contracts/data-model.md` §3.2.6），克隆与定位在 `lib/local/{git,index}.js`，之后**并入 U20 的 S5–S12**（守卫顺序与错误码一字不改，见 `docs/contracts/routes.md` §3.3.4）。两侧的取舍与偏离见 `docs/contracts/decisions.md` 附录 T。

| # | 目标 | 断言 | 层 |
| --- | --- | --- | --- |
| **K138** | 分类器：path 形态零回归 | `/abs/path` ⇒ `{kind:'path'}`；`~/x` 与 `~/x/y` 由 S1 展开后仍落 `E_BAD_PATH`/正常路径；空串、全空白 ⇒ `400 E_BAD_REQUEST`（U20 S0 不变）；**`./rel` 与裸 `o/r` 不再落 `E_BAD_PATH`**（改落 `E_GIT_SPEC_INVALID`，见附录 T-2） | L1 |
| **K139** | 分类器：接受面（宿主那一列是它自己 `parseInstallSpec` 跑出来的） | 30 行矩阵的接受组逐行解析出正确的 `{owner,repo,ref,subdir}`：`https://github.com/o/r`（ref/null）、`.git`（归一）、**尾斜杠**（归一，宿主实测拒）、**`/tree/main/skills/foo`**（ref+subdir，宿主实测拒）、`/tree/v1.2.3/x`（标签当 ref）、`/tree/main`（subdir null）、`/tree/main/x/`（尾斜杠）；`github:o/r`、`github:o/r#path:skills/foo`、`https://github.com/o/r#path:skills/foo`；`https://www.github.com/o/r`（`*.github.com` 接受）；scheme/host 大小写折叠；首尾空白 trim | L1 |
| **K140** | 分类器：认不出 ⇒ `E_GIT_SPEC_INVALID`（400） | 裸 `o/r`、`o/r@v1`、`./rel/path`、`github.com/o/r`（无 scheme）、`/blob/main/SKILL.md`、`/issues/1`、`/releases`、`/tree/<40 位 sha>/x`、`#path:` 与 `tree` 同时给、git 形态 > 2048 字符、`https://github.com/o`（段数不足）、`https://github.com/`（空段）——逐条只回这一个码，且**不产生任何子进程调用**（注入假 `git` 的调用计数为 0） | L1 |
| **K141** | 分类器：形态对但不在支持面 ⇒ `E_GIT_NOT_SUPPORTED`（400） | `gitlab:o/r` / `bitbucket:o/r` / `gist:x`、`https://gitlab.com/o/r`、`git@github.com:o/r.git`、`ssh://git@github.com/o/r`、`git://…`、`git+ssh://…`、`…/releases/download/v1/x.tgz`（`.tgz`/`.tar.gz` 结尾优先判）、`https://user:tok@github.com/o/r`（URL 带凭据）——逐条只回这一个码 | L1 |
| **K142** | G3 克隆：四条失败映射 + 加固 + 清理 | 注入假 `git`：`throw {code:'ENOENT'}` ⇒ `500 E_GIT_MISSING`；`{timedOut:true}` ⇒ `504 E_GIT_TIMEOUT`；stderr `remote: 404` / `could not read Username` / `Authentication failed` / `Remote branch … not found` ⇒ `404 E_GIT_REPO_NOT_FOUND`；stderr 网络族（`Could not resolve host` / `ECONNRESET` / `SSL`）与**任意其它** stderr ⇒ `502 E_GIT_UNREACHABLE`；每条失败后 `∄ .skc-clone-*`；argv 断言为 `clone --depth 1 --single-branch [--branch <ref>] --no-recurse-submodules -- https://github.com/<o>/<r>.git <dir>`；**env 断言按实际口径逐键比**（自建、**不带父环境**：`PATH`/`HOME`/可选 `TMPDIR` + `LC_ALL=C` + `GIT_TERMINAL_PROMPT=0` + 空 `GIT_ASKPASS`·`SSH_ASKPASS` + `SSH_ASKPASS_REQUIRE=never` + `GCM_INTERACTIVE=never` + `GIT_CONFIG_COUNT=1`/`GIT_CONFIG_KEY_0=credential.helper`/`GIT_CONFIG_VALUE_0=''`，共 **11–12 键**，`TMPDIR` 视父环境有无；**不要钉「七项」这种数量**）、`timeout=60000`、输出截断 16384 | L2 |
| **K143** | G4/G5 定位三级与多候选 | ① 给了 subdir ⇒ 只认 `<root>/<sub>/SKILL.md`，**不再往下探测**（`<sub>` 里没有 SKILL.md ⇒ `422 E_ADD_NOT_SKILL_DIR`，即使别处有）；越界 subdir（`../x`、绝对、NUL）⇒ `E_ADD_NOT_SKILL_DIR` 或 `E_GIT_SPEC_INVALID`（形状在分类器、越界在定位层）；② 没给 subdir 且根有 ⇒ 源目录 = 根；③ 都没有 ⇒ 深度 ≤4 探测：恰好 1 个 ⇒ 用它（不提示）；0 个 ⇒ `422 E_ADD_NOT_SKILL_DIR`；≥2 个 ⇒ `422 E_ADD_AMBIGUOUS_SKILL` + `data.candidates`（**目录相对路径**、去重、按字符串排序、≤10 条）+ `data.candidateTotal` + **`data.owner` / `data.repo`**（**失败信封里必须给全这两个**：客户端靠它们把输入改写成 `github:<o>/<r>#path:<sub>`，缺了就画不出候选按钮——U21 修过的缺陷 P1，见附录 T-15）；跳过 `.git`/`node_modules`/点开头、不跟随软链；G5 里 `SKILL.md` 是软链 ⇒ `422 E_ADD_NOT_SKILL_DIR` | L2 |
| **K144** | G6–G9：复用 S5–S9，一处不改 | S5 的「目录名兜底」取**源目录名**（`skills/foo` ⇒ `foo`）而不是仓库名；同名已存在 ⇒ `409 E_ALREADY_INSTALLED`（**无覆盖入口**）；影子命中 ⇒ `409 E_ADD_SHADOWED`；**清点对象是子目录**：克隆里含一个 2001 条目的大目录、但目标子目录只有 3 个条目 ⇒ 成功（不因整仓库体积拒） | L2 |
| **K145** | G10–G12 与台账 / 白名单 | 成功 ⇒ `<skillsRoot>/<name>/SKILL.md` 存在、`files`/`bytes` 与子目录实际一致、**副本里没有 `.git`**、台账多一条 `{source:'github', owner, slug, repo, ref, commit, fromPath:'', version:null}`、**重新读台账这三个字段仍在**（`normalizeRecord` 白名单已扩容，P0）；`∄ .skc-clone-*` 与 `∄ .skc-install-*`；台账写失败 ⇒ `500 E_INSTALL_IO` 目录保留（同 U20） | L2 |
| **K146** | 出参形状与两种形态同构 | `POST add` 200 的 `data` 恒为 `{name, path, files, bytes, source, repo, ref, commit}`：path 形态 `source:'local'`、后三个恒 `null`；github 形态 `source:'github'` 且三个有值（未指定 ref 时是 `rev-parse --abbrev-ref HEAD` 的分支名，取不到则 `null`；commit 是 40 位 sha）；`{path}` 旧字段名**不再被接受**（落 `E_BAD_REQUEST`，字段名已改 `spec`） | L2 |
| **K147** | L3 渲染：弹窗增量 | `input` 元素**恰好 1 个**；三处文案改值（`add.description` 说两种形态、`add.pathLabel` 带「或 GitHub 链接」、`add.safety` 说「这个技能」）；placeholder 不变；busy 前 800 ms 是 `add.busy`、之后仍在飞切 `add.fetching`；多候选渲染成可点列表，**点一条把输入改写成 `github:<o>/<r>#path:<sub>` 且不提交**（`api.addSkill` 调用次数不变）；超 10 条补 `add.moreCandidates`{count}；`done` 屏 git 形态多一行 `add.doneFrom`、path 形态**不渲染**该行；7 个新码各渲染出自己的中文（不落 `error.E_UNKNOWN`） | L3 |

**红绿口径**：K138–K147 全部进 `npm test`（K138–K141 是 L1 纯函数、K142–K146 是 L2 注入式、K147 是 L3 字符串渲染）；真机项是下面清单的第 11 条。

### D.10 添加菜单两项（U22，K148）

宿主 `AddPluginMenu` 的 chevron 菜单是**两项**（安装 / 让 Agent 创建），U22 靠齐它。结构与文案见 `docs/contracts/client.md` §3.9.7，刻度见 `docs/contracts/visual.md` A.3 与 A.9，两条取舍见 `docs/contracts/decisions.md` 附录 U。

| # | 目标 | 断言 | 层 |
| --- | --- | --- | --- |
| **K148** | chevron 菜单：两项、`MenuItemButton`、Creator 入口与降级 | ① **结构**：`Menu` 走 children 模式（收到 `listClassName`、子节点是 primitives 的 `MenuItemButton`，**不是 `Button`**），`align="end"`；chevron 是 anchor，图标 **size 12**，`aria-haspopup="menu"`、`aria-expanded` 随开合、`ArrowDown` 能打开；② **两项且顺序固定**：①「安装第三方技能」+ 副行「支持本机目录和 GitHub 仓库」，②「让 Agent 创建技能」+ 副行「进入创造模式，用 Agent 制作」，每项一枚 size 14 图标；③ **点第一项** ⇒ 菜单关闭 + `AddSkillDialog` 打开（`role="dialog"` 出现、`input` 恰好 1 个）；④ **点第二项** ⇒ 菜单关闭 + `uiWorkspace.startSession` **恰好调用一次**，参数逐字为 `(undefined, { clearPreviousDraft: false, agentPreset: 'cordis' })`，且**不发任何 `add` 请求**；⑤ **降级（两层，菜单打开前判一次）**：`ready = typeof uiWorkspace?.startSession === 'function'`；读 `ctx.uiWorkspace` 抛错或服务缺失 ⇒ `ready=false` ⇒ 第二项 `disabled` + **副行切成 `add.createWithAgentOff`「当前部署没有创造模式」**；点击时 `startSession` 抛错 ⇒ **吞掉返回 false**、不冒泡、**整页不转错误态**（列表照常渲染、第一项仍可用）；⑥ **样式**：`styles.js` 里有 `.skc_addMenu` / `.skc_addMenu [role='menuitem']` / `.skc_addMenuItem` / `.skc_addMenuDescription` 四条规则与 A.9 的数值（320 / `calc(100vw - 48px)` / 72 / gap 10 / `6px 12px` / gap 2 / 12·18 / `-webkit-line-clamp:2`），`skc_` 类名总数 **134 → 137**；⑦ **字典** 197 键（`add.fromPath` 改值 + 4 个新键：`add.fromPathHint` / `add.createWithAgent` / `add.createWithAgentHint` / `add.createWithAgentOff`） | L3 · `test/view-skill-dialogs.test.mjs` + `test/styles.test.mjs` |

**红绿口径**：K148 进 `npm test`（L3 字符串渲染 + `styles.js` 规则断言）；第二项真正开草稿是**宿主侧行为**，真机只确认「**会话区切到创造模式草稿**（preset 名不上屏，故只验创造模式标记与输入区出现——`data-agent-preset` / `data-preset` 在真机上是空的，屏幕文字里也没有 `cordis`）」，不进自动化。
**真机结果：通过（2026-11-13，真机 14/14）**：菜单两项、DOM 三层与四项刻度与宿主**逐项差 0**；**`ArrowDown` 开菜单**已验——`preventDefault` 生效（`defaultPrevented === true`）、**菜单已开时不重复 toggle**、其它键零行为；点法与键盘法各测一次：开菜单前 `scrollTop 300`、菜单开着仍 **300**、`Escape` 关掉 **700 ms 后仍是 300**（U20 那个滚动补偿的坑未复现）；第二项切到创造模式草稿（preset 名不上屏，只验创造模式标记与输入区出现，见上句）。

### 真机才能验证的项（不进自动化测试）

1. 像素几何：内边距、页签 34px、行高 64px、图标 48×48、开关 36×20（`HIDDER/AGENTS.md` 的教训：几何只能由真实浏览器量）。
2. 深色模式：所有 `--dsw-*` 解析成功（失败表现为「透明边框 / 看不见的文字」，`HIDDER/docs/reference/settings-ui.md` §9）。
3. 页头停靠在滚到紧凑态时**列表滚动范围不变**、反向滚动沿同一坐标返回。
4. darwin 标题栏安全区（含侧栏收起时的 8px 特例）。
5. 打开任意会话 → 主区回到会话正文；回到「技能」→ 页签保持。
6. 改完 frontmatter 后模型目录热刷新（`skill-filesystem` 的 `watch`）：停用一个技能后，下一轮会话的可用技能列表减少。
7. `prefers-reduced-motion: reduce` 下骨架不呼吸、页签指示块无位移过渡。
8. 市场卡片：深浅两主题下两枚来源图形的可见性与 16px 辨识度；同一屏任意两张卡，`.skc_marketStat` 的 `getBoundingClientRect().left` 逐格相等（280px 窄屏一列与 960px 三列各量一次），**并量任意两张卡的 `.skc_marketTag` 行左沿相等**；安装四态（安装 / 已安装 / 安装中… / 重试）各截一张，确认标题只在变宽时收缩、动作位不换行。
9. **卸载一个正在被当前会话使用的技能**（U20 队长裁决：**不加**「本会话正在使用」守卫，宿主的 `stop-profile` / `bundle-in-use` 两层不搬）：确认目录删除成功、面板那一行消失、**下一次 `list` 不含该行**；同时观察当前会话里模型是否仍能调用它（观察到「面板没了但仍可调用」才算登记过的事实，不改判据）。**结果：通过（2026-11-12，隔离实例 + CDP）**：卸载后目录消失、面板行消失，随后一次带 cache-busting 的 `list` 不含该行（35 行 → 34 行，注册表没有把它复活成幽灵行）。
10. **添加 2000 条目的上限边界**（U20 P1-6）：造一个 2001 条目的源目录 ⇒ `422 E_PACKAGE_INVALID` 且 `skills/<name>` 不存在、`.skc-install-*` 不存在、台账逐字节未变；造恰好 2000 条 ⇒ 成功（上限是「≤2000」）。同样的边界各量一次单文件 8 MiB 与总计 64 MiB。**结果：通过（2026-11-12）**：2001 条目 ⇒ `422 E_PACKAGE_INVALID` 且 `∄ skills/<name>` / `∄ .skc-install-*` / 台账逐字节未变；恰好 2000 ⇒ `200` 并落盘。同族边界同轮量过：单文件恰好 8 MiB 成功、8 MiB+1 字节 `422`；总量恰好 64 MiB 成功、64 MiB+1 `422`（两者都是零残留）。
11. **真 repo 克隆 / 多候选 / 无 git 环境**（U21）。**结果：通过（2026-11-12/13，隔离实例 + CDP，17/17）**，覆盖如下三条：① 一个把技能放在**子目录**的仓库（`anthropics/skills#path:skills/pdf`）走完整链路——按钮文案 `添加 → 正在添加… → 正在从 GitHub 取仓库… → 完成`、结局屏显示 `github.com/anthropics/skills@main`、副本里**没有 `.git`**、克隆目录已删、台账 `repo`/`ref`/`commit` 有值；② **多候选**：同一仓库不带 `#path:` ⇒ 20 个 `SKILL.md`，错误行 + **前 10 条候选按钮**（按路径排序）+「另有 10 个未列出」，`add` 请求计数仍是 **1**；点一条后输入改写成 `github:anthropics/skills#path:skills/academy-guide` 且**不发第二次请求**，再手动提交能真装上（落位 `skills/academy-guide/SKILL.md`、台账 `source=github`）；③ **无 git 环境**（`PATH` 指空目录）⇒ `500 E_GIT_MISSING` + 中文文案 + **零残留目录**。**未覆盖、只有 L2 的那一支**：「**仓库根目录直接放 `SKILL.md`**」——探了 `anthropics/skills`（20 个）、`obra/superpowers`（15）、`simonw/skills`（4）、`steipete/agent-scripts`（54）、`davepoon/buildwithclaude`（423），**没有一个把 `SKILL.md` 放在仓库根**，所以这条分支**没有真机样本**，只由 `test/local-git.test.mjs` 的 **K143** 用真实目录树钉（点名子目录 / 根 / 单命中 / 多命中 / 深度 4 / 软链）。

**K75–K85 的红绿**：除 K80（已退役）外全部进 `npm test`（K75–K78 与 K82 为 L1/L2，K79 与 K83–K84 含渲染半边，K81 与 K85 为门禁），没有一条靠真机抽查；真机口径见上面第 8 条。
