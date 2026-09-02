import { App, WorkspaceLeaf, setIcon } from 'obsidian';
import { MinimalismUISettings, SidebarSlot, MAX_LEFT_SIDEBAR_SLOTS } from '../core/settings';
import { LeafMountService, DOCUMENT_VIEW_TYPES } from '../core/LeafMountService';
import { PinManager } from '../tabs/PinManager';
import { uiDoc } from '../core/appDom';
import { t } from '../core/i18n';
import { openPluginSettings } from '../core/obsidianCommands';

// Obsidian 内部 workspace-item 树的最小结构约定（官方类型声明里没有 children/insertChild 等）。
// spike 结论（2026-09-01，见记忆 project-configurable-left-sidebar-slots）：
//   · 左侧栏 = leftSplit(WorkspaceSidedock)，direction 'horizontal' → CSS mod-horizontal /
//     flex-direction column → 自上而下堆叠，面板间是横向 resize handle。'vertical' 反而是并排列。
//   · getLeftLeaf(true) 在 leftSplit 末尾新建一个 WorkspaceTabs 包一个新 leaf，且不调 setActiveLeaf。
//   · 重排：leftSplit.removeChild(tabs) + insertChild(index, tabs) —— 同步内部数组 + DOM，
//     触发 workspace.onLayoutChange（Obsidian 随之把结构存进 workspace.json）。
//   · 危险：任一 WorkspaceParent 的 children 归零时，其父会 removeChild(自己)。清空 leftSplit
//     会连 sidedock 一起摘掉 —— 必须始终保留 ≥1 个子节点。
type ItemLike = {
	children?: unknown[];
	containerEl?: HTMLElement;
	insertChild?(index: number, child: unknown, resize?: boolean): void;
	removeChild?(child: unknown): void;
	recomputeChildrenDimensions?(): void;
	getViewState?(): { type: string };
	view?: { getViewType?(): string };
};
type SidedockLike = ItemLike & {
	collapsed: boolean;
	collapse(): void;
	expand(): void;
	direction?: 'horizontal' | 'vertical';
	setDirection?(dir: 'horizontal' | 'vertical'): void;
	// Obsidian 在侧栏 0 个 leaf 时 .show() 出来的原生「侧栏为空」提示容器（含一个 <p class="u-muted">）。
	emptyStateEl?: HTMLElement | null;
};

const EMPTY_HINT_CLASS = 'minimalism-ui-sidebar-empty-hint';
const EMPTY_HINT_ICON_CLASS = 'minimalism-ui-sidebar-empty-hint-icon';
const EMPTY_HINT_TEXT_CLASS = 'minimalism-ui-sidebar-empty-hint-text';
const EMPTY_HINT_LINK_CLASS = 'minimalism-ui-sidebar-empty-hint-link';

/**
 * LeftSidebarManager —— 「极简侧边栏」启用时接管左侧栏结构。
 *
 * 取代 SidebarLayoutManager 的 DOM 注入方案：不再把 Properties 的 .metadata-content /
 * Local Graph 的 containerEl 搬进 Outline leaf，而是按 settings.leftSidebarSlots 把每个 enabled
 * slot 的 view 作为**真正的左侧栏 stacked leaf**排进 leftSplit 的纵向 split，顺序 = slot 顺序。
 * resize handle / 尺寸测量 / deferred 生命周期 / 多窗口全部交给 Obsidian 原生 split。
 * 合并侧栏观感（隐藏 tab header、面板标题、scrollbar 统一）由 CSS 负责（Phase 4 重写 styles.css）。
 *
 * reconcile 而非重建：apply() 每次都 diff「期望 slot 列表」与「leftSplit 当前实际子节点」，
 * 只增删 / 移动有变化的 tab 组，避免每次 layout-change / file-open 全量 remove + 重建的开销与闪烁。
 *
 * Phase 1 范围：构造 + reconcile + 折叠快照还原 + 关系图颜色重探。
 * 高度持久化（拖 handle 写回 slot.height）见 Phase 2；SettingTab slot 列表 UI 见 Phase 3；
 * 关系图 4:3 自动高度、styles.css 全面重写、卸载收拢成单 leaf 见 Phase 2/4。
 */
export class LeftSidebarManager {
	// 并发守卫：apply() 内有 await，第二次调用不能与进行中的并发（会建重复 leaf），也不能被
	// 静默丢弃（设置可能在两次调用间变了）。进行中的那次记在 applyRun；期间到达的调用只置位
	// rerunRequested 并 await 同一个 promise —— runApplyLoop 重读设置再跑，直到某一轮没有再被
	// 请求重跑，然后一起 resolve 所有等待者。（沿用 SidebarLayoutManager 的思路。）
	private applyRun: Promise<void> | null = null;
	private rerunRequested = false;

	// 本轮 apply 是否由设置里「添加 / 更换面板」触发：若这轮确实新建了面板，即便进入前侧栏是
	// 收起态也保持展开 —— 用户刚加的面板要能看到，不能开一下又收回去。跨 rerun 保持，循环结束清零。
	private revealNewPanels = false;

	// 当前各 slot viewType → 其 leaf 的引用（关系图颜色重探、owned 查询用；显式持有引用而非
	// getLeavesOfType，以隔离多窗口 / 弹出窗口，见记忆 project-sidebar-local-graph-rewrite）。
	private slotLeaves = new Map<string, WorkspaceLeaf>();

	// 被 monkey-patch 的关系图 renderer.testCSS，remove() 时还原。
	private patchedRenderer: { testCSS?(): void } | null = null;
	private origTestCSS: (() => void) | null = null;

	// 已被我们改写文案 / 加图标的原生「侧栏为空」提示容器，restore 时还原。
	private hintedEmptyStateEl: HTMLElement | null = null;

	// 持续守卫：apply() 只在启动 / 设置变更时跑一次，中间任何往 leftSplit 里冒出来的 leaf
	// （Obsidian 恢复 workspace.json、ribbon 点击、其他插件、用户拖拽）都会滞留成「多出来的 Tab」。
	// 订阅 layout-change，每次只做一次廉价的 hasDrift() 判定，发现漂移才触发一次完整 reconcile。
	// 思路同 SingleTabGroupGuard / PinManager 的侧栏 layout-change 兜底。
	private layoutChangeHandler: (() => void) | null = null;

	// reconcile 自身的 detach / 建 leaf / setViewState 都会再次触发 layout-change；期间置位，
	// 避免守卫把我们自己的中间态误判成漂移而重入。runApplyLoop 全程持有。
	private isReconciling = false;

	// 建不出来的 slot viewType（插件已卸载 / 该 view 无文件上下文 setViewState 必抛）。记下后
	// 本轮配置内不再反复重试 —— 否则 hasDrift 永远为真，layout-change 守卫会无限重入。
	// slot 列表一变（用户可能重装了插件）即清空重试，signature 存在 lastDesiredKey。
	private unsatisfiableTypes = new Set<string>();
	private lastDesiredKey = '';

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		private leafMount: LeafMountService,
		private pinManager: PinManager,
	) {}

	// ── Public ────────────────────────────────────────────────────────────────

	async apply(opts?: { revealNewPanels?: boolean }): Promise<void> {
		this.ensureLayoutGuard();
		if (opts?.revealNewPanels) this.revealNewPanels = true;
		if (this.applyRun) {
			this.rerunRequested = true;
			return this.applyRun;
		}
		this.applyRun = this.runApplyLoop();
		try {
			await this.applyRun;
		} finally {
			this.applyRun = null;
		}
	}

	private async runApplyLoop(): Promise<void> {
		this.isReconciling = true;
		try {
			do {
				this.rerunRequested = false;
				await this.doReconcile();
			} while (this.rerunRequested);
		} finally {
			this.revealNewPanels = false;
			this.isReconciling = false;
		}
	}

	/** 卸载：解绑 layout-change 守卫，还原 testCSS patch + 原生空侧栏提示。split 结构本身保留（多 stacked leaf 是 Obsidian 可接受状态）。 */
	remove(): void {
		if (this.layoutChangeHandler) {
			this.app.workspace.off('layout-change', this.layoutChangeHandler);
			this.layoutChangeHandler = null;
		}
		this.restoreTestCSS();
		this.restoreEmptyStateHint();
		this.slotLeaves.clear();
	}

	// ── 持续守卫 ──────────────────────────────────────────────────────────────

	private ensureLayoutGuard(): void {
		if (this.layoutChangeHandler) return;
		this.layoutChangeHandler = () => {
			if (this.isReconciling || this.applyRun) return;
			if (!this.hasDrift()) return;
			void this.apply();
		};
		this.app.workspace.on('layout-change', this.layoutChangeHandler);
	}

	/**
	 * 廉价判定：leftSplit 里的工具类 leaf 是否已偏离「每个 enabled slot 恰好一个、且没有别的」。
	 * 命中才值得跑完整 reconcile —— 绝大多数 layout-change 在此快速返回 false。
	 */
	private hasDrift(): boolean {
		const ls = this.leftSplit();
		if (!ls) return false;
		const desired = this.enabledSlots().map(s => s.viewType);
		const byType = this.toolLeavesByType();

		if (desired.length === 0) {
			let toolLeaves = 0;
			for (const leaves of byType.values()) toolLeaves += leaves.length;
			// 0 slot：侧栏应为空（仅保留 1 个 keep-alive 子节点）。多于此即漂移。
			return toolLeaves > 0 && (ls.children?.length ?? 0) > 1;
		}

		const desiredSet = new Set(desired);
		for (const type of byType.keys()) {
			if (!desiredSet.has(type)) return true; // 外来工具面板
		}
		for (const type of desired) {
			if (this.unsatisfiableTypes.has(type)) continue; // 建不出来的类型不算漂移，避免无限重入
			if ((byType.get(type)?.length ?? 0) !== 1) return true; // 缺失或重复
		}
		return false;
	}

	/** 当前 enabled slot 占用的 view type 集合 —— 供右侧栏悬浮面板避让（两模块单一事实源）。 */
	getOwnedViewTypes(): ReadonlySet<string> {
		return new Set(this.enabledSlots().map(s => s.viewType));
	}

	/**
	 * 主题切换后重新探测关系图 canvas 颜色（renderer.testCSS 只在注入时探测一次）。
	 * 无关系图 slot / renderer 缺失时静默返回。延后一帧以确保新主题 CSS 已生效。
	 */
	reapplyGraphColors(): void {
		const graphLeaf = this.slotLeaves.get('localgraph');
		if (!graphLeaf) return;
		window.requestAnimationFrame(() => this.applyGraphColors(graphLeaf));
	}

	// ── Reconcile ─────────────────────────────────────────────────────────────

	private enabledSlots(): SidebarSlot[] {
		return this.getSettings().leftSidebarSlots.filter(s => s.enabled).slice(0, MAX_LEFT_SIDEBAR_SLOTS);
	}

	private leftSplit(): SidedockLike | null {
		const ls = this.app.workspace.leftSplit as unknown as SidedockLike | undefined;
		return ls && Array.isArray(ls.children) ? ls : null;
	}

	// leftSplit 为根的全部 leaf —— 以 leaf 为粒度，而非 leftSplit.children（tab 组）。
	// 一个组可能包着 ≥2 个 leaf（Obsidian 默认的「文件浏览器 / 搜索 / 书签」就是一个三标签组，
	// 恢复 workspace.json 时也可能把两个 slot 并进一组）。按组遍历会整组漏看 —— 正是
	// 「设置里只有一个 Tab、左侧栏实际两个 Tab」的架构根因。
	private leftLeaves(): WorkspaceLeaf[] {
		const ls = this.app.workspace.leftSplit as unknown;
		const out: WorkspaceLeaf[] = [];
		this.app.workspace.iterateAllLeaves(leaf => {
			if (leaf.getRoot() === ls) out.push(leaf);
		});
		return out;
	}

	// leftSplit 里的工具类 leaf 按 viewType 分桶（文档类 leaf 不参与，reconcile 不碰）。
	private toolLeavesByType(): Map<string, WorkspaceLeaf[]> {
		const map = new Map<string, WorkspaceLeaf[]>();
		for (const leaf of this.leftLeaves()) {
			const type = this.viewTypeOf(leaf);
			if (!type || DOCUMENT_VIEW_TYPES.has(type)) continue;
			const bucket = map.get(type);
			if (bucket) bucket.push(leaf);
			else map.set(type, [leaf]);
		}
		return map;
	}

	private async doReconcile(): Promise<void> {
		const ls = this.leftSplit();
		if (!ls) return;
		const desired = this.enabledSlots().map(s => s.viewType);

		// slot 列表变了就重置「建不出来」黑名单：用户可能刚重装了某个提供 view 的插件。
		const desiredKey = desired.join(' ');
		if (desiredKey !== this.lastDesiredKey) {
			this.unsatisfiableTypes.clear();
			this.lastDesiredKey = desiredKey;
		}

		// 0 个 slot：左侧栏应完全空白。摘掉左侧栏里的所有工具面板（含 Obsidian 默认的文件浏览器 /
		// 搜索 / 书签），让原生「侧栏为空」提示显出来（文案 + 图标改写见 applyEmptyStateHint）。
		// detachLeaf 走的是 leaf.detach()（= 关标签页的原生路径），空 sidedock 是 Obsidian 支持的
		// 状态；文档类 leaf（极少数情况下被拖进左侧栏）保留不动。
		//
		// 不主动收起侧栏：用户在设置里清空面板列表后，侧栏应保持清空前的开合状态。此前会无条件
		// collapse()，导致「清空面板 = 侧栏自动关闭」，用户反馈不符预期。摘掉最后一个 leaf 后
		// Obsidian 会在随后几百毫秒内异步把空 sidedock 收起，故清空前是展开态时要多次补发
		// expand() 压过它（sync + rAF 太早，实测无效）。
		if (desired.length === 0) {
			this.slotLeaves.clear();
			const wasCollapsed = ls.collapsed;
			for (const leaf of this.leftLeaves()) {
				if (!DOCUMENT_VIEW_TYPES.has(this.viewTypeOf(leaf))) this.detachLeaf(leaf);
			}
			// 原生「侧栏为空」提示：换成引导去设置配置面板的文案 + 图标（居中排版见 styles.css）。
			this.applyEmptyStateHint(ls);
			this.persistCollapsedState(ls, wasCollapsed);
			return;
		}

		// 有面板时原生提示会被 Obsidian .hide()，但仍还原我们的改写，避免语言切换后残留旧文案。
		this.restoreEmptyStateHint();

		const wasCollapsed = ls.collapsed;
		// 构造 / 测量需要展开态。
		if (ls.collapsed) ls.expand();

		// 本轮是否真的新建了面板 leaf —— 与 revealNewPanels 一起决定结尾要不要保持展开。
		let createdLeaf = false;

		try {
			// 1. 纵向堆叠 = direction 'horizontal'（spike 结论）。仅在不符时纠正。
			if (ls.direction !== 'horizontal' && typeof ls.setDirection === 'function') {
				ls.setDirection('horizontal');
			}

			const desiredSet = new Set(desired);

			// 顺序刻意为「先补齐、后清场」：teardown 期间 leftSplit 子节点归零会连 sidedock 一起
			// 被 Obsidian 摘掉，所以务必先把 desired 面板建进去，再删外来 / 重复的。

			// 2. 不变量「一个面板 = 一个独立 tab 组」：与别的 leaf 同组的 desired leaf 摘掉，交给
			//    第 3 步在各自独立组里重建。恢复 workspace.json 把两个 slot 并进一组时，若不拆开，
			//    第 3 步的 findSlotGroup 会漏看它、反复建重复 leaf，与 layout-change 守卫来回拉锯。
			//    每组按遍历序保留一个 —— 组内至少留 1 个 leaf，leftSplit 子节点数不会因此归零。
			for (const leaf of this.leftLeaves()) {
				const type = this.viewTypeOf(leaf);
				if (!desiredSet.has(type)) continue;
				const group = (leaf as unknown as { parent?: { children?: unknown[] } }).parent;
				if (group && (group as unknown) !== this.app.workspace.leftSplit && (group.children?.length ?? 1) > 1) {
					this.detachLeaf(leaf);
				}
			}

			// 3. 为每个尚无 leaf 的 desired viewType 建 leaf（末尾新建独立 tab 组），随后统一重排。
			for (const type of desired) {
				if (this.findSlotGroup(ls, type)) continue;
				if (this.unsatisfiableTypes.has(type)) continue;
				const leaf = this.app.workspace.getLeftLeaf(true);
				if (!leaf) continue;
				try {
					await leaf.setViewState({ type, active: false });
					createdLeaf = true;
				} catch (err: unknown) {
					console.error(`[minimalism-ui] left sidebar slot "${type}" setViewState failed`, err);
					this.unsatisfiableTypes.add(type);
					this.detachLeaf(leaf);
				}
			}

			// 4. 清场（leaf 粒度、幂等）：不在 slot 列表里的工具 leaf（旧 slot、Obsidian 默认放进来
			//    的文件浏览器 / 搜索 / 书签）以及同一 viewType 的重复 leaf 一律摘掉。文档类 leaf 不碰；
			//    leftSplit 至少留 1 个子节点（第 3 步已放进 ≥1 个 desired 面板，这里恒成立，仍加保险）。
			const seenType = new Set<string>();
			for (const leaf of this.leftLeaves()) {
				if ((ls.children?.length ?? 0) <= 1) break;
				const type = this.viewTypeOf(leaf);
				if (!type || DOCUMENT_VIEW_TYPES.has(type)) continue;
				if (!desiredSet.has(type) || seenType.has(type)) {
					this.detachLeaf(leaf);
					continue;
				}
				seenType.add(type);
			}

			// 5. 重排：期望顺序 = slot 顺序，占据 leftSplit 子节点列表的前段；
			//    未被任何 slot 匹配的「外来」文档类 tab 组保持在后段、不动。
			for (let i = 0; i < desired.length; i++) {
				const group = this.findSlotGroup(ls, desired[i]);
				if (!group) continue;
				const current = ls.children!.indexOf(group);
				if (current === i) continue;
				// 先移除再按目标下标插回。leftSplit 此刻必有 >1 子节点（正在放 ≥1 个 slot + 可能有外来），
				// 且我们只移动不净删，不会触发「children 归零 → 摘掉 sidedock」。
				ls.removeChild!(group);
				ls.insertChild!(Math.min(i, ls.children!.length), group);
			}
			ls.recomputeChildrenDimensions?.();

			// 6. 记录 slot leaf 引用 + 物化 deferred（关系图等虚拟/canvas 视图尤其需要）。
			this.slotLeaves.clear();
			const finalByType = this.toolLeavesByType();
			for (const type of desired) {
				const leaf = finalByType.get(type)?.[0];
				if (leaf) this.slotLeaves.set(type, leaf);
			}
			await this.leafMount.materializeDeferredLeaves([...this.slotLeaves.values()]);

			// 7. 让各 view 绑定到当前文件（原生侧栏 leaf 一般自动跟随，这里补一次兜底）。
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile) this.app.workspace.trigger('file-open', activeFile);

			// 8. 关系图颜色首次探测。
			const graphLeaf = this.slotLeaves.get('localgraph');
			if (graphLeaf) window.setTimeout(() => this.applyGraphColors(graphLeaf), 200);
		} finally {
			// 结尾的收起意图：进入前是收起的就还原收起 —— 唯一例外是这轮由设置里「添加 / 更换面板」
			// 触发且确实新建了面板，那种情况用户是想立刻看到新面板，保持展开。
			const keepExpanded = createdLeaf && this.revealNewPanels;
			this.enforceCollapsed(ls, wasCollapsed && !keepExpanded);
		}
	}

	// 断言侧栏收起态：立即设一次，并在下一帧再设一次 —— Obsidian 对「变动过的」split 会在随后
	// 异步自动折叠，单次同步调用会被它覆盖，导致「开一下又收回去」。
	private enforceCollapsed(ls: SidedockLike, collapsed: boolean): void {
		const sync = () => {
			if (collapsed && !ls.collapsed) ls.collapse();
			else if (!collapsed && ls.collapsed) ls.expand();
		};
		sync();
		window.requestAnimationFrame(sync);
	}

	// enforceCollapsed 的加强版：清空所有 slot 后 Obsidian 会在随后几百毫秒内异步收起空 sidedock，
	// 单次 sync + rAF 压不住。这里在 ~0.5s 内多次补发目标状态，直到 Obsidian 那次自动收起过去。
	private persistCollapsedState(ls: SidedockLike, collapsed: boolean): void {
		const sync = () => {
			if (collapsed && !ls.collapsed) ls.collapse();
			else if (!collapsed && ls.collapsed) ls.expand();
		};
		sync();
		for (const delay of [0, 60, 150, 300, 500]) window.setTimeout(sync, delay);
	}

	// ── workspace-item 树辅助 ─────────────────────────────────────────────────

	// leftSplit 里承载指定 viewType 的直接子节点（通常是 WorkspaceTabs，也可能是裸 leaf）。
	private findSlotGroup(ls: SidedockLike, viewType: string): unknown | null {
		for (const child of ls.children ?? []) {
			const leaf = this.leafOfGroup(child);
			if (leaf && this.viewTypeOf(leaf) === viewType) return child;
		}
		return null;
	}

	// 一个 leftSplit 直接子节点对应的 leaf：child 本身是 leaf，或 child 是只含一个 leaf 的 tab 组。
	private leafOfGroup(group: unknown): WorkspaceLeaf | null {
		if (!group || typeof group !== 'object') return null;
		if (group instanceof WorkspaceLeaf) return group;
		const kids = (group as ItemLike).children;
		if (Array.isArray(kids) && kids.length === 1 && kids[0] instanceof WorkspaceLeaf) {
			return kids[0];
		}
		return null;
	}

	private viewTypeOf(leaf: WorkspaceLeaf): string {
		try {
			// getViewState().type 是持久化的真实类型，deferred（未物化）leaf 也正确；
			// view.getViewType() 在 leaf 未物化时可能返回占位类型，故以前者优先 —— 否则
			// 启动时恢复出的 deferred slot leaf 认不出来，会被重复新建成第二个 Tab。
			return leaf.getViewState().type || leaf.view?.getViewType?.() || '';
		} catch {
			return '';
		}
	}

	// 把一个 leaf 连同（若因此清空的）tab 组一起摘掉，不留半初始化条目。
	private detachLeaf(leaf: WorkspaceLeaf): void {
		try {
			this.pinManager.forceDetachLeaf(leaf);
		} catch {
			try { leaf.detach(); } catch { /* already gone */ }
		}
	}

	// ── 关系图颜色重探（自 SidebarLayoutManager 迁移）─────────────────────────

	private applyGraphColors(graphLeaf: WorkspaceLeaf): void {
		const renderer = (graphLeaf.view as unknown as Record<string, unknown> | undefined)?.renderer as
			{ testCSS?(): void } | undefined;
		if (!renderer?.testCSS) return;

		this.restoreTestCSS();

		// 只在侧栏关系图的颜色探测期间给 body 加标记 —— 独立关系图调自己的 renderer.testCSS，
		// 不会带这个标记，颜色不受影响。
		const orig = renderer.testCSS.bind(renderer);
		this.patchedRenderer = renderer;
		this.origTestCSS = orig;
		renderer.testCSS = () => {
			uiDoc().body.classList.add('minimalism-ui-sidebar-graph-reading');
			orig();
			uiDoc().body.classList.remove('minimalism-ui-sidebar-graph-reading');
		};
		renderer.testCSS();
	}

	private restoreTestCSS(): void {
		if (this.patchedRenderer && this.origTestCSS) {
			this.patchedRenderer.testCSS = this.origTestCSS;
		}
		this.patchedRenderer = null;
		this.origTestCSS = null;
	}

	// ── 空侧栏提示改写 ────────────────────────────────────────────────────────
	//
	// Obsidian 原生的 .workspace-sidedock-empty-state 只有一行灰字（"The sidebar is empty…"）。
	// 0 面板时把它替换成「去设置里配置侧栏面板」的引导文案，并加一个图标；居中排版交给
	// styles.css 里的 .minimalism-ui-sidebar-empty-hint 规则。原生 <p class="u-muted"> 保留
	// 在 DOM 里（用 CSS 隐藏），卸载时移除我们加的节点即可无痕还原。

	private applyEmptyStateHint(ls: SidedockLike, retries = 3): void {
		const host = ls.emptyStateEl;
		if (!host) {
			// Obsidian 在最后一个 leaf 摘掉后才异步建出 emptyStateEl —— 下一帧再试几次。
			if (retries > 0) window.requestAnimationFrame(() => this.applyEmptyStateHint(ls, retries - 1));
			return;
		}
		host.classList.add(EMPTY_HINT_CLASS);
		this.hintedEmptyStateEl = host;

		if (!host.querySelector(`:scope > .${EMPTY_HINT_ICON_CLASS}`)) {
			setIcon(host.createDiv({ cls: EMPTY_HINT_ICON_CLASS, prepend: true }), 'panel-left');
		}

		// 提示文案里嵌一个「前往设置」链接：i18n 文案用 {link} 占位，切成前后两段文本包住 <a>，
		// 让链接读起来是句子的一部分而非孤立按钮。每次都重建（textEl.empty()），旧节点连监听器一起 GC。
		const textEl = host.querySelector<HTMLElement>(`:scope > .${EMPTY_HINT_TEXT_CLASS}`)
			?? host.createEl('p', { cls: EMPTY_HINT_TEXT_CLASS });
		textEl.empty();
		const [before, after = ''] = t('sidebarEmptyHint').split('{link}');
		textEl.appendText(before);
		const linkEl = textEl.createEl('a', {
			cls: EMPTY_HINT_LINK_CLASS,
			href: '#',
			text: t('sidebarEmptyHintLink'),
		});
		linkEl.addEventListener('click', e => {
			e.preventDefault();
			openPluginSettings(this.app, t('headingAppearance'));
		});
		textEl.appendText(after);
	}

	private restoreEmptyStateHint(): void {
		const host = this.hintedEmptyStateEl;
		if (!host) return;
		host.classList.remove(EMPTY_HINT_CLASS);
		host.querySelector(`:scope > .${EMPTY_HINT_ICON_CLASS}`)?.remove();
		host.querySelector(`:scope > .${EMPTY_HINT_TEXT_CLASS}`)?.remove();
		this.hintedEmptyStateEl = null;
	}
}
