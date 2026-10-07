import { BaseApiService } from './BaseApiService';
import type { SuccessResponse } from './AmuleApiService';
import type {
	MediaCategory,
	MediaTransfer,
	MediaTransfersResponse,
	MediaSearchResult,
	MediaSearchStartedResponse,
	MediaSearchResponse,
	MediaSearchStatusResponse,
	SearchProviderId,
} from './apiTypes';

export type {
	MediaCategory,
	SuccessResponse,
	MediaTransfer,
	MediaTransfersResponse,
	MediaSearchResult,
	MediaSearchStartedResponse,
	MediaSearchResponse,
	MediaSearchStatusResponse,
};
export type { ChunkStatus, ChunkInfo, TransferSource, TransferSourceNameCount } from './apiTypes';
export { CHUNK_STATUS } from './apiTypes';

export interface AddDownloadResponse extends SuccessResponse {
	/** Set when the link matches an already-tracked download (same hash & size, the name may differ). */
	duplicate?: {
		hash: string;
		name: string;
		size: number;
		isCompleted: boolean;
	};
}

/**
 * MediaApiService
 *
 * Frontend counterpart of the backend MediaProviderService.
 * Handles search and download management across all media providers
 * (aMule, Telegram, …) through the unified /api/media endpoint.
 */
export class MediaApiService extends BaseApiService {
	constructor() {
		super('/api/media');
	}

	// ---- Transfers -------------------------------------------------------------

	async getTransfers(): Promise<MediaTransfersResponse> {
		return this.request<MediaTransfersResponse>('/transfers');
	}

	async clearCompletedTransfers(hashes?: string[]): Promise<SuccessResponse> {
		return this.request<SuccessResponse>('/transfers/clear-completed', {
			method: 'POST',
			body: JSON.stringify({ hashes }),
		});
	}

	async sendDownloadCommand(hash: string, command: 'pause' | 'resume' | 'stop' | 'cancel'): Promise<SuccessResponse> {
		return this.request<SuccessResponse>('/download/command', {
			method: 'POST',
			body: JSON.stringify({ hash, command }),
		});
	}

	async setFileCategory(hash: string, categoryId: number, moveFiles = false): Promise<SuccessResponse> {
		return this.request<SuccessResponse>('/download/set-category', {
			method: 'POST',
			body: JSON.stringify({ hash, categoryId, moveFiles }),
		});
	}

	// ---- Search ----------------------------------------------------------------

	/** Providers a search reaches right now: aMule always, the others while their service is switched on. */
	async getSearchProviders(): Promise<SearchProviderId[]> {
		return this.request<SearchProviderId[]>('/search-providers');
	}

	/** Starts a search; its results and status are polled with the returned id. */
	async search(query: string, type: string): Promise<MediaSearchStartedResponse> {
		return this.request<MediaSearchStartedResponse>('/search', {
			method: 'POST',
			body: JSON.stringify({ query, type }),
		});
	}

	/** 404 once the backend no longer keeps the search (it keeps the last few, and none across a restart). */
	async getSearchResults(searchId: string): Promise<MediaSearchResponse> {
		return this.request<MediaSearchResponse>(`/search/results?id=${encodeURIComponent(searchId)}`);
	}

	async getSearchStatus(searchId: string): Promise<MediaSearchStatusResponse> {
		return this.request<MediaSearchStatusResponse>(`/search/status?id=${encodeURIComponent(searchId)}`);
	}

	// ---- Download --------------------------------------------------------------

	async addDownload(link: string): Promise<AddDownloadResponse> {
		return this.request<AddDownloadResponse>('/download', {
			method: 'POST',
			body: JSON.stringify({ link }),
		});
	}

	// ---- Categories (proxied from amule) --------------------------------------

	async getCategories(): Promise<MediaCategory[]> {
		return this.request<MediaCategory[]>('/categories');
	}
}
