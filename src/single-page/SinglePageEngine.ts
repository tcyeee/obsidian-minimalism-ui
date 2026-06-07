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
import { App, TAbstractFile, TFile, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from '../core/settings';
import { AnimationClass, NavigationHistory } from './NavigationHistory';
import { ResizeObserverErrorSuppressor } from './ResizeObserverErrorSuppressor';
import { LeafCache } from './LeafCache';

type WorkspaceInternal = {
	getLeaf: (newLeaf?: boolean | string) => WorkspaceLeaf;
};

type LeafInternal = WorkspaceLeaf & {
	openFile: (file: TFile, state?: unknown) => Promise<void>;
	history?: {
		back: () => void;
		forward: () => void;
		canGoBack?: () => boolean;
		canGoForward?: () => boolean;
	};
	view?: {
		file?: TFile;
		contentEl?: HTMLElement;
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
	private nav: NavigationHistory;
	private leafCache: LeafCache;
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

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
	) {
		this.nav = new NavigationHistory(app, getSettings, (path, animCls) => this.activateOrOpenFile(path, animCls));
		this.leafCache = new LeafCache(app);
	}

	apply() {
		this.remove();
		this.leafCache.reset();

		this.resizeErrSuppressor.apply();

		if (!this.getSettings().disableNoteTabs) return;

		// 拦截所有会新建/复用 leaf 的 getLeaf 调用（false/undefined/true/'tab'），
		// 统一改为新开 tab 并注入一次性 openFile 拦截器，实现全路径去重。
		// 'split' / 'window' 等明确指定布局方式的调用不拦截，保留原行为。
		const ws = this.app.workspace as unknown as WorkspaceInternal;
		this.originalGetLeaf = ws.getLeaf.bind(ws);
		ws.getLeaf = (newLeaf?: boolean | string) => {
			const shouldIntercept = newLeaf === false || newLeaf === undefined || newLeaf === true || newLeaf === 'tab';
			if (shouldIntercept && !this.isReusingLeaf && !this._isOpeningHomePage) {
				const leaf = this.originalGetLeaf!('tab');
				this.interceptLeafOpenFile(leaf);
				return leaf;
			}
			return this.originalGetLeaf!(newLeaf);
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
		if (mostRecent && this.nav.isEmpty()) {
			const seedPath = (mostRecent as LeafInternal).view?.file?.path;
			if (seedPath) this.nav.seed(seedPath);
		}

		// 把内置的 app:go-back / app:go-forward 命令路由到我们的跨 tab 导航栈
		this.nav.patchCommands();

		// 笔记重命名时同步更新导航历史中的路径，防止旧路径导致后退/前进跳过该条目
		this.renameHandler = (file: TAbstractFile, oldPath: string) => {
			if (!(file instanceof TFile)) return;
			this.nav.handleRename(oldPath, file.path);
		};
		this.app.vault.on('rename', this.renameHandler);
	}

	remove() {
		if (this.originalGetLeaf) {
			(this.app.workspace as unknown as WorkspaceInternal).getLeaf = this.originalGetLeaf;
			this.originalGetLeaf = null;
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
		this.leafCache.reset();
		this.pendingInterceptLeaves.clear();
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

	// 记录跨 tab 导航历史：只对 root leaf 且有 filePath 的激活生效，再交给 nav 处理一次性标志与去重。
	// root leaf 判断必须先于 nav.record，防止侧边栏等无关激活提前消耗 nav 的一次性标志。
	private handleNavTrack(leaf: WorkspaceLeaf | null) {
		if (!leaf) return;
		let isRootLeaf = false;
		this.app.workspace.iterateRootLeaves(l => { if (l === leaf) isRootLeaf = true; });
		if (!isRootLeaf) return;

		const filePath = (leaf as LeafInternal).view?.file?.path;
		if (!filePath) return;
		this.nav.record(filePath);
	}

	// 激活已显示目标路径的 root leaf；若无（已被 LRU 淘汰或手动关闭）则重新打开该文件。
	// 供 NavigationHistory 的 back/forward/onTabClosing 回调调用，收敛此前散落 4 处的重复逻辑。
	// animCls：前进/后退要播放的入场动画方向（onTabClosing 传 null 不播放）。在 setActiveLeaf
	// 之后立即对确定的目标 leaf 同步触发动画，保证动画始终落在真正的目标页上、且在 paint 前生效。
	private activateOrOpenFile(path: string, animCls: AnimationClass | null) {
		let targetLeaf: WorkspaceLeaf | null = null;
		this.app.workspace.iterateRootLeaves(l => {
			if (!targetLeaf && (l as LeafInternal).view?.file?.path === path) targetLeaf = l;
		});
		if (targetLeaf) {
			this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
			this.nav.playAnimation(targetLeaf, animCls);
			return;
		}
		if (!this.originalGetLeaf) return;
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
		(leaf as LeafInternal).openFile = async (file: TFile, state?: unknown) => {
			// 一次性拦截：立即还原，防止后续调用被意外拦截
			(leaf as LeafInternal).openFile = origOpenFile;
			this.pendingInterceptLeaves.delete(leaf);

			if (!this.isReusingLeaf) {
				let existingLeaf: WorkspaceLeaf | null = null;
				this.app.workspace.iterateRootLeaves(l => {
					if (existingLeaf || l === leaf) return;
					if ((l as LeafInternal).view?.file?.path === file.path) {
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
	// 在 detach 前通知 nav（移除历史条目、设置关闭标志、跳转到历史顶部），
	// detach 后从 patch 注册表移除该 leaf，避免已销毁 leaf 在 Map 中无限累积（内存泄漏）。
	// isReusingLeaf / 缓存淘汰中（leafCache.isEvictingNow）时豁免 nav 通知：属于插件内部操作而非用户关闭 tab。
	private patchRootLeafDetach(leaf: WorkspaceLeaf) {
		if (this.rootDetachPatches.has(leaf)) return;
		const original = (leaf as LeafInternal).detach.bind(leaf);
		(leaf as LeafInternal).detach = () => {
			if (!this.isReusingLeaf && !this.leafCache.isEvictingNow()) {
				const closingPath = (leaf as LeafInternal).view?.file?.path;
				this.nav.onTabClosing(closingPath);
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
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		this._isOpeningHomePage = true;
		this._homePageReopenQueued = false;
		try {
			const leaf = this.app.workspace.getLeaf(false);
			// Dedup: file-open may fire synchronously inside originalGetLeaf('tab') before
			// interceptLeafOpenFile installs its interceptor, so openHomePage can be reached
			// with the interceptor not yet in place. Mirror the same dedup check here.
			let existingLeaf: WorkspaceLeaf | null = null;
			this.app.workspace.iterateRootLeaves(l => {
				if (existingLeaf || l === leaf) return;
				if ((l as LeafInternal).view?.file?.path === file.path) existingLeaf = l;
			});
			if (existingLeaf) {
				this.leafCache.touch(existingLeaf);
				this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
				leaf.detach();
				return;
			}
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
}
