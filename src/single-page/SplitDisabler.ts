import { App, Platform } from 'obsidian';
import { MinimalismUISettings } from '../core/settings';
import { Feature } from '../core/Feature';

/**
 * SplitDisabler — 单页模式下从源头彻底关掉主区"左右/上下分屏"。
 *
 * 为什么必须从源头关掉而不是事后收拢：主区一旦真的分成两个标签组，左右两边的笔记会同时争抢
 * 插件的顶部导航栏（面包屑/前进后退只认一个"当前页"），并且 {@link SingleTabGroupGuard} 的合并
 * 与引擎的"可视位交接"会互相喂事件——每轮都新建 leaf，Obsidian 直接卡死；爆炸后的布局还会被
 * 存进 workspace.json，重启即复现。分屏对单页模式来说不是"要不要支持"，而是必须不可能发生。
 *
 * 两道封锁，合起来覆盖所有能产生分屏的入口：
 *
 * 1. **Platform.canSplit = false** —— 这是 Obsidian 自己为手机端准备的原生总开关（`canSplit`
 *    的原始实现就是 `!Platform.isPhone`），比逐个 monkey-patch 可靠得多，一处生效全线收口：
 *      · `createLeafBySplit()` 直接退化成"在原标签组里开一个 tab"；`splitActiveLeaf()` /
 *        `splitLeafOrActive()` / `duplicateLeaf(leaf, 'vertical'|'horizontal')` /
 *        `getLeaf('split')` 全部经由它，于是命令面板的「向右/向下拆分」、Mod+Alt+点击链接、
 *        第三方插件调的分屏 API 一律落成单页 tab；
 *      · 各类右键菜单里的「向右拆分」「在右侧打开」「在文档中显示反向链接/大纲/属性」条目由
 *        Obsidian 自己按 canSplit 决定是否添加，于是直接从菜单里消失，不留"点了没反应"的死入口；
 *      · 工作区反序列化时，Obsidian 会在 `!canSplit` 下把 root 里的多个标签组**压平成一个**——
 *        这正好把老用户 workspace.json 里存量的分屏布局在启动时就地化解掉。
 *    因此本单元必须在 `onload()` 里就 apply（插件加载早于 `workspace.loadLayout()`），而不是
 *    等到 onLayoutReady。
 *
 * 2. **workspace.getDropDirection 收口为 'center'** —— 拖拽分屏不走上面任何 API，而是由拖拽
 *    管理器自己算出落点方向后直接调内部 `splitLeaf()`，canSplit 管不到它。该方法返回
 *    'left'/'right'/'top'/'bottom' 即表示"在这一侧劈开"，返回 'center' 表示"并入这个标签组"。
 *    对主区目标恒定返回 'center'，拖拽就只剩"换标签顺序"这一种语义，连拖拽时的半屏预览蒙层
 *    也一并不再出现（预览与落点读的是同一个方法）。左右侧边栏不在收口范围内，面板纵向堆叠
 *    仍是原生行为。
 *
 * gate 在 disableNoteTabs（单页模式）下；非单页模式 apply() 空转，分屏完全原生可用。
 */

type DropDirection = 'left' | 'right' | 'top' | 'bottom' | 'center';

type WorkspaceInternal = {
	getDropDirection: (evt: unknown, rect: unknown, exclude: unknown, target: unknown) => DropDirection;
};

type WorkspaceItemInternal = { getRoot?: () => unknown };

export class SplitDisabler implements Feature {
	private originalCanSplit: PropertyDescriptor | null = null;
	private originalGetDropDirection: WorkspaceInternal['getDropDirection'] | null = null;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
	) {}

	apply(): void {
		this.remove();
		if (!this.getSettings().disableNoteTabs) return;
		this.disableNativeSplit();
		this.patchDropDirection();
	}

	remove(): void {
		if (this.originalCanSplit) {
			Object.defineProperty(Platform, 'canSplit', this.originalCanSplit);
			this.originalCanSplit = null;
		}
		if (this.originalGetDropDirection) {
			(this.app.workspace as unknown as WorkspaceInternal).getDropDirection = this.originalGetDropDirection;
			this.originalGetDropDirection = null;
		}
	}

	// canSplit 在 Platform 对象上是一个字面量 getter（可配置），改写后 remove() 能按原描述符还原。
	// 拿不到描述符（Obsidian 换了实现）时静默跳过：第 2 道封锁与 SingleTabGroupGuard 仍在。
	private disableNativeSplit(): void {
		const descriptor = Object.getOwnPropertyDescriptor(Platform, 'canSplit');
		if (!descriptor?.configurable) return;
		this.originalCanSplit = descriptor;
		Object.defineProperty(Platform, 'canSplit', {
			get: () => false,
			configurable: true,
			enumerable: descriptor.enumerable,
		});
	}

	private patchDropDirection(): void {
		const ws = this.app.workspace as unknown as WorkspaceInternal;
		if (typeof ws.getDropDirection !== 'function') return;
		const original = ws.getDropDirection.bind(ws);
		this.originalGetDropDirection = ws.getDropDirection;
		ws.getDropDirection = (evt, rect, exclude, target) => {
			if (this.isNoteArea(target)) return 'center';
			return original(evt, rect, exclude, target);
		};
	}

	// 落点是否属于"笔记区"（任一窗口的主编辑区）。判定方式与 Obsidian 拖拽代码本身一致：
	// 取落点所属的根容器，只要不是左/右侧边栏就视为笔记区——弹出窗口的主区同样需要收口。
	private isNoteArea(target: unknown): boolean {
		const root = (target as WorkspaceItemInternal | null)?.getRoot?.();
		if (!root) return false;
		return root !== this.app.workspace.leftSplit && root !== this.app.workspace.rightSplit;
	}
}
