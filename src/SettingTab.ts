import { AbstractInputSuggest, App, PluginSettingTab, Setting, SettingDefinitionItem, SettingGroupItem, TFile } from 'obsidian';
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

	private isCollapsed(key: string): boolean {
		return this.plugin.settings.collapsedSections[key] ?? false;
	}

	// 可折叠分组标题：点击只切换 collapsedSections[key] + refreshDomState()，
	// 不做整体重渲染——分组内容的显隐交给下面 group 定义的 visible 谓词。
	private renderSectionHeading(key: string, title: string) {
		return (setting: Setting): void => {
			const headingEl = setting.settingEl;
			headingEl.empty();
			headingEl.className = 'setting-item setting-item-heading minimalism-ui-collapsible-heading'
				+ (this.isCollapsed(key) ? ' minimalism-ui-collapsible-heading-collapsed' : '');
			const nameEl = headingEl.createDiv({ cls: 'setting-item-info' })
				.createDiv({ cls: 'setting-item-name' });
			nameEl.createSpan({ cls: 'minimalism-ui-section-arrow' });
			nameEl.createSpan({ text: title });

			headingEl.addEventListener('click', () => {
				const nowCollapsed = !this.isCollapsed(key);
				this.plugin.settings.collapsedSections[key] = nowCollapsed;
				headingEl.toggleClass('minimalism-ui-collapsible-heading-collapsed', nowCollapsed);
				void this.plugin.saveSettings();
				this.refreshDomState();
			});
		};
	}

	private section(key: string, title: string, items: SettingGroupItem[]): SettingDefinitionItem[] {
		return [
			{ name: title, searchable: false, render: this.renderSectionHeading(key, title) },
			{ type: 'group', visible: () => !this.isCollapsed(key), items },
		];
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: t('introTitle'),
				searchable: false,
				render: (setting) => {
					const el = setting.settingEl;
					el.empty();
					el.className = 'minimalism-ui-intro';
					el.createDiv({ cls: 'minimalism-ui-intro-title', text: t('introTitle') });
					el.createEl('p', { text: t('introDesc1') });
					el.createEl('p', { text: t('introDesc2') });
				},
			},

			...this.section('general', t('headingGeneral'), [
				{
					name: t('language'),
					render: (setting) => {
						setting.addDropdown(drop => drop
							.addOption('auto', t('languageAuto'))
							.addOption('zh', t('languageZh'))
							.addOption('en', t('languageEn'))
							.setValue(this.plugin.settings.language)
							.onChange(async (v: 'auto' | 'zh' | 'en') => {
								this.plugin.settings.language = v;
								setLang(v);
								await this.plugin.saveSettings();
								this.update();
							}));
					},
				},
				{
					name: t('theme'),
					render: (setting) => {
						setting.addDropdown(drop => {
							// 主题清单内嵌在 main.js 里，同步可得
							const names = this.plugin.listThemes();
							for (const name of names) drop.addOption(name, name);
							// 设置里残留了已不存在的主题名时，仍展示当前值，避免下拉框显示错位
							if (!names.includes(this.plugin.settings.theme)) {
								drop.addOption(this.plugin.settings.theme, this.plugin.settings.theme);
							}
							drop.setValue(this.plugin.settings.theme);
							drop.onChange(async v => {
								this.plugin.settings.theme = v;
								await this.plugin.saveSettings();
								await this.plugin.applyTheme();
							});
						});
					},
				},
			]),

			...this.section('interaction', t('headingInteraction'), [
				{
					name: t('singlePage'),
					render: (setting) => {
						setting.settingEl.addClass('minimalism-ui-single-page-setting');
						setting.addToggle(toggle => toggle
							.setValue(this.plugin.settings.disableNoteTabs)
							.onChange(async v => {
								this.plugin.settings.disableNoteTabs = v;
								await this.plugin.saveSettings();
							}));
						setting.descEl.createSpan({ text: t('singlePageDesc1') });
						setting.descEl.createEl('br');
						setting.descEl.createSpan({ text: t('singlePageDesc2') });
						setting.descEl.createEl('br');
						setting.descEl.createSpan({ text: t('singlePageDesc3') });
						setting.descEl.createEl('br');
						setting.descEl.createSpan({ text: t('singlePageDesc4') });
						setting.descEl.createEl('br');
					},
				},
				{
					name: t('homePage'),
					desc: t('homePageDesc'),
					render: (setting) => {
						setting.addText(text => {
							text.setPlaceholder(t('homePagePlaceholder'))
								.setValue(this.plugin.settings.homePage);
							// 仅在首页路径真正变化时收拢主区（关闭其余 tab + 面包屑只剩首页），
							// 避免点选了相同路径或重复触发 change 时白白关掉用户的标签。
							const applyHomePage = (value: string) => {
								const changed = this.plugin.settings.homePage !== value;
								this.plugin.settings.homePage = value;
								void this.plugin.saveSettings().then(() => {
									if (changed && value) void this.plugin.resetToHomePage();
								});
							};
							new FileSuggest(this.app, text.inputEl).onPick(path => applyHomePage(path));
							text.inputEl.addEventListener('change', () => applyHomePage(text.inputEl.value.trim()));
						});
					},
				},
			]),

			...this.section('appearance', t('headingAppearance'), [
				{
					name: t('hideTabBar'),
					render: (setting) => {
						setting.addToggle(toggle => toggle
							.setValue(this.plugin.settings.hideTabBar)
							.onChange(async v => {
								this.plugin.settings.hideTabBar = v;
								await this.plugin.saveSettings();
							}));
					},
				},
				{
					name: t('showProperties'),
					render: (setting) => {
						setting.addToggle(toggle => toggle
							.setValue(this.plugin.settings.showProperties)
							.onChange(async v => {
								this.plugin.settings.showProperties = v;
								await this.plugin.saveSettings();
								await this.plugin.applyMacSidebarLayout();
							}));
					},
				},
				{
					name: t('showLocalGraph'),
					render: (setting) => {
						setting.addToggle(toggle => toggle
							.setValue(this.plugin.settings.showLocalGraph)
							.onChange(async v => {
								this.plugin.settings.showLocalGraph = v;
								await this.plugin.saveSettings();
								await this.plugin.applyMacSidebarLayout();
							}));
					},
				},
				{
					name: t('showVaultProfile'),
					render: (setting) => {
						setting.addToggle(toggle => toggle
							.setValue(this.plugin.settings.showVaultProfile)
							.onChange(async v => {
								this.plugin.settings.showVaultProfile = v;
								await this.plugin.saveSettings();
							}));
					},
				},
				{
					name: t('showRightSidebarButton'),
					desc: t('showRightSidebarButtonDesc'),
					render: (setting) => {
						setting.addToggle(toggle => toggle
							.setValue(this.plugin.settings.showRightSidebarButton)
							.onChange(async v => {
								this.plugin.settings.showRightSidebarButton = v;
								await this.plugin.saveSettings();
							}));
					},
				},
			]),

			...this.section('animation', t('headingAnimation'), [
				{
					name: t('navAnimation'),
					desc: t('navAnimationDesc'),
					render: (setting) => {
						setting.addToggle(toggle => toggle
							.setValue(this.plugin.settings.enableNavAnimation)
							.onChange(async v => {
								this.plugin.settings.enableNavAnimation = v;
								await this.plugin.saveSettings();
							}));
					},
				},
			]),

			...this.section('advanced', t('headingAdvanced'), [
				{
					name: t('filenamePrefixManual'),
					desc: t('filenamePrefixManualDesc'),
					render: (setting) => {
						setting.addToggle(toggle => toggle
							.setValue(this.plugin.settings.filenamePrefixManual)
							.onChange(value => {
								this.plugin.settings.filenamePrefixManual = value;
								void this.plugin.saveSettings();
								// 仅需重估下面这一行的 visible 谓词，无需整体重渲染。
								this.refreshDomState();
							}));
					},
				},
				// 仅当手动隐藏开启时才显示长度设置。
				{
					name: t('filenamePrefixLength'),
					desc: t('filenamePrefixLengthDesc'),
					visible: () => this.plugin.settings.filenamePrefixManual,
					render: (setting) => {
						setting.addText(text => {
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
					},
				},
			]),
		];
	}
}
