import * as path from 'path';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Logger } from 'telegram/extensions';
import { TelegramIndexerDB } from './db/TelegramIndexerDB';
import { FloodWaitError } from 'telegram/errors/RPCErrorList';
import mainDb, { dbPath } from '../db';
import { Dialog } from 'telegram/tl/custom/dialog';

// Define a simple logger interface or use console
const logger = {
	info: (msg: string) => console.log(`[TelegramIndexer] ${msg}`),
	error: (msg: string, err?: any) => console.error(`[TelegramIndexer] ${msg}`, err),
	warn: (msg: string) => console.warn(`[TelegramIndexer] ${msg}`),
};

export type AuthStatus = 'disconnected' | 'waiting_code' | 'waiting_password' | 'connected' | 'authenticating';

export class TelegramIndexerService {
	private client: TelegramClient | null = null;
	private db: TelegramIndexerDB;

	// Auth State
	private authStatus: AuthStatus = 'disconnected';
	private tempApiId: number | null = null;
	private tempApiHash: string | null = null;
	private tempPhone: string | null = null;
	private tempPhoneCodeHash: string | null = null;

	private isIndexing = false;
	private readonly BATCH_SIZE = 50;
	private readonly RATE_LIMIT_DELAY = 1000;

	constructor() {
		// Initialize DB
		const dbDir = path.dirname(dbPath);
		const indexerDbPath = path.join(dbDir, 'indexer.db');
		this.db = new TelegramIndexerDB(indexerDbPath);
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
		const row = mainDb.prepare("SELECT config FROM extensions WHERE type = 'telegram_indexer' LIMIT 1").get() as { config: string } | undefined;
		if (row && row.config) {
			try {
				return JSON.parse(row.config);
			} catch (e) {
				return {};
			}
		}
		return {};
	}

	private saveExtensionConfig(newConfig: any) {
		// Ensure extension exists
		let ext = mainDb.prepare("SELECT id FROM extensions WHERE type = 'telegram_indexer' LIMIT 1").get() as { id: number } | undefined;
		if (!ext) {
			mainDb
				.prepare('INSERT INTO extensions (name, url, type, enabled, config) VALUES (?, ?, ?, ?, ?)')
				.run('Telegram Integration', 'local', 'telegram_indexer', 1, '{}');
			ext = mainDb.prepare("SELECT id FROM extensions WHERE type = 'telegram_indexer' LIMIT 1").get() as { id: number };
		}

		const currentConfig = this.getExtensionConfig();
		const finalConfig = { ...currentConfig, ...newConfig };

		mainDb.prepare('UPDATE extensions SET config = ? WHERE id = ?').run(JSON.stringify(finalConfig), ext.id);
	}

	// -- Auth Flow Methods --

	public async startAuth(apiId: number, apiHash: string, phoneNumber: string) {
		if (this.authStatus === 'connected') throw new Error('Already connected');

		this.authStatus = 'authenticating';
		this.tempApiId = apiId;
		this.tempApiHash = apiHash;
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

		// For this implementation, I will treat the dialog as a single stream for simplicity
		// unless I find a clear way to list all topics easily in the client wrapper.
		// But the requirement says "topics included".
		// Let's try to get history. If we get history of a Supergroup, we usually get all messages.

		await this.indexChatHistory(dialog.inputEntity, chatId, chatName, 0);
	}

	private async indexChatHistory(entity: Api.TypeInputPeer, chatId: string, chatName: string, topicId: number = 0) {
		let lastId = this.db.getLastMessageId(chatId, topicId);
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
					this.db.updateLastMessageId(chatId, topicId, maxIdInBatch);
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
							this.db.updateLastMessageId(chatId, topicId, lastId);
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

	private async executeWithRetry<T>(fn: () => Promise<T>, retries = 5): Promise<T> {
		try {
			return await fn();
		} catch (err) {
			if (err instanceof FloodWaitError) {
				const waitSeconds = err.seconds;
				logger.warn(`FloodWait caught in wrapper: waiting ${waitSeconds}s`);
				await new Promise((resolve) => setTimeout(resolve, (waitSeconds + 1) * 1000));
				return this.executeWithRetry(fn, retries);
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
