# Minimalism UI

> 将 Obsidian 改造为极简 macOS 风格的写作环境。
> Transform Obsidian into a minimal, macOS-native writing environment.

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

### What's New / 更新内容

- Removed outline-jump smooth scroll (unstable behavior on long-distance navigation, feature dropped entirely)
- Fixed callout losing its container div and breaking styles when selected in Live Preview
- Fixed missing outer border on tables in edit mode

- 移除大纲跳转平滑滚动功能（行为在长距离跳转时不稳定，已整体下线）
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

### What's New / 更新内容

- **Minimal Sidebar** — Typora-style left sidebar with fixed Outline (top) and Properties (bottom).
- **Minimal Info Bar** — Hides all secondary sidebar panels (file list, search, bookmarks, etc.).
- **Note Style** — Source Han Sans for Chinese, JetBrains Mono for code/numbers; redesigned blockquotes, tables, code blocks; rounded corners with deep-blue accent.
- **Home Note** — Auto-opens a specified note on startup and returns to it when all tabs are closed.
- **Single-Page Mode** — One note at a time with smart cache (up to 30 notes) and independent navigation history (back / forward).
- **Page Transition (Beta)** — Slide-in animation when navigating: left for back, right for forward.

---

- **极简侧边栏** — Typora 风格左侧边栏，固定显示大纲（上）和笔记属性（下）。
- **极简信息栏** — 隐藏所有侧边栏二级面板（文件列表、搜索、书签等）。
- **笔记样式** — 中文使用思源黑体，代码/数字使用 JetBrains Mono；引用块、表格、代码块视觉重构；整体圆角，深蓝主色调。
- **笔记首页** — 启动时自动打开指定笔记，所有标签页关闭后自动跳回。
- **单页模式** — 一次只看一篇笔记，智能缓存最多 30 篇，维护独立的前进/后退导航历史。
- **页面加载动画（Beta）** — 前进/后退切换时内容区滑入动画：后退左滑，前进右滑。

