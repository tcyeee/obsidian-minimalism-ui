/**
 * uiDoc() / uiWin() —— 插件 UI 所属的**主窗口**文档 / 窗口。
 *
 * 为什么不用 activeDocument / activeWindow：
 * Obsidian 1.13 起「设置」默认在一个独立窗口里打开（vault 配置 `settingsPopoutWindow`，
 * 默认 true），并且在该窗口存在期间把全局 activeWindow / activeDocument 整个改指向它：
 *
 *     this.popout.win.document.body.addClass("is-popout-modal"),
 *     activeWindow = this.popout.win, activeDocument = this.popout.win.document
 *
 * （关闭设置窗口时才在 cleanup() 里还原；期间即使把焦点切回主窗口也不会还原。）
 *
 * 而本插件绝大多数 apply() 恰恰是被「保存设置」触发的——也就是设置窗口必然开着的时刻。
 * 此时再读 activeDocument，DOM 操作就全落到设置窗口去了，实测到的三类症状：
 *   · 右下角悬浮按钮被注入到**设置窗口**右下角，主窗口里反而消失（设置窗口一关就彻底没了）；
 *   · body class 加到设置窗口的 body 上，主窗口那些纯 CSS 驱动的开关（隐藏标签栏、
 *     底部用户设置区域、单页模式外观……）改了像没反应，要重启才生效；
 *   · querySelector 在设置窗口里找不到工作区节点 → 依赖 DOM 注入的功能静默失效。
 * 笔记弹出窗口（popout note window）同理：焦点在弹出窗口时改设置会踩同一个坑。
 *
 * 插件的 JS 是在主窗口这个 realm 里求值的，模块作用域里的 window/document 恒为主窗口
 * （弹出窗口只是它 window.open 出来的子窗口，不会改变这里的绑定），因此直接取它即可。
 * 需要跨窗口生效的功能请显式遍历窗口（如 MermaidZoomManager 走 workspace 的
 * window-open / window-close 事件），而不是依赖 activeDocument 的"当前"语义。
 */
export function uiDoc(): Document {
	return window.document;
}

export function uiWin(): Window {
	return window;
}
