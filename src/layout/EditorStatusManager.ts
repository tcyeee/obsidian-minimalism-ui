import { App, MarkdownView, Plugin } from 'obsidian';
import { Feature } from '../core/Feature';

// 锁图标 SVG（Lucide lock）
const LOCK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;

/**
 * EditorStatusManager — 阅读模式锁图标。
 *
 * 隐藏 Obsidian 原生 plugin-editor-status 状态栏条目，
 * 仅在阅读视图时显示一把锁图标；点击切换回实时预览模式。
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
		this.statusBarItem.innerHTML = LOCK_SVG;
		this.statusBarItem.setAttribute('aria-label', '阅读模式 — 点击切换编辑');
		this.statusBarItem.setAttribute('data-tooltip-position', 'top');
		this.statusBarItem.style.display = 'none';

		this.statusBarItem.addEventListener('click', () => {
			const leaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
			if (!leaf) return;
			const state = leaf.getViewState();
			leaf.setViewState({ ...state, state: { ...state.state, mode: 'source' } });
		});

		const update = () => this.updateVisibility();
		this.leafChangeHandler = update;
		this.layoutChangeHandler = update;

		this.app.workspace.on('active-leaf-change', this.leafChangeHandler);
		this.app.workspace.on('layout-change', this.layoutChangeHandler);

		this.updateVisibility();
	}

	private updateVisibility(): void {
		if (!this.statusBarItem) return;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const isReading = view?.getState().mode === 'preview';
		this.statusBarItem.style.display = isReading ? '' : 'none';
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
