import Database from 'better-sqlite3';
import path from 'path';

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../database.sqlite');
const db = new Database(dbPath);

// Initialize tables
// db.exec(`
//   CREATE TABLE IF NOT EXISTS whatever (
//     id INTEGER PRIMARY KEY AUTOINCREMENT,
//     fullname TEXT NOT NULL,
//     created_at DATETIME DEFAULT CURRENT_TIMESTAMP
//   );
// `);

export default db;
