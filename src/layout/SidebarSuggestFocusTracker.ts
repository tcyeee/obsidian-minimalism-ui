import { Feature } from '../core/Feature';

const FOCUS_CLASS = 'minimalism-ui-sidebar-prop-focus';
const SIDEBAR_PROP_SELECTOR = '.workspace-split.mod-left-split .metadata-property-value';

/**
 * SidebarSuggestFocusTracker — 纯 CSS 无法定位的状态，用最小 JS 补足。
 *
 * 属性栏输入时 Obsidian 把建议下拉（.suggestion-container）直接 appendChild 到
 * document.body，没有可区分的 class。过去 styles.css 用
 * `body:has(... .metadata-property-value:focus-within) .suggestion-container`
 * 命中“此刻为左侧栏属性而开”的那一个弹层，但 :has 会触发大范围选择器失效，有明显性能开销
 * （Obsidian 提交审核也会就此告警）。
 *
 * 这里监听 focusin/focusout：当焦点落在左侧栏 .metadata-property-value 内时，给 body 加
 * .minimalism-ui-sidebar-prop-focus；离开时移除。CSS 据此为弹层着深色，等价于原 :has 选择器。
 * 每次焦点变化只做一次 closest() 判定，开销远低于 :has。
 */
export class SidebarSuggestFocusTracker implements Feature {
	private readonly onFocusIn = () => this.sync();
	// focusout 先于焦点落定触发；下一个 tick 再读 activeElement，避免点击建议项时误判离焦。
	private readonly onFocusOut = () => activeWindow.setTimeout(() => this.sync(), 0);
	private bound = false;

	apply() {
		if (this.bound) return;
		activeDocument.addEventListener('focusin', this.onFocusIn);
		activeDocument.addEventListener('focusout', this.onFocusOut);
		this.bound = true;
		this.sync();
	}

	remove() {
		if (!this.bound) return;
		activeDocument.removeEventListener('focusin', this.onFocusIn);
		activeDocument.removeEventListener('focusout', this.onFocusOut);
		this.bound = false;
		activeDocument.body.classList.remove(FOCUS_CLASS);
	}

	private sync() {
		// remove() 后可能还有一个 pending 的 focusout setTimeout 回调，跳过避免重新加 class。
		if (!this.bound) return;
		const active = activeDocument.activeElement;
		const focused = !!active?.closest(SIDEBAR_PROP_SELECTOR);
		activeDocument.body.classList.toggle(FOCUS_CLASS, focused);
	}
}
