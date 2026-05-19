export class LeafNameUtils {
	static stripPrefix(name: string, prefixLength: number): string {
		if (prefixLength <= 0) return name;
		if (name.length + 1 > prefixLength) return name.slice(prefixLength);
		return name;
	}
}
