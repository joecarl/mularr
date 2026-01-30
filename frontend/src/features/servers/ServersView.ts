import { component, signal } from 'chispa';
import { ApiService, Server } from '../../services/ApiService';
import tpl from './ServersView.html';
import './ServersView.css';

export const ServersView = component(() => {
	const apiService = ApiService.getInstance();
	// We'll treat the list as a signal of objects
	const servers = signal<Server[]>([]);
	const logText = signal('Initializing...');

	const loadServers = async () => {
		try {
			const data = await apiService.getServers();
			// data.list should be array of { name, ip, port }
			if (data.list) {
				servers.set(data.list);
			} else {
				logText.set('Received raw data without list format.\n' + data.raw);
			}
		} catch (e: any) {
			logText.set('Error loading servers: ' + e.message);
		}
	};

	loadServers();

	return tpl.fragment({
		serverListContainer: {
			inner: () => {
				const list = servers.get();
				if (list.length === 0) return tpl.serverRow({ nodes: { nameCol: { inner: 'No servers found.' } } });

				return list.map((s) =>
					tpl.serverRow({
						nodes: {
							nameCol: { inner: s.name },
							ipCol: { inner: s.ip },
							portCol: { inner: s.port },
						},
					})
				);
			},
		},
		logContainer: { inner: logText },
		refreshBtn: { onclick: loadServers },
	});
});
