# CLAUDE.md

This file provides guidance for Claude Code when working in this project.

## Project Overview

**obsidian-minimalism-ui** is an Obsidian plugin that transforms Obsidian into a minimal, macOS-native-style application. Core features:

- **极简侧边栏** — Finder-style frosted-glass sidebar with rounded corners
- **极简信息栏** — Hides sidebar panel buttons and Outline/Backlinks search bars
- **笔记样式** — Custom typography: JetBrains Mono, Forest-style blockquotes/tables/code
- **笔记首页** — Auto-opens a designated note on startup; returns to it when all tabs are closed
- **单页模式** — Hides the tab bar, shows one note at a time, caches the last 10 notes (LRU), disables pin
- **页面加载动画** — Slide-in animation on back/forward navigation (Beta)

All settings are managed at Settings → Community Plugins → Minimalism UI.

## File Structure

```
obsidian-minimalism-ui/
├── main.ts                    # Plugin entry point — coordinates all managers
├── main.js                    # Build output (esbuild, must be committed)
├── styles.css                 # All plugin styles (auto-loaded by Obsidian)
├── manifest.json              # Plugin metadata (id/name/version/minAppVersion)
├── versions.json              # Version compatibility map
├── customer-ui.css            # Legacy CSS snippet (reference only, not part of build)
├── esbuild.config.mjs         # Build configuration
├── package.json
├── tsconfig.json
└── src/
    ├── settings.ts            # MinimalismUISettings interface + DEFAULT_SETTINGS
    ├── SettingTab.ts          # Settings UI (MinimalismUISettingTab + FileSuggest)
    ├── TabCacheManager.ts     # Single-page mode: tab cache, nav history, back/forward, animations
    └── DragBarManager.ts      # Custom drag bar (title + status-bar) when tab bar is hidden
```

## Dev Commands

```bash
npm install        # Install dependencies
npm run dev        # Watch mode — rebuilds main.js on changes to main.ts
npm run build      # Production build
```

## Build Output

Obsidian requires these three files to load a plugin:
- `main.js` — compiled plugin code
- `manifest.json` — plugin metadata
- `styles.css` — styles

**`main.js` must be committed to Git** — users installing from GitHub use the build output directly.

## Settings

| Setting key | UI name | Toggled body class | Notes |
|---|---|---|---|
| `macSidebar` | 极简侧边栏 | `minimalism-ui-mac-sidebar` | |
| `hideTabBar` | 极简信息栏 | `minimalism-ui-hide-tab-bar` | Also sets `simplifyPanel` |
| `simplifyPanel` | (tied to hideTabBar) | `minimalism-ui-simplify-panel` | |
| `noteStyle` | 笔记样式 | `minimalism-ui-note-style` | |
| `homePage` | 笔记首页 | — | Path string, triggers `applyHomePage()` |
| `disableNoteTabs` | 单页模式 | `minimalism-ui-disable-note-tabs` | Also sets `disablePinTab` + `enableLeafCache` |
| `disablePinTab` | (tied to 单页模式) | `minimalism-ui-disable-pin` | |
| `enableLeafCache` | (tied to 单页模式) | — | Enables 10-tab LRU cap in TabCacheManager |
| `enableNavAnimation` | 页面加载动画 | — | Slide animation on back/forward |

## Key APIs

| API | Purpose |
|---|---|
| `Plugin` | Base class for the plugin |
| `PluginSettingTab` + `AbstractInputSuggest` | Settings page with file path autocomplete |
| `workspace.getLeaf()` (monkey-patched) | Redirect in-place navigation to new tabs in single-page mode |
| `workspace.on('active-leaf-change')` | Tab LRU eviction, cross-tab navigation history tracking, nav animations |
| `workspace.on('file-open')` | Detect empty-file events to trigger home page fallback |
| `workspace.on('layout-change')` | Re-insert drag bar after Obsidian rebuilds DOM |
| `vault.on('rename')` | Update drag bar title when active file is renamed |
| `leaf.history.back/forward/canGoBack/canGoForward` (patched) | Redirect built-in back/forward to cross-tab navigation stack |
| `FontFace` API | Load JetBrains Mono NL from plugin `fonts/` directory |

## Graph Color Architecture (Local Graph)

Obsidian 的 graph 渲染器通过 `renderer.testCSS()` 方法读取颜色——它在 `document.body` 上临时创建 `.graph-view.color-*` 元素，读取 `getComputedStyle().color`，然后立即 detach。颜色以 `{a: alpha, rgb: integer}` 格式存入 `renderer.colors`，再传给 WebGL 渲染。

**关键结论：**

- CSS 变量（`--graph-color-text` 等）**无效**，renderer 不读取变量，只读 `color` 属性
- scoped CSS（如 `.minimalism-ui-injected-graph .graph-view.color-text`）**无效**，因为元素临时挂在 `body` 上，不在容器内
- 必须用**全局规则** `.graph-view.color-text { color: ... }` 才能命中
- 改完 CSS 后必须调用 `renderer.testCSS()` 才会重新读取并触发重绘

**正确的插件实现方式（JS）：**

```typescript
// 1. 向 document.head 注入全局 style（插件 unload 时移除）
const style = document.createElement('style');
style.textContent = '.graph-view.color-text { color: white !important; }';
document.head.appendChild(style);

// 2. 获取 renderer 并触发重新读取颜色
const leaf = this.app.workspace.getLeavesOfType('localgraph')[0];
const renderer = (leaf?.view as any)?.renderer;
renderer?.testCSS?.();
```

**renderer 对象关键属性：**

| 属性/方法 | 说明 |
|---|---|
| `renderer.colors` | 当前颜色表 `{fill, fillFocused, text, line, arrow, ...}` |
| `renderer.testCSS()` | 重新从 DOM 读取所有颜色并触发重绘 |
| `renderer.setRenderOptions({nodeSizeMultiplier, lineSizeMultiplier, ...})` | 设置渲染参数 |
| `renderer.queueRender()` | 排队一次重绘 |
| `renderer.iframeEl` | graph 内部的 iframe 元素（内含显示用 canvas） |

**graph 颜色 CSS class 对应表：**

| CSS class | 对应颜色 |
|---|---|
| `.graph-view.color-text` | 节点标签字体色 |
| `.graph-view.color-fill` | 节点填充色 |
| `.graph-view.color-fill-focused` | 选中节点填充色 |
| `.graph-view.color-fill-unresolved` | 未解析链接节点色 |
| `.graph-view.color-fill-attachment` | 附件节点色 |
| `.graph-view.color-fill-tag` | 标签节点色 |
| `.graph-view.color-circle` | 节点边框色 |
| `.graph-view.color-arrow` | 箭头色 |
| `.graph-view.color-line` | 连线色 |

## Architecture Notes

- **TabCacheManager** monkey-patches `workspace.getLeaf()` to force new-tab navigation, injects a one-time `openFile` interceptor per leaf for cache lookup, and maintains a cross-tab `navHistory`/`navFuture` stack. `pendingInterceptLeaves` tracks leaves created by the patch but not yet loaded — used to prevent the home page handler from hijacking them (e.g. Cmd+N new note).
- **DragBarManager** creates a `minimalism-ui-drag-bar` div at the top of the workspace and physically moves the `.status-bar` DOM element into it. `remove()` restores the status-bar to its original position.
- **Fonts** are loaded via the FontFace API because Obsidian's CSP blocks `url()` in CSS `@font-face` for plugin files.
- The right sidebar is hidden entirely via CSS (`display: none`) on `.workspace-split.mod-right-split`, not via workspace API calls.
- When bumping plugin version, update `manifest.json`, `versions.json`, and `package.json` in sync.
