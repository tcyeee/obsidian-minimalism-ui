import { App, Platform, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from '../core/settings';
import { BreadcrumbRenderer } from './BreadcrumbRenderer';

type WorkspaceSplitInternal = { containerEl: HTMLElement };

/**
 * DragBarManager — 顶部自定义拖拽栏。
 *
 * 负责:构建拖拽区 DOM、在布局重建时重新插入拖拽区、把系统 status-bar 搬入拖拽栏右侧。
 * 面包屑导航委托给 {@link BreadcrumbRenderer}。
 */
export class DragBarManager {
	private dragBar: HTMLElement | null = null;
	private layoutHandler: (() => void) | null = null;
	private statusBarOriginalParent: HTMLElement | null = null;
	private statusBarOriginalNextSibling: Element | null = null;
	private breadcrumb: BreadcrumbRenderer;
	// 监测左侧栏展开/收起:ResizeObserver 在侧栏拖拽/折叠时会持续触发(见 SidebarLayoutManager),
	// 比 layout-change 更及时,确保收起瞬间面包屑就右移让位。
	private leftSplitObserver: ResizeObserver | null = null;
	private readonly isMac = Platform.isMacOS;
	// 左侧栏窄于此宽度时,主区左缘逼近 macOS 红绿灯,标题区需右移让位。
	// 阈值取红绿灯横向占位的安全外延:此时 20px 基础内边距的面包屑落在 ~100px 处,正好清出红绿灯区。
	private static readonly TRAFFIC_LIGHT_SAFE_WIDTH = 80;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		navHistoryGetter: () => string[] = () => [],
		onBreadcrumbNavigate: (index: number) => void = () => {},
		navDisplayNameGetter: (key: string) => string | null = () => null,
	) {
		this.breadcrumb = new BreadcrumbRenderer(app, getSettings, navHistoryGetter, onBreadcrumbNavigate, navDisplayNameGetter);
	}

	// 引擎记录一次导航后转发给面包屑刷新：覆盖 active-leaf-change 未触发的 deferred 视图 reveal 场景。
	notifyNavChange(leaf: WorkspaceLeaf | null) {
		this.breadcrumb.notifyActiveLeaf(leaf);
	}

	apply() {
		this.remove();
		if (!this.getSettings().disableNoteTabs) return;

		const rootEl = (this.app.workspace.rootSplit as unknown as WorkspaceSplitInternal).containerEl;
		const tabsEl = rootEl.querySelector<HTMLElement>('.workspace-tabs');
		if (!tabsEl) return;

		// 创建拖拽区
		this.dragBar = createDiv();
		this.dragBar.className = 'minimalism-ui-drag-bar';

		// Row 1: title + status bar
		const row1 = createDiv();
		row1.className = 'minimalism-ui-drag-bar-row1';
		this.dragBar.appendChild(row1);

		const titleEl = createSpan();
		titleEl.className = 'minimalism-ui-drag-bar-title';
		row1.appendChild(titleEl);

		// 面包屑前的装饰小圆点（不再显示 tab 数量）
		const dotEl = createSpan();
		dotEl.className = 'minimalism-ui-drag-bar-count';
		titleEl.appendChild(dotEl);

		// 面包屑替代文件名文本,行内挂在 titleEl 里
		this.breadcrumb.mount(titleEl);

		tabsEl.insertBefore(this.dragBar, tabsEl.firstChild);

		// macOS 下左侧栏收起时红绿灯会盖住面包屑,先同步一次初始状态
		this.updateLeftCollapsedClass();
		this.observeLeftSplit();

		// 布局变化时:① 同步左侧栏收起状态 ② 拖拽区被重建则重新插入
		this.layoutHandler = () => {
			this.updateLeftCollapsedClass();
			if (!this.dragBar || this.dragBar.isConnected) return;
			const rootEl2 = (this.app.workspace.rootSplit as unknown as WorkspaceSplitInternal).containerEl;
			const tabsEl2 = rootEl2.querySelector<HTMLElement>('.workspace-tabs');
			if (tabsEl2) tabsEl2.insertBefore(this.dragBar, tabsEl2.firstChild);
		};
		this.app.workspace.on('layout-change', this.layoutHandler);

		// 将 status-bar 搬入 row1 右侧
		const statusBar = activeDocument.querySelector<HTMLElement>('.status-bar');
		if (statusBar) {
			this.statusBarOriginalParent = statusBar.parentElement;
			this.statusBarOriginalNextSibling = statusBar.nextElementSibling;
			row1.appendChild(statusBar);
		}
	}

	/**
	 * macOS 专属:左侧栏收起时顶部红绿灯按钮会盖住面包屑;
	 * 给拖拽栏加 is-left-collapsed,由 CSS 把标题区右移 100px 让位。
	 *
	 * 判定跟随「实测侧栏宽度」而非单纯 leftSplit.collapsed 布尔值:collapsed 在
	 * 展开/折叠动画一开始就翻转,若只看它,展开时会在侧栏尚未滑到位(主区左缘仍≈0)
	 * 时就把标题归位到 20px,瞬间压上红绿灯再被推开 → 闪烁。改看宽度后,展开全程
	 * 保持让位直到侧栏真正变宽。仍 OR 上 collapsed 兜底:完全收起态宽度恒为 0,
	 * 即便测量有量子化误差也能保证让位。
	 *
	 * @param measuredWidth 可选,ResizeObserver 直接传 contentRect.width 复用其测量,避免强制重排。
	 */
	private updateLeftCollapsedClass(measuredWidth?: number) {
		if (!this.isMac || !this.dragBar) return;
		const collapsed = (this.app.workspace.leftSplit as unknown as { collapsed: boolean }).collapsed;
		const width = measuredWidth ?? this.getLeftSplitWidth();
		const needGuard = collapsed || width < DragBarManager.TRAFFIC_LIGHT_SAFE_WIDTH;
		this.dragBar.classList.toggle('is-left-collapsed', needGuard);
	}

	/** 左侧栏 containerEl 当前实测宽度;取不到时按 0(即视作收起)处理。 */
	private getLeftSplitWidth(): number {
		const el = (this.app.workspace.leftSplit as unknown as { containerEl?: HTMLElement }).containerEl
			?? activeDocument.querySelector<HTMLElement>('.workspace-split.mod-left-split');
		return el ? el.getBoundingClientRect().width : 0;
	}

	/**
	 * 监测左侧栏宽度变化(展开/收起/拖拽)。ResizeObserver 在折叠瞬间即触发且逐帧更新,
	 * 比 layout-change 更及时;把 contentRect.width 直接喂给判定,让标题区随侧栏宽度平滑让位。
	 * 非 macOS 无需监测。
	 */
	private observeLeftSplit() {
		if (!this.isMac) return;
		const leftSplitEl = this.app.workspace.leftSplit as unknown as { containerEl?: HTMLElement };
		const target = leftSplitEl?.containerEl
			?? activeDocument.querySelector<HTMLElement>('.workspace-split.mod-left-split');
		if (!target) return;
		this.leftSplitObserver = new ResizeObserver((entries) => {
			this.updateLeftCollapsedClass(entries[0].contentRect.width);
		});
		this.leftSplitObserver.observe(target);
	}

	remove() {
		this.breadcrumb.unmount();
		if (this.leftSplitObserver) {
			this.leftSplitObserver.disconnect();
			this.leftSplitObserver = null;
		}
		if (this.layoutHandler) {
			this.app.workspace.off('layout-change', this.layoutHandler);
			this.layoutHandler = null;
		}
		// 还原 status-bar 到原始位置
		if (this.statusBarOriginalParent) {
			const statusBar = activeDocument.querySelector<HTMLElement>('.status-bar');
			if (statusBar) {
				if (this.statusBarOriginalNextSibling) {
					this.statusBarOriginalParent.insertBefore(statusBar, this.statusBarOriginalNextSibling);
				} else {
					this.statusBarOriginalParent.appendChild(statusBar);
				}
			}
			this.statusBarOriginalParent = null;
			this.statusBarOriginalNextSibling = null;
		}
		if (this.dragBar) {
			this.dragBar.remove();
			this.dragBar = null;
		}
	}
}
