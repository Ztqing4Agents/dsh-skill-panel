# 验收：分层、夹具、用例编号与口径

> 类型：规范
> 读者：验收人（人或 agent）——回答「怎样算通过」
> 真源：`npm test` 的 646 条用例与 `npm run check` 的四道门；本文件只是它们的分层说明与编号索引
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
| **K26** | 计数文案 | `statusLine({total:5,disabled:1}) === '共 5 个技能，1 个已停用'`；`{total:5,disabled:0} === '共 5 个技能'` | L1 |
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
| **K49** | 页头刷新按页签分工 | 市场加载中 / 空闲两种状态 | 市场加载中刷新按钮 `aria-busy="true"` + `disabled` + 进行中指示；空闲时换成刷新图标；已安装面不受影响 | L3 · `test/market-view.test.mjs` |
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
| **K61** | 客户端渐进补齐（先字母后换图） | `market-model.js` 纯函数 + 真 store | 取值优先级 `item.iconUrl` → `market.icons[id]` → null（空串按「无」）；`iconCandidates` 只挑「ClawHub + 没图标 + 没问过 + owner/slug 齐全」，默认 ≤24、顺序随列表；`marketIconsReady` 只把非空值写进 `icons` 但**每个 id 都记 `iconsTried`（null 也记）**；`marketIconsAttempted` 整批失败只记 tried、`icons`／分页态／列表态一动不动；`marketReload` 与切来源/搜索/追加页一样**保留**已拿到的 `icons`/`iconsTried`（只清分页）；空 batch 不改状态对象 | L1 · `test/market-icons-client.test.mjs` |
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
| **K85** | 撤掉客户端收藏、保住后端（负向门禁） | `src/client/**`、`locale/*.json`、`lib/**`、样式表 | **客户端已撤（逐条为 0）**：`marketFavoriteToggle` / `marketFavoriteOk` / `marketFavoriteFail` 三个 action 名、`api.marketFavorite`、`market/favorite` 这条字面量、`toast.jsx` 的 `favorite-failed`、样式表的 `.skc_marketFavorite`、两份字典的 4 个 `market.favorite*` 键；**读侧仍在（逐条为真）**：`marketFavoritesLoaded` 在 `state.js` 与 `market-panel.jsx` 各出现一次、`initialMarket()` 里仍有 `favorites:{}` 与 `favoritesOk:true`；**后端仍在**：`lib/market/favorites.js` 存在、`ROUTES.marketFavorite === '/api/dsh-skill-center/market/favorite'`、`bootstrap` 仍返回 `favorites` / `favoritesOk`、两份字典仍有 `error.E_FAVORITE_FULL` / `error.E_FAVORITE_IO` | 门禁 · `test/market-gates.test.mjs` |

| **K86** | 镜像条目的归一化与身份兜底 | 假 `io` 返回 SkillHub 形状的 `source=clawhub` 页（含 `upstream_owner_login`、`clawhub_` 前缀、两者皆缺、`slug` 空四类） | `owner` 取 `upstream_owner_login`；缺则剥 `clawhub_` 前缀；剥不出来或 `slug` 空 ⇒ **丢条目**（`items` 里没有它、也不抛）；`id` = `clawhub:<owner>:<slug>`（与图标缓存键、已安装行 `_meta.json` 逐字相同）；`downloads` / `saves`(stars) / `score` **不再是 `null`**；`iconUrl` 是绝对 `https`（`skillhubIconUrl` 判据）；`tags` = `subCategories[].name`（保留大小写）；`category` 非 `null`；`version` 只接受 `versionLike`（`a1b2c3…` 这类 id ⇒ `null`）；`packageKind` 恒 `files` | L1 · `test/market-normalize.test.mjs` |
| **K87** | 镜像分页、游标与末页判定 | 假 `io` 记录 URL | `list` 只打一次 `GET {镜像}/api/skills`，参数含 `page`、`pageSize`、`sortBy`/`order`、`source=clawhub`、`keyword`（搜索时）、`category`（有值时）；游标是 `{page}`；`page*limit >= total` ⇒ `next === null`；**丢条目造成的短页仍给下一页**（12 条里丢 2 条、total 100 ⇒ `next` 非 `null`）；空页 ⇒ `next === null`；非法游标（`{cursor:"x"}` / `{page:0}`）⇒ `E_BAD_QUERY`；`data.skills` 不是数组 ⇒ `E_SOURCE_BAD_RESPONSE`；`total` 透传数字；空关键词的 `search` 本端拒绝（`E_BAD_QUERY`，不发请求） | L2 · `test/market-sources.test.mjs` |
| **K88** | 单源边界：目录 / 详情 / 安装包全部只走 `api.skillhub.cn` | 假 `io` 分别记录 URL 与失败注入 | `list`/`search`/`detail`/`plan`/`fetchFile` 的每一次上游调用**主机只有 `api.skillhub.cn`**（出现 `clawhub.ai` 即红，`lib/**` 里也零出现）；`detail` 的第 1 个请求是 `GET /api/skills?...keyword=<slug>&pageSize=20&source=clawhub`，它**同时**解析出 `namespace` 与 `score`，第 2 个才是 `GET /api/v1/skills/<slug>?namespace=`；一次 detail 的上游请求数恒为 **4**（解析 + 详情 + 清单 + `SKILL.md`），`item` 的 `downloads`/`saves`/`category`/`iconUrl` 来自镜像自己的详情载荷；**同名不同 owner 的两条并存时只认 `upstream_owner_login` 相同的那条**（slug 单独不唯一）；**零命中 ⇒ `E_SOURCE_BAD_RESPONSE`（502）且不再发详情/清单请求**（宁可不给详情，也不猜 namespace）；**仍不抛、键在值 `null` 的只有 `icons()` 的坏行/零命中**（见 K92） | L2 · `test/market-clawhub-mirror.test.mjs` |
| **K89** | 图标管道与分类开关不回归（负向门禁） | `lib/market/sources/clawhub.js` / `index.js` 文本 + `descriptors()` | `clawhubSource.icons` 仍是函数、`icons()` 仍按 `clawhub:<owner>:<slug>` 出 `{icons, names}`（K57 第二段的既有断言照跑）；`ROUTES.marketIcons` 仍在、`marketLucide` / `marketClawhubIcon` 已删（U7）、路由共 11 条；`descriptors()` 里两源 `hasCategories === true`、`packageKind === 'files'`，`SCOPES` 三项且 `all` 无适配器；`bootstrap` 只算**被问的那一档**（`sourceParam` 参与 `pageSize=1`，缓存按档分开，`countsOk` 语义不变） | 门禁 · `test/market-gates.test.mjs` |

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

| **K101** | 页头刷新重取期间不换骨架、不插尾部占位卡 | 字符串渲染（真 store：已加载一页 → `marketReload` → `marketListLoading`） | `items` 留 1 条、`listStatus='loading'`（**不是 idle**）、`page.status='loading'`、`pages=0`；真卡片 1 张、**占位卡 0 张**（`skc_marketSkeletonAction` 计数）、没有带 `role="status"` 的 `ul.skc_marketGrid`（不是整页骨架）、没有 `.skc_marketLoadMore`、也没有到底/重试页脚；`ul.skc_marketGrid` 与 `.skc_marketSection` 都 `aria-busy="true"`；播报只有一条「正在读取技能市场…」 | L3 · `test/market-view.test.mjs` |

| **K102** | 追加下一页仍画尾部 3 张占位卡与「加载更多」行（U10 不回退） | 同上：`pages=1` + `marketPageStart` | 真卡 1 张 + 尾部占位 **3 张**（`skc_marketSkeletonAction` 计数，挂在 `ul.skc_marketGrid` 内、真卡之后）、**不是**整页骨架；`.skc_marketLoadMore` 恰好 1 条且在 `</ul>` 之后；「正在加载更多」出现 2 次（视觉行 + sr-only，视觉行 `aria-hidden`） | L3 · `test/market-view.test.mjs` |

| **K103** | 重取与追加互斥：任何一刻 `role="status"` 最多一条 | 字符串渲染，四态（首屏 / 重取第一页 / 追加 / 空闲） | 首屏（列表为空）：6 张骨架 + **只有骨架那一条** status（叠加的 `skc_progressAnnouncement` 为 0，改前是 2 条）；重取第一页（列表还在）：恰好 1 条、是 sr-only 播报器、文案「正在读取」、不说「加载更多」；追加：恰好 1 条、文案「正在加载更多」、播报器在视觉行之前；空闲：0 条 | L3 · `test/market-view.test.mjs` |

| **K104** | 搜索重取（关键词落定）期间同样只留旧列表 | 同上：两页已加载 → `marketCommitKeyword('ui')` → `marketListLoading` | `keyword='ui'`、`items` 2 条留着、`pages=0`、`page.status='loading'`；真卡 2 张、**尾部占位卡 0 张**（改前这里是让文档长高一行 ≈206px 的原因）、没有 `.skc_marketLoadMore`、不换整页骨架；只有一条「正在读取」播报、不混用「正在加载更多」 | L3 · `test/market-view.test.mjs` |

| **K105** | 切筛选（来源 / 分类 / 排序）保留列表、只清分页（M10） | 真 store：一页卡 + 详情已开，三条路径各打一次补丁 | 三条路径都：`items` **同一数组引用**（卡片不重挂）、`listStatus='ready'`、`pages=0`、`cursors={}`、`exhausted={}`、`page.status='idle'`、`detail=null`；`categoriesLoading` **只在换 scope 时**置位（换分类/排序不碰 chips）；随后 `marketListLoading()` ⇒ `listStatus='loading'` 而 `items` 仍 2 条（骨架判据「loading + 空列表」不成立）；三个筛选都是原值时状态对象一动不动 | L1 · `test/state.test.mjs` |

| **K106** | 换来源的等待期不换骨架、不插尾部占位；答案落地整表替换（M10） | 字符串渲染（真 store：一页卡 + boot 已答 → `marketSetFilter({source})` → `marketListLoading`） | 等待期：真卡 1 张、**占位卡 0 张**（`skc_marketSkeletonAction` 计数）、没有带 `role="status"` 的 `ul.skc_marketGrid`、没有 `.skc_marketLoadMore`、网格 `aria-busy="true"`、`role="status"` 恰好 1 条且不是「加载更多」；答案落地后只有 1 张卡、是新 scope 的 id、旧 scope 的 id 不在 DOM 里（`loadFirst` 不带 `existing`，旧卡不串进新查询） | L3 · `test/market-view.test.mjs` |

| **K107** | 换来源时 chips 行只有一行：旧数字就地换新，不叠占位行 | 字符串渲染（`categoriesLoading` 两态：已有 chips 行 / 首屏还没有） | `categoriesLoading && chips 行在` ⇒ `skc_marketSkeletonChip` **0 根**、`skc_marketChips` 恰好 1 行且是 `role="group"` 的真 chip 行、旧计数仍在（「全部」+ 各分类各一个 `skc_marketChipCount`）；首屏（没有 chips 行）⇒ 仍画 **6 根** `skc_marketSkeletonChip` 且没有真 chip 行 | L3 · `test/market-view.test.mjs` |

| **K108** | 落点键（`source\|category\|sort\|keyword`）只被筛选与搜索改动 | 真 store（面板 paint effect 的依赖面） | 默认键 `all\|null\|recommended\|`；**刷新 / 第一页在飞 / 追加在飞 / 一页落地 / 开详情 / 详情落地 / 关详情 / 记滚动 / 安装成功** 九个动作后键一字不变（所以「刷新保住原位置」成立）；换分类、搜索、换来源+排序各自改键。落点本身（写 `scrollTop=0`）要真 DOM，归 K50 那类真机验证 | L1 · `test/state.test.mjs` |

| **K109** | 描述三行真的画出来、块内三处间距对不对、卡片没被撑歪（U14 / U15） | 真机：1320×940 隔离实例，三列网格、24 张卡 | `.skc_marketDesc` 的描述盒高恒 **54px**（3 × 18px）且 `marginTop/Bottom` 都是 **0**（UA `margin:1em` 没漏回来），长描述在**第三行末尾**截断（省略号、不溢出卡片、不出现第四行）；块内三处间距实测 **头→描述 12px**（卡片 `gap`）、**描述→标签 4px**、**标签→三段 4px**（正文 `gap`）；同一行卡片等高、卡高 **187px**（U14 三行时 219px、U15 收 32px）；标签行与三段数字都在卡片内、三段三格仍对齐同一 x；工具栏恒 3 子元素宽 944px、网格恒 3 列、搜索框 768px。**取值本身**（`-webkit-line-clamp: 3` + 13/18 + `margin:0` + 卡片 `gap:12px` + 正文 `gap:4px`）由 K40 在门禁里钉死，本条只验几何 | L4 · 真机抽查（不进 `npm test`：几何要真机，做法同 K50/K51） |

**红绿口径**（Round 20 终态，U15 卡片间距轮）：K28–K49 与 K52–**K108** 全部绿（**K33 / K58 / K60 / K80 已退役、不计入**；`node --test test/` 共 **687** 例，K 系列零红；K94–K109 的落点见上表末十六行，其中 **K101–K104 为 U13 新增、K105–K108 为 M10 新增、K109 为 U14 新增（真机，不进 `npm test`）**，编号接在前一个之后、未复用未重排）；K29/K35/K36/K37/K38/K42/K45/K55/K89/K93 的用例体按 U8 改写而编号未变，U13 就地改写了 K45/K61/K72 里「刷新清空列表/缓存」那条断言，M10 就地改写了 K98 里「切 scope 清列表」那条，U14 就地改写了 K40 里「描述两行」那条，U15 又就地改写了同一条里的「正文 6px 节奏」并补钉卡片 `gap:12px` 与描述 `margin:0`（都只动那一个行为拐点，编号未变；U14/U15 都是**改值不算新刻度**，`market.md` 附录 F 那几行是取值真源——U15 的 `margin:0` 是真因：`<p>` 的 UA `margin:1em` 在 13px 字号下白拿上下各 13px）；**不进 `npm test` 的三条**：K50 / K51（像素级命中、滚动容器与真实上游）、**K109（U14/U15 的几何：描述盒 54px 且 margin 归零、块内 12/4/4、卡高 187px、同行等高）**，都由 agent 驱动无头浏览器在隔离 `DSH_HOME` 上验。产物体积上限（`test/bundle-contract.test.mjs`）不当 K 号：它是门禁，M10 随产物 121147 B 从 120 KB 抬到 128 KB，判别力靠「react 一旦内联会到 ~190 KB」。

---

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
| **K72** | 标题优先级 `rowTitleOf` | ①`market.names[key]` 命中 ⇒ 上游标题；②无上游标题、`row.displayName` 非空 ⇒ 本地 `metadata.displayName`；③两者都无 ⇒ kebab `row.name`；④`row.upstream === null` 时**一次都不读缓存**（Proxy 记录零访问）；⑤空串/非字符串不算有值。配套 `nameFor`（只认非空字符串）、`nameSeeds`（无可播种 ⇒ `null`、幂等、不覆盖、**不写 `iconsTried`**）、`marketNamesReady`（可覆盖种子、`null` 不落键）、`marketReload` 保留 `names` 与图标（只清分页） | L1 · `test/market-names.test.mjs` |
| **K73** | 嵌套 `metadata.displayName` | 块内带引号/不带引号都读；**顶层 `display-name` 优先**（谁在前都算）；`metadata` 块里没有该键 ⇒ `undefined`；`metadata.summary: >` 块标量正文里的 `displayName:` 行**不得**被当成真键；BOM+CRLF 文件照读（读侧接字符串）；完全没有 `metadata` 块 ⇒ `undefined`；同一文件跑 `setDisableModelInvocation` 后仍只改开关那一行、行尾仍是纯 CRLF、嵌套标题与块标量原样 | L1 · `test/frontmatter.test.mjs` |
| **K74** | 行标题渲染 | 传 `title` ⇒ 可见文字是 `title`、tooltip 是 `row.name`，且不新增可点区域；**不传 `title` 时与改动前逐字节相同**（tooltip 仍是本地 `displayName`）；长标题整串渲染、单行省略（`nowrap`/`ellipsis`/`hidden`），`.skc_cardTitle` 的字号/行高逐字未变、没有多行截断一类新声明；标题里的 HTML 元字符被转义 | L3 · `test/view-row.test.mjs` |

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
8. 市场卡片：深浅两主题下两枚来源图形的可见性与 16px 辨识度；同一屏任意两张卡，`.skc_marketStat` 的 `getBoundingClientRect().left` 逐格相等（280px 窄屏一列与 960px 三列各量一次），**并量任意两张卡的 `.skc_marketTag` 行左沿相等**；安装四态（安装 / 已安装 / 安装中… / 重试）各截一张，确认标题只在变宽时收缩、动作位不换行。

**K75–K85 的红绿**：除 K80（已退役）外全部进 `npm test`（K75–K78 与 K82 为 L1/L2，K79 与 K83–K84 含渲染半边，K81 与 K85 为门禁），没有一条靠真机抽查；真机口径见上面第 8 条。
