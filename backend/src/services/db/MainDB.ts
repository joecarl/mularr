import Database from 'better-sqlite3';

export interface DownloadDbRecord {
	hash: string;
	name: string;
	size: number;
	category_name: string | null;
	added_at: string;
	is_completed: number;
	provider?: string;
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

export class MainDB {
	private db: Database.Database;
	public readonly dbPath: string;

	constructor(dbPath: string) {
		this.dbPath = dbPath;
		this.db = new Database(this.dbPath);
		this.init();
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
				provider TEXT DEFAULT 'amule'
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
		} catch (e) {
			console.error('Migration error:', e);
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

	public updateDownloadCompletion(hash: string, isCompleted: boolean, name?: string, size?: number) {
		if (name !== undefined && size !== undefined) {
			this.db.prepare('UPDATE downloads SET is_completed = ?, name = ?, size = ? WHERE hash = ?').run(isCompleted ? 1 : 0, name, size, hash);
		} else {
			this.db.prepare('UPDATE downloads SET is_completed = ? WHERE hash = ?').run(isCompleted ? 1 : 0, hash);
		}
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
}
