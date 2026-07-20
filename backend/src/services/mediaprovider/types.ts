import type { AmuleCategory } from 'amule-ec-client';

// ---------------------------------------------------------------------------
// Shared transfer / search types
// ---------------------------------------------------------------------------

export enum CHUNK_STATUS {
	UNAVAILABLE = 0,
	AVAILABLE = 1,
	COMPLETE = 2,
	DOWNLOADING = 3,
}

export interface ChunkInfo {
	chunkStates: CHUNK_STATUS[];
	chunkAvailability: number[];
	partCount: number;
	sizeFull: number;
}

export interface TransferSource {
	clientName?: string;
	ip?: string;
	port?: number;
	software?: string;
	softwareVersion?: string;
	downloadSpeed?: number;
	uploadSpeed?: number;
	availableParts?: number;
	remoteFilename?: string;
	sourceFrom?: number;
	remoteQueueRank?: number;
	waitingPosition?: number;
}

export interface TransferSourceNameCount {
	name: string;
	count: number;
}

export interface MediaTransfer {
	rawLine: string;
	name?: string;
	size?: number;
	completed?: number;
	speed?: number;
	isCompleted?: boolean;
	progress?: number;
	sourceCount?: number;
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
	/** Human-readable source label (e.g. Telegram chat name). Provider-agnostic. */
	sourceName?: string;
	/** Chunk information for the transfer. */
	chunkInfo?: ChunkInfo;
	/** Peers currently related to this transfer (download sources). */
	sources?: TransferSource[];
	/** Aggregated source names (client names grouped by count). */
	sourceNames?: TransferSourceNameCount[];
}

export interface MediaSearchResult {
	name: string;
	size: number;
	hash: string;
	link?: string;
	sourceCount?: number;
	completeSourceCount?: number;
	downloadStatus?: number;
	type?: string;
	provider: string;
	/** Human-readable source label (e.g. Telegram chat name). Provider-agnostic. */
	sourceName?: string;
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
