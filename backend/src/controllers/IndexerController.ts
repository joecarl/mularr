import { Request, Response } from 'express';
import { AmuleService } from '../services/AmuleService';
import { container } from '../ServiceContainer';

/**
 * IndexerController provides a Torznab-compatible API for Sonarr and Radarr.
 */
export class IndexerController {
	private readonly amuleService = container.get(AmuleService);

	handle = async (req: Request, res: Response) => {
		const { t, q, season, ep } = req.query;

		console.log(`[Indexer] Action: ${t}, Query: ${q}`);

		if (t === 'caps') {
			return this.getCapabilities(res);
		}

		if (t === 'search' || t === 'tvsearch' || t === 'movie') {
			let queryStr = (q as string) || '';
			if (t === 'tvsearch') {
				if (season) queryStr += ` S${season.toString().padStart(2, '0')}`;
				if (ep) queryStr += ` E${ep.toString().padStart(2, '0')}`;
			}

			try {
				const results = await this.amuleService.searchSynchronous(queryStr);
				return this.renderRss(res, results.list);
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
  <movie-search available="yes" supportedParams="q" />
  <categories>
    <category id="2000" name="Movies" />
    <category id="5000" name="TV" />
  </categories>
</caps>`;
		res.send(caps);
	}

	private renderRss(res: Response, results: any[]) {
		res.header('Content-Type', 'application/xml');

		let itemsXml = '';
		for (const item of results) {
			const sizeBytes = Math.floor(parseFloat(item.size) * 1024 * 1024);
			const title = this.escapeXml(item.name);
			const hash = item.hash;

			itemsXml += `
    <item>
      <title>${title}</title>
      <guid isPermaLink="false">${hash}</guid>
      <link>${hash}</link>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <size>${sizeBytes}</size>
      <enclosure url="${hash}" length="${sizeBytes}" type="application/x-bittorrent" />
      <torznab:attr name="seeders" value="${item.sources || 0}" />
      <torznab:attr name="peers" value="0" />
      <torznab:attr name="infohash" value="${hash}" />
    </item>`;
		}

		const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">
  <channel>
    <title>Mularr Indexer</title>
    <description>aMule search results for Sonarr/Radarr</description>
    <link>http://localhost:8940/</link>
    ${itemsXml}
  </channel>
</rss>`;
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
