import { App, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from '../core/settings';
import { SinglePageEngine } from './SinglePageEngine';

/**
 * HomePageManager — 首页策略层。
 *
 * 决定“何时”打开首页：会话中所有 note tab 关闭、工作区只剩空页时。（启动时的首次打开由
 * main 在 onLayoutReady 里显式调用 openHomePage 完成，不走本监听。）
 *
 * 触发信号用 active-leaf-change 而非 file-open(null)：实测快速连续 CMD+W 时 Obsidian 不保证
 * 补发 file-open(null)，会停在空页；而关闭最后一个 tab 必定触发 active-leaf-change（落到空 leaf）。
 *
 * “如何”打开（去重 / 新建 leaf）由 {@link SinglePageEngine.openHomePage} 提供机制。
 */
export class HomePageManager {
	private activeLeafHandler: ((leaf: WorkspaceLeaf | null) => void) | null = null;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		private engine: SinglePageEngine,
	) {}

	/** Register the active-leaf-change listener. Must be called after layout is ready. */
	apply() {
		this.remove();
		if (!this.getSettings().homePage) return;

		this.activeLeafHandler = () => this.maybeOpenHomePage();
		this.app.workspace.on('active-leaf-change', this.activeLeafHandler);
	}

	private maybeOpenHomePage() {
		// 首页正在打开：openHomePage 自身的 getLeaf 会先产生临时空 leaf 并触发本事件，
		// 此时再触发会无限重入；”打开途中被关掉”的情形由 openHomePage 内部兜底重试。
		if (this.engine.isOpeningHomePage()) return;

		// 当前活动 leaf 是否是 getLeaf patch 刚建的 pending leaf（即真正经过
		// `workspace.getLeaf()` 新建、尚未加载任何内容的空 leaf）？引擎内部重开笔记
		// （activateOrOpenFile / openHomePage 自身）一律绕开该 patch 直接用 originalGetLeaf，
		// 从不进入 pending 集合，故这条分支只可能命中用户/Obsidian 发起的真实 getLeaf 调用
		// （如 Cmd+N“新建标签页”），与当前导航栈是否为空无关，可放心不受 isNavEmpty 限制，
		// 直接把“打开新空白页”这个动作重定向到首页。
		// 两种情形需要用 setTimeout(0) 跨到下一个宏任务区分：
		//   ① 链接/命令即将调 openFile（如 Cmd+N 建新笔记）——openFile 与 getLeaf 同宏任务同步调用，
		//      此时不能抢先用首页覆盖它；
		//   ② 用户纯粹用快捷键开了一个新空页，不会再有 openFile——leaf 应加载首页。
		// 若 openFile 被调用，leaf 已离开 pending；若仍在 pending，说明无文件将加载。
		const active = this.app.workspace.getMostRecentLeaf();
		if (active && this.engine.hasPendingIntercept(active)) {
			window.setTimeout(() => {
				if (!this.engine.hasPendingIntercept(active)) return; // openFile 已调用，跳过
				if (this.engine.isOpeningHomePage()) return;
				// leaf 确认为空：释放 pending 使 openHomePage 可复用该 leaf，避免多开新 tab
				this.engine.releasePendingLeaf(active);
				// 用 goHome 而非直接 openHomePage：若首页已在导航历史栈中间（如新开空白 tab 前
				// 已打开过首页又继续前进了几篇），直接 openHomePage 触发的 record 会在栈尾重复
				// push 一次首页路径，产生重复的首页词条；goHome 会先折叠回原位再定位。
				this.engine.goHome();
			}, 0);
			return;
		}

		// 走到这里说明当前活动 leaf 并非刚经 getLeaf patch 新建（如 Obsidian 关闭最后一个
		// 文件 tab 后自动激活的既有空 leaf），无法用上面的 pending 状态判断是否该回首页，
		// 只能退回”跨 tab 导航历史是否已空”——用导航历史而非”是否还有文件 leaf”判断，
		// 是因为用户后退后留下的 future 残留 tab 仍是文件 leaf 但已不在浏览链中，不应阻止
		// 回到首页（关完整条后退链即应回首页）。这一判断同时天然滤掉了插件内部导航
		// （activateOrOpenFile 重开文件）产生的临时空 leaf——那种时刻历史栈仍有条目，
		// isNavEmpty 必为 false，从而避免在后退/前进过程中被误判为”该回首页”而劫持导航。
		// 关闭最后一个历史 tab 时若仍有 future 残留 leaf，引擎已在 onTabClosing 里吞掉 Obsidian
		// 自动激活残留 leaf 的那次 record，使历史保持为空，故此处能正确触发。
		if (!this.engine.isNavEmpty()) return;
		this.engine.goHome();
	}

	async openHomePage() {
		return this.engine.openHomePage();
	}

	remove() {
		if (this.activeLeafHandler) {
			this.app.workspace.off('active-leaf-change', this.activeLeafHandler);
			this.activeLeafHandler = null;
		}
	}
}
