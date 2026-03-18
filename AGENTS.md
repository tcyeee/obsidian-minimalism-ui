# AGENTS.md

本文件为 AI Agent（如 Claude Code、Cursor、Copilot 等）在此项目中的协作规范。

## 项目背景

这是一个 **Obsidian TypeScript 插件**项目，目标是将 Obsidian 改造为类 macOS 原生应用的极简风格。
插件核心约束：左侧信息面板必须始终存在，不可被用户关闭。

## 代码规范

- **语言**：TypeScript（严格模式，`strictNullChecks: true`）
- **构建**：esbuild，产物为 `main.js`（CommonJS 格式）
- **样式**：单文件 `styles.css`，优先使用 Obsidian CSS 变量（`var(--xxx)`）
- **注释语言**：中文（与项目保持一致）

## 修改规则

### main.ts
- 所有设置字段需同步更新：`MinimalismUISettings` 接口 → `DEFAULT_SETTINGS` → `saveSettings()` 中的刷新逻辑 → `MinimalismUISettingTab.display()` 中的 UI
- 视图类型常量 `VIEW_TYPE_NOTE_INFO` 不可更改，否则已保存的布局会找不到视图
- `ensureNoteInfoOpen()` 是核心保障逻辑，不可删除或弱化

### styles.css
- Mac 风格样式统一放在 `.minimalism-ui-mac-style` 父选择器下，确保可开关
- 隐藏类样式统一用 `display: none !important` 并放在对应 body class 选择器下

### manifest.json
- 修改版本号时同步更新 `versions.json` 和 `package.json`

## 构建 & 验证

每次修改 `main.ts` 后必须运行构建并确认无报错：

```bash
npm run build
```

构建成功标志：无 stderr 输出，`main.js` 更新时间刷新。

## 禁止事项

- 不要修改 `customer-ui.css`（旧版 CSS snippet，独立维护，不属于插件）
- 不要在 `styles.css` 中硬编码颜色值，优先使用 Obsidian CSS 变量
- 不要使用 `app.workspace.activeLeaf`（已废弃），改用 `app.workspace.getActiveFile()`
- 不要在插件卸载（`onunload`）后遗留 DOM 修改或事件监听
