import { component, signal, onUnmount } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { AmuleApiService, Transfer } from '../../services/AmuleApiService';
import { getFileIcon } from '../../utils/Icons';
import tpl from './TransfersView.html';
import './TransfersView.css';

export const TransfersView = component(() => {
	const apiService = services.get(AmuleApiService);

	const transferList = signal<Transfer[]>([]);
	const sharedList = signal<Transfer[]>([]);
	const sortColumn = signal<keyof Transfer>('name');
	const sortDirection = signal<'asc' | 'desc'>('asc');

	const loadTransfers = async () => {
		try {
			const data: any = await apiService.getTransfers();
			// Backward compatibility or new structure
			if (data.downloads) {
				transferList.set(data.downloads);
				sharedList.set(data.shared || []);
			}
		} catch (e: any) {
			transferList.set([{ rawLine: 'Error: ' + e.message }]);
		}
	};

	// Auto-update transfers every 2 seconds
	const intervalId = setInterval(loadTransfers, 2000);
	onUnmount(() => clearInterval(intervalId));

	loadTransfers();

	const sort = (col: keyof Transfer) => {
		if (sortColumn.get() === col) {
			sortDirection.set(sortDirection.get() === 'asc' ? 'desc' : 'asc');
		} else {
			sortColumn.set(col);
			sortDirection.set('asc');
		}
	};

	return tpl.fragment({
		thName: { onclick: () => sort('name') },
		thSize: { onclick: () => sort('size') },
		thCompleted: { onclick: () => sort('completed') },
		thSpeed: { onclick: () => sort('speed') },
		thProgress: { onclick: () => sort('progress') },
		thSources: { onclick: () => sort('sources') },
		thPriority: { onclick: () => sort('priority') },
		thStatus: { onclick: () => sort('status') },
		thRemaining: { onclick: () => sort('remaining') },
		thAddedOn: { onclick: () => sort('addedOn') },

		transferListContainer: {
			inner: () => {
				let list = [...transferList.get()];
				const col = sortColumn.get();
				const dir = sortDirection.get();

				if (list.length > 0 && !(list.length === 1 && !list[0].name && list[0].rawLine)) {
					list.sort((a, b) => {
						const va = a[col];
						const vb = b[col];
						if (va === vb) return 0;
						if (va === undefined) return 1;
						if (vb === undefined) return -1;
						if (va < vb) return dir === 'asc' ? -1 : 1;
						else return dir === 'asc' ? 1 : -1;
					});
				}

				if (list.length === 0) return tpl.noTransferRow({});

				const formatBytes = (bytes?: number) => {
					if (!bytes) return '0 B';
					const k = 1024;
					const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
					const i = Math.floor(Math.log(bytes) / Math.log(k));
					return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
				};

				return list.map((t) => {
					return tpl.transferRow({
						nodes: {
							nameCol: {
								nodes: {
									fileNameText: { inner: t.name || 'Unknown' },
									fileIcon: { inner: getFileIcon(t.name || '') },
								},
							},
							sizeCol: { inner: formatBytes(t.size) },
							completedCol: { inner: formatBytes(t.completed) },
							speedCol: { inner: formatBytes(t.speed) + '/s' },
							progressCol: {
								nodes: {
									progressBar: { style: { width: `${(t.progress || 0) * 100}%` } },
									progressText: { inner: ((t.progress || 0) * 100).toFixed(1) + '%' },
								},
							},
							sourcesCol: { inner: (t.sources || 0).toString() },
							priorityCol: { inner: (t.priority || 0).toString() },
							statusCol: { inner: t.status || '' },
							remainingCol: { inner: formatBytes(t.remaining) },
						},
					});
				});
			},
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
		refreshBtn: { onclick: loadTransfers },
	});
});
