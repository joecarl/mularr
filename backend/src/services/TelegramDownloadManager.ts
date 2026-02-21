import * as path from 'path';
import * as fs from 'fs';
import { Api, TelegramClient } from 'telegram';
import { TelegramIndexerDB } from './db/TelegramIndexerDB';
import { MainDB } from './db/MainDB';
import { AmuleService, getCatByName } from './AmuleService';
import { AmuledService } from './AmuledService';
import { AuthStatus } from './TelegramIndexerService';
import { container } from './container/ServiceContainer';

const logger = {
	info: (msg: string) => console.log(`[TelegramDownload] ${msg}`),
	error: (msg: string, err?: any) => console.error(`[TelegramDownload] ${msg}`, err),
	warn: (msg: string) => console.warn(`[TelegramDownload] ${msg}`),
};

export interface DownloadStatus {
	hash: string;
	fileName: string;
	size: number;
	downloaded: number;
	speed: number;
	status: 'downloading' | 'completed' | 'error' | 'stopped' | 'paused';
	startTime: number;
	lastUpdate?: number;
	lastBytes?: number;
}

interface DownloadControl {
	cancelled: boolean;
	paused: boolean;
	pausePromise: Promise<void> | null;
	pauseResolve: (() => void) | null;
}

export class TelegramDownloadManager {
	private activeDownloads: Map<string, DownloadStatus> = new Map();
	private completedDownloads: Map<string, DownloadStatus> = new Map();
	private downloadControls: Map<string, DownloadControl> = new Map();

	private readonly amuleService = container.get(AmuleService);
	private readonly amuledService = container.get(AmuledService);
	private readonly mainDb = container.get(MainDB);

	constructor(
		private readonly getClient: () => TelegramClient | null,
		private readonly getAuthStatus: () => AuthStatus,
		private readonly telegramDb: TelegramIndexerDB
	) {}

	// -- Directory helpers --

	private async getDownloadTempDir() {
		const cfg = await this.amuledService.getConfig();
		const tempDir = cfg.tempDir || cfg.incomingDir || path.dirname(this.mainDb.dbPath);
		const tgTempDir = path.join(tempDir, 'telegram-temp');
		if (!fs.existsSync(tgTempDir)) {
			fs.mkdirSync(tgTempDir, { recursive: true });
		}
		return tgTempDir;
	}

	private async getDownloadDir(hash: string) {
		const cfg = await this.amuledService.getConfig();
		const ctgs = await this.amuleService.getCategories();
		const dl = this.mainDb.getDownload(hash);
		if (dl) {
			const cat = getCatByName(ctgs, dl.category_name || '');
			if (cat && cat.path) {
				return cat.path;
			}
		}
		return cfg.incomingDir;
	}

	// -- Status queries --

	public getDownloadStatus(hash: string): DownloadStatus | undefined {
		if (this.activeDownloads.has(hash)) {
			return this.activeDownloads.get(hash);
		}
		if (this.completedDownloads.has(hash)) {
			return this.completedDownloads.get(hash);
		}
		// hash format: telegram:chatId:messageId
		const parts = hash.split(':');
		if (parts.length >= 3) {
			const msg = this.telegramDb.getMessage(parts[1], parseInt(parts[2]));
			if (msg && msg.file_size) {
				return {
					hash,
					fileName: msg.file_name || 'Unknown',
					size: Number(msg.file_size) || 0,
					downloaded: Number(msg.file_size) || 0,
					speed: 0,
					status: 'completed',
					startTime: 0,
				};
			}
		}
		return undefined;
	}

	// -- Download lifecycle --

	public async startDownload(chatId: string, messageId: number, hash: string): Promise<boolean> {
		const client = this.getClient();
		if (!client || this.getAuthStatus() !== 'connected') {
			logger.error('Cannot start download: Client not connected');
			return false;
		}

		if (this.activeDownloads.has(hash) || this.completedDownloads.has(hash)) {
			return true;
		}

		try {
			const messages = await client.getMessages(chatId, { ids: [messageId] });
			if (!messages || messages.length === 0) {
				logger.error(`Message not found for download: ${chatId}:${messageId}`);
				return false;
			}
			const message = messages[0];
			if (!message.media) {
				logger.error(`Message has no media: ${chatId}:${messageId}`);
				return false;
			}

			if (!(message.media instanceof Api.MessageMediaDocument) || !(message.media.document instanceof Api.Document)) {
				logger.error(`Message media is not a downloadable document: ${chatId}:${messageId}`);
				return false;
			}

			const doc = message.media.document;

			let fileName = `telegram_${hash}`;
			for (const attr of doc.attributes) {
				if (attr instanceof Api.DocumentAttributeFilename) {
					fileName = attr.fileName;
					break;
				}
			}

			const fileSize = doc.size.toJSNumber();

			const status: DownloadStatus = {
				hash,
				fileName,
				size: fileSize,
				downloaded: 0,
				speed: 0,
				status: 'downloading',
				startTime: Date.now(),
				lastUpdate: Date.now(),
				lastBytes: 0,
			};
			this.activeDownloads.set(hash, status);

			const outPath = path.join(await this.getDownloadTempDir(), fileName);
			logger.info(`Starting download: ${fileName} -> ${outPath}`);

			const control: DownloadControl = {
				cancelled: false,
				paused: false,
				pausePromise: null,
				pauseResolve: null,
			};
			this.downloadControls.set(hash, control);

			this.runIterDownload(hash, doc, outPath, fileName).catch((err) => {
				logger.error(`Download failed: ${fileName}`, err);
				const s = this.activeDownloads.get(hash);
				if (s) {
					s.status = 'error';
					s.speed = 0;
				}
			});

			return true;
		} catch (err) {
			logger.error('Error starting download:', err);
			return false;
		}
	}

	public pauseDownload(hash: string) {
		const control = this.downloadControls.get(hash);
		if (!control || control.paused || control.cancelled) return;
		control.paused = true;
		control.pausePromise = new Promise<void>((resolve) => {
			control.pauseResolve = resolve;
		});
		const status = this.activeDownloads.get(hash);
		if (status) {
			status.status = 'paused';
			status.speed = 0;
		}
	}

	public resumeDownload(hash: string) {
		const control = this.downloadControls.get(hash);
		if (!control || !control.paused) return;
		control.paused = false;
		if (control.pauseResolve) {
			control.pauseResolve();
			control.pauseResolve = null;
			control.pausePromise = null;
		}
		const status = this.activeDownloads.get(hash);
		if (status && status.status === 'paused') status.status = 'downloading';
	}

	public cancelDownload(hash: string) {
		const control = this.downloadControls.get(hash);
		if (control) {
			control.cancelled = true;
			// Unblock a paused loop so it exits cleanly
			if (control.paused && control.pauseResolve) {
				control.pauseResolve();
				control.pauseResolve = null;
				control.pausePromise = null;
			}
		}
		const status = this.activeDownloads.get(hash);
		if (status) {
			status.status = 'stopped';
			status.speed = 0;
		}
	}

	// -- Core streaming download --

	private async runIterDownload(hash: string, doc: Api.Document, outPath: string, fileName: string) {
		const client = this.getClient()!;
		const control = this.downloadControls.get(hash)!;
		const fileStream = fs.createWriteStream(outPath);

		try {
			const fileLocation = new Api.InputDocumentFileLocation({
				id: doc.id,
				accessHash: doc.accessHash,
				fileReference: doc.fileReference,
				thumbSize: '',
			});

			let downloadedBytes = 0;

			for await (const chunk of client.iterDownload({
				file: fileLocation,
				requestSize: 512 * 1024, // 512 KB per request
				fileSize: doc.size,
				dcId: doc.dcId,
			})) {
				// Check cancellation before processing chunk
				if (control.cancelled) {
					logger.info(`Download cancelled: ${fileName}`);
					break;
				}

				// Suspend iteration while paused
				if (control.paused && control.pausePromise) {
					await control.pausePromise;
					const s = this.activeDownloads.get(hash);
					if (s && !control.cancelled) s.status = 'downloading';
				}

				// Re-check after potential resume
				if (control.cancelled) break;

				fileStream.write(chunk as Buffer);
				downloadedBytes += (chunk as Buffer).length;

				// Rolling speed & progress update
				const now = Date.now();
				const status = this.activeDownloads.get(hash);
				if (status) {
					if (status.lastUpdate && now - status.lastUpdate > 1000) {
						const diffBytes = downloadedBytes - (status.lastBytes || 0);
						const diffTime = (now - status.lastUpdate) / 1000;
						status.speed = diffTime > 0 ? diffBytes / diffTime : 0;
						status.lastUpdate = now;
						status.lastBytes = downloadedBytes;
					}
					status.downloaded = downloadedBytes;
				}
			}

			fileStream.end();

			if (control.cancelled) {
				try {
					fs.unlinkSync(outPath);
				} catch {
					/* ignore */
				}
			} else {
				logger.info(`Download completed: ${fileName}`);
				const finalDir = await this.getDownloadDir(hash);
				if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });
				const finalPath = path.join(finalDir, fileName);
				fs.renameSync(outPath, finalPath);

				const status = this.activeDownloads.get(hash);
				if (status) {
					status.status = 'completed';
					status.downloaded = status.size;
					status.speed = 0;
					this.completedDownloads.set(hash, status);
					this.activeDownloads.delete(hash);
				}
			}
		} catch (err) {
			fileStream.end();
			try {
				if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
			} catch {
				/* ignore */
			}
			throw err;
		} finally {
			this.downloadControls.delete(hash);
		}
	}
}
