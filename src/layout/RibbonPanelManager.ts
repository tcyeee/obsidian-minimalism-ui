import { setIcon } from 'obsidian';
import { Feature } from '../core/Feature';
import { MinimalismUISettings } from '../core/settings';

/**
 * RibbonPanelManager — 将 .side-dock-actions 从左侧 ribbon 迁移至侧边栏底部可折叠面板。
 *
 * 注入策略与 SidebarLayoutManager 一致：移动最内层展示节点，记录 originalParent +
 * originalNextSibling，remove() 用 insertBefore 精确还原。
 *
 * 动画：CSS grid-template-rows 0fr ↔ 1fr trick，无需已知面板高度。
 * 状态：ribbonPanelExpanded 存入 settings，通过 saveSettings 回调持久化。
 */
export class RibbonPanelManager implements Feature {
	private panel: HTMLElement | null = null;
	private toggleBtn: HTMLElement | null = null;
	private movedEl: HTMLElement | null = null;
	private movedElOriginalParent: HTMLElement | null = null;
	private movedElOriginalNextSibling: ChildNode | null = null;

	constructor(
		private getSettings: () => MinimalismUISettings,
		private saveSettings: () => Promise<void>,
	) {}

	apply() {
		this.remove();

		const sideDocActions = activeDocument.querySelector<HTMLElement>(
			'.workspace-ribbon.side-dock-ribbon.mod-left .side-dock-actions',
		);
		const vaultProfile = activeDocument.querySelector<HTMLElement>(
			'.workspace-split.mod-left-split .workspace-sidedock-vault-profile',
		);
		const vaultActions = vaultProfile?.querySelector<HTMLElement>(
			'.workspace-drawer-vault-actions',
		);

		if (!sideDocActions || !vaultProfile || !vaultActions || !vaultProfile.parentElement) return;

		// 外层：grid 动画靶；内层：overflow:hidden 裁切层
		this.panel = createDiv({ cls: 'minimalism-ui-ribbon-panel' });
		const inner = this.panel.createDiv({ cls: 'minimalism-ui-ribbon-panel-inner' });

		// 插入 vault profile 之前（两者共享同一父节点）
		vaultProfile.parentElement.insertBefore(this.panel, vaultProfile);

		// 将 .side-dock-actions 移入 inner，记录原始位置以便 remove() 还原
		this.movedElOriginalParent = sideDocActions.parentElement as HTMLElement;
		this.movedElOriginalNextSibling = sideDocActions.nextSibling;
		this.movedEl = sideDocActions;
		inner.appendChild(sideDocActions);

		// 按持久化状态设置初始折叠
		const expanded = this.getSettings().ribbonPanelExpanded;
		if (!expanded) this.panel.classList.add('is-collapsed');

		// 展开/收起切换按钮，插入 vault-actions 最左侧
		this.toggleBtn = createDiv({ cls: 'minimalism-ui-ribbon-toggle clickable-icon' });
		setIcon(this.toggleBtn, expanded ? 'chevron-down' : 'chevron-up');
		this.toggleBtn.addEventListener('click', () => this.toggle());
		vaultActions.prepend(this.toggleBtn);
	}

	remove() {
		// 将 .side-dock-actions 还原至原 ribbon 位置
		if (this.movedEl && this.movedElOriginalParent) {
			this.movedElOriginalParent.insertBefore(this.movedEl, this.movedElOriginalNextSibling);
		}
		this.panel?.remove();
		this.toggleBtn?.remove();

		this.panel = null;
		this.toggleBtn = null;
		this.movedEl = null;
		this.movedElOriginalParent = null;
		this.movedElOriginalNextSibling = null;
	}

	private toggle() {
		if (!this.panel || !this.toggleBtn) return;
		const s = this.getSettings();
		s.ribbonPanelExpanded = !s.ribbonPanelExpanded;
		this.panel.classList.toggle('is-collapsed', !s.ribbonPanelExpanded);
		setIcon(this.toggleBtn, s.ribbonPanelExpanded ? 'chevron-down' : 'chevron-up');
		void this.saveSettings();
	}
}
