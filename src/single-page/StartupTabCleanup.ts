import { App, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from '../core/settings';
import { SinglePageEngine } from './SinglePageEngine';

/**
 * StartupTabCleanup — 单页模式下每次启动时把主区收拢成单独一页。
 *
 * workspace.json 存着上次会话遗留的任意布局（多标签、分屏、弹窗），而单页模式只认一个标签组、
 * 一条导航栈。{@link SplitDisabler} 已从源头封死新的分屏，本单元给存量布局一个确定的起点：
 * 设了首页就只留首页，没设就只留上次停留的那一页。
 *
 * 这同时是分屏类恶性 BUG 的最后一道兜底 —— 无论上次退出时布局坏成什么样，重启后必然回到一个
 * 干净的单页状态，不必像以前那样只能手删插件目录才能恢复。
 *
 * 一次性动作、无持久副作用，故不实现 Feature 契约、不进 features[]（同 FirstRunCleanup）。
 */
export class StartupTabCleanup {
	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		private engine: SinglePageEngine,
	) {}

	async run(): Promise<void> {
		if (!this.getSettings().disableNoteTabs) return;
		// 设了首页：engine.resetToHomePage() 本身就是「打开/激活首页 + 关掉其余全部 root leaf +
		// 导航栈重置为仅首页」这一整套，直接复用。
		if (this.getSettings().homePage) {
			await this.engine.resetToHomePage();
			return;
		}
		this.keepOnlyMostRecent();
	}

	// 没设首页：保留上次会话停留的那一页（workspace 恢复完即 getMostRecentLeaf），关掉其余。
	// 它若是空视图（上次退出时就停在空页），退而保留第一个有内容的 leaf——否则会把用户所有笔记
	// 都关掉却只留一张空白页。
	private keepOnlyMostRecent(): void {
		const leaves: WorkspaceLeaf[] = [];
		// 回调必须返回 undefined：iterateLeaves 在回调返回真值时**中断**遍历，而 push() 返回数组
		// 长度（恒为真），写成 `(leaf) => leaves.push(leaf)` 只会收到第一个 leaf。
		this.app.workspace.iterateRootLeaves((leaf) => { leaves.push(leaf); });
		if (leaves.length <= 1) return;

		const recent = this.app.workspace.getMostRecentLeaf();
		const keep = (recent && leaves.includes(recent) && this.hasContent(recent) ? recent : null)
			?? leaves.find((leaf) => this.hasContent(leaf))
			?? leaves[0];

		// detach 只许销毁：平时 detach 补丁会重开面包屑前一页（边关边开，leaf 数根本降不下来）
		// 并补空白顶位。代价是活动 leaf 要由我们自己钉回去（见 runWithoutDetachSideEffects）。
		this.engine.runWithoutDetachSideEffects(() => {
			for (const leaf of leaves) if (leaf !== keep) leaf.detach();
		});
		this.app.workspace.setActiveLeaf(keep, { focus: true });
		// 收拢后导航栈的起点变了（原先的 active-leaf-change 可能记的是别的页），重新播种。
		this.engine.ensureNavSeeded();
	}

	// deferred（恢复出、尚未实例化）的 leaf 只有 getViewState() 可读，view 实例还不在。
	private hasContent(leaf: WorkspaceLeaf): boolean {
		const viewState = leaf.getViewState() as { type?: string; state?: { file?: string } };
		return !!viewState.state?.file || (!!viewState.type && viewState.type !== 'empty');
	}
}
