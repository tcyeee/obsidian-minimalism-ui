import { AbstractInputSuggest, App, PluginSettingTab, Setting, TFile } from 'obsidian';
import type MinimalismUIPlugin from '../main';
import { t, setLang } from './core/i18n';
import { MAX_LEFT_SIDEBAR_SLOTS } from './core/settings';

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
					// 空侧栏提示文案由 LeftSidebarManager 注入，语言切换后重新应用一次以刷新
					void this.plugin.applyMacSidebarLayout();
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

	// ── 左侧栏面板列表（用户添加任意 view，最多 4 个，可拖拽排序）──────────────

	// 拖拽排序进行中的源行下标；drop 时读取，结束即清空。
	private slotDragIndex: number | null = null;

	private async persistSlots(): Promise<void> {
		await this.plugin.saveSettings();
		// 添加 / 更换面板会新建 leaf，触发时让侧栏展开露出新面板（纯排序 / 删除不会新建，故无副作用）。
		await this.plugin.applyMacSidebarLayout({ revealNewPanels: true });
		this.display();
	}

	private configureLeftSidebarSlots(parentEl: HTMLElement): void {
		// 整个「面板配置」区域套一个 border，视觉上与其他设置项区分开
		const sectionEl = parentEl.createDiv({ cls: 'minimalism-ui-slot-section' });
		const slots = this.plugin.settings.leftSidebarSlots;
		const options = this.plugin.listSidebarViewOptions();
		const atLimit = slots.length >= MAX_LEFT_SIDEBAR_SLOTS;
		const used = new Set(slots.map(s => s.viewType));
		// 新增行默认选中：优先经典三面板，其次任意未占用的已注册 view。
		const preferred = ['outline', 'file-properties', 'localgraph'];
		const nextFree = preferred.filter(tp => options.some(o => o.type === tp)).find(tp => !used.has(tp))
			?? options.find(o => !used.has(o.type))?.type;

		const header = new Setting(sectionEl)
			.setName(t('leftSidebarPanels'))
			.setDesc(atLimit ? t('leftSidebarPanelsFull') : t('leftSidebarPanelsDesc'));
		header.addButton(btn => {
			btn.setButtonText(t('addPanel'));
			if (atLimit || !nextFree) {
				btn.setDisabled(true);
			} else {
				btn.setCta();
				btn.onClick(async () => {
					slots.push({ id: `slot-${Date.now()}`, viewType: nextFree, enabled: true, height: null });
					await this.persistSlots();
				});
			}
		});

		const listEl = sectionEl.createDiv({ cls: 'minimalism-ui-slot-list' });
		if (slots.length === 0) {
			listEl.createDiv({ cls: 'minimalism-ui-slot-empty', text: t('leftSidebarPanelsEmpty') });
			return;
		}
		slots.forEach((_, index) => this.renderSlotRow(listEl, index, options));
	}

	private renderSlotRow(
		listEl: HTMLElement,
		index: number,
		options: { type: string; label: string }[],
	): void {
		const slots = this.plugin.settings.leftSidebarSlots;
		const slot = slots[index];
		const row = listEl.createDiv({ cls: 'minimalism-ui-slot-row', attr: { draggable: 'true' } });

		row.createSpan({
			cls: 'minimalism-ui-slot-handle',
			text: '⠿',
			attr: { 'aria-label': t('dragToReorder') },
		});

		const select = row.createEl('select', { cls: 'dropdown minimalism-ui-slot-select' });
		const usedElsewhere = new Set(slots.filter((_, i) => i !== index).map(s => s.viewType));
		let hasCurrent = false;
		for (const opt of options) {
			if (usedElsewhere.has(opt.type)) continue;
			select.createEl('option', { value: opt.type, text: opt.label });
			if (opt.type === slot.viewType) hasCurrent = true;
		}
		// 当前 slot 的 view type 未注册（插件已卸载等）时仍列出，避免下拉框回退到别的项。
		if (!hasCurrent) select.createEl('option', { value: slot.viewType, text: slot.viewType });
		select.value = slot.viewType;
		select.addEventListener('change', async () => {
			slot.viewType = select.value;
			await this.persistSlots();
		});

		const removeBtn = row.createEl('button', {
			cls: 'minimalism-ui-slot-remove clickable-icon',
			text: '✕',
			attr: { 'aria-label': t('removePanel') },
		});
		removeBtn.addEventListener('click', async () => {
			slots.splice(index, 1);
			await this.persistSlots();
		});

		row.addEventListener('dragstart', ev => {
			this.slotDragIndex = index;
			row.addClass('is-dragging');
			ev.dataTransfer?.setData('text/plain', String(index));
		});
		row.addEventListener('dragend', () => {
			this.slotDragIndex = null;
			row.removeClass('is-dragging');
		});
		row.addEventListener('dragover', ev => {
			if (this.slotDragIndex === null || this.slotDragIndex === index) return;
			ev.preventDefault();
			row.addClass('is-drop-target');
		});
		row.addEventListener('dragleave', () => row.removeClass('is-drop-target'));
		row.addEventListener('drop', async ev => {
			ev.preventDefault();
			row.removeClass('is-drop-target');
			const from = this.slotDragIndex;
			this.slotDragIndex = null;
			if (from === null || from === index) return;
			const [moved] = slots.splice(from, 1);
			slots.splice(index, 0, moved);
			await this.persistSlots();
		});
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

	// 目前未在 display() 中调用——该开关已从设置页移除，仅保留实现以便日后恢复。
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
		this.configureLeftSidebarSlots(appearanceEl);
		this.configureShowVaultProfile(new Setting(appearanceEl));
		// 「右侧栏悬浮按钮」不在设置页展示；开关仍可通过状态栏菜单切换（见 StatusBarMenuManager）。

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
