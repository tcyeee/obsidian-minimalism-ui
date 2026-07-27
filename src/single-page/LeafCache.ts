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

		const rootLeaves: WorkspaceLeaf[] = [];
		this.app.workspace.iterateRootLeaves(l => rootLeaves.push(l));
		const rootLeafSet = new Set(rootLeaves);
		// 移除队列中已不存在于 workspace 的 leaf
		this.queue = this.queue.filter(l => rootLeafSet.has(l));
		// 收录队列里缺失、但已存在于主区域的 root leaf：例如 SingleTabGroupGuard 经
		// createLeafInParent 合并分屏/弹窗、或重启恢复出的多分屏布局，会产生从未被激活、
		// 因而从未经 touch() 进入队列的 root leaf。若不补录，淘汰阈值就按"漏数的队列长度"
		// 计算，真实 tab 数会突破上限。插到队首（最旧端）优先被淘汰，活动 leaf 始终在队尾不受影响。
		const tracked = new Set(this.queue);
		const missing = rootLeaves.filter(l => !tracked.has(l));
		if (missing.length) this.queue = [...missing, ...this.queue];

		if (rootLeaves.length > this.max) {
			this.isEvicting = true;
			try {
				// 终止条件用真实存活的 root leaf 数（liveCount），而不是 this.queue.length：
				// 若某个 leaf 的 detach() 出于某种原因没能真正让它从 workspace 消失（比如 Obsidian
				// 内部对某类视图的保护、或某次调用被吞掉），只看 queue.length 会把它当作"已淘汰"
				// 提前收工——该 leaf 随即在下一次 trackActive() 里被上面的"missing"逻辑重新捕获、
				// 排到队首，此后每一轮都优先"淘汰"它（一样失败），真正可关闭的 leaf 永远轮不到,
				// 真实 tab 数就此只增不减、不受 30 上限约束（实测长期使用后台会堆积到几百个 tab、
				// 拖慢 Obsidian，正是这个原因）。改为按 liveCount 收尾后，即使某个 leaf 顽固淘汰不掉，
				// 循环也会继续处理队列里下一个候选者，直到真实数量降到上限为止。
				let liveCount = rootLeaves.length;
				while (liveCount > this.max && this.queue.length > 0) {
					const victim = this.queue.shift()!;
					victim.detach();
					let stillOpen = false;
					this.app.workspace.iterateRootLeaves(l => { if (l === victim) stillOpen = true; });
					if (!stillOpen) liveCount--;
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
