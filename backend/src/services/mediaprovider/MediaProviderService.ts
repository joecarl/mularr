import type { AmuleCategory } from 'amule-ec-client';
import { container } from '../container/ServiceContainer';
import { AmuleService } from '../AmuleService';
import { AmuleMediaProvider } from './adapters/AmuleMediaProvider';
import { TelegramMediaProvider } from './adapters/TelegramMediaProvider';
import type { IMediaProvider, MediaTransfer, MediaSearchResult, MediaTransfersResponse, MediaSearchResponse, MediaSearchStatusResponse } from './types';

export class MediaProviderService {
	private providers: IMediaProvider[] = [];

	constructor() {
		// Order matters: first matching provider wins for canHandleDownload
		this.providers.push(new TelegramMediaProvider());
		this.providers.push(new AmuleMediaProvider());
	}

	// ---- Search ----------------------------------------------------------------

	async startSearch(query: string, _type?: string): Promise<void> {
		await Promise.allSettled(this.providers.map((p) => p.startSearch(query)));
	}

	async getSearchResults(): Promise<MediaSearchResponse> {
		const perProvider = await Promise.allSettled(this.providers.map((p) => p.getSearchResults()));
		const combined: MediaSearchResult[] = [];
		for (const r of perProvider) {
			if (r.status === 'fulfilled') combined.push(...r.value);
		}
		return { raw: `Found ${combined.length} results`, list: combined };
	}

	async getSearchStatus(): Promise<MediaSearchStatusResponse> {
		// Overall progress = minimum across providers (all must finish before we report 1.0)
		const statuses = await Promise.allSettled(this.providers.map((p) => p.getSearchStatus()));
		let min = 1;
		for (const s of statuses) {
			if (s.status === 'fulfilled') min = Math.min(min, s.value);
		}
		return { raw: `Search progress: ${(min * 100).toFixed(0)}%`, progress: min };
	}

	// ---- Transfers -------------------------------------------------------------

	async getTransfers(): Promise<MediaTransfersResponse> {
		const perProvider = await Promise.allSettled(this.providers.map((p) => p.getTransfers()));
		const combined: MediaTransfer[] = [];
		for (const r of perProvider) {
			if (r.status === 'fulfilled') combined.push(...r.value);
		}

		let categories: AmuleCategory[] = [];
		try {
			categories = await container.get(AmuleService).getCategories();
		} catch (_e) {}

		return { raw: `Downloads (${combined.length})`, list: combined, categories };
	}

	async clearCompletedTransfers(hashes?: string[]): Promise<void> {
		await Promise.allSettled(this.providers.map((p) => p.clearCompletedTransfers(hashes)));
	}

	// ---- Download management ---------------------------------------------------

	async addDownload(link: string): Promise<void> {
		const provider = this.providers.find((p) => p.canHandleDownload(link));
		if (!provider) throw new Error(`No provider can handle link: ${link}`);
		await provider.addDownload(link);
	}

	async sendDownloadCommand(hash: string, command: 'pause' | 'resume' | 'stop' | 'cancel'): Promise<void> {
		const provider = this.providers.find((p) => p.canHandleDownload(hash)) ?? this.providers[this.providers.length - 1];
		switch (command) {
			case 'pause':
				await provider.pauseDownload(hash);
				break;
			case 'resume':
				await provider.resumeDownload(hash);
				break;
			case 'stop':
				await provider.stopDownload(hash);
				break;
			case 'cancel':
				await provider.removeDownload(hash);
				break;
			default:
				throw new Error(`Unknown command: ${command}`);
		}
	}

	// ---- Categories (amule-specific, proxied) ----------------------------------

	async getCategories(): Promise<AmuleCategory[]> {
		return container.get(AmuleService).getCategories();
	}

	async setFileCategory(hashHex: string, categoryId: number): Promise<void> {
		await container.get(AmuleService).setFileCategory(hashHex, categoryId);
	}
}
