const translations = {
	zh: {
		language: '语言',
		languageAuto: '跟随系统',
		languageZh: '中文',
		languageEn: 'English',

		introTitle: '使用前必读',
		introDesc1: '本插件是一款"做减法"的工具,设计理念与主流用法相悖:它只保留左侧边栏(至多显示大纲、属性、本地关系图),并裁剪掉了大量核心功能,甚至包括"文件夹"。安装前请先确认你认同这套极简理念。',
		introDesc2: '请指定一篇笔记作为首页。它如同一棵树的主干,你在其上用双链不断新建笔记,让知识开枝散叶,最终长成参天大树。',

		headingGeneral: '通用设置',
		headingAppearance: '侧边栏设置',
		headingInteraction: '交互设置',
		headingAnimation: '动画设置 (beta)',
		headingAdvanced: '高级设置',

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

		onboardingTitle: '新手任务',
		onboardingCreateNote: '使用快捷键新建一篇名为 Index 的笔记',
		onboardingSetHome: '将 Index 设置为主页',
		onboardingOpenSettings: '去设置',
		onboardingLinkNote: '在 Index 里输入 [[ 关联一篇新笔记',
		onboardingGoBack: '使用快捷键后退',
		onboardingGoForward: '使用快捷键前进',
		onboardingAllDone: '全部完成，开始你的写作吧！',

		filenamePrefixManual: '手动隐藏时间戳前缀',
		filenamePrefixManualDesc: '关闭时自动跟随 Obsidian「唯一笔记创建器」配置的时间戳格式剥离前缀（含其后的分隔符），无需设置；开启后改为下方手动指定要隐藏的位数。',
		filenamePrefixLength: '指定时间戳前缀长度',
		filenamePrefixLengthDesc: '隐藏文件名开头的时间戳前缀，如隐藏 "202604111230-test" 前 13 个字符，在导航栏中显示为 test（0 = 不隐藏，最多 20）。',

		graphView: '关系图',
		localGraph: '本地关系图',
	},
	en: {
		language: 'Language',
		languageAuto: 'Follow system',
		languageZh: '中文',
		languageEn: 'English',

		introTitle: 'Read this before you start',
		introDesc1: 'This plugin is all about subtraction, and its philosophy runs against mainstream usage: it keeps only the left sidebar (showing at most Outline, Properties, and Local Graph) and strips away many core features, including Folders. Make sure this minimalist philosophy suits you before installing.',
		introDesc2: 'Pick one note as your home page. Think of it as the trunk of a tree: keep creating notes from it through backlinks, letting your knowledge branch out until it grows into a towering tree.',

		headingGeneral: 'General',
		headingAppearance: 'Sidebar',
		headingInteraction: 'Interaction',
		headingAnimation: 'Animation (beta)',
		headingAdvanced: 'Advanced',

		showProperties: 'Properties',
		showLocalGraph: 'Local Graph',
		showVaultProfile: 'Bottom settings area',

		hideTabBar: 'Hide outline button',

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

		filenamePrefixManual: 'Manually hide timestamp prefix',
		filenamePrefixManualDesc: 'When off, automatically follows the timestamp format configured in Obsidian\'s "Unique note creator" core plugin to strip the prefix (and the separator after it) — no setup needed. When on, manually specify the length to hide below.',
		filenamePrefixLength: 'Timestamp prefix length',
		filenamePrefixLengthDesc: 'Hide the timestamp prefix at the start of a filename. E.g. hide the first 13 characters of "202604111230-test" so it shows as "test" in the navigation (0 = off, max 20).',

		graphView: 'Graph view',
		localGraph: 'Local Graph',
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

/** Resolved language ('zh' | 'en') after applying the auto/zh/en override — drives CSS lang body class. */
export function getLang(): Lang {
	return detectLang();
}
