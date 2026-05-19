# Breadcrumb Row in Drag Bar

## Overview

Add a second row to `.minimalism-ui-drag-bar` that displays the user's cross-tab navigation path (e.g. A / B / C). The row is purely informational — no click interaction. It hides automatically when there is no navigation history.

## Architecture & Data Flow

**`TabCacheManager`** exposes a new public getter:

```typescript
getNavHistory(): WorkspaceLeaf[] {
    return this.navHistory;
}
```

**`DragBarManager`** constructor gains a third parameter:

```typescript
constructor(
    private app: App,
    private getSettings: () => MinimalismUISettings,
    private navHistoryGetter: () => WorkspaceLeaf[]
) {}
```

**`main.ts`** wires them together (line 44):

```typescript
this.dragBar = new DragBarManager(
    this.app,
    () => this.settings,
    () => this.tabCache.getNavHistory()
);
```

No direct coupling between the two managers — `DragBarManager` only holds a getter callback.

## DOM Structure

```
.minimalism-ui-drag-bar  (flex-column)
  ├── .minimalism-ui-drag-bar-row1  (flex-row, 35px fixed height)
  │   ├── .minimalism-ui-drag-bar-title
  │   └── .status-bar
  └── .minimalism-ui-drag-bar-breadcrumb  (flex-row, hidden when history ≤ 1)
      ├── span.minimalism-ui-breadcrumb-item        "PageA"
      ├── span.minimalism-ui-breadcrumb-sep         "/"
      ├── span.minimalism-ui-breadcrumb-item        "PageB"
      ├── span.minimalism-ui-breadcrumb-sep         "/"
      └── span.minimalism-ui-breadcrumb-item.is-current  "PageC"
```

`DragBarManager.apply()` creates an inner `row1` div and appends both the title element and the `.status-bar` into it (previously both went directly into `this.dragBar`). The CSS selector `.minimalism-ui-drag-bar .status-bar` updates to `.minimalism-ui-drag-bar-row1 .status-bar`.

The drag bar overall height is no longer hardcoded at 35px — it uses `min-height: 35px` and expands when the breadcrumb row is visible.

## Breadcrumb Rendering Logic

`updateBreadcrumb()` runs on every `active-leaf-change` event:

1. Read `navHistory` via `navHistoryGetter()`
2. If `history.length ≤ 1` → hide breadcrumb row, return
3. Show breadcrumb row; extract `basename` for each leaf
4. **If `history.length > 15`** → render compact format directly:
   `[first] / ···N··· / [last]`  where N = history.length − 2
5. **Otherwise** → render all items: `[A] / [B] / ... / [Z]`
   - After render, check overflow in `requestAnimationFrame`:
     `if (breadcrumbEl.scrollWidth > breadcrumbEl.clientWidth)`
   - If overflow → re-render compact: `[A] / ···N··· / [Z]`

The current page is always the last item in `navHistory` and receives `.is-current` class. Individual item names are capped at `max-width: 120px` with CSS `text-overflow: ellipsis` as a final safety net.

## CSS Changes

```css
/* Drag bar: column layout, height driven by content */
.minimalism-ui-drag-bar {
    -webkit-app-region: drag;
    min-height: 35px;
    flex-grow: 0 !important;
    flex-shrink: 0 !important;
    display: flex;
    flex-direction: column;
    user-select: none;
    /* removed: height/min-height/max-height: 35px; padding: 0 14px */
}

/* Row 1: title + status bar */
.minimalism-ui-drag-bar-row1 {
    display: flex;
    align-items: center;
    padding: 0 14px;
    height: 35px;
    flex-shrink: 0;
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

`.minimalism-ui-drag-bar .status-bar` → `.minimalism-ui-drag-bar-row1 .status-bar` (selector rename only, other declarations unchanged).

## Files Changed

| File | Change |
|---|---|
| `src/TabCacheManager.ts` | Add `getNavHistory()` public getter |
| `src/DragBarManager.ts` | Add `navHistoryGetter` param; restructure DOM into row1 + breadcrumb; add `updateBreadcrumb()` logic |
| `main.ts` | Pass `navHistoryGetter` when constructing `DragBarManager` |
| `styles.css` | Restructure drag bar CSS; add breadcrumb styles; update status-bar selector |

## Out of Scope

- Breadcrumb item click / navigation
- Tooltip showing full name on hover of truncated items
- Persisting breadcrumb history across Obsidian restarts
