import { component, signal, effect, refBindCheckbox, refBindInput, refBindSelect } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { AmuleApiService, SharedDirectoryEntry } from '../../services/AmuleApiService';
import { LocalPrefsService } from '../../services/LocalPrefsService';
import { DialogService } from '../../services/DialogService';
import { smartLoad } from '../../utils/scheduling';
import { SharedDirsSettings } from './components/SharedDirsSettings';
import { BlacklistSettings } from './components/BlacklistSettings';
import tpl from './SettingsView.html';
import './SettingsView.css';

export const SettingsView = component(() => {
	const apiService = services.get(AmuleApiService);
	const prefs = services.get(LocalPrefsService);
	const dialogService = services.get(DialogService);

	const theme = signal(prefs.getTheme());

	effect(() => {
		const t = theme.get();
		document.documentElement.setAttribute('data-theme', t);
		prefs.setTheme(t);
	});

	const interval = signal(prefs.get('ui.refreshInterval', 2000));
	const detailedTransferProgress = signal(prefs.get('ui.transfers.useDetailedProgress', true));

	effect(() => {
		prefs.set('ui.refreshInterval', interval.get());
	});

	effect(() => {
		prefs.set('ui.transfers.useDetailedProgress', detailedTransferProgress.get());
	});

	const nick = signal('');
	const tcpPort = signal('');
	const udpPort = signal('');
	const maxSources = signal('');
	const maxConnections = signal('');
	const maxConnectionsPerFiveSeconds = signal('');
	const slotAllocation = signal('');
	const queueSizePref = signal('');
	const fileBufferSizePref = signal('');
	const maxDownload = signal('');
	const maxUpload = signal('');
	const downloadCap = signal('');
	const uploadCap = signal('');
	const incomingDir = signal('');
	const tempDir = signal('');
	const restartingDaemon = signal(false);

	const netEd2k = signal(true);
	const netKad = signal(true);
	const autoconnect = signal(true);
	const reconnect = signal(true);
	const upnp = signal(false);
	const obfuscationRequested = signal(true);
	const obfuscationRequired = signal(false);
	const smartIdCheck = signal(true);
	const ich = signal(true);
	const allocateFullFile = signal(false);
	const previewPrio = signal(false);
	const ipFilterClients = signal(true);
	const ipFilterServers = signal(true);
	const filterLanIps = signal(true);
	const paranoidFiltering = signal(true);
	const ipFilterAutoLoad = signal(true);
	const ipFilterUrl = signal('');
	const filterLevel = signal('127');
	const ipFilterSystem = signal(false);

	const showSplash = signal(true);
	const startMinimized = signal(false);

	const lockedPorts = signal(false);
	const lockedIncomingDir = signal(false);
	const lockedTempDir = signal(false);
	const lockedSharedDirs = signal(false);
	const sharedDirs = signal<SharedDirectoryEntry[]>([]);

	const amuleVersion = signal('');
	const loadAmuleVersion = smartLoad(async () => {
		const info = await apiService.getInfo();
		amuleVersion.set(info.version || '');
	}, 'amule-info');
	loadAmuleVersion();

	const loadConfig = async () => {
		try {
			const data = await apiService.getConfig();
			if (data) {
				const v = data;
				nick.set(v.nick || '');
				tcpPort.set(v.tcpPort || '');
				udpPort.set(v.udpPort || '');
				maxSources.set(v.maxSources || '');
				maxConnections.set(v.maxConnections || '');
				maxConnectionsPerFiveSeconds.set(v.maxConnectionsPerFiveSeconds || '');
				slotAllocation.set(v.slotAllocation || '');
				queueSizePref.set(v.queueSizePref || '');
				fileBufferSizePref.set(v.fileBufferSizePref || '');
				maxDownload.set(v.maxDownload || '');
				maxUpload.set(v.maxUpload || '');
				downloadCap.set(v.downloadCap || '');
				uploadCap.set(v.uploadCap || '');
				incomingDir.set(v.incomingDir || '');
				tempDir.set(v.tempDir || '');
				netEd2k.set(v.ed2k ?? true);
				netKad.set(v.kad ?? true);
				autoconnect.set(v.autoconnect ?? true);
				reconnect.set(v.reconnect ?? true);
				upnp.set(v.upnp ?? false);
				obfuscationRequested.set(v.obfuscationRequested ?? true);
				obfuscationRequired.set(v.obfuscationRequired ?? false);
				smartIdCheck.set(v.smartIdCheck ?? true);
				ich.set(v.ich ?? true);
				allocateFullFile.set(v.allocateFullFile ?? false);
				previewPrio.set(v.previewPrio ?? false);
				ipFilterClients.set(v.ipFilterClients ?? true);
				ipFilterServers.set(v.ipFilterServers ?? true);
				filterLanIps.set(v.filterLanIps ?? true);
				paranoidFiltering.set(v.paranoidFiltering ?? true);
				ipFilterAutoLoad.set(v.ipFilterAutoLoad ?? true);
				ipFilterUrl.set(v.ipFilterUrl || '');
				filterLevel.set(v.filterLevel || '127');
				ipFilterSystem.set(v.ipFilterSystem ?? false);
				sharedDirs.set((v.sharedDirs || []).map((entry) => ({ path: entry.path || '', recursive: !!entry.recursive })));
				lockedPorts.set(false);
				lockedIncomingDir.set(false);
				lockedTempDir.set(false);
				lockedSharedDirs.set(false);

				if (v.lockedFields) {
					lockedPorts.set(!!v.lockedFields.ports);
					lockedIncomingDir.set(!!v.lockedFields.incomingDir);
					lockedTempDir.set(!!v.lockedFields.tempDir);
					lockedSharedDirs.set(!!v.lockedFields.sharedDirs);
				}
			}
		} catch (e) {
			console.error('Failed to load amule config', e);
		}
	};

	loadConfig();

	const handleNostalgiaClick = (e: MouseEvent) => {
		e.preventDefault();
		dialogService.alert('This is just a nostalgic setting and has no effect on the daemon.', 'Nostalgia Filter');
	};

	return tpl.fragment({
		themeSelect: { _ref: refBindSelect(theme) },
		intervalInput: { _ref: refBindInput(interval) },
		detailedTransferProgress: { _ref: refBindCheckbox(detailedTransferProgress) },
		nick: { _ref: refBindInput(nick) },
		tcpPort: {
			disabled: lockedPorts,
			_ref: refBindInput(tcpPort),
		},
		udpPort: {
			disabled: lockedPorts,
			_ref: refBindInput(udpPort),
		},
		maxSources: { _ref: refBindInput(maxSources) },
		maxConnections: { _ref: refBindInput(maxConnections) },
		maxConnectionsPerFiveSeconds: { _ref: refBindInput(maxConnectionsPerFiveSeconds) },
		slotAllocation: { _ref: refBindInput(slotAllocation) },
		queueSizePref: { _ref: refBindInput(queueSizePref) },
		fileBufferSizePref: { _ref: refBindInput(fileBufferSizePref) },
		maxDownload: { _ref: refBindInput(maxDownload) },
		maxUpload: { _ref: refBindInput(maxUpload) },
		downloadCap: { _ref: refBindInput(downloadCap) },
		uploadCap: { _ref: refBindInput(uploadCap) },
		incomingDir: {
			disabled: lockedIncomingDir,
			_ref: refBindInput(incomingDir),
		},
		tempDir: {
			disabled: lockedTempDir,
			_ref: refBindInput(tempDir),
		},
		netEd2k: { _ref: refBindCheckbox(netEd2k) },
		netKad: { _ref: refBindCheckbox(netKad) },
		autoconnect: { _ref: refBindCheckbox(autoconnect) },
		reconnect: { _ref: refBindCheckbox(reconnect) },
		upnp: { _ref: refBindCheckbox(upnp) },
		obfuscationRequested: { _ref: refBindCheckbox(obfuscationRequested) },
		obfuscationRequired: { _ref: refBindCheckbox(obfuscationRequired) },
		smartIdCheck: { _ref: refBindCheckbox(smartIdCheck) },
		ich: { _ref: refBindCheckbox(ich) },
		allocateFullFile: { _ref: refBindCheckbox(allocateFullFile) },
		previewPrio: { _ref: refBindCheckbox(previewPrio) },
		ipFilterClients: { _ref: refBindCheckbox(ipFilterClients) },
		ipFilterServers: { _ref: refBindCheckbox(ipFilterServers) },
		filterLanIps: { _ref: refBindCheckbox(filterLanIps) },
		paranoidFiltering: { _ref: refBindCheckbox(paranoidFiltering) },
		ipFilterAutoLoad: { _ref: refBindCheckbox(ipFilterAutoLoad) },
		ipFilterUrl: { _ref: refBindInput(ipFilterUrl) },
		filterLevel: { _ref: refBindInput(filterLevel) },
		ipFilterSystem: { _ref: refBindCheckbox(ipFilterSystem) },
		showSplash: {
			onclick: handleNostalgiaClick,
			_ref: refBindCheckbox(showSplash),
		},
		startMinimized: {
			onclick: handleNostalgiaClick,
			_ref: refBindCheckbox(startMinimized),
		},
		amuleVersionLabel: {
			inner: () => (amuleVersion.get() ? `aMule v${amuleVersion.get()}` : ''),
		},
		restartDaemonBtn: {
			disabled: restartingDaemon,
			onclick: async () => {
				restartingDaemon.set(true);
				try {
					await apiService.restartDaemon();
				} catch (e) {
					console.error('Failed to restart daemon', e);
				} finally {
					restartingDaemon.set(false);
				}
			},
		},
		applyBtn: {
			onclick: async () => {
				try {
					await apiService.updateConfig({
						nick: nick.get(),
						tcpPort: tcpPort.get(),
						udpPort: udpPort.get(),
						maxSources: maxSources.get(),
						maxConnections: maxConnections.get(),
						maxConnectionsPerFiveSeconds: maxConnectionsPerFiveSeconds.get(),
						slotAllocation: slotAllocation.get(),
						queueSizePref: queueSizePref.get(),
						fileBufferSizePref: fileBufferSizePref.get(),
						downloadCap: downloadCap.get(),
						uploadCap: uploadCap.get(),
						maxDownload: maxDownload.get(),
						maxUpload: maxUpload.get(),
						incomingDir: incomingDir.get(),
						tempDir: tempDir.get(),
						ed2k: netEd2k.get(),
						kad: netKad.get(),
						autoconnect: autoconnect.get(),
						reconnect: reconnect.get(),
						upnp: upnp.get(),
						obfuscationRequested: obfuscationRequested.get(),
						obfuscationRequired: obfuscationRequired.get(),
						smartIdCheck: smartIdCheck.get(),
						ich: ich.get(),
						allocateFullFile: allocateFullFile.get(),
						previewPrio: previewPrio.get(),
						ipFilterClients: ipFilterClients.get(),
						ipFilterServers: ipFilterServers.get(),
						filterLanIps: filterLanIps.get(),
						paranoidFiltering: paranoidFiltering.get(),
						ipFilterAutoLoad: ipFilterAutoLoad.get(),
						ipFilterUrl: ipFilterUrl.get(),
						filterLevel: filterLevel.get(),
						ipFilterSystem: ipFilterSystem.get(),
						sharedDirs: sharedDirs.get(),
					});
					await loadConfig();
				} catch (e) {
					console.error('Failed to update config', e);
				}
			},
		},
		cancelBtn: {
			onclick: () => {
				loadConfig();
			},
		},
		lockedPortsInfo: {
			style: {
				display: () => (lockedPorts.get() ? '' : 'none'),
			},
		},
		lockedIncomingInfo: {
			style: {
				display: () => (lockedIncomingDir.get() ? '' : 'none'),
			},
		},
		lockedTempInfo: {
			style: {
				display: () => (lockedTempDir.get() ? '' : 'none'),
			},
		},
		sharedDirsSection: SharedDirsSettings({
			sharedDirs,
			isLocked: () => lockedSharedDirs.get(),
		}),
		blacklistSection: BlacklistSettings(),
	});
});
