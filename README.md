# Minimalism UI — Obsidian Plugin

Transform Obsidian into a macOS-native-style application. The left sidebar displays current note metadata at a glance; the right column stays hidden so you can focus on content. All appearance options are managed in one settings page.

---

## Features

### Left Info Panel (fixed)

- Note title, tags, and frontmatter properties
- Created / last modified timestamps
- Word and character count
- Outgoing and incoming link counts

The panel is kept open by the plugin at all times — it cannot be closed or dragged away. The `Cmd+\` / `Ctrl+\` sidebar shortcut is also intercepted.

### Settings

All options are in: **Settings → Community Plugins → Minimalism UI**

**Appearance**

| Option | Description |
|---|---|
| Sidebar Style | Applies a macOS Finder-style look to the left sidebar (rounded corners, custom background) |
| Tab Bar Style | Hides the note tab bar and replaces it with a drag region showing the current note title |
| Info Bar Style | Hides panel action buttons and search boxes in Outline / Backlinks; injects section labels |

**Interaction**

| Option | Description |
|---|---|
| Home Note | A note that opens automatically on startup and when all tabs are closed |
| Disable Pin Tab | Prevents tabs from being pinned and hides the pin icon |

---

## Installation

### Manual (recommended)

1. Go to the [Releases](../../releases) page and download `obsidian-minimalism-ui.zip` from the latest release
2. Unzip it — you will get a folder named `obsidian-minimalism-ui/`
3. Move that folder into your vault's `.obsidian/plugins/` directory
4. In Obsidian: Settings → Community Plugins → disable Safe Mode → enable **Minimalism UI**

```
your-vault/
└── .obsidian/
    └── plugins/
        └── obsidian-minimalism-ui/
            ├── main.js
            ├── manifest.json
            ├── styles.css
            └── fonts/
                └── ...
```

### Required Fonts

The plugin loads **JetBrains Mono NL** at runtime from a `fonts/` subfolder inside the plugin directory. **The `fonts/` folder is included in `obsidian-minimalism-ui.zip`** — no separate download needed.

| File | Weight | Style |
|---|---|---|
| `JetBrainsMonoNL-Regular.ttf` | 400 | normal |
| `JetBrainsMonoNL-Italic.ttf` | 400 | italic |
| `JetBrainsMonoNL-Medium.ttf` | 500 | normal |
| `JetBrainsMonoNL-MediumItalic.ttf` | 500 | italic |
| `JetBrainsMonoNL-Bold.ttf` | 700 | normal |
| `JetBrainsMonoNL-BoldItalic.ttf` | 700 | italic |
| `JetBrainsMonoNL-ExtraBold.ttf` | 900 | normal |
| `JetBrainsMonoNL-ExtraBoldItalic.ttf` | 900 | italic |

Without these files the font will silently fall back to system defaults, but no error will occur.

---

## Development

```bash
git clone https://github.com/your-username/obsidian-minimalism-ui.git
cd obsidian-minimalism-ui
npm install

npm run build   # production build → main.js
npm run dev     # watch mode — rebuilds on changes to main.ts
```

To test locally, symlink the project directory into your vault's plugin folder:

```bash
ln -s $(pwd) ~/your-vault/.obsidian/plugins/obsidian-minimalism-ui
```

After editing `main.ts`, run `npm run build` and reload the plugin in Obsidian.

---

## Known Limitations

- Obsidian uses a three-column layout internally (left + main + right). The right column is hidden via CSS — it cannot be removed at the DOM level.
- Some CSS variable overrides may not apply when using third-party themes.
- `getBacklinksForFile` is an internal Obsidian API. Changes in future Obsidian versions may break backlink counts.

---

## License

MIT
