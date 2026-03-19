import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
} from 'obsidian';

// ─── Settings ────────────────────────────────────────────────────────────────

export interface MinimalismUISettings {
	macSidebar: boolean;
	hideTabBar: boolean;
	hideNavButtons: boolean;
	disablePinTab: boolean;
}

const DEFAULT_SETTINGS: MinimalismUISettings = {
	macSidebar: false,
	hideTabBar: false,
	hideNavButtons: false,
	disablePinTab: true,
};

// ─── Main Plugin ──────────────────────────────────────────────────────────────

export default class MinimalismUIPlugin extends Plugin {
	settings: MinimalismUISettings;
	private pinBlockHandler: ((e: MouseEvent) => void) | null = null;
	private sidebarWrapper: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();
		this.applyBodyClasses();
		this.applyPinBlock();
		this.app.workspace.onLayoutReady(() => this.applySidebarWrapper());
		this.addSettingTab(new MinimalismUISettingTab(this.app, this));
	}

	onunload() {
		document.body.classList.remove(
			'minimalism-ui-mac-sidebar',
			'minimalism-ui-hide-tab-bar',
			'minimalism-ui-hide-nav-buttons',
			'minimalism-ui-disable-pin',
		);
		this.removePinBlockHandler();
		this.removeSidebarWrapper();
	}

	applyBodyClasses() {
		const cls = document.body.classList;
		cls.toggle('minimalism-ui-mac-sidebar', this.settings.macSidebar);
		cls.toggle('minimalism-ui-hide-tab-bar', this.settings.hideTabBar);
		cls.toggle('minimalism-ui-hide-nav-buttons', this.settings.hideNavButtons);
		cls.toggle('minimalism-ui-disable-pin', this.settings.disablePinTab);
	}

	applyPinBlock() {
		this.removePinBlockHandler();
		if (this.settings.disablePinTab) {
			this.pinBlockHandler = (e: MouseEvent) => {
				const target = e.target as Element;
				if (target.closest('.workspace-tab-header.tappable')) {
					e.stopImmediatePropagation();
					e.preventDefault();
				}
			};
			document.addEventListener('contextmenu', this.pinBlockHandler, true);
		}
	}

	private removePinBlockHandler() {
		if (this.pinBlockHandler) {
			document.removeEventListener('contextmenu', this.pinBlockHandler, true);
			this.pinBlockHandler = null;
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	applySidebarWrapper() {
		if (!this.settings.macSidebar) {
			this.removeSidebarWrapper();
			return;
		}
		if (this.sidebarWrapper?.isConnected) return;

		const sidebar = document.querySelector('.workspace-split.mod-left-split') as HTMLElement;
		if (!sidebar?.parentElement) return;

		const wrapper = document.createElement('div');
		wrapper.addClass('minimalism-ui-sidebar-wrapper');
		sidebar.parentElement.insertBefore(wrapper, sidebar);
		wrapper.appendChild(sidebar);
		this.sidebarWrapper = wrapper;
	}

	private removeSidebarWrapper() {
		if (!this.sidebarWrapper) return;
		const sidebar = this.sidebarWrapper.firstElementChild as HTMLElement;
		if (sidebar && this.sidebarWrapper.parentElement) {
			this.sidebarWrapper.parentElement.insertBefore(sidebar, this.sidebarWrapper);
		}
		this.sidebarWrapper.remove();
		this.sidebarWrapper = null;
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.applyBodyClasses();
		this.applyPinBlock();
		this.applySidebarWrapper();
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
			.setName('隐藏属性Tab二级操作栏')
			.setDesc('隐藏左侧任意属性栏(包括Files,Tags等)的二级操作图标按钮')
			.addToggle(t => t
				.setValue(this.plugin.settings.hideNavButtons)
				.onChange(async v => { this.plugin.settings.hideNavButtons = v; await this.plugin.saveSettings(); }));

		containerEl.createEl('h3', { text: '交互设置' });

		new Setting(containerEl)
			.setName('禁用 Pin 标签页功能')
			.setDesc('开启后，点击标签页时不再触发 Pin（固定）功能，并隐藏 Pin 图标')
			.addToggle(t => t
				.setValue(this.plugin.settings.disablePinTab)
				.onChange(async v => { this.plugin.settings.disablePinTab = v; await this.plugin.saveSettings(); }));

	}
}
