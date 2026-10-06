import { Request, Response } from 'express';
import { container } from '../services/container/ServiceContainer';
import { MainDB, type IndexerFeedMediaType } from '../services/db/MainDB';
import { ArrSyncService } from '../services/arrsync/ArrSyncService';
import { ProviderFeedService } from '../services/indexerfeed/ProviderFeedService';
import type { IndexerFeedListResponse } from '../types/IndexerFeedTypes';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/** Web UI endpoints to inspect and manage the indexer feed, the *arr wanted sync and the provider feeds that fill it. */
export class IndexerFeedController {
	private readonly db = container.get(MainDB);
	private readonly arrSyncService = container.get(ArrSyncService);
	private readonly providerFeedService = container.get(ProviderFeedService);

	list = (req: Request, res: Response) => {
		try {
			const { type, q, job, offset, limit } = req.query;
			const mediaType: IndexerFeedMediaType | undefined = type === 'tv' || type === 'movie' ? type : undefined;
			const search = typeof q === 'string' ? q : undefined;
			const jobKey = typeof job === 'string' && job ? job : undefined;
			const start = Math.max(0, parseInt(offset as string) || 0);
			const size = Math.min(MAX_LIMIT, Math.max(1, parseInt(limit as string) || DEFAULT_LIMIT));
			const query = { mediaType, search, jobKey };
			const response: IndexerFeedListResponse = {
				items: this.db.getIndexerFeed(query, start, size),
				total: this.db.countIndexerFeed(query),
				offset: start,
				limit: size,
			};
			res.json(response);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	remove = (req: Request, res: Response) => {
		try {
			const hash = req.params.hash as string;
			if (!this.db.deleteIndexerFeedItem(hash)) {
				return res.status(404).json({ error: 'Feed item not found' });
			}
			res.status(204).end();
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	clear = (_req: Request, res: Response) => {
		try {
			const removed = this.db.clearIndexerFeed();
			res.json({ success: true, removed });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	wanted = async (_req: Request, res: Response) => {
		try {
			res.json(await this.arrSyncService.getWanted());
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	syncStatus = (_req: Request, res: Response) => {
		try {
			res.json(this.arrSyncService.getStatus());
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	providerFeeds = (_req: Request, res: Response) => {
		try {
			res.json(this.providerFeedService.getStatus());
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	runSync = (req: Request, res: Response) => {
		try {
			const extensionId = Number(req.params.extensionId);
			if (!Number.isInteger(extensionId)) {
				return res.status(400).json({ error: 'extensionId must be an integer' });
			}
			this.arrSyncService.runNow(extensionId);
			res.json({ success: true, status: this.arrSyncService.getStatus() });
		} catch (e: any) {
			res.status(400).json({ error: e.message });
		}
	};
}
