import { component, Link, pathMatches, signal } from 'chispa';
import { services } from '../services/container/ServiceContainer';
import { SystemApiService, type SystemInfo } from '../services/SystemApiService';
import { StatsService } from '../services/StatsService';
import tpl from './Sidebar.html';
import './Sidebar.css';

// NOTE: ¡No crear nodos DOM manualmente en este archivo!
// Usa plantillas con `data-cb` en `Sidebar.html` y constrúyelas desde aquí con `tpl.<dataCbName>(...)`.
// Evita `document.createElement` y la manipulación manual del DOM; revisa `CHISPA_GUIDE.md` y `CHISPA_BEST_PRACTICES.md`.
function formatSpeed(bytes: number) {
	const k = 1024;
	const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
	if (bytes == null || bytes === 0) return { text: '0', unit: sizes[0] };
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	const num = parseFloat((bytes / Math.pow(k, i)).toFixed(1));
	return { text: String(num), unit: sizes[i] };
}

function formatBytes(bytes: number) {
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
	if (bytes == null || bytes === 0) return { text: '0', unit: sizes[0] };
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	const num = parseFloat((bytes / Math.pow(k, i)).toFixed(1));
	return { text: String(num), unit: sizes[i] };
}

function formatAmount(val: number) {
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

function formatPercent(p: number) {
	if (p == null) return { text: '0', unit: '%' };
	return { text: Number(p).toFixed(1), unit: '%' };
}

function renderValue(val: any): string {
	if (typeof val === 'boolean') return val ? 'Yes' : 'No';
	if (typeof val === 'object' && val !== null) {
		return JSON.stringify(val);
	}
	return String(val);
}

export const Sidebar = component(() => {
	const statsService = services.get(StatsService);
	const systemApiService = services.get(SystemApiService);
	const systemInfo = signal<SystemInfo | null>(null);

	const fetchSystemInfo = async () => {
		try {
			const info = await systemApiService.getSystemInfo();
			systemInfo.set(info);
		} catch (e) {
			console.error(e);
		}
	};

	// Initial fetch & loop (every 5 minutes)
	fetchSystemInfo();
	setInterval(fetchSystemInfo, 60000 * 5);

	const linksData = [
		//{ to: '/', inner: [getIcon('layout-dashboard'), ' Dashboard'] },
		{ to: '/servers', inner: ['🔌', ' Servers'] },
		{ to: '/transfers', inner: ['🔽', ' Transfers'] },
		{ to: '/search', inner: ['🔍', ' Search'] },
		{ to: '/categories', inner: ['🏷️', ' Categories'] },
		{ to: '/settings', inner: ['⚙️', ' Settings'] },
	];

	// Como linksData es un array que no va a cambiar, podemos crear una
	// lista de componentes Link sin necesidad de usar componentList,
	const links = linksData.map((link) =>
		Link({
			to: link.to,
			inner: link.inner,
			classes: { 'nav-link': true, 'active-link': pathMatches(link.to) },
		})
	);

	return tpl.fragment({
		navLinks: { inner: links },
		systemContainer: {
			inner: () => {
				const info = systemInfo.get();
				if (!info) return 'Loading...';

				const result: (string | Node)[] = [];

				if (info.publicIp) {
					result.push(
						tpl.statRow({
							nodes: {
								statLabel: { inner: 'Public IP:' },
								statValue: { inner: info.publicIp },
							},
						})
					);
				}

				// Location info (from IP Details or VPN fallback)
				const details = info.ipDetails || info.vpn;
				if (details && (details.city || details.country || details.region)) {
					const loc = [details.city, details.region, details.country].filter(Boolean).join(', ');
					if (loc) {
						result.push(
							tpl.statRow({
								nodes: {
									statLabel: { inner: 'Location:' },
									statValue: { inner: loc },
								},
							})
						);
					}
				}

				// Organization / ISP
				if (info.ipDetails && info.ipDetails.org) {
					result.push(
						tpl.statRow({
							nodes: {
								statLabel: { inner: 'ISP:' },
								statValue: { inner: info.ipDetails.org },
							},
						})
					);
				}

				if (info.vpn && info.vpn.enabled) {
					result.push(
						tpl.statRow({
							nodes: {
								statLabel: { inner: 'VPN:' },
								statValue: { inner: (info.vpn.status || 'Active').toUpperCase() },
								statUnit: { inner: '' },
							},
						})
					);

					if (info.vpn.port) {
						result.push(
							tpl.statRow({
								nodes: {
									statLabel: { inner: 'Forwarded Port:' },
									statValue: { inner: String(info.vpn.port) },
								},
							})
						);
					}
				} else {
					result.push(
						tpl.statRow({
							nodes: {
								statLabel: { inner: 'VPN:' },
								statValue: { inner: 'Disabled' },
							},
						})
					);
				}

				return result;
			},
		},
		statsContainer: {
			inner: () => {
				const s = statsService.stats.get();
				if (!s) return 'Connecting...';

				const result: (string | Node)[] = [];

				// 1. Speeds (Always on top)
				if (typeof s.downloadSpeed === 'number') {
					const ds = formatSpeed(s.downloadSpeed);
					result.push(
						tpl.statRow({
							nodes: {
								statLabel: { inner: `↓` },
								statValue: { inner: ds.text },
								statUnit: { inner: ds.unit },
							},
						})
					);

					const us = formatSpeed(s.uploadSpeed || 0);
					result.push(
						tpl.statRow({
							nodes: {
								statLabel: { inner: `↑` },
								statValue: { inner: us.text },
								statUnit: { inner: us.unit },
							},
						})
					);

					result.push(tpl.statsSep({}));
				}
				// 2. Typed fields — render each stat with an appropriate formatter
				const fields: Array<{ key: string; label: string; render?: (v: any) => any }> = [
					{ key: 'isHighID', label: 'HighID', render: (v: boolean) => (v ? 'Yes' : 'No') },
					{ key: 'id', label: 'ID' },
					{ key: 'ed2kId', label: 'ED2K ID' },
					{ key: 'kadId', label: 'KAD ID' },
					{
						key: 'connectedServer',
						label: 'Connected server',
						render: (v: any) => {
							if (!v) return null;
							if (v.name) return v.name;
							return `${v.ip}:${v.port}`;
						},
					},
					{ key: 'connectionState', label: 'Connection state' },
					{ key: 'uploadOverhead', label: 'Upload overhead', render: (v: number) => (v == null ? null : formatPercent(v)) },
					{ key: 'downloadOverhead', label: 'Download overhead', render: (v: number) => (v == null ? null : formatPercent(v)) },
					{ key: 'bannedCount', label: 'Banned', render: (v: number) => formatAmount(v) },
					{ key: 'loggerMessage', label: 'Log', render: (v: string[]) => (Array.isArray(v) ? v.slice(-3).join('\n') : String(v)) },
					{ key: 'totalSentBytes', label: 'Total sent', render: (v: number) => formatBytes(v) },
					{ key: 'totalReceivedBytes', label: 'Total received', render: (v: number) => formatBytes(v) },
					{ key: 'sharedFileCount', label: 'Shared files', render: (v: number) => formatAmount(v) },
					{ key: 'uploadSpeedLimit', label: 'Upload limit', render: (v: number) => (v === 0 ? { text: 'Unlimited' } : formatSpeed(v)) },
					{
						key: 'downloadSpeedLimit',
						label: 'Download limit',
						render: (v: number) => (v === 0 ? { text: 'Unlimited' } : formatSpeed(v)),
					},
					{ key: 'totalSourceCount', label: 'Sources', render: (v: number) => formatAmount(v) },
					{ key: 'ed2kUsers', label: 'ED2K users', render: (v: number) => formatAmount(v) },
					{ key: 'kadUsers', label: 'KAD users', render: (v: number) => formatAmount(v) },
					{ key: 'ed2kFiles', label: 'ED2K files', render: (v: number) => formatAmount(v) },
					{ key: 'kadFiles', label: 'KAD files', render: (v: number) => formatAmount(v) },
					{ key: 'kadNodes', label: 'KAD nodes', render: (v: number) => formatAmount(v) },
				];

				for (const f of fields) {
					const val = (s as any)[f.key];
					if (val === undefined || val === null || val === '') continue;

					const rendered = f.render ? f.render(val) : renderValue(val);
					if (rendered === null || rendered === undefined || rendered === '') continue;

					let valueText: any;
					let unitText: string | undefined;

					if (typeof rendered === 'object' && rendered !== null && 'text' in rendered) {
						valueText = (rendered as any).text;
						unitText = (rendered as any).unit;
					} else {
						valueText = rendered;
					}

					let valueNode: any = valueText;
					if (typeof valueText === 'string' && valueText.includes('\n')) {
						const lines = valueText.split('\n');
						valueNode = lines.flatMap((line, i) => (i > 0 ? [tpl.statsBr({}), line] : [line]));
					}

					const nodesObj: any = {
						statLabel: { inner: f.label + ':' },
						statValue: { inner: valueNode },
					};
					if (unitText) nodesObj.statUnit = { inner: unitText };

					result.push(
						tpl.statRow({
							nodes: nodesObj,
						})
					);
				}

				// Fallback if empty (preserve previous raw text behavior)
				if (result.length === 0 && s.raw) {
					return s.raw.split('\n').flatMap((line, i) => (i > 0 ? [tpl.statsBr({}), line] : [line]));
				}

				return result;
			},
		},
	});
});
