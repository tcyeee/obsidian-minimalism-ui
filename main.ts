import {
	AbstractInputSuggest,
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	WorkspaceLeaf,
} from 'obsidian';

// ─── Settings ────────────────────────────────────────────────────────────────

export interface MinimalismUISettings {
	macSidebar: boolean;
	hideTabBar: boolean;
	disablePinTab: boolean;
	simplifyPanel: boolean;
	disableNoteTabs: boolean;
	noteStyle: boolean;
	homePage: string;
}

const DEFAULT_SETTINGS: MinimalismUISettings = {
	macSidebar: false,
	hideTabBar: false,
	disablePinTab: true,
	simplifyPanel: false,
	disableNoteTabs: false,
	noteStyle: false,
	homePage: '',
};

// ─── File Suggester ───────────────────────────────────────────────────────────

class FileSuggest extends AbstractInputSuggest<TFile> {
	private onPickCb: ((path: string) => void) | null = null;

	onPick(cb: (path: string) => void): this {
		this.onPickCb = cb;
		return this;
	}

	getSuggestions(query: string): TFile[] {
		return this.app.vault.getMarkdownFiles()
			.filter(f => f.path.toLowerCase().includes(query.toLowerCase()))
			.slice(0, 20);
	}

	renderSuggestion(file: TFile, el: HTMLElement) {
		el.setText(file.path);
	}

	selectSuggestion(file: TFile) {
		this.setValue(file.path);
		this.onPickCb?.(file.path);
		this.close();
	}
}

// ─── Main Plugin ──────────────────────────────────────────────────────────────

export default class MinimalismUIPlugin extends Plugin {
	settings: MinimalismUISettings;
	private pinBlockHandler: ((e: MouseEvent) => void) | null = null;
	private detachPatches = new Map<WorkspaceLeaf, () => void>();
	private tabLimitHandler: (() => void) | null = null;
	private dragBar: HTMLElement | null = null;
	private dragBarTitleHandler: (() => void) | null = null;
	private dragBarLayoutHandler: (() => void) | null = null;
	private statusBarOriginalParent: HTMLElement | null = null;
	private statusBarOriginalNextSibling: Element | null = null;
	private homePageHandler: ((file: TFile | null) => void) | null = null;
	private isOpeningHomePage = false;

	async onload() {
		await this.loadSettings();
		this.applyBodyClasses();
		this.applyPinBlock();
		this.applyTabLimit();
		this.app.workspace.onLayoutReady(() => {
			this.applyDragBar();
			this.applyHomePage();
			this.openHomePage();
		});
		this.addSettingTab(new MinimalismUISettingTab(this.app, this));
	}

	onunload() {
		document.body.classList.remove(
			'minimalism-ui-mac-sidebar',
			'minimalism-ui-hide-tab-bar',
			'minimalism-ui-disable-pin',
			'minimalism-ui-simplify-panel',
			'minimalism-ui-disable-note-tabs',
			'minimalism-ui-note-style',
		);
		this.removePinBlockHandler();
		this.removeTabLimitHandler();
		this.removeDragBar();
		this.removeHomePageHandler();
	}

	applyBodyClasses() {
		const cls = document.body.classList;
		cls.toggle('minimalism-ui-mac-sidebar', this.settings.macSidebar);
		cls.toggle('minimalism-ui-hide-tab-bar', this.settings.hideTabBar);
		cls.toggle('minimalism-ui-disable-pin', this.settings.disablePinTab);
		cls.toggle('minimalism-ui-simplify-panel', this.settings.simplifyPanel);
		cls.toggle('minimalism-ui-disable-note-tabs', this.settings.disableNoteTabs);
		cls.toggle('minimalism-ui-note-style', this.settings.noteStyle);
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

		// 布局变化时重新插入拖拽区（关闭 Tab 时 Obsidian 会重建 DOM）
		this.dragBarLayoutHandler = () => {
			if (!this.dragBar || this.dragBar.isConnected) return;
			const rootEl2 = (this.app.workspace.rootSplit as any).containerEl as HTMLElement;
			const tabsEl2 = rootEl2.querySelector('.workspace-tabs') as HTMLElement | null;
			if (tabsEl2) tabsEl2.insertBefore(this.dragBar, tabsEl2.firstChild);
		};
		this.app.workspace.on('layout-change', this.dragBarLayoutHandler);

		// 将 status-bar 搬入拖拽区右侧
		const statusBar = document.querySelector('.status-bar') as HTMLElement | null;
		if (statusBar) {
			this.statusBarOriginalParent = statusBar.parentElement;
			this.statusBarOriginalNextSibling = statusBar.nextElementSibling;
			this.dragBar.appendChild(statusBar);
		}
	}

	applyHomePage() {
		this.removeHomePageHandler();
		if (!this.settings.homePage) return;

		this.homePageHandler = (file: TFile | null) => {
			if (!file) this.openHomePage();
		};
		this.app.workspace.on('file-open', this.homePageHandler);
	}

	async openHomePage() {
		if (this.isOpeningHomePage) return;
		const path = this.settings.homePage;
		if (!path) return;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		this.isOpeningHomePage = true;
		try {
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file);
		} finally {
			this.isOpeningHomePage = false;
		}
	}

	private removeDragBar() {
		if (this.dragBarTitleHandler) {
			this.app.workspace.off('active-leaf-change', this.dragBarTitleHandler);
			this.dragBarTitleHandler = null;
		}
		if (this.dragBarLayoutHandler) {
			this.app.workspace.off('layout-change', this.dragBarLayoutHandler);
			this.dragBarLayoutHandler = null;
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

	private removeHomePageHandler() {
		if (this.homePageHandler) {
			this.app.workspace.off('file-open', this.homePageHandler);
			this.homePageHandler = null;
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
		this.applyHomePage();
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
			.setName('极简侧边栏')
			.setDesc('为左侧边栏应用磨砂玻璃背景、圆角高亮等 Finder 视觉效果')
			.addToggle(t => t
				.setValue(this.plugin.settings.macSidebar)
				.onChange(async v => { this.plugin.settings.macSidebar = v; await this.plugin.saveSettings(); }));

		new Setting(containerEl)
			.setName('极简导航栏')
			.setDesc('隐藏笔记区域顶部的标签栏，限制同时只能打开一个笔记，并禁用 Pin 功能')
			.addToggle(t => t
				.setValue(this.plugin.settings.disableNoteTabs)
				.onChange(async v => {
					this.plugin.settings.disableNoteTabs = v;
					this.plugin.settings.disablePinTab = v;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('极简信息栏')
			.setDesc('隐藏左侧属性栏的操作按钮，以及 Outline、Backlinks 面板中的搜索框')
			.addToggle(t => t
				.setValue(this.plugin.settings.hideTabBar)
				.onChange(async v => {
					this.plugin.settings.hideTabBar = v;
					this.plugin.settings.simplifyPanel = v;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('笔记样式')
			.setDesc('为笔记正文应用 Forest 主题字体（思源黑体 + JetBrains Mono），行高 1.6')
			.addToggle(t => t
				.setValue(this.plugin.settings.noteStyle)
				.onChange(async v => { this.plugin.settings.noteStyle = v; await this.plugin.saveSettings(); }));

		containerEl.createEl('h3', { text: '交互设置' });

		new Setting(containerEl)
			.setName('笔记首页')
			.setDesc('设置一个笔记作为首页。Obsidian 启动时自动打开，关闭所有标签后自动返回。')
			.addText(text => {
				text.setPlaceholder('输入笔记路径，例如：src/Home.md')
					.setValue(this.plugin.settings.homePage);
				new FileSuggest(this.app, text.inputEl).onPick(async path => {
					this.plugin.settings.homePage = path;
					await this.plugin.saveSettings();
				});
				text.inputEl.addEventListener('change', async () => {
					this.plugin.settings.homePage = text.inputEl.value.trim();
					await this.plugin.saveSettings();
				});
			});

	}
}
