# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-09

### Added

- 侧栏新增「技能」一行，点开是一页技能面板：内置 / 本地 / 已安装三组分开列出。
- 每行右侧一个开关，点击即启用或停用该技能；写盘成功后下一轮会话即可见。
- 软链技能显示「软链·只读」标记、不渲染开关；服务端同样拒绝写入并返回 409。
- 页脚提示「另有 N 个技能位于项目级或其他目录」，首版不扫描这些根。
- 「＋ 添加技能」按钮与刷新、报错、空态均已就位（禁用态与占位文案的边界见 README「已知限制」）。
