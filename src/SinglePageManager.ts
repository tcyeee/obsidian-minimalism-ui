import { App, TFile } from 'obsidian';
import { MinimalismUISettings } from './settings';
import { TabCacheManager } from './TabCacheManager';

/**
 * Manages single-page mode side-effects that live outside TabCacheManager:
 *   • Pin block  — prevents right-click pin on tab headers
 *   • Home page  — opens a designated note on startup / when all tabs close
 *
 * Sidebar leaf detach blocking and openHomePage() logic live in TabCacheManager
 * because they directly operate on leaves.
 */
export class SinglePageManager {
	// ── Pin block ────────────────────────────────────────────────────────────
	private pinBlockHandler: ((e: MouseEvent) => void) | null = null;

	// ── Home page ────────────────────────────────────────────────────────────
	private homePageHandler: ((file: TFile | null) => void) | null = null;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		private tabCache: TabCacheManager,
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
		// Sidebar leaf detach blocking is managed by TabCacheManager.apply()
	}

	private removePinBlock() {
		if (this.pinBlockHandler) {
			document.removeEventListener('contextmenu', this.pinBlockHandler, true);
			this.pinBlockHandler = null;
		}
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
				void this.tabCache.openHomePage();
			}
		};
		this.app.workspace.on('file-open', this.homePageHandler);
	}

	async openHomePage() {
		return this.tabCache.openHomePage();
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
