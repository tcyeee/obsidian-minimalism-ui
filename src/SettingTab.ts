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
			.setDesc('修改笔记部分主题样式')
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

		new Setting(containerEl)
			.setName('页面缓存')
			.setDesc('极简导航栏开启时，在内存中保留最近访问的 10 个页面，返回已访问页面时无需重新加载')
			.addToggle(t => t
				.setValue(this.plugin.settings.enableLeafCache)
				.onChange(async v => {
					this.plugin.settings.enableLeafCache = v;
					await this.plugin.saveSettings();
				}));
	}
}
