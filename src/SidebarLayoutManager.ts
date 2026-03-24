import { App, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from './settings';

type WorkspaceSidedock = { collapsed: boolean; expand(): void; children?: unknown[] };

/**
 * SidebarLayoutManager — triggered when 极简侧边栏 is enabled.
 *
 * Strategy: create Outline + Properties leaves, then extract the inner
 * `.metadata-content` div from Properties and inject it directly into the
 * Outline leaf's `.workspace-leaf-content`. The Properties leaf shell is
 * hidden via inline style. CSS flexbox handles the top/bottom layout.
 *
 * Why inject the inner div instead of moving the whole leaf:
 *   - `.metadata-content` is a plain presentational div; Obsidian's workspace
 *     system does not track it.
 *   - Obsidian's Properties view JS holds a direct reference to the node, so
 *     it continues updating when the active file changes regardless of where
 *     the node lives in the DOM tree.
 *   - No workspace-split manipulation → no empty-shell artifacts.
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

			// 3. Outline leaf
			const outlineLeaf = workspace.getLeftLeaf(false);
			if (outlineLeaf) {
				await outlineLeaf.setViewState({ type: 'outline', active: false });
			}

			// 4. Properties leaf — active: true so Obsidian binds it to the
			//    current file and fully initializes .metadata-content.
			const propsLeaf = workspace.getLeftLeaf(true);
			if (propsLeaf) {
				await propsLeaf.setViewState({ type: 'file-properties', active: true });
			}

			// 5. Wait for Obsidian to finish rendering both views.
			await new Promise(resolve => setTimeout(resolve, 100));

			// 6. Extract .metadata-content and inject into Outline leaf.
			if (outlineLeaf && propsLeaf) {
				this.injectMetadataIntoOutline(outlineLeaf, propsLeaf);
			}
		} finally {
			this.isApplying = false;
		}
	}

	// ── Private ───────────────────────────────────────────────────────────────

	/**
	 * Moves `.metadata-content` (direct child of `.metadata-container`) from
	 * the Properties leaf into the Outline leaf's `.workspace-leaf-content`.
	 * The now-empty Properties workspace-tabs shell is hidden.
	 */
	private injectMetadataIntoOutline(outlineLeaf: WorkspaceLeaf, propsLeaf: WorkspaceLeaf) {
		const outlineEl = (outlineLeaf as WorkspaceLeaf & { containerEl: HTMLElement }).containerEl;
		const propsEl   = (propsLeaf  as WorkspaceLeaf & { containerEl: HTMLElement }).containerEl;

		// `.metadata-container > .metadata-content` — the direct child avoids
		// matching nested `.metadata-content` nodes inside individual properties.
		const metadataContent = propsEl.querySelector<HTMLElement>(
			'.metadata-container > .metadata-content',
		);

		// Injection target: the outline leaf content wrapper.
		// Appending here makes metadata-content a flex sibling of .view-content,
		// so CSS can size them independently (outline: flex 1, metadata: auto).
		const outlineLeafContent = outlineEl.querySelector<HTMLElement>(
			'.workspace-leaf-content[data-type="outline"]',
		);

		if (!metadataContent || !outlineLeafContent) return;

		outlineLeafContent.appendChild(metadataContent);

		// Hide the now-empty Properties workspace-tabs shell.
		const propsWorkspaceTabs = propsEl.closest<HTMLElement>('.workspace-tabs');
		if (propsWorkspaceTabs) {
			propsWorkspaceTabs.style.display = 'none';
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
