# AGENTS.md — dsh-skill-center 维护者开工地图

只写「不写就会返工」的。契约细节在 `docs/system_design.md` 与 `docs/contracts/visual.md`（真源），本文件不复述。

## 命令

```bash
npm run build        # src/client/** → client.js（esbuild，产物入库）
npm run check:i18n   # zh/en 键集一致 + 入口键存在 + lib/ 与 src/ 无 CJK 字面量
npm run check:client # 重打一次与 client.js 逐字节比对 + 装载形状 + exports["./client"]
npm run check        # 上面两个
npm test             # node --test test/（测试由 QA 维护）
```

## 文档地图

| 想知道什么 | 看哪份 | 注意 |
| --- | --- | --- |
| 现在必须成立的事实：判据、路由、接口、验收口径 | `docs/system_design.md` | 契约真源之一；编号（§x.y）有 26 个测试头注锚定，不许重排 |
| 页面视觉刻度：px、令牌、`skc_` 类名、响应式收拢顺序 | `docs/contracts/visual.md` | 契约真源之一；编号（A.1–A.9）有 2 个测试头注锚定 |
| 宿主「插件」页长什么样（外部形状、稳定钩子、几何） | `docs/reference/host-plugin-page.md` | 带采集日期；宿主升级后整份重采，不在旧值上打补丁 |
| 使用者能感知什么、怎么装、有哪些已知限制 | `README.md` | 只写使用者视角 |
| 升级时我要注意什么 | `CHANGELOG.md` | 记行为变化与迁移，不记改过哪些文件 |
| 过去是什么、为什么这么定 | `git log`（`git log -S`） | 仓库里没有 `archive/`，历史交 git |
| 现在卡在哪、还剩什么没验 | `.agents/work/BOARD.md` | 本地看板，不入库 |

**新知识写哪**：可 grep 的断言 → 契约；不能做错的事 → 本文件「硬约束」；用户可感知的变化 → `CHANGELOG`；还没做的事 → 看板；**没定型的探索结论**才进项目记忆。文档里不放过程（PRD、测试报告、设计图）——已移出，见 commit `a8141eb`。

## 目录

| 路径 | 是什么 |
| --- | --- |
| `index.js` | Host 半部入口：解析 `dshHome`/`skillsRoot`，注册 4 条路由 |
| `lib/classify.js` | **纯函数核心**：`rankOf` / `classifySkill` / `mergeCatalog` / `buildGroups`。改判据只改这里 |
| `lib/scan.js`、`lib/ledger.js` | 唯一碰盘的读取模块（自扫描 / 安装台账） |
| `lib/frontmatter.js` | 字节级改写器（CRLF/BOM/注释保真）+ 读侧解析器（含块标量 `>`/`\|`） |
| `lib/write-skill.js` | 指纹 → 临时文件 → fsync → rename → 回读校验 → 回滚 |
| `lib/routes.js` | 4 条 exact 路由，共用一个 `guard()` |
| `src/client/**` | 浏览器半部的**源码**（10 个文件，纯逻辑模块不含 JSX，node 可直接测） |
| `client.js` | **构建产物，入库**。不要手改 |
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
9. **页面不可点**：唯一交互控件是右侧开关；不要加行 hover 底色或详情入口（需求明确排除）。
10. **不写别人的存储**：`~/.dsh/skills-manager/state.json`、`skill-market/*`、`.skills-lock.json` 只读。
11. **Client 半部必须 `export const inject = ['slots', 'locale']`，且与 `ctx.*` 读取严格对齐**：
    cordis 按 fiber 的 inject 声明解析服务，读到未声明的服务直接抛
    `cannot get property "X" without inject` —— 那次是**整页 web boot 失败**（不是单个面板不显示），
    宿主还会自动把 entry 写进 profile 打成 `disabled: true`。`ctx.effect` 是核心能力，不要写进 inject；
    `ctx.theme` 若将来真用上才加。`test/client-entry.test.mjs` 用严格 Proxy ctx 加载**真实 `client.js`**
    守住这条。
12. **`locale/*.json` 必须是单层扁平点号键**（`"panel.label": "技能"`，不是 `{"panel":{"label":…}}`）：
    `ctx.locale` 取键是**字面量属性查找**（`dict[key]`，取不到直接回落成键名），不做嵌套遍历；
    嵌套字典的后果是**整页显示 `page.title`、`group.builtin` 这类原始键名**（真机踩过一次）。
    唯一允许的嵌套是顶层 `meta` 块（`{meta:{title,description}}`）—— 它只给宿主插件列表读
    （`dsh-app-boot` 的 `dictionariesOf` 读 `parsed.meta.title`），`src/client/index.jsx` 在
    `register` 前会把它滤掉，不进运行时字典；**不要**把 `meta` 改成 `"meta.title"` 扁平键，
    那会让插件列表里的名字掉回包名。`npm run check:i18n` 与 `test/i18n.test.mjs` 双向守这条。

## 两处容易踩的真机坑

- **`SkillSummary` 不暴露 `rank`**：`lib/registry.js` 用 `source`/`provider` 反推（100/200/250/300/400/500/600）。
  要给 `mergeCatalog` 加新来源，先补这张表，否则同名裁决会错。
- **frontmatter 有两套规则，不要混**：写入器（`setDisableModelInvocation`）只做**字节手术**，
  只替换 `disable-model-invocation` 一行；解析器（`parseFrontmatter`）负责**读**，含块标量
  （`>`/`|` 及其 `+`/`-` 变体，见 `docs/system_design.md` §3.2.4「读侧契约」）。改读规则不会影响
  写回字节；反过来也成立。QA 第 1 轮在这条缝上踩过一次（`description: >` 被读成 `>`）。
- **宿主 primitives 来自浏览器 seed**，node 里 import 不到。测组件要先映射
  `@deepseek-ai/dsh-client-ui-primitives`（见 `docs/system_design.md` 附录 D.1 的 L3 层）。
  `useSyncExternalStore` 必须带第三个参数（`getServerSnapshot`），否则 SSR 渲染直接抛错。

## 改完自检

```bash
node scripts/build-client.mjs && node scripts/check-client.mjs && node scripts/check-i18n.mjs \
  && node --check index.js && node --check client.js && node --check lib/*.js
```
