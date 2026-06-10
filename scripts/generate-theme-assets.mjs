// 构建前置步骤：把 theme/ 下各主题的 CSS 与字体内嵌为 TS 模块（src/generated/theme-assets.ts）。
//
// 为什么内嵌：Obsidian 社区市场 / BRAT 安装插件时只下载 main.js、manifest.json、styles.css
// 三个 release asset，不会下载 zip，theme/ 文件夹永远到不了用户的 vault。把主题资源打进
// main.js 是唯一能让市场安装用户拿到完整主题的分发方式。
//
// 生成规则：
//  · theme/<name>/<name>.css → THEME_CSS[name]（文本）；无 CSS 的主题文件夹也登记（值为空串），
//    保持"主题可被选中但暂无样式"的旧语义。
//  · theme/*/fonts/* → FONTS[文件名]（base64）。字体按文件名跨主题去重（多个主题共用
//    JetBrains Mono），同名但内容不同视为错误，直接失败。
//  · 主题的 .md 说明文件不内嵌（运行时不读）。
//
// 注意：dev watch 模式不会监听 theme/ 的变动，改主题文件后需重跑 pnpm dev / pnpm build。
import { createHash } from "crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const themeDir = path.join(root, "theme");
const outFile = path.join(root, "src", "generated", "theme-assets.ts");

const themeNames = readdirSync(themeDir, { withFileTypes: true })
	.filter(e => e.isDirectory())
	.map(e => e.name)
	.sort();

const themeCss = {};
const fonts = {};
const fontHashes = {};

for (const name of themeNames) {
	const dir = path.join(themeDir, name);

	let css = "";
	try {
		css = readFileSync(path.join(dir, `${name}.css`), "utf8");
	} catch {
		// 暂无 CSS 的主题（如 stub）：登记空串，仍出现在主题列表里
	}
	themeCss[name] = css;

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
	"/** 主题名 → 主题 CSS 全文。key 集合即全部可选主题。 */",
	`export const THEME_CSS: Record<string, string> = ${JSON.stringify(themeCss)};`,
	"",
	"/** 字体文件名 → base64 内容（跨主题按文件名去重）。 */",
	`export const FONTS: Record<string, string> = ${JSON.stringify(fonts)};`,
	"",
];

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, lines.join("\n"));

const totalKb = Math.round(Object.values(fonts).reduce((n, s) => n + s.length, 0) / 1024);
console.log(`theme assets: ${themeNames.length} themes, ${Object.keys(fonts).length} fonts (~${totalKb} KB base64) → src/generated/theme-assets.ts`);
