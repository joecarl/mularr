import { BaseApiService } from './BaseApiService';
import type { Transfer, Category, TransfersResponse, SearchResult, SearchResultsResponse, SearchStatusResponse, SuccessResponse } from './AmuleApiService';

// Re-export so consumers can import types from a single place
export type { Transfer, Category, TransfersResponse, SearchResult, SearchResultsResponse, SearchStatusResponse, SuccessResponse };

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

	async getTransfers(): Promise<TransfersResponse> {
		return this.request<TransfersResponse>('/transfers');
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

	async search(query: string, type: string): Promise<SuccessResponse> {
		return this.request<SuccessResponse>('/search', {
			method: 'POST',
			body: JSON.stringify({ query, type }),
		});
	}

	async getSearchResults(): Promise<SearchResultsResponse> {
		return this.request<SearchResultsResponse>('/search/results');
	}

	async getSearchStatus(): Promise<SearchStatusResponse> {
		return this.request<SearchStatusResponse>('/search/status');
	}

	// ---- Download --------------------------------------------------------------

	async addDownload(link: string): Promise<AddDownloadResponse> {
		return this.request<AddDownloadResponse>('/download', {
			method: 'POST',
			body: JSON.stringify({ link }),
		});
	}

	// ---- Categories (proxied from amule) --------------------------------------

	async getCategories(): Promise<Category[]> {
		return this.request<Category[]>('/categories');
	}
}
