import { App, TAbstractFile, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from './settings';
import { LeafNameUtils } from './utils';

type WorkspaceSplitInternal = { containerEl: HTMLElement };
type LeafWithFile = WorkspaceLeaf & { view?: { file?: { basename: string } } };

const COMPACT_THRESHOLD = 15;
const ROW1_HEIGHT = 35;
const BREADCRUMB_HEIGHT = 20;

export class DragBarManager {
	private dragBar: HTMLElement | null = null;
	private titleHandler: (() => void) | null = null;
	private countHandler: (() => void) | null = null;
	private breadcrumbHandler: (() => void) | null = null;
	private layoutHandler: (() => void) | null = null;
	private renameHandler: ((file: TAbstractFile) => void) | null = null;
	private statusBarOriginalParent: HTMLElement | null = null;
	private statusBarOriginalNextSibling: Element | null = null;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		private navHistoryGetter: () => WorkspaceLeaf[] = () => []
	) {}

	apply() {
		this.remove();
		if (!this.getSettings().disableNoteTabs) return;

		const rootEl = (this.app.workspace.rootSplit as unknown as WorkspaceSplitInternal).containerEl;
		const tabsEl = rootEl.querySelector<HTMLElement>('.workspace-tabs');
		if (!tabsEl) return;

		// 创建拖拽区
		this.dragBar = document.createElement('div');
		this.dragBar.className = 'minimalism-ui-drag-bar';

		// Row 1: title + status bar
		const row1 = document.createElement('div');
		row1.className = 'minimalism-ui-drag-bar-row1';
		this.dragBar.appendChild(row1);

		const titleEl = document.createElement('span');
		titleEl.className = 'minimalism-ui-drag-bar-title';
		row1.appendChild(titleEl);

		const countEl = document.createElement('span');
		countEl.className = 'minimalism-ui-drag-bar-count';
		titleEl.appendChild(countEl);

		const textEl = document.createElement('span');
		titleEl.appendChild(textEl);

		// Row 2: breadcrumb
		const breadcrumbEl = document.createElement('div');
		breadcrumbEl.className = 'minimalism-ui-drag-bar-breadcrumb';
		breadcrumbEl.style.display = 'none';
		this.dragBar.appendChild(breadcrumbEl);

		tabsEl.insertBefore(this.dragBar, tabsEl.firstChild);

		// 更新标题
		const updateTitle = () => {
			const activeFile = this.app.workspace.getActiveFile();
			textEl.textContent = activeFile
				? LeafNameUtils.stripPrefix(activeFile.basename, this.getSettings().filenamePrefixLength)
				: '';
		};
		updateTitle();
		this.titleHandler = updateTitle;
		this.app.workspace.on('active-leaf-change', updateTitle);

		// 更新 tab 计数徽章
		const updateCount = () => {
			let count = 0;
			this.app.workspace.iterateRootLeaves(() => { count++; });
			countEl.textContent = String(count);
		};
		updateCount();
		this.countHandler = updateCount;
		this.app.workspace.on('active-leaf-change', updateCount);

		this.renameHandler = (file: TAbstractFile) => {
			if (file === this.app.workspace.getActiveFile()) updateTitle();
		};
		this.app.vault.on('rename', this.renameHandler);

		// 布局变化时重新插入拖拽区（关闭 Tab 时 Obsidian 会重建 DOM）
		this.layoutHandler = () => {
			if (!this.dragBar || this.dragBar.isConnected) return;
			const rootEl2 = (this.app.workspace.rootSplit as unknown as WorkspaceSplitInternal).containerEl;
			const tabsEl2 = rootEl2.querySelector<HTMLElement>('.workspace-tabs');
			if (tabsEl2) tabsEl2.insertBefore(this.dragBar, tabsEl2.firstChild);
			updateCount();
		};
		this.app.workspace.on('layout-change', this.layoutHandler);

		// 面包屑渲染辅助函数
		const renderAll = (el: HTMLElement, names: string[]) => {
			el.innerHTML = '';
			names.forEach((name, i) => {
				if (i > 0) {
					const sep = document.createElement('span');
					sep.className = 'minimalism-ui-breadcrumb-sep';
					sep.textContent = '/';
					el.appendChild(sep);
				}
				const item = document.createElement('span');
				item.className = i === names.length - 1
					? 'minimalism-ui-breadcrumb-item is-current'
					: 'minimalism-ui-breadcrumb-item';
				item.textContent = name;
				el.appendChild(item);
			});
		};

		const renderCompact = (el: HTMLElement, names: string[], collapsedCount: number) => {
			el.innerHTML = '';

			const first = document.createElement('span');
			first.className = 'minimalism-ui-breadcrumb-item';
			first.textContent = names[0];
			el.appendChild(first);

			const sep1 = document.createElement('span');
			sep1.className = 'minimalism-ui-breadcrumb-sep';
			sep1.textContent = '/';
			el.appendChild(sep1);

			const collapse = document.createElement('span');
			collapse.className = 'minimalism-ui-breadcrumb-collapse';
			collapse.textContent = `···${collapsedCount}···`;
			el.appendChild(collapse);

			const sep2 = document.createElement('span');
			sep2.className = 'minimalism-ui-breadcrumb-sep';
			sep2.textContent = '/';
			el.appendChild(sep2);

			const last = document.createElement('span');
			last.className = 'minimalism-ui-breadcrumb-item is-current';
			last.textContent = names[names.length - 1];
			el.appendChild(last);
		};

		const updateBreadcrumb = () => {
			if (!this.getSettings().showBreadcrumb) {
				breadcrumbEl.style.display = 'none';
				if (this.dragBar) this.dragBar.style.removeProperty('min-height');
				return;
			}
			const raw = this.navHistoryGetter();
			// 过滤已关闭（view.file 为 null）的 leaf，避免面包屑出现空槽
			const history = raw.filter(l => (l as LeafWithFile).view?.file != null);
			if (history.length <= 1) {
				breadcrumbEl.style.display = 'none';
				if (this.dragBar) this.dragBar.style.removeProperty('min-height');
				return;
			}
			breadcrumbEl.style.display = 'flex';
			if (this.dragBar) this.dragBar.style.setProperty('min-height', `${ROW1_HEIGHT + BREADCRUMB_HEIGHT}px`, 'important');
			const prefixLen = this.getSettings().filenamePrefixLength;
			const names = history.map(l =>
				LeafNameUtils.stripPrefix((l as LeafWithFile).view!.file!.basename, prefixLen)
			);

			if (history.length > COMPACT_THRESHOLD) {
				renderCompact(breadcrumbEl, names, names.length - 2);
				return;
			}

			renderAll(breadcrumbEl, names);
			requestAnimationFrame(() => {
				if (!breadcrumbEl.isConnected) return;
				if (breadcrumbEl.clientWidth === 0) return;
				if (breadcrumbEl.scrollWidth > breadcrumbEl.clientWidth && names.length > 2) {
					renderCompact(breadcrumbEl, names, names.length - 2);
				}
			});
		};
		updateBreadcrumb();
		this.breadcrumbHandler = updateBreadcrumb;
		this.app.workspace.on('active-leaf-change', updateBreadcrumb);

		// 将 status-bar 搬入 row1 右侧
		const statusBar = document.querySelector<HTMLElement>('.status-bar');
		if (statusBar) {
			this.statusBarOriginalParent = statusBar.parentElement;
			this.statusBarOriginalNextSibling = statusBar.nextElementSibling;
			row1.appendChild(statusBar);
		}
	}

	remove() {
		if (this.titleHandler) {
			this.app.workspace.off('active-leaf-change', this.titleHandler);
			this.titleHandler = null;
		}
		if (this.countHandler) {
			this.app.workspace.off('active-leaf-change', this.countHandler);
			this.countHandler = null;
		}
		if (this.breadcrumbHandler) {
			this.app.workspace.off('active-leaf-change', this.breadcrumbHandler);
			this.breadcrumbHandler = null;
		}
		if (this.renameHandler) {
			this.app.vault.off('rename', this.renameHandler);
			this.renameHandler = null;
		}
		if (this.layoutHandler) {
			this.app.workspace.off('layout-change', this.layoutHandler);
			this.layoutHandler = null;
		}
		// 还原 status-bar 到原始位置
		if (this.statusBarOriginalParent) {
			const statusBar = document.querySelector<HTMLElement>('.status-bar');
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
