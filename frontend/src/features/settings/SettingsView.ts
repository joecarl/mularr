import { component, signal, bindControlledInput, bindControlledSelect, bindControlledCheckbox } from 'chispa';
import { ApiService } from '../../services/ApiService';
import tpl from './SettingsView.html';

export const SettingsView = component(() => {
	const apiService = ApiService.getInstance();
	const theme = signal('classic');
	const interval = signal(2000);

	const tcpPort = signal('');
	const udpPort = signal('');
	const maxSources = signal('');
	const maxConnections = signal('');
	const downloadCap = signal('');
	const uploadCap = signal('');
	const incomingDir = signal('');
	const tempDir = signal('');

	// Mock or config values for checkboxes
	const netEd2k = signal(true);
	const netKad = signal(true);
	const showSplash = signal(true);
	const startMinimized = signal(false);

	const loadConfig = async () => {
		try {
			const data = await apiService.getConfig();
			if (data && data.values) {
				const v = data.values;
				tcpPort.set(v.tcpPort || '');
				udpPort.set(v.udpPort || '');
				maxSources.set(v.maxSources || '');
				maxConnections.set(v.maxConnections || '');
				downloadCap.set(v.downloadCap || '');
				uploadCap.set(v.uploadCap || '');
				incomingDir.set(v.incomingDir || '');
				tempDir.set(v.tempDir || '');
			}
		} catch (e) {
			console.error('Failed to load amule config', e);
		}
	};

	loadConfig();

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
		tcpPort: {
			_ref: (el) => {
				bindControlledInput(el, tcpPort);
			},
		},
		udpPort: {
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
			_ref: (el) => {
				bindControlledInput(el, incomingDir);
			},
		},
		tempDir: {
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
		showSplash: {
			_ref: (el) => {
				bindControlledCheckbox(el, showSplash);
			},
		},
		startMinimized: {
			_ref: (el) => {
				bindControlledCheckbox(el, startMinimized);
			},
		},
	});
});
