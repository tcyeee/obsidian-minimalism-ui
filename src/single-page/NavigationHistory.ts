/**
 * NavigationHistory — 跨 tab 的前进/后退导航栈
 *
 * 维护独立于 leaf 生命周期的 `history` / `future`（文件路径数组），与 tab 完全解耦：
 * tab 关闭、LRU 淘汰均不影响导航历史；后退/前进时若无现有 leaf 显示目标文件，则通过
 * 注入的 `activateOrOpen` 回调重新打开。
 *
 * 同时负责前进/后退完成后的入场滑入动画（playAnimation：由引擎在定位到目标 leaf 后同步触发）。
 *
 * 与 SinglePageEngine 的协作边界：
 * - 本类只持有“文件路径”，不直接新建/激活 leaf；定位与打开 leaf 由 `activateOrOpen` 回调完成。
 * - 一次性标志 `jumpPath` / `isClosingTab` 都内聚在本类，由 SinglePageEngine 在相应时机调用
 *   `record` / `onTabClosing` 触发，避免标志散落在多个模块。
 */
import { App, TFile, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from '../core/settings';

export type AnimationClass = 'minimalism-ui-slide-from-left' | 'minimalism-ui-slide-from-right';

// 全局关系图在路径式历史栈中的合成键。关系图无文件路径，用一个绝不会与 vault 内真实路径
// 冲突的前缀作为占位 key，使其能像普通笔记一样入栈、去重、前进/后退与重开。
export const GLOBAL_GRAPH_KEY = 'minimalism-ui:global-graph';

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
	// 主区域当前活动 root leaf 显示的文件路径；无文件视图（如全局关系图）为 null。
	// 由引擎在每次 root leaf 激活时通过 markActiveRoot 同步，使本类能判断“当前显示的是否就是历史栈顶”，
	// 从而在无文件视图叠在栈顶之上时正确后退（回到栈顶文件，而非越过它弹到更早条目）。
	private currentRootPath: string | null = null;
	// 当前正在执行的后退/前进目标路径，用于阻止 record 将该激活记录为新导航
	private jumpPath: string | null = null;
	// tab 关闭后 Obsidian 自动激活下一个 leaf 会触发 active-leaf-change，该标志阻止其被记录为新导航
	private isClosingTab = false;
	private timer: number | null = null;
	private origGoBack: ObsidianCommand | null = null;
	private origGoForward: ObsidianCommand | null = null;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		// 激活已显示目标路径的 root leaf；若无则重新打开该文件（由 SinglePageEngine 提供）。
		// animCls：定位到目标 leaf 后要播放的入场动画方向（无动画时为 null）。
		private activateOrOpen: (path: string, animCls: AnimationClass | null) => void,
	) { }

	getHistory(): string[] {
		return this.history;
	}

	isEmpty(): boolean {
		return this.history.length === 0;
	}

	canGoBack(): boolean {
		// 当前显示的是叠在栈顶之上的无文件视图（如关系图）时，后退会回到栈顶文件本身，
		// 即便历史只有一条也可后退，故此处放行。
		const top = this.history[this.history.length - 1];
		if (top !== undefined && this.currentRootPath !== top) return true;
		return this.history.length >= 2;
	}

	canGoForward(): boolean {
		return this.future.length > 0;
	}

	// apply() 中途启用时用当前文件兜底初始化，避免首次后退因历史为空而静默失败
	seed(filePath: string) {
		if (this.history.length === 0) this.history.push(filePath);
	}

	// 引擎在每次 root leaf 激活时调用，记录主区域当前显示的文件路径（无文件视图传 null）。
	// 必须对所有 root leaf 激活生效（含关系图等无文件视图），back/canGoBack 依赖它判断
	// 当前显示是否就是历史栈顶。
	markActiveRoot(path: string | null) {
		this.currentRootPath = path;
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

	// 历史条目是否仍可定位/重开：全局关系图键恒为真（随时可重开关系图）；
	// 其余为文件路径，仅当 vault 中仍存在该文件时为真。死条目（已删除文件）返回 false。
	private isReopenable(key: string): boolean {
		if (key === GLOBAL_GRAPH_KEY) return true;
		return this.app.vault.getAbstractFileByPath(key) instanceof TFile;
	}

	back() {
		this.cancelTimer();
		// 无文件视图（如搜索结果）叠在文件栈顶之上时，当前显示的并非栈顶文件：
		// 此时后退应回到栈顶条目本身，而非越过栈顶弹出到更早条目（否则会跳到“上上页”）。
		// 注：全局关系图现已作为真实条目入栈，此处 currentRootPath === top，不会触发本分支。
		const top = this.history[this.history.length - 1];
		if (top !== undefined && this.currentRootPath !== top) {
			if (this.isReopenable(top)) {
				this.jumpPath = top;
				this.scheduleActivate(top, 'minimalism-ui-slide-from-left');
				return;
			}
			// 栈顶条目已失效：交由下方循环按常规死条目逻辑处理
		}
		// 从倒数第二个位置开始向前清除已删除文件的条目，保持当前页（末尾）不动，
		// 找到第一个有效前驱后执行导航。不做 rollback：死条目永久丢弃，避免反复卡死。
		while (this.history.length >= 2) {
			const prevPath = this.history[this.history.length - 2];
			if (!this.isReopenable(prevPath)) {
				this.history.splice(this.history.length - 2, 1);
				continue;
			}

			const current = this.history.pop()!;
			this.future.unshift(current);

			this.jumpPath = prevPath;
			this.scheduleActivate(prevPath, 'minimalism-ui-slide-from-left');
			return;
		}
		// 无有效前驱，导航无法执行；死条目已就地清除，无需回滚
	}

	forward() {
		this.cancelTimer();
		// shift 出的死条目直接丢弃（不回滚）：与 back 保持一致，避免死条目因回滚永远无法清除。
		while (this.future.length > 0) {
			const nextPath = this.future.shift()!;

			if (!this.isReopenable(nextPath)) continue; // 文件已从 vault 删除，丢弃并继续

			this.history.push(nextPath);

			this.jumpPath = nextPath;
			this.scheduleActivate(nextPath, 'minimalism-ui-slide-from-right');
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

	// 前进/后退导航完成后，对已定位的目标 leaf 同步播放入场动画。
	// 由 SinglePageEngine 在 setActiveLeaf 之后用已知的目标 leaf 直接调用，不再依赖全局
	// active-leaf-change 事件——后者会为每次激活（含重开时一闪而过的空 leaf）触发，快速切换时
	// 动画会落到中间页/空 leaf 上。这里拿到的永远是真正的目标 leaf。
	playAnimation(leaf: WorkspaceLeaf | null, cls: AnimationClass | null) {
		if (!cls || !leaf) return;
		if (!this.getSettings().enableNavAnimation) return;
		const el = (leaf as LeafView).view?.contentEl;
		if (!el) return;
		// 同步重启动画：移除两个方向的 class → 强制重排使移除生效 → 加目标 class。
		// 全程在浏览器 paint 前完成，页面直接从起始态滑入，消除“先以最终态显示再跳回起始态”的闪烁。
		// 动画只用 transform/opacity（合成层属性，不触发 layout/ResizeObserver），同步操作不会引发 RO loop。
		// 动画结束后 class 残留无害（animation-fill-mode 默认 none，元素回到基础态）；重复导航靠这里的
		// 移除+重排+添加重新触发，无需 animationend 监听清理。
		el.classList.remove('minimalism-ui-slide-from-left', 'minimalism-ui-slide-from-right');
		void el.offsetWidth;
		el.classList.add(cls);
	}

	dispose() {
		this.cancelTimer();
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
			window.clearTimeout(this.timer);
			this.timer = null;
		}
	}

	// 用 setTimeout(0) 推入新 task，彻底脱离当前渲染管线，
	// 避免 setActiveLeaf 在 rAF/ResizeObserver 阶段触发布局，产生 loop 错误。
	// 取消上一次尚未执行的 timer，防止连续点击时多个激活并发触发。
	private scheduleActivate(path: string, animCls: AnimationClass | null = null) {
		this.cancelTimer();
		this.timer = window.setTimeout(() => {
			this.timer = null;
			this.activateOrOpen(path, animCls);
		}, 0);
	}
}
