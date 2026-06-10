import { Feature } from './Feature';
import { MinimalismUISettings } from './settings';
import { FONTS } from '../generated/theme-assets';

interface MutableFontFaceSet {
	add(font: FontFace): void;
	delete(font: FontFace): void;
}

/**
 * FontLoader — 加载当前主题专属的字体（内嵌在 main.js 里）。
 *
 * 字体源码随主题存放（theme/<name>/fonts/），但分发时由构建脚本
 * （scripts/generate-theme-assets.mjs）以 base64 内嵌进 main.js 并跨主题按文件名去重：
 * Obsidian 市场安装只下载 main.js / manifest.json / styles.css，字体文件到不了用户 vault，
 * 所以运行时从内嵌的 FONTS 解码出 ArrayBuffer 直接构造 FontFace，不读文件系统
 * （这同时绕开了 Obsidian CSP 禁止 CSS url() 引插件资源的限制，见 styles.css 顶部说明）。
 *
 * apply() 读取当前 settings.theme，加载该主题的字族 + 一个仅覆盖数字 unicode 范围的
 * "Digits" 字族（用于正文数字混排）。切换主题时需重新 apply()，故 apply() 先 remove()
 * 旧字体，保证幂等。remove() 从 document.fonts 注销所有已加载的 FontFace。
 * 字体未内嵌时静默跳过（如暂无字体的主题）。
 */
export class FontLoader implements Feature {
	private loadedFonts: FontFace[] = [];

	constructor(
		private settings: () => MinimalismUISettings,
	) {}

	async apply() {
		// 切换主题时先卸载上一主题的字体，保证幂等
		this.remove();
		// 字体随主题分发：每个主题加载各自的字族。newspaper 用 PT Serif 作正文，
		// 其余主题（forest 等）用 JetBrains Mono。
		if (this.settings().theme === 'newspaper') {
			await this.loadNewspaperFonts();
		} else {
			await this.loadJetBrainsMono();
		}
	}

	// newspaper 字体：
	//  · 正文 = PT Serif（衬线，latin-only；CJK 由 CSS 字体栈回退到宋体 / Noto Serif CJK）。
	//    PT Serif 仅 Regular / Bold 两档，各带 italic，共 4 个文件（正文 / 斜体 / 加粗 / 加粗斜体）。
	//  · 代码块 / 行内代码 = JetBrains Mono，只加载代码会用到的 4 个字重
	//    （Regular / Bold / Italic / BoldItalic，覆盖语法高亮的加粗 / 斜体 token）。
	private async loadNewspaperFonts() {
		const serif = 'PT Serif';
		const mono = 'JetBrains Mono';
		await Promise.all([
			this.loadFontFace(serif, { file: 'pt-serif-v11-latin-regular.woff2',    style: 'normal', weight: '400' }),
			this.loadFontFace(serif, { file: 'pt-serif-v11-latin-italic.woff2',     style: 'italic', weight: '400' }),
			this.loadFontFace(serif, { file: 'pt-serif-v11-latin-700.woff2',        style: 'normal', weight: '700' }),
			this.loadFontFace(serif, { file: 'pt-serif-v11-latin-700italic.woff2',  style: 'italic', weight: '700' }),
			this.loadFontFace(mono, { file: 'JetBrainsMonoNL-Regular.ttf',    style: 'normal', weight: '400' }),
			this.loadFontFace(mono, { file: 'JetBrainsMonoNL-Italic.ttf',     style: 'italic', weight: '400' }),
			this.loadFontFace(mono, { file: 'JetBrainsMonoNL-Bold.ttf',       style: 'normal', weight: '700' }),
			this.loadFontFace(mono, { file: 'JetBrainsMonoNL-BoldItalic.ttf', style: 'italic', weight: '700' }),
		]);
	}

	private async loadJetBrainsMono() {
		// unicodeRange：数字 0-9、小数点、负号，仅用于正文数字字体混排
		const digitsRange = 'U+002D, U+002E, U+0030-0039';
		await Promise.all([
			this.loadFontFace('JetBrains Mono', { file: 'JetBrainsMonoNL-Regular.ttf',          style: 'normal', weight: '400' }),
			this.loadFontFace('JetBrains Mono', { file: 'JetBrainsMonoNL-Italic.ttf',           style: 'italic', weight: '400' }),
			this.loadFontFace('JetBrains Mono', { file: 'JetBrainsMonoNL-Medium.ttf',           style: 'normal', weight: '500' }),
			this.loadFontFace('JetBrains Mono', { file: 'JetBrainsMonoNL-MediumItalic.ttf',     style: 'italic', weight: '500' }),
			this.loadFontFace('JetBrains Mono', { file: 'JetBrainsMonoNL-Bold.ttf',             style: 'normal', weight: '700' }),
			this.loadFontFace('JetBrains Mono', { file: 'JetBrainsMonoNL-BoldItalic.ttf',       style: 'italic', weight: '700' }),
			this.loadFontFace('JetBrains Mono', { file: 'JetBrainsMonoNL-ExtraBold.ttf',        style: 'normal', weight: '900' }),
			this.loadFontFace('JetBrains Mono', { file: 'JetBrainsMonoNL-ExtraBoldItalic.ttf',  style: 'italic', weight: '900' }),
			// 数字专用字族：只覆盖数字 unicode 范围，用于正文混排
			this.loadFontFace('JetBrains Mono Digits', { file: 'JetBrainsMonoNL-Regular.ttf',         style: 'normal', weight: '400', unicodeRange: digitsRange }),
			this.loadFontFace('JetBrains Mono Digits', { file: 'JetBrainsMonoNL-Italic.ttf',          style: 'italic', weight: '400', unicodeRange: digitsRange }),
			this.loadFontFace('JetBrains Mono Digits', { file: 'JetBrainsMonoNL-Medium.ttf',          style: 'normal', weight: '500', unicodeRange: digitsRange }),
			this.loadFontFace('JetBrains Mono Digits', { file: 'JetBrainsMonoNL-MediumItalic.ttf',    style: 'italic', weight: '500', unicodeRange: digitsRange }),
			this.loadFontFace('JetBrains Mono Digits', { file: 'JetBrainsMonoNL-Bold.ttf',            style: 'normal', weight: '700', unicodeRange: digitsRange }),
			this.loadFontFace('JetBrains Mono Digits', { file: 'JetBrainsMonoNL-BoldItalic.ttf',      style: 'italic', weight: '700', unicodeRange: digitsRange }),
			this.loadFontFace('JetBrains Mono Digits', { file: 'JetBrainsMonoNL-ExtraBold.ttf',       style: 'normal', weight: '900', unicodeRange: digitsRange }),
			this.loadFontFace('JetBrains Mono Digits', { file: 'JetBrainsMonoNL-ExtraBoldItalic.ttf', style: 'italic', weight: '900', unicodeRange: digitsRange }),
		]);
	}

	remove() {
		for (const font of this.loadedFonts) (activeDocument.fonts as unknown as MutableFontFaceSet).delete(font);
		this.loadedFonts = [];
	}

	private async loadFontFace(family: string, descriptors: FontFaceDescriptors & { file: string }) {
		const { file, ...desc } = descriptors;
		const base64 = FONTS[file];
		if (!base64) return; // 该字体未内嵌（如暂无字体的主题），静默跳过
		try {
			// 从 ArrayBuffer 构造的 FontFace 同步解析完成，无需再 load()
			const face = new FontFace(family, base64ToArrayBuffer(base64), desc);
			(activeDocument.fonts as unknown as MutableFontFaceSet).add(face);
			this.loadedFonts.push(face);
		} catch {
			// 字体数据解析失败时静默跳过
		}
	}
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}
