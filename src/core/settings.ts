export interface MinimalismUISettings {
	showProperties: boolean;
	showLocalGraph: boolean;
	showVaultProfile: boolean;
	ribbonPanelExpanded: boolean;
	hideTabBar: boolean;
	disableNoteTabs: boolean;
	enableNavAnimation: boolean;
	theme: string;
	homePage: string;
	filenamePrefixManual: boolean;
	filenamePrefixLength: number;
	// 侧边栏 Properties 的 label（key）列宽，单位 px；由拖拽右边缘把手实时调整，全局共享、跨重启持久化。
	propertyKeyWidth: number;
	language: 'auto' | 'zh' | 'en';
	collapsedSections: Record<string, boolean>;
	onboarding: boolean;
	// 内部标记（无 UI）：已完成的新手任务，以任务 label 为键，跨重启持久化。
	onboardingDone: string[];
	// 内部标记（无 UI）：首次启用插件时的一次性多余 leaf 收拢是否已执行。
	firstRunCleanupDone: boolean;
	// 右下角悬浮按钮：展开/收起右侧边栏（供依赖右侧栏的第三方插件，如 AI 对话插件使用）。
	showRightSidebarButton: boolean;
	// 右侧栏悬浮面板的宽/高，单位 px；由左上角把手拖拽调整，跨重启持久化。
	rightSidebarPanelWidth: number;
	rightSidebarPanelHeight: number;
	// 右侧栏悬浮面板是否被用户 pin 住：pin 后失焦/Esc 均不关闭面板，仅能点击右下角
	// 悬浮按钮关闭；跨重启持久化，因此关闭后再次打开 pin 状态依然保留。
	rightSidebarPanelPinned: boolean;
	// 右下角视图图标堆叠的自定义顺序 + 收纳分界，按 leaf 的 view type 字符串存储，
	// 混入一个收纳图标哨兵（常量定义在 RightSidebarButtonManager 内，此处不耦合具体值）；
	// 哨兵左侧的 key 默认隐藏，右侧默认可见。跨重启持久化。
	// 已知局限：无法区分同一 view type 的多个 leaf（如两篇笔记被拖进右侧栏）。
	// 空数组表示“哨兵隐式在最前，所有已发现视图可见”。
	rightSidebarStackOrder: string[];
}

export const DEFAULT_SETTINGS: MinimalismUISettings = {
	// 除高级功能外，所有功能默认开启
	showProperties: true,
	showLocalGraph: true,
	showVaultProfile: true,
	// 默认展开：首次安装即可看到 ribbon 图标
	ribbonPanelExpanded: true,
	hideTabBar: true,
	disableNoteTabs: true,
	enableNavAnimation: true,
	theme: 'forest',
	homePage: '',
	// 高级功能（文件名前缀）默认关闭
	filenamePrefixManual: false,
	filenamePrefixLength: 0,
	// 默认 100px，与历史固定列宽一致
	propertyKeyWidth: 100,
	language: 'auto',
	// 动画与高级设置区块默认折叠
	collapsedSections: { animation: true, advanced: true },
	onboarding: true,
	// 默认无已完成任务；loadSettings 合并后老用户也会得到空数组。
	onboardingDone: [],
	// 默认未执行；仅全新安装会保持 false 并触发一次收拢，老用户在 loadSettings 里被置 true。
	firstRunCleanupDone: false,
	showRightSidebarButton: true,
	rightSidebarPanelWidth: 360,
	rightSidebarPanelHeight: 480,
	rightSidebarPanelPinned: false,
	rightSidebarStackOrder: [],
};
