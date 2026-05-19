import { App, TAbstractFile, TFile } from 'obsidian';
import { MinimalismUISettings } from './settings';
import { LeafNameUtils } from './utils';

type WorkspaceSplitInternal = { containerEl: HTMLElement };

const COMPACT_THRESHOLD = 15;

export class DragBarManager {
	private dragBar: HTMLElement | null = null;
	private countHandler: (() => void) | null = null;
	private breadcrumbHandler: (() => void) | null = null;
	private layoutHandler: (() => void) | null = null;
	private renameHandler: ((file: TAbstractFile) => void) | null = null;
	private statusBarOriginalParent: HTMLElement | null = null;
	private statusBarOriginalNextSibling: Element | null = null;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		private navHistoryGetter: () => string[] = () => []
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

		// Breadcrumb replaces filename text, lives inline inside titleEl
		const breadcrumbEl = document.createElement('div');
		breadcrumbEl.className = 'minimalism-ui-drag-bar-breadcrumb';
		titleEl.appendChild(breadcrumbEl);

		tabsEl.insertBefore(this.dragBar, tabsEl.firstChild);

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
			if (file === this.app.workspace.getActiveFile()) updateBreadcrumb();
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

		const showSingleFile = () => {
			breadcrumbEl.innerHTML = '';
			const activeFile = this.app.workspace.getActiveFile();
			if (!activeFile) return;
			const item = document.createElement('span');
			item.className = 'minimalism-ui-breadcrumb-item is-current';
			item.textContent = LeafNameUtils.stripPrefix(activeFile.basename, this.getSettings().filenamePrefixLength);
			breadcrumbEl.appendChild(item);
		};

		const updateBreadcrumb = () => {
			const prefixLen = this.getSettings().filenamePrefixLength;
			if (!this.getSettings().showBreadcrumb) {
				showSingleFile();
				return;
			}
			const paths = this.navHistoryGetter();
			if (paths.length <= 1) {
				showSingleFile();
				return;
			}
			// 路径是稳定字符串，直接从 vault 查文件名，无需过滤关闭的 leaf
			const names = paths.map(p => {
				const f = this.app.vault.getAbstractFileByPath(p);
				return f instanceof TFile
					? LeafNameUtils.stripPrefix(f.basename, prefixLen)
					: LeafNameUtils.stripPrefix(p, prefixLen);
			});

			if (paths.length > COMPACT_THRESHOLD) {
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
