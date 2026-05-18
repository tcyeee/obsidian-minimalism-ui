# Language Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Language / 语言 dropdown to the settings page that lets users override auto-detected language (auto / 中文 / English), taking effect immediately when changed.

**Architecture:** Add a `language` field to settings; export a `setLang()` setter from `i18n.ts` that stores a module-level override checked before auto-detection; call `setLang` on plugin load and on dropdown change; re-render settings on change via `this.display()`.

**Tech Stack:** TypeScript, Obsidian Plugin API (`Setting.addDropdown`), esbuild

---

### Task 1: Add `language` field to settings

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Add the field to the interface and defaults**

Replace the contents of `src/settings.ts` with:

```ts
export interface MinimalismUISettings {
	macSidebar: boolean;
	showProperties: boolean;
	showLocalGraph: boolean;
	hideTabBar: boolean;
	disablePinTab: boolean;
	simplifyPanel: boolean;
	disableNoteTabs: boolean;
	enableLeafCache: boolean;
	enableNavAnimation: boolean;
	noteStyle: boolean;
	homePage: string;
	language: 'auto' | 'zh' | 'en';
}

export const DEFAULT_SETTINGS: MinimalismUISettings = {
	macSidebar: false,
	showProperties: true,
	showLocalGraph: false,
	hideTabBar: false,
	disablePinTab: true,
	simplifyPanel: false,
	disableNoteTabs: false,
	enableLeafCache: false,
	enableNavAnimation: false,
	noteStyle: false,
	homePage: '',
	language: 'auto',
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/settings.ts
git commit -m "feat(settings): add language field"
```

---

### Task 2: Add `setLang` to i18n.ts and new translation keys

**Files:**
- Modify: `src/i18n.ts`

- [ ] **Step 1: Update i18n.ts**

Replace the full contents of `src/i18n.ts` with:

```ts
const translations = {
	zh: {
		language: '语言',
		languageAuto: '跟随系统',
		languageZh: '中文',
		languageEn: 'English',

		headingAppearance: '外观设置',
		headingInteraction: '交互设置',

		macSidebar: '极简侧边栏',
		macSidebarDesc: '为左侧边栏应用磨砂玻璃背景与圆角高亮，打造 macOS 原生风格。',
		showProperties: '显示属性面板',
		showPropertiesDesc: '在侧边栏左下角显示当前笔记的属性（Properties）。',
		showLocalGraph: '显示本地关系图',
		showLocalGraphDesc: '在侧边栏显示当前笔记的本地关系图（Local Graph），位于属性面板上方。',

		hideTabBar: '极简信息栏',
		hideTabBarDesc: '隐藏左侧属性栏的操作按钮，以及大纲、反向链接面板中的搜索框',

		noteStyle: '笔记样式优化',
		noteStyleDesc: '对编辑器与阅读视图应用以下定制样式：',
		noteStyleItem1: '字体：正文数字使用 JetBrains Mono 等宽字体混排',
		noteStyleItem2: '引用块、表格、代码块：Forest 风格样式定制',
		noteStyleItem3: 'Mermaid 图表：超宽图表默认缩放显示全图，点击后查看原始尺寸',

		homePage: '笔记首页',
		homePageDesc: '设置一个笔记作为首页。Obsidian 启动时自动打开，关闭所有标签后自动返回。',
		homePagePlaceholder: '输入笔记路径，例如：src/Home.md',

		singlePage: '单页模式',
		singlePageDesc1: '1. 隐藏顶部标签栏，每次只展示一篇笔记。',
		singlePageDesc2: '2. 启用页面缓存，在内存中保留最近访问的 10 个页面',
		singlePageDesc3: '3. 禁用 pin 标签功能，避免多余的标签被固定在顶部。',

		navAnimation: '页面加载动画 (beta)',
		navAnimationDesc: '前进或后退时，为目标页面播放滑入动画',
	},
	en: {
		language: 'Language',
		languageAuto: 'Follow system',
		languageZh: '中文',
		languageEn: 'English',

		headingAppearance: 'Appearance',
		headingInteraction: 'Interaction',

		macSidebar: 'Minimal Sidebar',
		macSidebarDesc: 'Apply a frosted-glass background and rounded highlights to the left sidebar for a macOS-native look.',
		showProperties: 'Show Properties',
		showPropertiesDesc: 'Display the current note\'s properties at the bottom of the sidebar.',
		showLocalGraph: 'Show Local Graph',
		showLocalGraphDesc: 'Display the local graph for the current note in the sidebar, above the properties panel.',

		hideTabBar: 'Minimal Info Bar',
		hideTabBarDesc: 'Hide action buttons in the properties panel and search bars in the Outline / Backlinks panels.',

		noteStyle: 'Note Style',
		noteStyleDesc: 'Apply the following custom styles to the editor and reading view:',
		noteStyleItem1: 'Typography: JetBrains Mono for inline digits in body text',
		noteStyleItem2: 'Blockquotes, tables, code blocks: Forest-style design',
		noteStyleItem3: 'Mermaid diagrams: wide diagrams scale to fit by default; click to view at full size',

		homePage: 'Home Note',
		homePageDesc: 'A note that opens automatically on startup and whenever all tabs are closed.',
		homePagePlaceholder: 'Note path, e.g. src/Home.md',

		singlePage: 'Single-Page Mode',
		singlePageDesc1: '1. Hide the tab bar — show one note at a time.',
		singlePageDesc2: '2. Keep the 10 most recently visited notes cached in memory.',
		singlePageDesc3: '3. Disable tab pinning to prevent tabs from being pinned.',

		navAnimation: 'Page Transition Animation (beta)',
		navAnimationDesc: 'Play a slide-in animation when navigating back or forward.',
	},
} as const;

type Lang = keyof typeof translations;
type Key = keyof typeof translations['en'];

let langOverride: Lang | null = null;

export function setLang(lang: 'auto' | 'zh' | 'en') {
	langOverride = lang === 'auto' ? null : lang as Lang;
}

function detectLang(): Lang {
	if (langOverride) return langOverride;
	const lang = document.documentElement.lang?.slice(0, 2) ?? 'en';
	return (lang in translations ? lang : 'en') as Lang;
}

export function t(key: Key): string {
	return translations[detectLang()][key];
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/i18n.ts
git commit -m "feat(i18n): add setLang override and language dropdown translation keys"
```

---

### Task 3: Call `setLang` on plugin load in main.ts

**Files:**
- Modify: `main.ts`

- [ ] **Step 1: Import setLang**

In `main.ts`, find the existing import line for `i18n`:

```ts
// There is no existing i18n import — add one after the MinimalismUISettingTab import:
import { setLang } from './src/i18n';
```

Add it after line 8 (after the `MinimalismUISettingTab` import):

```ts
import { MinimalismUISettingTab } from './src/SettingTab';
import { setLang } from './src/i18n';
```

- [ ] **Step 2: Call setLang after loadSettings**

In `main.ts`, find `async onload()`. After the `await this.loadSettings();` line (line 35), add:

```ts
setLang(this.settings.language);
```

So it reads:

```ts
async onload() {
    await this.loadSettings();
    setLang(this.settings.language);
    // ... rest unchanged
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add main.ts
git commit -m "feat(main): initialize language override on plugin load"
```

---

### Task 4: Add language dropdown to SettingTab.ts

**Files:**
- Modify: `src/SettingTab.ts`

- [ ] **Step 1: Import setLang in SettingTab.ts**

In `src/SettingTab.ts`, update the existing i18n import line (line 3):

```ts
import { t, setLang } from './i18n';
```

- [ ] **Step 2: Add the dropdown at the top of display()**

In `src/SettingTab.ts`, find the `display()` method. It currently starts with:

```ts
display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName(t('headingAppearance')).setHeading();
```

Replace that opening block with:

```ts
display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
        .setName(t('language'))
        .addDropdown(drop => drop
            .addOption('auto', t('languageAuto'))
            .addOption('zh', t('languageZh'))
            .addOption('en', t('languageEn'))
            .setValue(this.plugin.settings.language)
            .onChange(async (v: 'auto' | 'zh' | 'en') => {
                this.plugin.settings.language = v;
                setLang(v);
                await this.plugin.saveSettings();
                this.display();
            }));

    new Setting(containerEl).setName(t('headingAppearance')).setHeading();
```

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Verify manually in Obsidian**

1. Reload the plugin (disable → enable in Community Plugins, or use hot-reload).
2. Open Settings → Minimalism UI.
3. Confirm a "Language / 语言" dropdown appears at the top with three options.
4. Select **English** → all setting labels switch to English immediately.
5. Select **中文** → all labels switch to Chinese immediately.
6. Select **跟随系统 / Follow system** → labels revert to Obsidian's detected language.
7. Close and reopen Settings — the selected language persists.

- [ ] **Step 5: Commit**

```bash
git add src/SettingTab.ts
git commit -m "feat(settings): add language toggle dropdown"
```
