import { Request, Response } from 'express';
import { container } from '../services/container/ServiceContainer';
import { eD2kLinkToFakeMagnet, hashToFakeMagnet } from './qbittorrentMappings';
import { MediaProviderService, MediaSearchResult } from '../services/mediaprovider';

/**
 * IndexerController provides a Torznab-compatible API for Sonarr, Radarr and Lidarr.
 */
export class IndexerController {
	private readonly mediaProviderService = container.get(MediaProviderService);

	handle = async (req: Request, res: Response) => {
		const { t, q, season, ep, offset, limit, cat, imdbid, rid, director, year, artist, album } = req.query;

		console.log(`[Indexer] Action: ${t}, Query: ${q}, IMDB: ${imdbid}, Artist: ${artist}, Album: ${album}, Cat: ${cat}`);

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

			// With no search terms, return one fake item: the *arr
			// connection Test fails hard on an empty feed.
			if (!q && !imdbid && !musicQuery) {
				console.log('[Indexer] No search terms provided (q/imdbid/artist/album) — returning one fake item for compatibility');
				const fakeItem = [
					{
						name: 'Mularr Test Item',
						size: 10240,
						sources: 0,
						link: 'http://localhost:8940/dummy',
						hash: '00000000000000000000000000000000',
						provider: 'Mularr',
					} as MediaSearchResult,
				];
				return this.renderRss(res, fakeItem, cat as string);
			}

			let queryStr = (q as string) || '';

			// Lidarr sends a literal empty `q=` alongside artist/album —
			// fall back to the structured params whenever q is blank.
			if (t === 'music' && !queryStr.trim()) {
				queryStr = musicQuery;
			}

			// If no 'q' but has metadata (Radarr/Sonarr often do this first)
			if (!queryStr && imdbid) {
				// In a real eMule world, finding by IMDB directly is hard.
				// For now, if we don't have a name, we return empty to pass the "Test" accurately.
				// Sonarr/Radarr usually send the title in 'q' for actual searches though.
				console.log(`[Indexer] Search by IMDB ${imdbid} requested without title. Returning empty.`);
				return this.renderRss(res, [], cat as string);
			}

			// tvsearch: search by the title in `q` only. season/ep arrive as
			// separate Torznab params, not inside `q`; appending them narrows
			// the eD2k query against the network's inconsistent episode naming
			// and loses real content. Sonarr does the episode/language/quality
			// matching itself, rejecting releases that don't fit, so we let all
			// candidates flow back. (season/ep stay destructured for logging.)
			// Trade-off: a tvsearch returns every episode's releases; automatic
			// search only grabs matches, interactive greys out the rest.

			// Radarr/Sonarr "Test" often sends 't=movie' or 't=search' without 'q'.
			if (!queryStr.trim()) {
				console.log(`[Indexer] Empty query for action ${t}, returning empty valid RSS for Test compatibility`);
				return this.renderRss(res, [], cat as string);
			}

			try {
				await this.mediaProviderService.startSearch(queryStr);

				// Gather until the result set stops growing, not just until EC
				// progress hits 100%. progress reaches 1 as soon as the first
				// responses land, but a global eD2k search keeps trickling
				// results for many seconds; returning early yields a small,
				// non-deterministic snapshot (observed ~17 vs ~126) that drops
				// long-tail releases. So poll the set and stop only once its
				// size is stable across STABLE_POLLS polls AND the search
				// reports done, or MAX_WAIT_MS elapses — favouring completeness
				// over speed, within the *arr request timeout.
				const POLL_MS = 1500;
				const MAX_WAIT_MS = 12000;
				const STABLE_POLLS = 3;
				const startedAt = Date.now();
				let lastCount = -1;
				let stable = 0;
				while (Date.now() - startedAt < MAX_WAIT_MS) {
					await new Promise((r) => setTimeout(r, POLL_MS));
					const status = await this.mediaProviderService.getSearchStatus();
					const current = (await this.mediaProviderService.getSearchResults()).list.length;
					if (current === lastCount) {
						stable++;
						if (status.progress >= 1 && stable >= STABLE_POLLS) break;
					} else {
						stable = 0;
					}
					lastCount = current;
					console.log(`[Indexer] Search progress: ${Math.floor(status.progress * 100)}%, results so far: ${current}`);
				}

				const results = await this.mediaProviderService.getSearchResults();

				// Apply offset and limit
				let list = results.list;
				const start = parseInt(offset as string) || 0;
				const size = parseInt(limit as string) || 100;
				list = list.slice(start, start + size);

				console.log(`[Indexer] Returning ${list.length} results (offset: ${start}, limit: ${size}) for query "${queryStr}"`);

				return this.renderRss(res, list, cat as string);
			} catch (e: any) {
				console.error('Indexer Search Error:', e);
				return res.status(500).send(e.message);
			}
		}

		res.status(400).send('Unknown action');
	};

	private getCapabilities(res: Response) {
		res.header('Content-Type', 'application/xml');
		// Search elements MUST live inside <searching> — the *arr caps parsers
		// (shared NzbDrone.Core lineage) only read elements there and otherwise
		// fall back to built-in defaults. Names per those parsers: Lidarr
		// "audio-search" ("music-search" kept as a Jackett alias), Sonarr
		// "tv-search", Radarr "movie-search". movie-search advertises only "q"
		// (imdbid-only queries return empty, so advertising imdbid would make
		// Radarr prefer an always-empty tier); tv-search omits "rid" likewise.
		const caps = `<?xml version="1.0" encoding="UTF-8"?>
<caps>
  <server title="Mularr" description="aMule Indexer for Sonarr/Radarr/Lidarr" />
  <limits max="100" default="50" />
  <searching>
    <search available="yes" supportedParams="q" />
    <tv-search available="yes" supportedParams="q,season,ep" />
    <movie-search available="yes" supportedParams="q" />
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

	private renderRss(res: Response, results: MediaSearchResult[], requestedCat?: string) {
		res.header('Content-Type', 'application/xml');

		const category = requestedCat || '2000';
		const offset = res.req.query.offset || '0';
		const total = results.length;

		let itemsXml = '';
		for (const item of results) {
			const title = this.escapeXml(item.name);
			const hash = item.hash;
			const link = item.link && item.provider === 'amule' ? eD2kLinkToFakeMagnet(item.link) : hashToFakeMagnet(hash);
			const downloadUrl = this.escapeXml(link);
			itemsXml += `
    <item>
      <title>${title}</title>
      <guid isPermaLink="false">${hash}</guid>
      <link>${downloadUrl}</link>
      <category>${category}</category>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <size>${item.size}</size>
      <enclosure url="${downloadUrl}" length="${item.size}" type="application/x-bittorrent" />
      <torznab:attr name="seeders" value="${item.sources || 0}" />
      <torznab:attr name="peers" value="${item.sources || 0}" />
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

		console.log('Rendered RSS:', rss);

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
