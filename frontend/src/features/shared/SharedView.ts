import { component, signal, computed, onUnmount } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { AmuleApiService, Transfer } from '../../services/AmuleApiService';
import { getFileIcon } from '../../utils/Icons';
import tpl from './SharedView.html';
import './SharedView.css';

export const SharedView = component(() => {
	const apiService = services.get(AmuleApiService);

	const sharedList = signal<Transfer[]>([]);
	const selectedHash = signal<string | null>(null);
	const sortColumn = signal<keyof Transfer>('name');
	const sortDirection = signal<'asc' | 'desc'>('asc');

	const isDisabled = computed(() => !selectedHash.get());

	const loadShared = async () => {
		try {
			const data = await apiService.getSharedFiles();
			if (data.list) {
				sharedList.set(data.list);
			}
		} catch (e: any) {
			console.error('Error loading transfers:', e);
		}
	};

	// Auto-update transfers every 2 seconds
	const intervalId = setInterval(loadShared, 2000);
	onUnmount(() => clearInterval(intervalId));

	loadShared();

	const sort = (col: keyof Transfer) => {
		if (sortColumn.get() === col) {
			sortDirection.set(sortDirection.get() === 'asc' ? 'desc' : 'asc');
		} else {
			sortColumn.set(col);
			sortDirection.set('asc');
		}
	};

	const executeCommand = async (cmd: 'pause' | 'resume' | 'stop' | 'cancel') => {
		const hash = selectedHash.get();
		if (!hash) return;
		try {
			if (cmd === 'cancel' && !confirm('Are you sure you want to cancel this download?')) {
				return;
			}
			await apiService.sendDownloadCommand(hash, cmd);
			if (cmd === 'cancel') selectedHash.set(null);
			loadShared();
		} catch (e: any) {
			alert(e.message);
		}
	};

	return tpl.fragment({
		refreshBtn: { onclick: loadShared },

		cancelBtn: {
			disabled: isDisabled,
			onclick: () => executeCommand('cancel'),
		},

		sharedListContainer: {
			inner: () => {
				const list = sharedList.get();
				if (list.length === 0) return tpl.noSharedRow({});

				const formatBytes = (bytes?: number) => {
					if (!bytes) return '0 B';
					const k = 1024;
					const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
					const i = Math.floor(Math.log(bytes) / Math.log(k));
					return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
				};

				return list.map((t) => {
					return tpl.sharedRow({
						nodes: {
							sharedNameCol: {
								nodes: {
									sharedNameText: { inner: t.name || 'Unknown' },
									sharedIcon: { inner: getFileIcon(t.name || '') },
								},
							},
							sharedSizeCol: { inner: formatBytes(t.size) },
							sharedStatusCol: { inner: 'Shared' },
							sharedSourcesCol: { inner: String(t.sources || 0) },
						},
					});
				});
			},
		},
	});
});
