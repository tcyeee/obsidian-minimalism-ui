import { App, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from './settings';

const PROPS_SELECTOR =
	'.workspace-split.mod-left-split .workspace-leaf-content[data-type="file-properties"]';

export class PropertiesAutoHeightManager {
	private mutationObserver: MutationObserver | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private leafChangeHandler: (() => void) | null = null;
	private layoutHandler: (() => void) | null = null;

	// Saved flex-grow so remove() can restore Obsidian's original value
	private savedFlexGrow = '';

	// Saved DOM position so remove() can put the panel back where it was
	private movedTabsEl: HTMLElement | null = null;
	private movedRhEl: HTMLElement | null = null;          // resize handle that travels with the panel
	private tabsOriginalNextSibling: Node | null = null;
	private originalParent: HTMLElement | null = null;

	constructor(private app: App, private getSettings: () => MinimalismUISettings) {}

	apply() {
		this.remove();
		const s = this.getSettings();
		if (!s.macSidebar || !s.autoPropertiesHeight) return;

		// 如果 Properties 面板不在左侧边栏，先将其移过去；
		// 移动完成后 layout-change 触发，layoutHandler 会接手后续 setupObserver
		void this.ensurePropertiesInLeftSidebar();

		let rafId: number | null = null;
		const syncHeight = () => {
			const tabsEl = this.findTabsEl();
			if (!tabsEl) return;
			if (rafId !== null) cancelAnimationFrame(rafId);
			rafId = requestAnimationFrame(() => {
				rafId = null;
				const toH = this.measureContentHeight();
				if (toH <= 0) return;
				tabsEl.style.height = toH + 'px';
			});
		};

		const setupObserver = (): boolean => {
			const contentEl = document.querySelector<HTMLElement>(PROPS_SELECTOR);
			const tabsEl = contentEl?.closest<HTMLElement>('.workspace-tabs') ?? null;
			if (!contentEl || !tabsEl) return false;

			// ── 1. Move panel to bottom ──────────────────────────────────────
			this.moveToBottom(tabsEl);

			// ── 2. Switch from flex-grow to explicit height ──────────────────
			// Read current height BEFORE changing flex to prevent a collapse flash.
			const currentH = tabsEl.offsetHeight;
			this.savedFlexGrow = tabsEl.style.flexGrow;
			tabsEl.dataset.propertiesAutoHeight = 'true';
			tabsEl.style.flexGrow = '0';
			tabsEl.style.flexShrink = '0';
			tabsEl.style.height = currentH + 'px';

			// ── 3. Observers ─────────────────────────────────────────────────
			this.mutationObserver = new MutationObserver(syncHeight);
			this.mutationObserver.observe(contentEl, { childList: true, subtree: true });

			const metaContent = contentEl.querySelector<HTMLElement>('.metadata-content');
			if (metaContent) {
				this.resizeObserver = new ResizeObserver(syncHeight);
				this.resizeObserver.observe(metaContent);
			}

			syncHeight();
			return true;
		};

		if (!setupObserver()) {
			this.layoutHandler = () => {
				if (setupObserver()) {
					this.app.workspace.off('layout-change', this.layoutHandler!);
					this.layoutHandler = null;
				}
			};
			this.app.workspace.on('layout-change', this.layoutHandler);
		}

		this.leafChangeHandler = () => setTimeout(syncHeight, 80);
		this.app.workspace.on('active-leaf-change', this.leafChangeHandler);
	}

	remove() {
		this.mutationObserver?.disconnect();
		this.mutationObserver = null;
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;

		if (this.leafChangeHandler) {
			this.app.workspace.off('active-leaf-change', this.leafChangeHandler);
			this.leafChangeHandler = null;
		}
		if (this.layoutHandler) {
			this.app.workspace.off('layout-change', this.layoutHandler);
			this.layoutHandler = null;
		}

		// Restore flex / height overrides
		document.querySelectorAll<HTMLElement>('.workspace-tabs[data-properties-auto-height]').forEach(el => {
			el.style.flexGrow = this.savedFlexGrow;
			el.style.flexShrink = '';
			el.style.height = '';
			delete el.dataset.propertiesAutoHeight;
		});
		this.savedFlexGrow = '';

		// Restore panel to its original position in the sidebar
		this.restorePosition();
	}

	// ── Sidebar placement ─────────────────────────────────────────────────────

	/**
	 * 检查 Properties 面板是否已在左侧边栏；若不在（通常默认位于右侧上半部分），
	 * 则将其 detach 后在左侧边栏新建一个分区（split）重新打开。
	 * 移动完成后 Obsidian 触发 layout-change，由 layoutHandler 接手后续 moveToBottom。
	 */
	private async ensurePropertiesInLeftSidebar(): Promise<void> {
		// 已在左侧边栏 → 无需移动
		if (document.querySelector(PROPS_SELECTOR)) return;

		const leaves = this.app.workspace.getLeavesOfType('file-properties') as WorkspaceLeaf[];
		if (leaves.length === 0) return; // 面板未开启，无法移动

		// 从当前位置（通常是右侧边栏）摘除
		for (const leaf of leaves) leaf.detach();

		// 在左侧边栏底部新建一个独立分区并打开 Properties
		const newLeaf = this.app.workspace.getLeftLeaf(true);
		if (!newLeaf) return;
		await newLeaf.setViewState({ type: 'file-properties', active: false });
		// layout-change 触发后 layoutHandler → setupObserver → moveToBottom 完成定位
	}

	// ── DOM reordering ────────────────────────────────────────────────────────

	/**
	 * Move tabsEl (and the resize handle preceding it) to the bottom of the
	 * sidebar container, just before .workspace-sidedock-vault-profile.
	 *
	 * Before: [...] [rh] [tabsEl] [rh2] [Other panel] [vault-profile]
	 * After:  [...] [rh2] [Other panel] [rh] [tabsEl] [vault-profile]
	 */
	private moveToBottom(tabsEl: HTMLElement): void {
		const parent = tabsEl.parentElement;
		if (!parent) return;

		// Already the last workspace-tabs → nothing to do
		const allTabs = Array.from(parent.querySelectorAll<HTMLElement>(':scope > .workspace-tabs'));
		if (allTabs[allTabs.length - 1] === tabsEl) return;

		// The resize handle immediately before tabsEl travels with it
		const prevEl = tabsEl.previousElementSibling as HTMLElement | null;
		const rh = prevEl?.classList.contains('workspace-leaf-resize-handle') ? prevEl : null;

		// Save original position (next sibling of tabsEl is enough to restore both)
		this.originalParent = parent;
		this.tabsOriginalNextSibling = tabsEl.nextSibling;
		this.movedTabsEl = tabsEl;
		this.movedRhEl = rh;

		// Insertion point: directly before vault profile, or at end of container
		const vaultProfile = parent.querySelector<HTMLElement>(':scope > .workspace-sidedock-vault-profile');

		if (vaultProfile) {
			if (rh) parent.insertBefore(rh, vaultProfile);
			parent.insertBefore(tabsEl, vaultProfile);
		} else {
			if (rh) parent.appendChild(rh);
			parent.appendChild(tabsEl);
		}
	}

	/**
	 * Put tabsEl (and its resize handle) back to the original position.
	 */
	private restorePosition(): void {
		if (!this.originalParent || !this.movedTabsEl) return;

		// Restore tabsEl first, then insert rh directly before it
		if (this.tabsOriginalNextSibling) {
			this.originalParent.insertBefore(this.movedTabsEl, this.tabsOriginalNextSibling);
		} else {
			this.originalParent.appendChild(this.movedTabsEl);
		}
		if (this.movedRhEl) {
			this.originalParent.insertBefore(this.movedRhEl, this.movedTabsEl);
			this.movedRhEl = null;
		}

		this.movedTabsEl = null;
		this.tabsOriginalNextSibling = null;
		this.originalParent = null;
	}

	// ── height helpers ────────────────────────────────────────────────────────

	private findTabsEl(): HTMLElement | null {
		const contentEl = document.querySelector<HTMLElement>(PROPS_SELECTOR);
		const tabsEl = contentEl?.closest<HTMLElement>('.workspace-tabs') ?? null;
		if (!tabsEl?.dataset.propertiesAutoHeight) return null;
		return tabsEl;
	}

	/**
	 * Measure the height .workspace-tabs needs to show all properties without clipping.
	 *
	 * .metadata-content has a natural (unconstrained) height, so offsetHeight is the
	 * true rendered height of all property rows.  We add:
	 *   • topOffset  — distance from .workspace-tabs top to .metadata-content top
	 *                  (tab-header, "PROPERTIES" label, container padding, etc.)
	 *   • bottomPad  — bottom padding of .workspace-leaf-content
	 */
	private measureContentHeight(): number {
		const contentEl = document.querySelector<HTMLElement>(PROPS_SELECTOR);
		if (!contentEl) return 0;
		const tabsEl = contentEl.closest<HTMLElement>('.workspace-tabs');
		if (!tabsEl) return 0;

		const metaContent = contentEl.querySelector<HTMLElement>('.metadata-content');
		if (!metaContent) return 0;

		const tabsTop = tabsEl.getBoundingClientRect().top;
		const metaTop = metaContent.getBoundingClientRect().top;
		const topOffset = metaTop - tabsTop;
		const metaH = metaContent.offsetHeight;
		const bottomPad = parseFloat(getComputedStyle(contentEl).paddingBottom) || 8;

		return Math.round(topOffset + metaH + bottomPad);
	}
}
