# Language Toggle Design

## Overview

Add a manual language selector to the settings page so users can override the auto-detected language (currently `document.documentElement.lang`). Supports three values: auto, zh, en. Switching immediately re-renders the settings page.

## Changes

### `settings.ts`

Add field:
```ts
language: 'auto' | 'zh' | 'en'
```
Default: `'auto'`.

### `i18n.ts`

Add module-level override variable and setter:

```ts
let langOverride: Lang | null = null;

export function setLang(lang: 'auto' | 'zh' | 'en') {
    langOverride = lang === 'auto' ? null : lang as Lang;
}
```

Update `detectLang()` to check `langOverride` first, then fall back to `document.documentElement.lang`.

### `SettingTab.ts`

Add a dropdown before the Appearance heading. Options:
- `auto` → 跟随系统 / Auto (label varies by current lang)
- `zh` → 中文
- `en` → English

On change: call `setLang(v)`, `await saveSettings()`, then `this.display()` to re-render immediately.

### `main.ts`

After `await this.loadData()`, call `setLang(this.settings.language)` so the override is active before any UI renders.

## Constraints

- No new headings added to the settings page — the dropdown sits above the existing Appearance heading.
- The dropdown label keys (`language`, `languageAuto`) must be added to both `zh` and `en` translation objects in `i18n.ts`.
- `setLang` and `t` remain the only public exports from `i18n.ts`.
