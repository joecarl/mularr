import { component, componentList, computed, effect, Signal, signal } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { AmuleApiService, Server } from '../../services/AmuleApiService';
import { StatsService } from '../../services/StatsService';
import { formatAmount } from '../../utils/formats';
import { smartPoll } from '../../utils/scheduling';
import tpl from './ServersView.html';
import './ServersView.css';

interface ServersViewProps {
	// Optional callback for when a server row is double-clicked
	onConnectToServer?: (server: Server) => void;
	connectedServer: Signal<Server | null>;
}
const ServersRows = componentList<Server, ServersViewProps>(
	(sv, i, l, props) => {
		const { connectedServer, onConnectToServer } = props!;

		const isConnected = computed(() => {
			const cs = connectedServer.get();
			const s = sv.get();
			return !!cs && s.ip === cs.ip && s.port === cs.port;
		});

		const server = sv.get.bind(sv);
		const users = computed(() => formatAmount(server().users ?? 0));
		const maxUsers = computed(() => formatAmount(server().maxUsers ?? 0));
		const files = computed(() => formatAmount(server().files ?? 0));

		return tpl.serverRow({
			classes: { 'connected-server-row': isConnected },
			ondblclick: () => onConnectToServer && onConnectToServer(server()),
			nodes: {
				nameCol: {
					nodes: {
						nameText: { inner: () => server().name ?? '' },
						mobileInfo: {
							nodes: {
								mobIp: { inner: () => `${server().ip}:${server().port}` },
								mobUsers: { inner: () => users.get().text },
								mobFiles: { inner: () => files.get().text },
							},
						},
					},
				},
				ipCol: { inner: () => `${server().ip}:${server().port}` },
				descCol: { inner: () => server().description ?? '' },
				pingCol: { inner: () => server().ping ?? '' },
				usersCol: { inner: () => users.get().text + ' ' + users.get().unit },
				maxUsersCol: { inner: () => maxUsers.get().text + ' ' + maxUsers.get().unit },
				filesCol: { inner: () => files.get().text + ' ' + files.get().unit },
				prefCol: { inner: () => server().priority ?? '' },
				failedCol: { inner: () => server().failedCount ?? '' },
				staticCol: { inner: () => (server().isStatic ? 'Yes' : 'No') },
				softLimitCol: { inner: () => server().softFileLimit ?? '' },
				lowIDCol: { inner: () => (server().lowID ? 'Yes' : 'No') },
				obfuscatedCol: { inner: () => (server().obfuscated ? 'Yes' : 'No') },
			},
		});
	},
	(s) => s.ip + ':' + s.port
);

export const ServersView = component(() => {
	const apiService = services.get(AmuleApiService);
	const statsService = services.get(StatsService);

	// We'll treat the list as a signal of objects
	const servers = signal<Server[]>([]);
	const connectedServer = computed(() => {
		return statsService.stats.get()?.connectedServer ?? null;
	});
	const logText = signal('Initializing...');

	const fetchLog = smartPoll(async () => {
		try {
			const data = await apiService.getLog(100);
			const res = data && data.lines ? data.lines.join('\n') : 'No log data';
			logText.set(res);
		} catch (e) {
			console.error('Error fetching log:', e);
			logText.set('Error fetching log');
		}
	}, 3000);

	const loadServers = smartPoll(async () => {
		const data = await apiService.getServers();
		servers.set(data.list || []);
	}, 10000);

	const connectToServer = async (s?: Server) => {
		// logText.set(`Connecting to ${s.name ?? s.ip}...`);
		try {
			await apiService.connectToServer(s?.ip, s?.port);
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

	const someServers = computed(() => servers.get().length > 0);

	return tpl.fragment({
		serverListContainer: {
			inner: () => {
				const any = someServers.get();
				if (!any) return tpl.serverRow({ nodes: { nameCol: { inner: 'No servers found.' } } });
				return ServersRows(servers, { connectedServer, onConnectToServer: connectToServer });
			},
		},
		logContainer: {
			inner: logText,
			_ref: (el) => {
				logContainer = el;
			},
		},
		connectBtn: {
			onclick: () => {
				connectToServer();
			},
			style: { display: () => (someServers.get() && !connectedServer.get() ? '' : 'none') },
		},
		disconnectBtn: {
			onclick: async () => {
				await apiService.disconnectFromServer();
				setTimeout(loadServers, 1000);
			},
			style: { display: () => (someServers.get() && connectedServer.get() ? '' : 'none') },
		},
		refreshBtn: { onclick: loadServers },
	});
});
