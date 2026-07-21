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
//
// Stays on the imperative display() API only. A getSettingDefinitions() +
// display() dual-path version (guarding this.update()/refreshDomState() calls
// behind a `typeof this.update === 'function'` runtime check) was tried and
// submitted for review: Obsidian's submission checker flags any reference to
// update()/refreshDomState() as `obsidianmd/no-unsupported-api` — a blocking
// Error — purely from the static call site, regardless of a runtime guard
// around it. There is no way to call those APIs anywhere in the file without
// bumping minAppVersion to 1.13.0, which this plugin has already reverted once
// (commit f56f8f0) specifically to keep supporting 1.7.2. So the "does not
// implement getSettingDefinitions()" Warning is accepted as permanently open.

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
					this.display();
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
					this.display(); // 重渲染以同步长度数字框的显隐
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
}
