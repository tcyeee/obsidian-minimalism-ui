import { App, WorkspaceLeaf, setIcon } from 'obsidian';
import { MinimalismUISettings, SidebarSlot, MAX_LEFT_SIDEBAR_SLOTS } from '../core/settings';
import { LeafMountService, DOCUMENT_VIEW_TYPES } from '../core/LeafMountService';
import { PinManager } from '../tabs/PinManager';
import { uiDoc } from '../core/appDom';
import { t } from '../core/i18n';

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

	// 当前各 slot viewType → 其 leaf 的引用（关系图颜色重探、owned 查询用；显式持有引用而非
	// getLeavesOfType，以隔离多窗口 / 弹出窗口，见记忆 project-sidebar-local-graph-rewrite）。
	private slotLeaves = new Map<string, WorkspaceLeaf>();

	// 被 monkey-patch 的关系图 renderer.testCSS，remove() 时还原。
	private patchedRenderer: { testCSS?(): void } | null = null;
	private origTestCSS: (() => void) | null = null;

	// 已被我们改写文案 / 加图标的原生「侧栏为空」提示容器，restore 时还原。
	private hintedEmptyStateEl: HTMLElement | null = null;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		private leafMount: LeafMountService,
		private pinManager: PinManager,
	) {}

	// ── Public ────────────────────────────────────────────────────────────────

	async apply(): Promise<void> {
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
		do {
			this.rerunRequested = false;
			await this.doReconcile();
		} while (this.rerunRequested);
	}

	/** 卸载：还原 testCSS patch + 原生空侧栏提示。split 结构本身保留（多 stacked leaf 是 Obsidian 可接受状态）。 */
	remove(): void {
		this.restoreTestCSS();
		this.restoreEmptyStateHint();
		this.slotLeaves.clear();
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

	// 一个 leftSplit 直接子节点是否是文档类 leaf（markdown / canvas / pdf …）——这些不是我们
	// 管的工具面板，reconcile 清场时不碰。
	private isDocumentChild(child: unknown): boolean {
		const leaf = this.leafOfGroup(child);
		return !!leaf && DOCUMENT_VIEW_TYPES.has(this.viewTypeOf(leaf));
	}

	private leftSplit(): SidedockLike | null {
		const ls = this.app.workspace.leftSplit as unknown as SidedockLike | undefined;
		return ls && Array.isArray(ls.children) ? ls : null;
	}

	private async doReconcile(): Promise<void> {
		const ls = this.leftSplit();
		if (!ls) return;
		const slots = this.enabledSlots();

		// 0 个 slot：左侧栏应完全空白。摘掉所有工具面板（含 Obsidian 默认的文件浏览器 / 搜索 /
		// 书签），但至少留 1 个子节点——children 归零会连 sidedock 一起被摘掉——然后收起侧栏。
		if (slots.length === 0) {
			this.slotLeaves.clear();
			for (const child of [...(ls.children ?? [])]) {
				if ((ls.children?.length ?? 0) <= 1) break;
				if (this.isDocumentChild(child)) continue;
				const leaf = this.leafOfGroup(child);
				if (leaf) this.detachGroupOf(ls, leaf);
			}
			if (!ls.collapsed) ls.collapse();
			// 原生「侧栏为空」提示：换成引导去设置配置面板的文案 + 图标（居中排版见 styles.css）。
			this.applyEmptyStateHint(ls);
			return;
		}

		// 有面板时原生提示会被 Obsidian .hide()，但仍还原我们的改写，避免语言切换后残留旧文案。
		this.restoreEmptyStateHint();

		const wasCollapsed = ls.collapsed;
		// 构造 / 测量需要展开态。
		if (ls.collapsed) ls.expand();

		try {
			// 1. 纵向堆叠 = direction 'horizontal'（spike 结论）。仅在不符时纠正。
			if (ls.direction !== 'horizontal' && typeof ls.setDirection === 'function') {
				ls.setDirection('horizontal');
			}

			// 2. 为每个尚无 leaf 的 slot viewType 建 leaf（末尾新建 tab 组），随后统一重排。
			for (const slot of slots) {
				if (this.findSlotGroup(ls, slot.viewType)) continue;
				const leaf = this.app.workspace.getLeftLeaf(true);
				if (!leaf) continue;
				try {
					await leaf.setViewState({ type: slot.viewType, active: false });
				} catch (err: unknown) {
					console.error(`[minimalism-ui] left sidebar slot "${slot.viewType}" setViewState failed`, err);
					this.detachGroupOf(ls, leaf);
				}
			}

			// 2b. 清场：左侧栏只应留下当前 slot 列表里的工具面板。任何不在列表里的工具类 leaf
			//     —— 用户删掉的旧 slot、或 Obsidian 默认放进来的文件浏览器 / 搜索 / 书签 —— 一律摘掉。
			//     文档类 leaf（markdown / canvas …）不碰；始终至少留 1 个子节点，避免连 sidedock 被摘。
			const enabledTypes = new Set(slots.map(s => s.viewType));
			for (const child of [...(ls.children ?? [])]) {
				if ((ls.children?.length ?? 0) <= 1) break;
				if (this.isDocumentChild(child)) continue;
				const leaf = this.leafOfGroup(child);
				if (!leaf) continue;
				if (!enabledTypes.has(this.viewTypeOf(leaf))) {
					this.detachGroupOf(ls, leaf);
				}
			}

			// 3. 重排：期望顺序 = slot 顺序，占据 leftSplit 子节点列表的前段；
			//    未被任何 slot 匹配的「外来」tab 组保持在后段、不动。
			for (let i = 0; i < slots.length; i++) {
				const group = this.findSlotGroup(ls, slots[i].viewType);
				if (!group) continue;
				const current = ls.children!.indexOf(group);
				if (current === i) continue;
				// 先移除再按目标下标插回。leftSplit 此刻必有 >1 子节点（正在放 ≥1 个 slot + 可能有外来），
				// 且我们只移动不净删，不会触发「children 归零 → 摘掉 sidedock」。
				ls.removeChild!(group);
				ls.insertChild!(Math.min(i, ls.children!.length), group);
			}
			ls.recomputeChildrenDimensions?.();

			// 4. 记录 slot leaf 引用 + 物化 deferred（关系图等虚拟/canvas 视图尤其需要）。
			this.slotLeaves.clear();
			for (const slot of slots) {
				const leaf = this.leafOfGroup(this.findSlotGroup(ls, slot.viewType));
				if (leaf) this.slotLeaves.set(slot.viewType, leaf);
			}
			await this.leafMount.materializeDeferredLeaves([...this.slotLeaves.values()]);

			// 5. 让各 view 绑定到当前文件（原生侧栏 leaf 一般自动跟随，这里补一次兜底）。
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile) this.app.workspace.trigger('file-open', activeFile);

			// 6. 关系图颜色首次探测。
			const graphLeaf = this.slotLeaves.get('localgraph');
			if (graphLeaf) window.setTimeout(() => this.applyGraphColors(graphLeaf), 200);
		} finally {
			// Obsidian 对空 / 变动过的 split 会异步自动折叠 —— 按用户原本意图还原。
			if (wasCollapsed) ls.collapse();
			else if (ls.collapsed) ls.expand();
		}
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
			return leaf.view?.getViewType?.() ?? leaf.getViewState().type;
		} catch {
			return '';
		}
	}

	// setViewState 失败时，把刚 getLeftLeaf 出来的 leaf 连同其 tab 组一起摘掉，不留半初始化条目。
	private detachGroupOf(ls: SidedockLike, leaf: WorkspaceLeaf): void {
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

	private applyEmptyStateHint(ls: SidedockLike): void {
		const host = ls.emptyStateEl;
		if (!host) return;
		host.classList.add(EMPTY_HINT_CLASS);
		this.hintedEmptyStateEl = host;

		if (!host.querySelector(`:scope > .${EMPTY_HINT_ICON_CLASS}`)) {
			setIcon(host.createDiv({ cls: EMPTY_HINT_ICON_CLASS, prepend: true }), 'panel-left');
		}

		const textEl = host.querySelector<HTMLElement>(`:scope > .${EMPTY_HINT_TEXT_CLASS}`)
			?? host.createEl('p', { cls: EMPTY_HINT_TEXT_CLASS });
		textEl.setText(t('sidebarEmptyHint'));
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
