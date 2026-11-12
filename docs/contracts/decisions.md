# 决策登记：偏离、更正与假设

> 类型：规范
> 读者：想知道「为什么不是另一种做法」的人；改判据或 UI 口径前先看这里
> 真源：git log（`git log -S`）+ 本表；PRD 原件在 commit `a8141eb`
> 更新触发：拍下新的偏离 / 更正 / 假设时追加，不改历史结论
> 规模上限：400

编号 附录 B 保持原值（原件见 `git show a8141eb:docs/system_design.md`）。

---

## 附录 B 决策登记：与 PRD 的偏离与更正

> PRD 已于 2026-11-09 移出仓库（过程产物），原件见 commit `a8141eb`；下表「PRD 原文」列保留原文以便追溯，判定仍然有效。

**B 组：有宿主证据的更正**（不是设计偏好，是「PRD 写错了控件/类名」）：

| # | PRD 原文 | 实际（逐字证据） | 处理 |
| --- | --- | --- | --- |
| B-1 | §3.3.1 状态文案 = `.status`，13px/20px | 页头状态文案在宿主是 `.updatesNote`：`color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px`；`.status` 只用于页内状态段（`partsEmpty` / `installChecking` / `unavailable`） | 采用 `.updatesNote` 的 12/18。**2026-11-12 U19 更正**：早期那句「按队长决策改计数（`共 N 个技能`）」作废——更新提示落地后，宿主同位只有一句更新提示、没有计数，故计数整句退场（`status.count`/`status.offSuffix` 一并删除），状态位与宿主 1:1 |
| B-2 | §3.3.1 刷新中「14px 旋转指示」 | 宿主是 `StateDot state="ongoing" size={13}` 放在按钮 `icon` 位；14px 是 `.toggleProgress` 的**开关**占位（`--bundle-progress-size:14px`） | 刷新用 `StateDot`；开关 pending 用 14px 占位 + `StateDot`。保留 PRD 的「≥400ms、重复点击忽略」行为 |
| B-3 | PRD §3.3.5 错误态文字 = `state-error-primary` | 宿主 `.failure{color:error}` 但内部 `<p>` 被 `.failure p` 覆盖成 `label-tertiary`；错误信号由 `StateDot state="error"` 承担，`role="alert"` | 照宿主：容器 error 色 + 文字 tertiary + 红色 StateDot。若用户要求文字也变红，改 1 条规则即可 |
| B-4 | PRD §3.3.4 行 hover/active 底色 | 宿主行是链接（`.cardLink:hover` / `:active` 有底色反馈）；我们的行在 2026-11-09 前**不可点击**（Q6 + 队长决策） | **已安装行 U1 起可点**（进本地详情页，见 `docs/contracts/installed-detail.md`）：补 hover / `:active` / `:focus-visible` 三处可点证据，开关仍是行内**唯一独立动作位**；宿主 `.cardLink:hover` 的**确切色值没采到**，暂用市场卡同一个 `--dsw-alias-interactive-bg-hover`，标「待真机取色」（附录 Q） |
| B-5 | PRD §3.3.2 / PRD §3.3.5 把分段控件与开关当「规格」手写 | 两者都是 primitives 导出组件（`SegmentedTabs` / `Switch`），PRD 抄的正是它们的 CSS | **直接用组件**，不手写；`className` 只调容器（`skc_pageTabList`） |
| B-6 | §3.3.1 页签位置「`order:3`，`flex:100%`」 | 正确，但仅在「无 container query」时成立；`<600px` 时改 `flex:none; order:2`，`toolbar` 变 `order:3` | `docs/contracts/visual.md` A.8 已逐字包含 |
| B-7 | §3.4 软链技能写 realpath + 首次确认（Q4） | 队长 2026-11-08 决策：**软链只读，不给开关** | 全文按队长决策执行；Q4 关闭 |

**C 组：刻意偏离（已由 PRD/队长登记，实现必须照做）**：

| # | 偏离 | 依据 |
| --- | --- | --- |
| C-1 | 状态文案改计数，不写「所有插件均为最新版本」 | PRD §3.3.7 + 队长决策（首版无版本检查） |
| C-2 | 无「实验性插件」分区、无「更多 ›」 | PRD §3.3.7 |
| C-3 | `＋ 添加技能 ⌄` **P0 呈现但禁用**（PRD Q3 原建议 P0 不呈现） | 队长决策 3（视觉保留 1:1）；提示用包裹 `<span title>` 的原生 tooltip |
| C-4 | ~~技能市场页签只渲染占位文案~~ **（2026-11-09 由本轮改写，见附录 E）** | 队长决策 + PRD P0-13 |
| C-5 | ~~全行无点击，唯一交互是开关~~ **（已改写为「按页签划边界」：已安装行可点进详情、开关是行内唯一独立动作位；市场卡片的整卡点击层 + 唯一动作位（安装，U5 起收藏按钮已撤）；见附录 E、附录 J、附录 Q 与 `AGENTS.md` 硬约束 9）** | PRD Q6 / D2 |
| C-6 | 页脚新增「另有 N 个技能…」一行 | PRD P0-14 / PRD §3.3.7 |
| C-7 | 软链行右侧改静态标记（无开关） | 队长决策 2 |
| C-8 | 软链行不预留 22px（不预留进度环位） | 该行永不 pending，预留只会在视觉上多一条空白；行高仍 64px（标记 18px < 20px 开关） |

**D 组：QA 第 1 轮回归后的实现修正（2026-11-08，行为变化已登记）**：

| # | 现象 | 修正（落点） | 影响面 |
| --- | --- | --- | --- |
| KI-2 | 折叠块标量被读成 `>`：`description: >` + 缩进正文时，行描述只剩一个 `>`（真机 `clawhub-wpank--ui-design` 可见） | `lib/frontmatter.js` 的 `parseFrontmatter` 增加块标量读侧规则（见 §3.2.4「读侧契约」）。**写入器不动**：它只替换 `disable-model-invocation` 一行，与解析器解耦 | 仅影响读出的 `description`/`name`/`display-name` 值；写回字节与保真清单不变 |
| KI-3 | `SKILL.md` 本身是软链时写入被拒，但错误码是 `E_FILE_CHANGED`（`fstat` 口径取指纹、`lstat` 口径复核，软链下 inode 天然不同） | `lib/write-skill.js`：写前先 `lstat(file)`，软链直接 `409 E_SYMLINK_READONLY`；两次指纹复核统一 `lstat` 口径，不再混用 `fstat` | 错误码更准，fail-safe 行为不变（目标字节不变、软链不被替换） |
| KI-1 | `E_BAD_NAME`/`E_BAD_PATH` 在 §8.1 标「行内原因」，但 §8.3 键表没有对应文案 → 用户看到中文夹英文 | `locale/{zh,en}.json` 补 `error.E_BAD_NAME`/`error.E_BAD_PATH` 两键，`src/client/model.js` 的 `ROW_ERRORS` 收录两码（§8.3 的「P0 全集」= 下表 + 这两条） | 仅文案；两个码正常不可达（name/path 都源自已校验的 payload），属兜底 |

---

## 附录 E 市场轮决策登记

> 2026-11-09 技能市场轮。每条都带来源（PRD 原文 / 宿主读数 / 队长裁决 / 设计结论），没有一条是「我觉得」。市场面的完整契约在 `docs/contracts/market.md`，路由与安装链路在 `docs/contracts/routes.md` §3.7。

| # | 原文 / 待定说法 | 实际（逐字证据） | 处理 |
| --- | --- | --- | --- |
| E-1 | PRD §7.2「卡面：`radius-xl`、`.5px` 描边（`border-l3`）、padding 14px」 | 宿主市场卡片 **没有边框**：`border-radius:var(--dsw-radius-xl); align-items:center; gap:14px; margin:0 -8px; padding:8px; display:flex; position:relative`；可点性由 hover 底色 `interactive-bg-hover` 与 `cardOpen::after{inset:0}` 铺满整卡提供，描边只出现在 `.icon` 上 | **不自造描边**：卡面照宿主（无边框 + `radius-xl` + hover 底色），描边只留在头像框（复用既有 `.skc_cardIcon`，其声明一字不改）。竖向排布与 `padding:14px` 属新刻度，登记在 `docs/contracts/market.md` 附录 F |
| E-2 | PRD §7.5「详情含概览」＋ 旧记忆「ClawHub 详情只给 summary、SkillHub 用 `overviewMd`」 | ClawHub `GET /api/v1/skills/<slug>?ownerHandle=` 的 `skill.description` 就是**整份 `SKILL.md` 原文**（实测 7068 / 39618 字节，均以 `---` 开头）；SkillHub 的 `overviewMd` 恒为 `''`（实测多个技能） | 两源的「概述」都从 `SKILL.md` 派生：`stripFrontmatter()` 取正文当概览、`parseFrontmatter()` 取声明 `name`。**两个既有纯函数直接复用**，不新写解析器；正文为空时回落 `summary` |
| E-3 | PRD §9.1「`<name>` = 包内 `SKILL.md` 的 `name`，必须符合 kebab-case」＋ 待拍板项「不合规时是否用 slug 顶替」 | 真实包确实会声明不合规的名字：`ivangdavila/design` 声明 `Design`（大写），SkillHub 的展示名是 `编程大神.Skill` | **硬失败**：`422 E_SKILL_NAME_INVALID`，`data.declaredName` 回显原文，**不改名、不用 slug 顶替**（判名文法 `^[a-z0-9]+(?:-[a-z0-9]+)*$` 就是宿主加载器的 `SKILL_NAME`，声明 `Design` 的包装进去宿主也不会加载，所以这是对齐宿主而非保守）。安装顺序改为「先取 `SKILL.md` 再取其余」，这类失败只花 1 次文件请求；详情页在装前就用 `installTo` 给出「会装到哪」，名字不合规时显示不能安装的说明 |
| E-4 | 「市场刻度与适配器契约写进现有契约」 | `architecture.md` 已 393 行、`visual.md` 已 317 行；`类型：规范` 的 400 行上限由门禁钉死，改头注绕不过去 | **新开 `docs/contracts/market.md`**（`类型：规范`、上限 400）承载 §7 适配器与数据流 + 附录 F 视觉刻度 + 附录 G 文件清单；两份旧文件只加指针（`architecture.md` +4 行 → 397，守住 400）。`visual.md` 的 `A.10` 编号**弃用不占号**，市场刻度只在附录 F 维护，两处不重复 |

---

## 附录 H 首字母瓦片对齐 skillhub.cn

> 2026-11-09 用户第三轮反馈：「我看了 https://www.skillhub.cn/skills?sortBy=score 其没有图标的，也是用首字母图标，我想跟他对齐」。追问「哪些对齐、哪些不对齐」的回答是**「除了圆角外，其他都对齐」**。站点数据由 CDP 读计算样式实测，不是目测。

| # | 原口径 | 站点实测真值 | 处理 |
| --- | --- | --- | --- |
| F-1 | 12 组粉彩底 + 深色字，色相 30° 等分，字母对比度 4.95–6.62（`visual.md` A.5 原表） | 无图标条目只有 **6 组**：底色是该 accent 的 10%（天空那组 12%），字色是该 accent 的**实色**；滚动 25 屏没有出现第七组。天空组底色 `rgba(90,200,250,.12)` 与字色 `#32ADE6` 不是同一个值，照抄 | 色板换成这 6 组（`SKC_AVATAR_TONES` 12 → 6，形状 `{bg, ink}` 不变）。散列（FNV-1a）与首字规则本来就跟站点一致，不动 |
| F-2 | 字母 ≥4.5:1 对比度是一条硬判据（`styles.test.mjs` 与 `visual.md` A.5 都按它写） | 这 6 组的字母对底色只有约 **2–3:1**（橙/黄系最吃紧），站点就长这样 | **主动放弃 ≥4.5:1 判据**，改由「与站点逐值一致」当判据。这是本轮唯一一处我们明知降低可读性仍照抄的地方：用户拿站点当参照，对齐的价值高于这条自定阈值。已写进 `visual.md` A.5 与 A.9，避免后人再按 4.5:1 去「修正」 |
| F-3 | 瓦片 48×48、`radius-lg`（16px）、26px/500 首字母 | 瓦片 40×40、圆角 8px、字号 14px、字重 700、`font-family: Outfit, -apple-system, …` | 字号字重按 14/40 比例投到 48px 盒：**17px / 700**（16.8 舍入）。**圆角保持 16px、尺寸保持 48×48**——用户明确「除了圆角外，其他都对齐」，且 `.skc_cardIcon` 是「已安装」页签 11 行共用的容器，改尺寸会让行高回归。`Outfit` 字体不引入（不自造字体依赖），沿用系统字体栈 |

---

## 附录 I 已安装技能图标同步轮

> 2026-11-09 用户要求「已安装技能的图标与市场的图标同步」，参照 `dsh-skill-market` 的做法并回答「怎么确定这个技能是安装的」。三条登记：两条对齐参考项目，一条队长加严。

| # | 条目 | 实际（逐字证据） | 处理 |
| --- | --- | --- | --- |
| I-1 | **图标不落盘**——不写技能目录、不新增缓存文件、不读别人的存储 | 参考项目把「浏览过的市场条目」存成浏览器会话内 Map（`seen`），reload 即空，`skillFromInstalled` 给的 `iconUrl` 是空串；它从不写盘 | 只做会话内缓存：`market.icons`（`{[source:owner:slug]: url}`）+ `iconsTried`（负结果也记）。页面 reload / 新会话即清空，断网时全部回落字母瓦片。守住硬约束 10（不写别人的存储） |
| I-2 | **已安装页签主动解析一次**（参考项目**不做**这一步） | 参考项目只对「本会话浏览过的」条目显示图标，没浏览过的一律字母；队长加严要求「有台账身份、本会话没浏览过」的技能也取一次 | 图标循环上移到 `page.jsx`（面板打开期间恒挂载），`iconBatch` 同时产出两半候选：市场缺图的条目 + 已安装行里有身份却没问过的行。失败静默、每源 ≤12、总 ≤24，与路由限制同源 |
| I-4 | **已安装行的标题用上游标题**（`names[key]` → 本地 `metadata.displayName` → `row.name`），**kebab 名退到 tooltip** | 用户报告「已安装的技能，技能标题并不是 skillhub 的标题」：列表显示 `dev-expert-pro`，SkillHub 上叫「编程专家Pro.Skill」。用户认的是市场里的那个名字 | 标题走与图标同一条缓存链（`market/list` 的 `displayName` 种子 + `POST market/icons` 回来的 `names`），**会话内、不落盘**；`row.name` 仍是 tooltip（它是模型调用技能用的字符串，不能从界面上消失）。容器、字号、单行省略一律不动——只换文字内容 |
| I-3 | **手工 / 别的工具装的技能没有身份，因此没有图标** | `_meta.json` 里 `source` 是已知源 id 才认（那是本插件安装器写下的印记）。本机实测 `clawhub-wpank--ui-design` 的 `ownerId` 是 ClawHub 内部 Convex id，当 `ownerHandle` 查详情 **404**；目录名里的 `clawhub-wpank--` 前缀又把工具名一起吞了，切出来的 handle 是垃圾 | `upstream === null` ⇒ 字母瓦片。**不从目录名反推**、不按名字 join 台账、不用 slug 猜 owner。README「已知限制」写明，用户可感知的后果是「这类技能永远显示首字母」 |

---

---

## 待明确 / 假设

### 待用户/队长拍板

| # | 事项 | 我采用的默认 | 影响面 |
| --- | --- | --- | --- |
| **Q-A** | 入口名（PRD Q1）——队长最新消息未再变更，仍为「待用户最终拍板」 | 默认 **`技能`**（与 `@michengai/dsh-skills-manager` 重名，用户已接受）。只写进 `locale/*.json` 的 `panel.label` + `meta.title` | 改一个 JSON 键即可，代码零改动 |
| **Q-B** | 「内置永远胜出」vs「rank 小者胜」在 `bundled(600)` 与 `user-dsh(400)` 同名时互斥（见 §3.2.2 冲突表的第 3 条） | 取 **rank 小者胜**（保 G1：面板显示的就是模型拿到的那条） | 若改为「内置永远胜出」，`mergeCatalog` 加一条覆盖规则，并接受「面板显示的不是模型拿到的那条」 |
| **Q-C** | `＋ 添加技能 ⌄` 的「即将支持」提示形态 | 包裹 `<span title>` 的原生 tooltip（禁用按钮不触发鼠标事件，宿主对只读行也用 `title` 传原因） | 若要求浮层样式，需改用 `Tooltip` + `aria-disabled` 的非禁用按钮，多 1 个组件 |
| **Q-D** | 侧栏行的位置（`PANEL_ORDER = 40`，排在已知行之后） | 40 | 改 1 个常量 |

### 假设（已按此推进，如不成立请纠正）

| # | 假设 | 验证方法 |
| --- | --- | --- |
| A1 | 本 profile（desktop）的 `ctx.skills` 在 Host 平面能看到 `dsh-skill-filesystem` 的 provider 条目（因为 `@deepseek-ai/dsh-base` 在 profile 层挂了它） | 调 `GET /api/dsh-skill-panel/health`，看 `registry.complete` 与 `counts`；若 builtin 恒为 0 而实际有 bundled 技能 → 假设不成立，退化为「只靠自扫描 + 硬编码无 builtin」（`lib/registry.js` 已把快照失败降级成空集） |
| A2 | `SkillSummary` 的字段就是 `{name, path?, description, whenToUse?, invocation, source, provider, resourceBase?}`（无 `rank`） | 读 `EX/dsh-skill/lib/index.js` 的 `toSummary`；已在 §1.4.1 引用 |
| A3 | `dsh.client.immediately` 只影响预取，不影响 apply 时机 | 真机：禁用网络节流首次打开 GUI，侧栏「技能」行是否首屏可见；`SHELL/index-BgUyXZcc.js` 的 `prefetchImmediateTier` 已证 |
| A4 | 行内 `Switch` 与页签 `SegmentedTabs` 的 props 名（`checked`/`onChange`、`items[].value/label/id/panelId`）在 `0.2.2-rc.1` 稳定 | 宿主自身调用点即契约（§1.5.3）；升级后按 `HIDDER/docs/reference/settings-ui.md` §9 的健康检查思路复核 |
| A5 | `--dsh-frame-top-clearance` 在 darwin 下为 48px 且始终存在 | `EX/dsh-client-ui-layout/lib/client.js` 内 `dsh-frame-top-clearance:48px`（`html` 级）；代码里仍带 `,0px` 兜底 |
| A6 | 扫描 `~/.dsh/skills` 时 `.system` 子目录必须跳过 | `EX/dsh-skill-filesystem/README.md`「The user DSH root skips its `.system` child」；本机当前无该目录（防御性跳过） |
| A7 | P1/P2 全部不做（搜索、状态筛选、来源 tooltip、同名遮蔽提示、项目级根） | PRD §3.2 P1/P2；设计里只留不冲突的钩子（`Row.rule`/`Row.confidence` 已在 payload 里，P1 加 tooltip 不需要改 Host） |
| A8 | 客户端不需要 `localStorage`（页签状态用模块级 store） | 满足 P0-3「离开页面再回来保持」；整页 reload 后回到「已安装」是宿主同款行为 |

---

## 附录 J 市场卡片重做轮（2026-11-09）

> 参考项目 `montersy123/dsh-skill-market` 的卡片结构（作者行 / 等宽三段 / 收藏按钮）。每条都带来源，市场面的完整契约在 `docs/contracts/market.md` §7，路由在 `docs/contracts/routes.md` §3.7。

| # | 待定说法 | 实际（逐字证据 / 算式） | 处理 |
| --- | --- | --- | --- |
| J-1 | 卡片的**来源标识**用什么 | 用户诉求是「skillhub 就显示 skillhub 的 icon」，因此保真是需求本身：单色自绘 path 只能做到六成神似（等于自造 logo）；运行时直连品牌 URL 会踩「浏览器半部零 URL」那条回归门禁 | **内联位图**：`src/client/market-marks.jsx` 里两段 `data:image/png;base64`（SkillHub 站点自带 32×32 favicon 1334 B、sha256 `b00f1749…25a0fc`；ClawHub 站点自带 logo 由 192×192 降采样到 32×32、2357 B、sha256 `64a32b4f…949600`），显示 16×16、零网络、零新路由、不新增依赖。**替换**原来那枚文字 Tag（同一位），`title` 保留来源名；注释里不写 URL |
| J-2 | 收藏存哪、键是什么 | 别人的存储（`~/.dsh/skills-manager/state.json`、`skill-market/*`、`.skills-lock.json`）对本面板只读（`AGENTS.md` 硬约束 10），书签只能落本插件自己的目录 | `$DSH_HOME/dsh-skill-panel/favorites.json`，键 = `marketId(source, owner, slug)`（与图标缓存 / 上游标题 / 安装台账同一个键）；`{version:1, favorites:[…]}` 最新在前；上限 500；写盘走 `store.js` 的 `writeAtomic`；进程内一条 Promise 链串行化；与现状一致的写入不落盘（幂等）。读侧只在 `market/bootstrap`（`favorites` + `favoritesOk`），**不新增 GET**；写侧一条 `POST market/favorite`（见 `docs/contracts/routes.md` §3.7.6） |
| J-3 | 三段数字各是什么口径 | 参考项目的 `Stats` 是「下载 / 收藏 / 评分」三段；SkillHub 的 `stars` 是小整数（实测 37 / 99 / 158）、`score` 是 0–100000 的连续分（实测 `95757.41562195931`） | 下载 = `downloads`；收藏 = 上游 **`stars`**（不是你自己的书签，你自己的由按钮 `aria-pressed` 表达，两者不合并）；评分 = `4 + min(1, score/100000)` 量化到一位小数。`rating` **不进数据层**：它是客户端的显示投影，Host 只给原料 `score`（`normalize.js` 的「只映射、不解释」）。`score <= 0` 时评分段整段不出现——`4.0` 是缺值伪装成的分数 |
| J-4 | 三段与安装按钮能否同一行 | 安装按钮四态（安装 / 已安装 / 安装中… / 重试）宽度不同：段宽 =（内容宽 − 按钮宽 − gap）/ 3，`安装` 与 `已安装` 差一个汉字 ≈12.5px ⇒ 每段差 ≈4.2px，同屏两卡的「收藏」「评分」列各错开 4.2 / 8.4px；最窄卡（280−28=252px）塞进「安装中…」（≈78px）后三格只剩 ≈166px，每格 ≈55px 而中文 `1135万` 需 ≈39px 文本 + 16px 图标 | **三段独占一行**（`repeat(3, minmax(0,72px))` 左对齐）、安装按钮另起一行右对齐（`.skc_marketCardEnd` 既有声明一字不改）。代价是卡片高 ≈28px，换来四种情况下数字列零抖动 |
| J-5 | 缺段的格子：占位还是不占位 | 若缺段就让后面的段左移，一张缺「收藏」的卡会把「评分」挪到第二格，同屏立刻错位 | **槽位占位、内容不出现**：三格轨道恒在（同列的 x 坐标在任何两张卡上相同），空格里没有图标、没有数字、没有 `0`、没有破折号，读屏也读不到（`aria-hidden`）；三格全缺时整行不渲染（否则卡片中部剩三格空白） |
| J-6 | 作者行显示 `@owner/slug` 还是 publisher 中文名 | 用户原话的例子逐字是 `@indiv-integrator/dev-expert-pro`（= `@` + owner + `/` + slug），而这两个字段两源必填（路由白名单就要求），`author`（publisher 显示名）反而可能缺失 | **`@owner/slug`**（`authorTextOf` 三级回落：`owner/slug` → `owner` → `author`）；`market.metaAuthor` 文案 `@{author}` 一个字不改，插值换成 handle。代价：卡片不再出现 publisher 中文名，它仍在详情事实表的「作者」行 |

---

## 附录 K 市场工具栏间距（2026-11-09）

> 用户指着「技能市场」工具栏右侧那一组（搜索框右端 + `SkillHub ⌄` + `推荐 ⌄`）说「间距有些问题」。实测在隔离实例里做完再定，逐条结论见下表；刻度表在 `docs/contracts/market.md` 附录 F，`test/market-gates.test.mjs` 逐条守着这几个值。

| # | 待定说法 | 实际（逐字证据 / 算式） | 处理 |
| --- | --- | --- | --- |
| K-1 | 搜索框与两个菜单之间留多少 | 附录 F 逐字抄了宿主的 `.marketButton{margin-left:-8px}`，而工具栏 `gap:8px`：负边距把第一段吃成 **0**，第二段 8，右端 0（`推荐` 贴内容右边界）。实测（1320×940、内容宽 944）：搜索框右沿 1120.1 = 来源菜单左沿 1120.1；有词时清空按钮右沿也是 1120.1——× 直接贴住菜单。宿主这么做是因为它自己的按钮内边距更小，抄到位后在本面板里读起来像「搜索框里长出了两个菜单」 | **去掉 `margin-left:-8px`**（用户 2026-11-09 拍板）：盒子间距变成 8 / 8 / 0，右端仍贴内容右边界；清空按钮与来源菜单之间回到 8px。代价：相对宿主整体 +8px，附录 F 已标成偏离。**后由 K-4 修正**：两个菜单之间那一段仍需抵消一次 |
| K-2 | 两个同级菜单要不要同字重 | 只有来源菜单带了 `skc_marketSelect`，排序菜单没带：实测 `SkillHub` 是 500、`推荐` 是 400（同为 12px），同排两个同级控件看着不是一套。这是「只抄了半套」的实现漏，不是设计选择 | **两个菜单同带 `skc_marketSelect`**：字重统一 500、`max-width:240px` 统一生效；`text-overflow:ellipsis` 的标签类本来就两边都有 |
| K-3 | 搜索框有词时的清空按钮 | `Input` 的 `type="search"` 没被 `appearance` 收口，Blink 会在输入框内自己画一枚取消按钮，与面板自绘的清空按钮并排出现（实测：框内一枚原生 ×、框外 8px 又一枚自绘 ×） | **只留自绘那个**（它带 `aria-label` / `title`，可本地化、可被读屏念到）：`.skc_marketSearch input::-webkit-search-cancel-button` 关掉原生按钮。宿主市场页没有对应规则，这条算本面板自己的收口 |
| K-4 | 两个菜单之间的空隙要不要也等于搜索框那一段 | 用户 2026-11-10 复评：两个菜单中间看着是「所有来源」与搜索框之间那段的 **2 倍**。实测（1320×940、内容宽 944）：搜索框边框→来源菜单左沿 **8**、来源菜单左沿→「所有来源」**10**；来源菜单右沿→「默认排序」**18**。原因是 ghost 按钮不画盒子：第二段实际是 `gap 8 + 排序菜单自己的 10px 内边距`，而第一段贴着搜索框的边框读。盒子等距（8 / 8）不等于看着等距 | **只让排序菜单抵消一次 gap**：`.skc_marketSelectTrailing{margin-left:-8px}`，两段读成 8 / 10，盒子相邻而不重叠（接缝命中测试：右沿 −1px 命中来源菜单、+1px 命中排序菜单），搜索框那一段仍是 8px 不动。不选宿主的「两个菜单都 −8」——那会把搜索框与来源菜单也贴成 0，正是 K-1 否掉的那一版 |
---

## 附录 L 市场卡片重排（U5，2026-11-09）

> 用户看完 U2 真机截图说「和我想的不一样」，给了一张 646×360 的草图；用户原话「具体的间距等情况应该是你来定的，这个只是我画的一个草图」。逐行结构见 `docs/contracts/client.md` §3.9.2 的组件树与 `docs/contracts/market.md` 附录 F 的卡片刻度行。

| # | 待定说法 | 实际（证据 / 算式） | 处理 |
| --- | --- | --- | --- |
| L-1 | 安装按钮放哪 | 草图画在头部右侧；U2 把它放在底行右下（新刻度 ③ 的来源） | **头部右侧**：`.skc_marketCardEnd` 整块搬进 `.skc_marketHead`，**类名与 `z-index:1` 都不动**（改名要动 7 处，且会丢掉「浮在点击层之上」的唯一 grep 锚点），只删 `align-self:flex-end`。头部 `align-items:center`（与已安装行同配方）+ `nowrap`（flex 默认）：安装四态 ≈52/64/78/52px，变宽只让标题收缩成省略号。标题行 `align-self:flex-start` + `max-width:100%` + **`flex-wrap:nowrap`**、标题 `flex:0 1 auto` + `min-width:0`：品牌图**紧跟标题**（只隔 8px gap），长标题自己省略——`flex:1` 会把品牌图推到文本块最右端，与草图不符。`wrap` 同样不行：换行容器先按 flex base size 分行，收缩只在行内生效，超长标题会先把品牌图挤到**第二行**（实测 `skillhub:tencent-adm:tencent-docs` 与 `skillhub:beatra-ai:beatra` 两张卡：标题行高 20px → 44px、标题占满 162px），改 `nowrap` 后长标题在行内省略、品牌图留在第一行 |
| L-2 | 三段顺序 | 草图 `★ 5.0 · ↓ 1135万 · 🔖 101` | `MARKET_STAT_SLOTS` 与 `statSegments` 字面量都改成 `rating·downloads·saves`；**槽位仍恒三格**，所以对齐（x 逐格相等）与「缺段留空」都不受影响；ClawHub 只有下载 ⇒ 渲染成「空 / 下载 / 空」 |
| L-3 | 标签从哪来、要不要转小写 | SkillHub `subCategories: [{key, name}]`（`dev-god` = 代码生成 / Bug 修复 / 后端开发，实测正好三枚）；ClawHub `topics: string[]`（`buzzmark` = social-media / content-scheduling / linkedin / instagram / mcp，混着 `Marketing`、`Email`）。**ClawHub 的 `tags` 是 `{latest: version}`，不是标签** | SkillHub 取 `.name` 且**保留大小写**；ClawHub 取前 3 并**转小写**（同源内 kebab 与 Title Case 混排，统一才像一套；不做 title-case，否则 `mcp`→`Mcp`）。≤3 条、单条 ≤24 字符、同值去重、缺 = `[]` |
| L-4 | 空标签行的卡片高度 | 同屏不混源；SkillHub 少数条目 `subCategories` 为空 | **空数组整行不渲染**：占位会让「有标签」与「没标签」无法区分，且是谎报；差的一行由 grid 的 `stretch` 补成底部空白，验收① 管的是 x 不是 y |
| L-5 | 卡片上的收藏开关 | 用户决定：「本版不要收藏开关，只显示上游收藏数」 | 拆**客户端写侧**（卡片按钮 / `marketFavoriteToggle·Ok·Fail` / `api.marketFavorite` / toast 的 `favorite-failed` / 4 个 `market.favorite*` 键 / `BookmarkMark`）；**后端一条不删**（store / 路由 / `bootstrap` 两键 / 两个 `error.E_FAVORITE_*` 文案），**读侧 `favorites` + `marketFavoritesLoaded` 也留**（将来要接回 UI 时零 Host 改动）。K80 退役、号不复用 |

---

## 附录 N ClawHub 数据源改走 SkillHub 镜像（2026-11-09）

> 用户原话：「ClawHub 的数据来源，你看 skillhub.cn/skills?sortBy=score&source=clawhub 这个网站就有下载量等情况」。字段口径见 `docs/contracts/market.md` §7 与 `docs/contracts/routes.md` §3.7；用例见 `docs/contracts/acceptance.md` 的 K86–K88。

| # | 待定说法 | 实际（实测证据） | 处理 |
| --- | --- | --- | --- |
| N-1 | ClawHub 的数字从哪来 | 镜像 `api/skills?source=clawhub` 每条带 `downloads` / `stars` / `score`；`clawhub.ai` 列表三样都没有 | **list / search 走镜像**，`detail` / `plan` / `fetchFile` 仍走 `clawhub.ai`（混合适配器，按方法切） |
| N-2 | 两套下载量口径取哪个 | `agent-browser` 镜像 1,258,479 vs `clawhub.ai` 详情 4,347（≈290 倍） | 取**镜像**（用户参照的是 skillhub.cn），并在 `detail()` 里用一次镜像**列表**查询（`keyword=<slug>`，按 `slug` + `upstream_owner_login` 双匹配）覆盖五个字段，保证**卡片与详情同数**；零命中或失败退回 `clawhub.ai` 的数、不抛。**不按 `namespace` 查镜像 detail**：认领过的 namespace 没有 `clawhub_` 前缀（实测 `find-skills` → `indiv-guipi`），猜前缀会漏 5% |
| ~~N-3~~ | 安装能不能走镜像 | 曾经「不能」：`buzzmark` 当时查到 0 个文件 | **推翻（U7）**：那批 0 文件是查了镜像里不存在的 slug（80/80 抽样 manifest 完整且含 `SKILL.md`）⇒ 现在**只走镜像**；12 文件差的是元数据（见 ~~N-9~~），不影响运行 |
| N-4 | identity 用什么 | 镜像给 `upstream_owner_login`（100/100 有值）与 `namespace.handle`（`clawhub_<owner>`，95/100 带前缀） | 用 `upstream_owner_login`（原生 handle，`clawhub.ai` 的 `ownerHandle=` 认它，已安装行与图标缓存键零迁移）；缺则剥前缀，剥不出就丢条目 |
| ~~N-5~~ | `caps.categories` 翻不翻 | 当时分类表与 13 个计数写死取自 SkillHub 本体 | **推翻（U8）**：`caps.categories` 翻成 `true`，计数按 scope 各算各的、缓存 key 用 `sourceParam`（附录 O-3） |
| ~~N-6~~ | 图标管道全留还是删两条代理 | 曾经「全留」 | **部分推翻（U7）**：`market/lucide` 与 `market/clawhub-icon` 的**唯一**上游是 `clawhub.ai` 的两种图标形态，随它一起退场；`icons()` 与 `market/icons` **留下**（服务已安装行，见 N-11） |
| ~~N-7~~ | 卡片的版本号还在不在 | 镜像给的是真 semver 但**会滞后**（实测 `self-improving-agent` 3.0.24 vs 上游 4.0.5） | **被 N-10 覆盖**：U7 之后不再有「卡片旧、包装新」的分裂，三处都取镜像 |
| N-8 | 双匹配的样本 owner 是谁 | 设计期记的三个样本 owner 里 `cad-viewer` 记为 `pskoett`；实测镜像与 `clawhub.ai` 都说是 **`sanshuili334-code`**（`self-improving-agent` 才是 `pskoett`） | 双匹配按**镜像行的 `upstream_owner_login`** 比，而不是按设计稿里的样本值——卡片与详情的 owner 本来就同源，永远自洽；`keyword=cad-viewer` / `find-skills` / `self-improving-agent` 三次实测均命中，且 `clawhub.ai` 认这个 handle |
| ~~N-9~~ | 镜像与包的完整度差多少 | `agent-browser`：镜像 `/files` 2 个、旧 zip 3 个（多 `skill-card.md`，元数据）；`self-improving-agent` 两边都是 17 | **不再是取舍（U7）**：zip 整条退役，装的就是镜像那 2 个；`skill-card.md` 不参与运行 |
| **N-10** | 版本口径 | 卡片 / 详情 / 安装三处**都取镜像版本**。镜像可能滞后上游真最新（实测 `self-improving-agent` 镜像 3.0.24 / 上游 4.0.5） | 取舍：**一致性优先于新鲜度**——用户要「全部交由镜像」，三处同数比「卡片旧、包装新」可解释。要装官方最新版只能去 ClawHub 官网（`CHANGELOG` 已写明） |
| **N-11** | 两条图片代理为什么删 | 它们的唯一上游是 `clawhub.ai`（`lucide:<Name>` 与 `/api/v1/skill-icons/<hash>` 两种形态）。镜像给的是 cloudcache 的绝对 `https`，`<img>` 直连可画（U6 真机 24/24 有图已证），不需要本机转发；`_meta.json` 也不存图标地址，**没有旧缓存要照顾** | 删两条路由（13 → 11）与 `upstream.js` 的 8 个常量、2 个工厂、`normalize.js` 的 3 个 URL 函数；`icons()` 与 `market/icons` 留下服务已安装行 |

---

## 附录 O 筛选向 skillhub.cn 靠拢（2026-11-10）

> 用户原话：「ClawHub 顶部的类别是不是应该有，另外，你看下镜像站的 skillhub 和 clawhub 及其所有来源，是怎么排的（比如所有来源），我想完全向它靠拢」。逐值对照见下表；用例见 `docs/contracts/acceptance.md` 的 K98 与 `docs/contracts/market.md` §7。

| # | 事项 | 站点做法（bundle 抠出 / 实测） | 我们的处置 |
| --- | --- | --- | --- |
| O-1 | 「所有来源」怎么表达 | `source` 为空就不传（`"all" !== e.source` 才 `set`） | **`all` 是新默认 scope**，上游不传 `source` ⇒ 224,219 条（含 ClawHub） |
| O-2 | SkillHub 这一档是什么 | `source=community`，160,838 条，**本身含 `enterprise`** | 我们的 `skillhub` scope 传 `community`；`enterprise` 行折叠成 `skillhub` 身份（不进键） |
| O-3 | 分类是否与来源正交 | 是，ClawHub 也有分类 | 三个 scope 都渲染 chips，**计数按 scope 各算**（同一分类三档数字不同：23,193 / 10,145 / 13,048） |
| O-4 | 排序几项 | 默认 `score`，另有 `updated_at` / `downloads` / `stars` | 四项全上；**只改文案值、不改键名**（`recommended` 显示成「默认排序」，新增 `stars`=「收藏量」），`sort` 的机器值不漂 |
| O-5 | 旧游标怎么办 | 站点每次改筛选都重新拉第一页 | 契约写死「任何筛选变化必清 `cursor`」；**游标形状仍是 `{page}`**，不加筛选签名（客户端已经清，加签名只盖 bug 不修 bug）。~~「必清 `items`」~~ **（2026-11-10 由 M10 改写：筛选变更保留 `items` 直出，见附录 P）** |
| O-6 | 「不限 API Key」过滤 | 站点有 | **本轮不做**（用户明确排除），也不预留占位 UI |

---

## 附录 P 重取期间旧列表直出（U13 / M10，2026-11-10）

> 用户原话：「只要是刷新都会，右上角刷新，切换页签，搜索都会」（U13）；「可以落实，我发现确实还有这个问题」（M10，指切来源/排序）。判据与用例见 `docs/contracts/acceptance.md` 的 K101–K108（U13 四条 / M10 四条）与 `test/market-view.test.mjs`、`test/state.test.mjs` 的对应用例；表里每组数字都是隔离实例上逐帧（页内 `requestAnimationFrame`）实测的。

| # | 事项 | 原先做法与实测 | 现在的处置 |
| --- | --- | --- | --- |
| P-1 | 重取第一页时列表怎么处理 | `marketReload`（已删，见 S-16）与 `marketSetFilter` 都 `items: []`：整页换成 6 张卡骨架，文档高度 2020 → 940（−1080 px）、`scrollTop` 被浏览器夹回 0、卡片全部重挂所以头像退回字母；搜索保留 `items` 但共用 `page.status === 'loading'`，尾部多插 3 张占位卡（+206 px） | **一律保留 `items`**（刷新 / 搜索 / 筛选），`clearedPaging` 按「有 items 就 `ready`」给 `listStatus`；重量级判据换成 `pages > 0`——只有「追加下一页」才画尾部占位卡与「正在加载更多」。答案落地时整表替换（首屏重取不带 `existing`），所以旧卡不会串进新查询 |
| P-2 | 换 scope 时 chips 怎么进骨架 | `categoriesLoading` 一到就**再加**一行 chips 骨架（真行还在），一次换来源网格下移 42 px | 有 chips 行时**不叠骨架**：旧计数留在原位、新数字到达就地替换；只有还没有 chips 行（首屏）才画骨架。`categoriesLoading` 与 `bootstrap?source=` 的 token 守卫都不动 |
| P-3 | 关闭菜单会不会动滚动位置 | 宿主的 `Menu` 关闭时把焦点还给锚点，锚点在吸顶栏里、布局位置在容器顶部，浏览器为露出它把 `.skc_pageBody` 滚到 0（实测 300 → 0，**选同一个值也发生**，关闭后约 12 ms，且没有 JS 写 `scrollTop`）。这一跳与数据无关，U8 起就在 | `.skc_marketFilters` 在打开菜单时记下偏移，关闭后 150 ms 内监听容器的 `scroll` 事件：只要被拉到 0 就写回原偏移（只认「到 0」这一种，避免和浏览器的滚动锚定打架）。宿主没有关闭焦点的开关（`Menu` 的 props 里只有 `autoFocus`，`focusWithoutRing` 的 `preventScroll` 不外传），所以这是**对宿主行为的补偿**，不是样式改动。与 P-5 的先后：选中的值**变了**就解除补偿（`menuTop` 置 0），落点全交给 P-5；只有「选了同一个值」才用补偿（真机 4 例：同值 300 → 300，异值 → 0） |
| P-4 | 为什么不再「收窄骨架高度」 | 骨架 6 张（2 行）、真实列表 12/24 张（4/8 行），高度随内容变；要「高度不变」得在骨架期量旧高度再撑住，多一份状态与一套失效点 | 不选。保留旧列表的收益相同、代价更小；「陈旧但稳定」的窗口就是一次请求 |
| P-5 | 筛选后落在什么位置 | 改前靠「列表消失 → 骨架变矮 → 浏览器夹取」，落点由内容长度决定：实测切分类/排序落在 **0**、换来源那次落在 **228**（短页预取补页），同一条交互两种落点 | **自己决定落点：paint 之前瞬时写 0。** 面板用 `useLayoutEffect`，依赖只有四个查询输入 `source`/`category`/`sort`/`keyword` 拼成的键，键变了就把 `.skc_pageBody` 的 `scrollTop` 写 0（不做平滑、不 `scrollTo`、不等夹取）：跳变是那一帧的初始状态，不是动画。键没变（翻页、加载态、详情往返、刷新）一律不碰 —— 刷新的「保住你原来的位置」是 U13 的既定语义，与这条不冲突。参考实现 [dsh-market](https://github.com/dsh-market/dsh-market) 的市场页组件 `MarketSection.tsx` 正是这么做的（筛选键驱动的 `useLayoutEffect` 里 `el.scrollTop = 0`，注释写明 instant 不用 pagination 的 smooth，让跳变发生在 paint 之前），我们的容器没有宿主那种 sticky floor，所以目标就是 0 而不是「记住的 floor」 |

---

## 附录 Q 已安装详情页的设计参照（U1，2026-11-10；同日二核改写）

> 结论先行：宿主**确有**「插件详情页」，本轮已按它的**结构与顺序**重排已安装详情的头部。先前那条「本机宿主没有这一页」是**错的**，错因是采集方法而不是宿主：`grep` 对 asar 里的中文静默漏检。该结论作废，采集口径同步改成「只用 node 读 asar」。

| # | 事实 | 依据 / 处理 |
| --- | --- | --- |
| Q-1 | 宿主有插件详情页 | `app.asar` 内 `dsh/node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js`（node 读 asar 实测 438 450 B，含 zh/en/ja locale 表）的详情页键：`crumbRoot:"插件"`、`backToList:"返回插件"`、`openDetail:"查看 {name}"`、`uninstall:"卸载"`、`uninstallLabel:"卸载 {name}"`、`versionTag:"v{version}"`、`sourceTitle:"来源信息"`、`sourceSpec:"代码来源"`、`sourceVersion:"当前版本"`、`sourceBuiltIn:"内置"`；渲染侧顺序是「头行（图标 + 卸载按钮(`outline/sm`, `IconTrashOutlineRegular` 13) + 开关）→ `titleRow`(`h3` + `versionTag`) → 描述 → 正文/说明 → 来源信息」 |
| Q-2 | 上一轮判「没有」是**采集方法**错，不是宿主没有 | 同一份 213 MB asar：`grep -ac "卸载"` → **0**（假阴性）、`grep -ac "uninstall"` → 111（ASCII 正常）、node 逐字节读同一包时「卸载」「插件」各命中上百次。⇒ **对 asar 不能只用 grep 搜中文**；采集一律 node 读 asar（`u32@4 = headerSize`、`u32@12 = jsonLen`、JSON 从 byte 16 起、内容区 = `8 + headerSize`，按 offset 切片）。同一条规矩适用于以后任何「0 命中」的结论 |
| Q-3 | 本轮按宿主重排头部 | 面包屑「技能」（对 `crumbRoot`，不是 `backToList`）→ 图标行右侧「卸载（`disabled` 占位，无 onClick）+ 开关」→ 名称 + 版本（`v{version}`）+ 作者（`@owner/slug`，仅 `upstream` 非空）+ 描述；来源信息移到页尾。真实卸载仍是看板 M6（C-3「可见的不可点」先例） |
| Q-4 | 余项：**px 未逐值采集** | 宿主详情页的类名是构建哈希、样式在另一份产物里，本轮只对齐结构与顺序（用户也只要「先这样」）；详情页的确切 px/色值与 `.cardLink:hover` 一样标「待真机取色」（`docs/contracts/visual.md` A.5）。下次若采到样式，按 `docs/reference/host-plugin-page.md` 头注「整份重采」，不在旧的 §7 上补值 |

---

## 附录 R 更新检测对齐宿主（U19，2026-11-12）

> 用户原话：「将更新检测也对齐宿主的机制，并补充更新功能」；二选一确认：检测＝**完整对齐宿主**（自动检测 + 页头提示 + 候选判据 + 详情页头「更新」按钮），动作＝**覆盖安装 + 失败回滚**（保留下载前的启用状态、失败保留原版本）。宿主机制采集自 `app.asar` 内 `dsh-client-ui-plugin-manager` 的 `client.js`（0.2.2-rc.1），映射表见 `.agents/work/wip/U19-update-check.md` 的 A.1；用例见 `docs/contracts/acceptance.md` 附录 D.7 的 K116–K125。

| # | 事项 | 依据 / 处理 |
| --- | --- | --- |
| R-1 | 版本区块的「发布于 `{date}`」是**唯一**允许上屏的时间（「上次检查于 `{time}`」是同一轮新增的第二处，来自 `check.at`） | 它与 `docs/contracts/data-model.md` §3.8.1 不变式 3「卡片与详情不显示任何时间：`updatedAt` 只影响顺序」**不冲突**：那是**另一个字段**（市场条目的 `updatedAt`，只用于排序），而这里显示的是 `versions[].createdAt`（版本自身的发布时刻，上游给的真实事实），且只在**已安装详情的展开列表**里出现。不登记这句，下一个人会拿「不显示任何时间」来删它。口径：绝对日期 `YYYY-MM-DD`，不用相对时间（「3 天前」会随时间漂） |
| R-2 | 候选版本 = **`versions[0]`**，判据沿用「只比相等、不排序」 | 宿主取「第一个可安装（声明 bundle 且不与宿主版本冲突）∧ 非弃用 ∧ 非预发布」的版本，那四个字段在技能包里**都不存在**（`_meta.json` 只有 `source/ownerId/slug/version/name/installedAt`，上游 `versions` 每条只有 `version/versionId/changelog/createdAt/securityReports`）。所以取「第一条」：`candidate === row.version ⇒ 已是最新`，否则「可更新到 {candidate}」。**代价如实登记**：若上游把预发布或降级版本排在首位，我们会显示「可更新到 x」并允许装——那是**上游的排序**，不是我们的判断；客户端不做任何版本排序或大小比较（预发布、日期式版本号都会骗人，`checkVersion` 的旧注释同理）。补正路径只有一条：上游给字段后改这一处判据 |
| R-3 | 宿主的**四个分支整条删除**：`新版本需要更新 DSH` / `没有可直接安装的新版本` / `预发布`·`已弃用`·`需要 {peers}` 标签 / `安装源 {registry}` 一行 | ①「需要更新 DSH」要有 peer 依赖与宿主版本约束字段——技能包没有，写进代码就是永远绿的假覆盖率；②「没有可直接安装的新版本」要有 `bundle` 声明——技能能不能装由安装期的包闸判（`E_PACKAGE_INVALID`），检测期无条件可装；③ 预发布/弃用/peer 三个字段都没有，且**不拿版本号字符串猜预发布**（猜错就把可装的新版说成不可装）；④ 两个 `source` 都打同一个镜像 `api.skillhub.cn`，来源已在「来源信息 → 代码来源」显示，再列一行是同一句话说两遍。四项都是「插件包对一个宿主能不能装」的问题，技能包没有宿主要求、只有一个镜像、上游也不标预发布与弃用 |
| R-4 | 覆盖安装承接看板 **M2**，M2 原「先移出再装」的两段式被否 | 那个中间窗口会留下「已移出、未装成」的坏态；`rename` 的两次原子交换（旧目录 → `.skc-backup-*`、暂存 → 目标）没有这个窗口，失败路径见 `docs/contracts/market.md` §7.11。M6（卸载与版本回退）仍不做 |

## 附录 S 添加技能与卸载技能（U20，2026-11-12）

> 用户原话：「完善功能，删除技能以及添加技能的功能，与宿主对齐」。宿主的「添加插件」与「卸载」两条流程逐行采集自 `app.asar` 内 `dsh-client-ui-plugin-manager` 的 `client.js`（0.2.2-rc.1）与其 `PluginManagerPage.tsx` 渲染侧，坐标见 PRD `.agents/work/wip/U20-add-remove-skill.md` 附录 A；用例见 `docs/contracts/acceptance.md` 附录 D.8 的 K126–K136。**附录 Q-3 那句「真实卸载仍是看板 M6」由本轮作废**：M6 的「卸载」部分已被 U20 吃掉，剩下的「版本回退」仍留在板上。

| # | 事项 | 依据 / 处理 |
| --- | --- | --- |
| S-1 | **添加合并为一段式**（宿主是 `inspect` → `install` 两段） | 宿主两段式是为了 npm 包名 / Git 地址的**慢解析**与「安装源选择」：一段只做形状判定，一段真下载。我们只吃**本机目录路径**，校验是 `lstat` + 读一个文件的量级，没有可独立推进的慢阶段；照抄两段式要多一条路由、多一个中间态（`installChecking`「正在检查…」）与一屏没有内容的过渡态。所以添加入参只有 `{path}`，一次请求跑完「校验 + 复制 + 落位 + 回读 + 台账」，弹窗只有 `idle → busy → done`。少掉的能力是「先探再装」的二次确认，代价由「失败不落任何字节」的不变式兜住（§3.3.4） |
| S-2 | ~~**用户可见文案用「删除」而不是「卸载」**（宿主是 `uninstall`，pnpm 语义）~~ **2026-11-12 作废，改为同词「卸载」，见 S-14** | 技能是磁盘上的一个目录，删了就没了；宿主的「卸载」说得通是因为它的包由 pnpm 管理、可重装。**键不动、只改值**：`detail.uninstall` 的值改「删除」/`Delete`，确认弹窗新开的 `delete.*` 三个键也用「删除」。一句话能改回（四个值），键与代码零改动 |
| S-3 | **接受 `~` / `~/…` 前缀**（宿主只收绝对路径，`install-spec.js` 的路径分支直接拒相对与 `~`） | 宿主是给 `pnpm` 传 spec，必须是绝对路径；我们展开 `~` 后自己复制，家目录从哪里来无所谓。**这是有意放宽**：用户从终端 `cp -r` 到 `~/.dsh/skills/` 时习惯写 `~/…`，拒掉它只是让人多打几个字。风险面为零（展开后仍要过「绝对路径 + 无 NUL + ≤1024」三关，且落点由 Host 自己决定）。`error.E_BAD_PATH` 的文案同步写清「以 / 或 ~ 开头」 |
| S-4 | **不加「本会话正在使用」守卫**（宿主的 `stop-profile` 与 `bundle-in-use` 两层不搬） | 那两层守的是**插件包被宿主 loader 持有**（`require` 已加载、HMR 关不掉）：删掉文件后进程仍在跑旧的代码，必须拒。技能的加载是**快照式**的（`dsh-skill-filesystem` 以 `watch: true` 热刷新），删目录只是下一次 `list` 少一行，不存在「文件没了但代码还在跑」的坏态。所以 D0–D9 里没有这一层；**代价如实登记**：删掉一个正在被当前会话使用的技能后，当前会话里模型是否仍能调用它**没有自动化断言**，作为真机观察项写在 `docs/contracts/acceptance.md` 的「真机才能验证的项」第 9 条——观察到「面板没了但仍可调用」时再补一层拒删码 |
| S-5 | **卸载成功不发 toast**（照抄宿主：`applied()` 的 `'applied'` 分支直接 `return`） | 宿主的表达是「那一行从列表消失 + 详情自动退回卡片区」，我们同构：`closeDetail()` + 一次 `load('refresh')` + `marketInstalledStale()`，**notice 不新增第四种 kind**（仍是 `refresh-failed` / `install-ok` / `update-ok`）。添加成功反而**复用** `install-ok`（它确实「新增了一个已安装技能」，且弹窗已经用 `add.done` 说了同一句话之外的细节） |
| S-6 | **影子判据从「胜出行是 builtin」放宽到「存在 rank 更小的同名注册表行」** | PRD 写的是「重扫后同名**胜出行**的 `partition === 'builtin'` 即拒」。落地时发现 `mergeCatalog` 只吐出**仲裁后的赢家**，而输家有两种归宿：`partition === 'builtin'`（rank 250 的 runtime provider，R1）与 **`excluded`**（rank 100/200/300 的项目级/自定义根，R3 直接不渲染）。后者比前者更糟：用户会「加成功、面板里连影子都没有」。所以判据取更本质的那一条——**同名注册表行的 `rank < rankOf('user-dsh')`（400）**，既覆盖 runtime（250）也覆盖被 R3 排除的三个档；`rank 600`（bundled，即随 DSH 提供的 filesystem 技能）与 `rank 400`（user-dsh）不拦，因为扫描出来的行本身就是 400、在同名裁决里不输。判据落在新纯函数 `shadowOf(summaries, name)`（`lib/local/rules.js`（U20 新增），只 import `classify.js` 的 `rankOf`，**九级阶梯一行不改**），`409 E_ADD_SHADOWED` 的 `data.provider` 取自那条摘要 |
| S-7 | 自有台账的本地记录用 `installedAt` 而不是新造 `addedAt`，并给 `normalizeRecord` 补两个字段 | `lib/market/store.js` 的 `normalizeRecord` 会把不认识的字段**丢掉**，所以「多加一个 `addedAt`」的写法活不到下一次读盘。本地记录复用现成的 `installedAt`（同义：这条记录是什么时候进的面板），另加 `dirName` 与 `fromPath` 两个字段（写进 `normalizeRecord` 的白名单），`installs[].name` 仍是 `lib/ledger.js` 的 R5 读取器要的那个字段。**`market/installed` 的映射会多出 `local::` 这种键**（本地技能没有 source/owner/slug），它匹配不到任何市场卡片，是无害的死条目，但 `installed[name].exists` 的 `lstat` 会多跑一次——不改读侧接口，登记在此 |
| S-8 | 添加与删除**复用市场安装的那一张锁表**，没有第二套互斥 | `lib/market/install.js` 的 `withLock`（`source:owner:slug` + 全局上限 2）已经是本插件唯一的写互斥。给 `createInstaller` 的返回值加一个 `withWriteLock(key, run)`，本地写入用 `local:<name>` 当键：一个技能不可能同时在装/在更新/在删，`E_INSTALL_BUSY` 的文案也因此改宽成「正在被处理」（原文案只说得通安装） |
| S-9 | 卸载成功后的「市场卡片已安装标记」用 `marketInstalledStale()` 而不是 `installedDirty` | `installedDirty` 的效果是在**切回已安装页签**时再跑一次 `list`（`page.jsx` 的 dirty effect）；而市场卡片读的是 `market.installed` 那份映射，它只在 `installedReady !== true` 时读一次。删掉一个市场装的技能后要让卡片退回「安装」，只能把 `installedReady` 置回 false。同一件事用两个字段会各有一次多余的重扫，所以删除侧只置 `marketInstalledStale()`，`list` 由页面显式重扫一次 |
| S-10 | **附录 B 的 C-3 与待拍板的 Q-C 同时关闭**：`＋ 添加技能 ⌄` 从「呈现但禁用 + `title=add.comingSoon`」变成可用（主按钮开弹窗、chevron 开一项菜单） | C-3 的理由是「视觉保留 1:1，先给位置不接功能」，Q-C 是它的 tooltip 形态待定；两件事的前提（功能不存在）本轮消失：包在 `<span title>` 上的原生 tooltip 连同 `add.comingSoon` 键一起退役，按钮自身带 `aria-label`（`add.label`）与菜单项（`add.fromPath`）。**附录 Q-3 里「卸载占位」那半句同样关闭**（见本附录开头） |
| S-11 | **`asLocalError` 必须沿用既有面码的 HTTP 状态**（设计原文只写「`LOCAL_STATUS` 之外一律 `E_INTERNAL` / 500」） | 照字面实现会把两个面共用的 `E_NOT_FOUND` / `E_STALE_PATH` / `E_SYMLINK_READONLY` / `E_NOT_WRITABLE` / `E_BAD_PATH` / `E_BAD_NAME` 全变成 500 `E_INTERNAL`——那几个码恰好是删除侧最常返回的（`routes.md` §3.3.4 的 D2–D6），用户会看到「未预期异常」而不是「这个技能已不存在」。实现取三级查表：`LOCAL_STATUS`（**仍恰 4 键**，只有四个新码）→ `MARKET_STATUS`（复用的市场码）→ `FACE_STATUS`（§8.1 本地面既有码）→ 兜底 `E_INTERNAL`；`isKnownCode()` 三表都认，认不出的码才归一成 `E_INTERNAL`。**所有键数判据不变**：`LOCAL_STATUS` 四键、`MARKET_STATUS` 二十项、§8.6 二十行 |
| S-12 | **删除失败的行内文案走 `reasonText` + `ROW_ERRORS`**（设计写的是 `reasonKeyOf`） | 删除路由的 4xx 全在「行级写入」家族（`E_NOT_FOUND` / `E_STALE_PATH` / `E_SYMLINK_READONLY` / `E_NOT_WRITABLE` / `E_BAD_NAME` / `E_DELETE_IO`），而 `reasonKeyOf` 只认 `MARKET_ERROR_CODES`：把 `E_STALE_PATH` 交给它会被兜成 `E_UNKNOWN`，界面显示「操作失败：stale」这种中英夹生的句子。所以删除侧用 `src/client/model.js` 的 `reasonText(code, reason, t)`（按 `ROW_ERRORS` 取键，认不出才落 `error.E_UNKNOWN`），添加侧仍用 `reasonKeyOf`（它的拒绝码本来就在 `MARKET_ERROR_CODES` 里）。`E_DELETE_IO` **两个集合都登记**：`ROW_ERRORS` 管删除的行内原因，`MARKET_ERROR_CODES` 让 `reasonKeyOf` 也认得它。两个 helper 读同一份字典，不新增键 |
| S-13 | **页头状态位在后续轮进行中保留上一轮结论**（不是清空重算） | 用户实测：点刷新后列表重扫很快结束、刷新按钮先恢复，而 `.skc_status` 那一句先整块消失，要等更新检查那一轮（逐行串行、整轮上限 8 秒）跑完才回来——两个恢复点不同步，被读成「卡住了」。产品裁决：**已有上一轮 `done` 结论时，新一轮进行中沿用上一轮那句文案与 `data-tone`，一轮结束就地替换**；首轮（还没有任何结论）仍是一轮跑完才出现；结论确实为空（无检测对象）时该消失就消失；**刷新按钮的 `aria-busy` 仍只跟列表重扫**，不因状态位保持而延长。实现上不碰 `model.js` 的 `headerUpdateNote` 语义（纯函数照旧按当前 `checks`/`checkRun` 算一句话），页面另存一份「上一轮结论快照」兜底——契约只写行为口径，理由与代价：**宿主 `.updatesNote` 在「重新检查进行中」到底保持还是消失没有采集过**（`docs/reference/host-plugin-page.md` 只采了静态形状与页头三态），所以这条按用户反馈定，日后采到宿主行为再回改。口径见 `docs/contracts/client.md` §3.9.8 与 `docs/contracts/installed-detail.md` 的「页头四态」，用例 K137 |
| S-14 | **用户可见词汇从「删除」改回「卸载」**（推翻本附录 S-2） | 用户看了宿主「插件」详情页的真机截图后要求同词：宿主详情头那枚按钮就是 `uninstall`（zh「卸载」），我们上一轮为了「技能是磁盘上的目录」这个语义自己另起了「删除」，在同一个动作上出现了两套词。裁决：**宿主同词优先**——按钮、确认弹窗标题 / 正文 / 确认键、失败文案统一「卸载」。**键名一律不改**（`detail.uninstall`、`delete.{title,body,confirm,factDir}`、`error.E_DELETE_IO` 都只改**值**），所以字典仍是 **182** 键（U21 再加 11 个 git 形态的键 ⇒ **193**，见附录 T-10）、`check:i18n` 的键集一行不动；路由名 `remove` 与错误码 `E_DELETE_IO` 是内部标识、不面向用户，同样不改（改它们要动 `ROUTES`、两张码表与三条 K 用例，收益为零）。描述**行为**的词保留「删除」——「删除目录」「把目录删掉」说的是磁盘动作，不是界面上的那颗按钮 |
| S-15 | **「技能市场」页签不再渲染页头工具条**（状态位 + 刷新 + 添加组整行都不在） | 宿主那条工具条是**整行** `hidden={!onInstalled}`；我们上一轮只在**按钮级**做条件（状态位与添加组按页签隐藏，刷新按钮仍单独留在市场页签），结果市场页签多出一枚没有任何对象可刷新的按钮。用户要求靠齐整行口径。后果如实登记：`marketReload()` 因此**失去了页头入口**（市场侧的重取只剩面板自己的 effect：切回页签 / 搜索 / 筛选变化，以及整页错误态的「重试」），它的「保留 `items` 与图标、只清分页与详情」语义仍然有效（那几行口径没变）。~~「`marketReload()` 这个 action 保留、只失去入口」的说法作废~~——用户随后裁决**直接删除**，见 S-16。契约落点见 `docs/contracts/client.md` §3.5 的组件树、§3.9.1 的「已删除」行与 §3.9.8，用例扩在 K137 |
| S-16 | **`marketReload()` 删除，不留「预留」** | 市场页签撤掉页头工具条（S-15）之后这个 action 已经**零调用方**。用户裁决删掉而不是留着：市场重取本来就有两条真实 driver（面板自身的 effect：切回页签 / 搜索 / 筛选变化；整页错误态的「重试」），再留一个没人调、语义又与它们重叠的 action，就是第二个真相源——下一轮一定有人照它写代码，然后发现它不在任何调用链上。同轮连带：`state.js` 删 action（实现侧）、`docs/contracts/client.md` §3.9.3 动作表删行且 §3.9.1 那行改「已删除」、`acceptance.md` 的 **K49** 改成「市场页签没有页头刷新且 `marketReload` 已退役」、**K101** 的 driver 换成面板重取（断言值等价：`items` 留 1 条、`pages=0`、`listStatus='loading'`）。`clearedPaging` / `pages=0` 的口径不随之消失，只是现在挂在那两条 driver 上。K 号保留、不退役、不复用 |
## 附录 T GitHub 添加形态（U21，2026-11-12）

> 上游 PRD 用**宿主自己的** `parseInstallSpec` 跑了 30 个样例（我另跑一遍复核，见 T-3 的更正）。用户原话：「完善添加技能的功能，对齐宿主，也就是补充 github 链接添加」。三条口径用户已拍板：只接 GitHub 链接 + `github:o/r` 简写、根 → 自动探测唯一 `SKILL.md`、本机 git 浅克隆后复用 U20 的拷贝管线。

| # | 事项 | 取法与理由 |
| --- | --- | --- |
| T-1 | **`add` 的入参从 `{path}` 改名 `{spec}`** | 一个字段一个分类器，与宿主 `inspect(spec)` 同构。我们只有一个客户端，**不做双字段兼容**：`{path}` 从此落 `E_BAD_REQUEST`（可断言，K146），`api.addSkill({spec})`、`client.md` §3.9.4 与测试同轮改 |
| T-2 | **`E_BAD_PATH` 的适用面收窄**（改语义、不改键、不改值） | U20 里 `./rel/path` 与裸 `o/r` 落 `E_BAD_PATH`（「需要以 / 或 ~ 开头」）。分类器接管后，只有「看起来是路径（`/` 或 `~` 开头）但展开后不合法」才落它；其余归 `E_GIT_SPEC_INVALID`——后者的文案会把两种正确写法都说出来，对那两类输入更有用 |
| T-3 | **比宿主宽（D4）：接受 `/tree/<ref>[/<sub…>]` 与尾斜杠** | 这是本轮**主要增量**，也是与宿主的实质偏离。我独立复核过宿主解析器：`HOSTED_REPOSITORY_URL` 只允许 host/owner/repo 三段，第 4 段起一律 `a URL must point at a git repository or a tarball` ⇒ **浏览器地址栏那条链接宿主根本收不了**。更正 PRD 两处：`ssh://git@…` 宿主落的是「不是合法包名」而不是 git 形态；`*.tgz` 宿主判 `kind:'tarball'`（接受），不是拒。两条都不改我们的裁决（都拒） |
| T-4 | **克隆超时 60s（D5），宿主探活 5s** | 宿主那 5s 是 `ls-remote`（只问 HEAD）；`clone --depth 1` 要下真内容，5s 会把正常仓库判死。60s 一个数、可配，真机上若大仓库仍卡住再调 |
| T-5 | **不复刻「GitHub 失败」恢复专屏（D6）** | 宿主那屏的动作是「改用国内镜像重试」；我们的技能不经过 npm 源，没有镜像可换，复刻等于给一个走不通的动作。能力退化成一个字段下报因的码（`E_GIT_UNREACHABLE` 文案写成宽句） |
| T-6 | **不接 SSH / 非 `github.com` 主机 / tarball / URL 内嵌凭据** | 用户口径 1。四种都归 `E_GIT_NOT_SUPPORTED`（一句话说全），不为它们各开一个码 |
| T-7 | **「分支 / 标签不存在」与「凭据需要登录」并入 `E_GIT_REPO_NOT_FOUND`** | 一个码一句话说全三种可能（仓库不存在 / 无权限 / 分支或标签不存在）。宿主把凭据类归 `unknown`（注释明说），我们合成一条——差别只在「这句话准不准」，不加码收益更大 |
| T-8 | **`ref` 只取 `/tree/` 后第一段** | 含 `/` 的分支名（`feature/x`）**不支持**，登记为已知限制：要么先选分支根再用 `#path:`，要么用分支根链接。不做「最长前缀试克隆」——那要试错克隆，失败模式不可预测 |
| T-9 | **不写自有 `_meta.json`；仓库自带的原样复制** | ① 两种形态产物必须同构（U20 的 path 形态也不写）；② 不写 ⇒ `upstream` 恒 `null` ⇒ 详情页不查上游版本、不显示「可更新」，正好等于非目标「git 装的不参与市场更新」；③ 写进去就得维护第二份「这个技能是谁」，而台账已经在记（附录 S-7 的教训）。副作用如实登记：仓库自带 `_meta.json` 且三件套齐时 `upstream` 非 null，详情页可能显示「可更新」——那是仓库作者的声明。**`lib/market/store.js` 的 `normalizeRecord` 是白名单**，`repo`/`ref`/`commit` 必须与写侧同轮扩容，否则下一次读盘就没了 |
| T-10 | **`add.fetching` 提升为 P0，候选列表不自动提交** | 克隆是 10s 量级、本地拷贝是 100ms 量级，同一句「正在添加…」会让用户以为卡死（宿主不需要是因为它的 pnpm 安装有终端输出）。多候选点一条只**改写输入**不提交：提交权永远在用户手上，与宿主「填入示例」同一种语义 |

| T-11 | **相对路径与裸 `o/r` 归 `E_GIT_SPEC_INVALID`，不新建码** | 分类器接管后，`E_BAD_PATH` 只覆盖「**看起来是路径**（`/` 或 `~` 开头）却不合法」（含 NUL / 展开后超 1024 / 展开后仍非绝对）。`rel/path`、`./x`、`../x`、`o/r`、`github.com/o/r`（无 scheme）一律落 `E_GIT_SPEC_INVALID`——它的文案「认不出这个输入：请填本机目录或 GitHub 链接」对这几类都更有用，而 `E_BAD_PATH` 那句「需要以 / 或 ~ 开头」会把一个想填 GitHub 链接的人引向错的方向。落地：`lib/local/rules.js` 的 `classifyAddSpec` 尾部兜底就是它；`docs/contracts/routes.md` §8.1 的 `E_BAD_PATH` 行与 §3.3.4 的 S1/G1 措辞已同步（D.9 的 K138 钉的就是这次收窄） |
| T-12 | **git 形态不另取 `local:<name>` 那把锁**：`S8` 的 key 用 `github:<owner>/<repo>` | 克隆开始的那一刻**还不知道技能叫什么**（名字要等 G4 定位 + S5 取名才有），拿不到 `local:<name>`；嵌套两把锁会同时占掉全局 2 个名额里的两个，让并发的 path 形态 `add` 无谓吃 `429 E_INSTALL_BUSY`。同名并发仍由 **S6（重扫后同名即拒）+ `landSkill` 的 `mkdir` claim（`EEXIST` ⇒ 409）** 兜住——两道闸都在落位前，不依赖锁。切子目录不改锁：同一仓库不并行克隆两次 |
| T-13 | **`locateSkillDir` 放在 `rules.js`，但它是 `async` 且会读盘** | 它要 `lstat` / `readdir` 才能探测，同步做不了。这里「纯」的定义收紧为：**无时钟、无网络、不写盘、只读**（对比 `classifyAddSpec`：连 I/O 都没有）。放在 `rules.js` 是为了让「一份输入怎么变成一棵树里的一个目录」这两步挨着，而不是把它塞进 `git.js`（那会与子进程混在一起）。`docs/contracts/data-model.md` §3.2.6 的注已按此改写，测试用真目录或注入的假目录均可 |
| T-14 | **7 条 git 错误文案按体积预案①压短**（`add.fetching` 等新键不动） | 设计 §12 预估客户端增量 ≈ +4.4 KB、会顶穿**当时的上限 175000**；预案①（错误句压到 ≤60 汉字、把「为什么」挪进 `add.description`）执行后产物 **174755 B / 175000**（U21 当时的上限；U22 抬到 **180000**，最新实测 **177498 B**，余 2502——以 K115 为准）。代价是文案比 PRD §10.1 草拟的短（例如 `E_GIT_SPEC_INVALID` 由「…请填本机目录的完整路径（以 / 或 ~ 开头），或 GitHub 链接（https://github.com/owner/repo 或 github:owner/repo）」压成「认不出这个输入：请填本机目录或 GitHub 链接」）。**`docs/contracts/client.md` §8.3 已按 `locale/zh.json` 实测值回填**，以此为准；U21 收口时键数 **193**（U22 的添加菜单再加 4 键 ⇒ **197**，见附录 U），没有为省体积退役任何键 |

| T-15 | **`E_ADD_AMBIGUOUS_SKILL` 的 `data` 必须带 `owner`/`repo`**（U21 缺陷 P1 的裁决） | `locateSkillDir` 只看克隆目录，天然不知道仓库是谁，它给的 detail 只有 `{candidates, candidateTotal}`；客户端要拼 `github:<o>/<r>#path:<sub>` 就必须知道 owner/repo，于是这一支在真机上表现为「弹窗只显示一句话、画不出候选按钮」。裁决：**由编排层补齐**——`lib/local/index.js` 的 `addFromGithub` 在 G4 只对 `E_ADD_AMBIGUOUS_SKILL` 重新包一层 `localError(..., { ...error.detail, owner, repo })`（取入参原样大小写），其余码原样透出、`E_ADD_NOT_SKILL_DIR` 的 detail 仍是 null。`locateSkillDir` 与码表、`LOCAL_STATUS`、`src/**` 都不动。契约落点：`docs/contracts/acceptance.md` 附录 D.9 的 K143 与真机第 11 条② |
## 附录 U 添加菜单两项（U22，2026-11-13）

> 用户给了宿主截图并要求「两项，第一项是安装第三方技能，第二项是让 Agent 创建技能」。宿主事实（我逐个复核过 asar）：`PluginManagerPage.tsx` 的 `AddPluginMenu` 是 children 模式 + `listClassName`，子节点是 primitives 的 `MenuItemButton`；第二项来自 `dsh-client-ui-agent-preset` 的 `CreatePluginMenuItem`，其 `startCreatorDraft()` 落到 `scope.uiWorkspace.startSession(undefined, { clearPreviousDraft: false, agentPreset: 'cordis' })`。

| # | 事项 | 取法与理由 |
| --- | --- | --- |
| U-1 | **第二项复用宿主的 Creator 草稿（`agentPreset:'cordis'`），不自己造创建流程** | 「让 Agent 创建技能」在宿主里不是弹一个我们自己的对话框，而是**导航到会话区并开一个 cordis 预设的草稿**——宿主已经拥有「创造模式」的全部 UI、预设装载与草稿管理。我们复刻一个只会更差：拿不到预设、拿不到草稿恢复、还得自己维护第二套入口。所以直接调同一个服务同一个参数，用户点完之后看到的与在宿主「插件」页点那一项**完全一致**（同一个 Creator 草稿）。代价是我们依赖 `uiWorkspace`（见 U-2）。**不做**的事：不新建会话（`undefined` 就是「复用当前草稿」）、不传自己的 `agentPreset`、不改 `clearPreviousDraft`（`false` 保证用户没提交的草稿不丢） |
| U-2 | **为调它把 `uiWorkspace` 加进 `inject`，并给出降级口径** | 硬约束 11 的守法是「**声明后再读**」，不是绕过：`src/client/index.jsx` 的 `inject` 加 `uiWorkspace`（宿主 `dsh-client-ui-workspace` 提供）。**为什么这条服务是安全的**：workspace UI 是宿主两半的共同底座（桌面与 web 都装，会话区本身就是它），不是可选插件——真机上它一定在。即便如此仍按「可能缺席」写，且降级是**两层**：`ready = typeof uiWorkspace?.startSession === 'function'`，在**菜单打开前判一次**（不是每次点击再算）——① 读 `ctx.uiWorkspace` 本身抛错 ⇒ 当作没有（`ready=false`）；② 点击时 `startSession` 抛错 ⇒ **吞掉并返回 false**。`ready` 为假时该行 `disabled`、副行切 `add.createWithAgentOff`「当前部署没有创造模式」；两种情况都**不抛错、不冒泡、不把整页转成错误态**——硬约束 11 的失败后果是整页 web boot 失败，这里必须兜住（一个菜单行不许把面板带下来）。** knowingly 简化**：宿主那行有 4 态副行（`createPluginChecking` / `Unavailable` / `Missing`），我们不做——省 4 个键与体积，代价是禁用时不解释原因 |


## 验收

每条登记都必须能指出来源（PRD 原文 / 宿主读数 / 队长决策 / 测试用例），没有一条是「因为我觉得」。登记与实现不符时，先改实现或先改登记，不允许两边并存。
