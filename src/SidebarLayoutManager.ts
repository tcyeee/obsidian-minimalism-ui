import { App, WorkspaceLeaf } from 'obsidian';
import { MinimalismUISettings } from './settings';

type WorkspaceSidedock = { collapsed: boolean; expand(): void };

/**
 * SidebarLayoutManager — triggered when 极简侧边栏 is enabled.
 *
 * Arranges the left sidebar into two sections:
 *   • Top   — Outline (data-type="outline")
 *   • Bottom — File properties (data-type="file-properties")
 */
export class SidebarLayoutManager {
	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
	) {}

	async apply() {
		if (!this.getSettings().macSidebar) return;

		const { workspace } = this.app;
		const leftSplit = workspace.leftSplit as unknown as WorkspaceSidedock;

		// 1. Open left sidebar if collapsed
		if (leftSplit?.collapsed) {
			leftSplit.expand();
		}

		// 2. Detach all existing left sidebar leaves
		const toDetach: WorkspaceLeaf[] = [];
		workspace.iterateAllLeaves(leaf => {
			const containerEl = (leaf as WorkspaceLeaf & { containerEl?: HTMLElement }).containerEl;
			if (containerEl?.closest('.workspace-split.mod-left-split')) {
				toDetach.push(leaf);
			}
		});
		for (const leaf of toDetach) {
			leaf.detach();
		}

		// Re-expand in case Obsidian collapsed the sidebar after clearing
		if (leftSplit?.collapsed) {
			leftSplit.expand();
		}

		// 3. Outline in the top section
		const outlineLeaf = workspace.getLeftLeaf(false);
		if (outlineLeaf) {
			await outlineLeaf.setViewState({ type: 'outline', active: false });
		}

		// 4. File properties in the bottom section (new horizontal split)
		const propsLeaf = workspace.getLeftLeaf(true);
		if (propsLeaf) {
			await propsLeaf.setViewState({ type: 'file-properties', active: false });
		}
	}
}
