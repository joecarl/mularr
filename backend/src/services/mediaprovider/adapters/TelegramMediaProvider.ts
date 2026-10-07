import { container } from '../../container/ServiceContainer';
import { type TelegramIndexerSearchResult, TelegramIndexerService } from '../../TelegramIndexerService';
import { MainDB, DownloadDbRecord } from '../../db/MainDB';
import { AppEvents, toDownloadEventPayload } from '../../AppEvents';
import type { IMediaProvider, MediaSearchResult, MediaTransfer, ProviderSearch, SearchCriteria } from '../types';
import { DownloadStatus, TelegramDownloadDirectoryHelper } from '../../TelegramDownloadManager';
import * as nodePath from 'path';
import { LoggerFactory } from '../../logging/Logger';

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
		case 'queued':
			return 11;
		default:
			return 6; // default to 'Unknown'
	}
}

function toAmuleDownloadStatus(downloadStatus?: DownloadStatus): number {
	switch (downloadStatus?.status) {
		case 'completed':
			return 1;
		case 'downloading':
			return 2;
		case 'paused':
			return 2;
		case 'stopped':
			return 2;
		case 'queued':
			return 2;
		default:
			return 0; // default to 'Unknown'
	}
}

/** Origin label of a Telegram file: the chat, with the forum topic when the message sits in one. */
export function telegramSourceName(chatTitle?: string | null, topicName?: string | null): string | undefined {
	if (!chatTitle) return undefined;
	return topicName ? `${chatTitle} › ${topicName}` : chatTitle;
}

// ---------------------------------------------------------------------------
// Helper: build a MediaTransfer from a Telegram DB record
// ---------------------------------------------------------------------------

function buildTelegramTransfer(dbRecord: DownloadDbRecord, indexer: TelegramIndexerService, db: MainDB, events: AppEvents, tempDir?: string): MediaTransfer {
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
				db.updateDownloadCompletion(dbRecord.hash, true);
				dbRecord.is_completed = 1;
				events.emit('download.completed', toDownloadEventPayload(dbRecord, 'telegram'));
			}
		}
	} catch (_e) {
		// Indexer might not be ready
	}

	const parts = dbRecord.hash.split(':');

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
		sourceCount: 0,
		priority: 0,
		remaining: dbRecord.size - completed,
		addedOn: dbRecord.added_at,
		timeLeft,
		categoryName: dbRecord.category_name,
		isCompleted: !!dbRecord.is_completed,
		filePath: !dbRecord.is_completed && tempDir ? nodePath.join(tempDir, dbRecord.name) : undefined,
		provider: 'telegram',
		sourceName: (() => {
			if (parts.length < 2) return undefined;
			const msg = parts.length >= 3 ? indexer.getFileInfo(parts[1], parseInt(parts[2])) : undefined;
			return telegramSourceName(msg?.chat_title || indexer.getChatTitle(parts[1]), msg?.topic_name);
		})(),
	};
}

// ---------------------------------------------------------------------------
// TelegramMediaProvider
// ---------------------------------------------------------------------------

export class TelegramMediaProvider implements IMediaProvider {
	private readonly logger = LoggerFactory.create(this);
	readonly providerId = 'telegram';
	// Matches Telegram's getMessages batch limit so verifying a page costs one call per chat
	private readonly PAGE_SIZE = 100;
	private readonly indexer = container.get(TelegramIndexerService);
	private readonly db = container.get(MainDB);
	private readonly events = container.get(AppEvents);
	private readonly dirHelper = new TelegramDownloadDirectoryHelper();

	/** Switched on from the Telegram view; the indexer returns nothing while it is off. */
	isAvailable(): boolean {
		return this.indexer.isSearchEnabled();
	}

	canHandleDownload(link: string): boolean {
		return link.startsWith('telegram:');
	}

	/**
	 * Full-text search over the indexed messages; the identifiers in the criteria are ignored. Each search pages
	 * the index into its own buffer, so several may run at once.
	 */
	async startSearch(criteria: SearchCriteria): Promise<ProviderSearch> {
		const hits: TelegramIndexerSearchResult[] = [];
		let done = false;
		// Run pagination loop in the background – does not block the caller
		this.runSearchLoop(criteria.query, hits)
			.catch((e) => {
				this.logger.warn('search loop error:', e);
			})
			.finally(() => {
				done = true;
			});
		return {
			queued: false,
			getResults: async () => hits.map((r) => this.toSearchResult(r)),
			getProgress: async () => (done ? 1 : 0.5),
		};
	}

	private async runSearchLoop(query: string, into: TelegramIndexerSearchResult[]): Promise<void> {
		let cursorId: number | null = 0;
		while (cursorId !== null) {
			const { results: batch, nextCursor } = await this.indexer.search(query, this.PAGE_SIZE, cursorId);
			this.logger.debug(`Search batch: ${batch.length} results (cursor ${cursorId})`);
			// A page may come back empty when all its hits were purged as vanished media while
			// more pages remain, so only a null cursor ends the loop
			into.push(...batch);
			cursorId = nextCursor;
		}
		this.logger.info('Search completed. Total results:', into.length);
	}

	private toSearchResult(r: TelegramIndexerSearchResult): MediaSearchResult {
		return {
			name: r.name,
			size: r.size,
			hash: r.hash,
			sourceCount: 1,
			completeSourceCount: 1,
			downloadStatus: toAmuleDownloadStatus(this.indexer.getDownloadStatus(r.hash)),
			type: r.type || '',
			provider: 'telegram',
			sourceName: telegramSourceName(r.chatTitle, r.topicName),
			providerData: r,
		};
	}

	async addDownload(link: string): Promise<void> {
		const parts = link.split(':');
		if (parts.length < 3) throw new Error(`Invalid telegram link: ${link}`);
		const chatId = parts[1];
		const messageId = parseInt(parts[2]);
		const hash = link;

		const msg = this.indexer.getFileInfo(chatId, messageId);

		if (msg) {
			const existing = this.db.getDownload(hash);
			if (!existing) {
				this.db.addDownload(hash, msg.file_name || 'Unknown', Number(msg.file_size) || 0, null, 'telegram');
				this.logger.info('Added to DB:', hash);
			}
			this.indexer.startDownload(chatId, messageId, hash).catch((err: any) => {
				this.logger.error(`startDownload failed ${hash}:`, err);
			});
		} else {
			this.logger.warn('Message not found:', chatId, messageId);
		}
	}

	async removeDownload(hash: string): Promise<void> {
		try {
			this.indexer.cancelDownload(hash);
		} catch (e) {
			this.logger.error('removeDownload error:', e);
		}
		this.db.deleteDownload(hash);
	}

	async pauseDownload(hash: string): Promise<void> {
		try {
			this.indexer.pauseDownload(hash);
		} catch (e) {
			this.logger.error('pauseDownload error:', e);
		}
	}

	async resumeDownload(hash: string): Promise<void> {
		try {
			this.indexer.resumeDownload(hash);
		} catch (e) {
			this.logger.error('resumeDownload error:', e);
		}
	}

	async stopDownload(hash: string): Promise<void> {
		try {
			this.indexer.pauseDownload(hash);
		} catch (e) {
			this.logger.error('stopDownload error:', e);
		}
	}

	async getTempDir(): Promise<string | undefined> {
		try {
			return await this.dirHelper.getDownloadTempDir();
		} catch (e) {
			this.logger.error('getTempDir error:', e);
			return undefined;
		}
	}

	async getTransfers(): Promise<MediaTransfer[]> {
		const records = this.db.getAllDownloads().filter((r) => r.provider === 'telegram');
		// Only in-progress transfers need the temp dir, and resolving it reads amule.conf and touches the filesystem
		const tempDir = records.some((r) => !r.is_completed) ? await this.getTempDir() : undefined;
		return records.map((r) => buildTelegramTransfer(r, this.indexer, this.db, this.events, tempDir));
	}

	async clearCompletedTransfers(hashes?: string[]): Promise<void> {
		if (hashes && hashes.length > 0) {
			const telegram = hashes.filter((h) => h.startsWith('telegram:'));
			if (telegram.length > 0) this.db.clearCompletedDownloads(telegram);
		} else {
			const records = this.db.getAllDownloads().filter((r) => r.provider === 'telegram' && r.is_completed);
			if (records.length > 0) this.db.clearCompletedDownloads(records.map((r) => r.hash));
		}
	}
}
