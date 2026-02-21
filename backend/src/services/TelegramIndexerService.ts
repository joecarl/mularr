import * as path from 'path';
import * as fs from 'fs';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Logger } from 'telegram/extensions';
import { FloodWaitError } from 'telegram/errors/RPCErrorList';
import { Dialog } from 'telegram/tl/custom/dialog';
import { container } from './container/ServiceContainer';
import { TelegramIndexerDB } from './db/TelegramIndexerDB';
import { MainDB } from './db/MainDB';

// Define a simple logger interface or use console
const logger = {
	info: (msg: string) => console.log(`[TelegramIndexer] ${msg}`),
	error: (msg: string, err?: any) => console.error(`[TelegramIndexer] ${msg}`, err),
	warn: (msg: string) => console.warn(`[TelegramIndexer] ${msg}`),
};

export type AuthStatus = 'disconnected' | 'waiting_code' | 'waiting_password' | 'connected' | 'authenticating';

export interface DownloadStatus {
	hash: string;
	fileName: string;
	size: number;
	downloaded: number;
	speed: number;
	status: 'downloading' | 'completed' | 'error' | 'stopped';
	startTime: number;
	lastUpdate?: number;
	lastBytes?: number;
}

export class TelegramIndexerService {
	private readonly mainDb = container.get(MainDB);
	private client: TelegramClient | null = null;
	private db: TelegramIndexerDB;
	private activeDownloads: Map<string, DownloadStatus> = new Map();
	private completedDownloads: Map<string, DownloadStatus> = new Map();
	private downloadDir: string;

	// Auth State
	private authStatus: AuthStatus = 'disconnected';
	// private tempApiId: number | null = null;
	// private tempApiHash: string | null = null;
	private tempPhone: string | null = null;
	private tempPhoneCodeHash: string | null = null;

	private isIndexing = false;
	private readonly BATCH_SIZE = 50;
	private readonly RATE_LIMIT_DELAY = 1000;

	constructor() {
		// Initialize DB
		const dbDir = path.dirname(this.mainDb.dbPath);
		const indexerDbPath = path.join(dbDir, 'indexer.db');
		this.db = new TelegramIndexerDB(indexerDbPath);
		this.downloadDir = path.join(path.dirname(this.mainDb.dbPath), 'telegram-downloads');
		if (!fs.existsSync(this.downloadDir)) {
			fs.mkdirSync(this.downloadDir, { recursive: true });
		}
	}

	public async getAuthStatus() {
		return {
			status: this.authStatus,
			// phoneNumber: this.tempPhone, // For UI feedback
			user: this.client && this.authStatus === 'connected' ? await this.client.getMe() : null, // Return user info if connected
		};
	}

	public async start() {
		// Try to recover session from DB
		const config = this.getExtensionConfig();

		if (config && config.apiId && config.apiHash) {
			// Restore session if available
			if (config.session) {
				logger.info('Restoring Telegram session from DB...');
				await this.connectClient(config.apiId, config.apiHash, config.session);
			}
		}
	}

	private getExtensionConfig(): any {
		const ext = this.mainDb.getExtensionByType('telegram_indexer');
		if (ext && ext.config) {
			try {
				return JSON.parse(ext.config);
			} catch (e) {
				return {};
			}
		}
		return {};
	}

	private saveExtensionConfig(newConfig: any) {
		// Ensure extension exists
		let ext = this.mainDb.getExtensionByType('telegram_indexer');
		if (!ext) {
			const id = this.mainDb.addExtension({
				name: 'Telegram Integration',
				url: 'local',
				type: 'telegram_indexer',
				enabled: 1,
				config: '{}',
			});
			ext = this.mainDb.getExtensionById(Number(id));
		}

		if (!ext) return; // Should not happen

		const currentConfig = this.getExtensionConfig();
		const finalConfig = { ...currentConfig, ...newConfig };

		this.mainDb.updateExtensionConfig(ext.id, JSON.stringify(finalConfig));
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
			this.saveExtensionConfig({ apiId, apiHash });
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
			await (this.client as any).signIn({
				password: password,
			});

			this.onLoginSuccess();
		} catch (e: any) {
			throw e;
		}
	}

	private onLoginSuccess() {
		this.authStatus = 'connected';
		const session = this.client!.session.save() as unknown as string;
		this.saveExtensionConfig({ session });
		logger.info('Telegram login successful!');
		this.runIndexingLoop();
	}

	public async logout() {
		if (this.client) {
			await this.client.disconnect();
			this.client = null;
		}
		this.authStatus = 'disconnected';

		// Clear session from DB but keep API config
		this.saveExtensionConfig({ session: null });
	}

	// -- Chat Management --

	public getDiscoveredChats() {
		return this.db.getAllChats();
	}

	public setChatIndexing(chatId: string, enabled: boolean) {
		this.db.setChatIndexing(chatId, enabled);
	}

	// -- Client Actions --

	private async connectClient(apiId: number, apiHash: string, sessionString: string) {
		this.client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, { connectionRetries: 5 });
		await this.client.connect();
		this.authStatus = 'connected';
		this.runIndexingLoop();
	}

	private async runIndexingLoop() {
		// Just a safeguard if client is not connected
		if (this.isIndexing || !this.client || !this.client.connected) return;
		this.isIndexing = true;

		try {
			const dialogs = await this.getAllDialogs();
			logger.info(`Found ${dialogs.length} total dialogs.`);

			// ... (rest of function unchanged until end) ...

			// First pass: Register all chats
			for (const dialog of dialogs) {
				const chatId = dialog.id?.toString();
				if (!chatId) continue;

				// Skip user chats as requested
				if (dialog.isUser) continue;

				const name = dialog.title || chatId || 'Unknown';
				let type = 'chat';
				if (dialog.isChannel) type = 'channel';
				if (dialog.isGroup) type = 'group';

				this.db.registerChat(chatId, name, type);
			}

			const enabledChats = this.db.getIndexingEnabledChats();
			logger.info(`Found ${enabledChats.length} chats enabled for indexing.`);

			for (const chat of enabledChats) {
				// Find the dialog object again or use collected map
				const dialog = dialogs.find((d) => d.id?.toString() === chat.id);
				if (dialog) {
					await this.indexDialog(dialog, chat.title);
				}
			}

			logger.info('Full indexing cycle complete. Scheduling next check.');
		} catch (error) {
			logger.error('Error during indexing cycle:', error);
		} finally {
			this.isIndexing = false;
			// Schedule next run in 5 minutes (user said "consultas periodicas")
			setTimeout(() => this.runIndexingLoop(), 5 * 60 * 1000);
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
				logger.info(`Registered ${totalFetched} forum topics so far for chat ${chatId}`);

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
				logger.warn(`Could not fetch forum topics for ${chatId}: ${err}`);
				break;
			}
		}
	}

	private async indexChatHistory(entity: Api.TypeInputPeer, chatId: string, chatName: string) {
		let lastId = this.db.getLastMessageId(chatId);
		logger.info(`Indexing ${chatName} (ID: ${chatId}) starting from ${lastId}...`);

		let hasMore = true;

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

				logger.info(`Fetched ${messages.length} messages for ${chatName}.`);

				const messagesToInsert = [];
				let maxIdInBatch = lastId;

				for (const msg of messages) {
					if (msg.id <= lastId) continue; // Should be handled by minId, but safety check

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
								//fileName = doc.attributes?.find((a: any) => a.className === 'DocumentAttributeFilename')?.fileName;
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
					if (!text && !hasMedia) continue;

					messagesToInsert.push({
						chatId: chatId,
						topicId: msg.replyTo?.replyToTopId ?? 0,
						messageId: msg.id,
						senderId: msg.senderId ? msg.senderId.toString() : 'unknown',
						date: msg.date,
						text: text,
						hasMedia,
						mediaType,
						fileName,
						fileSize,
					});

					if (msg.id > maxIdInBatch) {
						maxIdInBatch = msg.id;
					}
				}

				if (messagesToInsert.length > 0) {
					this.db.insertMessages(messagesToInsert);
					this.db.updateLastMessageId(chatId, maxIdInBatch);
					lastId = maxIdInBatch;
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
				await new Promise((resolve) => setTimeout(resolve, this.RATE_LIMIT_DELAY));
			} catch (err) {
				if (err instanceof FloodWaitError) {
					const waitSeconds = err.seconds;
					logger.warn(`FloodWaitError: Waiting for ${waitSeconds} seconds.`);
					await new Promise((resolve) => setTimeout(resolve, (waitSeconds + 1) * 1000));
				} else {
					logger.error(`Error fetching history for ${chatName}:`, err);
					hasMore = false; // Abort this chat on other errors
				}
			}
		}
	}

	private async fetchWithFloodWait<T>(fn: () => Promise<T>): Promise<T> {
		return this.executeWithRetry(fn);
	}

	public getDownloadStatus(hash: string): DownloadStatus | undefined {
		if (this.activeDownloads.has(hash)) {
			return this.activeDownloads.get(hash);
		}
		if (this.completedDownloads.has(hash)) {
			return this.completedDownloads.get(hash);
		}
		// hash format: telegram:chatId:messageId — look up directly without a search scan
		const parts = hash.split(':');
		if (parts.length >= 3) {
			const msg = this.db.getMessage(parts[1], parseInt(parts[2]));
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

	public async startDownload(chatId: string, messageId: number, hash: string): Promise<boolean> {
		if (!this.client || this.authStatus !== 'connected') {
			logger.error('Cannot start download: Client not connected');
			return false;
		}

		if (this.activeDownloads.has(hash) || this.completedDownloads.has(hash)) {
			return true;
		}

		try {
			// Fetch message to get media
			const messages = await this.client.getMessages(chatId, { ids: [messageId] });
			if (!messages || messages.length === 0) {
				logger.error(`Message not found for download: ${chatId}:${messageId}`);
				return false;
			}
			const message = messages[0];
			if (!message.media) {
				logger.error(`Message has no media: ${chatId}:${messageId}`);
				return false;
			}

			// Get filename
			// @ts-ignore - attributes might not be strictly typed in some versions
			let fileName = 'unknown_file';
			// Try to find filename in attributes
			if (message.file && message.file.name) {
				fileName = message.file.name;
			} else {
				// Fallback
				fileName = `telegram_${hash}`;
			}

			const fileSize = message.file?.size ? Number(message.file.size) : 0;

			// Initialize status
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

			const outPath = path.join(this.downloadDir, fileName);
			logger.info(`Starting download: ${fileName} -> ${outPath}`);

			// Start download asynchronously
			this.client
				.downloadMedia(message, {
					outputFile: outPath,
					progressCallback: (downloaded, total) => {
						const now = Date.now();
						const downloadedNum = Number(downloaded);
						const totalNum = Number(total);

						const status = this.activeDownloads.get(hash);
						if (status) {
							// Calculate speed
							if (status.lastUpdate && now - status.lastUpdate > 1000) {
								const diffBytes = downloadedNum - (status.lastBytes || 0);
								const diffTime = (now - status.lastUpdate) / 1000;
								status.speed = diffBytes / diffTime;
								status.lastUpdate = now;
								status.lastBytes = downloadedNum;
							}

							status.downloaded = downloadedNum;
							// status.size = totalNum; // Optional update
						}
					},
				})
				.then(() => {
					logger.info(`Download completed: ${fileName}`);
					const status = this.activeDownloads.get(hash);
					if (status) {
						status.status = 'completed';
						status.downloaded = status.size;
						status.speed = 0;
						this.completedDownloads.set(hash, status);
						this.activeDownloads.delete(hash);
					}
				})
				.catch((err) => {
					logger.error(`Download failed: ${fileName}`, err);
					const status = this.activeDownloads.get(hash);
					if (status) {
						status.status = 'error';
						status.speed = 0;
						// Move to completed (as failed) or keep in active with error state?
						// For now keep in active so UI sees error
					}
				});

			return true;
		} catch (err) {
			logger.error('Error starting download:', err);
			return false;
		}
	}

	public cancelDownload(hash: string) {
		if (this.activeDownloads.has(hash)) {
			// There is no easy way to cancel a promise in JS/GramJS unless we destroy the client or use AbortController if supported
			// GramJS doesn't seem to support AbortSignal in downloadMedia directly in standard docs, but let's check.
			// For now, we just remove from active map so UI updates. The download might continue in background until completion or error.
			// To truly cancel, we might need a workaround.
			// Actually, removing from map stops progress updates.
			const status = this.activeDownloads.get(hash);
			if (status) {
				status.status = 'stopped';
				this.activeDownloads.delete(hash); // Or keep as stopped?
				// Keeping as stopped allows UI to show "Stopped"
				this.activeDownloads.set(hash, status);
			}
		}
	}

	public getFileInfo(chatId: string, messageId: number) {
		return this.db.getMessage(chatId, messageId);
	}

	public async search(query: string, limit: number = 50, cursorId: number = 0) {
		const ext = this.mainDb.getExtensionByType('telegram_indexer');
		if (!ext || !ext.enabled) {
			return { results: [], nextCursor: null };
		}
		const { rows, nextCursor } = await this.db.searchFiles(query, limit, cursorId);
		const results = rows
			.filter((f) => f.file_size)
			.map((msg) => ({
				name: msg.file_name || 'Unknown',
				size: msg.file_size || 0,
				hash: `telegram:${msg.chat_id}:${msg.message_id}`,
				provider: 'telegram',
				chatId: msg.chat_id,
				messageId: msg.message_id,
				sources: 1,
				completeSources: 1,
				downloadStatus: 'Unknown',
				type: msg.media_type || '',
				link: `telegram:${msg.chat_id}:${msg.message_id}`,
			}));
		return { results, nextCursor };
	}

	private async executeWithRetry<T>(fn: () => Promise<T>, retries = 5): Promise<T> {
		try {
			return await fn();
		} catch (err) {
			if (err instanceof FloodWaitError) {
				const waitSeconds = err.seconds;
				logger.warn(`FloodWait caught in wrapper: waiting ${waitSeconds}s`);
				await new Promise((resolve) => setTimeout(resolve, (waitSeconds + 1) * 1000));
				return this.executeWithRetry(fn, retries - 1);
			}
			if (retries > 0) {
				logger.error(`Error in API call, retrying... (${retries} left)`, err);
				await new Promise((resolve) => setTimeout(resolve, 2000));
				return this.executeWithRetry(fn, retries - 1);
			}
			throw err;
		}
	}
}
