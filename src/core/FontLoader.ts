import { App } from 'obsidian';
import { Feature } from './Feature';
import { MinimalismUISettings } from './settings';

interface MutableFontFaceSet {
	add(font: FontFace): void;
	delete(font: FontFace): void;
}

/**
 * FontLoader — 加载当前主题专属的字体（theme/<当前主题>/fonts/）。
 *
 * 字体随主题分发：每个主题文件夹自带 fonts/ 子目录。apply() 读取当前 settings.theme，
 * 从对应主题文件夹加载全字重字族 + 一个仅覆盖数字 unicode 范围的 "Digits" 字族（用于正文数字混排）。
 * 切换主题时需重新 apply()，故 apply() 先 remove() 旧字体，保证幂等。
 * remove() 从 document.fonts 注销所有已加载的 FontFace。字体文件缺失时静默跳过（如暂无字体的主题）。
 */
export class FontLoader implements Feature {
	private loadedFonts: FontFace[] = [];

	constructor(
		private app: App,
		private manifestDir: string,
		private settings: () => MinimalismUISettings,
	) {}

	async apply() {
		// 切换主题时先卸载上一主题的字体，保证幂等
		this.remove();
		// 字体随主题分发：每个主题加载各自的字族。newspaper 用阿里巴巴普惠体作正文，
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

	private vaultPath(filename: string): string {
		return `${this.manifestDir}/theme/${this.settings().theme}/fonts/${filename}`;
	}

	private async loadFontFace(family: string, descriptors: FontFaceDescriptors & { file: string }) {
		const { file, ...desc } = descriptors;
		const adapter = this.app.vault.adapter as {
			getResourcePath: (path: string) => string;
			exists: (path: string) => Promise<boolean>;
		};
		const vaultPath = this.vaultPath(file);
		// 先查文件是否存在再 fetch：缺字体的主题（如 newspaper 用系统衬线栈）直接跳过，
		// 否则 FontFace.load() 的 404 虽被 catch 吞掉，Chromium 仍会往控制台打 ERR_FILE_NOT_FOUND
		if (!(await adapter.exists(vaultPath))) return;
		const face = new FontFace(family, `url('${adapter.getResourcePath(vaultPath)}')`, desc);
		try {
			await face.load();
			(activeDocument.fonts as unknown as MutableFontFaceSet).add(face);
			this.loadedFonts.push(face);
		} catch {
			// 字体文件存在但解析失败时静默跳过
		}
	}
}
