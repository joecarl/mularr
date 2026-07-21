import { component, Link, pathMatches } from 'chispa';
import { services } from '../services/container/ServiceContainer';
import { AuthApiService } from '../services/AuthApiService';
import { StatsContainer } from './panels/Stats';
import { NetworkContainer } from './panels/Network';
import { ConnectionContainer } from './panels/Connection';
import tpl from './Sidebar.html';
import './Sidebar.css';

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

	return tpl.fragment({
		navLinks: { inner: links },
		connectionContainer: ConnectionContainer(),
		networkContainer: NetworkContainer(),
		statsContainer: StatsContainer(),
		appVersion: { inner: `v${__APP_MANIFEST__.version}` },
		logoutBtn: {
			onclick: handleLogout,
			style: { display: () => (authService.isLoggedIn() ? '' : 'none') },
		},
	});
});
