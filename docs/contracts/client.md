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
颜色不是样式表常量，而是 `avatar.js` 的 6 组色板（对齐 skillhub.cn 的 accent 10% 底 + 实色字，字母对比度约 2–3:1 是刻意取舍）经 `row.jsx`
以 `--skc-avatar-bg` / `--skc-avatar-ink` 行内传入（刻度见 `docs/contracts/visual.md` A.5）；
`background-clip: padding-box` 保证粉彩底不盖住半透明描边。骨架复用同一个类，由 `.skc_skeletonIcon`
自己再写灰色底，加载态不出现彩色块、也不出现字母。

---

## 3.9 市场页组件与状态

「技能市场」是同一个全局页的第二个页签：仍是 `main` 槽里的 `SkillsPage`，**不新增座位、不新增 `ctx.*` 服务**（`inject` 仍是 `['slots','locale']`）；安装成功的提示复用既有 `shell.overlay`。样式与取值来源见 `docs/contracts/market.md` 附录 F。

### 3.9.1 状态机

`PageState.market` 与 `tab` 一样放在模块级 store 里，因此**离开市场页签再回来，已加载的页、筛选、排序、详情状态与滚动位置都还在**（页签离开不销毁任何东西）。

```text
market = {
  boot: 'idle'|'loading'|'ready',                 // bootstrap；失败也进 ready，不是 error
  sources / categories / categoriesOk,            // 失败时 sources 回落内置双源、categoriesOk=false
  total / countsOk,                               // 分类 chip 的数量：'全部' 用 total，各分类用 categories[].count
  filters: {source, category, sort},              // source 是 **scope**：'all'（默认）|'skillhub'|'clawhub'；sort 四值
  bootScope / categoriesLoading,                  // 这份 categories+counts 属于哪个 scope；切 scope 只补一次 bootstrap（卡片与 chips 都不动，旧数字就地换新）
  keyword / input,                                // 已提交关键词 / 输入框现值（防抖在组件里，store 不持定时器）
  items / pages,                                  // 已合并去重后的列表、已加载页数（返回详情后要恢复）
  cursors / exhausted,                            // 每源自己的不透明游标与「已耗尽」
  page: {status, code, message},                  // idle | loading | more | done | error（尾部）；loading 同时表示「重取第一页」与「追加下一页」，用 pages 区分
  listStatus: 'idle'|'loading'|'ready'|'error',   // 整页态
  detail: null | {id, item, status, data, code},  // 内嵌详情三态
  installed / installedReady,                     // 安装台账 × item.id；只读一次
  installs: {[id]: {state, reason?, path?, version?, seq?}},   // 确认/安装中/已安装/失败
  icons / iconsTried,                             // 图标缓存 {[key]: url} 与「本会话已问过」{[key]: true}；两个消费者共用（市场条目 + 已装行的 upstream）
  names,                                          // 上游标题缓存 {[key]: title}；与 icons 同键空间、同生命周期
  favorites / favoritesOk,                        // 本地收藏 {[id]:true} 与可用性；**U5 起没有 UI 入口**，只为 M8 与 bootstrap 对齐而留（写侧已撤）
  installedDirty,                                 // 已安装页签标脏
  scrollTop,                                      // 进详情前记下，返回时恢复
}
```

转移（触发 → 结果）：

| 触发 | 结果 | 副作用 |
| --- | --- | --- |
| 首次进入市场页签 | `boot=loading`，并发发 `bootstrap` + `installed` + 第一页（默认 scope「所有来源」） | 骨架（分类条也是占位） |
| `bootstrap` 成功 | `boot=ready` | 填 `sources/categories`；`categoriesOk=false` 时分类行换成一句说明 |
| `bootstrap` 失败 | `boot=ready`（**不是 error**） | `sources` 回落内置三 scope，列表照打，分类行换成一句说明 |
| 关键词变化 | 250ms 防抖后提交；**IME 组字期间先攒着，组字结束才提交**（否则中文用户会被半成品过滤） | 请求中**保留旧 items**（`aria-busy`），不换骨架；工具栏不动；尾部也不插占位卡（`pages` 已归零，那是首屏重取不是追加）；**提交那一刻 `scrollTop` 写 0**（见下条落点） |
| 页头「刷新」（市场页签） | `marketReload`：清 `pages/cursors/exhausted`、关详情；**`items` 与 `icons`/`iconsTried`/`names` 都保留** | 重取期间旧列表直出（`aria-busy`），不换骨架、不滚回顶部、头像不回退成字母；`pages=0` 让尾部也不插占位卡 |
| 回车（非组字）/ 点 × / 清空输入 | 立刻提交，不经防抖（× 与回车都取消在飞的防抖） | × 在**框内**（`.skc_marketSearchField` 里绝对定位），同时清 `input` 与 `keyword` 并把焦点送回输入框；不动 scope 与分类 |
| 切 scope / 分类 / 排序 | 清 `pages/cursors/exhausted`、关详情；**`items` 保留**（旧卡直出，`clearedPaging` 按「有 items 就 ready」给 `listStatus`）；`bootScope !== filters.source` 时补一次 `bootstrap?source=`（带 token 守卫，旧响应不覆盖新数字） | 值没变时不重拉；重取期间不换骨架，答案落地时整表替换（`loadFirst` 不带 `existing`，旧卡不会串进新查询）；切 scope 时 chips 行留着旧数字就地换新，**只有还没有 chips 行时才画 chips 骨架**；落点见下一条 |
| 落点：`source`/`category`/`sort`/`keyword` 任一真的变化 | —— | 面板的 paint effect（`useLayoutEffect`；字符串渲染时降级成 `useEffect`）瞬时把**面板自己那个滚动容器**的 `scrollTop` 写 **0**，不做平滑滚动、不等浏览器夹取：跳变是那一帧的初始状态，不是动画。三条筛选与搜索的落点因此由我们决定、与答案长短无关（真机四条路径都落在 0，且换表那一帧 `scrollTop` 就已经是 0）。刷新**不在**这条里（U13：保留原位置）；翻页、加载态、详情往返也不在（键没变）。落地后首卡在吸顶页头之下 150px，不会被压住 |
| 关掉来源 / 排序菜单 | —— | 选的是**同一个值**时滚动位置不变。宿主的 `Menu` 关闭时把焦点还给锚点，焦点落在吸顶栏上会让 `.skc_pageBody` 滚回 0（实测 300 → 0，关闭后约 12 ms）；`.skc_marketFilters` 在关闭后把这个 0 写回原偏移（见 `decisions.md` 附录 P-3）。选的是**不同的值**时补偿自动解除，落点交给上一条的 paint effect（顶） |
| 一页返回 | `listStatus=ready`，`page` 进 `more` 或 `done` | 列表 = 已有项 + 这一页按序拼接（`mergeBatches` 仍接受多源数组，但市场一次只看一个源，只喂一项）；不跨源重排 |
| 请求失败 | `listStatus=error` | 整页错误态 + 重试；**不出空态**（空 ≠ 失败）。单源没有「部分源失败」这种中间态 |
| 追加返回 | `page` 进 `more` 或 `done` | 当前源 `cursor !== null` 才追加；`items` 追加去重，不重排已有项 |
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
├─ toolbar：刷新（恒在，行为跟随当前页签；详情打开时 = 关详情 + 重拉）｜计数 + ＋添加技能（仅「已安装」页签渲染）
├─ tabPanel(installed) → InstalledDetail (installed-detail.jsx)：面包屑 + 头 + 身份行 + 徽章 + 事实表 + 来源 + 正文 + 文件
└─ tabPanel(market) → MarketPanel (market-panel.jsx)
    ├─ MarketFilters (market-filters.jsx)：Input(250ms 防抖，× 在框内) / Menu(来源 = 所有来源｜SkillHub｜ClawHub) / Menu(排序) —— **工具栏恒三个子元素** / Pill(分类 chips + 数量)
    ├─ 首屏骨架｜整页错误态（当前源失败）｜空态
    ├─ ul.skc_marketGrid → MarketCard (market-card.jsx) × N（**头部 = 48 头像 + 标题行（标题 + 来源图）/ 作者行 + 安装位**；正文 = 描述 3 行 / 标签 chips / 三段 `评分·下载·收藏`；动作位只有安装；**追加下一页时**尾部 3 张骨架；头像位是 MarketIcon → tileElement）
    ├─ ul 之后：加载更多一行（`skc_marketLoadMore` = 圆点 + `market.loadingMore`，**视觉件 `aria-hidden`**，只在「已有卡片 + 正在追加」时出现；播报仍由上面那条 sr-only `role="status"` 负责）
    ├─ MarketDetail (market-detail.jsx)：面包屑 + 头 + 事实表 + 概览 + 文件
    └─ MarketConfirm (market-confirm.jsx)：Modal（width:min(480px,100vw - 32px)）
MarketSkeleton / MarketTailSkeleton (market-skeleton.jsx)
icon-tile.jsx：IconTile / tileElement / useIconState（市场三处 + 已安装行共用的视觉单元）
markdown.jsx：MarkdownBoundary / MarkdownBlock（市场详情与已安装详情共用同一段正文渲染与同一条兜底）
```

八条结构约束：

1. **整卡可点只有一个手段**：标题按钮 `.skc_marketCardOpen::after{inset:0}` 铺满整卡，**唯一的动作位**用显式层级浮在上面——安装位 `.skc_marketCardEnd{z-index:1}`（U5 起坐在头部右侧）；卡片里只有这一个动作位，其余区域（含**标签行**与三段数字）都落在点击层上、点的都是「进详情」。不做 `<a href>`、不加第二个可点区域、不用 JS 拦冒泡代替层级。**「已安装」的行用同一条手段**（U1 起）：标题按钮 `.skc_cardOpen::after{inset:0}` 铺满整行、开关位 `.skc_cardEnd{z-index:1}` 浮起，软链行的 `roTag` 不浮起、不可点；两处都不许出现「看着能点、点了没反应」。
2. **两种详情替换范围不同，是刻意的**：市场详情就地替换网格（页头保留）；**已安装详情替换整页页头 + 列表**（标题/介绍/计数/刷新/添加技能/页签全部不可见，详情从面包屑开始，顶端只留一条拖窗口的空条），与宿主的插件详情同构。两者返回都不重拉任何东西。
3. 详情正文用宿主 primitives 的 `MarkdownText` 渲染（与对话里的第三方 markdown 同一个渲染器，不自造 sanitizer）；渲染抛错或正文为空时回落纯文本 + `market.detailNoOverview`。
4. 组件只读 props（`store/api/t`）写 `store.actions`，不直接 `fetch`；只有滚动位置恢复与触底预取读 DOM，且都在 `useEffect` 里（字符串渲染不触发）。
5. **一次只问一个 scope**：来源菜单是 `所有来源`（默认）/`SkillHub`/`ClawHub` 三项——`all` 上游就是一次不带 `source` 的请求，所以仍不存在「两源同屏」「部分源失败提示条」，当前 scope 失败即整页错误态（可重试）。分类行三个 scope 都渲染（同一张 12 类表，计数按 scope 各算），menu 选项与计数来自 `bootScope` 那一份；`all` 下不判「这个来源暂时没有技能」。
6. **分类 chip 带数量**：`全部` 用 `bootstrap.total`，各分类用 `categories[].count`；`count` 为 `null` 时数字位整段不渲染（不写 0、不写破折号），`countsOk:false` 时所有数字位都不出现。格式是 `Intl.NumberFormat(undefined, {notation:'compact'})`（运行时默认语言，`try/catch` 兜底成原数字），样式见 §8.5。
7. **头像只有两态**（卡片、详情头、确认弹窗共用一个 `MarketIcon`）：**瓦片任何时候都不空**——URL 有值但还没 `onload` 时画字母 + 一张 `display:none` + `loading="eager"` 的探测图（同 `src`/同 `referrerPolicy`），图片只在 `onload` 之后才换成可见的 `<img class="skc_marketIconImg">`；探测图与可见图同一个 URL，浏览器只发一次请求（实测 `display:none` 的 eager 图会加载并触发 `onload`，`loading="lazy"` 的不会）。取值顺序 **`item.iconUrl` → `market.icons[marketKeyOf(item)]` → `null`**（`iconUrlOf()`，纯函数），拿到非空字符串就画图（`<img>` + `skc_marketIconImg`、`alt=""`、`loading="lazy"`、`referrerPolicy="no-referrer"`），否则画首字母；**图片 `onError` 也回落首字母**，任何情况下都不留空白方块。ClawHub 的图标是**后到的**：列表先给 `iconUrl:null`，页面渲染完成后由 `market/icons` 批量补齐，所以同一张卡会先字母、后换图。
8. **图标补齐不阻塞渲染**：`market/list` 回来后先画卡片，再由面板 effect 把「ClawHub + 无图标 + 本会话没问过」的条目打包（≤24）调 `market/icons`；**同一 id 只问一次**（`iconsTried` 同时记正负结果），请求失败静默保持字母；切来源 / 搜索 / 页头刷新都**不清**已拿到的图标（缓存按身份键，重问同一个身份不会得到不同答案；清掉只会让卡片先回退成字母再换图，还会多打一轮 `market/icons`）。图片是 `.skc_cardIcon` 的 flex 子项、只填满内容盒，所以宿主那条 `.5px` 描边始终压在图片之上；头像盒既有声明（48×48 / `border .5px` / `radius-lg` / `background-clip: padding-box` / 粉彩底）一字不改。

### 3.9.3 store action（`src/client/state.js`）

| action | 入参 | 做什么 |
| --- | --- | --- |
| `marketBootLoading()` | —— | `boot='loading'` |
| `marketBootReady({sources,categories,categoriesOk,total,countsOk})` | bootstrap data | 填这几件（`total`/`countsOk` 供 chip 数量位） |
| `marketBootFallback(sources)` | 描述符数组 | `boot='ready'`、`categoriesOk=false`、`countsOk=false`（失败不是错误态） |
| `marketSetInput(text)` | string | 只改 `input` |
| `marketCommitKeyword(text)` | string | `keyword=input=text`，清分页；**保留 items** |
| `marketSetFilter({source?,category?,sort?})` | 部分 filters | 合并 + 清分页 + 关详情；**`items` 保留**（重取期间卡片留在屏上，`clearedPaging` 给出 `listStatus`）；切 scope 时 `categoriesLoading=true`；值没变就什么都不做 |
| `marketReload()` | —— | 页头「刷新」在市场页签的行为：清已加载页，由面板 effect 重拉第一页；**只清分页与详情**（`items` 与图标/标题缓存保留，`clearedPaging` 按「有 items 就 ready」给出 `listStatus`） |
| `marketListLoading()` / `marketListFailed({code,message})` | —— / 错误 | 整页态 |
| `marketPageStart()` | —— | `page.status='loading'`（追加用，不清 items） |
| `marketPageAppended({pages,merged})` | `pages:[{sourceId,page,items}]`、合并结果 | 写该源 cursor/exhausted、`items=merged`、`pages+1`、尾部进 `more` 或 `done` |
| `marketPageFailed({code,message})` | 错误 | `page.status='error'`，items 不动 |
| `marketInstalledLoaded(map)` | `{[id]:{name,version,path,exists}}` | 填 `installed` + `installedReady=true` |
| `marketDetailOpen(item)` | MarketItem | `detail={id,item,status:'loading'}` |
| `marketDetailReady(data)` / `marketDetailFailed({code,message})` / `marketDetailClose()` | MarketDetail / 错误 / —— | 详情三态与关闭 |
| `marketInstallConfirm(id)` / `marketInstallCancel(id)` | id | 确认弹窗开关（**不发请求**） |
| `marketInstallStart(id)` | id | `state='installing'`（幂等） |
| `marketInstallOk(id,{name,path,version})` | —— | `installed` + `installed[id]` + `installedDirty` + 推 `notice{kind:'install-ok', name, path, seq}` |
| `marketInstallFail(id, reason)` | 本地化原因 | `state='failed'` + `reason` |
| `marketNamesSeeded(names)` | `{[id]: title}` | 只合并进 `names`（空值忽略、已有键不覆盖），**不写 `iconsTried`**：列表里的 `displayName` 是已知答案 |
| `marketNamesReady(names)` | `{[id]: title\|null}` | 批量端点回填：非空才写（覆盖同名种子），`null` 忽略——名字缺失不影响图标 |
| `marketIconsSeeded(icons)` | `{[id]: url}` | 只合并进 `icons`（已有键不覆盖），**不写 `iconsTried`**：列表内联的图标是已知答案，不是一次上游提问 |
| `marketIconsReady(icons)` | `{[id]: url|null}` | 合并进 `icons`（非空才存），每个 id 记进 `iconsTried`（**null 也记**，负结果同样只问一次） |
| `marketIconsAttempted(ids)` | `string[]` | 批次整体失败：只记 `iconsTried`、不写 `icons`，静默保持字母 |
| `marketFavoritesLoaded(list,ok)` | 数组 + 布尔 | 只在 `bootstrap` 写一次：数组转 `{[id]:true}`，`ok` 进 `favoritesOk`；**U5 起是纯读侧**（写侧三个 action 已撤，见 `docs/contracts/decisions.md` 附录 L） |
| `marketSetScroll(top)` / `marketClearInstalledDirty()` | number / —— | 记滚动位置 / 清脏 |

`notice` 复用既有字段：`refresh-failed` 与 `install-ok`（副行给安装路径），由 `toast.jsx` 按 `kind` 选文案，5 秒后 `dismissNotice(seq)`；U5 起没有第三种 `kind`（收藏写侧已撤，见 `docs/contracts/decisions.md` 附录 L）。

`marketPageAppended` 的入参仍是**数组**（设计文档写的是单源形状）：现在是「一源一项」，留着数组是为了将来真要同屏多源时不必改签名；语义（写游标、合并、翻页计数）不变。

### 3.9.4 api 方法（`src/client/api.js`）

| 方法 | 路由 | 备注 |
| --- | --- | --- |
| `marketBootstrap()` | `GET market/bootstrap` | 分类失败不报错：`categoriesOk:false` |
| `marketList({source,sort,category,keyword,cursor,limit})` | `GET market/list` | **一源一次请求**；空值不入参（不传 cursor 才是第一页） |
| `marketDetail({source,owner,slug,version})` | `GET market/detail` | —— |
| `marketInstalled()` | `GET market/installed` | 形状 `{items, readable}` |
| `marketInstall({source,owner,slug,version})` | `POST market/install` | body 只有身份，**没有 path/files** |
| `marketIcons({items})` | `POST market/icons` | `items` 是 **`{source,owner,slug}`** 数组（每源 ≤12、合计 **≤24**，一批可混两源）；出参 `{icons:{[key]: url|null}}`；失败静默 |

全部走既有 `request()`：文档相对 URL + 信封解包 + `ApiError{code, message, data}`（`data` 是信封里的 `data`，安装失败时用来取冲突路径与声明名）。安装永不自动重试。

### 3.9.5 详情就地替换网格的返回契约

「返回市场」必须逐项恢复，且**不重拉**：`items` 与 `pages` 不动、`filters` 与 `keyword` 不动、`scrollTop` 写回滚动容器、`detail` 置 `null`。列表顺序同样不动——顺序就是各源各自的分页顺序，客户端不二次排序（见 §8.4）。这是结构保证（状态在 store 里），不是补丁：面板卸载/重挂都不影响。

市场用例（K28–K51）与 PRD 的 A1–A17 对照见 `docs/contracts/acceptance.md` 的附录 D.5（由 QA 落地）。

### 3.9.6 已安装行的图标解析

已安装行与市场卡片共用 `market.icons`（键都是 `source:owner:slug`）。切到已安装页签时**分两种情况**，别写成笼统的「立刻」：

| 情况 | 表现 | 为什么 |
| --- | --- | --- |
| `market.icons[key]` **已有值** | **零请求**换成市场那张图 | ClawHub 条目本来就先进这个缓存；SkillHub 条目的内联 `iconUrl` 由 `iconSeeds()` 在列表到达时**播种**进来（不写 `iconsTried`，因为那是「问过上游」的账，种子是已知答案）。所以「从市场装 `dev-god` → 切已安装」是 0 次请求 |
| `market.icons[key]` **没有值** | 先字母瓦片，**一个批次后**换图 | 该行属于「有身份但本会话没问过」，由 `iconBatch` 收进下一批；混源批次可能被较慢的源拖到数秒（实测首个图标 7.5s，见下） |

| 事项 | 口径 |
| --- | --- |
| 循环在哪 | `page.jsx`（面板打开期间恒挂载），**不在** `market-panel.jsx`：两个 tabpanel 互斥挂载且已安装是默认页签，循环留在市场面板里就跑不到已安装 |
| 先播种 | `iconSeeds(market)`：列表里 `iconUrl` 非空、且 `icons` 还没有该键的条目 → `marketIconsSeeded()`（**不碰 `iconsTried`**）。effect 里播种后直接 `return`，写缓存会再触发一轮 effect，那一轮才走网络——幂等，不会死循环 |
| 选谁 | `iconBatch(payload, market)`：市场半边 = `iconCandidates()`（ClawHub / 无图 / 没问过）；已安装半边 = `row.upstream !== null` + `icons` 为空 + `iconsTried` 未命中 + `sourceId ∈ MARKET_SOURCE_IDS`；**`owner`/`slug` 必须是非空字符串（坏三元组跳过，不让整批 400）**；每源 ≤12、总 ≤24、按 key 去重（市场条目先） |
| 身份 | `Row.upstream = {sourceId, owner, slug} \| null`（Host 从 `_meta.json` 带出）；`null` ⇒ 该行永远是字母瓦片，不按名字猜 |
| 视觉单元 | `icon-tile.jsx`：`tileElement()`（无 hook，返回瓦片元素）+ `useIconState()`（按 URL 记 loaded/failed，未 loaded 时返回探测图 URL）；`IconTile` 是组件形态，`MarketIcon` 解析 URL 后调同一对函数。`.skc_cardIcon` 与 `.skc_marketIconImg` 声明零改动 |
| 失败 | 单条 → `null`；整批失败 → `marketIconsAttempted` 记 tried，不重试、不弹 toast、不写行内原因 |
| 标题优先级 | `rowTitleOf(row, market)`：`names[marketKeyOf(row.upstream)]` → `row.displayName`（本地 `metadata.displayName`）→ `row.name`。**kebab 名退到 tooltip**（`title` 属性仍是 `row.name`），因为它是模型调用技能时用的那个字符串，换了可见标题后仍要随手可查 |
| 失效 | 切页签不动 · 已安装页签刷新不动 · `marketReload()` 清空（`icons`/`iconsTried`/`names` 一起，一次性、下一批自愈）· 安装成功后不动（新技能与市场条目同键）· 新会话清空（不落盘） |

收藏的持久化在 `docs/contracts/market.md` §7.7；本页只负责「画对不对」：卡片上的「收藏 N」是上游 `saves`，与本地书签不同源、不互相修正（U5 起卡片上没有书签控件，集合与写路由仍在）。

---

## 3.10 已安装详情页
组件树、`detail` 三态、返回与失败口径、25 个文案键见 `docs/contracts/installed-detail.md`（本节只留指针：§3.9 已到 400 行档位）。

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
- 市场面沿用两族键：`market.*`（61 个 → **65 个**）与 `error.E_*`（11 个 → **13 个**）；已安装详情页再加 25 个 `detail.*`（键表见 `docs/contracts/installed-detail.md` 的「文案」一节），外加 6 个 `markdown.*`（宿主 `MarkdownText` 的代码围栏与脚注 chrome，缺了它就整段回落成纯文本），全字典 111 → 117 → 136 → 142 → 144 → 156 → **148**；**`market.placeholder` 已删除**（市场页签不再是占位文案）。下表有几行把同族的新键合并成一行，这是为了守住 400 行上限（`check-docs` 的 R11），键与值逐条列出、语义不变。
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
| `market.sourceLabel` | 来源 |
| `market.source.all` | 所有来源 |
| `market.source.skillhub` | SkillHub |
| `market.source.clawhub` | ClawHub |
| `market.sortLabel` | 排序 |
| `market.sort.recommended` | 默认排序 |
| `market.sort.updated` | 最近更新 |
| `market.sort.downloads` | 下载量 |
| `market.sort.stars` | 收藏量 |
| `market.categoriesLabel` | 分类 |
| `market.category.all` | 全部 |
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
| `market.categoriesUnavailable` | 暂时读不到分类 |
| `market.cardOpen` | 查看 {name} 详情 |
| `market.metaAuthor` | @{author} |
| `market.metaVersion` | v{version} |
| `market.metaDownloads` | 下载 {count} |
| `market.metaSaves` / `market.metaRating` / `market.metaRatingHint` | 收藏 {count} ／ 评分 {rating} ／ 上游评分的折算（4.0–5.0），不是用户评分均值 |
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
| `row.enable` / `row.disable` | 启用 {name} ／ 停用 {name} |
| `row.applying` | 正在应用 {name} 的更改 |
| `row.symlinkReadonly` | 软链·只读 |
| `row.symlinkTitle` | 这是一个软链（指向 {path}），本面板不会修改它 |
| `add.label` / `add.comingSoon` | 添加技能 ／ 即将支持 |
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
| `error.E_FAVORITE_FULL` / `error.E_FAVORITE_IO` | 收藏数量已达上限，请先取消一些 ／ 写入收藏失败：{reason} |

---

## 8.4 时间与其他

- 日志与 `health` 里的时间一律 **ISO 8601 UTC**（`new Date().toISOString()`）；**界面上不显示任何时间**（首版无版本检查、无「上次刷新」）。
- 市场条目的 `updatedAt` **客户端不读**：三种排序都由路由按 `sort` 在各源内完成，浏览器侧不二次排序；卡片与详情都不显示任何时间（不写「3 天前」、不写日期）；市场列表的 `total` 也不上屏。
- 布尔：YAML 侧接受 `true/false/yes/no/on/off/1/0`（大小写不敏感，宿主同文法，`EX/dsh-skill-filesystem/README.md`「Skill format」）；**写回只用 `true`/`false`**。
- 数字：`counts` 全部是整数，缺失按 0（不做 `undefined` 透出）。
- 日志：`ctx.logger.warn(error)` 记录，**不把路径之外的敏感内容打进日志**。

---

## 8.5 样式字面量单点

尺寸与颜色字面量只允许出现在 `src/client/styles.js`（样式）与 `src/client/avatar.js`（6 组头像色板，含 `rgba()` 半透明底与实色字；全仓库仅此两处色值）；其它组件文件不得写颜色/尺寸（`size={11|13}` 这类图标尺寸除外）。
市场样式同样只进 `styles.js`（类名 `skc_market*`，取值逐条来自 `docs/contracts/market.md` 附录 F）；**市场不新增任何颜色字面量**，也不改 `.skc_cardIcon` 的任何一条声明。上游图标用的 `.skc_marketIconImg` 只有四条声明（`width/height:100%`、`object-fit:contain`、`display:block`、`border-radius:calc(var(--dsw-radius-lg) - .5px)` 同心内圆角），不含色值；`contain` 是因为上游图标尺寸从 256×64 的横版 logo 到 1024×1024 都有，`cover` 会把横版裁成怪形状。
分类 chip 的数量位用 `.skc_marketChipCount`（`margin-left:4px`、12px/18px、`var(--dsw-alias-label-secondary)`），**不改 chip 的高度与点击面积**，也不新增色值。
锚点：`test/styles.test.mjs`；把刻度搬进组件时那条用例先红。

---

## 验收

K22–K27：`test/view-row.test.mjs`、`test/view-page.test.mjs`、`test/view-skeleton.test.mjs`、`test/view-toast.test.mjs`、`test/state.test.mjs`、`test/header-scroll.test.mjs`、`test/i18n.test.mjs`；`npm run check:i18n` 兜住「代码里不许有中文」。
K28–K51（市场）：见 `docs/contracts/acceptance.md` 的附录 D.5。
