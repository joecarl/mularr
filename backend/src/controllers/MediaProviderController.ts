import { Request, Response } from 'express';
import { container } from '../services/container/ServiceContainer';
import { MediaProviderService, MediaSearchService, UnknownSearchError } from '../services/mediaprovider';

export class MediaProviderController {
	private readonly service = container.get(MediaProviderService);
	private readonly searchService = container.get(MediaSearchService);

	getTransfers = async (req: Request, res: Response) => {
		try {
			const data = await this.service.getTransfers();
			res.json(data);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	clearCompletedTransfers = async (req: Request, res: Response) => {
		try {
			const { hashes } = req.body;
			await this.service.clearCompletedTransfers(hashes);
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	getSearchProviders = (req: Request, res: Response) => {
		try {
			res.json(this.service.getAvailableSearchProviders());
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	startSearch = async (req: Request, res: Response) => {
		try {
			const { query, type } = req.body;
			// Interactive: a user is waiting for these results (rate-limited providers keep quota for them)
			const searchId = await this.searchService.startSearch({ query, amuleSearchType: type }, true);
			res.json({ searchId });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	getSearchResults = async (req: Request, res: Response) => {
		try {
			const data = await this.searchService.getSearchResults(searchIdOf(req));
			res.json(data);
		} catch (e: any) {
			res.status(searchErrorStatus(e)).json({ error: e.message });
		}
	};

	getSearchStatus = async (req: Request, res: Response) => {
		try {
			const data = await this.searchService.getSearchStatus(searchIdOf(req));
			res.json(data);
		} catch (e: any) {
			res.status(searchErrorStatus(e)).json({ error: e.message });
		}
	};

	addDownload = async (req: Request, res: Response) => {
		try {
			const { link } = req.body;
			const { duplicate } = await this.service.addDownload(link);
			res.json({
				success: true,
				duplicate: duplicate ? { hash: duplicate.hash, name: duplicate.name, size: duplicate.size, isCompleted: !!duplicate.is_completed } : undefined,
			});
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	downloadCommand = async (req: Request, res: Response) => {
		try {
			const { hash, command } = req.body;
			await this.service.sendDownloadCommand(hash, command);
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	getCategories = async (req: Request, res: Response) => {
		try {
			const cats = await this.service.getCategories();
			res.json(cats);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	setFileCategory = async (req: Request, res: Response) => {
		try {
			const { hash, categoryId, moveFiles } = req.body;
			await this.service.setFileCategory(hash, parseInt(categoryId), !!moveFiles);
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};
}

/** The `id` query parameter naming the search, as returned by startSearch. */
function searchIdOf(req: Request): string {
	const id = req.query.id;
	if (typeof id !== 'string' || !id) throw new MissingSearchIdError();
	return id;
}

class MissingSearchIdError extends Error {
	constructor() {
		super('Missing search id');
	}
}

/** 400 without an id, 404 for one that is not kept (the UI then just starts a new search), 500 otherwise. */
function searchErrorStatus(e: unknown): number {
	if (e instanceof MissingSearchIdError) return 400;
	if (e instanceof UnknownSearchError) return 404;
	return 500;
}
