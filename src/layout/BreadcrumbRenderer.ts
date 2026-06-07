import { App, TAbstractFile, TFile } from 'obsidian';
import { MinimalismUISettings } from '../core/settings';
import { LeafNameUtils } from '../core/utils';

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
	private activeLeafHandler: (() => void) | null = null;
	private renameHandler: ((file: TAbstractFile) => void) | null = null;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		private navHistoryGetter: () => string[],
	) {}

	mount(parent: HTMLElement) {
		this.unmount();

		this.el = createDiv();
		this.el.className = 'minimalism-ui-drag-bar-breadcrumb';
		parent.appendChild(this.el);

		this.update();

		this.activeLeafHandler = () => this.update();
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
	}

	private update() {
		const el = this.el;
		if (!el) return;
		const prefixLen = this.getSettings().filenamePrefixLength;
		const paths = this.navHistoryGetter();
		if (paths.length <= 1) {
			this.showSingleFile();
			return;
		}
		// 路径是稳定字符串,直接从 vault 查文件名,无需过滤关闭的 leaf
		const names = paths.map(p => {
			const f = this.app.vault.getAbstractFileByPath(p);
			return f instanceof TFile
				? LeafNameUtils.stripPrefix(f.basename, prefixLen)
				: LeafNameUtils.stripPrefix(p, prefixLen);
		});

		if (paths.length > COMPACT_THRESHOLD) {
			this.renderCompact(names, names.length - 2);
			return;
		}

		this.renderAll(names);
		requestAnimationFrame(() => {
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
		el.innerHTML = '';
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
		el.innerHTML = '';
		names.forEach((name, i) => {
			if (i > 0) {
				const sep = createSpan();
				sep.className = 'minimalism-ui-breadcrumb-sep';
				sep.textContent = '/';
				el.appendChild(sep);
			}
			const item = createSpan();
			item.className = i === names.length - 1
				? 'minimalism-ui-breadcrumb-item is-current'
				: 'minimalism-ui-breadcrumb-item';
			item.textContent = name;
			el.appendChild(item);
		});
	}

	private renderCompact(names: string[], collapsedCount: number) {
		const el = this.el;
		if (!el) return;
		el.innerHTML = '';

		const first = createSpan();
		first.className = 'minimalism-ui-breadcrumb-item';
		first.textContent = names[0];
		el.appendChild(first);

		const sep1 = createSpan();
		sep1.className = 'minimalism-ui-breadcrumb-sep';
		sep1.textContent = '/';
		el.appendChild(sep1);

		const collapse = createSpan();
		collapse.className = 'minimalism-ui-breadcrumb-collapse';
		collapse.textContent = `···${collapsedCount}···`;
		el.appendChild(collapse);

		const sep2 = createSpan();
		sep2.className = 'minimalism-ui-breadcrumb-sep';
		sep2.textContent = '/';
		el.appendChild(sep2);

		const last = createSpan();
		last.className = 'minimalism-ui-breadcrumb-item is-current';
		last.textContent = names[names.length - 1];
		el.appendChild(last);
	}
}
