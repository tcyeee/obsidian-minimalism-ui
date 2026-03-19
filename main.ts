import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
} from 'obsidian';

// ─── Settings ────────────────────────────────────────────────────────────────

export interface MinimalismUISettings {
	enableMacStyle: boolean;
	hideTabBar: boolean;
	hideNavButtons: boolean;
	enablePinTab: boolean;
}

const DEFAULT_SETTINGS: MinimalismUISettings = {
	enableMacStyle: true,
	hideTabBar: false,
	hideNavButtons: false,
	enablePinTab: false,
};

// ─── Main Plugin ──────────────────────────────────────────────────────────────

export default class MinimalismUIPlugin extends Plugin {
	settings: MinimalismUISettings;
	private pinBlockHandler: ((e: MouseEvent) => void) | null = null;

	async onload() {
		await this.loadSettings();
		this.applyBodyClasses();
		this.applyPinBlock();
		this.addSettingTab(new MinimalismUISettingTab(this.app, this));
	}

	onunload() {
		document.body.classList.remove(
			'minimalism-ui-mac-style',
			'minimalism-ui-hide-tab-bar',
			'minimalism-ui-hide-nav-buttons',
			'minimalism-ui-disable-pin',
		);
		this.removePinBlockHandler();
	}

	applyBodyClasses() {
		const cls = document.body.classList;
		cls.toggle('minimalism-ui-mac-style', this.settings.enableMacStyle);
		cls.toggle('minimalism-ui-hide-tab-bar', this.settings.hideTabBar);
		cls.toggle('minimalism-ui-hide-nav-buttons', this.settings.hideNavButtons);
		cls.toggle('minimalism-ui-disable-pin', !this.settings.enablePinTab);
	}

	applyPinBlock() {
		this.removePinBlockHandler();
		if (!this.settings.enablePinTab) {
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

	async saveSettings() {
		await this.saveData(this.settings);
		this.applyBodyClasses();
		this.applyPinBlock();
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

		containerEl.createEl('h2', { text: 'Minimalism UI' });
		containerEl.createEl('p', {
			text: '将 Obsidian 改造为类 macOS 原生应用风格。',
			cls: 'minimalism-ui-setting-desc',
		});

		containerEl.createEl('h3', { text: '外观设置' });

		new Setting(containerEl)
			.setName('macOS 原生风格')
			.setDesc('启用圆角、系统字体、毛玻璃等 macOS 视觉风格')
			.addToggle(t => t
				.setValue(this.plugin.settings.enableMacStyle)
				.onChange(async v => { this.plugin.settings.enableMacStyle = v; await this.plugin.saveSettings(); }));

		new Setting(containerEl)
			.setName('隐藏顶部标签栏')
			.setDesc('隐藏多标签页切换栏，界面更简洁')
			.addToggle(t => t
				.setValue(this.plugin.settings.hideTabBar)
				.onChange(async v => { this.plugin.settings.hideTabBar = v; await this.plugin.saveSettings(); }));

		new Setting(containerEl)
			.setName('隐藏文件区域导航按钮')
			.setDesc('隐藏左侧文件栏上方的图标按钮')
			.addToggle(t => t
				.setValue(this.plugin.settings.hideNavButtons)
				.onChange(async v => { this.plugin.settings.hideNavButtons = v; await this.plugin.saveSettings(); }));

		containerEl.createEl('h3', { text: '交互设置' });

		new Setting(containerEl)
			.setName('启用 Pin 标签页功能')
			.setDesc('关闭后，点击标签页时不再触发 Pin（固定）功能，并隐藏 Pin 图标')
			.addToggle(t => t
				.setValue(this.plugin.settings.enablePinTab)
				.onChange(async v => { this.plugin.settings.enablePinTab = v; await this.plugin.saveSettings(); }));

	}
}
