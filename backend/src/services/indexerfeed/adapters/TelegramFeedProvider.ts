import { container } from '../../container/ServiceContainer';
import type { MessageRow } from '../../db/TelegramIndexerDB';
import { TelegramIndexerService } from '../../TelegramIndexerService';
import { telegramSourceName } from '../../mediaprovider/adapters/TelegramMediaProvider';
import type { MediaSearchResult } from '../../mediaprovider';
import { guessMediaType, isVideoFileName } from '../../../tools/releaseNameTools';
import { FEED_RELEASE_MAX_AGE_MS, type FeedRelease, type FeedReleaseListener, type IFeedProvider } from '../types';

/**
 * Pushes the video files the Telegram indexer stores in chats it had indexed before (see
 * TelegramIndexerService.onNewFilesIndexed). Always present; enabled by the account's feed toggle.
 */
export class TelegramFeedProvider implements IFeedProvider {
	readonly source = 'telegram' as const;
	private readonly telegram = container.get(TelegramIndexerService);

	isPresent(): boolean {
		return true;
	}

	isEnabled(): boolean {
		return this.telegram.isFeedEnabled();
	}

	subscribe(listener: FeedReleaseListener): void {
		this.telegram.onNewFilesIndexed((rows) => {
			const releases = this.toReleases(rows);
			if (releases.length > 0) listener(releases);
		});
	}

	/** Recent video files only: the *arr can import nothing else, and a re-enabled chat may deliver months of history in one pass. */
	private toReleases(rows: MessageRow[]): FeedRelease[] {
		const floor = Date.now() - FEED_RELEASE_MAX_AGE_MS;
		return rows
			.filter((row) => row.file_name && row.file_size && isVideoFileName(row.file_name) && row.date * 1000 >= floor)
			.map((row) => ({ result: this.toSearchResult(row), mediaType: guessMediaType(row.file_name!) }));
	}

	/** The same shape TelegramMediaProvider gives a search hit, so the download later shows the same origin. */
	private toSearchResult(row: MessageRow): MediaSearchResult {
		const hash = `telegram:${row.chat_id}:${row.message_id}`;
		const name = row.file_name || 'Unknown';
		const size = row.file_size || 0;
		return {
			name,
			size,
			hash,
			sourceCount: 1,
			completeSourceCount: 1,
			type: row.media_type || '',
			provider: 'telegram',
			sourceName: telegramSourceName(row.chat_title, row.topic_name),
			providerData: {
				name,
				size,
				hash,
				chatId: row.chat_id,
				chatTitle: row.chat_title || undefined,
				topicName: row.topic_name || undefined,
				messageId: row.message_id,
				type: row.media_type || '',
			},
		};
	}
}
