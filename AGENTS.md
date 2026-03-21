# AGENTS.md

This file defines collaboration guidelines for AI agents (Claude Code, Cursor, Copilot, etc.) working in this project.

## Project Background

This is an **Obsidian TypeScript plugin** that transforms Obsidian into a minimal, macOS-native-style application. The plugin has no custom panel view (ItemView was removed); all UI is achieved through CSS class toggles on `document.body` and targeted DOM manipulation by `DragBarManager`.

## Code Standards

- **Language**: TypeScript (strict mode, `strictNullChecks: true`)
- **Build**: esbuild, output is `main.js` (CommonJS format, must be committed)
- **Styles**: single file `styles.css`; prefer Obsidian CSS variables (`var(--xxx)`) over hardcoded values; hardcoded values are acceptable for Forest-theme color tokens (`#00997B`, `#DADCDE`, `#81888D`)
- **Comments**: Chinese for intent/context, English for type annotations and section headers

## Module Responsibilities

| File | Responsibility |
|---|---|
| `main.ts` | Plugin lifecycle, coordinates managers, body class application, pin block, home page handler, font loading |
| `src/settings.ts` | `MinimalismUISettings` interface + `DEFAULT_SETTINGS` — single source of truth for all settings |
| `src/SettingTab.ts` | Settings UI only; no side effects beyond calling `plugin.saveSettings()` |
| `src/TabCacheManager.ts` | Single-page mode: `getLeaf` patch, LRU eviction, cross-tab nav history, back/forward, slide animations |
| `src/DragBarManager.ts` | Drag bar DOM creation, title updates, status-bar relocation, cleanup |

## Modification Rules

### Adding a new setting
Update all four locations in sync:
1. `MinimalismUISettings` interface in `src/settings.ts`
2. `DEFAULT_SETTINGS` in `src/settings.ts`
3. `saveSettings()` in `main.ts` (call the relevant `apply*()` method)
4. `display()` in `src/SettingTab.ts` (add UI toggle/input)

Also add the corresponding body class toggle in `applyBodyClasses()` if the setting controls a CSS feature.

### TabCacheManager
- `pendingInterceptLeaves` guards against the home page handler hijacking newly created leaves (e.g. Cmd+N). Do not remove this check.
- `isReusingLeaf` and `isEvicting` are re-entrancy guards — do not remove.
- The cross-tab nav stack (`navHistory` / `navFuture`) is maintained independently of Obsidian's per-leaf history. Both are patched via `patchLeafHistory()`, which must be called for every leaf that enters the workspace under single-page mode.
- `navigateBack()` and `navigateForward()` snapshot state before iterating so that stale (detached) leaves in the history can be skipped without polluting the stacks.

### DragBarManager
- The status-bar DOM element is physically moved (not cloned) into the drag bar. `remove()` must restore it to `statusBarOriginalParent` / `statusBarOriginalNextSibling`.
- The drag bar is re-inserted on `layout-change` because Obsidian can rebuild the `.workspace-tabs` DOM when tabs are closed.

### styles.css
- Feature-scoped rules must be nested under the corresponding body class selector (e.g. `.minimalism-ui-note-style`, `.minimalism-ui-mac-sidebar`) so they activate and deactivate with the setting toggle.
- Hide rules use `display: none !important`.
- Table styles target both `.markdown-reading-view table` (reading view) and `.el-table` / `.el-table table` (Obsidian Bases view).

### manifest.json
- When bumping the version, update `versions.json` and `package.json` in sync.

## Build & Verify

After every change to any `.ts` file, run the build and confirm no errors:

```bash
npm run build
```

Success: no stderr output, `main.js` timestamp updated.

## Do Not

- Modify `customer-ui.css` — legacy CSS snippet, not part of the plugin build
- Use `app.workspace.activeLeaf` (deprecated) — use `app.workspace.getActiveFile()` or event callback arguments instead
- Use `app.vault.adapter.read()` for plugin-internal data — use `this.loadData()` / `this.saveData()`
- Leave DOM modifications or event listeners behind after `onunload` — every `apply()` must have a matching `remove()`
- Add a new manager class without wiring `apply()` and `remove()` into `main.ts` `onload` / `onunload`
- Introduce a `VIEW_TYPE_*` constant without documenting it — saved layouts reference view type strings by name and cannot be renamed without migration
