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

	// pending leaf 轮询参数：见 watchPendingLeaf 顶部注释。
	private static readonly PENDING_POLL_MS = 60;
	private static readonly PENDING_MIN_GRACE_MS = 250;
	private static readonly PENDING_CREATE_SIGNAL_MS = 400;
	private static readonly PENDING_MAX_WAIT_MS = 2000;

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
		// 两种情形需要区分，交给 watchPendingLeaf 判断：
		//   ① 链接/命令即将调 openFile（如“新建笔记”，内部先 vault.create() 落盘再 openFile，
		//      落盘是真实异步 IO，可能跨越多个宏任务）——此时不能抢先用首页覆盖它；
		//   ② 用户纯粹用快捷键开了一个新空页，不会再有 openFile——leaf 应加载首页。
		// 若 openFile 被调用，leaf 已离开 pending；若仍在 pending，说明无文件将加载。
		const active = this.app.workspace.getMostRecentLeaf();
		if (active && this.engine.hasPendingIntercept(active)) {
			this.watchPendingLeaf(active, Date.now());
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

	// 轮询等待 pending leaf 明确结果：openFile 已调用（放弃，交由其它路径处理）或确定不会再有
	// 内容进来（判定为真正的空白页，跳首页）。不能只等一个 0ms 宏任务就下结论——“新建笔记”命令
	// 内部先 vault.create() 落盘（真实异步 IO，耗时可能超过一个宏任务）、创建完成后才调用
	// openFile，过早判定为空白页会抢在笔记创建完成前跳首页：goHome 会把首页 push 进跨 tab 导航
	// 栈并释放 pending leaf，随后真正的 openFile 落到已被首页占用的 leaf 上时会绕开一次性拦截器
	// （其 openFile/setViewState 已在首页那次调用中被还原成原生实现），既不触发 nav.push 也不
	// 触发 active-leaf-change——表现为“新建笔记后面包屑被清空、历史记录错乱”。
	// 用 vault 最近一次 create 事件延长等待：有信号说明内容大概率正在路上，继续等；
	// 已过最短宽限期且长时间无信号，才判定为真正的空白页（如 Cmd+T 开的空 tab）。
	private watchPendingLeaf(leaf: WorkspaceLeaf, startedAt: number) {
		window.setTimeout(() => {
			if (!this.engine.hasPendingIntercept(leaf)) return; // openFile 已调用，跳过
			if (this.engine.isOpeningHomePage()) return;
			const elapsed = Date.now() - startedAt;
			const expectingContent = this.engine.msSinceLastFileCreate() < HomePageManager.PENDING_CREATE_SIGNAL_MS;
			if (elapsed < HomePageManager.PENDING_MAX_WAIT_MS
				&& (elapsed < HomePageManager.PENDING_MIN_GRACE_MS || expectingContent)) {
				this.watchPendingLeaf(leaf, startedAt);
				return;
			}
			// leaf 确认为空：释放 pending 使 openHomePage 可复用该 leaf，避免多开新 tab
			this.engine.releasePendingLeaf(leaf);
			// 用 goHome 而非直接 openHomePage：若首页已在导航历史栈中间（如新开空白 tab 前
			// 已打开过首页又继续前进了几篇），直接 openHomePage 触发的 record 会在栈尾重复
			// push 一次首页路径，产生重复的首页词条；goHome 会先折叠回原位再定位。
			this.engine.goHome();
		}, HomePageManager.PENDING_POLL_MS);
	}

	async openHomePage() {
		return this.engine.openHomePage();
	}

	// 启动时（onLayoutReady）的首页处理。与会话中的 openHomePage 区别在于：**不抢占**工作区
	// 恢复出的笔记。
	// 旧行为是无条件 openHomePage：Obsidian 恢复上次的笔记 A 后，首页又被打开顶到最前，用户看到
	// 「先闪一下 A、再跳到首页」；且因为首页是最后打开的，ensureHomeInvariant 的 wasCurrent 分支
	// 会把它留在栈尾，面包屑呈现「A / 首页」——顺序也是反的。
	// 现在把决定权交给 ensureNavSeeded：它返回 true 表示主区域此刻显示的是真内容（笔记或功能
	// 视图）且已入栈，此时由 ensureHomeInvariant 把首页钉在 index 0 充当可点击的锚点，面包屑即为
	// 「首页 / A」，页面停留在 A 不跳转；返回 false 表示停在空页（全新库、或上次退出时就是空页），
	// 才走原来的打开首页流程。
	async openHomePageOnStartup() {
		if (!this.getSettings().homePage) return;
		if (this.engine.ensureNavSeeded()) return;
		return this.engine.openHomePage();
	}

	remove() {
		if (this.activeLeafHandler) {
			this.app.workspace.off('active-leaf-change', this.activeLeafHandler);
			this.activeLeafHandler = null;
		}
	}
}
