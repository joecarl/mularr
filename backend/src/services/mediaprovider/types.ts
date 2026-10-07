import type { MediaTransfer, MediaSearchResult } from '../../types/MediaTypes';

// ---------------------------------------------------------------------------
// Shared transfer / search types
// ---------------------------------------------------------------------------

// The wire contract lives in src/types (the frontend imports it from there too) and is re-exported
// here so backend code keeps importing from this module.
export { CHUNK_STATUS, SEARCH_PROVIDER_IDS } from '../../types/MediaTypes';
export type {
	SearchProviderId,
	ChunkInfo,
	TransferSource,
	TransferSourceNameCount,
	MediaCategory,
	MediaTransfer,
	MediaTransfersResponse,
	MediaSearchResult,
	MediaSearchStartedResponse,
	MediaSearchResponse,
	MediaSearchStatusResponse,
} from '../../types/MediaTypes';

// ---------------------------------------------------------------------------
// IMediaProvider contract
// ---------------------------------------------------------------------------

/**
 * What a search is looking for. Every provider handles `query`; the identifiers are hints for providers
 * that can look a title up directly (a provider that ignores them just searches by text).
 */
export interface SearchCriteria {
	query: string;
	/** IMDb id of the wanted title ("tt0133093"), when the caller knows it (the *arr wanted sync does). */
	imdbId?: string | null;
	/**
	 * eD2k network scope chosen in the UI dropdown: 'Global' (default), 'Local' or 'Kad', matched
	 * case-insensitively by AmuleService. Only the aMule provider has a use for it.
	 */
	amuleSearchType?: string;
	/**
	 * Set by MediaSearchService: true when a user is waiting for the results (web UI), false for background
	 * searches (Torznab, *arr wanted sync). Rate-limited providers use it to keep quota for the former.
	 */
	interactive?: boolean;
	/**
	 * Ids of the providers to search (see SEARCH_PROVIDER_IDS); every provider when absent. Honoured by
	 * MediaSearchService, which leaves the others out of the search and of the collected results. The *arr
	 * wanted sync sets it from the extension's config, e.g. to keep an unreliable network out of the feed.
	 */
	providers?: readonly string[];
}

/**
 * One search as a provider runs it: its own result buffer, independent of any other search on the same
 * provider, so several clients searching at once each read their own results. Handed out by
 * IMediaProvider.startSearch and kept by MediaSearchService for as long as the search is retrievable.
 */
export interface ProviderSearch {
	/** Results gathered so far; the full set once done. */
	getResults(): Promise<MediaSearchResult[]>;
	/** 0 = not started / in progress, 1 = complete. */
	getProgress(): Promise<number>;
	/** True while the provider has not started it yet because it is busy with an earlier search (see AmuleMediaProvider). */
	readonly queued: boolean;
}

export interface IMediaProvider {
	readonly providerId: string;

	/**
	 * Whether searches reach this provider right now (its service is configured and switched on). Listed to
	 * the UI as the providers one can pick; an unavailable provider answers searches with no results.
	 */
	isAvailable(): boolean;

	/** Return true if this provider should handle the given link/hash. */
	canHandleDownload(link: string): boolean;

	/** Starts a search and returns right away with the handle its results are read from while it runs in the background. */
	startSearch(criteria: SearchCriteria): Promise<ProviderSearch>;

	/**
	 * True for catalogue providers that answer SearchCriteria.imdbId on its own, with no text query. The
	 * Torznab indexer advertises IMDb id searches while one of them is available and sends those searches
	 * to them alone (see MediaSearchService.imdbIdSearchProviderIds).
	 */
	readonly searchesByImdbId?: boolean;

	addDownload(link: string): Promise<void>;
	removeDownload(hash: string): Promise<void>;
	pauseDownload(hash: string): Promise<void>;
	resumeDownload(hash: string): Promise<void>;
	stopDownload(hash: string): Promise<void>;

	getTransfers(): Promise<MediaTransfer[]>;

	/** Clear completed transfers tracked by this provider. */
	clearCompletedTransfers(hashes?: string[]): Promise<void>;
}
