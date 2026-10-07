import { container } from '../../container/ServiceContainer';
import type { HispashareTitle } from '../../hispashare/HispashareApiClient';
import { HISPASHARE_FEED_DEFAULT_INTERVAL_MINUTES, HispashareService } from '../../hispashare/HispashareService';
import { hispashareSearchResults } from '../../mediaprovider/adapters/HispashareMediaProvider';
import { guessMediaType } from '../../../tools/releaseNameTools';
import type { IndexerFeedMediaType } from '../../../types/IndexerFeedTypes';
import { FEED_RELEASE_MAX_AGE_MS, type FeedRelease, type IFeedProvider } from '../types';
import { LoggerFactory } from '../../logging/Logger';

/**
 * Pages (of 20 titles) read per poll at most. Bounds the quota a poll can spend when many titles changed
 * since the last one (the first poll, a long downtime): the feed is about recent releases, not a complete
 * catalogue, and the age limit cuts it off anyway.
 */
const MAX_PAGES_PER_POLL = 5;

/**
 * Polls the Hispashare catalogue for its most recently updated titles and hands over the recent releases
 * they carry. Present once a Hispashare extension exists; enabled by the extension's feed option.
 */
export class HispashareFeedProvider implements IFeedProvider {
	private readonly logger = LoggerFactory.create(this);
	readonly source = 'hispashare' as const;
	private readonly hispashare = container.get(HispashareService);
	/** `updated_at` of the newest title seen by a poll; the next poll stops at titles not updated since. */
	private newestUpdatedAt: number | null = null;

	isPresent(): boolean {
		return this.hispashare.hasExtension();
	}

	isEnabled(): boolean {
		return this.hispashare.getActive()?.config.feedEnabled === true;
	}

	getPollIntervalMinutes(): number {
		return this.hispashare.getActive()?.config.feedIntervalMinutes ?? HISPASHARE_FEED_DEFAULT_INTERVAL_MINUTES;
	}

	/**
	 * Walks the catalogue newest-updated first until a title not updated since the previous poll (or the
	 * page cap) and returns the recent releases of the titles passed.
	 */
	async poll(): Promise<FeedRelease[]> {
		const active = this.hispashare.getActive();
		if (!active) throw new Error('Hispashare is not configured');
		const releaseFloor = Date.now() - FEED_RELEASE_MAX_AGE_MS;
		const since = this.newestUpdatedAt ?? releaseFloor;
		let newest = since;
		const titles: HispashareTitle[] = [];
		let cursor: string | undefined;
		let pages = 0;
		while (pages < MAX_PAGES_PER_POLL) {
			const page = await active.client.listRecentTitles(cursor);
			pages++;
			let reachedSeen = false;
			for (const title of page.titles) {
				const updatedAt = Date.parse(title.updated_at);
				if (!(updatedAt > since)) {
					reachedSeen = true;
					break;
				}
				if (updatedAt > newest) newest = updatedAt;
				titles.push(title);
			}
			if (reachedSeen || !page.hasMore || !page.nextCursor) break;
			cursor = page.nextCursor;
		}

		const releases: FeedRelease[] = [];
		for (const title of titles) {
			// Music has no feed (the *arr behind it is Lidarr, which searches instead); a title whose type the
			// catalogue does not know is classified by its release names
			if (title.type === 'music') continue;
			const mediaType: IndexerFeedMediaType | null = title.type === 'series' ? 'tv' : title.type === 'movie' ? 'movie' : null;
			// A title is "updated" when a link changes; only its releases that became available recently are news
			const recent = (title.releases ?? []).filter((r) => Date.parse(r.date) >= releaseFloor);
			if (recent.length === 0) continue;
			for (const result of hispashareSearchResults([{ ...title, releases: recent }])) {
				releases.push({ result, mediaType: mediaType ?? guessMediaType(result.name) });
			}
		}
		this.newestUpdatedAt = newest;
		this.logger.info(`${pages} page(s) read, ${titles.length} updated title(s), ${releases.length} recent file(s)`);
		return releases;
	}
}
