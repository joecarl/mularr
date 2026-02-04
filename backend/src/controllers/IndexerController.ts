import { Request, Response } from 'express';
import { container } from '../services/container/ServiceContainer';
import { AmuleService } from '../services/AmuleService';
import { hashToFakeMagnet } from './qbittorrentMappings';

/**
 * IndexerController provides a Torznab-compatible API for Sonarr and Radarr.
 */
export class IndexerController {
	private readonly amuleService = container.get(AmuleService);

	handle = async (req: Request, res: Response) => {
		const { t, q, season, ep, offset, limit, cat, imdbid, rid, director, year } = req.query;

		console.log(`[Indexer] Action: ${t}, Query: ${q}, IMDB: ${imdbid}, Cat: ${cat}`);

		if (t === 'caps') {
			return this.getCapabilities(res);
		}

		if (t === 'search' || t === 'tvsearch' || t === 'movie') {
			// If `t` is missing, return a single fake item so clients (Radarr/Sonarr) receive at least one result.
			if (!q && !imdbid) {
				console.log('[Indexer] No query `q` nor `imdbid` provided — returning one fake item for compatibility');
				const fakeItem = [
					{
						name: 'Mularr Test Item',
						size: '0.01',
						sizeBytes: 10240,
						sources: 0,
						link: 'http://localhost:8940/dummy',
						hash: '00000000000000000000000000000000',
					},
				];
				return this.renderRss(res, fakeItem, cat as string);
			}

			let queryStr = (q as string) || '';

			// If no 'q' but has metadata (Radarr/Sonarr often do this first)
			if (!queryStr && imdbid) {
				// In a real eMule world, finding by IMDB directly is hard.
				// For now, if we don't have a name, we return empty to pass the "Test" accurately.
				// Sonarr/Radarr usually send the title in 'q' for actual searches though.
				console.log(`[Indexer] Search by IMDB ${imdbid} requested without title. Returning empty.`);
				return this.renderRss(res, [], cat as string);
			}

			// If it's a TV search, add season/ep to query
			if (t === 'tvsearch') {
				if (season) queryStr += ` S${season.toString().padStart(2, '0')}`;
				if (ep) queryStr += ` E${ep.toString().padStart(2, '0')}`;
			}

			// Radarr/Sonarr "Test" often sends 't=movie' or 't=search' without 'q'.
			if (!queryStr.trim()) {
				console.log(`[Indexer] Empty query for action ${t}, returning empty valid RSS for Test compatibility`);
				return this.renderRss(res, [], cat as string);
			}

			try {
				const results = await this.amuleService.searchSynchronous(queryStr);

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
		const caps = `<?xml version="1.0" encoding="UTF-8"?>
<caps>
  <server title="Mularr" description="aMule Indexer for Sonarr/Radarr" />
  <limits max="100" default="50" />
  <search available="yes" supportedParams="q" />
  <tv-search available="yes" supportedParams="q,season,ep" />
  <movie-search available="yes" supportedParams="q,imdbid" />
  <categories>
    <category id="2000" name="Movies">
      <subcat id="2010" name="Foreign" />
      <subcat id="2020" name="Other" />
    </category>
    <category id="5000" name="TV">
      <subcat id="5030" name="Foreign" />
      <subcat id="5040" name="HD" />
    </category>
  </categories>
</caps>`;
		res.send(caps);
	}

	private renderRss(res: Response, results: any[], requestedCat?: string) {
		res.header('Content-Type', 'application/xml');

		const category = requestedCat || '2000';
		const offset = res.req.query.offset || '0';
		const total = results.length;

		let itemsXml = '';
		for (const item of results) {
			const sizeBytes = item.sizeBytes || Math.floor(parseFloat(item.size) * 1024 * 1024);
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
      <size>${sizeBytes}</size>
      <enclosure url="${downloadUrl}" length="${sizeBytes}" type="application/x-bittorrent" />
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
    <description>aMule search results for Sonarr/Radarr</description>
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
