import { container } from '../../container/ServiceContainer';
import { AmuleService } from '../../AmuleService';
import type { IMediaProvider, MediaSearchResult, MediaTransfer } from '../types';

export class AmuleMediaProvider implements IMediaProvider {
	readonly providerId = 'amule';

	canHandleDownload(link: string): boolean {
		return !link.startsWith('telegram:');
	}

	async startSearch(query: string): Promise<void> {
		await container.get(AmuleService).startSearch(query);
	}

	async getSearchResults(): Promise<MediaSearchResult[]> {
		try {
			const result = await container.get(AmuleService).getSearchResults();
			return (result.list || []).map((f: any) => ({
				name: f.name,
				size: f.size,
				hash: f.hash,
				sources: f.sources,
				completeSources: f.completeSources,
				downloadStatus: f.downloadStatus,
				type: f.type || '',
				provider: 'amule',
			}));
		} catch (e) {
			console.error('[AmuleMediaProvider] getSearchResults error:', e);
			return [];
		}
	}

	async getSearchStatus(): Promise<number> {
		try {
			const status = await container.get(AmuleService).getSearchStatus();
			return status.progress ?? 0;
		} catch (e) {
			return 0;
		}
	}

	async addDownload(link: string): Promise<void> {
		await container.get(AmuleService).addDownload(link);
	}

	async removeDownload(hash: string): Promise<void> {
		await container.get(AmuleService).removeDownload(hash);
	}

	async pauseDownload(hash: string): Promise<void> {
		await container.get(AmuleService).pauseDownload(hash);
	}

	async resumeDownload(hash: string): Promise<void> {
		await container.get(AmuleService).resumeDownload(hash);
	}

	async stopDownload(hash: string): Promise<void> {
		await container.get(AmuleService).stopDownload(hash);
	}

	async getTransfers(): Promise<MediaTransfer[]> {
		try {
			const result = await container.get(AmuleService).getTransfers();
			return result.list.map((d) => ({ ...d, provider: 'amule' })) as MediaTransfer[];
		} catch (e) {
			console.error('[AmuleMediaProvider] getTransfers error:', e);
			return [];
		}
	}

	async clearCompletedTransfers(hashes?: string[]): Promise<void> {
		if (!hashes) {
			await container.get(AmuleService).clearCompletedTransfers();
		} else {
			const amuleHashes = hashes.filter((h) => !h.startsWith('telegram:'));
			if (amuleHashes.length > 0) {
				await container.get(AmuleService).clearCompletedTransfers(amuleHashes);
			}
		}
	}
}
