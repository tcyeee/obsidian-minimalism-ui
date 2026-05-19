const translations = {
	zh: {
		language: '语言',
		languageAuto: '跟随系统',
		languageZh: '中文',
		languageEn: 'English',

		headingAppearance: '外观设置',
		headingInteraction: '单页模式设置',

		macSidebar: '极简侧边栏',
		macSidebarDesc: '为左侧边栏应用磨砂玻璃背景与圆角高亮，打造 macOS 原生风格。',
		showProperties: '显示属性面板',
		showPropertiesDesc: '在侧边栏左下角显示当前笔记的属性（Properties）。',
		showLocalGraph: '显示本地关系图',
		showLocalGraphDesc: '在侧边栏显示当前笔记的本地关系图（Local Graph），位于属性面板上方。',

		hideTabBar: '极简信息栏',
		hideTabBarDesc: '隐藏左侧属性栏的操作按钮，以及大纲、反向链接面板中的搜索框',

		noteStyle: '笔记样式优化',
		noteStyleDesc: '对编辑器与阅读视图应用以下定制样式：',
		noteStyleItem1: '字体：正文数字使用 JetBrains Mono 等宽字体混排',
		noteStyleItem2: '引用块、表格、代码块：Forest 风格样式定制',
		noteStyleItem3: 'Mermaid 图表：超宽图表默认缩放显示全图，点击后查看原始尺寸',

		homePage: '笔记首页',
		homePageDesc: '设置一个笔记作为首页。Obsidian 启动时自动打开，关闭所有标签后自动返回。',
		homePagePlaceholder: '输入笔记路径，例如：src/Home.md',

		singlePage: '开启单页模式',
		singlePageDesc1: '1. 隐藏顶部标签栏，每次只展示一篇笔记。',
		singlePageDesc2: '2. 启用页面缓存，在内存中保留最近访问的 10 个页面',
		singlePageDesc3: '3. 禁用 pin 标签功能，避免多余的标签被固定在顶部。',

		navAnimation: '页面加载动画 (beta)',
		navAnimationDesc: '前进或后退时，为目标页面播放滑入动画',

		filenamePrefixLength: '隐藏文件名前缀',
		filenamePrefixLengthDesc: '在文件浏览器和标签页中隐藏文件名开头的 N 个字符（0 = 不隐藏，最多 20）。适用于时间戳前缀笔记，如隐藏 "202604111230-" 前 13 个字符。',
	},
	en: {
		language: 'Language',
		languageAuto: 'Follow system',
		languageZh: '中文',
		languageEn: 'English',

		headingAppearance: 'Appearance',
		headingInteraction: 'Interaction',

		macSidebar: 'Minimal Sidebar',
		macSidebarDesc: 'Apply a frosted-glass background and rounded highlights to the left sidebar for a macOS-native look.',
		showProperties: 'Show Properties',
		showPropertiesDesc: 'Display the current note\'s properties at the bottom of the sidebar.',
		showLocalGraph: 'Show Local Graph',
		showLocalGraphDesc: 'Display the local graph for the current note in the sidebar, above the properties panel.',

		hideTabBar: 'Minimal Info Bar',
		hideTabBarDesc: 'Hide action buttons in the properties panel and search bars in the Outline / Backlinks panels.',

		noteStyle: 'Note Style',
		noteStyleDesc: 'Apply the following custom styles to the editor and reading view:',
		noteStyleItem1: 'Typography: JetBrains Mono for inline digits in body text',
		noteStyleItem2: 'Blockquotes, tables, code blocks: Forest-style design',
		noteStyleItem3: 'Mermaid diagrams: wide diagrams scale to fit by default; click to view at full size',

		homePage: 'Home Note',
		homePageDesc: 'A note that opens automatically on startup and whenever all tabs are closed.',
		homePagePlaceholder: 'Note path, e.g. src/Home.md',

		singlePage: 'Single-Page Mode',
		singlePageDesc1: '1. Hide the tab bar — show one note at a time.',
		singlePageDesc2: '2. Keep the 10 most recently visited notes cached in memory.',
		singlePageDesc3: '3. Disable tab pinning to prevent tabs from being pinned.',

		navAnimation: 'Page Transition Animation (beta)',
		navAnimationDesc: 'Play a slide-in animation when navigating back or forward.',

		filenamePrefixLength: 'Hide Filename Prefix',
		filenamePrefixLengthDesc: 'Hide the first N characters of filenames in the file explorer and tabs (0 = off, max 20). Useful for timestamp-prefixed notes, e.g. hide the first 13 chars of "202604111230-".',
	},
} as const;

type Lang = keyof typeof translations;
type Key = keyof typeof translations['en'];

let langOverride: Lang | null = null;

export function setLang(lang: 'auto' | 'zh' | 'en') {
	langOverride = lang === 'auto' ? null : lang as Lang;
}

function detectLang(): Lang {
	if (langOverride) return langOverride;
	const lang = document.documentElement.lang?.slice(0, 2) ?? 'en';
	return (lang in translations ? lang : 'en') as Lang;
}

export function t(key: Key): string {
	return translations[detectLang()][key];
}
