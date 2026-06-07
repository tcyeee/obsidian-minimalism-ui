import { MinimalismUISettings } from './settings';
import { Feature } from './Feature';

const BODY_CLASSES = [
	'minimalism-ui-mac-sidebar',
	'minimalism-ui-hide-tab-bar',
	'minimalism-ui-disable-pin',
	'minimalism-ui-simplify-panel',
	'minimalism-ui-disable-note-tabs',
	'minimalism-ui-note-style',
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
		cls.toggle('minimalism-ui-mac-sidebar', s.macSidebar);
		cls.toggle('minimalism-ui-hide-tab-bar', s.hideTabBar);
		cls.toggle('minimalism-ui-disable-pin', s.disablePinTab);
		cls.toggle('minimalism-ui-simplify-panel', s.simplifyPanel);
		cls.toggle('minimalism-ui-disable-note-tabs', s.disableNoteTabs);
		cls.toggle('minimalism-ui-note-style', s.noteStyle);
	}

	remove() {
		activeDocument.body.classList.remove(...BODY_CLASSES);
	}
}
