import { Plugin } from 'obsidian';
import { MinimalismUISettings, DEFAULT_SETTINGS } from './src/core/settings';
import { Feature } from './src/core/Feature';
import { FontLoader } from './src/core/FontLoader';
import { ThemeLoader } from './src/core/ThemeLoader';
import { BodyClassController } from './src/core/BodyClassController';
import { SinglePageEngine } from './src/single-page/SinglePageEngine';
import { PinManager } from './src/tabs/PinManager';
import { HomePageManager } from './src/single-page/HomePageManager';
import { EmptyViewButtonManager } from './src/single-page/EmptyViewButtonManager';
import { DragBarManager } from './src/layout/DragBarManager';
import { SidebarLayoutManager } from './src/layout/SidebarLayoutManager';
import { SidebarSuggestFocusTracker } from './src/layout/SidebarSuggestFocusTracker';
import { MermaidZoomManager } from './src/mermaid/MermaidZoomManager';
import { MinimalismUISettingTab } from './src/SettingTab';
import { setLang } from './src/core/i18n';

export type { MinimalismUISettings };

// ─── Main Plugin ──────────────────────────────────────────────────────────────

export default class MinimalismUIPlugin extends Plugin {
	settings: MinimalismUISettings;

	private bodyClasses: BodyClassController;
	private fontLoader: FontLoader;
	private themeLoader: ThemeLoader;
	private engine: SinglePageEngine;
	private pinManager: PinManager;
	private homePage: HomePageManager;
	private emptyViewButton: EmptyViewButtonManager;
	private dragBar: DragBarManager;
	private sidebarLayout: SidebarLayoutManager;
	private sidebarSuggestFocus: SidebarSuggestFocusTracker;
	private mermaidZoom: MermaidZoomManager;

	// 所有功能单元，统一用于卸载，避免逐个手写 remove() 时遗漏。
	private features: Feature[] = [];

	async onload() {
		await this.loadSettings();
		setLang(this.settings.language);

		const settings = () => this.settings;
		this.bodyClasses = new BodyClassController(settings);
		this.fontLoader = new FontLoader(this.app, this.manifest.dir ?? '');
		this.themeLoader = new ThemeLoader(this.app, this.manifest.dir ?? '', settings);
		this.engine = new SinglePageEngine(this.app, settings);
		this.pinManager = new PinManager(this.app, settings);
		this.homePage = new HomePageManager(this.app, settings, this.engine);
		this.emptyViewButton = new EmptyViewButtonManager(this.app, settings, this.engine);
		this.dragBar = new DragBarManager(
			this.app,
			settings,
			() => this.engine.getNavHistory(),
			(index) => this.engine.navigateHistoryTo(index),
		);
		this.sidebarLayout = new SidebarLayoutManager(this.app, settings, this.pinManager);
		this.sidebarSuggestFocus = new SidebarSuggestFocusTracker();
		this.mermaidZoom = new MermaidZoomManager(this.app);

		this.features = [
			this.bodyClasses,
			this.fontLoader,
			this.themeLoader,
			this.engine,
			this.pinManager,
			this.homePage,
			this.emptyViewButton,
			this.dragBar,
			this.sidebarLayout,
			this.sidebarSuggestFocus,
			this.mermaidZoom,
		];

		// 立即生效的部分
		await this.fontLoader.apply();
		void this.themeLoader.apply();
		this.bodyClasses.apply();
		this.sidebarSuggestFocus.apply();
		this.pinManager.apply();
		this.engine.apply();
		this.mermaidZoom.apply();

		// 依赖 workspace 布局就绪的部分
		this.app.workspace.onLayoutReady(() => {
			this.dragBar.apply();
			this.homePage.apply();
			this.emptyViewButton.apply();
			void this.homePage.openHomePage();
			void this.sidebarLayout.apply();
		});

		this.addSettingTab(new MinimalismUISettingTab(this.app, this));
	}

	onunload() {
		setLang('auto');
		for (const feature of this.features) feature.remove();
	}

	// ─── Sidebar Layout ───────────────────────────────────────────────────────

	async applyMacSidebarLayout() {
		await this.sidebarLayout.apply();
	}

	// ─── Body Classes ─────────────────────────────────────────────────────────

	applyBodyClasses() {
		this.bodyClasses.apply();
	}

	// ─── Theme ────────────────────────────────────────────────────────────────

	// 重新注入当前 theme 字段对应的主题 CSS（切换主题时调用）。
	async applyTheme() {
		await this.themeLoader.apply();
	}

	// 列出 theme/ 目录下所有可选主题名，供设置面板下拉框使用。
	listThemes(): Promise<string[]> {
		return this.themeLoader.listThemes();
	}

	// ─── Settings ─────────────────────────────────────────────────────────────

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<MinimalismUISettings>);
	}

	// 设置变更后重新应用对设置敏感的功能单元。
	// 侧边栏（开销大）走独立的 applyMacSidebarLayout；mermaid 在运行时读设置，无需重应用。
	async saveSettings() {
		await this.saveData(this.settings);
		this.bodyClasses.apply();
		this.pinManager.apply();
		this.engine.apply();
		this.dragBar.apply();
		this.homePage.apply();
		this.emptyViewButton.apply();
	}
}
