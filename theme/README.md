# Theme Authoring Guide

Purpose: let an AI (or human) **create or modify a note theme fast**. A theme controls only the
*note content* aesthetics (typography, blockquotes, code, tables, scrollbars, callouts, Mermaid).
It does **not** touch the plugin chrome (sidebar, drag bar, breadcrumb, tab hiding) — that lives in
the repo-root `styles.css` and is theme-independent.

If you only read one thing: **scope every rule under `body.minimalism-ui-theme-<name>`.** That is the
single contract that keeps themes from colliding.

---

## 1. File layout

Each theme is one folder under `theme/`:

```
theme/
└── <name>/
    ├── <name>.css     # required — the stylesheet (must match the folder name)
    ├── <name>.md      # optional — design notes / palette reference (not loaded at runtime)
    └── fonts/         # optional — bundled font files (see §6 for the hard constraint)
```

- `forest/` is the reference theme — copy it as a starting point.
- The folder name **is** the theme name. `<name>.css` must be named identically (e.g. `ocean/ocean.css`).
- A theme is "registered" simply by existing: `ThemeLoader.listThemes()` discovers themes by listing
  subfolders of `theme/`, so a new folder auto-appears in **Settings → Minimalism UI → theme** dropdown.
- The default theme is set in `src/core/settings.ts` (`DEFAULT_SETTINGS.theme`). Don't change it just
  to test — switch in the settings dropdown instead.

## 2. How a theme loads (so you know what to rely on)

- `ThemeLoader.apply()` reads the current `theme` setting, reads `theme/<name>/<name>.css` via
  `vault.adapter.read`, injects it into a `<style data-minimalism-theme="<name>">` element, and adds
  `body.minimalism-ui-theme-<name>`.
- On switch, the previous `<style>` is removed and the previous `minimalism-ui-theme-*` body class is
  cleared. **Only one theme's CSS is ever in the DOM at a time** — you never need to "undo" another
  theme's rules, but you also cannot rely on another theme's variables.
- A missing/empty `<name>.css` is silently skipped (the body class is still set), so a stub theme is
  harmless.

## 3. The two-tier scope model — the golden rule

Two body classes exist:

| Body class | Meaning | Who sets it |
|---|---|---|
| `minimalism-ui-note-style` | **Theme-agnostic baseline** — always on, shared by every theme. Reserved shared extension point; put a rule here only if it should apply under *every* theme. | `BodyClassController` (always) |
| `minimalism-ui-theme-<name>` | **This theme only.** | `ThemeLoader` (current theme) |

**Write 99% of your rules under `body.minimalism-ui-theme-<name>`.** This is non-negotiable: it is how
"which theme is active" becomes expressible in a selector and how themes stay isolated.

```css
/* CSS-variable overrides can use the bare class (it lands on <body>): */
.minimalism-ui-theme-ocean {
    --blockquote-background-color: rgba(0, 119, 153, 0.05);
    --link-decoration: none;
    --line-height-normal: 1.6;
}

/* Element rules use the full body-scoped selector: */
body.minimalism-ui-theme-ocean .markdown-reading-view blockquote { /* ... */ }
```

## 4. Selector idioms — always handle BOTH views

Obsidian renders notes in two completely different DOM trees. **A theme must style both** or it will
look right in one mode and broken in the other.

| Target | Reading view (rendered HTML) | Edit view (CodeMirror 6 / Live Preview) |
|---|---|---|
| Body text root | `.markdown-reading-view .markdown-preview-section` | `.cm-editor .cm-content`, `.cm-line`, `.cm-scroller` |
| Headings | `.markdown-preview-section h1`…`h6` | `.cm-line` (size via `--hX-size` vars) |
| Blockquote | `.markdown-reading-view blockquote` | `.cm-line.HyperMD-quote`, `.cm-blockquote-border` |
| Internal link | `.markdown-reading-view a.internal-link` | `.cm-editor .cm-hmd-internal-link` |
| Code (fenced/inline) | `.markdown-reading-view code` / `pre` | `.cm-editor .cm-inline-code` / `.HyperMD-codeblock` |
| Table | `.markdown-reading-view table` | `.table-wrapper table.table-editor` |
| Scrollbar | `.markdown-reading-view ::-webkit-scrollbar` | `.cm-scroller::-webkit-scrollbar` |

Pattern (group the two views in one rule when the declarations match):

```css
body.minimalism-ui-theme-ocean .markdown-reading-view .markdown-preview-section,
body.minimalism-ui-theme-ocean .cm-editor .cm-content {
    font-family: 'JetBrains Mono NL', 'PingFang SC', 'Microsoft YaHei', sans-serif;
    line-height: 1.74;
    word-break: break-word;
}
```

## 5. Prefer overriding Obsidian's CSS variables

Many things are cleaner set as variables on the theme class than as element rules. Common ones:

```css
.minimalism-ui-theme-ocean {
    --line-height-normal: 1.6;
    --blockquote-background-color: …;
    --blockquote-border-color: transparent;
    --blockquote-border-thickness: 0px;
    --blockquote-color: …;
    --blockquote-font-style: normal;
    --link-decoration: none;
    --link-decoration-hover: none;
    --link-unresolved-decoration: none;
}
```

Override the variable first; only add an explicit element rule as a fallback when the variable doesn't
cover the case (e.g. Live-Preview link underlines).

## 6. Fonts — read this before bundling any

**Hard constraint:** `src/core/FontLoader.ts` hardcodes the *filenames* `JetBrainsMonoNL-*.ttf` and the
*family names* `JetBrains Mono` / `JetBrains Mono Digits`. It loads them from
`theme/<current-theme>/fonts/`. It does **not** scan the folder. Consequences:

- A bundled font file is only picked up if it is named **exactly** one of the eight
  `JetBrainsMonoNL-{Regular,Italic,Medium,MediumItalic,Bold,BoldItalic,ExtraBold,ExtraBoldItalic}.ttf`.
- To ship a *different* bundled font you must edit `FontLoader.ts` (add `loadFontFace` calls with the new
  files/family). That is a code change, not just a CSS/asset change — flag it explicitly.
- The low-friction path: **don't bundle fonts.** Just reference system / web-safe families in
  `font-family` stacks in your CSS. The theme still works; it simply won't carry its own font binary.
- Missing font files are swallowed silently, so a theme with no `fonts/` folder is fine.

## 7. Lint rules (CI / submission bot will reject otherwise)

- **No `!important`.** Raise specificity by stacking class names instead (e.g.
  `body.minimalism-ui-theme-ocean.minimalism-ui-mac-sidebar …`).
- **Full 6-digit hex** — `#00997b`, never `#097` / `#0097`.
- **No duplicate selectors** — merge declarations into one rule.
- Run the `obsidian-plugin-lint` skill before finishing.

## 8. Quick start checklist

1. `cp -r theme/forest theme/<name>` then rename `forest.css` → `<name>.css` (and `forest.md` → `<name>.md`).
2. Global-replace `minimalism-ui-theme-forest` → `minimalism-ui-theme-<name>` inside `<name>.css`.
3. Decide fonts: keep JetBrains (leave `fonts/` as-is), or delete `fonts/` and use CSS font stacks
   (see §6 — anything else needs a `FontLoader.ts` edit).
4. Edit colors/typography. Keep every rule under `body.minimalism-ui-theme-<name>`. Cover both views (§4).
5. Build (`pnpm build`), reload the plugin in Obsidian, select the theme in Settings, verify in **both**
   reading and edit mode, light and dark.
6. Lint, then commit.
