import { Request, Response } from 'express';
import { container } from '../services/container/ServiceContainer';
import { AmuleService } from '../services/AmuleService';
import { AmuledService } from '../services/AmuledService';
import { MediaProviderService } from '../services/mediaprovider/MediaProviderService';

export class AmuleController {
	private readonly amuleService = container.get(AmuleService);
	private readonly amuledService = container.get(AmuledService);

	getInfo = async (req: Request, res: Response) => {
		try {
			const version = await this.amuleService.getVersion();
			res.json({ version });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

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

	updateConfig = async (req: Request, res: Response) => {
		try {
			await this.amuledService.updateConfig(req.body);
			await this.amuledService.startDaemon(); // Restart the daemon after updating config
			res.json({ success: true });
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

	clearCompletedTransfers = async (req: Request, res: Response) => {
		try {
			const { hashes } = req.body;
			await this.amuleService.clearCompletedTransfers(hashes);
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	getSharedFiles = async (req: Request, res: Response) => {
		try {
			const shared = await this.amuleService.getSharedFiles();
			res.json(shared);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	deleteSharedFile = async (req: Request, res: Response) => {
		try {
			const hash = req.params.hash as string;
			await this.amuleService.deleteSharedFile(hash);
			await container.get(MediaProviderService).cleanDeadDownloadRecords();
			res.json({ success: true });
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

	getSearchStatus = async (req: Request, res: Response) => {
		try {
			const status = await this.amuleService.getSearchStatus();
			res.json(status);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	getUploadQueue = async (req: Request, res: Response) => {
		try {
			const queue = await this.amuleService.getUploadQueue();
			res.json(queue);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	getUpdate = async (req: Request, res: Response) => {
		try {
			const update = await this.amuleService.getUpdate();
			res.json(update);
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

	downloadCommand = async (req: Request, res: Response) => {
		try {
			const { hash, command } = req.body;
			if (command === 'pause') await this.amuleService.pauseDownload(hash);
			else if (command === 'resume') await this.amuleService.resumeDownload(hash);
			else if (command === 'stop') await this.amuleService.stopDownload(hash);
			else if (command === 'cancel') await this.amuleService.removeDownload(hash);
			else throw new Error('Invalid command');
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	getCategories = async (req: Request, res: Response) => {
		try {
			const categories = await this.amuleService.getCategories();
			const incomingDir = await container.get(MediaProviderService).getIncomingDir();
			const enriched = categories.map((c) => ({ ...c, resolvedPath: c.path || incomingDir }));
			// Ensure a default category (id=0) is always present so the frontend can resolve its path
			if (!enriched.some((c) => c.id === 0)) {
				enriched.unshift({ id: 0, name: '', path: '', comment: '', color: 0, priority: 0, resolvedPath: incomingDir });
			}
			res.json(enriched);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	createCategory = async (req: Request, res: Response) => {
		try {
			const cat = await this.amuleService.createCategory(req.body);
			res.status(201).json(cat);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	updateCategory = async (req: Request, res: Response) => {
		try {
			const { id } = req.params;
			const { moveFiles, ...data } = req.body;
			let oldPath: string | undefined;
			if (moveFiles && data.path !== undefined) {
				const oldCats = await this.amuleService.getCategories();
				const oldCat = oldCats.find((c) => c.id === parseInt(id as string));
				oldPath = oldCat?.path;
			}
			const cat = await this.amuleService.updateCategory(parseInt(id as string), data);
			const newPath: string | undefined = data.path;
			if (moveFiles && newPath !== undefined && oldPath !== newPath) {
				await container.get(MediaProviderService).moveCategoryCompletedFiles(cat.name ?? '', oldPath ?? '', newPath);
			}
			res.json(cat);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	deleteCategory = async (req: Request, res: Response) => {
		try {
			const { id } = req.params;
			await this.amuleService.deleteCategory(parseInt(id as string));
			res.status(204).end();
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	setFileCategory = async (req: Request, res: Response) => {
		try {
			const { hash, categoryId } = req.body;
			await this.amuleService.setFileCategory(hash, parseInt(categoryId));
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

	disconnect = async (req: Request, res: Response) => {
		try {
			await this.amuleService.disconnectFromServer();
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	addServer = async (req: Request, res: Response) => {
		try {
			const { ip, port, name } = req.body;
			if (!ip || !port) {
				res.status(400).json({ error: 'Missing "ip" or "port" in request body' });
				return;
			}
			await this.amuleService.addServer(ip, port, name);
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	removeServer = async (req: Request, res: Response) => {
		try {
			const { ip, port } = req.body;
			if (!ip || !port) {
				res.status(400).json({ error: 'Missing "ip" or "port" in request body' });
				return;
			}
			await this.amuleService.removeServer(ip, port);
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	setServerPriority = async (req: Request, res: Response) => {
		try {
			const { ip, port, priority } = req.body;
			if (!ip || !port || ![0, 1, 2].includes(priority)) {
				res.status(400).json({ error: 'Expected "ip", "port" and "priority" (0=normal, 1=high, 2=low) in request body' });
				return;
			}
			await this.amuleService.setServerPriority(ip, port, priority);
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	setServerStatic = async (req: Request, res: Response) => {
		try {
			const { ip, port, isStatic } = req.body;
			if (!ip || !port || typeof isStatic !== 'boolean') {
				res.status(400).json({ error: 'Expected "ip", "port" and boolean "isStatic" in request body' });
				return;
			}
			await this.amuleService.setServerStatic(ip, port, isStatic);
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	updateServerList = async (req: Request, res: Response) => {
		try {
			const { url } = req.body;
			if (!url || typeof url !== 'string') {
				res.status(400).json({ error: 'Missing "url" in request body' });
				return;
			}
			await this.amuleService.updateServerListFromUrl(url);
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

	restartDaemon = async (req: Request, res: Response) => {
		try {
			await this.amuledService.restartDaemon();
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};
}
