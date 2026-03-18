import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
	ItemView,
	TFile,
	moment,
} from 'obsidian';

// ─── Settings ────────────────────────────────────────────────────────────────

export interface MinimalismUISettings {
	// 外观
	enableMacStyle: boolean;
	hideTabBar: boolean;
	hideNavButtons: boolean;
	hideRightSidebar: boolean;
	// 左侧面板内容
	showNoteTitle: boolean;
	showNoteTags: boolean;
	showNoteFrontmatter: boolean;
	showNoteCreated: boolean;
	showNoteModified: boolean;
	showNoteWordCount: boolean;
	showNoteLinks: boolean;
}

const DEFAULT_SETTINGS: MinimalismUISettings = {
	enableMacStyle: true,
	hideTabBar: false,
	hideNavButtons: false,
	hideRightSidebar: false,
	showNoteTitle: true,
	showNoteTags: true,
	showNoteFrontmatter: true,
	showNoteCreated: true,
	showNoteModified: true,
	showNoteWordCount: true,
	showNoteLinks: true,
};

// ─── Note Info View ───────────────────────────────────────────────────────────

export const VIEW_TYPE_NOTE_INFO = 'minimalism-ui-note-info';

export class NoteInfoView extends ItemView {
	plugin: MinimalismUIPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: MinimalismUIPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_NOTE_INFO;
	}

	getDisplayText(): string {
		return '笔记信息';
	}

	getIcon(): string {
		return 'file-text';
	}

	async onOpen() {
		this.containerEl.addClass('minimalism-ui-view-container');
		await this.renderContent();

		// 文件切换时刷新
		this.registerEvent(
			this.app.workspace.on('file-open', async () => {
				await this.renderContent();
			})
		);

		// 元数据变化时刷新
		this.registerEvent(
			this.app.metadataCache.on('changed', async (file) => {
				const active = this.app.workspace.getActiveFile();
				if (active && file.path === active.path) {
					await this.renderContent();
				}
			})
		);
	}

	async renderContent(file?: TFile) {
		const panel = this.containerEl.children[1] as HTMLElement;
		panel.empty();
		panel.addClass('minimalism-ui-info-panel');

		const activeFile = file ?? this.app.workspace.getActiveFile();

		if (!activeFile) {
			const empty = panel.createEl('div', { cls: 'minimalism-ui-empty-state' });
			empty.createEl('div', { cls: 'minimalism-ui-empty-icon', text: '📄' });
			empty.createEl('p', { text: '请打开一篇笔记' });
			return;
		}

		const metadata = this.app.metadataCache.getFileCache(activeFile);
		const stat = await this.app.vault.adapter.stat(activeFile.path);

		// ── 标题
		if (this.plugin.settings.showNoteTitle) {
			const sec = panel.createEl('div', { cls: 'minimalism-ui-section' });
			sec.createEl('div', { cls: 'minimalism-ui-label', text: '标题' });
			sec.createEl('div', { cls: 'minimalism-ui-value minimalism-ui-title', text: activeFile.basename });
		}

		// ── 标签
		if (this.plugin.settings.showNoteTags) {
			const allTags: string[] = [];
			// frontmatter tags
			const fmTags = metadata?.frontmatter?.tags;
			if (fmTags) {
				if (Array.isArray(fmTags)) allTags.push(...fmTags);
				else allTags.push(String(fmTags));
			}
			// inline tags
			if (metadata?.tags) {
				metadata.tags.forEach(t => {
					const tag = t.tag.startsWith('#') ? t.tag.slice(1) : t.tag;
					if (!allTags.includes(tag)) allTags.push(tag);
				});
			}

			if (allTags.length > 0) {
				const sec = panel.createEl('div', { cls: 'minimalism-ui-section' });
				sec.createEl('div', { cls: 'minimalism-ui-label', text: '标签' });
				const tagsEl = sec.createEl('div', { cls: 'minimalism-ui-tags' });
				allTags.forEach(tag => {
					tagsEl.createEl('span', { cls: 'minimalism-ui-tag', text: tag });
				});
			}
		}

		// ── Frontmatter 属性
		if (this.plugin.settings.showNoteFrontmatter && metadata?.frontmatter) {
			const skipKeys = new Set(['position', 'tags', 'tag']);
			const entries = Object.entries(metadata.frontmatter).filter(([k]) => !skipKeys.has(k));
			if (entries.length > 0) {
				const sec = panel.createEl('div', { cls: 'minimalism-ui-section' });
				sec.createEl('div', { cls: 'minimalism-ui-label', text: '属性' });
				entries.forEach(([key, value]) => {
					const row = sec.createEl('div', { cls: 'minimalism-ui-fm-row' });
					row.createEl('span', { cls: 'minimalism-ui-fm-key', text: key });
					const displayVal = Array.isArray(value) ? value.join(', ') : String(value);
					row.createEl('span', { cls: 'minimalism-ui-fm-value', text: displayVal });
				});
			}
		}

		// ── 创建时间
		if (this.plugin.settings.showNoteCreated && stat) {
			const sec = panel.createEl('div', { cls: 'minimalism-ui-section' });
			sec.createEl('div', { cls: 'minimalism-ui-label', text: '创建时间' });
			sec.createEl('div', {
				cls: 'minimalism-ui-value minimalism-ui-date',
				text: moment(stat.ctime).format('YYYY-MM-DD HH:mm'),
			});
		}

		// ── 修改时间
		if (this.plugin.settings.showNoteModified && stat) {
			const sec = panel.createEl('div', { cls: 'minimalism-ui-section' });
			sec.createEl('div', { cls: 'minimalism-ui-label', text: '修改时间' });
			sec.createEl('div', {
				cls: 'minimalism-ui-value minimalism-ui-date',
				text: moment(stat.mtime).format('YYYY-MM-DD HH:mm'),
			});
		}

		// ── 字数统计
		if (this.plugin.settings.showNoteWordCount) {
			const content = await this.app.vault.read(activeFile);
			const { words, chars } = countWords(content);
			const sec = panel.createEl('div', { cls: 'minimalism-ui-section' });
			sec.createEl('div', { cls: 'minimalism-ui-label', text: '字数统计' });
			const wc = sec.createEl('div', { cls: 'minimalism-ui-value' });
			wc.createEl('span', { cls: 'minimalism-ui-stat', text: `${words}` });
			wc.createEl('span', { cls: 'minimalism-ui-stat-label', text: ' 词  ' });
			wc.createEl('span', { cls: 'minimalism-ui-stat', text: `${chars}` });
			wc.createEl('span', { cls: 'minimalism-ui-stat-label', text: ' 字符' });
		}

		// ── 链接统计
		if (this.plugin.settings.showNoteLinks) {
			const outLinks = metadata?.links?.length ?? 0;
			// getBacklinksForFile 是 Obsidian 内部 API，类型定义中不存在
		const backlinks = (this.app.metadataCache as any).getBacklinksForFile(activeFile);
			const inLinks = backlinks ? Object.keys(backlinks.data).length : 0;

			const sec = panel.createEl('div', { cls: 'minimalism-ui-section' });
			sec.createEl('div', { cls: 'minimalism-ui-label', text: '链接' });
			const linksEl = sec.createEl('div', { cls: 'minimalism-ui-value minimalism-ui-links' });
			const outEl = linksEl.createEl('div', { cls: 'minimalism-ui-link-row' });
			outEl.createEl('span', { cls: 'minimalism-ui-link-icon', text: '↗' });
			outEl.createEl('span', { text: ` 出链  ${outLinks}` });
			const inEl = linksEl.createEl('div', { cls: 'minimalism-ui-link-row' });
			inEl.createEl('span', { cls: 'minimalism-ui-link-icon', text: '↙' });
			inEl.createEl('span', { text: ` 入链  ${inLinks}` });
		}
	}

	async onClose() {
		// nothing
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function countWords(text: string): { words: number; chars: number } {
	const clean = text
		.replace(/```[\s\S]*?```/g, '')
		.replace(/`[^`]*`/g, '')
		.replace(/^#{1,6}\s/gm, '')
		.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.replace(/[*_~]+/g, '')
		.trim();

	const chinese = (clean.match(/[\u4e00-\u9fa5\u3400-\u4dbf]/g) ?? []).length;
	const english = clean
		.replace(/[\u4e00-\u9fa5\u3400-\u4dbf]/g, ' ')
		.split(/\s+/)
		.filter(w => w.length > 0).length;

	return { words: chinese + english, chars: clean.replace(/\s/g, '').length };
}

// ─── Main Plugin ──────────────────────────────────────────────────────────────

export default class MinimalismUIPlugin extends Plugin {
	settings: MinimalismUISettings;
	private ensureTimer: number | null = null;

	async onload() {
		await this.loadSettings();

		// 注册自定义视图
		this.registerView(VIEW_TYPE_NOTE_INFO, (leaf) => new NoteInfoView(leaf, this));

		// 应用样式
		this.applyBodyClasses();

		// 布局就绪后打开视图
		this.app.workspace.onLayoutReady(() => {
			this.ensureNoteInfoOpen();
		});

		// 监听布局变化（用户关闭视图后重新打开）
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.scheduleEnsure();
			})
		);

		// 拦截关闭左侧边栏的快捷键 Cmd+\ / Ctrl+\
		this.registerDomEvent(document, 'keydown', (e: KeyboardEvent) => {
			const mod = e.metaKey || e.ctrlKey;
			if (mod && e.key === '\\') {
				e.stopPropagation();
				e.preventDefault();
			}
		}, true);

		// 设置页面
		this.addSettingTab(new MinimalismUISettingTab(this.app, this));
	}

	onunload() {
		if (this.ensureTimer !== null) window.clearTimeout(this.ensureTimer);
		document.body.classList.remove(
			'minimalism-ui-mac-style',
			'minimalism-ui-hide-tab-bar',
			'minimalism-ui-hide-nav-buttons',
			'minimalism-ui-hide-right-sidebar',
		);
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_NOTE_INFO);
	}

	private scheduleEnsure() {
		if (this.ensureTimer !== null) window.clearTimeout(this.ensureTimer);
		this.ensureTimer = window.setTimeout(() => {
			this.ensureNoteInfoOpen();
			this.ensureTimer = null;
		}, 400);
	}

	async ensureNoteInfoOpen() {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_NOTE_INFO);
		if (existing.length > 0) return;

		// 视图不存在，重新挂载到左侧边栏
		const leaf = this.app.workspace.getLeftLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: VIEW_TYPE_NOTE_INFO, active: false });
			// 确保左侧边栏展开
			this.app.workspace.revealLeaf(leaf);
		}
	}

	applyBodyClasses() {
		const cls = document.body.classList;
		cls.toggle('minimalism-ui-mac-style', this.settings.enableMacStyle);
		cls.toggle('minimalism-ui-hide-tab-bar', this.settings.hideTabBar);
		cls.toggle('minimalism-ui-hide-nav-buttons', this.settings.hideNavButtons);
		cls.toggle('minimalism-ui-hide-right-sidebar', this.settings.hideRightSidebar);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.applyBodyClasses();
		// 刷新信息面板
		this.app.workspace.getLeavesOfType(VIEW_TYPE_NOTE_INFO).forEach(leaf => {
			if (leaf.view instanceof NoteInfoView) leaf.view.renderContent();
		});
	}
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

class MinimalismUISettingTab extends PluginSettingTab {
	plugin: MinimalismUIPlugin;

	constructor(app: App, plugin: MinimalismUIPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Minimalism UI' });
		containerEl.createEl('p', {
			text: '将 Obsidian 改造为类 macOS 原生应用风格。左侧面板固定显示当前笔记信息，无法被关闭。',
			cls: 'minimalism-ui-setting-desc',
		});

		// ── 外观
		containerEl.createEl('h3', { text: '外观设置' });

		new Setting(containerEl)
			.setName('macOS 原生风格')
			.setDesc('启用圆角、系统字体、毛玻璃等 macOS 视觉风格')
			.addToggle(t => t
				.setValue(this.plugin.settings.enableMacStyle)
				.onChange(async v => { this.plugin.settings.enableMacStyle = v; await this.plugin.saveSettings(); }));

		new Setting(containerEl)
			.setName('隐藏顶部标签栏')
			.setDesc('隐藏多标签页切换栏，界面更简洁')
			.addToggle(t => t
				.setValue(this.plugin.settings.hideTabBar)
				.onChange(async v => { this.plugin.settings.hideTabBar = v; await this.plugin.saveSettings(); }));

		new Setting(containerEl)
			.setName('隐藏文件区域导航按钮')
			.setDesc('隐藏左侧文件栏上方的图标按钮')
			.addToggle(t => t
				.setValue(this.plugin.settings.hideNavButtons)
				.onChange(async v => { this.plugin.settings.hideNavButtons = v; await this.plugin.saveSettings(); }));

		new Setting(containerEl)
			.setName('隐藏右侧边栏')
			.setDesc('默认折叠右侧边栏，专注左+内容二栏布局')
			.addToggle(t => t
				.setValue(this.plugin.settings.hideRightSidebar)
				.onChange(async v => { this.plugin.settings.hideRightSidebar = v; await this.plugin.saveSettings(); }));

		// ── 左侧信息面板
		containerEl.createEl('h3', { text: '左侧信息面板内容' });

		const panelItems: Array<[keyof MinimalismUISettings, string, string]> = [
			['showNoteTitle', '笔记标题', ''],
			['showNoteTags', '标签', ''],
			['showNoteFrontmatter', 'Frontmatter 属性', '显示笔记的 YAML 属性（tags/tag 除外）'],
			['showNoteCreated', '创建时间', ''],
			['showNoteModified', '最后修改时间', ''],
			['showNoteWordCount', '字数统计', '统计词数与字符数'],
			['showNoteLinks', '链接统计', '显示出链与入链数量'],
		];

		panelItems.forEach(([key, name, desc]) => {
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addToggle(t => t
					.setValue(this.plugin.settings[key] as boolean)
					.onChange(async v => {
						(this.plugin.settings[key] as boolean) = v;
						await this.plugin.saveSettings();
					}));
		});
	}
}
