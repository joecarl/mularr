import { component, signal } from 'chispa';
import { services } from '../../../services/container/ServiceContainer';
import { BlacklistApiService, BlacklistEntry } from '../../../services/BlacklistApiService';
import { DialogService } from '../../../services/DialogService';
import { fbytes } from '../../../utils/formats';
import { BlacklistManagerDialog } from './BlacklistManagerDialog';
import tpl from './BlacklistSettings.html';

export const BlacklistSettings = component(() => {
	const blacklistApi = services.get(BlacklistApiService);
	const dialogService = services.get(DialogService);

	const entries = signal<BlacklistEntry[]>([]);

	const load = async () => {
		try {
			entries.set(await blacklistApi.getBlacklist());
		} catch (e) {
			console.error('Failed to load blacklist:', e);
		}
	};
	load();

	return tpl.fragment({
		manageBlacklistBtn: {
			onclick: () => {
				dialogService.open({
					title: 'Manage Blacklist',
					width: '760px',
					render: () => BlacklistManagerDialog({ entries, reload: load }),
				});
			},
		},
		blacklistTableBody: {
			inner: () => {
				const list = entries.get();
				if (list.length === 0) {
					return tpl.blacklistNoRows({});
				}

				return list.map((entry) =>
					tpl.blacklistTableRow({
						nodes: {
							blacklistNameCell: { inner: entry.name || 'Unknown', title: entry.name || 'Unknown' },
							blacklistSizeCell: { inner: entry.size ? fbytes(entry.size) : '-' },
						},
					})
				);
			},
		},
	});
});
