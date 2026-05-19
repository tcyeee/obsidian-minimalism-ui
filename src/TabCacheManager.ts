/**
 * TabCacheManager — 单页模式的核心控制器
 *
 * 职责：
 * 1. **getLeaf 拦截** — monkey-patch `workspace.getLeaf()`，将所有常规导航强制走新建 tab 路径，
 *    再注入一次性 `openFile` 拦截器，在文件实际加载前查重：若 workspace 中已有同路径 leaf，
 *    直接激活复用，丢弃空 leaf，避免重复打开与闪烁。
 *
 * 2. **LRU 淘汰** — 监听 `active-leaf-change`，维护 `leafQueue`（最近使用排末尾），
 *    超出上限（30）时 detach 最旧 leaf。
 *
 * 3. **跨 tab 导航栈** — 独立维护 `navHistory`（文件路径数组）/ `navFuture`，patch 每个 leaf 的
 *    `history.back/forward/canGoBack/canGoForward`，以及内置命令 `app:go-back` /
 *    `app:go-forward`，使快捷键在任意焦点位置均可跨 tab 前进后退。
 *    历史存储文件路径而非 leaf 引用，与 tab 生命周期完全解耦：tab 关闭、LRU 淘汰均不影响
 *    导航历史；后退/前进时若无现有 leaf 则重新打开对应文件。
 *
 * 4. **入场动画** — 前进/后退时设置 `pendingAnimationCls`，在下一次 `active-leaf-change`
 *    触发后通过双重 rAF 为目标 leaf 的 `contentEl` 添加滑入动画 class。
 *
 * 5. **ResizeObserver 错误抑制** — capture 阶段拦截 "ResizeObserver loop completed" 错误事件，
 *    阻止其到达 Obsidian 的全局 error handler，避免向用户展示无害的浏览器内部警告。
 *
 * `apply()` 注册所有 patch 与监听器；`remove()` 完整还原，保证插件卸载后无残留副作用。
 */
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
	// 导航历史存储文件路径，与 leaf 生命周期完全解耦
	private navHistory: string[] = [];
	private navFuture: string[] = [];
	// 当前正在执行的后退/前进目标路径，用于阻止 navTrackHandler 将该激活记录为新导航
	private navJumpPath: string | null = null;
	private tabLimitHandler: (() => void) | null = null;
	private navTrackHandler: ((leaf: WorkspaceLeaf | null) => void) | null = null;
	private navAnimateHandler: ((leaf: WorkspaceLeaf | null) => void) | null = null;
	private pendingAnimationCls: 'minimalism-ui-slide-from-left' | 'minimalism-ui-slide-from-right' | null = null;
	// tab 关闭后 Obsidian 自动激活下一个 leaf 会触发 active-leaf-change，该标志阻止其被记录为新导航
	private _isClosingTab = false;
	private navTimer: ReturnType<typeof setTimeout> | null = null;
	private animEndListeners = new WeakMap<Element, () => void>();
	private resizeObserverErrHandler: ((e: ErrorEvent) => void) | null = null;
	private historyPatches = new Map<WorkspaceLeaf, HistoryPatch>();
	// root leaf detach 补丁：触发时设置 _isClosingTab，覆盖所有关闭路径（CMD+W、右键、X 按钮）
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

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
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
			if (shouldIntercept && !this.isReusingLeaf && !this._isOpeningHomePage) {
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
			const max = 30;
			if (this.leafQueue.length > max) {
				this.isEvicting = true;
				try {
					while (this.leafQueue.length > max) {
						this.leafQueue.shift()!.detach();
					}
				} finally {
					this.isEvicting = false;
				}
			}
		};
		this.app.workspace.on('active-leaf-change', this.tabLimitHandler);

		// 记录跨 tab 导航历史（文件路径），用于 back/forward 切换。
		// 检查顺序严格固定：
		//   ① root leaf 判断必须最先——防止侧边栏事件提前消耗下方的一次性标志
		//   ② navJumpPath 匹配——我们自己发起的后退/前进不应再次入栈
		//   ③ _isClosingTab——tab 关闭后的自动激活不应入栈
		//   ④ 路径去重 + 写入
		this.navTrackHandler = (leaf: WorkspaceLeaf | null) => {
			if (!leaf) return;
			let isRootLeaf = false;
			this.app.workspace.iterateRootLeaves(l => { if (l === leaf) isRootLeaf = true; });
			if (!isRootLeaf) return;

			const filePath = (leaf as LeafInternal).view?.file?.path;
			if (!filePath) return;

			if (this.navJumpPath !== null && filePath === this.navJumpPath) {
				this.navJumpPath = null;
				return;
			}
			if (this._isClosingTab) {
				this._isClosingTab = false;
				return;
			}

			const last = this.navHistory[this.navHistory.length - 1];
			if (last === filePath) return;
			this.navHistory.push(filePath);
			this.navFuture = [];
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
			// Seed navHistory with the current file when apply() is called mid-session:
			// workspace restore fires active-leaf-change automatically, but a mid-session
			// re-apply does not, leaving navHistory empty so the first back press finds
			// length < 2 and silently fails.
			if (this.navHistory.length === 0) {
				const seedPath = (mostRecent as LeafInternal).view?.file?.path;
				if (seedPath) this.navHistory.push(seedPath);
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
		this._isClosingTab = false;
		if (this.navTimer !== null) {
			clearTimeout(this.navTimer);
			this.navTimer = null;
		}
		if (this.resizeObserverErrHandler) {
			window.removeEventListener('error', this.resizeObserverErrHandler, true);
			this.resizeObserverErrHandler = null;
		}
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
		for (const [leaf, original] of this.sidebarDetachPatches) {
			(leaf as LeafInternal).detach = original;
		}
		this.sidebarDetachPatches.clear();
		this.leafQueue = [];
		this.navJumpPath = null;
		this.pendingInterceptLeaves.clear();
	}

	// 检查指定 leaf 是否正处于等待 openFile 的 pending 状态
	// 供外部（homePageHandler）判断：若为 pending 则不应触发首页跳转
	hasPendingIntercept(leaf: WorkspaceLeaf): boolean {
		return this.pendingInterceptLeaves.has(leaf);
	}

	getNavHistory(): string[] {
		return this.navHistory;
	}

	// 对新建的空 leaf 注入一次性 openFile 拦截器：
	// 在文件实际加载前检查缓存，若已有相同文件的 leaf 则直接复用，避免闪烁
	private interceptLeafOpenFile(leaf: WorkspaceLeaf) {
		// If the leaf was already detached during the getLeaf patch (e.g. openHomePage ran
		// synchronously inside originalGetLeaf and discarded it), skip installation.
		if (!(leaf as LeafInternal).parent) return;
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
					// 文件已在缓存中：激活已有 leaf，丢弃当前空 leaf，无需加载文件。
					// 空 leaf 无文件路径，navTrackHandler 的 !filePath 守卫已阻止其写入历史，
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
					// setActiveLeaf 触发的 active-leaf-change 会将 existingLeaf 的路径写入 navHistory
					return;
				}
			}

			// 文件不在缓存中：正常加载，补充 history 和 detach 拦截
			this.patchLeafHistory(leaf);
			this.patchRootLeafDetach(leaf);
			const result = await origOpenFile(file, state);
			// 兜底：active-leaf-change 在 tab 尚未进入 iterateRootLeaves 时可能跳过该 leaf，
			// 文件加载完成后 leaf 已就位，此处确保路径写入 navHistory
			this.addToNavHistory(file.path);
			return result;
		};
	}

	// 将文件路径写入 navHistory（幂等：已是末尾则跳过，同时清除 forward 历史）
	private addToNavHistory(filePath: string) {
		const last = this.navHistory[this.navHistory.length - 1];
		if (last === filePath) return;
		this.navHistory.push(filePath);
		this.navFuture = [];
	}

	private navigateBack() {
		// 取消上一次尚未执行的导航 timer，防止连续点击时多个 setActiveLeaf 并发触发
		if (this.navTimer !== null) {
			clearTimeout(this.navTimer);
			this.navTimer = null;
		}
		const snapHistory = [...this.navHistory];
		const snapFuture = [...this.navFuture];
		while (this.navHistory.length >= 2) {
			const current = this.navHistory.pop()!;
			this.navFuture.unshift(current);
			const prevPath = this.navHistory[this.navHistory.length - 1];

			const file = this.app.vault.getAbstractFileByPath(prevPath);
			if (!(file instanceof TFile)) continue; // 文件已从 vault 删除，继续向前找

			let targetLeaf: WorkspaceLeaf | null = null;
			this.app.workspace.iterateRootLeaves(l => {
				if (!targetLeaf && (l as LeafInternal).view?.file?.path === prevPath) targetLeaf = l;
			});

			this.navJumpPath = prevPath;
			this.pendingAnimationCls = 'minimalism-ui-slide-from-left';

			if (targetLeaf) {
				const leaf = targetLeaf;
				// 用 setTimeout(0) 推入新 task，彻底脱离当前渲染管线，
				// 避免 setActiveLeaf 在 rAF/ResizeObserver 阶段触发布局，产生 loop 错误
				this.navTimer = setTimeout(() => {
					this.navTimer = null;
					this.app.workspace.setActiveLeaf(leaf, { focus: true });
				}, 0);
			} else {
				// 无现有 leaf 显示此文件（已被 LRU 淘汰或手动关闭），重新打开
				this.navTimer = setTimeout(async () => {
					this.navTimer = null;
					const newLeaf = this.originalGetLeaf!('tab');
					this.patchLeafHistory(newLeaf);
					this.patchRootLeafDetach(newLeaf);
					await (newLeaf as LeafInternal).openFile(file);
					this.app.workspace.setActiveLeaf(newLeaf, { focus: true });
				}, 0);
			}
			return;
		}
		// 未能完成导航，回滚
		this.navHistory = snapHistory;
		this.navFuture = snapFuture;
	}

	private navigateForward() {
		// 取消上一次尚未执行的导航 timer，防止连续点击时多个 setActiveLeaf 并发触发
		if (this.navTimer !== null) {
			clearTimeout(this.navTimer);
			this.navTimer = null;
		}
		const snapHistory = [...this.navHistory];
		const snapFuture = [...this.navFuture];
		while (this.navFuture.length > 0) {
			const nextPath = this.navFuture.shift()!;

			const file = this.app.vault.getAbstractFileByPath(nextPath);
			if (!(file instanceof TFile)) continue; // 文件已从 vault 删除，继续向后找

			this.navHistory.push(nextPath);

			let targetLeaf: WorkspaceLeaf | null = null;
			this.app.workspace.iterateRootLeaves(l => {
				if (!targetLeaf && (l as LeafInternal).view?.file?.path === nextPath) targetLeaf = l;
			});

			this.navJumpPath = nextPath;
			this.pendingAnimationCls = 'minimalism-ui-slide-from-right';

			if (targetLeaf) {
				const leaf = targetLeaf;
				this.navTimer = setTimeout(() => {
					this.navTimer = null;
					this.app.workspace.setActiveLeaf(leaf, { focus: true });
				}, 0);
			} else {
				this.navTimer = setTimeout(async () => {
					this.navTimer = null;
					const newLeaf = this.originalGetLeaf!('tab');
					this.patchLeafHistory(newLeaf);
					this.patchRootLeafDetach(newLeaf);
					await (newLeaf as LeafInternal).openFile(file);
					this.app.workspace.setActiveLeaf(newLeaf, { focus: true });
				}, 0);
			}
			return;
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

	// root leaf detach 补丁：通过捕获所有关闭路径（CMD+W、右键、X 按钮、API 调用）
	// 在 detach 前执行两件事：
	//   1. 从 navHistory 移除该文件路径的最后一次出现，使历史指针与实际位置保持一致
	//   2. 设置 _isClosingTab，阻止 navTrackHandler 将关闭后的自动激活记录为新导航
	// isReusingLeaf / isEvicting 为 true 时豁免：属于插件内部操作而非用户关闭 tab
	// navFuture 不修改：关闭 tab 不影响前进历史，已关闭的文件路径仍可通过前进重新打开
	private patchRootLeafDetach(leaf: WorkspaceLeaf) {
		if (this.rootDetachPatches.has(leaf)) return;
		const original = (leaf as LeafInternal).detach.bind(leaf);
		(leaf as LeafInternal).detach = () => {
			if (!this.isReusingLeaf && !this.isEvicting) {
				const closingPath = (leaf as LeafInternal).view?.file?.path;
				if (closingPath) {
					const idx = this.navHistory.lastIndexOf(closingPath);
					if (idx !== -1) this.navHistory.splice(idx, 1);
				}
				this._isClosingTab = true;
			}
			original();
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
		if (document.querySelector('.modal-container')) return;
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
