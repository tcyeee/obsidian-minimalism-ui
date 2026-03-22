import { App, TFile, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from './settings';
import { TabCacheManager } from './TabCacheManager';

type LeafWithInternals = WorkspaceLeaf & {
	containerEl?: HTMLElement;
	detach: () => void;
};

/**
 * Manages single-page mode side-effects that live outside TabCacheManager:
 *   • Pin block  — prevents right-click pin and sidebar leaf detach
 *   • Home page  — opens a designated note on startup / when all tabs close
 *
 * isOpeningHomePage is owned by main.ts (shared with TabCacheManager) and
 * injected via getter + setter to avoid a circular dependency.
 */
export class SinglePageManager {
	// ── Pin block ────────────────────────────────────────────────────────────
	private pinBlockHandler: ((e: MouseEvent) => void) | null = null;
	private detachPatches = new Map<WorkspaceLeaf, () => void>();

	// ── Home page ────────────────────────────────────────────────────────────
	private homePageHandler: ((file: TFile | null) => void) | null = null;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		private tabCache: TabCacheManager,
		private getIsOpeningHomePage: () => boolean,
		private setIsOpeningHomePage: (v: boolean) => void,
	) {}

	// ── Pin block ─────────────────────────────────────────────────────────────

	/** Set up right-click pin blocking. Safe to call before layout is ready. */
	apply() {
		this.removePinBlock();
		if (!this.getSettings().disablePinTab) return;

		this.pinBlockHandler = (e: MouseEvent) => {
			if ((e.target as Element).closest('.workspace-tab-header.tappable')) {
				e.stopImmediatePropagation();
				e.preventDefault();
			}
		};
		document.addEventListener('contextmenu', this.pinBlockHandler, true);
		this.patchSidebarLeafDetach();
	}

	private patchSidebarLeafDetach() {
		this.app.workspace.iterateAllLeaves(leaf => {
			if (this.detachPatches.has(leaf)) return;
			const leafEl = (leaf as LeafWithInternals).containerEl;
			if (!leafEl?.closest('.workspace-split.mod-left-split')) return;
			const original = (leaf as LeafWithInternals).detach.bind(leaf);
			// Store the original on the leaf so SidebarLayoutManager can bypass
			// this block when it needs to programmatically clear the sidebar.
			(leaf as LeafWithInternals & { __minui_origDetach__?: () => void }).__minui_origDetach__ = original;
			(leaf as LeafWithInternals).detach = () => { /* blocked */ };
			this.detachPatches.set(leaf, original);
		});
	}

	private removePinBlock() {
		if (this.pinBlockHandler) {
			document.removeEventListener('contextmenu', this.pinBlockHandler, true);
			this.pinBlockHandler = null;
		}
		for (const [leaf, original] of this.detachPatches) {
			(leaf as LeafWithInternals).detach = original;
			delete (leaf as LeafWithInternals & { __minui_origDetach__?: () => void }).__minui_origDetach__;
		}
		this.detachPatches.clear();
	}

	// ── Home page ─────────────────────────────────────────────────────────────

	/** Register the file-open listener. Must be called after layout is ready. */
	applyHomePage() {
		this.removeHomePage();
		if (!this.getSettings().homePage) return;

		this.homePageHandler = (file: TFile | null) => {
			if (!file) {
				// Skip if the active leaf was just created by getLeaf patch (e.g. Cmd+N)
				// to avoid hijacking it with the home page.
				const active = this.app.workspace.getMostRecentLeaf();
				if (active && this.tabCache.hasPendingIntercept(active)) return;
				void this.openHomePage();
			}
		};
		this.app.workspace.on('file-open', this.homePageHandler);
	}

	/** Open the home page in the current leaf. Must be called after layout is ready. */
	async openHomePage() {
		if (this.getIsOpeningHomePage()) return;
		const path = this.getSettings().homePage;
		if (!path) return;
		// 如果当前有 Modal 打开（如设置窗口），跳过，避免抢占焦点导致 Modal 被关闭
		if (document.querySelector('.modal-container')) return;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		this.setIsOpeningHomePage(true);
		try {
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file);
			// Home-page leaf bypasses the getLeaf interceptor, so patch its
			// history manually to keep the cross-tab nav stack consistent.
			this.tabCache.patchLeafHistory(leaf);
		} finally {
			this.setIsOpeningHomePage(false);
		}
	}

	private removeHomePage() {
		if (this.homePageHandler) {
			this.app.workspace.off('file-open', this.homePageHandler);
			this.homePageHandler = null;
		}
	}

	// ── Cleanup ───────────────────────────────────────────────────────────────

	remove() {
		this.removePinBlock();
		this.removeHomePage();
	}
}
