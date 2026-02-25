import * as path from 'path';
import * as fs from 'fs';
import { Api, TelegramClient } from 'telegram';
import { ActiveDownloadRow, TelegramIndexerDB } from './db/TelegramIndexerDB';
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

export class TelegramDownloadDirectoryHelper {
	private readonly amuleService = container.get(AmuleService);
	private readonly amuledService = container.get(AmuledService);
	private readonly mainDb = container.get(MainDB);

	public async getDownloadTempDir() {
		const cfg = await this.amuledService.getConfig();
		const tempDir = cfg.tempDir || cfg.incomingDir || path.dirname(this.mainDb.dbPath);
		const tgTempDir = path.join(tempDir, 'telegram-temp');
		if (!fs.existsSync(tgTempDir)) {
			fs.mkdirSync(tgTempDir, { recursive: true });
		}
		return tgTempDir;
	}

	public async getDownloadDir(hash: string) {
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
}

export class TelegramDownloadManager {
	private activeDownloads: Map<string, DownloadStatus> = new Map();
	private completedDownloads: Map<string, DownloadStatus> = new Map();
	private downloadControls: Map<string, DownloadControl> = new Map();
	private readonly dirHelper = new TelegramDownloadDirectoryHelper();

	private readonly mainDb = container.get(MainDB);

	constructor(
		private readonly getClient: () => TelegramClient | null,
		private readonly getAuthStatus: () => AuthStatus,
		private readonly telegramDb: TelegramIndexerDB
	) {}

	// -- Status queries --

	public getDownloadStatus(hash: string): DownloadStatus | undefined {
		if (this.activeDownloads.has(hash)) {
			return this.activeDownloads.get(hash);
		}
		if (this.completedDownloads.has(hash)) {
			return this.completedDownloads.get(hash);
		}
		const dbRecord = this.mainDb.getDownload(hash);
		if (!dbRecord) return undefined;

		return {
			hash,
			fileName: dbRecord.name,
			size: dbRecord.size,
			downloaded: dbRecord.is_completed ? dbRecord.size : 0,
			speed: 0,
			status: dbRecord.is_completed ? 'completed' : 'error',
			startTime: 0,
		};
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

			const outPath = path.join(await this.dirHelper.getDownloadTempDir(), fileName);
			logger.info(`Starting download: ${fileName} -> ${outPath}`);

			// Save to DB for persistence
			this.telegramDb.addActiveDownload({
				hash,
				chat_id: chatId,
				message_id: messageId,
				file_name: fileName,
				out_path: outPath,
				downloaded_bytes: 0,
				file_size: fileSize,
				status: 'downloading',
			});

			const control: DownloadControl = {
				cancelled: false,
				paused: false,
				pausePromise: null,
				pauseResolve: null,
			};
			this.downloadControls.set(hash, control);

			this.runIterDownload(hash, doc, outPath, fileName);

			return true;
		} catch (err) {
			logger.error('Error starting download:', err);
			return false;
		}
	}

	public async resumeActiveDownloads() {
		const active = this.telegramDb.getActiveDownloads();
		if (active.length === 0) return;

		logger.info(`Resuming ${active.length} active downloads...`);

		for (const row of active) {
			this.resumeActiveDownload(row);
		}
	}

	/**
	 * Internal method to resume a single active download from DB record.
	 * Used for retry and initial resume on startup.
	 * @param row
	 * @returns
	 */
	private async resumeActiveDownload(row: ActiveDownloadRow) {
		const client = this.getClient();
		if (!client) return;
		// Skip if already in memory
		if (this.activeDownloads.has(row.hash)) return;

		try {
			const messages = await client.getMessages(row.chat_id, { ids: [row.message_id] });
			if (!messages || messages.length === 0) return;

			const message = messages[0];
			if (!message.media || !(message.media instanceof Api.MessageMediaDocument)) return;

			const doc = message.media.document as Api.Document;

			const status: DownloadStatus = {
				hash: row.hash,
				fileName: row.file_name,
				size: row.file_size,
				downloaded: row.downloaded_bytes,
				speed: 0,
				status: 'downloading',
				startTime: Date.now(),
				lastUpdate: Date.now(),
				lastBytes: row.downloaded_bytes,
			};
			this.activeDownloads.set(row.hash, status);

			const control: DownloadControl = {
				cancelled: false,
				paused: false,
				pausePromise: null,
				pauseResolve: null,
			};
			this.downloadControls.set(row.hash, control);

			this.runIterDownload(row.hash, doc, row.out_path, row.file_name);

			if (row.status === 'paused') {
				this.pauseDownload(row.hash);
			}
		} catch (err) {
			logger.error(`Error resuming download ${row.file_name}:`, err);
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
			this.telegramDb.updateDownloadProgress(hash, status.downloaded, 'paused');
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
		if (status && status.status === 'paused') {
			status.status = 'downloading';
			this.telegramDb.updateDownloadProgress(hash, status.downloaded, 'downloading');
		}
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
			this.telegramDb.removeActiveDownload(hash);
		}
	}

	// -- Core streaming download --

	private async runIterDownload(hash: string, doc: Api.Document, outPath: string, fileName: string) {
		const client = this.getClient()!;
		const control = this.downloadControls.get(hash);
		if (!control) {
			logger.error(`No control found for download ${fileName}`);
			return;
		}
		let fileStream: fs.WriteStream | undefined;

		try {
			// Source of truth for resume: check file size on disk if it exists
			let offsetProgress = 0;
			if (fs.existsSync(outPath)) {
				try {
					const stats = fs.statSync(outPath);
					offsetProgress = stats.size;
					logger.info(`Resuming ${fileName} from disk offset: ${offsetProgress} bytes`);
				} catch (e) {
					logger.warn(`Could not read file size for ${fileName}`);
				}
			}

			// Update DB with current actual progress before starting
			this.telegramDb.updateDownloadProgress(hash, offsetProgress, 'downloading');

			// Open in append mode
			fileStream = fs.createWriteStream(outPath, { flags: 'a' });

			const fileLocation = new Api.InputDocumentFileLocation({
				id: doc.id,
				accessHash: doc.accessHash,
				fileReference: doc.fileReference,
				thumbSize: '',
			});

			let downloadedBytes = offsetProgress;
			let lastDbUpdate = Date.now();

			for await (const chunk of client.iterDownload({
				file: fileLocation,
				requestSize: 1024 * 1024, // 1MB per request for better throughput
				fileSize: doc.size,
				dcId: doc.dcId,
				offset: doc.size.constructor(offsetProgress),
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
					if (s && !control.cancelled) {
						s.status = 'downloading';
						this.telegramDb.updateDownloadProgress(hash, s.downloaded, 'downloading');
					}
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

					// Throttle DB updates (every 5 seconds)
					if (now - lastDbUpdate > 5000) {
						this.telegramDb.updateDownloadProgress(hash, downloadedBytes, 'downloading');
						lastDbUpdate = now;
					}
				}
			}

			await new Promise<void>((resolve, reject) => {
				fileStream!.end((err?: Error | null) => {
					if (err) reject(err);
					else resolve();
				});
			});

			if (control.cancelled) {
				try {
					fs.unlinkSync(outPath);
				} catch {
					logger.warn(`Could not delete file after cancellation: ${outPath}`);
				}
			} else {
				// Final verification (size check)
				logger.info(`Verifying download completion for ${fileName}...`);
				const finalSize = fs.statSync(outPath).size;
				if (finalSize !== doc.size.toJSNumber()) {
					const errMsg = `expected ${doc.size.toJSNumber()}, got ${finalSize}`;
					logger.error(`Download size mismatch for ${fileName}: ${errMsg}`);
					const s = this.activeDownloads.get(hash);
					if (s) {
						s.status = 'error';
						s.speed = 0;
						this.telegramDb.updateDownloadProgress(hash, s.downloaded, 'error', 'Size mismatch: ' + errMsg);
					}
					return;
				}
				logger.info(`Download completed: ${fileName}`);

				const finalDir = await this.dirHelper.getDownloadDir(hash);
				if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });
				const finalPath = path.join(finalDir, fileName);

				// If final destination exists, delete it first (or rename)
				if (fs.existsSync(finalPath)) {
					fs.renameSync(finalPath, `${finalPath}.bak`);
				}
				fs.renameSync(outPath, finalPath);

				const status = this.activeDownloads.get(hash);
				if (status) {
					status.status = 'completed';
					status.downloaded = status.size;
					status.speed = 0;
					this.completedDownloads.set(hash, status);
					this.activeDownloads.delete(hash);
				}
				this.telegramDb.removeActiveDownload(hash);
			}
		} catch (err: any) {
			fileStream?.end();
			logger.error(`Error in runIterDownload for ${fileName}:`, err);
			const s = this.activeDownloads.get(hash);
			if (s) {
				s.status = 'error';
				s.speed = 0;
				this.telegramDb.updateDownloadProgress(hash, s.downloaded, 'error', String(err?.message ?? err));
			}
			// Retry after delay for transient errors (e.g. network issues)
			setTimeout(() => {
				if (control.cancelled) return;
				logger.info(`Retrying download after error: ${fileName}`);
				const row = this.telegramDb.getActiveDownload(hash);
				if (!row) {
					logger.error(`No DB record found for retry of ${fileName}`);
					return;
				}
				this.resumeActiveDownload(row);
			}, 10000);
		} finally {
			this.downloadControls.delete(hash);
		}
	}
}
