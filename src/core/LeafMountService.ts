import { App, WorkspaceLeaf } from 'obsidian';

// "全部已注册 view" 兜底扫描（见 ensureAllToolViewsExist）只覆盖工具类面板，不包括按文件渲染的
// 文档类 view —— 这些 view 脱离文件上下文 setViewState 大概率报错或空白，且"切到 markdown/canvas
// 视图"这个操作在悬浮面板 / 侧栏 slot 的语义下也没有意义。此处只列出 Obsidian 核心已知的文档类
// type；第三方插件注册的未知类型一律放行，由 ensureAllToolViewsExist 的 try/catch 兜底探测失败。
export const DOCUMENT_VIEW_TYPES = new Set([
	'markdown', 'canvas', 'pdf', 'image', 'audio', 'video',
	'empty', 'release-notes', 'webviewer', 'bases',
]);

type CreateLeafInParentWorkspace = { createLeafInParent: (parent: unknown, index: number) => WorkspaceLeaf };

export interface EnsureToolViewsOptions {
	/**
	 * 调用方（左 / 右侧栏）当前已独占管理、不该被兜底探测创建的 view type 集合。
	 * 例如右侧栏会排除已被左侧栏 slot 占用的 view type，避免同一 view 同时出现在两处。
	 */
	excludedViewTypes?: ReadonlySet<string>;
	/**
	 * 返回一个已存在的、可作为新建 leaf 归属的 tab 组（`WorkspaceParent`），或 null。
	 * 新探测出的 leaf 会并入同一组，而不是各自 split 一块新分屏。
	 */
	findSharedParent: () => unknown;
	/**
	 * 当没有可复用的共享组时（findSharedParent 返回 null），建第一个 leaf 用的兜底工厂
	 * —— 通常是 `workspace.getRightLeaf(true)`。之后一律 createLeafInParent 复用它的 parent。
	 */
	createFallbackLeaf: () => WorkspaceLeaf | null;
}

/**
 * LeafMountService — view-type 无关的 leaf 枚举 / find-or-create / deferred 物化 / 虚拟滚动
 * resize 通知。从 RightSidebarViewStack 抽出，供右侧栏悬浮面板与左侧栏 slot 管理共同消费，
 * 两模块只提供各自的"在哪里建 leaf""哪些 view type 归我管"策略。
 *
 * 注意：containerEl 搬迁 / 还原（showLeaf / restoreMounted）**不**在此服务里 —— 那是右侧栏
 * 悬浮窗（本质是 overlay）专属。原生 split 方案下的左侧栏不需要搬 DOM。
 */
export class LeafMountService {
	constructor(private app: App) {}

	/**
	 * 全部已注册的"工具类" view type：读 `app.viewRegistry.viewByType`（内部 API，registerView
	 * 时写入，与是否有 leaf 打开无关 —— 正是探测"已关闭但曾注册过"的 view 所需入口），
	 * 排除文档类（DOCUMENT_VIEW_TYPES）与调用方声明独占的类型（excludedViewTypes）。
	 */
	allRegisteredToolViewTypes(excludedViewTypes: ReadonlySet<string> = new Set()): string[] {
		const registry = (this.app as unknown as { viewRegistry?: { viewByType?: Record<string, unknown> } }).viewRegistry;
		const types = Object.keys(registry?.viewByType ?? {});
		return types.filter((type) => !DOCUMENT_VIEW_TYPES.has(type) && !excludedViewTypes.has(type));
	}

	/**
	 * 为每个尚无 leaf 的工具类 view type 静默创建一个 leaf 占位，使其之后能被枚举 / 挂载。
	 * 逐个 await 而非 Promise.all，避免并发调用 setViewState 在工作区内部产生竞态。
	 * 某个类型探测失败（第三方 view 在无文件上下文下抛错）不影响其余类型，失败时把刚创建的
	 * 空 / 半初始化 leaf 一并 detach，不留垃圾条目；若该组因此清空，重置 sharedParent。
	 */
	async ensureAllToolViewsExist(opts: EnsureToolViewsOptions): Promise<void> {
		const ws = this.app.workspace as unknown as CreateLeafInParentWorkspace;
		let sharedParent: unknown = opts.findSharedParent();

		for (const type of this.allRegisteredToolViewTypes(opts.excludedViewTypes)) {
			if (this.app.workspace.getLeavesOfType(type).length > 0) continue;
			let leaf: WorkspaceLeaf | null = null;
			try {
				if (sharedParent) {
					const index = (sharedParent as { children?: unknown[] }).children?.length ?? 0;
					leaf = ws.createLeafInParent(sharedParent, index);
				} else {
					leaf = opts.createFallbackLeaf();
					if (leaf) sharedParent = (leaf as unknown as { parent: unknown }).parent;
				}
				if (!leaf) continue;
				await leaf.setViewState({ type, active: false });
			} catch (err: unknown) {
				console.error(`[minimalism-ui] probing view type "${type}" failed, skipping`, err);
				leaf?.detach();
				if (sharedParent && ((sharedParent as { children?: unknown[] }).children?.length ?? 0) === 0) {
					sharedParent = null;
				}
			}
		}
	}

	/**
	 * Obsidian 的 deferred leaf 只有在"第一次真正被用到"时才物化真正的 View 实例，物化过程会
	 * 触发一次其所在 tab group 的内部重渲染。把物化提前到用户开始点选之前做，避免它误伤此刻
	 * 被搬进悬浮面板的 sibling leaf。逐个 await，理由同 ensureAllToolViewsExist。
	 */
	async materializeDeferredLeaves(leaves: Iterable<WorkspaceLeaf>): Promise<void> {
		for (const leaf of leaves) {
			if (!leaf.isDeferred) continue;
			try {
				await leaf.loadIfDeferred();
			} catch (err: unknown) {
				console.error('[minimalism-ui] failed to materialize deferred leaf', leaf.view.getViewType(), err);
			}
		}
	}

	/**
	 * 核心的 All Properties / Tags / Backlinks 等面板内部用虚拟滚动实现列表，其 onResize() 只有
	 * 在"测得的宽度与上次缓存的宽度不同"时才真正重排；宽度相同则只重放缓存布局。当我们绕过
	 * Obsidian 原生 leaf 缩放流程直接搬运 DOM（右侧栏悬浮窗），或 leaf 从隐藏区进入可见区时，
	 * 它量到的宽度可能与缓存一致而一直空着。手动把宽度先改一格再改回，逼它认为"宽度变了"
	 * 从而完整重排一次。onResize() 跑第三方 / 核心视图代码，出错也不该拖垮调用方，故 try/catch。
	 */
	notifyResize(leaf: WorkspaceLeaf): void {
		const el = leaf.view.containerEl;
		const originalWidth = el.style.width;
		try {
			el.setCssStyles({ width: `${el.clientWidth + 1}px` });
			leaf.onResize();
		} catch (err: unknown) {
			console.error('[minimalism-ui] view onResize() failed', err);
		} finally {
			el.setCssStyles({ width: originalWidth });
		}
		try {
			leaf.onResize();
		} catch (err: unknown) {
			console.error('[minimalism-ui] view onResize() failed', err);
		}
	}
}
