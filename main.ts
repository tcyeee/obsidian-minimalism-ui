import { Plugin } from 'obsidian';
import { MinimalismUISettings, DEFAULT_SETTINGS } from './src/core/settings';
import { Feature } from './src/core/Feature';
import { FontLoader } from './src/core/FontLoader';
import { BodyClassController } from './src/core/BodyClassController';
import { SinglePageEngine } from './src/single-page/SinglePageEngine';
import { PinManager } from './src/tabs/PinManager';
import { HomePageManager } from './src/single-page/HomePageManager';
import { DragBarManager } from './src/layout/DragBarManager';
import { SidebarLayoutManager } from './src/layout/SidebarLayoutManager';
import { MermaidZoomManager } from './src/mermaid/MermaidZoomManager';
import { MinimalismUISettingTab } from './src/SettingTab';
import { setLang } from './src/core/i18n';

export type { MinimalismUISettings };

// ─── Main Plugin ──────────────────────────────────────────────────────────────

export default class MinimalismUIPlugin extends Plugin {
	settings: MinimalismUISettings;

	private bodyClasses: BodyClassController;
	private fontLoader: FontLoader;
	private engine: SinglePageEngine;
	private pinManager: PinManager;
	private homePage: HomePageManager;
	private dragBar: DragBarManager;
	private sidebarLayout: SidebarLayoutManager;
	private mermaidZoom: MermaidZoomManager;

	// 所有功能单元，统一用于卸载，避免逐个手写 remove() 时遗漏。
	private features: Feature[] = [];

	async onload() {
		await this.loadSettings();
		setLang(this.settings.language);

		const settings = () => this.settings;
		this.bodyClasses = new BodyClassController(settings);
		this.fontLoader = new FontLoader(this.app, this.manifest.dir ?? '');
		this.engine = new SinglePageEngine(this.app, settings);
		this.pinManager = new PinManager(this.app, settings);
		this.homePage = new HomePageManager(this.app, settings, this.engine);
		this.dragBar = new DragBarManager(this.app, settings, () => this.engine.getNavHistory());
		this.sidebarLayout = new SidebarLayoutManager(this.app, settings, this.pinManager);
		this.mermaidZoom = new MermaidZoomManager(this.app, settings);

		this.features = [
			this.bodyClasses,
			this.fontLoader,
			this.engine,
			this.pinManager,
			this.homePage,
			this.dragBar,
			this.sidebarLayout,
			this.mermaidZoom,
		];

		// 立即生效的部分
		await this.fontLoader.apply();
		this.bodyClasses.apply();
		this.pinManager.apply();
		this.engine.apply();
		this.mermaidZoom.apply();

		// 依赖 workspace 布局就绪的部分
		this.app.workspace.onLayoutReady(() => {
			this.dragBar.apply();
			this.homePage.apply();
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
		if (this.settings.macSidebar) {
			await this.sidebarLayout.apply();
		} else {
			this.sidebarLayout.remove();
		}
	}

	// ─── Body Classes ─────────────────────────────────────────────────────────

	applyBodyClasses() {
		this.bodyClasses.apply();
	}

	// ─── Settings ─────────────────────────────────────────────────────────────

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
	}
}
