/**
 * NavigationHistory — 跨 tab 的前进/后退导航栈
 *
 * 维护独立于 leaf 生命周期的 `history` / `future`（文件路径数组），与 tab 完全解耦：
 * tab 关闭、LRU 淘汰均不影响导航历史；后退/前进时若无现有 leaf 显示目标文件，则通过
 * 注入的 `activateOrOpen` 回调重新打开。
 *
 * 同时负责前进/后退完成后的入场滑入动画（双重 rAF 推迟到渲染后再加 class）。
 *
 * 与 SinglePageEngine 的协作边界：
 * - 本类只持有“文件路径”，不直接新建/激活 leaf；定位与打开 leaf 由 `activateOrOpen` 回调完成。
 * - 一次性标志 `jumpPath` / `isClosingTab` 都内聚在本类，由 SinglePageEngine 在相应时机调用
 *   `record` / `onTabClosing` 触发，避免标志散落在多个模块。
 */
import { App, TFile, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from '../core/settings';

type AnimationClass = 'minimalism-ui-slide-from-left' | 'minimalism-ui-slide-from-right';

type LeafView = WorkspaceLeaf & {
	view?: { contentEl?: HTMLElement };
};

type ObsidianCommand = {
	callback?: () => void;
	checkCallback?: (checking: boolean) => boolean | void;
};

type AppInternal = App & {
	commands: {
		commands: Record<string, ObsidianCommand>;
	};
};

export class NavigationHistory {
	private history: string[] = [];
	private future: string[] = [];
	// 当前正在执行的后退/前进目标路径，用于阻止 record 将该激活记录为新导航
	private jumpPath: string | null = null;
	// tab 关闭后 Obsidian 自动激活下一个 leaf 会触发 active-leaf-change，该标志阻止其被记录为新导航
	private isClosingTab = false;
	private timer: number | null = null;
	private pendingAnimationCls: AnimationClass | null = null;
	private animEndListeners = new WeakMap<Element, () => void>();
	private origGoBack: ObsidianCommand | null = null;
	private origGoForward: ObsidianCommand | null = null;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		// 激活已显示目标路径的 root leaf；若无则重新打开该文件（由 SinglePageEngine 提供）
		private activateOrOpen: (path: string) => void,
	) { }

	getHistory(): string[] {
		return this.history;
	}

	isEmpty(): boolean {
		return this.history.length === 0;
	}

	canGoBack(): boolean {
		return this.history.length >= 2;
	}

	canGoForward(): boolean {
		return this.future.length > 0;
	}

	// apply() 中途启用时用当前文件兜底初始化，避免首次后退因历史为空而静默失败
	seed(filePath: string) {
		if (this.history.length === 0) this.history.push(filePath);
	}

	// active-leaf-change 触发时记录导航历史。检查顺序严格固定：
	//   ① jumpPath 匹配——我们自己发起的后退/前进不应再次入栈
	//   ② isClosingTab——tab 关闭后的自动激活不应入栈
	//   ③ 路径去重 + 写入
	// 调用方（SinglePageEngine）须先确认这是 root leaf 且有 filePath，再调用本方法，
	// 否则一次性标志会被侧边栏等无关激活提前消耗。
	record(filePath: string) {
		if (this.jumpPath !== null && filePath === this.jumpPath) {
			this.jumpPath = null;
			this.isClosingTab = false;
			return;
		}
		if (this.isClosingTab) {
			this.isClosingTab = false;
			return;
		}
		this.push(filePath);
	}

	// 将文件路径写入 history（幂等：已是末尾则跳过，同时清除 forward 历史）
	push(filePath: string) {
		const last = this.history[this.history.length - 1];
		if (last === filePath) return;
		this.history.push(filePath);
		this.future = [];
	}

	// 笔记重命名时同步更新 history / future 中的路径，防止旧路径导致后退/前进跳过该条目
	handleRename(oldPath: string, newPath: string) {
		this.history = this.history.map(p => p === oldPath ? newPath : p);
		this.future = this.future.map(p => p === oldPath ? newPath : p);
		if (this.jumpPath === oldPath) this.jumpPath = newPath;
	}

	back() {
		this.cancelTimer();
		// 从倒数第二个位置开始向前清除已删除文件的条目，保持当前页（末尾）不动，
		// 找到第一个有效前驱后执行导航。不做 rollback：死条目永久丢弃，避免反复卡死。
		while (this.history.length >= 2) {
			const prevPath = this.history[this.history.length - 2];
			const file = this.app.vault.getAbstractFileByPath(prevPath);
			if (!(file instanceof TFile)) {
				this.history.splice(this.history.length - 2, 1);
				continue;
			}

			const current = this.history.pop()!;
			this.future.unshift(current);

			this.jumpPath = prevPath;
			this.pendingAnimationCls = 'minimalism-ui-slide-from-left';
			this.scheduleActivate(prevPath);
			return;
		}
		// 无有效前驱，导航无法执行；死条目已就地清除，无需回滚
	}

	forward() {
		this.cancelTimer();
		// shift 出的死条目直接丢弃（不回滚）：与 back 保持一致，避免死条目因回滚永远无法清除。
		while (this.future.length > 0) {
			const nextPath = this.future.shift()!;

			const file = this.app.vault.getAbstractFileByPath(nextPath);
			if (!(file instanceof TFile)) continue; // 文件已从 vault 删除，丢弃并继续

			this.history.push(nextPath);

			this.jumpPath = nextPath;
			this.pendingAnimationCls = 'minimalism-ui-slide-from-right';
			this.scheduleActivate(nextPath);
			return;
		}
		// future 已空或全为死条目；死条目已丢弃，无需回滚
	}

	// tab 关闭时调用：从 history 移除该路径的最后一次出现，使历史指针与实际位置一致；
	// 设置 isClosingTab 阻止关闭后的自动激活被记为新导航；并主动跳转到 history 顶部，
	// 让用户落在上一篇笔记而非 Obsidian 任意选择的相邻 leaf。
	// future 不修改：关闭 tab 不影响前进历史，已关闭的文件路径仍可通过前进重新打开。
	onTabClosing(closingPath: string | undefined) {
		if (closingPath) {
			const idx = this.history.lastIndexOf(closingPath);
			if (idx !== -1) this.history.splice(idx, 1);
		}
		this.isClosingTab = true;

		const prevPath = this.history[this.history.length - 1];
		if (prevPath) {
			this.jumpPath = prevPath;
			this.scheduleActivate(prevPath);
		}
	}

	// 前进/后退导航完成后，对已显示的目标 leaf 播放入场动画
	animate(leaf: WorkspaceLeaf | null) {
		if (!this.pendingAnimationCls || !leaf) return;
		const cls = this.pendingAnimationCls;
		this.pendingAnimationCls = null;
		if (!this.getSettings().enableNavAnimation) return;
		// 用双重 rAF 推迟到浏览器完成 DOM 渲染后再加动画 class：
		// 第一帧移除旧 class，第二帧添加新 class，避免同帧内强制重排触发 ResizeObserver loop 错误
		requestAnimationFrame(() => {
			const el = (leaf as LeafView).view?.contentEl;
			if (!el) return;
			el.classList.remove('minimalism-ui-slide-from-left', 'minimalism-ui-slide-from-right');
			requestAnimationFrame(() => {
				// 清理上一次未触发的 animationend listener，防止快速翻页时 listener 累积
				const oldListener = this.animEndListeners.get(el);
				if (oldListener) el.removeEventListener('animationend', oldListener);
				const listener = () => el.classList.remove(cls);
				el.addEventListener('animationend', listener, { once: true });
				this.animEndListeners.set(el, listener);
				el.classList.add(cls);
			});
		});
	}

	dispose() {
		this.cancelTimer();
		this.pendingAnimationCls = null;
		this.isClosingTab = false;
		this.jumpPath = null;
	}

	// Patch 内置的 app:go-back / app:go-forward command，
	// 使快捷键在焦点位于 OUTLINE / PROPERTIES 等侧边栏面板时同样生效。
	// Obsidian 热键系统在 document 层全局触发 command，不受焦点限制；
	// 唯一有焦点依赖的是 command 内部的 getActiveLeaf()?.history.back/forward()，
	// 替换 callback 与 checkCallback 两个入口，直接调用我们的导航方法即可解决。
	patchCommands() {
		const appCmds = (this.app as unknown as AppInternal).commands.commands;
		const backCmd = appCmds['app:go-back'];
		const fwdCmd = appCmds['app:go-forward'];
		if (backCmd) {
			this.origGoBack = { callback: backCmd.callback, checkCallback: backCmd.checkCallback };
			delete backCmd.callback;
			backCmd.checkCallback = (checking: boolean) => {
				if (checking) return this.canGoBack();
				this.back();
				return true;
			};
		}
		if (fwdCmd) {
			this.origGoForward = { callback: fwdCmd.callback, checkCallback: fwdCmd.checkCallback };
			delete fwdCmd.callback;
			fwdCmd.checkCallback = (checking: boolean) => {
				if (checking) return this.canGoForward();
				this.forward();
				return true;
			};
		}
	}

	unpatchCommands() {
		const appCmds = (this.app as unknown as AppInternal).commands.commands;
		if (this.origGoBack) {
			const cmd = appCmds['app:go-back'];
			if (cmd) {
				delete cmd.checkCallback;
				if (this.origGoBack.callback) cmd.callback = this.origGoBack.callback;
				if (this.origGoBack.checkCallback) cmd.checkCallback = this.origGoBack.checkCallback;
			}
			this.origGoBack = null;
		}
		if (this.origGoForward) {
			const cmd = appCmds['app:go-forward'];
			if (cmd) {
				delete cmd.checkCallback;
				if (this.origGoForward.callback) cmd.callback = this.origGoForward.callback;
				if (this.origGoForward.checkCallback) cmd.checkCallback = this.origGoForward.checkCallback;
			}
			this.origGoForward = null;
		}
	}

	private cancelTimer() {
		if (this.timer !== null) {
			activeWindow.clearTimeout(this.timer);
			this.timer = null;
		}
	}

	// 用 setTimeout(0) 推入新 task，彻底脱离当前渲染管线，
	// 避免 setActiveLeaf 在 rAF/ResizeObserver 阶段触发布局，产生 loop 错误。
	// 取消上一次尚未执行的 timer，防止连续点击时多个激活并发触发。
	private scheduleActivate(path: string) {
		this.cancelTimer();
		this.timer = activeWindow.setTimeout(() => {
			this.timer = null;
			this.activateOrOpen(path);
		}, 0);
	}
}
