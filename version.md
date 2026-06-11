# Minimalism UI

> 将 Obsidian 改造为极简 macOS 风格的写作环境。
> Transform Obsidian into a minimal, macOS-native writing environment.

---

## Version 1.2.8

- Added collapsible sections to the Settings panel for better organization
- Fixed single-page navigation getting stuck when navigating back through fileless views (e.g., global graph)
- Fixed breadcrumb home icon color not inheriting from surrounding items
- Theme fonts and styles are now fully embedded in the plugin bundle, ensuring they load correctly after marketplace installation

- 为设置面板添加可折叠分组，浏览更清晰
- 修复单页模式下后退经过无文件视图（如全局图谱）时导航被卡住的问题
- 修复面包屑主页图标颜色未跟随周围图标颜色的问题
- 主题字体与样式现已完整内嵌于插件包，从插件市场安装后可正确加载

---

## Version 1.2.7

- Added a home icon to the breadcrumb and improved home page detection
- Improved Forest theme styling for Bases tables, with better alignment and readability
- Fixed graph colors not always reapplying when the graph is reopened
- Fixed the single-page forward/back entrance animation occasionally not being visible

- 在面包屑导航新增主页图标，并改进主页检测
- 优化森林主题 Bases 表格样式，对齐与可读性更好
- 修复重新打开图谱时颜色不总是重新应用的问题
- 修复单页模式前进/后退入场动画极小概率才可见的问题

---

## Version 1.2.6

- Added Newspaper theme styling for Bases tables, canvas, and sidebar with a paper-like look
- Improved Forest and Newspaper sidebar and chrome colors for a more cohesive theme look
- Improved single-page navigation animations and state handling
- Improved left sidebar resize behavior and width handling
- Changed defaults so the local graph and vault profile are shown out of the box

- 为报纸主题新增 Bases 表格、白板与侧边栏的纸感样式
- 优化森林与报纸主题的侧边栏与边框配色，整体观感更统一
- 优化单页模式的导航动画与状态处理
- 优化左侧边栏的拖拽缩放行为与宽度处理
- 调整默认设置，开箱即默认显示本地图谱与仓库简介

---

## Version 1.2.5

- Added Forest theme with dynamic theme switching
- Added a "Go to home" button on Obsidian's empty view
- Added table drag-handle styling and fixed table content clipping on overflow
- Changed drag-bar tab indicator from a count number to a small dot
- Fixed single-page navigation: home note now opens reliably on rapid CMD+W close, and the page transition animation no longer triggers from the wrong tab

- 新增森林主题，支持动态切换主题
- 在 Obsidian 空页面新增回到主页按钮
- 新增表格拖拽手柄样式，修复表格内容溢出时被裁切的问题
- 拖拽栏标签页指示从数字改为小圆点
- 修复单页模式导航问题：快速 CMD+W 关闭时主页能稳定打开，页面切换动画不再由错误的标签页触发

---

## Version 1.2.1

- Fixed navigation history retaining stale entries after closing tabs
- Fixed navigation history not updating when a file is renamed
- Fixed navigation history not seeding correctly when plugin is enabled mid-session

- 修复关闭标签页后导航历史残留失效条目的问题
- 修复文件重命名后导航历史未同步更新的问题
- 修复插件在 Obsidian 运行中途启用时导航历史未正确初始化的问题

---

## Version 1.2.0

- Added breadcrumb row in the drag bar showing recent navigation history
- Added setting to strip filename timestamp prefix from breadcrumb display
- Added language toggle setting (Chinese / English)
- Added tab count indicator in the drag bar
- Fixed breadcrumb overflow detection crashing on zero-width container
- Fixed stale leaves with no file leaking into breadcrumb history
- Improved graph node label visibility in the local graph panel

- 拖拽栏新增面包屑行，展示最近导航历史
- 新增文件名前缀剥离设置，在面包屑中隐藏时间戳前缀
- 新增语言切换设置（中文 / 英文）
- 拖拽栏新增当前打开的标签页数量显示
- 修复面包屑溢出检测在容器宽度为零时崩溃的问题
- 修复无文件的失效 leaf 泄漏进面包屑历史的问题
- 优化本地图谱节点标签的可见性

---

## Version 1.1.2

### Installation

1. Download `minimalism-ui.zip` from the [Releases](../../releases) page
2. Unzip it directly into your vault's `.obsidian/plugins/` directory
3. In Obsidian: **Settings → Community Plugins → enable Minimalism UI**

The zip extracts to an `obsidian-minimalism-ui/` folder that includes `main.js`, `manifest.json`, `styles.css`, and the bundled `fonts/` directory — no extra steps needed.

### 安装

1. 在 [Releases](../../releases) 页面下载 `minimalism-ui.zip`
2. 将压缩包直接解压到库的 `.obsidian/plugins/` 目录中
3. 在 Obsidian 中：**设置 → 第三方插件 → 启用 Minimalism UI**

压缩包解压后得到 `obsidian-minimalism-ui/` 文件夹，已包含 `main.js`、`manifest.json`、`styles.css` 及 `fonts/` 目录，无需额外操作。

---

### What's New / 新增功能

- Added local graph panel to sidebar with dark color theme, resizable layout, and header controls
- Added option to show Properties panel in sidebar
- Added zoom support for Mermaid diagrams
- Increased tab cache size from 10 to 30

- 侧边栏新增本地图谱面板，支持暗色主题、动态缩放与顶部控制栏
- 新增在侧边栏显示属性面板的选项
- Mermaid 图表新增缩放功能
- 标签页缓存上限从 10 提升至 30

### Bug Fixes / 问题修复

- Fixed animation listener accumulation during rapid navigation
- Improved font rendering and line height in note style

- 修复快速导航时动画监听器堆积的问题
- 优化笔记样式的字体渲染与行高

---

## Version 1.1.1

### Installation

1. Download `minimalism-ui.zip` from the [Releases](../../releases) page
2. Unzip it directly into your vault's `.obsidian/plugins/` directory
3. In Obsidian: **Settings → Community Plugins → enable Minimalism UI**

The zip extracts to an `obsidian-minimalism-ui/` folder that includes `main.js`, `manifest.json`, `styles.css`, and the bundled `fonts/` directory — no extra steps needed.

### 安装

1. 在 [Releases](../../releases) 页面下载 `minimalism-ui.zip`
2. 将压缩包直接解压到库的 `.obsidian/plugins/` 目录中
3. 在 Obsidian 中：**设置 → 第三方插件 → 启用 Minimalism UI**

压缩包解压后得到 `obsidian-minimalism-ui/` 文件夹，已包含 `main.js`、`manifest.json`、`styles.css` 及 `fonts/` 目录，无需额外操作。

---

### What's New / 新增功能

- Removed outline-jump smooth scroll (unstable behavior on long-distance navigation, feature dropped entirely)

- 移除大纲跳转平滑滚动功能（行为在长距离跳转时不稳定，已整体下线）

### Bug Fixes / 问题修复

- Fixed callout losing its container div and breaking styles when selected in Live Preview
- Fixed missing outer border on tables in edit mode

- 修复编辑模式下 callout 被选中时外层容器消失、样式崩塌的问题
- 修复编辑模式下表格缺少外边框的问题

---

## Version 1.0.0

### Installation

1. Download `minimalism-ui.zip` from the [Releases](../../releases) page
2. Unzip it directly into your vault's `.obsidian/plugins/` directory
3. In Obsidian: **Settings → Community Plugins → enable Minimalism UI**

The zip extracts to an `obsidian-minimalism-ui/` folder that includes `main.js`, `manifest.json`, `styles.css`, and the bundled `fonts/` directory — no extra steps needed.

### 安装

1. 在 [Releases](../../releases) 页面下载 `minimalism-ui.zip`
2. 将压缩包直接解压到库的 `.obsidian/plugins/` 目录中
3. 在 Obsidian 中：**设置 → 第三方插件 → 启用 Minimalism UI**

压缩包解压后得到 `obsidian-minimalism-ui/` 文件夹，已包含 `main.js`、`manifest.json`、`styles.css` 及 `fonts/` 目录，无需额外操作。

---

### What's New / 新增功能

- **Minimal Sidebar** — Typora-style left sidebar with fixed Outline (top) and Properties (bottom).
- **Minimal Info Bar** — Hides all secondary sidebar panels (file list, search, bookmarks, etc.).
- **Note Style** — Source Han Sans for Chinese, JetBrains Mono for code/numbers; redesigned blockquotes, tables, code blocks; rounded corners with deep-blue accent.
- **Home Note** — Auto-opens a specified note on startup and returns to it when all tabs are closed.
- **Single-Page Mode** — One note at a time with smart cache (up to 30 notes) and independent navigation history (back / forward).
- **Page Transition (Beta)** — Slide-in animation when navigating: left for back, right for forward.

- **极简侧边栏** — Typora 风格左侧边栏，固定显示大纲（上）和笔记属性（下）。
- **极简信息栏** — 隐藏所有侧边栏二级面板（文件列表、搜索、书签等）。
- **笔记样式** — 中文使用思源黑体，代码/数字使用 JetBrains Mono；引用块、表格、代码块视觉重构；整体圆角，深蓝主色调。
- **笔记首页** — 启动时自动打开指定笔记，所有标签页关闭后自动跳回。
- **单页模式** — 一次只看一篇笔记，智能缓存最多 30 篇，维护独立的前进/后退导航历史。
- **页面加载动画（Beta）** — 前进/后退切换时内容区滑入动画：后退左滑，前进右滑。
