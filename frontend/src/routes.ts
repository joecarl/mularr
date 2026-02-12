import { type Route } from 'chispa';
import { ServersView } from './features/servers/ServersView';
import { TransfersView } from './features/transfers/TransfersView';
import { SearchView } from './features/search/SearchView';
import { SharedView } from './features/shared/SharedView';
import { SettingsView } from './features/settings/SettingsView';
import { CategoriesView } from './features/categories/CategoriesView';
import { WebhooksView } from './features/webhooks/WebhooksView';

export const routes: Route[] = [
	{ path: '/', component: ServersView },
	{ path: '/servers', component: ServersView },
	{ path: '/transfers', component: TransfersView },
	{ path: '/search', component: SearchView },
	{ path: '/shared', component: SharedView },
	{ path: '/webhooks', component: WebhooksView },
	{ path: '/categories', component: CategoriesView },
	{ path: '/settings', component: SettingsView },
];
