import { App, setIcon, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from '../core/settings';
import { Feature } from '../core/Feature';
import { t } from '../core/i18n';
import { patchExecuteCommand } from '../core/obsidianCommands';
import { trackPointerDrag } from '../core/utils';
import { RightSidebarViewStack } from './RightSidebarViewStack';
import { RightSidebarIconDrag } from './RightSidebarIconDrag';

const LAUNCHER_CLASS = 'minimalism-ui-rsb-launcher';
const BUTTON_CLASS = 'minimalism-ui-rsb-button';
const PANEL_CLASS = 'minimalism-ui-rsb-panel';
const OPEN_CLASS = 'minimalism-ui-rsb-panel-open';
const BUTTON_ACTIVE_CLASS = 'minimalism-ui-rsb-button-active';
const SURFACE_CLASS = 'minimalism-ui-rsb-surface';
const PIN_CLASS = 'minimalism-ui-rsb-pin';
const PIN_HINT_CLASS = 'minimalism-ui-rsb-pin-hint';
const PIN_ACTIVE_CLASS = 'minimalism-ui-rsb-pin-active';
const RESIZE_HANDLE_CLASS = 'minimalism-ui-rsb-resize-handle';
const RESIZING_BODY_CLASS = 'minimalism-ui-rsb-resizing';
const STACK_CLASS = 'minimalism-ui-rsb-stack';
const STACK_EXPANDED_CLASS = 'minimalism-ui-rsb-stack-expanded';
const CONTENT_CLASS = 'minimalism-ui-rsb-content';
const DEFAULT_ICON = 'panel-right';

// 面板尺寸边界：小于 MIN 时内容放不下，大于 MAX（连同视口裁剪）时观感失控。
const MIN_WIDTH = 280;
const MAX_WIDTH = 720;
const MIN_HEIGHT = 220;
const MAX_HEIGHT = 800;
// 面板固定 right: 20px / bottom: 72px（见 styles.css），为视口裁剪预留同等边距。
const VIEWPORT_MARGIN_X = 40;
const VIEWPORT_MARGIN_Y = 92;

// 鼠标距面板顶边多近算"顶部区域"，命中时探出 pin 按钮（未 pin 住时）。
const PIN_HOVER_ZONE_PX = 40;
const PIN_ICON = 'pin';

// 面板打开后堆叠自动亮相的延迟，及亮相后（未被悬浮打断时）自动收起前的停留时长。
const STACK_AUTO_EXPAND_DELAY = 500;
const STACK_AUTO_COLLAPSE_DELAY = 2000;
// 悬浮唤出后，鼠标移出 launcher 到收起之间的短暂缓冲——比首次自动收起短得多，
// 因为用户已经主动看过、移开了，不需要再等 2s。
const STACK_HOVER_LEAVE_DELAY = 300;

// 用 patchExecuteCommand()（见 core/obsidianCommands.ts）监听原生「切换右侧边栏」命令——
// 右侧栏本体已被 CSS 永久隐藏（见类注释），单靠原生命令用户会觉得快捷键"没反应"，
// 拦截后原样放行的同时让悬浮按钮的开关状态跟着同步。
const TOGGLE_RIGHT_SIDEBAR_COMMAND_ID = 'app:toggle-right-sidebar';

/**
 * RightSidebarButtonManager — 右下角悬浮按钮，展开一个悬浮面板承载右侧边栏（及左侧栏里
 * 未被合并管理的"外来" leaf，如手动加入的 File Explorer/Tags/Search）的视图。
 *
 * 右侧边栏本身仍在（styles.css 用 body.minimalism-ui-mac-sidebar 纯 CSS 隐藏，
 * 内部 leaf/view 从未被拆除）。切视图不再靠面板内部的 tab 栏，而是按钮左侧一叠
 * 圆形图标（收起时层叠、点击展开成一排）：收起态最靠近按钮（最上层）的图标即当前
 * 展示的视图；展开后点选任意一个即完成切换，选中项重新收起时会挪到最靠近按钮的位置。
 *
 * 本类只管**面板本体的生命周期**：注入/拆除 DOM、开关/pin、尺寸拖拽、堆叠的悬浮展开/
 * 自动收起动画、点击外部/Esc 关闭、拦截原生"切换右侧边栏"命令。哪些视图可切换、图标
 * 堆叠怎么渲染、挂载哪个 leaf 的 DOM，都委托给 `RightSidebarViewStack`；图标的拖拽重排
 * 委托给 `RightSidebarIconDrag`。三者共用同一套 DOM 节点（stackEl/contentEl/buttonEl），
 * 本类在 inject() 时创建，通过 viewStack.mount() 交接。
 *
 * 图标堆叠的显隐是计时器 + 悬浮共同驱动的，跟"点击展开"无关：
 *   - 面板一打开就排 500ms 定时器，到点后堆叠从按钮下方向左滑出（showStack）；
 *   - 每次堆叠变为可见，只要鼠标当下不在 launcher 上，就顺带排一个 2s 定时器，
 *     到点自动收回到按钮下方、被按钮完全遮挡（不是老版本"层叠但仍露头"的收起态）；
 *   - 鼠标悬浮在 launcher（按钮或已展开的堆叠）上会清掉/暂停这个 2s 倒计时，移开后
 *     重新起算；堆叠处于隐藏态时悬浮 launcher 会立即唤出（跳过 500ms 延迟，那个延迟
 *     只属于"面板刚打开"这一次）；
 * isHovering 是这套逻辑的唯一状态位，靠 launcherEl 的 mouseenter/mouseleave 维护。
 *
 * 面板左上角有一个拖拽把手（面板锚定在右下角，故只能从左上角调整宽高）。
 * 拖拽逻辑与 PropertyKeyResizer 同构（共用 core/utils 的 trackPointerDrag）：
 * 拖拽中用 setCssStyles 直接改尺寸，松手才写入设置持久化，避免拖拽过程中频繁触发保存。
 *
 * Pin：panelEl 不再自己裁剪溢出，真正的圆角/背景/裁剪挪到内层 surfaceEl，
 * 好让 pin 按钮（挂在 panelEl 上，绝对定位）探出面板右上角之外。鼠标移到面板
 * 顶部一小段区域内时探出（mousemove 判 clientY 距顶边距离，见 PIN_HOVER_ZONE_PX），
 * 移出面板则收回；点击后切到"常驻显示"的 pinned 态并写入设置（跨重启持久化，
 * 因此关闭面板再打开、甚至重载插件后 pin 状态都还在）。
 * pinned 时 outsideClickHandler / keydownHandler 的关闭分支直接跳过——失焦、Esc
 * 都不再关闭面板，唯一出口是再次点击右下角悬浮按钮（toggle 不受 pinned 影响）。
 */
export class RightSidebarButtonManager implements Feature {
	private launcherEl: HTMLElement | null = null;
	private buttonEl: HTMLElement | null = null;
	private stackEl: HTMLElement | null = null;
	private panelEl: HTMLElement | null = null;
	private surfaceEl: HTMLElement | null = null;
	private contentEl: HTMLElement | null = null;
	private resizeHandleEl: HTMLElement | null = null;
	private pinEl: HTMLElement | null = null;
	private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
	private pointerDownHandler: ((e: PointerEvent) => void) | null = null;
	// pointerdown（capture 阶段，先于 click）时记录的"按下点是否在面板/launcher 内"——
	// 见 outsideClickHandler 顶部注释，click 事件的 composedPath() 在某些场景不可靠，
	// 这个提前一步、DOM 还未被任何 mousedown 触发的副作用改动过的快照更可信。
	private pointerDownInsidePanel = false;
	private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
	private layoutChangeHandler: (() => void) | null = null;
	// 见 patchExecuteCommand()：调用它返回的 unpatch()，remove() 时执行即可安全还原。
	private unpatchExecuteCommand: (() => void) | null = null;
	private isOpen = false;
	private stackExpanded = false;
	// 面板是否被 pin 住；跨重启持久化于设置，见类注释。
	private isPinned = false;

	private readonly viewStack: RightSidebarViewStack;
	private readonly iconDrag: RightSidebarIconDrag;

	// 面板开关态（isOpen）的订阅者——供 StatusBarMenuManager 之类的外部消费方在自己的
	// 悬浮面板打开期间，实时感知"用户直接点了右下角悬浮按钮"这类不经过它的触发路径。
	// 不随 remove()/apply() 的内部重建清空：订阅关系属于调用方，与本管理器的 DOM 重建
	// 生命周期无关（详见 apply() 里 wasOpen/restoreOpenState 的重建保活注释）。
	private stateChangeListeners = new Set<() => void>();

	// 鼠标是否停留在 launcher（按钮 + 堆叠）范围内——决定自动收起定时器要不要暂停。
	private isHovering = false;
	private autoExpandTimer: number | null = null;
	private autoCollapseTimer: number | null = null;

	// 进行中的拖拽起点；null 表示未在拖拽。
	private resizeStart: { x: number; y: number; width: number; height: number } | null = null;
	private currentSize: { width: number; height: number } | null = null;
	private stopResizeDrag: (() => void) | null = null;
	// 拖拽超出可调节范围时，松手瞬间指针已远离面板：随之而来的 click 会落在面板外，
	// 被"点击外部关闭"误判。此标记在拖拽结束后短暂生效，让该次 click 被忽略。
	private suppressNextOutsideClick = false;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		private save: () => Promise<void>,
	) {
		this.viewStack = new RightSidebarViewStack(app, getSettings, save);
		this.iconDrag = new RightSidebarIconDrag(this.viewStack, getSettings, save, () => this.suppressOutsideClickOnce());
		this.viewStack.bindIconDrag(this.iconDrag);
	}

	apply() {
		// remove() 会整体重建面板 DOM 并把 isOpen 复位为 false——但 apply() 不只在插件加载时跑
		// 一次，任何设置变更（如切换左下角 ribbon 面板的展开/收起）都会经 saveSettings() 触发一次
		// 全量重应用。如果面板此刻正开着（尤其是 pin 住常驻显示的情况），重建后不恢复开启态
		// 就会让它凭空消失——用户观感是"pin 住了还是被隐藏了"。故记住重建前的开启状态，重建后
		// 原样恢复；用 restoreOpenState() 而非 open()，避免重放"图标堆叠 500ms 后自动滑出、
		// 2s 后自动收起"这套只该在用户主动点击展开时触发的动画——否则每次无关设置保存都会让
		// 底部图标堆叠列表跟着自己开合一次。
		const wasOpen = this.isOpen;
		this.remove();
		if (!this.getSettings().showRightSidebarButton) return;
		this.inject();
		if (wasOpen) this.restoreOpenState();
	}

	// 重建后原样恢复"已打开"态：只還原面板可见性与当前挂载的视图内容，不触碰堆叠展开/收起
	// 动画计时器（那套只属于用户主动点击 launcher 的那一次，见类注释）。
	private restoreOpenState() {
		this.isOpen = true;
		this.panelEl?.addClass(OPEN_CLASS);
		this.buttonEl?.addClass(BUTTON_ACTIVE_CLASS);
		this.viewStack.refreshStack();
	}

	private inject() {
		this.isPinned = this.getSettings().rightSidebarPanelPinned;
		this.panelEl = activeDocument.body.createDiv({ cls: PANEL_CLASS });
		const s = this.getSettings();
		this.panelEl.setCssStyles({
			width: `${s.rightSidebarPanelWidth}px`,
			height: `${s.rightSidebarPanelHeight}px`,
		});
		this.surfaceEl = this.panelEl.createDiv({ cls: SURFACE_CLASS });
		this.contentEl = this.surfaceEl.createDiv({ cls: CONTENT_CLASS });
		this.resizeHandleEl = this.surfaceEl.createDiv({ cls: RESIZE_HANDLE_CLASS });
		this.resizeHandleEl.addEventListener('pointerdown', this.onResizePointerDown);

		this.pinEl = this.panelEl.createDiv({
			cls: PIN_CLASS,
			attr: { 'aria-label': t(this.isPinned ? 'rightSidebarPanelUnpin' : 'rightSidebarPanelPin') },
		});
		setIcon(this.pinEl, PIN_ICON);
		this.pinEl.toggleClass(PIN_ACTIVE_CLASS, this.isPinned);
		this.pinEl.addEventListener('click', (e) => {
			e.stopPropagation();
			this.togglePinned();
		});
		this.panelEl.addEventListener('mousemove', this.onPanelMouseMove);
		this.panelEl.addEventListener('mouseleave', this.onPanelMouseLeave);

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
			// 阻止冒泡到 document，避免同一次点击被下方的"点击外部关闭"监听器立即判定为外部点击。
			e.stopPropagation();
			this.setStackExpanded(false);
			this.toggle();
		});

		this.viewStack.mount({ stackEl: this.stackEl, contentEl: this.contentEl, buttonEl: this.buttonEl });

		// pointerdown 在 capture 阶段先于 click 触发，此刻这次交互（无论是我们自己、Obsidian
		// 核心还是某个三方插件）都还没来得及跑任何同步副作用去改动 DOM——是整个交互序列里
		// DOM 结构最可信的一个快照点。用它兜底记录"按下点是否在面板/launcher 内"，弥补下面
		// click 阶段 composedPath() 可能已经不可靠的情况（见其注释）。
		this.pointerDownHandler = (e: PointerEvent) => {
			const path = e.composedPath();
			this.pointerDownInsidePanel =
				(this.launcherEl != null && path.includes(this.launcherEl)) ||
				(this.panelEl != null && path.includes(this.panelEl));
		};
		activeDocument.addEventListener('pointerdown', this.pointerDownHandler, true);

		this.outsideClickHandler = (e: MouseEvent) => {
			if (this.suppressNextOutsideClick) {
				this.suppressNextOutsideClick = false;
				return;
			}
			// 用 composedPath() 而非 target.contains()：部分挂载视图（如 Search 结果列表用了虚拟
			// 渲染）会在冒泡到 document 之前就同步重建/替换被点击的 DOM 节点，届时 target 已从
			// 文档树摘除，.contains() 恒为 false，会把"点击面板内部"误判成"点击外部"进而误关闭。
			// composedPath() 返回事件刚开始派发时（DOM 变动前）就已固定的冒泡路径快照，不受影响
			// ——但这只覆盖"click 事件自身触发的副作用"这一种情况：如果 DOM 变动发生在更早的
			// mousedown 阶段（同一次交互里 click 是后触发的独立事件），click 派发时快照本身就已经
			// 是变动后的了，此时这里会失真。故以 pointerDownInsidePanel（见上）作为更早、更可信的
			// 兜底信号，两者任一为真都判定"在面板内"。
			const path = e.composedPath();
			const inStack = this.stackEl != null && path.includes(this.stackEl);
			if (this.stackExpanded && !inStack) {
				this.clearStackTimers();
				this.setStackExpanded(false);
			}
			if (!this.isOpen) return;
			const insidePanel = this.pointerDownInsidePanel
				|| (this.launcherEl != null && path.includes(this.launcherEl))
				|| (this.panelEl != null && path.includes(this.panelEl));
			if (insidePanel) return;
			// pin 住之后失焦（点击面板外）不再关闭，唯一出口是再点一次悬浮按钮（toggle，见 open/close）。
			if (this.isPinned) return;
			this.close();
		};
		activeDocument.addEventListener('click', this.outsideClickHandler);

		// stackExpanded 只可能在 isOpen 为 true 时出现（见 showStack 的调用路径），此前曾单独
		// 分支处理它、仅收起堆叠而不关闭面板，导致堆叠恰好展开时用户要按两次 Escape 才能真正
		// 退出面板——close() 本身已经会收起堆叠，直接统一走它即可，一次 Escape 关到底。
		this.keydownHandler = (e: KeyboardEvent) => {
			if (e.key !== 'Escape' || !this.isOpen) return;
			// pin 住之后 Esc 不再关闭，交给其它监听者处理（如退出编辑）。
			if (this.isPinned) return;
			e.stopPropagation();
			this.close();
		};
		activeDocument.addEventListener('keydown', this.keydownHandler);

		// 可切换 leaf 增减（第三方插件开关视图、手动拖拽 leaf 进出左/右侧栏）时，面板开着才重新扫描。
		this.layoutChangeHandler = () => {
			if (this.isOpen) this.viewStack.refreshStack();
		};
		this.app.workspace.on('layout-change', this.layoutChangeHandler);

		// 拦截原生「切换右侧边栏」命令（热键 / 命令面板均走这里）：patchExecuteCommand 原样
		// 放行原始调用（它仍会 collapse/expand 那个被 CSS 隐藏的 rightSplit，无害），命中且
		// 执行成功时额外让悬浮按钮跟着开关一次，使快捷键在用户看来确实"生效"了。
		this.unpatchExecuteCommand = patchExecuteCommand(this.app, (commandId) => {
			if (commandId === TOGGLE_RIGHT_SIDEBAR_COMMAND_ID) this.toggle();
		});
	}

	private toggle() {
		if (this.isOpen) this.close();
		else this.open();
	}

	// 供外部（StatusBarMenuManager）触发的公开入口，与直接点击右下角悬浮按钮等价。
	// launcherEl 为 null 说明 showRightSidebarButton 关闭、面板未注入，直接 no-op。
	togglePanel(): void {
		if (!this.launcherEl) return;
		this.toggle();
	}

	isPanelOpen(): boolean {
		return this.isOpen;
	}

	// 订阅 isOpen 变化（见字段注释）。返回取消订阅函数。
	onStateChange(cb: () => void): () => void {
		this.stateChangeListeners.add(cb);
		return () => this.stateChangeListeners.delete(cb);
	}

	private notifyStateChange() {
		for (const cb of this.stateChangeListeners) cb();
	}

	private open() {
		this.isOpen = true;
		this.panelEl?.addClass(OPEN_CLASS);
		this.buttonEl?.addClass(BUTTON_ACTIVE_CLASS);
		this.notifyStateChange();
		this.viewStack.refreshStack();

		// 面板打开 500ms 后堆叠自动滑出亮相；到点时面板可能已经被关掉了，需要重新判断 isOpen。
		this.clearStackTimers();
		this.autoExpandTimer = window.setTimeout(() => {
			this.autoExpandTimer = null;
			if (this.isOpen) this.showStack();
		}, STACK_AUTO_EXPAND_DELAY);

		// 首次展开时补齐所有已注册但当前没有 leaf 的工具类 view，随后重新扫描一次把它们
		// 纳入堆叠。先同步 refreshStack 一次是为了不让已存在的 leaf 因为等待探测而白屏。
		if (!this.viewStack.hasProbed()) {
			this.viewStack.markProbed();
			void this.viewStack.ensureAllToolViewsExist()
				.then(() => this.viewStack.materializeDeferredLeaves())
				.then(() => { if (this.isOpen) this.viewStack.refreshStack(); });
		} else {
			// 已经探测过 view type，但本次打开面板前可能还有 leaf 从未被真正物化过（用户这次话
			// 还没点过它）——每次打开都补一遍，把"物化"这一次性副作用提前到用户开始切换之前。
			void this.viewStack.materializeDeferredLeaves();
		}
	}

	private close() {
		this.isOpen = false;
		this.clearStackTimers();
		this.setStackExpanded(false);
		this.panelEl?.removeClass(OPEN_CLASS);
		this.buttonEl?.removeClass(BUTTON_ACTIVE_CLASS);
		this.notifyStateChange();
	}

	private setStackExpanded(expanded: boolean) {
		this.stackExpanded = expanded;
		this.stackEl?.toggleClass(STACK_EXPANDED_CLASS, expanded);
	}

	// 堆叠从隐藏变为可见的唯一入口：500ms 自动亮相定时器、悬浮唤出都走这里。
	// 亮相当下鼠标没停在 launcher 上才排"首次亮相"的 2s 自动收起——否则等 mouseleave
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

	// 堆叠隐藏态下唤出跳过 500ms 延迟（那个延迟只属于"面板刚打开"那一次）；
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
	// （区别于"面板刚打开、无人理会"那次的 2s——见 showStack）。
	private onLauncherMouseLeave = () => {
		this.isHovering = false;
		if (!this.isOpen) return;
		if (this.stackExpanded) this.scheduleAutoCollapse(STACK_HOVER_LEAVE_DELAY);
	};

	// 鼠标距面板顶边 PIN_HOVER_ZONE_PX 以内时探出 pin 按钮；已 pin 住的话本就常驻显示
	// （由 PIN_ACTIVE_CLASS 控制），这里只管未 pin 时的悬浮提示态。
	private onPanelMouseMove = (e: MouseEvent) => {
		if (!this.panelEl || this.isPinned) return;
		const rect = this.panelEl.getBoundingClientRect();
		const nearTop = e.clientY - rect.top <= PIN_HOVER_ZONE_PX;
		this.pinEl?.toggleClass(PIN_HINT_CLASS, nearTop);
	};

	private onPanelMouseLeave = () => {
		this.pinEl?.removeClass(PIN_HINT_CLASS);
	};

	private togglePinned() {
		this.isPinned = !this.isPinned;
		this.pinEl?.toggleClass(PIN_ACTIVE_CLASS, this.isPinned);
		this.pinEl?.setAttribute('aria-label', t(this.isPinned ? 'rightSidebarPanelUnpin' : 'rightSidebarPanelPin'));
		const s = this.getSettings();
		s.rightSidebarPanelPinned = this.isPinned;
		void this.save();
	}

	// ─── 拖拽调整面板尺寸 ───────────────────────────────────────────────────

	private onResizePointerDown = (e: PointerEvent) => {
		if (!this.panelEl) return;
		e.preventDefault();
		e.stopPropagation();
		const rect = this.panelEl.getBoundingClientRect();
		this.resizeStart = { x: e.clientX, y: e.clientY, width: rect.width, height: rect.height };
		activeDocument.body.addClass(RESIZING_BODY_CLASS);
		this.stopResizeDrag = trackPointerDrag({ onMove: this.onResizePointerMove, onEnd: this.onResizePointerUp });
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
		const mountedLeaf = this.viewStack.getMountedLeaf();
		if (mountedLeaf) this.viewStack.notifyResize(mountedLeaf);
	};

	private onResizePointerUp = () => {
		const size = this.currentSize;
		const had = this.resizeStart !== null;
		if (had) {
			// 拖拽到边界时指针已远离面板，随之而来的 click 会被"点击外部关闭"误判为外部点击。
			this.suppressOutsideClickOnce();
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
		this.stopResizeDrag?.();
		this.stopResizeDrag = null;
	}

	// 消费该次 click 后立即复位；若浏览器这次没有派发 click，靠超时兜底避免标记卡死。
	// 供面板 resize 拖拽（见上）与图标拖拽重排（见 RightSidebarIconDrag 的 notifyDragEnd）共用：
	// 两者松手点都可能落在 launcher/panel 之外，误触发"点击外部关闭"。
	private suppressOutsideClickOnce() {
		this.suppressNextOutsideClick = true;
		window.setTimeout(() => { this.suppressNextOutsideClick = false; }, 300);
	}

	remove() {
		if (this.outsideClickHandler) {
			activeDocument.removeEventListener('click', this.outsideClickHandler);
			this.outsideClickHandler = null;
		}
		if (this.pointerDownHandler) {
			activeDocument.removeEventListener('pointerdown', this.pointerDownHandler, true);
			this.pointerDownHandler = null;
		}
		this.pointerDownInsidePanel = false;
		if (this.keydownHandler) {
			activeDocument.removeEventListener('keydown', this.keydownHandler);
			this.keydownHandler = null;
		}
		if (this.layoutChangeHandler) {
			this.app.workspace.off('layout-change', this.layoutChangeHandler);
			this.layoutChangeHandler = null;
		}
		this.unpatchExecuteCommand?.();
		this.unpatchExecuteCommand = null;
		this.endResizeDrag();
		activeDocument.body.removeClass(RESIZING_BODY_CLASS);
		this.iconDrag.endIconDrag();
		this.viewStack.unmount();
		this.clearStackTimers();
		this.isHovering = false;
		this.resizeHandleEl?.removeEventListener('pointerdown', this.onResizePointerDown);
		this.resizeHandleEl = null;
		this.stackEl = null;
		this.contentEl = null;
		this.launcherEl?.removeEventListener('mouseenter', this.onLauncherMouseEnter);
		this.launcherEl?.removeEventListener('mouseleave', this.onLauncherMouseLeave);
		this.panelEl?.removeEventListener('mousemove', this.onPanelMouseMove);
		this.panelEl?.removeEventListener('mouseleave', this.onPanelMouseLeave);
		this.launcherEl?.remove();
		this.panelEl?.remove();
		this.launcherEl = null;
		this.buttonEl = null;
		this.panelEl = null;
		this.surfaceEl = null;
		this.pinEl = null;
		this.isOpen = false;
		this.stackExpanded = false;
		this.isPinned = false;
	}
}
