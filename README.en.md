# dsh-skill-panel — Skill Panel

English | [简体中文](README.md)

[![npm](https://img.shields.io/npm/v/@ztqing4agents/dsh-skill-panel)](https://www.npmjs.com/package/@ztqing4agents/dsh-skill-panel) ![downloads](https://img.shields.io/npm/dm/@ztqing4agents/dsh-skill-panel)
[![release](https://img.shields.io/github/v/release/Ztqing4Agents/dsh-skill-panel?logo=github)](https://github.com/Ztqing4Agents/dsh-skill-panel/releases/latest) ![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.1-4B6EF5) ![license](https://img.shields.io/github/license/Ztqing4Agents/dsh-skill-panel)

**One sidebar entry, one full-page panel. Built-in, local and market-installed skills listed apart, each row a switch; symlinked skills are read-only.**

![Skills page: built-in skills grouped by plugin, the local symlink row read-only, one switch per installed row](docs/assets/installed-page.png)

## Three steps to install

1. **Desktop app**: open **Plugins** in the app → add plugin → paste the npm name `@ztqing4agents/dsh-skill-panel`. For a source install, paste `github:Ztqing4Agents/dsh-skill-panel` instead.
2. **CLI**: `dsh plugin --profile <name> add @ztqing4agents/dsh-skill-panel`. `--profile` is required. The desktop profile belongs to the app, so desktop users take step 1.
3. **Restart DSH**: the plugin list is read once at startup, so no restart means no **Skills** entry.

- Make sure the machine has `pnpm` and can reach the npm registry first; without `pnpm` it says it cannot find it and the install stops.
- The `dsh-skill-panel` package on npm belongs to someone else — do not install that one.
- The old and the new package cannot be installed side by side; they clash and the second one fails.

## What it does

- The panel opens on one list in three groups: built-in skills (grouped by the plugin that provides them), skills on this machine, and skills installed from the market. A skill shows up only once, never twice.
- Every row has a switch on the right. Click it to turn that skill off or on, and you never edit a file yourself. Once it is off, the model stops using it. Skills that are symlinked in are read-only and get no switch.
- Click the title of any row under **Installed** to open its own page: the name you call it by (you can select and copy it), the folder it lives in on this machine, its own description, where it came from and which version. Market installs also show older versions, and the page header gains **Update**.
- In **Skill market**, search, narrow by one of the 12 categories, sort by downloads or favorites, and keep scrolling to load more. Click the empty part of a card for a short description and what is inside the package; click **Install** to put it on this machine, and the next session can use it.
- **＋ Add skill** in the toolbar takes a folder path on this machine or a GitHub repository address; the `⌄` next to it also offers **Let the Agent create a skill**. When you no longer want one, **Uninstall** in the detail page header deletes it together with its install record.

## Skill market

![Skill market: search, source and sort menus, 12 categories with their counts, an equal-width card grid](docs/assets/market-page.png)

Skills come from the skillhub.cn catalog, and ClawHub skills are in there too. Pick a range at the top: **All sources** is the default and the largest, or narrow it to **SkillHub** or **ClawHub**.

There are 12 categories, each label saying how many skills it holds, and four sort orders: default, recently updated, downloads, favorites. Scroll to the bottom and the next page loads by itself; when everything is loaded it says **No more results**.

- **Where it lands**: in your own skills folder, `~/.dsh/skills/<name>`, next to the skills you put there by hand. The folder name is the name the skill declares itself, which is not always the name shown in the market.
- **When you can use it**: in a new session. The one you are in keeps the list it loaded earlier, so the skill will not show up right away.
- **If the name is taken**: a skill with that name is not replaced, and the panel tells you where the old one is. There is no overwrite button — to change versions, use **Update** on the detail page.
- **Why some skills will not install**: a name can only use lowercase English letters, digits and hyphens. Names with capitals, spaces or Chinese characters cannot be installed.

## Known limitations

- **Symlinked skills are read-only**: no switch, and the panel will not change them for you.
- **A built-in skill's switch only counts inside this panel**: the plugin that provides it does not read that setting, so whether the model still uses the skill depends on that plugin.
- **No going back to an older version**: after an update, the only way back is to move the skill folder out and install it again.
- **No network only affects Skill market**: that tab shows an error with a retry button, while **Installed** keeps working.
- **Installed, but the record was not written**: the skill is already in the list while its install record is missing. Installing again is blocked as a name clash — move the folder out and install once more.
- **The panel only touches skills you can see in it**: if a skill moved on disk, the write is refused instead of landing on the wrong file.

## Upgrade and migration

From `dsh-skill-center` to 1.0.0, run `mv ~/.dsh/dsh-skill-center ~/.dsh/dsh-skill-panel` first. From 1.0.0 to 1.1.0 it is `remove` → `add` → restart, and **do not `mv`**. Details are in the 1.1.0 and 1.0.0 sections of [CHANGELOG.md](CHANGELOG.md).

## Requirements

- DSH `>= 0.2.1`, Node `>= 20`.
- The skill market reaches `api.skillhub.cn` only, and goes through the plugin rather than the browser.
- No runtime dependencies. `esbuild` is only needed if you rebuild the client yourself.

## More

- Nine-level classification and the same-name tiers: [architecture.md §1.4.2 / §1.4.3](docs/contracts/architecture.md)
- Market install / update / rollback and error codes: [routes.md §3.7](docs/contracts/routes.md)
- zh/en locale keys and UI vocabulary: [client.md §8.3](docs/contracts/client.md)
- Full change history: [CHANGELOG.md](CHANGELOG.md)

## License

This project is licensed under the [MIT License](LICENSE).

The internal contract documents linked above are written in Chinese.
