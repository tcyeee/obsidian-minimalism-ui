# AGENTS.md

This file defines collaboration guidelines for AI agents (Claude Code, Cursor, Copilot, etc.) working in this project.

## Project Background

This is an **Obsidian TypeScript plugin** that transforms Obsidian into a minimal macOS-native-style application.
Core constraint: the left info panel must always be present and cannot be closed by the user.

## Code Standards

- **Language**: TypeScript (strict mode, `strictNullChecks: true`)
- **Build**: esbuild, output is `main.js` (CommonJS format)
- **Styles**: single file `styles.css`, prefer Obsidian CSS variables (`var(--xxx)`) over hardcoded values
- **Comments**: English

## Modification Rules

### main.ts
- When adding a setting, update all four locations in sync: `MinimalismUISettings` interface → `DEFAULT_SETTINGS` → refresh logic in `saveSettings()` → UI in `MinimalismUISettingTab.display()`
- The view type constant `VIEW_TYPE_NOTE_INFO` must not be changed — saved layouts reference it by name
- `ensureNoteInfoOpen()` is the core guarantee logic — do not remove or weaken it

### styles.css
- macOS-style rules go under the `.minimalism-ui-mac-style` parent selector so they can be toggled
- Hide rules use `display: none !important` scoped under the corresponding body class selector

### manifest.json
- When bumping the version, update `versions.json` and `package.json` in sync

## Build & Verify

After every change to `main.ts`, run the build and confirm no errors:

```bash
npm run build
```

Success: no stderr output, `main.js` timestamp updated.

## Do Not

- Modify `customer-ui.css` — it is a legacy CSS snippet maintained separately, not part of the plugin
- Hardcode color values in `styles.css` — use Obsidian CSS variables instead
- Use `app.workspace.activeLeaf` (deprecated) — use `app.workspace.getActiveFile()` instead
- Leave DOM modifications or event listeners behind after `onunload`
