const translations = {
	zh: {
		language: '语言',
		languageAuto: '跟随系统',
		languageZh: '中文',
		languageEn: 'English',

		introTitle: '使用前必读',
		introDesc1: '本插件是一款"做减法"的工具,设计理念与主流用法相悖:它只保留左侧边栏(至多显示大纲、属性、本地关系图),并裁剪掉了大量核心功能,甚至包括"文件夹"。安装前请先确认你认同这套极简理念。',
		introDesc2: '请指定一篇笔记作为首页。它如同一棵树的主干,你在其上用双链不断新建笔记,让知识开枝散叶,最终长成参天大树。',
		introDesc3: '由于放弃了"文件夹",几乎所有笔记都平铺在根目录。建议开启时间戳前缀命名,为每篇笔记赋予唯一标识,从而避免重名冲突。',

		headingGeneral: '通用设置',
		headingAppearance: '侧边栏设置',
		headingInteraction: '交互设置',
		headingAnimation: '动画设置 (beta)',

		showProperties: '属性面板',
		showLocalGraph: '本地关系图',
		showVaultProfile: '底部用户设置区域',

		hideTabBar: '隐藏大纲按钮',

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

		filenamePrefixLength: '隐藏文件名时间戳前缀',
		filenamePrefixLengthDesc: '适用于时间戳前缀笔记，如隐藏 "202604111230-test" 前 13 个字符，实际在导航栏中显示为 test（0 = 不隐藏，最多 20）。',

		graphView: '关系图',
	},
	en: {
		language: 'Language',
		languageAuto: 'Follow system',
		languageZh: '中文',
		languageEn: 'English',

		introTitle: 'Read this before you start',
		introDesc1: 'This plugin is all about subtraction, and its philosophy runs against mainstream usage: it keeps only the left sidebar (showing at most Outline, Properties, and Local Graph) and strips away many core features, including Folders. Make sure this minimalist philosophy suits you before installing.',
		introDesc2: 'Pick one note as your home page. Think of it as the trunk of a tree: keep creating notes from it through backlinks, letting your knowledge branch out until it grows into a towering tree.',
		introDesc3: 'Since folders are gone, almost every note lives in the vault root. Enable timestamp-prefixed filenames to give each note a unique identifier and avoid name clashes.',

		headingGeneral: 'General',
		headingAppearance: 'Sidebar',
		headingInteraction: 'Interaction',
		headingAnimation: 'Animation (beta)',

		showProperties: 'Properties',
		showLocalGraph: 'Local Graph',
		showVaultProfile: 'Bottom Settings Area',

		hideTabBar: 'Hide Outline Button',

		theme: 'Theme',

		homePage: 'Home Note',
		homePageDesc: 'A note that opens automatically on startup and whenever all tabs are closed.',
		homePagePlaceholder: 'Note path, e.g. src/Home.md',
		goHome: 'Back to Home',

		singlePage: 'Single-Page Mode',
		singlePageDesc1: '1. Hide the tab bar — show one note at a time.',
		singlePageDesc2: '2. Keep the 10 most recently visited notes cached in memory.',
		singlePageDesc3: '3. Prevent pinning tabs via the right-click menu.',
		singlePageDesc4: '4. Show a breadcrumb trail in the drag bar to track navigation history.',

		navAnimation: 'Page Transition Animation',
		navAnimationDesc: 'Play a slide-in animation when navigating back or forward.',

		filenamePrefixLength: 'Hide Filename Timestamp Prefix',
		filenamePrefixLengthDesc: 'For timestamp-prefixed notes. E.g. hide the first 13 characters of "202604111230-test" so it shows as "test" in the navigation (0 = off, max 20).',

		graphView: 'Graph view',
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
	const lang = activeDocument.documentElement.lang?.slice(0, 2) ?? 'en';
	return (lang in translations ? lang : 'en') as Lang;
}

export function t(key: Key): string {
	return translations[detectLang()][key];
}
