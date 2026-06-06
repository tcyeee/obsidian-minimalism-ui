/**
 * ResizeObserverErrorSuppressor — 抑制无害的 ResizeObserver 级联报错
 *
 * "ResizeObserver loop completed with undelivered notifications" 由 CodeMirror 内部
 * ResizeObserver 级联迭代次数超出浏览器阈值时触发，笔记样式改变行高/字体大小也会触发。
 * 浏览器抛出此错误事件（非致命，未送达的通知会推迟到下一帧自动处理），但 Obsidian 的
 * window.onerror 会将它展示为用户可见的报错提示。通过 capture phase 提前拦截，阻止其
 * 传播到 Obsidian 的全局 handler。
 *
 * 注：监听挂在主窗口 `window` 上，仅覆盖主窗口的 CodeMirror；弹出窗口有独立的 window。
 */
export class ResizeObserverErrorSuppressor {
	private handler: ((e: ErrorEvent) => void) | null = null;

	apply() {
		this.remove();
		this.handler = (e: ErrorEvent) => {
			if (e.message === 'ResizeObserver loop completed with undelivered notifications.') {
				e.stopImmediatePropagation();
				e.preventDefault();
			}
		};
		window.addEventListener('error', this.handler, true);
	}

	remove() {
		if (this.handler) {
			window.removeEventListener('error', this.handler, true);
			this.handler = null;
		}
	}
}
