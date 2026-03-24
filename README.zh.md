# Minimalism UI — Obsidian 插件

<kbd>中文</kbd> · <kbd>[English](README.md)</kbd>

将 Obsidian 改造为极简、macOS 原生风格的写作环境。所有选项均在 **设置 → 第三方插件 → Minimalism UI** 中管理。

---

## 功能

### 极简侧边栏

为左侧边栏应用 macOS Finder 风格的磨砂玻璃效果（圆角、自定义背景）。同时重构侧边栏布局：大纲面板与属性元数据合并为一个视图——大纲在上，frontmatter 属性在下——无需切换面板即可看到笔记的完整上下文。

关闭此选项后恢复原始侧边栏布局。

### 极简信息栏

隐藏大纲、反向链接等面板中的操作按钮图标行，并移除搜索框，减少视觉干扰。

### 笔记样式

为编辑器和阅读视图应用自定义排版：

- 代码块、行内代码及编辑器字体使用 **JetBrains Mono NL**
- Forest 风格的引用块、表格和代码块
- 调整行高，阅读视图启用平滑滚动
- 从大纲面板跳转时，为当前标题添加闪光动画

### 笔记首页

指定一篇笔记作为首页，Obsidian 启动时自动打开，关闭所有标签后自动返回。在插件设置中填写路径（支持自动补全）。

### 单页模式

隐藏标签栏，每次只显示一篇笔记。附加导航功能：

- **LRU 页面缓存** — 在后台保留最近访问的 10 篇笔记，超出上限时自动关闭最旧的
- **跨标签前进/后退** — `app:go-back` / `app:go-forward` 在标签间跳转，而非只在单个标签的历史记录内导航
- 禁用标签固定功能

### 页面加载动画 *(Beta)*

在笔记历史记录中前进或后退时，为目标页面播放滑入动画。

---

## 设置项

| 选项 | 说明 |
|---|---|
| 极简侧边栏 | Finder 风格侧边栏 + 大纲与属性合并布局 |
| 极简信息栏 | 隐藏面板操作按钮和搜索框 |
| 笔记样式 | JetBrains Mono、Forest 风格块元素、平滑滚动、标题闪光 |
| 笔记首页 | 启动及关闭所有标签时自动打开的笔记路径 |
| 单页模式 | 单笔记视图 + LRU 缓存 + 跨标签历史导航 |
| 页面加载动画 | 前进/后退时的滑入动画 |

---

## 安装

1. 在 [Releases](../../releases) 页面下载 `minimalism-ui.zip`
2. 将压缩包直接解压到库的 `.obsidian/plugins/` 目录中
3. 在 Obsidian 中：**设置 → 第三方插件 → 启用 Minimalism UI**

压缩包解压后得到 `obsidian-minimalism-ui/` 文件夹，已包含 `main.js`、`manifest.json`、`styles.css` 及 `fonts/` 目录，无需额外操作。

---

## 开发

```bash
git clone https://github.com/your-username/obsidian-minimalism-ui.git
cd obsidian-minimalism-ui
npm install

npm run build   # 生产构建 → main.js
npm run dev     # 监听模式 — 修改 main.ts 后自动重新构建
```

本地测试时，将项目目录软链接到你的库的插件文件夹：

```bash
ln -s $(pwd) ~/your-vault/.obsidian/plugins/obsidian-minimalism-ui
```

修改 `main.ts` 后，运行 `npm run build`，然后在 Obsidian 中重新加载插件（在社区插件列表中按 **Ctrl/Cmd+R**）。

---

## 许可证

MIT
