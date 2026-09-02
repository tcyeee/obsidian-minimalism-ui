import { App, setIcon, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from '../core/settings';
import { LeafMountService } from '../core/LeafMountService';
import { t } from '../core/i18n';
import type { RightSidebarIconDrag } from './RightSidebarIconDrag';

// 左侧栏默认独占管理的三种 view type：右侧栏悬浮面板的通用挂载/归还逻辑会和左侧栏对它们的
// 簿记打架——排除在外；左侧栏里其余（用户手动加入、未被管理的）leaf 视为普通可切换项。
// Phase 4 会把这个集合改成向 LeftSidebarManager 动态查询"当前 enabled slot 占用的 view type"，
// 此处先保留默认值，并允许外部通过 setManagedLeftViewTypesProvider 覆盖（Phase 1 起接线）。
export const DEFAULT_MANAGED_LEFT_VIEW_TYPES: ReadonlySet<string> = new Set(['outline', 'localgraph', 'file-properties']);

const DEFAULT_ICON = 'panel-right';
const STACK_ICON_CLASS = 'minimalism-ui-rsb-stack-icon';
const STACK_ICON_ACTIVE_CLASS = 'minimalism-ui-rsb-stack-icon-active';
const EMPTY_CLASS = 'minimalism-ui-rsb-empty';
const STOW_ICON_CLASS = 'minimalism-ui-rsb-stow-icon';
const STOW_ICON_EXPANDED_CLASS = 'minimalism-ui-rsb-stow-icon-expanded';
const STOW_ICON_GLYPH = 'chevrons-left';
const STACK_ICON_HIDDEN_CLASS = 'minimalism-ui-rsb-stack-icon-hidden';
// "已收纳"视觉提示（灰化）：哨兵左侧即命中，与是否肉眼可见（展开/拖拽强制显形）无关——
// 纯粹是位置语义的提示，STACK_ICON_HIDDEN_CLASS 管的是"收起态下要不要占位/可见"。
const STACK_ICON_STOWED_CLASS = 'minimalism-ui-rsb-stack-icon-stowed';

// 收纳分界哨兵：混入 rightSidebarStackOrder / computeRenderOrder() 的返回序列，标记
// "左侧默认隐藏、右侧默认可见"的分界位置。用普通 view type 字符串不可能撞上的前缀。
export const STOW_KEY = 'minimalism-ui-rsb-stow';

// 渲染序列里的一项：真实的可切换视图，或收纳哨兵。
export type StackItem = WorkspaceLeaf | typeof STOW_KEY;

export interface MountedElements {
	stackEl: HTMLElement;
	contentEl: HTMLElement;
	buttonEl: HTMLElement;
}

/**
 * RightSidebarViewStack — 右侧栏悬浮面板的"视图层"。从 RightSidebarButtonManager 拆出：
 * 发现哪些 leaf 可切换（右侧栏本体 + 左侧栏里未被合并管理的"外来" leaf）、渲染图标堆叠、
 * 挂载/归还当前选中视图的 DOM。面板本身的开关/pin/尺寸拖拽仍在 RightSidebarButtonManager；
 * 图标的拖拽重排在 RightSidebarIconDrag。三者共用同一套 DOM（stackEl/contentEl/buttonEl
 * 由主类在 inject() 时创建，通过 mount() 交给本类）。
 *
 * 切换视图时把该 leaf 视图的 containerEl（DOM 节点本身，保留其事件监听/内部状态）
 * 挂进面板内容区；切走或卸载时移回原位置——与 SidebarLayoutManager 合并 Properties/
 * Graph 到 Outline 的手法同构（移动整个 containerEl，而非只挪 .view-content）。
 * 全程不调用 setActiveLeaf/revealLeaf：只搬 DOM，不改变 Obsidian 认为的"当前活动 leaf"，
 * 避免干扰单页模式引擎（SinglePageEngine）的导航状态。
 *
 * 图标可拖拽重排、且序列中混入一个"收纳"哨兵图标（STOW_KEY）：哨兵左侧的图标默认隐藏
 * （宽度/透明度归零，纯 CSS 折叠），右侧始终可见；点击哨兵切换展开/收起；拖拽任意图标
 * 越过哨兵即改变其隐藏/可见归属，拖拽哨兵本身直接挪动分界（拖拽机制见 RightSidebarIconDrag）。
 * 真正的视觉顺序由 computeRenderOrder() 从 settings.rightSidebarStackOrder（按 view type
 * 持久化、跨重启保留）解析得到，与 leafOrder 是两层独立的东西——后者只管存在性。
 *
 * 容错兜底：collectSwitchableLeaves 只能看到当前存在的 leaf —— 一个 view 一旦被用户
 * Cmd+W 关闭，leaf 就被销毁，不再出现在任何遍历里（这不是"隐藏"，是真的不存在了）。
 * 为了让本面板成为"任何 view 都能找回来"的最后入口，面板首次展开时会调用
 * ensureAllToolViewsExist 扫描 app.viewRegistry.viewByType 里注册过的全部工具类 view type，
 * 对尚无 leaf 的类型静默在（本就被 CSS 整体隐藏的）右侧栏里创建一个 leaf 补齐 —— 之后它
 * 就和其余 leaf 一样被 collectSwitchableLeaves 收进堆叠，图标/名称直接读自真实 View 实例，
 * 无需维护一份猜测的图标映射表。
 */
export class RightSidebarViewStack {
	private stackEl: HTMLElement | null = null;
	private contentEl: HTMLElement | null = null;
	private buttonEl: HTMLElement | null = null;
	private iconDrag: RightSidebarIconDrag | null = null;

	// 每次 apply() 只做一次全量探测（见 ensureAllToolViewsExist），避免每次开面板都重复扫描/创建。
	private hasProbedAllViewTypes = false;

	// 当前挂进 contentEl 的 leaf，及其原本所在的位置（用于切走/卸载时移回）。
	private mountedLeaf: WorkspaceLeaf | null = null;
	private mountedOriginal: { parent: HTMLElement; nextSibling: ChildNode | null } | null = null;
	// 图标堆叠的发现顺序：只负责"视图是否存在" + activeLeaf 兜底，不再是视觉顺序（见类注释）。
	// 视觉顺序 + 收纳分界由 computeRenderOrder() 结合 settings.rightSidebarStackOrder 派生。
	private leafOrder: WorkspaceLeaf[] = [];
	// 当前选中项，独立于 leafOrder 的顺序记录。
	private activeLeaf: WorkspaceLeaf | null = null;
	// leaf 实例 → 稳定的每实例 key（区别于 keyOf() 返回的 view type 字符串）：DOM 的
	// data-rsb-key 及拖拽排序全程用它，只有落盘到 settings.rightSidebarStackOrder 时才
	// 换回 view type。原先直接复用 keyOf() 当 DOM key，导致同一 view type 的多个 leaf
	// 在 DOM 上共享同一个 data-rsb-key、querySelector 永远只命中第一个——拖动其中一个会
	// 连带影响另一个。key 只在本次运行时有效，不跨重启持久化（无此需要，settings 里仍是
	// 按 view type 存储，见 keyOf() 与 computeRenderOrder() 的既有局限）。
	private leafInstanceKeys = new WeakMap<WorkspaceLeaf, string>();
	private instanceKeyToLeaf = new Map<string, WorkspaceLeaf>();
	private instanceKeyCounter = 0;
	// 收纳图标是否处于展开态（显示分界左侧的隐藏图标）；跨重启持久化于 settings，
	// 只由用户点击哨兵图标改变——切视图、堆叠自动收起等操作不再连带重置它（见类注释）。
	private stowExpanded = false;

	// 左侧栏独占的 view type 提供者：默认三件套，可被外部（LeftSidebarManager）覆盖为动态查询。
	private getManagedLeftViewTypes: () => ReadonlySet<string> = () => DEFAULT_MANAGED_LEFT_VIEW_TYPES;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		private save: () => Promise<void>,
		private leafMount: LeafMountService,
	) {}

	// Phase 1 起由 main.ts 接线：让"左侧栏独占哪些 view type"成为两模块的单一事实源。
	setManagedLeftViewTypesProvider(fn: () => ReadonlySet<string>) {
		this.getManagedLeftViewTypes = fn;
	}

	// 双向引用只能在两者都构造完之后接上（见 RightSidebarButtonManager 的构造顺序）。
	bindIconDrag(iconDrag: RightSidebarIconDrag) {
		this.iconDrag = iconDrag;
	}

	mount(elements: MountedElements) {
		this.stackEl = elements.stackEl;
		this.contentEl = elements.contentEl;
		this.buttonEl = elements.buttonEl;
		this.hasProbedAllViewTypes = false;
		this.stowExpanded = this.getSettings().rightSidebarStowExpanded;
	}

	unmount() {
		this.restoreMounted();
		this.leafOrder = [];
		this.activeLeaf = null;
		this.leafInstanceKeys = new WeakMap();
		this.instanceKeyToLeaf.clear();
		this.stowExpanded = false;
		this.stackEl = null;
		this.contentEl = null;
		this.buttonEl = null;
	}

	getStackEl(): HTMLElement | null {
		return this.stackEl;
	}

	getMountedLeaf(): WorkspaceLeaf | null {
		return this.mountedLeaf;
	}

	// 把当前挂载的视图在主编辑区新开一个真实标签页。右侧栏原 leaf 不动——用 getViewState()
	// 克隆一份状态到新 leaf（等于复制，而非搬迁），故堆叠里的图标依旧在。先 restoreMounted()
	// 把被搬进面板的 containerEl 还回隐藏的右侧栏，避免后续 setViewState 触发的重渲染误伤它。
	async openMountedInMainArea(): Promise<boolean> {
		const leaf = this.mountedLeaf;
		if (!leaf) return false;
		const state = leaf.getViewState();
		this.restoreMounted();
		const mainLeaf = this.app.workspace.getLeaf('tab');
		await mainLeaf.setViewState({ ...state, active: true });
		this.app.workspace.setActiveLeaf(mainLeaf, { focus: true });
		return true;
	}

	hasProbed(): boolean {
		return this.hasProbedAllViewTypes;
	}

	markProbed() {
		this.hasProbedAllViewTypes = true;
	}

	// ─── 视图枚举 / 渲染图标堆叠 / 挂载切换 ─────────────────────────────────

	// 右侧栏的全部 leaf，加上左侧栏里不属于 Outline/Graph/Properties 合并三件套的"外来" leaf。
	private collectSwitchableLeaves(): WorkspaceLeaf[] {
		const { leftSplit, rightSplit } = this.app.workspace;
		const leaves: WorkspaceLeaf[] = [];
		this.app.workspace.iterateAllLeaves((leaf) => {
			const root = leaf.getRoot();
			if (rightSplit && root === rightSplit) {
				leaves.push(leaf);
			} else if (leftSplit && root === leftSplit && !this.getManagedLeftViewTypes().has(leaf.getViewState().type)) {
				leaves.push(leaf);
			}
		});
		return leaves;
	}

	// 为每个尚无 leaf 的工具类 view type 在（CSS 整体隐藏的）右侧栏静默创建一个 leaf 占位，
	// 使其之后能被 collectSwitchableLeaves 发现。枚举 / 建 leaf / 竞态守卫的通用逻辑在
	// LeafMountService；本类只提供右侧栏专属的"在哪里建"策略：优先复用右侧栏里已存在的某个
	// leaf 所在的组，侧栏全空时才 getRightLeaf(true) 建第一个组。
	async ensureAllToolViewsExist() {
		await this.leafMount.ensureAllToolViewsExist({
			excludedViewTypes: this.getManagedLeftViewTypes(),
			findSharedParent: () => this.findExistingRightSidebarParent(),
			createFallbackLeaf: () => this.app.workspace.getRightLeaf(true),
		});
	}

	// 把 deferred leaf 物化提前到用户开始点选之前做，避免它触发的重渲染误伤此刻被搬进悬浮
	// 面板的 sibling leaf（详见 LeafMountService.materializeDeferredLeaves）。
	async materializeDeferredLeaves() {
		await this.leafMount.materializeDeferredLeaves(this.collectSwitchableLeaves());
	}

	// 右侧栏里任意一个已存在 leaf 所属的 tab 组（原生已打开的面板，或此前探测遗留的），
	// 用于把新探测出的 leaf 并入同一组，而不是各自新开一块分屏。
	private findExistingRightSidebarParent(): unknown {
		const { rightSplit } = this.app.workspace;
		if (!rightSplit) return null;
		let found: WorkspaceLeaf | null = null;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (found) return;
			if (leaf.getRoot() === rightSplit) found = leaf;
		});
		return found ? (found as unknown as { parent: unknown }).parent : null;
	}

	// 用最新扫描结果更新堆叠顺序：保留既有相对顺序，已关闭的 leaf 剔除，
	// 新出现的 leaf 追加到最前（选中不再触发重排，见类注释）。
	private syncLeafOrder(leaves: WorkspaceLeaf[]) {
		const present = new Set(leaves);
		this.leafOrder = this.leafOrder.filter((l) => present.has(l));
		const known = new Set(this.leafOrder);
		for (const leaf of leaves) if (!known.has(leaf)) this.leafOrder.unshift(leaf);
		// 已关闭的 leaf 从 instanceKeyToLeaf 里摘掉，避免这个 Map 一直强引用已销毁的 leaf。
		for (const [key, leaf] of this.instanceKeyToLeaf) {
			if (!present.has(leaf)) this.instanceKeyToLeaf.delete(key);
		}
	}

	refreshStack() {
		if (!this.stackEl) return;
		const leaves = this.collectSwitchableLeaves();
		this.syncLeafOrder(leaves);

		if (this.leafOrder.length === 0) {
			this.activeLeaf = null;
			this.stackEl.empty();
			this.showEmpty();
			return;
		}

		// activeLeaf 缺失（首次扫描，含插件重启后的第一次打开）或其 leaf 已被关闭时，优先回退
		// 到用户上次选中、跨重启持久化的视图（见 rightSidebarLastActiveView）；找不到（从未
		// 记录过，或该视图这次没有对应 leaf）才退回最早发现的一项。
		if (!this.activeLeaf || !this.leafOrder.includes(this.activeLeaf)) {
			const lastKey = this.getSettings().rightSidebarLastActiveView;
			const remembered = lastKey ? this.leafOrder.find((l) => this.keyOf(l) === lastKey) : undefined;
			this.activeLeaf = remembered ?? this.leafOrder[this.leafOrder.length - 1];
		}

		this.renderStackIcons();
		void this.showLeaf(this.activeLeaf);
	}

	// leaf 的持久化 key：按 view type 字符串，跨重启稳定。已知局限（用户已接受）：无法区分
	// 同一 view type 的多个 leaf——池化解析算法（见 computeRenderOrder）令这种情况有确定性
	// 表现而不至于崩溃，但不保证严格身份对应。
	keyOf(leaf: WorkspaceLeaf): string {
		return leaf.getViewState().type;
	}

	// 每个 leaf 实例稳定、唯一的 key（见字段注释）：DOM 身份与拖拽全程用它，避免同 view type
	// 的多个 leaf 在 data-rsb-key 上撞车。
	instanceKeyOf(leaf: WorkspaceLeaf): string {
		let key = this.leafInstanceKeys.get(leaf);
		if (!key) {
			key = `leaf-${this.instanceKeyCounter++}`;
			this.leafInstanceKeys.set(leaf, key);
			this.instanceKeyToLeaf.set(key, leaf);
		}
		return key;
	}

	leafForInstanceKey(key: string): WorkspaceLeaf | undefined {
		return this.instanceKeyToLeaf.get(key);
	}

	// 把 settings.rightSidebarStackOrder（持久化的 key 序列，含 STOW_KEY 哨兵）解析成当前
	// 实际渲染序列：按 leaf 的 view type 从 leafOrder 里"消费"对应 leaf；持久化序列里指向
	// 已关闭 leaf 的 key 静默丢弃；不在持久化序列里出现过的 leaf（新视图，或同 type 的额外
	// leaf）追加到末尾——末尾即哨兵之后，天然是可见区。全程缺失哨兵时补在最前（对应默认值
	// 空数组的语义：哨兵隐式在最前，所有已发现视图可见）。
	computeRenderOrder(): StackItem[] {
		const pool = new Map<string, WorkspaceLeaf[]>();
		for (const leaf of this.leafOrder) {
			const key = this.keyOf(leaf);
			const bucket = pool.get(key);
			if (bucket) bucket.push(leaf); else pool.set(key, [leaf]);
		}

		const result: StackItem[] = [];
		let sawStow = false;
		for (const key of this.getSettings().rightSidebarStackOrder) {
			if (key === STOW_KEY) {
				result.push(STOW_KEY);
				sawStow = true;
				continue;
			}
			const leaf = pool.get(key)?.shift();
			if (leaf) result.push(leaf);
		}
		for (const bucket of pool.values()) {
			for (const leaf of bucket) result.push(leaf);
		}
		if (!sawStow) result.unshift(STOW_KEY);
		return result;
	}

	renderStackIcons() {
		if (!this.stackEl) return;
		this.stackEl.empty();
		const order = this.computeRenderOrder();
		const stowIndex = order.indexOf(STOW_KEY);

		order.forEach((item, idx) => {
			if (item === STOW_KEY) {
				const stowEl = this.stackEl!.createDiv({
					cls: `${STACK_ICON_CLASS} ${STOW_ICON_CLASS}`,
					attr: {
						'aria-label': t(this.stowExpanded ? 'rightSidebarStowCollapse' : 'rightSidebarStowExpand'),
						'data-rsb-key': STOW_KEY,
					},
				});
				stowEl.toggleClass(STOW_ICON_EXPANDED_CLASS, this.stowExpanded);
				setIcon(stowEl, STOW_ICON_GLYPH);
				stowEl.addEventListener('click', (e) => {
					e.stopPropagation();
					this.dispatchIconClick(() => this.toggleStowExpanded());
				});
				stowEl.addEventListener('pointerdown', (e) => this.iconDrag?.startIconDrag(e, STOW_KEY));
				return;
			}

			const leaf = item;
			const instanceKey = this.instanceKeyOf(leaf);
			const iconEl = this.stackEl!.createDiv({
				cls: STACK_ICON_CLASS,
				attr: { 'aria-label': leaf.getDisplayText(), 'data-rsb-key': instanceKey },
			});
			iconEl.toggleClass(STACK_ICON_ACTIVE_CLASS, leaf === this.activeLeaf);
			iconEl.toggleClass(STACK_ICON_HIDDEN_CLASS, !this.stowExpanded && idx < stowIndex);
			iconEl.toggleClass(STACK_ICON_STOWED_CLASS, idx < stowIndex);
			setIcon(iconEl, leaf.getIcon());
			iconEl.addEventListener('click', (e) => {
				e.stopPropagation();
				this.dispatchIconClick(() => this.selectLeaf(leaf));
			});
			iconEl.addEventListener('pointerdown', (e) => this.iconDrag?.startIconDrag(e, instanceKey));
		});
	}

	// 只更新既有图标 DOM 节点上的状态 class（选中/隐藏折叠/收纳灰化、哨兵展开态），不走
	// renderStackIcons() 的 empty() + 重建整套节点。选中项/收纳展开这两个操作只改视觉状态、
	// 不改变堆叠的项集合或顺序，若像 renderStackIcons() 那样整体销毁重建 DOM，浏览器会把
	// 新节点当成一开始就是最终态、没有"变化前"可过渡——CSS 的宽度折叠/chevron 旋转动画
	// 因此完全不播放。原地 toggleClass 保留节点本身，过渡才能生效。
	updateStackIconVisualState() {
		if (!this.stackEl) return;
		const order = this.computeRenderOrder();
		const stowIndex = order.indexOf(STOW_KEY);
		const byKey = (key: string) => this.stackEl!.querySelector<HTMLElement>(`[data-rsb-key="${CSS.escape(key)}"]`);

		const stowEl = byKey(STOW_KEY);
		if (stowEl) {
			stowEl.toggleClass(STOW_ICON_EXPANDED_CLASS, this.stowExpanded);
			stowEl.setAttribute('aria-label', t(this.stowExpanded ? 'rightSidebarStowCollapse' : 'rightSidebarStowExpand'));
		}

		order.forEach((item, idx) => {
			if (item === STOW_KEY) return;
			const el = byKey(this.instanceKeyOf(item));
			if (!el) return;
			el.toggleClass(STACK_ICON_ACTIVE_CLASS, item === this.activeLeaf);
			el.toggleClass(STACK_ICON_HIDDEN_CLASS, !this.stowExpanded && idx < stowIndex);
			el.toggleClass(STACK_ICON_STOWED_CLASS, idx < stowIndex);
		});
	}

	// 拖拽越过阈值后会置位 RightSidebarIconDrag 的 suppressNextIconClick，吞掉紧随拖拽而来的
	// 一次 click——供收纳切换/选中共用的统一入口。
	private dispatchIconClick(action: () => void) {
		if (this.iconDrag?.consumeSuppressedClick()) return;
		action();
	}

	private toggleStowExpanded() {
		this.stowExpanded = !this.stowExpanded;
		const s = this.getSettings();
		s.rightSidebarStowExpanded = this.stowExpanded;
		void this.save();
		this.updateStackIconVisualState();
	}

	private selectLeaf(leaf: WorkspaceLeaf) {
		this.activeLeaf = leaf;
		// 记住这次选中，供下次打开面板（含插件/Obsidian 重启后）默认展示，见 refreshStack()。
		const s = this.getSettings();
		const key = this.keyOf(leaf);
		if (s.rightSidebarLastActiveView !== key) {
			s.rightSidebarLastActiveView = key;
			void this.save();
		}
		this.updateStackIconVisualState();
		void this.showLeaf(leaf);
	}

	private async showLeaf(leaf: WorkspaceLeaf) {
		if (this.mountedLeaf === leaf) return;
		this.restoreMounted();

		if (leaf.isDeferred) await leaf.loadIfDeferred();
		const viewEl = leaf.view.containerEl;
		if (!viewEl.parentElement) return;

		this.mountedOriginal = { parent: viewEl.parentElement, nextSibling: viewEl.nextSibling };
		this.contentEl?.empty();
		this.contentEl?.appendChild(viewEl);
		this.mountedLeaf = leaf;

		if (this.buttonEl) setIcon(this.buttonEl, leaf.getIcon());
		// 该 leaf 原本渲染在被 CSS 永久隐藏（display:none）的右侧栏里；不少核心视图
		// （文件列表、搜索、标签、反向链接等）按容器尺寸做虚拟滚动/懒渲染，隐藏期间量到的
		// 是 0 尺寸，且我们这里是绕过 Obsidian 原生 leaf 缩放流程的裸 DOM 搬运，不会
		// 自动触发它们预期的重新measure。用官方 onResize() 钩子显式通知一次，
		// 让它们据当前真实容器尺寸重新布局。
		this.notifyResize(leaf);
	}

	private showEmpty() {
		this.restoreMounted();
		this.contentEl?.empty();
		this.contentEl?.createDiv({ cls: EMPTY_CLASS, text: t('rightSidebarPanelEmpty') });
		if (this.buttonEl) setIcon(this.buttonEl, DEFAULT_ICON);
	}

	// 虚拟滚动视图（文件树 / 搜索 / 标签 / 反链）在 DOM 被裸搬进悬浮面板后不会自动重新
	// measure，需显式骗一次宽度变化触发完整重排（详见 LeafMountService.notifyResize）。
	notifyResize(leaf: WorkspaceLeaf) {
		this.leafMount.notifyResize(leaf);
	}

	// 把当前挂载的 leaf 视图移回它原本所在的 DOM 位置（隐藏的右侧栏内）。
	private restoreMounted() {
		if (!this.mountedLeaf || !this.mountedOriginal) return;
		const viewEl = this.mountedLeaf.view.containerEl;
		// showLeaf() 是 async 函数，调用方全是 void this.showLeaf(...) 不接 .catch()——这里如果
		// insertBefore 因为 nextSibling 已经不是 parent 的子节点（比如 Obsidian 内部在这期间
		// 重建了右侧栏的 tab 结构）而抛 DOMException，会变成一个没人处理的 promise rejection，
		// 函数从这里直接中断。加 try/catch 兜底，退化成 appendChild（插到最后，位置不对但至少不丢）。
		try {
			this.mountedOriginal.parent.insertBefore(viewEl, this.mountedOriginal.nextSibling);
		} catch (err: unknown) {
			console.error('[minimalism-ui] restoreMounted() insertBefore failed', err);
			this.mountedOriginal.parent.appendChild(viewEl);
		}
		this.mountedLeaf = null;
		this.mountedOriginal = null;
	}
}
