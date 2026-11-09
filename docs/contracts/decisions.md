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
| C-5 | ~~全行无点击，唯一交互是开关~~ **（已改写为「按页签划边界」：已安装行不可点、市场卡片可点；见附录 E 与 `docs/contracts/market.md` 附录 F）** | PRD Q6 / D2 |
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

## 验收

每条登记都必须能指出来源（PRD 原文 / 宿主读数 / 队长决策 / 测试用例），没有一条是「因为我觉得」。登记与实现不符时，先改实现或先改登记，不允许两边并存。
