import { component, computed, signal } from 'chispa';
import { ApiService, Server } from '../../services/ApiService';
import { StatsService } from '../../services/StatsService';
import tpl from './ServersView.html';
import './ServersView.css';

export const ServersView = component(() => {
	const apiService = ApiService.getInstance();
	const statsService = StatsService.getInstance();
	// We'll treat the list as a signal of objects
	const servers = signal<Server[]>([]);
	const connectedServer = computed(() => {
		return statsService.stats.get()?.connectedServer ?? null;
	});
	const logText = signal('Initializing...');

	const loadServers = async () => {
		try {
			const data = await apiService.getServers();
			// data.list should be array of { name, ip, port, ... }
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

	const connectToServer = async (s: Server) => {
		logText.set(`Connecting to ${s.name ?? s.ip}...`);
		try {
			await apiService.connectToServer(s.ip, s.port);
			logText.set(`Connected request sent to ${s.name ?? s.ip}. Refreshing...`);
			setTimeout(loadServers, 1000);
		} catch (e: any) {
			logText.set(`Error connecting: ${e.message}`);
		}
	};

	return tpl.fragment({
		serverListContainer: {
			inner: () => {
				const list = servers.get();
				const connected = connectedServer.get();
				if (list.length === 0) return tpl.serverRow({ nodes: { nameCol: { inner: 'No servers found.' } } });

				return list.map((s) => {
					const isConnected = connected && s.ip === connected.ip && s.port === connected.port;
					const rowStyle = isConnected ? { color: 'blue', fontWeight: 'bold' } : {};

					return tpl.serverRow({
						style: rowStyle,
						ondblclick: () => connectToServer(s),
						nodes: {
							nameCol: { inner: s.name ?? '' },
							ipCol: { inner: `${s.ip}:${s.port}` },
							descCol: { inner: s.description ?? '' },
							pingCol: { inner: s.ping ?? '' },
							usersCol: { inner: s.users ?? '' },
							maxUsersCol: { inner: s.maxUsers ?? '' },
							filesCol: { inner: s.files ?? '' },
							prefCol: { inner: s.priority ?? '' },
							failedCol: { inner: s.failedCount ?? '' },
							staticCol: { inner: s.isStatic ? 'Yes' : 'No' },
							softLimitCol: { inner: s.softFileLimit ?? '' },
							lowIDCol: { inner: s.lowID ? 'Yes' : 'No' },
							obfuscatedCol: { inner: s.obfuscated ? 'Yes' : 'No' },
						},
					});
				});
			},
		},
		logContainer: { inner: logText },
		refreshBtn: { onclick: loadServers },
	});
});
