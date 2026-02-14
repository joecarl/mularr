import { component, type Route, Router, signal } from 'chispa';
import { services } from '../services/container/ServiceContainer';
import { AmuleInfo, AmuleApiService } from '../services/AmuleApiService';
import { StatsService } from '../services/StatsService';
import { DialogHost } from '../components/DialogHost';
import { formatSpeed } from '../utils/formats';
import { Sidebar } from './Sidebar';
import tpl from './App.html';

export interface IAppProps {
	routes: Route[];
}
export const App = component<IAppProps>(({ routes }) => {
	const apiService = services.get(AmuleApiService);
	const statsService = services.get(StatsService);
	const amuleInfo = signal<AmuleInfo | null>(null);
	const isSidebarOpen = signal(false);

	const loadAmuleInfo = async () => {
		try {
			const info = await apiService.getInfo();
			amuleInfo.set(info);
			console.log('aMule Info:', info);
		} catch (e) {
			console.error('Failed to load aMule info', e);
		}
	};
	loadAmuleInfo();

	return tpl.fragment({
		layoutRoot: {
			classes: { 'sidebar-open': () => isSidebarOpen.get() },
		},
		menuToggle: {
			onclick: () => isSidebarOpen.set(!isSidebarOpen.get()),
		},
		sidebarOverlay: {
			onclick: () => isSidebarOpen.set(false),
		},
		sidebarContainer: Sidebar({
			onLinkClick: () => isSidebarOpen.set(false),
		}),
		dialogHost: DialogHost({}),
		routerView: {
			inner: Router({
				routes,
			}),
		},
		globalDownloadSpeed: {
			inner: () => {
				const s = statsService.stats.get();
				if (!s || typeof s.downloadSpeed !== 'number') return '';
				const ds = formatSpeed(s.downloadSpeed);
				return `${ds.text} ${ds.unit}`;
			},
		},
		globalUploadSpeed: {
			inner: () => {
				const s = statsService.stats.get();
				if (!s || typeof s.uploadSpeed !== 'number') return '';
				const us = formatSpeed(s.uploadSpeed);
				return `${us.text} ${us.unit}`;
			},
		},
		amuleVersion: {
			inner: () => {
				const info = amuleInfo.get();
				if (info) {
					return `aMule v${info.version} ready`;
				} else {
					return 'Loading aMule info...';
				}
			},
		},
	});
});
