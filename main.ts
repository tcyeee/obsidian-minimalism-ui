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
}

const DEFAULT_SETTINGS: MinimalismUISettings = {
	enableMacStyle: true,
	hideTabBar: false,
	hideNavButtons: false,
};

// ─── Main Plugin ──────────────────────────────────────────────────────────────

export default class MinimalismUIPlugin extends Plugin {
	settings: MinimalismUISettings;

	async onload() {
		await this.loadSettings();
		this.applyBodyClasses();
		this.addSettingTab(new MinimalismUISettingTab(this.app, this));
	}

	onunload() {
		document.body.classList.remove(
			'minimalism-ui-mac-style',
			'minimalism-ui-hide-tab-bar',
			'minimalism-ui-hide-nav-buttons',
		);
	}

	applyBodyClasses() {
		const cls = document.body.classList;
		cls.toggle('minimalism-ui-mac-style', this.settings.enableMacStyle);
		cls.toggle('minimalism-ui-hide-tab-bar', this.settings.hideTabBar);
		cls.toggle('minimalism-ui-hide-nav-buttons', this.settings.hideNavButtons);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.applyBodyClasses();
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

	}
}
