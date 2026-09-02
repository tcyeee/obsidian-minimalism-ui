import { Plugin } from 'obsidian';
import { MinimalismUISettings, DEFAULT_SETTINGS } from './src/core/settings';
import { Feature } from './src/core/Feature';
import { LeafMountService } from './src/core/LeafMountService';
import { FontLoader } from './src/core/FontLoader';
import { ThemeLoader } from './src/core/ThemeLoader';
import { BodyClassController } from './src/core/BodyClassController';
import { SinglePageEngine } from './src/single-page/SinglePageEngine';
import { SingleTabGroupGuard } from './src/single-page/SingleTabGroupGuard';
import { PinManager } from './src/tabs/PinManager';
import { HomePageManager } from './src/single-page/HomePageManager';
import { EmptyViewButtonManager } from './src/single-page/EmptyViewButtonManager';
import { DragBarManager } from './src/layout/DragBarManager';
import { LeftSidebarManager } from './src/layout/LeftSidebarManager';
import { SidebarSuggestFocusTracker } from './src/layout/SidebarSuggestFocusTracker';
import { ResponsiveSidebarManager } from './src/layout/ResponsiveSidebarManager';
import { PropertyKeyResizer } from './src/layout/PropertyKeyResizer';
import { RibbonPanelManager } from './src/layout/RibbonPanelManager';
import { EditorStatusManager } from './src/layout/EditorStatusManager';
import { StatusBarMenuManager } from './src/layout/StatusBarMenuManager';
import { MermaidZoomManager } from './src/mermaid/MermaidZoomManager';
import { RightSidebarButtonManager } from './src/right-sidebar/RightSidebarButtonManager';
import { OnboardingManager } from './src/onboarding/OnboardingManager';
import { FirstRunCleanup } from './src/onboarding/FirstRunCleanup';
import { MinimalismUISettingTab } from './src/SettingTab';
import { setLang } from './src/core/i18n';

export type { MinimalismUISettings };

// ─── Main Plugin ──────────────────────────────────────────────────────────────

export default class MinimalismUIPlugin extends Plugin {
	settings: MinimalismUISettings;

	private leafMount: LeafMountService;
	private bodyClasses: BodyClassController;
	private fontLoader: FontLoader;
	private themeLoader: ThemeLoader;
	private engine: SinglePageEngine;
	private tabGroupGuard: SingleTabGroupGuard;
	private pinManager: PinManager;
	private homePage: HomePageManager;
	private emptyViewButton: EmptyViewButtonManager;
	private dragBar: DragBarManager;
	private leftSidebar: LeftSidebarManager;
	private sidebarSuggestFocus: SidebarSuggestFocusTracker;
	private responsiveSidebar: ResponsiveSidebarManager;
	private propertyKeyResizer: PropertyKeyResizer;
	private ribbonPanel: RibbonPanelManager;
	private editorStatus: EditorStatusManager;
	private statusBarMenu: StatusBarMenuManager;
	private mermaidZoom: MermaidZoomManager;
	private rightSidebarButton: RightSidebarButtonManager;
	private onboarding: OnboardingManager;
	// 一次性首次启用收拢；无持久副作用，不进 features[]。
	private firstRunCleanup: FirstRunCleanup;

	// 所有功能单元，统一用于卸载，避免逐个手写 remove() 时遗漏。
	private features: Feature[] = [];
	// workspace.onLayoutReady() 的回调挂在 Workspace 自身的队列上，不随插件卸载而取消；
	// 若插件在布局就绪前被禁用，onunload() 跑完之后该回调仍会触发，对已卸载的实例重新
	// apply() 一遍。用这个标志在回调入口短路，避免卸载后的幽灵重新应用。
	private unloaded = false;

	async onload() {
		await this.loadSettings();
		setLang(this.settings.language);

		const settings = () => this.settings;
		this.leafMount = new LeafMountService(this.app);
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
			() => this.engine.goBack(),
			() => this.engine.goForward(),
			() => this.engine.canGoBack(),
			() => this.engine.canGoForward(),
		);
		// active-leaf-change 未触发时（如 deferred 视图经 revealLeaf 显示），引擎记录导航后
		// 直接驱动面包屑刷新，使其与历史栈保持同步。
		this.engine.setNavChangeListener((leaf) => this.dragBar.notifyNavChange(leaf));
		this.leftSidebar = new LeftSidebarManager(this.app, settings, this.leafMount, this.pinManager);
		this.sidebarSuggestFocus = new SidebarSuggestFocusTracker();
		this.responsiveSidebar = new ResponsiveSidebarManager(this.app);
		this.propertyKeyResizer = new PropertyKeyResizer(settings, () => this.saveData(this.settings));
		this.ribbonPanel = new RibbonPanelManager(settings, () => this.saveSettings());
		this.editorStatus = new EditorStatusManager(this.app, this);
		this.mermaidZoom = new MermaidZoomManager(this.app);
		this.rightSidebarButton = new RightSidebarButtonManager(this.app, settings, () => this.saveData(this.settings), this.leafMount);
		// 左侧栏 slot 当前占用的 view type 是右侧栏悬浮面板避让的单一事实源。
		this.rightSidebarButton.setManagedLeftViewTypesProvider(() => this.leftSidebar.getOwnedViewTypes());
		// 状态栏菜单里的「右侧边栏」开关现在控制右下角悬浮框（minimalism-ui-rsb-launcher）的显隐，
		// 即 showRightSidebarButton 设置；saveSettings() 会触发 rightSidebarButton.apply() 注入/拆除 DOM。
		this.statusBarMenu = new StatusBarMenuManager(this.app, this, {
			getVisible: () => this.settings.showRightSidebarButton,
			setVisible: (visible) => {
				this.settings.showRightSidebarButton = visible;
				void this.saveSettings();
			},
		});
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
			this.leftSidebar,
			this.sidebarSuggestFocus,
			this.responsiveSidebar,
			this.propertyKeyResizer,
			this.mermaidZoom,
			this.onboarding,
			this.rightSidebarButton,
			this.ribbonPanel,
			this.editorStatus,
			this.statusBarMenu,
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
		this.editorStatus.apply();
		this.mermaidZoom.apply();
		this.onboarding.apply();
		this.rightSidebarButton.apply();
		this.statusBarMenu.apply();

		// 依赖 workspace 布局就绪的部分
		this.app.workspace.onLayoutReady(() => {
			if (this.unloaded) return;
			this.dragBar.apply();
			this.homePage.apply();
			this.emptyViewButton.apply();
			// 单页模式下强制主区域只剩一个标签组：监听 layout-change 兜底拖拽分屏，并立即收拢存量布局。
			this.tabGroupGuard.apply();
			// 首次启用：先把主区残留的多余标签页/分屏收成一个，再让首页逻辑在干净状态上运行。
			if (!this.settings.firstRunCleanupDone) void this.firstRunCleanup.run();
			// 启动专用入口：主区域已由 workspace 恢复出笔记时不跳首页，只把首页钉进面包屑。
			void this.homePage.openHomePageOnStartup();
			void this.leftSidebar.apply();
			// 窗口宽度自适应收起左侧栏：依赖 leftSplit 与窗口尺寸就绪。
			this.responsiveSidebar.apply();
			// 将 .side-dock-actions 迁移至侧边栏内嵌可折叠面板。
			this.ribbonPanel.apply();
		});

		this.addSettingTab(new MinimalismUISettingTab(this.app, this));
	}

	onunload() {
		this.unloaded = true;
		setLang('auto');
		for (const feature of this.features) feature.remove();
	}

	// ─── Sidebar Layout ───────────────────────────────────────────────────────

	async applyMacSidebarLayout(opts?: { revealNewPanels?: boolean }) {
		await this.leftSidebar.apply(opts);
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

	// 左侧 ribbon 始终隐藏：图标迁移至侧边栏内嵌 RibbonPanelManager。
	// setConfig 立即触发 Obsidian 内部 updateRibbonDisplay，比插件 CSS 更可靠。
	applyRibbon() {
		type ConfigVault = { setConfig(key: string, value: unknown): void };
		(this.app.vault as unknown as ConfigVault).setConfig('showRibbon', false);
	}

	// ─── Theme ────────────────────────────────────────────────────────────────

	// 重新注入当前 theme 字段对应的主题 CSS 与字体（切换主题时调用）。
	// 字体随主题分发（theme/<name>/fonts/），故主题切换时一并重载。
	async applyTheme() {
		this.themeLoader.apply();
		await this.fontLoader.apply();
		// 主题切换后，注入的本地关系图（canvas）颜色仍是旧主题——它只在注入时
		// 通过 renderer.testCSS() 探测一次 CSS 颜色。这里就地重新探测，无需重建侧边栏。
		this.leftSidebar.reapplyGraphColors();
	}

	// 列出所有可选主题名（内嵌清单），供设置面板下拉框使用。
	listThemes(): string[] {
		return this.themeLoader.listThemes();
	}

	// 左侧栏 slot 下拉框的候选：全部已注册的工具类 view type + 人类可读标签。
	// 标签优先取当前已打开的同类型 leaf 的 getDisplayText()（Obsidian 已本地化）；没有已打开
	// leaf 时把 type 字符串转成词组兜底。按标签排序。见 SettingTab 的左侧栏面板列表 UI。
	listSidebarViewOptions(): { type: string; label: string }[] {
		const humanize = (s: string): string =>
			s.replace(/[-_]+/g, ' ').replace(/^./, c => c.toUpperCase());
		return this.leafMount.allRegisteredToolViewTypes()
			.map(type => {
				let label = '';
				try {
					label = this.app.workspace.getLeavesOfType(type)[0]?.getDisplayText() ?? '';
				} catch {
					label = '';
				}
				return { type, label: label || humanize(type) };
			})
			.sort((a, b) => a.label.localeCompare(b.label));
	}

	// ─── Settings ─────────────────────────────────────────────────────────────

	async loadSettings() {
		const saved = (await this.loadData()) as Partial<MinimalismUISettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);

		// 「隐藏大纲按钮」已不再提供开关，恒为开启：覆盖老用户可能关掉的旧值。
		this.settings.hideTabBar = true;

		// 迁移旧 data.json（没有 leftSidebarSlots 字段）：新形态下左侧栏默认完全空白，老用户升级后
		// 也一并清空——旧的固定三面板全部移除，用户可在设置页自行添加。旧开关值一并归零。
		if (saved && !Array.isArray(saved.leftSidebarSlots)) {
			this.settings.leftSidebarSlots = [];
			this.settings.showProperties = false;
			this.settings.showLocalGraph = false;
			await this.saveData(this.settings);
		}
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
		this.rightSidebarButton.apply();
	}
}
