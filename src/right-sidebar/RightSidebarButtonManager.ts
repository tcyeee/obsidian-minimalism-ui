import { App, setIcon, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from '../core/settings';
import { Feature } from '../core/Feature';
import { t } from '../core/i18n';

const LAUNCHER_CLASS = 'minimalism-ui-rsb-launcher';
const BUTTON_CLASS = 'minimalism-ui-rsb-button';
const PANEL_CLASS = 'minimalism-ui-rsb-panel';
const OPEN_CLASS = 'minimalism-ui-rsb-panel-open';
const BUTTON_ACTIVE_CLASS = 'minimalism-ui-rsb-button-active';
const RESIZE_HANDLE_CLASS = 'minimalism-ui-rsb-resize-handle';
const RESIZING_BODY_CLASS = 'minimalism-ui-rsb-resizing';
const STACK_CLASS = 'minimalism-ui-rsb-stack';
const STACK_EXPANDED_CLASS = 'minimalism-ui-rsb-stack-expanded';
const STACK_ICON_CLASS = 'minimalism-ui-rsb-stack-icon';
const STACK_ICON_ACTIVE_CLASS = 'minimalism-ui-rsb-stack-icon-active';
const CONTENT_CLASS = 'minimalism-ui-rsb-content';
const EMPTY_CLASS = 'minimalism-ui-rsb-empty';
const DEFAULT_ICON = 'panel-right';

// 左侧栏里这三种 view type 由 SidebarLayoutManager 拆解合并进 Outline（Properties 只挪了
// 内部节点，Graph 挪了整个 containerEl），继续套用通用挂载/归还逻辑会和它的簿记打架——
// 排除在外；左侧栏里其余（用户手动加入、未被合并处理的）leaf 视为普通可切换项。
const MANAGED_LEFT_VIEW_TYPES = new Set(['outline', 'localgraph', 'file-properties']);

// “全部已注册 view”兜底扫描（见 ensureAllToolViewsExist）只覆盖工具类面板，不包括按文件渲染的
// 文档类 view —— 这些 view 脱离文件上下文 setViewState 大概率报错或空白，且“切到 markdown/canvas
// 视图”这个操作在悬浮面板的语义下也没有意义。此处只列出 Obsidian 核心已知的文档类 type；
// 第三方插件注册的未知类型一律放行，由 ensureAllToolViewsExist 的 try/catch 兜底探测失败。
const DOCUMENT_VIEW_TYPES = new Set([
	'markdown', 'canvas', 'pdf', 'image', 'audio', 'video',
	'empty', 'release-notes', 'webviewer', 'bases',
]);

// 面板尺寸边界：小于 MIN 时内容放不下，大于 MAX（连同视口裁剪）时观感失控。
const MIN_WIDTH = 280;
const MAX_WIDTH = 720;
const MIN_HEIGHT = 220;
const MAX_HEIGHT = 800;
// 面板固定 right: 20px / bottom: 72px（见 styles.css），为视口裁剪预留同等边距。
const VIEWPORT_MARGIN_X = 40;
const VIEWPORT_MARGIN_Y = 92;

// 面板打开后堆叠自动亮相的延迟，及亮相后（未被悬浮打断时）自动收起前的停留时长。
const STACK_AUTO_EXPAND_DELAY = 500;
const STACK_AUTO_COLLAPSE_DELAY = 2000;
// 悬浮唤出后，鼠标移出 launcher 到收起之间的短暂缓冲——比首次自动收起短得多，
// 因为用户已经主动看过、移开了，不需要再等 2s。
const STACK_HOVER_LEAVE_DELAY = 300;

/**
 * RightSidebarButtonManager — 右下角悬浮按钮，展开一个悬浮面板承载右侧边栏（及左侧栏里
 * 未被合并管理的“外来” leaf，如手动加入的 File Explorer/Tags/Search）的视图。
 *
 * 右侧边栏本身仍在（styles.css 用 body.minimalism-ui-mac-sidebar 纯 CSS 隐藏，
 * 内部 leaf/view 从未被拆除）。切视图不再靠面板内部的 tab 栏，而是按钮左侧一叠
 * 圆形图标（收起时层叠、点击展开成一排）：收起态最靠近按钮（最上层）的图标即当前
 * 展示的视图；展开后点选任意一个即完成切换，选中项重新收起时会挪到最靠近按钮的位置。
 *
 * 切换视图时把该 leaf 视图的 containerEl（DOM 节点本身，保留其事件监听/内部状态）
 * 挂进面板内容区；切走或卸载时移回原位置——与 SidebarLayoutManager 合并 Properties/
 * Graph 到 Outline 的手法同构（移动整个 containerEl，而非只挪 .view-content）。
 *
 * 全程不调用 setActiveLeaf/revealLeaf：只搬 DOM，不改变 Obsidian 认为的“当前活动 leaf”，
 * 避免干扰单页模式引擎（SinglePageEngine）的导航状态。
 *
 * 图标堆叠的显隐是计时器 + 悬浮共同驱动的，跟“点击展开”无关：
 *   - 面板一打开就排 500ms 定时器，到点后堆叠从按钮下方向左滑出（showStack）；
 *   - 每次堆叠变为可见，只要鼠标当下不在 launcher 上，就顺带排一个 2s 定时器，
 *     到点自动收回到按钮下方、被按钮完全遮挡（不是老版本“层叠但仍露头”的收起态）；
 *   - 鼠标悬浮在 launcher（按钮或已展开的堆叠）上会清掉/暂停这个 2s 倒计时，移开后
 *     重新起算；堆叠处于隐藏态时悬浮 launcher 会立即唤出（跳过 500ms 延迟，那个延迟
 *     只属于“面板刚打开”这一次）；
 *   - 用户点选某个视图 = 立即收起并清空所有计时器，不等 2s。
 * isHovering 是这套逻辑的唯一状态位，靠 launcherEl 的 mouseenter/mouseleave 维护。
 * 选中项不再把 leafOrder 里的顺序打乱——activeLeaf 单独记录“当前选中项”，堆叠顺序
 * 保持发现时的先后不变。
 *
 * 面板左上角有一个拖拽把手（面板锚定在右下角，故只能从左上角调整宽高）。
 * 拖拽逻辑与 PropertyKeyResizer 同构：拖拽中用 setCssStyles 直接改尺寸，
 * 松手才写入设置持久化，避免拖拽过程中频繁触发保存。
 *
 * 容错兜底：collectSwitchableLeaves 只能看到当前存在的 leaf —— 一个 view 一旦被用户
 * Cmd+W 关闭，leaf 就被销毁，不再出现在任何遍历里（这不是“隐藏”，是真的不存在了）。
 * 为了让本面板成为“任何 view 都能找回来”的最后入口，面板首次展开时会调用
 * ensureAllToolViewsExist 扫描 app.viewRegistry.viewByType 里注册过的全部工具类 view type，
 * 对尚无 leaf 的类型静默在（本就被 CSS 整体隐藏的）右侧栏里创建一个 leaf 补齐 —— 之后它
 * 就和其余 leaf 一样被 collectSwitchableLeaves 收进堆叠，图标/名称直接读自真实 View 实例，
 * 无需维护一份猜测的图标映射表。
 */
export class RightSidebarButtonManager implements Feature {
	private launcherEl: HTMLElement | null = null;
	private buttonEl: HTMLElement | null = null;
	private stackEl: HTMLElement | null = null;
	private panelEl: HTMLElement | null = null;
	private contentEl: HTMLElement | null = null;
	private resizeHandleEl: HTMLElement | null = null;
	private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
	private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
	private layoutChangeHandler: (() => void) | null = null;
	private isOpen = false;
	private stackExpanded = false;
	// 每次 apply() 只做一次全量探测（见 ensureAllToolViewsExist），避免每次开面板都重复扫描/创建。
	private hasProbedAllViewTypes = false;

	// 当前挂进 contentEl 的 leaf，及其原本所在的位置（用于切走/卸载时移回）。
	private mountedLeaf: WorkspaceLeaf | null = null;
	private mountedOriginal: { parent: HTMLElement; nextSibling: ChildNode | null } | null = null;
	// 图标堆叠的发现顺序，选中不再改变它（见类注释）。
	private leafOrder: WorkspaceLeaf[] = [];
	// 当前选中项，独立于 leafOrder 的顺序记录。
	private activeLeaf: WorkspaceLeaf | null = null;

	// 鼠标是否停留在 launcher（按钮 + 堆叠）范围内——决定自动收起定时器要不要暂停。
	private isHovering = false;
	private autoExpandTimer: number | null = null;
	private autoCollapseTimer: number | null = null;

	// 进行中的拖拽起点；null 表示未在拖拽。
	private resizeStart: { x: number; y: number; width: number; height: number } | null = null;
	private currentSize: { width: number; height: number } | null = null;
	// 拖拽超出可调节范围时，松手瞬间指针已远离面板：随之而来的 click 会落在面板外，
	// 被“点击外部关闭”误判。此标记在拖拽结束后短暂生效，让该次 click 被忽略。
	private suppressNextOutsideClick = false;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		private save: () => Promise<void>,
	) {}

	apply() {
		this.remove();
		if (!this.getSettings().showRightSidebarButton) return;
		this.inject();
	}

	private inject() {
		this.hasProbedAllViewTypes = false;
		this.panelEl = activeDocument.body.createDiv({ cls: PANEL_CLASS });
		const s = this.getSettings();
		this.panelEl.setCssStyles({
			width: `${s.rightSidebarPanelWidth}px`,
			height: `${s.rightSidebarPanelHeight}px`,
		});
		this.contentEl = this.panelEl.createDiv({ cls: CONTENT_CLASS });
		this.resizeHandleEl = this.panelEl.createDiv({ cls: RESIZE_HANDLE_CLASS });
		this.resizeHandleEl.addEventListener('pointerdown', this.onResizePointerDown);

		this.launcherEl = activeDocument.body.createDiv({ cls: LAUNCHER_CLASS });
		this.stackEl = this.launcherEl.createDiv({ cls: STACK_CLASS });
		this.launcherEl.addEventListener('mouseenter', this.onLauncherMouseEnter);
		this.launcherEl.addEventListener('mouseleave', this.onLauncherMouseLeave);

		this.buttonEl = this.launcherEl.createDiv({
			cls: BUTTON_CLASS,
			attr: { 'aria-label': t('rightSidebarButtonLabel') },
		});
		setIcon(this.buttonEl, DEFAULT_ICON);
		this.buttonEl.addEventListener('click', (e) => {
			// 阻止冒泡到 document，避免同一次点击被下方的“点击外部关闭”监听器立即判定为外部点击。
			e.stopPropagation();
			this.setStackExpanded(false);
			this.toggle();
		});

		this.outsideClickHandler = (e: MouseEvent) => {
			if (this.suppressNextOutsideClick) {
				this.suppressNextOutsideClick = false;
				return;
			}
			// 用 composedPath() 而非 target.contains()：部分挂载视图（如 Search 结果列表用了虚拟
			// 渲染）会在冒泡到 document 之前就同步重建/替换被点击的 DOM 节点，届时 target 已从
			// 文档树摘除，.contains() 恒为 false，会把"点击面板内部"误判成"点击外部"进而误关闭。
			// composedPath() 返回事件刚开始派发时（DOM 变动前）就已固定的冒泡路径快照，不受影响。
			const path = e.composedPath();
			const inStack = this.stackEl != null && path.includes(this.stackEl);
			if (this.stackExpanded && !inStack) {
				this.clearStackTimers();
				this.setStackExpanded(false);
			}
			if (!this.isOpen) return;
			if ((this.launcherEl && path.includes(this.launcherEl)) || (this.panelEl && path.includes(this.panelEl))) return;
			this.close();
		};
		activeDocument.addEventListener('click', this.outsideClickHandler);

		// stackExpanded 只可能在 isOpen 为 true 时出现（见 showStack 的调用路径），此前曾单独
		// 分支处理它、仅收起堆叠而不关闭面板，导致堆叠恰好展开时用户要按两次 Escape 才能真正
		// 退出面板——close() 本身已经会收起堆叠，直接统一走它即可，一次 Escape 关到底。
		this.keydownHandler = (e: KeyboardEvent) => {
			if (e.key !== 'Escape' || !this.isOpen) return;
			e.stopPropagation();
			this.close();
		};
		activeDocument.addEventListener('keydown', this.keydownHandler);

		// 可切换 leaf 增减（第三方插件开关视图、手动拖拽 leaf 进出左/右侧栏）时，面板开着才重新扫描。
		this.layoutChangeHandler = () => {
			if (this.isOpen) this.refreshStack();
		};
		this.app.workspace.on('layout-change', this.layoutChangeHandler);
	}

	private toggle() {
		if (this.isOpen) this.close();
		else this.open();
	}

	private open() {
		this.isOpen = true;
		this.panelEl?.addClass(OPEN_CLASS);
		this.buttonEl?.addClass(BUTTON_ACTIVE_CLASS);
		this.refreshStack();

		// 面板打开 500ms 后堆叠自动滑出亮相；到点时面板可能已经被关掉了，需要重新判断 isOpen。
		this.clearStackTimers();
		this.autoExpandTimer = window.setTimeout(() => {
			this.autoExpandTimer = null;
			if (this.isOpen) this.showStack();
		}, STACK_AUTO_EXPAND_DELAY);

		// 首次展开时补齐所有已注册但当前没有 leaf 的工具类 view，随后重新扫描一次把它们
		// 纳入堆叠。先同步 refreshStack 一次是为了不让已存在的 leaf 因为等待探测而白屏。
		if (!this.hasProbedAllViewTypes) {
			this.hasProbedAllViewTypes = true;
			void this.ensureAllToolViewsExist().then(() => {
				if (this.isOpen) this.refreshStack();
			});
		}
	}

	private close() {
		this.isOpen = false;
		this.clearStackTimers();
		this.setStackExpanded(false);
		this.panelEl?.removeClass(OPEN_CLASS);
		this.buttonEl?.removeClass(BUTTON_ACTIVE_CLASS);
	}

	private setStackExpanded(expanded: boolean) {
		this.stackExpanded = expanded;
		this.stackEl?.toggleClass(STACK_EXPANDED_CLASS, expanded);
	}

	// 堆叠从隐藏变为可见的唯一入口：500ms 自动亮相定时器、悬浮唤出都走这里。
	// 亮相当下鼠标没停在 launcher 上才排“首次亮相”的 2s 自动收起——否则等 mouseleave
	// 再排（见 onLauncherMouseLeave，用的是更短的 300ms），避免鼠标正停在上面时
	// 列表突然从指针底下收走。
	private showStack() {
		this.setStackExpanded(true);
		if (this.autoCollapseTimer !== null) {
			window.clearTimeout(this.autoCollapseTimer);
			this.autoCollapseTimer = null;
		}
		if (!this.isHovering) this.scheduleAutoCollapse(STACK_AUTO_COLLAPSE_DELAY);
	}

	private scheduleAutoCollapse(delayMs: number) {
		if (this.autoCollapseTimer !== null) window.clearTimeout(this.autoCollapseTimer);
		this.autoCollapseTimer = window.setTimeout(() => {
			this.autoCollapseTimer = null;
			if (!this.isHovering) this.setStackExpanded(false);
		}, delayMs);
	}

	private clearStackTimers() {
		if (this.autoExpandTimer !== null) {
			window.clearTimeout(this.autoExpandTimer);
			this.autoExpandTimer = null;
		}
		if (this.autoCollapseTimer !== null) {
			window.clearTimeout(this.autoCollapseTimer);
			this.autoCollapseTimer = null;
		}
	}

	// 堆叠隐藏态下唤出跳过 500ms 延迟（那个延迟只属于“面板刚打开”那一次）；
	// 已经展开时悬浮只是暂停当前倒计时（清掉定时器），不重新触发亮相动画。
	private onLauncherMouseEnter = () => {
		this.isHovering = true;
		if (!this.isOpen) return;
		if (!this.stackExpanded) {
			this.showStack();
			return;
		}
		if (this.autoCollapseTimer !== null) {
			window.clearTimeout(this.autoCollapseTimer);
			this.autoCollapseTimer = null;
		}
	};

	// 鼠标移出 launcher：用户已经主动看过、决定移开了，收起前只留 300ms 短缓冲
	// （区别于“面板刚打开、无人理会”那次的 2s——见 showStack）。
	private onLauncherMouseLeave = () => {
		this.isHovering = false;
		if (!this.isOpen) return;
		if (this.stackExpanded) this.scheduleAutoCollapse(STACK_HOVER_LEAVE_DELAY);
	};

	// ─── 视图枚举 / 渲染图标堆叠 / 挂载切换 ─────────────────────────────────

	// 右侧栏的全部 leaf，加上左侧栏里不属于 Outline/Graph/Properties 合并三件套的“外来” leaf。
	private collectSwitchableLeaves(): WorkspaceLeaf[] {
		const { leftSplit, rightSplit } = this.app.workspace;
		const leaves: WorkspaceLeaf[] = [];
		this.app.workspace.iterateAllLeaves((leaf) => {
			const root = leaf.getRoot();
			if (rightSplit && root === rightSplit) {
				leaves.push(leaf);
			} else if (leftSplit && root === leftSplit && !MANAGED_LEFT_VIEW_TYPES.has(leaf.getViewState().type)) {
				leaves.push(leaf);
			}
		});
		return leaves;
	}

	// 全部已注册的“工具类” view type：viewByType 里排除文档类（DOCUMENT_VIEW_TYPES）和
	// 已被 SidebarLayoutManager 合并管理的三种（MANAGED_LEFT_VIEW_TYPES）。
	// viewByType 是内部 API（未出现在官方类型声明中），随 Obsidian 插件注册 registerView 时写入，
	// 与是否有 leaf 打开无关 —— 这正是探测“已关闭但曾注册过”的 view 所需要的入口。
	private allRegisteredToolViewTypes(): string[] {
		const registry = (this.app as unknown as { viewRegistry?: { viewByType?: Record<string, unknown> } }).viewRegistry;
		const types = Object.keys(registry?.viewByType ?? {});
		return types.filter((type) => !DOCUMENT_VIEW_TYPES.has(type) && !MANAGED_LEFT_VIEW_TYPES.has(type));
	}

	// 为每个尚无 leaf 的工具类 view type 在（CSS 整体隐藏的）右侧栏静默创建一个 leaf 占位，
	// 使其之后能被 collectSwitchableLeaves 发现。逐个 await 而非 Promise.all，避免并发调用
	// getRightLeaf/setViewState 在 Obsidian 工作区内部产生竞态。
	// 某个类型探测失败（第三方 view 在无文件上下文下抛错）不影响其余类型，失败时把刚创建的
	// 空/半初始化 leaf 一并 detach 掉，不留垃圾条目。
	private async ensureAllToolViewsExist() {
		for (const type of this.allRegisteredToolViewTypes()) {
			if (this.app.workspace.getLeavesOfType(type).length > 0) continue;
			let leaf: WorkspaceLeaf | null = null;
			try {
				leaf = this.app.workspace.getRightLeaf(true);
				if (!leaf) continue;
				await leaf.setViewState({ type, active: false });
			} catch (err: unknown) {
				console.error(`[minimalism-ui] probing view type "${type}" failed, skipping`, err);
				leaf?.detach();
			}
		}
	}

	// 用最新扫描结果更新堆叠顺序：保留既有相对顺序，已关闭的 leaf 剔除，
	// 新出现的 leaf 追加到最前（选中不再触发重排，见类注释）。
	private syncLeafOrder(leaves: WorkspaceLeaf[]) {
		const present = new Set(leaves);
		this.leafOrder = this.leafOrder.filter((l) => present.has(l));
		const known = new Set(this.leafOrder);
		for (const leaf of leaves) if (!known.has(leaf)) this.leafOrder.unshift(leaf);
	}

	private refreshStack() {
		if (!this.stackEl) return;
		const leaves = this.collectSwitchableLeaves();
		this.syncLeafOrder(leaves);

		if (this.leafOrder.length === 0) {
			this.activeLeaf = null;
			this.stackEl.empty();
			this.showEmpty();
			return;
		}

		// activeLeaf 缺失（首次扫描）或其 leaf 已被关闭时，回退到最新发现的一项。
		if (!this.activeLeaf || !this.leafOrder.includes(this.activeLeaf)) {
			this.activeLeaf = this.leafOrder[this.leafOrder.length - 1];
		}

		this.renderStackIcons();
		void this.showLeaf(this.activeLeaf);
	}

	private renderStackIcons() {
		if (!this.stackEl) return;
		this.stackEl.empty();
		for (const leaf of this.leafOrder) {
			const iconEl = this.stackEl.createDiv({
				cls: STACK_ICON_CLASS,
				attr: { 'aria-label': leaf.getDisplayText() },
			});
			iconEl.toggleClass(STACK_ICON_ACTIVE_CLASS, leaf === this.activeLeaf);
			setIcon(iconEl, leaf.getIcon());
			iconEl.addEventListener('click', (e) => {
				e.stopPropagation();
				this.selectLeaf(leaf);
			});
		}
	}

	private selectLeaf(leaf: WorkspaceLeaf) {
		this.activeLeaf = leaf;
		this.clearStackTimers();
		this.setStackExpanded(false);
		if (!this.isOpen) this.open();
		else {
			this.renderStackIcons();
			void this.showLeaf(leaf);
		}
	}

	private async showLeaf(leaf: WorkspaceLeaf) {
		if (this.mountedLeaf === leaf) return;
		this.restoreMounted();

		if (leaf.isDeferred) await leaf.loadIfDeferred();
		const viewEl = leaf.view.containerEl;
		if (!viewEl.parentElement) return;

		this.mountedOriginal = { parent: viewEl.parentElement, nextSibling: viewEl.nextSibling };
		this.contentEl?.empty();
		this.contentEl?.appendChild(viewEl);
		this.mountedLeaf = leaf;

		if (this.buttonEl) setIcon(this.buttonEl, leaf.getIcon());
		// 该 leaf 原本渲染在被 CSS 永久隐藏（display:none）的右侧栏里；不少核心视图
		// （文件列表、搜索、标签、反向链接等）按容器尺寸做虚拟滚动/懒渲染，隐藏期间量到的
		// 是 0 尺寸，且我们这里是绕过 Obsidian 原生 leaf 缩放流程的裸 DOM 搬运，不会
		// 自动触发它们预期的重新measure。用官方 onResize() 钩子显式通知一次，
		// 让它们据当前真实容器尺寸重新布局。
		this.notifyResize(leaf);
	}

	private showEmpty() {
		this.restoreMounted();
		this.contentEl?.empty();
		this.contentEl?.createDiv({ cls: EMPTY_CLASS, text: t('rightSidebarPanelEmpty') });
		if (this.buttonEl) setIcon(this.buttonEl, DEFAULT_ICON);
	}

	// onResize() 跑的是任意第三方/核心视图的代码，出错也不该拖垮我们自己的挂载逻辑。
	private notifyResize(leaf: WorkspaceLeaf) {
		try {
			leaf.onResize();
		} catch (err: unknown) {
			console.error('[minimalism-ui] right sidebar view onResize() failed', err);
		}
	}

	// 把当前挂载的 leaf 视图移回它原本所在的 DOM 位置（隐藏的右侧栏内）。
	private restoreMounted() {
		if (!this.mountedLeaf || !this.mountedOriginal) return;
		const viewEl = this.mountedLeaf.view.containerEl;
		this.mountedOriginal.parent.insertBefore(viewEl, this.mountedOriginal.nextSibling);
		this.mountedLeaf = null;
		this.mountedOriginal = null;
	}

	// ─── 拖拽调整面板尺寸 ───────────────────────────────────────────────────

	private onResizePointerDown = (e: PointerEvent) => {
		if (!this.panelEl) return;
		e.preventDefault();
		e.stopPropagation();
		const rect = this.panelEl.getBoundingClientRect();
		this.resizeStart = { x: e.clientX, y: e.clientY, width: rect.width, height: rect.height };
		activeDocument.body.addClass(RESIZING_BODY_CLASS);
		activeDocument.addEventListener('pointermove', this.onResizePointerMove, true);
		activeDocument.addEventListener('pointerup', this.onResizePointerUp, true);
	};

	private onResizePointerMove = (e: PointerEvent) => {
		if (!this.resizeStart || !this.panelEl) return;
		// 把手在左上角，面板锚定右下角：指针左移/上移 → 宽/高增大。
		const dx = this.resizeStart.x - e.clientX;
		const dy = this.resizeStart.y - e.clientY;
		const maxWidth = Math.min(MAX_WIDTH, activeWindow.innerWidth - VIEWPORT_MARGIN_X);
		const maxHeight = Math.min(MAX_HEIGHT, activeWindow.innerHeight - VIEWPORT_MARGIN_Y);
		const width = Math.max(MIN_WIDTH, Math.min(maxWidth, Math.round(this.resizeStart.width + dx)));
		const height = Math.max(MIN_HEIGHT, Math.min(maxHeight, Math.round(this.resizeStart.height + dy)));
		this.currentSize = { width, height };
		this.panelEl.setCssStyles({ width: `${width}px`, height: `${height}px` });
		// 面板尺寸随拖拽实时变化：挂载中的视图（若也做尺寸相关布局）同步收到通知。
		if (this.mountedLeaf) this.notifyResize(this.mountedLeaf);
	};

	private onResizePointerUp = () => {
		const size = this.currentSize;
		const had = this.resizeStart !== null;
		if (had) {
			// 拖拽到边界时指针已远离面板，随之而来的 click 会被“点击外部关闭”误判为外部点击。
			// 消费该次 click 后立即复位；若浏览器这次没有派发 click，靠超时兜底避免标记卡死。
			this.suppressNextOutsideClick = true;
			window.setTimeout(() => { this.suppressNextOutsideClick = false; }, 300);
		}
		this.endResizeDrag();
		if (had && size) {
			const s = this.getSettings();
			s.rightSidebarPanelWidth = size.width;
			s.rightSidebarPanelHeight = size.height;
			void this.save();
		}
	};

	private endResizeDrag() {
		if (!this.resizeStart) return;
		this.resizeStart = null;
		this.currentSize = null;
		activeDocument.body.removeClass(RESIZING_BODY_CLASS);
		activeDocument.removeEventListener('pointermove', this.onResizePointerMove, true);
		activeDocument.removeEventListener('pointerup', this.onResizePointerUp, true);
	}

	remove() {
		if (this.outsideClickHandler) {
			activeDocument.removeEventListener('click', this.outsideClickHandler);
			this.outsideClickHandler = null;
		}
		if (this.keydownHandler) {
			activeDocument.removeEventListener('keydown', this.keydownHandler);
			this.keydownHandler = null;
		}
		if (this.layoutChangeHandler) {
			this.app.workspace.off('layout-change', this.layoutChangeHandler);
			this.layoutChangeHandler = null;
		}
		this.endResizeDrag();
		activeDocument.body.removeClass(RESIZING_BODY_CLASS);
		this.restoreMounted();
		this.clearStackTimers();
		this.leafOrder = [];
		this.activeLeaf = null;
		this.isHovering = false;
		this.resizeHandleEl?.removeEventListener('pointerdown', this.onResizePointerDown);
		this.resizeHandleEl = null;
		this.stackEl = null;
		this.contentEl = null;
		this.launcherEl?.removeEventListener('mouseenter', this.onLauncherMouseEnter);
		this.launcherEl?.removeEventListener('mouseleave', this.onLauncherMouseLeave);
		this.launcherEl?.remove();
		this.panelEl?.remove();
		this.launcherEl = null;
		this.buttonEl = null;
		this.panelEl = null;
		this.isOpen = false;
		this.stackExpanded = false;
	}
}
