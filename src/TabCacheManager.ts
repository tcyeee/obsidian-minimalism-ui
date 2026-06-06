/**
 * TabCacheManager — 单页模式的核心协调器
 *
 * 职责：
 * 1. **getLeaf 拦截** — monkey-patch `workspace.getLeaf()`，将所有常规导航强制走新建 tab 路径，
 *    再注入一次性 `openFile` 拦截器，在文件实际加载前查重：若 workspace 中已有同路径 leaf，
 *    直接激活复用，丢弃空 leaf，避免重复打开与闪烁。
 *
 * 2. **LRU 淘汰** — 监听 `active-leaf-change`，维护 `leafQueue`（最近使用排末尾），
 *    超出 `MAX_CACHED_TABS` 时 detach 最旧 leaf。
 *
 * 3. **跨 tab 导航栈** — 委托给 {@link NavigationHistory}：patch 每个 leaf 的
 *    `history.back/forward/canGoBack/canGoForward`，以及内置命令 `app:go-back` /
 *    `app:go-forward`，使快捷键在任意焦点位置均可跨 tab 前进后退。本类只负责把这些入口
 *    路由到 NavigationHistory，并提供 `activateOrOpenFile`（定位/重新打开 leaf）回调。
 *
 * 4. **ResizeObserver 错误抑制** — 委托给 {@link ResizeObserverErrorSuppressor}。
 *
 * 5. **侧边栏 pin guard / 首页跳转** — 拦截侧边栏 leaf detach，打开首页笔记。
 *
 * `apply()` 注册所有 patch 与监听器；`remove()` 完整还原，保证插件卸载后无残留副作用。
 *
 * active-leaf-change 上的三件事（LRU、导航记录、入场动画）由单一 dispatcher 按固定顺序触发，
 * 避免依赖多个 listener 的注册顺序。
 */
import { App, TAbstractFile, TFile, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from './settings';
import { NavigationHistory } from './NavigationHistory';
import { ResizeObserverErrorSuppressor } from './ResizeObserverErrorSuppressor';

const MAX_CACHED_TABS = 30;

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

type ObsidianCommand = {
	callback?: () => void;
	checkCallback?: (checking: boolean) => boolean | void;
};

type AppInternal = App & {
	commands: {
		commands: Record<string, ObsidianCommand>;
	};
};

export class TabCacheManager {
	private leafQueue: WorkspaceLeaf[] = [];
	private isReusingLeaf = false;
	private isEvicting = false;
	private originalGetLeaf: ((newLeaf?: boolean | string) => WorkspaceLeaf) | null = null;
	private nav: NavigationHistory;
	private resizeErrSuppressor = new ResizeObserverErrorSuppressor();
	private activeLeafChangeHandler: ((leaf: WorkspaceLeaf | null) => void) | null = null;
	private historyPatches = new Map<WorkspaceLeaf, HistoryPatch>();
	// root leaf detach 补丁：触发时通知 nav 并清理 patch 注册表，覆盖所有关闭路径（CMD+W、右键、X 按钮）
	private rootDetachPatches = new Map<WorkspaceLeaf, () => void>();
	private origGoBack: ObsidianCommand | null = null;
	private origGoForward: ObsidianCommand | null = null;
	// 由 getLeaf patch 新建、尚未调用 openFile 的空 leaf
	private pendingInterceptLeaves = new Set<WorkspaceLeaf>();
	// 首页打开期间为 true，避免 getLeaf 拦截器介入
	private _isOpeningHomePage = false;
	// 侧边栏 leaf 的 detach 拦截（pin guard），key=leaf，value=原始 detach
	private sidebarDetachPatches = new Map<WorkspaceLeaf, () => void>();
	private sidebarLayoutChangeHandler: (() => void) | null = null;
	private renameHandler: ((file: TAbstractFile, oldPath: string) => void) | null = null;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
	) {
		this.nav = new NavigationHistory(app, getSettings, path => this.activateOrOpenFile(path));
	}

	apply() {
		this.remove();
		this.leafQueue = [];

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

		// active-leaf-change 上按固定顺序触发三件事，单一 dispatcher 避免依赖 listener 注册顺序。
		// 顺序要求：① root leaf 判断须在消费 nav 一次性标志之前（在 handleNavTrack 内保证）
		this.activeLeafChangeHandler = (leaf: WorkspaceLeaf | null) => {
			this.handleTabLimit();
			this.handleNavTrack(leaf);
			this.nav.animate(leaf);
		};
		this.app.workspace.on('active-leaf-change', this.activeLeafChangeHandler);

		// 对已有 leaf 补充 history 和 detach 拦截，同时用当前所有 root leaf 初始化缓存队列。
		// 确保单页模式启用前已打开的 tab 也受 LRU 限制，最近活跃的 leaf 排到队尾。
		this.app.workspace.iterateRootLeaves(leaf => {
			this.patchLeafHistory(leaf);
			this.patchRootLeafDetach(leaf);
			this.leafQueue.push(leaf);
		});
		const mostRecent = this.app.workspace.getMostRecentLeaf();
		if (mostRecent) {
			this.leafQueue = this.leafQueue.filter(l => l !== mostRecent);
			this.leafQueue.push(mostRecent);
			// Seed nav history with the current file when apply() is called mid-session:
			// workspace restore fires active-leaf-change automatically, but a mid-session
			// re-apply does not, leaving the history empty so the first back press finds
			// length < 2 and silently fails.
			if (this.nav.isEmpty()) {
				const seedPath = (mostRecent as LeafInternal).view?.file?.path;
				if (seedPath) this.nav.seed(seedPath);
			}
		}

		// Patch 内置的 app:go-back / app:go-forward command，
		// 使快捷键在焦点位于 OUTLINE / PROPERTIES 等侧边栏面板时同样生效。
		// Obsidian 热键系统在 document 层全局触发 command，不受焦点限制；
		// 唯一有焦点依赖的是 command 内部的 getActiveLeaf()?.history.back/forward()，
		// 替换 callback 与 checkCallback 两个入口，直接调用我们的导航方法即可解决。
		const appCmds = (this.app as unknown as AppInternal).commands.commands;
		const backCmd = appCmds['app:go-back'];
		const fwdCmd = appCmds['app:go-forward'];
		if (backCmd) {
			this.origGoBack = { callback: backCmd.callback, checkCallback: backCmd.checkCallback };
			delete backCmd.callback;
			backCmd.checkCallback = (checking: boolean) => {
				if (checking) return this.nav.canGoBack();
				this.nav.back();
				return true;
			};
		}
		if (fwdCmd) {
			this.origGoForward = { callback: fwdCmd.callback, checkCallback: fwdCmd.checkCallback };
			delete fwdCmd.callback;
			fwdCmd.checkCallback = (checking: boolean) => {
				if (checking) return this.nav.canGoForward();
				this.nav.forward();
				return true;
			};
		}

		// 笔记重命名时同步更新导航历史中的路径，防止旧路径导致后退/前进跳过该条目
		this.renameHandler = (file: TAbstractFile, oldPath: string) => {
			if (!(file instanceof TFile)) return;
			this.nav.handleRename(oldPath, file.path);
		};
		this.app.vault.on('rename', this.renameHandler);

		// 拦截侧边栏 leaf 的 detach，防止用户通过右键菜单关闭（pin guard）
		if (this.getSettings().disablePinTab) {
			this.patchSidebarLeafDetach();
			this.sidebarLayoutChangeHandler = () => this.patchSidebarLeafDetach();
			this.app.workspace.on('layout-change', this.sidebarLayoutChangeHandler);
		}
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
		this.resizeErrSuppressor.remove();
		this.unpatchAllLeafHistories();
		this.unpatchAllRootLeafDetaches();
		const appCmds = (this.app as unknown as AppInternal).commands.commands;
		if (this.origGoBack) {
			const cmd = appCmds['app:go-back'];
			if (cmd) {
				delete cmd.checkCallback;
				if (this.origGoBack.callback) cmd.callback = this.origGoBack.callback;
				if (this.origGoBack.checkCallback) cmd.checkCallback = this.origGoBack.checkCallback;
			}
			this.origGoBack = null;
		}
		if (this.origGoForward) {
			const cmd = appCmds['app:go-forward'];
			if (cmd) {
				delete cmd.checkCallback;
				if (this.origGoForward.callback) cmd.callback = this.origGoForward.callback;
				if (this.origGoForward.checkCallback) cmd.checkCallback = this.origGoForward.checkCallback;
			}
			this.origGoForward = null;
		}
		if (this.sidebarLayoutChangeHandler) {
			this.app.workspace.off('layout-change', this.sidebarLayoutChangeHandler);
			this.sidebarLayoutChangeHandler = null;
		}
		if (this.renameHandler) {
			this.app.vault.off('rename', this.renameHandler);
			this.renameHandler = null;
		}
		for (const [leaf, original] of this.sidebarDetachPatches) {
			(leaf as LeafInternal).detach = original;
		}
		this.sidebarDetachPatches.clear();
		this.leafQueue = [];
		this.pendingInterceptLeaves.clear();
	}

	// 检查指定 leaf 是否正处于等待 openFile 的 pending 状态
	// 供外部（homePageHandler）判断：若为 pending 则不应触发首页跳转
	hasPendingIntercept(leaf: WorkspaceLeaf): boolean {
		return this.pendingInterceptLeaves.has(leaf);
	}

	getNavHistory(): string[] {
		return this.nav.getHistory();
	}

	// LRU：将当前 leaf 移到队尾（最近使用），清理已销毁的 leaf，淘汰超出上限的最旧 leaf。
	// isEvicting 防止 detach() 触发的 active-leaf-change 引发重入。
	private handleTabLimit() {
		if (this.isEvicting) return;
		const active = this.app.workspace.getMostRecentLeaf();
		if (!active) return;

		this.leafQueue = this.leafQueue.filter(l => l !== active);
		this.leafQueue.push(active);

		// 移除队列中已不存在于 workspace 的 leaf
		const rootLeaves: WorkspaceLeaf[] = [];
		this.app.workspace.iterateRootLeaves(l => rootLeaves.push(l));
		this.leafQueue = this.leafQueue.filter(l => rootLeaves.includes(l));

		if (this.leafQueue.length > MAX_CACHED_TABS) {
			this.isEvicting = true;
			try {
				while (this.leafQueue.length > MAX_CACHED_TABS) {
					this.leafQueue.shift()!.detach();
				}
			} finally {
				this.isEvicting = false;
			}
		}
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
	private activateOrOpenFile(path: string) {
		let targetLeaf: WorkspaceLeaf | null = null;
		this.app.workspace.iterateRootLeaves(l => {
			if (!targetLeaf && (l as LeafInternal).view?.file?.path === path) targetLeaf = l;
		});
		if (targetLeaf) {
			this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
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
						this.leafQueue = this.leafQueue.filter(l => l !== existingLeaf);
						this.leafQueue.push(existingLeaf);
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
	// isReusingLeaf / isEvicting 为 true 时豁免 nav 通知：属于插件内部操作而非用户关闭 tab。
	private patchRootLeafDetach(leaf: WorkspaceLeaf) {
		if (this.rootDetachPatches.has(leaf)) return;
		const original = (leaf as LeafInternal).detach.bind(leaf);
		(leaf as LeafInternal).detach = () => {
			if (!this.isReusingLeaf && !this.isEvicting) {
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

	// 拦截左侧边栏所有 leaf 的 detach，防止用户通过右键菜单关闭（pin guard）
	private patchSidebarLeafDetach() {
		this.app.workspace.iterateAllLeaves(leaf => {
			if (this.sidebarDetachPatches.has(leaf)) return;
			const leafEl = (leaf as LeafInternal).containerEl;
			if (!leafEl?.closest('.workspace-split.mod-left-split')) return;
			const original = (leaf as LeafInternal).detach.bind(leaf);
			(leaf as LeafInternal).detach = () => { /* blocked */ };
			this.sidebarDetachPatches.set(leaf, original);
		});
	}

	// 绕过 patchSidebarLeafDetach 的阻断，强制 detach 一个 leaf（供 SidebarLayoutManager 调用）
	forceDetachLeaf(leaf: WorkspaceLeaf) {
		const original = this.sidebarDetachPatches.get(leaf);
		if (original) {
			original();
		} else {
			leaf.detach();
		}
	}

	// 打开首页笔记：先置 _isOpeningHomePage 防止 getLeaf 拦截器介入，再补 history / detach patch
	async openHomePage() {
		if (this._isOpeningHomePage) return;
		const path = this.getSettings().homePage;
		if (!path) return;
		if (activeDocument.querySelector('.modal-container')) return;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		this._isOpeningHomePage = true;
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
				this.leafQueue = this.leafQueue.filter(l => l !== existingLeaf);
				this.leafQueue.push(existingLeaf);
				this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
				leaf.detach();
				return;
			}
			await (leaf as LeafInternal).openFile(file);
			this.patchLeafHistory(leaf);
			this.patchRootLeafDetach(leaf);
		} finally {
			this._isOpeningHomePage = false;
		}
	}
}
