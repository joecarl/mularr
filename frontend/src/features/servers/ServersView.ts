import { component, computed, effect, signal } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { AmuleApiService, Server } from '../../services/AmuleApiService';
import { StatsService } from '../../services/StatsService';
import { formatAmount } from '../../utils/formats';
import { smartPoll } from '../../utils/scheduling';
import tpl from './ServersView.html';
import './ServersView.css';

export const ServersView = component(() => {
	const apiService = services.get(AmuleApiService);
	const statsService = services.get(StatsService);

	// We'll treat the list as a signal of objects
	const servers = signal<Server[]>([]);
	const connectedServer = computed(() => {
		return statsService.stats.get()?.connectedServer ?? null;
	});
	const logText = signal('Initializing...');

	const fetchLog = smartPoll(
		logText,
		async () => {
			try {
				const data = await apiService.getLog(100);
				return data && data.lines ? data.lines.join('\n') : 'No log data';
			} catch (e) {
				console.error('Error fetching log:', e);
				return 'Error fetching log';
			}
		},
		3000
	);

	const loadServers = smartPoll(
		servers,
		async () => {
			const data = await apiService.getServers();
			return data.list || [];
		},
		10000
	);

	const connectToServer = async (s: Server) => {
		// logText.set(`Connecting to ${s.name ?? s.ip}...`);
		try {
			await apiService.connectToServer(s.ip, s.port);
			// logText.set(`Connected request sent to ${s.name ?? s.ip}. Refreshing...`);
			setTimeout(loadServers, 1000);
		} catch (e: any) {
			console.error(`Error connecting: ${e.message}`);
		}
	};

	let logContainer: HTMLElement | null = null;
	effect(() => {
		logText.get();
		if (logContainer) {
			// Keep scroll at bottom
			//console.log('Updating log scroll position', logContainer);
			logContainer.scrollTop = logContainer.scrollHeight;
		}
	});

	return tpl.fragment({
		serverListContainer: {
			inner: () => {
				const list = servers.get();
				const connected = connectedServer.get();
				if (list.length === 0) return tpl.serverRow({ nodes: { nameCol: { inner: 'No servers found.' } } });

				return list.map((s) => {
					const isConnected = connected && s.ip === connected.ip && s.port === connected.port;
					const rowStyle = isConnected ? { color: 'blue', fontWeight: 'bold' } : {};
					const users = formatAmount(s.users ?? 0);
					const maxUsers = formatAmount(s.maxUsers ?? 0);
					const files = formatAmount(s.files ?? 0);

					return tpl.serverRow({
						style: rowStyle,
						ondblclick: () => connectToServer(s),
						nodes: {
							nameCol: { inner: s.name ?? '' },
							ipCol: { inner: `${s.ip}:${s.port}` },
							descCol: { inner: s.description ?? '' },
							pingCol: { inner: s.ping ?? '' },
							usersCol: { inner: users.text + ' ' + users.unit },
							maxUsersCol: { inner: maxUsers.text + ' ' + maxUsers.unit },
							filesCol: { inner: files.text + ' ' + files.unit },
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
		logContainer: {
			inner: logText,
			_ref: (el) => {
				logContainer = el;
			},
		},
		refreshBtn: { onclick: loadServers },
	});
});
