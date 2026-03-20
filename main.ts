import { Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings, DEFAULT_SETTINGS } from './src/settings';
import { TabCacheManager } from './src/TabCacheManager';
import { DragBarManager } from './src/DragBarManager';
import { MinimalismUISettingTab } from './src/SettingTab';

export type { MinimalismUISettings };

// ─── Main Plugin ──────────────────────────────────────────────────────────────

export default class MinimalismUIPlugin extends Plugin {
	settings: MinimalismUISettings;

	private tabCache: TabCacheManager;
	private dragBar: DragBarManager;

	private pinBlockHandler: ((e: MouseEvent) => void) | null = null;
	private detachPatches = new Map<WorkspaceLeaf, () => void>();

	private homePageHandler: ((file: TFile | null) => void) | null = null;
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

		await this.loadJetBrainsMono();
		await this.loadSourceHanSansSC();
		this.applyBodyClasses();
		this.applyPinBlock();
		this.tabCache.apply();
		this.app.workspace.onLayoutReady(() => {
			this.dragBar.apply();
			this.applyHomePage();
			this.openHomePage();
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
		for (const font of this.loadedFonts) (document.fonts as any).delete(font);
		this.loadedFonts = [];
		this.removePinBlockHandler();
		this.tabCache.remove();
		this.dragBar.remove();
		this.removeHomePageHandler();
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

	// ─── Pin Block ────────────────────────────────────────────────────────────

	applyPinBlock() {
		this.removePinBlockHandler();
		if (!this.settings.disablePinTab) return;

		this.pinBlockHandler = (e: MouseEvent) => {
			if ((e.target as Element).closest('.workspace-tab-header.tappable')) {
				e.stopImmediatePropagation();
				e.preventDefault();
			}
		};
		document.addEventListener('contextmenu', this.pinBlockHandler, true);
		this.patchSidebarLeafDetach();
	}

	private patchSidebarLeafDetach() {
		this.app.workspace.iterateAllLeaves(leaf => {
			if (this.detachPatches.has(leaf)) return;
			const leafEl = (leaf as any).containerEl as HTMLElement | undefined;
			if (!leafEl?.closest('.workspace-split.mod-left-split')) return;
			const original = (leaf as any).detach.bind(leaf);
			(leaf as any).detach = () => { /* blocked */ };
			this.detachPatches.set(leaf, original);
		});
	}

	private removePinBlockHandler() {
		if (this.pinBlockHandler) {
			document.removeEventListener('contextmenu', this.pinBlockHandler, true);
			this.pinBlockHandler = null;
		}
		for (const [leaf, original] of this.detachPatches) {
			(leaf as any).detach = original;
		}
		this.detachPatches.clear();
	}

	// ─── Home Page ────────────────────────────────────────────────────────────

	applyHomePage() {
		this.removeHomePageHandler();
		if (!this.settings.homePage) return;

		this.homePageHandler = (file: TFile | null) => {
			if (!file) this.openHomePage();
		};
		this.app.workspace.on('file-open', this.homePageHandler);
	}

	async openHomePage() {
		if (this.isOpeningHomePage) return;
		const path = this.settings.homePage;
		if (!path) return;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		this.isOpeningHomePage = true;
		try {
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file);
		} finally {
			this.isOpeningHomePage = false;
		}
	}

	private removeHomePageHandler() {
		if (this.homePageHandler) {
			this.app.workspace.off('file-open', this.homePageHandler);
			this.homePageHandler = null;
		}
	}

	// ─── Settings ─────────────────────────────────────────────────────────────

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.applyBodyClasses();
		this.applyPinBlock();
		this.tabCache.apply();
		this.dragBar.apply();
		this.applyHomePage();
	}

	// ─── Fonts ────────────────────────────────────────────────────────────────

	private fontPath(filename: string): string {
		const adapter = this.app.vault.adapter as any;
		return adapter.getResourcePath(`${this.manifest.dir}/fonts/${filename}`);
	}

	private async loadFontFace(family: string, descriptors: FontFaceDescriptors & { file: string }) {
		const { file, ...desc } = descriptors;
		const face = new FontFace(family, `url('${this.fontPath(file)}')`, desc);
		try {
			await face.load();
			(document.fonts as any).add(face);
			this.loadedFonts.push(face);
		} catch {
			// 字体文件不存在时静默跳过
		}
	}

	private async loadJetBrainsMono() {
		await Promise.all([
			this.loadFontFace('JetBrains Mono', { file: 'JetBrainsMonoNL-Regular.ttf',          style: 'normal', weight: '400' }),
			this.loadFontFace('JetBrains Mono', { file: 'JetBrainsMonoNL-Italic.ttf',           style: 'italic', weight: '400' }),
			this.loadFontFace('JetBrains Mono', { file: 'JetBrainsMonoNL-Medium.ttf',           style: 'normal', weight: '500' }),
			this.loadFontFace('JetBrains Mono', { file: 'JetBrainsMonoNL-MediumItalic.ttf',     style: 'italic', weight: '500' }),
			this.loadFontFace('JetBrains Mono', { file: 'JetBrainsMonoNL-Bold.ttf',             style: 'normal', weight: '700' }),
			this.loadFontFace('JetBrains Mono', { file: 'JetBrainsMonoNL-BoldItalic.ttf',       style: 'italic', weight: '700' }),
			this.loadFontFace('JetBrains Mono', { file: 'JetBrainsMonoNL-ExtraBold.ttf',        style: 'normal', weight: '900' }),
			this.loadFontFace('JetBrains Mono', { file: 'JetBrainsMonoNL-ExtraBoldItalic.ttf',  style: 'italic', weight: '900' }),
		]);
	}

	private async loadSourceHanSansSC() {
		const unicodeRange = 'U+4E00-9FA5, U+9FA6-9FFF, U+3400-4DBF, U+2E80-2EF3, U+2F00-2FD5, U+2FF0-2FFB, U+3007, U+31C0-31E3, U+3105-312F, U+31A0-31BA, U+F900-FAD9, U+2F800-2FA1D';
		await Promise.all([
			this.loadFontFace('SourceHanSansSC', { file: 'SourceHanSansSC-Light.otf',   weight: '300',    unicodeRange }),
			this.loadFontFace('SourceHanSansSC', { file: 'SourceHanSansSC-Regular.otf', weight: 'normal', unicodeRange }),
			this.loadFontFace('SourceHanSansSC', { file: 'SourceHanSansSC-Medium.otf',  weight: '500',    unicodeRange }),
			this.loadFontFace('SourceHanSansSC', { file: 'SourceHanSansSC-Bold.otf',    weight: 'bold',   unicodeRange }),
			this.loadFontFace('SourceHanSansSC', { file: 'SourceHanSansSC-Heavy.otf',   weight: '900',    unicodeRange }),
		]);
	}
}
