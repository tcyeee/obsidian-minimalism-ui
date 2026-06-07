/**
 * Feature — 插件功能单元的统一生命周期契约。
 *
 * 每个功能模块实现 apply()（按当前设置启用/重新配置，必须幂等）与 remove()（完整还原副作用）。
 * 主插件以 Feature[] 统一编排卸载，避免逐个手写 remove() 时遗漏。
 */
export interface Feature {
	apply(): void | Promise<void>;
	remove(): void;
}
