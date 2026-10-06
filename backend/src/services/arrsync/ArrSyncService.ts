import { container } from '../container/ServiceContainer';
import { AmuledService } from '../AmuledService';
import { MainDB, type Extension, type IndexerFeedRecord } from '../db/MainDB';
import { MediaSearchService, SEARCH_PROVIDER_IDS, type MediaSearchResult, type SearchProviderId } from '../mediaprovider';
import type { ArrSyncExtensionStatus, ArrSyncStatusResponse, WantedItem, WantedListResponse } from '../../types/IndexerFeedTypes';
import { LoggerFactory } from '../logging/Logger';
import type { ArrApiClient, ArrApp, SearchJob } from './ArrApiClient';
import { SonarrApiClient } from './SonarrApiClient';
import { RadarrApiClient } from './RadarrApiClient';

// ---------------------------------------------------------------------------
// Extension config
// ---------------------------------------------------------------------------

export const ARR_EXTENSION_TYPES: readonly ArrApp[] = ['sonarr', 'radarr'];

export function isArrExtensionType(type: string): type is ArrApp {
	return (ARR_EXTENSION_TYPES as readonly string[]).includes(type);
}

/** Stored as the extension's `config` JSON. The base URL lives in the extension's `url` column. */
export interface ArrExtensionConfig {
	/**
	 * Periodically sync the instance's wanted list (see ArrSyncService), which needs the extension URL and apiKey.
	 * Off, the extension only holds the search provider selection of its app (see arrSearchProvidersFor). Absent
	 * in configs saved before this existed: on.
	 */
	syncWanted: boolean;
	/** API key of the instance; may be empty while syncWanted is off. */
	apiKey: string;
	/** Minutes between two sync runs of this instance. */
	intervalMinutes: number;
	/**
	 * Search providers of this instance: the ones its wanted titles are periodically looked up on, and the ones
	 * the automatic searches of its app reach through the Torznab indexer (see arrSearchProvidersFor). E.g.
	 * without aMule when its results are too unreliable for unattended downloads. Empty: the wanted list is read
	 * but never searched, and the indexer answers the app's searches with nothing. Absent in configs saved before
	 * this existed: every provider.
	 */
	searchProviders?: SearchProviderId[];
}

export const ARR_SYNC_DEFAULT_INTERVAL_MINUTES = 60;
export const ARR_SYNC_MIN_INTERVAL_MINUTES = 15;

/**
 * Validates a config object as received from the API. Throws a message fit for the user on invalid input.
 */
export function validateArrConfig(config: Record<string, unknown>): ArrExtensionConfig {
	const syncWanted = config.syncWanted === undefined ? true : config.syncWanted === true;
	const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
	if (syncWanted && !apiKey) throw new Error('apiKey is required to sync the wanted list');
	let intervalMinutes = ARR_SYNC_DEFAULT_INTERVAL_MINUTES;
	if (config.intervalMinutes !== undefined && config.intervalMinutes !== null && config.intervalMinutes !== '') {
		const n = Number(config.intervalMinutes);
		if (!Number.isInteger(n) || n < ARR_SYNC_MIN_INTERVAL_MINUTES) {
			throw new Error(`intervalMinutes must be an integer of at least ${ARR_SYNC_MIN_INTERVAL_MINUTES}`);
		}
		intervalMinutes = n;
	}
	const normalized: ArrExtensionConfig = { syncWanted, apiKey, intervalMinutes };
	if (config.searchProviders !== undefined) {
		if (!Array.isArray(config.searchProviders) || !config.searchProviders.every(isSearchProviderId)) {
			throw new Error(`searchProviders must be an array of ${SEARCH_PROVIDER_IDS.join(', ')}`);
		}
		normalized.searchProviders = [...new Set(config.searchProviders)];
	}
	return normalized;
}

function isSearchProviderId(value: unknown): value is SearchProviderId {
	return typeof value === 'string' && (SEARCH_PROVIDER_IDS as readonly string[]).includes(value);
}

/** Whether the wanted titles of this config are searched anywhere (every provider when the list is absent). */
export function hasSearchProviders(config: ArrExtensionConfig): boolean {
	return config.searchProviders === undefined || config.searchProviders.length > 0;
}

/**
 * Whether the wanted list of this extension is synced: opted in (see ArrExtensionConfig.syncWanted) and with the
 * instance URL to read it; the API key is checked when the config is validated. Otherwise the extension only
 * selects the search providers of its app.
 */
export function syncsWanted(ext: Extension, config: ArrExtensionConfig): boolean {
	return config.syncWanted && !!ext.url?.trim();
}

/**
 * Search providers the automatic searches of an app (Sonarr or Radarr) reach through the Torznab indexer: the
 * union of the selections of its enabled, configured extensions, since the indexer tells the app from the
 * request (see IndexerController.selectedProvidersFor) but not the instance. Undefined, every provider, when the
 * app has no such extension or one of them predates the selection; empty when they all have none selected.
 */
export function arrSearchProvidersFor(extensions: readonly Extension[], app: ArrApp): SearchProviderId[] | undefined {
	const configs = extensions
		.filter((ext) => ext.enabled && ext.type === app)
		.map((ext) => parseArrConfig(ext.config))
		.filter((config): config is ArrExtensionConfig => config !== null);
	if (configs.length === 0 || configs.some((config) => config.searchProviders === undefined)) return undefined;
	return [...new Set(configs.flatMap((config) => config.searchProviders ?? []))];
}

/** Client for the given app; the extension's `url` is the instance base URL. */
export function createArrApiClient(app: ArrApp, url: string, apiKey: string): ArrApiClient {
	return app === 'sonarr' ? new SonarrApiClient(url, apiKey) : new RadarrApiClient(url, apiKey);
}

/** Parses a stored config; null when it is missing or unusable (e.g. the sync is on with no API key). */
export function parseArrConfig(config?: string | null): ArrExtensionConfig | null {
	try {
		return validateArrConfig(JSON.parse(config || '{}'));
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Sync service
// ---------------------------------------------------------------------------

/** How often due extensions are looked for. */
const TICK_MS = 60_000;
/** Delay before the first tick, so aMule has connected to a server by then. */
const FIRST_TICK_DELAY_MS = 30_000;
/**
 * Searches per extension per run. Each one is a global eD2k search that takes ~13 s and puts load on the
 * servers, so a big backlog is covered across runs, oldest-searched first, instead of all at once.
 */
const MAX_QUERIES_PER_RUN = 10;
/** Hits kept per query, best-sourced first, so a generic title does not flood the feed. */
const MAX_RESULTS_PER_QUERY = 50;
/** Feed items older than this are dropped, whatever filled them in; the *arr have had plenty of RSS syncs to see them. */
export const FEED_RETENTION_DAYS = 30;
/** A UI search this recent postpones the run: the user is watching results a new search would replace. */
const INTERACTIVE_SEARCH_GRACE_MS = 2 * 60_000;

/** Outcome of the last run of one extension. In memory only: a restart shows every extension as never run. */
interface ExtensionRunState {
	lastRunAt: number;
	lastDurationMs: number;
	wantedCount: number | null;
	searched: number | null;
	found: number | null;
	error: string | null;
}

/**
 * Feeds the Torznab RSS from what Sonarr/Radarr are waiting for. eD2k has no "recent releases" feed, so
 * for every enabled 'sonarr'/'radarr' extension this service periodically reads the instance's wanted
 * list (`/api/v3/wanted/missing`), searches the providers for those titles and stores the matching
 * releases in the indexer_feed table. The *arr then find them on their next RSS sync (a Torznab request
 * with no query, served by IndexerController) and grab them like any other indexer's release.
 */
export class ArrSyncService {
	private readonly logger = LoggerFactory.create(this);
	private readonly db = container.get(MainDB);
	private readonly searchService = container.get(MediaSearchService);
	private readonly amuledService = container.get(AmuledService);

	private tickId: NodeJS.Timeout | null = null;
	private firstTickId: NodeJS.Timeout | null = null;
	private startedAt: number | null = null;
	private running = false;
	private currentExtensionId: number | null = null;
	private postponedReason: string | null = null;
	/** Extensions with a manual run requested; due regardless of their interval. */
	private readonly forcedRuns = new Set<number>();
	private readonly runStateByExtension = new Map<number, ExtensionRunState>();
	private readonly lastSearchedByJob = new Map<string, number>();

	start(): void {
		this.logger.info('Starting *arr wanted sync...');
		this.startedAt = Date.now();
		this.firstTickId = setTimeout(() => void this.tick(), FIRST_TICK_DELAY_MS);
		this.tickId = setInterval(() => void this.tick(), TICK_MS);
	}

	stop(): void {
		if (this.firstTickId) clearTimeout(this.firstTickId);
		if (this.tickId) clearInterval(this.tickId);
		this.firstTickId = null;
		this.tickId = null;
	}

	// ---- Status & manual runs -------------------------------------------------

	getStatus(): ArrSyncStatusResponse {
		const now = Date.now();
		const extensions = this.db
			.getAllExtensions()
			.filter((ext) => isArrExtensionType(ext.type))
			.map((ext) => this.toExtensionStatus(ext, now));
		return { extensions, running: this.running, postponedReason: this.postponedReason };
	}

	private toExtensionStatus(ext: Extension, now: number): ArrSyncExtensionStatus {
		const config = parseArrConfig(ext.config);
		const state = this.runStateByExtension.get(ext.id);
		const syncWanted = !!config && syncsWanted(ext, config);
		let nextRunAt: number | null = null;
		if (ext.enabled && config && syncWanted && hasSearchProviders(config)) {
			if (this.forcedRuns.has(ext.id)) nextRunAt = now;
			else if (state) nextRunAt = state.lastRunAt + config.intervalMinutes * 60_000;
			else if (this.startedAt !== null) nextRunAt = Math.max(now, this.startedAt + FIRST_TICK_DELAY_MS);
		}
		return {
			extensionId: ext.id,
			name: ext.name,
			type: ext.type as ArrApp,
			enabled: !!ext.enabled,
			configured: !!config,
			syncWanted,
			intervalMinutes: config?.intervalMinutes ?? null,
			searchProviders: config?.searchProviders ?? null,
			running: this.currentExtensionId === ext.id,
			queued: this.forcedRuns.has(ext.id) && this.currentExtensionId !== ext.id,
			lastRunAt: state ? new Date(state.lastRunAt).toISOString() : null,
			nextRunAt: nextRunAt !== null ? new Date(nextRunAt).toISOString() : null,
			lastDurationMs: state?.lastDurationMs ?? null,
			wantedCount: state?.wantedCount ?? null,
			searched: state?.searched ?? null,
			found: state?.found ?? null,
			error: state?.error ?? null,
		};
	}

	/**
	 * Requests a run of one extension as soon as possible: right away when nothing is running, otherwise
	 * after the current run. Throws when the extension cannot be synced.
	 */
	runNow(extensionId: number): void {
		const ext = this.db.getExtensionById(extensionId);
		if (!ext || !isArrExtensionType(ext.type)) throw new Error('Extension is not a Sonarr/Radarr extension');
		if (!ext.enabled) throw new Error('Extension is disabled');
		const config = parseArrConfig(ext.config);
		if (!config) throw new Error('Extension has no valid configuration');
		if (!syncsWanted(ext, config)) throw new Error('The wanted sync is off for this extension');
		if (!hasSearchProviders(config)) throw new Error('Extension has no search providers selected');
		this.forcedRuns.add(extensionId);
		void this.tick();
	}

	/**
	 * Wanted titles of every enabled instance with the sync on, read live from Sonarr/Radarr, with what the sync
	 * knows about each: when it was last searched and how many of its releases sit in the feed. Instances
	 * that cannot be read are reported in `errors` instead of failing the whole list.
	 */
	async getWanted(): Promise<WantedListResponse> {
		const items: WantedItem[] = [];
		const errors: WantedListResponse['errors'] = [];
		const hitsByJob = this.db.countIndexerFeedByJobKey();
		for (const ext of this.db.getAllExtensions()) {
			if (!ext.enabled || !isArrExtensionType(ext.type)) continue;
			const config = parseArrConfig(ext.config);
			if (!config || !syncsWanted(ext, config)) continue;
			try {
				const jobs = await createArrApiClient(ext.type, ext.url, config.apiKey).getWantedSearchJobs();
				for (const job of jobs) {
					const key = this.jobKey(ext, job);
					const lastSearched = this.lastSearchedByJob.get(key);
					items.push({
						key,
						extensionId: ext.id,
						extensionName: ext.name,
						type: ext.type,
						mediaType: job.mediaType,
						title: job.title,
						pending: job.pending,
						query: job.query,
						imdbId: job.imdbId,
						lastSearchedAt: lastSearched ? new Date(lastSearched).toISOString() : null,
						feedHits: hitsByJob.get(key) ?? 0,
					});
				}
			} catch (error: any) {
				errors.push({ extensionId: ext.id, extensionName: ext.name, message: error?.message ?? String(error) });
			}
		}
		return { items, errors };
	}

	/** Key of a job across runs and feed rows. Prefixed with the extension id: two instances may report the same ids. */
	private jobKey(ext: Extension, job: SearchJob): string {
		return `${ext.id}:${job.key}`;
	}

	// ---- Scheduling -------------------------------------------------------------

	/**
	 * Enabled sonarr/radarr extensions with the sync on whose interval has elapsed since their last run, or with
	 * a run requested. One with no search providers selected is never due: there is nowhere to search.
	 */
	private getDueExtensions(now: number): Extension[] {
		return this.db.getAllExtensions().filter((ext) => {
			if (!ext.enabled || !isArrExtensionType(ext.type)) return false;
			const config = parseArrConfig(ext.config);
			if (!config) {
				this.logger.warn(`Extension "${ext.name}" (${ext.type}) has no valid configuration; skipping`);
				return false;
			}
			if (!syncsWanted(ext, config) || !hasSearchProviders(config)) return false;
			if (this.forcedRuns.has(ext.id)) return true;
			const lastRun = this.runStateByExtension.get(ext.id)?.lastRunAt ?? 0;
			return now - lastRun >= config.intervalMinutes * 60_000;
		});
	}

	private async tick(): Promise<void> {
		if (this.running) return;
		const due = this.getDueExtensions(Date.now());
		if (due.length === 0) return;

		// Postponed, not skipped: the extension stays due for the next tick
		if (this.amuledService.isRestarting) {
			this.postponedReason = 'aMule daemon is restarting';
			this.logger.debug(`${this.postponedReason}; postponing wanted sync`);
			return;
		}
		if (Date.now() - this.searchService.lastInteractiveSearchAt < INTERACTIVE_SEARCH_GRACE_MS) {
			this.postponedReason = 'A search from the web UI is in progress';
			this.logger.debug(`${this.postponedReason}; postponing wanted sync`);
			return;
		}

		this.running = true;
		this.postponedReason = null;
		try {
			for (const ext of due) await this.runExtension(ext);
			const pruned = this.db.pruneIndexerFeed(new Date(Date.now() - FEED_RETENTION_DAYS * 24 * 60 * 60_000));
			if (pruned > 0) this.logger.info(`Pruned ${pruned} feed item(s) older than ${FEED_RETENTION_DAYS} days`);
		} finally {
			this.running = false;
			this.currentExtensionId = null;
		}
	}

	/** Runs one extension's sync and records its outcome. Never throws: a broken instance is retried every interval. */
	private async runExtension(ext: Extension): Promise<void> {
		this.currentExtensionId = ext.id;
		this.forcedRuns.delete(ext.id);
		const startedAt = Date.now();
		const previous = this.runStateByExtension.get(ext.id);
		try {
			const outcome = await this.sync(ext);
			this.runStateByExtension.set(ext.id, { lastRunAt: Date.now(), lastDurationMs: Date.now() - startedAt, ...outcome, error: null });
		} catch (error: any) {
			const message = error?.message ?? String(error);
			this.logger.error(`Wanted sync failed for "${ext.name}" (${ext.type}):`, message);
			this.runStateByExtension.set(ext.id, {
				lastRunAt: Date.now(),
				lastDurationMs: Date.now() - startedAt,
				// Counts of the failed run are unknown; keep the last known ones next to the error
				wantedCount: previous?.wantedCount ?? null,
				searched: previous?.searched ?? null,
				found: previous?.found ?? null,
				error: message,
			});
		}
	}

	private async sync(ext: Extension): Promise<{ wantedCount: number; searched: number; found: number }> {
		const config = parseArrConfig(ext.config);
		if (!config || !isArrExtensionType(ext.type) || !syncsWanted(ext, config)) throw new Error('Extension is not configured for the wanted sync');

		const jobs = await createArrApiClient(ext.type, ext.url, config.apiKey).getWantedSearchJobs();
		// Never searched first, then least recently searched, so a backlog larger than one run is covered over time
		jobs.sort((a, b) => (this.lastSearchedByJob.get(this.jobKey(ext, a)) ?? 0) - (this.lastSearchedByJob.get(this.jobKey(ext, b)) ?? 0));
		const batch = jobs.slice(0, MAX_QUERIES_PER_RUN);
		const providersNote = config.searchProviders ? ` on ${config.searchProviders.join(', ')}` : '';
		this.logger.info(`[${ext.name}] ${jobs.length} wanted title(s); searching ${batch.length} this run${providersNote}`);

		let found = 0;
		let lastFailure: string | null = null;
		let failures = 0;
		for (const job of batch) {
			const jobKey = this.jobKey(ext, job);
			try {
				const results = await this.searchService.searchAndCollect({ query: job.query, imdbId: job.imdbId, providers: config.searchProviders });
				const hits = results
					.filter((r) => r.hash && job.matches(r))
					.sort((a, b) => (b.sourceCount ?? 0) - (a.sourceCount ?? 0))
					.slice(0, MAX_RESULTS_PER_QUERY);
				this.db.upsertIndexerFeedItems(hits.map((r) => this.toFeedItem(r, job, jobKey)));
				found += hits.length;
				this.logger.debug(`[${ext.name}] "${job.label}": ${hits.length} matching release(s) out of ${results.length}`);
			} catch (error: any) {
				// One title failing must not stop the rest of the batch
				failures++;
				lastFailure = error?.message ?? String(error);
				this.logger.warn(`[${ext.name}] "${job.label}": search failed: ${lastFailure}`);
			}
			// Counted as searched either way, so a title that keeps failing rotates to the back instead of blocking the backlog
			this.lastSearchedByJob.set(jobKey, Date.now());
		}
		// Every title failed: most likely a provider-wide problem, surfaced as the run's error
		if (failures > 0 && failures === batch.length) throw new Error(`All ${failures} searches failed; last error: ${lastFailure}`);
		const failuresNote = failures > 0 ? `, ${failures} search(es) failed` : '';
		this.logger.info(`[${ext.name}] Wanted sync done: ${found} release(s) added or refreshed in the feed${failuresNote}`);
		return { wantedCount: jobs.length, searched: batch.length, found };
	}

	private toFeedItem(r: MediaSearchResult, job: SearchJob, jobKey: string): Omit<IndexerFeedRecord, 'discovered_at'> {
		return {
			hash: r.hash,
			name: r.name,
			size: r.size,
			link: r.link ?? null,
			provider: r.provider,
			source_count: r.sourceCount ?? 0,
			media_type: job.mediaType,
			query: job.query,
			imdb_id: job.imdbId,
			job_key: jobKey,
			search_result: JSON.stringify(r),
		};
	}
}
