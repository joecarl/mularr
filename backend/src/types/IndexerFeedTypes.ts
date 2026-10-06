// Wire contract of the indexer feed and the *arr wanted sync, shared with the frontend through
// frontend/src/services/apiTypes.ts. Keep this module free of imports (see the note there).

/** Torznab top-level category a feed item was discovered for ('tv' → 5000, 'movie' → 2000). */
export type IndexerFeedMediaType = 'tv' | 'movie';

/**
 * A release discovered by the *arr wanted sync or taken from a provider's own feed of new releases. Served by
 * the Torznab endpoint on RSS requests, which is how Sonarr/Radarr pick up new releases without searching.
 * Column names as stored in the indexer_feed table.
 */
export interface IndexerFeedItem {
	hash: string;
	name: string;
	size: number;
	/** Provider link (ed2k link for aMule, telegram:… for Telegram); null when the hash alone identifies the file. */
	link: string | null;
	provider: string;
	source_count: number;
	media_type: IndexerFeedMediaType;
	/** Search query that produced the hit, for debugging; null for releases taken from a provider feed. */
	query: string | null;
	/** IMDb id of the title the release belongs to ("tt0133093"); null when neither the *arr nor the provider reported one. */
	imdb_id: string | null;
	/**
	 * Wanted title the hit was found for (see WantedItem.key), or `feed:<source>` for a release taken from that
	 * provider's feed (see ProviderFeedStatus.jobKey); null for rows written before this existed.
	 */
	job_key: string | null;
	/**
	 * JSON snapshot of the MediaSearchResult the release was discovered as. Attached to the download when the
	 * *arr grabs the item from the RSS feed, long after the search left the in-memory history.
	 */
	search_result: string | null;
	/** ISO timestamp of the first discovery. Kept on re-discovery: the *arr RSS paging stops at items older than its last sync. */
	discovered_at: string;
}

export interface IndexerFeedListResponse {
	items: IndexerFeedItem[];
	/** Size of the whole result set for the applied filters, not of this page. */
	total: number;
	offset: number;
	limit: number;
}

/** Sync state of one Sonarr/Radarr extension, kept in memory by ArrSyncService (reset on restart). */
export interface ArrSyncExtensionStatus {
	extensionId: number;
	name: string;
	type: 'sonarr' | 'radarr';
	enabled: boolean;
	/** False when the stored config is not usable (e.g. sync on with no API key); such an extension is never synced. */
	configured: boolean;
	/** The wanted list of this instance is synced (opted in, with URL and API key); false: the extension only selects search providers. */
	syncWanted: boolean;
	intervalMinutes: number | null;
	/** Ids of the search providers this extension's titles are looked up on; empty when it is never searched, null when it searches all of them. */
	searchProviders: string[] | null;
	/** A run for this extension is in progress. */
	running: boolean;
	/** A manual run was requested and waits for the current run to finish. */
	queued: boolean;
	lastRunAt: string | null;
	/** When the scheduler will consider this extension due again; null when it will not run (disabled or unconfigured). */
	nextRunAt: string | null;
	lastDurationMs: number | null;
	/** Titles in the instance's wanted list at the last run. */
	wantedCount: number | null;
	/** Titles searched at the last run (capped per run). */
	searched: number | null;
	/** Releases added or refreshed in the feed at the last run. */
	found: number | null;
	/** Message of the failure that ended the last run, null when it succeeded. */
	error: string | null;
}

/** One wanted title of a Sonarr/Radarr instance, as the sync sees it, with what the sync did about it so far. */
export interface WantedItem {
	/** Identifies the title across runs; feed rows carry it as job_key. */
	key: string;
	extensionId: number;
	extensionName: string;
	type: 'sonarr' | 'radarr';
	mediaType: IndexerFeedMediaType;
	/** Series or movie title as the *arr reports it. */
	title: string;
	/** Pending units: episode numbers ("S01E05") for a series, the year for a movie. */
	pending: string[];
	/** Search query the sync runs for it. */
	query: string;
	imdbId: string | null;
	/** ISO timestamp of the last search for this title; null when it has not been searched since Mularr started. */
	lastSearchedAt: string | null;
	/** Releases currently in the feed found for this title. */
	feedHits: number;
}

export interface WantedListResponse {
	items: WantedItem[];
	/** Instances that could not be read, with the reason. Their titles are missing from `items`. */
	errors: { extensionId: number; extensionName: string; message: string }[];
}

export interface ArrSyncStatusResponse {
	extensions: ArrSyncExtensionStatus[];
	/** Any run in progress. */
	running: boolean;
	/** Why the last due run was postponed (aMule restarting, a UI search in progress), null otherwise. */
	postponedReason: string | null;
}

/**
 * Providers whose own new releases feed the indexer, next to the wanted sync: Hispashare is polled for its
 * most recently updated titles, Telegram publishes the video files its indexer finds in chats indexed before.
 */
export type ProviderFeedSource = 'hispashare' | 'telegram';

/** State of one provider feed, kept in memory by ProviderFeedService (reset on restart). */
export interface ProviderFeedStatus {
	source: ProviderFeedSource;
	/** Switched on: the Hispashare extension is enabled with its feed option, or the Telegram feed toggle is on. */
	enabled: boolean;
	/** Minutes between two polls; null for Telegram, which publishes files as its indexer finds them. */
	intervalMinutes: number | null;
	/** A poll is in progress (Hispashare only). */
	running: boolean;
	/** Last poll (Hispashare), or last indexing pass that published files (Telegram). */
	lastRunAt: string | null;
	/** When the next poll is due; null when it will not run, and always for Telegram. */
	nextRunAt: string | null;
	/** Releases added to the feed by the last run. */
	added: number | null;
	/** Releases from this source currently in the feed. */
	inFeed: number;
	/** Value the feed rows of this source carry as job_key; filters the feed listing to them. */
	jobKey: string;
	/** Message of the failure that ended the last run, null when it succeeded. */
	error: string | null;
}

export interface ProviderFeedStatusResponse {
	sources: ProviderFeedStatus[];
}
