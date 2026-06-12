import { MinimalismUISettings } from './settings';
import { Feature } from './Feature';

const BODY_CLASSES = [
	'minimalism-ui-mac-sidebar',
	'minimalism-ui-hide-tab-bar',
	'minimalism-ui-disable-pin',
	'minimalism-ui-simplify-panel',
	'minimalism-ui-disable-note-tabs',
	'minimalism-ui-note-style',
	'minimalism-ui-has-home',
	'minimalism-ui-hide-vault-profile',
	'minimalism-ui-hide-ribbon',
] as const;

/**
 * BodyClassController — 把设置映射到 body 上的一组开关 class。
 *
 * 这些 class 纯粹驱动 CSS（无 JS 行为），apply() 按当前设置 toggle，remove() 全部清除。
 */
export class BodyClassController implements Feature {
	constructor(private getSettings: () => MinimalismUISettings) {}

	apply() {
		const s = this.getSettings();
		const cls = activeDocument.body.classList;
		// 极简侧边栏全程默认开启，不再受设置开关控制
		cls.add('minimalism-ui-mac-sidebar');
		cls.toggle('minimalism-ui-hide-tab-bar', s.hideTabBar);
		// 禁用 pin 标签已并入单页模式：单页模式开启时一并隐藏 pin 指示
		cls.toggle('minimalism-ui-disable-pin', s.disableNoteTabs);
		// 极简信息栏同时驱动 simplify-panel（二者一直同值，不再单独存字段）
		cls.toggle('minimalism-ui-simplify-panel', s.hideTabBar);
		cls.toggle('minimalism-ui-disable-note-tabs', s.disableNoteTabs);
		// 笔记排版基线：主题无关、全程默认开启，作为所有主题之下的共享扩展点
		// （各主题专属样式由 ThemeLoader 挂在 minimalism-ui-theme-<name> 下）
		cls.add('minimalism-ui-note-style');
		// 配置了首页时，空页面隐藏原生 Close 按钮（由“回到主页”取代）
		cls.toggle('minimalism-ui-has-home', !!s.homePage);
		// 关闭“底部用户设置区域”开关时，隐藏侧边栏底部 vault profile
		cls.toggle('minimalism-ui-hide-vault-profile', !s.showVaultProfile);
		// 关闭“功能区”开关时，隐藏左侧 ribbon 活动栏
		cls.toggle('minimalism-ui-hide-ribbon', !s.showRibbon);
	}

	remove() {
		activeDocument.body.classList.remove(...BODY_CLASSES);
	}
}
