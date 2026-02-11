import { component, signal, bindControlledInput, bindControlledSelect, bindControlledCheckbox, effect } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { AmuleApiService } from '../../services/AmuleApiService';
import { LocalPrefsService } from '../../services/LocalPrefsService';
import { DialogService } from '../../services/DialogService';
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

	effect(() => {
		prefs.set('ui.refreshInterval', interval.get());
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

	const showSplash = signal(true);
	const startMinimized = signal(false);

	const lockedPorts = signal(false);
	const lockedIncomingDir = signal(false);
	const lockedTempDir = signal(false);

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

				if (v.lockedFields) {
					lockedPorts.set(!!v.lockedFields.ports);
					lockedIncomingDir.set(!!v.lockedFields.incomingDir);
					lockedTempDir.set(!!v.lockedFields.tempDir);
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
		themeSelect: {
			_ref: (el) => {
				bindControlledSelect(el, theme);
			},
		},
		intervalInput: {
			_ref: (el) => {
				bindControlledInput(el, interval);
			},
		},
		nick: {
			_ref: (el) => {
				bindControlledInput(el, nick);
			},
		},
		tcpPort: {
			disabled: lockedPorts,
			_ref: (el) => {
				bindControlledInput(el, tcpPort);
			},
		},
		udpPort: {
			disabled: lockedPorts,
			_ref: (el) => {
				bindControlledInput(el, udpPort);
			},
		},
		maxSources: {
			_ref: (el) => {
				bindControlledInput(el, maxSources);
			},
		},
		maxConnections: {
			_ref: (el) => {
				bindControlledInput(el, maxConnections);
			},
		},
		maxConnectionsPerFiveSeconds: {
			_ref: (el) => {
				bindControlledInput(el, maxConnectionsPerFiveSeconds);
			},
		},
		slotAllocation: {
			_ref: (el) => {
				bindControlledInput(el, slotAllocation);
			},
		},
		queueSizePref: {
			_ref: (el) => {
				bindControlledInput(el, queueSizePref);
			},
		},
		fileBufferSizePref: {
			_ref: (el) => {
				bindControlledInput(el, fileBufferSizePref);
			},
		},
		maxDownload: {
			_ref: (el) => {
				bindControlledInput(el, maxDownload);
			},
		},
		maxUpload: {
			_ref: (el) => {
				bindControlledInput(el, maxUpload);
			},
		},
		downloadCap: {
			_ref: (el) => {
				bindControlledInput(el, downloadCap);
			},
		},
		uploadCap: {
			_ref: (el) => {
				bindControlledInput(el, uploadCap);
			},
		},
		incomingDir: {
			disabled: lockedIncomingDir,
			_ref: (el) => {
				bindControlledInput(el, incomingDir);
			},
		},
		tempDir: {
			disabled: lockedTempDir,
			_ref: (el) => {
				bindControlledInput(el, tempDir);
			},
		},
		netEd2k: {
			_ref: (el) => {
				bindControlledCheckbox(el, netEd2k);
			},
		},
		netKad: {
			_ref: (el) => {
				bindControlledCheckbox(el, netKad);
			},
		},
		autoconnect: {
			_ref: (el) => {
				bindControlledCheckbox(el, autoconnect);
			},
		},
		reconnect: {
			_ref: (el) => {
				bindControlledCheckbox(el, reconnect);
			},
		},
		upnp: {
			_ref: (el) => {
				bindControlledCheckbox(el, upnp);
			},
		},
		obfuscationRequested: {
			_ref: (el) => {
				bindControlledCheckbox(el, obfuscationRequested);
			},
		},
		obfuscationRequired: {
			_ref: (el) => {
				bindControlledCheckbox(el, obfuscationRequired);
			},
		},
		smartIdCheck: {
			_ref: (el) => {
				bindControlledCheckbox(el, smartIdCheck);
			},
		},
		ich: {
			_ref: (el) => {
				bindControlledCheckbox(el, ich);
			},
		},
		allocateFullFile: {
			_ref: (el) => {
				bindControlledCheckbox(el, allocateFullFile);
			},
		},
		showSplash: {
			onclick: handleNostalgiaClick,
			_ref: (el) => {
				bindControlledCheckbox(el, showSplash);
			},
		},
		startMinimized: {
			onclick: handleNostalgiaClick,
			_ref: (el) => {
				bindControlledCheckbox(el, startMinimized);
			},
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
	});
});
