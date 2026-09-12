import fs from 'fs';
import path from 'path';
import { ECSearchFileDownloadStatus, FileStatus } from 'amule-ec-client';
import type { ServerPriority, UpdateResponse } from 'amule-ec-client';
import { container } from '../services/container/ServiceContainer';
import { MainDB, type DownloadDbRecord } from '../services/db/MainDB';
import { AppEvents, toDownloadEventPayload } from '../services/AppEvents';
import { buildEd2kLink, parseEd2kLink } from '../services/eD2kTools';
import { LoggerFactory } from '../services/logging/Logger';
import type { MediaCategory, MediaTransfer } from '../types/MediaTypes';
import { getMockWorld, type MockQueueEntry } from './MockWorld';

/** Same rule as AmuleService: unknown names and the default category read as 'default'. */
function normalizeCategoryName(name: string | null, categories: MediaCategory[]): string {
	if (!name || !name.trim()) return 'default';
	const found = categories.find((c) => c.name === name);
	if (!found || found.id === 0) return 'default';
	return name;
}

/**
 * Stand-in for AmuleService in MOCK_MODE: same public surface, backed by MockWorld instead of the EC
 * protocol. Downloads are still tracked in MainDB exactly like the real service does, so everything
 * built on top (duplicate detection, blacklist, events, Telegram transfers) runs the real code.
 */
export class MockAmuleService {
	private readonly logger = LoggerFactory.create(this);
	private readonly world = getMockWorld();
	private readonly events = container.get(AppEvents);
	private readonly db = container.get(MainDB);

	async getVersion(): Promise<string> {
		return '3.0.1';
	}

	async getStats() {
		return this.world.getStats();
	}

	async getConfig(): Promise<never> {
		throw new Error('getConfig not implemented in AmuleService');
	}

	// ── Servers ───────────────────────────────────────────────────────────────

	async getServers() {
		const server = this.world.connectedServer;
		return {
			list: this.world.servers,
			connectedServer: server ? { name: server.name, description: server.description, ip: server.ip, port: server.port } : null,
		};
	}

	async connectToServer(ip: string, port: number): Promise<void> {
		this.world.connectToServer(ip, port);
	}

	async disconnectFromServer(): Promise<void> {
		this.world.disconnectFromServer();
	}

	async updateServerListFromUrl(url: string): Promise<void> {
		this.world.refreshServerList(url);
	}

	async addServer(ip: string, port: number, name?: string): Promise<void> {
		this.world.addServer(ip, port, name);
	}

	async removeServer(ip: string, port: number): Promise<void> {
		this.world.removeServer(ip, port);
	}

	async setServerPriority(ip: string, port: number, priority: ServerPriority): Promise<void> {
		this.requireServer(ip, port).priority = priority;
	}

	async setServerStatic(ip: string, port: number, isStatic: boolean): Promise<void> {
		this.requireServer(ip, port).isStatic = isStatic;
	}

	private requireServer(ip: string, port: number) {
		const server = this.world.findServer(ip, port);
		if (!server) throw new Error(`Server not found: ${ip}:${port}`);
		return server;
	}

	// ── Shared files ──────────────────────────────────────────────────────────

	async getSharedFiles() {
		const list = this.world.shared.map((file) => ({
			...file,
			name: file.fileName,
			hash: file.fileHashHexString,
			size: file.sizeFull,
			path: file.filePath,
		}));
		return { raw: `Shared Files (${list.length})`, list };
	}

	/**
	 * Removes the file from the shared list and deletes its placeholder on disk. The controller then runs
	 * cleanDeadDownloadRecords, which drops the matching download record because the file is gone, as in production.
	 */
	async deleteSharedFile(hash: string): Promise<void> {
		const file = this.world.removeSharedFile(hash);
		if (!file) throw new Error(`Shared file with hash ${hash} not found`);
		fs.rmSync(path.join(file.filePath, file.fileName), { force: true });
		this.logger.info(`Deleted shared file from disk: ${path.join(file.filePath, file.fileName)}`);
	}

	// ── Transfers ─────────────────────────────────────────────────────────────

	async getTransfers(): Promise<{ raw: string; list: MediaTransfer[]; categories: MediaCategory[] }> {
		const categories = await this.getCategories();
		const records = this.db.getAllDownloads().filter((r) => !r.provider || r.provider === 'amule');
		const list = records.map((record) => {
			const entry = this.world.findQueueEntry(record.hash);
			if (!record.is_completed && entry?.status === FileStatus.COMPLETE) this.finishDownload(record, entry);
			if (record.is_completed) return this.completedTransfer(record, categories);
			if (!entry) return this.notInQueueTransfer(record, categories);
			return this.queuedTransfer(entry, record, categories);
		});
		return { raw: `Downloads (${this.world.getQueue().length})`, list, categories };
	}

	/** Mirrors the real completion detection: mark the record, share the file, tell everyone. */
	private finishDownload(record: DownloadDbRecord, entry: MockQueueEntry): void {
		this.db.updateDownloadCompletion(record.hash, true, entry.name, entry.size);
		record.is_completed = 1;
		record.name = entry.name;
		record.size = entry.size;
		const dir = this.world.categoryDir(record.category_name);
		this.world.addSharedFile(entry.name, entry.size, dir, entry.hash);
		try {
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, entry.name), '');
		} catch (e) {
			this.logger.warn('Could not create the placeholder file for a completed download:', e);
		}
		this.logger.info('Marked file as completed in DB:', record.hash, record.name);
		this.events.emit('download.completed', toDownloadEventPayload(record, 'amule'));
	}

	private completedTransfer(record: DownloadDbRecord, categories: MediaCategory[]): MediaTransfer {
		const size = record.size || 0;
		return {
			rawLine: `> ${record.name} [${(size / (1024 * 1024)).toFixed(2)} MB] Completed 100%`,
			name: record.name,
			size,
			progress: 1,
			status: 'Completed',
			statusId: FileStatus.COMPLETE,
			stopped: true,
			hash: record.hash,
			link: buildEd2kLink(record.name, size, record.hash),
			completed: size,
			speed: 0,
			sourceCount: 0,
			priority: 0,
			remaining: 0,
			addedOn: record.added_at,
			timeLeft: 0,
			categoryName: normalizeCategoryName(record.category_name, categories),
			isCompleted: true,
		};
	}

	private notInQueueTransfer(record: DownloadDbRecord, categories: MediaCategory[]): MediaTransfer {
		return {
			rawLine: `> ${record.name} [${((record.size || 0) / (1024 * 1024)).toFixed(2)} MB] Not in queue`,
			name: record.name,
			size: record.size || 0,
			progress: 0,
			status: 'Not in queue',
			statusId: -1,
			stopped: false,
			hash: record.hash,
			link: '',
			completed: 0,
			speed: 0,
			sourceCount: 0,
			priority: 0,
			remaining: record.size || 0,
			addedOn: record.added_at,
			timeLeft: Infinity,
			categoryName: normalizeCategoryName(record.category_name, categories),
			isCompleted: false,
		};
	}

	private queuedTransfer(entry: MockQueueEntry, record: DownloadDbRecord, categories: MediaCategory[]): MediaTransfer {
		const done = Math.round(entry.done);
		const progress = entry.size > 0 ? done / entry.size : 0;
		const remaining = entry.size - done;
		return {
			rawLine: `> ${entry.name} [${(entry.size / (1024 * 1024)).toFixed(2)} MB] Status: ${entry.status} ${(progress * 100).toFixed(1)}%`,
			name: entry.name,
			size: entry.size,
			progress,
			status: String(entry.status),
			statusId: entry.status,
			stopped: entry.stopped,
			hash: entry.hash,
			link: buildEd2kLink(entry.name, entry.size, entry.hash),
			completed: done,
			speed: entry.speed,
			sourceCount: entry.sourceCount,
			priority: entry.priority,
			remaining,
			timeLeft: remaining / (entry.speed || 1),
			categoryName: normalizeCategoryName(record.category_name, categories),
			addedOn: record.added_at,
			isCompleted: false,
			chunkInfo: this.world.toChunkInfo(entry),
			sources: entry.sources,
			sourceNames: entry.sourceNames,
		};
	}

	async clearCompletedTransfers(hashes?: string[]): Promise<void> {
		this.logger.info('Clearing completed transfers from DB', hashes ? `for hashes: ${hashes.join(', ')}` : 'for all');
		this.db.clearCompletedDownloads(hashes);
	}

	// ── Search ────────────────────────────────────────────────────────────────

	async startSearch(query: string, _type: string = 'Global'): Promise<string> {
		this.logger.info(`Starting Search for: ${query}`);
		this.world.startSearch(query);
		return 'Search Started';
	}

	async searchSynchronous(query: string, timeoutMs: number = 10000, resultsThreshold: number = 100) {
		await this.startSearch(query);
		const start = Date.now();
		let results = await this.getSearchResults();
		while (Date.now() - start < timeoutMs && this.world.getSearchProgress() < 1 && results.list.length < resultsThreshold) {
			await new Promise((resolve) => setTimeout(resolve, 500));
			results = await this.getSearchResults();
		}
		return results;
	}

	async getSearchResults() {
		const list = this.world.getSearchResults().map((r) => ({
			name: r.name,
			size: r.size,
			sourceCount: r.sourceCount,
			completeSourceCount: r.completeSourceCount,
			downloadStatus: this.downloadStatusOf(r.hash),
			type: r.type,
			link: r.link,
			hash: r.hash,
			provider: 'amule',
		}));
		return list.length > 0 ? { raw: `Found ${list.length} results`, list } : { raw: 'No results yet', list };
	}

	/** Whether the daemon already knows the file: finished, queued, or new. */
	private downloadStatusOf(hash: string): ECSearchFileDownloadStatus {
		const record = this.db.getDownload(hash);
		if (record?.is_completed) return ECSearchFileDownloadStatus.DOWNLOADED;
		if (record || this.world.findQueueEntry(hash)) return ECSearchFileDownloadStatus.QUEUED;
		return ECSearchFileDownloadStatus.NEW;
	}

	async getSearchStatus() {
		const progress = this.world.getSearchProgress();
		return { raw: `Search Status: ${progress}`, progress };
	}

	// ── Downloads ─────────────────────────────────────────────────────────────

	async getUploadQueue() {
		const list = this.world.getUploadQueue().slice();
		return { raw: `Uploads (${list.length})`, list };
	}

	/** Accepts an ed2k link or a bare hash from the current search results, like the daemon. */
	async addDownload(link: string): Promise<void> {
		this.logger.info('Adding download:', link);
		let file: { hash: string; name: string; size: number } | null = parseEd2kLink(link);
		if (!file && /^[a-fA-F0-9]{32}$/.test(link)) {
			const result = this.world.findSearchResult(link);
			file = result ? { hash: result.hash, name: result.name, size: result.size } : null;
		}
		if (!file) {
			this.logger.error('File ref error, cannot add download:', link);
			return;
		}
		if (!this.world.findQueueEntry(file.hash)) this.world.addQueueEntry(file.hash, file.name, file.size);
		this.db.addDownload(file.hash, file.name, file.size);
	}

	async removeDownload(hash: string): Promise<void> {
		this.logger.info('Removing download:', hash);
		this.world.removeQueueEntry(hash);
		this.db.deleteDownload(hash.toLowerCase());
	}

	async pauseDownload(hash: string): Promise<void> {
		this.world.pauseEntry(hash);
	}

	async resumeDownload(hash: string): Promise<void> {
		this.world.resumeEntry(hash);
	}

	async stopDownload(hash: string): Promise<void> {
		this.world.stopEntry(hash);
	}

	async getUpdate(): Promise<UpdateResponse> {
		return {
			sharedFiles: this.world.shared,
			downloadQueue: this.world.getQueue().map((entry) => this.world.toTransferringFile(entry)),
			clients: this.world.getUploadQueue().slice(),
			servers: this.world.servers,
			friends: [],
		};
	}

	// ── Categories ────────────────────────────────────────────────────────────

	async getCategories(): Promise<MediaCategory[]> {
		return this.world.categories.map((c) => ({ ...c }));
	}

	async createCategory(data: Partial<MediaCategory>): Promise<MediaCategory> {
		return { ...this.world.createCategory(data) };
	}

	async updateCategory(id: number, data: Partial<MediaCategory>): Promise<MediaCategory> {
		const existing = this.world.categories.find((c) => c.id === id);
		if (!existing) throw new Error(`Category with id ${id} not found`);
		const oldName = existing.name;
		const updated = this.world.updateCategory(id, data);
		if (id !== 0 && data.name && data.name !== oldName) this.db.updateCategoryName(oldName, data.name);
		return { ...updated };
	}

	async deleteCategory(id: number): Promise<void> {
		this.world.deleteCategory(id);
	}

	/** The daemon side of a category change; the record itself is updated by MediaProviderService. */
	async setFileCategory(hashHex: string, categoryId: number): Promise<void> {
		this.logger.debug(`Category of ${hashHex} set to ${categoryId}`);
	}
}
