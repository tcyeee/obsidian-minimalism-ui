import { App, TAbstractFile, TFile, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from '../core/settings';
import { LeafNameUtils } from '../core/utils';
import { GLOBAL_GRAPH_KEY } from '../single-page/NavigationHistory';
import { t } from '../core/i18n';

const COMPACT_THRESHOLD = 15;

// 无文件视图(如全局关系图)的 viewType,面包屑用它们的 getDisplayText() 作为当前项,
// 而非沿用导航历史里残留的上一篇笔记名。
const FILELESS_VIEW_TYPES = new Set(['graph']);

/**
 * BreadcrumbRenderer — 顶部拖拽栏里的面包屑导航。
 *
 * 自成一体:`mount(parent)` 在父元素内创建面包屑 DOM、注册 active-leaf-change /
 * rename 监听并首次渲染;`unmount()` 注销监听。面包屑元素本身随父级(拖拽栏)一起销毁。
 *
 * 渲染策略:
 *   - 未开启面包屑 / 历史 ≤1 → 只显示当前文件名
 *   - 历史超过 {@link COMPACT_THRESHOLD} 或渲染后横向溢出 → 折叠中间项为 `···N···`
 *   - 否则完整列出
 */
export class BreadcrumbRenderer {
	private el: HTMLElement | null = null;
	private activeLeafHandler: ((leaf: WorkspaceLeaf | null) => void) | null = null;
	private renameHandler: ((file: TAbstractFile) => void) | null = null;
	// 最近一次 active-leaf-change 的 leaf,用于判断当前是否停在无文件视图(如关系图)。
	private currentLeaf: WorkspaceLeaf | null = null;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		private navHistoryGetter: () => string[],
		// 点击非当前面包屑条目时回调,参数为该条目在导航历史栈中的下标(语义=连续后退)。
		private onNavigate: (index: number) => void = () => {},
	) {}

	mount(parent: HTMLElement) {
		this.unmount();

		this.el = createDiv();
		this.el.className = 'minimalism-ui-drag-bar-breadcrumb';
		parent.appendChild(this.el);

		this.update();

		this.activeLeafHandler = (leaf: WorkspaceLeaf | null) => {
			this.currentLeaf = leaf;
			this.update();
		};
		this.app.workspace.on('active-leaf-change', this.activeLeafHandler);

		this.renameHandler = (file: TAbstractFile) => {
			if (file === this.app.workspace.getActiveFile()) this.update();
		};
		this.app.vault.on('rename', this.renameHandler);
	}

	unmount() {
		if (this.activeLeafHandler) {
			this.app.workspace.off('active-leaf-change', this.activeLeafHandler);
			this.activeLeafHandler = null;
		}
		if (this.renameHandler) {
			this.app.vault.off('rename', this.renameHandler);
			this.renameHandler = null;
		}
		// breadcrumbEl 是拖拽栏的子元素,由 DragBarManager 随拖拽栏一起移除。
		this.el = null;
		this.currentLeaf = null;
	}

	private update() {
		const el = this.el;
		if (!el) return;

		const filelessLabel = this.activeFilelessViewLabel();
		const paths = this.navHistoryGetter();

		if (filelessLabel === null && paths.length <= 1) {
			this.showSingleFile();
			return;
		}

		this.renderTrail(this.buildTrail(paths, filelessLabel));
	}

	// 纯函数(无 DOM):由历史路径 + 当前无文件视图标签算出面包屑文本序列。
	// 全局关系图现已作为真实条目入栈,buildNames 会用 graph 标签渲染它;只有在它尚未落入历史
	// (active-leaf-change 与 nav 记录之间的时序间隙)时,才用实时标签补在末尾,避免出现两个关系图项。
	private buildTrail(paths: string[], filelessLabel: string | null): string[] {
		const names = this.buildNames(paths);
		if (filelessLabel !== null && paths[paths.length - 1] !== GLOBAL_GRAPH_KEY) {
			names.push(filelessLabel);
		}
		return names;
	}

	// 当前激活 leaf 若是无文件视图(graph 等),返回其本地化标题;否则返回 null。
	private activeFilelessViewLabel(): string | null {
		const view = (this.currentLeaf ?? this.app.workspace.getMostRecentLeaf())?.view;
		if (!view || !FILELESS_VIEW_TYPES.has(view.getViewType())) return null;
		return view.getDisplayText() || view.getViewType();
	}

	// 路径是稳定字符串,直接从 vault 查文件名,无需过滤关闭的 leaf。
	// 全局关系图的合成键不是文件路径,映射为本地化的 graph 标签,避免被 stripPrefix 截成 ":global-graph"。
	private buildNames(paths: string[]): string[] {
		const prefixLen = this.getSettings().filenamePrefixLength;
		return paths.map(p => {
			if (p === GLOBAL_GRAPH_KEY) return t('graphView');
			const f = this.app.vault.getAbstractFileByPath(p);
			return f instanceof TFile
				? LeafNameUtils.stripPrefix(f.basename, prefixLen)
				: LeafNameUtils.stripPrefix(p, prefixLen);
		});
	}

	// 渲染完整路径:单项→当前项;超阈值或溢出→折叠中间项;否则完整列出。
	private renderTrail(names: string[]) {
		const el = this.el;
		if (!el) return;
		if (names.length === 0) return;

		if (names.length === 1) {
			el.empty();
			const item = createSpan();
			item.className = 'minimalism-ui-breadcrumb-item is-current';
			item.textContent = names[0];
			el.appendChild(item);
			return;
		}

		if (names.length > COMPACT_THRESHOLD) {
			this.renderCompact(names, names.length - 2);
			return;
		}

		this.renderAll(names);
		window.requestAnimationFrame(() => {
			if (!el.isConnected) return;
			if (el.clientWidth === 0) return;
			if (el.scrollWidth > el.clientWidth && names.length > 2) {
				this.renderCompact(names, names.length - 2);
			}
		});
	}

	private showSingleFile() {
		const el = this.el;
		if (!el) return;
		el.empty();
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return;
		const item = createSpan();
		item.className = 'minimalism-ui-breadcrumb-item is-current';
		item.textContent = LeafNameUtils.stripPrefix(activeFile.basename, this.getSettings().filenamePrefixLength);
		el.appendChild(item);
	}

	private renderAll(names: string[]) {
		const el = this.el;
		if (!el) return;
		el.empty();
		names.forEach((name, i) => {
			if (i > 0) el.appendChild(this.makeSep());
			el.appendChild(this.makeItem(name, i, i === names.length - 1));
		});
	}

	private renderCompact(names: string[], collapsedCount: number) {
		const el = this.el;
		if (!el) return;
		el.empty();

		// 首项下标恒为 0,可点;折叠的中间项与当前项不可点。
		el.appendChild(this.makeItem(names[0], 0, false));
		el.appendChild(this.makeSep());

		const collapse = createSpan();
		collapse.className = 'minimalism-ui-breadcrumb-collapse';
		collapse.textContent = `···${collapsedCount}···`;
		el.appendChild(collapse);

		el.appendChild(this.makeSep());
		el.appendChild(this.makeItem(names[names.length - 1], names.length - 1, true));
	}

	private makeSep(): HTMLElement {
		const sep = createSpan();
		sep.className = 'minimalism-ui-breadcrumb-sep';
		sep.textContent = '/';
		return sep;
	}

	// 渲染下标与导航历史栈下标 1:1(末尾追加的无文件视图标签恒为当前项,不可点),
	// 故非当前项可直接用 index 触发 onNavigate(连续后退到该条目)。
	private makeItem(name: string, index: number, isCurrent: boolean): HTMLElement {
		const item = createSpan();
		item.className = isCurrent
			? 'minimalism-ui-breadcrumb-item is-current'
			: 'minimalism-ui-breadcrumb-item is-clickable';
		item.textContent = name;
		if (!isCurrent) {
			item.addEventListener('click', () => this.onNavigate(index));
		}
		return item;
	}
}
