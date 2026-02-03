import { Request, Response } from 'express';
import { AmuleService } from '../services/AmuleService';
import { AmuledService } from '../services/AmuledService';
import { container } from '../ServiceContainer';

export class AmuleController {
	private readonly amuleService = container.get(AmuleService);
	private readonly amuledService = container.get(AmuledService);

	getStatus = async (req: Request, res: Response) => {
		try {
			const stats = await this.amuleService.getStats();
			res.json(stats);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	getConfig = async (req: Request, res: Response) => {
		try {
			const config = await this.amuledService.getConfig();
			res.json(config);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	getServers = async (req: Request, res: Response) => {
		try {
			const servers = await this.amuleService.getServers();
			res.json(servers);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	getTransfers = async (req: Request, res: Response) => {
		try {
			const transfers = await this.amuleService.getTransfers();
			res.json(transfers);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	search = async (req: Request, res: Response) => {
		try {
			const { query, type } = req.body;
			await this.amuleService.startSearch(query, type);
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	getSearchResults = async (req: Request, res: Response) => {
		try {
			const results = await this.amuleService.getSearchResults();
			res.json(results);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	download = async (req: Request, res: Response) => {
		try {
			const { link } = req.body;
			await this.amuleService.addDownload(link);
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	connect = async (req: Request, res: Response) => {
		try {
			const { ip, port } = req.body;
			await this.amuleService.connectToServer(ip, port);
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	getLog = async (req: Request, res: Response) => {
		try {
			const lines = req.query.lines ? parseInt(req.query.lines as string) : 50;
			const log = await this.amuledService.getLog(lines);
			res.json({ lines: log });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};
}
