import { AbstractInputSuggest, App, PluginSettingTab, Setting, TFile } from 'obsidian';
import type MinimalismUIPlugin from '../main';

// ─── File Suggester ───────────────────────────────────────────────────────────

export class FileSuggest extends AbstractInputSuggest<TFile> {
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

// ─── Settings Tab ─────────────────────────────────────────────────────────────

export class MinimalismUISettingTab extends PluginSettingTab {
	plugin: MinimalismUIPlugin;

	constructor(app: App, plugin: MinimalismUIPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl).setName('外观设置').setHeading();

		new Setting(containerEl)
			.setName('极简侧边栏')
			.setDesc('为左侧边栏应用磨砂玻璃背景与圆角高亮，打造 macOS 原生风格')
			.addToggle(t => t
				.setValue(this.plugin.settings.macSidebar)
				.onChange(async v => { this.plugin.settings.macSidebar = v; await this.plugin.saveSettings(); }));

		new Setting(containerEl)
			.setName('极简信息栏')
			.setDesc('隐藏左侧属性栏的操作按钮，以及大纲、反向链接面板中的搜索框')
			.addToggle(t => t
				.setValue(this.plugin.settings.hideTabBar)
				.onChange(async v => {
					this.plugin.settings.hideTabBar = v;
					this.plugin.settings.simplifyPanel = v;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('极简属性栏')
			.setDesc('开启后，Properties 面板高度随笔记属性数量自动伸缩，切换笔记时平滑过渡（需同时开启极简侧边栏）')
			.addToggle(t => t
				.setValue(this.plugin.settings.autoPropertiesHeight)
				.onChange(async v => { this.plugin.settings.autoPropertiesHeight = v; await this.plugin.saveSettings(); }));

		new Setting(containerEl)
			.setName('笔记样式优化')
			.setDesc('修改笔记部分主题样式')
			.addToggle(t => t
				.setValue(this.plugin.settings.noteStyle)
				.onChange(async v => { this.plugin.settings.noteStyle = v; await this.plugin.saveSettings(); }));

		new Setting(containerEl).setName('交互设置').setHeading();

		new Setting(containerEl)
			.setName('笔记首页')
			.setDesc('设置一个笔记作为首页。Obsidian 启动时自动打开，关闭所有标签后自动返回。')
			.addText(text => {
				text.setPlaceholder('输入笔记路径，例如：src/Home.md')
					.setValue(this.plugin.settings.homePage);
				new FileSuggest(this.app, text.inputEl).onPick(path => {
					this.plugin.settings.homePage = path;
					void this.plugin.saveSettings();
				});
				text.inputEl.addEventListener('change', () => {
					this.plugin.settings.homePage = text.inputEl.value.trim();
					void this.plugin.saveSettings();
				});
			});

		const singlePageSetting = new Setting(containerEl)
			.setName('单页模式');
		singlePageSetting.settingEl.addClass('minimalism-ui-single-page-setting');
		singlePageSetting.addToggle(t => t
			.setValue(this.plugin.settings.disableNoteTabs)
			.onChange(async v => {
				this.plugin.settings.disableNoteTabs = v;
				this.plugin.settings.disablePinTab = v;
				this.plugin.settings.enableLeafCache = v;
				await this.plugin.saveSettings();
			}));
		singlePageSetting.descEl.createEl('span', { text: '1.隐藏顶部标签栏，每次只展示一篇笔记。' });
		singlePageSetting.descEl.createEl('br');
		singlePageSetting.descEl.createEl('span', { text: '2.启用页面缓存，在内存中保留最近访问的 10 个页面' });
		singlePageSetting.descEl.createEl('br');
		singlePageSetting.descEl.createEl('span', { text: '3.禁用 pin 标签功能，避免多余的标签被固定在顶部。' });
		singlePageSetting.descEl.createEl('br');

		new Setting(containerEl)
			.setName('页面加载动画 (beta)')
			.setDesc('前进或后退时，为目标页面播放滑入动画')
			.addToggle(t => t
				.setValue(this.plugin.settings.enableNavAnimation)
				.onChange(async v => {
					this.plugin.settings.enableNavAnimation = v;
					await this.plugin.saveSettings();
				}));
	}
}
