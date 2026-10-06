import type { IndexerFeedMediaType, ProviderFeedSource } from '../../types/IndexerFeedTypes';
import type { MediaSearchResult } from '../mediaprovider';
import { FEED_RETENTION_DAYS } from '../arrsync/ArrSyncService';

/**
 * Releases older than this are not published even when a provider reports them now (a re-enabled chat
 * delivering months of history, an old title whose links changed): the feed is about news, and the wanted
 * sync prunes the feed at this age anyway.
 */
export const FEED_RELEASE_MAX_AGE_MS = FEED_RETENTION_DAYS * 24 * 60 * 60_000;

/** A release a feed provider hands over: the result as a search would have returned it, plus its feed category. */
export interface FeedRelease {
	result: MediaSearchResult;
	mediaType: IndexerFeedMediaType;
}

export type FeedReleaseListener = (releases: FeedRelease[]) => void;

/**
 * A provider's own feed of new releases, published in the indexer feed by ProviderFeedService next to what
 * the *arr wanted sync finds. A provider is either polled on a timer (it implements `poll` together with
 * `getPollIntervalMinutes`) or pushes releases as it finds them (it implements `subscribe`). The service
 * owns everything else: scheduling, blacklist, insertion, per-source cap and status.
 */
export interface IFeedProvider {
	readonly source: ProviderFeedSource;

	/** Whether the provider exists for this install at all (e.g. a Hispashare extension was added); absent ones are left out of the status. */
	isPresent(): boolean;

	/** Switched on by the user. A disabled provider is neither polled nor listened to. */
	isEnabled(): boolean;

	/** Polled providers: minutes between two polls, from the user's settings. */
	getPollIntervalMinutes?(): number;

	/** Polled providers: the releases new since the previous poll. Rejects when the provider cannot be reached. */
	poll?(): Promise<FeedRelease[]>;

	/** Pushing providers: hands releases to the listener as they are found. */
	subscribe?(listener: FeedReleaseListener): void;
}

/** A provider polled on a timer, see IFeedProvider. */
export type PolledFeedProvider = IFeedProvider & Required<Pick<IFeedProvider, 'poll' | 'getPollIntervalMinutes'>>;

export function isPolledFeedProvider(provider: IFeedProvider): provider is PolledFeedProvider {
	return typeof provider.poll === 'function' && typeof provider.getPollIntervalMinutes === 'function';
}
