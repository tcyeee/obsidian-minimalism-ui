import { App, EventRef, WorkspaceLeaf } from 'obsidian';
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

	// Saved state for reversible injection — one record per injected element.
	private injectedItems: Array<{
		el: HTMLElement;
		originalParent: HTMLElement;
		originalNextSibling: ChildNode | null;
		addedClass?: string;
	}> = [];
	private hiddenShells: HTMLElement[] = [];
	// Elements created (not moved) by apply() — removed entirely on cleanup.
	private createdEls: HTMLElement[] = [];
	// Workspace resize event ref — notifies the graph iframe renderer when sidebar width changes.
	private graphResizeRef: EventRef | null = null;
	private injectedGraphLeaf: WorkspaceLeaf | null = null;
	private graphResizeObserver: ResizeObserver | null = null;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
	) { }

	// ── Public ────────────────────────────────────────────────────────────────

	/** Undo all DOM injections and restore leaves to their original state. */
	remove() {
		if (this.injectedItems.length === 0 && this.hiddenShells.length === 0 && this.createdEls.length === 0) return;
		for (const { el, originalParent, originalNextSibling, addedClass } of this.injectedItems) {
			if (addedClass) el.classList.remove(addedClass);
			originalParent.insertBefore(el, originalNextSibling);
		}
		for (const shell of this.hiddenShells) {
			shell.classList.remove('minimalism-ui-is-hidden');
		}
		for (const el of this.createdEls) {
			el.remove();
		}
		if (this.graphResizeRef) {
			this.app.workspace.offref(this.graphResizeRef);
			this.graphResizeRef = null;
		}
		this.graphResizeObserver?.disconnect();
		this.graphResizeObserver = null;
		this.injectedGraphLeaf = null;
		this.injectedItems = [];
		this.hiddenShells = [];
		this.createdEls = [];
	}

	async apply() {
		this.remove();
		if (!this.getSettings().macSidebar) return;
		if (this.isApplying) return;
		this.isApplying = true;

		try {
			const { workspace } = this.app;
			const leftSplit = workspace.leftSplit as unknown as WorkspaceSidedock;
			const { showProperties, showLocalGraph } = this.getSettings();

			// 1. Clear the entire left sidebar
			this.clearLeftSidebar();

			// 2. Expand left sidebar (may have auto-collapsed after clearing)
			if (leftSplit?.collapsed) leftSplit.expand();

			// 3. Outline leaf (always present)
			const outlineLeaf = workspace.getLeftLeaf(false);
			if (outlineLeaf) {
				await outlineLeaf.setViewState({ type: 'outline', active: false });
			}

			// 4. Local Graph leaf (if enabled) — created before Properties so it
			//    ends up above Properties in the injected flex column.
			let graphLeaf: WorkspaceLeaf | null = null;
			if (showLocalGraph) {
				graphLeaf = workspace.getLeftLeaf(true);
				if (graphLeaf) {
					await graphLeaf.setViewState({ type: 'localgraph', active: false });
				}
			}

			// 5. Properties leaf (if enabled) — use active: false to avoid
			//    triggering active-leaf-change (which would close open modals).
			let propsLeaf: WorkspaceLeaf | null = null;
			if (showProperties) {
				propsLeaf = workspace.getLeftLeaf(true);
				if (propsLeaf) {
					await propsLeaf.setViewState({ type: 'file-properties', active: false });
				}
			}

			if (!showProperties && !showLocalGraph) return;

			// 6. Wait for Obsidian to finish rendering all views.
			await new Promise(resolve => setTimeout(resolve, 100));

			// 7. Nudge views to load the current file (active: false skips auto-bind).
			const activeFile = workspace.getActiveFile();
			if (activeFile) {
				workspace.trigger('file-open', activeFile);
				await new Promise(resolve => setTimeout(resolve, 50));
			}

			// 8. Inject Properties above Local Graph (appended first in flex column).
			if (outlineLeaf && propsLeaf) {
				this.injectMetadataIntoOutline(outlineLeaf, propsLeaf);
			}

			// 9. Inject Local Graph at the bottom (appended after properties).
			if (outlineLeaf && graphLeaf) {
				this.injectLocalGraphIntoOutline(outlineLeaf, graphLeaf);
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

		const originalParent = metadataContent.parentElement as HTMLElement;
		const originalNextSibling = metadataContent.nextSibling;

		outlineLeafContent.appendChild(metadataContent);
		this.injectedItems.push({ el: metadataContent, originalParent, originalNextSibling });

		// Hide the now-empty Properties workspace-tabs shell.
		const propsWorkspaceTabs = propsEl.closest<HTMLElement>('.workspace-tabs');
		if (propsWorkspaceTabs) {
			propsWorkspaceTabs.classList.add('minimalism-ui-is-hidden');
			this.hiddenShells.push(propsWorkspaceTabs);
		}
	}

	/**
	 * Moves the Local Graph's entire `.workspace-leaf-content` (the view's containerEl)
	 * into the Outline leaf's `.workspace-leaf-content`, above the Properties panel.
	 *
	 * Why the whole containerEl and not just .view-content:
	 *   Obsidian's graph view registers all mouse/wheel event listeners on
	 *   `this.containerEl` (.workspace-leaf-content[data-type="localgraph"]).
	 *   If only .view-content is moved, canvas events bubble up through the new
	 *   DOM parent (outline's containerEl) and never reach the original, now-hidden
	 *   localgraph containerEl — making the graph completely non-interactive.
	 *   Moving the containerEl itself keeps the event listeners wired up.
	 *
	 * The class `minimalism-ui-injected-graph` is added for CSS targeting.
	 */
	private injectLocalGraphIntoOutline(outlineLeaf: WorkspaceLeaf, graphLeaf: WorkspaceLeaf) {
		const outlineEl = (outlineLeaf as WorkspaceLeaf & { containerEl: HTMLElement }).containerEl;
		const graphEl   = (graphLeaf  as WorkspaceLeaf & { containerEl: HTMLElement }).containerEl;

		// Select the containerEl of the graph view — NOT just .view-content.
		const graphLeafContent = graphEl.querySelector<HTMLElement>(
			'.workspace-leaf-content[data-type="localgraph"]',
		);
		const outlineLeafContent = outlineEl.querySelector<HTMLElement>(
			'.workspace-leaf-content[data-type="outline"]',
		);

		if (!graphLeafContent || !outlineLeafContent) return;

		const originalParent = graphLeafContent.parentElement as HTMLElement;
		const originalNextSibling = graphLeafContent.nextSibling;
		const addedClass = 'minimalism-ui-injected-graph';

		graphLeafContent.classList.add(addedClass);

		// Build a title header for the LOCAL GRAPH section.
		// NOTE: .graph-controls is intentionally NOT moved here. Moving it out of
		// .view-content breaks Obsidian's built-in toggle mechanism: when the user
		// clicks the gear button, Obsidian removes .is-close from .graph-controls,
		// repositioning it outside the header bounds where overflow:hidden clips it,
		// making both the settings panel and the button invisible.
		// Leave .graph-controls in its original position so the toggle works natively.
		const viewContent = graphLeafContent.querySelector<HTMLElement>('.view-content');
		const graphControls = graphLeafContent.querySelector<HTMLElement>('.graph-controls');
		// Ensure the settings panel starts collapsed.
		if (graphControls && !graphControls.classList.contains('is-close')) {
			graphControls.classList.add('is-close');
		}

		const header = document.createElement('div');
		header.className = 'minimalism-ui-graph-header';
		const titleSpan = document.createElement('span');
		titleSpan.textContent = 'Local graph';
		header.appendChild(titleSpan);

		if (viewContent) {
			graphLeafContent.insertBefore(header, viewContent);
		} else {
			graphLeafContent.prepend(header);
		}
		this.createdEls.push(header);

		outlineLeafContent.appendChild(graphLeafContent);
		this.injectedItems.push({ el: graphLeafContent, originalParent, originalNextSibling, addedClass });

		// Hide the now-empty Local Graph workspace-tabs shell (graphLeafContent has
		// already been moved out, so the shell is empty and safe to hide).
		const graphWorkspaceTabs = graphEl.closest<HTMLElement>('.workspace-tabs') ?? graphEl;
		if (graphWorkspaceTabs) {
			graphWorkspaceTabs.classList.add('minimalism-ui-is-hidden');
			this.hiddenShells.push(graphWorkspaceTabs);
		}

		// Use ResizeObserver on the left split — confirmed to fire continuously
		// during sidebar drag. Read the sidebar width from the entry (pre-reflow)
		// to compute the 4:3 panel height, then call view.onResize() to redraw.
		this.injectedGraphLeaf = graphLeaf;
		if (this.graphResizeRef) {
			this.app.workspace.offref(this.graphResizeRef);
			this.graphResizeRef = null;
		}
		this.graphResizeObserver?.disconnect();
		const leftSplitEl = this.app.workspace.leftSplit as unknown as { containerEl?: HTMLElement };
		const observeTarget = leftSplitEl?.containerEl ?? document.querySelector<HTMLElement>('.workspace-split.mod-left-split');
		if (observeTarget) {
			this.graphResizeObserver = new ResizeObserver((entries) => {
				const w = entries[0].contentRect.width;
				if (w > 0) {
					graphLeafContent.setCssProps({'--minimalism-ui-graph-height': `${Math.round(w * 3 / 4)}px`});
				}
				(this.injectedGraphLeaf?.view as { onResize?(): void } | undefined)?.onResize?.();
			});
			this.graphResizeObserver.observe(observeTarget);
		}

		// Set initial 4:3 height after layout has settled, then apply graph colors.
		setTimeout(() => {
			const w = graphLeafContent.getBoundingClientRect().width;
			if (w > 0) {
				graphLeafContent.setCssProps({'--minimalism-ui-graph-height': `${Math.round(w * 3 / 4)}px`});
			}
			this.applyGraphColors();
		}, 200);
	}

	private applyGraphColors() {
		const renderer = (this.injectedGraphLeaf?.view as Record<string, unknown> | undefined)?.renderer as
			{ testCSS?(): void } | undefined;
		renderer?.testCSS?.();
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
