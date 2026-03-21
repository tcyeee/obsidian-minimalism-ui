import { App, TAbstractFile } from 'obsidian';
import { MinimalismUISettings } from './settings';

type WorkspaceSplitInternal = { containerEl: HTMLElement };

export class DragBarManager {
	private dragBar: HTMLElement | null = null;
	private titleHandler: (() => void) | null = null;
	private layoutHandler: (() => void) | null = null;
	private renameHandler: ((file: TAbstractFile) => void) | null = null;
	private statusBarOriginalParent: HTMLElement | null = null;
	private statusBarOriginalNextSibling: Element | null = null;

	constructor(private app: App, private getSettings: () => MinimalismUISettings) {}

	apply() {
		this.remove();
		if (!this.getSettings().disableNoteTabs) return;

		const rootEl = (this.app.workspace.rootSplit as unknown as WorkspaceSplitInternal).containerEl;
		const tabsEl = rootEl.querySelector<HTMLElement>('.workspace-tabs');
		if (!tabsEl) return;

		// 创建拖拽区
		this.dragBar = document.createElement('div');
		this.dragBar.className = 'minimalism-ui-drag-bar';

		const titleEl = document.createElement('span');
		titleEl.className = 'minimalism-ui-drag-bar-title';
		this.dragBar.appendChild(titleEl);

		tabsEl.insertBefore(this.dragBar, tabsEl.firstChild);

		// 更新标题
		const updateTitle = () => {
			const activeFile = this.app.workspace.getActiveFile();
			titleEl.textContent = activeFile ? activeFile.basename : '';
		};
		updateTitle();

		this.titleHandler = updateTitle;
		this.app.workspace.on('active-leaf-change', updateTitle);

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
		};
		this.app.workspace.on('layout-change', this.layoutHandler);

		// 将 status-bar 搬入拖拽区右侧
		const statusBar = document.querySelector<HTMLElement>('.status-bar');
		if (statusBar) {
			this.statusBarOriginalParent = statusBar.parentElement;
			this.statusBarOriginalNextSibling = statusBar.nextElementSibling;
			this.dragBar.appendChild(statusBar);
		}
	}

	remove() {
		if (this.titleHandler) {
			this.app.workspace.off('active-leaf-change', this.titleHandler);
			this.titleHandler = null;
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
