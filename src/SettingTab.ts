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
//
// Two rendering paths share the same per-setting `configureX(setting)` methods
// below:
//   - display() — imperative fallback for Obsidian < 1.13. Deprecated, but it's
//     the only path older clients call, so it's kept fully working rather than
//     bumping minAppVersion — a prior attempt to migrate to
//     getSettingDefinitions() as the *only* path was reverted for exactly this
//     reason (cuts off pre-1.13 users for no functional gain).
//   - getSettingDefinitions() — declarative path for Obsidian >= 1.13, needed
//     for the plugin's settings to appear in Obsidian's settings search.
//
// Both paths keep the same custom collapsible-section widget: display() drives
// it with plain DOM (addCollapsibleSection), getSettingDefinitions() drives it
// with a `render`-type heading row + a sibling group's `visible` predicate
// (section()) — there's no native collapsible group in the declarative API.

export class MinimalismUISettingTab extends PluginSettingTab {
	plugin: MinimalismUIPlugin;

	constructor(app: App, plugin: MinimalismUIPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private isCollapsed(key: string): boolean {
		return this.plugin.settings.collapsedSections[key] ?? false;
	}

	private addCollapsibleSection(key: string, title: string): HTMLElement {
		const { containerEl } = this;

		const headingEl = containerEl.createDiv({
			cls: 'setting-item setting-item-heading minimalism-ui-collapsible-heading'
				+ (this.isCollapsed(key) ? ' minimalism-ui-collapsible-heading-collapsed' : ''),
		});
		const nameEl = headingEl.createDiv({ cls: 'setting-item-info' })
			.createDiv({ cls: 'setting-item-name' });
		nameEl.createSpan({ cls: 'minimalism-ui-section-arrow' });
		nameEl.createSpan({ text: title });

		const contentEl = containerEl.createDiv({ cls: 'minimalism-ui-collapsible-content' });

		headingEl.addEventListener('click', () => {
			const nowCollapsed = !this.isCollapsed(key);
			this.plugin.settings.collapsedSections[key] = nowCollapsed;
			headingEl.toggleClass('minimalism-ui-collapsible-heading-collapsed', nowCollapsed);
			void this.plugin.saveSettings();
		});

		return contentEl;
	}

	/** getSettingDefinitions()-only counterpart of addCollapsibleSection(): a
	 *  standalone heading row that toggles collapsedSections[key], followed by
	 *  a group whose `visible` predicate hides/shows its items. Only reachable
	 *  from the declarative path, so refreshDomState() (>= 1.13-only) is safe
	 *  to call unconditionally here. */
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

	/** Re-renders the tab after a change whose effect other rendered rows depend
	 *  on (a new language, since `name`/`desc` strings are evaluated once and
	 *  won't otherwise pick up the new language; or the prefix-length row's
	 *  visibility). `update()` only exists on Obsidian >= 1.13 (it re-invokes
	 *  getSettingDefinitions()); older runtimes fall back to re-running
	 *  display() directly, since this is reachable from both paths. */
	private refreshTab(): void {
		if (typeof this.update === 'function') {
			this.update();
		} else {
			this.display();
		}
	}

	// ── Shared per-setting configuration ──

	private configureLanguage(setting: Setting): void {
		setting.setName(t('language'))
			.addDropdown(drop => drop
				.addOption('auto', t('languageAuto'))
				.addOption('zh', t('languageZh'))
				.addOption('en', t('languageEn'))
				.setValue(this.plugin.settings.language)
				.onChange(async (v: 'auto' | 'zh' | 'en') => {
					this.plugin.settings.language = v;
					setLang(v);
					await this.plugin.saveSettings();
					this.refreshTab();
				}));
	}

	private configureTheme(setting: Setting): void {
		setting.setName(t('theme'))
			.addDropdown(drop => {
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
	}

	private configureSinglePage(setting: Setting): void {
		setting.setName(t('singlePage'));
		setting.settingEl.addClass('minimalism-ui-single-page-setting');
		setting.addToggle(toggle => toggle
			.setValue(this.plugin.settings.disableNoteTabs)
			.onChange(async v => {
				this.plugin.settings.disableNoteTabs = v;
				await this.plugin.saveSettings();
			}));
		setting.descEl.empty();
		setting.descEl.createSpan({ text: t('singlePageDesc1') });
		setting.descEl.createEl('br');
		setting.descEl.createSpan({ text: t('singlePageDesc2') });
		setting.descEl.createEl('br');
		setting.descEl.createSpan({ text: t('singlePageDesc3') });
		setting.descEl.createEl('br');
		setting.descEl.createSpan({ text: t('singlePageDesc4') });
		setting.descEl.createEl('br');
	}

	private configureHomePage(setting: Setting): void {
		setting.setName(t('homePage'))
			.setDesc(t('homePageDesc'))
			.addText(text => {
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
	}

	private configureHideTabBar(setting: Setting): void {
		setting.setName(t('hideTabBar'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.hideTabBar)
				.onChange(async v => {
					this.plugin.settings.hideTabBar = v;
					await this.plugin.saveSettings();
				}));
	}

	private configureShowProperties(setting: Setting): void {
		setting.setName(t('showProperties'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showProperties)
				.onChange(async v => {
					this.plugin.settings.showProperties = v;
					await this.plugin.saveSettings();
					await this.plugin.applyMacSidebarLayout();
				}));
	}

	private configureShowLocalGraph(setting: Setting): void {
		setting.setName(t('showLocalGraph'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showLocalGraph)
				.onChange(async v => {
					this.plugin.settings.showLocalGraph = v;
					await this.plugin.saveSettings();
					await this.plugin.applyMacSidebarLayout();
				}));
	}

	private configureShowVaultProfile(setting: Setting): void {
		setting.setName(t('showVaultProfile'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showVaultProfile)
				.onChange(async v => {
					this.plugin.settings.showVaultProfile = v;
					await this.plugin.saveSettings();
				}));
	}

	private configureShowRightSidebarButton(setting: Setting): void {
		setting.setName(t('showRightSidebarButton'))
			.setDesc(t('showRightSidebarButtonDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showRightSidebarButton)
				.onChange(async v => {
					this.plugin.settings.showRightSidebarButton = v;
					await this.plugin.saveSettings();
				}));
	}

	private configureNavAnimation(setting: Setting): void {
		setting.setName(t('navAnimation'))
			.setDesc(t('navAnimationDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableNavAnimation)
				.onChange(async v => {
					this.plugin.settings.enableNavAnimation = v;
					await this.plugin.saveSettings();
				}));
	}

	private configureFilenamePrefixManual(setting: Setting): void {
		setting.setName(t('filenamePrefixManual'))
			.setDesc(t('filenamePrefixManualDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.filenamePrefixManual)
				.onChange(value => {
					this.plugin.settings.filenamePrefixManual = value;
					void this.plugin.saveSettings();
					this.refreshTab(); // 重渲染以同步长度数字框的显隐
				}));
	}

	private configureFilenamePrefixLength(setting: Setting): void {
		setting.setName(t('filenamePrefixLength'))
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
	}

	// ── Imperative fallback (Obsidian < 1.13) ──

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const intro = containerEl.createDiv({ cls: 'minimalism-ui-intro' });
		intro.createDiv({ cls: 'minimalism-ui-intro-title', text: t('introTitle') });
		intro.createEl('p', { text: t('introDesc1') });
		intro.createEl('p', { text: t('introDesc2') });

		const generalEl = this.addCollapsibleSection('general', t('headingGeneral'));
		this.configureLanguage(new Setting(generalEl));
		this.configureTheme(new Setting(generalEl));

		const interactionEl = this.addCollapsibleSection('interaction', t('headingInteraction'));
		this.configureSinglePage(new Setting(interactionEl));
		this.configureHomePage(new Setting(interactionEl));

		const appearanceEl = this.addCollapsibleSection('appearance', t('headingAppearance'));
		this.configureHideTabBar(new Setting(appearanceEl));
		this.configureShowProperties(new Setting(appearanceEl));
		this.configureShowLocalGraph(new Setting(appearanceEl));
		this.configureShowVaultProfile(new Setting(appearanceEl));
		this.configureShowRightSidebarButton(new Setting(appearanceEl));

		const animationEl = this.addCollapsibleSection('animation', t('headingAnimation'));
		this.configureNavAnimation(new Setting(animationEl));

		const advancedEl = this.addCollapsibleSection('advanced', t('headingAdvanced'));
		this.configureFilenamePrefixManual(new Setting(advancedEl));

		// 仅当手动隐藏开启时才显示长度设置。
		if (this.plugin.settings.filenamePrefixManual) {
			this.configureFilenamePrefixLength(new Setting(advancedEl));
		}
	}

	// ── Declarative path (Obsidian >= 1.13) ──

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: t('introTitle'),
				searchable: false,
				render: setting => {
					setting.settingEl.addClass('minimalism-ui-intro-wrapper');
					const intro = setting.settingEl.createDiv({ cls: 'minimalism-ui-intro' });
					intro.createDiv({ cls: 'minimalism-ui-intro-title', text: t('introTitle') });
					intro.createEl('p', { text: t('introDesc1') });
					intro.createEl('p', { text: t('introDesc2') });
				},
			},
			...this.section('general', t('headingGeneral'), [
				{ name: t('language'), render: setting => this.configureLanguage(setting) },
				{ name: t('theme'), render: setting => this.configureTheme(setting) },
			]),
			...this.section('interaction', t('headingInteraction'), [
				{
					name: t('singlePage'),
					desc: [t('singlePageDesc1'), t('singlePageDesc2'), t('singlePageDesc3'), t('singlePageDesc4')].join(' '),
					render: setting => this.configureSinglePage(setting),
				},
				{ name: t('homePage'), desc: t('homePageDesc'), render: setting => this.configureHomePage(setting) },
			]),
			...this.section('appearance', t('headingAppearance'), [
				{ name: t('hideTabBar'), render: setting => this.configureHideTabBar(setting) },
				{ name: t('showProperties'), render: setting => this.configureShowProperties(setting) },
				{ name: t('showLocalGraph'), render: setting => this.configureShowLocalGraph(setting) },
				{ name: t('showVaultProfile'), render: setting => this.configureShowVaultProfile(setting) },
				{
					name: t('showRightSidebarButton'),
					desc: t('showRightSidebarButtonDesc'),
					render: setting => this.configureShowRightSidebarButton(setting),
				},
			]),
			...this.section('animation', t('headingAnimation'), [
				{
					name: t('navAnimation'),
					desc: t('navAnimationDesc'),
					render: setting => this.configureNavAnimation(setting),
				},
			]),
			...this.section('advanced', t('headingAdvanced'), [
				{
					name: t('filenamePrefixManual'),
					desc: t('filenamePrefixManualDesc'),
					render: setting => this.configureFilenamePrefixManual(setting),
				},
				{
					name: t('filenamePrefixLength'),
					desc: t('filenamePrefixLengthDesc'),
					visible: () => this.plugin.settings.filenamePrefixManual,
					render: setting => this.configureFilenamePrefixLength(setting),
				},
			]),
		];
	}
}
