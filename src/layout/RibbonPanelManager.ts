import { setIcon } from 'obsidian';
import { Feature } from '../core/Feature';
import { MinimalismUISettings } from '../core/settings';

type MovedNode = { el: HTMLElement; parent: HTMLElement; next: ChildNode | null };
type WrappedIcon = { icon: HTMLElement; wrapper: HTMLElement };

/**
 * RibbonPanelManager — 重排左下角 vault profile 区：
 *  1. 将 .side-dock-actions 从左侧 ribbon 迁入 vault profile 内嵌的可折叠面板（面板居顶）。
 *  2. 将 .workspace-drawer-vault-switcher（名称）与 .workspace-drawer-vault-actions（操作图标）
 *     包进一行容器，左右分布。
 *
 * 注入策略与 SidebarLayoutManager 一致：移动既有节点前先记录 (parent, nextSibling)，
 * remove() 逆序用 insertBefore 精确还原；自建容器（面板 / 行）直接 remove()。
 *
 * 动画：CSS grid-template-rows 0fr ↔ 1fr trick，无需已知面板高度。
 * 状态：ribbonPanelExpanded 存入 settings，通过 saveSettings 回调持久化。
 */
export class RibbonPanelManager implements Feature {
	private panel: HTMLElement | null = null;
	private toggleBtn: HTMLElement | null = null;
	private vaultRow: HTMLElement | null = null;
	private iconsContainer: HTMLElement | null = null;
	private wrappedIcons: WrappedIcon[] = [];
	private movedNodes: MovedNode[] = [];

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
		const vaultSwitcher = vaultProfile?.querySelector<HTMLElement>(
			'.workspace-drawer-vault-switcher',
		);

		if (!sideDocActions || !vaultProfile || !vaultActions) return;

		// ── vault-switcher（左·名称）+ vault-actions（右·操作）包成一行 ──
		// 仅当两者均为 vault-profile 直接子节点时包装；记录原位以便 remove() 精确还原。
		let panelAnchor: ChildNode = vaultActions;
		if (
			vaultSwitcher &&
			vaultSwitcher.parentElement === vaultProfile &&
			vaultActions.parentElement === vaultProfile
		) {
			this.vaultRow = createDiv({ cls: 'minimalism-ui-vault-row' });
			this.recordMove(vaultSwitcher);
			this.recordMove(vaultActions);
			vaultProfile.insertBefore(this.vaultRow, vaultSwitcher);
			this.vaultRow.appendChild(vaultSwitcher);
			this.vaultRow.appendChild(vaultActions);
			panelAnchor = this.vaultRow;
		}

		// ── 内嵌 ribbon 面板：注入 vault-profile，置于行（或 actions）之上 ──
		// 外层：grid 动画靶；内层：overflow:hidden 裁切层
		this.panel = createDiv({ cls: 'minimalism-ui-ribbon-panel' });
		const inner = this.panel.createDiv({ cls: 'minimalism-ui-ribbon-panel-inner' });
		if (panelAnchor.parentElement === vaultProfile) {
			vaultProfile.insertBefore(this.panel, panelAnchor);
		} else {
			vaultProfile.prepend(this.panel);
		}

		// 将每个图标从 .side-dock-actions 迁入我们自己的容器（div 包装）。
		// 直接移动 sideDocActions 整体会继承 Obsidian 原始 flex-direction:column 及子项
		// width:100%，导致横排换行后宽度异常。用自建容器可完全控制布局。
		this.iconsContainer = inner.createDiv({ cls: 'minimalism-ui-ribbon-icons' });
		const icons = Array.from(sideDocActions.children) as HTMLElement[];
		for (const icon of icons) {
			const wrapper = createDiv({ cls: 'minimalism-ui-ribbon-icon-wrap' });
			sideDocActions.insertBefore(wrapper, icon);
			wrapper.appendChild(icon);
			this.wrappedIcons.push({ icon, wrapper });
			this.iconsContainer.appendChild(wrapper);
		}


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
		// 还原被包装的图标：从 wrapper 取出 icon，放回 sideDocActions
		for (const { icon, wrapper } of this.wrappedIcons) {
			wrapper.before(icon);
			wrapper.remove();
		}
		this.wrappedIcons = [];
		this.iconsContainer?.remove();
		this.iconsContainer = null;

		// 逆序还原被移动的节点
		for (let i = this.movedNodes.length - 1; i >= 0; i--) {
			const { el, parent, next } = this.movedNodes[i];
			if (next && next.parentNode === parent) {
				parent.insertBefore(el, next);
			} else {
				parent.appendChild(el);
			}
		}
		this.movedNodes = [];

		this.panel?.remove();
		this.toggleBtn?.remove();
		this.vaultRow?.remove();

		this.panel = null;
		this.toggleBtn = null;
		this.vaultRow = null;
	}

	private recordMove(el: HTMLElement) {
		this.movedNodes.push({ el, parent: el.parentElement as HTMLElement, next: el.nextSibling });
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
