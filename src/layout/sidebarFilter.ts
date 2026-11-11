import { App, TFile, getAllTags } from 'obsidian';
import { SidebarCondition, SidebarConditionOperator, SidebarRule } from '../core/settings';

type FieldValue = string[];

// folder 的匹配粒度是"落在该文件夹或其任意子文件夹下"，而不是只认直接父文件夹——
// 否则配置"日记文件夹"规则时，日记文件夹下再分子文件夹（按年/月归档）的笔记会匹配不到。
// 返回从最具体到最笼统的祖先路径链，根目录用 ''（与 getDailyNotesFolder 的归一化格式一致）。
function folderAncestors(file: TFile): string[] {
	const parts = file.path.split('/');
	parts.pop(); // 去掉文件名本身
	const ancestors: string[] = [];
	for (let i = parts.length; i >= 0; i--) ancestors.push(parts.slice(0, i).join('/'));
	return ancestors;
}

function fieldValues(app: App, cond: SidebarCondition, file: TFile): FieldValue {
	switch (cond.field) {
		case 'path':
			return [file.path];
		case 'folder':
			return folderAncestors(file);
		case 'tag': {
			const cache = app.metadataCache.getFileCache(file);
			const tags = (cache && getAllTags(cache)) || [];
			// getAllTags 返回带 '#' 前缀的标签；去掉前缀使用户两种写法('project' / '#project')都能命中。
			return tags.map(tag => tag.replace(/^#/, ''));
		}
		case 'property': {
			if (!cond.property) return [];
			const frontmatter: Record<string, unknown> | undefined = app.metadataCache.getFileCache(file)?.frontmatter;
			const value = frontmatter?.[cond.property];
			if (value == null) return [];
			return Array.isArray(value) ? value.map(v => String(v)) : [String(value)];
		}
	}
}

function evaluate(operator: SidebarConditionOperator, values: string[], target: string): boolean {
	switch (operator) {
		case 'is-empty': return values.every(v => v.trim() === '');
		case 'is-not-empty': return values.some(v => v.trim() !== '');
		case 'is': return values.some(v => v === target);
		case 'is-not': return !values.some(v => v === target);
		case 'contains': return values.some(v => v.includes(target));
		case 'not-contains': return !values.some(v => v.includes(target));
		case 'starts-with': return values.some(v => v.startsWith(target));
	}
}

function conditionMatches(app: App, cond: SidebarCondition, file: TFile): boolean {
	const values = fieldValues(app, cond, file);
	const rawTarget = (cond.value ?? '').trim();
	const target = cond.field === 'tag' ? rawTarget.replace(/^#/, '') : rawTarget;
	return evaluate(cond.operator, values, target);
}

/** 规则命中判定：conditions 纯 AND；空列表视为永不命中（避免空规则误吞所有笔记）。 */
export function ruleMatches(app: App, rule: SidebarRule, file: TFile): boolean {
	if (rule.conditions.length === 0) return false;
	return rule.conditions.every(cond => conditionMatches(app, cond, file));
}

/** 按 rules 数组顺序找第一条命中的规则；都不命中（或没有活动文件）返回 null，调用方退回默认配置。 */
export function matchSidebarRule(app: App, rules: SidebarRule[], file: TFile | null): SidebarRule | null {
	if (!file) return null;
	for (const rule of rules) {
		if (ruleMatches(app, rule, file)) return rule;
	}
	return null;
}
