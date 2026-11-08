# dsh_skill_center PRD

模式：PRD（简单）｜Language：中文（简体）

> 定位：DSH 新独立插件，视觉 1:1 对齐宿主侧栏「插件」页，首版只做「已安装」标签页。
> 本文不含系统设计与代码，实现细节由架构师决定。

---

## 1 项目信息

| 项 | 值 |
| --- | --- |
| 产品名 | 技能中心 / dsh-skill-center（包名待定，见 Q1） |
| Project Name | `dsh_skill_center` |
| 位置 | `~/Documents/Agents/Plugins/dsh-skill-center` |
| Programming Language | 待架构师定；**硬约束**：复用宿主 slot / 原语 / `--dsw-*` 令牌，不引入第二套样式系统（不引 MUI / Tailwind）。理由：本插件的验收标准是「与宿主插件页 1:1」，任何平行样式系统都会引入偏差 |
| 目标宿主 | DSH ≥ 0.2.1（「插件」页在 0.2.1 起进入侧栏，见 dshmarket README.zh.md 第 79 行） |
| 依赖的既有能力 | `ctx.skills` 注册表、`@deepseek-ai/dsh-skill-filesystem`（rank 扫描、`disable-model-invocation`、watch 热刷新） |

### 1.1 需求复述（用户原文要点，不得曲解）

1. 做一个 DSH 插件管理 skill，**界面 UI 与视觉效果与 DSH 原生侧栏「插件」页相同**。
2. 分两个标签页：「已安装」「技能市场」；**先做「已安装」**。
3. 「已安装」下面分三个分区：**内置技能配置**（DSH 或插件自带）、**本地技能**、**已安装技能**。
4. 参考 `MichengAI/dsh-skills-manager`、`zhu1090093659/dsh-web` 的 `dsh-skill-explorer`；本地 vs 已安装的判据参考 `montersy123/dsh-skill-market`。
5. 用户要求「能 1:1 复原就 1:1 复原」→ 设计层不许自作主张。

### 1.2 已拍板决策（不再讨论）

| # | 决策 |
| --- | --- |
| D1 | **新独立插件**，侧栏新增一条「技能」入口；现有三个技能插件（`@linxin666/dsh-client-ui-skill-explorer`、`@michengai/dsh-skills-manager`、`@montersy123/dsh-skill-market`）**先不动** |
| D2 | **内置技能配置**：列出 DSH 内置（bundled）+ 插件/provider 提供的技能，每行一个启用/禁用开关。**不做详情抽屉** |
| D3 | **扫描范围（首版）**：只扫用户级 `~/.dsh/skills`（含软链）。项目级 `.dsh/skills`、`.agents/skills`、`customSkillDirs`、其他 AI 工具的 skills 目录 = **P2 backlog，只记录不实现** |
| D4 | **包名/位置**：`~/Documents/Agents/Plugins/dsh-skill-center` |

---

## 2 产品定义

### 2.1 产品目标（3 个，互相正交，各自可度量）

- **G1 · 一眼分得清（正确性）**：对本机 `~/.dsh/skills` 下的每个技能，面板给出的三分区归属与人工标注**一致率 100%**。验收基线 = 本文 §3.1.3 的 5 条真实样本，要求 5/5 命中；其中软链 1 条必须落在「本地技能」，带市场来源元数据/前缀的 4 条必须落在「已安装技能」。
- **G2 · 开关一定真生效（可靠性）**：任一行的启用/禁用操作，**写入成功且可回读一致率 ≥ 99%**；失败时 100% 回弹到原状态并给出可见原因（不允许「看起来关了其实没关」）；面板关闭重开、DSH 重启后开关状态与磁盘真源 100% 一致。
- **G3 · 少一点等待与翻找（效率）**：首屏（含读取注册表 + 扫描技能根 + 渲染三分区）**P95 ≤ 800ms**；单分区超过 12 行时提供搜索过滤（P1）前，用户通过分区归属即可在**不滚动超过 1 屏**内定位到目标技能（自测：5–40 条技能规模下成立）。

三条互不重叠：G1 衡量分类正确，G2 衡量写入可靠，G3 衡量读取与定位效率。

### 2.2 目标用户与场景

| 用户 | 场景 | 现在怎么痛 |
| --- | --- | --- |
| **主用户 · 重度 DSH 用户（技能数量 5–40 条）** | 装了市场技能、也自己写技能、还有插件自带的技能，想临时关掉一个 | 现在 `~/.dsh/skills` 混着软链、市场安装目录、手写目录，靠 `ls` + 改 frontmatter 猜；改错就得重新找 |
| **次用户 · 技能作者** | 在 `~/Documents/Agents/Skills/<name>` 维护技能并用软链挂进 DSH | 软链在文件层面和真目录看不出区别，容易误删真目录、或误以为市场装的和自己维护的是同一类 |
| **次用户 · 刚装完技能的回归用户** | 装完技能回到侧栏确认到底进了哪里 | 没有统一视图；三个既有技能插件各说各话，来源口径不一致 |
| **反用户 · 只想逛市场的人** | 只想看有什么可装 | 不是本插件首版目标（「技能市场」页签 P2） |

### 2.3 用户故事（5 条）

- **US1**：As 技能库已被三类来源弄混的重度用户，I want 一眼看清哪些是内置、哪些是我手写的、哪些是从市场装的，so that 我删除或升级时不会误改内置技能、也不会误删自己维护的那份。
- **US2**：As 想临时省 context 的用户，I want 在行右侧一键停用某个技能并立刻生效，so that 我不用去翻 `SKILL.md` 改 `disable-model-invocation` 再重开会话。
- **US3**：As 刚装完技能的回归用户，I want 点「刷新」后新技能出现在**正确的分区**，so that 我能确认安装/挂载真的生效，而不是去翻文件系统。
- **US4**：As 用软链把技能挂在自己 git 仓库里维护的作者，I want 面板明确告诉我这条是软链、开关会写到哪个真实文件，so that 我不会在不知情的情况下改动仓库文件。
- **US5**：As 第一次打开面板或遇到读取失败的用户，I want 看到一句解释得通的空态/错误态并能重试，so that 我不会以为面板坏了、也不会以为技能丢了。

---

## 3 技术规范

### 3.1 分区判据（本文档最核心的规范）

#### 3.1.1 可判定的输入信号

| ID | 信号 | 精确取值来源 | 判定强度 |
| --- | --- | --- | --- |
| **R1** | 注册表提供方名 | `ctx.skills` 条目上的 provider 名：`filesystem`（磁盘）/ `runtime`（插件 `ctx.skills.register()` 注册的内存技能，该名保留）/ 其他插件自注册 provider | 强（身份级） |
| **R2** | 文件系统根的 rank | `dsh-skill-filesystem` 默认根：`project-dsh` 100 / `project-agents` 200 / `custom`(=`customSkillDirs`) 300 / `user-dsh` 400 / `user-agents` 500；`bundledSkillDir` 配置后为 600 | 强（位置级） |
| **R3** | 条目绝对路径 | `SkillSummary.path`（解析后的指令文件路径；软链按 realpath 解析） | 强（位置级） |
| **R4** | 是否软链 | 对 `~/.dsh/skills/<entry>` 做 `lstat().isSymbolicLink()`（不是 `stat`） | 强（意图级） |
| **R5** | 安装台账 | ① `$DSH_HOME/dsh-skill-market/installed.json`（键 = 目录名，值 `{version, at, namespace, slug}`）；② `$DSH_HOME/skills-manager/repositories.json` 的 `installs[]`；③ `<root>/.skills-lock.json` 的 `skills{}`（按 name / declaredName 索引）；④ 本插件自己的安装记录（P2 才有） | **最强（现网唯一权威）** |
| **R6** | 来源元数据（skills-manager 口径） | `<skillDir>/_skillhub_meta.json` 或 `_meta.json` 里出现 `source`（或 `sourceType: "github"`），且能被解析成 repo/URL | 强 |
| **R7** | 发布记录（ClawHub 口径） | `<skillDir>/_meta.json` 里同时出现 `ownerId` + `slug`（通常还带 `version` / `publishedAt`） | 强（现网实际命中） |
| **R8** | 目录名结构 | 目录名匹配 `^[a-z0-9][a-z0-9-]*--[a-z0-9][a-z0-9-]*$`，且 `--` 之后的段与技能声明名（frontmatter `name`）相同 | **中**（结构佐证，不单独可信） |
| **R9** | 当前启用状态 | `SKILL.md` frontmatter 的 `disable-model-invocation`（严格布尔：`true/false/yes/no/on/off/1/0`，大小写不敏感；拼错会让整个技能被丢弃） | 只表示状态，**不是来源证据** |

#### 3.1.2 判定优先级（首个命中即定，从高到低）

| 序 | 条件 | 归属 | 说明 |
| --- | --- | --- | --- |
| 1 | `R1` provider ≠ `filesystem` | **内置技能配置** | 插件/provider 提供的技能，无用户可写的本地文件路径 |
| 2 | `R1` = `filesystem` 且 `R2` = 600 | **内置技能配置** | DSH 随包 bundled 技能 |
| 3 | `R2` ∈ {100, 200, 300, 500} | **不列入三分区** | 项目级 / 自定义 / 用户 agents 根：D3 明确列为 P2；首版**不展示**，页脚给一行计数「另有 N 个技能位于项目级或其他目录，首版不展示」 |
| 4 | `R4` 为真（软链） | **本地技能** | 软链 = 用户自己的挂载意图，优先级高于任何来源元数据（即使链接目标里带 `_meta.json`） |
| 5 | `R5` 任一命中 | **已安装技能** | 台账是唯一权威：**手抄一份带前缀的目录不该算安装** |
| 6 | `R6` 命中 | **已安装技能** | skills-manager 的 meta 口径 |
| 7 | `R7` 命中 | **已安装技能** | ClawHub 发布记录口径（现网主要命中项） |
| 8 | `R8` 命中 | **已安装技能（中置信）** | 结构佐证；置信度只进 tooltip 文案，不加视觉元素（避免破坏 1:1） |
| 9 | 以上都不命中 | **本地技能** | 兜底：没有来源证据的本地目录就是本地技能 |

**冲突处理（必须显式实现，不许靠顺序碰运气）**

- **软链 + 来源元数据** → 本地技能（序 4 胜）。
- **内置 + 用户根**：内置判定（序 1/2）永远胜出；同一个技能名同时被 bundled 和用户根提供时，按注册表胜者显示，且只显示一次。
- **同名跨分区**：不重复展示。按官方 rank **数值小者胜**（100 < 200 < 300 < 400 < 500 < 600），面板显示的必须就是模型实际拿到的那一条（对齐 `dsh-skill-explorer` 的立场）。P1 才加「被 X 遮蔽」提示。
- **R5 与 R8 相悖**（有前缀但台账明确记录它是 `local` 手导）→ 已安装技能；`origin=local` 与 `origin=market` 在 P0 视觉上不区分，P1 可作为 tooltip 文案。

#### 3.1.3 真机证据行（`~/.dsh/skills` 实测，2026-11-08）

| 条目 | 形态 | 命中的信号 | 结论 | 备注 |
| --- | --- | --- | --- | --- |
| `clawhub-michaelmonetized--frontend-design-3/` | 真目录 | R7（`_meta.json`：`ownerId=kn780r0jztja96vfbt1wz9pas1808t9c`、`slug=frontend-design-3`、`version=0.1.0`、`publishedAt=1770862472442`）；R8 同时命中 | 已安装技能 | 目录名为 `<handle>--<slug>`，`--` 后是 `frontend-design-3`，与 frontmatter `name: frontend-design` **不完全相同** → R8 只是佐证，不能单独用 |
| `clawhub-wpank--ui-design/` | 真目录 | R7（`ownerId=kn77z49xfssappp65hpybb9gx180x56e`、`slug=ui-design`、`version=1.0.0`、`publishedAt=1770726331187`）；R8 命中（`ui-design` = frontmatter `name`） | 已安装技能 | `SKILL.md` 自带 `version: 1.0.0` + `tags`，与 `_meta.json` 一致 |
| `indiv-guipi--find-skills/` | 真目录，**无** `_meta.json` | R8（`indiv--find-skills`，slug 段 = frontmatter `name: find-skills`；frontmatter 另有 `slug: find-skills`、`displayName`、`version: "1.7.0"`） | 已安装技能（中置信） | **唯一可用证据是目录名结构**；没有台账、没有 `_meta.json` |
| `indiv-integrator--dev-expert-pro/` | 真目录，**无** `_meta.json` | R8（slug 段 = `name: dev-expert-pro`） | 已安装技能（中置信） | frontmatter 用 `metadata.slug/displayName/version/summary` 嵌套写法 |
| `dev-docs-standards` | **软链** → `~/Documents/Agents/Skills/dev-docs-standards`（该目录是 git 仓库 main 分支） | R4 | 本地技能 | 链接目标内只有 `SKILL.md` + `references/`，无任何来源元数据 |

**负证据（同样重要，直接推翻了三份参考实现的部分假设）**

| 事实 | 影响 |
| --- | --- |
| `~/.dsh/skill-market/` **不存在**，`installed.json` 也无 | dsh-skill-market 的 `origin` 判据（`record[dir] === undefined → manual`）会把上面 4 条**全判成 `manual`**，即「不是安装的」 |
| `~/.dsh/skills/.skills-lock.json` **不存在** | skills-manager 的锁文件判据（R5-③）落空 |
| `~/.dsh/skills-manager/repositories.json` 的 `installs = []` | R5-② 落空 |
| 两个 `clawhub-*` 的 `_meta.json` **没有 `source` 字段** | skills-manager 的 `fromMarketMeta()` 走 `sourceInfo(metadata?.source)` → `undefined` → `null` → 回落 `{kind:'root'}`（= 来源未知）。**照抄 R6 会让 4 条市场技能全部落到「本地/未知」** |
| `~/.dsh/skills-manager/state.json` 里 `enabledSkills.dsh = ["dev-docs-standards"]`，`disabledSkills` 全空 | 这是**第三方开关存储**，不是来源证据；本插件只读它做交叉校验，**绝不写入**（写它就是替别人管状态） |
| `.DS_Store` 出现在技能根与技能目录里 | 扫描必须跳过点文件与 `skills` 根下的非技能条目，否则会多出幽灵行 |

> 结论：现网必须靠 **R5 → R6 → R7 → R8** 这条阶梯，任何单一口径都不够。R8 是 `indiv-*` 两条的唯一依据，因此必须保留但标为中置信。

### 3.2 需求池（P0 / P1 / P2）

句式：`must`（P0，必须）/ `should`（P1，应该）/ `could`（P2，可以有）。每条给判定标准。

#### P0 · 已安装页（首版交付）

| ID | 需求 | 判定标准 |
| --- | --- | --- |
| P0-1 | **必须** 提供侧栏入口一条 + **全局页**（不属于任何会话；打开任意会话即让主区回到会话正文，与宿主「插件」页一致） | 点入口进入页面；切到任一会话后主区是正文；页面自身不出现「返回会话」控件 |
| P0-2 | **必须** 页头 = 大标题 + 副标题 + ⓘ 信息按钮 + 右侧状态文案 + 「刷新」按钮 | 逐项对齐 §3.3 的像素/令牌规格；ⓘ 悬停或聚焦出共享 tooltip；点击后保持展开，直到再点 / Escape / Tab / 点外部 |
| P0-3 | **必须** 分段控件两个页签「已安装 / 技能市场」，默认「已安装」 | 控件总高 34px；选中块与外框间距 2px；离开页面再回来保持所选页签 |
| P0-4 | **必须** 「已安装」页按顺序渲染三个分区：**内置技能配置 → 本地技能 → 已安装技能**（按用户原始口述顺序） | 顺序固定；某分区为空时仍显示区标题 + 该分区空态文案 |
| P0-5 | **必须** 行结构 = 48×48 方形圆角图标 + 加粗名称 + 灰色单行描述 + 行右侧开关 | 对齐 §3.3；描述缺省时不占位；行高 64px |
| P0-6 | **必须** 按 §3.1.2 实现三分区判据（含优先级与冲突处理） | §3.1.3 五条样本 5/5 命中；同名只出现一次且是 rank 胜者 |
| P0-7 | **必须** 每行一个启用/禁用开关，读写语义见 §3.4 | 操作后回读一致；失败回弹 + 可见原因；重启后状态一致 |
| P0-8 | **必须** 「刷新」按钮重新扫描并重绘 | 刷新中显示旋转指示并禁用，至少 400ms（防闪烁）；重复点击被忽略；成功不弹 toast |
| P0-9 | **必须** 加载态：一条短区标题占位 + 四行骨架卡 | 骨架沿用真实卡片的行/图标/文字间距；呼吸动画规格见 §3.3；`prefers-reduced-motion` 下静止；无障碍文案「正在读取技能…」 |
| P0-10 | **必须** 空态：三个分区各自的空文案 | 见 §3.3.5；13px/20px、`--dsw-alias-label-tertiary` |
| P0-11 | **必须** 错误态：首次读取失败原位显示原因 + 「重试」 | 文案「可能由于网络问题，无法读取全部技能」+「重试」；颜色 `--dsw-alias-state-error-primary` |
| P0-12 | **必须** 有缓存时刷新失败：保留已有列表 + toast「刷新失败，请重试」 | 列表不清空；toast 在离开页面后仍可见 |
| P0-13 | **必须** 「技能市场」页签在 P0 显示占位空态（不实现浏览/安装） | 文案待定（Q5）；页签本身可点、可显示、不报错 |
| P0-14 | **必须** 只扫 `~/.dsh/skills`（含软链）；其余根不展示，页脚一行计数 | 项目级/自定义/用户 agents 根下的技能**不出现**在三分区；页脚文案「另有 N 个技能位于项目级或其他目录，首版不展示」（N=0 时不显示该行） |

#### P1 · 检索与打磨

| ID | 需求 | 判定标准 |
| --- | --- | --- |
| P1-1 | **应该** 搜索框：按名称 + 描述即时过滤 | 名称命中排在描述命中之前；Esc 清空；空结果文案「没有匹配的技能。」 |
| P1-2 | **应该** 状态筛选：全部 / 已启用 / 已停用 | 与搜索叠加生效；当前收窄维度可数 |
| P1-3 | **应该** 右上「＋ 添加技能 ⌄」分裂按钮（视觉 1:1 占位） | 无安装流程时**禁用**而非隐藏；禁用态 opacity .5；菜单项指向 P2 |
| P1-4 | **应该** 「刷新」悬停/键盘聚焦 500ms 后显示 tooltip | 与宿主插件页一致 |
| P1-5 | **应该** 行内来源 tooltip：显示来源证据与置信度 | 如「来源：ClawHub 发布记录（`_meta.json`）」/「目录名结构，未找到来源记录」/「软链 → /Users/.../dev-docs-standards」；只用 title/共享 tooltip，**不加视觉元素** |
| P1-6 | **应该** 同名被遮蔽提示 | 「被 <来源> 的同名技能覆盖」；仅在存在跨分区同名时出现 |
| P1-7 | **应该** 键盘可达：Tab 序 = 刷新 → 页签 → 各分区行开关；`aria-label` 为「启用 <技能名>」 | 全键盘可完成一次开关操作 |

#### P2 · 范围外（只记录，不实现）

| ID | 需求 |
| --- | --- |
| P2-1 | **可以** 扫描项目级 `.dsh/skills`（rank 100）与 `.agents/skills`（rank 200） |
| P2-2 | **可以** 扫描 `customSkillDirs`（rank 300）与用户级 `~/.agents/skills`（rank 500） |
| P2-3 | **可以** 扫描其他 AI 工具 skills 目录（清单见 §3.6） |
| P2-4 | **可以** 「技能市场」页签：浏览 / 搜索 / 详情 / 安装 / 卸载 |
| P2-5 | **可以** 版本与更新检查（参考图「所有插件均为最新版本」依赖上游版本探测，首版没有这条数据源） |
| P2-6 | **可以** 详情页 / 抽屉（**用户已在 D2 明确排除**，记录备查） |
| P2-7 | **可以** 与三个既有技能插件做入口与口径收敛（依赖 D1 解禁） |

### 3.3 UI 规格表（可核对到像素 / 令牌级）

**总原则**：所有取值来自宿主真实产物，不是估计。来源标注：
`[PM]` = `@deepseek-ai/dsh-client-ui-plugin-manager` 的 `lib/client.js` 内 `PluginManagerPage.module.css`（类前缀 `w6M7KW_`，逐字）；
`[TABS]` = 宿主 `SegmentedTabs`（`._tabs_1lga9_1`，`data-size=sm`，逐字）；
`[SW]` = 宿主 Switch（`._switch_1ik0f_5` / `._thumb_1ik0f_33`，见 `dsh-hidder/docs/reference/settings-ui.md` §4.4，逐字）。

#### 3.3.1 页面外壳与页头

| 元素 | 规格 | 来源 |
| --- | --- | --- |
| 页面 | `height:100%; padding:0 var(--plugin-page-inset); display:flex; flex-direction:column; align-items:center; color:var(--dsw-alias-label-primary)` | [PM] `.page` |
| 左右内边距 | `--plugin-page-inset: clamp(24px, 4vw, 48px)`；**窗口 ≤ 767px 时 20px** | [PM] `.page` |
| 内容最大宽 | 每个直接子元素 `max-width:960px; width:100%`，居中 | [PM] `.page>*` |
| 滚动容器 | 页头与列表共用 `pageBody`：`padding:0 <inset> 48px; gap:32px; overflow:hidden auto`；无页头兄弟时 `padding-top:32px` | [PM] `.pageBody` |
| 页头 | `padding-top:var(--plugin-page-top-inset)` = **28px**；`display:flex; flex-wrap:wrap; justify-content:space-between; align-items:flex-start; gap:16px` | [PM] `.pageHead` |
| macOS 额外留白 | `[data-platform=darwin]` 时 `padding-top: calc(28px + var(--dsh-frame-top-clearance,0px))` | [PM] `.pageHead` |
| 大标题 | `font-size:20px; font-weight:500; line-height:28px; margin:0` | [PM] `.pageTitle` |
| 副标题 | `font-size:13px; line-height:20px; color:var(--dsw-alias-label-secondary); margin:4px 0 0; display:flex; align-items:center; gap:4px` | [PM] `.pageIntro` |
| ⓘ 信息按钮 | `width:20px; height:20px; padding:0; color:var(--dsw-alias-label-caption); flex:none`；图标字号 11px；与副标题间隔 4px；20px 方形悬停区 | [PM] `.infoButton` + 插件页 README |
| 右侧操作组 | `display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:8px 16px; white-space:nowrap; order:2; min-width:0` | [PM] `.toolbar` |
| 状态文案 | `font-size:13px; line-height:20px; color:var(--dsw-alias-label-tertiary); margin:0` | [PM] `.status` |
| 「刷新」按钮 | `height:32px; padding:0 12px; font-size:13px; line-height:20px; border-radius:var(--dsw-radius-md)`；刷新中 14px 旋转指示 + 禁用，最短 400ms | [PM] `.addButton` 系 + 插件页 README |
| 「＋ 添加技能 ⌄」（P1） | 高度 32 / padding 0 12 / 13px·20px / radius md；主按钮 `border-top-right-radius:0; border-bottom-right-radius:0`；箭头 `width:32px; padding:0`，`border-left:.5px solid color-mix(in srgb, var(--dsw-alias-label-primary-foreground) 30%, transparent)`，左上/左下 0 | [PM] `.addPrimary` `.addMore` |
| 图标按钮（窄宽替换「刷新」） | `28×28; border-radius:var(--dsw-radius-sm); color:var(--dsw-alias-label-caption)`；hover 时 `background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-secondary)`；disabled `opacity:.5` | [PM] `.iconButton` |

#### 3.3.2 分段控件（两个页签）

| 属性 | 规格 | 来源 |
| --- | --- | --- |
| 容器（`data-size=sm`） | `display:grid; padding:2px; --segmented-tabs-inset:2px; border-radius: calc(var(--dsw-radius-md) + 2px); background:var(--dsw-alias-bg-module-platform)` | [TABS] |
| **总高** | **34px**（= tab 30px + 上下各 2px） | [TABS] |
| 页签 | `height:30px; padding:0 12px; border-radius:var(--dsw-radius-md); font-size:14px; line-height:20px; color:var(--dsw-alias-label-secondary)` | [TABS] |
| 选中页签 | `color:var(--dsw-alias-label-primary); font-weight:500`（sm 档；md 档为 600） | [TABS] |
| 选中指示块 | `position:absolute; inset:2px auto 2px 2px; border:.5px solid var(--dsw-alias-border-l3); border-radius:var(--dsw-radius-md); background:var(--dsw-alias-bg-layer-3); transition:transform .18s ease` | [TABS] |
| 焦点环 | `outline:none; text-decoration:underline; text-decoration-thickness:1px; text-underline-offset:4px` | [TABS] |
| 位置 | 页头下方（`order:3`，`flex:100%`）；窄宽时 `order:2`、`min-width:0`；滚动时停靠到「刷新」「添加」旁；页签存在时标题随滚动离开、页签停靠 | 插件页 README + [PM] `.pageTabs` |
| 页面级行为 | 页签在组合包/详情页隐藏；离开「插件」后所选页签保持；所选页签被移除时回到「已安装」 | 插件页 README |

#### 3.3.3 分区（group）

| 元素 | 规格 | 来源 |
| --- | --- | --- |
| 区块 | `display:flex; flex-direction:column; gap:8px` | [PM] `.group` |
| 区头 | `display:flex; align-items:center; gap:8px` | [PM] `.groupHead` |
| 区标题 | `flex:1; margin:0; font-size:14px; font-weight:500; line-height:22px`（**注意：不是设置页那套 12px/600/0.06em 大写字距**） | [PM] `.groupTitle` |
| 「更多 ›」入口 | `font-size:14px; font-weight:400; line-height:22px; gap:4px; color: color-mix(in srgb, var(--dsw-alias-label-secondary) 60%, var(--dsw-alias-label-tertiary))`；hover → label-secondary | [PM] `.groupMore` |
| 分区顺序 | 内置技能配置 → 本地技能 → 已安装技能 | D2 + 用户原文 |

#### 3.3.4 行（card）

| 元素 | 规格 | 来源 |
| --- | --- | --- |
| 列表 | `display:flex; flex-direction:column; gap:2px; margin:0; padding:0; list-style:none` | [PM] `.cards` |
| 行容器 | `border-radius:var(--dsw-radius-xl); margin:0 -8px`（左右各外扩 8px，让 hover 底色超出文字块） | [PM] `.card` |
| 行 hover / active | hover：`background:var(--dsw-alias-interactive-bg-hover)`；active：`var(--dsw-alias-interactive-bg-active)`；**仅在 `@media (hover:hover)` 生效** | [PM] `.cardLink` |
| 行内排布 | `display:flex; align-items:center; gap:14px; padding:8px` → **行高 64px**（48 + 8×2） | [PM] `.cardHead` |
| **图标** | `width:48px; height:48px; border:.5px solid var(--dsw-alias-border-l3); border-radius:var(--dsw-radius-lg); color:var(--dsw-alias-label-secondary); display:inline-flex; justify-content:center; align-items:center; flex:none`；图片 `object-fit:contain` | [PM] `.cardIcon` `.packageImage` |
| 主文本块 | `flex:1; display:flex; flex-direction:column; gap:4px; min-width:0` | [PM] `.cardMain` |
| 标题行 | `display:flex; flex-wrap:wrap; align-items:center; gap:8px; min-width:0`（徽标/状态标签放这里） | [PM] `.titleRow` |
| **名称** | `font-size:14px; font-weight:500; line-height:20px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis` | [PM] `.cardTitle` |
| **描述** | `font-size:13px; line-height:18px; color:var(--dsw-alias-label-tertiary); -webkit-line-clamp:1`（单行截断，多出省略） | [PM] `.cardDesc` |
| 行右侧容器 | `display:inline-flex; align-items:center; gap:8px; flex:none; position:relative; z-index:1` | [PM] `.cardEnd` |
| 标签（如「实验性」） | `height:18px; padding:0 7px; font-size:10px; line-height:1`（首版无标签，预留） | [PM] `.statusTag` |

#### 3.3.5 开关、加载、空、错

| 元素 | 规格 | 来源 |
| --- | --- | --- |
| **开关** | `width:36px; height:20px; padding:2px; border:0; border-radius:999px; corner-shape:round; background:var(--dsw-alias-border-l3)`；`[aria-checked=true]` → `background:var(--dsw-alias-brand-primary)` | [SW] |
| 开关滑块 | `16×16; border-radius:50%; background:var(--dsw-alias-label-primary-foreground)`；未选中时 `var(--dsw-alias-switch-thumb)`；`transition:transform .12s ease` | [SW] |
| 开关焦点环 | `outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset:2px` | [SW] |
| 操作区预留 | 开关左侧固定预留 **22px**（进度环 14px + gap 8px），保证状态变化不引起行内跳动 | [PM] `--bundle-progress-size:14px` `--bundle-toggle-gap:8px` + 插件页 README |
| 进度环 | `14×14`，`display:inline-flex`，内部 `svg{width:100%;height:100%}` | [PM] `.toggleProgress` |
| 状态播报 | 常驻 `aria-live` 区域（视觉隐藏：`clip-path:inset(50%); width:1px; height:1px; overflow:hidden`） | [PM] `.progressAnnouncement` |
| 骨架填充 | `background:var(--dsw-alias-bg-skeleton); animation:2s cubic-bezier(.36,0,.64,1) infinite`（`0%` opacity 1 → `40%` .6 → `80%,100%` 1）；`prefers-reduced-motion:reduce` 时 `animation:none` | [PM] `.skeletonFill` |
| 骨架条 | `height:12px; border-radius:var(--dsw-radius-xs); width:100%` | [PM] `.skeletonBar` |
| 骨架尺寸 | 区标题占位 `width:48px`；名称占位 `width:min(144px,60%)`；描述占位 `width:min(280px,85%)`；操作占位 `width:calc(36px + 8px + 14px)` = **58px**，`height:20px`；图标占位沿用 48×48 但 `border-color:transparent` | [PM] `.skeletonHeading` `.skeletonTitle` `.skeletonDescription` `.skeletonActions` `.skeletonIcon` |
| 骨架数量 | 一条短的区标题占位 + **四行**骨架卡 | 插件页 README |
| 空态 | `font-size:13px; line-height:20px; color:var(--dsw-alias-label-tertiary); margin:0` | [PM] `.empty` |
| 错误态 | `display:flex; align-items:center; gap:10px; color:var(--dsw-alias-state-error-primary)`；内部 `<p>` 13px/20px | [PM] `.failure` |
| 行内失败原因 | `font-size:12px; line-height:18px; color:var(--dsw-alias-state-error-primary); white-space:pre-wrap; overflow-wrap:anywhere; margin:0` | [PM] `.reason` |

**空 / 加载 / 错误文案（P0 必须逐字实现）**

| 场景 | 文案 |
| --- | --- |
| 加载中 | `正在读取技能…` |
| 首次读取失败 | `可能由于网络问题，无法读取全部技能` + 按钮 `重试` |
| 刷新失败（已有缓存） | toast `刷新失败，请重试` |
| 内置技能配置 · 空 | `这个部署没有内置技能。` |
| 本地技能 · 空 | `还没有本地技能。把技能目录放进 ~/.dsh/skills/ 就会出现。` |
| 已安装技能 · 空 | `还没有从市场安装技能。` |
| 搜索无结果（P1） | `没有匹配的技能。` |
| 技能市场页签（P0 占位） | 待定，见 Q5 |
| 页脚范围提示 | `另有 {count} 个技能位于项目级或其他目录，首版不展示` |

#### 3.3.6 滚动与响应式（1:1 必须实现，否则「像」但不是「一样」）

| 行为 | 规格 |
| --- | --- |
| 页头与列表共用滚动容器 | 页头随滚动移动，到紧凑态位置停住；反向滚动沿同一坐标返回 |
| 静止态留白 | 顶部 28px（+ darwin 安全区） |
| 紧凑态留白 | 顶部 16px，控件下方 16px；底部 `.5px solid var(--dsw-alias-border-l3)` 分隔线横跨整行页面 |
| 滚动范围 | 页头保留静止态布局高度，控件移动**不改变**列表滚动范围 |
| 收拢顺序 | 「刷新」/「添加」先退化为带 `aria-label` + tooltip 的图标按钮；标签再从常规最小宽收紧为文案宽；仍不足才让操作组换行 |
| 窄页面 | 页签与图标操作优先在标题下方共用一行；放不下时页签**始终在操作组上方**；滚动中两组控件的相对顺序不变 |
| 指针 | 悬停样式只在 `@media (hover:hover)` 下生效；触摸改用按下填充回馈 |
| 输入框字号 | 粗指针（`pointer:coarse`）下 16px，避免 iOS Safari 聚焦放大 |
| **macOS** | 静止态保留框架标题栏安全区；折叠态侧栏展开时上下各 16px，侧栏收起时再避让框架顶部安全区；**仅在 darwin + 侧栏收起时**，紧凑态额外顶部留白由 16px 减为 8px；静止态与紧凑态底部留白不变 |
| Windows | 使用框架已有标题栏偏移，**不重复叠加** |

#### 3.3.7 与参考图的差异（必须显式记录，不许偷偷改）

| 图上的元素 | 我们的处理 | 原因 |
| --- | --- | --- |
| 状态文案「所有插件均为最新版本」 | 位置/字号/颜色 1:1，**文案改为计数**（如「共 5 个技能，1 个已停用」） | 首版不做版本检查，写「均为最新版本」是在编造 |
| 第二个分区「实验性插件」+「更多 ›」 | 换成「本地技能」+「已安装技能」，**不带「更多 ›」** | 用户口述的三分区里没有可展开的更多页 |
| 行右侧开关 | 1:1（36×20 宿主 Switch） | 无差异 |
| 「＋ 添加插件 ⌄」 | P0 不呈现，P1 以禁用态呈现 | P0 无安装流程，放了不可用按钮等于假控件 |
| 行可点击进详情 | **全行无点击**，只有开关可交互 | D2 明确「不做详情抽屉」 |

### 3.4 开关状态语义（写入哪、失败怎么办）

| 分区 | 写入位置 | 生效方式 | 失败表现 |
| --- | --- | --- | --- |
| **内置技能配置** | `$DSH_HOME/dsh-skill-center/provider-toggles.json`（本插件自有的状态存储）。键 = `${provider}#${skillName}`（沿用 skill-explorer 的 `(provider, 名称)` 组合身份）。**只存身份，不存路径** | 面板读自己的存储决定开关；停用要求**最新一次扫描**仍能把该身份解析为 provider 行，因此存储里只可能是面板真正展示过的身份；启用只删记录（幂等，插件卸载后残留记录仍可清） | 写失败：开关回弹原状态 + 行内 `.reason`（12px/18px，error 色）给原因；开关本次操作期间禁用 + 14px 进度环 |
| **本地技能** | 就地改写该技能 `SKILL.md` 的 frontmatter：`disable-model-invocation: true`（停用）/ 删除该键或写 `false`（启用）。其余字段、注释、正文、BOM 与换行风格**逐字保留** | `skill-filesystem` 的 `watch: true` 让模型目录热刷新，无需重启 | 同上。写前先取文件指纹，写入后回读校验；回读不一致按失败处理并回滚 |
| **已安装技能** | 同「本地技能」（它们就是 `~/.dsh/skills` 下的普通技能，市场/管理器把技能装进的就是宿主自己的根） | 同上 | 同上。**已知限制**：市场或管理器后续「更新/重装」会整目录覆盖，`SKILL.md` 被换掉 → 开关状态可能被重置；首版只如实呈现，不试图守卫 |
| **软链技能**（属本地技能） | 写到 **realpath 指向的真实文件**（如 `~/Documents/Agents/Skills/<name>/SKILL.md`，可能位于用户 git 工作区） | 同上 | 同上；另需首次写入前的一次性确认（Q4） |

**通用规则**

1. **磁盘是唯一真源**：每次读取都从 `SKILL.md` / 自有 JSON 现算，不在内存里缓存开关状态。
2. **原子写**：自有 JSON 用「临时文件 + fsync + rename」；损坏、异构或超限的文档降级为「什么都没停用」，绝不因为存储坏了让整个面板打不开。
3. **不做乐观 UI**：点击后开关立即进入 pending（禁用 + 进度环），写成功才落新状态；失败回弹。不做「先翻转再回退」的闪烁。
4. **幂等**：重复点击、重试、双向切换都不得堆出重复记录或重复 frontmatter 键。
5. **不写别人的存储**：`~/.dsh/skills-manager/state.json`（`enabledSkills`/`disabledSkills`）、`$DSH_HOME/skill-market/*`、`~/.dsh/skills/.skills-lock.json` 一律**只读**。否则等于替第三方插件改状态、且两处口径会互相打架。

### 3.5 验收口径（给 QA 用）

| 编号 | 用例 | 通过标准 |
| --- | --- | --- |
| A1 | 本机 5 条真实样本 | 三分区归属 5/5 命中（对照 §3.1.3） |
| A2 | 新建一个手写目录 + 一个假 `clawhub-a--b` 空目录 + 一个软链 | 手写 → 本地；空 `clawhub-a--b` → 已安装（中置信）；软链 → 本地 |
| A3 | 停用本地技能后读 `SKILL.md` | frontmatter 出现 `disable-model-invocation: true`，且**其余字节不变**（diff 只有这一个键） |
| A4 | 停用后重启 DSH | 面板仍显示为停用 |
| A5 | 把 `provider-toggles.json` 改成非法 JSON | 面板正常打开，全部显示为启用（降级），不报错 |
| A6 | 读取期间断网/权限不足 | 首次失败 → 原位错误 + 重试；有缓存 → 列表保留 + toast |
| A7 | 窗口从 1200px 拖到 700px | 内边距 20px；操作组退化顺序符合 §3.3.6；页签在操作组上方 |
| A8 | `prefers-reduced-motion: reduce` | 骨架不呼吸；无位移过渡 |

### 3.6 Backlog（只记录，不实现）

**用户点名要记录的扫描范围**

| 项 | 官方 rank | 首版 |
| --- | --- | --- |
| 项目级 `<projectRoot>/.dsh/skills` | 100 | 不扫 |
| 项目级 `<projectRoot>/.agents/skills` | 200 | 不扫 |
| `Config.customSkillDirs` | 300 | 不扫 |
| 用户级 `~/.dsh/skills` | 400 | **唯一扫描** |
| 用户级 `<agentsHome>/skills`（默认 `~/.agents/skills`） | 500 | 不扫 |
| `bundledSkillDir`（DSH 随包 / 插件自带） | 600 | 不扫文件，但**通过注册表列出**（= 内置技能配置） |

**其他 AI 工具的 skills 目录**（来源：`@michengai/dsh-skills-manager` 的来源清单；本机 `state.json` 里 `dsh=true`、`agents=false`、`workbuddy=false`）

CC Switch、Codex、Claude Code、Gemini、OpenCode、Cursor、Copilot、Windsurf（含 user 档）、Trae、Trae CN、OpenClaw、Clawdbot、Roo、CodeBuddy、WorkBuddy、Qoder、Qoder CN（项目技能在 `.qoder/skills`）、Lingma、Antigravity（CC Switch 另有 `~/.dsh/skills-manager/roots.json` 覆盖机制与 32 个自定义来源上限）。

**其他 backlog**

- 「技能市场」页签的浏览 / 搜索 / 详情 / 安装 / 卸载。
- 版本与更新检查（需要上游版本探测，参考图的「均为最新版本」才有数据源）。
- 详情页 / 抽屉（D2 已排除，记录备查）。
- 分类、拖拽归类、批量启停（skills-manager 已有，本插件不重复造）。
- 与三个既有技能插件的入口收敛（D1 解禁后）。

---

## 待确认 / 假设

### 待用户拍板（按影响排序）

**Q1 · 入口命名（必答）**
现侧栏已有三条：「技能」（`@michengai/dsh-skills-manager`，其 `zhName` 硬编码为 `技能`）、「技能中心」（`@linxin666/dsh-client-ui-skill-explorer`，client 里硬编码 `技能中心`）、「技能市场」（`@montersy123/dsh-skill-market`）。四个名字已被占三个。
**建议：入口叫「技能管理」**（与「技能中心」区分明确，动词性更强，也贴合本页「管理 + 启停」的本质）。
备选：`技能库` / `全部技能` / `Skills`。若你更在意「与「插件」页对仗」，可用 `技能` + 副标题区分，但那会与 skills-manager 重名，不建议。

**Q2 · 状态文案**
参考图写「所有插件均为最新版本」。首版无版本检查，建议改为计数文案（`共 N 个技能` / `N 个已停用`）。是否接受偏离原文案？

**Q3 · 「＋ 添加技能 ⌄」按钮**
P0 是否留位？建议 P1 以**禁用态**出现（保住右上三件套的视觉节奏），P0 只留「刷新」。

**Q4 · 软链技能写 frontmatter 需不需要确认**
`dev-docs-standards` 的真实文件在 `~/Documents/Agents/Skills/dev-docs-standards`（一个 git 仓库）。开关会改写它的 `SKILL.md`。建议：**首次对软链技能写入前弹一次确认**（「这会修改 <realpath> 中的 SKILL.md，该文件位于你的 git 仓库内」），之后本次会话不再问。是否采用？

**Q5 ·「技能市场」页签 P0 的占位文案**
建议 `技能市场将在后续版本提供。`。或你希望整条页签 P0 就先隐藏（但会偏离「两个标签页」的视觉 1:1）。

**Q6 · 行是否完全不响应点击**
D2 只排除了「内置技能配置」的详情抽屉。本地/已安装两类是否也一律无详情（建议：是，全行只有开关可交互，避免出现半可点的行）？

### 假设（我已按此推进，如不成立请纠正）

1. **副标题文案**暂定 `启用、停用和查看技能来源`，ⓘ 说明文案暂定 `在这里启用或停用技能。内置技能、本地技能和从市场安装的技能分三组展示。`（等你确认 Q1 后可一并润色）。
2. **名称显示**用 `SKILL.md` frontmatter 的 `name`；若 frontmatter 有 `displayName`（`indiv-guipi--find-skills`、`indiv-integrator--dev-expert-pro` 都有），P0 仍显示 `name`，`displayName` 只进 title tooltip——理由是分区判据和 rank 裁决都基于 `name`，界面用另一个名字会让「哪个是模型拿到的」变得不可判定。
3. **描述来源**：注册表条目的 `description`；文件系统条目读 `SKILL.md` frontmatter 的 `description`。`indiv-guipi--find-skills` 的描述长达数百字，按 `.cardDesc` 单行截断。
4. **图标**：首版统一用宿主的默认技能插画，容器一律按 §3.3.4 的 `.cardIcon`（48×48 / `.5px` 描边 / `label-secondary` 色 / `inline-flex` 居中），不按来源换品牌图标（`dsh-skills-manager` 那套按来源换 SVG 的做法属于它自己的视觉，不复用）。
5. **`Programming Language`** 未由用户指定，按 §1 的「复用宿主原语」约束推进；若架构师认为需要独立构建链，以架构文档为准。
6. **不写代码、不做系统设计**：本 PRD 只定义判据、规格与语义；接口、状态机、文件布局由架构师定。
