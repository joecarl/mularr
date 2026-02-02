import { component, signal, onUnmount } from 'chispa';
import { ApiService, Transfer } from '../../services/ApiService';
import tpl from './TransfersView.html';
import './TransfersView.css';

export const TransfersView = component(() => {
	const apiService = ApiService.getInstance();
	const transferList = signal<Transfer[]>([]);

	const loadTransfers = async () => {
		try {
			const data = await apiService.getTransfers();
			if (data.list) {
				transferList.set(data.list);
			} else {
				transferList.set([{ rawLine: data.raw }]);
			}
		} catch (e: any) {
			transferList.set([{ rawLine: 'Error: ' + e.message }]);
		}
	};

	// Auto-update transfers every 2 seconds
	const intervalId = setInterval(loadTransfers, 2000);
	onUnmount(() => clearInterval(intervalId));

	loadTransfers();

	return tpl.fragment({
		transferListContainer: {
			inner: () => {
				const list = transferList.get();
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
							nameCol: { inner: t.name || 'Unknown' },
							sizeCol: { inner: formatBytes(t.size) },
							completedCol: { inner: formatBytes(t.completed) },
							speedCol: { inner: formatBytes(t.speed) + '/s' },
							progressCol: { inner: ((t.progress || 0) * 100).toFixed(1) + '%' },
							sourcesCol: { inner: (t.sources || 0).toString() },
							priorityCol: { inner: (t.priority || 0).toString() },
							statusCol: { inner: t.status || '' },
							remainingCol: { inner: formatBytes(t.remaining) },
							addedOnCol: { inner: '-' },
						},
					});
				});
			},
		},
		refreshBtn: { onclick: loadTransfers },
	});
});
