# 架构、文件清单与依赖

> 类型：规范
> 读者：要判断「这块为什么这样接」，或要动 `package.json`、`cordis.patch.yml`、`index.js` 与 `lib/**` 分工的人
> 真源：`package.json`、`cordis.patch.yml`、`index.js` 与 `lib/**` 的实际导出
> 更新触发：加删模块、换构建方式、改依赖或座位接线时，同步改 §1 / §2 / §6
> 规模上限：400

2026-11-09 从原单文件契约拆出（`git show a8141eb:docs/system_design.md`），编号 §1 / §2 / §6 保持原值。

本文不含业务实现代码；可出现签名、类型、契约与 ≤10 行伪代码。

> 证据记号（`EX/` `PROF/` `SHELL/` `HIDDER/`）与宿主版本见 `docs/reference/host-plugin-page.md` §1。

---

---

## 1 实现方案与框架选型

### 1.1 核心难点 → 方案 → 模式

| # | 难点 | 方案 | 依据 |
| --- | --- | --- | --- |
| 1 | 页面必须「与宿主插件页 1:1」，但宿主样式类名是每次构建变化的 module hash（`w6M7KW_*`、`_tabs_1lga9_1`、`_switch_1ik0f_5`） | 三条路分开走：**能拿到组件就用宿主的 primitives 组件**（SegmentedTabs / Switch / Button / Tooltip / Toast / StateDot / 图标）；**拿不到组件就把规则体逐字转写**成自有前缀 `skc_` 的类；**绝不 write 第二套样式系统**（不引 Tailwind/MUI/antd） | `HIDDER/docs/reference/settings-ui.md` §9「Host class names are build-hashed; none may appear in your selectors」；`EX/dsh-client-ui-plugin-manager/lib/client.js` 内 `PluginManagerPage.module.css` 的 `css` 字符串（下称 **[PM-CSS]**）；`PRD` §1 硬约束 |
| 2 | 侧栏入口要打开**全局页**（不属于任何会话），而不是设置页/抽屉 | 用 shell 自己的两座位：`sidebar.panellist`（行）+ `main`（keyed 页面）。shell 会接管行盒子、标签、选中高亮、折叠轨、页面切换 | `EX/dsh-client-ui-plugin-manager/lib/client.js` 的 `slots.inject("sidebar.panellist", …)` 与 `slots.inject("main", …)`（`PANEL_ID = "plugins"`）；`EX/dsh-client-ui-layout/README.md`「Global panels occupy the root-scoped `main` keyed slot … `ctx.layout.selectPanel(id)`」 |
| 3 | 「打开任意会话即回到会话正文」 | **不需要我们实现**：workspace 打开会话走 `openSession → replaceMain(…, "reveal")` → `ctx.layout.selectPanel(null)` | `PROF` 外的宿主包 `EX/dsh-client-ui-workspace/lib/client.js`（`openSession(target)` / `replaceMain` 内 `if (panel === "reveal") this.ctx.layout.selectPanel(null)`） |
| 4 | 分区判据必须可单测、可复现 | 判定与合并全部收敛成**纯函数**（`classify.js`：`rankOf` / `classifySkill` / `mergeCatalog`），I/O 全部在边界模块 | `PRD` §3.1.2、§3.5（A1/A2 可直接喂 fixture） |
| 5 | frontmatter 改写必须**逐字节保真**，且本机真的存在 CRLF 技能文件 | 自写字节级改写器（保留 BOM、保留每行原行尾），不复用现成实现 | 本机实测：`~/.dsh/skills/indiv-guipi--find-skills/SKILL.md` 首字节为 `---\r\n`（CRLF），其余 4 条为 LF。`PROF/@linxin666/dsh-client-ui-skill-explorer/lib/index.js` 的 `setFrontmatterField` 用 `` `---\n${next.join("\n")}\n---${match[2]}` `` **会把 CRLF 与 BOM 一起洗掉**，因此不可移植 |
| 6 | 写入要能判定「拒绝过期同名回退」 | 写路由**不接受信任的路径**：先按 name 重新扫描，再要求 `resolved.path === submitted.path`，不等即 409 | `PROF/@linxin666/dsh-client-ui-skill-explorer/lib/index.js` 的 `resolveScannedSkill`（同一模式，含 404/409 语义） |
| 7 | 软链技能只读（队长决策 2） | 三层同时拦：扫描层给 `symlink` 事实 → 展示层渲染静态标记不渲染开关 → **写路由拒绝并发错误码** | 队长消息（2026-11-08）；`PRD` §3.1.1 R4（`lstat().isSymbolicLink()`，不是 `stat`） |
| 8 | 已安装详情页的正文从哪来 | **本地读盘**（`lib/scan.js` 的 `readSkillContent`，第 12 条路由当场读一次），**不借** `market/detail` | 已安装详情答的是「我磁盘上这一份」，与上游那份允许不一致（`upstream === null` 是常态，见 `docs/contracts/decisions.md` 附录 I）；只有当场读盘才能反映手改 |

架构模式：**分层 + 两半（dual-face）**。Host 半部 = 纯数据面（扫描/判定/写入/路由，零 React）；Client 半部 = 纯展示面（React 组件 + 一个模块级 store），二者只通过 `/api/dsh-skill-center/*` 的 JSON 契约耦合。

### 1.2 包形态与接线

#### 1.2.1 两半如何拆分与导出

一个包、两半、四个导出点：

```jsonc
// package.json（节选；完整形态以文件本身为准）
{
  "name": "dsh-skill-center",
  "type": "module",
  "main": "index.js",                       // Host 半部入口（ESM，无构建）
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",              // 必须是字符串或 {default:string}
    "./package.json": "./package.json",
    "./locale/*.json": "./locale/*.json"
  },
  "dsh": {
    "manifestVersion": 1,
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": [
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-layout",
        "@deepseek-ai/dsh-client-ui-sidebar"
      ]
    }
  }
}
```

依据与约束：

- **`exports["./client"]` 是硬契约**：宿主按 `clientExportOf(pkgName, pkg.exports)` 取它，缺失即 `client-modules: <pkg> declares dsh.client but exports no "./client" bundle`（`EX/dsh-client-modules/lib/index.js`）。只接受字符串，或 `{ default: string }`；不接受 `{import, require}` 之外的嵌套形态。
- **`dsh.client` 的合法字段**只有四个：`platform`（必填字符串）、`inject`（字符串数组）、`external`（字符串数组）、`immediately`（布尔）。多写/类型错会在扫描时抛错（`parseDshClient`，`EX/dsh-client-modules/lib/index.js`）。
- `immediately: true` 的语义是**启动时预取该 bundle**（`SHELL/index-BgUyXZcc.js` 的 `prefetchImmediateTier()`：`manifest.plugins.filter(e => e.immediately).map(e => this.modules.prefetch(e.id))`），不是「立即 apply」。我们取 `true`，与 `PROF/dsh-hidder/package.json`、`PROF/@montersy123/dsh-skill-market/package.json` 一致（首屏侧栏行不等一个网络瀑布）。
- `inject` 只影响 **bundle 加载顺序**（boot graph 让被请求者排在消费者之前，`EX/dsh-client-modules/lib/index.js` 的 `graphRow`/排序注释）。真正的座位等待由 `ctx.slots.inject(...)` 完成（见 1.2.3），所以 `inject` 写少了也不会崩，写多了只是多拉几个已在图里的包。这里只列我们真正依赖的三个。
- **Host 半部不需要 `dsh.client`，Client 半部不需要 `main`**：`main`/`exports["."]` 给 Host（cordis 加载 ESM 插件），`exports["./client"]` 给浏览器。

#### 1.2.2 `cordis.patch.yml` 需要哪些行

只有一行 plugin 条目：**bundle 层要能把这个包选成 profile bundle，就必须有一条 Host 行**（Host 行本身可以什么都不注册）。

```yaml
# bundle layer for dsh-skill-center —— 本插件的 Host 半部负责 /api/dsh-skill-center/* 路由，
# Client 半部负责侧栏「技能」行与主区全局页。这一条只是让包可被 profile 选中。
- insert:
    - id: dsh-skill-center
      name: dsh-skill-center
```

依据：`PROF/dsh-hidder/cordis.patch.yml`（单行 `insert`）、`PROF/@linxin666/dsh-client-ui-skill-explorer/cordis.patch.yml`、`PROF/@michengai/dsh-skills-manager/cordis.patch.yml`、`PROF/@montersy123/dsh-skill-market/cordis.patch.yml` —— 四份文件都是「一个 `insert` 一个 id/name」的形状。

**部署侧（不属于包内容，装的时候才做）**：`~/.dsh/profiles/desktop/package.json` 加 `"dsh-skill-center": "link:../../Documents/Agents/Plugins/dsh-skill-center"`、`dsh.profile.bundles` 插入 `"dsh-skill-center"`、`node_modules` 建相对软链。bundle 列表**只在启动时读**，改完必须重启 DSH（项目记忆「DSH 插件开发」条已记录同一坑）。

#### 1.2.3 侧栏入口 + 全局页的注册方式（与宿主「插件」页同构）

按宿主 `ui-plugin-manager` 的两条语句**逐句对齐**（`EX/dsh-client-ui-plugin-manager/lib/client.js`）：

```js
// ① 侧栏行：shell 拥有按钮、标签、tooltip、rail 几何；我们只画图标
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
  name: 'sidebar.panellist',
  id: PANEL_ID,              // 'dsh-skill-center'
  order: PANEL_ORDER,        // 40
  label: () => tt('panel.label'),   // 单一 i18n 键；请勿硬编码中文
}, PanelIcon));

// ② 主区全局页：keyed slot，key 与行的 id 必须相同
ctx.slots.inject('main', () => ctx.slots.register({
  name: 'main',
  key: PANEL_ID,
  locale: NS,                // 让页面组件拿到 t（宿主同款）
  inject: () => ({ store, api }),
}, SkillsPage));
```

为什么这样就能满足 P0-1「不是会话页」：

| 需求 | 机制 | 证据 |
| --- | --- | --- |
| 行出现在侧栏 | `sidebar.panellist` 是 list slot，`panels` 默认全部显示（`unpinned` 初值为空） | `EX/dsh-client-ui-sidebar/lib/client.js`：`panels.filter(({id}) => id === "plugins" \|\| !unpinned.includes(id))`；`createPanelPins` 的 `unpinned: NO_PANELS` |
| 点击行切到页面 | 行 `onClick` → `selectPanel(id)` → `ctx.layout.selectPanel(id)` | 同上 `PanelRow` 的 `onClick`；`EX/dsh-client-ui-layout/lib/client.js` 的 `LayoutController.selectPanel` |
| 页面占主区 | `main` 是 `kind:"keyed", scope:"root"`；`renderSlot("main", {}, { entryKey: panelId ?? "conversation" })` | `EX/dsh-client-ui-layout/lib/client.js` 的 `MainPanel` 与 root 槽声明 |
| 打开会话回正文 | `openSession → replaceMain(…,"reveal") → ctx.layout.selectPanel(null)` | `EX/dsh-client-ui-workspace/lib/client.js` |
| 面板被移除时不留死状态 | `retainMainPanels` 在 `main` 注册表变化时把失效的 `activePanelId` 归零 | `EX/dsh-client-ui-layout/lib/client.js` |
| 标签由 shell 解析 | `label: resolveSlotLabel(options.label) ?? id`，并在 `slots.subscribe("sidebar.panellist")` 与 `locale.subscribe` 时重算 | `EX/dsh-client-ui-sidebar/lib/client.js`（`syncPanels`）/ `HIDDER/docs/reference/host-selectors.md` §1 |

`PANEL_ORDER = 40`：本机已有 `plugins`(0)、`dsh-market`(1)、`schedules`(10)、`dsh-context`(20)、`mnemon`(30)，40 不撞号且排在已知行之后；要改位置只改这一个常量（`HIDDER/docs/reference/host-selectors.md` §1 列出该 profile 的已知 order）。

图标组件签名：`({ size, active }) => ReactElement`（shell 传 `size: wide ? 16 : 18`）。我们用 primitives 的 `IconSkillOutlineRegular`（图标组件清单见 §1.5.3）。

#### 1.2.4 Bundle 运行时 `require` 能拿到什么（决定「不许 import 任意包」）

浏览器端 `factory(require)` 的解析顺序是：**平台 seed → 其它插件的 client 模块（`dsh.client` 图）→ 抛错**（`EX/dsh-client-modules/lib/client.js` 的 `import(specifier)`：先 `this.seed.has(specifier)`，再 `graphRows`）。平台 seed 的键是固定 11 个：

```
react, react/jsx-runtime, react-dom, react-dom/client, @deepseek-ai/cordis, zod,
@tanstack/react-virtual, @deepseek-ai/dsh-client-store,
@deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-client-ui-primitives,
@deepseek-ai/dsh-client-ui-dockkit
```

依据：`SHELL/index-BgUyXZcc.js` 里 `function YZ(){return{react:…,"react/jsx-runtime":…,…,"@deepseek-ai/dsh-client-ui-dockkit":…}}`（宿主传给 `__ModuleLoader__.create` 的 seed map）。

因此：**客户端代码只允许 `require` 上面 11 个**（我们实际用 `react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives`），其它一律走 `ctx.*` 服务或 `fetch` 自己的路由。市场半部不引入任何新的 `require`：一切都是本插件自己的路由，网络能力全在 Host 侧（`lib/market/upstream.js` 用 `node:https`），详见 `docs/contracts/market.md` §7。

#### 1.2.5 接线相关的硬事实（不照做就会白屏）

1. client bundle 必须自己调用 `window.__ModuleLoader__.load({ id, factory })`，且 `id` 与包名一致；否则宿主报 `bundle … loaded without registering "<id>" via __ModuleLoader__.load`（`EX/dsh-client-modules/lib/client.js`）。`PROF/dsh-hidder/client.js`、`PROF/@michengai/dsh-skills-manager/lib/client.js`、`EX/dsh-client-ui-plugin-manager/lib/client.js` 三处都是这个形状。
2. 样式**自己注入**为 `<style data-plugin-css="dsh-skill-center/client.css">`，并按同一选择器去重（宿主同款：`PluginManagerPage.module.css` 的 loader 用 `tag.dataset.pluginCss = tagId`）。`HIDDER/docs/reference/settings-ui.md` §9 把 `style[data-plugin-css=…]` 列为可健康检查的稳定钩子。
3. 路由 URL 必须**文档相对**（`api/dsh-skill-center/list`，没有前导 `/`）：GUI 用 `<base href="./">`，子路径部署下根绝对路径会逃出前缀。`PROF/@linxin666/dsh-client-ui-skill-explorer/lib/types/client/api.d.ts` 的注释 + 其 `EX/dsh-client-ui-skill-explorer/lib/client.js` 的 `API` 常量就是这套写法（issue #1707 的现场记录）。

### 1.3 构建方式：**明确决定 —— esbuild 打单一 client bundle，源码按模块拆分，产物入库**

| | 方案 A 零构建手写单文件 | 方案 B（**选定**）esbuild + 模块化源码 |
| --- | --- | --- |
| 可维护性 | `PROF/dsh-hidder/client.js` 已 259 KB / 约 6000 行，其 `AGENTS.md` 明文写「不要整文件重写…一次改动不该让 diff 变成整个文件」——这就是单文件的代价 | 10 个源文件，每个 ≤ 300 行，改一个函数只 diff 一个文件 |
| 可测试性 | 纯函数被关在 `window.__ModuleLoader__` 的 factory 闭包里，node 无法 import；测它只能造假 `window`（hidder 的 `HIDDER/test/smoke.mjs` 就是这条路，168 条用例全跑在假 DOM 上，其 `AGENTS.md` 明确记录「证明不了那个选择器选中的是对的」） | 纯函数放在**普通 ESM 文件**里，`node --test` 直接 import，无需浏览器、无需构建 |
| 「1:1」风险 | JSX 手写成 `createElement`，易错 | JSX 交给 esbuild，组件树与宿主同形 |

**决定**：

- 源码：`src/client/*.jsx|*.js`，**普通 ESM**，纯逻辑模块（`model.js`、`header-scroll.js` 的纯函数部分）**不含 JSX**，可被 node 直接 import。
- 产物：`client.js`（仓库根）—— `scripts/build-client.mjs` 用 esbuild 打成 **CJS 单文件**，再套上 `__ModuleLoader__.load` 外壳；**产物入库**（本插件靠 `link:` 安装，没有 install 步骤，不提交产物就没有可用的浏览器半部）。
- 版本锁定与守卫：`esbuild@0.25.0`（与 `PROF/@michengai/dsh-skills-manager` 的 devDependency 同版本），并在 `scripts/check-client.mjs` 里做「重打一次 → 与已提交产物逐字节比对」，防止「改了源码忘了 build」。
- 若 `npm install` 不可用（离线）：已提交的 `client.js` 仍可运行；`npm run build` 会失败并明确报错，不会静默产出半成品。

`scripts/build-client.mjs` 的关键参数（照抄即可）：

```js
const result = await esbuild.build({
  entryPoints: ['src/client/index.jsx'],
  bundle: true, format: 'cjs', platform: 'browser', target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
             '@deepseek-ai/*', 'zod', '@tanstack/react-virtual'],
  loader: { '.json': 'json' },   // locale/*.json 内联进 bundle
  minify: false,                 // 保持可读：报错栈要能落回源码行
  write: false,
});
// 外壳：window.__ModuleLoader__.load({ id: '@…/dsh-skill-center', factory: (require) => { … } })
```

为什么 `external` 用通配 `@deepseek-ai/*` 而不是逐个列：seed 与 graph 的解析在运行时完成，打包期把它们留在 `require(...)` 里就是唯一正确做法；漏列一个会让 esbuild 试图内联宿主的私有实现。

### 1.4 数据源与合并

#### 1.4.1 两个数据源，各管一段事实

| 源 | 提供什么 | 谁提供 | 依据 |
| --- | --- | --- | --- |
| **A. 自扫描** `$DSH_HOME/skills` | 目录条目、**是否软链**、realpath、`SKILL.md` 的 `name`/`description`/`disable-model-invocation`、`_meta.json` / `_skillhub_meta.json` | 我们自己 `lib/scan.js` | `PRD` §3.1.1 R3/R4/R6/R7/R9；本机 5 条实测（`PRD` §3.1.3） |
| **B. `ctx.skills` 注册表** | `{name, path?, description, whenToUse?, invocation, source, provider, resourceBase?}`，以及 bundled / runtime / provider 条目 | `ctx.skills.snapshot({cwd})` | `EX/dsh-skill/lib/index.js` 的 `toSummary()`（字段就是这 8 个）；README「A consumer asks for the current catalog of a workspace and receives every winning skill summary」 |

关键事实：**`SkillSummary` 不暴露 `rank`**（`toSummary` 只搬 `source`/`provider`），所以 rank 必须由 `source`/`provider` 反推（见 1.4.3）。这是本设计的**已知近似**，写进 §5。

另一个关键事实：本 profile 的 `@deepseek-ai/dsh-base` bundle 在 **profile 层**挂了 `dsh-skill` + `dsh-skill-filesystem` + `dsh-tool-skill`（`EX/dsh-base/cordis.patch.yml`），所以 Host 半部的 `ctx.skills` **能看到** user-dsh 条目。但我们**仍然自己扫** `~/.dsh/skills`，因为注册表不告诉你「这条是不是软链」（R4），也不给你 `_meta.json`。注册表在我们这里只负责三件事：bundled/runtime/其它 provider 条目、项目级与 `user-agents` 条目的**计数**、以及同名裁决时的 rank 参照。

#### 1.4.2 合并与 9 级判定

```
scan($DSH_HOME/skills) ──┐
                          ├─► mergeCatalog() ─► groups{builtin,local,installed} + excludedCount + diagnostics
registry.snapshot(cwd) ──┘        ▲
ledger.readAll() ─────────────────┘   （R5：台账只影响判定，不影响去重）
```

合并规则（**先裁决、后分类**，这是唯一自洽的顺序）：

1. 两组候选都带 `rank`（自扫描恒 400）。
2. 按 `name` 分组；组内取 `rank` 最小者；**同 rank 时自扫描条目优先**（它带软链/路径事实，且可写）。
3. 对**胜者**跑 9 级判定（§3.2 的 `classifySkill`）。
4. 判定为 `excluded` 的胜者**不进三分区**，但计入 `excludedCount`（页脚「另有 N 个…」）。
5. 分区内按 `name` 码点排序（`compareCodePoints`，与注册表一致：`EX/dsh-skill/lib/index.js`）。

为什么必须先裁决：`PRD` §3.1.2「同名跨分区：不重复展示，按官方 rank 数值小者胜，面板显示的必须就是模型实际拿到的那一条」。若先分类再去重，会出现「一条被 rank 更高的同名技能遮蔽，却仍然显示成另一个分区」的自相矛盾。

性能（对 `PRD` G3 的 P95 ≤ 800ms）：

- 每次 `list` 都做一次**新鲜扫描**（`readdir` + 每个条目一次 `SKILL.md` 读取 + 一次 `lstat`）。本机 5 条样本的量级是「十几次 `fs` 调用」，不需要缓存；缓存反而会让「手改了文件」变成看得见的过期数据。
- 唯一可能慢的是 `ctx.skills.snapshot({cwd})`（要等 provider 的 `list()`）。它 `complete: false` 时我们仍返回已收集项（`complete` 透给客户端），不阻塞首屏。
- 客户端只发**一个**请求；骨架在请求前就已上屏，因此首屏可交互时间与扫描耗时解耦（≤ 1 帧）。

#### 1.4.3 rank 反推表（`SkillSummary` 无 rank 的补偿）

| `summary.source` | rank | 依据 |
| --- | --- | --- |
| `project-dsh` | 100 | `EX/dsh-skill-filesystem/README.md`「Roots and priority」表 |
| `project-agents` | 200 | 同上 |
| `custom` | 300 | 同上 |
| `user-dsh` | 400 | 同上 |
| `user-agents` | 500 | 同上 |
| `bundled` | 600 | 同上（`bundledSkillDir` 配置时为 600）；`EX/dsh-skill/lib/index.js` 的 `BUNDLED_SKILL_RANK = 600` |
| *（`source` 缺失且 `provider === 'runtime'`）* | 250 | `EX/dsh-skill/lib/index.js` 的 `RUNTIME_RANK = 250`、`RUNTIME_PROVIDER = "runtime"`；`validateRuntimeSkill` **不校验 `source`**，所以 runtime 条目的 `source` 可能是 `undefined` |
| 其它（第三方 provider 自注册） | 600 | `BUNDLED_SKILL_RANK` 的注释：「Standard precedence rank for packaged skill providers and local bundled roots」；`ctx.skills.registerProvider` 的候选要自带 `rank`，约定值就是它 |

`PROF/@linxin666/dsh-client-ui-skill-explorer/lib/index.js` 的 `SKILL_SOURCE_RANK` 与我们这张表逐项相同（含 `runtime: 250`），可作为交叉验证。

### 1.5 视觉实现策略（1:1 的可行路径）

#### 1.5.1 三类元素，三种落地方式

| 类别 | 元素 | 做法 | 理由 |
| --- | --- | --- | --- |
| **A. 直接使用宿主组件** | 页签 `SegmentedTabs`、行内 `Switch`、`Button`、`Tooltip`、`Toast`、`StateDot`、全部图标 | `require('@deepseek-ai/dsh-client-ui-primitives')` 取组件，只传 `className` 调尺寸 | 这些组件**就是**宿主插件页渲染的那几个；用它们，1:1 由构造保证，不需要复刻 |
| **B. 逐字转写规则** | 页面外壳 / 页头 / 页头停靠 / 分区 / 行 / 骨架 / 空错态 | 自有前缀 `skc_`，取值逐字照抄 [PM-CSS] 与 SHELL 的对应规则（`docs/contracts/visual.md`） | 宿主类名是构建哈希，不能复用；但规则体是稳定的，可以抄 |
| **C. 新造（受限）** | 软链只读标记、页脚计数行、`＋ 添加技能 ⌄` 禁用态 | 只用宿主已存在的配方拼装（`.attemptBadge` / `.empty` / `.addGroup`），不引入新视觉语言 | 队长决策 2/3；不新造颜色、不新造阴影 |

**禁止清单**（验收会查）：不写任何 `--dsw-*` 同名变量；不 `import` 宿主 `*.module.css`；不引 tailwind/MUI/antd/任何 UI 库；不使用宿主哈希类名做选择器；不在 `client/src/**` 里出现 CJK 字面量（由 `scripts/check-i18n.mjs` 强制）。

关于「为什么不干脆用 primitives 的 Switch/SegmentedTabs 就完事、还要抄 CSS」：primitives 只给了**控件**，页面外壳（`page`/`pageBody`/`pageHead`/`group`/`cards`/`cardHead`/`skeleton`）是 `ui-plugin-manager` 的 **module CSS**，不导出、不可引用，只能转写。`HIDDER/docs/reference/settings-ui.md` §8 也把「primitives 可达但不是契约」写成了明确结论：图标与控件可以用，页面骨架必须自己写。

#### 1.5.2 页头滚动停靠（P0 里风险最高的一项）

宿主实现不是「CSS sticky」，而是**克隆量测 + 逐部件插值**（`PluginManagerPage` 的 `createPluginHeaderRef` / `attach`）：

1. 把 `pageBar` **克隆**一份，加 `data-measuring`（`visibility:hidden; position:absolute`），插进 `pageBody`；
2. 在克隆上量两套布局：**静止态**与**紧凑态**（给克隆加 `data-compact`），得到 `restHeight` / `compactHeight` / 每个 `[data-plugin-header-part]`（`title`/`intro`/`toolbar`/`tabs`）的 `{x,y,width}`；
3. 把静止态坐标写进真实元素的 `--plugin-part-x/y/width`，真实 `pageBar` 加 `data-natural`（`position:sticky`），高度锁 `--plugin-header-rest-height`，并用 `clip-path` 只露出 `--plugin-header-paint-height`；
4. 滚动时按 `offset` 给每个部件插值 `translate`/`width`/`clip-path`，并翻转 `data-compact`/`data-scrolled`；
5. `ResizeObserver(body)` + `MutationObserver(header)` + `document.fonts loadingdone` 触发重量测。

这一段是「滚动范围不变 / 控件停靠 / 收拢顺序」三条 P0 行为的唯一实现路径，因此**照 port**（`src/client/header-scroll.js`，纯插值部分单独抽函数给 QA 单测）。若真机上出现抖动，降级阶梯写在 §5 D3。

#### 1.5.3 用到的 primitives 导出（逐个核实存在）

`EX/dsh-client-ui-primitives` 通过 seed 暴露 `@deepseek-ai/dsh-client-ui-primitives`（seed 键见 1.2.4），导出名在本机 shell 里逐个命中：

| 用途 | 导出名 | 关键 props（宿主用法） |
| --- | --- | --- |
| 页签 | `SegmentedTabs` | `{size:'sm', className, label, value, onChange, items:[{value,label,id,panelId}]}` |
| 行内开关 | `Switch` | `{checked, label, disabled, title?, onChange}` |
| ⓘ / 刷新 / 重试 / 添加 | `Button` | `{variant ∈ {ghost, outline, primary}, size:'sm', className, icon, disabled, onClick, children}` |
| tooltip | `Tooltip` | `{label, side:'bottom', delayMs, focusDelayMs?, maxWidth?, portal, openOnClick?, disabled?}` |
| 失败 toast | `Toast` | `{text, icon, holdMs?, onDone}` |
| 进行中/错误指示 | `StateDot` | `{state ∈ {ongoing, error, idle}, size?}` |
| 侧栏行图标 | `IconSkillOutlineRegular` | `{size}` |
| ⓘ / 刷新 / 箭头 / 软链标记 / 警告 | `IconInfoOutlineRegular`(11)、`IconRefreshOutlineRegular`(13)、`IconChevronDownOutlineRegular`、`IconLinkOutlineRegular`、`IconWarningOutlineRegular` | `{size, "aria-hidden"?}` |

依据：`EX/dsh-client-ui-plugin-manager/lib/client.js`（SegmentedTabs / Switch / Button / Tooltip / StateDot / Toast 的真实调用点，见 §3.3 各条引注）；导出名在 `SHELL/index-BgUyXZcc.js` 中存在（如 `IconSkillOutlineRegular`、`IconLinkOutlineRegular`、`StateDot`、`Toast`）。

行图标（`.skc_cardIcon`）**不取 primitives**：它是首字母头像（技能名首字母 + 按名字散列的粉彩色块），
色板与散列在 `src/client/avatar.js`，刻度见 `docs/contracts/visual.md` A.5 / A.9。

---

---

## 2 文件清单

相对 `~/Documents/Agents/Plugins/dsh-skill-center/`；标 **★** 的由构建产出并入库。

### 2.1 包根与接线

| 文件 | 职责 |
| --- | --- |
| `package.json` | 包清单：`exports` / `dsh.client` / `peerDependencies` / `scripts`（build、check、check:i18n、test）/ `files` |
| `cordis.patch.yml` | bundle 层：一条 `insert` 让包可被 profile 选中 |
| `index.js` | **Host 半部入口**：`name` / `inject` / `apply(ctx, config)`；解析 `dshHome`/`skillsRoot`，装配 `makeRoutes()`，`ctx.effect` 注册与释放路由 |
| `client.js` ★ | **Client 半部产物**：`__ModuleLoader__.load` 外壳 + 全部页面代码（由 `scripts/build-client.mjs` 生成） |
| `assets/icon.svg` | 插件列表图标（`package.json` 的 `icon` 指向它） |
| `README.md` | 使用者视角：能力、安装、已知限制（P0 只读软链、市场页签占位） |
| `AGENTS.md` | 维护者视角：命令、真源文件地图、硬约束（不提交构建产物以外的生成物、不硬编码中文） |
| `locale/zh.json` | 唯一中文文案真源（含 `meta.title` = 入口名、`panel.label`、全部 UI 键） |
| `locale/en.json` | 英文真源，键集必须与 `zh.json` 完全一致（`check:i18n` 强制） |

### 2.2 Host 半部（`lib/`，纯 node ESM，无构建）

| 文件 | 职责 |
| --- | --- |
| `lib/names.js` | `isSkillName()`（`^[a-z0-9]+(?:-[a-z0-9]+)*$`）、`isAbsoluteSkillFile()`、`isWithin(root, path)`、`identityKey(provider,name)`、上游身份三段正则 + `isUpstreamIdentity(sourceId, owner, slug)`（市场路由的白名单也取这三个常量） |
| `lib/loopback.js` | loopback 围栏纯函数：`isLoopbackAddress` / `isLoopbackHostname` / `isProxiedRequest` / `isLoopbackRequest(req)` |
| `lib/http.js` | `readJsonBody(req, {maxBytes, objectOnly})`、`asJsonObject`、`writeJson(res, status, body)`、`ok()/fail()` 信封 |
| `lib/frontmatter.js` | `parseFrontmatter(text)`、`stripFrontmatter(text)`、`setDisableModelInvocation(bytes, disabled)`（**字节级纯函数**） |
| `lib/write-skill.js` | 指纹 → 临时文件 → fsync → rename → 回读校验 → 失败回滚（`writeDisableFlag(path, disabled)`） |
| `lib/ledger.js` | R5 四个台账的只读解析（`installed.json` / `repositories.json` / `.skills-lock.json` / 自有记录），全部损坏降级 |
| `lib/scan.js` | 扫描 `$DSH_HOME/skills`（跳过 `.system`、点文件、非技能条目）；产出 `ScanCandidate[]`（含 `symlink`/`realPath`、`upstream` 身份三元组、`version`）；`readSkillContent(row)` = 详情页那一次读盘（围栏见 `docs/contracts/routes.md` §3.3.3） |
| `lib/registry.js` | `snapshotRegistry(ctx.skills, cwd)` + `rankOfSummary(summary)`（= 先按 `source`/`provider` 映射成 level，再调 `classify.rankOf(level)`；映射表见 1.4.3） |
| `lib/classify.js` | **纯函数核心**：`rankOf(level)`、`classifySkill(input)`、`mergeCatalog({scanned, registry, ledger})`、`buildGroups()` |
| `lib/provider-toggles.js` | 自有存储 `$DSH_HOME/dsh-skill-center/provider-toggles.json`：`deserialize`/`serialize`/`read`/`setEnabled`（原子写、损坏降级） |
| `lib/routes.js` | `makeRoutes(ctx, deps) → WebRoute[]`：`list` / `toggle` / `provider-toggle` / `health` / `detail` 五条本地面 exact 路由 + 市场面 7 条（批量图标 `market/icons` 与本地收藏写 `market/favorite` 在内；两条图片端点已于 U7 退场）+ 围栏 + 身份校验 |
| `lib/market/`（市场面） | 源适配器、上游客户端、ZIP 读取、安装链路与两份自有存储（台账 / 收藏），共 11 个文件；本表不展开，逐个职责见 `docs/contracts/market.md` 附录 G |

### 2.3 Client 半部源码（`src/client/`，ESM + JSX，esbuild 打包）

| 文件 | 职责 |
| --- | --- |
| `src/client/index.jsx` | `apply(ctx)`：注册 locale 字典、注入样式表、注册 `sidebar.panellist` + `main` + `shell.overlay`（toast），返回 disposer |
| `src/client/api.js` | `SkillCenterApi`：`list()` / `toggle({name,path,enabled})` / `toggleProvider({provider,name,enabled})` / `skillDetail({name})`；文档相对 URL；把 `{code,data,message}` 归一成 `ApiError{code}` |
| `src/client/state.js` | 模块级 store（`createStore` 形状：`getSnapshot`/`subscribe`/`actions`）：`tab` / `payload` / `status` / `error` / `rows` / `notice` / `detail`（详情三态）/ `detailScrollTop` |
| `src/client/model.js` | **纯函数**：`toGroups(payload)`、`statusLine(counts, t)`、`rowViewState(row, rows)`、`isPending(rows, key)`、`groupEmptyKey(key)`、`rowByKey(payload, key)`、`detailStateOf(state, key)`、`detailFactsOf(row, t)`、`partitionTagKey(row)` |
| `src/client/avatar.js` | **纯函数（无 React）**：`SKC_AVATAR_TONES`（12 组 `{bg, ink}` 粉彩，色相 30° 等分）+ `avatarOf(name)`（首个 `\p{L}`/`\p{N}` 大写字母 + FNV-1a 散列选色），node 可直接测 |
| `src/client/page.jsx` | 页面组件：`page` → `pageBody` → `pageBar`(header) + 两个 `tabPanel`；骨架/空/错/页脚的组装 |
| `src/client/row.jsx` | `SkillRow`（首字母头像/标题/描述/`cardEnd`）、`EnableSwitch`（`bundleToggle` + `toggleProgress` + primitives `Switch`）、`ReadonlyTag`（软链只读标记） |
| `src/client/skeleton.jsx` | 加载态：区标题占位 + 4 行骨架卡（规格见 `docs/contracts/visual.md` A.6） |
| `src/client/header-scroll.js` | `attachHeader(bar)`（克隆量测 + 观测）+ **纯函数** `interpolateParts(parts, offset)` |
| `src/client/styles.js` | 单一 CSS 字符串（`docs/contracts/visual.md` 的全文）+ `injectStyles()`（按 `data-plugin-css` 去重） |
| `src/client/toast.jsx` | `shell.overlay` 占位者：渲染刷新失败 toast（primitives `Toast`），离开页面后仍可见 |
| `src/client/` 下的 `market-*` 文件 | 市场页的纯函数模块与 6 个组件（列表 / 筛选 / 卡片 / 详情 / 骨架 / 确认）加图形单元（品牌位图与三段字形）；职责见 `docs/contracts/market.md` 附录 G。`installed-detail.jsx`（已安装详情页）与 `markdown.jsx`（两页共用的正文渲染 + 兜底）见 `docs/contracts/installed-detail.md` |

### 2.4 构建与门禁脚本（`scripts/`）

| 文件 | 职责 |
| --- | --- |
| `scripts/build-client.mjs` | esbuild 打包 + `__ModuleLoader__` 外壳 + sourcemap |
| `scripts/check-client.mjs` | 重新构建到临时文件并与 `client.js` 逐字节比对；校验产物含 `__ModuleLoader__.load({ id: "<包名>"`；无 esbuild 时给出可读报错 |
| `scripts/check-i18n.mjs` | `zh.json`/`en.json` 键集一致；`src/client/**` 与 `lib/**` 中**禁止 CJK 字面量**；`panel.label` 键存在 |

### 2.5 测试（QA 拥有）

全部用例在 `test/**/*.test.mjs`，`npm test` 一次跑完；**分层依据、夹具与用例编号见附录 D**（本设计只给口径，不给骨架）。

### 2.6 文档

本文件是架构与接口契约。「想知道什么该看哪份」的读者入口见 `AGENTS.md` 的文档地图；页面视觉刻度在 `docs/contracts/visual.md`；宿主页面形状（外部取值来源）在 `docs/reference/host-plugin-page.md`。

---

---

## 6 依赖包

运行时**零依赖**；以下全部是 devDependency（不进 `dependencies`，因为本插件靠 `link:` 安装、Host 半部只用 node 内置模块）。

```
esbuild@0.25.0            —— 打包 client 半部；与 PROF/@michengai/dsh-skills-manager 同版本
react@18.3.1              —— JSX 类型与本地渲染测试（运行时由宿主 seed 提供）
react-dom@18.3.1          —— renderToStaticMarkup 结构测试（运行时由宿主 seed 提供）
@types/react@~18.3.1      —— 编辑器补全（仅类型）
@types/react-dom@~18.3.1  —— 同上
```

`peerDependencies`（声明我们依赖宿主提供什么，不安装）：

```
@deepseek-ai/cordis                    >=4.0.1        —— Host 半部 ctx
@deepseek-ai/dsh-host-webserver        >=0.2.0-rc.1   —— ctx.webServer.register
@deepseek-ai/dsh-skill                 >=0.2.0-rc.1   —— ctx.skills.snapshot
@deepseek-ai/dsh-session               >=0.2.0-rc.1   —— ctx.sessions.list（解析 cwd）
@deepseek-ai/dsh-client-locale         >=0.2.0-rc.1   —— ctx.locale.register/bind
@deepseek-ai/dsh-client-ui-layout      >=0.2.0-rc.1   —— main 座位
@deepseek-ai/dsh-client-ui-sidebar     >=0.2.0-rc.1   —— sidebar.panellist 座位
@deepseek-ai/dsh-client-ui-primitives  >=0.2.0-rc.1   —— 控件与图标（经 seed）
react                                  ^18.2.0
react-dom                              ^18.2.0
```

依据：`PROF/@michengai/dsh-skills-manager/package.json` 与 `PROF/@linxin666/dsh-client-ui-skill-explorer/package.json` 的 peer 集合（我们只取真正用到的子集），版本区间取本机实测可用的 `0.2.2-rc.1` 系列。

市场面同样**不新增任何 dependency / devDependency**：`node:https`、`node:crypto`、`node:fs/promises` 都是 node 内置；U7 之后没有 zip 读取器（zip 读取模块随 `package:'zip'` 一起退役）。

---

---

## 验收

- `npm run check:client` 通过 ⇒ `exports["./client"]`、产物装载形状与 `src/client/**` 一致（§2.4）。
- `test/bundle-contract.test.mjs`、`test/index.test.mjs` 通过 ⇒ §1.2 的座位接线与 §2.1 的包清单没被改坏。
