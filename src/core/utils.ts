import { App } from 'obsidian';

// Obsidian「唯一笔记创建器」(zk-prefixer) 内部插件形态——未文档化，本地 cast 取用。
type ZkPrefixerPlugin = {
	enabled: boolean;
	instance?: { options?: { format?: string } };
};
type InternalPluginsApp = App & {
	internalPlugins?: { getPluginById(id: string): ZkPrefixerPlugin | null };
};

// 裸 pointerdown→move→up 拖拽的公共骨架：PropertyKeyResizer（1D 列宽）与
// RightSidebarButtonManager（2D 面板尺寸）各自的 resize 拖拽都是这套捕获阶段监听器
// 生命周期，只是计算的值形状不同——具体的 clamp/尺寸计算、持久化仍留给调用方的
// onMove/onEnd 闭包，这里只负责监听器的挂载与摘除。
// 返回 detach()：调用方自己的 onEnd（随自然的 pointerup 触发）内部会再调一次，
// 是幂等的 removeEventListener，无副作用；也供 Feature.remove() 在拖拽进行中
// 被强制卸载时直接摘除监听器而不触发 onEnd（不持久化未完成的拖拽）。
export function trackPointerDrag(handlers: { onMove(e: PointerEvent): void; onEnd(): void }): () => void {
	const onMove = (e: PointerEvent) => handlers.onMove(e);
	const detach = () => {
		activeDocument.removeEventListener('pointermove', onMove, true);
		activeDocument.removeEventListener('pointerup', onUp, true);
	};
	const onUp = () => {
		detach();
		handlers.onEnd();
	};
	activeDocument.addEventListener('pointermove', onMove, true);
	activeDocument.addEventListener('pointerup', onUp, true);
	return detach;
}

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
