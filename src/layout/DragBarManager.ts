import { App } from 'obsidian';
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

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		navHistoryGetter: () => string[] = () => [],
	) {
		this.breadcrumb = new BreadcrumbRenderer(app, getSettings, navHistoryGetter);
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

		// 布局变化时重新插入拖拽区（关闭 Tab 时 Obsidian 会重建 DOM）
		this.layoutHandler = () => {
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

	remove() {
		this.breadcrumb.unmount();
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
