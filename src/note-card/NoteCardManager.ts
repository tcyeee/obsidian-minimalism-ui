import { Plugin } from 'obsidian';
import { Feature } from '../core/Feature';
import { MinimalismUISettings } from '../core/settings';
import { NoteCardView, VIEW_TYPE_NOTE_CARD } from './NoteCardView';

/**
 * NoteCardManager — 注册 NoteCardView 这一个 view type，并把「每个 slot 最后绑定的笔记路径」
 * 接到 settings.noteCardBindings，按 slotId 分流（为什么需要这一层、与另外两层持久化的关系，
 * 见该字段注释）。
 *
 * 故意没有命令 / 右键菜单入口：用户添加它的唯一方式是鼠标操作——设置页「左侧边栏样式」里
 * 的「添加面板」下拉框（它作为一个普通已注册工具类 view 出现，见 LeafMountService 里
 * DOCUMENT_VIEW_TYPES 的排除说明）。与其它 view type 不同的是它允许在 slot 列表里重复添加
 * 多份（见 settings.ts 的 MULTI_INSTANCE_VIEW_TYPES），每份各自独立绑定；选中 / 删除 /
 * 拖拽排序都走 LeftSidebarManager 现成的通用 slot 逻辑，这里不需要任何额外接线。
 *
 * apply() 只在 onload() 跑一次——registerView 由 Obsidian 在 Plugin.onunload() 时自动
 * 逆注册，remove() 无需手写清理（也不能重复 apply，否则对同一 type 二次注册会抛错）。
 */
export class NoteCardManager implements Feature {
	constructor(
		private plugin: Plugin,
		private getSettings: () => MinimalismUISettings,
		private saveSettings: () => void | Promise<void>,
	) {}

	apply(): void {
		this.plugin.registerView(VIEW_TYPE_NOTE_CARD, (leaf) => new NoteCardView(leaf, {
			getLastFile: (slotId) => this.getSettings().noteCardBindings[slotId] ?? null,
			setLastFile: (slotId, path) => {
				const settings = this.getSettings();
				if (path) settings.noteCardBindings[slotId] = path;
				else delete settings.noteCardBindings[slotId];
				void this.saveSettings();
			},
		}));
	}

	remove(): void {
		// 故意留空，见上方类注释。
	}
}
