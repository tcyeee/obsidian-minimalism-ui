import { App, TFile, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from './settings';

type HistoryPatch = {
	back: () => void;
	forward: () => void;
	canGoBack: (() => boolean) | undefined;
	canGoForward: (() => boolean) | undefined;
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
	private historyPatches = new Map<WorkspaceLeaf, HistoryPatch>();

	// isOpeningHomePage 由 plugin 提供，避免首页打开时触发 getLeaf 拦截
	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		private isOpeningHomePage: () => boolean,
	) {}

	apply() {
		this.remove();
		this.leafQueue = [];
		if (!this.getSettings().disableNoteTabs) return;

		// 拦截 workspace.getLeaf(false)：将所有"当前 leaf"导航改为新开 tab，
		// 并在新 leaf 上注入一次性 openFile 拦截器（路径 4）
		const ws = this.app.workspace as any;
		this.originalGetLeaf = ws.getLeaf.bind(ws);
		ws.getLeaf = (newLeaf?: boolean | string) => {
			if ((newLeaf === false || newLeaf === undefined) && !this.isReusingLeaf && !this.isOpeningHomePage()) {
				const leaf = this.originalGetLeaf!('tab');
				this.interceptLeafOpenFile(leaf);
				return leaf;
			}
			return this.originalGetLeaf!(newLeaf);
		};

		// 仅监听 active-leaf-change，避免 layout-change 引发的重入
		this.tabLimitHandler = () => {
			if (this.isEvicting) return;
			const active = this.app.workspace.activeLeaf;
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
			const max = this.getSettings().enableLeafCache ? 10 : Infinity;
			if (this.leafQueue.length > max) {
				this.isEvicting = true;
				try {
					while (this.leafQueue.length > max) {
						const oldest = this.leafQueue.shift()!;
						oldest.detach();
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
			// 用 rAF 推迟到浏览器完成 DOM 渲染后再加动画 class，
			// 避免 active-leaf-change 同步触发时 leaf 尚未显示
			requestAnimationFrame(() => {
				const el = (leaf as any).view?.contentEl as HTMLElement | undefined;
				if (!el) return;
				el.classList.remove('minimalism-ui-slide-from-left', 'minimalism-ui-slide-from-right');
				void el.offsetWidth;
				el.classList.add(cls);
				el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
			});
		};
		this.app.workspace.on('active-leaf-change', this.navAnimateHandler);

		// 对已有 leaf 补充 history 拦截
		this.app.workspace.iterateRootLeaves(leaf => this.patchLeafHistory(leaf));
	}

	remove() {
		if (this.originalGetLeaf) {
			(this.app.workspace as any).getLeaf = this.originalGetLeaf;
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
		this.unpatchAllLeafHistories();
		this.leafQueue = [];
		this.navHistory = [];
		this.navFuture = [];
		this.navJumpTarget = null;
	}

	// 对新建的空 leaf 注入一次性 openFile 拦截器：
	// 在文件实际加载前检查缓存，若已有相同文件的 leaf 则直接复用，避免闪烁
	private interceptLeafOpenFile(leaf: WorkspaceLeaf) {
		const manager = this;
		const origOpenFile = (leaf as any).openFile.bind(leaf);
		(leaf as any).openFile = async function(file: TFile, state?: any) {
			// 一次性拦截：立即还原，防止后续调用被意外拦截
			(leaf as any).openFile = origOpenFile;

			if (!manager.isReusingLeaf) {
				let existingLeaf: WorkspaceLeaf | null = null;
				manager.app.workspace.iterateRootLeaves(l => {
					if (existingLeaf || l === leaf) return;
					if (((l as any).view?.file as TFile | undefined)?.path === file.path) {
						existingLeaf = l;
					}
				});
				if (existingLeaf) {
					// 文件已在缓存中：激活已有 leaf，丢弃当前空 leaf，无需加载文件
					manager.isReusingLeaf = true;
					try {
						manager.leafQueue = manager.leafQueue.filter(l => l !== existingLeaf);
						manager.leafQueue.push(existingLeaf!);
						manager.app.workspace.setActiveLeaf(existingLeaf!, { focus: true });
						leaf.detach();
					} finally {
						manager.isReusingLeaf = false;
					}
					return;
				}
			}

			// 文件不在缓存中：正常加载，并补充 history 拦截
			manager.patchLeafHistory(leaf);
			return origOpenFile(file, state);
		};
	}

	private navigateBack() {
		while (this.navHistory.length >= 2) {
			const current = this.navHistory.pop()!;
			this.navFuture.unshift(current);
			const prev = this.navHistory[this.navHistory.length - 1];
			if ((prev as any).parent) {
				this.navJumpTarget = prev;
				this.pendingAnimationCls = 'minimalism-ui-slide-from-left';
				this.app.workspace.setActiveLeaf(prev, { focus: true });
				return;
			}
			// leaf 已被淘汰，继续向前找
		}
	}

	private navigateForward() {
		while (this.navFuture.length > 0) {
			const next = this.navFuture.shift()!;
			if ((next as any).parent) {
				this.navHistory.push(next);
				this.navJumpTarget = next;
				this.pendingAnimationCls = 'minimalism-ui-slide-from-right';
				this.app.workspace.setActiveLeaf(next, { focus: true });
				return;
			}
			// leaf 已被淘汰，继续向后找
		}
	}

	patchLeafHistory(leaf: WorkspaceLeaf) {
		const history = (leaf as any).history;
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
			const history = (leaf as any).history;
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
