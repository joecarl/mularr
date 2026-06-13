import { Request, Response } from 'express';
import { container } from '../services/container/ServiceContainer';
import { hashToFakeMagnet } from './qbittorrentMappings';
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
			// artist/album params (Lidarr prefers them over free-text `q`
			// when the caps advertise audio-search support). Values are
			// trimmed; for self-titled albums Lidarr sends artist == album,
			// deduped case-insensitively to avoid "X X" queries.
			let musicQuery = '';
			if (t === 'music') {
				const parts = [artist, album]
					.flat()
					.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
					.map((v) => v.trim());
				musicQuery = parts.filter((p, i) => parts.findIndex((x) => x.toLowerCase() === p.toLowerCase()) === i).join(' ');
			}

			// If no search terms at all, return a single fake item so clients
			// (Radarr/Sonarr/Lidarr) receive at least one result: their
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

			// tvsearch: search by the title Sonarr put in `q` and nothing
			// else. season/ep arrive as separate Torznab params, NOT inside
			// `q` — appending them to the eD2k query (in any token form)
			// only narrows it against the network's inconsistent episode
			// naming and loses real content. The episode, language and
			// quality matching is Sonarr's job: it parses each returned
			// release name and rejects what doesn't fit (verified against
			// Sonarr's search decision specs). So leave `q` as formatted and
			// let the candidates flow back. (season/ep stay destructured for
			// logging/clarity but are intentionally unused.)
			//
			// Trade-off: a tvsearch returns every episode's releases for the
			// show. Automatic search is unaffected (only matches are grabbed);
			// interactive search shows the non-matching ones greyed-out with a
			// "Wrong episode" rejection — noisier list, but never grabbable.

			// Radarr/Sonarr "Test" often sends 't=movie' or 't=search' without 'q'.
			if (!queryStr.trim()) {
				console.log(`[Indexer] Empty query for action ${t}, returning empty valid RSS for Test compatibility`);
				return this.renderRss(res, [], cat as string);
			}

			try {
				await this.mediaProviderService.startSearch(queryStr);

				// Gather results until the set stops growing, not just until
				// the EC "progress" hits 100%. progress reaches 1 as soon as
				// the search is dispatched and the first responses land, but a
				// global eD2k search keeps trickling results back for many
				// seconds after that — returning at progress>=1 yields a small,
				// non-deterministic early snapshot (observed: ~17 vs ~126 for
				// the same query given more time), which silently drops
				// long-tail releases (minority languages, rarer rips).
				//
				// Tuned for completeness ("fuller" over "faster"): poll the
				// accumulating result set and only stop once its size has been
				// stable across STABLE_POLLS consecutive polls AND the search
				// reports done, or once MAX_WAIT_MS elapses. No early-exit on a
				// result-count threshold — we want the full set, accepting up
				// to ~MAX_WAIT_MS of latency on interactive searches (well
				// within Sonarr/Radarr's request timeout).
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
		// The search elements MUST live inside <searching> — the *arr caps
		// parsers (shared NzbDrone.Core lineage) read xmlRoot.Element("searching")
		// and ignore search elements placed anywhere else, silently falling
		// back to their built-in defaults. Element names per those parsers:
		// Lidarr reads "audio-search" (NOT "music-search" — kept below as the
		// Jackett-convention alias for other consumers), Sonarr "tv-search",
		// Radarr "movie-search". movie-search deliberately advertises only
		// "q" (we return empty for imdbid-only queries, so advertising imdbid
		// would make Radarr prefer an always-empty search tier); tv-search
		// omits "rid" for the same reason.
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
			//const downloadUrl = this.escapeXml(item.link);
			const link = hashToFakeMagnet(hash);
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
