# Test Report — dsh-skill-center（第 3 轮：真机事故复盘与守卫升级 · 最终）

任务板：`task-4`（QA：dsh-skill-center 测试与路由判定）
被测代码：`lib/` 11 个模块 + `index.js` + `src/client/` 10 个模块 + `client.js`（构建产物入库）
测试真源：`docs/system_design.md` §3.2/§3.3/§8.1 + 附录 D、`docs/PRD.md` §3.1.3/§3.5、`AGENTS.md` 硬约束
执行环境：node v26.13.0 / macOS（APFS）/ 仓库根 `/Users/zhutongqing/Documents/Agents/Plugins/dsh-skill-center`
轮次：第 1 轮（QA → Engineer，3 处缺陷）→ 修复 → 第 2 轮回归（NoOne）→ **真机两次事故 → 本轮（第 3 轮）复核守卫是否真的有效**

---

## Summary

| 项 | 第 1 轮 | 第 2 轮 | **第 3 轮（本轮，最终）** |
| --- | --- | --- | --- |
| Total Tests | 239 | 257 | **279** |
| Passed / Failed / Skipped | 239 / 0 / 0 | 257 / 0 / 0 | **279 / 0 / 0** |
| 测试文件 | 24 | 24 | **26**（新增 `test/inject-contract.test.mjs`、`test/bundle-contract.test.mjs`）+ 5 个 fixture 树 + 4 个 helper |
| 源文件覆盖 | 22 / 22 | 22 / 22 | **22 / 22** |
| 行 / 分支 / 函数覆盖率（node 内置） | 92.30 / 87.53 / 94.23 | 92.87 / 87.83 / 94.44 | **92.87 / 87.83 / 94.44**（JSX 与入口仍不进表：走 esbuild 临时 bundle） |
| `npm test`（= `node --test test/`） | exit 0 | exit 0 | **exit 0** |
| `npm run check` | exit 0 | exit 0 | **exit 0**（i18n 43 键 + `client.js` 51 826 B 与源码一致） |
| 真机事故 | —— | —— | **2 次（boot 失败 / 整页键名）→ 守卫已升级，两个事故各用变异复现并验证会红** |
| **Routing Decision** | Engineer | NoOne | **NoOne（守卫已验证有效，无新增源码缺陷）** |

> 本轮**不是重跑签字**：两次事故都是我的用例模型漏掉的（详见下一节的「原测试为什么漏」）。缺口在测试替身而不在产品逻辑，因此本轮的主要交付是**把替身改成与真机同款 + 新增静态守卫**，再用变异证明它们会红。

## 真机事故复盘与守卫升级（第 3 轮）

### 事故 1：整页 boot 失败 —— client 半部漏了 `export const inject`

**现场**：`cannot get property "locale" without inject` → `web boot: 1 entry did not activate / dsh-skill-center: failed`；DSH 自愈把该 entry 写进 profile 打成 `disabled: true`。影响面是**整个 web boot**，不是单个面板。

**根因**：cordis 按 fiber 的 `inject` 声明解析服务，`ctx.locale` / `ctx.slots` 都必须在 `inject` 里声明；`effect` 是核心能力、不能写进去。

**我的用例为什么没抓到（三层原因，按重要性）**：

1. **测试替身比真机宽松**：`client-entry.test.mjs` 原来的 `fakeContext()` 是普通对象，读任何属性都有值 → cordis 的 inject 围栏在测试里根本不存在，`apply(ctx)` 永远不抛。
2. **只测源码、没测交付物**：用例 import 的是 `src/client/index.jsx` 的 esbuild 源码 bundle，**没有一条用例执行真正上机的 `client.js`**；而「entry 有没有导出 cordis 需要的东西」正是产物级的契约。
3. **没有任何用例断言「入口导出了什么」**：`inject` 这个导出当时不在任何断言面里，删掉它测试全绿。

### 事故 2：整页文案变成原始键名 —— 字典是嵌套对象，`ctx.locale` 是字面量取键

**现场**：页面显示 `page.title` / `group.builtin` / `panel.label`。

**根因**：宿主 `locale` 的解析是**字面量属性查找**（本次从 app 包 `@deepseek-ai/dsh-client-locale/lib/client.js` 里读到的真实实现）：

```js
translate(ns, key, params) {
  const template = this.lookup(ns, key, chain)
    ?? (ns !== "common" ? this.lookup("common", key, chain) : undefined)
    ?? key;
  ...
}
lookup(ns, key, chain) {
  const locales = this.dicts.get(ns);
  for (const locale of chain) {
    const value = locales?.get(localeKey(locale))?.[key];   // 字面量取键
    if (value !== undefined) return value;
  }
}
```

**我的用例为什么没抓到**：`test/helpers/ssr.mjs` 的 `translator()` 自己实现了**点号路径遍历**（`path.split('.').reduce(...)`），比真机宽松一个数量级 —— 嵌套字典在测试里被正确解析成中文，于是当时的 45 条视图/入口结构断言**全部**在不真实的宽松模型上通过（现在这批断言已扩到 50 条）。同时没有任何用例断言字典的**形状**（只比了键集合，而键集合是 flatten 出来的）。

**共同教训（写进报告，避免下次复犯）**：**替身的语义必须从真机实现里抄，不能自己发明**。两次事故都发生在「我的替身比真机宽松」的维度上（服务解析、取键方式），而不是业务逻辑维度。凡是替身，只能比真机**更严格**，不能更宽松。

### 守卫升级清单（本轮最终形态）

| # | 守卫 | 位置 | 若没有它，事故会漏在哪 |
| --- | --- | --- | --- |
| **G1** | **严格 Proxy ctx**：`declared` 取自模块自己的 `inject`，读取未声明的服务抛 `cannot get property "X" without inject`；`effect` 放行 | `test/client-entry.test.mjs` 的 `strictContext()`，**全部 12 条 client-entry 用例都走它**（原来的宽松 `fakeContext()` 已删除） | 事故 1 |
| **G2** | **加载真实产物**：用 `vm` 造 `window.__ModuleLoader__`，执行提交进库的 `client.js`，再 `factory(require)` 注入 seed 模块 | `test/client-entry.test.mjs` 的 `loadCommittedBundle()` | 事故 1（源码对、产物旧/缺导出） |
| **G3** | **真机同款 `t()`**：字面量 `dictionary[key]`，取不到回落键名 | `test/helpers/ssr.mjs` 的 `translator()`；`view-*` / `model` / `client-entry` 全走它（重复的自造 `flatTranslate()` 已删除） | 事故 2 |
| **G4** | **静态 inject 契约**（新增文件）：先剥注释与字符串字面量，再扫 `ctx.<x>`，两个半部都要求「读到的都在 `inject` 里」且「声明的都被读到」；另断言产物里的 `inject` 与源码一致 | `test/inject-contract.test.mjs`（9 条） | 事故 1（且**不需要构建**就能报红） |
| **G5** | **字典文件形状守卫**：只允许顶层 `meta` 嵌套（且 `meta.title/description` 非空），其它键必须是「带点的扁平字符串」 | `scripts/check-i18n.mjs`（exit 1） | 事故 2 |
| **G6** | **i18n 形状/键名断言**：扁平形状、`t('…')` 字面量键两侧都存在、动态拼的键存在、`meta` 块保留 | `test/i18n.test.mjs`（13 条） | 事故 2 |
| **G7** | **运行时字典断言**：从真实 `client.js` 取注册的字典，断言值**全是字符串**、键集**正好等于 UI 键**（`meta` 被滤掉） | `test/client-entry.test.mjs` | 事故 2 + `meta` 泄漏 |
| **G8** | **首屏键名扫描**：渲染首屏 HTML，断言不出现 `a.b` 形状的未翻译键，并正向断言 7 条真实文案 | `test/client-entry.test.mjs` | 事故 2（即使个别键漏网也会被抓） |
| **G9** | **产物运行时契约**（新增文件）：`client.js` 只 `require` 平台 seed 白名单（从宿主产物里核对的 11 个带 scope 的 id）、`__ModuleLoader__.load` 形状与 id、`package.json` 的 `exports['./client']`/`dsh.client.platform`/patch、无 sourcemap、体积区间 | `test/bundle-contract.test.mjs`（5 条） | 与事故 1 同级的另一类 boot 失败：产物引了非 seed 模块 = 浏览器 `Cannot find module`，而 node 侧替身会替它兜住 |

### 变异验证（我自己做的，不看工程师的红绿记录）

做法：把包复制到 `/tmp`（链路 `node_modules`），逐个注入缺陷 → 跑 `npm test` → 记录红名单 → 丢弃副本；真实仓库全程只读。

| 变异 | 改了什么 | 是否重建 `client.js` | 结果 |
| --- | --- | --- | --- |
| **M1** | 删掉 `src/client/index.jsx` 的 `export const inject = ['slots','locale']` | 是 | **15 红** = `inject-contract` 4 条（G4：导出存在 / 静态扫描 / 正好是 slots+locale / 产物与源码一致）+ `client-entry` 11 条（其中 5 条走真实产物、6 条走源码 bundle，全部因 G1 抛 `cannot get property … without inject`） |
| **M2** | 把 `locale/{zh,en}.json` 改回嵌套对象（`{"panel":{"label":…}}`） | 是 | **37 红** + `check:i18n` **exit 1**（G5 报 `"panel" is nested` / `"panel" has no dot`）。分布：`view-page` 14、`i18n` 8、`client-entry` 5、`model` 4、`view-row` 4、`view-skeleton` 1、`view-toast` 1 —— 即**所有经过 `t()` 的文案断言**（G3 已是字面量语义，嵌套字典一律回落键名） |
| **M3** | `apply` 里不再过滤 `meta`（把原字典直接注册） | 是 | **1 红**：G7「字典只含字符串 / 键集正好是 UI 键」（精确命中） |
| **M4** | 新增真实读取 `ctx.theme.overrideTokens(...)` 但**不写进 `inject`** | **否**（故意不重建） | **7 红** = `inject-contract` 1 条（G4 静态扫描：`src/client/index.jsx reads ctx.theme`，**不构建就报红**）+ `client-entry` 6 条走源码 bundle 的用例（bundle 是测试时现打的，G1 直接抛） |
| **M5** | `inject` 里多声明一个从不读取的 `theme` | 否 | **2 红**：G4「inject 里没有多余声明」+「正好是 slots+locale」 |
| **M6** | 往 `client.js` 末尾追加 `require("clsx")`（模拟引了非 seed 模块的依赖） | —— | **6 红**：G9 的 seed 白名单直接报 `越界：clsx`（另有 5 条产物级用例因 vm 的 `require` 解析不到 `clsx` 而红） |

结论：**两次事故对应的变异分别红 15 条与 37 条，且红的位置正是守护它们的那几条**；`meta` 泄漏与「多/少声明」也各有精确断言。守卫确实有守门能力，不是摆设。

### 覆盖范围：严格替身是否覆盖到**全部**视图用例

- **视图/模型用例根本不创建 ctx**：`view-page 20`、`view-row 10`、`view-skeleton 4`、`view-toast 4`、`model 12`（合计 50 条）都是以显式 props 渲染（`{ store, api, t }`），走不到服务解析这一层。所以「老用例还用宽松 ctx」在这里不存在。
- **唯一需要 ctx 的是 `client-entry`（12 条）**，已全部走 `strictContext()`；宽松的 `fakeContext()` 已删除，且严格工厂现在**导出在 `test/helpers/ssr.mjs`**，新用例能拿到的只有严格版。
- **`t` 的来源也统一**：`translator()` / `zhTranslator()` 是唯一实现，`i18n.test.mjs` 自带的 `valueAt()` 已收紧为「字面量优先，只允许 `meta.*` 下钻」；`client-entry` 里重复自造的那份已删。
- **仍然只是「约定」的一处**：若将来有人在新测试文件里手搓一个 `{ locale: …, slots: … }` 普通对象，编译不会拦。缓解：`strictContext` 已是唯一现成选项 + 代码评审。我也评估过「静态扫描 test/** 禁止出现 `slots:` 字面量对象」，判定不加 —— 那是把测试当产品代码约束，误报高（payload/注册对象里到处有 `slots:` 这个名字），收益低。

### 我认为仍然缺失的守卫（结论：加了两条，一条故意不加）

- **加**：G4（静态 inject 契约，两个半部、双向）—— 这正是事故 1 缺的那一层，且**不依赖构建**。
- **加**：G9（产物运行时契约 + seed 白名单）—— 堵住与事故 1 同级的另一类 boot 失败（产物引了浏览器解析不到的模块），这类问题在 node 侧替身里会被兜住、只有真机会炸。
- **故意不加**：断言 `package.json` 的 `dsh.client.inject`（预取清单）与代码所需服务的映射关系。理由：`service → package` 是**约定**而非契约（`locale` ↔ `@deepseek-ai/dsh-client-locale` 是确定的，但 `slots` 由 shell/prelude 提供，未必是 `ui-layout`/`ui-sidebar` 那两个包），把它写成门禁等于把猜测固化成红绿信号；manifest 的形状校验已由宿主 `parseDshClient` 负责，`check-client` 也校验了 `exports["./client"]` 与 loader 形状。真出现「服务在但激活顺序不对」，该补的是**真机用例**，不是静态断言。

### `translator()` 与真机语义的一致性（逐点核对）

| 维度 | 宿主实现（app 包内） | `test/helpers/ssr.mjs` | 判定 |
| --- | --- | --- | --- |
| 取键方式 | `dict[key]` 字面量 | `dictionary[key]` | ✅ 一致（这条就是事故 2 的根因维度） |
| 取不到 | `?? key` 回落键名 | 非字符串/未命中 → 返回 `key` | ✅ 一致 |
| 插值 | `template.replace(/\{(\w+)\}/g, …)`，参数缺失保留占位符 | 同一正则，同一「缺失保留」 | ✅ 一致 |
| `common` 命名空间回落 | 命中不到时先查 `common` 再回落键名 | 不查 `common`，直接回落键名 | ⚠️ **我们更严格**（缺键在测试里一定暴露，而真机可能被 `common` 补上）。方向安全，记录在案 |
| 非字符串值（如误注册的 `meta` 对象） | 原样返回 → React 渲染/插值直接报错 | 视为未命中，返回键名 | ⚠️ **我们更宽松一点**；由 G7「值全是字符串」+ G8「首屏无键名」补上，两处都能独立抓住 |

结论：**核心语义（字面量取键 + 回落键名 + 插值）已与真机一致**，两处偏差都朝「不会让错误悄悄通过」的方向收敛，且各有兜底断言。

### `meta` 例外复核

- `check-i18n`（G5）：允许且**仅**允许顶层 `meta` 是对象，并强制 `meta.title` / `meta.description` 为非空字符串 —— 这正是宿主插件列表（`dictionariesOf` 读 `parsed.meta.title`）要的东西；其它任何嵌套一律 exit 1。
- 运行时（G7）：`uiDictionary()` 在 `register` 前滤掉 `meta` 与非字符串值；用例断言注册字典的键集**正好等于 UI 键**（`meta` 不在其中）、值**全是字符串**。
- 为什么**不**把 `meta` 拍平成 `"meta.title"`：宿主插件列表读的是 `parsed.meta.title` 这条嵌套路径，拍平会让插件列表里的名字掉回包名。已被 `AGENTS.md` 规则 12 与两条用例（G5/G6）双向钉住。

### 本轮我改的测试文件（都在 QA 自己的作用域内，未碰源码）

- `test/helpers/ssr.mjs`：`translator()` 改为字面量取键（事故 2 的根因修复）；**新增导出 `strictContext()`**，让严格 ctx 成为全仓唯一可复用的替身。
- `test/client-entry.test.mjs`：删除宽松 `fakeContext()` 与重复自造 `flatTranslate()`，12 条用例统一走严格 ctx（源码 bundle 7 条 + 真实 `client.js` 5 条）。
- `test/i18n.test.mjs`：`valueAt()` 收紧为「字面量优先，只允许 `meta.*` 下钻」，去掉「点号遍历任意键」的宽松回落。
- `test/inject-contract.test.mjs`（新增 9 条）：G4 静态 inject 契约，含注释/字符串剥离，避免把文档里的 `ctx.theme` 当真实读取。
- `test/bundle-contract.test.mjs`（新增 5 条）：G9 产物运行时契约与 seed 白名单。
- 期间修掉我自己守卫的一个误报：`styles.js` 注释里出现 `ctx.theme.overrideTokens` 被朴素正则误判 —— 改为「先剥注释与字符串字面量再扫」。

## 第 2 轮复核结论（历史，结论仍然有效）

### 1. 工程师改了什么（我逐项独立核实，非采信自报）

| 文件 | 工程师自报 | 我的核实方式 | 结论 |
| --- | --- | --- | --- |
| `lib/frontmatter.js` | KI-2：新增块标量读侧（`>`/`>-`/`>+`/`\|`/`\|-`/`\|+`、公共缩进剥离、空行成段、同级键收尾），`parseFrontmatter` 改索引循环；**写入器一行未动** | 逐行读代码比对：`setDisableModelInvocation` 与第 1 轮字节级一致；新增 `BLOCK_INDICATOR`/`readBlockBody`/`indentOf`/`foldLines`/`blockScalarValue` 五个内部函数 | ✅ 属实 |
| `lib/write-skill.js` | KI-3：写前 `lstat(file)` 判软链 → `E_SYMLINK_READONLY`；两次指纹复核统一 `lstat` | 读代码：`lstat(dir)` → `lstat(file)`（软链/非常规文件分别拦）→ `before=fingerprint(lstat)` → `open`+`read` → 写临时文件 → `after=fingerprint(lstat)`；`E_FILE_CHANGED` 比较基准两侧同源 | ✅ 属实，且并发判定语义更干净（原先是 fstat 对 lstat） |
| `locale/{zh,en}.json` | KI-1：补 `error.E_BAD_NAME`/`error.E_BAD_PATH`（41→43 键） | 实测 43 键、占位符逐键对齐、英文无残留 CJK | ✅ 属实 |
| `src/client/model.js` | `ROW_ERRORS` 收录两码 | 读代码确认两码在集合内 | ✅ 属实 |
| `client.js` | 重建 51 401 B | `npm run check:client` 逐字节比对通过 | ✅ 属实 |
| `docs/system_design.md`、`AGENTS.md`、`.gitignore` | 只增读侧契约表 + D 组三行 / 目录表与真机坑 / 忽略项 | 读文档确认；`AGENTS.md` 新增「frontmatter 有两套规则，不要混」 | ✅ 属实 |

### 2. 四条被改写的断言：是否被削弱？（逐条判定）

| 文件 · 用例 | 第 1 轮断言 | 现在断言 | 判定 |
| --- | --- | --- | --- |
| `test/frontmatter.test.mjs` · KI-2 | `parseFrontmatter(text).description === '>'`（记录 bug 现场） | `=== 'Comprehensive UI design skill. Second line.\n'`（整串精确相等，含 clip 换行） | **通过（变强）**：从「记录错误值」变成「钉住完整正确值」，是精确相等而非包含/正则，且额外覆盖了末尾换行语义 |
| `test/write-skill.test.mjs` · KI-3 | `error.code === 'E_FILE_CHANGED'` | `error.code === 'E_SYMLINK_READONLY'` | **通过（变准）**：断言的是修复后的契约值；**两条 fail-safe 断言都在**（目标字节 `equals` 前后相同、`lstat(...).isSymbolicLink() === true` 证明软链没被替换成普通文件），没有被删弱 |
| `test/i18n.test.mjs` · KI-1 | 断言两个码**缺键**、且走 `E_UNKNOWN` 兜底（`'操作失败：…'`） | 断言两码**有键**：`ROUTE_CODES` 从 9 项扩到 11 项（删掉「已知两个例外」豁免）、新增「文案里没有英文句子 / 没有 undefined / 不含『操作失败』」三条 | **通过（变强）**：从「豁免缺口」变成「不允许缺口」；错误码清单随实现扩展 |
| `test/model.test.mjs` · KI-1 | `reasonText('E_BAD_NAME', …) === '操作失败：name must be kebab-case'`（兜底口径） | `=== '技能名不合规范，未做任何修改'` / `=== '技能文件路径不合规范，未做任何修改'`（专属文案口径） | **通过（变准）**：与套件里其它 `reasonText` 用例同一风格（精确文案），并额外保留「未知码仍回落 E_UNKNOWN」的用例 |

**一条被我改掉的（QA 侧决定）**：工程师把字典键数**钉死成 `assert.equal(zhKeys.length, 43)`** —— 这正是「以后合法加一个文案键就变红」的维护陷阱，且它并不比集合断言多证明任何东西。已改为：

- `zh`/`en` 键集**互相相等**（原有）；
- 新增「设计 §8.3 键表要求的 **43 个键名逐条存在**」的集合断言（删键仍会被抓，增键不再误报）；
- 再加一条 `flatten(zh).length >= required.length`（允许更多，不允许更少）。

改完 `test/i18n.test.mjs` 全绿（当前 13 条）。这是**测试自身**的问题，按 SOP 由 QA 自修，不计入「失败」。

### 3. KI-2 端到端复核（走扫描层，并独立核对「与宿主一致」的说法）

**做法**：把 `@deepseek-ai/dsh-skill-filesystem/lib/index.js` 与它依赖的 **`yaml@2.9.1`** 从 `DeepSeek Harness.app/Contents/Resources/app.asar` 里按 asar 头解析出原始字节（`dataStart = 8 + headerSize`），在 node 里直接跑宿主那份 `parseFrontmatter`（`yaml.parse` 切块解析）当**独立基准**，与我们的实现喂同一份字节做差分。

- 宿主实现已核实：`parseFrontmatter` = 首行必须是 `---` → 找闭合 `---` → `yaml.parse(块内文本)`，随后 `stringField(data,'description')` 要求 `typeof === 'string' && length > 0`。所以「宿主用 `yaml.parse` 读同一文件」这句话成立。
- **真机 5 条样本：5/5 与 `yaml@2.9.1` 完全一致**（含 `ui-design` 的三句正文 + 末尾一个 `\n`，即 YAML 的 clip chomping）。
- 扫描层端到端：`~/.dsh/skills/clawhub-wpank--ui-design` 的行描述现在是
  `'Comprehensive UI design skill covering fundamentals, patterns, and anti-patterns. Layout, typography, color, spacing, accessibility, motion, and component design. Use when building any web interface, reviewing design quality, or creating distinctive UIs.\n'`
  —— 不再是 `'>'`。已固化成用例（`real-samples.test.mjs`，真机优先、无样本时用 fixture 折叠技能）。
- 常规块标量形态差分：`>`、`>-`、`>+`、`|`、`|-`、`|+`、空行成段、深缩进续行、整体缩进 4、同级键收尾、指示符带行尾注释、布尔字段块标量 —— **与 `yaml@2.9.1` 一致**。
- **发现 4 类边缘偏差**（详见 KI-5），都不出现在真机样本里，也不影响写入字节。

### 4. KI-3 从路由层复核

新建临时树：技能目录是**真目录**、其中 `SKILL.md` 是软链（指向树外共享文件）。`makeRoutes` 之后 `POST /toggle`：

- 返回 **409 `E_SYMLINK_READONLY`**（不再是 `E_FILE_CHANGED`）；
- 链接目标文件**字节前后完全相同**；
- `lstat(SKILL.md).isSymbolicLink() === true` —— 软链**没有被替换成普通文件**（第 1 轮担心的静默破坏不存在）。

### 5. `.gitignore` 复核（有没有把该入库的东西挡掉）

做法：把包（除 `node_modules`）复制到临时目录 → `git init` → `git add -A` → 逐项 `git ls-files` 验证。结果：

| 路径 | 是否入库 |
| --- | --- |
| `client.js`、`index.js`、`package.json`、`cordis.patch.yml`、`assets/icon.svg` | ✅ 全部入库 |
| `locale/zh.json`、`locale/en.json` | ✅ |
| `docs/test-report.md`、`docs/system_design.md`、`README.md`、`AGENTS.md` | ✅ |
| `test/fixtures/skills-plain/**`、`skills-crlf/**`、`target-repo/**`、`skills-messy/folded-desc/**` | ✅ |
| `test/fixtures/skills-symlink/dev-docs-standards` | ✅ 以 **mode 120000（软链）** 入库，相对目标 `../target-repo` 保留 |
| `test/helpers/**`、`test/*.test.mjs`、`scripts/*.mjs` | ✅ |
| `test/.build/`、`test/.tmp/` | ⛔ 忽略（**应该**：SSR 中间产物） |
| **`test/fixtures/skills-messy/.DS_Store`** | ⛔ **被忽略**（见 N-1） |

结论：**没有忽略任何该入库的产物**。唯一副作用是「噪声夹具 `.DS_Store`」在新克隆里会消失——我把这条判据补成**运行时造噪声**（见下），所以门禁不依赖它。

### 6. 第 2 轮新增/补强的用例（+18 条，239 → 257；第 3 轮再 +22 条，见上节）

| 文件 | +条数 | 内容 |
| --- | --- | --- |
| `test/frontmatter.test.mjs` | +10 | 按设计 §3.2.4「读侧契约」逐行验收：折叠/字面/空行成段/深缩进/公共缩进/三层 chomping/标量边界（同级键、行尾注释、缩进数字）/空正文/布尔块标量 + 「写入器与解析器解耦」（写完 disable 位后描述解析值一字不变）+ 空值 `disable:` 行补成显式布尔 |
| `test/routes.test.mjs` | +2 | KI-3 路由层回归（零写入 + 软链未被替换）；「目录真、`SKILL.md` 软链」行的现状记录（见 KI-6） |
| `test/scan.test.mjs` | +2 | KI-2 扫描层回归（折叠成一句话）；噪声判据的**运行时版本**（不依赖被 gitignore 的夹具） |
| `test/real-samples.test.mjs` | +1 | KI-2 真机端到端（三句正文 + clip 换行） |
| `test/write-skill.test.mjs` | +2 | 文件不可读 → `E_WRITE_FAILED` 且字节不变；目录只读 → 落盘失败 `E_WRITE_FAILED`、原文件不变、无 `.tmp` 残留 |
| `test/i18n.test.mjs` | +1（净） | 设计键表集合断言（替代硬编码 43） |

### 7. 反「假绿」补充：对**本轮改动**做变异验证（4/4 被抓）

| 注入的缺陷 | 变红的用例 |
| --- | --- |
| 读侧退回 `scalarOf`（KI-2 复发） | 8 条：`KI-2 折叠标量…`、`KI-2 回归：扫描层…`、`KI-2 回归：真机 ui-design…`、`读侧契约·折叠/字面/chomping/公共缩进/布尔` |
| 写侧删掉 `lstat(file)` 软链判断（KI-3 复发） | `KI-3 SKILL.md 本身是软链时…`、`KI-3 回归（路由层）…` |
| 折叠规则改成「一律按字面」（相邻行不折成空格） | 6 条折叠相关用例 |
| chomping 一律按 clip（`-`/`+` 失效） | `读侧契约·chomping` |

（第 1 轮的 5 个变异——删软链 409、CRLF 洗成 LF、去掉 `getServerSnapshot`、rank 大者胜、软链行也渲染开关——同样仍全部被抓，说明原有判据没有因本轮改动而松掉。）

---

## 必测 8 类的逐项覆盖（第 3 轮仍全部覆盖）

### ① 判据：5 条真机样本 5/5 命中三分区 → 覆盖（真机实测）

| 样本 | 期望 | 实测（真实 `~/.dsh/skills`） |
| --- | --- | --- |
| `dev-docs-standards`（软链） | local / R4 / high | ✅ `path=null`、`realPath` → `~/Documents/Agents/Skills/dev-docs-standards/SKILL.md` |
| `clawhub-…--frontend-design-3` | installed / R7 / high | ✅（R8 不命中：slug 段 `frontend-design-3` ≠ 声明名 `frontend-design`） |
| `clawhub-wpank--ui-design` | installed / R7 / high | ✅ 且**描述现为三句正文 + clip 换行**（KI-2 已修，与 `yaml@2.9.1` 一致） |
| `indiv-guipi--find-skills` | installed / R8 / medium | ✅ |
| `indiv-integrator--dev-expert-pro` | installed / R8 / medium | ✅ |

真实样本 vs fixture 的界限：`real-samples.test.mjs` 优先读 `$DSH_HOME/skills` → `~/.dsh/skills`（本机存在，断言直接跑真机字节）；缺失时自动回落 fixture 并在 `t.diagnostic` 写明，用例数不跳变、不静默 skip。

### ② 去重裁决 → 覆盖（`classify.test.mjs` 15 条）

同名 `bundled(600)+user-dsh(400)` ⇒ 一行、`local/R9`；`runtime(250)+user-dsh(400)` ⇒ 一行、`builtin/R1`；并列 rank 取扫描条；台账（R5）先于目录名结构（R8）；`excluded + Σgroups ===` 不同 name 数；三分区每个 name 只出现一次。

### ③ 软链三层拦截 → 覆盖（四层实际都有用例）

| 层 | 用例 | 结论 |
| --- | --- | --- |
| 扫描层 `symlink` 事实 | `scan.test.mjs`（K12）+ `routes.test.mjs` list | ✅ |
| view-model 不渲染开关 | `model.test.mjs`（`switchMode` 返回 `null`）+ `view-row`/`view-page` | ✅ |
| 写路由 409 + 目标零字节改动 | `routes.test.mjs`（K18） | ✅ |
| 写入层双保险 | `write-skill.test.mjs`（软链目录 / 软链文件两种形态） | ✅ |

### ④ frontmatter 字节保真 → 覆盖（`frontmatter.test.mjs` 27 条 + `write-skill.test.mjs` 14 条）

CRLF 逐行保留（无裸 `\n`）、逐字保真（定位第一处差异，前后行原样）、BOM 首位、混排行尾、行尾注释保留、启用写 `false` 不删键、多字节（中文/emoji/组合符）保留、无 frontmatter 抛 `NO_FRONTMATTER`、写后无 `.tmp` 残留、`0600` 权限位不变、**读写解耦**（写 disable 位不改变描述解析值）。

### ⑤ 写路由路径身份校验 → 覆盖（`routes.test.mjs` 30 条）

任意路径 `400 E_BAD_PATH`（相对路径、`/etc/passwd`、`README.md`、空串、非字符串）；同名换路径 `409 E_STALE_PATH` 且两个文件都没被写；身份一致 `200` + 文件只多一个键（增量字节精确等于 `disable-model-invocation: true\n`）+ 再 `list` 计数同步；重复写幂等；用文件路由写内置行 `409 E_NOT_WRITABLE`。

### ⑥ 路由围栏与错误码 → 覆盖

`403 E_FORBIDDEN`（非回环 socket / `x-forwarded-for` / `cf-connecting-ip` / `cross-site` / Host 伪装 / Origin 端口不同）且**被拒的写请求零字节改动**；围栏先于方法判断；`405`（GET toggle、POST list、POST health）；`404`（未知 name、provider 不匹配）；`400`（坏 JSON、空正文、数组正文、70 KiB、`enabled` 非布尔、超长 provider）；`200`（health 全字段、provider-toggle 落盘后 list 反映）；`cwd` 解析顺序（`?cwd=` → 会话 cwd → 进程 cwd）。

### ⑦ 视图层（结构，不含几何）→ 覆盖（**50 条**结构断言：view-page 20 + view-row 10 + view-skeleton 4 + view-toast 4 + client-entry 12）

三分区标题顺序与 `data-skc-group`；行四件套（图标/名称/描述/右侧控件）；可写行 `role="switch"` + `aria-label="启用 <name>"` + `aria-checked`；软链行无开关 + `skc_roTag`「软链·只读」+ 指向 `realPath` 的 title；骨架 `role="status"` + **9 条 `skc_skeletonBar`**（1 标题 + 4×2）+ `aria-busy`；空态/错误态（`role="alert"` + 重试）/市场页签（占位文案 + 工具栏 `hidden` + 不渲染分区）；页脚计数；状态行「共 N 个技能，M 个已停用」；行内原因与 pending 态；行不可点（无 `<a>`、无 `role="button"`、无 `tabindex`）。

### ⑧ i18n → 覆盖（`i18n.test.mjs` **13 条** + `inject-contract.test.mjs` 9 条 + `scripts/check-i18n.mjs` 形状守卫）

`zh`/`en` 键集相等 + 设计 §8.3 的 **43 个键名逐条存在** + 占位符逐键对齐 + en 无残留 CJK + 入口键 `panel.label` = 「技能」（并通过**真实注册路径**验证：`apply(ctx)` 后侧栏行 `label()` 返回「技能」，换英文返回 `Skills`）+ `lib/**`、`src/client/**` 零 CJK + 11 个路由错误码文案齐备（含新补的两个）。

---

## 覆盖率（`node --test --experimental-test-coverage`）

| 文件 | 行 % | 分支 % | 函数 % |
| --- | --- | --- | --- |
| `index.js` | 98.61 | 83.33 | 83.33 |
| `lib/classify.js` | 99.57 | 85.98 | 100.00 |
| `lib/frontmatter.js` | **99.09** | **91.95** | 100.00 |
| `lib/http.js` | 100.00 | 88.89 | 100.00 |
| `lib/ledger.js` | 100.00 | 81.40 | 100.00 |
| `lib/loopback.js` | 97.62 | 90.24 | 100.00 |
| `lib/names.js` | 100.00 | 92.31 | 100.00 |
| `lib/provider-toggles.js` | 98.86 | 93.22 | 100.00 |
| `lib/registry.js` | 100.00 | 96.77 | 100.00 |
| `lib/routes.js` | 90.83 | 76.67 | 94.12 |
| `lib/scan.js` | 98.65 | 93.33 | 100.00 |
| `lib/write-skill.js` | 85.97 | 79.55 | 77.78 |
| `src/client/api.js` | 100.00 | 84.00 | 85.71 |
| `src/client/header-scroll.js` | 42.98 | 64.71 | 50.00 |
| `src/client/model.js` | 99.20 | 95.56 | 100.00 |
| `src/client/state.js` | 100.00 | 91.18 | 100.00 |
| `src/client/styles.js` | 100.00 | 100.00 | 100.00 |
| **all files** | **92.87** | **87.83** | **94.44** |

未覆盖行都可解释：`routes.js` 是 `E_INTERNAL`/`E_WRITE_FAILED` 兜底分支；`write-skill.js` 是 `E_FILE_CHANGED`/`E_VERIFY_FAILED` 与回滚（需在 rename 前后注入故障，`writeDisableFlag` 无注入缝，ESM 也 patch 不了 `node:fs/promises`）；`header-scroll.js` 是 `measure()`/`attachHeader()` 的 DOM 量测段（L4）。JSX 组件经 esbuild 打成临时 bundle 加载，不进覆盖表，其证据是 50 条结构断言（含 5 条直接加载真实 `client.js` 的产物级用例）。

---

## 用例分布（279 条 / 26 文件 · 第 3 轮）

`routes 30`、`frontmatter 27`、`view-page 20`、`classify 15`、`write-skill 14`、`i18n 13`、`model 12`、`client-entry 12`、`http 11`、`scan 11`、`state 11`、`provider-toggles 10`、`view-row 10`、`api 9`、`inject-contract 9`、`header-scroll 8`、`ledger 8`、`loopback 8`、`styles 8`、`names 6`、`bundle-contract 5`、`real-samples 5`、`registry 5`、`index 4`、`view-skeleton 4`、`view-toast 4`。

第 3 轮变化：`client-entry` 7 → 12（+2 产物级，7 条旧用例改为严格 ctx）、`i18n` 10 → 13（+3 形状/键名）、新增 `inject-contract 9` 与 `bundle-contract 5`，合计 257 → **279**。

## Failed Tests

**无。** 279 条全绿，`npm test` exit 0。

第 3 轮修掉的是 **2 处测试守卫缺口**（不是源码缺陷，按 SOP 由 QA 自修）：

1. **宽松的假 ctx**（事故 1 的漏点）：`client-entry.test.mjs` 里那个返回「读啥都有值」的普通对象被删除，12 条用例统一换成严格 Proxy。
2. **宽松的 `translator()`**（事故 2 的漏点）：`ssr.mjs` 的点号路径遍历改为字面量取键；`i18n.test.mjs` 的 `valueAt()` 同步收紧到「只允许 `meta.*` 下钻」；`client-entry.test.mjs` 里重复自造的一份 `flatTranslate()` 删除，避免两份语义漂移。

前两轮修掉的测试自身缺陷（realpath 归一化、`_skillhub_meta.source` 类型、`counts` 断言路径、`apply` 一次性守卫、子进程 `ctx.effect` 未执行、i18n 键数硬编码）保持不变。

## Known Issues（第 3 轮状态）

> 本轮**没有新增产品层缺陷**：两次真机事故的根因都在测试守卫（替身语义），已按上一节修复并用变异验证。下表沿用第 2 轮判定。

| ID | 状态 | 严重度 | 说明 |
| --- | --- | --- | --- |
| KI-1 | **已修 ✅** | — | `E_BAD_NAME`/`E_BAD_PATH` 补文案（`locale` 41→43 键）+ `ROW_ERRORS` 收录；用户不再看到「操作失败：name must be kebab-case」。验证：`i18n`/`model` 各 1 条精确文案断言 + 路由层实测两个码 |
| KI-2 | **已修 ✅** | — | 折叠块标量读侧：真机 `ui-design` 行描述 = 三句正文 + clip 换行，与宿主 `yaml@2.9.1` 逐字符一致；写入器未动（读写解耦有用例）。验证：`frontmatter`（含 §3.2.4 逐行契约）+ `scan` + `real-samples` 共 13 条 |
| KI-3 | **已修 ✅** | — | 「目录真、`SKILL.md` 是软链」→ `409 E_SYMLINK_READONLY`，目标零字节改动、软链未被替换；写入层与路由层各有一条用例。指纹复核统一 `lstat`，`E_FILE_CHANGED` 语义保留 |
| **KI-4** | **遗留（不修）** | 极低 | frontmatter 里的**非 UTF-8 字节**会被重编码成 `U+FFFD`（其余字节保真只对合法 UTF-8 成立）。SKILL.md 本身必须 UTF-8 宿主才能读，风险≈0 |
| **KI-5** | **遗留（不修，本轮新发现）** | 低 | **与 `yaml@2.9.1` 的 4 类边缘偏差**（真机 5 条样本、常规形态均一致）：①显式缩进数字小于实际缩进时（如 `\|2` + 4 空格正文），yaml 保留 2 个前导空格、我们按「公共缩进」全剥；②正文首行前有空行时 yaml 保留前导 `\n`、我们丢掉；③「只含空格的行」yaml 留一个空格字符、我们当作空行；④**tab 缩进的块标量 yaml 直接报错（宿主会整条丢弃该技能），我们仍能解析并列出**。①②③是空白差异（渲染不可见），④是「列出了宿主不认的技能」，但 tab 缩进属非法 YAML、现实为零；要 100% 对齐必须引入 `yaml` 依赖，与「运行时零依赖」设计冲突。已记录，不修 |
| **KI-6** | **遗留（首版接受，非真实场景）** | 低 | **`SKILL.md` 本身是软链**（目录是真目录）时：扫描层按目录条目判定，`row.symlink=false`、`writable=true` → 面板**渲染开关**，点了才 `409 E_SYMLINK_READONLY`，而不是直接显示只读标记。行为安全（零写入、文案准确），只是「不渲染开关」那一层没盖住这种构造形态。本机 5 条样本零命中；`routes.test.mjs` 有 characterization 用例记录现状（改了就会红） |
| N-1 | 遗留（仓库整洁，可选） | 低 | `.gitignore` 的 `.DS_Store` 会把噪声夹具 `test/fixtures/skills-messy/.DS_Store` 一起忽略，新克隆里该文件消失。判据已由「运行时造噪声」用例兜住（不是红）。建议加一行 `!test/fixtures/**/.DS_Store`，或者干脆删掉该夹具文件（两者都行） |

**按队长口径未判缺陷**：骨架 9 条 `skc_skeletonBar`（附录 D K24「4 个」是文档笔误，用例按 `=9 且 >=4` + kind 断言）、D1（`Row.evidence`）/D2（`model.switchMode`）/D6（无 sourcemap）为有意偏离、`node_modules/` 与 `package-lock.json` 归「环境」。

---

## 关于「`SKILL.md` 是软链」这条观察的判定（队长点名要意见）

**结论：Known Issue（低），首版不修。理由四条：**

1. **非真实场景**：本机 `~/.dsh/skills` 5 条样本无一命中；正常技能是「目录 + 真实 `SKILL.md`」，文件级软链通常意味着作者在手工做跨仓共享，属极端构造。
2. **行为已经安全**：三层里的第三层（写路由 `409`）与写入层的 `lstat(file)` 都拦住了，实测零字节改动、软链没被替换成普通文件；错误文案「软链技能只读，未做任何修改」准确，用户不会踩到数据风险。
3. **代价不对称**：让扫描层再 `lstat(SKILL.md)` 只是第一步，真正要改的是 **payload 不变式**（`readonlyReason` 目前只有 `symlink`/`provider-store`/`no-file` 三值，需新增 `symlink-file`）+ 前端只读标记复用 + locale 文案 + 设计 §3.3.1 的不变式与附录 B 登记 + 真机复验；收益只是「少点一次注定失败的开关」。
4. **有 tripwire**：现状已被 `routes.test.mjs` 的 characterization 用例钉住（谁改了这个行为，测试会提示并把报告里的判定翻过来）。

**将来若要修（最小方案，留给 P1）**：扫描层对 `instructionPath` 做 `lstat`，是软链时给 `readonlyReason: 'symlink-file'`、`realPath` 复用现有字段（指向真实 `SKILL.md`），前端 `switchMode` 天然返回 `null`（不渲染开关），只读标记直接复用 `skc_roTag` + `row.symlinkTitle`；路由与写入层的 409 保持不动（双保险）。**不需要改 payload 结构以外的东西。**

---

## 未覆盖项与理由

| 项 | 理由 |
| --- | --- |
| `E_FILE_CHANGED`（写入期间被改）、`E_VERIFY_FAILED`（回读不一致并回滚） | `writeDisableFlag` 没有注入缝（rename 前后无钩子），ESM 也无法 patch `node:fs/promises`；用并发制造窗口会变成 flaky。宁可少一条，不写不稳定用例；错误码映射由代码审阅 + `statusOf` 分支确认 |
| 点击开关触发写请求（组件交互） | SSR 只渲染一次，无法触发事件；由 `api.test.mjs`（请求体）+ `state.test.mjs`（pending/commit/fail）+ `routes.test.mjs`（真实落盘）三段串联覆盖，真机再点一次 |
| `routes.js` 的 `E_INTERNAL` 500 分支、`queryCwd` 的 catch | 正常路径不可达（扫描/台账/注册表三层都自带降级）；`new URL(任意串, base)` 几乎不抛，属防御分支 |

---

## 真机待验清单（10 项，标注当前状态）

队长已用隔离 `DSH_HOME` + 无头 chromium 跑过一次，确认：侧栏「技能」出现、页头「技能 / 启用、停用和查看技能来源 / 共 5 个技能」、三个分组、「软链·只读」标记正确、4 条市场技能归入「已安装技能」、控制台零错误。据此：

| # | 项 | 状态 |
| --- | --- | --- |
| 1 | 侧栏入口 + 页头 + 三分组 + 条目分区 | ✅ 队长已验（上述那轮） |
| 2 | 「软链·只读」标记与只读行无开关 | ✅ 队长已验 |
| 3 | 文案全为中文、无原始键名（事故 2 的现场） | ✅ 队长已验（零控制台错误）；本轮另加了 G7/G8 静态+渲染双向守卫 |
| 4 | **像素几何**：内边距、页签 34px、行高 64px、图标 48×48、开关 36×20、只读标记 18px/padding 0 6px/11px·18px（附录 A.9） | ⬜ 待量 |
| 5 | **深色模式**：所有 `--dsw-*` 令牌解析成功（失败表现为透明边框/看不见文字） | ⬜ 待验 |
| 6 | **页头停靠**：滚到紧凑态时列表滚动范围不变、反向滚动沿同一坐标返回 | ⬜ 待验 |
| 7 | **darwin 标题栏安全区**（含侧栏收起时 8px 特例） | ⬜ 待验 |
| 8 | **页面切换**：打开任意会话 → 主区回会话正文；回到「技能」→ 页签保持 | ⬜ 待验 |
| 9 | **热刷新**：停用技能后下一轮会话可用列表减少；A4「重启后状态一致」抽检 1 次 | ⬜ 待验 |
| 10 | **`prefers-reduced-motion: reduce`** + **1200→700px 响应式**（页签落到操作组上方、内边距 20px） | ⬜ 待验 |
| 11 | **点击闭环**：点开关 → pending → 成功写盘 / 失败出现行内原因与 toast（A6 断网注入） | ⬜ 待验 |
| 12 | **KI-2 现场复验**：`ui-design` 行描述显示三句正文（不再是一个 `>`） | ⬜ 待验 |

（工程侧还有一条部署动作未做：profile `link:` + `bundles` + 重启；那不属 QA 验收面，但真机装不到就验不了。）

## Routing Decision

# **NoOne**

- **279 / 279 通过**，`npm test` 与 `npm run check` 均 exit 0；两次真机事故的守卫升级**逐项复核并用变异验证**：删 `inject` → 15 条红；字典改回嵌套 → 37 条红 + `check-i18n` exit 1；`meta` 漏进运行时字典 → 1 条红；新增未声明的 `ctx.theme`（**不重建**）→ 7 条红；`inject` 多声明 → 2 条红；产物引非 seed 模块 → 6 条红。
- 本轮**没有发现新的源码缺陷**：工程师的三处修复（`inject` 导出、`uiDictionary()` 过滤 `meta`、locale 拍平）我都在源码 + 产物 + 门禁三层核对过，且 `translator()` 已改成与宿主 `lookup` 同语义。
- 剩余遗留仍是第 2 轮的 KI-4 / KI-5 / KI-6 与整洁项 N-1（均极低/低、非真实场景或纯整洁），**不阻断真机验收**。

## 本轮遗留的可选项（都不是补丁阻塞项）

1. **N-1**（`.gitignore` 的 `.DS_Store` 会顺带忽略噪声夹具）：属工程师写入面；QA 已使判据不依赖它。
2. **`common` 命名空间回落**：真机 `translate` 在找不到键时会先查 `common` 再回落键名，我们的 `t()` 不查 `common`（更严格）。若将来插件真的依赖 `common` 里的文案，需要在 `translator()` 补一层并可考虑加断言。
3. **非字符串字典值**：真机会原样返回（React 直接报错），我们回落键名（更安静）。已被 G7/G8 兜住；若想让失败更响，可把 `translator()` 改成 `value ?? key`（不带 typeof 判断），代价是错误会以 React 异常形式出现而不是断言消息。

## 待确认 / 假设

1. **假设**：KI-5 不修是可接受的口径——若队长要求「与宿主 `yaml` 逐字节一致」，唯一干净的办法是把 `yaml` 提为运行时依赖（当前设计是运行时零依赖），需要先改设计约束再谈。
2. **假设**：KI-6 首版接受（我同意工程师「行为安全、文案准确」的判断，理由见上）；若队长要求「软链一律不渲染开关」一字不让，则按上面「最小方案」走 P1，成本约 1 个扫描分支 + 1 个只读原因值 + 1 个文案键。
3. **待确认（仓库整洁）**：N-1 建议由工程师（`.gitignore` 属其写入面）加 `!test/fixtures/**/.DS_Store`；QA 侧已把判据改成不依赖该文件，加不加都不会红。
4. **待确认（流程，沿用上轮）**：`task-3` 的 `writeScopes` 仍缺 `dsh-skill-center/src/client`；本轮 QA 只改 `test/**` 与 `docs/test-report.md`，未越界碰源码。
