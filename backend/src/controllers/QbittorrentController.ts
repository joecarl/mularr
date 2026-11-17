import { Request, Response } from 'express';
import { container } from '../services/container/ServiceContainer';
import { AmuleService, getCatByName } from '../services/AmuleService';
import { MediaProviderService } from '../services/mediaprovider';
import { ExtensionsService } from '../services/ExtensionsService';
import { AmuledService } from '../services/AmuledService';
import { AuthService } from '../services/AuthService';
import { hashToBtih, extractFileRefFromMagnet, clientHashMatchesMularrHash, seedStats, parseShareLimit } from './qbittorrentMappings';
import { applyHispashareSeedPolicy } from '../services/mediaprovider/hispashareSeedPolicy';
import { LoggerFactory } from '../services/logging/Logger';
import { __APP_CONFIG__ } from '../app-env';

/**
 * ArrController provides a qBittorrent-compatible API for Sonarr and Radarr.
 */
export class QbittorrentController {
	private readonly logger = LoggerFactory.create(this);
	private readonly amuleService = container.get(AmuleService);
	private readonly amuledService = container.get(AmuledService);
	private readonly mediaProviderService = container.get(MediaProviderService);
	private readonly extensionsService = container.get(ExtensionsService);
	private readonly authService = container.get(AuthService);

	// qBittorrent API: POST /api/v2/auth/login
	login = async (req: Request, res: Response) => {
		const { username, password } = req.body;

		// If auth is not enabled, always succeed (open mode)
		if (!this.authService.isAuthEnabled()) {
			this.authService.setSidCookieOpenMode(res);
			res.send('Ok.');
			return;
		}

		// Accept username/password matching AUTH credentials, or API_KEY as password
		const validCredentials = this.authService.validateCredentials(username ?? '', password ?? '');
		const validApiKey = this.authService.validateApiKey(password ?? '');

		if (!validCredentials && !validApiKey) {
			res.send('Fails.');
			return;
		}

		// Always generate a JWT as SID so the cookie value is always a safe,
		// consistent format regardless of whether login was via credentials or API key.
		// API-key logins get a non-expiring token so integrations like Sonarr/Radarr
		// are never broken by token expiry (they do not re-authenticate on 401).
		const session = this.authService.generateToken(validCredentials ? username : '__apikey__', validApiKey);

		this.logger.info('Login successful for Sonarr/Radarr');
		// Max-Age matches the JWT lifetime — cookie and token expire together.
		this.authService.setSidCookie(res, session);
		res.send('Ok.');
	};

	// qBittorrent API: GET /api/v2/app/version
	getVersion = async (req: Request, res: Response) => {
		this.logger.debug('Version requested');
		res.send('v4.3.3');
	};

	// qBittorrent API: GET /api/v2/app/webapiVersion
	getWebApiVersion = async (req: Request, res: Response) => {
		this.logger.debug('WebAPI Version requested');
		res.send('2.0');
	};

	getCategories = async (req: Request, res: Response) => {
		this.logger.debug('Categories requested');
		const categories = await this.amuleService.getCategories();
		const dict: any = {};
		categories.forEach((cat) => {
			if (!cat.name) return;
			dict[cat.name] = {
				name: cat.name,
				savePath: cat.path,
			};
		});
		res.json(dict);
	};

	getProperties = async (req: Request, res: Response) => {
		this.logger.debug('Torrent properties requested');
		// https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#get-torrent-generic-properties

		const { hash } = req.query;
		if (!hash || typeof hash !== 'string') {
			return res.status(400).send('No hash provided');
		}
		const config = await this.amuledService.getConfig();
		const categories = await this.amuleService.getCategories();
		const transfers = await this.mediaProviderService.getTransfers();
		// Sonarr sends the 40-hex btih we advertised; match it back to the transfer.
		const tr = transfers.list.find((t) => clientHashMatchesMularrHash(t.hash, hash));

		if (tr) {
			const savePath = getCatByName(categories, tr.categoryName ?? '')?.path || config.incomingDir;
			const seed = seedStats(tr, __APP_CONFIG__.seeding);
			const completedAt = tr.completedOn ? Date.parse(tr.completedOn) : NaN;
			const properties = {
				addition_date: 0,
				comment: '',
				completion_date: tr.statusId === 9 ? Math.floor((Number.isFinite(completedAt) ? completedAt : Date.now()) / 1000) : 0,
				created_by: '',
				dl_speed: tr.speed || 0,
				eta: tr.timeLeft || 0,
				isPrivate: false,
				peers: tr.sourceCount || 0,
				save_path: savePath,
				seeding_time: seed.seeding_time,
				seeds: tr.sourceCount || 0,
				seeds_total: tr.sourceCount || 0,
				share_ratio: seed.ratio,
				total_downloaded: tr.completed || 0,
				total_size: tr.size || 0,
				total_uploaded: tr.uploadedTotal || 0,
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
		this.logger.debug('Create Category requested');
		const { category, savePath } = req.body;
		if (!category) {
			return res.status(400).send('Category name is empty');
		}
		try {
			this.logger.info(`Creating category: ${category} with path: ${savePath}`);
			await this.amuleService.createCategory({
				name: category,
				path: savePath,
			});
			res.send('');
		} catch (e: any) {
			this.logger.error('QbittorrentController createCategory Error:', e);
			res.status(500).send(e.message);
		}
	};

	setCategory = async (req: Request, res: Response) => {
		this.logger.debug('Set Category requested');
		const { hashes, category } = req.body;
		if (!hashes || !category) {
			return res.status(400).send('Hash and category are required');
		}
		if (hashes === 'all') {
			return res.status(400).send('Setting category for all torrents is not supported');
		}
		const hashList = hashes.split('|');
		// Resolve the btih(s) Sonarr sends back to transfer hashes (one fetch).
		const transfers = await this.mediaProviderService.getTransfers();
		for (const hash of hashList) {
			if (!hash) continue;
			const match = transfers.list.find((t) => clientHashMatchesMularrHash(t.hash, hash));
			await this.setCategoryForHash(match?.hash ?? hash, category);
		}
		res.send('');
	};

	private async setCategoryForHash(hash: string, category: string): Promise<void> {
		const categories = await this.mediaProviderService.getCategories();
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

		if (categoryId !== undefined) {
			await this.mediaProviderService.setFileCategory(hash, categoryId, true);
		}
	}

	// qBittorrent API: GET /api/v2/torrents/info
	getTorrents = async (req: Request, res: Response) => {
		this.logger.debug('Torrents info requested');
		const { category } = req.query;
		try {
			const transfers = await this.mediaProviderService.getTransfers();
			const categories = await this.amuleService.getCategories();
			const config = await this.amuledService.getConfig();

			const requestedCtgName = category as string | undefined;

			const downloads = transfers.list.filter((t) => {
				if (requestedCtgName) {
					return t.categoryName === requestedCtgName;
				}
				return true;
			});

			const qbitTorrents = downloads.map((t) => {
				const savePath = getCatByName(categories, t.categoryName ?? '')?.path || config.incomingDir;
				const contentPath = t.name ? savePath + '/' + t.name : undefined;

				let state = this.mapStatusIdToQbitState(t.statusId);

				// -- Validator Check --
				// If fully downloaded, check if valid.
				// If not valid, report state = 'checkingUP'.
				if (t.hash && contentPath && t.statusId && t.statusId >= 9) {
					// Trigger validation (non-blocking) - fire and forget
					this.extensionsService.processFile(t.hash, contentPath).catch((err) => this.logger.error('Validator processing failed:', err));

					const isValid = this.extensionsService.getValidationStatus(t.hash);
					if (!isValid) {
						state = 'checkingUP';
					}
				}

				return {
					// Report the 40-hex btih (sha1 of the transfer hash), not the
					// raw hash: it must equal the infohash in the magnet Sonarr
					// grabbed, or Sonarr can't match this download to its queue
					// entry (no progress, no import). The validator calls above
					// still use the real t.hash internally.
					hash: t.hash ? hashToBtih(t.hash) : 'unknown',
					name: t.name || 'Unknown',
					size: t.size || 0,
					progress: t.progress || 0,
					dlspeed: t.speed || 0,
					upspeed: 0,
					priority: t.priority || 0,
					num_seeds: t.sourceCount || 0,
					num_leechers: 0,
					state: state,
					save_path: savePath,
					content_path: contentPath,
					added_on: Math.floor(Date.now() / 1000),
					eta: t.timeLeft || 0,
					category: t.categoryName,
					uploaded: t.uploadedTotal || 0,
					// Real ratio (aMule's all-time upload count over the size) and the seed limits
					// Sonarr/Radarr set on the download, or the configured ones. Without limits the
					// download is removable right after import, so they move the file and delete the
					// download; with one, they copy the file and remove it once the limit is reached.
					...seedStats(t, __APP_CONFIG__.seeding),
				};
			});

			res.json(qbitTorrents);
		} catch (e: any) {
			this.logger.error('QbittorrentController getTorrents Error:', e);
			res.status(500).json({ error: e.message });
		}
	};

	getFiles = async (req: Request, res: Response) => {
		this.logger.debug('Torrent files requested');
		const { hash } = req.query;
		if (!hash || typeof hash !== 'string') {
			return res.status(400).send('No hash provided');
		}

		try {
			const transfers = await this.mediaProviderService.getTransfers();
			const tr = transfers.list.find((t) => clientHashMatchesMularrHash(t.hash, hash));
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
			this.logger.error('QbittorrentController getFiles Error:', e);
			res.status(500).json({ error: e.message });
		}
	};

	// qBittorrent API: POST /api/v2/torrents/add
	addTorrent = async (req: Request, res: Response) => {
		this.logger.debug('Add torrent requested');
		try {
			// qBittorrent transmits URLs in a field called 'urls'
			const { urls, category, paused, stopped } = req.body;
			if (!urls) {
				return res.status(400).send('No URLs provided');
			}

			// Sonarr/Radarr send the initial-state flag as a urlencoded STRING
			// "false"/"true" (param "paused" pre qBit API 2.11, "stopped" after).
			// A bare `if (paused)` treats the string "false" as truthy and pauses
			// every download — they then sit paused in aMule's queue forever,
			// since the *arr client added them as Start and never resumes. So
			// pause only on an explicit true (boolean or string).
			const shouldPause = paused === true || paused === 'true' || stopped === true || stopped === 'true';

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
				this.logger.debug(`Parsing magnet: ${trimmedUrl}`);
				const fileRef = extractFileRefFromMagnet(trimmedUrl);
				if (!fileRef) {
					this.logger.warn(`⚠️ Could not extract file reference from magnet link. Skipping.`);
					continue; // Skip invalid magnet links
				}

				this.logger.info(`Adding download for the extracted file reference: ${fileRef.ref}`);
				await this.mediaProviderService.addDownload(fileRef.ref);

				const hash = fileRef.hash;

				if (categoryId) {
					this.logger.info(`Setting category ID ${categoryId} for hash ${hash}`);
					// Use MediaProviderService (not amuleService) so the category
					// persists to mularr's DB, not only in aMule over EC.
					// getTransfers reads categoryName from the DB record, so
					// without this the download surfaces under the DEFAULT
					// category and Sonarr's torrents/info?category= filter drops
					// it — it never enters the queue. Mirrors the setCategory endpoint.
					await this.mediaProviderService.setFileCategory(hash, categoryId);
				}

				if (shouldPause) {
					this.logger.info(`Pausing download for hash ${hash}`);
					await this.mediaProviderService.sendDownloadCommand(hash, 'pause');
				}
			}

			res.send('Ok.');
		} catch (e: any) {
			this.logger.error('QbittorrentController addTorrent Error:', e);
			res.status(500).send(e.message);
		}
	};

	// qBittorrent API: POST /api/v2/torrents/setShareLimits
	// Sonarr/Radarr call it right after adding a download when their indexer has a Seed Ratio and/or
	// Seed Time (minutes) set; they later read the limits back from torrents/info to decide when the
	// download may be removed. -2 (use the client's global limit) and -1 (none) both mean no limit here.
	setShareLimits = async (req: Request, res: Response) => {
		this.logger.debug('Set share limits requested');
		try {
			const { hashes, ratioLimit, seedingTimeLimit } = req.body;
			if (!hashes) return res.status(400).send('No hashes provided');
			if (hashes === 'all') return res.status(400).send('Setting share limits for all torrents is not supported');
			const ratio = parseShareLimit(ratioLimit);
			const minutes = parseShareLimit(seedingTimeLimit);
			const transfers = await this.mediaProviderService.getTransfers();
			for (const hash of (hashes as string).split('|')) {
				if (!hash) continue;
				const match = transfers.list.find((t) => clientHashMatchesMularrHash(t.hash, hash));
				const targetHash = match?.hash ?? hash;
				// Hispashare downloads never get a limit: the *arr keep reading what they sent, but the stored
				// -1/-1 means "no limit of that kind", so they never remove the download, and its file.
				const keepSharing = applyHispashareSeedPolicy(targetHash);
				const found = this.mediaProviderService.setSeedLimits(targetHash, keepSharing ? -1 : ratio, keepSharing ? -1 : minutes);
				if (!found) {
					this.logger.warn(`Share limits requested for an unknown download: ${hash}`);
					return res.status(404).send('Torrent hash was not found');
				}
				this.logger.info(
					`Seed limits for ${targetHash}: ratio ${keepSharing ? 'none (Hispashare keeps sharing)' : (ratio ?? 'none')}, time ${keepSharing ? 'none (Hispashare keeps sharing)' : minutes === null ? 'none' : `${minutes} min`}`
				);
			}
			res.send('Ok.');
		} catch (e: any) {
			this.logger.error('QbittorrentController setShareLimits Error:', e);
			res.status(500).send(e.message);
		}
	};

	// qBittorrent API: POST /api/v2/torrents/delete
	deleteTorrent = async (req: Request, res: Response) => {
		this.logger.debug('Delete torrent requested');
		try {
			const { hashes } = req.body;
			if (!hashes) return res.status(400).send('No hashes provided');

			const hashList = hashes.split('|');
			// Resolve the btih(s) Sonarr sends back to transfer hashes, falling
			// back to the input when no transfer matches (raw hash, or the
			// download is already gone — cancel is then a harmless no-op).
			const transfers = await this.mediaProviderService.getTransfers();
			for (const hash of hashList) {
				if (!hash) continue;
				const match = transfers.list.find((t) => clientHashMatchesMularrHash(t.hash, hash));
				await this.mediaProviderService.sendDownloadCommand(match?.hash ?? hash, 'cancel');
			}
			res.send('Ok.');
		} catch (e: any) {
			this.logger.error('QbittorrentController deleteTorrent Error:', e);
			res.status(500).send(e.message);
		}
	};

	getPreferences = async (req: Request, res: Response) => {
		this.logger.debug('Preferences requested');
		const config = await this.amuledService.getConfig();
		const { ratioLimit, timeLimitMinutes } = __APP_CONFIG__.seeding;
		res.json({
			save_path: config.incomingDir,
			temp_path: config.tempDir,
			dht: true,
			// The configured limits, as qBittorrent's global ones. Only read for torrents reporting -2,
			// which torrents/info never does (it resolves them itself); kept coherent anyway.
			max_ratio_enabled: ratioLimit > 0,
			max_ratio: ratioLimit > 0 ? ratioLimit : -1,
			max_seeding_time_enabled: timeLimitMinutes > 0,
			max_seeding_time: timeLimitMinutes > 0 ? timeLimitMinutes : -1,
			max_inactive_seeding_time_enabled: false,
			max_inactive_seeding_time: -1,
		});
	};

	private mapStatusIdToQbitState(statusId?: number): string {
		switch (statusId) {
			case 0: // Downloading
				return 'downloading';
			case 7: // Paused
				return 'pausedDL';
			case 9: // Completed
				// pausedUP, NOT uploading: both map to Sonarr's "Completed" so
				// import fires, but only pausedUP/stoppedUP lets Sonarr remove
				// the download after import (with Remove Completed Downloads on).
				// 'uploading' reads as still seeding, so it's never removed.
				// aMule keeps sharing the file regardless of what we report.
				return 'pausedUP';
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
