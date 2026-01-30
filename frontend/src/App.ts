import { component, Router } from 'chispa';
import { Sidebar } from './layout/Sidebar';
import { ServersView } from './features/servers/ServersView';
import { TransfersView } from './features/transfers/TransfersView';
import { SearchView } from './features/search/SearchView';
import { SettingsView } from './features/settings/SettingsView';

import tpl from './App.html';

export const App = component(() => {
	return tpl.fragment({
		sidebarContainer: Sidebar({}),
		routerView: Router({
			routes: [
				{ path: '/', component: ServersView },
				{ path: '/servers', component: ServersView },
				{ path: '/transfers', component: TransfersView },
				{ path: '/search', component: SearchView },
				{ path: '/settings', component: SettingsView },
			],
		}),
	});
});
