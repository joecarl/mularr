import { component, computed, Link, pathMatches } from 'chispa';
import { services } from '../services/container/ServiceContainer';
import { StatsService } from '../services/StatsService';
import { AuthApiService } from '../services/AuthApiService';
import { StatsContainer } from './panels/Stats';
import { NetworkContainer } from './panels/Network';
import tpl from './Sidebar.html';
import './Sidebar.css';

// NOTE: ¡No crear nodos DOM manualmente en este archivo!
// Usa plantillas con `data-cb` en `Sidebar.html` y constrúyelas desde aquí con `tpl.<dataCbName>(...)`.
// Evita `document.createElement` y la manipulación manual del DOM; revisa `CHISPA_GUIDE.md` y `CHISPA_BEST_PRACTICES.md`.

interface LinkData {
	to: string;
	icon?: string;
	emoji?: string;
	label: string;
	style?: Record<string, string>;
}

export interface SidebarProps {
	onLinkClick?: () => void;
}

export const Sidebar = component<SidebarProps>((props) => {
	const statsService = services.get(StatsService);
	const authService = services.get(AuthApiService);

	const handleLogout = () => {
		authService.logout();
		window.location.reload();
	};

	const linksData: LinkData[] = [
		{ to: '/dashboard', icon: '/assets/icons/Statistics.ico', label: 'Dashboard' },
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
			onclick: () => {
				if (props && props.onLinkClick) props.onLinkClick();
			},
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
						ed2kBadge: { title: '-', classes: { 'badge-error': true } },
						ed2kBadgeIcon: { inner: '✖' },
						kadBadge: { title: '-', classes: { 'badge-error': true } },
						kadBadgeIcon: { inner: '✖' },
					},
				});
			}

			const s = () => statsService.stats.get()!;
			const server = () => s().connectedServer!;
			const isHigh = () => !!s().isHighID;

			const hasEd2k = () => !!(s().ed2kId || s().id);
			const hasKad = () => !!s().kadId && s().kadId !== '-' && s().kadId !== '0';

			return tpl.connectionContainer({
				nodes: {
					connStatusText: { inner: () => s().connectionState || 'Connected' },
					highIdBadge: {
						inner: () => (isHigh() ? 'High ID' : 'Low ID'),
						addClass: () => (isHigh() ? 'badge-success' : 'badge-error'),
					},
					serverName: { inner: () => server()?.name || 'Unknown Server' },
					serverIpPort: { inner: () => `${server()?.ip}:${server()?.port}` },
					serverDesc: { inner: () => server()?.description || 'No description available' },
					ed2kBadge: {
						title: () => String(s().ed2kId || s().id || '-'),
						addClass: () => (hasEd2k() ? 'badge-success' : 'badge-error'),
					},
					ed2kBadgeIcon: { inner: () => (hasEd2k() ? '✔' : '✖') },
					kadBadge: {
						title: () => s().kadId || '-',
						addClass: () => (hasKad() ? 'badge-success' : 'badge-error'),
					},
					kadBadgeIcon: { inner: () => (hasKad() ? '✔' : '✖') },
				},
			});
		},
		networkContainer: NetworkContainer(),
		statsContainer: StatsContainer(),
		appVersion: { inner: `v${__APP_MANIFEST__.version}` },
		logoutBtn: {
			onclick: handleLogout,
			style: { display: () => (authService.isLoggedIn() ? '' : 'none') },
		},
	});
});
