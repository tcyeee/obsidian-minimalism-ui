import { AbstractInputSuggest, App, PluginSettingTab, Setting, TFile } from 'obsidian';
import type MinimalismUIPlugin from '../main';
import { t, setLang } from './i18n';

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

		new Setting(containerEl)
			.setName(t('language'))
			.addDropdown(drop => drop
				.addOption('auto', t('languageAuto'))
				.addOption('zh', t('languageZh'))
				.addOption('en', t('languageEn'))
				.setValue(this.plugin.settings.language)
				.onChange(async (v: 'auto' | 'zh' | 'en') => {
					this.plugin.settings.language = v;
					setLang(v);
					await this.plugin.saveSettings();
					this.display();
				}));

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
					showPropertiesSetting.settingEl.toggle(v);
					showLocalGraphSetting.settingEl.toggle(v);
					await this.plugin.applyMacSidebarLayout();
				}));

		const showPropertiesSetting = new Setting(containerEl)
			.setName(t('showProperties'))
			.setDesc(t('showPropertiesDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showProperties)
				.onChange(async v => {
					this.plugin.settings.showProperties = v;
					await this.plugin.saveSettings();
					await this.plugin.applyMacSidebarLayout();
				}));
		showPropertiesSetting.settingEl.addClass('minimalism-ui-sub-setting');
		showPropertiesSetting.settingEl.toggle(this.plugin.settings.macSidebar);

		const showLocalGraphSetting = new Setting(containerEl)
			.setName(t('showLocalGraph'))
			.setDesc(t('showLocalGraphDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showLocalGraph)
				.onChange(async v => {
					this.plugin.settings.showLocalGraph = v;
					await this.plugin.saveSettings();
					await this.plugin.applyMacSidebarLayout();
				}));
		showLocalGraphSetting.settingEl.addClass('minimalism-ui-sub-setting');
		showLocalGraphSetting.settingEl.toggle(this.plugin.settings.macSidebar);

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

		const noteStyleSetting = new Setting(containerEl)
			.setName(t('noteStyle'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.noteStyle)
				.onChange(async v => { this.plugin.settings.noteStyle = v; await this.plugin.saveSettings(); }));
		noteStyleSetting.descEl.createEl('span', { text: t('noteStyleDesc') });
		const noteStyleList = noteStyleSetting.descEl.createEl('ul');
		noteStyleList.createEl('li', { text: t('noteStyleItem1') });
		noteStyleList.createEl('li', { text: t('noteStyleItem2') });
		noteStyleList.createEl('li', { text: t('noteStyleItem3') });

		new Setting(containerEl).setName(t('headingInteraction')).setHeading();

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

		new Setting(containerEl)
			.setName(t('navAnimation'))
			.setDesc(t('navAnimationDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableNavAnimation)
				.onChange(async v => {
					this.plugin.settings.enableNavAnimation = v;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('filenamePrefixLength'))
			.setDesc(t('filenamePrefixLengthDesc'))
			.addText(text => {
				text.inputEl.type = 'number';
				text.inputEl.min = '0';
				text.inputEl.max = '20';
				text.inputEl.style.width = '60px';
				text.setValue(String(this.plugin.settings.filenamePrefixLength));
				text.inputEl.addEventListener('change', async () => {
					const raw = parseInt(text.inputEl.value, 10);
					const clamped = isNaN(raw) ? 0 : Math.min(20, Math.max(0, raw));
					text.setValue(String(clamped));
					this.plugin.settings.filenamePrefixLength = clamped;
					await this.plugin.saveSettings();
				});
			});
	}
}
