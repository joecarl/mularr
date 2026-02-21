import Database from 'better-sqlite3';

export interface Chat {
	id: string;
	title: string;
	type: string;
	indexing_enabled: number;
}

export interface IndexingProgress {
	chat_id: string;
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
	chat_title: string | null;
	topic_id: number;
	topic_name: string | null;
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
		// Source of truth for chat titles
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS chats (
				id TEXT PRIMARY KEY,
				title TEXT,
				type TEXT,
				indexing_enabled INTEGER DEFAULT 0
			);
		`);

		// Source of truth for topic names (normalized)
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS topics (
				chat_id TEXT NOT NULL,
				topic_id INTEGER NOT NULL,
				topic_name TEXT,
				PRIMARY KEY (chat_id, topic_id)
			);
		`);

		// Table to track indexing progress
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS indexing_progress (
				chat_id TEXT NOT NULL,
				last_message_id INTEGER DEFAULT 0,
				PRIMARY KEY (chat_id)
			);
		`);

		// Raw message content — no denormalized name columns
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

		// View that joins messages with their normalized names — used as FTS5 content source
		this.db.exec(`
			CREATE VIEW IF NOT EXISTS messages_view AS
			SELECT
				mc.id,
				mc.chat_id,
				c.title        AS chat_title,
				mc.topic_id,
				t.topic_name,
				mc.message_id,
				mc.sender_id,
				mc.date,
				mc.text,
				mc.has_media,
				mc.media_type,
				mc.file_name,
				mc.file_size
			FROM messages_content mc
			LEFT JOIN chats c  ON c.id = mc.chat_id
			LEFT JOIN topics t ON t.chat_id = mc.chat_id AND t.topic_id = mc.topic_id;
		`);

		// FTS5 — content source is the view so rebuild reads resolved names automatically
		// Searchable columns: text, file_name, chat_title, topic_name
		this.db.exec(`
			CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
				chat_id    UNINDEXED,
				chat_title,
				topic_id   UNINDEXED,
				topic_name,
				message_id UNINDEXED,
				sender_id  UNINDEXED,
				date       UNINDEXED,
				text,
				file_name,
				content='messages_view',
				content_rowid='id',
				tokenize='unicode61 remove_diacritics 2'
			);
		`);

		// Triggers — resolve names via subquery so they stay current with chats/topics tables
		this.db.exec(`
			CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages_content BEGIN
				INSERT INTO messages_fts(rowid, chat_id, chat_title, topic_id, topic_name, message_id, sender_id, date, text, file_name)
				VALUES (
					new.id,
					new.chat_id,
					(SELECT title FROM chats WHERE id = new.chat_id),
					new.topic_id,
					(SELECT topic_name FROM topics WHERE chat_id = new.chat_id AND topic_id = new.topic_id),
					new.message_id, new.sender_id, new.date, new.text, new.file_name
				);
			END;

			CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages_content BEGIN
				INSERT INTO messages_fts(messages_fts, rowid, chat_id, chat_title, topic_id, topic_name, message_id, sender_id, date, text, file_name)
				VALUES (
					'delete', old.id,
					old.chat_id,
					(SELECT title FROM chats WHERE id = old.chat_id),
					old.topic_id,
					(SELECT topic_name FROM topics WHERE chat_id = old.chat_id AND topic_id = old.topic_id),
					old.message_id, old.sender_id, old.date, old.text, old.file_name
				);
			END;

			CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages_content BEGIN
				INSERT INTO messages_fts(messages_fts, rowid, chat_id, chat_title, topic_id, topic_name, message_id, sender_id, date, text, file_name)
				VALUES (
					'delete', old.id,
					old.chat_id,
					(SELECT title FROM chats WHERE id = old.chat_id),
					old.topic_id,
					(SELECT topic_name FROM topics WHERE chat_id = old.chat_id AND topic_id = old.topic_id),
					old.message_id, old.sender_id, old.date, old.text, old.file_name
				);
				INSERT INTO messages_fts(rowid, chat_id, chat_title, topic_id, topic_name, message_id, sender_id, date, text, file_name)
				VALUES (
					new.id,
					new.chat_id,
					(SELECT title FROM chats WHERE id = new.chat_id),
					new.topic_id,
					(SELECT topic_name FROM topics WHERE chat_id = new.chat_id AND topic_id = new.topic_id),
					new.message_id, new.sender_id, new.date, new.text, new.file_name
				);
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

	public getLastMessageId(chatId: string): number {
		const row = this.db.prepare('SELECT last_message_id FROM indexing_progress WHERE chat_id = ?').get(chatId) as
			| Pick<IndexingProgress, 'last_message_id'>
			| undefined;
		return row ? row.last_message_id : 0;
	}

	public updateLastMessageId(chatId: string, lastMessageId: number) {
		this.db
			.prepare(
				`INSERT INTO indexing_progress (chat_id, last_message_id)
				 VALUES (?, ?)
				 ON CONFLICT(chat_id) DO UPDATE SET last_message_id = ?`
			)
			.run(chatId, lastMessageId, lastMessageId);
	}

	public registerTopic(chatId: string, topicId: number, topicName: string) {
		this.db
			.prepare(
				`INSERT INTO topics (chat_id, topic_id, topic_name)
				 VALUES (?, ?, ?)
				 ON CONFLICT(chat_id, topic_id) DO UPDATE SET topic_name = ?`
			)
			.run(chatId, topicId, topicName, topicName);
	}

	public insertMessages(messages: MessageInput[]) {
		const insert = this.db.prepare(`
			INSERT OR IGNORE INTO messages_content (chat_id, topic_id, message_id, sender_id, date, text, has_media, media_type, file_name, file_size)
			VALUES (@chatId, @topicId, @messageId, @senderId, @date, @text, @hasMedia, @mediaType, @fileName, @fileSize)
		`);

		const insertMany = this.db.transaction((msgs: MessageInput[]) => {
			for (const msg of msgs) {
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

	/**
	 * Search for media files using FTS5.
	 *
	 * Pagination uses a rowid cursor instead of OFFSET so SQLite can seek
	 * directly to the right position rather than scanning and discarding rows.
	 *
	 * @param cursorId  The `id` of the last row returned by the previous page (0 for the first page).
	 * @returns         The current page of rows and the cursor to pass for the next page
	 *                  (`nextCursor === null` means there are no more results).
	 */
	public async searchFiles(query: string, limit: number = 50, cursorId: number = 0): Promise<{ rows: MessageRow[]; nextCursor: number | null }> {
		// better-sqlite3 is synchronous; yield to the event loop before running the
		// query so callers in pagination loops don't starve other async work.
		await new Promise((resolve) => setTimeout(resolve, 0));

		const rows = this.db
			.prepare(
				`
				SELECT mv.*, bm25(messages_fts) AS score
				FROM messages_fts
				JOIN messages_view mv ON mv.id = messages_fts.rowid
				WHERE messages_fts MATCH ?
				AND mv.has_media = 1
				AND messages_fts.rowid > ?
				ORDER BY messages_fts.rowid
				LIMIT ?
			`
			)
			.all(query, cursorId, limit) as MessageRow[];

		const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;
		return { rows, nextCursor };
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
