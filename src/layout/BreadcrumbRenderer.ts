import { App, setIcon, TAbstractFile, TFile, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from '../core/settings';
import { LeafNameUtils } from '../core/utils';
import { GLOBAL_GRAPH_KEY, isFilelessViewKey, viewTypeFromKey } from '../single-page/NavigationHistory';
import { t } from '../core/i18n';

const COMPACT_THRESHOLD = 15;

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

	// 外部（SinglePageEngine 经 DragBarManager）在记录一次导航后调用：用于 active-leaf-change 未触发
	// 的场景（如 deferred 视图经 revealLeaf 显示），同步当前 leaf 并重绘面包屑。
	notifyActiveLeaf(leaf: WorkspaceLeaf | null) {
		this.currentLeaf = leaf;
		this.update();
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

		this.renderTrail(this.buildTrail(paths, filelessLabel), this.firstIsHome(paths));
	}

	// 导航历史的首项是否正好是设置里的主页(homePage 存的是完整路径,与历史栈一致)。
	private firstIsHome(paths: string[]): boolean {
		const home = this.getSettings().homePage;
		return !!home && paths[0] === home;
	}

	// 纯函数(无 DOM):由历史路径 + 当前无文件视图标签算出面包屑文本序列。
	// 无文件视图(关系图及各类插件视图)现已作为真实条目入栈,buildNames 会渲染它;只有在它尚未落入
	// 历史(active-leaf-change 与 nav 记录之间的时序间隙)时,才用实时标签补在末尾,避免重复出现。
	private buildTrail(paths: string[], filelessLabel: string | null): string[] {
		const names = this.buildNames(paths, filelessLabel);
		const last = paths[paths.length - 1];
		if (filelessLabel !== null && (last === undefined || !isFilelessViewKey(last))) {
			names.push(filelessLabel);
		}
		return names;
	}

	// 当前激活 leaf 若是无文件视图(全局关系图、各类插件自定义视图等),返回其本地化标题作为
	// 面包屑当前项;否则返回 null。判定方式不再用 viewType 白名单,而是看视图是否挂在文件上:
	// Obsidian 的 FileView(markdown / canvas / pdf 等)有 view.file,无 file 即视为无文件视图,
	// 这样所有插件视图无需逐个登记都能正确显示。空视图(empty)不挂文件但也无内容可标注,排除。
	private activeFilelessViewLabel(): string | null {
		const view = (this.currentLeaf ?? this.app.workspace.getMostRecentLeaf())?.view;
		if (!view || view.getViewType() === 'empty') return null;
		if ((view as { file?: unknown }).file) return null;
		return view.getDisplayText() || view.getViewType();
	}

	// 路径是稳定字符串,直接从 vault 查文件名,无需过滤关闭的 leaf。
	// 无文件视图的合成键不是文件路径:关系图映射为本地化 graph 标签;其余视图若正是当前末项则用实时
	// getDisplayText(filelessLabel),否则退化为 viewType。避免被 stripPrefix 截成乱码。
	private buildNames(paths: string[], filelessLabel: string | null): string[] {
		const prefixLen = this.getSettings().filenamePrefixLength;
		return paths.map((p, i) => {
			if (p === GLOBAL_GRAPH_KEY) return t('graphView');
			if (isFilelessViewKey(p)) {
				if (i === paths.length - 1 && filelessLabel) return filelessLabel;
				return viewTypeFromKey(p) ?? p;
			}
			const f = this.app.vault.getAbstractFileByPath(p);
			if (f instanceof TFile) return LeafNameUtils.stripPrefix(f.basename, prefixLen);
			// 文件已不在 vault(被删):从路径推导 basename(去目录、去扩展名)再剥前缀,
			// 避免直接对完整路径 slice 导致连文件夹名 / 扩展名一起被截。
			const base = p.split('/').pop()!.replace(/\.md$/, '');
			return LeafNameUtils.stripPrefix(base, prefixLen);
		});
	}

	// 渲染完整路径:单项→当前项;超阈值或溢出→折叠中间项;否则完整列出。
	private renderTrail(names: string[], firstIsHome: boolean) {
		const el = this.el;
		if (!el) return;
		if (names.length === 0) return;

		if (names.length === 1) {
			el.empty();
			el.appendChild(this.makeItem(names[0], 0, true, firstIsHome));
			return;
		}

		if (names.length > COMPACT_THRESHOLD) {
			this.renderCompact(names, names.length - 2, firstIsHome);
			return;
		}

		this.renderAll(names, firstIsHome);
		window.requestAnimationFrame(() => {
			if (!el.isConnected) return;
			if (el.clientWidth === 0) return;
			if (el.scrollWidth > el.clientWidth && names.length > 2) {
				this.renderCompact(names, names.length - 2, firstIsHome);
			}
		});
	}

	private showSingleFile() {
		const el = this.el;
		if (!el) return;
		el.empty();
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return;
		const home = this.getSettings().homePage;
		const isHome = !!home && activeFile.path === home;
		const name = LeafNameUtils.stripPrefix(activeFile.basename, this.getSettings().filenamePrefixLength);
		el.appendChild(this.makeItem(name, 0, true, isHome));
	}

	private renderAll(names: string[], firstIsHome: boolean) {
		const el = this.el;
		if (!el) return;
		el.empty();
		names.forEach((name, i) => {
			if (i > 0) el.appendChild(this.makeSep());
			el.appendChild(this.makeItem(name, i, i === names.length - 1, i === 0 && firstIsHome));
		});
	}

	private renderCompact(names: string[], collapsedCount: number, firstIsHome: boolean) {
		const el = this.el;
		if (!el) return;
		el.empty();

		// 首项下标恒为 0,可点;折叠的中间项与当前项不可点。
		el.appendChild(this.makeItem(names[0], 0, false, firstIsHome));
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
	private makeItem(name: string, index: number, isCurrent: boolean, withHomeIcon = false): HTMLElement {
		const item = createSpan();
		item.className = isCurrent
			? 'minimalism-ui-breadcrumb-item is-current'
			: 'minimalism-ui-breadcrumb-item is-clickable';
		// 首项恰为主页时,文字前加一个房屋 icon。
		if (withHomeIcon) {
			const icon = item.createSpan({ cls: 'minimalism-ui-breadcrumb-home-icon' });
			setIcon(icon, 'house');
		}
		item.appendText(name);
		if (!isCurrent) {
			item.addEventListener('click', () => this.onNavigate(index));
		}
		return item;
	}
}
