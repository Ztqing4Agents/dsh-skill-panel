# dsh-skill-panel

**English** | [简体中文](README.md) | [Changelog](CHANGELOG.md)

[![npm package](https://img.shields.io/npm/v/%40ztqing4agents%2Fdsh-skill-panel?label=npm%20package)](https://www.npmjs.com/package/@ztqing4agents/dsh-skill-panel) [![npm downloads](https://img.shields.io/npm/dt/%40ztqing4agents%2Fdsh-skill-panel?label=npm%20downloads)](https://www.npmjs.com/package/@ztqing4agents/dsh-skill-panel) [![DSH](https://img.shields.io/badge/DSH-%3E%3D0.2.3--alpha.2-4B6EF5)](#installation) ![Node](https://img.shields.io/badge/Node-%3E%3D20-339933) [![license](https://img.shields.io/github/license/Ztqing4Agents/dsh-skill-panel)](LICENSE)

A native-style skill management panel for the DSH (DeepSeek Harness) Web GUI.

It adds a **Skills** entry to the sidebar and gathers **built-in skills**, **local skills**, and **market-installed skills** into one view, with an integrated skill market powered by the [SkillHub](https://skillhub.cn) mirror supporting search, installation, in-place updates, and lossless on/off control.

![Skills page: built-in skills grouped by plugin, local symlink rows read-only, one switch per installed row](docs/assets/installed-page.png)

## Features

- **Native look and feel**: layout, sticky collapsing page header, responsive step-down, detail view structure, and row height all align with DSH's native **Plugins** panel for a seamless experience.
- **Three sources, accurate grouping**: automatically classifies skills into built-in / local / installed based on symlinks, the install ledger, and metadata; duplicate names are deduplicated by host priority so the list always reflects the active copy.
- **Lossless on/off control**: toggling a local or installed skill rewrites only the `disable-model-invocation` field in `SKILL.md`, preserving original line endings (CRLF/LF), BOM, comments, and line order; built-in skill states are persisted in plugin storage.
- **Built-in skill market (SkillHub mirror)**: switch across **All sources / SkillHub / ClawHub** with debounced search, category filters, multi-dimensional sorting, and infinite scrolling; market-installed skills inherit upstream icons and display names.
- **Flexible import and in-place updates**: import third-party skills from local directories or GitHub repository URLs (including subdirectories); market-installed skills support in-place updates from both market cards and detail pages (preserving enabled state with automatic rollback on failure) and complete uninstallation.

## Installation

> ℹ️ DSH reads its plugin list only at startup. **Restart DSH after every install or upgrade for changes to take effect.**

### Option 1: Desktop App (Recommended)

1. Open the DSH desktop app and navigate to the **Plugins** page in the sidebar.
2. Click **Add plugin**, enter the package name below, and confirm (to install from source, use `github:Ztqing4Agents/dsh-skill-panel`):
   ```text
   @ztqing4agents/dsh-skill-panel
   ```
3. Restart the app to see the **Skills** entry in the sidebar.

*(Note: the `desktop` profile is managed exclusively by the Electron client; do not modify it via the CLI.)*

### Option 2: CLI / Custom Profile

Ensure `pnpm` is available on your `PATH`, then run (`--profile` is required):

```bash
dsh plugin --profile <your-profile-name> add @ztqing4agents/dsh-skill-panel
```

*Installation automatically fetches required peer dependencies from the npm registry. Re-running the command is idempotent.*

## Usage

### 1. Managing installed skills

- **Grouped list**: displays all available skills in the order of Built-in skills (grouped by plugin) → Local skills → Installed skills, with an independent toggle on each row.
- **Skill details**: click any row title under **Installed** to view the rendered `SKILL.md` body, invocation name (selectable and copyable), real disk path, source repository, and version metadata.
- **Import third-party skills**: click **＋ Add skill** in the toolbar using any of the following inputs:
  - **Local directory**: e.g. `~/my-skills/demo-skill` (copied into `$DSH_HOME/skills/` after validation)
  - **GitHub shorthand**: `github:owner/repo`
  - **Full GitHub URL**: `https://github.com/owner/repo` or a branch subdirectory `https://github.com/owner/repo/tree/<branch>/<subdir>`
- Click the dropdown arrow next to the button to open the host's **Let the Agent create a skill** mode.

### 2. Skill market
![Skill market: search bar, source and sort menus, category filters, and equal-width card grid](docs/assets/market-page.png)

- **Browse and search**: switch between data sources (All sources (default) / SkillHub / ClawHub) with keyword search, category filters, and sorting (default / recently updated / downloads / favorites).
- **Installation path and activation**: skills install into `$DSH_HOME/skills/<name>` (default `~/.dsh/skills/<name>`), named after the `name` field in `SKILL.md`. **Newly installed skills are immediately available in new chat sessions** (existing open sessions keep their previous snapshot).
- **Updates and uninstallation**: opening the **Installed** tab or a skill's detail page checks upstream versions automatically; when an update is available, click **Update** directly on the market card or at the top right of the detail page (replaces the skill directory while preserving its enabled state); click **Uninstall** to remove both the directory and the ledger record.

## How it works and known limits

### Classification priority (top to bottom, first match wins)

1. **Built-in**: skills shipped with the host or built-in plugins.
2. **Hidden (counted in footer)**: skills in project-level or custom non-global directories.
3. **Local**: skill directories that are symlinks.
4. **Installed**: skills recorded in the install ledger, carrying valid market source metadata, or matching the market naming pattern.
5. **Local**: all other manually placed directories under `$DSH_HOME/skills/`.

*Note: when duplicate skill names exist across scopes, the panel deduplicates by host load priority (project > runtime > user > built-in) and displays only the active copy.*

### Known limits

- **Naming validation**: the host strictly requires lowercase `kebab-case` names (`^[a-z0-9]+(?:-[a-z0-9]+)*$`). Packages whose `SKILL.md` declares an invalid `name` are rejected to prevent host load failures.
- **Duplicate-name protection**: if a directory with the same name already exists, installation halts and reports the path instead of silently overwriting; remove the existing directory first or use **Update** on the market card or detail page.
- **Symlinked skills are read-only**: symlinked local skills are marked `symlink · read-only` without a toggle, and the server rejects write requests to them.
- **Built-in switch scope**: built-in skill toggle states are tracked within this panel only; actual model injection remains controlled by the owning plugin.
- **No version rollback**: updates overwrite the directory in place; to revert to an older version, remove the directory and reinstall manually.
- **Local-only access**: all backend routes enforce loopback connections and browser same-origin checks and are never exposed externally.
- **Offline mode affects the market only**: the **Installed** tab remains fully functional offline; on the market tab, initial load failures show a full-page error while failed refreshes preserve loaded cards with an inline retry banner.
- **Ledger write failure recovery**: if a skill directory installs successfully but the ledger write fails, re-installing is blocked by duplicate-name protection; remove the skill directory and install again to recover.

## Local development

The repository ships a prebuilt `client.js`, so standard installation requires no build step. To modify the frontend (`src/client/**`):

```bash
# Install dev dependencies
npm install

# Rebuild the frontend bundle
npm run build
```

For local debugging, link the plugin in a test profile's `package.json` via `"@ztqing4agents/dsh-skill-panel": "link:/path/to/dsh-skill-panel"` and register it in `dsh.profile.bundles`.

## Recommended skills

Once installed, you can try the author's engineering-standards skill directly from the skill market or via **＋ Add skill**:

- **[dev-docs-standards](https://www.skillhub.cn/skills/user_7e37093e/dev-docs-standards)** ([GitHub source](https://github.com/Ztqing4Agents/Skills/tree/main/dev-docs-standards)) — a standardized documentation writing and organization guide for Agents to produce clear, consistent technical docs.

## Acknowledgements

This project draws inspiration from and integrates with the following open-source projects:

- **[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)** — the official DSH host framework providing plugin loading, native panel UI patterns, and the underlying skill system.
- **[dsh-market/dsh-market](https://github.com/dsh-market/dsh-market)** — a DSH plugin market ecosystem project informing extension mechanisms and package management flows.
- **[montersy123/dsh-skill-market](https://github.com/montersy123/dsh-skill-market)** — an early DSH skill market project inspiring skill catalog aggregation and distribution.
- **[michengai/dsh-skills-manager](https://github.com/michengai/dsh-skills-manager)** — an open-source DSH skills manager informing local skill state management and organization.

## License

Open source under the [MIT](LICENSE) license.
