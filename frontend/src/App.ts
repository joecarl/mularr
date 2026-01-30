import { component, Router } from 'chispa';
import { Sidebar } from './layout/Sidebar';
import { DashboardView } from './features/dashboard/DashboardView';
import { SettingsView } from './features/settings/SettingsView';

import tpl from './App.html';

export const App = component(() => {
	return tpl.fragment({
		sidebarContainer: Sidebar({}),
		routerView: Router({
			routes: [
				{ path: '/', component: DashboardView },
				{ path: '/settings', component: SettingsView },
			],
		}),
	});
});
