import { releaseMatchesYear } from '../../tools/releaseNameTools';
import { ArrApiClient, titleToSearchQuery, toImdbId, type SearchJob } from './ArrApiClient';

/** A monitored movie without a file (Radarr `wanted/missing`). */
export interface WantedMovie {
	id: number;
	title: string;
	year: number;
	/** Whether the movie has reached the availability the user configured (in cinemas, digital...). */
	isAvailable: boolean;
	/** IMDb id ("tt0133093"), null when Radarr has none. */
	imdbId: string | null;
}

export class RadarrApiClient extends ArrApiClient {
	readonly app = 'radarr' as const;

	/** Unlike Sonarr, Radarr lists every missing movie; callers must check `isAvailable` themselves. */
	async getMissingMovies(): Promise<WantedMovie[]> {
		const records = await this.getAllPages<any>('/wanted/missing', {
			monitored: 'true',
			sortKey: 'movieMetadata.digitalRelease',
			sortDirection: 'descending',
		});
		return records
			.filter((r) => r && r.title)
			.map((r) => ({
				id: r.id,
				title: String(r.title),
				year: typeof r.year === 'number' ? r.year : 0,
				isAvailable: !!r.isAvailable,
				imdbId: toImdbId(r.imdbId),
			}));
	}

	/**
	 * One job per available missing movie; a hit must carry the movie's year, which is what keeps a
	 * one-word title from dragging the whole network into the feed (Radarr needs the year to match anyway).
	 * A provider that identifies the title itself (IMDb id on the result) is trusted without the year.
	 */
	async getWantedSearchJobs(): Promise<SearchJob[]> {
		const movies = await this.getMissingMovies();
		const jobs: SearchJob[] = [];
		for (const m of movies) {
			if (!m.isAvailable) continue;
			const query = titleToSearchQuery(m.title);
			if (!query) continue;
			jobs.push({
				key: `radarr:${m.id}`,
				query,
				label: m.year ? `${m.title} (${m.year})` : m.title,
				mediaType: 'movie',
				imdbId: m.imdbId,
				title: m.title,
				pending: m.year ? [String(m.year)] : [],
				matches: (r) => (!!m.imdbId && r.imdbId === m.imdbId) || !m.year || releaseMatchesYear(r.name, m.year),
			});
		}
		return jobs;
	}
}
