import { component, type Route, Router, signal } from 'chispa';
import { services } from '../services/container/ServiceContainer';
import { AmuleInfo, AmuleApiService } from '../services/AmuleApiService';
import { StatsService } from '../services/StatsService';
import { WsService } from '../services/WsService';
import { formatSpeed } from '../utils/formats';
import { smartLoad } from '../utils/scheduling';
import { Sidebar } from './Sidebar';
import tpl from './App.html';

export interface IAppProps {
	routes: Route[];
}
export const App = component<IAppProps>(({ routes }) => {
	const apiService = services.get(AmuleApiService);
	const statsService = services.get(StatsService);
	const ws = services.get(WsService);
	const amuleInfo = signal<AmuleInfo | null>(null);
	const isSidebarOpen = signal(false);

	// Status bar shows the latest critical aMule log line ("!"-prefixed),
	// stripped of the "!" and datetime prefix: "!2026-07-22 11:36:16: Downloading X" → "Downloading X"
	const statusText = () => {
		const log = ws.amuleLog.get();
		for (let i = log.length - 1; i >= 0; i--) {
			const { text } = log[i];
			if (!text.startsWith('!')) continue;
			return text.replace(/^!\s*/, '').replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}:\s*/, '');
		}
		const info = amuleInfo.get();
		return info ? `aMule v${info.version} ready` : 'Loading aMule info...';
	};

	const loadAmuleInfo = smartLoad(async () => {
		const info = await apiService.getInfo();
		amuleInfo.set(info);
		console.log('aMule Info:', info);
	}, 'amule-info');
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
		statusText: {
			inner: statusText,
			title: statusText,
		},
	});
});
