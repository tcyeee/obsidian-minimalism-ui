import { Feature } from './Feature';
import { MinimalismUISettings } from './settings';
import { THEME_NAMES } from '../generated/theme-assets';

// body 上的主题作用域钩子：body.minimalism-ui-theme-<name>。
// 各主题 CSS 收敛在此命名空间下，使"当前是哪个主题"成为可被选择器表达的状态。
const THEME_CLASS_PREFIX = 'minimalism-ui-theme-';

/**
 * ThemeLoader — 切换当前生效的笔记主题作用域。
 *
 * 主题源码是 theme/ 下的独立文件夹（theme/<name>/，内含同名 CSS 与 fonts/）。CSS 本身不再由
 * 本加载器在运行时注入——Obsidian 插件审核禁止运行时创建/插入 <style> 元素（"styles.css" 是
 * 唯一会被自动加载的样式表），因此各主题的 CSS 原文由构建脚本
 * （scripts/generate-theme-assets.mjs）直接拼接进 styles.css 的生成区间，随插件静态分发；
 * 每个主题的规则本就收敛在 body.minimalism-ui-theme-<name> 选择器下，多个主题的 CSS 同时
 * 存在于同一份样式表里不会互相覆盖。
 *
 * apply() 只做一件事：在 <body> 打上 minimalism-ui-theme-<name> 类名，选中对应主题的 CSS
 * 生效；重复调用先清旧再打新的，保证幂等与切换生效。remove() 清除该类名。
 *
 * 笔记样式分两层：body.minimalism-ui-note-style 是"主题无关基线"（全程默认开启，所有主题之下
 * 通用的笔记排版底座，作为共享扩展点保留）；body.minimalism-ui-theme-<name> 是各主题专属的内容
 * 美学层。本加载器只负责"选中哪一套主题规则生效"。
 */
export class ThemeLoader implements Feature {
	constructor(
		private settings: () => MinimalismUISettings,
	) {}

	apply() {
		this.remove();
		const name = this.settings().theme;
		if (!name) return;

		activeDocument.body.classList.add(`${THEME_CLASS_PREFIX}${name}`);
	}

	remove() {
		// 清除 body 上任何主题作用域钩子（切换主题时一并移除上一个）
		const cls = activeDocument.body.classList;
		Array.from(cls)
			.filter(c => c.startsWith(THEME_CLASS_PREFIX))
			.forEach(c => cls.remove(c));
	}

	/** 列出所有可选主题名。 */
	listThemes(): string[] {
		return THEME_NAMES;
	}
}
