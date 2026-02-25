import type { AmuleCategory } from 'amule-ec-client';

// ---------------------------------------------------------------------------
// Shared transfer / search types
// ---------------------------------------------------------------------------

export interface MediaTransfer {
	rawLine: string;
	name?: string;
	size?: number;
	completed?: number;
	speed?: number;
	isCompleted?: boolean;
	progress?: number;
	sources?: number;
	priority?: number;
	status?: string;
	statusId?: number;
	stopped?: boolean;
	remaining?: number;
	hash?: string;
	link?: string;
	timeLeft?: number;
	categoryName?: string | null;
	addedOn?: string | null;
	provider?: string;
	/** Resolved absolute path to the file on disk. Populated by MediaProviderService. */
	filePath?: string;
}

export interface MediaSearchResult {
	name: string;
	size: number;
	hash: string;
	sources?: number;
	completeSources?: number;
	downloadStatus?: number;
	type?: string;
	provider: string;
}

export interface MediaTransfersResponse {
	raw: string;
	list: MediaTransfer[];
	categories: AmuleCategory[];
}

export interface MediaSearchResponse {
	raw: string;
	list: MediaSearchResult[];
}

export interface MediaSearchStatusResponse {
	raw: string;
	progress: number; // 0–1
}

// ---------------------------------------------------------------------------
// IMediaProvider contract
// ---------------------------------------------------------------------------

export interface IMediaProvider {
	readonly providerId: string;

	/** Return true if this provider should handle the given link/hash. */
	canHandleDownload(link: string): boolean;

	/** Fire-and-forget search initiation. */
	startSearch(query: string): Promise<void>;

	/** Return cached/latest search results for this provider. */
	getSearchResults(): Promise<MediaSearchResult[]>;

	/** 0 = not started / in-progress, 1 = complete. */
	getSearchStatus(): Promise<number>;

	addDownload(link: string): Promise<void>;
	removeDownload(hash: string): Promise<void>;
	pauseDownload(hash: string): Promise<void>;
	resumeDownload(hash: string): Promise<void>;
	stopDownload(hash: string): Promise<void>;

	getTransfers(): Promise<MediaTransfer[]>;

	/** Clear completed transfers tracked by this provider. */
	clearCompletedTransfers(hashes?: string[]): Promise<void>;
}
