export function formatSpeed(bytes: number) {
	const k = 1024;
	const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
	if (bytes == null || bytes === 0) return { text: '0', unit: sizes[0] };
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	const num = parseFloat((bytes / Math.pow(k, i)).toFixed(1));
	return { text: String(num), unit: sizes[i] };
}

export function formatBytes(bytes: number) {
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
	if (bytes == null || bytes === 0) return { text: '0', unit: sizes[0] };
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	const num = parseFloat((bytes / Math.pow(k, i)).toFixed(1));
	return { text: String(num), unit: sizes[i] };
}

export function fbytes(bytes?: number) {
	const b = formatBytes(bytes || 0);
	return `${b.text} ${b.unit}`;
}

export function formatAmount(val: number) {
	if (val == null) return { text: '0', unit: '' };
	if (val >= 1_000_000_000) {
		return { text: (val / 1_000_000_000).toFixed(1), unit: 'B' };
	} else if (val >= 1_000_000) {
		return { text: (val / 1_000_000).toFixed(1), unit: 'M' };
	} else if (val >= 1_000) {
		return { text: (val / 1_000).toFixed(1), unit: 'K' };
	} else {
		return { text: String(val), unit: '' };
	}
}

export function formatPercent(p: number) {
	if (p == null) return { text: '0', unit: '%' };
	return { text: Number(p).toFixed(1), unit: '%' };
}
