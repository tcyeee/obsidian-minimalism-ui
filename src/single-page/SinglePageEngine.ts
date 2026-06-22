/**
 * SinglePageEngine — 单页模式的核心引擎
 *
 * 不变量：**一个文件 ⇄ 一个 leaf**，并受 LRU 上限约束；导航栈与 leaf 生命周期解耦。
 *
 * 职责：
 * 1. **getLeaf 拦截** — monkey-patch `workspace.getLeaf()`，将所有常规导航强制走新建 tab 路径，
 *    再注入一次性 `openFile` 拦截器，在文件实际加载前查重：若 workspace 中已有同路径 leaf，
 *    直接激活复用，丢弃空 leaf，避免重复打开与闪烁。
 *
 * 2. **LRU 淘汰** — 委托给 {@link LeafCache}：`active-leaf-change` 时调用其 `trackActive()`，
 *    维护最近使用队列并在超额时 detach 最旧 leaf。
 *
 * 3. **跨 tab 导航栈** — 委托给 {@link NavigationHistory}：patch 每个 leaf 的
 *    `history.back/forward/canGoBack/canGoForward`，以及内置命令 `app:go-back` /
 *    `app:go-forward`，使快捷键在任意焦点位置均可跨 tab 前进后退。本类只负责把这些入口
 *    路由到 NavigationHistory，并提供 `activateOrOpenFile`（定位/重新打开 leaf）回调。
 *
 * 4. **ResizeObserver 错误抑制** — 委托给 {@link ResizeObserverErrorSuppressor}。
 *
 * 5. **首页打开机制** — `openHomePage()` 安全地把指定笔记打开为 leaf（含去重）。
 *    何时打开（启动 / 全部关闭）由 {@link HomePageManager} 决定，本类只提供机制。
 *
 * pin 相关拦截（右键 pin、侧边栏 leaf detach 守卫）不在本类，已收敛到 PinManager。
 *
 * `apply()` 注册所有 patch 与监听器；`remove()` 完整还原，保证插件卸载后无残留副作用。
 *
 * active-leaf-change 上的两件事（LRU、导航记录）由单一 dispatcher 按固定顺序触发，避免依赖多个
 * listener 的注册顺序；入场动画不在此触发，改由 activateOrOpenFile 在定位到目标 leaf 后直接调用。
 */
import { App, TAbstractFile, TFile, WorkspaceLeaf, normalizePath } from 'obsidian';
import { MinimalismUISettings } from '../core/settings';
import { AnimationClass, GLOBAL_GRAPH_KEY, NavigationHistory, filelessViewKey, isFilelessViewKey, viewTypeFromKey } from './NavigationHistory';
import { ResizeObserverErrorSuppressor } from './ResizeObserverErrorSuppressor';
import { LeafCache } from './LeafCache';
import { GraphSidebarManager } from './GraphSidebarManager';

type WorkspaceInternal = {
	getLeaf: (newLeaf?: boolean | string) => WorkspaceLeaf;
	revealLeaf: (leaf: WorkspaceLeaf) => void;
};

type LeafInternal = WorkspaceLeaf & {
	openFile: (file: TFile, state?: unknown) => Promise<void>;
	setViewState: (state: { type: string;[k: string]: unknown }, eState?: unknown) => Promise<void>;
	history?: {
		back: () => void;
		forward: () => void;
		canGoBack?: () => boolean;
		canGoForward?: () => boolean;
	};
	view?: {
		file?: TFile;
		contentEl?: HTMLElement;
		getViewType?: () => string;
		getDisplayText?: () => string;
	};
	parent?: unknown;
	containerEl?: HTMLElement;
	detach: () => void;
};

type HistoryPatch = {
	back: () => void;
	forward: () => void;
	canGoBack: (() => boolean) | undefined;
	canGoForward: (() => boolean) | undefined;
};

export class SinglePageEngine {
	private isReusingLeaf = false;
	private originalGetLeaf: ((newLeaf?: boolean | string) => WorkspaceLeaf) | null = null;
	private originalRevealLeaf: ((leaf: WorkspaceLeaf) => void) | null = null;
	private nav: NavigationHistory;
	private leafCache: LeafCache;
	private graphSidebar: GraphSidebarManager;
	private resizeErrSuppressor = new ResizeObserverErrorSuppressor();
	private activeLeafChangeHandler: ((leaf: WorkspaceLeaf | null) => void) | null = null;
	private historyPatches = new Map<WorkspaceLeaf, HistoryPatch>();
	// root leaf detach 补丁：触发时通知 nav 并清理 patch 注册表，覆盖所有关闭路径（CMD+W、右键、X 按钮）
	private rootDetachPatches = new Map<WorkspaceLeaf, () => void>();
	// 由 getLeaf patch 新建、尚未调用 openFile 的空 leaf
	private pendingInterceptLeaves = new Set<WorkspaceLeaf>();
	// 首页打开期间为 true，避免 getLeaf 拦截器介入
	private _isOpeningHomePage = false;
	// openHomePage 异步打开 await 期间，首页 leaf 又被快速 CMD+W 关掉时置位（await 后 parent 为 null）。
	// 此刻重入锁未释放，无法立即重开，置位后由当前这次的 finally 兜底补开，保证最终落在首页而非空页。
	private _homePageReopenQueued = false;
	private renameHandler: ((file: TAbstractFile, oldPath: string) => void) | null = null;
	private deleteHandler: ((file: TAbstractFile) => void) | null = null;
	// 导航历史变更通知：引擎记录一次导航后回调，使面包屑等独立组件能在 active-leaf-change 未触发
	// （如 deferred 视图经 revealLeaf 显示）时也及时刷新。由 main.ts 注入，跨 apply/remove 持续有效。
	private navChangeListener: ((leaf: WorkspaceLeaf | null) => void) | null = null;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
	) {
		this.nav = new NavigationHistory(app, getSettings, (path, animCls) => this.activateOrOpenFile(path, animCls));
		this.leafCache = new LeafCache(app);
		this.graphSidebar = new GraphSidebarManager(app);
	}

	apply() {
		this.remove();
		this.leafCache.reset();

		this.resizeErrSuppressor.apply();

		if (!this.getSettings().disableNoteTabs) return;

		// 拦截所有会新建/复用 leaf 的 getLeaf 调用（false/undefined/true/'tab'），
		// 统一改为新开 tab 并注入一次性 openFile 拦截器，实现全路径去重。
		// 单页模式下连 'split'(分屏) / 'window'(弹出窗口) 也收口成新开 tab，强制主区域只有一个
		// 标签组——命令分屏、"在右侧打开"、弹窗全部塌成单页 tab，源头拦截无闪烁。拖拽分屏 / 拖出
		// 弹窗走不到 getLeaf，由 SingleTabGroupGuard 监听 layout-change 兜底合并。
		const ws = this.app.workspace as unknown as WorkspaceInternal;
		this.originalGetLeaf = ws.getLeaf.bind(ws);
		ws.getLeaf = (newLeaf?: boolean | string) => {
			const shouldIntercept = newLeaf === false || newLeaf === undefined || newLeaf === true
				|| newLeaf === 'tab' || newLeaf === 'split' || newLeaf === 'window';
			if (shouldIntercept && !this.isReusingLeaf && !this._isOpeningHomePage) {
				const leaf = this.originalGetLeaf!('tab');
				this.interceptLeafOpenFile(leaf);
				return leaf;
			}
			return this.originalGetLeaf!(newLeaf);
		};

		// 兜底 revealLeaf：插件常用 `getLeavesOfType()[0]` 复用已有 leaf 后直接 revealLeaf 显示视图
		// （如 day-echo）。若该 leaf 是 deferred（工作区重启恢复、尚未实例化）的无文件主区视图，
		// Obsidian 在 reveal 时不触发 active-leaf-change，导致导航历史 / currentRootPath / 面包屑全都
		// 不知道该视图已显示，直到用户在视图内点击才恢复——表现为“困死”。在此对被显示的 root leaf
		// 直接补走一遍 nav 记录（handleNavTrack 自带 isRootLeaf 守卫，侧边栏 reveal 不受影响；幂等）。
		this.originalRevealLeaf = ws.revealLeaf.bind(ws);
		ws.revealLeaf = (leaf: WorkspaceLeaf) => {
			this.originalRevealLeaf!(leaf);
			if (!leaf) return;
			// 原生 revealLeaf 只 selectTab(切换 tab 组的可见 tab),从不更新 workspace.activeLeaf、
			// 也不触发 active-leaf-change。对 root leaf 这会留下"可见 ≠ 活动"的半激活态:此时按后退,
			// 目标(上一篇笔记)恰好仍是 activeLeaf,setActiveLeaf 对相同 leaf 整体短路——不切 tab、
			// 不发事件,后退表现为无效;须先前进一次(真正激活本视图、同步 activeLeaf)后退才恢复。
			// 故对被 reveal 的 root leaf 在此补一次真正激活,保证可见 tab 与 activeLeaf 始终一致。
			// 侧边栏 leaf 不受影响(激活会抢编辑器焦点,且本就无此问题)。
			let isRootLeaf = false;
			this.app.workspace.iterateRootLeaves(l => { if (l === leaf) isRootLeaf = true; });
			if (isRootLeaf && this.app.workspace.getMostRecentLeaf() !== leaf) {
				this.app.workspace.setActiveLeaf(leaf, { focus: true });
			}
			// setActiveLeaf 触发的 active-leaf-change 同样会走 handleNavTrack,但事件派发可能延后;
			// 此处保留同步补记(幂等),保证面包屑立即刷新,也覆盖 leaf 已是活动 leaf 的情况。
			this.handleNavTrack(leaf);
		};

		// active-leaf-change 上按固定顺序触发两件事，单一 dispatcher 避免依赖 listener 注册顺序。
		// 顺序要求：① root leaf 判断须在消费 nav 一次性标志之前（在 handleNavTrack 内保证）
		// 入场动画不在此触发：重开被淘汰文件时 originalGetLeaf('tab') 会先产生一个空 leaf 并触发
		// active-leaf-change，若在此播动画会落到空 leaf 上。改由 activateOrOpenFile 用确定的目标 leaf 触发。
		this.activeLeafChangeHandler = (leaf: WorkspaceLeaf | null) => {
			this.leafCache.trackActive();
			this.handleNavTrack(leaf);
		};
		this.app.workspace.on('active-leaf-change', this.activeLeafChangeHandler);

		// 对已有 leaf 补充 history 和 detach 拦截，同时用当前所有 root leaf 初始化缓存队列。
		// 确保单页模式启用前已打开的 tab 也受 LRU 限制，最近活跃的 leaf 排到队尾。
		this.app.workspace.iterateRootLeaves(leaf => {
			this.patchLeafHistory(leaf);
			this.patchRootLeafDetach(leaf);
		});
		// 用当前所有 root leaf 初始化 LRU 缓存，最近活跃的 leaf 排到队尾。
		this.leafCache.seed();
		// Seed nav history with the current file when apply() is called mid-session:
		// workspace restore fires active-leaf-change automatically, but a mid-session
		// re-apply does not, leaving the history empty so the first back press finds
		// length < 2 and silently fails.
		const mostRecent = this.app.workspace.getMostRecentLeaf();
		if (mostRecent) {
			const seedKey = this.navKeyForLeaf(mostRecent);
			if (seedKey) {
				if (this.nav.isEmpty()) this.nav.seed(seedKey);
				// 初始化当前活动 root leaf 键，避免首次后退时把“当前页”误判为无文件视图而原地重激活。
				this.nav.markActiveRoot(seedKey);
				// mid-session 启用时若当前就停在全局关系图上，同步收起左侧边栏，保持行为一致。
				this.graphSidebar.handleRootNav(seedKey);
			}
		}

		// 把内置的 app:go-back / app:go-forward 命令路由到我们的跨 tab 导航栈
		this.nav.patchCommands();

		// 笔记重命名时同步更新导航历史中的路径，防止旧路径导致后退/前进跳过该条目
		this.renameHandler = (file: TAbstractFile, oldPath: string) => {
			if (!(file instanceof TFile)) return;
			this.nav.handleRename(oldPath, file.path);
		};
		this.app.vault.on('rename', this.renameHandler);

		// 笔记删除时清除导航历史中的死条目。删除已打开的笔记不会走常规关 tab 路径
		// （Obsidian 先把 leaf 换成空视图再 detach，detach 补丁拿不到路径），必须靠本事件清理，
		// 否则死条目残留栈顶，后退空转、面包屑被打乱（详见 NavigationHistory.handleDelete）。
		this.deleteHandler = (file: TAbstractFile) => {
			if (!(file instanceof TFile)) return;
			this.nav.handleDelete(file.path);
		};
		this.app.vault.on('delete', this.deleteHandler);
	}

	remove() {
		if (this.originalGetLeaf) {
			(this.app.workspace as unknown as WorkspaceInternal).getLeaf = this.originalGetLeaf;
			this.originalGetLeaf = null;
		}
		if (this.originalRevealLeaf) {
			(this.app.workspace as unknown as WorkspaceInternal).revealLeaf = this.originalRevealLeaf;
			this.originalRevealLeaf = null;
		}
		if (this.activeLeafChangeHandler) {
			this.app.workspace.off('active-leaf-change', this.activeLeafChangeHandler);
			this.activeLeafChangeHandler = null;
		}
		this.nav.dispose();
		this.nav.unpatchCommands();
		this.resizeErrSuppressor.remove();
		this.unpatchAllLeafHistories();
		this.unpatchAllRootLeafDetaches();
		if (this.renameHandler) {
			this.app.vault.off('rename', this.renameHandler);
			this.renameHandler = null;
		}
		if (this.deleteHandler) {
			this.app.vault.off('delete', this.deleteHandler);
			this.deleteHandler = null;
		}
		this.leafCache.reset();
		this.pendingInterceptLeaves.clear();
		// 若卸载 / 关闭单页模式时仍停在关系图上，恢复左侧边栏到进入前状态，避免残留收起状态。
		this.graphSidebar.reset();
	}

	// 检查指定 leaf 是否正处于等待 openFile 的 pending 状态
	// 供外部（HomePageManager）判断：若为 pending 则不应触发首页跳转
	hasPendingIntercept(leaf: WorkspaceLeaf): boolean {
		return this.pendingInterceptLeaves.has(leaf);
	}

	// 首页是否正在打开。供 HomePageManager 在 active-leaf-change 中过滤：openHomePage 自身的 getLeaf
	// 会先产生一个临时空 leaf 并触发 active-leaf-change，此时不能再次触发打开（会无限重入）。
	isOpeningHomePage(): boolean {
		return this._isOpeningHomePage;
	}

	getNavHistory(): string[] {
		return this.nav.getHistory();
	}

	getNavDisplayName(key: string): string | null {
		return this.nav.getDisplayName(key);
	}

	// 注入导航历史变更监听器（main.ts 用它驱动面包屑刷新）。
	setNavChangeListener(cb: (leaf: WorkspaceLeaf | null) => void) {
		this.navChangeListener = cb;
	}

	// 跨 tab 导航历史是否为空。供 HomePageManager 判断“用户是否关完了整条浏览链”：
	// 为空即应回到首页，即便 future 中仍残留打开的 tab。
	isNavEmpty(): boolean {
		return this.nav.isEmpty();
	}

	// 面包屑点击:跳转到导航历史栈中指定下标的条目(语义等同连续后退)。
	navigateHistoryTo(index: number) {
		this.nav.jumpToIndex(index);
	}

	// 记录跨 tab 导航历史：只对 root leaf 且有 filePath 的激活生效，再交给 nav 处理一次性标志与去重。
	// root leaf 判断必须先于 nav.record，防止侧边栏等无关激活提前消耗 nav 的一次性标志。
	private handleNavTrack(leaf: WorkspaceLeaf | null) {
		if (!leaf) return;
		let isRootLeaf = false;
		this.app.workspace.iterateRootLeaves(l => { if (l === leaf) isRootLeaf = true; });
		if (!isRootLeaf) return;

		const navKey = this.navKeyForLeaf(leaf);
		// 进入/离开全局关系图时自动收起 / 恢复左侧边栏。在此处(已过 isRootLeaf 守卫)调用，
		// 保证只对真正的 root 页面切换生效，侧边栏点击 / 过场空 leaf 不会误触发。
		this.graphSidebar.handleRootNav(navKey);
		// 先同步“当前活动 root leaf 路径”（无文件且非关系图的视图传 null），
		// nav 据此判断后退时当前显示是否就是历史栈顶；必须先于 record（record 仅处理可入栈的条目）。
		this.nav.markActiveRoot(navKey);
		if (!navKey) return;
		this.nav.record(navKey);
		// 无文件视图：缓存人类可读显示名，供面包屑在该视图不再是当前项时仍能正确显示。
		if (isFilelessViewKey(navKey)) {
			const displayText = (leaf as LeafInternal).view?.getDisplayText?.();
			if (displayText) this.nav.recordDisplayName(navKey, displayText);
		}
		// 通知面包屑刷新（传入当前 leaf 以便其取 getDisplayText 作为无文件视图标签）。
		this.navChangeListener?.(leaf);
	}

	// 取 root leaf 对应的文件路径，对 deferred（延迟加载、尚未实例化）视图做兜底。
	// 关键：deferred 视图（重启恢复出、尚未点开的 tab）此时 view.file 尚未就位为 null，
	// 仅凭 view.file?.path 判断会把它当作"无文件"漏判——而 getViewState() 仍返回真实的
	// state.file。所有去重 / "是否还有文件 leaf" 判断都必须经此函数，否则 deferred tab
	// 永远匹配不上，导致重复打开同一文件（违反 one-file-one-leaf 不变量）。
	private filePathForLeaf(leaf: WorkspaceLeaf): string | null {
		const li = leaf as LeafInternal;
		const vs = leaf.getViewState() as { state?: { file?: string } } | undefined;
		return li.view?.file?.path ?? vs?.state?.file ?? null;
	}

	// 把 root leaf 映射为导航栈中的键：有文件则用文件路径；无文件视图（全局关系图、搜索、各类插件
	// 自定义视图等）用按 viewType 编码的合成键，使其与笔记一样入栈、前进/后退、重开。
	// 空视图（empty，关完所有 tab 后的占位）无内容可记，返回 null（不入栈，由 nav 的 currentRootPath 兜底）。
	private navKeyForLeaf(leaf: WorkspaceLeaf): string | null {
		const filePath = this.filePathForLeaf(leaf);
		if (filePath) return filePath;
		const li = leaf as LeafInternal;
		// getViewState() 对 deferred 视图仍返回真实 type，而此时 view.getViewType() 可能返回 'empty'。优先用前者兜底。
		const vs = leaf.getViewState() as { type?: string } | undefined;
		const viewType = vs?.type ?? li.view?.getViewType?.();
		if (!viewType || viewType === 'empty') return null;
		return filelessViewKey(viewType);
	}

	// 关闭 except 这个 leaf 后，workspace 中是否仍有其他带文件的 root leaf。
	// 在 detach 前调用，故需排除正在关闭的 leaf 自身。
	private hasOtherFileLeaf(except: WorkspaceLeaf): boolean {
		let found = false;
		this.app.workspace.iterateRootLeaves(l => {
			if (found || l === except) return;
			if (this.filePathForLeaf(l)) found = true;
		});
		return found;
	}

	// 激活已显示目标路径的 root leaf；若无（已被 LRU 淘汰或手动关闭）则重新打开该文件。
	// 供 NavigationHistory 的 back/forward/onTabClosing 回调调用，收敛此前散落 4 处的重复逻辑。
	// animCls：前进/后退要播放的入场动画方向（onTabClosing 传 null 不播放）。在 setActiveLeaf
	// 之后立即对确定的目标 leaf 同步触发动画，保证动画始终落在真正的目标页上、且在 paint 前生效。
	private activateOrOpenFile(path: string, animCls: AnimationClass | null) {
		let targetLeaf: WorkspaceLeaf | null = null;
		this.app.workspace.iterateRootLeaves(l => {
			if (!targetLeaf && this.navKeyForLeaf(l) === path) targetLeaf = l;
		});
		if (targetLeaf) {
			this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
			this.nav.playAnimation(targetLeaf, animCls);
			return;
		}
		if (!this.originalGetLeaf) return;
		// 无文件视图条目（关系图 / 其余插件视图）：缓存中已无对应 leaf（被 LRU 淘汰或手动关闭），
		// 从合成键反解出 viewType，新开一个 tab 按 viewType 重建该视图以重现历史条目。
		const reopenViewType = viewTypeFromKey(path);
		if (reopenViewType) {
			const newLeaf = this.originalGetLeaf('tab');
			this.patchLeafHistory(newLeaf);
			this.patchRootLeafDetach(newLeaf);
			void (newLeaf as LeafInternal).setViewState({ type: reopenViewType }).then(() => {
				this.app.workspace.setActiveLeaf(newLeaf, { focus: true });
				this.nav.playAnimation(newLeaf, animCls);
			});
			return;
		}
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		const newLeaf = this.originalGetLeaf('tab');
		this.patchLeafHistory(newLeaf);
		this.patchRootLeafDetach(newLeaf);
		void (newLeaf as LeafInternal).openFile(file).then(() => {
			this.app.workspace.setActiveLeaf(newLeaf, { focus: true });
			// 重开路径：文件加载完成后目标 leaf 才就位，此时再播放动画，避免落到加载前一闪而过的空 leaf 上。
			this.nav.playAnimation(newLeaf, animCls);
		});
	}

	// 对新建的空 leaf 注入一次性 openFile 拦截器：
	// 在文件实际加载前检查缓存，若已有相同文件的 leaf 则直接复用，避免闪烁
	private interceptLeafOpenFile(leaf: WorkspaceLeaf) {
		// If the leaf was already detached during the getLeaf patch (e.g. openHomePage ran
		// synchronously inside originalGetLeaf and discarded it), skip installation.
		if (!(leaf as LeafInternal).parent) return;
		this.pendingInterceptLeaves.add(leaf);
		const origOpenFile: (file: TFile, state?: unknown) => Promise<void> = (leaf as LeafInternal).openFile.bind(leaf);
		const origSetViewState: (state: { type: string;[k: string]: unknown }, eState?: unknown) => Promise<void> = (leaf as LeafInternal).setViewState.bind(leaf);
		(leaf as LeafInternal).openFile = async (file: TFile, state?: unknown) => {
			// 一次性拦截：立即还原两个入口，防止后续调用被意外拦截
			(leaf as LeafInternal).openFile = origOpenFile;
			(leaf as LeafInternal).setViewState = origSetViewState;
			this.pendingInterceptLeaves.delete(leaf);

			if (!this.isReusingLeaf) {
				let existingLeaf: WorkspaceLeaf | null = null;
				this.app.workspace.iterateRootLeaves(l => {
					if (existingLeaf || l === leaf) return;
					if (this.filePathForLeaf(l) === file.path) {
						existingLeaf = l;
					}
				});
				if (existingLeaf) {
					// 文件已在缓存中：激活已有 leaf，丢弃当前空 leaf，无需加载文件。
					// 空 leaf 无文件路径，handleNavTrack 的 !filePath 守卫已阻止其写入历史，
					// 无需额外清理历史数组。
					this.isReusingLeaf = true;
					try {
						this.leafCache.touch(existingLeaf);
						this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
						leaf.detach();
						// 复用已有 leaf 时必须把 openFile 收到的 state 重放到该 leaf，否则其中携带的
						// eState.subpath（同文件 [[#标题]] 锚点 / 滚动位置）会被丢弃，导致点击锚点不滚动。
						// 目标文件已加载，openFile 同文件不会重新加载，仅应用 eState 完成定位。
						if (state !== undefined) {
							void (existingLeaf as LeafInternal).openFile(file, state);
						}
					} finally {
						this.isReusingLeaf = false;
					}
					// setActiveLeaf 触发的 active-leaf-change 会将 existingLeaf 的路径写入历史
					return;
				}
			}

			// 文件不在缓存中：正常加载，补充 history 和 detach 拦截
			this.patchLeafHistory(leaf);
			this.patchRootLeafDetach(leaf);
			const result = await origOpenFile(file, state);
			// 兜底：active-leaf-change 在 tab 尚未进入 iterateRootLeaves 时可能跳过该 leaf，
			// 文件加载完成后 leaf 已就位，此处确保路径写入历史。
			// 仅在 leaf 仍挂载时写入：若用户在 openFile 异步加载期间快速关闭了该 tab，
			// parent 已为 null，detach 时 view.file 尚未就位无法清理，此处若仍写入
			// 会在历史中留下永远无法清除的残留条目。
			if ((leaf as LeafInternal).parent) {
				this.nav.push(file.path);
			}
			return result;
		};

		// 同一空 leaf 上的一次性 setViewState 拦截：处理通过 setViewState 打开的无文件视图
		// （关系图、搜索、各类插件视图），使其与文件一样补 history / detach 拦截并入导航历史。
		// 仅全局关系图保留单实例去重（“一份只开一个 tab”）；其余视图正常创建。
		(leaf as LeafInternal).setViewState = async (state: { type: string;[k: string]: unknown }, eState?: unknown) => {
			const viewType = state?.type;
			// 空视图 / 无类型 / 复用中：透传，不消费一次性标志（leaf 仍在等待真正的内容赋值）。
			if (!viewType || viewType === 'empty' || this.isReusingLeaf) {
				return origSetViewState(state, eState);
			}
			// 命中真正的视图赋值：还原两个入口并退出 pending
			(leaf as LeafInternal).openFile = origOpenFile;
			(leaf as LeafInternal).setViewState = origSetViewState;
			this.pendingInterceptLeaves.delete(leaf);

			// 全局关系图单实例去重：已存在则激活复用、丢弃当前空 leaf，不再创建第二个关系图。
			if (viewType === 'graph') {
				let existingLeaf: WorkspaceLeaf | null = null;
				this.app.workspace.iterateRootLeaves(l => {
					if (existingLeaf || l === leaf) return;
					if (this.navKeyForLeaf(l) === GLOBAL_GRAPH_KEY) existingLeaf = l;
				});
				if (existingLeaf) {
					// setActiveLeaf 触发的 active-leaf-change 会把 GLOBAL_GRAPH_KEY 写入历史。
					this.isReusingLeaf = true;
					try {
						this.leafCache.touch(existingLeaf);
						this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
						leaf.detach();
					} finally {
						this.isReusingLeaf = false;
					}
					return;
				}
			}

			// 正常创建无文件视图：先补 history / detach 拦截再设置视图。
			this.patchLeafHistory(leaf);
			this.patchRootLeafDetach(leaf);
			const result = await origSetViewState(state, eState);
			// 兜底：setViewState 在同一活动 leaf 上原地换视图时，active-leaf-change 可能不触发，
			// 导致该无文件视图既不入导航历史、currentRootPath 也停留在上一篇，造成在该视图里前进/后退
			// 与面包屑点击全部失效（“困死”）。视图就位后在此直接补记，使三者与 active-leaf-change 路径
			// 一致（均幂等，与可能照常触发的 active-leaf-change 重复执行无副作用）。
			if ((leaf as LeafInternal).parent) {
				const key = this.navKeyForLeaf(leaf);
				if (key) {
					this.graphSidebar.handleRootNav(key);
					this.nav.markActiveRoot(key);
					this.nav.push(key);
					if (isFilelessViewKey(key)) {
						const displayText = (leaf as LeafInternal).view?.getDisplayText?.();
						if (displayText) this.nav.recordDisplayName(key, displayText);
					}
					this.navChangeListener?.(leaf);
				}
			}
			return result;
		};
	}

	// 供 SingleTabGroupGuard 调用：它经 createLeafInParent 合并分屏/弹窗产生的 root leaf 绕过了
	// getLeaf 拦截，从未补过 history / detach 补丁——于是用户手动关这些 tab 时 detach 补丁缺位，
	// nav.onTabClosing 不触发，导航历史残留死条目、面包屑错乱。在此把它们纳入引擎管理。
	// 两个补丁均幂等（各自的 Map.has 去重），重复 adopt 安全。
	adoptLeaf(leaf: WorkspaceLeaf) {
		if (!this.getSettings().disableNoteTabs) return;
		this.patchLeafHistory(leaf);
		this.patchRootLeafDetach(leaf);
	}

	patchLeafHistory(leaf: WorkspaceLeaf) {
		const history = (leaf as LeafInternal).history;
		if (!history || this.historyPatches.has(leaf)) return;
		const origBack = history.back.bind(history);
		const origForward = history.forward.bind(history);
		const origCanGoBack = history.canGoBack?.bind(history);
		const origCanGoForward = history.canGoForward?.bind(history);
		history.back = () => this.nav.back();
		history.forward = () => this.nav.forward();
		// 让 Obsidian 的 UI 按钮 / 命令守卫读到我们自己的导航栈状态
		history.canGoBack = () => this.nav.canGoBack();
		history.canGoForward = () => this.nav.canGoForward();
		this.historyPatches.set(leaf, { back: origBack, forward: origForward, canGoBack: origCanGoBack, canGoForward: origCanGoForward });
	}

	private unpatchAllLeafHistories() {
		for (const [leaf, orig] of this.historyPatches) {
			const history = (leaf as LeafInternal).history;
			if (history) {
				history.back = orig.back;
				history.forward = orig.forward;
				if (orig.canGoBack !== undefined) history.canGoBack = orig.canGoBack;
				if (orig.canGoForward !== undefined) history.canGoForward = orig.canGoForward;
			}
		}
		this.historyPatches.clear();
	}

	// root leaf detach 补丁：通过捕获所有关闭路径（CMD+W、右键、X 按钮、API 调用）
	// 在 detach 前通知 nav（移除历史条目、设置关闭标志），并在真正 detach 之前同步激活面包屑前一页，
	// detach 后从 patch 注册表移除该 leaf，避免已销毁 leaf 在 Map 中无限累积（内存泄漏）。
	// isReusingLeaf / 缓存淘汰中（leafCache.isEvictingNow）时豁免 nav 通知：属于插件内部操作而非用户关闭 tab。
	private patchRootLeafDetach(leaf: WorkspaceLeaf) {
		if (this.rootDetachPatches.has(leaf)) return;
		const original = (leaf as LeafInternal).detach.bind(leaf);
		(leaf as LeafInternal).detach = () => {
			if (!this.isReusingLeaf && !this.leafCache.isEvictingNow()) {
				// 关系图 tab 关闭时同样需移除其历史条目，故用 navKeyForLeaf 而非仅文件路径。
				const closingPath = this.navKeyForLeaf(leaf) ?? undefined;
				// 关闭后是否仍有其他文件 leaf（排除本 leaf）：决定历史清空时是否需吞掉 Obsidian 自动激活
				// 残留 tab 的那次 record，使 history 保持为空、HomePageManager 据此回到首页。
				const hasOtherFileLeaf = this.hasOtherFileLeaf(leaf);
				const target = this.nav.onTabClosing(closingPath, hasOtherFileLeaf);
				// 关键修复：在真正 detach（original()）**之前**同步激活面包屑前一页，使待关闭 leaf
				// 变为非活动 leaf。否则 detach 活动 leaf 时 Obsidian 会自行挑选相邻 leaf（常是面包屑之外
				// 的 future tab）作为新活动 leaf——它与我们此前的 setTimeout 异步激活产生竞态，Obsidian
				// 的挑选若后触发会胜出并把无关 tab 写入历史，表现为“关闭后随意跳转到面包屑之外的 tab”。
				// 前驱仍打开时同步激活无闪烁；已被 LRU 淘汰时 activateOrOpenFile 会先 getLeaf('tab')
				// 拿到一个新活动 leaf（同样使待关闭 leaf 变为非活动），再异步重开文件，仍可避免自动挑选。
				// 落到前驱页时播放与后退一致的入场动画（从左滑入）。
				if (target !== null) {
					this.activateOrOpenFile(target, 'minimalism-ui-slide-from-left');
				}
			}
			original();
			// leaf 已销毁，清理两个 patch 注册表，防止 Map 随累计打开的 tab 数无限增长
			this.rootDetachPatches.delete(leaf);
			this.historyPatches.delete(leaf);
		};
		this.rootDetachPatches.set(leaf, original);
	}

	private unpatchAllRootLeafDetaches() {
		for (const [leaf, original] of this.rootDetachPatches) {
			(leaf as LeafInternal).detach = original;
		}
		this.rootDetachPatches.clear();
	}

	// 打开首页笔记：先置 _isOpeningHomePage 防止 getLeaf 拦截器介入，再补 history / detach patch
	async openHomePage() {
		// 重入：上一次首页打开仍在 await 中。不能直接丢弃请求——连续快速 CMD+W 可能把正在
		// 打开的首页 leaf 也关掉，留下空页。置位待补开标志，由当前调用的 finally 兜底重试。
		if (this._isOpeningHomePage) {
			this._homePageReopenQueued = true;
			return;
		}
		const path = this.getSettings().homePage;
		if (!path) return;
		if (activeDocument.querySelector('.modal-container')) return;
		const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
		if (!(file instanceof TFile)) return;
		this._isOpeningHomePage = true;
		this._homePageReopenQueued = false;
		try {
			// 先查重、后取 leaf:首页已开着就直接激活复用。先查重避免旧实现"先 getLeaf(false)
			// 抓住当前活动 leaf、命中去重时再 detach 它"——那会顺手关掉一篇仍开着的 future 残留笔记。
			let existingLeaf: WorkspaceLeaf | null = null;
			this.app.workspace.iterateRootLeaves(l => {
				if (existingLeaf) return;
				if (this.filePathForLeaf(l) === file.path) existingLeaf = l;
			});
			if (existingLeaf) {
				this.leafCache.touch(existingLeaf);
				this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
				return;
			}
			// 选目标 leaf:仅当当前活动 leaf 是空白页(关完所有 tab 后落到的空 leaf)才复用它;
			// 否则新开 tab。关键修复(BUG 2):关闭面包屑最前一页后历史清空,Obsidian 会先自动激活
			// 一篇仍开着的 future 残留笔记(带文件),此时绝不能用 getLeaf(false) 复用它——那会把那篇
			// 笔记顶掉(用户看到的"先关掉一个缓存 Tab")。带文件就新开 tab,残留笔记原样保留。
			// getLeaf('tab') 在 _isOpeningHomePage 守卫下会绕过拦截器、退回原生行为,单页/非单页模式均安全。
			const active = this.app.workspace.getMostRecentLeaf();
			const canReuse = !!active
				&& !this.filePathForLeaf(active)
				&& !this.pendingInterceptLeaves.has(active);
			const leaf = canReuse && active ? active : this.app.workspace.getLeaf('tab');
			await (leaf as LeafInternal).openFile(file);
			if ((leaf as LeafInternal).parent) {
				this.patchLeafHistory(leaf);
				this.patchRootLeafDetach(leaf);
			} else {
				// 首页 leaf 在加载途中被快速 CMD+W 关掉了（parent 为 null）。此刻 HomePageManager 的
				// active-leaf-change 检测被 _isOpeningHomePage 守卫挡住、不会兜底，故在此置位待补开
				// 标志，由下方 finally 重试，保证最终落在首页而非空页。对已 detach 的 leaf 打补丁只会
				// 在注册表里留下永不回收的死 leaf，故跳过。
				this._homePageReopenQueued = true;
			}
		} finally {
			this._isOpeningHomePage = false;
			// 补偿重试：打开期间又收到过“全部关闭”请求（很可能把刚打开的首页也关了），此时
			// 重新打开，保证最终落在首页而非空页。重试自身再被重入会再次置位，循环由用户的关闭
			// 操作驱动；用户停手后最后一次重试不再被重入、得以成功就位，因而不会空转。
			if (this._homePageReopenQueued) {
				this._homePageReopenQueued = false;
				void this.openHomePage();
			}
		}
	}

	// 设置里更换首页后调用：把主区收拢为只剩首页一个 tab，并把导航历史 / 面包屑重置为仅首页。
	// 仅在用户真正改动首页路径时触发（见 SettingTab），不在每次 saveSettings 时跑，避免误关标签。
	async resetToHomePage() {
		const path = this.getSettings().homePage;
		if (!path) return;
		const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
		if (!(file instanceof TFile)) return;

		// 先打开 / 激活首页：openHomePage 自带去重（已开则激活复用，未开则新建 tab）。
		await this.openHomePage();

		// 收集除首页外的所有 root leaf。首页 leaf 取首个匹配，重复的首页 leaf 一并归入待关闭。
		const others: WorkspaceLeaf[] = [];
		let homeLeaf: WorkspaceLeaf | null = null;
		this.app.workspace.iterateRootLeaves(l => {
			if (!homeLeaf && this.filePathForLeaf(l) === file.path) {
				homeLeaf = l;
			} else {
				others.push(l);
			}
		});

		// 关闭其余 tab。置 isReusingLeaf 豁免 detach 补丁的 nav.onTabClosing 通知——这是插件内部
		// 收拢而非用户关 tab；detach 同步执行，期间不会触发 openFile 拦截，标志可安全短暂置位。
		this.isReusingLeaf = true;
		try {
			for (const l of others) l.detach();
		} finally {
			this.isReusingLeaf = false;
		}

		// 导航历史 / 面包屑重置为仅首页，并立即刷新面包屑。
		this.nav.reset(path);
		this.navChangeListener?.(homeLeaf);
	}
}
