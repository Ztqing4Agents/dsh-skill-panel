# dsh-skill-panel — 技能面板

**简体中文** | [English](README.en.md)

[![npm](https://img.shields.io/npm/v/@ztqing4agents/dsh-skill-panel)](https://www.npmjs.com/package/@ztqing4agents/dsh-skill-panel) ![downloads](https://img.shields.io/npm/dm/@ztqing4agents/dsh-skill-panel)
[![release](https://img.shields.io/github/v/release/Ztqing4Agents/dsh-skill-panel?logo=github)](https://github.com/Ztqing4Agents/dsh-skill-panel/releases/latest) ![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.1-4B6EF5) ![license](https://img.shields.io/github/license/Ztqing4Agents/dsh-skill-panel)

**一个侧栏入口，一页全局面板。内置 / 本地 / 已安装三类技能分开列出，每行一个开关，软链技能只读。**

![技能页：内置技能按插件归成一块、本地软链行只读、已安装每行一个开关](docs/assets/installed-page.png)

## 三步安装

1. **桌面 App**：「插件」页 → 添加插件 → 粘贴 npm 包名 `@ztqing4agents/dsh-skill-panel`。要从源码装就填 `github:Ztqing4Agents/dsh-skill-panel`。
2. **CLI**：`dsh plugin --profile <name> add @ztqing4agents/dsh-skill-panel`。`--profile` 必填。桌面端的 profile 由 App 独占，只能走第 1 步。
3. **重启 DSH**：插件清单只在启动时读一次，不重启看不到「技能」。

- 装之前先确保机器上有 `pnpm`、也连得上 npm 源；没有 `pnpm` 时会提示找不到，装不上。
- npm 上同名的 `dsh-skill-panel` 是别人的包，别装错。
- 新旧两个包不能同时装，它们会互相冲突，后装的那个会装不上。

## 能做什么

- 打开就是一页列表，分成三组：内置的技能（按提供它的插件归成一组）、本机的技能、从市场装的技能。同一个技能只出现一次，不会重复。
- 每行右边一个开关，点一下就能停用或启用，不用自己去改文件。停用之后，模型就不会再用它。软链过来的技能是只读的，不给开关。
- 点「已安装」里任意一行的标题，进它自己的页面：调用它的名字（可以直接选中复制）、装在本机哪个目录、它自己的说明正文、从哪儿装的、什么版本。从市场装的多一块历史版本，页头还多一个「更新」。
- 在「技能市场」搜一下，用 12 类分类收窄，按下载量或收藏量排序，滚到底继续加载。点卡片空白处先看简介和包里有什么；点「安装」就装进本机，新开一个会话就能用。
- 工具条的「＋ 添加技能」可以填本机一个技能目录，也可以贴一个 GitHub 仓库地址；旁边的 `⌄` 里还有「让 Agent 创建技能」。不要了就在详情页头点「卸载」，连安装记录一起删掉。

## 技能市场

![技能市场：搜索、来源与排序菜单、12 类分类带数量、等宽卡片网格](docs/assets/market-page.png)

技能来自 skillhub.cn 的目录，ClawHub 上的技能也在里面。上面能选范围：「所有来源」默认、量最大，也可以只看「SkillHub」或「ClawHub」。

12 类分类，每个标签上写着这一类有多少个；四种排序：默认、最近更新、下载量、收藏量。滚到底自动加载下一页，全部取完会显示「没有更多了」。

- **装到哪**：装进你本机的技能目录 `~/.dsh/skills/<name>`，和手动放进去的技能放在一起。目录名用的是技能自己声明的名字，不一定等于市场上显示的名字。
- **什么时候能用**：新开一个会话就能用；当前这个会话还在用它之前加载的清单，所以不会马上出现。
- **名字撞了怎么办**：本机已经有同名技能就不装，并告诉你它在哪。没有覆盖按钮——想换版本，用详情页的「更新」。
- **为什么有的装不了**：技能名只能用英文小写字母、数字和短横线；名字里带大写、空格或中文的装不进来。

## 已知限制

- **软链过来的技能是只读的**：面板不给开关，也不会替你改它。
- **内置技能的开关只在这个面板里算数**：装它的插件不认这份设置，模型会不会用到它，还要看那个插件。
- **升上去就退不回来**：更新之后想回旧版，只能把技能目录移出去再装一次。
- **断网只影响「技能市场」**：这一页会报错，可以点重试；「已安装」照常能用。
- **装好了但记录没写上**：技能已经在列表里，安装记录却没写成功，再装会被「同名」拦下——把目录移出去再装一次就好。
- **面板只动你在界面上看到的那些技能**：磁盘上它的位置要是变了，写入会被拒绝，不会改错文件。

## 升级与迁移

从 `dsh-skill-center` 到 1.0.0，先跑 `mv ~/.dsh/dsh-skill-center ~/.dsh/dsh-skill-panel`。1.0.0 到 1.1.0 是 `remove` → `add` → 重启，不要 `mv`。细节见 [CHANGELOG.md](CHANGELOG.md) 的 1.1.0 与 1.0.0 两节。

## 要求

- DSH `>= 0.2.1`、Node `>= 20`。
- 技能市场只访问 `api.skillhub.cn`，由插件代为请求，浏览器不直接连它。
- 平时不需要额外装依赖；只有自己改源码重新构建时才用得到 `esbuild`。

## 更多

- 三分区九级判定与同名档位：[architecture.md §1.4.2 / §1.4.3](docs/contracts/architecture.md)
- 市场安装 / 更新 / 回滚与错误码：[routes.md §3.7](docs/contracts/routes.md)
- 中英文案键与界面名词：[client.md §8.3](docs/contracts/client.md)
- 全量变更：[CHANGELOG.md](CHANGELOG.md)

## 许可

本项目采用 [MIT](LICENSE) 开源协议。
