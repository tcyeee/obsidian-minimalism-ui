import { App } from 'obsidian';

/**
 * SkillFlowIntegration —— 对 obsidian-skillflow 插件的可选吸收。
 *
 * skillflow 会在状态栏常驻一个图标，点击弹出它自己的技能菜单（内置技能 / 用户 Skills /
 * 新建与管理入口）。为避免状态栏同时出现两个长相接近的"更多操作"图标，本插件把它的菜单项
 * 原样接入 StatusBarMenuManager 的面板（见该文件 renderContent() 末尾），并隐藏它自己的图标。
 *
 * 隐藏图标这一步特意不走"调一次 JS 方法"的命令式路径：skillflow 的状态栏图标会在它自己
 * 每次 onload()（插件被手动开关、或被 Hot Reload 卸载重装）时整个重新创建成一个新 DOM
 * 节点，一次性的隐藏调用只对调用那一刻已存在的旧节点生效，新节点刷出来就不再隐藏——
 * 两边谁先谁后加载也会踩中同样的问题。改用 CSS 规则（styles.css 里的
 * `.skillflow-status-bar-icon`）则是声明式的：只要本插件启用，这条规则就存在，不管
 * skillflow 的图标节点什么时候被重建都会命中；本插件被禁用时，Obsidian 卸载本插件注入的
 * `<style>` 一并带走这条规则，图标自动恢复可见，也不需要显式调用"还原"。
 *
 * getStatusBarMenuGroups() 拿的是实际菜单数据，没有这个一次性时机问题——只是单次读取。
 * 两边都没有正式的跨插件协议，纯靠方法名 + 返回形状的约定（对齐 skillflow 自身
 * src/components/common/StatusBarMenu.ts 的 StatusBarMenuRow），没装 skillflow 或装的是
 * 不提供该方法的旧版本时直接退化成空操作，StatusBarMenuManager 的原有面板行为不受影响。
 */

export type SkillFlowMenuRow = { label: string; icon: string; onClick: () => void };

type SkillFlowPluginApi = {
	getStatusBarMenuGroups?: () => Promise<SkillFlowMenuRow[][]>;
};

const SKILLFLOW_PLUGIN_ID = 'skillflow';

export class SkillFlowIntegration {
	constructor(private app: App) {}

	private getPlugin(): SkillFlowPluginApi | null {
		const plugins = (this.app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins;
		return (plugins?.[SKILLFLOW_PLUGIN_ID] as SkillFlowPluginApi | undefined) ?? null;
	}

	// 取不到（未装/旧版本/运行时报错）统一返回空数组，调用方据此判断是否渲染这一段。
	async getRows(): Promise<SkillFlowMenuRow[][]> {
		const plugin = this.getPlugin();
		if (!plugin?.getStatusBarMenuGroups) return [];
		try {
			return await plugin.getStatusBarMenuGroups();
		} catch (err) {
			console.error('[minimalism-ui] failed to read skillflow status bar menu groups', err);
			return [];
		}
	}
}
