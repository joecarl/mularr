import { signal, effect, WritableSignal } from 'chispa';
import { services } from './container/ServiceContainer';
import { MediaApiService, Transfer, Category } from './MediaApiService';
import { DialogService } from './DialogService';
import { BlacklistApiService } from './BlacklistApiService';
import { WsService } from './WsService';
import { smartLoad } from '../utils/scheduling';

function hashesToTransfers(hashes: string[], list: Transfer[]): Transfer[] {
	return hashes.flatMap((h) => {
		const t = list.find((x) => x.hash === h);
		return t ? [t] : [];
	});
}

/**
 * Singleton service that owns the reactive transfers + categories state and
 * exposes all user-facing actions with their confirmation dialogs.
 *
 * Both TransfersView (toolbar buttons) and TransferRows (context menu) delegate
 * to this service so all prompting logic lives in one place.
 */
export class TransfersContextService {
	readonly transfers: WritableSignal<Transfer[]> = signal([]);
	readonly categories: WritableSignal<Category[]> = signal([]);

	private readonly mediaApi = services.get(MediaApiService);
	private readonly dialogService = services.get(DialogService);
	private readonly blacklistApi = services.get(BlacklistApiService);

	constructor() {
		// Keep state in sync with WebSocket push updates
		const ws = services.get(WsService);
		effect(() => {
			const t = ws.transfers.get();
			if (t) {
				this.transfers.set(t.list || []);
				this.categories.set(t.categories || []);
			}
		});
	}

	/** REST refresh — call after any action for immediate feedback. */
	readonly reload = smartLoad(async () => {
		const data = await this.mediaApi.getTransfers();
		this.transfers.set(data.list || []);
		this.categories.set(data.categories || []);
	}, 'transfers');

	// ---------------------------------------------------------------------------
	// Commands
	// ---------------------------------------------------------------------------

	async executeCommand(hashes: string[], cmd: 'pause' | 'resume' | 'stop' | 'cancel'): Promise<boolean> {
		if (hashes.length === 0) return false;
		try {
			if (cmd === 'cancel') {
				const confirmed = await this.dialogService.confirm('Are you sure you want to cancel the selected downloads?', 'Cancel Download');
				if (!confirmed) return false;
			}
			await Promise.all(hashes.map((h) => this.mediaApi.sendDownloadCommand(h, cmd)));
			this.reload();
			return true;
		} catch (e: any) {
			await this.dialogService.alert(e.message, 'Error');
			return false;
		}
	}

	// ---------------------------------------------------------------------------
	// Category
	// ---------------------------------------------------------------------------

	/**
	 * Changes the category for the given hashes.
	 * If any completed transfer would be moved to a different directory,
	 * asks for confirmation first (same logic as the toolbar select).
	 *
	 * @returns `false` if the user cancelled, `true` on success.
	 */
	async changeCategory(hashes: string[], catId: number): Promise<boolean> {
		if (hashes.length === 0) return false;
		try {
			const allCats = this.categories.get();
			const allTransfers = this.transfers.get();

			let moveFiles = false;
			const destCat = allCats.find((c) => c.id === catId);
			const destPath = destCat?.resolvedPath ?? destCat?.path ?? '';
			if (destPath) {
				const completedThatMove = hashesToTransfers(hashes, allTransfers).filter((t) => {
					if (!t.isCompleted) return false;
					const srcCat = allCats.find((c) => c.name === (t.categoryName ?? ''));
					const srcPath = srcCat?.resolvedPath ?? srcCat?.path ?? '';
					return srcPath !== destPath;
				});
				if (completedThatMove.length > 0) {
					const confirmed = await this.dialogService.confirm(
						`Change category and move ${
							completedThatMove.length === 1 ? 'the completed file' : `${completedThatMove.length} completed files`
						} to the new directory?\n\nDestination: ${destPath}`,
						'Change Category'
					);
					if (!confirmed) return false;
					moveFiles = true;
				}
			}

			await Promise.all(hashes.map((h) => this.mediaApi.setFileCategory(h, catId, moveFiles)));
			this.reload();
			return true;
		} catch (e: any) {
			await this.dialogService.alert(e.message, 'Error');
			return false;
		}
	}

	// ---------------------------------------------------------------------------
	// Blacklist
	// ---------------------------------------------------------------------------

	async blacklistHash(hash: string, name: string): Promise<boolean> {
		const confirmed = await this.dialogService.confirm(
			`Mark this hash as bad content?\n\nHash: ${hash}\nName: ${name || 'Unknown'}\n\nThe download will be cancelled and the hash blocked from future downloads.`,
			'Blacklist Hash'
		);
		if (!confirmed) return false;
		try {
			await this.blacklistApi.addToBlacklist(hash, name, '');
			await this.mediaApi.sendDownloadCommand(hash, 'cancel');
			this.reload();
			return true;
		} catch (e: any) {
			await this.dialogService.alert(e.message, 'Error');
			return false;
		}
	}

	// ---------------------------------------------------------------------------
	// Clear completed
	// ---------------------------------------------------------------------------

	async clearCompleted(hashes?: string[]): Promise<boolean> {
		try {
			await this.mediaApi.clearCompletedTransfers(hashes);
			this.reload();
			return true;
		} catch (e: any) {
			await this.dialogService.alert(e.message, 'Error');
			return false;
		}
	}
}
