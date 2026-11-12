# AGENTS.md — dsh-skill-center 维护者开工地图

只写「不写就会返工」的。契约细节在 `docs/contracts/*.md`（真源），本文件不复述。

## 命令

```bash
npm run build        # src/client/** → client.js（esbuild，产物入库）
npm run check:i18n   # zh/en 键集一致 + 入口键存在 + lib/ 与 src/ 无 CJK 字面量
npm run check:client # 重打一次与 client.js 逐字节比对 + 装载形状 + exports["./client"]
npm run check:docs   # 文档门禁：白名单/头注/章节/锚点/引用/零行号（脚本自测见 test/docs-gate）
npm run check:board  # 看板格式与依据锚点（无 .agents/work/ 时跳过）
npm run check        # 上面四个
npm test             # node --test test/（测试由 QA 维护）
```

## 文档地图

| 想知道什么 | 看哪份 | 编号 / 注意 |
| --- | --- | --- |
| 架构、文件清单、依赖与接线 | `docs/contracts/architecture.md` | §1 §2 §6 |
| 类型总览、判据阶梯、纯函数契约 | `docs/contracts/data-model.md` | §3.1 §3.2 |
| 路由表、写盘、错误码 | `docs/contracts/routes.md` | §3.3 §3.4 §8.1 |
| 前端组件、状态机、命名与 i18n；已安装详情页 | `docs/contracts/client.md`、`docs/contracts/installed-detail.md` | §3.5 §3.6 §8.2–§8.5；详情页全文 |
| 调用流程与未定事项 | `docs/contracts/flows.md` | §4 §5 |
| 验收口径、夹具、用例编号 K1–K148 | `docs/contracts/acceptance.md` | 附录 D.5（K28–K61 K75–K78 K82–K115）、D.6（K62–K74）、D.7（K116–K125）、D.8（K126–K137）、D.9（K138–K147）、D.10（K148） |
| 决策登记（偏离 / 更正 / 假设） | `docs/contracts/decisions.md` | 附录 B |
| 页面视觉刻度（px、令牌、`skc_` 类名、收拢顺序） | `docs/contracts/visual.md` | A.1–A.9 |
| 技能市场（源适配器、数据流、市场刻度、安装链路） | `docs/contracts/market.md` | §7 附录 F 附录 G（路由见 `routes.md` §3.7 §8.6） |
| 宿主「插件」页长什么样（外部形状、稳定钩子、几何） | `docs/reference/host-plugin-page.md` | 带采集日期；宿主升级后整份重采，不在旧值上打补丁 |
| 使用者能感知什么、怎么装、有哪些已知限制 | `README.md` | 只写使用者视角 |
| 升级时我要注意什么 | `CHANGELOG.md` | 记行为变化与迁移，不记改过哪些文件 |
| 过去是什么、为什么这么定 | `git log`（`git log -S`） | 仓库里没有 `archive/`，历史交 git |
| 现在卡在哪、还剩什么没验 | `.agents/work/BOARD.md` | 本地看板（列约定在文件头，过程产物在 wip/ 与 scratch/），不入库 |

契约按**编号分区**：`§x.y` 与 `附录 X.n` 在全仓库唯一，正文里看到编号就按上表定位；编号是 `test/*.test.mjs` 头注的锚点（K1–K148），**不许重排或复用**（K33 / K58 / K60 / K80 已退役，号不复用）。

**新知识写哪**：可 grep 的断言 → 契约；不能做错的事 → 本文件「硬约束」；用户可感知的变化 → `CHANGELOG`；还没做的事 → 看板；**没定型的探索结论**才进项目记忆。文档里不放过程（PRD、测试报告、设计图）——已移出，见 commit `a8141eb`。

## 目录

| 路径 | 是什么 |
| --- | --- |
| `index.js` | Host 半部入口：解析 `dshHome`/`skillsRoot`，注册 16 条路由（本地面 7 + 市场面 9） |
| `lib/classify.js` | **纯函数核心**：`rankOf` / `classifySkill` / `mergeCatalog` / `buildGroups`。改判据只改这里 |
| `lib/scan.js`、`lib/ledger.js` | 唯一碰盘的读取模块（自扫描 / 安装台账） |
| `lib/frontmatter.js` | 字节级改写器（CRLF/BOM/注释保真）+ 读侧解析器（含块标量 `>`/`\|`） |
| `lib/write-skill.js` | 指纹 → 临时文件 → fsync → rename → 回读校验 → 回滚 |
| `lib/routes.js` | 16 条 exact 路由（本地面 7 + 市场面 9），共用一个 `guard()` |
| `lib/local/**` | 已安装页两条写路由的编排：`add` 复制本机目录或 **GitHub 浅克隆**（`rules.js` 分类/定位，`git.js` 克隆，`copy.js` 拷贝）、`remove` 删目录 + 清台账；守卫顺序 G0–G12 + S0–S12 见 `docs/contracts/routes.md` §3.3.4 |
| `src/client/**` → `client.js` | 源码 23 个文件（市场页 8 个为 `market-*`；`installed-detail.jsx` 是已安装详情页、`skill-dialogs.jsx` 是添加/卸载两个弹窗（`page.jsx` 里另有工具条那个两项的添加菜单）、`markdown.jsx` 是两页共用的 markdown 兜底，`icon-tile.jsx`/`avatar.js` 是共用视觉单元；纯逻辑模块不含 JSX，node 可直接测）；`client.js` 是**构建产物、入库、不要手改** |
| `lib/market/**`、`src/client/` 的 `market-*` 文件 | 市场半部：源适配器、安装链路、市场页组件（清单见 `docs/contracts/market.md` 附录 G） |
| `locale/{zh,en}.json` | 唯一文案真源 |

## 硬约束（改错就是返工）

1. **不要手改 `client.js`**：它由 `npm run build` 生成，`npm run check:client` 会逐字节比对。
   改了源码必须重新 build 并提交产物，否则真机装的还是旧代码。
2. **不要在 `lib/**` 或 `src/client/**` 写中文**（注释也不行）：`check:i18n` 直接 exit 1。
   界面文案一律进 `locale/*.json`，代码里只出现键名。
3. **入口名只在 `locale/*.json` 里改**（`panel.label` + `meta.title`），代码零改动。
4. **不写同名 `--dsw-*` 变量**，不引第二套样式系统。宿主类名是构建哈希，不许出现在选择器里；
   页骨架用 `skc_` 前缀，规则体逐字来自宿主「插件」页（`docs/contracts/visual.md`）。
5. **软链技能只读，三层同时拦**：扫描层给 `symlink` 事实 → 前端渲染只读标记不渲染开关 →
   写路由返回 `409 E_SYMLINK_READONLY`。任何一层被去掉都算回归。
6. **写路由不得信任请求里的路径**：先按 name 重新扫描，`row.path !== path` 即 `409 E_STALE_PATH`。
7. **frontmatter 改写只能走 `lib/frontmatter.js`**：现成实现（含 skill-explorer 的
   `setFrontmatterField`）会把 CRLF 洗成 LF。本机 `indiv-guipi--find-skills/SKILL.md` 就是 CRLF 样本。
8. **`exports["./client"]` 必须是字符串 `"./client.js"`**：宿主 `clientExportOf()` 硬契约。
9. **点击边界按页签划（三处）**：「已安装」页签的**行可点**（进本地详情页，见 `docs/contracts/installed-detail.md`），手段只有宿主那一个——标题按钮 `cardOpen::after{inset:0}` 铺满整行 + **唯一的动作位**用显式 `z-index` 浮在上层（开关位 `.skc_cardEnd{z-index:1}`；软链行的 `roTag` **不浮起、不可点**）；「技能市场」页签的卡不变（`marketCardOpen::after` + `marketCardEnd{z-index:1}`，安装是唯一动作位）；**详情页内部**的面包屑、开关、重新检查 / 重试是普通按钮，不属于「整区可点」；**两页都没有复制入口**（调用名是可选中的纯文本）。
   三处都**不许**做成 `<a href>`、不许加第二个可点区域、不许用 JS 拦冒泡代替层级；行 hover/active 只出现在可点的行上，不许出现「看着能点、点了没反应」。
10. **不写别人的存储**：`~/.dsh/skills-manager/state.json`、`skill-market/*`、`.skills-lock.json` 只读。
11. **Client 半部 `inject` 与 `ctx.*` 严格对齐**：读到未声明的服务会抛 `cannot get property "X" without inject`，
    后果是**整页 web boot 失败**（不是单个面板不显示），宿主还会把 entry 打成 `disabled: true`。
    `ctx.effect` 是核心能力、不要写进 inject；`test/client-entry.test.mjs` 用严格 Proxy ctx 加载真实 `client.js` 守这条。
    当前声明是 `['slots', 'locale', 'uiWorkspace']`——`uiWorkspace` 只为「让 Agent 创建技能」那一项调 `startSession`，**读它之前必须在 inject 里**，否则整页挂。
12. **`locale/*.json` 必须是单层扁平点号键**：`ctx.locale` 只做字面量查找，嵌套字典会让整页显示
    `page.title` 这种原始键名（真机踩过一次）。唯一例外是顶层 `meta` 块（只给宿主插件列表读，
    改成扁平键会让插件名掉回包名）。`check:i18n` 与 `test/i18n.test.mjs` 双向守，细节见 `docs/contracts/client.md` §8.3。
13. **浏览器半部不直连上游**：单上游 `api.skillhub.cn`（三个 scope）一律走 Host 代理（`lib/market/upstream.js` 是唯一出口）；`src/client/**` 里出现 `fetch('https://api.skillhub.cn…')` 即返工。
14. **安装只写清单里的文件**：不执行包内脚本、不跟随包内符号链接、不写包外路径；任一步失败必须删掉 `.skc-install-*` 临时目录，`skills/<name>` 与自有台账要么都有、要么都没有（唯一例外：台账写失败时目录保留并报 `E_INSTALL_IO`，见 `docs/contracts/routes.md` §3.7）。`files` 形态下**空清单 / 无 `SKILL.md` / 路径不安全**三态一律 `E_PACKAGE_INVALID`——镜像单源之后这是唯一的包闸。

## 四处容易踩的真机坑

- **`SkillSummary` 不暴露 `rank`**：`lib/registry.js` 用 `source`/`provider` 反推档位（表见 `docs/contracts/architecture.md` §1.4.3）；加新来源先补表，否则同名裁决会错。
- **frontmatter 写入与读侧是两套规则**：`setDisableModelInvocation` 只做字节手术、只替换一行；`parseFrontmatter` 只负责读（含块标量，见 `docs/contracts/data-model.md` §3.2.4）。改一侧不影响另一侧；QA 踩过 `description: >`。
- **宿主 primitives 来自浏览器 seed**，node 里 import 不到：测组件先映射（`docs/contracts/acceptance.md` 附录 D.1 的 L3 层）；`useSyncExternalStore` 必须带第三个参数，否则 SSR 直接抛。
- **市场面只有一个上游（`api.skillhub.cn`）**：ClawHub 的目录 / 详情 / 安装包全走镜像；**三个 scope 不等于三个身份**——`all`（不传 source）/`skillhub`（`community`）/`clawhub` 只决定查询，`MarketItem.sourceId` 只有 `skillhub`/`clawhub` 两个值且**按行折叠**（`enterprise` 归 `skillhub`），`all` 传给 `detail`/`install` 就是 400；末页按 `data.total` 判（无 total 才退回短页）；分类计数**按 scope 各算、缓存 key 用 `sourceParam`**；`namespace` 不能猜（`keyword=<slug>` + 双匹配）；安装只认 `/files` 清单。

## 改完自检

```bash
node scripts/build-client.mjs && node scripts/check-client.mjs && node scripts/check-i18n.mjs \
  && node scripts/check-docs.mjs && node scripts/check-board.mjs && node --check index.js && node --check client.js && node --check lib/*.js
```
