import { container } from '../../container/ServiceContainer';
import { TelegramIndexerService } from '../../TelegramIndexerService';
import { MainDB, DownloadDbRecord } from '../../db/MainDB';
import type { IMediaProvider, MediaSearchResult, MediaTransfer } from '../types';

function toAmuleStatusId(status: string): number {
	switch (status) {
		case 'downloading':
			return 0;
		case 'completed':
			return 9;
		case 'paused':
			return 7;
		case 'stopped':
			return 7;
		case 'error':
			return 4;
		default:
			return 6; // default to 'Unknown'
	}
}

// ---------------------------------------------------------------------------
// Helper: build a MediaTransfer from a Telegram DB record
// ---------------------------------------------------------------------------

function buildTelegramTransfer(dbRecord: DownloadDbRecord, indexer: TelegramIndexerService): MediaTransfer {
	let statusText = dbRecord.is_completed ? 'completed' : '';
	let progress = dbRecord.is_completed ? 1 : 0;
	let completed = dbRecord.is_completed ? dbRecord.size : 0;
	let speed = 0;
	let timeLeft = 0;

	try {
		const dlStatus = indexer.getDownloadStatus(dbRecord.hash);
		if (dlStatus) {
			statusText = dlStatus.status;

			completed = dlStatus.downloaded;
			progress = dlStatus.size > 0 ? dlStatus.downloaded / dlStatus.size : 0;
			speed = dlStatus.speed || 0;

			if (dlStatus.speed > 0) {
				timeLeft = (dlStatus.size - dlStatus.downloaded) / dlStatus.speed;
			}

			if (dlStatus.status === 'completed' && !dbRecord.is_completed) {
				container.get(MainDB).updateDownloadCompletion(dbRecord.hash, true);
				dbRecord.is_completed = 1;
			}
		}
	} catch (_e) {
		// Indexer might not be ready
	}

	return {
		rawLine: `> ${dbRecord.name} [Telegram] ${statusText}`,
		name: dbRecord.name,
		size: dbRecord.size,
		progress,
		status: statusText,
		statusId: dbRecord.is_completed ? 9 : toAmuleStatusId(statusText),
		stopped: statusText === 'stopped',
		hash: dbRecord.hash,
		link: dbRecord.hash,
		completed,
		speed,
		sources: 0,
		priority: 0,
		remaining: dbRecord.size - completed,
		addedOn: dbRecord.added_at,
		timeLeft,
		categoryName: dbRecord.category_name,
		isCompleted: !!dbRecord.is_completed,
		provider: 'telegram',
	};
}

// ---------------------------------------------------------------------------
// TelegramMediaProvider
// ---------------------------------------------------------------------------

export class TelegramMediaProvider implements IMediaProvider {
	readonly providerId = 'telegram';
	private cachedResults: MediaSearchResult[] = [];
	private searchDone = true;
	private readonly PAGE_SIZE = 20;
	private readonly indexer = container.get(TelegramIndexerService);

	canHandleDownload(link: string): boolean {
		return link.startsWith('telegram:');
	}

	async startSearch(query: string): Promise<void> {
		this.cachedResults = [];
		this.searchDone = false;
		// Run pagination loop in the background – does not block the caller
		this.runSearchLoop(query)
			.catch((e) => {
				console.warn('[TelegramMediaProvider] search loop error:', e);
			})
			.finally(() => {
				this.searchDone = true;
			});
	}

	private async runSearchLoop(query: string): Promise<void> {
		let cursorId: number | null = 0;
		while (cursorId !== null) {
			const { results: batch, nextCursor } = await this.indexer.search(query, this.PAGE_SIZE, cursorId);
			console.log(`[TelegramMediaProvider] Search batch: ${batch.length} results (cursor ${cursorId})`);
			if (batch.length === 0) break;

			const mapped: MediaSearchResult[] = batch.map((r: any) => ({
				name: r.name,
				size: r.size,
				hash: r.hash,
				sources: r.sources,
				completeSources: r.completeSources,
				downloadStatus: r.downloadStatus,
				type: r.type || '',
				provider: 'telegram',
			}));
			this.cachedResults.push(...mapped);

			cursorId = nextCursor;
		}
		console.log('[TelegramMediaProvider] Search completed. Total results:', this.cachedResults.length);
	}

	async getSearchResults(): Promise<MediaSearchResult[]> {
		return this.cachedResults;
	}

	async getSearchStatus(): Promise<number> {
		return this.searchDone ? 1.0 : 0.5;
	}

	async addDownload(link: string): Promise<void> {
		const parts = link.split(':');
		if (parts.length < 3) throw new Error(`Invalid telegram link: ${link}`);
		const chatId = parts[1];
		const messageId = parseInt(parts[2]);
		const hash = link;

		const db = container.get(MainDB);
		const msg = this.indexer.getFileInfo(chatId, messageId);

		if (msg) {
			const existing = db.getDownload(hash);
			if (!existing) {
				db.addDownload(hash, msg.file_name || 'Unknown', Number(msg.file_size) || 0, null, 'telegram');
				console.log('[TelegramMediaProvider] Added to DB:', hash);
			}
			this.indexer.startDownload(chatId, messageId, hash).catch((err: any) => {
				console.error(`[TelegramMediaProvider] startDownload failed ${hash}:`, err);
			});
		} else {
			console.warn('[TelegramMediaProvider] Message not found:', chatId, messageId);
		}
	}

	async removeDownload(hash: string): Promise<void> {
		try {
			this.indexer.cancelDownload(hash);
		} catch (e) {
			console.error('[TelegramMediaProvider] removeDownload error:', e);
		}
		container.get(MainDB).deleteDownload(hash);
	}

	async pauseDownload(hash: string): Promise<void> {
		try {
			this.indexer.pauseDownload(hash);
		} catch (e) {
			console.error('[TelegramMediaProvider] pauseDownload error:', e);
		}
	}

	async resumeDownload(hash: string): Promise<void> {
		try {
			this.indexer.resumeDownload(hash);
		} catch (e) {
			console.error('[TelegramMediaProvider] resumeDownload error:', e);
		}
	}

	async stopDownload(hash: string): Promise<void> {
		try {
			this.indexer.pauseDownload(hash);
		} catch (e) {
			console.error('[TelegramMediaProvider] stopDownload error:', e);
		}
	}

	async getTransfers(): Promise<MediaTransfer[]> {
		const db = container.get(MainDB);
		const records = db.getAllDownloads().filter((r) => r.provider === 'telegram');
		return records.map((r) => buildTelegramTransfer(r, this.indexer));
	}

	async clearCompletedTransfers(hashes?: string[]): Promise<void> {
		const db = container.get(MainDB);
		if (hashes && hashes.length > 0) {
			const telegram = hashes.filter((h) => h.startsWith('telegram:'));
			if (telegram.length > 0) db.clearCompletedDownloads(telegram);
		} else {
			const records = db.getAllDownloads().filter((r) => r.provider === 'telegram' && r.is_completed);
			if (records.length > 0) db.clearCompletedDownloads(records.map((r) => r.hash));
		}
	}
}
