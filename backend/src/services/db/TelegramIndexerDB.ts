import Database from 'better-sqlite3';

export interface Chat {
	id: string;
	title: string;
	type: string;
	indexing_enabled: number;
}

export interface IndexingProgress {
	chat_id: string;
	topic_id: number;
	last_message_id: number;
}

export interface MessageInput {
	chatId: string;
	topicId: number;
	messageId: number;
	senderId: string;
	date: number;
	text: string;
	hasMedia: boolean;
	mediaType?: string;
	fileName?: string;
	fileSize?: number;
}

export interface MessageRow {
	id: number;
	chat_id: string;
	topic_id: number;
	message_id: number;
	sender_id: string;
	date: number;
	text: string;
	has_media: number;
	media_type: string | null;
	file_name: string | null;
	file_size: number | null;
}

export class TelegramIndexerDB {
	private db: Database.Database;

	constructor(dbPath: string) {
		this.db = new Database(dbPath);
		this.db.pragma('journal_mode = WAL');
		this.initialize();
	}

	private initialize() {
		// Table to store discovered chats and their indexing status
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS chats (
				id TEXT PRIMARY KEY,
				title TEXT,
				type TEXT,
				indexing_enabled INTEGER DEFAULT 0
			);
		`);

		// Table to track indexing progress
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS indexing_progress (
				chat_id TEXT NOT NULL,
				topic_id INTEGER DEFAULT 0,
				last_message_id INTEGER DEFAULT 0,
				PRIMARY KEY (chat_id, topic_id)
			);
		`);

		// FTS5 table for messages
		this.db.exec(`
			CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
				chat_id UNINDEXED,
				topic_id UNINDEXED,
				message_id UNINDEXED,
				sender_id UNINDEXED,
				date UNINDEXED,
				text,
				content='messages_content',
				content_rowid='id'
			);
		`);

		// Real content table with media columns
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS messages_content (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				chat_id TEXT NOT NULL,
				topic_id INTEGER DEFAULT 0,
				message_id INTEGER NOT NULL,
				sender_id TEXT,
				date INTEGER,
				text TEXT,
				has_media INTEGER DEFAULT 0,
				media_type TEXT,
				file_name TEXT,
				file_size INTEGER,
				UNIQUE(chat_id, topic_id, message_id)
			);
		`);

		// Triggers to keep FTS in sync
		this.db.exec(`
			CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages_content BEGIN
				INSERT INTO messages_fts(rowid, text, chat_id, topic_id, message_id, sender_id, date) 
				VALUES (new.id, new.text, new.chat_id, new.topic_id, new.message_id, new.sender_id, new.date);
			END;

			CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages_content BEGIN
				INSERT INTO messages_fts(messages_fts, rowid, text, chat_id, topic_id, message_id, sender_id, date) 
				VALUES('delete', old.id, old.text, old.chat_id, old.topic_id, old.message_id, old.sender_id, old.date);
			END;

			CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages_content BEGIN
				INSERT INTO messages_fts(messages_fts, rowid, text, chat_id, topic_id, message_id, sender_id, date) 
				VALUES('delete', old.id, old.text, old.chat_id, old.topic_id, old.message_id, old.sender_id, old.date);
				INSERT INTO messages_fts(rowid, text, chat_id, topic_id, message_id, sender_id, date) 
				VALUES (new.id, new.text, new.chat_id, new.topic_id, new.message_id, new.sender_id, new.date);
			END;
		`);
	}

	public registerChat(id: string, title: string, type: string) {
		this.db
			.prepare(
				`
				INSERT INTO chats (id, title, type) 
				VALUES (?, ?, ?) 
				ON CONFLICT(id) DO UPDATE SET title = ?
			`
			)
			.run(id, title, type, title);
	}

	public getIndexingEnabledChats(): Array<Pick<Chat, 'id' | 'title'>> {
		return this.db.prepare('SELECT id, title FROM chats WHERE indexing_enabled = 1').all() as Array<Pick<Chat, 'id' | 'title'>>;
	}

	public isIndexingEnabled(chatId: string): boolean {
		const row = this.db.prepare('SELECT indexing_enabled FROM chats WHERE id = ?').get(chatId) as Pick<Chat, 'indexing_enabled'> | undefined;
		return row ? row.indexing_enabled === 1 : false;
	}

	public getLastMessageId(chatId: string, topicId: number = 0): number {
		const row = this.db.prepare('SELECT last_message_id FROM indexing_progress WHERE chat_id = ? AND topic_id = ?').get(chatId, topicId) as
			| Pick<IndexingProgress, 'last_message_id'>
			| undefined;
		return row ? row.last_message_id : 0;
	}

	public updateLastMessageId(chatId: string, topicId: number, lastMessageId: number) {
		this.db
			.prepare(
				`
				INSERT INTO indexing_progress (chat_id, topic_id, last_message_id) 
				VALUES (?, ?, ?) 
				ON CONFLICT(chat_id, topic_id) DO UPDATE SET last_message_id = ?
			`
			)
			.run(chatId, topicId, lastMessageId, lastMessageId);
	}

	public insertMessages(messages: MessageInput[]) {
		const insert = this.db.prepare(`
			INSERT OR IGNORE INTO messages_content (chat_id, topic_id, message_id, sender_id, date, text, has_media, media_type, file_name, file_size)
			VALUES (@chatId, @topicId, @messageId, @senderId, @date, @text, @hasMedia, @mediaType, @fileName, @fileSize)
		`);

		const insertMany = this.db.transaction((msgs: MessageInput[]) => {
			for (const msg of msgs) {
				// SQLite normalization for nullable fields and booleans
				const safeMsg = {
					...msg,
					hasMedia: msg.hasMedia ? 1 : 0,
					mediaType: msg.mediaType ?? null,
					fileName: msg.fileName ?? null,
					fileSize: msg.fileSize !== null && msg.fileSize !== undefined ? BigInt(msg.fileSize) : null,
				};
				insert.run(safeMsg);
			}
		});

		insertMany(messages);
	}

	public search(query: string, limit: number = 20): MessageRow[] {
		return this.db
			.prepare(
				`
				SELECT * FROM messages_fts WHERE messages_fts MATCH ? ORDER BY rank LIMIT ?
			`
			)
			.all(query, limit) as MessageRow[];
	}

	public getMessage(chatId: string, messageId: number): MessageRow | undefined {
		return this.db.prepare('SELECT * FROM messages_content WHERE chat_id = ? AND message_id = ?').get(chatId, messageId) as MessageRow | undefined;
	}

	public async searchFiles(query: string, limit: number = 50, offset: number = 0): Promise<MessageRow[]> {
		// better-sqlite3 is synchronous; yield to the event loop before running the
		// query so callers in pagination loops don't starve other async work.
		// This is the only place that needs to know about the sync/async impedance.
		await new Promise((resolve) => setTimeout(resolve, 0));
		return this.db
			.prepare(
				`
				SELECT * FROM messages_content 
				WHERE has_media = 1 
				AND (file_name LIKE ? OR text LIKE ?)
				ORDER BY date DESC 
				LIMIT ? OFFSET ?
			`
			)
			.all(`%${query}%`, `%${query}%`, limit, offset) as MessageRow[];
	}

	public getContext(chatId: string, messageId: number, window: number = 5): MessageRow[] {
		return this.db
			.prepare(
				`
				SELECT * FROM messages_content 
				WHERE chat_id = ? 
				AND message_id BETWEEN ? AND ?
				ORDER BY message_id ASC
			`
			)
			.all(chatId, messageId - window, messageId + window) as MessageRow[];
	}

	public getAllChats(): Chat[] {
		return this.db.prepare('SELECT * FROM chats').all() as Chat[];
	}

	public setChatIndexing(chatId: string, enabled: boolean) {
		this.db
			.prepare(
				`
				UPDATE chats 
				SET indexing_enabled = ? 
				WHERE id = ?
			`
			)
			.run(enabled ? 1 : 0, chatId);
	}

	public close() {
		this.db.close();
	}
}
