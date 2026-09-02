// 左侧栏的一个用户添加的面板。整个列表最多 4 项，顺序即纵向 split 自上而下的顺序。
// 详见仓库根 TODO.md 的目标数据模型一节。
export interface SidebarSlot {
	// 稳定 id：供设置页列表渲染 / 拖拽排序做 key。新增用 `slot-<时间戳>`。
	id: string;
	// 任意已注册的工具类 view type（'outline' / 'file-properties' / 'localgraph' / 'backlink' …）。
	// 同一列表内不重复（设置页下拉框会排除已占用的类型）。
	viewType: string;
	// 预留：列表里的每一项都视为启用（添加即启用、移除即删除）。LeftSidebarManager 仍按此字段
	// 过滤，故新增项一律置 true。
	enabled: boolean;
	// 用户拖 resize handle 写入的高度。Obsidian 的 WorkspaceItem.setDimension() 取值是
	// flex-grow 数值（0 < n < 100，否则视为等分）——存这个值，null = 交给 split 等分 / 内容自适应。
	// （Phase 2 才写入；Phase 1 只读不写。）
	height: number | null;
}

// 上限：整个列表最多 4 项。
export const MAX_LEFT_SIDEBAR_SLOTS = 4;

// 默认空列表：全新安装时左侧栏完全空白，由用户在设置页自行添加面板。
// 老用户升级的迁移见 main.ts loadSettings。
export const DEFAULT_LEFT_SIDEBAR_SLOTS: SidebarSlot[] = [];

export interface MinimalismUISettings {
	// 废弃：旧固定三面板的开关。由 leftSidebarSlots 取代，仅 loadSettings 迁移时读一次旧值。
	showProperties: boolean;
	showLocalGraph: boolean;
	showVaultProfile: boolean;
	// 左侧栏面板列表。用户在设置页添加 / 删除 / 拖拽排序，最多 4 项；顺序即纵向 split 中
	// 自上而下的顺序。默认空 = 空白侧栏。
	leftSidebarSlots: SidebarSlot[];
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
	// 收纳分界左侧（已收纳）图标是否展开可见：跨重启持久化，只由用户点击哨兵图标改变——
	// 切换视图、堆叠自动收起/面板关闭等操作都不应连带重置它。
	rightSidebarStowExpanded: boolean;
	// 用户最后一次在悬浮面板里选中的视图（按 leaf 的 view type 字符串存储，见 keyOf()）。
	// 跨重启持久化，使下次打开面板时默认展示这一项，而不是 activeLeaf 缺失时随意回退到
	// leafOrder 里最早发现的那个。空字符串表示尚无记录（沿用原有回退逻辑）。
	rightSidebarLastActiveView: string;
}

export const DEFAULT_SETTINGS: MinimalismUISettings = {
	// 左侧栏面板默认全关（新装即空白侧栏）；showVaultProfile 是独立的 vault profile 开关，保持默认开。
	showProperties: false,
	showLocalGraph: false,
	showVaultProfile: true,
	leftSidebarSlots: DEFAULT_LEFT_SIDEBAR_SLOTS.map(s => ({ ...s })),
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
	rightSidebarStowExpanded: false,
	rightSidebarLastActiveView: '',
};
