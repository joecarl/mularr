import * as fs from 'fs';
import * as nodePath from 'path';
import type { AmuleCategory } from 'amule-ec-client';
import { container } from '../container/ServiceContainer';
import { AmuleService } from '../AmuleService';
import { AmuledService } from '../AmuledService';
import { MainDB, blacklistEntryMatches, type DownloadDbRecord } from '../db/MainDB';
import { parseEd2kLink } from '../eD2kTools';
import { AmuleMediaProvider } from './adapters/AmuleMediaProvider';
import { TelegramMediaProvider } from './adapters/TelegramMediaProvider';
import type { IMediaProvider, MediaTransfer, MediaSearchResult, MediaTransfersResponse, MediaSearchResponse, MediaSearchStatusResponse } from './types';

export class MediaProviderService {
	private providers: IMediaProvider[] = [];
	private readonly db = container.get(MainDB);
	public readonly searchHistory = new SearchHistory();

	constructor() {
		// Order matters: first matching provider wins for canHandleDownload
		this.providers.push(new TelegramMediaProvider());
		this.providers.push(new AmuleMediaProvider());
	}

	// ---- Search ----------------------------------------------------------------

	async startSearch(query: string, _type?: string): Promise<void> {
		await Promise.allSettled(this.providers.map((p) => p.startSearch(query)));
		this.searchHistory.addEntry(query, query);
	}

	async getSearchResults(): Promise<MediaSearchResponse> {
		const perProvider = await Promise.allSettled(this.providers.map((p) => p.getSearchResults()));
		const combined: MediaSearchResult[] = [];
		for (const r of perProvider) {
			if (r.status === 'fulfilled') {
				combined.push(...r.value);
				this.searchHistory.pushResults(r.value);
			}
		}
		const { visible, blacklistedCount } = this.filterBlacklisted(combined);
		return { raw: `Found ${visible.length} results`, list: visible, blacklistedCount };
	}

	/** Removes blacklisted results (see blacklistEntryMatches for the hash+size rule). */
	private filterBlacklisted(results: MediaSearchResult[]): { visible: MediaSearchResult[]; blacklistedCount: number } {
		const entries = this.db.getBlacklist();
		if (entries.length === 0) return { visible: results, blacklistedCount: 0 };
		const byHash = new Map(entries.map((e) => [e.hash.toLowerCase(), e]));
		const visible = results.filter((r) => {
			const entry = r.hash ? byHash.get(r.hash.toLowerCase()) : undefined;
			return !entry || !blacklistEntryMatches(entry, r.size);
		});
		return { visible, blacklistedCount: results.length - visible.length };
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

	async addDownload(link: string): Promise<{ duplicate?: DownloadDbRecord }> {
		this.assertNotBlacklisted(link);
		const duplicate = this.findExistingDownload(link);
		const provider = this.providers.find((p) => p.canHandleDownload(link));
		if (!provider) throw new Error(`No provider can handle link: ${link}`);
		await provider.addDownload(link);
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
			case 'cancel':
				await this.deleteFileForCompletedDownload(hash);
				await provider.removeDownload(hash);
				break;
			default:
				throw new Error(`Unknown command: ${command}`);
		}
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
				console.log(`[sendDownloadCommand] Deleted file: ${targetPath}`);
			}
		} catch (e) {
			console.error('[sendDownloadCommand] Error deleting file on cancel:', e);
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

type MediaSearchResultsByHash = Record<string, MediaSearchResult>;

interface SearchHistoryEntry {
	id: string;
	query: string;
	timestamp: number;
	results: MediaSearchResultsByHash;
}

/**
 * A simple in-memory cache for search results, keyed by query string.
 * Bad things will happend if and external service triggers a search on amule which is not handled by mularr
 */
class SearchHistory {
	private readonly searchesById: Record<string, SearchHistoryEntry> = {};
	private current: SearchHistoryEntry | null = null;

	addEntry(id: string, query: string, results: MediaSearchResultsByHash = {}) {
		if (this.current) {
			this.controlHistorySize();
			this.searchesById[this.current.id] = this.current;
		}
		this.current = { id, query, timestamp: Date.now(), results };
	}

	private controlHistorySize() {
		const MAX_HISTORY_SIZE = 10;
		const entries = Object.values(this.searchesById);
		if (entries.length > MAX_HISTORY_SIZE) {
			// Sort by timestamp and remove the oldest entries
			entries.sort((a, b) => a.timestamp - b.timestamp);
			const excessCount = entries.length - MAX_HISTORY_SIZE;
			for (let i = 0; i < excessCount; i++) {
				delete this.searchesById[entries[i].id];
			}
		}
	}

	pushResults(results: MediaSearchResult[]) {
		if (!this.current) return;
		for (const r of results) {
			this.current.results[r.hash] = r;
		}
	}

	/**
	 * Returns a read-only view of the search history, keyed by search ID.
	 * The current search (if any) is not included in the returned object.
	 */
	getFullHistory() {
		return this.searchesById as Readonly<typeof this.searchesById>;
	}

	deleteEntry(id: string) {
		if (this.current?.id === id) {
			this.current = null;
		} else {
			delete this.searchesById[id];
		}
	}
}
