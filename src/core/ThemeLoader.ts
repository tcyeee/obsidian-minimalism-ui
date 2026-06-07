import { App, normalizePath } from 'obsidian';
import { Feature } from './Feature';
import { MinimalismUISettings } from './settings';

const STYLE_ATTR = 'data-minimalism-theme';

/**
 * ThemeLoader — 加载随插件分发的笔记主题 CSS（theme/<name>.css）。
 *
 * apply() 读取当前 settings.theme 对应的主题文件，注入一个带 data-minimalism-theme 标记的
 * <style> 元素（重复调用先清旧再注入，保证幂等与切换生效）；remove() 移除该元素。
 * 主题文件缺失时静默跳过（与 FontLoader 一致）。
 *
 * 主题样式统一挂在 body.minimalism-ui-note-style 下（该 class 现已全程默认开启）；
 * 本加载器只负责"提供哪一套规则"。
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

		const path = normalizePath(`${this.manifestDir}/theme/${name}.css`);
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
	}

	/** 列出 theme/ 目录下所有可选主题名（去掉 .css 后缀）。 */
	async listThemes(): Promise<string[]> {
		const dir = normalizePath(`${this.manifestDir}/theme`);
		try {
			const listing = await this.app.vault.adapter.list(dir);
			return listing.files
				.map(p => p.split('/').pop() ?? '')
				.filter(f => f.endsWith('.css'))
				.map(f => f.slice(0, -'.css'.length))
				.sort();
		} catch {
			return [];
		}
	}
}
