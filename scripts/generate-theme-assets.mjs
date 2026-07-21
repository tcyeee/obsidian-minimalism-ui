// 构建前置步骤：
//  1. 把 theme/ 下各主题的字体内嵌为 TS 模块（src/generated/theme-assets.ts），并登记主题名单。
//  2. 把各主题的 CSS 原文拼接进 styles.css 的生成区间（GENERATED-THEME-CSS 标记之间）。
//
// 为什么主题 CSS 改为拼进 styles.css、不再内嵌进 main.js 运行时注入：Obsidian 插件审核禁止
// 运行时创建/插入 <style> 元素（曾因 ThemeLoader 在 apply() 里 createEl('style', ...) 被判定为
// "严重违规"直接拒绝发布）——styles.css 是 Obsidian 唯一会自动加载的样式表，主题 CSS 必须随它
// 一起静态分发。各主题的规则本就收敛在 body.minimalism-ui-theme-<name> 选择器下，多个主题的
// CSS 同时存在于 styles.css 里不会互相覆盖，运行时只需要切换 body 上的类名即可选中生效的一段。
//
// 字体仍然走内嵌路线：Obsidian 市场安装只下载 main.js、manifest.json、styles.css 三个 release
// asset，theme/ 文件夹到不了用户 vault；字体通过 FontFace API 注册（不是 <style>/<link>
// 元素，不受上述限制），所以继续保留 base64 内嵌到 main.js 这条路径。
//
// 生成规则：
//  · theme/<name>/<name>.css → 原文拼接进 styles.css 的 GENERATED-THEME-CSS 标记区间；
//    无 CSS 的主题文件夹（如 stub）跳过拼接，但仍登记进 THEME_NAMES。
//  · theme 文件夹名单 → THEME_NAMES（string[]，供 ThemeLoader.listThemes() 使用）。
//  · theme/*/fonts/* → FONTS[文件名]（base64）。字体按文件名跨主题去重（多个主题共用
//    JetBrains Mono），同名但内容不同视为错误，直接失败。
//  · 主题的 .md 说明文件不内嵌（运行时不读）。
//
// 注意：dev watch 模式不会监听 theme/ 或 styles.css 的变动，改动后需重跑 pnpm dev / pnpm build。
import { createHash } from "crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const themeDir = path.join(root, "theme");
const outFile = path.join(root, "src", "generated", "theme-assets.ts");
const stylesFile = path.join(root, "styles.css");

const BEGIN_MARKER = "/* GENERATED-THEME-CSS:BEGIN */";
const END_MARKER = "/* GENERATED-THEME-CSS:END */";

const themeNames = readdirSync(themeDir, { withFileTypes: true })
	.filter(e => e.isDirectory())
	.map(e => e.name)
	.sort();

const themeCssBlocks = [];
const fonts = {};
const fontHashes = {};

for (const name of themeNames) {
	const dir = path.join(themeDir, name);

	try {
		const css = readFileSync(path.join(dir, `${name}.css`), "utf8").trim();
		if (css) themeCssBlocks.push(css);
	} catch {
		// 暂无 CSS 的主题（如 stub）：跳过拼接，仍出现在 THEME_NAMES 里
	}

	let fontFiles = [];
	try {
		fontFiles = readdirSync(path.join(dir, "fonts"));
	} catch {
		continue; // 没有 fonts/ 子目录的主题
	}
	for (const file of fontFiles.sort()) {
		const buf = readFileSync(path.join(dir, "fonts", file));
		const hash = createHash("sha256").update(buf).digest("hex");
		if (file in fonts) {
			if (fontHashes[file] !== hash) {
				console.error(`theme assets: 字体文件名冲突但内容不同: ${file}（${name} 与其他主题）`);
				process.exit(1);
			}
			continue; // 跨主题同名同内容，去重
		}
		fonts[file] = buf.toString("base64");
		fontHashes[file] = hash;
	}
}

const lines = [
	"// 此文件由 scripts/generate-theme-assets.mjs 自动生成，勿手动编辑（已 gitignore）。",
	"",
	"/** 全部可选主题名（对应 theme/ 下的文件夹）。 */",
	`export const THEME_NAMES: string[] = ${JSON.stringify(themeNames)};`,
	"",
	"/** 字体文件名 → base64 内容（跨主题按文件名去重）。 */",
	`export const FONTS: Record<string, string> = ${JSON.stringify(fonts)};`,
	"",
];

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, lines.join("\n"));

// styles.css 里用两行标记注释框住生成区间，每次运行整段替换，保持幂等。
const stylesSrc = readFileSync(stylesFile, "utf8");
const beginIdx = stylesSrc.indexOf(BEGIN_MARKER);
const endIdx = stylesSrc.indexOf(END_MARKER);
if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
	console.error(`theme assets: styles.css 里找不到 ${BEGIN_MARKER} / ${END_MARKER} 标记，无法拼接主题 CSS`);
	process.exit(1);
}
const generatedBlock = themeCssBlocks.length
	? "\n\n" + themeCssBlocks.join("\n\n") + "\n\n"
	: "\n";
const newStylesSrc =
	stylesSrc.slice(0, beginIdx + BEGIN_MARKER.length) +
	generatedBlock +
	stylesSrc.slice(endIdx);
if (newStylesSrc !== stylesSrc) writeFileSync(stylesFile, newStylesSrc);

const totalKb = Math.round(Object.values(fonts).reduce((n, s) => n + s.length, 0) / 1024);
console.log(`theme assets: ${themeNames.length} themes, ${Object.keys(fonts).length} fonts (~${totalKb} KB base64) → src/generated/theme-assets.ts; theme CSS synced into styles.css`);
