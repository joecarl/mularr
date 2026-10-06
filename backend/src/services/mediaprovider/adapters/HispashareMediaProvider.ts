import { container } from '../../container/ServiceContainer';
import { parseEd2kLink } from '../../eD2kTools';
import { HispashareApiClient, HispashareRateLimitError, hispashareTitleUrl, type HispashareTitle } from '../../hispashare/HispashareApiClient';
import { HispashareService } from '../../hispashare/HispashareService';
import type { IMediaProvider, MediaSearchResult, MediaTransfer, SearchCriteria } from '../types';
import { LoggerFactory } from '../../logging/Logger';

export const HISPASHARE_PROVIDER_ID = 'hispashare';

/**
 * Search-only provider backed by the Hispashare catalogue. Its results are eD2k files, so downloading,
 * pausing and the rest are aMule's job: canHandleDownload is always false and the download methods are
 * never reached. Active only while an enabled 'hispashare' extension with a token exists.
 */
export class HispashareMediaProvider implements IMediaProvider {
	private readonly logger = LoggerFactory.create(this);
	readonly providerId = HISPASHARE_PROVIDER_ID;
	readonly searchesByImdbId = true;
	private readonly hispashare = container.get(HispashareService);
	private results: MediaSearchResult[] = [];
	private searchDone = true;

	isAvailable(): boolean {
		return this.hispashare.getClient() !== null;
	}

	canHandleDownload(_link: string): boolean {
		return false;
	}

	async startSearch(criteria: SearchCriteria): Promise<void> {
		this.results = [];
		const client = this.hispashare.getClient();
		if (!client) {
			this.searchDone = true;
			return;
		}
		this.searchDone = false;
		// Runs in the background like the other providers; getSearchStatus reports completion
		this.runSearch(client, criteria)
			.catch((error: any) => {
				if (error instanceof HispashareRateLimitError) this.logger.info(`Search skipped: ${error.message}`);
				else this.logger.warn('Search failed:', error?.message ?? error);
			})
			.finally(() => {
				this.searchDone = true;
			});
	}

	private async runSearch(client: HispashareApiClient, criteria: SearchCriteria): Promise<void> {
		const interactive = !!criteria.interactive;
		let titles: HispashareTitle[];
		if (criteria.imdbId) {
			titles = await client.titlesByImdb(criteria.imdbId, interactive);
		} else {
			const q = firstQueryVariant(criteria.query);
			if (!q) return;
			titles = await client.searchTitles(q, interactive);
		}
		this.results = hispashareSearchResults(titles);
		this.logger.info(`Search completed: ${titles.length} title(s), ${this.results.length} file(s)`);
	}

	async getSearchResults(): Promise<MediaSearchResult[]> {
		return this.results;
	}

	async getSearchStatus(): Promise<number> {
		return this.searchDone ? 1 : 0.5;
	}

	// Downloads are eD2k transfers owned by aMule; MediaProviderService never routes them here (canHandleDownload is false)
	async addDownload(_link: string): Promise<void> {
		throw new Error('Hispashare releases are downloaded through aMule');
	}
	async removeDownload(_hash: string): Promise<void> {
		throw new Error('Hispashare releases are downloaded through aMule');
	}
	async pauseDownload(_hash: string): Promise<void> {
		throw new Error('Hispashare releases are downloaded through aMule');
	}
	async resumeDownload(_hash: string): Promise<void> {
		throw new Error('Hispashare releases are downloaded through aMule');
	}
	async stopDownload(_hash: string): Promise<void> {
		throw new Error('Hispashare releases are downloaded through aMule');
	}

	async getTransfers(): Promise<MediaTransfer[]> {
		return [];
	}

	async clearCompletedTransfers(_hashes?: string[]): Promise<void> {}
}

/** Hispashare matches titles, not keywords: of an aMule-style "A OR B" query only the first variant is sent. */
function firstQueryVariant(query: string): string {
	return query.split(/\s+OR\s+/)[0].trim();
}

/** Origin label shown as Provider Info, in results and later on the download. */
export function hispashareSourceName(title: HispashareTitle, releaseInfo: string, languages: string[]): string {
	const name = title.production_year ? `${title.title} (${title.production_year})` : title.title;
	return ['Hispashare: ' + name, releaseInfo.trim(), languages.join('/')].filter((part) => part).join(' · ');
}

/**
 * One result per ed2k file of every release, deduplicated by hash (a file may appear under several titles).
 * Also how the feed poller turns the catalogue's newest titles into releases (see services/indexerfeed).
 */
export function hispashareSearchResults(titles: HispashareTitle[]): MediaSearchResult[] {
	const byHash = new Map<string, MediaSearchResult>();
	for (const title of titles) {
		const webUrl = hispashareTitleUrl(title.id);
		// The title without its releases: each result carries its own release, not the siblings
		const { releases, ...titleData } = title;
		for (const release of releases ?? []) {
			const sourceName = hispashareSourceName(title, release.release_info ?? '', release.language ?? []);
			for (const link of release.elinks ?? []) {
				const file = parseEd2kLink(link);
				if (!file || byHash.has(file.hash)) continue;
				byHash.set(file.hash, {
					name: file.name,
					size: file.size,
					hash: file.hash,
					link,
					// Hispashare does not report eD2k sources; 1 marks the file as available (the *arr reject 0 seeders)
					sourceCount: 1,
					completeSourceCount: 1,
					type: title.type ?? '',
					provider: HISPASHARE_PROVIDER_ID,
					sourceName,
					webUrl,
					imdbId: title.imdb_id ?? undefined,
					providerData: { title: titleData, release },
				});
			}
		}
	}
	return [...byHash.values()];
}
