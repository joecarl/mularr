interface Ed2kLinkData {
	name: string;
	size: number;
	hash: string;
}

export function parseEd2kLink(link: string): Ed2kLinkData | null {
	const ed2kMatch = link.match(/^ed2k:\/\/\|file\|([^|]+)\|(\d+)\|([a-fA-F0-9]{32})\|/);
	if (!ed2kMatch) return null;
	return {
		name: decodeURIComponent(ed2kMatch[1]),
		size: parseInt(ed2kMatch[2], 10),
		hash: ed2kMatch[3].toLowerCase(),
	};
}

export function buildEd2kLink(name: string, size: number, hash: string): string {
	return `ed2k://|file|${encodeURIComponent(name)}|${size}|${hash.toUpperCase()}|/`;
}
