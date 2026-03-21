import { Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings, DEFAULT_SETTINGS } from './src/settings';
import { TabCacheManager } from './src/TabCacheManager';
import { DragBarManager } from './src/DragBarManager';
import { MinimalismUISettingTab } from './src/SettingTab';

export type { MinimalismUISettings };

interface MutableFontFaceSet {
	add(font: FontFace): void;
	delete(font: FontFace): void;
}

type LeafWithInternals = WorkspaceLeaf & {
	containerEl?: HTMLElement;
	detach: () => void;
};

// ─── Main Plugin ──────────────────────────────────────────────────────────────

export default class MinimalismUIPlugin extends Plugin {
	settings: MinimalismUISettings;

	private tabCache: TabCacheManager;
	private dragBar: DragBarManager;

	private pinBlockHandler: ((e: MouseEvent) => void) | null = null;
	private detachPatches = new Map<WorkspaceLeaf, () => void>();

	private homePageHandler: ((file: TFile | null) => void) | null = null;
	private isOpeningHomePage = false;

	private outlineNavHandler: ((e: MouseEvent) => void) | null = null;

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
		this.applyBodyClasses();
		this.applyPinBlock();
		this.applyOutlineAnimation();
		this.tabCache.apply();
		this.app.workspace.onLayoutReady(() => {
			this.dragBar.apply();
			this.applyHomePage();
			void this.openHomePage();
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
		this.removePinBlockHandler();
		this.tabCache.remove();
		this.dragBar.remove();
		this.removeHomePageHandler();
		this.removeOutlineAnimation();
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
			const leafEl = (leaf as LeafWithInternals).containerEl;
			if (!leafEl?.closest('.workspace-split.mod-left-split')) return;
			const original = (leaf as LeafWithInternals).detach.bind(leaf);
			(leaf as LeafWithInternals).detach = () => { /* blocked */ };
			this.detachPatches.set(leaf, original);
		});
	}

	private removePinBlockHandler() {
		if (this.pinBlockHandler) {
			document.removeEventListener('contextmenu', this.pinBlockHandler, true);
			this.pinBlockHandler = null;
		}
		for (const [leaf, original] of this.detachPatches) {
			(leaf as LeafWithInternals).detach = original;
		}
		this.detachPatches.clear();
	}

	// ─── Home Page ────────────────────────────────────────────────────────────

	applyHomePage() {
		this.removeHomePageHandler();
		if (!this.settings.homePage) return;

		this.homePageHandler = (file: TFile | null) => {
			if (!file) {
				// 若 active leaf 正在等待 openFile（由 getLeaf patch 新建，如 Cmd+N 新笔记），
				// 跳过首页跳转，避免抢占该 leaf
				const active = this.app.workspace.getMostRecentLeaf();
				if (active && this.tabCache.hasPendingIntercept(active)) return;
				void this.openHomePage();
			}
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
			// 首页 leaf 绕过了 getLeaf 拦截，不会经过 interceptLeafOpenFile，
			// 需在此手动补充 history patch，确保 canGoForward 返回我们的导航栈状态
			this.tabCache.patchLeafHistory(leaf);
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
		this.applyOutlineAnimation();
	}

	// ─── Outline Animation ────────────────────────────────────────────────────

	applyOutlineAnimation() {
		this.removeOutlineAnimation();
		if (!this.settings.noteStyle) return;

		this.outlineNavHandler = (e: MouseEvent) => {
			const item = (e.target as Element).closest('.tree-item-inner');
			if (!item?.closest('[data-type="outline"]')) return;
			setTimeout(() => this.flashCurrentHeading(), 50);
		};
		document.addEventListener('click', this.outlineNavHandler, true);
	}

	private removeOutlineAnimation() {
		if (this.outlineNavHandler) {
			document.removeEventListener('click', this.outlineNavHandler, true);
			this.outlineNavHandler = null;
		}
	}

	private flashCurrentHeading() {
		const leaf = this.app.workspace.getMostRecentLeaf();
		if (!leaf) return;

		const scrollEl = leaf.view.containerEl.querySelector<HTMLElement>('.markdown-preview-view');
		if (!scrollEl) return;

		const containerRect = scrollEl.getBoundingClientRect();
		const headings = scrollEl.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6');

		let target: HTMLElement | null = null;
		let minDist = Infinity;

		for (const h of Array.from(headings)) {
			const dist = Math.abs(h.getBoundingClientRect().top - containerRect.top);
			if (dist < minDist) {
				minDist = dist;
				target = h;
			}
		}

		if (target) {
			const el = target;
			el.classList.add('minimalism-ui-heading-flash');
			el.addEventListener('animationend', () => el.classList.remove('minimalism-ui-heading-flash'), { once: true });
		}
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
