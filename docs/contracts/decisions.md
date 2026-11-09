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
| B-1 | §3.3.1 状态文案 = `.status`，13px/20px | 页头状态文案在宿主是 `.updatesNote`：`color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px`；`.status` 只用于页内状态段（`partsEmpty` / `installChecking` / `unavailable`） | 采用 `.updatesNote` 的 12/18。文案本身按队长决策改为计数（`共 N 个技能`） |
| B-2 | §3.3.1 刷新中「14px 旋转指示」 | 宿主是 `StateDot state="ongoing" size={13}` 放在按钮 `icon` 位；14px 是 `.toggleProgress` 的**开关**占位（`--bundle-progress-size:14px`） | 刷新用 `StateDot`；开关 pending 用 14px 占位 + `StateDot`。保留 PRD 的「≥400ms、重复点击忽略」行为 |
| B-3 | PRD §3.3.5 错误态文字 = `state-error-primary` | 宿主 `.failure{color:error}` 但内部 `<p>` 被 `.failure p` 覆盖成 `label-tertiary`；错误信号由 `StateDot state="error"` 承担，`role="alert"` | 照宿主：容器 error 色 + 文字 tertiary + 红色 StateDot。若用户要求文字也变红，改 1 条规则即可 |
| B-4 | PRD §3.3.4 行 hover/active 底色 | 宿主行是链接（`.cardLink:hover`）；我们的行**不可点击**（Q6 + 队长决策） | **不实现** hover/active；给不可点的行加 hover 反馈等于骗点击 |
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
| C-5 | ~~全行无点击，唯一交互是开关~~ **（已改写为「按页签划边界」：已安装行不可点；市场卡片的整卡点击层 + 两个动作位（安装 / 收藏）；见附录 E、附录 J 与 `docs/contracts/market.md` 附录 F）** | PRD Q6 / D2 |
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
| A1 | 本 profile（desktop）的 `ctx.skills` 在 Host 平面能看到 `dsh-skill-filesystem` 的 provider 条目（因为 `@deepseek-ai/dsh-base` 在 profile 层挂了它） | 调 `GET /api/dsh-skill-center/health`，看 `registry.complete` 与 `counts`；若 builtin 恒为 0 而实际有 bundled 技能 → 假设不成立，退化为「只靠自扫描 + 硬编码无 builtin」（`lib/registry.js` 已把快照失败降级成空集） |
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
| J-2 | 收藏存哪、键是什么 | 别人的存储（`~/.dsh/skills-manager/state.json`、`skill-market/*`、`.skills-lock.json`）对本面板只读（`AGENTS.md` 硬约束 10），书签只能落本插件自己的目录 | `$DSH_HOME/dsh-skill-center/favorites.json`，键 = `marketId(source, owner, slug)`（与图标缓存 / 上游标题 / 安装台账同一个键）；`{version:1, favorites:[…]}` 最新在前；上限 500；写盘走 `store.js` 的 `writeAtomic`；进程内一条 Promise 链串行化；与现状一致的写入不落盘（幂等）。读侧只在 `market/bootstrap`（`favorites` + `favoritesOk`），**不新增 GET**；写侧一条 `POST market/favorite`（见 `docs/contracts/routes.md` §3.7.6） |
| J-3 | 三段数字各是什么口径 | 参考项目的 `Stats` 是「下载 / 收藏 / 评分」三段；SkillHub 的 `stars` 是小整数（实测 37 / 99 / 158）、`score` 是 0–100000 的连续分（实测 `95757.41562195931`） | 下载 = `downloads`；收藏 = 上游 **`stars`**（不是你自己的书签，你自己的由按钮 `aria-pressed` 表达，两者不合并）；评分 = `4 + min(1, score/100000)` 量化到一位小数。`rating` **不进数据层**：它是客户端的显示投影，Host 只给原料 `score`（`normalize.js` 的「只映射、不解释」）。`score <= 0` 时评分段整段不出现——`4.0` 是缺值伪装成的分数 |
| J-4 | 三段与安装按钮能否同一行 | 安装按钮四态（安装 / 已安装 / 安装中… / 重试）宽度不同：段宽 =（内容宽 − 按钮宽 − gap）/ 3，`安装` 与 `已安装` 差一个汉字 ≈12.5px ⇒ 每段差 ≈4.2px，同屏两卡的「收藏」「评分」列各错开 4.2 / 8.4px；最窄卡（280−28=252px）塞进「安装中…」（≈78px）后三格只剩 ≈166px，每格 ≈55px 而中文 `1135万` 需 ≈39px 文本 + 16px 图标 | **三段独占一行**（`repeat(3, minmax(0,72px))` 左对齐）、安装按钮另起一行右对齐（`.skc_marketCardEnd` 既有声明一字不改）。代价是卡片高 ≈28px，换来四种情况下数字列零抖动 |
| J-5 | 缺段的格子：占位还是不占位 | 若缺段就让后面的段左移，一张缺「收藏」的卡会把「评分」挪到第二格，同屏立刻错位 | **槽位占位、内容不出现**：三格轨道恒在（同列的 x 坐标在任何两张卡上相同），空格里没有图标、没有数字、没有 `0`、没有破折号，读屏也读不到（`aria-hidden`）；三格全缺时整行不渲染（否则卡片中部剩三格空白） |
| J-6 | 作者行显示 `@owner/slug` 还是 publisher 中文名 | 用户原话的例子逐字是 `@indiv-integrator/dev-expert-pro`（= `@` + owner + `/` + slug），而这两个字段两源必填（路由白名单就要求），`author`（publisher 显示名）反而可能缺失 | **`@owner/slug`**（`authorTextOf` 三级回落：`owner/slug` → `owner` → `author`）；`market.metaAuthor` 文案 `@{author}` 一个字不改，插值换成 handle。代价：卡片不再出现 publisher 中文名，它仍在详情事实表的「作者」行 |

---

## 附录 K 市场工具栏间距（2026-11-09）

> 用户指着「技能市场」工具栏右侧那一组（搜索框右端 + `SkillHub ⌄` + `推荐 ⌄`）说「间距有些问题」。实测在隔离实例里做完再定，完整过程见 `.agents/work/wip/U4-toolbar-spacing.md`；刻度表在 `docs/contracts/market.md` 附录 F。

| # | 待定说法 | 实际（逐字证据 / 算式） | 处理 |
| --- | --- | --- | --- |
| K-1 | 搜索框与两个菜单之间留多少 | 附录 F 逐字抄了宿主的 `.marketButton{margin-left:-8px}`，而工具栏 `gap:8px`：负边距把第一段吃成 **0**，第二段 8，右端 0（`推荐` 贴内容右边界）。实测（1320×940、内容宽 944）：搜索框右沿 1120.1 = 来源菜单左沿 1120.1；有词时清空按钮右沿也是 1120.1——× 直接贴住菜单。宿主这么做是因为它自己的按钮内边距更小，抄到位后在本面板里读起来像「搜索框里长出了两个菜单」 | **去掉 `margin-left:-8px`**（用户 2026-11-09 拍板）：间距变成 8 / 8 / 0，右端仍贴内容右边界；清空按钮与来源菜单之间回到 8px。代价：相对宿主整体 +8px，附录 F 已标成「唯一偏离」 |
| K-2 | 两个同级菜单要不要同字重 | 只有来源菜单带了 `skc_marketSelect`，排序菜单没带：实测 `SkillHub` 是 500、`推荐` 是 400（同为 12px），同排两个同级控件看着不是一套。这是「只抄了半套」的实现漏，不是设计选择 | **两个菜单同带 `skc_marketSelect`**：字重统一 500、`max-width:240px` 统一生效；`text-overflow:ellipsis` 的标签类本来就两边都有 |
| K-3 | 搜索框有词时的清空按钮 | `Input` 的 `type="search"` 没被 `appearance` 收口，Blink 会在输入框内自己画一枚取消按钮，与面板自绘的清空按钮并排出现（实测：框内一枚原生 ×、框外 8px 又一枚自绘 ×） | **只留自绘那个**（它带 `aria-label` / `title`，可本地化、可被读屏念到）：`.skc_marketSearch input::-webkit-search-cancel-button` 关掉原生按钮。宿主市场页没有对应规则，这条算本面板自己的收口 |

---

## 附录 L 市场卡片重排（U5，2026-11-09）

> 用户看完 U2 真机截图说「和我想的不一样」，给了一张 646×360 的草图；用户原话「具体的间距等情况应该是你来定的，这个只是我画的一个草图」。逐行结构见 `.agents/work/wip/U5-card-relayout.md`。

| # | 待定说法 | 实际（证据 / 算式） | 处理 |
| --- | --- | --- | --- |
| L-1 | 安装按钮放哪 | 草图画在头部右侧；U2 把它放在底行右下（新刻度 ③ 的来源） | **头部右侧**：`.skc_marketCardEnd` 整块搬进 `.skc_marketHead`，**类名与 `z-index:1` 都不动**（改名要动 7 处，且会丢掉「浮在点击层之上」的唯一 grep 锚点），只删 `align-self:flex-end`。头部 `align-items:center`（与已安装行同配方）+ `nowrap`（flex 默认）：安装四态 ≈52/64/78/52px，变宽只让标题收缩成省略号。标题行 `align-self:flex-start` + `max-width:100%` + **`flex-wrap:nowrap`**、标题 `flex:0 1 auto` + `min-width:0`：品牌图**紧跟标题**（只隔 8px gap），长标题自己省略——`flex:1` 会把品牌图推到文本块最右端，与草图不符。`wrap` 同样不行：换行容器先按 flex base size 分行，收缩只在行内生效，超长标题会先把品牌图挤到**第二行**（实测 `skillhub:tencent-adm:tencent-docs` 与 `skillhub:beatra-ai:beatra` 两张卡：标题行高 20px → 44px、标题占满 162px），改 `nowrap` 后长标题在行内省略、品牌图留在第一行 |
| L-2 | 三段顺序 | 草图 `★ 5.0 · ↓ 1135万 · 🔖 101` | `MARKET_STAT_SLOTS` 与 `statSegments` 字面量都改成 `rating·downloads·saves`；**槽位仍恒三格**，所以对齐（x 逐格相等）与「缺段留空」都不受影响；ClawHub 只有下载 ⇒ 渲染成「空 / 下载 / 空」 |
| L-3 | 标签从哪来、要不要转小写 | SkillHub `subCategories: [{key, name}]`（`dev-god` = 代码生成 / Bug 修复 / 后端开发，实测正好三枚）；ClawHub `topics: string[]`（`buzzmark` = social-media / content-scheduling / linkedin / instagram / mcp，混着 `Marketing`、`Email`）。**ClawHub 的 `tags` 是 `{latest: version}`，不是标签** | SkillHub 取 `.name` 且**保留大小写**；ClawHub 取前 3 并**转小写**（同源内 kebab 与 Title Case 混排，统一才像一套；不做 title-case，否则 `mcp`→`Mcp`）。≤3 条、单条 ≤24 字符、同值去重、缺 = `[]` |
| L-4 | 空标签行的卡片高度 | 同屏不混源；SkillHub 少数条目 `subCategories` 为空 | **空数组整行不渲染**：占位会让「有标签」与「没标签」无法区分，且是谎报；差的一行由 grid 的 `stretch` 补成底部空白，验收① 管的是 x 不是 y |
| L-5 | 卡片上的收藏开关 | 用户决定：「本版不要收藏开关，只显示上游收藏数」 | 拆**客户端写侧**（卡片按钮 / `marketFavoriteToggle·Ok·Fail` / `api.marketFavorite` / toast 的 `favorite-failed` / 4 个 `market.favorite*` 键 / `BookmarkMark`）；**后端一条不删**（store / 路由 / `bootstrap` 两键 / 两个 `error.E_FAVORITE_*` 文案），**读侧 `favorites` + `marketFavoritesLoaded` 也留**（M8 接回 UI 时零 Host 改动）。K80 退役、号不复用 |

---

## 验收

每条登记都必须能指出来源（PRD 原文 / 宿主读数 / 队长决策 / 测试用例），没有一条是「因为我觉得」。登记与实现不符时，先改实现或先改登记，不允许两边并存。
