import { App, TFile } from 'obsidian';
import { MinimalismUISettings } from '../core/settings';
import { SinglePageEngine } from './SinglePageEngine';

/**
 * HomePageManager — 首页策略层。
 *
 * 决定“何时”打开首页：启动时，以及所有 tab 关闭后（file-open 事件的 file 为 null）。
 * “如何”打开（去重 / 新建 leaf）由 {@link SinglePageEngine.openHomePage} 提供机制。
 */
export class HomePageManager {
	private homePageHandler: ((file: TFile | null) => void) | null = null;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		private engine: SinglePageEngine,
	) {}

	/** Register the file-open listener. Must be called after layout is ready. */
	apply() {
		this.remove();
		if (!this.getSettings().homePage) return;

		this.homePageHandler = (file: TFile | null) => {
			if (!file) {
				// Skip if the active leaf was just created by getLeaf patch (e.g. Cmd+N)
				// to avoid hijacking it with the home page.
				const active = this.app.workspace.getMostRecentLeaf();
				if (active && this.engine.hasPendingIntercept(active)) return;
				void this.engine.openHomePage();
			}
		};
		this.app.workspace.on('file-open', this.homePageHandler);
	}

	async openHomePage() {
		return this.engine.openHomePage();
	}

	remove() {
		if (this.homePageHandler) {
			this.app.workspace.off('file-open', this.homePageHandler);
			this.homePageHandler = null;
		}
	}
}
