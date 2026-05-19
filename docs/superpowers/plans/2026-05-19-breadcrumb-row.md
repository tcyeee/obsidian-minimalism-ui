# Breadcrumb Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second row to the drag bar that displays the cross-tab navigation path (e.g. A / B / C), collapsing middle items when they overflow.

**Architecture:** `TabCacheManager` exposes `getNavHistory()` which `DragBarManager` reads on every `active-leaf-change`. The drag bar gains a `row1` inner div (title + status bar) and a `breadcrumb` div (hidden when history ≤ 1). Adaptive rendering: render all items, check overflow in `requestAnimationFrame`, collapse to compact `[first] / ···N··· / [last]` if needed; always compact when history > 15.

**Tech Stack:** TypeScript, Obsidian Plugin API, esbuild

---

## Task 1: Add `getNavHistory()` to `TabCacheManager`

**Files:**
- Modify: `src/TabCacheManager.ts`

- [ ] **Step 1: Add the public getter method**

In `src/TabCacheManager.ts`, add this method after `hasPendingIntercept()` (after line 279, before `interceptLeafOpenFile`):

```typescript
getNavHistory(): WorkspaceLeaf[] {
    return this.navHistory;
}
```

- [ ] **Step 2: Build and verify**

```bash
cd "/Users/tcyeee/Library/Mobile Documents/iCloud~md~obsidian/Documents/Lucas/.obsidian/plugins/obsidian-minimalism-ui"
npm run build
```

Expected: exits with code 0, no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/TabCacheManager.ts main.js
git commit -m "feat(breadcrumb): expose getNavHistory() on TabCacheManager"
```

---

## Task 2: Rewrite `DragBarManager` and wire `main.ts`

**Files:**
- Modify: `src/DragBarManager.ts` (full replacement)
- Modify: `main.ts`

- [ ] **Step 1: Replace `src/DragBarManager.ts` with the complete new implementation**

```typescript
import { App, TAbstractFile, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from './settings';

type WorkspaceSplitInternal = { containerEl: HTMLElement };
type LeafWithFile = WorkspaceLeaf & { view?: { file?: { basename: string } } };

const COMPACT_THRESHOLD = 15;

export class DragBarManager {
	private dragBar: HTMLElement | null = null;
	private titleHandler: (() => void) | null = null;
	private breadcrumbHandler: (() => void) | null = null;
	private layoutHandler: (() => void) | null = null;
	private renameHandler: ((file: TAbstractFile) => void) | null = null;
	private statusBarOriginalParent: HTMLElement | null = null;
	private statusBarOriginalNextSibling: Element | null = null;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		private navHistoryGetter: () => WorkspaceLeaf[] = () => []
	) {}

	apply() {
		this.remove();
		if (!this.getSettings().disableNoteTabs) return;

		const rootEl = (this.app.workspace.rootSplit as unknown as WorkspaceSplitInternal).containerEl;
		const tabsEl = rootEl.querySelector<HTMLElement>('.workspace-tabs');
		if (!tabsEl) return;

		// 创建拖拽区
		this.dragBar = document.createElement('div');
		this.dragBar.className = 'minimalism-ui-drag-bar';

		// Row 1: title + status bar
		const row1 = document.createElement('div');
		row1.className = 'minimalism-ui-drag-bar-row1';
		this.dragBar.appendChild(row1);

		const titleEl = document.createElement('span');
		titleEl.className = 'minimalism-ui-drag-bar-title';
		row1.appendChild(titleEl);

		// Row 2: breadcrumb
		const breadcrumbEl = document.createElement('div');
		breadcrumbEl.className = 'minimalism-ui-drag-bar-breadcrumb';
		breadcrumbEl.style.display = 'none';
		this.dragBar.appendChild(breadcrumbEl);

		tabsEl.insertBefore(this.dragBar, tabsEl.firstChild);

		// 更新标题
		const updateTitle = () => {
			const activeFile = this.app.workspace.getActiveFile();
			titleEl.textContent = activeFile ? activeFile.basename : '';
		};
		updateTitle();
		this.titleHandler = updateTitle;
		this.app.workspace.on('active-leaf-change', updateTitle);

		this.renameHandler = (file: TAbstractFile) => {
			if (file === this.app.workspace.getActiveFile()) updateTitle();
		};
		this.app.vault.on('rename', this.renameHandler);

		// 布局变化时重新插入拖拽区（关闭 Tab 时 Obsidian 会重建 DOM）
		this.layoutHandler = () => {
			if (!this.dragBar || this.dragBar.isConnected) return;
			const rootEl2 = (this.app.workspace.rootSplit as unknown as WorkspaceSplitInternal).containerEl;
			const tabsEl2 = rootEl2.querySelector<HTMLElement>('.workspace-tabs');
			if (tabsEl2) tabsEl2.insertBefore(this.dragBar, tabsEl2.firstChild);
		};
		this.app.workspace.on('layout-change', this.layoutHandler);

		// 面包屑渲染辅助函数
		const renderAll = (el: HTMLElement, names: string[]) => {
			el.innerHTML = '';
			names.forEach((name, i) => {
				if (i > 0) {
					const sep = document.createElement('span');
					sep.className = 'minimalism-ui-breadcrumb-sep';
					sep.textContent = '/';
					el.appendChild(sep);
				}
				const item = document.createElement('span');
				item.className = i === names.length - 1
					? 'minimalism-ui-breadcrumb-item is-current'
					: 'minimalism-ui-breadcrumb-item';
				item.textContent = name;
				el.appendChild(item);
			});
		};

		const renderCompact = (el: HTMLElement, names: string[], collapsedCount: number) => {
			el.innerHTML = '';

			const first = document.createElement('span');
			first.className = 'minimalism-ui-breadcrumb-item';
			first.textContent = names[0];
			el.appendChild(first);

			const sep1 = document.createElement('span');
			sep1.className = 'minimalism-ui-breadcrumb-sep';
			sep1.textContent = '/';
			el.appendChild(sep1);

			const collapse = document.createElement('span');
			collapse.className = 'minimalism-ui-breadcrumb-collapse';
			collapse.textContent = `···${collapsedCount}···`;
			el.appendChild(collapse);

			const sep2 = document.createElement('span');
			sep2.className = 'minimalism-ui-breadcrumb-sep';
			sep2.textContent = '/';
			el.appendChild(sep2);

			const last = document.createElement('span');
			last.className = 'minimalism-ui-breadcrumb-item is-current';
			last.textContent = names[names.length - 1];
			el.appendChild(last);
		};

		const updateBreadcrumb = () => {
			const history = this.navHistoryGetter();
			if (history.length <= 1) {
				breadcrumbEl.style.display = 'none';
				return;
			}
			breadcrumbEl.style.display = 'flex';
			const names = history.map(l => (l as LeafWithFile).view?.file?.basename ?? '');

			if (history.length > COMPACT_THRESHOLD) {
				renderCompact(breadcrumbEl, names, names.length - 2);
				return;
			}

			renderAll(breadcrumbEl, names);
			requestAnimationFrame(() => {
				if (!breadcrumbEl.isConnected) return;
				if (breadcrumbEl.scrollWidth > breadcrumbEl.clientWidth) {
					renderCompact(breadcrumbEl, names, names.length - 2);
				}
			});
		};
		updateBreadcrumb();
		this.breadcrumbHandler = updateBreadcrumb;
		this.app.workspace.on('active-leaf-change', updateBreadcrumb);

		// 将 status-bar 搬入 row1 右侧
		const statusBar = document.querySelector<HTMLElement>('.status-bar');
		if (statusBar) {
			this.statusBarOriginalParent = statusBar.parentElement;
			this.statusBarOriginalNextSibling = statusBar.nextElementSibling;
			row1.appendChild(statusBar);
		}
	}

	remove() {
		if (this.titleHandler) {
			this.app.workspace.off('active-leaf-change', this.titleHandler);
			this.titleHandler = null;
		}
		if (this.breadcrumbHandler) {
			this.app.workspace.off('active-leaf-change', this.breadcrumbHandler);
			this.breadcrumbHandler = null;
		}
		if (this.renameHandler) {
			this.app.vault.off('rename', this.renameHandler);
			this.renameHandler = null;
		}
		if (this.layoutHandler) {
			this.app.workspace.off('layout-change', this.layoutHandler);
			this.layoutHandler = null;
		}
		// 还原 status-bar 到原始位置
		if (this.statusBarOriginalParent) {
			const statusBar = document.querySelector<HTMLElement>('.status-bar');
			if (statusBar) {
				if (this.statusBarOriginalNextSibling) {
					this.statusBarOriginalParent.insertBefore(statusBar, this.statusBarOriginalNextSibling);
				} else {
					this.statusBarOriginalParent.appendChild(statusBar);
				}
			}
			this.statusBarOriginalParent = null;
			this.statusBarOriginalNextSibling = null;
		}
		if (this.dragBar) {
			this.dragBar.remove();
			this.dragBar = null;
		}
	}
}
```

- [ ] **Step 2: Update `main.ts` line 44 — pass `navHistoryGetter` to `DragBarManager`**

Find this line in `main.ts`:

```typescript
this.dragBar = new DragBarManager(this.app, () => this.settings);
```

Replace with:

```typescript
this.dragBar = new DragBarManager(
    this.app,
    () => this.settings,
    () => this.tabCache.getNavHistory()
);
```

- [ ] **Step 3: Build and verify**

```bash
cd "/Users/tcyeee/Library/Mobile Documents/iCloud~md~obsidian/Documents/Lucas/.obsidian/plugins/obsidian-minimalism-ui"
npm run build
```

Expected: exits with code 0, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/DragBarManager.ts main.ts main.js
git commit -m "feat(breadcrumb): restructure drag bar DOM and implement breadcrumb rendering"
```

---

## Task 3: Update `styles.css`

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Replace the drag bar CSS block in `styles.css`**

Find and replace the block from line 342 (`.minimalism-ui-drag-bar {`) through line 390 (the closing `}` of `.minimalism-ui-drag-bar .status-bar`) with:

```css
.minimalism-ui-drag-bar {
	-webkit-app-region: drag;
	min-height: 35px !important;
	flex-grow: 0 !important;
	flex-shrink: 0 !important;
	display: flex;
	flex-direction: column;
	user-select: none;
}

/* Row 1: title + status bar */
.minimalism-ui-drag-bar-row1 {
	display: flex;
	align-items: center;
	height: 35px;
	padding: 0 14px;
	flex-shrink: 0;
}

.minimalism-ui-drag-bar-title {
	-webkit-app-region: no-drag;
	pointer-events: none;
	padding-left: 20px;
	font-size: 0.75rem;
	color: var(--text-muted);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-weight: bold;
	max-width: 50%;
	position: relative;
	display: flex;
	align-items: center;
	gap: 6px;
}

.minimalism-ui-drag-bar-title::before {
	content: '';
	flex-shrink: 0;
	width: 7px;
	height: 7px;
	border-radius: 50%;
	background-color: var(--text-muted);
	opacity: 0.5;
}

/* status-bar 搬入 row1 后重置定位，推到最右侧 */
.minimalism-ui-drag-bar-row1 .status-bar {
	position: static !important;
	margin-left: auto;
	background: transparent !important;
	border: none !important;
	padding: 0 !important;
	-webkit-app-region: no-drag;
}

/* Row 2: breadcrumb */
.minimalism-ui-drag-bar-breadcrumb {
	display: flex;
	align-items: center;
	padding: 0 34px 5px;
	gap: 4px;
	overflow: hidden;
	-webkit-app-region: drag;
}

.minimalism-ui-breadcrumb-item {
	font-size: 0.65rem;
	color: var(--text-faint);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	max-width: 120px;
	pointer-events: none;
	-webkit-app-region: no-drag;
	flex-shrink: 1;
}

.minimalism-ui-breadcrumb-item.is-current {
	color: var(--text-muted);
}

.minimalism-ui-breadcrumb-sep,
.minimalism-ui-breadcrumb-collapse {
	font-size: 0.65rem;
	color: var(--text-faint);
	opacity: 0.4;
	flex-shrink: 0;
	pointer-events: none;
	-webkit-app-region: no-drag;
}
```

- [ ] **Step 2: Build and verify**

```bash
cd "/Users/tcyeee/Library/Mobile Documents/iCloud~md~obsidian/Documents/Lucas/.obsidian/plugins/obsidian-minimalism-ui"
npm run build
```

Expected: exits with code 0.

- [ ] **Step 3: Manual test in Obsidian**

Reload the plugin (Settings → Community Plugins → disable then enable Minimalism UI). With 单页模式 enabled:

1. Open note A → drag bar row 1 shows title, no second row visible
2. Open note B (Cmd+click a link or use quick switcher) → second row appears: `A / B`
3. Open note C → second row shows: `A / B / C`
4. Open notes until history has 16 items → second row shows compact: `[NoteA] / ···14··· / [NoteP]`
5. Open a note with a very long name (e.g. 80+ characters) → verify it truncates with `…` within its `max-width`
6. Disable 单页模式 in settings → drag bar disappears entirely, no second row visible
7. Re-enable 单页模式 → drag bar returns, breadcrumb works correctly on next navigation

- [ ] **Step 4: Commit**

```bash
git add styles.css
git commit -m "feat(breadcrumb): add breadcrumb row styles to drag bar"
```
