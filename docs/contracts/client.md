# 前端组件、状态与命名约定

> 类型：规范
> 读者：改 `src/client/**`、`locale/*.json` 的人
> 真源：`src/client/**` 与 `locale/{zh,en}.json`；页面刻度的取值在 `docs/contracts/visual.md`
> 更新触发：改组件结构、状态机、文案键、命名约定或 i18n 形状时，同步改 §3.5 / §3.6 / §3.9 / §8.2–§8.5
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
`market` 子状态同理（见 §3.9.1）：它和 `tab` 一样跨页签存活，**离开市场页签不会销毁已加载的页、筛选与滚动位置**。

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

## 3.9 市场页组件与状态

「技能市场」是同一个全局页的第二个页签：仍是 `main` 槽里的 `SkillsPage`，**不新增座位、不新增 `ctx.*` 服务**（`inject` 仍是 `['slots','locale']`）；安装成功的提示复用既有 `shell.overlay`。样式与取值来源见 `docs/contracts/market.md` 附录 F。

### 3.9.1 状态机

`PageState.market` 与 `tab` 一样放在模块级 store 里，因此**离开市场页签再回来，已加载的页、筛选、排序、详情状态与滚动位置都还在**（页签离开不销毁任何东西）。

```text
market = {
  boot: 'idle'|'loading'|'ready',                 // bootstrap；失败也进 ready，不是 error
  sources / categories / categoriesOk,            // 失败时 sources 回落内置双源、categoriesOk=false
  filters: {source, category, sort},              // source 含机器值 'all'
  keyword / input,                                // 已提交关键词 / 输入框现值（防抖在组件里，store 不持定时器）
  items / pages,                                  // 已合并去重后的列表、已加载页数（返回详情后要恢复）
  cursors / exhausted,                            // 每源自己的不透明游标与「已耗尽」
  page: {status, code, message},                  // idle | loading | more | done | error（尾部）
  sourceErrors: [{sourceId, code}],               // 部分源不可用 → 顶部提示条
  listStatus: 'idle'|'loading'|'ready'|'error',   // 整页态
  detail: null | {id, item, status, data, code},  // 内嵌详情三态
  installed / installedReady,                     // 安装台账 × item.id；只读一次
  installs: {[id]: {state, reason?, path?, version?, seq?}},   // 确认/安装中/已安装/失败
  installedDirty,                                 // 已安装页签标脏
  scrollTop,                                      // 进详情前记下，返回时恢复
}
```

转移（触发 → 结果）：

| 触发 | 结果 | 副作用 |
| --- | --- | --- |
| 首次进入市场页签 | `boot=loading`，并发发 `bootstrap` + `installed` + 第一页扇出 | 骨架（分类条也是占位） |
| `bootstrap` 成功 | `boot=ready` | 填 `sources/categories`；`categoriesOk=false` 时分类行换成一句说明 |
| `bootstrap` 失败 | `boot=ready`（**不是 error**） | `sources` 回落内置双源，列表照打，分类行隐藏 |
| 关键词变化 | 250ms 防抖后提交 | 请求中**保留旧 items**（`aria-busy` + 搜索框旁 ongoing 点），不换骨架 |
| 回车 / 清空输入 | 立刻提交，不经防抖 | 清空只清关键词，不动来源与分类 |
| 切来源 / 分类 / 排序 | 清 `items/pages/cursors/exhausted/detail`，滚回顶部 | 值没变时不重拉 |
| 扇出返回（≥1 源成功） | `listStatus=ready`，`page` 进 `more` 或 `done` | 成功的源按 `mergeBatches` 交错；失败的源进 `sourceErrors` → 提示条 |
| 扇出返回（全部失败） | `listStatus=error` | 整页错误态 + 重试；**不出空态**（空 ≠ 失败） |
| 追加返回 | `page` 进 `more` 或 `done` | 只向 `cursor !== null` 的源扇出；`items` 追加去重，不重排已有项 |
| 追加失败 | `page=error` | 底部「加载失败，点此重试」，items 不动 |
| 触底（距底 200px）或本页没填满视口 | `page=loading` | 同时最多一次（组件内 `useRef` 闸）；**短页不算结束**，判据只有 `next === null` |
| 打开详情 | `detail={status:'loading'}` | 先记 `scrollTop`；items 与 pages 原地不动 |
| 返回市场 | `detail=null` | 恢复 `scrollTop`，不重拉 |
| 点安装 | `installs[id].state='confirm'` | 只有确认弹窗，不发请求 |
| 确认 / 成功 / 失败 | `installing` → `installed` 或 `failed` | 成功：toast + `installedDirty=true` + `installed[id]`；失败：行内原因 + 「重试」 |
| 切到已安装页签且 `installedDirty` | 重拉 `list` 一次并清脏 | 用户不必手按刷新 |

两条闸：`installs[id].state === 'installing'` 时按钮 `disabled`，且 action 自身幂等（重复调用直接返回），因此连点只发一次请求。

### 3.9.2 组件树与文件

```text
SkillsPage (page.jsx：页头 + 两个页签)
├─ toolbar：刷新（恒在，行为跟随当前页签）｜计数 + ＋添加技能（仅「已安装」页签渲染）
└─ tabPanel(market) → MarketPanel (market-panel.jsx)
    ├─ MarketFilters (market-filters.jsx)：Input(250ms 防抖) / Menu(来源) / Menu(排序) / Pill(分类 chips)
    ├─ 提示条（部分源不可用）｜首屏骨架｜整页错误态｜空态
    ├─ ul.skc_marketGrid → MarketCard (market-card.jsx) × N（尾部 3 张骨架）
    ├─ MarketDetail (market-detail.jsx)：面包屑 + 头 + 事实表 + 概览 + 文件
    └─ MarketConfirm (market-confirm.jsx)：Modal（width:min(480px,100vw - 32px)）
MarketSkeleton / MarketTailSkeleton (market-skeleton.jsx)
```

四条结构约束：

1. **整卡可点只有一个手段**：标题按钮 `.skc_marketCardOpen::after{inset:0}` 铺满整卡，`.skc_marketCardEnd{z-index:1}` 让安装按钮浮在点击层之上。不做 `<a href>`、不做卡片内的第二个可点区域、不给卡片加行 hover 之外的交互。已安装页签的行一个字节不变。
2. **详情就地替换网格**（`detail !== null` 时返回详情而不是网格），与宿主的页内详情同构；返回不重拉任何东西。
3. 详情正文用宿主 primitives 的 `MarkdownText` 渲染（与对话里的第三方 markdown 同一个渲染器，不自造 sanitizer）；渲染抛错或正文为空时回落纯文本 + `market.detailNoOverview`。
4. 组件只读 props（`store/api/t`）写 `store.actions`，不直接 `fetch`；只有滚动位置恢复与触底预取读 DOM，且都在 `useEffect` 里（字符串渲染不触发）。

### 3.9.3 store action（`src/client/state.js`）

| action | 入参 | 做什么 |
| --- | --- | --- |
| `marketBootLoading()` | —— | `boot='loading'` |
| `marketBootReady({sources,categories,categoriesOk})` | bootstrap data | 填三件 |
| `marketBootFallback(sources)` | 描述符数组 | `boot='ready'`、`categoriesOk=false`（失败不是错误态） |
| `marketSetInput(text)` | string | 只改 `input` |
| `marketCommitKeyword(text)` | string | `keyword=input=text`，清分页；**保留 items** |
| `marketSetFilter({source?,category?,sort?})` | 部分 filters | 合并 + 清 items/分页 + 关详情；值没变就什么都不做 |
| `marketReload()` | —— | 页头「刷新」在市场页签的行为：清已加载页，由面板 effect 重拉第一页 |
| `marketListLoading()` / `marketListFailed({code,message})` | —— / 错误 | 整页态 |
| `marketPageStart()` | —— | `page.status='loading'`（追加用，不清 items） |
| `marketPageAppended({pages,merged,errors})` | `pages:[{sourceId,page,items}]`、合并结果、本轮失败源 | 写每源 cursor/exhausted、`items=merged`、`pages+1`、尾部进 `more` 或 `done`；成功的源从 `sourceErrors` 里清掉 |
| `marketPageFailed({code,message})` | 错误 | `page.status='error'`，items 不动 |
| `marketInstalledLoaded(map)` | `{[id]:{name,version,path,exists}}` | 填 `installed` + `installedReady=true` |
| `marketDetailOpen(item)` | MarketItem | `detail={id,item,status:'loading'}` |
| `marketDetailReady(data)` / `marketDetailFailed({code,message})` / `marketDetailClose()` | MarketDetail / 错误 / —— | 详情三态与关闭 |
| `marketInstallConfirm(id)` / `marketInstallCancel(id)` | id | 确认弹窗开关（**不发请求**） |
| `marketInstallStart(id)` | id | `state='installing'`（幂等） |
| `marketInstallOk(id,{name,path,version})` | —— | `installed` + `installed[id]` + `installedDirty` + 推 `notice{kind:'install-ok', name, path, seq}` |
| `marketInstallFail(id, reason)` | 本地化原因 | `state='failed'` + `reason` |
| `marketSetScroll(top)` / `marketClearInstalledDirty()` | number / —— | 记滚动位置 / 清脏 |

`notice` 复用既有字段：`refresh-failed`（既有）与 `install-ok`（新增，副行给安装路径），由 `toast.jsx` 按 `kind` 选文案，5 秒后 `dismissNotice(seq)`。

`marketPageAppended` 的入参是**数组**（设计文档写的是单源形状）：触底追加会同时向「还没耗尽」的多个源扇出，单源形状承载不了；语义（写游标、合并、翻页计数）不变。

### 3.9.4 api 方法（`src/client/api.js`）

| 方法 | 路由 | 备注 |
| --- | --- | --- |
| `marketBootstrap()` | `GET market/bootstrap` | 分类失败不报错：`categoriesOk:false` |
| `marketList({source,sort,category,keyword,cursor,limit})` | `GET market/list` | **一源一次请求**；空值不入参（不传 cursor 才是第一页） |
| `marketDetail({source,owner,slug,version})` | `GET market/detail` | —— |
| `marketInstalled()` | `GET market/installed` | 形状 `{items, readable}` |
| `marketInstall({source,owner,slug,version})` | `POST market/install` | body 只有身份，**没有 path/files** |

全部走既有 `request()`：文档相对 URL + 信封解包 + `ApiError{code, message, data}`（`data` 是信封里的 `data`，安装失败时用来取冲突路径与声明名）。安装永不自动重试。

### 3.9.5 详情就地替换网格的返回契约

「返回市场」必须逐项恢复，且**不重拉**：`items` 与 `pages` 不动、`filters` 与 `keyword` 不动、`scrollTop` 写回滚动容器、`detail` 置 `null`。这是结构保证（状态在 store 里），不是补丁：面板卸载/重挂都不影响。

市场用例（K28–K51）与 PRD 的 A1–A17 对照见 `docs/contracts/acceptance.md` 的附录 D.5（由 QA 落地）。


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
| 市场路由前缀 | `/api/dsh-skill-center/market/*`（服务端）；客户端 `api/dsh-skill-center/market/*` | `market/list` |
| 市场 CSS 类 | `skc_market*` 前缀，取值见 `docs/contracts/market.md` 附录 F | `skc_marketCard` |
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
- 市场面沿用两族键：`market.*`（61 个，全部新增）与 `error.E_*`（11 个新增，与既有的 11 个同族）；**`market.placeholder` 已删除**（市场页签不再是占位文案）。
- 键表（P0 全集 + 市场轮；`zh` 值逐字来自 `PRD` §3.3.5 与本设计）：

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
| `market.sectionLabel` | 技能市场 |
| `market.searchLabel` | 搜索技能 |
| `market.searchPlaceholder` | 搜索技能… |
| `market.clearSearch` | 清除搜索 |
| `market.searching` | 正在搜索 |
| `market.sourceLabel` | 来源 |
| `market.source.all` | 全部来源 |
| `market.source.skillhub` | SkillHub |
| `market.source.clawhub` | ClawHub |
| `market.sortLabel` | 排序 |
| `market.sort.recommended` | 推荐 |
| `market.sort.updated` | 最近更新 |
| `market.sort.downloads` | 下载最多 |
| `market.categoriesLabel` | 分类 |
| `market.category.all` | 全部 |
| `market.categoryScope` | 分类只作用于带分类的来源（ClawHub 条目不在分类内） |
| `market.loading` | 正在读取技能市场… |
| `market.loadingMore` | 正在加载更多 |
| `market.endOfList` | 没有更多了 |
| `market.moreFailed` | 加载失败，点此重试 |
| `market.emptyTitle` | 这个来源暂时没有技能 |
| `market.emptySearchTitle` | 没有找到与「{keyword}」匹配的技能 |
| `market.emptySearchHint` | 换个词试试，或看看全部分类 |
| `market.emptyCategoryTitle` | 这个分类下暂时没有技能 |
| `market.emptyCategoryAction` | 看全部分类 |
| `market.errorTitle` | 无法连接技能市场 |
| `market.errorHint` | 检查网络后重试 |
| `market.retry` | 重试 |
| `market.partialSource` | {source} 暂时连不上，以下是另一个来源的结果 |
| `market.categoriesUnavailable` | 暂时读不到分类 |
| `market.cardOpen` | 查看 {name} 详情 |
| `market.metaAuthor` | @{author} |
| `market.metaVersion` | v{version} |
| `market.metaDownloads` | 下载 {count} |
| `market.install` | 安装 |
| `market.installing` | 安装中… |
| `market.installed` | 已安装 |
| `market.installedTitle` | 已安装到 {path} |
| `market.retryInstall` | 重试 |
| `market.detailBack` | 返回市场 |
| `market.detailLoading` | 正在读取详情… |
| `market.detailError` | 读不到这个技能的详情 |
| `market.detailOverview` | 概览 |
| `market.detailFiles` | 文件 |
| `market.detailNoOverview` | 这个技能没有单独的说明 |
| `market.detailFilesEmpty` | 这个技能的包里没有可列出的文件 |
| `market.factSource` | 来源 |
| `market.factAuthor` | 作者 |
| `market.factVersion` | 版本 |
| `market.factDownloads` | 下载量 |
| `market.factCategory` | 分类 |
| `market.factInstallTo` | 安装到 |
| `market.factUnknown` | 未知 |
| `market.confirmTitle` | 安装 {name} |
| `market.confirmTrust` | 技能来自第三方，安装前请确认可信。装好后在新建的会话里生效，当前会话仍用它已加载的技能清单。 |
| `market.confirmCancel` | 取消 |
| `market.confirmInstall` | 安装 |
| `market.installStarted` | 正在安装 {name} |
| `market.installOk` | 已安装 {name} · 新会话生效 |
| `market.installOkHint` | 安装到 {path} |
| `market.nameInvalidNote` | 这个技能的包声明了不合规的名字，不能安装 |
| `row.enable` | 启用 {name} |
| `row.disable` | 停用 {name} |
| `row.applying` | 正在应用 {name} 的更改 |
| `row.symlinkReadonly` | 软链·只读 |
| `row.symlinkTitle` | 这是一个软链（指向 {path}），本面板不会修改它 |
| `add.label` | 添加技能 |
| `add.comingSoon` | 即将支持 |
| `error.E_NOT_FOUND` | 这个技能已不存在，请刷新 |
| `error.E_BAD_NAME` | 技能名不合规范，未做任何修改 |
| `error.E_BAD_PATH` | 技能文件路径不合规范，未做任何修改 |
| `error.E_STALE_PATH` | 技能文件位置已变化，请刷新后重试 |
| `error.E_SYMLINK_READONLY` | 软链技能只读，未做任何修改 |
| `error.E_FILE_CHANGED` | 技能文件在你操作期间被修改，请刷新后重试 |
| `error.E_NOT_WRITABLE` | 这个技能没有可写的本地文件 |
| `error.E_WRITE_FAILED` | 写入技能文件失败：{reason} |
| `error.E_VERIFY_FAILED` | 写入后回读不一致，已回滚 |
| `error.E_FORBIDDEN` | 请求被拒绝（仅限本机访问） |
| `error.E_UNKNOWN` | 操作失败：{reason} |
| `error.E_SOURCE_UNKNOWN` | 不认识这个来源 |
| `error.E_SOURCE_UNAVAILABLE` | {source} 暂时连不上 |
| `error.E_SOURCE_TIMEOUT` | {source} 响应超时 |
| `error.E_SOURCE_BAD_RESPONSE` | {source} 返回了无法识别的数据 |
| `error.E_BAD_QUERY` | 请求参数不合规 |
| `error.E_SKILL_NAME_INVALID` | 这个技能的包声明了不合规的名字：{name} |
| `error.E_ALREADY_INSTALLED` | 本机已有同名技能：{path} |
| `error.E_PACKAGE_INVALID` | 这个技能的包不完整或校验不通过 |
| `error.E_DOWNLOAD_FAILED` | 下载技能包失败：{reason} |
| `error.E_INSTALL_IO` | 写入技能目录失败：{reason} |
| `error.E_INSTALL_BUSY` | 这个技能正在安装，请稍候 |

---

## 8.4 时间与其他

- 日志与 `health` 里的时间一律 **ISO 8601 UTC**（`new Date().toISOString()`）；**界面上不显示任何时间**（首版无版本检查、无「上次刷新」）。
- 市场条目的 `updatedAt` **只用于排序**：卡片与详情都不显示任何时间（不写「3 天前」、不写日期）；市场列表的 `total` 也不上屏。
- 布尔：YAML 侧接受 `true/false/yes/no/on/off/1/0`（大小写不敏感，宿主同文法，`EX/dsh-skill-filesystem/README.md`「Skill format」）；**写回只用 `true`/`false`**。
- 数字：`counts` 全部是整数，缺失按 0（不做 `undefined` 透出）。
- 日志：`ctx.logger.warn(error)` 记录，**不把路径之外的敏感内容打进日志**。

---

## 8.5 样式字面量单点

尺寸与颜色字面量只允许出现在 `src/client/styles.js`（样式）与 `src/client/avatar.js`（12 组头像色板，全仓库仅此两处色值）；其它组件文件不得写颜色/尺寸（`size={11|13}` 这类图标尺寸除外）。
市场样式同样只进 `styles.js`（类名 `skc_market*`，取值逐条来自 `docs/contracts/market.md` 附录 F）；**市场不新增任何颜色字面量**，也不改 `.skc_cardIcon` 的任何一条声明。
锚点：`test/styles.test.mjs`；把刻度搬进组件时那条用例先红。

---

---

## 验收

K22–K27：`test/view-row.test.mjs`、`test/view-page.test.mjs`、`test/view-skeleton.test.mjs`、`test/view-toast.test.mjs`、`test/state.test.mjs`、`test/header-scroll.test.mjs`、`test/i18n.test.mjs`；`npm run check:i18n` 兜住「代码里不许有中文」。
K28–K51（市场）：见 `docs/contracts/acceptance.md` 的附录 D.5。
