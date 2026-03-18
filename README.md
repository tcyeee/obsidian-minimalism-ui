# Minimalism UI — Obsidian Plugin

将 Obsidian 改造为类 macOS 原生应用风格。左侧固定展示当前笔记的状态信息，右侧专注笔记内容，外观配置统一在设置页面管理。

---

## 功能

### 左侧固定信息面板
- 笔记标题、标签、Frontmatter 属性
- 创建时间 / 最后修改时间
- 字数统计（词数 + 字符数）
- 出链 / 入链统计

面板由插件强制保持打开，无法被关闭或拖离左侧栏。`Cmd+\` / `Ctrl+\` 关闭侧边栏的快捷键也会被拦截。

### macOS 原生外观
- 系统字体（`-apple-system` / SF Pro）
- Accent 蓝色标签样式
- 左侧边栏圆角处理

### 统一设置页面
所有外观与面板内容选项均在：**设置 → 第三方插件 → Minimalism UI**

| 选项 | 说明 |
|---|---|
| macOS 原生风格 | 系统字体、圆角等视觉优化 |
| 隐藏顶部标签栏 | 隐藏多标签页切换栏 |
| 隐藏文件区导航按钮 | 隐藏左侧文件栏上方图标 |
| 隐藏右侧边栏 | 实现视觉上的左+内容二栏布局 |
| 左侧面板各项开关 | 按需展示标题/标签/时间/字数/链接 |

---

## 安装

### 手动安装（推荐）

1. 下载本仓库的 `main.js`、`manifest.json`、`styles.css`
2. 在你的 vault 中创建目录：`.obsidian/plugins/obsidian-minimalism-ui/`
3. 将三个文件复制进去
4. 在 Obsidian 中：设置 → 第三方插件 → 关闭安全模式 → 启用 **Minimalism UI**

```
你的vault/
└── .obsidian/
    └── plugins/
        └── obsidian-minimalism-ui/
            ├── main.js
            ├── manifest.json
            └── styles.css
```

---

## 开发

### 环境准备

```bash
git clone https://github.com/your-username/obsidian-minimalism-ui.git
cd obsidian-minimalism-ui
npm install
```

### 构建

```bash
npm run build    # 生产构建，输出 main.js
npm run dev      # 监听模式，修改 main.ts 后自动重建
```

### 本地调试

将整个项目目录软链到 vault 的插件目录，然后在 Obsidian 中启用插件：

```bash
ln -s $(pwd) ~/你的vault/.obsidian/plugins/obsidian-minimalism-ui
```

修改 `main.ts` 后运行 `npm run build`，再在 Obsidian 中执行「重新加载插件」即可看到效果。

---

## 已知限制

- Obsidian 底层是三栏架构（左栏 + 主区域 + 右栏），无法在代码层面改为二栏；右栏通过 CSS `display: none` 隐藏
- 切换非默认主题时，部分 CSS 变量覆盖可能不生效
- `getBacklinksForFile` 为 Obsidian 内部 API，后续版本若变更可能影响入链统计

---

## License

MIT
