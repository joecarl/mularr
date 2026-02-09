import { Request, Response } from 'express';
import { container } from '../services/container/ServiceContainer';
import { AmuleService } from '../services/AmuleService';
import { ValidatorsService } from '../services/ValidatorsService';
import { hashToBtih, extractHashFromMagnet } from './qbittorrentMappings';
import { AmuleCategory } from 'amule-ec-client';

const getCatByName = (ctgs: AmuleCategory[], name: string) => {
	const cat = ctgs.find((c) => c.name === name);
	if (!cat) return ctgs.find((c) => c.id === 0); // Default category
	return cat;
};

/**
 * ArrController provides a qBittorrent-compatible API for Sonarr and Radarr.
 */
export class QbittorrentController {
	private readonly amuleService = container.get(AmuleService);
	private readonly validatorsService = container.get(ValidatorsService);

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
		// https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#get-torrent-generic-properties

		const { hash } = req.query;
		if (!hash || typeof hash !== 'string') {
			return res.status(400).send('No hash provided');
		}

		const categories = await this.amuleService.getCategories();
		const transfers = await this.amuleService.getTransfers();
		const tr = transfers.list.find((t) => t.hash === hash);

		if (tr) {
			const savePath = getCatByName(categories, tr.categoryName ?? '')?.path || '/incoming';
			const properties = {
				addition_date: 0,
				comment: '',
				completion_date: tr.statusId === 9 ? Math.floor(Date.now() / 1000) : 0,
				created_by: '',
				dl_speed: tr.speed || 0,
				eta: tr.timeLeft || 0,
				isPrivate: false,
				peers: tr.sources || 0,
				save_path: savePath,
				seeding_time: 0,
				seeds: tr.sources || 0,
				seeds_total: tr.sources || 0,
				total_downloaded: tr.completed || 0,
				total_size: tr.size || 0,
				up_limit: -1,
				up_speed: 0,
				up_speed_avg: 0,
			};
			return res.json(properties);
		} else {
			return res.status(404).send('Torrent not found');
		}
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

			const requestedCtgName = category as string | undefined;

			const downloads = transfers.list.filter((t) => {
				if (requestedCtgName) {
					return t.categoryName === requestedCtgName;
				}
				return true;
			});

			const qbitTorrents = downloads.map((t) => {
				const savePath = getCatByName(categories, t.categoryName ?? '')?.path || '/incoming';
				const contentPath = t.name ? savePath + '/' + t.name : undefined;

				let state = this.mapStatusIdToQbitState(t.statusId);

				// -- Validator Check --
				// If fully downloaded, check if valid.
				// If not valid, report state = 'checkingUP'.
				if (t.hash && contentPath && t.statusId && t.statusId >= 9) {
					// Trigger validation (non-blocking) - fire and forget
					this.validatorsService.processFile(t.hash, contentPath).catch((err) => console.error(err));

					const isValid = this.validatorsService.getValidationStatus(t.hash);
					if (!isValid) {
						state = 'checkingUP';
					}
				}

				return {
					hash: t.hash || 'unknown',
					name: t.name || 'Unknown',
					size: t.size || 0,
					progress: t.progress || 0,
					dlspeed: t.speed || 0,
					upspeed: 0,
					priority: t.priority || 0,
					num_seeds: t.sources || 0,
					num_leechers: 0,
					state: state,
					save_path: savePath,
					content_path: contentPath,
					added_on: Math.floor(Date.now() / 1000),
					eta: t.timeLeft || 0,
					category: t.categoryName,
				};
			});

			res.json(qbitTorrents);
		} catch (e: any) {
			console.error('QbittorrentController getTorrents Error:', e);
			res.status(500).json({ error: e.message });
		}
	};

	getFiles = async (req: Request, res: Response) => {
		console.log('[QbittorrentController] Torrent files requested');
		const { hash } = req.query;
		if (!hash || typeof hash !== 'string') {
			return res.status(400).send('No hash provided');
		}

		try {
			const transfers = await this.amuleService.getTransfers();
			const tr = transfers.list.find((t) => t.hash === hash);
			if (!tr) {
				return res.status(404).send('Torrent not found');
			}

			const files = [
				{
					index: 0,
					is_seed: tr.statusId === 9,
					name: tr.name || 'Unknown',
					priority: tr.priority || 1,
					progress: tr.progress || 0,
					size: tr.size || 0,
					availability: 1.0,
				},
			];

			res.json(files);
		} catch (e: any) {
			console.error('QbittorrentController getFiles Error:', e);
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

	private mapStatusIdToQbitState(statusId?: number): string {
		switch (statusId) {
			case 0: // Downloading
				return 'downloading';
			case 7: // Paused
				return 'pausedDL';
			case 9: // Completed
				return 'uploading';
			case 3: // Hashing
			case 2: // Waiting for Hash
				return 'checkingDL';
			case 4: // Error
			case 5: // Insufficient Space
				return 'error';
			case 8: // Completing
				return 'moving';
			case 10: // Allocating
				return 'checkingDL';
			default:
				return 'downloading';
		}
	}
}
