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
| C-4 | 技能市场页签只渲染占位文案 | 队长决策 + PRD P0-13 |
| C-5 | 全行无点击，唯一交互是开关 | PRD Q6 / D2 |
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
| A7 | P1/P2 全部不做（搜索、状态筛选、来源 tooltip、同名遮蔽提示、市场页签、项目级根） | PRD §3.2 P1/P2；设计里只留不冲突的钩子（`Row.rule`/`Row.confidence` 已在 payload 里，P1 加 tooltip 不需要改 Host） |
| A8 | 客户端不需要 `localStorage`（页签状态用模块级 store） | 满足 P0-3「离开页面再回来保持」；整页 reload 后回到「已安装」是宿主同款行为 |

---

## 验收

每条登记都必须能指出来源（PRD 原文 / 宿主读数 / 队长决策 / 测试用例），没有一条是「因为我觉得」。登记与实现不符时，先改实现或先改登记，不允许两边并存。
