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
		try {
			const transfers = await this.amuleService.getTransfers();

			const qbitTorrents = [
				...(transfers.downloads || []).map((t) => ({
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
					save_path: '/incoming',
					added_on: Math.floor(Date.now() / 1000),
					eta: t.timeLeft || 0,
					category: 'mularr',
				})),
				...(transfers.shared || []).map((t) => ({
					hash: t.hash || 'unknown',
					name: t.name || 'Unknown',
					size: t.size || 0,
					progress: 1,
					dlspeed: 0,
					upspeed: 0,
					priority: 0,
					num_seeds: 0,
					num_leechers: 0,
					state: 'uploading',
					save_path: '/incoming',
					added_on: Math.floor(Date.now() / 1000),
					category: 'mularr',
				})),
			];

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
			const { urls } = req.body;
			if (!urls) {
				return res.status(400).send('No URLs provided');
			}

			const urlList = typeof urls === 'string' ? urls.split('\n') : urls;

			for (const url of urlList) {
				const trimmedUrl = url.trim();
				const decodedUrl = extractHashFromMagnet(trimmedUrl);
				if (decodedUrl) {
					console.log(`[QbittorrentController] Extracted HASH from magnet: ${decodedUrl}`);
					await this.amuleService.addDownload(decodedUrl);
				} else if (trimmedUrl) {
					console.log(`[QbittorrentController] Adding download from Sonarr/Radarr: ${trimmedUrl}`);
					await this.amuleService.addDownload(trimmedUrl);
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
