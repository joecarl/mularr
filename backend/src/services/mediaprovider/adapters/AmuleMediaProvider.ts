import { container } from '../../container/ServiceContainer';
import { AmuleService } from '../../AmuleService';
import type { IMediaProvider, MediaSearchResult, MediaTransfer, ProviderSearch, SearchCriteria } from '../types';
import { LoggerFactory } from '../../logging/Logger';
import { sleep } from '../../../tools/asyncTools';

/** How often the active search copies the daemon's result list into its buffer. */
const POLL_MS = 1500;
/** The daemon's list is settled once it reports done and the count held still this many polls. */
const SETTLED_POLLS = 3;
/**
 * Longest an active search keeps the daemon while another one waits. A global eD2k search trickles results
 * for a long time; this caps what the waiting one (another user, the *arr) has to sit through.
 */
const MAX_HOLD_MS = 15_000;
/** An active search nobody is waiting behind stops polling the daemon after this; results past it are not worth the EC traffic. */
const MAX_ACTIVE_MS = 90_000;

/**
 * A search on the daemon: queued until the daemon is free, then active (polling its results into the
 * buffer) and finally frozen with what it gathered. Only ever handled by the provider's queue.
 */
class AmuleSearch implements ProviderSearch {
	results: MediaSearchResult[] = [];
	progress = 0;
	state: 'queued' | 'active' | 'frozen' = 'queued';

	constructor(readonly criteria: SearchCriteria) {}

	get queued(): boolean {
		return this.state === 'queued';
	}

	async getResults(): Promise<MediaSearchResult[]> {
		return this.results;
	}

	/** Daemon progress while active; a frozen search reports 1 whatever the daemon said last. */
	async getProgress(): Promise<number> {
		return this.state === 'frozen' ? 1 : this.progress;
	}
}

/**
 * The daemon runs one search at a time and starting another replaces it (the EC protocol has no search id:
 * results and progress are "the current search's"), so searches queue here. The active one copies the
 * daemon's results into its own buffer until it settles, or has held the daemon MAX_HOLD_MS with another
 * search waiting; then it freezes, keeping what it has, and the next one starts. Clients hold their own
 * search's buffer, so nobody ever reads another search's results.
 */
export class AmuleMediaProvider implements IMediaProvider {
	private readonly logger = LoggerFactory.create(this);
	readonly providerId = 'amule';
	private readonly amuleService = container.get(AmuleService);
	/** Tail of the search queue; every search chains on it. */
	private queue: Promise<void> = Promise.resolve();
	/** Searches chained but not started: the active one yields to them. */
	private waiting = 0;

	/** aMule is what Mularr runs on, so it always takes part. */
	isAvailable(): boolean {
		return true;
	}

	canHandleDownload(link: string): boolean {
		return !link.startsWith('telegram:');
	}

	/** eD2k searches by keywords only; the identifiers in the criteria are ignored. Returns at once; the search starts when the daemon is free. */
	async startSearch(criteria: SearchCriteria): Promise<ProviderSearch> {
		const search = new AmuleSearch(criteria);
		this.waiting++;
		this.queue = this.queue.then(() => this.run(search)).catch(() => {});
		return search;
	}

	private async run(search: AmuleSearch): Promise<void> {
		this.waiting--;
		search.state = 'active';
		try {
			await this.amuleService.startSearch(search.criteria.query, search.criteria.amuleSearchType);
			const startedAt = Date.now();
			let stablePolls = 0;
			while (true) {
				await sleep(POLL_MS);
				const before = search.results.length;
				// The daemon's list only grows during a search; a shorter one is a failed read (see readResults)
				const list = await this.readResults();
				if (list.length >= before) search.results = list;
				search.progress = await this.readProgress();
				stablePolls = search.results.length === before ? stablePolls + 1 : 0;
				const settled = search.progress >= 1 && stablePolls >= SETTLED_POLLS;
				const held = Date.now() - startedAt;
				if (this.waiting > 0 && (settled || held >= MAX_HOLD_MS)) break;
				if (held >= MAX_ACTIVE_MS) break;
			}
		} catch (e) {
			this.logger.error('Search failed:', e);
		} finally {
			search.state = 'frozen';
		}
	}

	private async readResults(): Promise<MediaSearchResult[]> {
		try {
			const result = await this.amuleService.getSearchResults();
			return (result.list || []).map((f: any) => ({
				name: f.name,
				size: f.size,
				hash: f.hash,
				link: f.link,
				sourceCount: f.sourceCount,
				completeSourceCount: f.completeSourceCount,
				downloadStatus: f.downloadStatus,
				type: f.type || '',
				provider: 'amule',
			}));
		} catch (e) {
			this.logger.error('getSearchResults error:', e);
			return [];
		}
	}

	private async readProgress(): Promise<number> {
		try {
			const status = await this.amuleService.getSearchStatus();
			return status.progress ?? 0;
		} catch (e) {
			return 0;
		}
	}

	async addDownload(link: string): Promise<void> {
		await this.amuleService.addDownload(link);
	}

	async removeDownload(hash: string): Promise<void> {
		await this.amuleService.removeDownload(hash);
	}

	async pauseDownload(hash: string): Promise<void> {
		await this.amuleService.pauseDownload(hash);
	}

	async resumeDownload(hash: string): Promise<void> {
		await this.amuleService.resumeDownload(hash);
	}

	async stopDownload(hash: string): Promise<void> {
		await this.amuleService.stopDownload(hash);
	}

	async getTransfers(): Promise<MediaTransfer[]> {
		try {
			const result = await this.amuleService.getTransfers();
			return result.list.map((d) => ({ ...d, provider: 'amule' })) as MediaTransfer[];
		} catch (e) {
			this.logger.error('getTransfers error:', e);
			return [];
		}
	}

	async clearCompletedTransfers(hashes?: string[]): Promise<void> {
		if (!hashes) {
			await this.amuleService.clearCompletedTransfers();
		} else {
			const amuleHashes = hashes.filter((h) => !h.startsWith('telegram:'));
			if (amuleHashes.length > 0) {
				await this.amuleService.clearCompletedTransfers(amuleHashes);
			}
		}
	}
}
