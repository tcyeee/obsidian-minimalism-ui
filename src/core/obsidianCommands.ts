import { App } from 'obsidian';

// Obsidian 内部命令对象与执行口，均未出现在官方类型声明中（app.commands 本身也未公开）。
// 集中在这一处声明/取用，任何依赖 app.commands 内部形状的功能都从这里导入，避免同一份
// 未文档化 API 在多个文件里各自声明出形状不完全一致的局部类型（曾发生：OnboardingManager
// 与 RightSidebarButtonManager 各自声明了一份几乎相同的 CommandApi）。
type Command = { id: string };
type CommandApi = {
	executeCommand: (command: Command, ...args: unknown[]) => boolean;
	executeCommandById: (id: string) => boolean;
};

/**
 * 可逆地包裹 app.commands.executeCommand，命令执行成功后调用 onExecuted(id)。
 * 热键 / 命令面板 / 程序触发最终都汇聚于这一处，比「匹配配置热键」更可靠——后者对默认键为空
 * / 绑定鼠标的命令永远匹配不上，也不必重新读取用户配置。注意：必须包裹 executeCommand 而非
 * executeCommandById——后者只是命令面板/程序入口，热键派发（HotkeyManager.onTrigger →
 * findCommand → executeCommand）根本不经过它（已对照 Obsidian 运行时确认）；包裹底层的
 * executeCommand 才能同时覆盖热键、命令面板、程序调用三种触发方式。
 *
 * 支持多个调用方各自独立包裹、形成链式包裹（如本插件里 OnboardingManager 与
 * RightSidebarButtonManager 各自监听不同命令）：返回的 unpatch() 只在自己仍处于链顶端
 * （即 app.commands.executeCommand 当前仍等于自己安装的那个包裹函数）时才还原为自己捕获
 * 的 original。若省略这层判断：假设 A 先包裹、B 后包裹（B 包着 A 包着原生函数），卸载顺序
 * 是 A 先 remove()——A 直接把 app.commands.executeCommand 覆盖回原生，B 的包裹整个丢失；
 * 之后 B 才 remove()，它又把 app.commands.executeCommand 覆盖成自己捕获的 original（也就是
 * A 的包裹函数本体，此时这个闭包仍然存在），结果是原生函数被永久替换成一个引用着已卸载 A
 * 实例的孤儿包裹——曾是这个插件里真实出现过的 bug。这里的等值判断从根上避免了这种「谁的
 * unpatch 先执行、谁就把后来者的包裹连带原生函数一起冲掉」的顺序依赖。
 */
export function patchExecuteCommand(app: App, onExecuted: (commandId: string) => void): () => void {
	const commands = (app as unknown as { commands?: Partial<CommandApi> }).commands;
	if (!commands || typeof commands.executeCommand !== 'function') return () => {};

	const original = commands.executeCommand;
	const wrapped = (command: Command, ...rest: unknown[]) => {
		const result = original.call(commands, command, ...rest);
		if (result && command) onExecuted(command.id);
		return result;
	};
	commands.executeCommand = wrapped;

	return () => {
		if (commands.executeCommand === wrapped) commands.executeCommand = original;
	};
}

// 直接触发一个已注册命令（命令面板/程序入口的执行口，非热键派发），返回是否命中并执行成功。
export function executeCommandById(app: App, id: string): boolean {
	const commands = (app as unknown as { commands?: Partial<CommandApi> }).commands;
	return commands?.executeCommandById?.(id) ?? false;
}

// Obsidian 内部设置面板形状：打开设置并切到指定插件页签。未出现在官方类型声明中。
type SettingApi = { open: () => void; openTabById: (id: string) => void };

// 本插件 id（与 manifest.json 一致），用于打开本插件的设置页签。
const PLUGIN_ID = 'minimalism-ui';

// 打开本插件的设置页。
export function openPluginSettings(app: App): void {
	const setting = (app as unknown as { setting?: SettingApi }).setting;
	setting?.open();
	setting?.openTabById(PLUGIN_ID);
}
