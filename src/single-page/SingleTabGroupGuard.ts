import { App, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from '../core/settings';
import { Feature } from '../core/Feature';

/**
 * SingleTabGroupGuard — 单页模式下强制主区域只保留一个标签组。
 *
 * Obsidian 主编辑区可分屏出多个标签组(WorkspaceTabs)，并可把标签拖出成独立弹窗(popout)。
 * 单页写作体验下只应存在一个标签组。本单元是前两道源头封锁的**兜底**：
 *   · {@link SplitDisabler} 关掉 Platform.canSplit 并把拖拽落点收口成 'center'，封死分屏；
 *   · SinglePageEngine 的 getLeaf 拦截把 'split'/'window' 收口成新开 tab。
 * 它负责这两道拦截覆盖不到的残余情况：
 *   1. 弹出窗口(popout) —— canSplit 管不到弹窗，弹窗仍可由命令/菜单产生；
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
 * 搬迁期间必须把 detach 还原成"纯粹销毁"(withoutDetachSideEffects)：平时 detach 补丁会重开面包屑
 * 前一页、并在被摘空的外组里补一个空白 leaf 顶住可视位，于是外组永不为空，本单元在下一次
 * layout-change 上又看到多组、再搬再摘，每轮新建 leaf —— 这正是"主区左右分屏后 Obsidian 卡死、
 * 且重启也救不回来"那个恶性 BUG 的成因。详见
 * {@link SinglePageEngine.runWithoutDetachSideEffects}。代价是活动 leaf 可能随外组消失，故搬完由
 * 本单元自己把 activeLeaf 钉回主组对应的页面。
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

	// 熔断器。合并本应一两轮就收敛（变成单组后 enforce 快速返回），短时间内反复合并只能说明出现
	// 了未知的「摘空后又冒出新组」回路。绝不能任它跑下去：每轮都新建 leaf，Obsidian 会直接卡死，
	// 而爆炸后的布局又被存进 workspace.json 导致重启复现 —— 用户只能手删插件目录才能恢复。
	// 触发后停掉监听、保留现场并报错，Obsidian 仍可正常使用（最多是主区留着分屏）。
	private static readonly MERGE_BURST_LIMIT = 24;
	private static readonly MERGE_BURST_WINDOW_MS = 2000;
	private burstStartedAt = 0;
	private burstCount = 0;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		// 合并产生新 leaf 后回调（SinglePageEngine.adoptLeaf）：补 history / detach 补丁，
		// 使这些绕过 getLeaf 拦截的 leaf 也受引擎统一管理。setViewState 异步就位后再调用。
		private onLeafCreated?: (leaf: WorkspaceLeaf) => void,
		// SinglePageEngine.runWithoutDetachSideEffects：搬迁期间 detach 只许销毁，见类注释。
		private withoutDetachSideEffects: <T>(fn: () => T) => T = (fn) => fn(),
	) {}

	apply(): void {
		this.remove();
		if (!this.getSettings().disableNoteTabs) return;
		this.burstStartedAt = 0;
		this.burstCount = 0;
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
		if (this.tripBreaker()) return;

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
			// key → 主组里承载该内容的 leaf。既用于去重，也用于搬迁后定位活动页面。
			const existing = new Map<string, WorkspaceLeaf>();
			for (const leaf of groups.get(primaryGroup)!) {
				const key = this.dedupKey(leaf);
				if (key && !existing.has(key)) existing.set(key, leaf);
			}
			// 活动页面搬迁后在主组里的落点；活动 leaf 本就在主组时保持 null（无需移动）。
			let activeTarget: WorkspaceLeaf | null = null;
			// 插入位置：接在主组现有标签之后。children 是 WorkspaceParent 的运行时字段(类型未公开)。
			let index = ((primaryGroup as { children?: unknown[] }).children?.length) ?? 0;
			this.withoutDetachSideEffects(() => {
				for (const [group, leaves] of groups) {
					if (group === primaryGroup) continue;
					for (const leaf of leaves) {
						const li = leaf as LeafInternal;
						const key = this.dedupKey(leaf);
						const duplicate = key ? existing.get(key) : undefined;
						if (duplicate) {
							// 同一文件/视图已在主组，丢弃重复件，活动页面改指向主组那一份
							if (leaf === active) activeTarget = duplicate;
							li.detach();
							continue;
						}
						const vs = li.getViewState();
						const newLeaf = ws.createLeafInParent(primaryGroup, index++) as LeafInternal;
						// setViewState 就位后再 adopt：此时 leaf.history 才实例化，patchLeafHistory 方能生效。
						void newLeaf.setViewState(vs as { type: string;[k: string]: unknown })
							.then(() => this.onLeafCreated?.(newLeaf));
						if (key) existing.set(key, newLeaf);
						if (leaf === active) activeTarget = newLeaf;
						li.detach(); // 搬走后销毁原件；空组/空弹窗随之自动回收
					}
				}
			});
			this.restoreActiveLeaf(primaryGroup, activeRoot, activeTarget);
		} finally {
			this.isEnforcing = false;
		}
	}

	/**
	 * 把活动 leaf 显式钉回主组。两个必须：
	 *   · 停用了可视位交接，原活动 leaf 可能已随外组一起销毁 —— 不能把接替者的选择权留给
	 *     Obsidian 的 updateLayout（它会挑"左邻 tab"，即一篇不相干的旧笔记）；
	 *   · createLeafInParent 内部会把每个新建 leaf 设为活动 leaf，不纠正的话用户会被甩到最后
	 *     一个被搬过来的页面上，而不是停在自己原本看的那一页。
	 */
	private restoreActiveLeaf(primaryGroup: unknown, activeRoot: WorkspaceLeaf | null, activeTarget: WorkspaceLeaf | null): void {
		const children = ((primaryGroup as { children?: WorkspaceLeaf[] }).children) ?? [];
		// 原活动 leaf 本就在主组 → 它健在，原样停在那一页。
		const stayed = activeRoot && (activeRoot as LeafInternal).parent === primaryGroup ? activeRoot : null;
		const target = activeTarget ?? stayed ?? children[children.length - 1];
		if (target) this.app.workspace.setActiveLeaf(target, { focus: true });
	}

	// 见 MERGE_BURST_LIMIT 上方的熔断器说明。返回 true 表示已熔断，调用方立即放弃本轮合并。
	private tripBreaker(): boolean {
		const now = Date.now();
		if (now - this.burstStartedAt > SingleTabGroupGuard.MERGE_BURST_WINDOW_MS) {
			this.burstStartedAt = now;
			this.burstCount = 0;
		}
		if (++this.burstCount <= SingleTabGroupGuard.MERGE_BURST_LIMIT) return false;
		console.error('[minimalism-ui] single tab group merge did not converge; guard disabled to keep Obsidian responsive');
		this.remove();
		return true;
	}
}
