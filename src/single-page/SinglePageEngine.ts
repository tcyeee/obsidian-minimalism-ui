/**
 * SinglePageEngine — 单页模式的核心引擎
 *
 * 不变量：
 * - **一个文件 ⇄ 一个 leaf**，并受 LRU 上限约束；导航栈与 leaf 生命周期解耦。
 * - **绝不销毁正占着"可视位"的 root leaf** —— 所有关闭路径收口到 `detachRootLeaf()`，真正 detach
 *   之前先把 activeLeaf / 标签组 currentTab 交接给明确的接替者。这条不变量是"关闭当前笔记却平移
 *   到另一篇笔记"的根治手段：它剥夺了 Obsidian 自行挑选接替 tab 的机会，详见该方法上方的长注释。
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
import { uiDoc } from '../core/appDom';
import { AnimationClass, GLOBAL_GRAPH_KEY, NavigationHistory, filelessViewKey, isFilelessViewKey, viewTypeFromKey } from './NavigationHistory';
import { ResizeObserverErrorSuppressor } from './ResizeObserverErrorSuppressor';
import { LeafCache } from './LeafCache';
import { GraphSidebarManager } from './GraphSidebarManager';

type WorkspaceInternal = {
	getLeaf: (newLeaf?: boolean | string) => WorkspaceLeaf;
	revealLeaf: (leaf: WorkspaceLeaf) => void;
	// 直接在指定标签组里造 leaf，绕过 getLeaf 的"复用空 tab / 依赖 focusNewTab 配置"等隐式行为。
	createLeafInParent: (parent: unknown, index: number) => WorkspaceLeaf;
	activeLeaf: WorkspaceLeaf | null;
};

// WorkspaceTabs（标签组）的运行时字段，类型未公开。currentTab 是"当前可见 tab"的下标，
// 与 workspace.activeLeaf 是两套独立状态（revealLeaf 只改前者），关闭 tab 时两者都要考虑。
type TabGroupInternal = {
	children?: WorkspaceLeaf[];
	currentTab?: number;
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
	// 分屏尺寸（flexGrow）。createLeafInParent 会按兄弟数量给新 leaf 写一个百分比，
	// 在标签组里没有意义，建完即清掉，避免残留内联样式。
	setDimension?: (dimension: number | null) => void;
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
	// 正在执行 detach 补丁体的那个 leaf。它马上就要消失，因此在这段窗口里绝不能被当成
	// "接替者"选中（否则内容会加载进一个随即被销毁的 leaf，用户停在空白页上）。
	// 触发路径：关闭 A→需重开前驱 B 时先建空白 leaf 顶位，用户在 B 加载完成前又按了一次 CMD+W，
	// 此时活动 leaf 正是那个还没有文件的空白 leaf，会同时满足"待关闭"和"可复用的空白 leaf"。
	private closingLeaf: WorkspaceLeaf | null = null;
	// layout-change 兜底：把任何新冒出来的 root leaf 纳入 detach 补丁（见 apply 中的注释）
	private layoutChangeHandler: (() => void) | null = null;
	private renameHandler: ((file: TAbstractFile, oldPath: string) => void) | null = null;
	private deleteHandler: ((file: TAbstractFile) => void) | null = null;
	private createHandler: ((file: TAbstractFile) => void) | null = null;
	// 最近一次 vault 创建事件的时间戳。供 HomePageManager 判断"当前 pending leaf 是否大概率正
	// 等待一个刚创建的文件被 openFile"——见 msSinceLastFileCreate。
	private lastFileCreateAt = 0;
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
		// 兜底补扫：detach 补丁是"绝不销毁正占着可视位的 root leaf"这条不变量的唯一执行点，
		// 只要有一个 root leaf 漏打补丁，它被关闭时就会绕过不变量、把接替 tab 的选择权交还给
		// Obsidian（表现即"平移到不相干的笔记"）。而漏网 leaf 的来源无法穷举：rootSplit 被清空时
		// Obsidian 会在 updateLayout 里自建空 leaf、工作区布局恢复、拖出弹窗、其它插件直接调
		// createLeafInParent……与其逐个堵，不如在 layout-change 上统一补扫。两个补丁各自幂等
		// （Map.has 去重），成本是一次不超过 LRU 上限的遍历。
		this.layoutChangeHandler = () => {
			this.app.workspace.iterateRootLeaves(leaf => {
				this.patchLeafHistory(leaf);
				this.patchRootLeafDetach(leaf);
			});
		};
		this.app.workspace.on('layout-change', this.layoutChangeHandler);

		// 用当前所有 root leaf 初始化 LRU 缓存，最近活跃的 leaf 排到队尾。
		this.leafCache.seed();
		this.ensureNavSeeded();

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

		// 记录文件创建时间：新建笔记命令内部先 vault.create() 落盘（真实磁盘 IO，耗时可能跨越
		// 多个宏任务）、创建完成后才对 pending leaf 调用 openFile。HomePageManager 用这个时间戳
		// 判断"是否该再等等"，避免在笔记创建完成前误判 pending leaf 为空白页而抢先跳首页。
		this.createHandler = () => {
			this.lastFileCreateAt = Date.now();
		};
		this.app.vault.on('create', this.createHandler);
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
		if (this.layoutChangeHandler) {
			this.app.workspace.off('layout-change', this.layoutChangeHandler);
			this.layoutChangeHandler = null;
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
		if (this.createHandler) {
			this.app.vault.off('create', this.createHandler);
			this.createHandler = null;
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

	// 释放 pending 状态：HomePageManager 在延迟确认 leaf 仍为空（无文件被加载）后调用，
	// 使 openHomePage 的 canReuse 判断能复用该 leaf，而无需另开新 tab。
	releasePendingLeaf(leaf: WorkspaceLeaf): void {
		this.pendingInterceptLeaves.delete(leaf);
	}

	// 首页是否正在打开。供 HomePageManager 在 active-leaf-change 中过滤：openHomePage 自身的 getLeaf
	// 会先产生一个临时空 leaf 并触发 active-leaf-change，此时不能再次触发打开（会无限重入）。
	isOpeningHomePage(): boolean {
		return this._isOpeningHomePage;
	}

	// 距最近一次 vault 文件创建事件过去了多少毫秒；从未发生过则返回 Infinity。
	// 供 HomePageManager 判断某个 pending leaf 是否大概率正等着接收一个刚创建的文件。
	msSinceLastFileCreate(): number {
		return this.lastFileCreateAt ? Date.now() - this.lastFileCreateAt : Infinity;
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

	// 用主区域当前显示的 root leaf 兜底初始化导航栈（幂等：历史非空则只同步 markActiveRoot）。
	// 返回该 leaf 是否有可入栈的内容（笔记，或关系图等无文件功能视图）——即「主区域此刻显示的
	// 是真内容还是空页」，这也正是调用方判断该不该打开首页所需的信号，故与 seed 合为一个方法：
	// 两者必须读同一个 leaf，分成独立的 hasContent() + seed() 会让判断与入栈的对象不一致
	// （例如显示的是空页、但别的 tab 里还开着笔记时，判断说“有内容”而 seed 什么也没写入，
	// 结果既不跳首页、面包屑又是空的）。
	// 两处调用：
	//   ① apply() 中途启用——workspace 恢复会自动触发 active-leaf-change，但会话中途重新 apply()
	//      不会，历史留空会让首次后退因 length < 2 静默失败；
	//   ② 启动时决定不抢占已恢复的笔记（见 HomePageManager.openHomePageOnStartup）——此时必须
	//      保证那篇笔记确实在栈内，seed() 收尾的 ensureHomeInvariant 才会把首页钉到 index 0，
	//      面包屑呈现「首页 / 上次的笔记」。
	// 用 navKeyForLeaf 而非 filePathForLeaf：deferred（重启恢复出、尚未点开）的视图经
	// getViewState() 兜底也能正确识别，不会被误判为空页。
	ensureNavSeeded(): boolean {
		const mostRecent = this.app.workspace.getMostRecentLeaf();
		if (!mostRecent) return false;
		const seedKey = this.navKeyForLeaf(mostRecent);
		if (!seedKey) return false;
		if (this.nav.isEmpty()) this.nav.seed(seedKey);
		// 初始化当前活动 root leaf 键，避免首次后退时把“当前页”误判为无文件视图而原地重激活。
		this.nav.markActiveRoot(seedKey);
		// mid-session 启用时若当前就停在全局关系图上，同步收起左侧边栏，保持行为一致。
		this.graphSidebar.handleRootNav(seedKey);
		// 恢复出的 deferred 视图不一定发过 active-leaf-change，面包屑得由这里驱动首绘。
		this.navChangeListener?.(mostRecent);
		return true;
	}

	// 面包屑点击:跳转到导航历史栈中指定下标的条目(语义等同连续后退)。
	navigateHistoryTo(index: number) {
		this.nav.jumpToIndex(index);
	}

	// 拖拽栏前进/后退按钮:直接复用 nav 的判定与执行逻辑，与快捷键/面包屑保持同一套语义。
	goBack() {
		this.nav.back();
	}

	goForward() {
		this.nav.forward();
	}

	canGoBack(): boolean {
		return this.nav.canGoBack();
	}

	canGoForward(): boolean {
		return this.nav.canGoForward();
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

	// ───────────────────────────────────────────────────────────────────────────────
	// 单页模式的核心不变量：**绝不销毁正占着"可视位"的 root leaf。**
	//
	// 为什么这是架构级的而不是又一个补丁：主区域是否显示某个 tab，Obsidian 自己有两套状态——
	// `workspace.activeLeaf` 和标签组的 `currentTab` 下标。当被 detach 的 leaf 正好持有其中任意
	// 一个时，Obsidian 会**自行决定**接替者，而且这个决定是我们抢不过的：
	//   ① `WorkspaceTabs.removeChild`：移除的正是 currentTab 时 → `currentTab = max(0, n - 1)`，
	//      即"左边那个 tab"。单页模式下缓存着最多 30 个 tab，左邻几乎必然是一篇不相干的旧笔记。
	//   ② `Workspace.updateLayout`（detach 触发 onLayoutChange 后于**下一帧**执行）：发现
	//      `activeLeaf` 已不再 attached 时 → 取 `activeTabGroup.children[currentTab]`，
	//      也就是①刚挑出来的那个左邻，然后 `setActiveLeaf(它, { focus: true })`。
	// 这就是"关掉当前笔记却平移到另一篇笔记"的全部来源。
	//
	// 旧实现试图靠"抢先一步"取胜：detach 之前先同步激活面包屑前一页。前驱 leaf 还开着时确实有效，
	// 但只要接替者需要**异步**产生就必然失守——`openFile()` / `setViewState()` 要跨帧 resolve，而
	// updateLayout 下一帧就跑；更隐蔽的是 `getLeaf('tab')` 只在用户开启了 `focusNewTab` 配置时才
	// 顺带 setActiveLeaf，关掉该配置的用户连"临时新 tab 顶位"这一步都拿不到。再叠加
	// `active-leaf-change` 本身是 0ms 去抖并合并的（Obsidian 的 requestActiveLeafEvents），
	// 用来吞掉误记的 `isClosingTab` 一次性标志也可能吞错对象——于是概率高、且难以复现稳定。
	//
	// 改法：不再和 Obsidian 抢时序，而是让它**根本没有选择的机会**。所有销毁 root leaf 的路径统一
	// 收口到 detachRootLeaf()：真正 detach 之前，若该 leaf 仍持有可视位，就同步造一个空白 leaf 顶上。
	// 交接完成后 Obsidian 看到的永远是"移除一个非当前、非活动的 tab"——①走 else 分支保持选中不变、
	// ②因 activeLeaf 仍 attached 而整段跳过。异步接替者（重开被淘汰的笔记、加载首页）此后只是往
	// 这个已经就位的空白 leaf 里填内容，跨多少帧都无所谓。
	// ───────────────────────────────────────────────────────────────────────────────

	// leaf 是否正占着可视位：workspace 的活动 leaf，或其所在标签组的当前可见 tab。
	// 两者都要查：revealLeaf 只改 currentTab 不改 activeLeaf，二者可以短暂不一致。
	private isHoldingViewSlot(leaf: WorkspaceLeaf): boolean {
		const ws = this.app.workspace as unknown as WorkspaceInternal;
		if (ws.activeLeaf === leaf) return true;
		const parent = (leaf as LeafInternal).parent as TabGroupInternal | undefined;
		if (!parent || parent.currentTab === undefined || !parent.children) return false;
		return parent.children[parent.currentTab] === leaf;
	}

	// 同步把可视位从 leaf 手里接过来：在同一标签组里新建一个空白 leaf 并激活它。
	// 用 createLeafInParent 而非 getLeaf('tab')：后者会"若最近活跃的 leaf 是空视图就直接复用它"
	// （可能把待关闭的 leaf 自己还回来），且是否 setActiveLeaf 取决于用户的 focusNewTab 配置——
	// 两点都会让交接失败。这里要的是无条件、确定地拿到一个新 leaf 并让它立刻成为活动 leaf。
	private handOverViewSlot(leaf: WorkspaceLeaf): void {
		const parent = (leaf as LeafInternal).parent as TabGroupInternal | undefined;
		if (!parent || !this.originalGetLeaf) return;
		const ws = this.app.workspace as unknown as WorkspaceInternal;
		const placeholder = ws.createLeafInParent(parent, parent.children?.length ?? 0);
		if (!placeholder || placeholder === leaf) return;
		(placeholder as LeafInternal).setDimension?.(null);
		// 空白 leaf 也纳入引擎管理：用户可能直接把它再关掉，缺补丁会让 nav 簿记漏一拍。
		this.patchRootLeafDetach(placeholder);
		this.app.workspace.setActiveLeaf(placeholder, { focus: true });
	}

	// 销毁 root leaf 的唯一出口（detach 补丁只经由这里调用原始 detach）。
	// 先保证不变量成立，再执行真正的 detach。
	private detachRootLeaf(leaf: WorkspaceLeaf, original: () => void): void {
		if (this.isHoldingViewSlot(leaf)) this.handOverViewSlot(leaf);
		original();
	}

	// 复用一个已存在的空白 leaf（无文件、未处于 pending 拦截中）而非总是新开 tab，与
	// openHomePage() 的 canReuse 判断同一套逻辑。onTabClosing 关闭最后一篇笔记后落到 home
	// （首页此前从未真正打开过、只是被 ensureHomeInvariant 钉在历史栈里的锚点）这类场景下，
	// 若不复用，会把一个 Cmd+N 之类留下的空白标签晾在一边、又额外新开一个标签。
	private acquireReopenLeaf(): WorkspaceLeaf {
		const active = this.app.workspace.getMostRecentLeaf();
		const canReuse = !!active
			&& active !== this.closingLeaf
			&& !this.filePathForLeaf(active)
			&& !this.pendingInterceptLeaves.has(active);
		if (canReuse && active) return active;
		const leaf = this.originalGetLeaf!('tab');
		// 立刻激活这个空白 leaf，**不能**依赖 getLeaf 顺带做这件事——Obsidian 的
		// createLeafInTabGroup 只在用户开启 `focusNewTab` 配置时才 setActiveLeaf。关掉该配置时，
		// 待关闭的 leaf 会一直霸着可视位直到 openFile 异步 resolve，中间隔着的那一帧正好够
		// updateLayout 挑走一个左邻 tab（见 detachRootLeaf 上方的不变量说明）。
		// 这里同步激活，使"交接可视位"始终在当前这个同步块内完成，后续 openFile 只是填内容。
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
		return leaf;
	}

	// 激活已显示目标路径的 root leaf；若无（已被 LRU 淘汰或手动关闭）则重新打开该文件。
	// 供 NavigationHistory 的 back/forward/onTabClosing 回调调用，收敛此前散落 4 处的重复逻辑。
	// animCls：前进/后退要播放的入场动画方向（onTabClosing 传 null 不播放）。在 setActiveLeaf
	// 之后立即对确定的目标 leaf 同步触发动画，保证动画始终落在真正的目标页上、且在 paint 前生效。
	private activateOrOpenFile(path: string, animCls: AnimationClass | null) {
		let targetLeaf: WorkspaceLeaf | null = null;
		this.app.workspace.iterateRootLeaves(l => {
			if (targetLeaf || l === this.closingLeaf) return;
			if (this.navKeyForLeaf(l) === path) targetLeaf = l;
		});
		if (targetLeaf) {
			this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
			this.nav.playAnimation(targetLeaf, animCls);
			return;
		}
		if (!this.originalGetLeaf) return;
		// 无文件视图条目（关系图 / 其余插件视图）：缓存中已无对应 leaf（被 LRU 淘汰或手动关闭），
		// 从合成键反解出 viewType，复用一个空白 leaf（或新开 tab）按 viewType 重建该视图以重现历史条目。
		const reopenViewType = viewTypeFromKey(path);
		if (reopenViewType) {
			const newLeaf = this.acquireReopenLeaf();
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
		const newLeaf = this.acquireReopenLeaf();
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
		// 立即补 detach patch：openFile/setViewState 触发前该 leaf 就可能被直接 detach（如新建
		// 空白 tab 后立刻关闭），若等到拦截器触发才补 patch，这段窗口期内走的是原生 detach，
		// pendingInterceptLeaves 里的记录永远不会被清理（其内部统一在 detach patch 里清理）。
		this.patchRootLeafDetach(leaf);
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
	// 在 detach 前通知 nav（移除历史条目、设置关闭标志），随后经 detachRootLeaf 这个不变量出口销毁，
	// detach 后从 patch 注册表移除该 leaf，避免已销毁 leaf 在 Map 中无限累积（内存泄漏）。
	// isReusingLeaf / 缓存淘汰中（leafCache.isEvictingNow）时豁免 nav 通知：属于插件内部操作而非用户关闭 tab。
	private patchRootLeafDetach(leaf: WorkspaceLeaf) {
		if (this.rootDetachPatches.has(leaf)) return;
		const original = (leaf as LeafInternal).detach.bind(leaf);
		(leaf as LeafInternal).detach = () => {
			// 整个补丁体内把本 leaf 标记为"待关闭"，使 activateOrOpenFile / acquireReopenLeaf
			// 不会把它当成接替者（它马上就要消失）。嵌套 detach 时保存并恢复外层的标记。
			const outerClosingLeaf = this.closingLeaf;
			this.closingLeaf = leaf;
			try {
				if (!this.isReusingLeaf && !this.leafCache.isEvictingNow()) {
					// 关系图 tab 关闭时同样需移除其历史条目，故用 navKeyForLeaf 而非仅文件路径。
					const closingPath = this.navKeyForLeaf(leaf) ?? undefined;
					const target = this.nav.onTabClosing(closingPath);
					// 在真正 detach 之前先把接替者定下来：面包屑前一页。前驱 leaf 还开着时同步激活、
					// 无闪烁；已被 LRU 淘汰 / 早先被关掉时，acquireReopenLeaf 会同步新建并激活一个空白
					// leaf 顶位，再异步把文件加载进去。两条路都在本同步块内完成"可视位交接"。
					// 落到前驱页时播放与后退一致的入场动画（从左滑入）。
					// target 为 null（关完了整条浏览链）时这里不做激活：下面的 detachRootLeaf 会兜底顶上
					// 一个空白 leaf，HomePageManager 随即据 isNavEmpty() 把首页加载进去。
					if (target !== null) {
						this.activateOrOpenFile(target, 'minimalism-ui-slide-from-left');
					}
				}
				// 统一经由不变量出口销毁：无论上面走到哪一支、接替者是否已经就位，
				// 到这一步都保证待关闭的 leaf 已不再持有可视位。
				this.detachRootLeaf(leaf, original);
				// leaf 已销毁，清理各注册表，防止随累计打开的 tab 数无限增长
				this.rootDetachPatches.delete(leaf);
				this.historyPatches.delete(leaf);
				this.pendingInterceptLeaves.delete(leaf);
			} finally {
				this.closingLeaf = outerClosingLeaf;
			}
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
		// 有模态框开着时不抢焦点开首页。两个 document 都要查：Obsidian 1.13 起「设置」是一个
		// 独立窗口（见 core/appDom.ts），它的 .modal-container 只存在于那个窗口的 document 里，
		// 主窗口查不到；反过来若设置窗口开着，activeDocument 又查不到主窗口里的普通模态框。
		if (uiDoc().querySelector('.modal-container')) return;
		if (activeDocument !== uiDoc() && activeDocument.querySelector('.modal-container')) return;
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

	// “回到首页”统一入口：供 EmptyViewButtonManager 的按钮点击、以及 HomePageManager 对空白新
	// 标签页的自动重定向共用。首页若已在导航历史栈中（通常发生在从其它笔记回首页时），先用
	// nav.foldTo 把它折叠回栈内原位（其后的条目整体移入 future，语义等同面包屑点击首页），
	// 再复用 openHomePage() 的去重/空 leaf 复用逻辑完成实际定位——不能直接调用面包屑同款的
	// jumpToIndex，那会走它自己的“找现有 leaf 否则新开 tab”通用流程，若当前恰好停在一个刚创建
	// 的空白 leaf 上（如触发本方法的正是那个空白 tab 本身），会把它晾成一个没人清理的多余空标签
	// 页。foldTo 折叠后置的 jumpPath 会被 openHomePage 触发的那次 active-leaf-change 消费掉，
	// 使 nav.record 把这次识别为“自己发起的跳转”而跳过 push，避免在栈尾重复记一次首页路径
	// （否则面包屑会同时在首列与末列出现两个首页，且不再折叠回首列）。
	// 首页尚未入栈、或本就已是当前栈顶（已经就在首页）时，foldTo 直接返回 false 不做任何簿记，
	// 此时 openHomePage() 的正常 push（或“已是同一 leaf，setActiveLeaf 短路不触发事件”）不会
	// 造成重复。
	goHome() {
		const path = this.getSettings().homePage;
		if (!path) return;
		const idx = this.nav.getHistory().indexOf(path);
		if (idx !== -1) this.nav.foldTo(idx);
		void this.openHomePage();
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
