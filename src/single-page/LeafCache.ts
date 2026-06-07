import { App, WorkspaceLeaf } from 'obsidian';

const MAX_CACHED_TABS = 30;

/**
 * LeafCache — 单页模式下的 root leaf LRU 缓存。
 *
 * 维护一个最近使用队列（队尾最新），超出上限时 detach 最旧 leaf。与导航历史解耦：
 * 淘汰只影响内存中保留的 tab 数量，不影响 {@link NavigationHistory} 持有的路径栈。
 *
 * `isEvictingNow()` 暴露淘汰进行中标志：detach 触发的 active-leaf-change / detach 补丁
 * 据此区分"插件内部淘汰"与"用户主动关闭 tab"，避免把淘汰误记为导航或历史变更。
 */
export class LeafCache {
	private queue: WorkspaceLeaf[] = [];
	private isEvicting = false;

	constructor(private app: App, private max: number = MAX_CACHED_TABS) {}

	reset() {
		this.queue = [];
	}

	/** 用当前所有 root leaf 初始化队列，最近活跃的 leaf 排到队尾。 */
	seed() {
		this.queue = [];
		this.app.workspace.iterateRootLeaves(leaf => this.queue.push(leaf));
		const mostRecent = this.app.workspace.getMostRecentLeaf();
		if (mostRecent) this.touch(mostRecent);
	}

	/** 将 leaf 移到队尾（标记为最近使用）。 */
	touch(leaf: WorkspaceLeaf) {
		this.queue = this.queue.filter(l => l !== leaf);
		this.queue.push(leaf);
	}

	/**
	 * active-leaf-change 时调用：把当前 leaf 移到队尾、清理已销毁 leaf、淘汰超额的最旧 leaf。
	 * isEvicting 防止 detach() 触发的 active-leaf-change 引发重入。
	 */
	trackActive() {
		if (this.isEvicting) return;
		const active = this.app.workspace.getMostRecentLeaf();
		if (!active) return;

		this.touch(active);

		// 移除队列中已不存在于 workspace 的 leaf
		const rootLeaves: WorkspaceLeaf[] = [];
		this.app.workspace.iterateRootLeaves(l => rootLeaves.push(l));
		this.queue = this.queue.filter(l => rootLeaves.includes(l));

		if (this.queue.length > this.max) {
			this.isEvicting = true;
			try {
				while (this.queue.length > this.max) {
					this.queue.shift()!.detach();
				}
			} finally {
				this.isEvicting = false;
			}
		}
	}

	isEvictingNow(): boolean {
		return this.isEvicting;
	}
}
