import { AbstractInputSuggest, App, Modal, PluginSettingTab, Setting, SettingDefinitionItem, SettingGroupItem, TFile, getAllTags, setIcon } from 'obsidian';
import type MinimalismUIPlugin from '../main';
import { t, setLang } from './core/i18n';
import { MAX_LEFT_SIDEBAR_SLOTS, MULTI_INSTANCE_VIEW_TYPES } from './core/settings';
import type { SidebarSlot, SidebarRule, SidebarCondition, SidebarConditionField, SidebarConditionOperator } from './core/settings';
import { getDailyNotesFolder } from './core/utils';
import { VIEW_TYPE_NOTE_CARD } from './note-card/NoteCardView';

// 字段 → 该字段下有意义的操作符子集（如 path/folder 没有"是否为空"，因为文件路径恒非空）。
const OPERATORS_BY_FIELD: Record<SidebarConditionField, SidebarConditionOperator[]> = {
	path: ['is', 'is-not', 'contains', 'not-contains', 'starts-with'],
	folder: ['is', 'is-not', 'contains', 'not-contains', 'starts-with'],
	tag: ['is', 'is-not', 'contains', 'not-contains', 'is-empty', 'is-not-empty'],
	property: ['is', 'is-not', 'contains', 'not-contains', 'starts-with', 'is-empty', 'is-not-empty'],
};

function fieldLabel(field: SidebarConditionField): string {
	switch (field) {
		case 'path': return t('conditionFieldPath');
		case 'folder': return t('conditionFieldFolder');
		case 'tag': return t('conditionFieldTag');
		case 'property': return t('conditionFieldProperty');
	}
}

function operatorLabel(op: SidebarConditionOperator): string {
	switch (op) {
		case 'is': return t('conditionOperatorIs');
		case 'is-not': return t('conditionOperatorIsNot');
		case 'contains': return t('conditionOperatorContains');
		case 'not-contains': return t('conditionOperatorNotContains');
		case 'starts-with': return t('conditionOperatorStartsWith');
		case 'is-empty': return t('conditionOperatorIsEmpty');
		case 'is-not-empty': return t('conditionOperatorIsNotEmpty');
	}
}

function describeCondition(cond: SidebarCondition): string {
	const field = cond.field === 'property' ? (cond.property || t('conditionFieldProperty')) : fieldLabel(cond.field);
	if (cond.operator === 'is-empty' || cond.operator === 'is-not-empty') return `${field} ${operatorLabel(cond.operator)}`;
	return `${field} ${operatorLabel(cond.operator)} ${cond.value ?? ''}`;
}

function summarizeConditions(conditions: SidebarCondition[]): string {
	if (conditions.length === 0) return t('ruleConditionsEmpty');
	return conditions.map(describeCondition).join(` ${t('conditionJoinerAnd')} `);
}

function vaultPropertyNames(app: App): string[] {
	const names = new Set<string>();
	for (const file of app.vault.getMarkdownFiles()) {
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm) continue;
		for (const key of Object.keys(fm)) {
			// Obsidian 往 frontmatter 缓存对象里混入了一个内部字段记录文本区间，不是真实属性。
			if (key === 'position') continue;
			names.add(key);
		}
	}
	return Array.from(names).sort();
}

function vaultTagNames(app: App): string[] {
	const names = new Set<string>();
	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		if (!cache) continue;
		for (const tag of getAllTags(cache) ?? []) names.add(tag.replace(/^#/, ''));
	}
	return Array.from(names).sort();
}

// ─── 筛选条件弹窗 ───────────────────────────────────────────────────────────────
// 自定义规则的筛选条件在弹窗里编辑（固定三个 tab——首页/日记/默认——没有这个入口，
// 它们的匹配逻辑写死在 LeftSidebarManager 里，不接受用户编辑）。弹窗内部用自己的
// render() 做局部重渲染，不触发外层 SettingTab.update()；只有关闭时才通过 onDismiss
// 回调通知外层刷新一次（tab 文案 + 「筛选条件」摘要）。

class SidebarConditionModal extends Modal {
	constructor(
		app: App,
		private rule: SidebarRule,
		private persist: () => void | Promise<void>,
		private onDismiss: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(t('ruleConditions'));
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
		this.onDismiss();
	}

	private render(): void {
		this.contentEl.empty();

		const header = new Setting(this.contentEl)
			.setDesc(this.rule.conditions.length === 0 ? t('ruleConditionsEmptyHint') : '');
		header.addButton(btn => {
			btn.setButtonText(t('addCondition'));
			btn.setCta();
			btn.onClick(() => {
				this.rule.conditions.push({ field: 'property', operator: 'is', value: '' });
				void this.persist();
				this.render();
			});
		});

		const listEl = this.contentEl.createDiv({ cls: 'minimalism-ui-condition-list' });
		if (this.rule.conditions.length > 0) {
			const propertyNames = vaultPropertyNames(this.app);
			const tagNames = vaultTagNames(this.app);
			this.rule.conditions.forEach((_, index) => this.renderRow(listEl, index, propertyNames, tagNames));
		}
	}

	private renderRow(listEl: HTMLElement, index: number, propertyNames: string[], tagNames: string[]): void {
		const cond = this.rule.conditions[index];
		const row = listEl.createDiv({ cls: 'minimalism-ui-condition-row' });

		const fieldSelect = row.createEl('select', { cls: 'dropdown minimalism-ui-condition-field' });
		(['path', 'folder', 'tag', 'property'] as SidebarConditionField[]).forEach(field => {
			fieldSelect.createEl('option', { value: field, text: fieldLabel(field) });
		});
		fieldSelect.value = cond.field;

		let propertyInput: HTMLInputElement | null = null;
		if (cond.field === 'property') {
			const listId = 'minimalism-ui-property-suggestions';
			propertyInput = row.createEl('input', {
				cls: 'minimalism-ui-condition-property',
				attr: { type: 'text', placeholder: t('conditionPropertyPlaceholder'), list: listId },
			});
			propertyInput.value = cond.property ?? '';
			this.fillDatalist(listId, propertyNames);
			propertyInput.addEventListener('change', () => {
				cond.property = propertyInput!.value.trim();
				void this.persist();
			});
		}

		const operatorSelect = row.createEl('select', { cls: 'dropdown minimalism-ui-condition-operator' });
		const valueInput = row.createEl('input', {
			cls: 'minimalism-ui-condition-value',
			attr: { type: 'text', placeholder: t('conditionValuePlaceholder') },
		});
		if (cond.field === 'tag') {
			const listId = 'minimalism-ui-tag-suggestions';
			valueInput.setAttribute('list', listId);
			this.fillDatalist(listId, tagNames);
		}
		const updateValueVisibility = () => {
			const hide = operatorSelect.value === 'is-empty' || operatorSelect.value === 'is-not-empty';
			valueInput.toggleClass('is-hidden', hide);
		};
		for (const op of OPERATORS_BY_FIELD[cond.field]) {
			operatorSelect.createEl('option', { value: op, text: operatorLabel(op) });
		}
		operatorSelect.value = OPERATORS_BY_FIELD[cond.field].includes(cond.operator)
			? cond.operator : OPERATORS_BY_FIELD[cond.field][0];
		valueInput.value = cond.value ?? '';
		updateValueVisibility();

		fieldSelect.addEventListener('change', () => {
			cond.field = fieldSelect.value as SidebarConditionField;
			if (cond.field !== 'property') delete cond.property;
			if (!OPERATORS_BY_FIELD[cond.field].includes(cond.operator)) cond.operator = OPERATORS_BY_FIELD[cond.field][0];
			// 换字段会改变是否需要属性名输入框 / 标签建议列表这类行内结构，整行重渲染最简单。
			void this.persist();
			this.render();
		});
		operatorSelect.addEventListener('change', () => {
			cond.operator = operatorSelect.value as SidebarConditionOperator;
			updateValueVisibility();
			void this.persist();
		});
		valueInput.addEventListener('change', () => {
			cond.value = valueInput.value;
			void this.persist();
		});

		const removeBtn = row.createEl('button', {
			cls: 'minimalism-ui-slot-remove clickable-icon',
			text: '✕',
			attr: { 'aria-label': t('removeCondition') },
		});
		removeBtn.addEventListener('click', () => {
			this.rule.conditions.splice(index, 1);
			void this.persist();
			this.render();
		});
	}

	// 属性名 / 标签输入框的 <datalist> 建议列表：按 id 幂等创建，每次渲染都重新填充内容。
	private fillDatalist(id: string, values: string[]): void {
		const doc = this.contentEl.ownerDocument;
		const existing = doc.getElementById(id);
		const list = existing ?? doc.body.createEl('datalist', { attr: { id } });
		list.empty();
		for (const value of values) list.createEl('option', { value });
	}
}

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
			// 标记原生 setting-items 包裹层，供 CSS 摘掉它给标题行套的圆角灰底
			// （直接打标记而非用 :has() 选择器，避免 :has 的大范围选择器失效性能开销）
			headingEl.parentElement?.classList.add('minimalism-ui-collapsible-heading-wrapper');
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
					this.update();
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
					void this.plugin.saveSettings().then(async () => {
						if (changed) await this.plugin.applyMacSidebarLayout();
						if (changed && value) void this.plugin.resetToHomePage();
					});
				};
				new FileSuggest(this.app, text.inputEl).onPick(path => applyHomePage(path));
				text.inputEl.addEventListener('change', () => applyHomePage(text.inputEl.value.trim()));
			});
	}

	// ── 左侧栏面板列表（首页 / 日记 / 默认三个固定 tab + 用户自定义规则 tab）────

	// 拖拽排序进行中的源行下标；drop 时读取，结束即清空。
	private slotDragIndex: number | null = null;
	// 'home' / 'diary' / 'other' 三个固定、不可改筛选条件的 tab，或某条 sidebarRules[].id。
	private sidebarProfile = 'home';

	private profileLabel(key: string): string {
		if (key === 'home') return t('sidebarProfileHome');
		if (key === 'diary') return t('sidebarProfileDiary');
		if (key === 'other') return t('sidebarProfileOther');
		return this.plugin.settings.sidebarRules.find(r => r.id === key)?.name || t('sidebarRuleUnnamed');
	}

	private profileOverride(): SidebarSlot[] | null {
		const s = this.plugin.settings;
		if (this.sidebarProfile === 'home') return s.homeSidebarSlots;
		if (this.sidebarProfile === 'diary') return s.diarySidebarSlots;
		if (this.sidebarProfile === 'other') return s.leftSidebarSlots;
		return s.sidebarRules.find(r => r.id === this.sidebarProfile)?.slots ?? null;
	}

	private displayedSlots(): SidebarSlot[] {
		const override = this.profileOverride();
		return (override ?? this.plugin.settings.leftSidebarSlots).map(slot => ({ ...slot }));
	}

	private setProfileSlots(slots: SidebarSlot[] | null): void {
		const s = this.plugin.settings;
		if (this.sidebarProfile === 'home') s.homeSidebarSlots = slots;
		else if (this.sidebarProfile === 'diary') s.diarySidebarSlots = slots;
		else if (this.sidebarProfile === 'other') s.leftSidebarSlots = slots ?? [];
		else {
			const rule = s.sidebarRules.find(r => r.id === this.sidebarProfile);
			if (rule) rule.slots = slots ?? [];
		}
	}

	private async persistSlots(): Promise<void> {
		await this.plugin.saveSettings();
		// 添加 / 更换面板会新建 leaf，触发时让侧栏展开露出新面板（纯排序 / 删除不会新建，故无副作用）。
		await this.plugin.applyMacSidebarLayout({ revealNewPanels: true });
		this.update();
	}

	private configureLeftSidebarSlots(parentEl: HTMLElement): void {
		// 整个「面板配置」区域套一个 border，视觉上与其他设置项区分开
		const sectionEl = parentEl.createDiv({ cls: 'minimalism-ui-slot-section' });
		const slots = this.displayedSlots();
		const options = this.plugin.listSidebarViewOptions();
		const atLimit = slots.length >= MAX_LEFT_SIDEBAR_SLOTS;
		const used = new Set(slots.map(s => s.viewType));
		// 笔记卡片允许在同一列表里重复添加（每份各自独立绑定一篇笔记），其它 view type 仍是
		// 「已占用即排除」。
		const isAvailable = (type: string): boolean => !used.has(type) || MULTI_INSTANCE_VIEW_TYPES.has(type);
		const workspaceEl = sectionEl.createDiv({ cls: 'minimalism-ui-slot-workspace' });
		const tabs = workspaceEl.createDiv({ cls: 'minimalism-ui-slot-profiles' });
		const contentEl = workspaceEl.createDiv({ cls: 'minimalism-ui-slot-content' });

		// 固定三个 tab（首页/日记/默认，筛选条件不可改）+ 用户自定义规则 tab，顺序即命中优先级
		// （LeftSidebarManager.activeSlots 按同样顺序判定：home → diary → 自定义规则 → 默认）。
		const tabKeys = ['home', 'diary', ...this.plugin.settings.sidebarRules.map(r => r.id), 'other'];
		for (const key of tabKeys) {
			const isFixedKey = key === 'home' || key === 'diary' || key === 'other';
			const tab = tabs.createEl('button', {
				cls: `minimalism-ui-slot-profile${this.sidebarProfile === key ? ' is-active' : ''}${isFixedKey ? ' is-fixed' : ''}`,
				attr: {
					'aria-pressed': String(this.sidebarProfile === key),
					...(isFixedKey ? { title: t('sidebarProfileFixedTooltip') } : {}),
				},
			});
			// 固定三个 tab 前面加一个锁图标，和中间夹着的自定义规则 tab 在视觉上区分开——
			// 不用点进去看筛选条件区才知道这三个的匹配条件是系统写死、不可编辑的。
			if (isFixedKey) setIcon(tab.createSpan({ cls: 'minimalism-ui-slot-profile-lock' }), 'lock');
			tab.createSpan({ cls: 'minimalism-ui-slot-profile-label', text: this.profileLabel(key) });
			tab.addEventListener('click', () => {
				this.sidebarProfile = key;
				this.update();
			});
		}
		const addTab = tabs.createEl('button', {
			cls: 'minimalism-ui-slot-profile minimalism-ui-slot-profile-add',
			text: '+',
			attr: { 'aria-label': t('addRule') },
		});
		addTab.addEventListener('click', () => {
			void (async () => {
				const id = `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
				this.plugin.settings.sidebarRules.push({ id, name: '', conditions: [], slots: [] });
				this.sidebarProfile = id;
				await this.plugin.saveSettings();
				this.update();
			})();
		});

		const isFixedTab = this.sidebarProfile === 'home' || this.sidebarProfile === 'diary' || this.sidebarProfile === 'other';
		const unavailableReason = this.sidebarProfile === 'home'
			? (this.plugin.settings.homePage.trim() ? '' : t('sidebarProfileHomeUnavailable'))
			: this.sidebarProfile === 'diary'
				? (getDailyNotesFolder(this.app) === null ? t('sidebarProfileDiaryUnavailable') : '')
				: '';
		if (unavailableReason) contentEl.createDiv({ cls: 'minimalism-ui-slot-notice', text: unavailableReason });
		const editable = !unavailableReason;

		// 自定义规则 tab：筛选条件本身在弹窗里编辑（见下方「编辑筛选条件」按钮），这里只放
		// 名称 + 弹窗入口 + 删除。固定三个 tab 没有名称/弹窗，但同样占一行「筛选条件」展示其
		// 系统写死的匹配条件——与自定义规则并排对照，才看得出这三个为什么没有编辑入口。
		if (isFixedTab) this.renderFixedProfileHeader(contentEl, this.sidebarProfile);
		else this.renderRuleHeader(contentEl, this.sidebarProfile);

		// 新增行默认选中：优先经典三面板，其次任意未占用的已注册 view。
		const preferred = ['outline', 'file-properties', 'localgraph'];
		const nextFree = preferred.filter(tp => options.some(o => o.type === tp)).find(isAvailable)
			?? options.find(o => isAvailable(o.type))?.type;

		if (atLimit) {
			new Setting(contentEl).setDesc(t('leftSidebarPanelsFull'));
		}

		const listEl = contentEl.createDiv({ cls: 'minimalism-ui-slot-list' });
		if (slots.length === 0 && editable) {
			listEl.createDiv({ cls: 'minimalism-ui-slot-empty', text: t('leftSidebarPanelsEmpty') });
		} else if (slots.length > 0) {
			slots.forEach((_, index) => this.renderSlotRow(listEl, index, options, editable));
		}

		const footer = new Setting(contentEl);
		footer.addButton(btn => {
			btn.setButtonText(t('addPanel'));
			if (!editable || atLimit || !nextFree) {
				btn.setDisabled(true);
			} else {
				btn.setCta();
				btn.onClick(async () => {
					// Date.now() 单独做 id 在「Add 按钮被连续快速触发两次、落在同一毫秒」时会撞车——
					// 对笔记卡片这种允许同列表多份的 type 尤其致命（撞车的两个 slot 会算出同一个
					// slotKey，LeftSidebarManager 里互相顶替）。加一段随机后缀，不依赖单一时间戳。
					const id = `slot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
					slots.push({ id, viewType: nextFree, enabled: true, height: null });
					this.setProfileSlots(slots);
					await this.persistSlots();
				});
			}
		});
	}

	/** 固定三个 tab（首页/日记/默认）顶部的「筛选条件」展示行：只读文案 + 锁图标，无编辑入口。 */
	private renderFixedProfileHeader(parentEl: HTMLElement, key: string): void {
		const condition = key === 'home' ? t('sidebarProfileHomeCondition')
			: key === 'diary' ? t('sidebarProfileDiaryCondition')
			: t('sidebarProfileOtherCondition');
		new Setting(parentEl)
			.setName(t('ruleConditions'))
			.setDesc(condition)
			.addExtraButton(btn => btn
				.setIcon('lock')
				.setTooltip(t('sidebarProfileFixedTooltip'))
				.setDisabled(true));
	}

	/** 自定义规则 tab 顶部的名称 + 筛选条件弹窗入口 + 删除；固定三个 tab 不会调这个方法。 */
	private renderRuleHeader(parentEl: HTMLElement, ruleId: string): void {
		const rule = this.plugin.settings.sidebarRules.find(r => r.id === ruleId);
		if (!rule) return;

		new Setting(parentEl)
			.setName(t('ruleName'))
			.addText(text => {
				text.setPlaceholder(t('ruleNamePlaceholder')).setValue(rule.name);
				text.inputEl.addEventListener('change', () => {
					rule.name = text.inputEl.value.trim();
					void this.plugin.saveSettings();
					this.update(); // tab 文案跟着刷新
				});
			})
			.addExtraButton(btn => btn
				.setIcon('trash-2')
				.setTooltip(t('removeRule'))
				.onClick(async () => {
					const rules = this.plugin.settings.sidebarRules;
					const idx = rules.findIndex(r => r.id === ruleId);
					if (idx < 0) return;
					const [removed] = rules.splice(idx, 1);
					// 规则里的笔记卡片一并清掉持久化绑定，同面板列表删除笔记卡片 slot 时的逻辑。
					for (const slot of removed.slots) {
						if (slot.viewType === VIEW_TYPE_NOTE_CARD) delete this.plugin.settings.noteCardBindings[slot.id];
					}
					this.sidebarProfile = 'other';
					await this.plugin.saveSettings();
					await this.plugin.applyMacSidebarLayout({ revealNewPanels: true });
					this.update();
				}));

		new Setting(parentEl)
			.setName(t('ruleConditions'))
			.setDesc(summarizeConditions(rule.conditions))
			.addButton(btn => btn
				.setButtonText(t('editConditions'))
				.onClick(() => {
					new SidebarConditionModal(
						this.app,
						rule,
						() => this.plugin.saveSettings(),
						() => this.update(),
					).open();
				}));
	}

	private renderSlotRow(
		listEl: HTMLElement,
		index: number,
		options: { type: string; label: string }[],
		editable = true,
	): void {
		const slots = this.displayedSlots();
		const slot = slots[index];
		const row = listEl.createDiv({ cls: 'minimalism-ui-slot-row', attr: { draggable: String(editable) } });

		row.createSpan({
			cls: 'minimalism-ui-slot-handle',
			text: '⠿',
			attr: { 'aria-label': t('dragToReorder') },
		});

		const select = row.createEl('select', { cls: 'dropdown minimalism-ui-slot-select' });
		const usedElsewhere = new Set(slots.filter((_, i) => i !== index).map(s => s.viewType));
		let hasCurrent = false;
		for (const opt of options) {
			if (usedElsewhere.has(opt.type) && !MULTI_INSTANCE_VIEW_TYPES.has(opt.type)) continue;
			select.createEl('option', { value: opt.type, text: opt.label });
			if (opt.type === slot.viewType) hasCurrent = true;
		}
		// 当前 slot 的 view type 未注册（插件已卸载等）时仍列出，避免下拉框回退到别的项。
		if (!hasCurrent) select.createEl('option', { value: slot.viewType, text: slot.viewType });
		select.value = slot.viewType;
		select.disabled = !editable;
		select.addEventListener('change', () => {
			if (!editable) return;
			// 从笔记卡片切到别的类型：这个 slot.id 以后再也不会被笔记卡片认领，顺手清掉它在
			// settings.noteCardBindings 里的残留，否则这条绑定会永久留在 data.json 里（同removeBtn
			// 下面的清理逻辑）。
			if (slot.viewType === VIEW_TYPE_NOTE_CARD && select.value !== VIEW_TYPE_NOTE_CARD) {
				delete this.plugin.settings.noteCardBindings[slot.id];
			}
			slot.viewType = select.value;
			this.setProfileSlots(slots);
			void this.persistSlots();
		});

		const removeBtn = row.createEl('button', {
			cls: 'minimalism-ui-slot-remove clickable-icon',
			text: '✕',
			attr: { 'aria-label': t('removePanel') },
		});
		removeBtn.disabled = !editable;
		removeBtn.addEventListener('click', () => {
			if (!editable) return;
			const [removed] = slots.splice(index, 1);
			// 笔记卡片删了就彻底清掉它那份持久化绑定——不然 settings.noteCardBindings 里会
			// 永久留着一个再也用不到的 slot.id（slot.id 用时间戳生成，理论上不会被复用）。
			if (removed?.viewType === VIEW_TYPE_NOTE_CARD) delete this.plugin.settings.noteCardBindings[removed.id];
			this.setProfileSlots(slots);
			void this.persistSlots();
		});

		if (!editable) return;
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
		row.addEventListener('drop', ev => {
			ev.preventDefault();
			row.removeClass('is-drop-target');
			const from = this.slotDragIndex;
			this.slotDragIndex = null;
			if (from === null || from === index) return;
			const [moved] = slots.splice(from, 1);
			slots.splice(index, 0, moved);
			this.setProfileSlots(slots);
			void this.persistSlots();
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
					// 仅需重估下面这一行的 visible 谓词，无需整体重渲染。
					this.refreshDomState();
				}));
	}

	private configureSkillflowMenuMerge(setting: Setting): void {
		setting.setName(t('skillflowMenuMerge'))
			.setDesc(t('skillflowMenuMergeDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableSkillflowMenuMerge)
				.onChange(async v => {
					this.plugin.settings.enableSkillflowMenuMerge = v;
					await this.plugin.saveSettings();
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

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			...this.section('general', t('headingGeneral'), [
				{ name: t('language'), render: (setting) => this.configureLanguage(setting) },
				{ name: t('theme'), render: (setting) => this.configureTheme(setting) },
			]),

			...this.section('interaction', t('headingInteraction'), [
				{ name: t('singlePage'), render: (setting) => this.configureSinglePage(setting) },
				{ name: t('homePage'), render: (setting) => this.configureHomePage(setting) },
			]),

			...this.section('appearance', t('headingAppearance'), [
				{
					name: t('leftSidebarPanels'),
					render: (setting) => {
						setting.settingEl.empty();
						setting.settingEl.className = 'minimalism-ui-slot-setting-wrapper';
						this.configureLeftSidebarSlots(setting.settingEl);
					},
				},
			]),
			// 底部设置区域 / 右侧栏按钮单独成一个组，与上方的面板配置保持间距。
			{
				type: 'group',
				visible: () => !this.isCollapsed('appearance'),
				cls: 'minimalism-ui-sidebar-secondary-group',
				items: [
					{ name: t('showVaultProfile'), render: (setting) => this.configureShowVaultProfile(setting) },
					{ name: t('showRightSidebarButton'), render: (setting) => this.configureShowRightSidebarButton(setting) },
				],
			},

			...this.section('advanced', t('headingAdvanced'), [
				{ name: t('navAnimation'), render: (setting) => this.configureNavAnimation(setting) },
				{ name: t('skillflowMenuMerge'), render: (setting) => this.configureSkillflowMenuMerge(setting) },
				{ name: t('filenamePrefixManual'), render: (setting) => this.configureFilenamePrefixManual(setting) },
				// 仅当手动隐藏开启时才显示长度设置。
				{
					name: t('filenamePrefixLength'),
					visible: () => this.plugin.settings.filenamePrefixManual,
					render: (setting) => this.configureFilenamePrefixLength(setting),
				},
			]),
		];
	}
}
