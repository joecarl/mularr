import { Transfer } from '../../services/MediaApiService';

function isUnknownSourceName(name?: string): boolean {
	const normalized = (name || '').trim().toLowerCase();
	return normalized === '' || normalized === 'unknown' || normalized === '-';
}

export function formatSourcesSummary(transfer: Transfer): string {
	const total = Math.max(0, Number(transfer.sourceCount || 0));
	const peers = transfer.sources || [];

	let known = 0;
	if ((transfer.sourceNames || []).length > 0) {
		known = (transfer.sourceNames || []).reduce((acc, s) => {
			const count = Number(s.count || 0);
			if (count <= 0 || isUnknownSourceName(s.name)) return acc;
			return acc + count;
		}, 0);
	} else if (peers.length > 0) {
		known = peers.reduce((acc, p) => (isUnknownSourceName(p.clientName) ? acc : acc + 1), 0);
	}

	const downloading = peers.reduce((acc, p) => ((p.downloadSpeed || 0) > 0 ? acc + 1 : acc), 0);
	const knownClamped = total > 0 ? Math.min(known, total) : known;
	const downloadingClamped = total > 0 ? Math.min(downloading, total) : downloading;
	const base = knownClamped === total ? String(total) : `${knownClamped}/${total}`;
	const suffix = downloadingClamped > 0 ? ` (${downloadingClamped})` : '';

	return `${base}${suffix}`;
}
