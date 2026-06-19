/**
 * ResponsiveSidebarManager — 按正文文本列宽度自适应收起 / 展开左侧边栏。
 *
 * 行为：
 * - 侧栏展开时，正文文本列(.cm-sizer / .markdown-preview-sizer，宽度上限即 --file-line-width)
 *   缩到 < readable line length，就收起左侧边栏，并记下「这是本功能收的」与收起时的窗口宽度。
 * - 侧栏被本功能收起后，窗口宽度回到收起时的宽度(+滞回)以上，就重新展开；
 *   用户本来就手动收起的则保持收起。
 *
 * 只管左侧边栏(workspace.leftSplit)，符合插件的极简哲学。
 *
 * 为什么测文本列而非容器：rootSplit 容器比真正的文本列宽一圈(编辑器左右内边距 ~60px)，
 * 拿容器宽度比会让触发点偏晚(容器 700 时文本列其实已被压到 ~640)。
 *
 * 防抖动 / 防死区：收起侧栏会让正文变宽，若收起后还拿「当前正文宽」判断就会来回横跳。
 * 这里不去折算侧栏宽度(实测易失真)，而是收起时记下当时的窗口宽度 collapseWidth ——
 * 那一刻文本列恰好≈readable，故「窗口回到 collapseWidth 以上」即「文本列又能放下 readable」。
 * 收起判断用文本列(直接实测、可靠)，展开判断用窗口宽度(与侧栏开合无关、连续)，互不打架。
 *
 * 触发：监听 activeWindow 的 resize(带 ~100ms 防抖)；apply() 时立即评估一次，
 * 处理启动时窗口已经很窄的情况。阈值每次评估时实时读 --file-line-width，
 * 用户改了 readable line length 设置即自动跟随。
 */
import { App } from 'obsidian';
import { Feature } from '../core/Feature';

type WorkspaceSidedock = { collapsed: boolean; collapse(): void; expand(): void };
type WorkspaceSplit = { containerEl?: HTMLElement };

const DEFAULT_READABLE_WIDTH = 700;
const RESIZE_DEBOUNCE_MS = 100;
// 展开滞回：窗口需回到收起宽度 + 该值以上才展开，避免在临界点反复开合。
const EXPAND_HYSTERESIS = 20;

export class ResponsiveSidebarManager implements Feature {
	// 侧栏当前的收起是否由本功能造成(决定变宽时是否自动展开)。
	private autoCollapsed = false;
	// 本功能收起时记录的窗口宽度；窗口回到此宽度(+滞回)以上才展开。
	private collapseWidth = 0;
	private debounceTimer: number | null = null;

	// 文本列(受 --file-line-width 约束)元素选择器：编辑视图 .cm-sizer / 阅读视图 .markdown-preview-sizer。
	// 在 activeDocument 全局查找(侧栏面板不含 .cm-sizer，不会误命中)，不依赖 rootSplit/.mod-active 作用域。
	private static readonly SIZER_SELECTOR = '.cm-sizer, .markdown-preview-sizer';
	// rootSplit 容器到文本列的横向内边距兜底值(实测无法拿到文本列时用)。
	private static readonly FALLBACK_OFFSET = 60;

	constructor(private app: App) {}

	private get leftSplit(): WorkspaceSidedock | null {
		return (this.app.workspace.leftSplit as unknown as WorkspaceSidedock) ?? null;
	}

	private get rootSplit(): WorkspaceSplit | null {
		return (this.app.workspace.rootSplit as unknown as WorkspaceSplit) ?? null;
	}

	apply(): void {
		this.remove();
		activeWindow.addEventListener('resize', this.onResize);
		this.evaluate();
	}

	remove(): void {
		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		activeWindow.removeEventListener('resize', this.onResize);
		// 卸载不还原侧栏可见状态，仅清内部状态。
		this.autoCollapsed = false;
		this.collapseWidth = 0;
	}

	private onResize = () => {
		if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
		this.debounceTimer = window.setTimeout(() => {
			this.debounceTimer = null;
			this.evaluate();
		}, RESIZE_DEBOUNCE_MS);
	};

	// 读取 readable line length 像素宽度，解析失败回退到默认值。
	private getReadableWidth(): number {
		const raw = getComputedStyle(activeDocument.body)
			.getPropertyValue('--file-line-width')
			.trim();
		const parsed = parseFloat(raw);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_READABLE_WIDTH;
	}

	// 当前笔记文本列宽度：优先实测 .cm-sizer/.markdown-preview-sizer(受 --file-line-width 约束的真正文本列)；
	// 实测不到则用 rootSplit 容器宽 - 兜底内边距估算。都拿不到返回 null(跳过)。
	private getColumnWidth(): number | null {
		const sizerEl = activeDocument.querySelector<HTMLElement>(ResponsiveSidebarManager.SIZER_SELECTOR);
		if (sizerEl) {
			const width = sizerEl.getBoundingClientRect().width;
			if (width > 0) return width;
		}
		const rootWidth = this.rootSplit?.containerEl?.clientWidth ?? -1;
		return rootWidth > 0 ? rootWidth - ResponsiveSidebarManager.FALLBACK_OFFSET : null;
	}

	// 评估并收敛侧栏状态：
	// - 侧栏展开 & 文本列 < readable → 收起(记下窗口宽度)，无论用户之前是否手动开关过。
	// - 侧栏(被本功能)收起 & 窗口回到收起宽度+滞回以上 → 展开。
	private evaluate(): void {
		const split = this.leftSplit;
		if (!split) return;
		const innerWidth = activeWindow.innerWidth;

		if (split.collapsed) {
			// 收起态：只判断是否该展开(用窗口宽度，不依赖文本列)。
			if (this.autoCollapsed && innerWidth >= this.collapseWidth + EXPAND_HYSTERESIS) {
				split.expand();
				this.autoCollapsed = false;
			}
			return;
		}

		// 展开态：量文本列，窄则收起。
		const columnWidth = this.getColumnWidth();
		if (columnWidth === null) return;
		if (columnWidth < this.getReadableWidth()) {
			split.collapse();
			this.autoCollapsed = true;
			this.collapseWidth = innerWidth;
		}
	}
}
