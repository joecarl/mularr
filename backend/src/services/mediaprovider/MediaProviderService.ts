import * as fs from 'fs';
import * as nodePath from 'path';
import type { AmuleCategory } from 'amule-ec-client';
import { container } from '../container/ServiceContainer';
import { AmuleService } from '../AmuleService';
import { AmuledService } from '../AmuledService';
import { MainDB } from '../db/MainDB';
import { AmuleMediaProvider } from './adapters/AmuleMediaProvider';
import { TelegramMediaProvider } from './adapters/TelegramMediaProvider';
import { TelegramDownloadDirectoryHelper } from '../TelegramDownloadManager';
import type { IMediaProvider, MediaTransfer, MediaSearchResult, MediaTransfersResponse, MediaSearchResponse, MediaSearchStatusResponse } from './types';

export class MediaProviderService {
	private providers: IMediaProvider[] = [];
	private readonly db = container.get(MainDB);

	constructor() {
		// Order matters: first matching provider wins for canHandleDownload
		this.providers.push(new TelegramMediaProvider());
		this.providers.push(new AmuleMediaProvider());
	}

	// ---- Search ----------------------------------------------------------------

	async startSearch(query: string, _type?: string): Promise<void> {
		await Promise.allSettled(this.providers.map((p) => p.startSearch(query)));
	}

	async getSearchResults(): Promise<MediaSearchResponse> {
		const perProvider = await Promise.allSettled(this.providers.map((p) => p.getSearchResults()));
		const combined: MediaSearchResult[] = [];
		for (const r of perProvider) {
			if (r.status === 'fulfilled') combined.push(...r.value);
		}
		return { raw: `Found ${combined.length} results`, list: combined };
	}

	async getSearchStatus(): Promise<MediaSearchStatusResponse> {
		// Overall progress = minimum across providers (all must finish before we report 1.0)
		const statuses = await Promise.allSettled(this.providers.map((p) => p.getSearchStatus()));
		let min = 1;
		for (const s of statuses) {
			if (s.status === 'fulfilled') min = Math.min(min, s.value);
		}
		return { raw: `Search progress: ${(min * 100).toFixed(0)}%`, progress: min };
	}

	// ---- Transfers -------------------------------------------------------------

	async getTransfers(): Promise<MediaTransfersResponse> {
		const perProvider = await Promise.allSettled(this.providers.map((p) => p.getTransfers()));
		const combined: MediaTransfer[] = [];
		for (const r of perProvider) {
			if (r.status === 'fulfilled') combined.push(...r.value);
		}

		let categories: AmuleCategory[] = [];
		try {
			categories = await container.get(AmuleService).getCategories();
		} catch (_e) {}

		// Enrich each transfer with its resolved absolute file path
		try {
			const incomingDir = await this.getIncomingDir();

			for (const transfer of combined) {
				if (!transfer.name) continue;
				if (transfer.isCompleted) {
					const cat = transfer.categoryName ? categories.find((c) => c.name === transfer.categoryName) : undefined;
					transfer.filePath = this.resolveFilePath(transfer.name, cat?.path, incomingDir);
				} else if (transfer.provider === 'telegram') {
					const tgDirHelper = new TelegramDownloadDirectoryHelper();
					transfer.filePath = nodePath.join(await tgDirHelper.getDownloadTempDir(), transfer.name);
				}
				// amule in-progress: temp files are hash-named .part files — not useful(?)
			}
		} catch (_e) {}

		return { raw: `Downloads (${combined.length})`, list: combined, categories };
	}

	async clearCompletedTransfers(hashes?: string[]): Promise<void> {
		await Promise.allSettled(this.providers.map((p) => p.clearCompletedTransfers(hashes)));
	}

	// ---- Download management ---------------------------------------------------

	async addDownload(link: string): Promise<void> {
		const provider = this.providers.find((p) => p.canHandleDownload(link));
		if (!provider) throw new Error(`No provider can handle link: ${link}`);
		await provider.addDownload(link);
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
			case 'cancel':
				await provider.removeDownload(hash);
				break;
			default:
				throw new Error(`Unknown command: ${command}`);
		}
	}

	// ---- Categories (amule-specific, proxied) ----------------------------------

	async getCategories(): Promise<AmuleCategory[]> {
		return container.get(AmuleService).getCategories();
	}

	/**
	 * Change the category of a file in aMule and update the DB.
	 * If `moveFiles` is true and the completed file exists on disk, it is moved
	 * from its current location to the new category directory using filename-based resolution
	 * (no reliance on aMule's shared-files hash list).
	 */
	async setFileCategory(hashHex: string, categoryId: number, moveFiles = false): Promise<void> {
		const amule = container.get(AmuleService);

		const categories = await amule.getCategories();
		const newCat = categories.find((c) => c.id === categoryId);

		// Resolve old location before updating DB
		const dbRecord = this.db.getDownload(hashHex.toLowerCase());
		const oldCatName = dbRecord?.category_name ?? null;
		const oldCat = oldCatName ? categories.find((c) => c.name === oldCatName) : categories.find((c) => c.id === 0);

		// Delegate EC protocol update to AmuleService
		await amule.setFileCategory(hashHex, categoryId);

		// Update our DB record with the new category name (or empty string for "none")
		const catName = categoryId === 0 ? null : newCat ? newCat.name : null;
		if (catName !== undefined) {
			this.db.setDownloadCategory(hashHex.toLowerCase(), catName);
		}

		if (moveFiles && dbRecord?.is_completed && dbRecord.name) {
			try {
				const incomingDir = await this.getIncomingDir();
				const srcPath = this.resolveFilePath(dbRecord.name, oldCat?.path, incomingDir);
				const destPath = this.resolveFilePath(dbRecord.name, newCat?.path, incomingDir);

				const wasMoved = await this.moveFile(srcPath, destPath);
				if (wasMoved) console.log(`[setFileCategory] Moved: ${srcPath} -> ${destPath}`);
			} catch (e: any) {
				console.error('[setFileCategory] Error moving file:', e);
			}
		}
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
				console.log(`[moveCategoryCompletedFiles] Moved: ${srcPath} -> ${destPath}`);
				moved++;
			} catch (e: any) {
				console.error(`[moveCategoryCompletedFiles] Error moving ${dl.name}:`, e);
				errors.push(`Failed to move "${dl.name}": ${e.message}`);
			}
		}

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
				console.log(`[cleanDeadDownloadRecords] Removed dead record: ${record.name} (${record.hash})`);
			}
		}
		if (deleted > 0) console.log(`[cleanDeadDownloadRecords] Cleaned ${deleted} dead record(s) from DB`);
		return deleted;
	}

	// ---- Private helpers -------------------------------------------------------

	private async moveFile(srcPath: string, destPath: string): Promise<boolean> {
		if (srcPath === destPath) return false;

		if (!fs.existsSync(srcPath)) {
			throw new Error(`File not found on disk`);
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
		if (process.env.AMULE_INCOMING_DIR) return process.env.AMULE_INCOMING_DIR;
		try {
			const config = await container.get(AmuledService).getConfig();
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
