import Database from 'better-sqlite3';
import path from 'path';

export const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../dev-data/database.sqlite');
const db = new Database(dbPath);

// Migration: Add config column if not exists
try {
	const tableInfo = db.prepare('PRAGMA table_info(extensions)').all() as any[];
	const hasConfig = tableInfo.some((col) => col.name === 'config');
	if (!hasConfig) {
		db.prepare('ALTER TABLE extensions ADD COLUMN config TEXT').run();
	}
} catch (e) {
	console.error('Migration error adding config column:', e);
}

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS downloads (
    hash TEXT PRIMARY KEY,
    name TEXT,
    size INTEGER,
    category_name TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_completed INTEGER DEFAULT 0
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

export default db;
