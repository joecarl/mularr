import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import type { IndexerFeedItem, IndexerFeedMediaType } from '../../types/IndexerFeedTypes';
import { LoggerFactory } from '../logging/Logger';

export interface DownloadDbRecord {
	hash: string;
	name: string;
	size: number;
	category_name: string | null;
	added_at: string;
	is_completed: number;
	/** ISO timestamp of when the download was first seen complete; null for records completed before the column existed. */
	completed_at?: string | null;
	/**
	 * Seed limits Sonarr/Radarr set on this download (qBittorrent torrents/setShareLimits, from the Seed Ratio and Seed
	 * Time fields of their indexer). Null: no limit of that kind. See qbittorrentMappings.seedStats for how they are read.
	 */
	seed_ratio_limit?: number | null;
	/** Minutes of sharing after completion. */
	seed_time_limit?: number | null;
	provider?: string;
	/**
	 * JSON snapshot of the MediaSearchResult the download was added from, when it came from a search (see
	 * MediaSearchService.recordSearchResult). Read for the origin of the release (sourceName, webUrl); the rest is as of that moment.
	 */
	search_result?: string | null;
}

export interface Extension {
	id: number;
	name: string;
	url: string;
	type: string;
	enabled: number;
	config?: string;
}

export interface ValidationResult {
	file_hash: string;
	extension_id: number;
	status: string;
	details: string;
	last_check: string;
}

export interface BlacklistEntry {
	hash: string;
	name: string;
	/** File size in bytes — ed2k identifies a file by (hash, size). Null when unknown. */
	size: number | null;
	reason: string | null;
	added_at: string;
}

/** A row of the indexer_feed table; same shape as the wire type. */
export type IndexerFeedRecord = IndexerFeedItem;
export type { IndexerFeedMediaType };

/** Filters of the indexer feed listing. Without any, every item matches. */
export interface IndexerFeedQuery {
	mediaType?: IndexerFeedMediaType;
	/** Case-insensitive substring of the release name. */
	search?: string;
	/** Only releases found for this wanted title (see IndexerFeedRecord.job_key). */
	jobKey?: string;
}

/**
 * ed2k identifies a file by (hash, size): a hash match is discarded only when
 * both sizes are known and differ. Pass a falsy size when it is unknown.
 */
export function blacklistEntryMatches(entry: BlacklistEntry, size?: number | null): boolean {
	return !(entry.size && size && entry.size !== size);
}

export class MainDB {
	private readonly logger = LoggerFactory.create(this);
	private db: Database.Database;
	public readonly dbPath: string;

	constructor(dbPath: string) {
		this.dbPath = dbPath;
		this.moveLegacyDatabase(path.join(path.dirname(dbPath), 'database.sqlite'));
		this.db = new Database(this.dbPath);
		this.init();
	}

	/**
	 * Until 2026-10 the database was called database.sqlite. Renames it (with the WAL and shared-memory files
	 * SQLite may have left beside it) to the current path, so upgraded installs keep their data. Nothing happens
	 * when the current path is that very file (deprecated DATABASE_PATH pointing at it) or already exists.
	 */
	private moveLegacyDatabase(from: string) {
		if (from === this.dbPath || !fs.existsSync(from) || fs.existsSync(this.dbPath)) return;
		for (const suffix of ['', '-wal', '-shm']) {
			if (fs.existsSync(from + suffix)) fs.renameSync(from + suffix, this.dbPath + suffix);
		}
		this.logger.info(`Renamed the database from ${from} to ${this.dbPath}`);
	}

	private init() {
		// Initialize tables
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS downloads (
				hash TEXT PRIMARY KEY,
				name TEXT,
				size INTEGER,
				category_name TEXT,
				added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				is_completed INTEGER DEFAULT 0,
				completed_at DATETIME,
				seed_ratio_limit REAL,
				seed_time_limit INTEGER,
				provider TEXT DEFAULT 'amule',
				search_result TEXT
			);

			CREATE TABLE IF NOT EXISTS extensions (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL,
				url TEXT NOT NULL,
				type TEXT DEFAULT 'generic',
				enabled INTEGER DEFAULT 1,
				config TEXT
			);

			CREATE TABLE IF NOT EXISTS file_validations (
				file_hash TEXT,
				extension_id INTEGER,
				status TEXT DEFAULT 'pending',
				details TEXT,
				last_check DATETIME DEFAULT CURRENT_TIMESTAMP,
				PRIMARY KEY (file_hash, extension_id)
			);

			CREATE TABLE IF NOT EXISTS blacklist (
				hash TEXT PRIMARY KEY,
				name TEXT NOT NULL DEFAULT '',
				size INTEGER,
				reason TEXT,
				added_at DATETIME DEFAULT CURRENT_TIMESTAMP
			);

			CREATE TABLE IF NOT EXISTS indexer_feed (
				hash TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				size INTEGER NOT NULL,
				link TEXT,
				provider TEXT NOT NULL DEFAULT 'amule',
				source_count INTEGER NOT NULL DEFAULT 0,
				media_type TEXT NOT NULL,
				query TEXT,
				imdb_id TEXT,
				job_key TEXT,
				search_result TEXT,
				discovered_at DATETIME NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_indexer_feed_discovered ON indexer_feed (media_type, discovered_at DESC);
		`);

		this.migrate();
	}

	private migrate() {
		try {
			const tableInfo = this.db.prepare('PRAGMA table_info(extensions)').all() as any[];
			const hasConfig = tableInfo.some((col) => col.name === 'config');
			if (!hasConfig) {
				this.db.prepare('ALTER TABLE extensions ADD COLUMN config TEXT').run();
			}

			const dlTableInfo = this.db.prepare('PRAGMA table_info(downloads)').all() as any[];
			const hasProvider = dlTableInfo.some((col) => col.name === 'provider');
			if (!hasProvider) {
				this.db.prepare("ALTER TABLE downloads ADD COLUMN provider TEXT DEFAULT 'amule'").run();
			}
			if (!dlTableInfo.some((col) => col.name === 'search_result')) {
				this.db.prepare('ALTER TABLE downloads ADD COLUMN search_result TEXT').run();
			}
			if (!dlTableInfo.some((col) => col.name === 'completed_at')) {
				this.db.prepare('ALTER TABLE downloads ADD COLUMN completed_at DATETIME').run();
			}
			if (!dlTableInfo.some((col) => col.name === 'seed_ratio_limit')) {
				this.db.prepare('ALTER TABLE downloads ADD COLUMN seed_ratio_limit REAL').run();
				this.db.prepare('ALTER TABLE downloads ADD COLUMN seed_time_limit INTEGER').run();
			}

			const blTableInfo = this.db.prepare('PRAGMA table_info(blacklist)').all() as any[];
			const hasSize = blTableInfo.some((col) => col.name === 'size');
			if (!hasSize) {
				this.db.prepare('ALTER TABLE blacklist ADD COLUMN size INTEGER').run();
				// One-time normalization: hashes are matched case-insensitively from now on
				this.db.prepare('UPDATE blacklist SET hash = LOWER(hash)').run();
			}

			// indexer_feed grew these columns while the feature was being developed
			const feedTableInfo = this.db.prepare('PRAGMA table_info(indexer_feed)').all() as any[];
			for (const column of ['imdb_id', 'job_key', 'search_result']) {
				if (!feedTableInfo.some((col) => col.name === column)) {
					this.db.prepare(`ALTER TABLE indexer_feed ADD COLUMN ${column} TEXT`).run();
				}
			}
		} catch (e) {
			this.logger.error('Migration error:', e);
		}
	}

	// ---------------------------------------------------------
	// Downloads
	// ---------------------------------------------------------

	public getAllDownloads(): DownloadDbRecord[] {
		return this.db.prepare<[], DownloadDbRecord>('SELECT * FROM downloads').all();
	}

	public getDownload(hash: string): DownloadDbRecord | undefined {
		return this.db.prepare<string, DownloadDbRecord>('SELECT * FROM downloads WHERE hash = ?').get(hash);
	}

	public addDownload(hash: string, name: string, size: number, categoryName: string | null = null, provider: string = 'amule', isCompleted: boolean = false) {
		const existing = this.getDownload(hash);
		if (!existing) {
			this.db
				.prepare('INSERT INTO downloads (hash, name, size, category_name, added_at, is_completed, provider) VALUES (?, ?, ?, ?, ?, ?, ?)')
				.run(hash, name, size, categoryName, new Date().toISOString(), isCompleted ? 1 : 0, provider);
		}
	}

	/** Stores the seed limits of a download (see DownloadDbRecord.seed_ratio_limit); null clears a limit. */
	public setDownloadSeedLimits(hash: string, ratioLimit: number | null, timeLimitMinutes: number | null) {
		this.db.prepare('UPDATE downloads SET seed_ratio_limit = ?, seed_time_limit = ? WHERE hash = ?').run(ratioLimit, timeLimitMinutes, hash);
	}

	/** Attaches the search-result snapshot (see DownloadDbRecord.search_result) to a download. */
	public setDownloadSearchResult(hash: string, searchResultJson: string) {
		this.db.prepare('UPDATE downloads SET search_result = ? WHERE hash = ?').run(searchResultJson, hash);
	}

	/** Marks the completion state. completed_at is set the first time a download is marked complete and cleared when it is unmarked. */
	public updateDownloadCompletion(hash: string, isCompleted: boolean, name?: string, size?: number) {
		const completedAt = isCompleted ? new Date().toISOString() : null;
		if (name !== undefined && size !== undefined) {
			this.db
				.prepare('UPDATE downloads SET is_completed = ?, completed_at = COALESCE(completed_at, ?), name = ?, size = ? WHERE hash = ?')
				.run(isCompleted ? 1 : 0, completedAt, name, size, hash);
		} else {
			this.db
				.prepare('UPDATE downloads SET is_completed = ?, completed_at = COALESCE(completed_at, ?) WHERE hash = ?')
				.run(isCompleted ? 1 : 0, completedAt, hash);
		}
		if (!isCompleted) this.db.prepare('UPDATE downloads SET completed_at = NULL WHERE hash = ?').run(hash);
	}

	public deleteDownload(hash: string) {
		this.db.prepare('DELETE FROM downloads WHERE hash = ?').run(hash);
	}

	public clearCompletedDownloads(hashes?: string[]) {
		if (hashes && hashes.length > 0) {
			const placeholders = hashes.map(() => '?').join(',');
			this.db.prepare(`DELETE FROM downloads WHERE is_completed = 1 AND hash IN (${placeholders})`).run(...hashes);
		} else {
			this.db.prepare('DELETE FROM downloads WHERE is_completed = 1').run();
		}
	}

	public updateCategoryName(oldName: string, newName: string) {
		this.db.prepare('UPDATE downloads SET category_name = ? WHERE category_name = ?').run(newName, oldName);
	}

	public setDownloadCategory(hash: string, categoryName: string | null) {
		this.db.prepare('UPDATE downloads SET category_name = ? WHERE hash = ?').run(categoryName, hash);
	}

	// ---------------------------------------------------------
	// Extensions
	// ---------------------------------------------------------

	public getAllExtensions(): Extension[] {
		return this.db.prepare<[], Extension>('SELECT * FROM extensions').all();
	}

	public getExtensionByType(type: string): Extension | undefined {
		return this.db.prepare<string, Extension>('SELECT * FROM extensions WHERE type = ? LIMIT 1').get(type);
	}

	public getExtensionById(id: number): Extension | undefined {
		return this.db.prepare<number, Extension>('SELECT * FROM extensions WHERE id = ?').get(id);
	}

	public addExtension(extension: Omit<Extension, 'id'>): number | bigint {
		const result = this.db
			.prepare('INSERT INTO extensions (name, url, type, enabled, config) VALUES (?, ?, ?, ?, ?)')
			.run(extension.name, extension.url, extension.type, extension.enabled, extension.config || null);
		return result.lastInsertRowid;
	}

	public deleteExtension(id: number) {
		this.db.prepare('DELETE FROM extensions WHERE id = ?').run(id);
		this.deleteValidationsForExtension(id);
	}

	public updateExtensionConfig(id: number, config: string) {
		this.db.prepare('UPDATE extensions SET config = ? WHERE id = ?').run(config, id);
	}

	public updateExtensionUrl(id: number, url: string) {
		this.db.prepare('UPDATE extensions SET url = ? WHERE id = ?').run(url, id);
	}

	public toggleExtension(id: number, enabled: boolean) {
		this.db.prepare('UPDATE extensions SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
	}

	// ---------------------------------------------------------
	// File Validations
	// ---------------------------------------------------------

	public getValidationsForFile(fileHash: string): ValidationResult[] {
		return this.db.prepare<string, ValidationResult>('SELECT * FROM file_validations WHERE file_hash = ?').all(fileHash);
	}

	public getValidation(fileHash: string, extensionId: number): ValidationResult | undefined {
		return this.db
			.prepare<[string, number], ValidationResult>('SELECT * FROM file_validations WHERE file_hash = ? AND extension_id = ?')
			.get(fileHash, extensionId);
	}

	public upsertValidation(fileHash: string, extensionId: number, status: string, details: string) {
		this.db
			.prepare(
				`
				INSERT INTO file_validations (file_hash, extension_id, status, details, last_check)
				VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
				ON CONFLICT(file_hash, extension_id) DO UPDATE SET
				status = excluded.status,
				details = excluded.details,
				last_check = CURRENT_TIMESTAMP
			`
			)
			.run(fileHash, extensionId, status, details);
	}

	public deleteValidationsForExtension(extensionId: number) {
		this.db.prepare('DELETE FROM file_validations WHERE extension_id = ?').run(extensionId);
	}

	// ---------------------------------------------------------
	// Blacklist
	// ---------------------------------------------------------

	public getBlacklist(): BlacklistEntry[] {
		return this.db.prepare<[], BlacklistEntry>('SELECT * FROM blacklist ORDER BY added_at DESC').all();
	}

	public getBlacklistEntry(hash: string): BlacklistEntry | undefined {
		return this.db.prepare<string, BlacklistEntry>('SELECT * FROM blacklist WHERE hash = ?').get(hash.toLowerCase());
	}

	public addToBlacklist(hash: string, name: string, reason: string | null = null, size: number | null = null) {
		this.db
			.prepare('INSERT OR REPLACE INTO blacklist (hash, name, size, reason, added_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)')
			.run(hash.toLowerCase(), name, size, reason);
	}

	public removeFromBlacklist(hash: string) {
		this.db.prepare('DELETE FROM blacklist WHERE hash = ?').run(hash.toLowerCase());
	}

	public isBlacklisted(hash: string, size?: number | null): boolean {
		const entry = this.getBlacklistEntry(hash);
		return !!entry && blacklistEntryMatches(entry, size);
	}

	// ---------------------------------------------------------
	// Indexer feed (releases found by the *arr wanted sync and the provider feeds)
	// ---------------------------------------------------------

	/** Inserts new items and refreshes name/size/link/sources of known ones, keeping their discovered_at. */
	public upsertIndexerFeedItems(items: Omit<IndexerFeedRecord, 'discovered_at'>[]): void {
		if (items.length === 0) return;
		const stmt = this.db.prepare(`
			INSERT INTO indexer_feed (hash, name, size, link, provider, source_count, media_type, query, imdb_id, job_key, search_result, discovered_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(hash) DO UPDATE SET
				name = excluded.name,
				size = excluded.size,
				link = excluded.link,
				source_count = excluded.source_count,
				query = excluded.query,
				imdb_id = COALESCE(excluded.imdb_id, indexer_feed.imdb_id),
				job_key = COALESCE(excluded.job_key, indexer_feed.job_key),
				search_result = COALESCE(excluded.search_result, indexer_feed.search_result)
		`);
		const now = new Date().toISOString();
		const insertAll = this.db.transaction((rows: Omit<IndexerFeedRecord, 'discovered_at'>[]) => {
			for (const r of rows) {
				stmt.run(
					r.hash.toLowerCase(),
					r.name,
					r.size,
					r.link,
					r.provider,
					r.source_count,
					r.media_type,
					r.query,
					r.imdb_id,
					r.job_key,
					r.search_result,
					now
				);
			}
		});
		insertAll(items);
	}

	/**
	 * Inserts the items whose hash is not in the feed yet and leaves the known ones as they are: a release the
	 * wanted sync found keeps its title and snapshot. Returns how many were added.
	 */
	public insertIndexerFeedItemsIfNew(items: Omit<IndexerFeedRecord, 'discovered_at'>[]): number {
		if (items.length === 0) return 0;
		const stmt = this.db.prepare(`
			INSERT OR IGNORE INTO indexer_feed (hash, name, size, link, provider, source_count, media_type, query, imdb_id, job_key, search_result, discovered_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		const now = new Date().toISOString();
		const insertAll = this.db.transaction((rows: Omit<IndexerFeedRecord, 'discovered_at'>[]) => {
			let added = 0;
			for (const r of rows) {
				added += stmt.run(
					r.hash.toLowerCase(),
					r.name,
					r.size,
					r.link,
					r.provider,
					r.source_count,
					r.media_type,
					r.query,
					r.imdb_id,
					r.job_key,
					r.search_result,
					now
				).changes;
			}
			return added;
		});
		return insertAll(items);
	}

	/** WHERE clause and its parameters for the given filters (empty clause when there are none). */
	private indexerFeedWhere(query: IndexerFeedQuery): { where: string; params: (string | number)[] } {
		const conditions: string[] = [];
		const params: (string | number)[] = [];
		if (query.mediaType) {
			conditions.push('media_type = ?');
			params.push(query.mediaType);
		}
		if (query.jobKey) {
			conditions.push('job_key = ?');
			params.push(query.jobKey);
		}
		const search = query.search?.trim();
		if (search) {
			conditions.push("name LIKE ? ESCAPE '\\'");
			params.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
		}
		return { where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '', params };
	}

	/** Newest first. */
	public getIndexerFeed(query: IndexerFeedQuery, offset: number, limit: number): IndexerFeedRecord[] {
		const { where, params } = this.indexerFeedWhere(query);
		return this.db
			.prepare<(string | number)[], IndexerFeedRecord>(`SELECT * FROM indexer_feed ${where} ORDER BY discovered_at DESC, hash LIMIT ? OFFSET ?`)
			.all(...params, limit, offset);
	}

	public countIndexerFeed(query: IndexerFeedQuery = {}): number {
		const { where, params } = this.indexerFeedWhere(query);
		const row = this.db.prepare<(string | number)[], { n: number }>(`SELECT COUNT(*) AS n FROM indexer_feed ${where}`).get(...params);
		return row?.n ?? 0;
	}

	/** Number of feed items per wanted title (job_key); rows without one are not counted. */
	public countIndexerFeedByJobKey(): Map<string, number> {
		const rows = this.db
			.prepare<[], { job_key: string; n: number }>('SELECT job_key, COUNT(*) AS n FROM indexer_feed WHERE job_key IS NOT NULL GROUP BY job_key')
			.all();
		return new Map(rows.map((r) => [r.job_key, r.n]));
	}

	public getIndexerFeedItem(hash: string): IndexerFeedRecord | undefined {
		return this.db.prepare<string, IndexerFeedRecord>('SELECT * FROM indexer_feed WHERE hash = ?').get(hash.toLowerCase());
	}

	public deleteIndexerFeedItem(hash: string): boolean {
		return this.db.prepare('DELETE FROM indexer_feed WHERE hash = ?').run(hash.toLowerCase()).changes > 0;
	}

	/** Empties the feed. Returns how many items were removed. */
	public clearIndexerFeed(): number {
		return this.db.prepare('DELETE FROM indexer_feed').run().changes;
	}

	/** Removes items first discovered before the given instant. Returns how many were removed. */
	public pruneIndexerFeed(olderThan: Date): number {
		return this.db.prepare('DELETE FROM indexer_feed WHERE discovered_at < ?').run(olderThan.toISOString()).changes;
	}

	/** Keeps only the `keep` most recently discovered items carrying the job key (a provider feed's). Returns how many were removed. */
	public pruneIndexerFeedJobKey(jobKey: string, keep: number): number {
		return this.db
			.prepare(
				`DELETE FROM indexer_feed WHERE job_key = ?
				 AND hash NOT IN (SELECT hash FROM indexer_feed WHERE job_key = ? ORDER BY discovered_at DESC, hash LIMIT ?)`
			)
			.run(jobKey, jobKey, keep).changes;
	}
}
