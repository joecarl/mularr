import { Request, Response } from 'express';
import { container } from '../services/container/ServiceContainer';
import { AmuleService } from '../services/AmuleService';
import { hashToBtih, extractHashFromMagnet } from './qbittorrentMappings';

/**
 * ArrController provides a qBittorrent-compatible API for Sonarr and Radarr.
 */
export class QbittorrentController {
	private readonly amuleService = container.get(AmuleService);

	// qBittorrent API: POST /api/v2/auth/login
	login = async (req: Request, res: Response) => {
		// We don't implement full auth yet, just return Ok and a dummy cookie
		console.log('[QbittorrentController] Login requested (dummy implementation)');
		res.setHeader('Set-Cookie', 'SID=mularr_dummy_session; HttpOnly; Path=/');
		res.send('Ok.');
	};

	// qBittorrent API: GET /api/v2/app/version
	getVersion = async (req: Request, res: Response) => {
		console.log('[QbittorrentController] Version requested');
		res.send('v4.3.3');
	};

	// qBittorrent API: GET /api/v2/app/webapiVersion
	getWebApiVersion = async (req: Request, res: Response) => {
		console.log('[QbittorrentController] WebAPI Version requested');
		res.send('2.0');
	};

	getCategories = async (req: Request, res: Response) => {
		console.log('[QbittorrentController] Categories requested');
		const categories = await this.amuleService.getCategories();
		const dict: any = {};
		categories.forEach((cat) => {
			dict[cat.name] = {
				name: cat.name,
				savePath: cat.path,
			};
		});
		res.json(dict);
	};

	getProperties = async (req: Request, res: Response) => {
		console.log('[QbittorrentController] Torrent properties requested');
		const { hash } = req.query;
		if (!hash || typeof hash !== 'string') {
			return res.status(400).send('No hash provided');
		}

		const transfers = await this.amuleService.getTransfers();
		for (const t of transfers.downloads) {
			if (t.name && t.hash) {
				if (t.rawLine === undefined && hashToBtih(t.hash) === hash) {
					return res.json(t);
				}
			}
		}

		return res.status(404).send('Torrent not found');
	};

	createCategory = async (req: Request, res: Response) => {
		console.log('[QbittorrentController] Create Category requested');
		const { category, savePath } = req.body;
		// In a real implementation, you'd store this category somewhere
		console.log(`Creating category: ${category} with path: ${savePath}`);
		this.amuleService.createCategory({
			name: category,
			path: savePath,
		});
		res.send('');
	};

	// qBittorrent API: GET /api/v2/torrents/info
	getTorrents = async (req: Request, res: Response) => {
		console.log('[QbittorrentController] Torrents info requested');
		const { category } = req.query;
		try {
			const transfers = await this.amuleService.getTransfers();
			const categories = await this.amuleService.getCategories();

			const getCatByName = (name: string) => {
				if (!name) return categories.find((c) => c.id === 0); // Default category
				const cat = categories.find((c) => c.name === name);
				return cat;
			};

			const requestedCtgName = category as string | undefined;

			const downloads = transfers.downloads.filter((t) => {
				if (requestedCtgName) {
					return t.categoryName === requestedCtgName;
				}
				return true;
			});

			const qbitTorrents = [
				...downloads.map((t) => ({
					hash: t.hash || 'unknown',
					name: t.name || 'Unknown',
					size: t.size || 0,
					progress: t.progress || 0,
					dlspeed: t.speed || 0,
					upspeed: 0,
					priority: t.priority || 0,
					num_seeds: t.sources || 0,
					num_leechers: 0,
					state: this.mapStatusToQbitState(t.status || 'Downloading'),
					save_path: getCatByName(t.categoryName ?? '')?.path || '/incoming',
					added_on: Math.floor(Date.now() / 1000),
					eta: t.timeLeft || 0,
					category: t.categoryName,
				})),
			];
			//console.log(qbitTorrents);

			res.json(qbitTorrents);
		} catch (e: any) {
			console.error('QbittorrentController getTorrents Error:', e);
			res.status(500).json({ error: e.message });
		}
	};

	// qBittorrent API: POST /api/v2/torrents/add
	addTorrent = async (req: Request, res: Response) => {
		console.log('[QbittorrentController] Add torrent requested');
		try {
			// qBittorrent transmits URLs in a field called 'urls'
			const { urls, category, paused } = req.body;
			if (!urls) {
				return res.status(400).send('No URLs provided');
			}

			const urlList = typeof urls === 'string' ? urls.split('\n') : urls;

			const categories = await this.amuleService.getCategories();
			let categoryId: number | undefined = undefined;
			if (category) {
				const cat = categories.find((c) => c.name === category);
				if (cat) {
					categoryId = cat.id;
				} else {
					const newCat = await this.amuleService.createCategory({
						name: category,
					});
					categoryId = newCat.id;
				}
			}

			for (const url of urlList) {
				const trimmedUrl: string = url.trim();
				let hash = extractHashFromMagnet(trimmedUrl);
				if (hash) {
					console.log(`[QbittorrentController] Extracted HASH from magnet: ${hash}`);
				} else {
					hash = trimmedUrl;
				}

				console.log(`[QbittorrentController] Adding download from Sonarr/Radarr`);
				await this.amuleService.addDownload(hash);

				if (categoryId) {
					console.log(`[QbittorrentController] Setting category ID ${categoryId} for hash ${hash}`);
					await this.amuleService.setFileCategory(hash, categoryId || 0);
				}

				if (paused) {
					console.log(`[QbittorrentController] Pausing download for hash ${hash}`);
					await this.amuleService.pauseDownload(hash);
				}
			}

			res.send('Ok.');
		} catch (e: any) {
			console.error('QbittorrentController addTorrent Error:', e);
			res.status(500).send(e.message);
		}
	};

	// qBittorrent API: POST /api/v2/torrents/delete
	deleteTorrent = async (req: Request, res: Response) => {
		console.log('[QbittorrentController] Delete torrent requested');
		try {
			const { hashes } = req.body;
			if (!hashes) return res.status(400).send('No hashes provided');

			const hashList = hashes.split('|');
			for (const hash of hashList) {
				if (hash) {
					await this.amuleService.removeDownload(hash);
				}
			}
			res.send('Ok.');
		} catch (e: any) {
			console.error('QbittorrentController deleteTorrent Error:', e);
			res.status(500).send(e.message);
		}
	};

	getPreferences = async (req: Request, res: Response) => {
		console.log('[QbittorrentController] Preferences requested');
		res.json({
			save_path: '/incoming',
			temp_path: '/temp',
			dht: true,
		});
	};

	private mapStatusToQbitState(status: string): string {
		switch (status.toLowerCase()) {
			case 'downloading':
				return 'downloading';
			case 'paused':
				return 'pausedDL';
			case 'completed':
			case 'shared':
				return 'uploading';
			case 'hashing':
			case 'waiting for hash':
				return 'checkingDL';
			case 'error':
				return 'error';
			default:
				return 'downloading';
		}
	}
}
