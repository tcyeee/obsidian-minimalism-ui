import { Feature } from './Feature';
import { MinimalismUISettings } from './settings';
import { THEME_CSS } from '../generated/theme-assets';

const STYLE_ATTR = 'data-minimalism-theme';
// body 上的主题作用域钩子：body.minimalism-ui-theme-<name>。
// 各主题 CSS 收敛在此命名空间下，使"当前是哪个主题"成为可被选择器表达的状态。
const THEME_CLASS_PREFIX = 'minimalism-ui-theme-';

/**
 * ThemeLoader — 加载内嵌在 main.js 里的笔记主题 CSS。
 *
 * 主题源码是 theme/ 下的独立文件夹（theme/<name>/，内含同名 CSS 与 fonts/），但分发时
 * 由构建脚本（scripts/generate-theme-assets.mjs）内嵌进 main.js：Obsidian 市场安装只下载
 * main.js / manifest.json / styles.css 三个文件，theme/ 文件夹到不了用户 vault，所以
 * 运行时一律从内嵌的 THEME_CSS 取，不读文件系统。
 *
 * apply() 取当前 settings.theme 对应的内嵌 CSS，注入一个带 data-minimalism-theme 标记的
 * <style> 元素，并在 <body> 打上 minimalism-ui-theme-<name> 作用域钩子（各主题 CSS 收敛于此
 * 命名空间下，可表达"主题专属"规则）；重复调用先清旧再注入，保证幂等与切换生效。
 * remove() 移除该 <style> 并清除 body 上的主题钩子。主题无 CSS 时静默跳过（与 FontLoader 一致）。
 *
 * 笔记样式分两层：body.minimalism-ui-note-style 是"主题无关基线"（全程默认开启，所有主题之下
 * 通用的笔记排版底座，作为共享扩展点保留）；body.minimalism-ui-theme-<name> 是各主题专属的内容
 * 美学层。本加载器只负责"提供哪一套主题规则"并打上对应作用域钩子。
 */
export class ThemeLoader implements Feature {
	constructor(
		private settings: () => MinimalismUISettings,
	) {}

	apply() {
		this.remove();
		const name = this.settings().theme;
		if (!name) return;

		// 先打主题作用域钩子（即使该主题暂无 CSS，也标记"当前主题"）
		activeDocument.body.classList.add(`${THEME_CLASS_PREFIX}${name}`);

		const css = THEME_CSS[name];
		if (!css) return;

		const style = activeDocument.createElement('style');
		style.setAttribute(STYLE_ATTR, name);
		style.textContent = css;
		activeDocument.head.appendChild(style);
	}

	remove() {
		activeDocument.head.querySelectorAll(`style[${STYLE_ATTR}]`).forEach(el => el.remove());
		// 清除 body 上任何主题作用域钩子（切换主题时一并移除上一个）
		const cls = activeDocument.body.classList;
		Array.from(cls)
			.filter(c => c.startsWith(THEME_CLASS_PREFIX))
			.forEach(c => cls.remove(c));
	}

	/** 列出所有可选主题名（内嵌清单的 key 集合）。 */
	listThemes(): string[] {
		return Object.keys(THEME_CSS).sort();
	}
}
