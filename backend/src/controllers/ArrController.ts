import { Request, Response } from 'express';
import { AmuleService } from '../services/AmuleService';
import { container } from '../ServiceContainer';

/**
 * ArrController provides a qBittorrent-compatible API for Sonarr and Radarr.
 */
export class ArrController {
	private readonly amuleService = container.get(AmuleService);

	// qBittorrent API: POST /api/v2/auth/login
	login = async (req: Request, res: Response) => {
		// We don't implement full auth yet, just return Ok and a dummy cookie
		res.setHeader('Set-Cookie', 'SID=mularr_dummy_session; HttpOnly; Path=/');
		res.send('Ok.');
	};

	// qBittorrent API: GET /api/v2/app/version
	getVersion = async (req: Request, res: Response) => {
		res.send('v4.3.3');
	};

	// qBittorrent API: GET /api/v2/app/webapiVersion
	getWebApiVersion = async (req: Request, res: Response) => {
		res.send('2.8.3');
	};

	// qBittorrent API: GET /api/v2/torrents/info
	getTorrents = async (req: Request, res: Response) => {
		try {
			const transfers: any = await this.amuleService.getTransfers();

			const qbitTorrents = [
				...(transfers.downloads || []).map((t: any) => ({
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
					completion_on: t.progress === 1 ? Math.floor(Date.now() / 1000) : 0,
					category: 'mularr',
				})),
				...(transfers.shared || []).map((t: any) => ({
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
					completion_on: Math.floor(Date.now() / 1000),
					category: 'mularr',
				})),
			];

			res.json(qbitTorrents);
		} catch (e: any) {
			console.error('ArrController getTorrents Error:', e);
			res.status(500).json({ error: e.message });
		}
	};

	// qBittorrent API: POST /api/v2/torrents/add
	addTorrent = async (req: Request, res: Response) => {
		try {
			// qBittorrent transmits URLs in a field called 'urls'
			const { urls } = req.body;
			if (!urls) {
				return res.status(400).send('No URLs provided');
			}

			const urlList = typeof urls === 'string' ? urls.split('\n') : urls;

			for (const url of urlList) {
				const trimmedUrl = url.trim();
				if (trimmedUrl) {
					console.log(`[ArrController] Adding download from Sonarr/Radarr: ${trimmedUrl}`);
					await this.amuleService.addDownload(trimmedUrl);
				}
			}
			res.send('Ok.');
		} catch (e: any) {
			console.error('ArrController addTorrent Error:', e);
			res.status(500).send(e.message);
		}
	};

	// qBittorrent API: POST /api/v2/torrents/delete
	deleteTorrent = async (req: Request, res: Response) => {
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
			console.error('ArrController deleteTorrent Error:', e);
			res.status(500).send(e.message);
		}
	};

	getPreferences = async (req: Request, res: Response) => {
		res.json({
			save_path: '/incoming',
			temp_path: '/temp',
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
