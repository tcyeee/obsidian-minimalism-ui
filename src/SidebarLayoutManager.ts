import { App, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from './settings';

type WorkspaceSidedock = { collapsed: boolean; expand(): void; children?: unknown[] };

/**
 * SidebarLayoutManager — triggered when 极简侧边栏 is enabled.
 *
 * Places the Outline panel (data-type="outline") in the left sidebar.
 */
export class SidebarLayoutManager {
	// Guard against concurrent calls: each `apply()` awaits async ops, so a
	// second call arriving mid-flight would create duplicate leaves.
	private isApplying = false;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
	) { }

	// ── Public ────────────────────────────────────────────────────────────────

	async apply() {
		if (!this.getSettings().macSidebar) return;
		if (this.isApplying) return;
		this.isApplying = true;

		try {
			const { workspace } = this.app;
			const leftSplit = workspace.leftSplit as unknown as WorkspaceSidedock;

			// 1. Clear the entire left sidebar
			this.clearLeftSidebar();

			// 2. Expand left sidebar (may have auto-collapsed after clearing)
			if (leftSplit?.collapsed) leftSplit.expand();

			// 3. Outline in the top section
			const outlineLeaf = workspace.getLeftLeaf(false);
			if (outlineLeaf) {
				await outlineLeaf.setViewState({ type: 'outline', active: false });
			}
		} finally {
			this.isApplying = false;
		}
	}

	// ── Public helpers ────────────────────────────────────────────────────────

	/**
	 * Clears every leaf from the left sidebar using three complementary strategies:
	 *
	 *   A. Walk leftSplit's internal workspace-item tree directly.
	 *      Works regardless of DOM state (collapsed sidebar, mid-rebuild, etc.).
	 *
	 *   B. DOM traversal via containerEl.closest('.mod-left-split').
	 *      Catches leaves whose workspace-item tree position wasn't found in A
	 *      (e.g. floating / detached DOM fragments that still reference a split).
	 *
	 *   C. Full iterateAllLeaves sweep for the outline type.
	 *      Guards against leaves that survived A and B because their containerEl
	 *      was missing or not yet attached to the document.
	 *
	 * Results from all three are de-duplicated via a Set before detaching.
	 *
	 * NOTE: SinglePageManager may patch leaf.detach() to a no-op when disablePinTab
	 * is enabled. We bypass this by calling the original stored as __minui_origDetach__.
	 */
	clearLeftSidebar() {
		const { workspace } = this.app;
		const all = new Set<WorkspaceLeaf>();

		// Strategy A — internal workspace-item tree walk
		const leftSplit = workspace.leftSplit as unknown as WorkspaceSidedock;
		for (const leaf of this.collectLeavesFromItem(leftSplit)) {
			all.add(leaf);
		}

		// Strategy B — DOM traversal
		workspace.iterateAllLeaves(leaf => {
			const el = (leaf as WorkspaceLeaf & { containerEl?: HTMLElement }).containerEl;
			if (el?.closest('.workspace-split.mod-left-split')) {
				all.add(leaf);
			}
		});

		// Detach collected leaves, bypassing any SinglePageManager pin-block patch
		for (const leaf of all) {
			try { this.forceDetach(leaf); } catch { /* leaf may already be detached */ }
		}

		// Strategy C — final sweep for the outline type
		// (covers leaves whose containerEl was null/detached during A & B)
		const stragglers: WorkspaceLeaf[] = [];
		workspace.iterateAllLeaves(leaf => {
			const type = leaf.getViewState().type;
			if (type === 'outline') stragglers.push(leaf);
		});
		for (const leaf of stragglers) {
			try { this.forceDetach(leaf); } catch { /* leaf may already be detached */ }
		}
	}

	/**
	 * Detaches a leaf, bypassing SinglePageManager's pin-block patch if active.
	 * SinglePageManager stores the original detach as __minui_origDetach__ on the leaf.
	 */
	private forceDetach(leaf: WorkspaceLeaf) {
		type PatchedLeaf = WorkspaceLeaf & { __minui_origDetach__?: () => void };
		const orig = (leaf as PatchedLeaf).__minui_origDetach__;
		if (orig) {
			orig();
		} else {
			leaf.detach();
		}
	}

	/**
	 * Recursively collects all WorkspaceLeaf instances from a workspace item
	 * (WorkspaceSplit / WorkspaceSidedock / WorkspaceTabs / WorkspaceLeaf).
	 */
	private collectLeavesFromItem(item: unknown): WorkspaceLeaf[] {
		if (!item || typeof item !== 'object') return [];

		if (item instanceof WorkspaceLeaf) return [item];

		const children = (item as { children?: unknown[] }).children;
		if (!Array.isArray(children)) return [];

		return children.flatMap(child => this.collectLeavesFromItem(child));
	}
}
