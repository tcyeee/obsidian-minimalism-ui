const translations = {
	zh: {
		headingAppearance: '外观设置',
		headingInteraction: '交互设置',

		macSidebar: '极简侧边栏',
		macSidebarDesc: '为左侧边栏应用磨砂玻璃背景与圆角高亮，打造 macOS 原生风格。',

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

		singlePage: '单页模式',
		singlePageDesc1: '1. 隐藏顶部标签栏，每次只展示一篇笔记。',
		singlePageDesc2: '2. 启用页面缓存，在内存中保留最近访问的 10 个页面',
		singlePageDesc3: '3. 禁用 pin 标签功能，避免多余的标签被固定在顶部。',

		navAnimation: '页面加载动画 (beta)',
		navAnimationDesc: '前进或后退时，为目标页面播放滑入动画',
	},
	en: {
		headingAppearance: 'Appearance',
		headingInteraction: 'Interaction',

		macSidebar: 'Minimal Sidebar',
		macSidebarDesc: 'Apply a frosted-glass background and rounded highlights to the left sidebar for a macOS-native look.',

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
	},
} as const;

type Lang = keyof typeof translations;
type Key = keyof typeof translations['en'];

function detectLang(): Lang {
	const lang = document.documentElement.lang?.slice(0, 2) ?? 'en';
	return (lang in translations ? lang : 'en') as Lang;
}

export function t(key: Key): string {
	return translations[detectLang()][key];
}
