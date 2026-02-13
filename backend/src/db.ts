import Database from 'better-sqlite3';
import path from 'path';

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../database.sqlite');
const db = new Database(dbPath);

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
    enabled INTEGER DEFAULT 1
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
