import { AbstractInputSuggest, App, PluginSettingTab, Setting, TFile } from 'obsidian';
import type MinimalismUIPlugin from '../main';
import { t } from './i18n';

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
		new Setting(containerEl).setName(t('headingAppearance')).setHeading();

		new Setting(containerEl)
			.setName(t('macSidebar'))
			.setDesc(t('macSidebarDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.macSidebar)
				.onChange(async v => {
					this.plugin.settings.macSidebar = v;
					await this.plugin.saveSettings();
					this.plugin.applyBodyClasses();
					await this.plugin.applyMacSidebarLayout();
				}));

		new Setting(containerEl)
			.setName(t('hideTabBar'))
			.setDesc(t('hideTabBarDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.hideTabBar)
				.onChange(async v => {
					this.plugin.settings.hideTabBar = v;
					this.plugin.settings.simplifyPanel = v;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('noteStyle'))
			.setDesc(t('noteStyleDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.noteStyle)
				.onChange(async v => { this.plugin.settings.noteStyle = v; await this.plugin.saveSettings(); }));

		new Setting(containerEl).setName(t('headingInteraction')).setHeading();

		new Setting(containerEl)
			.setName(t('homePage'))
			.setDesc(t('homePageDesc'))
			.addText(text => {
				text.setPlaceholder(t('homePagePlaceholder'))
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
			.setName(t('singlePage'));
		singlePageSetting.settingEl.addClass('minimalism-ui-single-page-setting');
		singlePageSetting.addToggle(toggle => toggle
			.setValue(this.plugin.settings.disableNoteTabs)
			.onChange(async v => {
				this.plugin.settings.disableNoteTabs = v;
				this.plugin.settings.disablePinTab = v;
				this.plugin.settings.enableLeafCache = v;
				await this.plugin.saveSettings();
			}));
		singlePageSetting.descEl.createEl('span', { text: t('singlePageDesc1') });
		singlePageSetting.descEl.createEl('br');
		singlePageSetting.descEl.createEl('span', { text: t('singlePageDesc2') });
		singlePageSetting.descEl.createEl('br');
		singlePageSetting.descEl.createEl('span', { text: t('singlePageDesc3') });
		singlePageSetting.descEl.createEl('br');

		new Setting(containerEl)
			.setName(t('navAnimation'))
			.setDesc(t('navAnimationDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableNavAnimation)
				.onChange(async v => {
					this.plugin.settings.enableNavAnimation = v;
					await this.plugin.saveSettings();
				}));
	}
}
