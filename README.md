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

1. Download `main.js`, `manifest.json`, and `styles.css` from this repository
2. Create the directory `.obsidian/plugins/obsidian-minimalism-ui/` inside your vault
3. Copy the three files into it
4. In Obsidian: Settings → Community Plugins → disable Safe Mode → enable **Minimalism UI**

```
your-vault/
└── .obsidian/
    └── plugins/
        └── obsidian-minimalism-ui/
            ├── main.js
            ├── manifest.json
            └── styles.css
```

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
