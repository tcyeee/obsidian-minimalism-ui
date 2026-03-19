import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
} from 'obsidian';

// ─── Settings ────────────────────────────────────────────────────────────────

export interface MinimalismUISettings {
	macSidebar: boolean;
	hideTabBar: boolean;
	disablePinTab: boolean;
	simplifyPanel: boolean;
	disableNoteTabs: boolean;
}

const DEFAULT_SETTINGS: MinimalismUISettings = {
	macSidebar: false,
	hideTabBar: false,
	disablePinTab: true,
	simplifyPanel: false,
	disableNoteTabs: false,
};

// ─── Main Plugin ──────────────────────────────────────────────────────────────

export default class MinimalismUIPlugin extends Plugin {
	settings: MinimalismUISettings;
	private pinBlockHandler: ((e: MouseEvent) => void) | null = null;
	private detachPatches = new Map<WorkspaceLeaf, () => void>();
	private tabLimitHandler: (() => void) | null = null;
	private dragBar: HTMLElement | null = null;
	private dragBarTitleHandler: (() => void) | null = null;
	private statusBarOriginalParent: HTMLElement | null = null;
	private statusBarOriginalNextSibling: Element | null = null;

	async onload() {
		await this.loadSettings();
		this.applyBodyClasses();
		this.applyPinBlock();
		this.applyTabLimit();
		this.app.workspace.onLayoutReady(() => this.applyDragBar());
		this.addSettingTab(new MinimalismUISettingTab(this.app, this));
	}

	onunload() {
		document.body.classList.remove(
			'minimalism-ui-mac-sidebar',
			'minimalism-ui-hide-tab-bar',
			'minimalism-ui-disable-pin',
			'minimalism-ui-simplify-panel',
			'minimalism-ui-disable-note-tabs',
		);
		this.removePinBlockHandler();
		this.removeTabLimitHandler();
		this.removeDragBar();
	}

	applyBodyClasses() {
		const cls = document.body.classList;
		cls.toggle('minimalism-ui-mac-sidebar', this.settings.macSidebar);
		cls.toggle('minimalism-ui-hide-tab-bar', this.settings.hideTabBar);
		cls.toggle('minimalism-ui-disable-pin', this.settings.disablePinTab);
		cls.toggle('minimalism-ui-simplify-panel', this.settings.simplifyPanel);
		cls.toggle('minimalism-ui-disable-note-tabs', this.settings.disableNoteTabs);
	}

	applyPinBlock() {
		this.removePinBlockHandler();
		if (!this.settings.disablePinTab) return;

		// 拦截右键菜单，防止 pin 操作
		this.pinBlockHandler = (e: MouseEvent) => {
			if ((e.target as Element).closest('.workspace-tab-header.tappable')) {
				e.stopImmediatePropagation();
				e.preventDefault();
			}
		};
		document.addEventListener('contextmenu', this.pinBlockHandler, true);

		// patch 每个侧边栏 leaf 的 detach()，阻止任何路径关闭它们
		this.patchSidebarLeafDetach();
	}

	applyTabLimit() {
		this.removeTabLimitHandler();
		if (!this.settings.disableNoteTabs) return;

		this.tabLimitHandler = () => {
			const rootLeaves: WorkspaceLeaf[] = [];
			this.app.workspace.iterateRootLeaves((leaf: WorkspaceLeaf) => {
				rootLeaves.push(leaf);
			});
			if (rootLeaves.length <= 1) return;
			const active = this.app.workspace.activeLeaf;
			for (const leaf of rootLeaves) {
				if (leaf !== active) leaf.detach();
			}
		};
		this.app.workspace.on('layout-change', this.tabLimitHandler);
	}

	applyDragBar() {
		this.removeDragBar();
		if (!this.settings.disableNoteTabs) return;

		const rootEl = (this.app.workspace.rootSplit as any).containerEl as HTMLElement;
		const tabsEl = rootEl.querySelector('.workspace-tabs') as HTMLElement | null;
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

		this.dragBarTitleHandler = updateTitle;
		this.app.workspace.on('active-leaf-change', updateTitle);

		// 将 status-bar 搬入拖拽区右侧
		const statusBar = document.querySelector('.status-bar') as HTMLElement | null;
		if (statusBar) {
			this.statusBarOriginalParent = statusBar.parentElement;
			this.statusBarOriginalNextSibling = statusBar.nextElementSibling;
			this.dragBar.appendChild(statusBar);
		}
	}

	private removeDragBar() {
		if (this.dragBarTitleHandler) {
			this.app.workspace.off('active-leaf-change', this.dragBarTitleHandler);
			this.dragBarTitleHandler = null;
		}
		// 还原 status-bar 到原始位置
		if (this.statusBarOriginalParent) {
			const statusBar = document.querySelector('.status-bar') as HTMLElement | null;
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

	private removeTabLimitHandler() {
		if (this.tabLimitHandler) {
			this.app.workspace.off('layout-change', this.tabLimitHandler);
			this.tabLimitHandler = null;
		}
	}

	private patchSidebarLeafDetach() {
		this.app.workspace.iterateAllLeaves(leaf => {
			if (this.detachPatches.has(leaf)) return;
			const leafEl = (leaf as any).containerEl as HTMLElement | undefined;
			if (!leafEl?.closest('.workspace-split.mod-left-split')) return;
			const original = (leaf as any).detach.bind(leaf);
			(leaf as any).detach = () => { /* blocked */ };
			this.detachPatches.set(leaf, original);
		});
	}

	private removePinBlockHandler() {
		if (this.pinBlockHandler) {
			document.removeEventListener('contextmenu', this.pinBlockHandler, true);
			this.pinBlockHandler = null;
		}
		for (const [leaf, original] of this.detachPatches) {
			(leaf as any).detach = original;
		}
		this.detachPatches.clear();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.applyBodyClasses();
		this.applyPinBlock();
		this.applyTabLimit();
		this.applyDragBar();
	}
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

class MinimalismUISettingTab extends PluginSettingTab {
	plugin: MinimalismUIPlugin;

	constructor(app: App, plugin: MinimalismUIPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h3', { text: '外观设置' });

		new Setting(containerEl)
			.setName('侧边栏美化')
			.setDesc('为左侧边栏应用磨砂玻璃背景、圆角高亮等 Finder 视觉效果')
			.addToggle(t => t
				.setValue(this.plugin.settings.macSidebar)
				.onChange(async v => { this.plugin.settings.macSidebar = v; await this.plugin.saveSettings(); }));

		new Setting(containerEl)
			.setName('隐藏属性Tab一级操作栏')
			.setDesc('隐藏左侧任意属性栏(包括Files,Tags等)的标签栏操作图片按钮')
			.addToggle(t => t
				.setValue(this.plugin.settings.hideTabBar)
				.onChange(async v => { this.plugin.settings.hideTabBar = v; await this.plugin.saveSettings(); }));

		new Setting(containerEl)
			.setName('简化信息面板')
			.setDesc('隐藏左侧属性栏的二级操作按钮，以及 Outline、Backlinks 面板中的搜索框')
			.addToggle(t => t
				.setValue(this.plugin.settings.simplifyPanel)
				.onChange(async v => { this.plugin.settings.simplifyPanel = v; await this.plugin.saveSettings(); }));

		containerEl.createEl('h3', { text: '交互设置' });

		new Setting(containerEl)
			.setName('禁用笔记 Tab')
			.setDesc('隐藏笔记区域顶部的标签栏，并限制同时只能打开一个笔记')
			.addToggle(t => t
				.setValue(this.plugin.settings.disableNoteTabs)
				.onChange(async v => { this.plugin.settings.disableNoteTabs = v; await this.plugin.saveSettings(); }));

		new Setting(containerEl)
			.setName('禁用 Pin 标签页功能')
			.setDesc('开启后，点击标签页时不再触发 Pin（固定）功能，并隐藏 Pin 图标')
			.addToggle(t => t
				.setValue(this.plugin.settings.disablePinTab)
				.onChange(async v => { this.plugin.settings.disablePinTab = v; await this.plugin.saveSettings(); }));

	}
}
