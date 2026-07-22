import { bindControlledInput, component, componentList, computed, effect, Signal, signal } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { AmuleApiService, Server } from '../../services/AmuleApiService';
import { ContextMenuService, ContextMenuItem } from '../../services/ContextMenuService';
import { DialogService } from '../../services/DialogService';
import { LocalPrefsService } from '../../services/LocalPrefsService';
import { StatsService } from '../../services/StatsService';
import { WsService } from '../../services/WsService';
import { ListManager } from '../../utils/ListManager';
import { formatAmount } from '../../utils/formats';
import { smartLoad } from '../../utils/scheduling';
import { AddServerDialog } from './AddServerDialog';
import tpl from './ServersView.html';
import './ServersView.css';

const LAST_URL_KEY = 'mularr.servers.lastUpdateUrl';

// Servers have no natural hash, so synthesize one for ListManager selection
type ServerItem = Server & { hash: string };
const toServerItems = (list: Server[]): ServerItem[] => (list || []).map((s) => ({ ...s, hash: `${s.ip}:${s.port}` }));

// SRV_PR_* values in aMule's Server.h
const PRIORITY_LABELS: Record<number, string> = { 0: 'Normal', 1: 'High', 2: 'Low' };

interface ServersViewProps {
	// Optional callback for when a server row is double-clicked
	onConnectToServer?: (server: Server) => void;
	onRemoveServers?: (servers: Server[]) => void;
	onSetPriority?: (servers: Server[], priority: number) => void;
	onSetStatic?: (servers: Server[], isStatic: boolean) => void;
	connectedServer: Signal<Server | null>;
	mgr: ListManager<ServerItem, keyof ServerItem>;
}
const ServersRows = componentList<ServerItem, ServersViewProps>(
	(sv, i, l, props) => {
		const { connectedServer, onConnectToServer, onRemoveServers, onSetPriority, onSetStatic, mgr } = props!;
		const ctxMenu = services.get(ContextMenuService);

		const isConnected = computed(() => {
			const cs = connectedServer.get();
			const s = sv.get();
			return !!cs && s.ip === cs.ip && s.port === cs.port;
		});
		const isSelected = computed(() => mgr.selectedHashes.get().has(sv.get().hash));

		const server = sv.get.bind(sv);
		const users = computed(() => formatAmount(server().users ?? 0));
		const maxUsers = computed(() => formatAmount(server().maxUsers ?? 0));
		const files = computed(() => formatAmount(server().files ?? 0));

		return tpl.serverRow({
			classes: { selected: isSelected, 'connected-server-row': isConnected },
			onclick: (e: MouseEvent) => {
				mgr.handleRowSelection(e, server().hash, l.get());
			},
			ondblclick: () => onConnectToServer && onConnectToServer(server()),
			oncontextmenu: (e: MouseEvent) => {
				mgr.handleContextMenuSelection(e, server().hash, l.get());
				const selected = mgr.selectedHashes.get();
				const targets = l.get().filter((x) => selected.has(x.hash));
				const multi = targets.length > 1;
				const suffix = multi ? ` (${targets.length} servers)` : '';

				const actions: ContextMenuItem[] = [];
				if (!multi) {
					actions.push({
						label: 'Connect',
						icon: '🔌',
						onClick: () => onConnectToServer && onConnectToServer(server()),
					});
					actions.push({ separator: true });
				}
				actions.push({
					label: `Priority High${suffix}`,
					icon: '⬆️',
					onClick: () => onSetPriority && onSetPriority(targets, 1),
				});
				actions.push({
					label: `Priority Normal${suffix}`,
					icon: '➖',
					onClick: () => onSetPriority && onSetPriority(targets, 0),
				});
				actions.push({
					label: `Priority Low${suffix}`,
					icon: '⬇️',
					onClick: () => onSetPriority && onSetPriority(targets, 2),
				});
				actions.push({ separator: true });
				actions.push({
					label: `${server().isStatic ? 'Unset' : 'Set'} static${suffix}`,
					icon: '📌',
					onClick: () => onSetStatic && onSetStatic(targets, !server().isStatic),
				});
				actions.push({ separator: true });
				actions.push({
					label: multi ? `Remove ${targets.length} servers` : 'Remove server',
					icon: '🗑️',
					onClick: () => onRemoveServers && onRemoveServers(targets),
				});
				ctxMenu.show(e, actions);
			},
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
				prefCol: { inner: () => PRIORITY_LABELS[server().priority ?? -1] ?? server().priority ?? '' },
				failedCol: { inner: () => server().failedCount ?? '' },
				staticCol: { inner: () => (server().isStatic ? 'Yes' : 'No') },
				softLimitCol: { inner: () => server().softFileLimit ?? '' },
				lowIDCol: { inner: () => (server().lowID ? 'Yes' : 'No') },
				obfuscatedCol: { inner: () => (server().obfuscated ? 'Yes' : 'No') },
			},
		});
	},
	(s) => s.hash
);

export const ServersView = component(() => {
	const apiService = services.get(AmuleApiService);
	const statsService = services.get(StatsService);
	const dialogService = services.get(DialogService);
	const prefs = services.get(LocalPrefsService);
	const ws = services.get(WsService);

	const mgr = new ListManager<ServerItem, keyof ServerItem>({
		defaultColumn: 'name',
		numericColumns: ['port', 'ping', 'users', 'maxUsers', 'files', 'priority', 'failedCount', 'softFileLimit'],
		prefs: { service: prefs, key: 'servers' },
	});

	const connectedServer = computed(() => {
		return statsService.stats.get()?.connectedServer ?? null;
	});
	const logText = signal('Initializing...');

	// Sync log and servers from WebSocket
	effect(() => {
		const log = ws.amuleLog.get();
		logText.set(log.length ? log.join('\n') : 'No log data');
	});
	effect(() => {
		const s = ws.servers.get();
		if (s) mgr.items.set(toServerItems(s.list || []));
	});

	// Manual refresh for post-action use
	const loadServers = smartLoad(async () => {
		const data = await apiService.getServers();
		mgr.items.set(toServerItems(data.list || []));
	}, 'servers');

	const storedUpdateUrl = localStorage.getItem(LAST_URL_KEY) || '';
	const updateUrl = signal(storedUpdateUrl);

	// Default URL is the Ed2kServersUrl configured in amule.conf
	const loadDefaultUrl = async () => {
		try {
			const cfg = await apiService.getConfig();
			return cfg.ed2kServersUrl || '';
		} catch {
			return '';
		}
	};

	if (!storedUpdateUrl) {
		loadDefaultUrl().then((url) => {
			if (!updateUrl.get() && url) updateUrl.set(url);
		});
	}

	const resetUpdateUrl = async () => {
		localStorage.removeItem(LAST_URL_KEY);
		updateUrl.set(await loadDefaultUrl());
	};

	const updateServerList = async () => {
		const url = updateUrl.get().trim();
		if (!url) return;
		localStorage.setItem(LAST_URL_KEY, url);
		try {
			await apiService.updateServerList(url);
			// The daemon downloads the list asynchronously; give it a moment
			setTimeout(loadServers, 2000);
		} catch (e: any) {
			await dialogService.alert('Error updating server list: ' + e.message, 'Update Error');
		}
	};

	const openAddServerDialog = () => {
		dialogService.open({
			title: 'Add Server',
			width: '400px',
			render: (close) =>
				AddServerDialog({
					onConfirm: async ({ ip, port, name }) => {
						close();
						try {
							await apiService.addServer(ip, port, name);
							setTimeout(loadServers, 500);
						} catch (e: any) {
							await dialogService.alert('Error adding server: ' + e.message, 'Add Server Error');
						}
					},
					onCancel: close,
				}),
		});
	};

	const setPriority = async (list: Server[], priority: number) => {
		try {
			await Promise.all(list.map((s) => apiService.setServerPriority(s.ip, s.port, priority)));
			setTimeout(loadServers, 500);
		} catch (e: any) {
			await dialogService.alert('Error setting server priority: ' + e.message, 'Priority Error');
		}
	};

	const setStatic = async (list: Server[], isStatic: boolean) => {
		try {
			await Promise.all(list.map((s) => apiService.setServerStatic(s.ip, s.port, isStatic)));
			setTimeout(loadServers, 500);
		} catch (e: any) {
			await dialogService.alert('Error setting server static flag: ' + e.message, 'Static Flag Error');
		}
	};

	const removeServers = async (list: Server[]) => {
		if (list.length === 0) return;
		const label =
			list.length === 1
				? `server ${list[0].name ? `"${list[0].name}" ` : ''}(${list[0].ip}:${list[0].port})`
				: `${list.length} servers`;
		const ok = await dialogService.confirm(`Remove ${label} from the list?`, 'Remove Servers');
		if (!ok) return;
		try {
			await Promise.all(list.map((s) => apiService.removeServer(s.ip, s.port)));
			mgr.clearSelection();
			setTimeout(loadServers, 500);
		} catch (e: any) {
			await dialogService.alert('Error removing server: ' + e.message, 'Remove Error');
		}
	};

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

	const someServers = mgr.hasItems;

	return tpl.fragment({
		thName: { onclick: () => mgr.sort('name') },
		thIp: { onclick: () => mgr.sort('ip') },
		thDesc: { onclick: () => mgr.sort('description') },
		thPing: { onclick: () => mgr.sort('ping') },
		thUsers: { onclick: () => mgr.sort('users') },
		thMaxUsers: { onclick: () => mgr.sort('maxUsers') },
		thFiles: { onclick: () => mgr.sort('files') },
		thPref: { onclick: () => mgr.sort('priority') },
		thFailed: { onclick: () => mgr.sort('failedCount') },
		thStatic: { onclick: () => mgr.sort('isStatic') },
		thSoftLimit: { onclick: () => mgr.sort('softFileLimit') },
		thLowID: { onclick: () => mgr.sort('lowID') },
		thObfuscated: { onclick: () => mgr.sort('obfuscated') },

		serverListContainer: {
			inner: () => {
				const any = someServers.get();
				if (!any) return tpl.serverRow({ nodes: { nameCol: { inner: 'No servers found.' } } });
				return ServersRows(mgr.sortedItems, {
					connectedServer,
					onConnectToServer: connectToServer,
					onRemoveServers: removeServers,
					onSetPriority: setPriority,
					onSetStatic: setStatic,
					mgr,
				});
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
		addServerBtn: { onclick: openAddServerDialog },
		updateUrlInput: {
			_ref: (el) => {
				bindControlledInput(el, updateUrl);
			},
			onkeydown: (e: KeyboardEvent) => {
				if (e.key === 'Enter') updateServerList();
			},
		},
		defaultUrlBtn: { onclick: resetUpdateUrl },
		updateListBtn: { onclick: updateServerList },
	});
});
