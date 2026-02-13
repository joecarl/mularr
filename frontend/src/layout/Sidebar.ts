import { component, computed, Link, pathMatches } from 'chispa';
import { services } from '../services/container/ServiceContainer';
import { StatsService } from '../services/StatsService';
import { Stats } from './panels/Stats';
import { Network } from './panels/Network';
import tpl from './Sidebar.html';
import './Sidebar.css';

// NOTE: ¡No crear nodos DOM manualmente en este archivo!
// Usa plantillas con `data-cb` en `Sidebar.html` y constrúyelas desde aquí con `tpl.<dataCbName>(...)`.
// Evita `document.createElement` y la manipulación manual del DOM; revisa `CHISPA_GUIDE.md` y `CHISPA_BEST_PRACTICES.md`.

export const Sidebar = component(() => {
	const statsService = services.get(StatsService);

	const linksData = [
		{ to: '/servers', icon: '/assets/icons/Server.ico', label: 'Servers' },
		{ to: '/transfers', icon: '/assets/icons/Transfer.ico', label: 'Transfers' },
		{ to: '/search', icon: '/assets/icons/Search.ico', label: 'Search' },
		{ to: '/shared', icon: '/assets/icons/SharedFiles.ico', label: 'Shared' },
		{ to: '/categories', emoji: '🏷️', label: 'Categories' },
		{ to: '/extensions', emoji: '🧩', label: 'Extensions' },
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
		networkContainer: {
			inner: Network(),
		},
		statsContainer: {
			inner: Stats(),
		},
	});
});
