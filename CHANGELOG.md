# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- 技能图标改为首字母彩色头像：48px 圆角色块 + 技能名首字母，色块颜色由技能名稳定决定（12 组粉彩色板，按色相 30° 等分，字母对比度全部 ≥4.5:1，同名恒同色），深色模式沿用同一套粉彩底；图标容器仍是宿主原样式与边框。此前所有技能共用同一个灰色描边图标。

### Fixed

- 技能行的图标与行高不再被边框撑大 2px：图标回到 48×48，行高回到 64px。

## [0.1.0] - 2026-11-09

### Added

- 侧栏新增「技能」一行，点开是一页技能面板：内置 / 本地 / 已安装三组分开列出。
- 每行右侧一个开关，点击即启用或停用该技能；写盘成功后下一轮会话即可见。
- 软链技能显示「软链·只读」标记、不渲染开关；服务端同样拒绝写入并返回 409。
- 页脚提示「另有 N 个技能位于项目级或其他目录」，首版不扫描这些根。
- 「＋ 添加技能」按钮与刷新、报错、空态均已就位（禁用态与占位文案的边界见 README「已知限制」）。
