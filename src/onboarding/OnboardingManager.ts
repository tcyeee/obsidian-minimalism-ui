import { App, Hotkey, Modifier, Platform, TFile, normalizePath } from 'obsidian';
import { MinimalismUISettings } from '../core/settings';
import { Feature } from '../core/Feature';
import { t } from '../core/i18n';

const PANEL_CLASS = 'minimalism-ui-onboarding';
// 全部完成后停留展示全勾选的时长（毫秒），之后淡出并永久关闭引导。
const ALL_DONE_HIDE_DELAY = 2500;
// 退场动画时长（毫秒），需与 styles.css 中 .is-hiding 的 animation 时长一致。
const EXIT_DURATION = 320;

// 任务三态：已完成 / 进行中 / 未开始。
type TaskStatus = 'done' | 'doing' | 'todo';

// 本插件 id（与 manifest.json 一致），用于打开本插件的设置页签。
const PLUGIN_ID = 'minimalism-ui';

// 单条新手任务。两类完成方式：
//   - 状态型：提供 isSatisfied 谓词，在 refresh() 中被动判定（如「设置主页」）。
//   - 热键型：提供 commandId，激活状态下按下其配置热键即完成。
// label 同时作为持久化（settings.onboardingDone）的稳定唯一键。
// openSettings：渲染一个「去设置」按钮，点击打开本插件设置页（仅进行中可见，见 styles.css）。
type TaskDef = {
	label: Parameters<typeof t>[0];
	commandId?: string;
	isSatisfied?: (app: App, settings: MinimalismUISettings) => boolean;
	openSettings?: boolean;
};

// 库内是否存在名为 Index 的笔记（宽松匹配：去空格、不区分大小写）。
function hasIndexNote(app: App): boolean {
	return app.vault.getMarkdownFiles().some((f) => f.basename.trim().toLowerCase() === 'index');
}

// 首页笔记是否已含一条「能解析到真实笔记」的链接（即用 [[ ]] 新建/关联了一篇笔记）。
// 用 metadataCache.resolvedLinks 判定——只算指向真实存在文件的链接，留个死链不算。
function homeNoteHasLink(app: App, settings: MinimalismUISettings): boolean {
	const path = settings.homePage.trim();
	if (!path) return false;
	const file = app.vault.getAbstractFileByPath(normalizePath(path));
	if (!(file instanceof TFile)) return false;
	const links = app.metadataCache.resolvedLinks[file.path];
	return links != null && Object.keys(links).length > 0;
}

// 新手任务清单（顺序即推进顺序）。
// 第一条同时带 commandId（仅用于展示快捷键键帽）与 isSatisfied（真正的完成判据）：
// 按快捷键本身不算完成，必须库内真出现名为 Index 的笔记才推进。
const TASKS: TaskDef[] = [
	{ label: 'onboardingCreateNote', commandId: 'file-explorer:new-file', isSatisfied: (app) => hasIndexNote(app) },
	{ label: 'onboardingSetHome', isSatisfied: (_app, s) => s.homePage.trim() !== '', openSettings: true },
	{ label: 'onboardingLinkNote', isSatisfied: (app, s) => homeNoteHasLink(app, s) },
	{ label: 'onboardingGoBack', commandId: 'app:go-back' },
	{ label: 'onboardingGoForward', commandId: 'app:go-forward' },
];

// Obsidian 内部设置面板形状：打开设置并切到指定插件页签；close 用于可逆拦截（见 apply()）。
type SettingApi = { open: () => void; openTabById: (id: string) => void; close: () => void };

// Obsidian 内部命令对象（仅取完成判定需要的 id）。
type Command = { id: string };
// Obsidian 内部命令执行口。热键 / 命令面板 / 程序触发最终都经 executeCommand(cmd) 这一处，
// 是比「匹配配置热键」可靠的完成信号。注意：必须是 executeCommand 而非 executeCommandById——
// 后者只是命令面板/程序入口，热键派发（HotkeyManager.onTrigger → findCommand → executeCommand）
// 根本不经过它（已对照 Obsidian 运行时确认）。包裹底层的 executeCommand 才能同时覆盖三种触发。
type CommandApi = { executeCommand: (command: Command, ...args: unknown[]) => boolean };

// 打开本插件的设置页（设置 Index 为主页处）。
function openPluginSettings(app: App) {
	const setting = (app as unknown as { setting?: SettingApi }).setting;
	setting?.open();
	setting?.openTabById(PLUGIN_ID);
}

// Obsidian 内部热键管理器形状（自定义优先，否则取默认）。
type HotkeyManager = {
	getHotkeys?: (id: string) => Hotkey[] | undefined;
	getDefaultHotkeys?: (id: string) => Hotkey[] | undefined;
};

// 修饰键 → 符号。Mod 在 mac 为 ⌘、其它平台为 Ctrl；按 mac 习惯排序 ⌃⌥⇧⌘。
const MOD_SYMBOLS: Record<Modifier, string> = Platform.isMacOS
	? { Mod: '⌘', Ctrl: '⌃', Meta: '⌘', Alt: '⌥', Shift: '⇧' }
	: { Mod: 'Ctrl', Ctrl: 'Ctrl', Meta: 'Win', Alt: 'Alt', Shift: 'Shift' };
const MOD_ORDER: Modifier[] = ['Ctrl', 'Alt', 'Shift', 'Meta', 'Mod'];

// 特殊键名 → 显示符号（mac 下方向键用箭头）。
const KEY_LABELS: Record<string, string> = {
	ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
	' ': 'Space', Enter: '↵', Backspace: '⌫', Delete: '⌦', Escape: 'Esc',
};

// 读取命令当前生效的第一个热键；无则 null。
function readHotkey(app: App, commandId: string): Hotkey | null {
	const hm = (app as unknown as { hotkeyManager?: HotkeyManager }).hotkeyManager;
	if (!hm) return null;
	const custom = hm.getHotkeys?.(commandId);
	// custom 为 undefined 表示未自定义，回退默认；为空数组表示用户主动清空热键。
	const list = custom !== undefined ? custom : hm.getDefaultHotkeys?.(commandId);
	return list?.[0] ?? null;
}

// 主键归一化为可读符号（方向键→箭头，单字符→大写）。
function keyLabel(key: string): string {
	return KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

// 把热键拆为逐键 token，如 ['⌘','W'] / ['Ctrl','Shift','N']；无热键则 null。
function readHotkeyTokens(app: App, commandId: string): string[] | null {
	const hk = readHotkey(app, commandId);
	if (!hk) return null;
	const mods = (hk.modifiers ?? [])
		.slice()
		.sort((a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b))
		.map((m) => MOD_SYMBOLS[m] ?? m);
	return [...mods, keyLabel(hk.key)];
}

/**
 * OnboardingManager — 页面右上角常驻的新手引导悬浮框。
 *
 * 开启「新手引导」设置后注入一个固定定位的卡片，内含新手任务清单。任务状态从持久化
 * 的已完成集合（settings.onboardingDone）派生：已完成→done，第一个未完成→doing（唯一
 * 激活），其后→todo。仅激活任务可被完成（顺序门控）。
 *
 * 完成检测：热键型任务可逆包裹 app.commands.executeCommandById（observe-only，原样转调
 * 后再判定），命中激活任务的 commandId 且命令执行成功即完成——比匹配配置热键可靠；状态
 * 型任务在 refresh() 中按谓词判定，已满足则级联推进。完成即把 label 写入 onboardingDone
 * 并持久化，refresh() 只切换 class、不重建 DOM。全部完成后弹出庆祝反馈并停留，再播放退场
 * 动画，关闭 onboarding 设置并落盘，之后不再出现。
 *
 * 注入幂等：apply() 先 remove() 再重建。remove() 完整回滚：移除节点、解绑 workspace /
 * vault / metadataCache 监听、还原命令与设置面板拦截、清除计时器。
 */
export class OnboardingManager implements Feature {
	private panel: HTMLElement | null = null;
	private items: { def: TaskDef; el: HTMLElement }[] = [];
	private refreshHandler: (() => void) | null = null;
	private hideScheduled = false;
	private timers: number[] = [];
	// 被拦截的设置面板及其原始 close（用于 remove() 还原，避免 monkey-patch 泄漏）。
	private patchedSetting: SettingApi | null = null;
	private originalSettingClose: (() => void) | null = null;
	// 被拦截的命令执行口及其原始 executeCommand（用于 remove() 还原）。
	private patchedCommands: CommandApi | null = null;
	private originalExecuteCommand: CommandApi['executeCommand'] | null = null;

	constructor(
		private app: App,
		private getSettings: () => MinimalismUISettings,
		private persist: () => Promise<void>,
	) {}

	apply() {
		this.remove();
		if (!this.getSettings().onboarding) return;

		const panel = activeDocument.body.createDiv({ cls: PANEL_CLASS });
		panel.createDiv({ cls: `${PANEL_CLASS}-header`, text: t('onboardingTitle') });

		const list = panel.createDiv({ cls: `${PANEL_CLASS}-tasks` });
		for (const def of TASKS) {
			const item = list.createDiv({ cls: `${PANEL_CLASS}-task` });
			item.createSpan({ cls: `${PANEL_CLASS}-task-check` });
			item.createSpan({ cls: `${PANEL_CLASS}-task-label`, text: t(def.label) });
			if (def.openSettings) {
				const btn = item.createEl('button', {
					cls: `${PANEL_CLASS}-task-action`,
					text: t('onboardingOpenSettings'),
				});
				btn.addEventListener('click', () => openPluginSettings(this.app));
			}
			this.renderHotkey(item, def);
			this.items.push({ def, el: item });
		}

		this.panel = panel;

		// 状态型任务依赖工作区/设置/库文件状态，变更后重新判定。
		// 新建 / 重命名 / 删除会改变「是否存在 Index 笔记」，故也监听 vault 文件事件。
		this.refreshHandler = () => this.refresh();
		this.app.workspace.on('layout-change', this.refreshHandler);
		this.app.workspace.on('active-leaf-change', this.refreshHandler);
		this.app.vault.on('create', this.refreshHandler);
		this.app.vault.on('rename', this.refreshHandler);
		this.app.vault.on('delete', this.refreshHandler);
		// 首页含链接的判定依赖链接解析结果，故监听 metadataCache 的解析事件。
		this.app.metadataCache.on('changed', this.refreshHandler);
		this.app.metadataCache.on('resolved', this.refreshHandler);

		// 热键型任务完成检测：可逆地包裹 app.commands.executeCommand（observe-only，
		// 原样转调后再判定）。热键 / 命令面板 / 程序触发最终都汇聚到 executeCommand，且不依赖
		// 「重新读取配置热键并精确匹配 keydown」——后者对默认键为空 / 绑定鼠标的命令（如
		// app:go-back）永远匹配不上。注意不能包裹 executeCommandById：热键派发不经过它。
		const commands = (this.app as unknown as { commands?: Partial<CommandApi> }).commands;
		if (commands && typeof commands.executeCommand === 'function') {
			this.patchedCommands = commands as CommandApi;
			const original = commands.executeCommand;
			this.originalExecuteCommand = original;
			commands.executeCommand = (command: Command, ...rest: unknown[]) => {
				const result = original.call(commands, command, ...rest);
				// 仅命令真正执行成功才算完成。
				if (result && command) this.onCommand(command.id);
				return result;
			};
		}

		// Obsidian 无公开的热键变更事件；改键只发生在设置弹窗内，故可逆地拦截设置面板的
		// close()，在原逻辑后刷新一次——使引导框键帽同步到用户刚改好的快捷键。
		const setting = (this.app as unknown as { setting?: SettingApi }).setting;
		if (setting && typeof setting.close === 'function') {
			this.patchedSetting = setting;
			this.originalSettingClose = setting.close;
			const original = setting.close;
			setting.close = (...args: unknown[]) => {
				(original as (...a: unknown[]) => void).apply(setting, args);
				this.refresh();
			};
		}

		this.refresh();
	}

	// 当前激活任务 = 第一个未完成的任务；全部完成则 null。
	private activeTask(): TaskDef | null {
		const done = new Set(this.getSettings().onboardingDone);
		return TASKS.find((task) => !done.has(task.label)) ?? null;
	}

	// 标记某任务完成并持久化（去重）；随后刷新派生状态。
	private async complete(label: string) {
		const done = this.getSettings().onboardingDone;
		if (done.includes(label)) return;
		done.push(label);
		await this.persist();
		this.refresh();
	}

	// 某命令成功执行：仅命中当前激活的纯热键型任务（无 isSatisfied）才完成。
	// 带 isSatisfied 的任务（即便也有 commandId 用于展示键帽）只凭谓词判定，命令不完成。
	private onCommand(id: string) {
		const active = this.activeTask();
		if (!active || !active.commandId || active.isSatisfied) return;
		if (active.commandId === id) void this.complete(active.label);
	}

	// 渲染/更新某任务的快捷键键帽：重读当前生效热键，与已显示的键帽逐 token diff，
	// 一致则不动 DOM（保持「只改必要 DOM」的约定），不同才重建该任务的键帽节点。
	// 无 commandId 直接跳过；热键被清空则移除残留键帽。
	private renderHotkey(item: HTMLElement, def: TaskDef) {
		if (!def.commandId) return;
		const next = readHotkeyTokens(this.app, def.commandId);
		let keys = item.querySelector<HTMLElement>(`.${PANEL_CLASS}-task-hotkey`);
		const current = keys
			? Array.from(keys.querySelectorAll(`.${PANEL_CLASS}-task-key`)).map((s) => s.textContent ?? '')
			: null;
		if (JSON.stringify(current) === JSON.stringify(next)) return;
		if (keys) keys.remove();
		if (next) {
			keys = item.createDiv({ cls: `${PANEL_CLASS}-task-hotkey` });
			for (const tk of next) keys.createSpan({ cls: `${PANEL_CLASS}-task-key`, text: tk });
		}
	}

	// 重新派生每条任务三态并切换样式（只改 class，不重建 DOM）。
	// 顺带级联判定激活的状态型任务：谓词已满足则完成并继续看下一条。
	private refresh() {
		const settings = this.getSettings();

		let active = this.activeTask();
		while (active && active.isSatisfied && active.isSatisfied(this.app, settings)) {
			if (!settings.onboardingDone.includes(active.label)) {
				settings.onboardingDone.push(active.label);
				void this.persist();
			}
			active = this.activeTask();
		}

		const done = new Set(settings.onboardingDone);
		const activeLabel = active?.label ?? null;
		for (const { def, el } of this.items) {
			const status: TaskStatus = done.has(def.label)
				? 'done'
				: def.label === activeLabel
					? 'doing'
					: 'todo';
			el.toggleClass('is-done', status === 'done');
			el.toggleClass('is-doing', status === 'doing');
			el.toggleClass('is-todo', status === 'todo');
			this.renderHotkey(el, def);
		}

		if (done.size === TASKS.length) this.scheduleHide();
	}

	// 全部完成：弹出庆祝反馈 → 停留展示 → 退场动画 → 移除节点、关闭 onboarding 设置并落盘。
	private scheduleHide() {
		if (this.hideScheduled) return;
		this.hideScheduled = true;
		this.showAllDoneFeedback();
		this.timers.push(window.setTimeout(() => {
			if (this.panel) this.panel.addClass('is-hiding');
			this.timers.push(window.setTimeout(() => {
				this.getSettings().onboarding = false;
				void this.persist();
				this.remove();
			}, EXIT_DURATION));
		}, ALL_DONE_HIDE_DELAY));
	}

	// 在任务清单下方弹出一条「全部完成」的庆祝反馈（带 pop 入场动画，见 styles.css）。
	private showAllDoneFeedback() {
		if (!this.panel || this.panel.querySelector(`.${PANEL_CLASS}-feedback`)) return;
		this.panel.addClass('is-celebrate');
		const fb = this.panel.createDiv({ cls: `${PANEL_CLASS}-feedback` });
		fb.createSpan({ cls: `${PANEL_CLASS}-feedback-icon`, text: '🎉' });
		fb.createSpan({ cls: `${PANEL_CLASS}-feedback-text`, text: t('onboardingAllDone') });
	}

	remove() {
		for (const id of this.timers) window.clearTimeout(id);
		this.timers = [];
		this.hideScheduled = false;
		if (this.refreshHandler) {
			this.app.workspace.off('layout-change', this.refreshHandler);
			this.app.workspace.off('active-leaf-change', this.refreshHandler);
			this.app.vault.off('create', this.refreshHandler);
			this.app.vault.off('rename', this.refreshHandler);
			this.app.vault.off('delete', this.refreshHandler);
			this.app.metadataCache.off('changed', this.refreshHandler);
			this.app.metadataCache.off('resolved', this.refreshHandler);
			this.refreshHandler = null;
		}
		// 还原对命令执行口的拦截。
		if (this.patchedCommands && this.originalExecuteCommand) {
			this.patchedCommands.executeCommand = this.originalExecuteCommand;
		}
		this.patchedCommands = null;
		this.originalExecuteCommand = null;
		// 还原对设置面板 close() 的拦截。
		if (this.patchedSetting && this.originalSettingClose) {
			this.patchedSetting.close = this.originalSettingClose;
		}
		this.patchedSetting = null;
		this.originalSettingClose = null;
		this.items = [];
		if (this.panel) {
			this.panel.remove();
			this.panel = null;
		}
		// 兜底：清理可能残留的同类节点（如热重载）
		activeDocument.querySelectorAll(`.${PANEL_CLASS}`).forEach((el) => el.remove());
	}
}
