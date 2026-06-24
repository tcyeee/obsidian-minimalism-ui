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
};
