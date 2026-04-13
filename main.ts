import { Plugin } from 'obsidian';
import { MinimalismUISettings, DEFAULT_SETTINGS } from './src/settings';
import { TabCacheManager } from './src/TabCacheManager';
import { DragBarManager } from './src/DragBarManager';
import { SinglePageManager } from './src/SinglePageManager';
import { SidebarLayoutManager } from './src/SidebarLayoutManager';
import { MermaidZoomManager } from './src/MermaidZoomManager';
import { MinimalismUISettingTab } from './src/SettingTab';

export type { MinimalismUISettings };

interface MutableFontFaceSet {
	add(font: FontFace): void;
	delete(font: FontFace): void;
}

// ─── Main Plugin ──────────────────────────────────────────────────────────────

export default class MinimalismUIPlugin extends Plugin {
	settings: MinimalismUISettings;

	private tabCache: TabCacheManager;
	private dragBar: DragBarManager;
	private singlePage: SinglePageManager;
	private sidebarLayout: SidebarLayoutManager;
	private mermaidZoom: MermaidZoomManager;
	// Shared flag between TabCacheManager and SinglePageManager.
	// TabCacheManager reads it to skip getLeaf interception while the home page
	// is opening; SinglePageManager writes it during openHomePage().
	private isOpeningHomePage = false;

	private loadedFonts: FontFace[] = [];

	async onload() {
		await this.loadSettings();

		this.tabCache = new TabCacheManager(
			this.app,
			() => this.settings,
			() => this.isOpeningHomePage,
		);
		this.dragBar = new DragBarManager(this.app, () => this.settings);
		this.sidebarLayout = new SidebarLayoutManager(this.app, () => this.settings);
		this.singlePage = new SinglePageManager(
			this.app,
			() => this.settings,
			this.tabCache,
			() => this.isOpeningHomePage,
			(v) => { this.isOpeningHomePage = v; },
		);
		this.mermaidZoom = new MermaidZoomManager(this.app, () => this.settings);
		await this.loadJetBrainsMono();
		this.applyBodyClasses();
		this.singlePage.apply();
		this.tabCache.apply();
		this.mermaidZoom.apply();
		this.app.workspace.onLayoutReady(() => {
			this.dragBar.apply();
			this.singlePage.applyHomePage();
			void this.singlePage.openHomePage();
			void this.sidebarLayout.apply();
		});
		this.addSettingTab(new MinimalismUISettingTab(this.app, this));
	}

	onunload() {
		document.body.classList.remove(
			'minimalism-ui-mac-sidebar',
			'minimalism-ui-hide-tab-bar',
			'minimalism-ui-disable-pin',
			'minimalism-ui-simplify-panel',
			'minimalism-ui-disable-note-tabs',
			'minimalism-ui-note-style',
		);
		for (const font of this.loadedFonts) (document.fonts as unknown as MutableFontFaceSet).delete(font);
		this.loadedFonts = [];
		this.singlePage.remove();
		this.tabCache.remove();
		this.dragBar.remove();
		this.sidebarLayout.remove();
		this.mermaidZoom.remove();
	}

	// ─── Sidebar Layout ───────────────────────────────────────────────────────

	async applyMacSidebarLayout() {
		if (this.settings.macSidebar) {
			await this.sidebarLayout.apply();
		} else {
			this.sidebarLayout.remove();
		}
	}

	// ─── Body Classes ─────────────────────────────────────────────────────────

	applyBodyClasses() {
		const cls = document.body.classList;
		cls.toggle('minimalism-ui-mac-sidebar', this.settings.macSidebar);
		cls.toggle('minimalism-ui-hide-tab-bar', this.settings.hideTabBar);
		cls.toggle('minimalism-ui-disable-pin', this.settings.disablePinTab);
		cls.toggle('minimalism-ui-simplify-panel', this.settings.simplifyPanel);
		cls.toggle('minimalism-ui-disable-note-tabs', this.settings.disableNoteTabs);
		cls.toggle('minimalism-ui-note-style', this.settings.noteStyle);
	}

	// ─── Settings ─────────────────────────────────────────────────────────────

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.applyBodyClasses();
		this.singlePage.apply();
		this.tabCache.apply();
		this.dragBar.apply();
		this.singlePage.applyHomePage();
	}

	// ─── Fonts ────────────────────────────────────────────────────────────────

	private fontPath(filename: string): string {
		const adapter = this.app.vault.adapter as { getResourcePath: (path: string) => string };
		return adapter.getResourcePath(`${this.manifest.dir}/fonts/${filename}`);
	}

	private async loadFontFace(family: string, descriptors: FontFaceDescriptors & { file: string }) {
		const { file, ...desc } = descriptors;
		const face = new FontFace(family, `url('${this.fontPath(file)}')`, desc);
		try {
			await face.load();
			(document.fonts as unknown as MutableFontFaceSet).add(face);
			this.loadedFonts.push(face);
		} catch {
			// 字体文件不存在时静默跳过
		}
	}

	private async loadJetBrainsMono() {
		// unicodeRange：数字 0-9、小数点、负号，仅用于正文数字字体混排
		const digitsRange = 'U+002D, U+002E, U+0030-0039';
		await Promise.all([
			this.loadFontFace('JetBrains Mono', { file: 'JetBrainsMonoNL-Regular.ttf',          style: 'normal', weight: '400' }),
			this.loadFontFace('JetBrains Mono', { file: 'JetBrainsMonoNL-Italic.ttf',           style: 'italic', weight: '400' }),
			this.loadFontFace('JetBrains Mono', { file: 'JetBrainsMonoNL-Medium.ttf',           style: 'normal', weight: '500' }),
			this.loadFontFace('JetBrains Mono', { file: 'JetBrainsMonoNL-MediumItalic.ttf',     style: 'italic', weight: '500' }),
			this.loadFontFace('JetBrains Mono', { file: 'JetBrainsMonoNL-Bold.ttf',             style: 'normal', weight: '700' }),
			this.loadFontFace('JetBrains Mono', { file: 'JetBrainsMonoNL-BoldItalic.ttf',       style: 'italic', weight: '700' }),
			this.loadFontFace('JetBrains Mono', { file: 'JetBrainsMonoNL-ExtraBold.ttf',        style: 'normal', weight: '900' }),
			this.loadFontFace('JetBrains Mono', { file: 'JetBrainsMonoNL-ExtraBoldItalic.ttf',  style: 'italic', weight: '900' }),
			// 数字专用字族：只覆盖数字 unicode 范围，用于正文混排
			this.loadFontFace('JetBrains Mono Digits', { file: 'JetBrainsMonoNL-Regular.ttf',         style: 'normal', weight: '400', unicodeRange: digitsRange }),
			this.loadFontFace('JetBrains Mono Digits', { file: 'JetBrainsMonoNL-Italic.ttf',          style: 'italic', weight: '400', unicodeRange: digitsRange }),
			this.loadFontFace('JetBrains Mono Digits', { file: 'JetBrainsMonoNL-Medium.ttf',          style: 'normal', weight: '500', unicodeRange: digitsRange }),
			this.loadFontFace('JetBrains Mono Digits', { file: 'JetBrainsMonoNL-MediumItalic.ttf',    style: 'italic', weight: '500', unicodeRange: digitsRange }),
			this.loadFontFace('JetBrains Mono Digits', { file: 'JetBrainsMonoNL-Bold.ttf',            style: 'normal', weight: '700', unicodeRange: digitsRange }),
			this.loadFontFace('JetBrains Mono Digits', { file: 'JetBrainsMonoNL-BoldItalic.ttf',      style: 'italic', weight: '700', unicodeRange: digitsRange }),
			this.loadFontFace('JetBrains Mono Digits', { file: 'JetBrainsMonoNL-ExtraBold.ttf',       style: 'normal', weight: '900', unicodeRange: digitsRange }),
			this.loadFontFace('JetBrains Mono Digits', { file: 'JetBrainsMonoNL-ExtraBoldItalic.ttf', style: 'italic', weight: '900', unicodeRange: digitsRange }),
		]);
	}

}
