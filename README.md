# Minimalism UI — Obsidian Plugin

<kbd>[中文](README.zh.md)</kbd> · <kbd>English</kbd>

Transform Obsidian into a minimal, macOS-native-style writing environment. All options are in **Settings → Community Plugins → Minimalism UI**.

---

## Features

### 极简侧边栏

Applies a Typora-style frosted-glass look to the left sidebar (rounded corners, custom background). Also restructures the sidebar: the Outline panel and Properties metadata are merged into a single view — Outline on top, frontmatter properties below — so all note context is visible at a glance without switching panels.

Toggling this option off restores the original sidebar layout.

### 极简信息栏

Hides panel action buttons (the icon row in Outline, Backlinks, etc.) and removes the search bar from those panels, reducing visual noise.

### 笔记样式

Applies custom typography to the editor and reading view:

- **JetBrains Mono NL** for code blocks, inline code, and the editor font
- Forest-style blockquotes, tables, and code blocks
- Adjusted line height and smooth scroll in the reading view
- Heading flash animation when jumping from the Outline panel

### 笔记首页

Designates a note that opens automatically on startup and whenever all tabs are closed. Set the path in the plugin settings (supports autocomplete).

### 单页模式

Hides the tab bar and keeps one note visible at a time. Additional navigation features:

- **LRU tab cache** — keeps the 10 most recently visited notes open in the background; the oldest is closed when the limit is reached
- **Cross-tab back / forward** — `app:go-back` / `app:go-forward` navigate across tabs, not just within a single tab's history
- Disables tab pinning

### 页面加载动画 *(Beta)*

Slide-in animation when navigating back or forward through note history.

---

## Settings

| Option | Description |
|---|---|
| 极简侧边栏 | Finder-style sidebar + merged Outline + Properties layout |
| 极简信息栏 | Hides panel buttons and search bars |
| 笔记样式 | JetBrains Mono, Forest-style blocks, smooth scroll, heading flash |
| 笔记首页 | Note path to open on startup and when all tabs are closed |
| 单页模式 | One-note-at-a-time with LRU cache and cross-tab history |
| 页面加载动画 | Slide animation on back/forward navigation |

---

## Installation

### Manual

1. Go to the [Releases](../../releases) page and download `obsidian-minimalism-ui.zip` from the latest release
2. Unzip — you will get a folder named `obsidian-minimalism-ui/`
3. Move that folder into your vault's `.obsidian/plugins/` directory
4. In Obsidian: **Settings → Community Plugins → enable Minimalism UI**

```
your-vault/
└── .obsidian/
    └── plugins/
        └── obsidian-minimalism-ui/
            ├── main.js
            ├── manifest.json
            ├── styles.css
            └── fonts/
                └── JetBrainsMonoNL-*.ttf
```

### Fonts

JetBrains Mono NL is bundled in the `fonts/` subfolder and loaded at runtime. **The `fonts/` folder is included in `obsidian-minimalism-ui.zip`** — no separate download needed.

Without the font files the plugin still works; code blocks will fall back to your system monospace font.

---

## Development

```bash
git clone https://github.com/your-username/obsidian-minimalism-ui.git
cd obsidian-minimalism-ui
npm install

npm run build   # production build → main.js
npm run dev     # watch mode — rebuilds on changes to main.ts
```

To test locally, symlink the project directory into your vault:

```bash
ln -s $(pwd) ~/your-vault/.obsidian/plugins/obsidian-minimalism-ui
```

After editing `main.ts`, run `npm run build` and reload the plugin in Obsidian (**Ctrl/Cmd+R** in the community plugins list).

---

## License

MIT
