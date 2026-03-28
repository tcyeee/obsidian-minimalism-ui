import { App, TFile, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from './settings';

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
	private navHistory: WorkspaceLeaf[] = [];
	private navFuture: WorkspaceLeaf[] = [];
	private navJumpTarget: WorkspaceLeaf | null = null;
	private tabLimitHandler: (() => void) | null = null;
	private navTrackHandler: ((leaf: WorkspaceLeaf | null) => void) | null = null;
	private navAnimateHandler: ((leaf: WorkspaceLeaf | null) => void) | null = null;
	private pendingAnimationCls: 'minimalism-ui-slide-from-left' | 'minimalism-ui-slide-from-right' | null = null;
	private navTimer: ReturnType<typeof setTimeout> | null = null;
	private animEndListeners = new WeakMap<Element, () => void>();
	private resizeObserverErrHandler: ((e: ErrorEvent) => void) | null = null;
	private historyPatches = new Map<WorkspaceLeaf, HistoryPatch>();
	private origGoBack: ObsidianCommand | null = null;
	private origGoForward: ObsidianCommand | null = null;
	// 由 getLeaf patch 新建、尚未调用 openFile 的空 leaf
	private pendingInterceptLeaves = new Set<WorkspaceLeaf>();

	// isOpeningHomePage 由 plugin 提供，避免首页打开时触发 getLeaf 拦截
	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		private isOpeningHomePage: () => boolean,
	) { }

	apply() {
		this.remove();
		this.leafQueue = [];

		// 拦截 "ResizeObserver loop completed with undelivered notifications" 错误：
		// CodeMirror 内部 ResizeObserver 级联迭代次数超出浏览器阈值时触发，
		// 笔记样式等 CSS 改变行高/字体大小也会触发此问题。
		// 浏览器抛出此错误事件（非致命，未送达的通知会推迟到下一帧自动处理），
		// 但 Obsidian 的 window.onerror 会将它展示为用户可见的报错提示。
		// 通过 capture phase 提前拦截，阻止其传播到 Obsidian 的全局 handler。
		this.resizeObserverErrHandler = (e: ErrorEvent) => {
			if (e.message === 'ResizeObserver loop completed with undelivered notifications.') {
				e.stopImmediatePropagation();
				e.preventDefault();
			}
		};
		window.addEventListener('error', this.resizeObserverErrHandler, true);

		if (!this.getSettings().disableNoteTabs) return;

		// 拦截所有会新建/复用 leaf 的 getLeaf 调用（false/undefined/true/'tab'），
		// 统一改为新开 tab 并注入一次性 openFile 拦截器，实现全路径去重。
		// 'split' / 'window' 等明确指定布局方式的调用不拦截，保留原行为。
		const ws = this.app.workspace as unknown as WorkspaceInternal;
		this.originalGetLeaf = ws.getLeaf.bind(ws);
		ws.getLeaf = (newLeaf?: boolean | string) => {
			const shouldIntercept = newLeaf === false || newLeaf === undefined || newLeaf === true || newLeaf === 'tab';
			if (shouldIntercept && !this.isReusingLeaf && !this.isOpeningHomePage()) {
				const leaf = this.originalGetLeaf!('tab');
				this.interceptLeafOpenFile(leaf);
				return leaf;
			}
			return this.originalGetLeaf!(newLeaf);
		};

		// 仅监听 active-leaf-change，避免 layout-change 引发的重入
		this.tabLimitHandler = () => {
			if (this.isEvicting) return;
			const active = this.app.workspace.getMostRecentLeaf();
			if (!active) return;

			// 将当前 leaf 移到队列末尾（最近使用）
			this.leafQueue = this.leafQueue.filter(l => l !== active);
			this.leafQueue.push(active);

			// 移除队列中已不存在于 workspace 的 leaf
			const rootLeaves: WorkspaceLeaf[] = [];
			this.app.workspace.iterateRootLeaves(l => rootLeaves.push(l));
			this.leafQueue = this.leafQueue.filter(l => rootLeaves.includes(l));

			// 淘汰超出缓存数量的最旧 leaf
			// isEvicting 防止 detach() 触发的 active-leaf-change 引发重入
			// tabLimitHandler 仅在 disableNoteTabs=true 时注册，故此处固定上限为 30
			const max = 30;
			if (this.leafQueue.length > max) {
				this.isEvicting = true;
				try {
					while (this.leafQueue.length > max) {
						const oldest = this.leafQueue.shift()!;
						oldest.detach();
						this.navHistory = this.navHistory.filter(l => l !== oldest);
						this.navFuture = this.navFuture.filter(l => l !== oldest);
					}
				} finally {
					this.isEvicting = false;
				}
			}
		};
		this.app.workspace.on('active-leaf-change', this.tabLimitHandler);

		// 记录跨 tab 导航历史，用于 back/forward 切换
		this.navTrackHandler = (leaf: WorkspaceLeaf | null) => {
			if (!leaf) return;
			// 引用比较替代布尔守卫，不依赖事件是否同步触发
			if (leaf === this.navJumpTarget) {
				this.navJumpTarget = null;
				return;
			}
			// 只跟踪主内容区的 leaf，排除左/右侧边栏 leaf（点击侧边栏也会触发此事件）
			let isRootLeaf = false;
			this.app.workspace.iterateRootLeaves(l => { if (l === leaf) isRootLeaf = true; });
			if (!isRootLeaf) return;

			const last = this.navHistory[this.navHistory.length - 1];
			if (last === leaf) return;
			this.navHistory.push(leaf);
			this.navFuture = []; // 新导航清除 forward 历史
		};
		this.app.workspace.on('active-leaf-change', this.navTrackHandler);

		// 前进/后退导航完成后，对已显示的目标 leaf 播放入场动画
		this.navAnimateHandler = (leaf: WorkspaceLeaf | null) => {
			if (!this.pendingAnimationCls || !leaf) return;
			const cls = this.pendingAnimationCls;
			this.pendingAnimationCls = null;
			if (!this.getSettings().enableNavAnimation) return;
			// 用双重 rAF 推迟到浏览器完成 DOM 渲染后再加动画 class：
			// 第一帧移除旧 class，第二帧添加新 class，避免同帧内强制重排
			// 触发 ResizeObserver loop 错误
			requestAnimationFrame(() => {
				const el = (leaf as LeafInternal).view?.contentEl;
				if (!el) return;
				el.classList.remove('minimalism-ui-slide-from-left', 'minimalism-ui-slide-from-right');
				requestAnimationFrame(() => {
					// 清理上一次未触发的 animationend listener，防止快速翻页时 listener 累积
					const oldListener = this.animEndListeners.get(el);
					if (oldListener) el.removeEventListener('animationend', oldListener);
					const listener = () => el.classList.remove(cls);
					el.addEventListener('animationend', listener, { once: true });
					this.animEndListeners.set(el, listener);
					el.classList.add(cls);
				});
			});
		};
		this.app.workspace.on('active-leaf-change', this.navAnimateHandler);

		// 对已有 leaf 补充 history 拦截，同时用当前所有 root leaf 初始化缓存队列。
		// 确保单页模式启用前已打开的 tab 也受 LRU 限制，最近活跃的 leaf 排到队尾。
		this.app.workspace.iterateRootLeaves(leaf => {
			this.patchLeafHistory(leaf);
			this.leafQueue.push(leaf);
		});
		const mostRecent = this.app.workspace.getMostRecentLeaf();
		if (mostRecent) {
			this.leafQueue = this.leafQueue.filter(l => l !== mostRecent);
			this.leafQueue.push(mostRecent);
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
				if (checking) return this.navHistory.length >= 2;
				this.navigateBack();
				return true;
			};
		}
		if (fwdCmd) {
			this.origGoForward = { callback: fwdCmd.callback, checkCallback: fwdCmd.checkCallback };
			delete fwdCmd.callback;
			fwdCmd.checkCallback = (checking: boolean) => {
				if (checking) return this.navFuture.length > 0;
				this.navigateForward();
				return true;
			};
		}
	}

	remove() {
		if (this.originalGetLeaf) {
			(this.app.workspace as unknown as WorkspaceInternal).getLeaf = this.originalGetLeaf;
			this.originalGetLeaf = null;
		}
		if (this.tabLimitHandler) {
			this.app.workspace.off('active-leaf-change', this.tabLimitHandler);
			this.tabLimitHandler = null;
		}
		if (this.navTrackHandler) {
			this.app.workspace.off('active-leaf-change', this.navTrackHandler);
			this.navTrackHandler = null;
		}
		if (this.navAnimateHandler) {
			this.app.workspace.off('active-leaf-change', this.navAnimateHandler);
			this.navAnimateHandler = null;
		}
		this.pendingAnimationCls = null;
		if (this.navTimer !== null) {
			clearTimeout(this.navTimer);
			this.navTimer = null;
		}
		if (this.resizeObserverErrHandler) {
			window.removeEventListener('error', this.resizeObserverErrHandler, true);
			this.resizeObserverErrHandler = null;
		}
		this.unpatchAllLeafHistories();
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
		this.leafQueue = [];
		this.navJumpTarget = null;
		this.pendingInterceptLeaves.clear();
	}

	// 检查指定 leaf 是否正处于等待 openFile 的 pending 状态
	// 供外部（homePageHandler）判断：若为 pending 则不应触发首页跳转
	hasPendingIntercept(leaf: WorkspaceLeaf): boolean {
		return this.pendingInterceptLeaves.has(leaf);
	}

	// 对新建的空 leaf 注入一次性 openFile 拦截器：
	// 在文件实际加载前检查缓存，若已有相同文件的 leaf 则直接复用，避免闪烁
	private interceptLeafOpenFile(leaf: WorkspaceLeaf) {
		this.pendingInterceptLeaves.add(leaf);
		const origOpenFile = (leaf as LeafInternal).openFile.bind(leaf);
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
					// 文件已在缓存中：激活已有 leaf，丢弃当前空 leaf，无需加载文件
					this.isReusingLeaf = true;
					try {
						this.leafQueue = this.leafQueue.filter(l => l !== existingLeaf);
						this.leafQueue.push(existingLeaf);
						this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
						leaf.detach();
					} finally {
						this.isReusingLeaf = false;
					}
					return;
				}
			}

			// 文件不在缓存中：正常加载，并补充 history 拦截
			this.patchLeafHistory(leaf);
			return await origOpenFile(file, state);
		};
	}

	private navigateBack() {
		// 取消上一次尚未执行的导航 timer，防止连续点击时多个 setActiveLeaf 并发触发，
		// 导致 navJumpTarget 状态错乱，并引发 ResizeObserver loop 错误
		if (this.navTimer !== null) {
			clearTimeout(this.navTimer);
			this.navTimer = null;
		}
		// 快照：若找不到可用的目标 leaf，回滚所有状态变更，避免 navFuture 被污染
		const snapHistory = [...this.navHistory];
		const snapFuture = [...this.navFuture];
		while (this.navHistory.length >= 2) {
			const current = this.navHistory.pop()!;
			this.navFuture.unshift(current);
			const prev = this.navHistory[this.navHistory.length - 1];
			if ((prev as LeafInternal).parent) {
				this.navJumpTarget = prev;
				this.pendingAnimationCls = 'minimalism-ui-slide-from-left';
				// 用 setTimeout(0) 推入新 task，彻底脱离当前渲染管线，
				// 避免 setActiveLeaf 在 rAF/ResizeObserver 阶段触发布局，产生 loop 错误
				this.navTimer = setTimeout(() => {
					this.navTimer = null;
					this.app.workspace.setActiveLeaf(prev, { focus: true });
				}, 0);
				return;
			}
			// leaf 已被淘汰，继续向前找
		}
		// 未能完成导航（所有历史 leaf 均已淘汰），回滚
		this.navHistory = snapHistory;
		this.navFuture = snapFuture;
	}

	private navigateForward() {
		// 取消上一次尚未执行的导航 timer，防止连续点击时多个 setActiveLeaf 并发触发
		if (this.navTimer !== null) {
			clearTimeout(this.navTimer);
			this.navTimer = null;
		}
		// 快照：若所有 forward leaf 均已淘汰，回滚，避免 navHistory 被多余条目污染
		const snapHistory = [...this.navHistory];
		const snapFuture = [...this.navFuture];
		while (this.navFuture.length > 0) {
			const next = this.navFuture.shift()!;
			if ((next as LeafInternal).parent) {
				this.navHistory.push(next);
				this.navJumpTarget = next;
				this.pendingAnimationCls = 'minimalism-ui-slide-from-right';
				// 用 setTimeout(0) 推入新 task，彻底脱离当前渲染管线，
				// 避免 setActiveLeaf 在 rAF/ResizeObserver 阶段触发布局，产生 loop 错误
				this.navTimer = setTimeout(() => {
					this.navTimer = null;
					this.app.workspace.setActiveLeaf(next, { focus: true });
				}, 0);
				return;
			}
			// leaf 已被淘汰，继续向后找
		}
		// 未能完成导航，回滚
		this.navHistory = snapHistory;
		this.navFuture = snapFuture;
	}

	patchLeafHistory(leaf: WorkspaceLeaf) {
		const history = (leaf as LeafInternal).history;
		if (!history || this.historyPatches.has(leaf)) return;
		const origBack = history.back.bind(history);
		const origForward = history.forward.bind(history);
		const origCanGoBack = history.canGoBack?.bind(history);
		const origCanGoForward = history.canGoForward?.bind(history);
		history.back = () => this.navigateBack();
		history.forward = () => this.navigateForward();
		// 让 Obsidian 的 UI 按钮 / 命令守卫读到我们自己的导航栈状态
		history.canGoBack = () => this.navHistory.length >= 2;
		history.canGoForward = () => this.navFuture.length > 0;
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
}
