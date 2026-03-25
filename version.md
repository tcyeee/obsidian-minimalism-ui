# Minimalism UI

> 将 Obsidian 改造为极简 macOS 风格的写作环境。
> Transform Obsidian into a minimal, macOS-native writing environment.

---

## Version 1.1.1

- Removed outline-jump smooth scroll (unstable behavior on long-distance navigation, feature dropped entirely)
- Fixed callout losing its container div and breaking styles when selected in Live Preview
- Fixed missing outer border on tables in edit mode

- 移除大纲跳转平滑滚动功能（行为在长距离跳转时不稳定，已整体下线）
- 修复编辑模式下 callout 被选中时外层容器消失、样式崩塌的问题
- 修复编辑模式下表格缺少外边框的问题

---

## Version 1.0.0

- Left sidebar restyled with frosted glass; Outline and Properties merged into a single fixed view, fully restored on toggle-off
- Hides sidebar icon buttons and search bars in Outline / Backlinks panels
- Code font **JetBrains Mono NL**, Chinese body in Source Han Sans; custom styles for blockquotes, tables, and code blocks
- Set a note path to auto-open on startup and return to when all tabs are closed
- Single-page mode: hides tab bar, LRU-caches the 10 most recent notes, maintains cross-tab back / forward history
- Page transition animation (Beta): content slides in from left or right on back / forward navigation

- 左侧边栏改为磨砂玻璃风格，固定合并显示**大纲**与**笔记属性**，关闭后完整还原
- 隐藏侧边栏图标按钮及大纲 / 反向链接面板中的搜索框
- 代码字体 **JetBrains Mono NL**，中文思源黑体；引用块、表格、代码块独立视觉风格
- 指定一个笔记路径，启动时自动打开，关闭所有标签后自动回到该笔记
- 单页模式：隐藏标签栏，后台 LRU 缓存最近 10 篇笔记，维护独立跨标签浏览历史，支持前进 / 后退
- 页面过渡动画（Beta）：前进 / 后退时内容区从左或右滑入
