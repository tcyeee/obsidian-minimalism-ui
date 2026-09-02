import { uiDoc } from './appDom';

const translations = {
	zh: {
		language: '语言',
		languageAuto: '跟随系统',
		languageZh: '中文',
		languageEn: 'English',

		introTitle: '使用前必读',
		introDesc1: '本插件是一款"做减法"的工具,设计理念与主流用法相悖:它只保留左侧边栏(默认空白,可自行添加大纲、属性、本地关系图等面板,最多 4 个),并裁剪掉了大量核心功能,甚至包括"文件夹"。安装前请先确认你认同这套极简理念。',
		introDesc2: '请指定一篇笔记作为首页。它如同一棵树的主干,你在其上用双链不断新建笔记,让知识开枝散叶,最终长成参天大树。',

		headingGeneral: '通用设置',
		headingAppearance: '左侧边栏样式',
		headingInteraction: '交互设置',
		headingAnimation: '动画设置 (beta)',
		headingAdvanced: '高级设置',

		showProperties: '属性面板',
		showLocalGraph: '本地关系图',
		showVaultProfile: '底部用户设置区域',

		leftSidebarPanels: '面板配置',
		leftSidebarPanelsDesc: '选择要显示在左侧栏的面板，最多 4 个，可拖拽排序。默认空白。',
		leftSidebarPanelsEmpty: '左侧栏当前为空白。点击「添加面板」选择要显示的内容。',
		leftSidebarPanelsFull: '已达到 4 个面板上限。',
		sidebarEmptyHint: '左侧栏还没有面板。前往「设置 → 左侧边栏样式」添加大纲、属性、本地关系图等面板。',
		addPanel: '添加面板',
		removePanel: '移除面板',
		dragToReorder: '拖拽排序',

		showRightSidebarButton: '右侧栏悬浮按钮',
		showRightSidebarButtonDesc: '在右下角显示一个悬浮按钮，用于展开/收起右侧边栏（供依赖右侧栏的插件，如 AI 对话插件使用）。',
		rightSidebarButtonLabel: '右侧边栏',
		rightSidebarPanelEmpty: '右侧边栏暂无内容',
		rightSidebarPanelPin: '固定面板（失焦/Esc 不再关闭）',
		rightSidebarPanelUnpin: '取消固定',
		rightSidebarPanelExpand: '在主区打开',
		rightSidebarStowExpand: '展开已收纳的视图',
		rightSidebarStowCollapse: '收起视图列表',

		theme: '主题',

		homePage: '笔记首页',
		homePageDesc: '设置一个笔记作为首页。Obsidian 启动时自动打开，关闭所有标签后自动返回。',
		homePagePlaceholder: '输入笔记路径，例如：src/Home.md',
		goHome: '回到主页',

		singlePage: '开启单页模式',
		singlePageDesc1: '1. 隐藏顶部标签栏，每次只展示一篇笔记。',
		singlePageDesc2: '2. 启用页面缓存，在内存中保留最近访问的 10 个页面。',
		singlePageDesc3: '3. 禁止通过右键菜单 pin（固定）标签页。',
		singlePageDesc4: '4. 在顶部拖拽栏显示访问路径（面包屑），方便追踪导航历史。',

		navAnimation: '页面加载动画',
		navAnimationDesc: '前进或后退时，为目标页面播放滑入动画',

		onboardingTitle: '新手任务',
		onboardingCreateNote: '使用快捷键新建一篇名为 Index 的笔记',
		onboardingSetHome: '将 Index 设置为主页',
		onboardingOpenSettings: '去设置',
		onboardingLinkNote: '在 Index 里输入 [[ 关联一篇新笔记',
		onboardingGoBack: '使用快捷键后退',
		onboardingGoForward: '使用快捷键前进',
		onboardingAllDone: '全部完成，开始你的写作吧！',
		onboardingSkip: '跳过教程',

		filenamePrefixManual: '手动隐藏时间戳前缀',
		filenamePrefixManualDesc: '关闭时自动跟随 Obsidian「唯一笔记创建器」配置的时间戳格式剥离前缀（含其后的分隔符），无需设置；开启后改为下方手动指定要隐藏的位数。',
		filenamePrefixLength: '指定时间戳前缀长度',
		filenamePrefixLengthDesc: '隐藏文件名开头的时间戳前缀，如隐藏 "202604111230-test" 前 13 个字符，在导航栏中显示为 test（0 = 不隐藏，最多 20）。',

		graphView: '关系图',
		localGraph: '本地关系图',

		navBack: '后退',
		navForward: '前进',

		editorLockAriaReading: '阅读模式（已锁定）',

		statusBarMenuLabel: '操作菜单',
		statusBarMenuModeLocked: '锁定（阅读模式）',
		statusBarMenuModeEdit: '编辑（实时预览）',
		statusBarMenuModeSource: '源码模式',
		statusBarMenuRename: '重命名笔记',
		statusBarMenuDelete: '删除笔记',
		statusBarMenuExportPdf: '导出为 PDF',
		statusBarMenuExportPdfFailed: '导出失败：命令不可用',
		statusBarMenuOpenDefaultApp: '使用默认软件打开',
		statusBarMenuToggleLeftSidebar: '左侧边栏',
		statusBarMenuToggleRightSidebar: '右侧边栏',
		statusBarMenuPluginSettings: '插件设置',
		renameModalTitle: '重命名笔记',
		renameModalPlaceholder: '输入新文件名',
		renameModalConfirm: '重命名',
		renameModalCancel: '取消',
		renameModalFailed: '重命名失败，请检查新文件名是否已被占用',
		deleteModalTitle: '删除笔记',
		deleteModalMessage: '确定要删除这篇笔记吗？',
		deleteModalConfirm: '删除',
		deleteModalCancel: '取消',
		deleteModalFailed: '删除失败',
	},
	en: {
		language: 'Language',
		languageAuto: 'Follow system',
		languageZh: '中文',
		languageEn: 'English',

		introTitle: 'Read this before you start',
		introDesc1: 'This plugin is all about subtraction, and its philosophy runs against mainstream usage: it keeps only the left sidebar (empty by default — add up to 4 panels such as Outline, Properties, and Local Graph yourself) and strips away many core features, including Folders. Make sure this minimalist philosophy suits you before installing.',
		introDesc2: 'Pick one note as your home page. Think of it as the trunk of a tree: keep creating notes from it through backlinks, letting your knowledge branch out until it grows into a towering tree.',

		headingGeneral: 'General',
		headingAppearance: 'Left sidebar',
		headingInteraction: 'Interaction',
		headingAnimation: 'Animation (beta)',
		headingAdvanced: 'Advanced',

		showProperties: 'Properties',
		showLocalGraph: 'Local Graph',
		showVaultProfile: 'Bottom settings area',

		leftSidebarPanels: 'Panel configuration',
		leftSidebarPanelsDesc: 'Choose which panels appear in the left sidebar. Up to 4, drag to reorder. Empty by default.',
		leftSidebarPanelsEmpty: 'The left sidebar is empty. Click "Add panel" to choose what to show.',
		leftSidebarPanelsFull: 'Panel limit of 4 reached.',
		sidebarEmptyHint: 'No panels in the left sidebar yet. Add panels like Outline, Properties, or Local Graph from Settings → Left sidebar.',
		addPanel: 'Add panel',
		removePanel: 'Remove panel',
		dragToReorder: 'Drag to reorder',

		showRightSidebarButton: 'Right sidebar button',
		showRightSidebarButtonDesc: 'Show a floating button in the bottom-right corner to expand/collapse the right sidebar (for plugins that need it, e.g. AI chat plugins).',
		rightSidebarButtonLabel: 'Right sidebar',
		rightSidebarPanelEmpty: 'Nothing in the right sidebar yet',
		rightSidebarPanelPin: 'Pin panel (stays open on blur/Esc)',
		rightSidebarPanelUnpin: 'Unpin',
		rightSidebarPanelExpand: 'Open in main area',
		rightSidebarStowExpand: 'Show stowed views',
		rightSidebarStowCollapse: 'Collapse view list',

		theme: 'Theme',

		homePage: 'Home note',
		homePageDesc: 'A note that opens automatically on startup and whenever all tabs are closed.',
		homePagePlaceholder: 'Note path, e.g. src/Home.md',
		goHome: 'Back to Home',

		singlePage: 'Single-page mode',
		singlePageDesc1: '1. Hide the tab bar — show one note at a time.',
		singlePageDesc2: '2. Keep the 10 most recently visited notes cached in memory.',
		singlePageDesc3: '3. Prevent pinning tabs via the right-click menu.',
		singlePageDesc4: '4. Show a breadcrumb trail in the drag bar to track navigation history.',

		navAnimation: 'Page transition animation',
		navAnimationDesc: 'Play a slide-in animation when navigating back or forward.',

		onboardingTitle: 'Getting started',
		onboardingCreateNote: 'Create a note named Index with the shortcut',
		onboardingSetHome: 'Set Index as your home page',
		onboardingOpenSettings: 'Open settings',
		onboardingLinkNote: 'In Index, type [[ to link a new note',
		onboardingGoBack: 'Go back with the shortcut',
		onboardingGoForward: 'Go forward with the shortcut',
		onboardingAllDone: 'All set — start writing!',
		onboardingSkip: 'Skip tutorial',

		filenamePrefixManual: 'Manually hide timestamp prefix',
		filenamePrefixManualDesc: 'When off, automatically follows the timestamp format configured in Obsidian\'s "Unique note creator" core plugin to strip the prefix (and the separator after it) — no setup needed. When on, manually specify the length to hide below.',
		filenamePrefixLength: 'Timestamp prefix length',
		filenamePrefixLengthDesc: 'Hide the timestamp prefix at the start of a filename. E.g. hide the first 13 characters of "202604111230-test" so it shows as "test" in the navigation (0 = off, max 20).',

		graphView: 'Graph view',
		localGraph: 'Local Graph',

		navBack: 'Back',
		navForward: 'Forward',

		editorLockAriaReading: 'Reading view (locked)',

		statusBarMenuLabel: 'Actions menu',
		statusBarMenuModeLocked: 'Locked (Reading view)',
		statusBarMenuModeEdit: 'Edit (Live Preview)',
		statusBarMenuModeSource: 'Source mode',
		statusBarMenuRename: 'Rename note',
		statusBarMenuDelete: 'Delete note',
		statusBarMenuExportPdf: 'Export to PDF',
		statusBarMenuExportPdfFailed: 'Export failed: command unavailable',
		statusBarMenuOpenDefaultApp: 'Open with default app',
		statusBarMenuToggleLeftSidebar: 'Left sidebar',
		statusBarMenuToggleRightSidebar: 'Right sidebar',
		statusBarMenuPluginSettings: 'Plugin settings',
		renameModalTitle: 'Rename note',
		renameModalPlaceholder: 'Enter new filename',
		renameModalConfirm: 'Rename',
		renameModalCancel: 'Cancel',
		renameModalFailed: 'Rename failed — the new filename may already be taken',
		deleteModalTitle: 'Delete note',
		deleteModalMessage: 'Are you sure you want to delete this note?',
		deleteModalConfirm: 'Delete',
		deleteModalCancel: 'Cancel',
		deleteModalFailed: 'Delete failed',
	},
} as const;

type Lang = keyof typeof translations;
type Key = keyof typeof translations['en'];

let langOverride: Lang | null = null;

export function setLang(lang: 'auto' | 'zh' | 'en') {
	langOverride = lang === 'auto' ? null : lang;
}

function detectLang(): Lang {
	if (langOverride) return langOverride;
	const lang = uiDoc().documentElement.lang?.slice(0, 2) ?? 'en';
	return (lang in translations ? lang : 'en') as Lang;
}

export function t(key: Key): string {
	return translations[detectLang()][key];
}

/** Resolved language ('zh' | 'en') after applying the auto/zh/en override — drives CSS lang body class. */
export function getLang(): Lang {
	return detectLang();
}
