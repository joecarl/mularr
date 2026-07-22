import { component, Signal } from 'chispa';
import { services } from '../../../services/container/ServiceContainer';
import { BlacklistApiService, BlacklistEntry } from '../../../services/BlacklistApiService';
import { DialogService } from '../../../services/DialogService';
import { fbytes } from '../../../utils/formats';
import tpl from './BlacklistManagerDialog.html';

export interface BlacklistManagerDialogProps {
	entries: Signal<BlacklistEntry[]>;
	reload: () => Promise<void>;
}

export const BlacklistManagerDialog = component<BlacklistManagerDialogProps>(({ entries, reload }) => {
	const blacklistApi = services.get(BlacklistApiService);
	const dialogService = services.get(DialogService);

	const removeEntry = async (entry: BlacklistEntry) => {
		const confirmed = await dialogService.confirm(
			`Remove this hash from the blacklist?\n\nHash: ${entry.hash}\nName: ${entry.name || 'Unknown'}`,
			'Remove from Blacklist'
		);
		if (!confirmed) return;
		try {
			await blacklistApi.removeFromBlacklist(entry.hash);
			await reload();
		} catch (e: any) {
			await dialogService.alert(e.message, 'Error');
		}
	};

	return tpl.fragment({
		managerTableBody: {
			inner: () => {
				const list = entries.get();
				if (list.length === 0) {
					return tpl.managerNoRows({});
				}

				return list.map((entry) =>
					tpl.managerRow({
						nodes: {
							managerNameCell: { inner: entry.name || 'Unknown', title: entry.name || 'Unknown' },
							managerHashCell: { inner: entry.hash, title: entry.hash },
							managerSizeCell: { inner: entry.size ? fbytes(entry.size) : '-' },
							managerReasonCell: { inner: entry.reason || '-', title: entry.reason || '' },
							managerAddedCell: { inner: entry.added_at ? new Date(entry.added_at).toLocaleString() : '-' },
							managerRemoveBtn: { onclick: () => removeEntry(entry) },
						},
					})
				);
			},
		},
	});
});
