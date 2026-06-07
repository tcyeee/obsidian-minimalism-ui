export class LeafNameUtils {
	static stripPrefix(name: string, prefixLength: number): string {
		if (prefixLength <= 0) return name;
		// 仅在去掉前缀后仍有剩余字符时才切；name.length === prefixLength 时返回原名而非空串
		if (name.length > prefixLength) return name.slice(prefixLength);
		return name;
	}
}
