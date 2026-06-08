import { AbstractInputSuggest, App, PluginSettingTab, Setting, TFile } from 'obsidian';
import type MinimalismUIPlugin from '../main';
import { t, setLang } from './core/i18n';

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

		const intro = containerEl.createDiv({ cls: 'minimalism-ui-intro' });
		intro.createDiv({ cls: 'minimalism-ui-intro-title', text: t('introTitle') });
		intro.createEl('p', { text: t('introDesc1') });
		intro.createEl('p', { text: t('introDesc2') });
		intro.createEl('p', { text: t('introDesc3') });

		new Setting(containerEl).setName(t('headingGeneral')).setHeading();

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

		new Setting(containerEl)
			.setName(t('theme'))
			.addDropdown(drop => {
				// 先放入当前值，避免异步列目录完成前下拉框为空
				drop.addOption(this.plugin.settings.theme, this.plugin.settings.theme);
				drop.setValue(this.plugin.settings.theme);
				drop.onChange(async v => {
					this.plugin.settings.theme = v;
					await this.plugin.saveSettings();
					await this.plugin.applyTheme();
				});
				// 异步补全 theme/ 目录下的其他主题
				void this.plugin.listThemes().then(names => {
					for (const name of names) {
						if (name !== this.plugin.settings.theme) drop.addOption(name, name);
					}
					drop.setValue(this.plugin.settings.theme);
				});
			});

		new Setting(containerEl).setName(t('headingAppearance')).setHeading();

		new Setting(containerEl)
			.setName(t('hideTabBar'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.hideTabBar)
				.onChange(async v => {
					this.plugin.settings.hideTabBar = v;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('showProperties'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showProperties)
				.onChange(async v => {
					this.plugin.settings.showProperties = v;
					await this.plugin.saveSettings();
					await this.plugin.applyMacSidebarLayout();
				}));

		new Setting(containerEl)
			.setName(t('showLocalGraph'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showLocalGraph)
				.onChange(async v => {
					this.plugin.settings.showLocalGraph = v;
					await this.plugin.saveSettings();
					await this.plugin.applyMacSidebarLayout();
				}));

		new Setting(containerEl)
			.setName(t('showVaultProfile'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showVaultProfile)
				.onChange(async v => {
					this.plugin.settings.showVaultProfile = v;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl).setName(t('headingInteraction')).setHeading();

		const singlePageSetting = new Setting(containerEl)
			.setName(t('singlePage'));
		singlePageSetting.settingEl.addClass('minimalism-ui-single-page-setting');
		singlePageSetting.addToggle(toggle => toggle
			.setValue(this.plugin.settings.disableNoteTabs)
			.onChange(async v => {
				this.plugin.settings.disableNoteTabs = v;
				await this.plugin.saveSettings();
			}));
		singlePageSetting.descEl.createSpan({ text: t('singlePageDesc1') });
		singlePageSetting.descEl.createEl('br');
		singlePageSetting.descEl.createSpan({ text: t('singlePageDesc2') });
		singlePageSetting.descEl.createEl('br');
		singlePageSetting.descEl.createSpan({ text: t('singlePageDesc3') });
		singlePageSetting.descEl.createEl('br');
		singlePageSetting.descEl.createSpan({ text: t('singlePageDesc4') });
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
			.setName(t('filenamePrefixLength'))
			.setDesc(t('filenamePrefixLengthDesc'))
			.addText(text => {
				text.inputEl.type = 'number';
				text.inputEl.min = '0';
				text.inputEl.max = '20';
				text.inputEl.addClass('minimalism-ui-prefix-input');
				text.setValue(String(this.plugin.settings.filenamePrefixLength));
				text.inputEl.addEventListener('change', () => {
					const raw = parseInt(text.inputEl.value, 10);
					const clamped = isNaN(raw) ? 0 : Math.min(20, Math.max(0, raw));
					text.setValue(String(clamped));
					this.plugin.settings.filenamePrefixLength = clamped;
					void this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).setName(t('headingAnimation')).setHeading();

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
