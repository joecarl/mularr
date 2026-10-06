import { Request, Response } from 'express';
import { container } from '../services/container/ServiceContainer';
import { eD2kLinkToFakeMagnet, hashToFakeMagnet } from './qbittorrentMappings';
import { MediaSearchService, MediaSearchResult } from '../services/mediaprovider';
import { MainDB, type IndexerFeedMediaType, type IndexerFeedRecord } from '../services/db/MainDB';
import { expandApostrophes, filterByEpisode } from '../services/releaseNameTools';
import { toImdbId, type ArrApp } from '../services/arrsync/ArrApiClient';
import { arrSearchProvidersFor } from '../services/arrsync/ArrSyncService';
import { parseEd2kLink } from '../services/eD2kTools';
import { LoggerFactory } from '../services/logging/Logger';

/** What renderRss needs from a release. pubDate defaults to now (live search results). */
type RssItem = MediaSearchResult & { pubDate?: Date };

function feedRecordToRssItem(r: IndexerFeedRecord): RssItem {
	return {
		name: r.name,
		size: r.size,
		hash: r.hash,
		link: r.link ?? undefined,
		sourceCount: r.source_count,
		provider: r.provider,
		pubDate: new Date(r.discovered_at),
	};
}

/** Providers in both lists, where an absent list stands for every provider (see SearchCriteria.providers). */
function restrictProviders(providers: readonly string[] | undefined, selected: readonly string[] | undefined): readonly string[] | undefined {
	if (!providers) return selected;
	if (!selected) return providers;
	return providers.filter((p) => selected.includes(p));
}

const EMPTY_FEED_PLACEHOLDER: MediaSearchResult[] = [
	{
		name: 'Mularr Test Item',
		size: 10240,
		sourceCount: 0,
		link: 'http://localhost:8940/dummy',
		hash: '00000000000000000000000000000000',
		provider: 'Mularr',
	},
];

/**
 * IndexerController provides a Torznab-compatible API for Sonarr, Radarr and Lidarr.
 *
 * Two kinds of request arrive here:
 * - Searches (`q`, `imdbid`, `artist`/`album`): a live search on the providers.
 * - RSS syncs, the same actions with no search terms, which the *arr send every few minutes to learn
 *   about new releases. eD2k has no such feed, so it is served from the indexer_feed table filled by
 *   the *arr wanted sync (see services/arrsync) and the provider feeds (see services/indexerfeed).
 *
 * Searches reach the providers selected in the Sonarr/Radarr extensions of the calling app, see selectedProvidersFor.
 */
export class IndexerController {
	private readonly logger = LoggerFactory.create(this);
	private readonly searchService = container.get(MediaSearchService);
	private readonly db = container.get(MainDB);

	handle = async (req: Request, res: Response) => {
		const { t, q, season, ep, offset, limit, cat, imdbid, rid, director, year, artist, album } = req.query;

		this.logger.info(`Action: ${t}, Query: ${q}, IMDB: ${imdbid}, Artist: ${artist}, Album: ${album}, Cat: ${cat}`);

		if (t === 'caps') {
			return this.getCapabilities(res);
		}

		if (t === 'search' || t === 'tvsearch' || t === 'movie' || t === 'music') {
			// Music search (Lidarr): build the query from the structured
			// artist/album params (Lidarr prefers them over free-text `q`).
			// Values are trimmed and deduped case-insensitively, since
			// self-titled albums arrive as artist == album.
			let musicQuery = '';
			if (t === 'music') {
				const parts = [artist, album]
					.flat()
					.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
					.map((v) => v.trim());
				musicQuery = parts.filter((p, i) => parts.findIndex((x) => x.toLowerCase() === p.toLowerCase()) === i).join(' ');
			}

			// With no search terms this is an RSS sync (or the *arr connection Test): serve the feed built by
			// the wanted sync. When it is empty, return one fake item: the Test fails hard on an empty feed.
			if (!q && !imdbid && !musicQuery) {
				const start = parseInt(offset as string) || 0;
				const size = parseInt(limit as string) || 100;
				return this.handleRssSync(res, start, size, t, cat as string);
			}

			// Releases often drop apostrophes (e.g. "Widow's Bay" -> "Widows Bay").
			// Done here so every search type benefits.
			let queryStr = expandApostrophes((q as string) || '');
			const imdbId = toImdbId(imdbid);

			// Lidarr sends a literal empty `q=` alongside artist/album —
			// fall back to the structured params whenever q is blank.
			if (t === 'music' && !queryStr.trim()) {
				queryStr = expandApostrophes(musicQuery);
			}

			// What the request can search with, narrowed to what the calling app selected
			const selected = this.selectedProvidersFor(t);
			const providers = restrictProviders(this.getSearchProvidersFor(queryStr, imdbId), selected);
			if (providers?.length === 0) {
				this.logger.debug(
					`No providers to search with (q "${queryStr}", IMDb id ${imdbId ?? 'none'}, selected: ${selected ? selected.join(', ') || 'none' : 'all'}); returning empty valid RSS`
				);
				return this.renderRss(res, [], cat as string);
			}

			// tvsearch: search by title alone, then filter names locally by
			// season/ep (see filterByEpisode).
			let epFilter: { season: number; ep: number } | undefined;
			if (t === 'tvsearch' && typeof season === 'string' && typeof ep === 'string' && /^\d+$/.test(season) && /^\d+$/.test(ep)) {
				epFilter = { season: parseInt(season, 10), ep: parseInt(ep, 10) };
			}

			try {
				const results = await this.searchService.searchAndCollect({ query: queryStr, imdbId, providers });

				let list = epFilter ? filterByEpisode(results, epFilter.season, epFilter.ep) : results;

				// Apply offset and limit
				const start = parseInt(offset as string) || 0;
				const size = parseInt(limit as string) || 100;
				list = list.slice(start, start + size);

				this.logger.info(
					`Returning ${list.length} results (offset: ${start}, limit: ${size}) for ${queryStr ? `query "${queryStr}"` : `IMDb id ${imdbId}`}`
				);

				return this.renderRss(res, list, cat as string);
			} catch (e: any) {
				this.logger.error('Indexer Search Error:', e);
				return res.status(500).send(e.message);
			}
		}

		res.status(400).send('Unknown action');
	};

	private handleRssSync(res: Response, start: number, size: number, t?: string, cat?: string) {
		// tvsearch/movie map to one media type; a plain search gets everything; music has no feed
		const mediaType: IndexerFeedMediaType | undefined = t === 'tvsearch' ? 'tv' : t === 'movie' ? 'movie' : undefined;
		const total = t === 'music' ? 0 : this.db.countIndexerFeed({ mediaType });
		if (total > 0) {
			const items = this.db.getIndexerFeed({ mediaType }, start, size).map((r) => feedRecordToRssItem(r));
			this.logger.info(`RSS sync (${t}): returning ${items.length} feed item(s) (offset: ${start}, limit: ${size}, total: ${total})`);
			return this.renderRss(res, items, cat, total);
		}

		this.logger.debug('No search terms provided (q/imdbid/artist/album) and the feed is empty — returning one fake item for compatibility');
		return this.renderRss(res, EMPTY_FEED_PLACEHOLDER, cat);
	}

	/**
	 * Providers the calling app's searches are limited to: the ones selected in its Sonarr/Radarr extensions, the
	 * same ones their wanted sync uses (see arrSearchProvidersFor), so a network whose results are too unreliable
	 * for unattended downloads can be kept out of the automatic searches. The app is told by the action: with the
	 * caps advertised, Sonarr searches with tvsearch and Radarr with movie. search and music (Lidarr, Prowlarr's
	 * manual search) name no app and reach every provider, as do the apps without a selection (undefined).
	 */
	private selectedProvidersFor(t: unknown): readonly string[] | undefined {
		const app: ArrApp | null = t === 'tvsearch' ? 'sonarr' : t === 'movie' ? 'radarr' : null;
		return app ? arrSearchProvidersFor(this.db.getAllExtensions(), app) : undefined;
	}

	/**
	 * Providers a Torznab search can go to, before the calling app's selection (see selectedProvidersFor): all of
	 * them for a text query (undefined), the id-searching ones for an IMDb id alone, none when there is nothing to
	 * search with (the *arr Test sends no terms at all). The id tier is advertised in caps only while an
	 * id-searching provider is available; its exact matches are enough, and when it knows nothing, or the app left
	 * it out of its selection, the *arr falls back to its text tier on the empty answer.
	 */
	private getSearchProvidersFor(queryStr: string, imdbId: string | null): string[] | undefined {
		if (queryStr.trim()) return undefined;
		return imdbId ? this.searchService.imdbIdSearchProviderIds() : [];
	}

	private getCapabilities(res: Response) {
		res.header('Content-Type', 'application/xml');
		// Search elements MUST live inside <searching> — the *arr caps parsers
		// (shared NzbDrone.Core lineage) only read elements there and otherwise
		// fall back to built-in defaults. Names per those parsers: Lidarr
		// "audio-search" ("music-search" kept as a Jackett alias), Sonarr
		// "tv-search", Radarr "movie-search". imdbid is advertised only while a catalogue provider searches
		// by id (see MediaSearchService.imdbIdSearchProviderIds): the *arr try an id-only tier first when it
		// is listed, and with nobody to answer it that tier would always be empty. tv-search omits "rid" likewise.
		// A caps request names no app, so the apps' provider selections cannot be applied here.
		const idParams = this.searchService.imdbIdSearchProviderIds().length > 0 ? ',imdbid' : '';
		const caps = `<?xml version="1.0" encoding="UTF-8"?>
<caps>
  <server title="Mularr" description="aMule Indexer for Sonarr/Radarr/Lidarr" />
  <limits max="100" default="50" />
  <searching>
    <search available="yes" supportedParams="q" />
    <tv-search available="yes" supportedParams="q,season,ep${idParams}" />
    <movie-search available="yes" supportedParams="q${idParams}" />
    <audio-search available="yes" supportedParams="q,artist,album" />
    <music-search available="yes" supportedParams="q,artist,album" />
  </searching>
  <categories>
    <category id="2000" name="Movies">
      <subcat id="2010" name="Foreign" />
      <subcat id="2020" name="Other" />
    </category>
    <category id="5000" name="TV">
      <subcat id="5030" name="Foreign" />
      <subcat id="5040" name="HD" />
    </category>
    <category id="3000" name="Audio">
      <subcat id="3010" name="MP3" />
      <subcat id="3030" name="Audiobook" />
      <subcat id="3040" name="Lossless" />
    </category>
  </categories>
</caps>`;
		res.send(caps);
	}

	/** `total` is the size of the whole result set when `results` is one page of it (feed paging). */
	private renderRss(res: Response, results: RssItem[], requestedCat?: string, total: number = results.length) {
		res.header('Content-Type', 'application/xml');

		const category = requestedCat || '2000';
		const offset = res.req.query.offset || '0';

		let itemsXml = '';
		for (const item of results) {
			const title = this.escapeXml(item.name);
			const hash = item.hash;
			// Any ed2k link (aMule's own results, Hispashare's) travels whole so aMule can add it without a prior search
			const link = item.link && parseEd2kLink(item.link) ? eD2kLinkToFakeMagnet(item.link) : hashToFakeMagnet(hash);
			const downloadUrl = this.escapeXml(link);
			itemsXml += `
    <item>
      <title>${title}</title>
      <guid isPermaLink="false">${hash}</guid>
      <link>${downloadUrl}</link>
      <category>${category}</category>
      <pubDate>${(item.pubDate ?? new Date()).toUTCString()}</pubDate>
      <size>${item.size}</size>
      <enclosure url="${downloadUrl}" length="${item.size}" type="application/x-bittorrent" />
      <torznab:attr name="seeders" value="${item.sourceCount || 0}" />
      <torznab:attr name="peers" value="${item.sourceCount || 0}" />
      <torznab:attr name="infohash" value="${hash}" />
      <torznab:attr name="category" value="${category}" />
      <torznab:attr name="downloadvolumefactor" value="1" />
      <torznab:attr name="uploadvolumefactor" value="1" />
    </item>`;
		}

		const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">
  <channel>
    <title>Mularr Indexer</title>
    <description>aMule search results for Sonarr/Radarr/Lidarr</description>
    <torznab:response offset="${offset}" total="${total}" />
    ${itemsXml}
  </channel>
</rss>`;

		this.logger.debug('Rendered RSS:', rss);

		res.send(rss);
	}

	private escapeXml(unsafe: string) {
		return unsafe.replace(/[<>&"']/g, (c) => {
			switch (c) {
				case '<':
					return '&lt;';
				case '>':
					return '&gt;';
				case '&':
					return '&amp;';
				case '"':
					return '&quot;';
				case "'":
					return '&apos;';
			}
			return c;
		});
	}
}
