import * as fs from 'fs';
import * as path from 'path';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Logger } from 'telegram/extensions';
import { FloodWaitError } from 'telegram/errors/RPCErrorList';
import { Dialog } from 'telegram/tl/custom/dialog';
import { container } from './container/ServiceContainer';
import { ChatOverview, MessageInput, MessageRow, TelegramIndexerDB } from './db/TelegramIndexerDB';
import { MainDB } from './db/MainDB';
import { TelegramDownloadManager, getDownloadableDocument } from './TelegramDownloadManager';
import { JoinedChat, JoinQueueStatus, TelegramJoinManager, usernameOf } from './TelegramJoinManager';
import { LoggerFactory } from './logging/Logger';
import { __APP_CONFIG__ } from '../app-env';
import { sleep } from '../tools/asyncTools';

export type AuthStatus = 'disconnected' | 'waiting_code' | 'waiting_password' | 'connected' | 'authenticating';

/** A chat as the UI lists it: the index overview plus whether a pass over it is running right now. */
export interface TelegramChatStatus extends ChatOverview {
	indexing_now: boolean;
}

/** Where the periodic indexing cycle stands. Times are epoch ms. */
export interface IndexingCycleStatus {
	running: boolean;
	/** Chat being indexed at the moment, null between chats or while idle. */
	currentChatId: string | null;
	lastRunAt: number | null;
	/** When the next cycle is due; null while one runs or nothing is scheduled (signed out). */
	nextRunAt: number | null;
}

export interface TelegramChatsResponse {
	chats: TelegramChatStatus[];
	cycle: IndexingCycleStatus;
}

/** Receives the files a pass stored in a chat indexed before, see TelegramIndexerService.onNewFilesIndexed. */
export type NewFilesListener = (rows: MessageRow[]) => void;

export interface TelegramIndexerSearchResult {
	hash: string;
	name: string;
	size: number;
	chatId: string;
	chatTitle?: string;
	topicName?: string;
	messageId: number;
	type: string;
}

export class TelegramIndexerService {
	private readonly logger = LoggerFactory.create(this);
	private readonly mainDb = container.get(MainDB);
	private client: TelegramClient | null = null;
	private db: TelegramIndexerDB;
	private readonly downloadManager: TelegramDownloadManager;
	private readonly joinManager: TelegramJoinManager;

	// Auth State
	private authStatus: AuthStatus = 'disconnected';
	private tempPhone: string | null = null;
	private tempPhoneCodeHash: string | null = null;

	private isIndexing = false;
	/** Chat whose history is being fetched right now, see IndexingCycleStatus.currentChatId. */
	private indexingChatId: string | null = null;
	private lastCycleAt: number | null = null;
	private nextCycleAt: number | null = null;
	private nextCycleTimer: NodeJS.Timeout | null = null;
	/** Chats asked to be indexed without waiting for the timer; they go first in the next cycle. */
	private readonly priorityChats = new Set<string>();
	private readonly newFilesListeners: NewFilesListener[] = [];
	private readonly BATCH_SIZE = 50;
	private readonly RATE_LIMIT_DELAY = 1000;
	private readonly CYCLE_INTERVAL_MS = 5 * 60 * 1000;
	/** Retry delay when a cycle is due but the client is momentarily disconnected. */
	private readonly RECONNECT_RETRY_MS = 60 * 1000;
	/** Search hits confirmed to exist within this window are trusted without asking Telegram again. */
	private readonly MEDIA_VERIFY_TTL_MS = 6 * 60 * 60 * 1000;

	constructor() {
		// Initialize DB
		const { dataDir, telegramDir } = __APP_CONFIG__;
		fs.mkdirSync(telegramDir, { recursive: true });
		const indexerDbPath = path.join(telegramDir, 'indexer.db');
		this.moveLegacyIndexerDb(path.join(dataDir, 'indexer.db'), indexerDbPath);
		this.db = new TelegramIndexerDB(indexerDbPath);

		this.downloadManager = new TelegramDownloadManager(
			() => this.client,
			() => this.authStatus,
			this.db
		);
		this.joinManager = new TelegramJoinManager(
			() => this.client,
			() => this.authStatus,
			this.db,
			(chat, indexOnJoin) => this.onChatJoined(chat, indexOnJoin)
		);
	}

	/**
	 * Until 2026-10 the indexer database sat at the root of the data directory. Moves it (with the WAL and
	 * shared-memory files SQLite may have left beside it) into telegram/, so upgraded installs keep their index.
	 */
	private moveLegacyIndexerDb(from: string, to: string) {
		if (!fs.existsSync(from) || fs.existsSync(to)) return;
		for (const suffix of ['', '-wal', '-shm']) {
			if (fs.existsSync(from + suffix)) fs.renameSync(from + suffix, to + suffix);
		}
		this.logger.info(`Moved the Telegram indexer database from ${from} to ${to}`);
	}

	public async getAuthStatus() {
		return {
			status: this.authStatus,
			// phoneNumber: this.tempPhone, // For UI feedback
			user: this.client && this.authStatus === 'connected' ? await this.client.getMe() : null, // Return user info if connected
			searchEnabled: this.isSearchEnabled(),
			feedEnabled: this.isFeedEnabled(),
		};
	}

	public async start() {
		this.migrateLegacyExtensionRow();

		// Try to recover session from DB
		const account = this.db.getAccount();
		if (account.apiId && account.apiHash && account.session) {
			this.logger.info('Restoring Telegram session from DB...');
			await this.connectClient(account.apiId, account.apiHash, account.session);
		}
	}

	/**
	 * Until 2026-10 the account was kept as a 'telegram_indexer' row of the extensions table. Moves it into
	 * the indexer DB and drops the row, so installs upgraded from that layout keep their session and settings.
	 */
	private migrateLegacyExtensionRow() {
		const ext = this.mainDb.getExtensionByType('telegram_indexer');
		if (!ext) return;
		let config: any = {};
		try {
			config = JSON.parse(ext.config || '{}');
		} catch {
			config = {};
		}
		this.db.updateAccount({
			apiId: typeof config.apiId === 'number' ? config.apiId : null,
			apiHash: typeof config.apiHash === 'string' ? config.apiHash : null,
			session: typeof config.session === 'string' ? config.session : null,
			searchEnabled: !!ext.enabled,
		});
		this.mainDb.deleteExtension(ext.id);
		this.logger.info('Moved the Telegram account from the extensions table into the indexer DB');
	}

	// -- Search provider flag --

	/** Whether searches reach the Telegram index; see TelegramAccount.searchEnabled. */
	public isSearchEnabled(): boolean {
		return this.db.getAccount().searchEnabled;
	}

	public setSearchEnabled(enabled: boolean) {
		this.db.updateAccount({ searchEnabled: enabled });
	}

	// -- Indexer feed flag --

	/** Whether newly indexed files are published in the indexer feed; see TelegramAccount.feedEnabled. */
	public isFeedEnabled(): boolean {
		return this.db.getAccount().feedEnabled;
	}

	public setFeedEnabled(enabled: boolean) {
		this.db.updateAccount({ feedEnabled: enabled });
	}

	/**
	 * Called with the files (messages with a name and size) a pass stores in a chat that had been indexed
	 * before, once per pass. The first pass over a chat, which backfills its whole history, is not reported:
	 * those are not new files, only newly indexed ones.
	 */
	public onNewFilesIndexed(listener: NewFilesListener) {
		this.newFilesListeners.push(listener);
	}

	// -- Auth Flow Methods --

	public async startAuth(apiId: number, apiHash: string, phoneNumber: string) {
		if (this.authStatus === 'connected') throw new Error('Already connected');

		this.authStatus = 'authenticating';
		// this.tempApiId = apiId;
		// this.tempApiHash = apiHash;
		this.tempPhone = phoneNumber;

		try {
			this.client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });
			await this.client.connect();

			const result = await this.client.sendCode(
				{
					apiId,
					apiHash,
				},
				phoneNumber
			);

			this.tempPhoneCodeHash = result.phoneCodeHash;
			this.authStatus = 'waiting_code';

			// Save initial config
			this.db.updateAccount({ apiId, apiHash });
		} catch (e) {
			this.authStatus = 'disconnected';
			this.client = null;
			throw e;
		}
	}

	public async submitCode(code: string) {
		if (this.authStatus !== 'waiting_code' || !this.client || !this.tempPhone) {
			throw new Error('Not waiting for code');
		}

		try {
			await this.client.invoke(
				new Api.auth.SignIn({
					phoneNumber: this.tempPhone,
					phoneCodeHash: this.tempPhoneCodeHash!,
					phoneCode: code,
				})
			);

			// If successful
			this.onLoginSuccess();
		} catch (e: any) {
			if (e.errorMessage === 'SESSION_PASSWORD_NEEDED') {
				this.authStatus = 'waiting_password';
				throw new Error('SESSION_PASSWORD_NEEDED');
			}
			throw e;
		}
	}

	public async submitPassword(password: string) {
		if (this.authStatus !== 'waiting_password' || !this.client) {
			throw new Error('Not waiting for password');
		}

		try {
			const { apiId, apiHash } = this.db.getAccount();
			if (!apiId || !apiHash) throw new Error('Missing Telegram API credentials');
			await this.client.signInWithPassword(
				{ apiId, apiHash },
				{
					password: async () => password,
					onError: (err: any) => {
						throw err;
					},
				}
			);

			this.onLoginSuccess();
		} catch (e: any) {
			throw e;
		}
	}

	private onLoginSuccess() {
		this.authStatus = 'connected';
		const session = this.client!.session.save() as unknown as string;
		this.db.updateAccount({ session });
		this.logger.info('Telegram login successful!');
		this.downloadManager.resumeActiveDownloads().catch((e) => this.logger.error('Error resuming active downloads:', e));
		this.joinManager.resume();
		this.runIndexingLoop();
	}

	public async logout() {
		this.joinManager.stop();
		if (this.client) {
			await this.client.disconnect();
			this.client = null;
		}
		this.authStatus = 'disconnected';

		// Clear session from DB but keep API config
		this.db.updateAccount({ session: null });
	}

	// -- Chat Management --

	public getDiscoveredChats(): TelegramChatsResponse {
		const chats = this.db.getChatsOverview().map((c) => ({ ...c, indexing_now: c.id === this.indexingChatId }));
		return { chats, cycle: this.getCycleStatus() };
	}

	private getCycleStatus(): IndexingCycleStatus {
		return {
			running: this.isIndexing,
			currentChatId: this.indexingChatId,
			lastRunAt: this.lastCycleAt,
			nextRunAt: this.isIndexing ? null : this.nextCycleAt,
		};
	}

	/** Enabling a chat also indexes it right away instead of waiting for the next cycle. */
	public setChatIndexing(chatId: string, enabled: boolean) {
		this.db.setChatIndexing(chatId, enabled);
		if (enabled) this.requestIndexing(chatId);
	}

	/**
	 * Indexes the chat as soon as possible: a new cycle starts now with it first, or, if one is running,
	 * right after it ends. Nothing happens while signed out (the cycle resumes on sign-in).
	 */
	public requestIndexing(chatId: string) {
		if (!this.db.isIndexingEnabled(chatId)) throw new Error('Indexing is disabled for this chat');
		this.priorityChats.add(chatId);
		if (this.isIndexing) return; // the running cycle schedules the next one immediately, see runIndexingLoop
		this.runIndexingLoop();
	}

	/** Drops what the index holds for the chat; it is indexed again from scratch if enabled. See TelegramIndexerDB.clearChatIndex. */
	public clearChatIndex(chatId: string) {
		this.ensureNotIndexing(chatId);
		this.db.clearChatIndex(chatId);
		this.logger.info(`Cleared the index of chat ${chatId}`);
	}

	/** Removes the chat with its index; the next cycle registers it again (disabled) while the account still has it. */
	public deleteChat(chatId: string) {
		this.ensureNotIndexing(chatId);
		this.priorityChats.delete(chatId);
		this.db.deleteChat(chatId);
		this.logger.info(`Deleted chat ${chatId} with its index`);
	}

	/** A pass over the chat writes to its rows as it goes, so purging them meanwhile would leave a half state. */
	private ensureNotIndexing(chatId: string) {
		if (this.indexingChatId === chatId) throw new Error('The chat is being indexed right now, try again when the pass ends');
	}

	// -- Join queue --

	public getJoinQueue(): JoinQueueStatus {
		return this.joinManager.getStatus();
	}

	/** Queues channel links to join in the background, see TelegramJoinManager.addJoinLinks. */
	public addJoinLinks(links: string[], indexOnJoin: boolean) {
		return this.joinManager.addJoinLinks(links, indexOnJoin);
	}

	public retryJoin(id: number) {
		this.joinManager.retry(id);
	}

	public removeJoin(id: number) {
		this.joinManager.remove(id);
	}

	public clearFinishedJoins(): number {
		return this.joinManager.clearFinished();
	}

	/**
	 * A queued link got the account into the chat: registers it right away (the next cycle would too) and,
	 * when asked, enables its indexing and indexes it now.
	 */
	private onChatJoined(chat: JoinedChat, indexOnJoin: boolean) {
		this.db.registerChat(chat.id, chat.title, chat.type, chat.username);
		if (!indexOnJoin) return;
		this.db.setChatIndexing(chat.id, true);
		this.requestIndexing(chat.id);
	}

	// -- Client Actions --

	private async connectClient(apiId: number, apiHash: string, sessionString: string) {
		this.client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, { connectionRetries: 5 });
		await this.client.connect();
		this.authStatus = 'connected';
		this.downloadManager.resumeActiveDownloads().catch((e) => this.logger.error('Error resuming active downloads:', e));
		this.joinManager.resume();
		this.runIndexingLoop();
	}

	/** Arms the cycle timer, replacing any pending one, and publishes when it is due. */
	private scheduleNextCycle(delayMs: number) {
		if (this.nextCycleTimer) clearTimeout(this.nextCycleTimer);
		this.nextCycleAt = Date.now() + delayMs;
		this.nextCycleTimer = setTimeout(() => this.runIndexingLoop(), delayMs);
	}

	private async runIndexingLoop() {
		if (this.isIndexing) return;
		// Signed out: nothing to do until the next sign-in starts the loop again
		if (!this.client || this.authStatus !== 'connected') {
			if (this.nextCycleTimer) clearTimeout(this.nextCycleTimer);
			this.nextCycleTimer = null;
			this.nextCycleAt = null;
			return;
		}
		// Signed in but the connection dropped for the moment: keep the loop alive and try again shortly
		if (!this.client.connected) {
			this.logger.warn('Indexing cycle due but the client is disconnected; retrying in a minute');
			this.scheduleNextCycle(this.RECONNECT_RETRY_MS);
			return;
		}
		this.isIndexing = true;
		if (this.nextCycleTimer) {
			clearTimeout(this.nextCycleTimer);
			this.nextCycleTimer = null;
		}
		this.nextCycleAt = null;

		try {
			const dialogs = await this.getAllDialogs();
			this.logger.info(`Found ${dialogs.length} total dialogs.`);

			// ... (rest of function unchanged until end) ...

			// First pass: Register all chats
			const presentIds: string[] = [];
			for (const dialog of dialogs) {
				const chatId = dialog.id?.toString();
				if (!chatId) continue;

				// Skip user chats as requested
				if (dialog.isUser) continue;

				const name = dialog.title || chatId || 'Unknown';
				let type = 'chat';
				if (dialog.isChannel) type = 'channel';
				if (dialog.isGroup) type = 'group';

				this.db.registerChat(chatId, name, type, usernameOf(dialog.entity));
				presentIds.push(chatId);
			}
			// Chats the account no longer has (left, deleted...) keep their rows but are flagged, see Chat.invalid
			const gone = this.db.markChatsInvalidNotIn(presentIds);
			if (gone > 0) this.logger.info(`${gone} chats are no longer among the account dialogs; marked invalid`);

			// Chats asked for explicitly go first; the set is cleared as they are taken
			const requested = new Set(this.priorityChats);
			this.priorityChats.clear();
			const enabledChats = this.db
				.getIndexingEnabledChats()
				.sort((a, b) => Number(requested.has(b.id)) - Number(requested.has(a.id)) || (a.title ?? '').localeCompare(b.title ?? ''));
			this.logger.info(`Found ${enabledChats.length} chats enabled for indexing.`);

			for (const chat of enabledChats) {
				// Find the dialog object again or use collected map
				const dialog = dialogs.find((d) => d.id?.toString() === chat.id);
				if (!dialog) {
					// The account left the chat or it was deleted: indexing it would only fail (CHANNEL_INVALID), and its
					// messages can no longer be downloaded, so stop indexing it, which also takes it out of searches.
					// The user can enable it again if the chat comes back.
					this.logger.warn(`Chat ${chat.title} (${chat.id}) is no longer among the account dialogs; disabling its indexing`);
					this.db.setChatIndexing(chat.id, false);
					this.db.recordChatCheck(chat.id, Date.now(), 'Chat not found among the account dialogs; indexing disabled');
					continue;
				}
				this.indexingChatId = chat.id;
				try {
					await this.indexDialog(dialog, chat.title);
				} finally {
					this.indexingChatId = null;
				}
			}

			this.logger.info('Full indexing cycle complete. Scheduling next check.');
		} catch (error) {
			this.logger.error('Error during indexing cycle:', error);
		} finally {
			this.isIndexing = false;
			this.indexingChatId = null;
			this.lastCycleAt = Date.now();
			// Next cycle in CYCLE_INTERVAL_MS, or right away when a chat was requested meanwhile
			this.scheduleNextCycle(this.priorityChats.size > 0 ? 0 : this.CYCLE_INTERVAL_MS);
		}
	}

	private async getAllDialogs() {
		if (!this.client) return [];
		// We need to iterate over all dialogs.
		const dialogs = await this.client.getDialogs({});
		return dialogs; // This returns a list of Dialog objects
	}

	private async indexDialog(dialog: Dialog, chatName: string) {
		const chatId = dialog.id?.toString();
		if (!chatId) return;

		// If the dialog is a forum supergroup, fetch and register all topic names first
		const entity = dialog.entity as any;
		if (entity?.forum) {
			await this.registerForumTopics(dialog.inputEntity, chatId);
		}

		await this.indexChatHistory(dialog.inputEntity, chatId, chatName);
	}

	/**
	 * Fetches all forum topics for a channel and stores their names in the `topics` table.
	 *
	 * GetForumTopics uses a three-part cursor: (offsetDate, offsetId, offsetTopic).
	 * All three must advance together or the server returns the same page repeatedly.
	 * The response includes a `messages` array (the top message of each topic) from
	 * which we extract the proper offsetDate and offsetId for the next page.
	 */
	private async registerForumTopics(entity: Api.TypeInputPeer, chatId: string) {
		const PAGE = 100;
		let offsetDate = 0;
		let offsetId = 0;
		let offsetTopic = 0;
		let totalFetched = 0;

		while (true) {
			try {
				const result = (await this.fetchWithFloodWait(() =>
					this.client!.invoke(
						new Api.channels.GetForumTopics({
							channel: entity,
							limit: PAGE,
							offsetDate,
							offsetId,
							offsetTopic,
						})
					)
				)) as any;

				const topics: Api.ForumTopic[] = result.topics ?? [];
				if (topics.length === 0) break;

				for (const topic of topics) {
					this.db.registerTopic(chatId, topic.id, topic.title);
				}
				totalFetched += topics.length;
				this.logger.debug(`Registered ${totalFetched} forum topics so far for chat ${chatId}`);

				// Stop if we've received everything
				if (topics.length < PAGE || totalFetched >= (result.count ?? Infinity)) break;

				// Advance cursor — all three parts must come from the last topic's top message
				const lastTopic = topics[topics.length - 1];
				const topMsgId: number = lastTopic.topMessage;
				const topMsg = (result.messages as any[])?.find((m: any) => m.id === topMsgId);
				offsetDate = topMsg?.date ?? 0;
				offsetId = topMsgId;
				offsetTopic = lastTopic.id;

				// Safety: if cursor didn't advance (malformed response), stop
				if (offsetTopic === 0 && offsetId === 0) break;
			} catch (err) {
				this.logger.warn(`Could not fetch forum topics for ${chatId}: ${err}`);
				break;
			}
		}
	}

	private async indexChatHistory(entity: Api.TypeInputPeer, chatId: string, chatName: string) {
		let lastId = this.db.getLastMessageId(chatId);
		this.logger.info(`Indexing ${chatName} (ID: ${chatId}) starting from ${lastId}...`);

		let hasMore = true;
		/** The error that stopped the pass, kept for the chats list; null when it ran to the end. */
		let lastError: string | null = null;
		// Files stored by this pass, reported to the listeners at the end; a first pass is a backfill, not news (see onNewFilesIndexed)
		const reportNewFiles = lastId > 0 && this.newFilesListeners.length > 0;
		const newFiles: MessageRow[] = [];

		// Correct strategy:
		// Use `minId: lastId` (and `limit` for batching).

		while (hasMore && this.db.isIndexingEnabled(chatId)) {
			try {
				// Fetch a batch
				// We want to fetch messages > lastId.
				// We use loop to process.

				const messages = await this.fetchWithFloodWait(() =>
					this.client!.getMessages(entity, {
						limit: this.BATCH_SIZE,
						minId: lastId,
						// reverse: true // If true, returned in chronological order (oldest first).
						// This is better for "resuming". We get 101, 102, 103...
						// then we update lastId to 103.
						reverse: true,
					})
				);

				if (!messages || messages.length === 0) {
					hasMore = false;
					break;
				}

				this.logger.debug(`Fetched ${messages.length} messages for ${chatName}.`);

				const messagesToInsert: MessageInput[] = [];
				let maxIdInBatch = lastId;

				for (const msg of messages) {
					if (msg.id <= lastId) continue; // Should be handled by minId, but safety check
					const input = this.toMessageInput(msg, chatId);
					if (!input) continue;
					messagesToInsert.push(input);
					if (msg.id > maxIdInBatch) {
						maxIdInBatch = msg.id;
					}
				}

				if (messagesToInsert.length > 0) {
					this.db.insertMessages(messagesToInsert);
					this.db.updateLastMessageId(chatId, maxIdInBatch, Date.now());
					lastId = maxIdInBatch;
					if (reportNewFiles) newFiles.push(...this.readStoredFiles(chatId, messagesToInsert));
				} else {
					// We got messages but none were suitable or all were old?
					// With minId and reverse=true, this shouldn't happen unless they are empty.
					// If they are empty, we still need to advance lastId, otherwise we loop forever on the same empty messages.
					// Wait, if messages are returned, we should use the id of the last one to advance.
					if (messages.length > 0) {
						const lastMsg = messages[messages.length - 1];
						if (lastMsg.id > lastId) {
							lastId = lastMsg.id;
							this.db.updateLastMessageId(chatId, lastId);
						}
					}
				}

				if (messages.length < this.BATCH_SIZE) {
					hasMore = false;
				}

				// Rate limiting pause
				await sleep(this.RATE_LIMIT_DELAY);
			} catch (err) {
				if (err instanceof FloodWaitError) {
					const waitSeconds = err.seconds;
					this.logger.warn(`FloodWaitError: Waiting for ${waitSeconds} seconds.`);
					await sleep((waitSeconds + 1) * 1000);
				} else {
					this.logger.error(`Error fetching history for ${chatName}:`, err);
					lastError = err instanceof Error ? err.message : String(err);
					hasMore = false; // Abort this chat on other errors
				}
			}
		}

		this.db.recordChatCheck(chatId, Date.now(), lastError);
		if (newFiles.length > 0) this.emitNewFilesIndexed(newFiles, chatName);
	}

	/** The row to store for a message, or null when it carries neither text nor media. */
	private toMessageInput(msg: Api.Message, chatId: string): MessageInput | null {
		// Analyze media
		let hasMedia: boolean = false;
		let mediaType: string | undefined = undefined;
		let fileName: string | undefined = undefined;
		let fileSize: number | undefined = undefined;

		if (msg.media) {
			hasMedia = true;
			mediaType = msg.media.className;

			// Safe casting or type checking would be better, but for GramJS explicit types we can do check:
			if (msg.media.className === 'MessageMediaDocument' && 'document' in msg.media) {
				const doc = msg.media.document;
				if (doc instanceof Api.Document) {
					// It's a file
					fileSize = doc.size.toJSNumber();
					for (const attr of doc.attributes) {
						if (attr instanceof Api.DocumentAttributeFilename) {
							fileName = attr.fileName;
						}
					}
					if (!fileName) {
						// Try to guess based on mime type or use default
						fileName = `file_${doc.id}`;
					}
				}
			} else if (msg.media.className === 'MessageMediaPhoto') {
				mediaType = 'Photo';
			}
		}

		const text = msg.message || '';
		if (!text && !hasMedia) return null;

		return {
			chatId: chatId,
			// In Telegram forum supergroups two cases exist:
			// 1) Reply to a specific message inside the topic:
			//    replyToTopId = topic ID, replyToMsgId = the replied-to message.
			// 2) Message posted directly to the topic (no specific reply):
			//    forumTopic = true, replyToTopId NOT set, replyToMsgId = topic ID.
			// Using only replyToTopId causes case 2 to be stored as topic 0.
			topicId: msg.replyTo?.replyToTopId ?? (msg.replyTo?.forumTopic ? msg.replyTo!.replyToMsgId : undefined) ?? 0,
			messageId: msg.id,
			senderId: msg.senderId ? msg.senderId.toString() : 'unknown',
			date: msg.date,
			text: text,
			hasMedia,
			mediaType,
			fileName,
			fileSize,
		};
	}

	/** The just-stored messages that carry a file, read back from the view so the rows carry the chat and topic names. */
	private readStoredFiles(chatId: string, stored: MessageInput[]): MessageRow[] {
		const rows: MessageRow[] = [];
		for (const m of stored) {
			if (!m.fileName || !m.fileSize) continue;
			const row = this.db.getMessage(chatId, m.messageId);
			if (row) rows.push(row);
		}
		return rows;
	}

	/** A listener failing must not count as an indexing error of the chat. */
	private emitNewFilesIndexed(rows: MessageRow[], chatName: string) {
		for (const listener of this.newFilesListeners) {
			try {
				listener(rows);
			} catch (err) {
				this.logger.error(`A new-files listener failed for ${chatName}:`, err);
			}
		}
	}

	private async fetchWithFloodWait<T>(fn: () => Promise<T>): Promise<T> {
		return this.executeWithRetry(fn);
	}

	public getDownloadStatus(hash: string) {
		return this.downloadManager.getDownloadStatus(hash);
	}

	public startDownload(chatId: string, messageId: number, hash: string): Promise<boolean> {
		return this.downloadManager.startDownload(chatId, messageId, hash);
	}

	public pauseDownload(hash: string) {
		this.downloadManager.pauseDownload(hash);
	}

	public resumeDownload(hash: string) {
		this.downloadManager.resumeDownload(hash);
	}

	public cancelDownload(hash: string) {
		this.downloadManager.cancelDownload(hash);
	}

	public getFileInfo(chatId: string, messageId: number) {
		return this.db.getMessage(chatId, messageId);
	}

	public getChatTitle(chatId: string): string | undefined {
		return this.db.getChatTitle(chatId);
	}

	public async search(query: string, limit: number = 50, cursorId: number = 0) {
		if (!this.isSearchEnabled()) {
			return { results: [], nextCursor: null };
		}
		const { rows, nextCursor } = await this.db.searchFiles(query, limit, cursorId);
		const available = await this.dropMissingMedia(rows.filter((f) => f.file_size));
		const results = available.map((msg) => {
			const hash = `telegram:${msg.chat_id}:${msg.message_id}`;

			return {
				name: msg.file_name || 'Unknown',
				size: msg.file_size || 0,
				hash: hash,
				chatId: msg.chat_id,
				chatTitle: msg.chat_title || undefined,
				topicName: msg.topic_name || undefined,
				messageId: msg.message_id,
				type: msg.media_type || '',
			} as TelegramIndexerSearchResult;
		});
		return { results, nextCursor };
	}

	/**
	 * Indexed media can vanish from Telegram (deleted messages, attachments edited away),
	 * leaving search hits that can no longer be downloaded. Re-checks `rows` against
	 * Telegram, purges the missing ones from the index and returns only those still
	 * available.
	 *
	 * Rows confirmed within MEDIA_VERIFY_TTL_MS are trusted without a call so repeated
	 * searches (e.g. *arr batches) stay cheap; the rest cost one API call per chat per
	 * 100 ids. Rows whose check fails (offline, FloodWait above the client threshold,
	 * left channel...) are kept — never purge on a transient error.
	 */
	private async dropMissingMedia(rows: MessageRow[]): Promise<MessageRow[]> {
		if (!this.client?.connected || this.authStatus !== 'connected') return rows;

		const now = Date.now();
		const stale = rows.filter((r) => !r.media_verified_at || now - r.media_verified_at > this.MEDIA_VERIFY_TTL_MS);
		if (stale.length === 0) return rows;

		const byChat = new Map<string, MessageRow[]>();
		for (const row of stale) {
			const list = byChat.get(row.chat_id) ?? [];
			list.push(row);
			byChat.set(row.chat_id, list);
		}

		const confirmed: MessageRow[] = [];
		const missing: MessageRow[] = [];
		for (const [chatId, chatRows] of byChat) {
			try {
				// GramJS batches ids 100 per request and yields `undefined` for deleted messages
				const messages = await this.client.getMessages(chatId, { ids: chatRows.map((r) => r.message_id) });
				const available = new Set<number>();
				for (const msg of messages as Array<Api.Message | undefined>) {
					if (msg && getDownloadableDocument(msg)) available.add(msg.id);
				}
				for (const row of chatRows) {
					(available.has(row.message_id) ? confirmed : missing).push(row);
				}
			} catch (err) {
				this.logger.warn(`Could not verify ${chatRows.length} media in chat ${chatId}, keeping them: ${err}`);
			}
		}

		if (confirmed.length > 0) this.db.markMediaVerified(confirmed, now);
		if (missing.length === 0) return rows;

		this.db.deleteMessages(missing);
		this.logger.info(`Purged ${missing.length} media no longer available on Telegram.`);
		const gone = new Set(missing.map((r) => r.id));
		return rows.filter((r) => !gone.has(r.id));
	}

	private async executeWithRetry<T>(fn: () => Promise<T>, retries = 5): Promise<T> {
		try {
			return await fn();
		} catch (err) {
			if (err instanceof FloodWaitError) {
				const waitSeconds = err.seconds;
				this.logger.warn(`FloodWait caught in wrapper: waiting ${waitSeconds}s`);
				await sleep((waitSeconds + 1) * 1000);
				return this.executeWithRetry(fn, retries - 1);
			}
			if (retries > 0) {
				this.logger.error(`Error in API call, retrying... (${retries} left)`, err);
				await sleep(2000);
				return this.executeWithRetry(fn, retries - 1);
			}
			throw err;
		}
	}
}
