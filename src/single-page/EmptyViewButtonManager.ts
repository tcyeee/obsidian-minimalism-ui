import { App } from 'obsidian';
import { MinimalismUISettings } from '../core/settings';
import { Feature } from '../core/Feature';
import { t } from '../core/i18n';
import { SinglePageEngine } from './SinglePageEngine';

const HOME_ACTION_CLASS = 'minimalism-ui-home-action';

/**
 * EmptyViewButtonManager — 在 Obsidian 原生空页面（empty view）底部注入“回到主页”按钮。
 *
 * 空页面的动作列表（.empty-state-action-list）在每次 EmptyView.onOpen 时被清空并重建，
 * 因此监听 layout-change / active-leaf-change，在视图渲染后补注入；注入幂等，重复调用安全。
 * 点击委托给 {@link SinglePageEngine.openHomePage}。仅在配置了首页时启用。
 */
export class EmptyViewButtonManager implements Feature {
	private handler: (() => void) | null = null;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		private engine: SinglePageEngine,
	) {}

	apply() {
		this.remove();
		if (!this.getSettings().homePage) return;

		// onOpen 异步重建动作列表，延到下一帧再注入，确保原生按钮已就位（追加在其后）。
		this.handler = () => window.requestAnimationFrame(() => this.inject());
		this.app.workspace.on('layout-change', this.handler);
		this.app.workspace.on('active-leaf-change', this.handler);
		this.inject();
	}

	private inject() {
		const lists = activeDocument.querySelectorAll<HTMLElement>(
			'.empty-state .empty-state-action-list',
		);
		lists.forEach((list) => {
			if (list.querySelector(`.${HOME_ACTION_CLASS}`)) return;
			const btn = list.createDiv({
				cls: `empty-state-action tappable ${HOME_ACTION_CLASS}`,
				text: t('goHome'),
			});
			btn.addEventListener('click', () => void this.engine.openHomePage());
		});
	}

	remove() {
		if (this.handler) {
			this.app.workspace.off('layout-change', this.handler);
			this.app.workspace.off('active-leaf-change', this.handler);
			this.handler = null;
		}
		activeDocument
			.querySelectorAll(`.${HOME_ACTION_CLASS}`)
			.forEach((el) => el.remove());
	}
}
