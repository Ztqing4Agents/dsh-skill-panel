# README 编写规范：骨架、双语同构与徽标同步

> 类型：规范
> 读者：改 `README.md` / `README.en.md` 的人——写新特性说明、换截图、抬宿主区间前先看这里
> 真源：2026-11-28 用户拍板的体例，本文件即体例原文；徽标取值真源是 `scripts/hosts.mjs`，章节与条目以两条 README 的实际内容为准
> 更新触发：改章节骨架、改双语同构口径、改徽标或体量红线时同轮改本文件；宿主区间变动后先跑 `node scripts/sync-hosts.mjs --write`
> 规模上限：400

本规范定义 `README.md`（简体中文）与 `README.en.md`（英文）的定位边界、标准骨架、双语同构原则、徽标与宿主同步契约及体量红线，确保项目首页面向使用者清晰可读，并与仓库自动化门禁（`check:docs`、`check:hosts`）保持一致。

版本演进与逐版正文分别由《CHANGELOG 编写规范》（`docs/contracts/changelog-standard.md`）与《Release 文档编写规范》（`docs/contracts/release-doc-standard.md`）约束，本规范只管首页。

## 11.1 定位与职责边界

README 是项目的**对外门面与上手入口**，读者是准备评估、安装或日常使用本插件的用户。

- **只写使用者视角**：回答「这是什么 → 有什么亮点 → 怎么装 → 怎么用 → 有哪些边界与限制 → 怎么本地开发」。
- **不与其它文档抢活**：
  - 版本演进与旧宿主历史兼容指引归 `CHANGELOG.md` 与 `docs/releases/`（README 末尾可给入口链接，不堆砌历史版本表）；
  - 内部架构、路由表、错误码清单与像素刻度归 `docs/contracts/`，不复述进 README。

## 11.2 标准章节骨架

中英两版必须严格遵循以下章节顺序（增删章节须双语同步）：

| 顺序 | 中文标题（`README.md`） | 英文标题（`README.en.md`） | 核心要求 |
| ----- | ----- | ----- | ----- |
| 1 | `# dsh-skill-panel` + 语言切换 + 徽标 + 简介 + 头图 | 同构 | 顶部导航栏为 **简体中文** \| [English](README.en.md) \| [Changelog](CHANGELOG.md)（英文版对称）；简介 1–2 段说清定位与核心价值 |
| 2 | `## 核心特性` | `## Features` | 4–5 条，统一 `- **核心主题**：一句话说明用户价值` |
| 3 | `## 安装指南` | `## Installation` | 顶部醒目提示「装完需重启 DSH」；区分「桌面 App（推荐）」与「CLI / 自定义 Profile」两种方式 |
| 4 | `## 使用说明` | `## Usage` | 分 `1. 已安装技能管理` 与 `2. 技能市场` 两节，配市场截图与关键操作说明 |
| 5 | `## 机制与已知限制` | `## How it works and known limits` | 用用户可理解的语言说明分类逻辑与真正会遇到的使用边界，避免堆砌内部字段名或极低概率边缘故障 |
| 6 | `## 本地开发` | `## Local development` | 说明已有预构建 `client.js`、常用开发命令及本地挂载调试方式（包名使用最新作用域包名） |
| 7 | `## 推荐技能`（可选） | `## Recommended skills` | 精简列出关联推荐技能与链接 |
| 8 | `## 致谢` | `## Acknowledgements` | 客观致谢参考的开源项目 |
| 9 | `## 开源协议` | `## License` | 一句话标明协议并链接 `LICENSE` |

## 11.3 双语同构原则

1. **逐节对应、条目数相等**：`README.md` 与 `README.en.md` 的标题层级、章节数量与列表条目数必须保持一致；改一侧必须同轮改另一侧。
2. **技术标识不翻译**：包名（`@ztqing4agents/dsh-skill-panel`）、命令、路径、环境变量（`$DSH_HOME`）、配置键与文件名保持原样。
3. **两版都保持地道书面语气**：中文避免口语化短句（如「要从源码装就填」「把目录移出去」），英文保持简洁、客观的开源文档风格，避免过度随性的口语。

## 11.4 徽标与自动化门禁硬约束

| 约束项 | 规范要求 | 对应门禁 |
| ----- | ----- | ----- |
| 体量上限 | `README.md` 与 `README.en.md` 均不超过 **160 行**（推荐控制在 110–140 行） | `check:docs` R12 |
| DSH 徽标锚点 | 两版必须**恰好包含一处** `![DSH](https://img.shields.io/badge/DSH-<encoded>-<hex>)`，版本号真源为 `scripts/hosts.mjs`，升级宿主区间后通过 `node scripts/sync-hosts.mjs --write` 同步，严禁手改 | `check:hosts` |
| 许可徽标出处 | 必须使用 `github/license/Ztqing4Agents/dsh-skill-panel`（读取仓库 `LICENSE`），不得使用 `npm/l`（已发包元数据不可变） | 约定（`docs/contracts/decisions.md` 附录 W-3） |
| 真实可验证徽标 | 仅放置有真实来源的徽标（npm 版本、下载量、DSH / Node 要求、开源协议），不放自造数字或夸大断言 | 人工评审 |
| 禁止易腐数字 | 正文与图注不写死会随上游变化的分类数或技能总数（如「十二类」「二十余万」），改为定性描述（如「场景分类筛选」） | 人工评审 |
| 路径与链接可达 | 所有相对路径（截图、`LICENSE`、`README.en.md`、`CHANGELOG.md`）必须真实存在，不出现代码行号 | `check:docs` R8 / R9 |

## 11.5 更新触发时机

以下任一变化发生时，必须同轮同步更新中英文 README：

- 宿主兼容下限变动（运行 `node scripts/sync-hosts.mjs --write`）；
- 安装方式、包名、核心交互能力或主要使用边界发生变化（如新增原地更新、交互流程调整）；
- 截图已明显滞后于当前界面。

## 11.6 提交前自检清单

1. 中英两版章节结构、条目数、语言切换加粗格式完全对称。
2. 文中包名、功能描述（含最新版本能力）、开发命令与当前代码一致，无过期数字或口语表述。
3. 运行 `npm run check:docs && npm run check:hosts` 全部通过且零警告。

## 11.7 验收

- **体量（自动）**：`node scripts/check-docs.mjs` 的 R12 对两条 README 各判一次，超过 160 行即 warn 并点名是哪一版。
- **DSH 徽标（自动）**：`node scripts/sync-hosts.mjs`（第五门 `check:hosts`，默认只读）要求每条 README **恰好一处** `![DSH](https://img.shields.io/badge/DSH-…)`，且编码值与 `scripts/hosts.mjs` 的当前宿主下限一致；可选兼容行存在时也必须同值。真正回写只走 `--write`，严禁手改徽标。
- **双语同构（review）**：两版章节数与列表条目数相等、语言切换格式对称，目前没有自动断言——`scripts/sync-hosts.mjs` 的注释点名了这一条，但代码只校验徽标与兼容行，所以「条目数相等」靠提交前自检与评审核对，别当成门禁绿灯。
- **链接与零行号（自动）**：`check:docs` 的 R8 校验 README 里的相对链接（截图、`LICENSE`、`README.en.md`、`CHANGELOG.md`）必须可达，R9 禁止任何 `file:line` 写法。
- **易腐数字与措辞（review）**：分类数、技能总数这类会随上游漂的数字不得写死，标语不得夸大——门禁不判，评审判。
