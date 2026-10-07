import * as fs from 'fs';
import * as nodePath from 'path';
import { __APP_CONFIG__ } from '../../app-env';
import { container } from '../container/ServiceContainer';
import { AmuleService } from '../AmuleService';
import { AmuledService } from '../AmuledService';
import { MainDB, blacklistEntryMatches, type DownloadDbRecord } from '../db/MainDB';
import { AppEvents, toDownloadEventPayload } from '../AppEvents';
import { parseEd2kLink } from '../../tools/eD2kTools';
import { AmuleMediaProvider } from './adapters/AmuleMediaProvider';
import { TelegramMediaProvider } from './adapters/TelegramMediaProvider';
import { HispashareMediaProvider } from './adapters/HispashareMediaProvider';
import type { MediaCategory, IMediaProvider, MediaSearchResult, MediaTransfer, MediaTransfersResponse, SearchProviderId } from './types';
import { LoggerFactory } from '../logging/Logger';

/** The source of a move is not on disk (typically already moved away by Sonarr/Radarr on import). */
class FileNotFoundError extends Error {
	constructor(readonly path: string) {
		super(`file not found on disk: ${path}`);
		this.name = 'FileNotFoundError';
	}
}

/**
 * How long a transfers snapshot is served from cache. Building one chains several EC requests,
 * reads amule.conf and has side effects (completion detection, events), and it is requested by
 * WsBroadcastService every 2 s, SpeedHistoryService every 5 s and by Sonarr in bursts (torrents/info
 * followed by properties/files per torrent). The TTL matches the media:transfers broadcast period,
 * so nothing served from the cache is staler than what the UI already shows; mutations invalidate it.
 */
const TRANSFERS_CACHE_TTL_MS = 2000;

export class MediaProviderService {
	private readonly logger = LoggerFactory.create(this);
	/** Search fan-out lives in MediaSearchService, which reads the providers from here. */
	public readonly providers: IMediaProvider[] = [];
	private readonly db = container.get(MainDB);
	private readonly events = container.get(AppEvents);
	private readonly amuleService = container.get(AmuleService);
	private readonly amuledService = container.get(AmuledService);
	private transfersCache: { snapshot: Promise<MediaTransfersResponse>; expiresAt: number } | null = null;

	constructor() {
		// Order matters: first matching provider wins for canHandleDownload
		this.providers.push(new TelegramMediaProvider());
		// Search-only (its files are downloaded by aMule) and reaches the internet, so it is left out in mock mode
		if (!__APP_CONFIG__.mockMode) this.providers.push(new HispashareMediaProvider());
		this.providers.push(new AmuleMediaProvider());
	}

	/** Ids of the providers a search reaches right now (see IMediaProvider.isAvailable), in fan-out order. */
	public getAvailableSearchProviders(): SearchProviderId[] {
		return this.providers.filter((p) => p.isAvailable()).map((p) => p.providerId as SearchProviderId);
	}

	// ---- Transfers -------------------------------------------------------------

	/** Current transfers across providers, served from a short-lived cache (see TRANSFERS_CACHE_TTL_MS). */
	getTransfers(): Promise<MediaTransfersResponse> {
		if (!this.transfersCache || this.transfersCache.expiresAt <= Date.now()) {
			const entry = { snapshot: this.buildTransfers(), expiresAt: Date.now() + TRANSFERS_CACHE_TTL_MS };
			// Don't keep a failed build around
			entry.snapshot.catch(() => {
				if (this.transfersCache === entry) this.transfersCache = null;
			});
			this.transfersCache = entry;
		}
		return this.transfersCache.snapshot;
	}

	/** Drops the cached snapshot so the next getTransfers() reflects a mutation immediately. */
	private invalidateTransfers(): void {
		this.transfersCache = null;
	}

	private async buildTransfers(): Promise<MediaTransfersResponse> {
		const perProvider = await Promise.allSettled(this.providers.map((p) => p.getTransfers()));
		const combined: MediaTransfer[] = [];
		for (const r of perProvider) {
			if (r.status === 'fulfilled') combined.push(...r.value);
		}
		this.applyDownloadRecords(combined);

		let categories: MediaCategory[] = [];
		try {
			categories = await this.amuleService.getCategories();
		} catch (_e) {}

		// Enrich each transfer with its resolved absolute file path
		try {
			const incomingDir = await this.getIncomingDir();

			for (const transfer of combined) {
				if (!transfer.name) continue;
				if (transfer.isCompleted) {
					const cat = transfer.categoryName ? categories.find((c) => c.name === transfer.categoryName) : undefined;
					transfer.filePath = this.resolveFilePath(transfer.name, cat?.path, incomingDir);
				}
				// amule in-progress: temp files are hash-named .part files — not useful(?)
			}
		} catch (_e) {}

		return { raw: `Downloads (${combined.length})`, list: combined, categories };
	}

	async clearCompletedTransfers(hashes?: string[]): Promise<void> {
		await Promise.allSettled(this.providers.map((p) => p.clearCompletedTransfers(hashes)));
		this.invalidateTransfers();
	}

	/**
	 * Fills in what the download record keeps and the providers don't: the seed limits, and sourceName/webUrl
	 * from the search-result snapshot (see DownloadDbRecord.search_result) when the provider did not set them.
	 */
	private applyDownloadRecords(transfers: MediaTransfer[]): void {
		const byHash = new Map<string, DownloadDbRecord>();
		for (const d of this.db.getAllDownloads()) byHash.set(d.hash.toLowerCase(), d);
		for (const t of transfers) {
			const record = t.hash ? byHash.get(t.hash.toLowerCase()) : undefined;
			if (!record) continue;
			t.seedRatioLimit = record.seed_ratio_limit ?? null;
			t.seedTimeLimit = record.seed_time_limit ?? null;
			if (!record.search_result) continue;
			try {
				const r = JSON.parse(record.search_result) as Partial<MediaSearchResult>;
				if (!t.sourceName && r.sourceName) t.sourceName = r.sourceName;
				if (!t.webUrl && r.webUrl) t.webUrl = r.webUrl;
			} catch {
				// A corrupt snapshot only loses the label
			}
		}
	}

	// ---- Seed limits -----------------------------------------------------------

	/**
	 * Sets the seed limits of a download (see DownloadDbRecord.seed_ratio_limit). Null removes a limit.
	 * Resolves false when no download record has that hash.
	 */
	setSeedLimits(hash: string, ratioLimit: number | null, timeLimitMinutes: number | null): boolean {
		const key = hash.toLowerCase();
		if (!this.db.getDownload(key)) return false;
		this.db.setDownloadSeedLimits(key, ratioLimit, timeLimitMinutes);
		this.invalidateTransfers();
		return true;
	}

	// ---- Download management ---------------------------------------------------

	async addDownload(link: string): Promise<{ duplicate?: DownloadDbRecord }> {
		this.assertNotBlacklisted(link);
		const duplicate = this.findExistingDownload(link);
		const provider = this.providers.find((p) => p.canHandleDownload(link));
		if (!provider) throw new Error(`No provider can handle link: ${link}`);
		await provider.addDownload(link);
		this.invalidateTransfers();
		if (!duplicate) {
			// Providers swallow their own failures, so the tracked record is the proof that the download was really added
			const { hash } = this.parseLinkIdentity(link);
			const record = hash ? this.db.getDownload(hash) : undefined;
			if (record) this.events.emit('download.added', { ...toDownloadEventPayload(record, provider.providerId), link });
		}
		return { duplicate };
	}

	/** Throws when the link/hash to download is blacklisted. */
	private assertNotBlacklisted(link: string): void {
		const { hash, size } = this.parseLinkIdentity(link);
		if (!hash) return;
		const entry = this.db.getBlacklistEntry(hash);
		if (!entry || !blacklistEntryMatches(entry, size)) return;
		throw new Error(`This file is blacklisted${entry.name ? `: ${entry.name}` : ''}`);
	}

	/** Extracts the (hash, size) file identity from a link/hash, when recognizable. */
	private parseLinkIdentity(link: string): { hash: string | null; size: number | null } {
		if (link.startsWith('telegram:')) return { hash: link, size: null };
		const ed2k = parseEd2kLink(link);
		if (ed2k) return { hash: ed2k.hash, size: ed2k.size };
		if (/^[a-fA-F0-9]{32}$/.test(link)) return { hash: link.toLowerCase(), size: null };
		return { hash: null, size: null };
	}

	/**
	 * Returns the already-tracked download matching the link, if any.
	 * ed2k identifies a file by (hash, size): a hash match is discarded only when
	 * both sizes are known and differ (the name may differ freely).
	 */
	private findExistingDownload(link: string): DownloadDbRecord | undefined {
		const { hash, size } = this.parseLinkIdentity(link);
		if (!hash) return undefined;
		const record = this.db.getDownload(hash);
		if (!record) return undefined;
		if (record.size && size && record.size !== size) return undefined;
		return record;
	}

	async sendDownloadCommand(hash: string, command: 'pause' | 'resume' | 'stop' | 'cancel'): Promise<void> {
		const provider = this.providers.find((p) => p.canHandleDownload(hash)) ?? this.providers[this.providers.length - 1];
		switch (command) {
			case 'pause':
				await provider.pauseDownload(hash);
				break;
			case 'resume':
				await provider.resumeDownload(hash);
				break;
			case 'stop':
				await provider.stopDownload(hash);
				break;
			case 'cancel': {
				// Read the record before removing it so the event carries name/size/category
				const dbRecord = this.db.getDownload(hash.toLowerCase());
				await this.deleteFileForCompletedDownload(hash);
				await provider.removeDownload(hash);
				this.events.emit('download.cancelled', toDownloadEventPayload(dbRecord ?? { hash }, provider.providerId));
				break;
			}
			default:
				throw new Error(`Unknown command: ${command}`);
		}
		this.invalidateTransfers();
	}

	/**
	 * Delete the file associated with a completed download record from disk.
	 */
	private async deleteFileForCompletedDownload(hash: string): Promise<void> {
		try {
			const dbRecord = this.db.getDownload(hash.toLowerCase());
			if (!dbRecord?.name) return;
			if (!dbRecord.is_completed) return;
			const incomingDir = await this.getIncomingDir();
			const categories = await this.getCategories();
			const cat = dbRecord.category_name ? categories.find((c) => c.name === dbRecord.category_name) : undefined;
			const targetPath = this.resolveFilePath(dbRecord.name, cat?.path, incomingDir);
			if (targetPath && nodePath.isAbsolute(targetPath) && fs.existsSync(targetPath)) {
				await fs.promises.unlink(targetPath);
				this.logger.info(`Deleted file: ${targetPath}`);
			}
		} catch (e) {
			this.logger.error('Error deleting file on cancel:', e);
		}
	}

	// ---- Categories (amule-specific, proxied) ----------------------------------

	async getCategories(): Promise<MediaCategory[]> {
		return this.amuleService.getCategories();
	}

	/**
	 * Change the category of a file in aMule and update the DB.
	 * If `moveFiles` is true and the completed file exists on disk, it is moved
	 * from its current location to the new category directory using filename-based resolution
	 * (no reliance on aMule's shared-files hash list).
	 */
	async setFileCategory(hashHex: string, categoryId: number, moveFiles = false): Promise<void> {
		const categories = await this.amuleService.getCategories();
		const newCat = categories.find((c) => c.id === categoryId);

		// Resolve old location before updating DB
		const dbRecord = this.db.getDownload(hashHex.toLowerCase());
		const oldCatName = dbRecord?.category_name ?? null;
		const oldCat = oldCatName ? categories.find((c) => c.name === oldCatName) : categories.find((c) => c.id === 0);

		// Delegate EC protocol update to AmuleService
		await this.amuleService.setFileCategory(hashHex, categoryId);

		// Update our DB record with the new category name (or empty string for "none")
		const catName = categoryId === 0 ? null : newCat ? newCat.name : null;
		if (catName !== undefined) {
			this.db.setDownloadCategory(hashHex.toLowerCase(), catName);
		}

		if (moveFiles && dbRecord?.is_completed && dbRecord.name) {
			const incomingDir = await this.getIncomingDir();
			const srcPath = this.resolveFilePath(dbRecord.name, oldCat?.path, incomingDir);
			const destPath = this.resolveFilePath(dbRecord.name, newCat?.path, incomingDir);
			try {
				const wasMoved = await this.moveFile(srcPath, destPath);
				if (wasMoved) this.logger.info(`Moved: ${srcPath} -> ${destPath}`);
			} catch (e: any) {
				// Sonarr/Radarr move (not copy) the file when we report pausedUP with the seed limit
				// reached, so by the time they switch the category the source is usually gone. Expected.
				if (e instanceof FileNotFoundError) this.logger.warn(`Skipping move, ${e.message}`);
				else this.logger.error(`Error moving file ${srcPath} -> ${destPath}:`, e);
			}
		}
		this.invalidateTransfers();
	}

	/**
	 * Move all completed files that belong to a category from oldCatPath to newCatPath.
	 * Called after a category's save path is changed.
	 * Pass empty string for a path to mean "use aMule's global IncomingDir".
	 */
	async moveCategoryCompletedFiles(categoryName: string, oldCatPath: string, newCatPath: string): Promise<{ moved: number; errors: string[] }> {
		const downloads = this.db.getAllDownloads().filter((d) => d.is_completed === 1 && d.category_name === categoryName);

		if (downloads.length === 0) return { moved: 0, errors: [] };

		const incomingDir = await this.getIncomingDir();
		let moved = 0;
		const errors: string[] = [];

		for (const dl of downloads) {
			if (!dl.name) continue;
			try {
				const srcPath = this.resolveFilePath(dl.name, oldCatPath || undefined, incomingDir);
				const destPath = this.resolveFilePath(dl.name, newCatPath || undefined, incomingDir);

				const wasMoved = await this.moveFile(srcPath, destPath);
				if (!wasMoved) continue;
				this.logger.info(`Moved: ${srcPath} -> ${destPath}`);
				moved++;
			} catch (e: any) {
				this.logger.error(`Error moving ${dl.name}:`, e);
				errors.push(`Failed to move "${dl.name}": ${e.message}`);
			}
		}

		this.invalidateTransfers();
		return { moved, errors };
	}

	// ---- Maintenance ----------------------------------------------------------

	/**
	 * Scan all completed download records and remove any whose file no longer
	 * exists on disk. Works for every provider because it resolves the path the
	 * same way the rest of the service does (category dir or incomingDir + name).
	 */
	async cleanDeadDownloadRecords(): Promise<number> {
		const completedRecords = this.db.getAllDownloads().filter((r) => r.is_completed === 1);
		if (completedRecords.length === 0) return 0;

		const incomingDir = await this.getIncomingDir();
		const categories = await this.getCategories();

		let deleted = 0;
		for (const record of completedRecords) {
			if (!record.name) continue;
			const cat = record.category_name ? categories.find((c) => c.name === record.category_name) : undefined;
			const filePath = this.resolveFilePath(record.name, cat?.path, incomingDir);
			if (!nodePath.isAbsolute(filePath)) continue; // safety guard
			if (!fs.existsSync(filePath)) {
				this.db.deleteDownload(record.hash);
				deleted++;
				this.logger.info(`Removed dead record: ${record.name} (${record.hash})`);
			}
		}
		if (deleted > 0) {
			this.logger.info(`Cleaned ${deleted} dead record(s) from DB`);
			this.invalidateTransfers();
		}
		return deleted;
	}

	// ---- Private helpers -------------------------------------------------------

	private async moveFile(srcPath: string, destPath: string): Promise<boolean> {
		if (srcPath === destPath) return false;

		if (!fs.existsSync(srcPath)) {
			throw new FileNotFoundError(srcPath);
		}

		const destDir = nodePath.dirname(destPath);
		if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

		await fs.promises.rename(srcPath, destPath);

		return true;
	}

	/**
	 * Returns the aMule global incoming directory.
	 * Priority: AMULE_INCOMING_DIR env var → amule.conf IncomingDir.
	 */
	async getIncomingDir(): Promise<string> {
		if (__APP_CONFIG__.amule.incomingDir) return __APP_CONFIG__.amule.incomingDir;
		try {
			const config = await this.amuledService.getConfig();
			if (config.incomingDir) return config.incomingDir;
		} catch (_e) {}
		return '/incoming'; // last-resort fallback
	}

	/**
	 * Resolve the absolute path of a file given its basename and an optional
	 * category-specific directory.  When catPath is falsy the global incomingDir is used.
	 */
	private resolveFilePath(filename: string, catPath: string | undefined, incomingDir: string): string {
		const dir = catPath || incomingDir;
		return nodePath.join(dir, nodePath.basename(filename));
	}
}
