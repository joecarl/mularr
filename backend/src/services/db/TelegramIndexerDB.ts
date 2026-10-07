import Database from 'better-sqlite3';
import { LoggerFactory } from '../logging/Logger';
import { sleep } from '../../tools/asyncTools';

export interface Chat {
	id: string;
	title: string;
	type: string;
	indexing_enabled: number;
	/**
	 * Public username of the channel (lowercase, no @) as of the last indexing cycle; null for private chats.
	 * Lets the join queue skip links of chats the account is already in, see getValidChatIdByUsername.
	 */
	username: string | null;
	/**
	 * 1 when the chat is no longer among the account dialogs (left, deleted, banned...): the indexing cycle
	 * sets it and clears it again if the chat comes back. Such a chat keeps its rows but does not count as joined.
	 */
	invalid: number;
}

export interface IndexingProgress {
	chat_id: string;
	last_message_id: number;
	/** Epoch ms of the end of the last indexing pass over the chat (null if never visited). */
	last_checked_at: number | null;
	/** Epoch ms of the last pass that stored new messages (null if none did). */
	last_indexed_at: number | null;
	/** Message of the error that ended the last pass; null when it went fine. */
	last_error: string | null;
}

/** A chat plus what the index holds for it, see getChatsOverview. Every `_at` is epoch ms. */
export interface ChatOverview extends Chat {
	/** Indexed messages (text or media). */
	message_count: number;
	/** Indexed messages carrying media. */
	media_count: number;
	/** Sum of the indexed file sizes, in bytes. */
	media_size: number;
	/** Forum topics known for the chat (0 for non-forum chats). */
	topic_count: number;
	last_message_id: number;
	/** Date of the newest indexed message (null while nothing is indexed). */
	last_message_at: number | null;
	last_checked_at: number | null;
	last_indexed_at: number | null;
	last_error: string | null;
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
	/** Epoch ms of the last time Telegram confirmed the media still exists (null if never checked). Only populated by searchFiles. */
	media_verified_at?: number | null;
}

/** Identifies one indexed message. */
export type MessageRef = Pick<MessageRow, 'chat_id' | 'message_id'>;

/**
 * The Telegram account this instance signs in with. One row (see the `account` table); every field but
 * `searchEnabled` is null until the first sign-in stores it.
 */
export interface TelegramAccount {
	apiId: number | null;
	apiHash: string | null;
	/** Serialized client session; null while signed out. */
	session: string | null;
	/** Whether searches reach the Telegram index. Independent of being signed in. */
	searchEnabled: boolean;
	/** Whether video files the indexer finds in already indexed chats are published in the indexer feed (see services/indexerfeed). */
	feedEnabled: boolean;
}

interface AccountRow {
	api_id: number | null;
	api_hash: string | null;
	session: string | null;
	search_enabled: number;
	feed_enabled: number;
}

const DEFAULT_ACCOUNT: TelegramAccount = { apiId: null, apiHash: null, session: null, searchEnabled: true, feedEnabled: false };

export interface ActiveDownloadRow {
	hash: string;
	chat_id: string;
	message_id: number;
	file_name: string;
	out_path: string;
	downloaded_bytes: number;
	file_size: number;
	status: string;
	error_message?: string | null;
}

/**
 * Where a queued join stands: `pending` waits for the worker (maybe until `next_attempt_at`), `joined` is done
 * (also when the account was already a member), `request_sent` means the chat needs an admin to approve the
 * join request, and `failed` is final (see `error`) until the user retries it.
 */
export type JoinStatus = 'pending' | 'joined' | 'request_sent' | 'failed';

/** A channel link the account was asked to join, see the `join_queue` table. Every `_at` is epoch ms. */
export interface JoinQueueRow {
	id: number;
	/** The link as the user gave it, trimmed. */
	link: string;
	/** Normalized form that identifies the chat behind the link (`@name` or `+hash`), unique in the queue. */
	target: string;
	status: JoinStatus;
	/** Whether to enable indexing for the chat once joined. */
	index_on_join: number;
	/** The joined chat, once known. */
	chat_id: string | null;
	chat_title: string | null;
	/** Why the last attempt failed or was deferred; null when nothing went wrong so far. */
	error: string | null;
	attempts: number;
	added_at: number;
	/** When the last attempt ran; null while never tried. */
	attempted_at: number | null;
	/** When a pending link may be tried again (after a FLOOD_WAIT or a transient failure); null means right away. */
	next_attempt_at: number | null;
}

// Quote each term so FTS5-special chars (' - : & ( ) ") match literally
// instead of throwing; keep uppercase OR/AND/NOT as operators. Drops
// punctuation-only terms; null when nothing usable remains.
export function toFtsMatchExpr(query: string): string | null {
	const expr = query
		.split(/\s+/)
		.map((tok) => {
			if (tok === 'OR' || tok === 'AND' || tok === 'NOT') return tok;
			if (!/[\p{L}\p{N}]/u.test(tok)) return '';
			return `"${tok.replace(/"/g, '""')}"`;
		})
		.filter((tok) => tok.length > 0)
		.join(' ');
	return expr.length > 0 ? expr : null;
}

/**
 * Bumped when the search index has to be rebuilt once on existing installs; kept in PRAGMA user_version.
 *   1 — names (chat_title, topic_name) used to be read live at delete time, which left stale entries behind
 *       whenever a chat or topic had been renamed since it was indexed (see reindexWhere).
 */
const INDEX_VERSION = 1;

/** The columns of messages_fts in the order the view yields them; also what the index statements feed. */
const FTS_COLUMNS = 'chat_id, chat_title, topic_id, topic_name, message_id, sender_id, date, text, file_name';

export class TelegramIndexerDB {
	private readonly logger = LoggerFactory.create(this);
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

		this.db.exec(`
			CREATE TABLE IF NOT EXISTS active_downloads (
				hash TEXT PRIMARY KEY,
				chat_id TEXT NOT NULL,
				message_id INTEGER NOT NULL,
				file_name TEXT,
				out_path TEXT,
				downloaded_bytes INTEGER DEFAULT 0,
				file_size INTEGER,
				status TEXT,
				error_message TEXT
			);
		`);

		// Migrations: columns added after the tables shipped (each fails harmlessly once it exists)
		const migrations = [
			'ALTER TABLE active_downloads ADD COLUMN error_message TEXT',
			'ALTER TABLE indexing_progress ADD COLUMN last_checked_at INTEGER',
			'ALTER TABLE indexing_progress ADD COLUMN last_indexed_at INTEGER',
			'ALTER TABLE indexing_progress ADD COLUMN last_error TEXT',
			'ALTER TABLE chats ADD COLUMN username TEXT',
			'ALTER TABLE chats ADD COLUMN invalid INTEGER NOT NULL DEFAULT 0',
		];
		for (const sql of migrations) {
			try {
				this.db.exec(sql);
			} catch {
				// Column already exists — ignore
			}
		}

		// The account this instance signs in with: a single row, see TelegramAccount
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS account (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				api_id INTEGER,
				api_hash TEXT,
				session TEXT,
				search_enabled INTEGER NOT NULL DEFAULT 1,
				feed_enabled INTEGER NOT NULL DEFAULT 0
			);
		`);
		try {
			this.db.exec('ALTER TABLE account ADD COLUMN feed_enabled INTEGER NOT NULL DEFAULT 0');
		} catch {
			// Column already exists — ignore
		}

		// Operational per-message metadata that plays no part in search. Kept apart from
		// messages_content so writing it never fires the FTS update trigger; add here any
		// future field that should not touch the index. All columns nullable: a row may
		// carry some fields and not others.
		//   media_verified_at — epoch ms of the last time Telegram confirmed the media still exists
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS messages_metadata (
				chat_id TEXT NOT NULL,
				message_id INTEGER NOT NULL,
				media_verified_at INTEGER,
				PRIMARY KEY (chat_id, message_id)
			);
		`);

		// Channel links the account was asked to join, worked through in the background one at a time, see JoinQueueRow
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS join_queue (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				link TEXT NOT NULL,
				target TEXT NOT NULL UNIQUE,
				status TEXT NOT NULL DEFAULT 'pending',
				index_on_join INTEGER NOT NULL DEFAULT 0,
				chat_id TEXT,
				chat_title TEXT,
				error TEXT,
				attempts INTEGER NOT NULL DEFAULT 0,
				added_at INTEGER NOT NULL,
				attempted_at INTEGER,
				next_attempt_at INTEGER
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

		// Indexes built before INDEX_VERSION may hold stale entries; one rebuild brings them in line with the content
		const indexVersion = this.db.pragma('user_version', { simple: true }) as number;
		if (indexVersion < INDEX_VERSION) {
			if (indexVersion > 0 || this.countMessages() > 0)
				this.logger.info('Rebuilding the Telegram search index once to drop stale entries left by renamed chats and topics...');
			this.rebuildIndex();
			this.db.pragma(`user_version = ${INDEX_VERSION}`);
		}
	}

	// ── Search index maintenance ──────────────────────────────────────────────

	private countMessages(): number {
		return (this.db.prepare('SELECT COUNT(*) AS n FROM messages_content').get() as { n: number }).n;
	}

	/** Rebuilds the FTS index from messages_view: the one cure once its entries no longer match the content. */
	public rebuildIndex() {
		this.db.exec(`INSERT INTO messages_fts(messages_fts) VALUES('rebuild')`);
	}

	/**
	 * Runs `fn`; if SQLite reports the index as corrupt (what FTS5 does once its entries disagree with the
	 * content, "database disk image is malformed"), rebuilds the index and runs `fn` again. A statement that
	 * failed inside a transaction was rolled back, so the retry starts clean.
	 */
	private withIndexRepair<T>(fn: () => T): T {
		try {
			return fn();
		} catch (e: any) {
			if (typeof e?.code !== 'string' || !e.code.startsWith('SQLITE_CORRUPT')) throw e;
			this.logger.warn(`The Telegram search index is corrupt (${e.message}); rebuilding it and retrying`);
			this.rebuildIndex();
			return fn();
		}
	}

	/**
	 * Re-indexes the messages selected by `where` around a change of a name they are indexed with. FTS5
	 * only removes an entry when it is handed the exact values that were indexed, and the triggers read the
	 * names live from chats/topics, so a rename has to go through here: the entries are dropped while the
	 * view still yields the old name, `change` applies it, and the rows are indexed again with the new one.
	 */
	private reindexWhere(where: string, params: unknown[], change: () => void) {
		this.withIndexRepair(() =>
			this.db.transaction(() => {
				this.db
					.prepare(
						`INSERT INTO messages_fts(messages_fts, rowid, ${FTS_COLUMNS}) SELECT 'delete', id, ${FTS_COLUMNS} FROM messages_view WHERE ${where}`
					)
					.run(...params);
				change();
				this.db.prepare(`INSERT INTO messages_fts(rowid, ${FTS_COLUMNS}) SELECT id, ${FTS_COLUMNS} FROM messages_view WHERE ${where}`).run(...params);
			})()
		);
	}

	// ── Account ───────────────────────────────────────────────────────────────

	/** The stored account, or the defaults (nothing stored, search enabled) before the first sign-in. */
	public getAccount(): TelegramAccount {
		const row = this.db.prepare('SELECT api_id, api_hash, session, search_enabled, feed_enabled FROM account WHERE id = 1').get() as AccountRow | undefined;
		if (!row) return { ...DEFAULT_ACCOUNT };
		return {
			apiId: row.api_id,
			apiHash: row.api_hash,
			session: row.session,
			searchEnabled: row.search_enabled === 1,
			feedEnabled: row.feed_enabled === 1,
		};
	}

	/** Stores the given fields of the account, keeping the others as they are. */
	public updateAccount(patch: Partial<TelegramAccount>) {
		const next = { ...this.getAccount(), ...patch };
		this.db
			.prepare(
				`INSERT INTO account (id, api_id, api_hash, session, search_enabled, feed_enabled)
				 VALUES (1, ?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET api_id = excluded.api_id, api_hash = excluded.api_hash,
				 	session = excluded.session, search_enabled = excluded.search_enabled, feed_enabled = excluded.feed_enabled`
			)
			.run(next.apiId, next.apiHash, next.session, next.searchEnabled ? 1 : 0, next.feedEnabled ? 1 : 0);
	}

	// ── Chats ─────────────────────────────────────────────────────────────────

	/**
	 * Adds the chat, or picks up its new title (its messages are re-indexed under it, see reindexWhere) and
	 * username; a chat marked invalid becomes valid again, since the account has it. An `undefined` username
	 * leaves the stored one alone.
	 */
	public registerChat(id: string, title: string, type: string, username?: string | null) {
		const existing = this.db.prepare('SELECT title, username, invalid FROM chats WHERE id = ?').get(id) as
			Pick<Chat, 'title' | 'username' | 'invalid'> | undefined;
		if (!existing) {
			this.db.prepare('INSERT INTO chats (id, title, type, username) VALUES (?, ?, ?, ?)').run(id, title, type, username ?? null);
			return;
		}
		if (username !== undefined && username !== existing.username) this.db.prepare('UPDATE chats SET username = ? WHERE id = ?').run(username, id);
		if (existing.invalid) this.db.prepare('UPDATE chats SET invalid = 0 WHERE id = ?').run(id);
		if (existing.title === title) return;
		this.reindexWhere('chat_id = ?', [id], () => this.db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(title, id));
	}

	/** Marks as invalid every chat not among `presentIds` (the account dialogs), see Chat.invalid; returns how many changed. */
	public markChatsInvalidNotIn(presentIds: string[]): number {
		return this.db.prepare('UPDATE chats SET invalid = 1 WHERE invalid = 0 AND id NOT IN (SELECT value FROM json_each(?))').run(JSON.stringify(presentIds))
			.changes;
	}

	/** The chat the account is in under this public username (lowercase, no @), if any; invalid chats (see Chat.invalid) do not count. */
	public getValidChatIdByUsername(username: string): string | undefined {
		const row = this.db.prepare('SELECT id FROM chats WHERE username = ? AND invalid = 0').get(username.toLowerCase()) as Pick<Chat, 'id'> | undefined;
		return row?.id;
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

	/** Advances the cursor; `indexedAt` (epoch ms) is given when the pass stored new messages. */
	public updateLastMessageId(chatId: string, lastMessageId: number, indexedAt: number | null = null) {
		this.db
			.prepare(
				`INSERT INTO indexing_progress (chat_id, last_message_id, last_indexed_at)
				 VALUES (?, ?, ?)
				 ON CONFLICT(chat_id) DO UPDATE SET last_message_id = excluded.last_message_id,
				 	last_indexed_at = COALESCE(excluded.last_indexed_at, last_indexed_at)`
			)
			.run(chatId, lastMessageId, indexedAt);
	}

	/** Records the end of an indexing pass over the chat: when it finished and the error that ended it, if any. */
	public recordChatCheck(chatId: string, checkedAt: number, error: string | null) {
		this.db
			.prepare(
				`INSERT INTO indexing_progress (chat_id, last_message_id, last_checked_at, last_error)
				 VALUES (?, 0, ?, ?)
				 ON CONFLICT(chat_id) DO UPDATE SET last_checked_at = excluded.last_checked_at, last_error = excluded.last_error`
			)
			.run(chatId, checkedAt, error);
	}

	/**
	 * Adds the topic or picks up its new name. Messages of the topic indexed so far (under the old name, or
	 * with no name when the topic was unknown) are re-indexed, see reindexWhere.
	 */
	public registerTopic(chatId: string, topicId: number, topicName: string) {
		const existing = this.db.prepare('SELECT topic_name FROM topics WHERE chat_id = ? AND topic_id = ?').get(chatId, topicId) as
			{ topic_name: string | null } | undefined;
		if (existing && existing.topic_name === topicName) return;
		this.reindexWhere('chat_id = ? AND topic_id = ?', [chatId, topicId], () =>
			this.db
				.prepare(
					`INSERT INTO topics (chat_id, topic_id, topic_name)
					 VALUES (?, ?, ?)
					 ON CONFLICT(chat_id, topic_id) DO UPDATE SET topic_name = excluded.topic_name`
				)
				.run(chatId, topicId, topicName)
		);
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

		this.withIndexRepair(() => insertMany(messages));
	}

	public getMessage(chatId: string, messageId: number): MessageRow | undefined {
		return this.db.prepare('SELECT * FROM messages_view WHERE chat_id = ? AND message_id = ?').get(chatId, messageId) as MessageRow | undefined;
	}

	public getChatTitle(chatId: string): string | undefined {
		const row = this.db.prepare('SELECT title FROM chats WHERE id = ?').get(chatId) as Pick<Chat, 'title'> | undefined;
		return row?.title || undefined;
	}

	/**
	 * Search for media files using FTS5. Only chats enabled for indexing take part: a disabled
	 * one (by the user, or by the indexer once the chat vanished from the account) keeps its
	 * messages stored but out of the results.
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
		await sleep(0);

		const match = toFtsMatchExpr(query);
		if (match === null) return { rows: [], nextCursor: null };

		const rows = this.withIndexRepair(
			() =>
				this.db
					.prepare(
						`
				SELECT mv.*, mm.media_verified_at, bm25(messages_fts) AS score
				FROM messages_fts
				JOIN messages_view mv ON mv.id = messages_fts.rowid
				JOIN chats c ON c.id = mv.chat_id
				LEFT JOIN messages_metadata mm ON mm.chat_id = mv.chat_id AND mm.message_id = mv.message_id
				WHERE messages_fts MATCH ?
				AND mv.has_media = 1
				AND c.indexing_enabled = 1
				AND messages_fts.rowid > ?
				ORDER BY messages_fts.rowid
				LIMIT ?
			`
					)
					.all(match, cursorId, limit) as MessageRow[]
		);

		const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;
		return { rows, nextCursor };
	}

	/** Records that Telegram confirmed these media still exist at `verifiedAt` (epoch ms). Other metadata columns are left untouched. */
	public markMediaVerified(refs: MessageRef[], verifiedAt: number) {
		const upsert = this.db.prepare(
			`INSERT INTO messages_metadata (chat_id, message_id, media_verified_at)
			 VALUES (?, ?, ?)
			 ON CONFLICT(chat_id, message_id) DO UPDATE SET media_verified_at = ?`
		);
		const upsertMany = this.db.transaction((rows: MessageRef[]) => {
			for (const r of rows) upsert.run(r.chat_id, r.message_id, verifiedAt, verifiedAt);
		});
		upsertMany(refs);
	}

	/** Removes messages from the index along with their metadata; FTS rows go via the delete trigger. */
	public deleteMessages(refs: MessageRef[]) {
		const deleteContent = this.db.prepare('DELETE FROM messages_content WHERE chat_id = ? AND message_id = ?');
		const deleteMetadata = this.db.prepare('DELETE FROM messages_metadata WHERE chat_id = ? AND message_id = ?');
		const deleteMany = this.db.transaction((rows: MessageRef[]) => {
			for (const r of rows) {
				deleteContent.run(r.chat_id, r.message_id);
				deleteMetadata.run(r.chat_id, r.message_id);
			}
		});
		this.withIndexRepair(() => deleteMany(refs));
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

	/** Every chat with its index counters and progress, see ChatOverview. Message dates come out as epoch ms. */
	public getChatsOverview(): ChatOverview[] {
		return this.db
			.prepare(
				`SELECT c.id, c.title, c.type, c.indexing_enabled, c.username, c.invalid,
					COALESCE(m.message_count, 0) AS message_count,
					COALESCE(m.media_count, 0)   AS media_count,
					COALESCE(m.media_size, 0)    AS media_size,
					m.last_message_at,
					COALESCE(t.topic_count, 0)   AS topic_count,
					COALESCE(p.last_message_id, 0) AS last_message_id,
					p.last_checked_at, p.last_indexed_at, p.last_error
				 FROM chats c
				 LEFT JOIN (
					SELECT chat_id, COUNT(*) AS message_count, SUM(has_media) AS media_count,
						SUM(COALESCE(file_size, 0)) AS media_size, MAX(date) * 1000 AS last_message_at
					FROM messages_content GROUP BY chat_id
				 ) m ON m.chat_id = c.id
				 LEFT JOIN (SELECT chat_id, COUNT(*) AS topic_count FROM topics GROUP BY chat_id) t ON t.chat_id = c.id
				 LEFT JOIN indexing_progress p ON p.chat_id = c.id`
			)
			.all() as ChatOverview[];
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

	/**
	 * Drops everything indexed for the chat (messages, their metadata, topics and the progress cursor) and
	 * keeps the chat itself with its indexing flag, so an enabled chat gets indexed again from scratch.
	 * FTS rows go via the delete trigger.
	 */
	public clearChatIndex(chatId: string) {
		this.withIndexRepair(() => this.db.transaction(() => this.purgeChatIndexRows(chatId))());
	}

	/** Removes the chat and everything indexed for it; registerChat brings it back (disabled) if the account still has it. */
	public deleteChat(chatId: string) {
		this.withIndexRepair(() =>
			this.db.transaction(() => {
				this.purgeChatIndexRows(chatId);
				this.db.prepare('DELETE FROM chats WHERE id = ?').run(chatId);
			})()
		);
	}

	private purgeChatIndexRows(chatId: string) {
		this.db.prepare('DELETE FROM messages_content WHERE chat_id = ?').run(chatId);
		this.db.prepare('DELETE FROM messages_metadata WHERE chat_id = ?').run(chatId);
		this.db.prepare('DELETE FROM topics WHERE chat_id = ?').run(chatId);
		this.db.prepare('DELETE FROM indexing_progress WHERE chat_id = ?').run(chatId);
	}

	// Active Downloads management

	public addActiveDownload(row: ActiveDownloadRow) {
		this.db
			.prepare(
				`INSERT INTO active_downloads (hash, chat_id, message_id, file_name, out_path, downloaded_bytes, file_size, status, error_message)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(hash) DO UPDATE SET downloaded_bytes = ?, status = ?, error_message = ?`
			)
			.run(
				row.hash,
				row.chat_id,
				row.message_id,
				row.file_name,
				row.out_path,
				row.downloaded_bytes,
				row.file_size,
				row.status,
				row.error_message ?? null,
				row.downloaded_bytes,
				row.status,
				row.error_message ?? null
			);
	}

	public updateDownloadProgress(hash: string, downloadedBytes: number, status: string, errorMessage?: string | null) {
		this.db
			.prepare(
				`UPDATE active_downloads 
				 SET downloaded_bytes = ?, status = ?, error_message = ? 
				 WHERE hash = ?`
			)
			.run(downloadedBytes, status, errorMessage ?? null, hash);
	}

	public removeActiveDownload(hash: string) {
		this.db.prepare('DELETE FROM active_downloads WHERE hash = ?').run(hash);
	}

	public getActiveDownloads(): ActiveDownloadRow[] {
		return this.db.prepare('SELECT * FROM active_downloads').all() as ActiveDownloadRow[];
	}

	public getActiveDownload(hash: string) {
		return this.db.prepare<[string], ActiveDownloadRow>('SELECT * FROM active_downloads WHERE hash = ?').get(hash);
	}

	// ── Join queue ────────────────────────────────────────────────────────────

	/** Every queued link, oldest first. */
	public getJoinQueue(): JoinQueueRow[] {
		return this.db.prepare('SELECT * FROM join_queue ORDER BY id').all() as JoinQueueRow[];
	}

	public getJoinQueueRow(id: number): JoinQueueRow | undefined {
		return this.db.prepare('SELECT * FROM join_queue WHERE id = ?').get(id) as JoinQueueRow | undefined;
	}

	/** The oldest pending link whose wait (if any) is over at `now`, or undefined. */
	public getNextPendingJoin(now: number): JoinQueueRow | undefined {
		return this.db
			.prepare(`SELECT * FROM join_queue WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY id LIMIT 1`)
			.get(now) as JoinQueueRow | undefined;
	}

	/** The earliest moment a pending link becomes due, or null when nothing is pending. */
	public getEarliestPendingJoinAt(): number | null {
		const row = this.db.prepare(`SELECT MIN(COALESCE(next_attempt_at, 0)) AS at FROM join_queue WHERE status = 'pending'`).get() as { at: number | null };
		return row.at;
	}

	/**
	 * Queues a link for its target: a new row, or the existing one brought back to pending with the new
	 * settings unless it is already pending or joined (then it is left alone). Returns the row.
	 */
	public enqueueJoin(link: string, target: string, indexOnJoin: boolean, addedAt: number): JoinQueueRow {
		const existing = this.db.prepare('SELECT * FROM join_queue WHERE target = ?').get(target) as JoinQueueRow | undefined;
		if (existing && (existing.status === 'pending' || existing.status === 'joined')) return existing;
		if (existing) {
			this.db
				.prepare(
					`UPDATE join_queue SET link = ?, status = 'pending', index_on_join = ?, error = NULL, attempts = 0, added_at = ?, attempted_at = NULL, next_attempt_at = NULL
					 WHERE id = ?`
				)
				.run(link, indexOnJoin ? 1 : 0, addedAt, existing.id);
			return this.getJoinQueueRow(existing.id)!;
		}
		const result = this.db
			.prepare('INSERT INTO join_queue (link, target, index_on_join, added_at) VALUES (?, ?, ?, ?)')
			.run(link, target, indexOnJoin ? 1 : 0, addedAt);
		return this.getJoinQueueRow(Number(result.lastInsertRowid))!;
	}

	/** Puts a failed or request-sent link back in the queue, to be tried right away. */
	public resetJoin(id: number) {
		this.db
			.prepare(
				`UPDATE join_queue SET status = 'pending', error = NULL, attempts = 0, next_attempt_at = NULL WHERE id = ? AND status IN ('failed', 'request_sent')`
			)
			.run(id);
	}

	/** Counts an attempt that reached Telegram and records its outcome. */
	public recordJoinAttempt(
		id: number,
		attemptedAt: number,
		patch: Partial<Pick<JoinQueueRow, 'status' | 'chat_id' | 'chat_title' | 'error' | 'next_attempt_at'>>
	) {
		const row = this.getJoinQueueRow(id);
		if (!row) return;
		const next = { ...row, ...patch, attempted_at: attemptedAt, attempts: row.attempts + 1 };
		this.db
			.prepare(
				`UPDATE join_queue SET status = ?, chat_id = ?, chat_title = ?, error = ?, attempts = ?, attempted_at = ?, next_attempt_at = ? WHERE id = ?`
			)
			.run(next.status, next.chat_id, next.chat_title, next.error, next.attempts, next.attempted_at, next.next_attempt_at, id);
	}

	public deleteJoin(id: number) {
		this.db.prepare('DELETE FROM join_queue WHERE id = ?').run(id);
	}

	/** Drops every link the worker is done with (joined, failed or waiting for an admin); returns how many went. */
	public deleteFinishedJoins(): number {
		return this.db.prepare(`DELETE FROM join_queue WHERE status != 'pending'`).run().changes;
	}

	public close() {
		this.db.close();
	}
}
