import { Request, Response } from 'express';
import { container } from '../services/container/ServiceContainer';
import { MediaProviderService } from '../services/mediaprovider';

export class MediaProviderController {
	private readonly service = container.get(MediaProviderService);

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

	startSearch = async (req: Request, res: Response) => {
		try {
			const { query, type } = req.body;
			await this.service.startSearch(query, type);
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	getSearchResults = async (req: Request, res: Response) => {
		try {
			const data = await this.service.getSearchResults();
			res.json(data);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	getSearchStatus = async (req: Request, res: Response) => {
		try {
			const data = await this.service.getSearchStatus();
			res.json(data);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	addDownload = async (req: Request, res: Response) => {
		try {
			const { link } = req.body;
			await this.service.addDownload(link);
			res.json({ success: true });
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
			const { hash, categoryId } = req.body;
			await this.service.setFileCategory(hash, parseInt(categoryId));
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};
}
