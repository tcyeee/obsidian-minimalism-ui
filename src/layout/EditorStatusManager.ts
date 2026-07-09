import { App, MarkdownView, Plugin } from 'obsidian';
import { Feature } from '../core/Feature';

// 锁图标 SVG（Lucide lock）
const LOCK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
// 解析一次，运行期用 cloneNode 复用，避免 innerHTML 赋值
const LOCK_SVG_EL = new DOMParser().parseFromString(LOCK_SVG, 'image/svg+xml').documentElement;

/**
 * EditorStatusManager — 阅读模式锁图标。
 *
 * 隐藏 Obsidian 原生 plugin-editor-status 状态栏条目，常驻显示一把锁图标：
 * 阅读模式下图标变为主题强调色，编辑模式下为浅灰色（未激活态）；点击在两种模式间切换。
 */
export class EditorStatusManager implements Feature {
	private statusBarItem: HTMLElement | null = null;
	private leafChangeHandler: (() => void) | null = null;
	private layoutChangeHandler: (() => void) | null = null;

	constructor(private app: App, private plugin: Plugin) {}

	apply(): void {
		this.remove();

		this.statusBarItem = this.plugin.addStatusBarItem();
		this.statusBarItem.addClass('minimalism-ui-editor-lock');
		this.statusBarItem.appendChild(LOCK_SVG_EL.cloneNode(true));
		this.statusBarItem.setAttribute('data-tooltip-position', 'top');

		this.statusBarItem.addEventListener('click', () => {
			const leaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
			if (!leaf) return;
			const state = leaf.getViewState();
			const nextMode = state.state?.mode === 'preview' ? 'source' : 'preview';
			void leaf.setViewState({ ...state, state: { ...state.state, mode: nextMode } });
		});

		const update = () => this.updateState();
		this.leafChangeHandler = update;
		this.layoutChangeHandler = update;

		this.app.workspace.on('active-leaf-change', this.leafChangeHandler);
		this.app.workspace.on('layout-change', this.layoutChangeHandler);

		this.updateState();
	}

	private updateState(): void {
		if (!this.statusBarItem) return;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const isReading = view?.getState().mode === 'preview';
		this.statusBarItem.toggleClass('is-reading', isReading);
		this.statusBarItem.setAttribute('aria-label', isReading ? '阅读模式 — 点击切换编辑' : '编辑模式 — 点击切换阅读');
	}

	remove(): void {
		if (this.leafChangeHandler) {
			this.app.workspace.off('active-leaf-change', this.leafChangeHandler);
			this.leafChangeHandler = null;
		}
		if (this.layoutChangeHandler) {
			this.app.workspace.off('layout-change', this.layoutChangeHandler);
			this.layoutChangeHandler = null;
		}
		if (this.statusBarItem) {
			this.statusBarItem.remove();
			this.statusBarItem = null;
		}
	}
}
