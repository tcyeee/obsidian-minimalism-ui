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

	private addCollapsibleSection(key: string, title: string): HTMLElement {
		const { containerEl } = this;
		const isCollapsed = this.plugin.settings.collapsedSections[key] ?? false;

		const headingEl = containerEl.createDiv({
			cls: 'setting-item setting-item-heading minimalism-ui-collapsible-heading'
				+ (isCollapsed ? ' minimalism-ui-collapsible-heading-collapsed' : ''),
		});
		const nameEl = headingEl.createDiv({ cls: 'setting-item-info' })
			.createDiv({ cls: 'setting-item-name' });
		nameEl.createSpan({ cls: 'minimalism-ui-section-arrow' });
		nameEl.createSpan({ text: title });

		const contentEl = containerEl.createDiv({ cls: 'minimalism-ui-collapsible-content' });

		headingEl.addEventListener('click', () => {
			const nowCollapsed = !(this.plugin.settings.collapsedSections[key] ?? false);
			this.plugin.settings.collapsedSections[key] = nowCollapsed;
			headingEl.toggleClass('minimalism-ui-collapsible-heading-collapsed', nowCollapsed);
			void this.plugin.saveSettings();
		});

		return contentEl;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const intro = containerEl.createDiv({ cls: 'minimalism-ui-intro' });
		intro.createDiv({ cls: 'minimalism-ui-intro-title', text: t('introTitle') });
		intro.createEl('p', { text: t('introDesc1') });
		intro.createEl('p', { text: t('introDesc2') });

		// ── General ──
		const generalEl = this.addCollapsibleSection('general', t('headingGeneral'));

		new Setting(generalEl)
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

		new Setting(generalEl)
			.setName(t('theme'))
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

		// ── Interaction ──
		const interactionEl = this.addCollapsibleSection('interaction', t('headingInteraction'));

		const singlePageSetting = new Setting(interactionEl)
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

		new Setting(interactionEl)
			.setName(t('homePage'))
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

		// ── Appearance ──
		const appearanceEl = this.addCollapsibleSection('appearance', t('headingAppearance'));

		new Setting(appearanceEl)
			.setName(t('hideTabBar'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.hideTabBar)
				.onChange(async v => {
					this.plugin.settings.hideTabBar = v;
					await this.plugin.saveSettings();
				}));

		new Setting(appearanceEl)
			.setName(t('showProperties'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showProperties)
				.onChange(async v => {
					this.plugin.settings.showProperties = v;
					await this.plugin.saveSettings();
					await this.plugin.applyMacSidebarLayout();
				}));

		new Setting(appearanceEl)
			.setName(t('showLocalGraph'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showLocalGraph)
				.onChange(async v => {
					this.plugin.settings.showLocalGraph = v;
					await this.plugin.saveSettings();
					await this.plugin.applyMacSidebarLayout();
				}));

		new Setting(appearanceEl)
			.setName(t('showVaultProfile'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showVaultProfile)
				.onChange(async v => {
					this.plugin.settings.showVaultProfile = v;
					await this.plugin.saveSettings();
				}));

		// ── Animation ──
		const animationEl = this.addCollapsibleSection('animation', t('headingAnimation'));

		new Setting(animationEl)
			.setName(t('navAnimation'))
			.setDesc(t('navAnimationDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableNavAnimation)
				.onChange(async v => {
					this.plugin.settings.enableNavAnimation = v;
					await this.plugin.saveSettings();
				}));

		// ── Advanced ──
		const advancedEl = this.addCollapsibleSection('advanced', t('headingAdvanced'));

		new Setting(advancedEl)
			.setName(t('filenamePrefixManual'))
			.setDesc(t('filenamePrefixManualDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.filenamePrefixManual)
				.onChange(value => {
					this.plugin.settings.filenamePrefixManual = value;
					void this.plugin.saveSettings();
					this.display(); // 重渲染以同步长度数字框的显隐
				}));

		// 仅当手动隐藏开启时才显示长度设置。
		if (this.plugin.settings.filenamePrefixManual) {
			new Setting(advancedEl)
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
		}
	}
}
