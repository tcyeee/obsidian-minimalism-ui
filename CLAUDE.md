# CLAUDE.md

本文件为 Claude Code 在此项目中的工作指南。

## 项目简介

**obsidian-minimalism-ui** 是一个 Obsidian 插件，将 Obsidian 改造为类 macOS 原生应用风格：
- 左侧固定信息面板，展示当前笔记的元数据（标题、标签、时间、字数、链接）
- 左侧面板由插件强制保持打开，用户无法关闭或拖动
- 所有外观配置统一在设置页面（设置 → 第三方插件 → Minimalism UI）

## 文件结构

```
obsidian-minimalism-ui/
├── main.ts          # 插件主逻辑（TypeScript 源码）
├── main.js          # 构建产物（由 esbuild 生成，需提交）
├── styles.css       # 插件样式（随插件自动加载）
├── manifest.json    # 插件元数据（id/name/version/minAppVersion）
├── versions.json    # 版本兼容性映射
├── customer-ui.css  # 旧版 CSS snippet（保留，不参与插件构建）
├── esbuild.config.mjs  # 构建配置
├── package.json
└── tsconfig.json
```

## 开发命令

```bash
npm install        # 安装依赖
npm run dev        # 监听模式（修改 main.ts 后自动重新构建 main.js）
npm run build      # 生产构建
```

## 构建产物说明

Obsidian 插件加载时需要以下三个文件：
- `main.js` — 编译后的插件代码
- `manifest.json` — 插件元数据
- `styles.css` — 样式

**`main.js` 必须提交到 Git**，因为用户从 GitHub 安装插件时直接使用构建产物。

## 关键 API

| API | 用途 |
|---|---|
| `Plugin` | 插件基类 |
| `ItemView` | 自定义左侧面板视图 |
| `PluginSettingTab` | 设置页面 |
| `workspace.on('layout-change')` | 监听布局变化，面板关闭时自动重开 |
| `metadataCache.getFileCache()` | 获取笔记标签、frontmatter、链接 |
| `(metadataCache as any).getBacklinksForFile()` | 获取入链（内部 API，无类型定义） |

## 注意事项

- `getBacklinksForFile` 是 Obsidian 内部 API，类型定义中不存在，需要 `as any` 访问
- 插件通过监听 `keydown`（capture 阶段）拦截 `Cmd+\` / `Ctrl+\`，阻止关闭左侧边栏
- Obsidian 是三栏架构（左栏 + 主区域 + 右栏），无法底层改为二栏；右栏通过 CSS 隐藏实现二栏视觉效果
- `styles.css` 中的 CSS 变量覆盖依赖 Obsidian 默认主题变量名，切换第三方主题时可能需要适配
