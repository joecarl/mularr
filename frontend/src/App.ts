import { component, Router, signal } from 'chispa';
import { services } from './services/container/ServiceContainer';
import { AmuleInfo, AmuleApiService } from './services/AmuleApiService';
import { Sidebar } from './layout/Sidebar';
import { ServersView } from './features/servers/ServersView';
import { TransfersView } from './features/transfers/TransfersView';
import { SearchView } from './features/search/SearchView';
import { SettingsView } from './features/settings/SettingsView';
import { CategoriesView } from './features/categories/CategoriesView';
import tpl from './App.html';

export const App = component(() => {
	const apiService = services.get(AmuleApiService);
	const amuleInfo = signal<AmuleInfo | null>(null);
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
		sidebarContainer: Sidebar({}),
		routerView: {
			inner: Router({
				routes: [
					{ path: '/', component: ServersView },
					{ path: '/servers', component: ServersView },
					{ path: '/transfers', component: TransfersView },
					{ path: '/search', component: SearchView },
					{ path: '/categories', component: CategoriesView },
					{ path: '/settings', component: SettingsView },
				],
			}),
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
