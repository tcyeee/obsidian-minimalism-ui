import { App, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from '../core/settings';
import { Feature } from '../core/Feature';

/**
 * SingleTabGroupGuard — 单页模式下强制主区域只保留一个标签组。
 *
 * Obsidian 主编辑区可分屏出多个标签组(WorkspaceTabs)，并可把标签拖出成独立弹窗(popout)。
 * 单页写作体验下只应存在一个标签组。本单元是 `getLeaf` 源头拦截(见 SinglePageEngine：'split'/
 * 'window' 已被收口成新开 tab)的**兜底**，负责两类拦截覆盖不到的情况：
 *   1. 拖拽分屏 / 拖出弹窗 —— 经 Obsidian 内部拖拽管理器，不走 getLeaf；
 *   2. 重启恢复 / 开启单页模式时主区域已存在的多分屏、多弹窗(存量布局)。
 *
 * 机制：监听 `layout-change`，把主窗口(rootSplit)主标签组以外的所有 root leaf(含弹窗里的)
 * 读出 viewState、在主标签组里重建、再 detach 原件；空标签组 / 空弹窗由 Obsidian 在最后一个
 * leaf detach 后自动回收。搬运而非丢弃，保证笔记内容不丢失。同一文件在多处打开时只保留一份
 * (one-file-one-leaf 不变量，与 SinglePageEngine 一致)。
 *
 * 重入守卫：createLeafInParent / setViewState / detach 都会再次触发 layout-change，
 * `isEnforcing` 期间忽略；setViewState 异步 resolve 后那次 layout-change 落到「单组快速返回」，
 * 不会死循环。思路同 LeafCache.isEvictingNow()。
 *
 * gate 在 disableNoteTabs(单页模式)下；非单页模式 apply() 直接空转，分屏/弹窗恢复原生可用。
 */

type LeafInternal = WorkspaceLeaf & {
	parent?: unknown;
	getContainer: () => unknown;
	getViewState: () => { type?: string; state?: { file?: string } };
	setViewState: (state: { type: string;[k: string]: unknown }, eState?: unknown) => Promise<void>;
	detach: () => void;
};

type WorkspaceInternal = {
	createLeafInParent: (parent: unknown, index: number) => WorkspaceLeaf;
};

export class SingleTabGroupGuard implements Feature {
	private handler: (() => void) | null = null;
	private isEnforcing = false;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
	) {}

	apply(): void {
		this.remove();
		if (!this.getSettings().disableNoteTabs) return;
		this.handler = () => this.enforce();
		this.app.workspace.on('layout-change', this.handler);
		// 处理存量布局：开启单页模式 / 重启恢复出的多分屏弹窗。
		this.enforce();
	}

	remove(): void {
		if (this.handler) {
			this.app.workspace.off('layout-change', this.handler);
			this.handler = null;
		}
		// 不回滚已合并的布局——合并是目标终态，重新拆分既不可能也无意义。
	}

	// 去重键：文件路径优先，其次视图类型；空视图返回 null(不参与去重，但仍会被搬运)。
	private dedupKey(leaf: WorkspaceLeaf): string | null {
		const vs = (leaf as LeafInternal).getViewState() as { type?: string; state?: { file?: string } } | undefined;
		const filePath = vs?.state?.file;
		if (filePath) return `file:${filePath}`;
		const viewType = vs?.type;
		if (!viewType || viewType === 'empty') return null;
		return `view:${viewType}`;
	}

	private enforce(): void {
		if (!this.getSettings().disableNoteTabs) return;
		if (this.isEnforcing) return;

		// 按所属标签组(leaf.parent)给所有 root leaf 分桶；iterateRootLeaves 含弹窗、排除侧边栏。
		const rootSplit = this.app.workspace.rootSplit as unknown;
		const groups = new Map<unknown, WorkspaceLeaf[]>();
		const active = this.app.workspace.getMostRecentLeaf();
		let activeRoot: WorkspaceLeaf | null = null;
		this.app.workspace.iterateRootLeaves((leaf) => {
			const parent = (leaf as LeafInternal).parent;
			if (!groups.has(parent)) groups.set(parent, []);
			groups.get(parent)!.push(leaf);
			if (leaf === active) activeRoot = leaf;
		});
		if (groups.size <= 1) return; // 已是单组，常态快速返回

		// 主组必须属于主窗口(rootSplit)，绝不能选中弹窗里的组(否则会把主区往弹窗里搬)：
		// 优先取活动 leaf 所在组(限其在主窗口内)，否则取第一个属于 rootSplit 的组。
		const inMainWindow = (leaf: WorkspaceLeaf) => (leaf as LeafInternal).getContainer() === rootSplit;
		let primaryGroup: unknown = null;
		if (activeRoot && inMainWindow(activeRoot)) {
			primaryGroup = (activeRoot as LeafInternal).parent;
		} else {
			for (const [group, leaves] of groups) {
				if (inMainWindow(leaves[0])) { primaryGroup = group; break; }
			}
		}
		if (primaryGroup === null) return; // 理论不达：rootSplit 至少有一个组

		this.isEnforcing = true;
		try {
			const ws = this.app.workspace as unknown as WorkspaceInternal;
			const existing = new Set<string>();
			for (const leaf of groups.get(primaryGroup)!) {
				const key = this.dedupKey(leaf);
				if (key) existing.add(key);
			}
			// 插入位置：接在主组现有标签之后。children 是 WorkspaceParent 的运行时字段(类型未公开)。
			let index = ((primaryGroup as { children?: unknown[] }).children?.length) ?? 0;
			for (const [group, leaves] of groups) {
				if (group === primaryGroup) continue;
				for (const leaf of leaves) {
					const li = leaf as LeafInternal;
					const key = this.dedupKey(leaf);
					if (key && existing.has(key)) {
						li.detach(); // 同一文件/视图已在主组，丢弃重复件
						continue;
					}
					const vs = li.getViewState();
					const newLeaf = ws.createLeafInParent(primaryGroup, index++) as LeafInternal;
					void newLeaf.setViewState(vs as { type: string;[k: string]: unknown });
					if (key) existing.add(key);
					li.detach(); // 搬走后销毁原件；空组/空弹窗随之自动回收
				}
			}
		} finally {
			this.isEnforcing = false;
		}
	}
}
