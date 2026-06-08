import { App, normalizePath } from 'obsidian';
import { Feature } from './Feature';
import { MinimalismUISettings } from './settings';

const STYLE_ATTR = 'data-minimalism-theme';
// body 上的主题作用域钩子：body.minimalism-ui-theme-<name>。
// 各主题 CSS 收敛在此命名空间下，使"当前是哪个主题"成为可被选择器表达的状态。
const THEME_CLASS_PREFIX = 'minimalism-ui-theme-';

/**
 * ThemeLoader — 加载随插件分发的笔记主题 CSS（theme/<name>/<name>.css）。
 *
 * 每个主题是 theme/ 下的一个独立文件夹（theme/<name>/），内含同名 CSS（<name>.css）
 * 以及该主题专属的字体（theme/<name>/fonts/，由 FontLoader 按主题加载）。
 *
 * apply() 读取当前 settings.theme 对应的主题文件，注入一个带 data-minimalism-theme 标记的
 * <style> 元素，并在 <body> 打上 minimalism-ui-theme-<name> 作用域钩子（各主题 CSS 收敛于此
 * 命名空间下，可表达"主题专属"规则）；重复调用先清旧再注入，保证幂等与切换生效。
 * remove() 移除该 <style> 并清除 body 上的主题钩子。主题文件缺失时静默跳过（与 FontLoader 一致）。
 *
 * 笔记样式分两层：body.minimalism-ui-note-style 是"主题无关基线"（全程默认开启，所有主题之下
 * 通用的笔记排版底座，作为共享扩展点保留）；body.minimalism-ui-theme-<name> 是各主题专属的内容
 * 美学层。本加载器只负责"提供哪一套主题规则"并打上对应作用域钩子。
 */
export class ThemeLoader implements Feature {
	constructor(
		private app: App,
		private manifestDir: string,
		private settings: () => MinimalismUISettings,
	) {}

	async apply() {
		this.remove();
		const name = this.settings().theme;
		if (!name) return;

		// 先打主题作用域钩子（即使该主题暂无 CSS 文件，也标记"当前主题"）
		activeDocument.body.classList.add(`${THEME_CLASS_PREFIX}${name}`);

		const path = normalizePath(`${this.manifestDir}/theme/${name}/${name}.css`);
		const adapter = this.app.vault.adapter;
		let css: string;
		try {
			css = await adapter.read(path);
		} catch {
			// 主题文件不存在时静默跳过
			return;
		}

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

	/** 列出 theme/ 目录下所有可选主题名（每个主题是一个子文件夹）。 */
	async listThemes(): Promise<string[]> {
		const dir = normalizePath(`${this.manifestDir}/theme`);
		try {
			const listing = await this.app.vault.adapter.list(dir);
			return listing.folders
				.map(p => p.split('/').pop() ?? '')
				.filter(f => f.length > 0)
				.sort();
		} catch {
			return [];
		}
	}
}
