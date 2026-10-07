import { releaseMatchesEpisode } from '../../tools/releaseNameTools';
import { ArrApiClient, titleToSearchQuery, toImdbId, type SearchJob } from './ArrApiClient';

/** A monitored, already aired episode without a file (Sonarr `wanted/missing`). */
export interface WantedEpisode {
	id: number;
	seriesId: number;
	seriesTitle: string;
	seasonNumber: number;
	episodeNumber: number;
	airDateUtc: string | null;
	/** IMDb id of the series ("tt0944947"), null when Sonarr has none. */
	imdbId: string | null;
}

export class SonarrApiClient extends ArrApiClient {
	readonly app = 'sonarr' as const;

	/** Sonarr already limits this list to aired episodes; `includeSeries` brings the series title and ids along. */
	async getMissingEpisodes(): Promise<WantedEpisode[]> {
		const records = await this.getAllPages<any>('/wanted/missing', {
			monitored: 'true',
			includeSeries: 'true',
			sortKey: 'airDateUtc',
			sortDirection: 'descending',
		});
		return records
			.filter((r) => r && typeof r.seasonNumber === 'number' && typeof r.episodeNumber === 'number' && r.series?.title)
			.map((r) => ({
				id: r.id,
				seriesId: r.seriesId,
				seriesTitle: String(r.series.title),
				seasonNumber: r.seasonNumber,
				episodeNumber: r.episodeNumber,
				airDateUtc: r.airDateUtc ?? null,
				imdbId: toImdbId(r.series.imdbId),
			}));
	}

	/** One job per series with missing episodes; a hit must carry one of the wanted SxxEyy numbers. */
	async getWantedSearchJobs(): Promise<SearchJob[]> {
		const episodes = await this.getMissingEpisodes();
		const bySeries = new Map<number, { title: string; imdbId: string | null; episodes: { season: number; ep: number }[] }>();
		for (const e of episodes) {
			const entry = bySeries.get(e.seriesId) ?? { title: e.seriesTitle, imdbId: e.imdbId, episodes: [] };
			entry.episodes.push({ season: e.seasonNumber, ep: e.episodeNumber });
			bySeries.set(e.seriesId, entry);
		}
		const jobs: SearchJob[] = [];
		for (const [seriesId, { title, imdbId, episodes: wanted }] of bySeries) {
			const query = titleToSearchQuery(title);
			if (!query) continue;
			wanted.sort((a, b) => a.season - b.season || a.ep - b.ep);
			jobs.push({
				key: `sonarr:${seriesId}`,
				query,
				label: `${title} (${wanted.length} episode(s))`,
				mediaType: 'tv',
				imdbId,
				title,
				pending: wanted.map((w) => `S${String(w.season).padStart(2, '0')}E${String(w.ep).padStart(2, '0')}`),
				matches: (r) => wanted.some((w) => releaseMatchesEpisode(r.name, w.season, w.ep)),
			});
		}
		return jobs;
	}
}
