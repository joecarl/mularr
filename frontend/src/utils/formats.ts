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

export function formatRemaining(remainingBytes?: number, speedBytesPerSec?: number) {
	const sizeText = fbytes(remainingBytes);
	if (!remainingBytes) return `-`;
	if (!speedBytesPerSec) return `? (${sizeText})`;

	const seconds = Math.floor(remainingBytes / speedBytesPerSec);
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;

	let timeStr = '';
	if (days > 0) {
		timeStr = `${days} d ${hours} h`;
	} else if (hours > 0) {
		if (minutes > 0) timeStr = `${hours} h ${minutes} m`;
		else timeStr = `${hours} h`;
	} else {
		// minutes and seconds: show M:SS mins
		const mm = String(minutes);
		const ss = String(secs).padStart(2, '0');
		timeStr = `${mm}:${ss} mins`;
	}

	return `${timeStr} (${sizeText})`;
}

export function toString(val: any): string {
	if (typeof val === 'boolean') return val ? 'Yes' : 'No';
	if (typeof val === 'object' && val !== null) {
		return JSON.stringify(val);
	}
	return String(val);
}
