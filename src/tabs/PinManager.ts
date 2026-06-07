import { App, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from '../core/settings';

type LeafInternal = WorkspaceLeaf & {
	containerEl?: HTMLElement;
	detach: () => void;
};

/**
 * PinManager — 收敛防 pin 相关逻辑（均依赖 `disableNoteTabs`，即单页模式）：
 *
 *   1. **右键 pin 拦截** — capture 阶段拦掉 tab header 上的 contextmenu，
 *      阻止用户通过右键菜单 pin 标签。
 *   2. **侧边栏 leaf detach 守卫** — 把左侧边栏所有 leaf 的 `detach` patch 成 no-op，
 *      防止用户右键关闭侧边栏面板；新 leaf 在 layout-change 时补 patch。
 *
 * 两者都是单页模式的固有行为，单页模式关闭时一并停用。
 *
 * `forceDetachLeaf` 供 {@link SidebarLayoutManager} 绕过守卫强制 detach（重建侧边栏时使用）。
 * 该方法在守卫未启用时也可调用——此时无 patch，退化为普通 `leaf.detach()`。
 */
export class PinManager {
	private pinBlockHandler: ((e: MouseEvent) => void) | null = null;
	// 侧边栏 leaf 的 detach 拦截，key=leaf，value=原始 detach
	private sidebarDetachPatches = new Map<WorkspaceLeaf, () => void>();
	private sidebarLayoutChangeHandler: (() => void) | null = null;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
	) {}

	apply() {
		this.remove();
		const s = this.getSettings();

		// 禁用 pin 标签已并入单页模式：两项守卫均在单页模式下启用。
		if (s.disableNoteTabs) {
			// 1. 右键 pin 拦截
			this.pinBlockHandler = (e: MouseEvent) => {
				if ((e.target as Element).closest('.workspace-tab-header.tappable')) {
					e.stopImmediatePropagation();
					e.preventDefault();
				}
			};
			activeDocument.addEventListener('contextmenu', this.pinBlockHandler, true);

			// 2. 侧边栏 leaf detach 守卫，新 leaf 在 layout-change 时补 patch。
			this.patchSidebarLeafDetach();
			this.sidebarLayoutChangeHandler = () => this.patchSidebarLeafDetach();
			this.app.workspace.on('layout-change', this.sidebarLayoutChangeHandler);
		}
	}

	remove() {
		if (this.pinBlockHandler) {
			activeDocument.removeEventListener('contextmenu', this.pinBlockHandler, true);
			this.pinBlockHandler = null;
		}
		if (this.sidebarLayoutChangeHandler) {
			this.app.workspace.off('layout-change', this.sidebarLayoutChangeHandler);
			this.sidebarLayoutChangeHandler = null;
		}
		for (const [leaf, original] of this.sidebarDetachPatches) {
			(leaf as LeafInternal).detach = original;
		}
		this.sidebarDetachPatches.clear();
	}

	// 绕过 detach 守卫，强制 detach 一个 leaf（供 SidebarLayoutManager 重建侧边栏时调用）
	forceDetachLeaf(leaf: WorkspaceLeaf) {
		const original = this.sidebarDetachPatches.get(leaf);
		if (original) {
			original();
		} else {
			leaf.detach();
		}
	}

	// 拦截左侧边栏所有 leaf 的 detach，防止用户通过右键菜单关闭（pin guard）
	private patchSidebarLeafDetach() {
		this.app.workspace.iterateAllLeaves(leaf => {
			if (this.sidebarDetachPatches.has(leaf)) return;
			const leafEl = (leaf as LeafInternal).containerEl;
			if (!leafEl?.closest('.workspace-split.mod-left-split')) return;
			const original = (leaf as LeafInternal).detach.bind(leaf);
			(leaf as LeafInternal).detach = () => { /* blocked */ };
			this.sidebarDetachPatches.set(leaf, original);
		});
	}
}
