# 前端组件、状态与命名约定

> 类型：规范
> 读者：改 `src/client/**`、`locale/*.json` 的人
> 真源：`src/client/**` 与 `locale/{zh,en}.json`；页面刻度的取值在 `docs/contracts/visual.md`
> 更新触发：改组件结构、状态机、文案键、命名约定或 i18n 形状时，同步改 §3.5 / §3.6 / §8.2–§8.5
> 规模上限：400

编号 §3.5 / §3.6 / §8.2–§8.5 保持原值（原件见 `git show a8141eb:docs/system_design.md`）。

---

## 3.5 Client 组件与状态契约

```
ClientPlugin.apply(ctx)
  ├─ ctx.effect(() => ctx.locale.register(NS, { zh, en }))          // 字典来自 locale/*.json（构建期内联）
  ├─ injectStyles()                                                // <style data-plugin-css="dsh-skill-center/client.css">
  ├─ slots.inject('sidebar.panellist', …)  → SkillsPanelIcon
  ├─ slots.inject('main', …)               → SkillsPage（inject: {store, api}）
  └─ slots.inject('shell.overlay', …)      → ToastHost（inject: {store}）  // 离开页面仍可见（P0-12）
```

状态机（`PageState.status`）：`idle → loading → ready | error`；`error` 且已有 `payload` ⇒ 保留 `payload` 并把 `notice` 置成刷新失败 toast；`rows` 是 `Map<identityKey, {pending:boolean, reason:string|null}>`，**不做乐观 UI**：`pending` 期间开关 `disabled` + `StateDot ongoing`，成功才写 `payload` 里的 `enabled`，失败写 `reason` 并保持旧值。

`main` 槽注册带 `locale: NS` ⇒ 页面组件从框架拿到 `t`（宿主同款；依据 `EX/dsh-client-ui-plugin-manager/lib/client.js` 的 `function PluginManagerPage(props){ const { t, ensure, renderSlot, resolveText } = props; … }` 与其 `main` 注册里的 `locale: NS`）。

页签状态放**模块级 store**（不是 `localStorage`）：满足 P0-3「离开页面再回来保持所选页签」，且与宿主一致（宿主用 `main` 注册的 `store` 选项保存视图状态，页面卸载后重建仍能恢复）。

---

## 3.6 视觉契约

完整、可直接抄进代码的样式表见 **`docs/contracts/visual.md`**；「哪条规则抄自宿主哪条」逐行标注。关键类名与宿主规则的对应：

| 我们的类 | 宿主来源 | 语义 |
| --- | --- | --- |
| `skc_page` / `skc_pageBody` / `skc_pageBar` / `skc_pageHead` | `[PM-CSS]` `.page` / `.pageBody` / `.pageBar` / `.pageHead` | 页面外壳与页头条 |
| `skc_pageHeading` / `skc_pageTitle` / `skc_pageIntro` / `skc_infoButton` / `skc_toolbar` | 同上 | 页头四件套 |
| `skc_pageTabs` / `skc_pageTabList` | 同上 + `SHELL` `._tabs_1lga9_1` | 页签容器（组件用 `SegmentedTabs`） |
| `skc_installedPanel` / `skc_tabPanel` / `skc_group` / `skc_groupHead` / `skc_groupTitle` | 同上 | 分区骨架 |
| `skc_cards` / `skc_card` / `skc_cardHead` / `skc_cardIcon` / `skc_cardMain` / `skc_titleRow` / `skc_cardTitle` / `skc_cardDesc` / `skc_cardEnd` | 同上 | 行 |
| `skc_bundleToggle` / `skc_toggleProgress` / `skc_progressAnnouncement` | 同上 | 开关左侧 22px 预留 + 进行中指示 |
| `skc_roTag` | `[PM-CSS]` `.attemptBadge`（配方）+ `IconLinkOutlineRegular` | 软链只读标记（队长决策 2） |
| `skc_skeletonFill` / `skc_skeletonBar` / `skc_skeletonHeading` … | 同上 | 骨架 |
| `skc_empty` / `skc_failure` / `skc_status` / `skc_reason` | 同上 | 空 / 错 / 状态 / 行内原因 |
| `skc_addGroup` / `skc_addPrimary` / `skc_addMore` / `skc_addButton` | 同上 | `＋ 添加技能 ⌄`（P0 禁用态） |

`.skc_cardIcon` 的**容器是宿主 `.cardIcon` 原样式**（`.5px` `border-l3` 描边、`radius-lg` 圆角、48×48、`border-box`），
不随头像需求改动；变化只在内容层：宿主画通用技能图标，本面板画首字母。
颜色不是样式表常量，而是 `avatar.js` 的 12 组色板（色相 30° 等分，字母对比度 4.95–6.62）经 `row.jsx`
以 `--skc-avatar-bg` / `--skc-avatar-ink` 行内传入（刻度见 `docs/contracts/visual.md` A.5）；
`background-clip: padding-box` 保证粉彩底不盖住半透明描边。骨架复用同一个类，由 `.skc_skeletonIcon`
自己再写灰色底，加载态不出现彩色块、也不出现字母。

---

---

## 8.2 命名约定

| 对象 | 规则 | 例 |
| --- | --- | --- |
| 面板 id | 与包名同值，全局唯一 | `dsh-skill-center` |
| 路由前缀 | `/api/dsh-skill-center/*`（服务端带前导 `/`；客户端用**文档相对** `api/dsh-skill-center/*`） | —— |
| 分区 key | `builtin` / `local` / `installed`（**机器值**，永不本地化） | `group.local` |
| CSS 类 | `skc_` 前缀 + camelCase；局部自定义属性 `--skc-*` | `skc_cardHead`、`--skc-page-inset` |
| 样式注入钩子 | `style[data-plugin-css="dsh-skill-center/client.css"]` | —— |
| 自有存储 | `$DSH_HOME/dsh-skill-center/provider-toggles.json` | —— |
| 技能名文法 | `^[a-z0-9]+(?:-[a-z0-9]+)*$`（宿主同文法） | `dev-docs-standards` |
| 身份键 | `${provider}#${name}`（内存）；磁盘用 `{provider,name}` 数组 | `filesystem#ui-design` |

---

## 8.3 i18n 键约定

- 命名空间 `NS = 'dsh-skill-center'`；`locale/zh.json` / `locale/en.json` 是**唯一文案真源**，键集必须一致。
- **文件形状：单层扁平点号键**（`"panel.label": "技能"`），**不是**嵌套对象（`{"panel":{"label":…}}`）。
  依据是宿主实现：`ctx.locale` 的 `lookup(ns,key)` 是 `locales.get(locale)?.[key]` ——**字面量属性查找**，
  找不到就 `?? key` 回落成键名；它不做点号路径遍历。嵌套字典在真机上的表现是**整页显示原始键名**
  （`page.title` / `group.builtin` / `status.count`…）。
- **唯一允许的嵌套是顶层 `meta` 块**（`{"meta":{"title":…,"description":…}}`）：它不进运行时字典，
  只给宿主的插件列表读（`dsh-app-boot` 的 `readPluginMeta` → `dictionariesOf` 读 `parsed.meta.title`）。
  `src/client/index.jsx` 注册前用 `uiDictionary()` 滤掉 `meta`，因此运行时字典里**只有字符串**；
  反过来把 `meta` 也拍平会让插件列表里的名字掉回包名。`check:i18n` 校验这个形状，
  `test/i18n.test.mjs` 校验「每个 `t('…')` 字面量键在两侧字典里都存在」。
- `client/src/**` 与 `lib/**` **不得出现 CJK 字面量**（`check:i18n` 强制）；界面文案一律 `t('key')`。
- 占位符用 `{name}`（宿主同款：`t('partToggle', { name: title })`）。
- 入口标题**只允许**通过 `panel.label` 表达：改名 = 改 `locale/*.json` 的 `panel.label` + `meta.title`，代码零改动（这是「不硬编码中文」的可验收形态）。两处都要改的理由：`meta.title` 是插件列表里的显示名（`PROF/*/locale/zh.json` 四家都是 `{meta:{title,description}}`），`panel.label` 是侧栏行标题。`check-i18n` 会校验两者都存在。
- 键表（P0 全集，`zh` 值逐字来自 `PRD` §3.3.5 与本设计）：

| key | zh |
| --- | --- |
| `meta.title` | 技能 |
| `meta.description` | 一眼分清内置、本地与市场安装的技能，逐行启用或停用。 |
| `panel.label` | 技能 |
| `page.title` | 技能 |
| `page.intro` | 启用、停用和查看技能来源 |
| `page.infoLabel` | 关于技能 |
| `page.infoDescription` | 在这里启用或停用技能。内置技能、本地技能和从市场安装的技能分三组展示。 |
| `page.refresh` | 刷新 |
| `page.loading` | 正在读取技能… |
| `page.error` | 可能由于网络问题，无法读取全部技能 |
| `page.retry` | 重试 |
| `page.refreshError` | 刷新失败，请重试 |
| `tabs.label` | 技能分区 |
| `tabs.installed` | 已安装 |
| `tabs.market` | 技能市场 |
| `group.builtin` | 内置技能配置 |
| `group.local` | 本地技能 |
| `group.installed` | 已安装技能 |
| `group.builtinEmpty` | 这个部署没有内置技能。 |
| `group.localEmpty` | 还没有本地技能。把技能目录放进 ~/.dsh/skills/ 就会出现。 |
| `group.installedEmpty` | 还没有从市场安装技能。 |
| `footer.excluded` | 另有 {count} 个技能位于项目级或其他目录，首版不展示 |
| `status.count` | 共 {total} 个技能 |
| `status.offSuffix` | ，{count} 个已停用 |
| `market.placeholder` | 技能市场将在后续版本提供。 |
| `row.enable` | 启用 {name} |
| `row.disable` | 停用 {name} |
| `row.applying` | 正在应用 {name} 的更改 |
| `row.symlinkReadonly` | 软链·只读 |
| `row.symlinkTitle` | 这是一个软链（指向 {path}），本面板不会修改它 |
| `add.label` | 添加技能 |
| `add.comingSoon` | 即将支持 |
| `error.E_NOT_FOUND` | 这个技能已不存在，请刷新 |
| `error.E_STALE_PATH` | 技能文件位置已变化，请刷新后重试 |
| `error.E_SYMLINK_READONLY` | 软链技能只读，未做任何修改 |
| `error.E_FILE_CHANGED` | 技能文件在你操作期间被修改，请刷新后重试 |
| `error.E_NOT_WRITABLE` | 这个技能没有可写的本地文件 |
| `error.E_WRITE_FAILED` | 写入技能文件失败：{reason} |
| `error.E_VERIFY_FAILED` | 写入后回读不一致，已回滚 |
| `error.E_FORBIDDEN` | 请求被拒绝（仅限本机访问） |
| `error.E_UNKNOWN` | 操作失败：{reason} |

---

## 8.4 时间与其他

- 日志与 `health` 里的时间一律 **ISO 8601 UTC**（`new Date().toISOString()`）；**界面上不显示任何时间**（首版无版本检查、无「上次刷新」）。
- 布尔：YAML 侧接受 `true/false/yes/no/on/off/1/0`（大小写不敏感，宿主同文法，`EX/dsh-skill-filesystem/README.md`「Skill format」）；**写回只用 `true`/`false`**。
- 数字：`counts` 全部是整数，缺失按 0（不做 `undefined` 透出）。
- 日志：`ctx.logger.warn(error)` 记录，**不把路径之外的敏感内容打进日志**。

---

## 8.5 样式字面量单点

尺寸与颜色字面量只允许出现在 `src/client/styles.js`（样式）与 `src/client/avatar.js`（12 组头像色板，全仓库仅此两处色值）；其它组件文件不得写颜色/尺寸（`size={11|13}` 这类图标尺寸除外）。
锚点：`test/styles.test.mjs`；把刻度搬进组件时那条用例先红。

---

---

## 验收

K22–K27：`test/view-row.test.mjs`、`test/view-page.test.mjs`、`test/view-skeleton.test.mjs`、`test/view-toast.test.mjs`、`test/state.test.mjs`、`test/header-scroll.test.mjs`、`test/i18n.test.mjs`；`npm run check:i18n` 兜住「代码里不许有中文」。
