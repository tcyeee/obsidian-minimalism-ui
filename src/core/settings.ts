// 左侧栏的一个用户添加的面板。整个列表最多 4 项，顺序即纵向 split 自上而下的顺序。
// 详见仓库根 TODO.md 的目标数据模型一节。
export interface SidebarSlot {
	// 稳定 id：供设置页列表渲染 / 拖拽排序做 key，笔记卡片还用它区分多份实例（见
	// MULTI_INSTANCE_VIEW_TYPES）。新增用 `slot-<时间戳>-<随机后缀>`——纯时间戳在同一毫秒内
	// 连续两次添加会撞车，对笔记卡片这种允许同列表多份的类型是真实风险。
	id: string;
	// 任意已注册的工具类 view type（'outline' / 'file-properties' / 'localgraph' / 'backlink' …）。
	// 同一列表内不重复，唯一例外是 MULTI_INSTANCE_VIEW_TYPES 里的 type（目前仅笔记卡片）：
	// 它允许在同一列表甚至不同 profile 列表里重复出现多份，每份各自独立绑定一篇笔记，靠这个
	// `id` 字段区分彼此。
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

// 左侧栏规则的一条筛选条件。字段与操作符的笛卡尔积里有些组合没有意义（如 path 配
// contains），具体哪些可用由 SettingTab 的下拉联动控制，这里的类型本身不做收窄。
export type SidebarConditionField = 'path' | 'folder' | 'tag' | 'property';
export type SidebarConditionOperator =
	| 'is' | 'is-not' | 'contains' | 'not-contains' | 'starts-with' | 'is-empty' | 'is-not-empty';

export interface SidebarCondition {
	field: SidebarConditionField;
	// field === 'property' 时填 frontmatter 属性名；其它 field 不使用。
	property?: string;
	operator: SidebarConditionOperator;
	// is-empty / is-not-empty 不需要 value。
	value?: string;
}

// 左侧栏的一条筛选规则：按 conditions（纯 AND，空列表视为永不命中）匹配当前笔记，
// 命中则用这条规则的 slots 取代默认的 leftSidebarSlots。整个 sidebarRules 数组的
// 顺序即命中优先级，第一条命中为准。
export interface SidebarRule {
	// 稳定 id，同 SidebarSlot.id 的生成方式：`rule-<时间戳>-<随机后缀>`。
	id: string;
	// 用户自定义名称，规则列表 / 面板配置区展示用。
	name: string;
	conditions: SidebarCondition[];
	slots: SidebarSlot[];
}

// 允许在同一个 slot 列表（甚至跨 home/diary/other 多套列表）里重复出现多份的 view type。
// 目前仅笔记卡片：每一份各自独立绑定一篇笔记，靠 SidebarSlot.id 区分彼此——其它工具类面板
// （outline/properties/关系图……）全局只反映 activeFile，多份毫无意义，故不开放。这是 schema
// 层的约束（决定设置页允不允许重复添加），放在这里而非 LeftSidebarManager，好让 SettingTab
// 与 LeftSidebarManager 都从这同一个权威定义读，不必互相 import。
// LeftSidebarManager 里对应的 leaf 匹配逻辑见该文件的 slotKeyOf / leafSlotKey。
//
// 字符串硬编码而不是 import NoteCardView.VIEW_TYPE_NOTE_CARD：core/ 不依赖任何 feature 目录
// 是这个代码库的既有分层约定（反过来——feature 依赖 core——到处都是），这里不该开这个例外。
// 这个值本身也不会变：它是持久化进用户 workspace.json 的 view type id，改名等于让所有老用户
// 现有的笔记卡片 leaf 全部认不出来，实质已经和字面量一样「冻结」。
export const MULTI_INSTANCE_VIEW_TYPES = new Set<string>(['minimalism-ui-note-card']);

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
	// null 表示跟随 leftSidebarSlots（默认）；数组表示该固定 profile 的独立配置。这两个 profile
	// 的筛选条件（笔记路径 === homePage / 落在日记文件夹下）写死在 LeftSidebarManager 里，不接受
	// 用户编辑——用户能改的只有下面它们各自的面板内容，以及额外加 sidebarRules 这种自定义规则。
	homeSidebarSlots: SidebarSlot[] | null;
	diarySidebarSlots: SidebarSlot[] | null;
	// 用户自定义的筛选规则：按数组顺序排在 home/diary 固定判定之后、leftSidebarSlots 默认配置
	// 之前，当前笔记命中第一条规则即用该规则的 slots。规则数量不设上限（不同于每条规则内部
	// slots 仍受 MAX_LEFT_SIDEBAR_SLOTS）。
	sidebarRules: SidebarRule[];
	ribbonPanelExpanded: boolean;
	hideTabBar: boolean;
	disableNoteTabs: boolean;
	enableNavAnimation: boolean;
	theme: string;
	homePage: string;
	filenamePrefixManual: boolean;
	filenamePrefixLength: number;
	// 是否把 skillflow 插件的状态栏菜单项合并进本插件的菜单面板（见 SkillFlowIntegration）。
	// 关闭后 StatusBarMenuManager 不再吸收它的菜单项，skillflow 自己的状态栏图标也不再被隐藏。
	enableSkillflowMenuMerge: boolean;
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
	// 每张笔记卡片当前绑定的笔记路径，按 SidebarSlot.id 存（null = 未绑定）。
	//
	// 这是笔记卡片绑定状态的第三层持久化，与另外两层各自堵一个不同的失效窗口（NoteCardView /
	// NoteCardManager 只需知道有这一层兜底、不重复这段推理，遇到细节请回链到这里）：
	//   1. 内存里的 NoteCardView.boundFile —— leaf 存活期间（含被 park 摘下、未 detach）的
	//      唯一真源，profile 切换、面板重新显示都不会动它。
	//   2. leaf.getState() → Obsidian 落盘的 workspace.json —— 跨重启持久化，但只在该 leaf
	//      当时确实挂在 workspace 树上才会被存下。LeftSidebarManager 的 PARKABLE_VIEW_TYPES
	//      机制在 home/diary/other 三套 profile 切换时会把不在当前 profile 内的笔记卡片 leaf
	//      整组从树上摘下保活（parkLeaf）而不 detach，那段时间它完全不出现在 workspace.json 里。
	//   3. 这个字段 —— 若恰好在上面「摘下保活」期间退出 Obsidian，重启后这个 leaf 整个消失
	//      （第 2 层救不了），连「上次绑定的是哪篇笔记」都无从查起；这份独立存在 settings 里、
	//      每次绑定都跟着落盘，不随 leaf 在不在树上而定，专门兜底这一种情况（见
	//      NoteCardView.setState 对 state 里缺 `file` key 时的兜底读取）。
	// 按 slot.id 分开存：现在允许多张卡片同时存在、各自独立绑定，不能再共用一个全局值。
	noteCardBindings: Record<string, string | null>;
}

export const DEFAULT_SETTINGS: MinimalismUISettings = {
	// 左侧栏面板默认全关（新装即空白侧栏）；showVaultProfile 是独立的 vault profile 开关，保持默认开。
	showProperties: false,
	showLocalGraph: false,
	showVaultProfile: true,
	leftSidebarSlots: DEFAULT_LEFT_SIDEBAR_SLOTS.map(s => ({ ...s })),
	homeSidebarSlots: null,
	diarySidebarSlots: null,
	sidebarRules: [],
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
	enableSkillflowMenuMerge: true,
	// 默认 100px，与历史固定列宽一致
	propertyKeyWidth: 100,
	language: 'auto',
	// 高级设置区块默认折叠
	collapsedSections: { advanced: true },
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
	noteCardBindings: {},
};
