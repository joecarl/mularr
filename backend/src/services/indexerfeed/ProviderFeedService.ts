import { container } from '../container/ServiceContainer';
import { MainDB, type IndexerFeedRecord } from '../db/MainDB';
import type { ProviderFeedSource, ProviderFeedStatus, ProviderFeedStatusResponse } from '../../types/IndexerFeedTypes';
import { isPolledFeedProvider, type FeedRelease, type IFeedProvider, type PolledFeedProvider } from './types';
import { HispashareFeedProvider } from './adapters/HispashareFeedProvider';
import { TelegramFeedProvider } from './adapters/TelegramFeedProvider';
import { LoggerFactory } from '../logging/Logger';

/** What the feed rows of each source carry as job_key, see IndexerFeedItem.job_key. */
export const PROVIDER_FEED_JOB_KEYS: Record<ProviderFeedSource, string> = { hispashare: 'feed:hispashare', telegram: 'feed:telegram' };

/** How often a due poll is looked for. */
const TICK_MS = 60_000;
/** Delay before the first tick after start. */
const FIRST_TICK_DELAY_MS = 20_000;
/** Newest rows kept per source. The *arr RSS paging stops at what it already saw, so it never reads further back. */
export const PROVIDER_FEED_MAX_ITEMS = 1000;

/** Outcome of the last run of one source. In memory only: a restart shows every source as never run. */
interface SourceRunState {
	lastRunAt: number;
	added: number;
	error: string | null;
}

/**
 * Fills the indexer feed from the providers' own news, next to what the *arr wanted sync finds. Each feed
 * provider (see IFeedProvider) is either polled on its interval or pushes releases as it finds them; this
 * service schedules the polls, keeps blacklisted hashes out, inserts the rows with `feed:<source>` as
 * job_key (see PROVIDER_FEED_JOB_KEYS) when their hash is new to the feed, trims each source to its
 * PROVIDER_FEED_MAX_ITEMS newest rows and reports the state of every source. The wanted sync's age-based
 * pruning applies to these rows as well.
 */
export class ProviderFeedService {
	private readonly logger = LoggerFactory.create(this);
	private readonly db = container.get(MainDB);
	private readonly providers: IFeedProvider[] = [new HispashareFeedProvider(), new TelegramFeedProvider()];

	private tickId: NodeJS.Timeout | null = null;
	private firstTickId: NodeJS.Timeout | null = null;
	private startedAt: number | null = null;
	private readonly polling = new Set<ProviderFeedSource>();
	private readonly runStateBySource = new Map<ProviderFeedSource, SourceRunState>();

	constructor() {
		for (const provider of this.providers) provider.subscribe?.((releases) => this.onPushed(provider, releases));
	}

	start(): void {
		this.logger.info('Starting provider feeds...');
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

	// ---- Status -------------------------------------------------------------------

	getStatus(): ProviderFeedStatusResponse {
		const now = Date.now();
		return { sources: this.providers.filter((p) => p.isPresent()).map((p) => this.toStatus(p, now)) };
	}

	private toStatus(provider: IFeedProvider, now: number): ProviderFeedStatus {
		const enabled = provider.isEnabled();
		const polled = isPolledFeedProvider(provider);
		const state = this.runStateBySource.get(provider.source);
		const intervalMinutes = enabled && polled ? provider.getPollIntervalMinutes() : null;
		let nextRunAt: number | null = null;
		if (intervalMinutes !== null) {
			if (state) nextRunAt = state.lastRunAt + intervalMinutes * 60_000;
			else if (this.startedAt !== null) nextRunAt = Math.max(now, this.startedAt + FIRST_TICK_DELAY_MS);
		}
		return {
			source: provider.source,
			enabled,
			intervalMinutes,
			running: this.polling.has(provider.source),
			lastRunAt: state ? new Date(state.lastRunAt).toISOString() : null,
			nextRunAt: nextRunAt !== null ? new Date(nextRunAt).toISOString() : null,
			added: state?.added ?? null,
			inFeed: this.db.countIndexerFeed({ jobKey: PROVIDER_FEED_JOB_KEYS[provider.source] }),
			jobKey: PROVIDER_FEED_JOB_KEYS[provider.source],
			error: state?.error ?? null,
		};
	}

	// ---- Polled providers ---------------------------------------------------------

	private async tick(): Promise<void> {
		const now = Date.now();
		for (const provider of this.providers) {
			if (!isPolledFeedProvider(provider) || this.polling.has(provider.source) || !provider.isEnabled()) continue;
			const lastRun = this.runStateBySource.get(provider.source)?.lastRunAt ?? 0;
			if (now - lastRun >= provider.getPollIntervalMinutes() * 60_000) await this.runPoll(provider);
		}
	}

	/** Runs one poll and records its outcome. Never throws: a failing provider is retried after its interval. */
	private async runPoll(provider: PolledFeedProvider): Promise<void> {
		this.polling.add(provider.source);
		try {
			const added = this.publish(provider.source, await provider.poll());
			this.runStateBySource.set(provider.source, { lastRunAt: Date.now(), added, error: null });
		} catch (error: any) {
			const message = error?.message ?? String(error);
			this.logger.warn(`${provider.source} feed poll failed: ${message}`);
			// Counts as a run: the next attempt waits for the interval instead of hammering a failing API
			this.runStateBySource.set(provider.source, {
				lastRunAt: Date.now(),
				added: this.runStateBySource.get(provider.source)?.added ?? 0,
				error: message,
			});
		} finally {
			this.polling.delete(provider.source);
		}
	}

	// ---- Pushing providers --------------------------------------------------------

	private onPushed(provider: IFeedProvider, releases: FeedRelease[]): void {
		if (!provider.isEnabled()) return;
		try {
			const added = this.publish(provider.source, releases);
			this.runStateBySource.set(provider.source, { lastRunAt: Date.now(), added, error: null });
		} catch (error: any) {
			const message = error?.message ?? String(error);
			this.logger.error(`${provider.source} feed update failed:`, message);
			this.runStateBySource.set(provider.source, { lastRunAt: Date.now(), added: 0, error: message });
		}
	}

	// ---- Shared ------------------------------------------------------------------

	/** Adds the releases new to the feed (blacklisted ones left out) and trims the source to its cap. Returns how many were added. */
	private publish(source: ProviderFeedSource, releases: FeedRelease[]): number {
		const jobKey = PROVIDER_FEED_JOB_KEYS[source];
		const items = releases.filter((r) => !this.db.isBlacklisted(r.result.hash, r.result.size)).map((r) => this.toFeedItem(r, jobKey));
		const added = this.db.insertIndexerFeedItemsIfNew(items);
		const pruned = this.db.pruneIndexerFeedJobKey(jobKey, PROVIDER_FEED_MAX_ITEMS);
		this.logger.info(
			`${source} feed: ${added} of ${releases.length} release(s) added to the feed${pruned > 0 ? `, ${pruned} pruned beyond the newest ${PROVIDER_FEED_MAX_ITEMS}` : ''}`
		);
		return added;
	}

	private toFeedItem({ result: r, mediaType }: FeedRelease, jobKey: string): Omit<IndexerFeedRecord, 'discovered_at'> {
		return {
			hash: r.hash,
			name: r.name,
			size: r.size,
			link: r.link ?? null,
			provider: r.provider,
			source_count: r.sourceCount ?? 0,
			media_type: mediaType,
			query: null,
			imdb_id: r.imdbId ?? null,
			job_key: jobKey,
			search_result: JSON.stringify(r),
		};
	}
}
