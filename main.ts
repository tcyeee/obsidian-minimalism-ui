import { Plugin } from 'obsidian';
import { MinimalismUISettings, DEFAULT_SETTINGS } from './src/core/settings';
import { Feature } from './src/core/Feature';
import { FontLoader } from './src/core/FontLoader';
import { ThemeLoader } from './src/core/ThemeLoader';
import { BodyClassController } from './src/core/BodyClassController';
import { SinglePageEngine } from './src/single-page/SinglePageEngine';
import { SingleTabGroupGuard } from './src/single-page/SingleTabGroupGuard';
import { PinManager } from './src/tabs/PinManager';
import { HomePageManager } from './src/single-page/HomePageManager';
import { EmptyViewButtonManager } from './src/single-page/EmptyViewButtonManager';
import { DragBarManager } from './src/layout/DragBarManager';
import { SidebarLayoutManager } from './src/layout/SidebarLayoutManager';
import { SidebarSuggestFocusTracker } from './src/layout/SidebarSuggestFocusTracker';
import { ResponsiveSidebarManager } from './src/layout/ResponsiveSidebarManager';
import { PropertyKeyResizer } from './src/layout/PropertyKeyResizer';
import { MermaidZoomManager } from './src/mermaid/MermaidZoomManager';
import { OnboardingManager } from './src/onboarding/OnboardingManager';
import { FirstRunCleanup } from './src/onboarding/FirstRunCleanup';
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
	private tabGroupGuard: SingleTabGroupGuard;
	private pinManager: PinManager;
	private homePage: HomePageManager;
	private emptyViewButton: EmptyViewButtonManager;
	private dragBar: DragBarManager;
	private sidebarLayout: SidebarLayoutManager;
	private sidebarSuggestFocus: SidebarSuggestFocusTracker;
	private responsiveSidebar: ResponsiveSidebarManager;
	private propertyKeyResizer: PropertyKeyResizer;
	private mermaidZoom: MermaidZoomManager;
	private onboarding: OnboardingManager;
	// 一次性首次启用收拢；无持久副作用，不进 features[]。
	private firstRunCleanup: FirstRunCleanup;

	// 所有功能单元，统一用于卸载，避免逐个手写 remove() 时遗漏。
	private features: Feature[] = [];

	async onload() {
		await this.loadSettings();
		setLang(this.settings.language);

		const settings = () => this.settings;
		this.bodyClasses = new BodyClassController(settings);
		this.fontLoader = new FontLoader(settings);
		this.themeLoader = new ThemeLoader(settings);
		this.engine = new SinglePageEngine(this.app, settings);
		this.tabGroupGuard = new SingleTabGroupGuard(this.app, settings, (leaf) => this.engine.adoptLeaf(leaf));
		this.pinManager = new PinManager(this.app, settings);
		this.homePage = new HomePageManager(this.app, settings, this.engine);
		this.emptyViewButton = new EmptyViewButtonManager(this.app, settings, this.engine);
		this.dragBar = new DragBarManager(
			this.app,
			settings,
			() => this.engine.getNavHistory(),
			(index) => this.engine.navigateHistoryTo(index),
			(key) => this.engine.getNavDisplayName(key),
		);
		// active-leaf-change 未触发时（如 deferred 视图经 revealLeaf 显示），引擎记录导航后
		// 直接驱动面包屑刷新，使其与历史栈保持同步。
		this.engine.setNavChangeListener((leaf) => this.dragBar.notifyNavChange(leaf));
		this.sidebarLayout = new SidebarLayoutManager(this.app, settings, this.pinManager);
		this.sidebarSuggestFocus = new SidebarSuggestFocusTracker();
		this.responsiveSidebar = new ResponsiveSidebarManager(this.app);
		this.propertyKeyResizer = new PropertyKeyResizer(settings, () => this.saveData(this.settings));
		this.mermaidZoom = new MermaidZoomManager(this.app);
		this.onboarding = new OnboardingManager(this.app, settings, () => this.saveData(this.settings));
		this.firstRunCleanup = new FirstRunCleanup(this.app, async () => {
			this.settings.firstRunCleanupDone = true;
			await this.saveData(this.settings);
		});

		this.features = [
			this.bodyClasses,
			this.fontLoader,
			this.themeLoader,
			this.engine,
			this.tabGroupGuard,
			this.pinManager,
			this.homePage,
			this.emptyViewButton,
			this.dragBar,
			this.sidebarLayout,
			this.sidebarSuggestFocus,
			this.responsiveSidebar,
			this.propertyKeyResizer,
			this.mermaidZoom,
			this.onboarding,
		];

		// 立即生效的部分
		await this.fontLoader.apply();
		void this.themeLoader.apply();
		this.bodyClasses.apply();
		this.applyRibbon();
		this.sidebarSuggestFocus.apply();
		this.propertyKeyResizer.apply();
		this.pinManager.apply();
		this.engine.apply();
		this.mermaidZoom.apply();
		this.onboarding.apply();

		// 依赖 workspace 布局就绪的部分
		this.app.workspace.onLayoutReady(() => {
			this.dragBar.apply();
			this.homePage.apply();
			this.emptyViewButton.apply();
			// 单页模式下强制主区域只剩一个标签组：监听 layout-change 兜底拖拽分屏，并立即收拢存量布局。
			this.tabGroupGuard.apply();
			// 首次启用：先把主区残留的多余标签页/分屏收成一个，再让首页逻辑在干净状态上运行。
			if (!this.settings.firstRunCleanupDone) void this.firstRunCleanup.run();
			void this.homePage.openHomePage();
			void this.sidebarLayout.apply();
			// 窗口宽度自适应收起左侧栏：依赖 leftSplit 与窗口尺寸就绪。
			this.responsiveSidebar.apply();
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

	// 设置里更换首页后：把主区收拢为只剩首页一个 tab，面包屑也只剩首页。
	// 仅在首页路径真正变化时由 SettingTab 调用，避免每次保存设置都误关标签。
	async resetToHomePage() {
		await this.engine.resetToHomePage();
	}

	// ─── Body Classes ─────────────────────────────────────────────────────────

	applyBodyClasses() {
		this.bodyClasses.apply();
	}

	// ─── Ribbon ───────────────────────────────────────────────────────────────

	// 左侧 ribbon（活动栏）的显隐由 Obsidian 1.8 起自己接管：原生 showRibbon 配置驱动
	// body.show-ribbon，并以 `body:not(.show-ribbon) .workspace-ribbon{display:none}` 隐藏。
	// 插件单靠自家 CSS 只能再叠一层 display:none，无法盖过原生隐藏——所以这里直接写原生配置，
	// 与 Obsidian 设置面板里那个开关同源（setConfig 会触发 updateRibbonDisplay 立即生效）。
	applyRibbon() {
		type ConfigVault = { setConfig(key: string, value: unknown): void };
		(this.app.vault as unknown as ConfigVault).setConfig('showRibbon', this.settings.showRibbon);
	}

	// ─── Theme ────────────────────────────────────────────────────────────────

	// 重新注入当前 theme 字段对应的主题 CSS 与字体（切换主题时调用）。
	// 字体随主题分发（theme/<name>/fonts/），故主题切换时一并重载。
	async applyTheme() {
		this.themeLoader.apply();
		await this.fontLoader.apply();
		// 主题切换后，注入的本地关系图（canvas）颜色仍是旧主题——它只在注入时
		// 通过 renderer.testCSS() 探测一次 CSS 颜色。这里就地重新探测，无需重建侧边栏。
		this.sidebarLayout.reapplyGraphColors();
	}

	// 列出所有可选主题名（内嵌清单），供设置面板下拉框使用。
	listThemes(): string[] {
		return this.themeLoader.listThemes();
	}

	// ─── Settings ─────────────────────────────────────────────────────────────

	async loadSettings() {
		const saved = (await this.loadData()) as Partial<MinimalismUISettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
		// 区分全新安装与老用户升级：data.json 已存在但没有 firstRunCleanupDone 字段 → 老用户，
		// 标记为已完成并落盘，避免在其既有布局上误关标签页。全新安装（saved 为空）保持默认
		// false，由 onLayoutReady 触发一次收拢。
		if (saved && saved.firstRunCleanupDone === undefined) {
			this.settings.firstRunCleanupDone = true;
			await this.saveData(this.settings);
		}
	}

	// 设置变更后重新应用对设置敏感的功能单元。
	// 侧边栏（开销大）走独立的 applyMacSidebarLayout；mermaid 在运行时读设置，无需重应用。
	async saveSettings() {
		await this.saveData(this.settings);
		this.bodyClasses.apply();
		this.applyRibbon();
		this.pinManager.apply();
		this.engine.apply();
		this.tabGroupGuard.apply();
		this.dragBar.apply();
		this.homePage.apply();
		this.emptyViewButton.apply();
		this.onboarding.apply();
	}
}
