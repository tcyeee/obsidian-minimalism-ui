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
}
