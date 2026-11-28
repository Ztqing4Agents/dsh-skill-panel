/**
 * 单一真源：这个插件支持哪些 DSH 宿主。
 *
 * 包里的三处声明全部从这里派生，谁都不再手写：
 *   1. `package.json` 的 `engines.dsh` 与七条 `@deepseek-ai/dsh-*` peer（**同一个字符串**）；
 *   2. `README.md` / `README.en.md` 的兼容行与 DSH 徽标（下限 = `supportedHosts[0]`）；
 *   3. `scripts/check-version.mjs` 的发布前断言、`scripts/test-compat.mjs` 的基线比对。
 *
 * 别把这两层混成一层：`peerRange` 是**声明面**（npm 安装时按 peer 解析执行，区间外的宿主根本
 * 装不上，用户侧不需要额外说明），`supportedHosts` 是**验证面**（人工在真机上跑过哪几版），
 * 徽标下限取后者——所以「装得上」不等于「这一版验过」，两者不必然相等。
 *
 * 校验与回写都由 `scripts/sync-hosts.mjs` 负责：默认只校验（声明漂移就 exit 1），
 * `--write` 才回写文件。手改 `package.json` 里的区间会被 `npm run check` 的第五门拦下。
 *
 * 区间里的 `-0` 不是笔误：semver 的 prerelease 规则要求「目标 tuple 的预发布标识出现在
 * 比较子里」，`>=0.2.3` 会把 `0.2.3-alpha.2` 挡在门外；`>=0.2.3-0` 才让它进得来。
 */

/**
 * 逐个在真机上验证过的宿主版本，升序排列。
 * README 的兼容下限取第 0 项，所以数组必须保持升序（`scripts/sync-hosts.mjs` 会校验）。
 *
 * **这个数组是人工的信用记录，不是被门禁证明过的事实**：`check:hosts` 只能保证它与
 * `peerRange`、README 自洽，`check-version` 只能保证区间覆盖它；「这一版我真的装上去跑过」
 * 没有任何自动化能证明，只能靠 `node scripts/test-compat.mjs --host <version>` 逐条跑。
 * 往这里加一个区间内但没验过的版本，两道门都会放行。
 */
export const supportedHosts = Object.freeze([
  '0.2.3-alpha.2',
]);

/**
 * `engines.dsh` 与七条宿主 peer 共用的唯一字符串（`AGENTS.md` 硬约束 18）。
 *
 * 换代际不止改这一个常量：`supportedHosts` / `peerRange` / `developmentHost` 三处同轮改完之后，
 * 还要在 CHANGELOG 写「旧宿主请装哪个版本」，并**同轮对旧代际的所有版本跑一次 `npm deprecate`**
 * （模板与理由见 `docs/contracts/decisions.md` Z-14）：npm 拦不住任何人装旧版本，`deprecate` 是唯一
 * 能让「装到旧版的人当场看到指引」的机制，而门禁守不到这一步（它看不见「上一代」）。
 */
export const peerRange = '>=0.2.3-0 <0.3.0-0';

/** 开发基线：本机 `app.asar` 里那份宿主，`scripts/test-compat.mjs` 默认与它比对。 */
export const developmentHost = '0.2.3-alpha.2';

/** 必须随包声明的宿主 peer，一个不多、一个不少。 */
export const requiredHostPeers = Object.freeze([
  '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/dsh-skill',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-client-ui-primitives',
]);

/**
 * 断言一份 `peerDependencies` 的宿主部分与 `requiredHostPeers` 逐字相等。
 *
 * 只比集合，不比区间值：值的一致性由 `scripts/sync-hosts.mjs` 逐条比对（它要报「期望 vs 实际」）。
 *
 * @param {Record<string, string>} peers - 待检查的 `peerDependencies`。
 * @returns {void} 一致时静默返回。
 * @throws {Error} 缺项或多出宿主 peer 时抛出，消息里列出具体名字。
 */
export function assertHostPeers(peers) {
  const declared = Object.keys(peers ?? {}).filter((name) => name.startsWith('@deepseek-ai/dsh-'));
  const missing = requiredHostPeers.filter((name) => !declared.includes(name));
  const extra = declared.filter((name) => !requiredHostPeers.includes(name));
  if (missing.length === 0 && extra.length === 0) return;
  const parts = [];
  if (missing.length > 0) parts.push(`缺少 ${missing.join('、')}`);
  if (extra.length > 0) parts.push(`多出 ${extra.join('、')}`);
  throw new Error(`宿主 peer 集合与 requiredHostPeers 不一致：${parts.join('；')}`);
}
