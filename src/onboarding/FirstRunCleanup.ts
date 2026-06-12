import { App, WorkspaceLeaf } from 'obsidian';

/**
 * FirstRunCleanup — 首次启用插件时的一次性工作区收拢。
 *
 * 全新安装首次启用时，主编辑区可能残留多个标签页/分屏（旧 vault 的遗留布局，或
 * Obsidian 默认打开的欢迎页）。单页写作体验下应只剩一个 leaf，故保留 rootSplit 内
 * 迭代顺序的第一个 leaf，detach 其余。仅执行一次，由 firstRunCleanupDone 标记控制
 * （老用户升级时该标记已在 loadSettings 里被置 true，不会触发，避免误关既有标签）。
 *
 * iterateRootLeaves 只遍历主 rootSplit，天然排除左右侧边栏与 popout 弹出窗口。
 * 这是一次性动作、无持久副作用，故不实现 Feature 契约、不进 features[]。
 */
export class FirstRunCleanup {
	constructor(
		private app: App,
		private markDone: () => Promise<void>,
	) {}

	async run() {
		const leaves: WorkspaceLeaf[] = [];
		this.app.workspace.iterateRootLeaves((leaf) => leaves.push(leaf));
		// 保留第一个，关闭其余；少于两个时无需收拢。detach 同步完成，故先于随后的首页逻辑。
		for (let i = 1; i < leaves.length; i++) leaves[i].detach();
		await this.markDone();
	}
}
