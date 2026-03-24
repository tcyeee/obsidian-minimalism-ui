# Minimalism UI

> 将 Obsidian 改造为极简 macOS 风格的写作环境。
> Transform Obsidian into a minimal, macOS-native writing environment.

---

## 极简侧边栏 · Minimal Sidebar

左侧边栏切换为磨砂玻璃风格，固定显示**大纲**（上）与**笔记属性**（下），无需切换面板。关闭后恢复原始布局。

The left sidebar gets a frosted-glass look with rounded corners. Outline and Properties are merged into a single fixed view. Toggling off fully restores the original layout.

---

## 极简信息栏 · Minimal Info Bar

隐藏侧边栏图标按钮、大纲与反向链接面板中的搜索框，减少视觉干扰。

Hides sidebar icon buttons and search bars in the Outline / Backlinks panels.

---

## 笔记样式 · Note Style

- 代码使用 **JetBrains Mono NL**，中文使用思源黑体
- 引用块、表格、代码块有独立视觉风格
- 阅读视图平滑滚动；从大纲跳转时当前标题闪光提示

- Code uses **JetBrains Mono NL**; Chinese body text uses Source Han Sans
- Custom styles for blockquotes, tables, and code blocks
- Smooth scroll in reading view; heading flash on Outline jump

---

## 笔记首页 · Home Note

填入一个笔记路径后，Obsidian 启动时自动打开，关闭所有标签后自动返回。

Set a note path to auto-open on startup and return to when all tabs are closed.

---

## 单页模式 · Single-Page Mode

隐藏标签栏，一次只显示一篇笔记，同时：

- 后台保留最近 10 篇笔记（LRU 缓存），切换无闪烁
- 维护独立的跨标签浏览历史，支持前进 / 后退
- 焦点在侧边栏时，前进 / 后退快捷键同样生效

Hides the tab bar and shows one note at a time:

- Keeps the 10 most recent notes cached in the background (LRU); switching is instant
- Maintains a cross-tab navigation history with back / forward support
- Back / forward shortcuts work even when focus is in a sidebar panel

---

## 页面加载动画 · Page Transition · *(Beta)*

前进 / 后退切换笔记时，内容区从左或右滑入。

Slide-in animation when navigating back or forward through note history.
