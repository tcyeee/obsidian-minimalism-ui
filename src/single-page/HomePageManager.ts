import { App, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from '../core/settings';
import { SinglePageEngine } from './SinglePageEngine';

type LeafWithFile = WorkspaceLeaf & { view?: { file?: unknown } };

/**
 * HomePageManager — 首页策略层。
 *
 * 决定“何时”打开首页：会话中所有 note tab 关闭、工作区只剩空页时。（启动时的首次打开由
 * main 在 onLayoutReady 里显式调用 openHomePage 完成，不走本监听。）
 *
 * 触发信号用 active-leaf-change 而非 file-open(null)：实测快速连续 CMD+W 时 Obsidian 不保证
 * 补发 file-open(null)，会停在空页；而关闭最后一个 tab 必定触发 active-leaf-change（落到空 leaf）。
 *
 * “如何”打开（去重 / 新建 leaf）由 {@link SinglePageEngine.openHomePage} 提供机制。
 */
export class HomePageManager {
	private activeLeafHandler: ((leaf: WorkspaceLeaf | null) => void) | null = null;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		private engine: SinglePageEngine,
	) {}

	/** Register the active-leaf-change listener. Must be called after layout is ready. */
	apply() {
		this.remove();
		if (!this.getSettings().homePage) return;

		this.activeLeafHandler = () => this.maybeOpenHomePage();
		this.app.workspace.on('active-leaf-change', this.activeLeafHandler);
	}

	private maybeOpenHomePage() {
		// 首页正在打开：openHomePage 自身的 getLeaf 会先产生临时空 leaf 并触发本事件，
		// 此时再触发会无限重入；“打开途中被关掉”的情形由 openHomePage 内部兜底重试。
		if (this.engine.isOpeningHomePage()) return;
		// 工作区仍有任意带文件的 root leaf：不是“全部关闭”，跳过。
		// 这一条同时天然滤掉了插件内部导航（activateOrOpenFile 重开文件）产生的临时空 leaf——
		// 那种时刻当前文件的 leaf 仍在，hasFileLeaf 必为 true。
		let hasFileLeaf = false;
		this.app.workspace.iterateRootLeaves(l => { if ((l as LeafWithFile).view?.file) hasFileLeaf = true; });
		if (hasFileLeaf) return;
		// 工作区已无带文件的 leaf。但若当前活动空 leaf 是 getLeaf patch 刚为 Cmd+N 新建的，
		// 别用首页劫持它。
		const active = this.app.workspace.getMostRecentLeaf();
		if (active && this.engine.hasPendingIntercept(active)) return;
		void this.engine.openHomePage();
	}

	async openHomePage() {
		return this.engine.openHomePage();
	}

	remove() {
		if (this.activeLeafHandler) {
			this.app.workspace.off('active-leaf-change', this.activeLeafHandler);
			this.activeLeafHandler = null;
		}
	}
}
