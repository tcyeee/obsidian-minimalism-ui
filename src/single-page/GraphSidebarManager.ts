/**
 * GraphSidebarManager — 进入/离开全局关系图时自动收起 / 恢复左侧边栏。
 *
 * 行为：
 * - 进入全局关系图(root leaf 的导航键为 GLOBAL_GRAPH_KEY)时，记录当前左侧边栏开合状态并收起。
 * - 离开关系图(切到任意其他 root 页面)时，恢复到**进入关系图那一刻**的状态：
 *   进入前是展开的就重新展开；进入前本就收起则保持收起。
 *
 * 只管左侧边栏(workspace.leftSplit)，符合插件的极简哲学。
 *
 * 检测复用 {@link SinglePageEngine} 在 active-leaf-change 上已算好的 navKey：
 * 引擎仅在真正的 root leaf 切换时调用 {@link handleRootNav}，侧边栏点击 / 过场空 leaf
 * 已被引擎的 isRootLeaf 守卫过滤，不会误触发。
 */
import { App } from 'obsidian';
import { GLOBAL_GRAPH_KEY } from './NavigationHistory';

type WorkspaceSidedock = { collapsed: boolean; collapse(): void; expand(): void };

export class GraphSidebarManager {
	// 进入关系图前左侧边栏是否收起；null 表示当前不在关系图模式。
	private savedCollapsed: boolean | null = null;

	constructor(private app: App) {}

	private get leftSplit(): WorkspaceSidedock | null {
		return (this.app.workspace.leftSplit as unknown as WorkspaceSidedock) ?? null;
	}

	// 由引擎在 root leaf 切换时调用，navKey 为该 root leaf 的导航键(无文件视图为 null)。
	handleRootNav(navKey: string | null) {
		const isGraph = navKey === GLOBAL_GRAPH_KEY;
		if (isGraph) {
			this.enterGraph();
		} else {
			this.leaveGraph();
		}
	}

	private enterGraph() {
		if (this.savedCollapsed !== null) return; // 已在关系图模式，避免重复记录覆盖原始状态
		const split = this.leftSplit;
		if (!split) return;
		this.savedCollapsed = split.collapsed;
		if (!split.collapsed) split.collapse();
	}

	private leaveGraph() {
		if (this.savedCollapsed === null) return; // 本就不在关系图模式
		const split = this.leftSplit;
		// 进入前是展开的才恢复展开；进入前本就收起则保持现状。
		if (split && this.savedCollapsed === false && split.collapsed) split.expand();
		this.savedCollapsed = null;
	}

	// 插件卸载 / 关闭单页模式时调用：若仍在关系图模式，恢复到进入前状态，保证无残留。
	reset() {
		this.leaveGraph();
	}
}
