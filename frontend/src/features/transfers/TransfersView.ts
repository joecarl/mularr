import { component, signal } from 'chispa';
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

	loadTransfers();

	return tpl.fragment({
		transferListContainer: {
			inner: () => {
				const list = transferList.get();
				if (list.length === 0) return tpl.transferRow({ nodes: { nameCol: { inner: 'No active transfers.' } } });
				return list.map((t) =>
					tpl.transferRow({
						nodes: {
							nameCol: { inner: t.rawLine },
						},
					})
				);
			},
		},
		refreshBtn: { onclick: loadTransfers },
	});
});
