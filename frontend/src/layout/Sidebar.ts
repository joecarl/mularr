import { component, computed, Link, pathMatches, signal } from 'chispa';
import { formatAmount, formatBytes, formatPercent, formatSpeed } from '../utils/formats';
import { services } from '../services/container/ServiceContainer';
import { SystemApiService, type SystemInfo } from '../services/SystemApiService';
import { StatsService } from '../services/StatsService';
import tpl from './Sidebar.html';
import './Sidebar.css';

// NOTE: ¡No crear nodos DOM manualmente en este archivo!
// Usa plantillas con `data-cb` en `Sidebar.html` y constrúyelas desde aquí con `tpl.<dataCbName>(...)`.
// Evita `document.createElement` y la manipulación manual del DOM; revisa `CHISPA_GUIDE.md` y `CHISPA_BEST_PRACTICES.md`.

function renderValue(val: any): string {
	if (typeof val === 'boolean') return val ? 'Yes' : 'No';
	if (typeof val === 'object' && val !== null) {
		return JSON.stringify(val);
	}
	return String(val);
}
const formatLimit = (v: number) => (v === 0 ? { text: 'Unlimited' } : formatSpeed(v));

const statsFields: { key: string; label: string; render?: (v: any) => any }[] = [
	{ key: 'downloadOverhead', label: 'Download overhead', render: formatSpeed },
	{ key: 'uploadOverhead', label: 'Upload overhead', render: formatSpeed },
	{ key: 'bannedCount', label: 'Banned', render: formatAmount },
	{ key: 'totalSentBytes', label: 'Total sent', render: formatBytes },
	{ key: 'totalReceivedBytes', label: 'Total received', render: formatBytes },
	{ key: 'sharedFileCount', label: 'Shared files', render: formatAmount },
	{ key: 'uploadSpeedLimit', label: 'Upload limit', render: formatLimit },
	{ key: 'downloadSpeedLimit', label: 'Download limit', render: formatLimit },
	{ key: 'totalSourceCount', label: 'Sources', render: formatAmount },
	{ key: 'ed2kUsers', label: 'ED2K users', render: formatAmount },
	{ key: 'kadUsers', label: 'KAD users', render: formatAmount },
	{ key: 'ed2kFiles', label: 'ED2K files', render: formatAmount },
	{ key: 'kadFiles', label: 'KAD files', render: formatAmount },
	{ key: 'kadNodes', label: 'KAD nodes', render: formatAmount },
];

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
		{ to: '/servers', icon: '/assets/icons/Server.ico', label: 'Servers' },
		{ to: '/transfers', icon: '/assets/icons/Transfer.ico', label: 'Transfers' },
		{ to: '/search', icon: '/assets/icons/Search.ico', label: 'Search' },
		{ to: '/shared', icon: '/assets/icons/SharedFiles.ico', label: 'Shared' },
		{ to: '/categories', emoji: '🏷️', label: 'Categories' },
		{ to: '/webhooks', emoji: '🪝', label: 'Webhooks', style: { filter: 'hue-rotate(195deg)' } },
		{ to: '/settings', icon: '/assets/icons/Preferences.ico', label: 'Settings' },
	];

	// Como linksData es un array que no va a cambiar, podemos crear una
	// lista de componentes Link sin necesidad de usar componentList,
	const links = linksData.map((link) => {
		const icon = link.icon ? tpl.navIcon({ src: link.icon, style: link.style }) : tpl.navIconEmoji({ inner: link.emoji, style: link.style });
		const label = tpl.navLabel({ inner: link.label });

		return Link({
			to: link.to,
			inner: [icon, label],
			classes: { 'nav-link': true, 'active-link': pathMatches(link.to) },
		});
	});

	const serverIsConnected = computed(() => {
		const s = statsService.stats.get();
		return !!s && !!s.connectedServer;
	});

	return tpl.fragment({
		navLinks: { inner: links },
		connectionContainer: () => {
			if (!serverIsConnected.get()) {
				return tpl.connectionContainer({
					nodes: {
						connStatusText: { inner: 'Disconnected' },
						highIdBadge: { style: { display: 'none' } },
						serverName: { inner: 'Not connected' },
						serverIpPort: { inner: '-' },
						serverDesc: { inner: 'Please connect to a server' },
						ed2kIdVal: { inner: '-' },
						kadIdVal: { inner: '-' },
					},
				});
			}

			const s = () => statsService.stats.get()!;
			const server = () => s().connectedServer!;
			const isHigh = () => !!s().isHighID;

			return tpl.connectionContainer({
				nodes: {
					connStatusText: { inner: () => s().connectionState || 'Connected' },
					highIdBadge: {
						inner: () => (isHigh() ? 'High ID' : 'Low ID'),
						style: {
							background: () => (isHigh() ? '#4caf50' : '#f44336'),
							color: 'white',
							border: () => (isHigh() ? '1px solid #388e3c' : '1px solid #d32f2f'),
						},
					},
					serverName: { inner: () => server().name || 'Unknown Server' },
					serverIpPort: { inner: () => `${server().ip}:${server().port}` },
					serverDesc: { inner: () => server().description || 'No description available' },
					ed2kIdVal: { inner: () => String(s().ed2kId || s().id || '-') },
					kadIdVal: { inner: () => s().kadId || '-' },
				},
			});
		},
		systemContainer: {
			inner: () => {
				const info = systemInfo.get();
				if (!info) return 'Loading...';

				const result: (string | Node)[] = [];

				if (info.publicIp) {
					result.push(
						tpl.infoItem({
							nodes: {
								infoIcon: { inner: '🌐' },
								infoLabel: { inner: 'Public IP' },
								infoValue: { inner: info.publicIp },
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
							tpl.infoItem({
								nodes: {
									infoIcon: { inner: '📍' },
									infoLabel: { inner: 'Location' },
									infoValue: { inner: loc },
								},
							})
						);
					}
				}

				// Organization / ISP
				if (info.ipDetails && info.ipDetails.org) {
					result.push(
						tpl.infoItem({
							nodes: {
								infoIcon: { inner: '🏢' },
								infoLabel: { inner: 'Provider' },
								infoValue: { inner: info.ipDetails.org },
							},
						})
					);
				}

				if (info.vpn) {
					const isEnabled = info.vpn.enabled;
					const status = (info.vpn.status || (isEnabled ? 'Active' : 'Disabled')).toUpperCase();

					result.push(
						tpl.vpnInfo({
							nodes: {
								vpnStatusBadge: {
									inner: status,
									classes: {
										'vpn-badge-active': isEnabled,
										'vpn-badge-inactive': !isEnabled,
									},
								},
								vpnPortContainer: {
									style: { display: isEnabled && info.vpn.port ? '' : 'none' },
								},
								vpnPortValue: { inner: String(info.vpn.port || '-') },
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

				// Typed fields — render each stat with an appropriate formatter
				for (const f of statsFields) {
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
