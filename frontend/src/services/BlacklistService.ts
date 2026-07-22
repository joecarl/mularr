import { services } from './container/ServiceContainer';
import { BlacklistApiService } from './BlacklistApiService';
import { DialogService } from './DialogService';
import { BlacklistConfirmDialog } from '../components/BlacklistConfirmDialog';

export interface BlacklistCandidate {
	hash: string;
	name?: string;
	size?: number;
}

/**
 * Shared blacklisting flow: confirmation dialog (with an optional reason) plus
 * the API calls to add the entries. Callers layer their own follow-up on top
 * (transfers cancel the downloads, search refreshes the results).
 */
export class BlacklistService {
	private readonly blacklistApi = services.get(BlacklistApiService);
	private readonly dialogService = services.get(DialogService);

	/**
	 * @param consequences Sentence appended to the confirmation message describing what will happen.
	 * @returns `false` when the user cancelled or an API call failed.
	 */
	async blacklistWithConfirm(items: BlacklistCandidate[], consequences: string): Promise<boolean> {
		const targets = items.filter((i) => i.hash);
		if (targets.length === 0) return false;
		const single = targets.length === 1;
		const { confirmed, reason } = await this.confirm(targets, consequences, single ? 'Blacklist Hash' : 'Blacklist Hashes');
		if (!confirmed) return false;
		try {
			await Promise.all(targets.map((t) => this.blacklistApi.addToBlacklist(t.hash, t.name || '', reason, t.size)));
			return true;
		} catch (e: any) {
			await this.dialogService.alert(e.message, 'Error');
			return false;
		}
	}

	/** Blacklist-specific confirmation dialog with an optional reason field. */
	private confirm(files: BlacklistCandidate[], consequences: string, title: string): Promise<{ confirmed: boolean; reason: string }> {
		return new Promise((resolve) => {
			this.dialogService.open({
				title,
				width: '540px',
				render: (close) =>
					BlacklistConfirmDialog({
						files,
						consequences,
						onConfirm: (reason) => {
							close();
							resolve({ confirmed: true, reason });
						},
						onCancel: () => {
							close();
							resolve({ confirmed: false, reason: '' });
						},
					}),
			});
		});
	}
}
