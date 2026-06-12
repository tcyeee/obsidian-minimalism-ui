import { App } from 'obsidian';

// Obsidian「唯一笔记创建器」(zk-prefixer) 内部插件形态——未文档化，本地 cast 取用。
type ZkPrefixerPlugin = {
	enabled: boolean;
	instance?: { options?: { format?: string } };
};
type InternalPluginsApp = App & {
	internalPlugins?: { getPluginById(id: string): ZkPrefixerPlugin | null };
};

export class LeafNameUtils {
	static stripPrefix(name: string, prefixLength: number): string {
		if (prefixLength <= 0) return name;
		// 仅在去掉前缀后仍有剩余字符时才切；name.length === prefixLength 时返回原名而非空串
		if (name.length <= prefixLength) return name;
		// 仅当开头确实是"时间戳前缀"形态(前 prefixLength 个字符全是数字、末位可为分隔符,
		// 形如 202604111230-)时才剥离;无前缀的笔记原样返回,避免把真实标题开头切掉。
		if (!/^\d+[-_ ]?$/.test(name.slice(0, prefixLength))) return name;
		return name.slice(prefixLength);
	}

	// 读取「唯一笔记创建器」配置的时间戳格式,渲染一个样本算出其真实位数。
	// 不手动解析格式 token——直接 moment().format(format).length,对任何格式都稳。
	// 插件未启用 / 拿不到格式则返回 0(降级为不裁剪)。
	static detectTimestampDigits(app: App): number {
		const plugin = (app as InternalPluginsApp).internalPlugins?.getPluginById('zk-prefixer');
		const format = plugin?.enabled ? plugin.instance?.options?.format : null;
		if (!format) return 0;
		return window.moment().format(format).length;
	}

	// 自动模式:砍掉开头 digits 位数字,再吃掉紧跟的一个 -/_/空格。
	// 仅当开头确实是数字、且剥离后仍有剩余字符时才裁剪,否则原样返回。
	static stripTimestampPrefix(name: string, digits: number): string {
		if (digits <= 0) return name;
		if (!/^\d/.test(name) || name.length <= digits) return name;
		const rest = name.slice(digits).replace(/^[-_ ]/, '');
		return rest.length > 0 ? rest : name;
	}
}
