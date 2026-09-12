import fs from 'fs';
import os from 'os';
import path from 'path';
import { MainDB } from '../services/db/MainDB';
import { LoggerFactory } from '../services/logging/Logger';
import * as F from './fixtures';
import { getMockWorld, type MockWorld } from './MockWorld';

const logger = LoggerFactory.create('MockDatabase');

/**
 * Builds the MOCK_MODE database from scratch: the previous one and the placeholder files are removed, then
 * downloads, extensions and blacklist entries are seeded from MockWorld, so every start (and every
 * screenshot) shows the same data. The JWT secret next to the database is kept so sessions survive restarts.
 */
export function createMockDatabase(dbPath: string): MainDB {
	const dataDir = path.dirname(dbPath);
	// Guard against any future change to how the path is chosen: this function deletes directories
	if (path.relative(os.tmpdir(), dataDir).startsWith('..')) {
		throw new Error(`Refusing to reset a mock data directory outside the temp folder: ${dataDir}`);
	}
	const world = getMockWorld();
	fs.mkdirSync(dataDir, { recursive: true });
	for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(dbPath + suffix, { force: true });
	fs.rmSync(world.incomingDir, { recursive: true, force: true });
	fs.rmSync(world.libraryDir, { recursive: true, force: true });

	const db = new MainDB(dbPath);
	seedDownloads(db, world);
	seedExtensions(db);
	seedBlacklist(db, world);
	createPlaceholderFiles(world);
	logger.info(`Mock database seeded at ${dbPath}`);
	return db;
}

function seedDownloads(db: MainDB, world: MockWorld): void {
	for (const d of world.seededAmuleDownloads) db.addDownload(d.hash, d.name, d.size, d.category, 'amule', d.completed);
	for (const d of world.seededTelegramDownloads) db.addDownload(d.hash, d.name, d.size, d.category, 'telegram', d.completed);
}

function seedExtensions(db: MainDB): void {
	db.addExtension({
		name: 'Telegram Integration',
		url: 'local',
		type: 'telegram_indexer',
		enabled: 1,
		// A stored session is what makes the mock indexer start as "connected"
		config: JSON.stringify({ apiId: 123456, apiHash: '0123456789abcdef0123456789abcdef', session: 'mock-session' }),
	});
	db.addExtension({
		name: 'Notify Home Assistant',
		url: 'https://home.example.net/api/webhook/mularr',
		type: 'webhook',
		enabled: 1,
		config: JSON.stringify({ events: ['download.added', 'download.completed'] }),
	});
	db.addExtension({ name: 'ClamAV scan', url: 'http://clamav.example.net:8080/validate', type: 'validator', enabled: 0 });
}

function seedBlacklist(db: MainDB, world: MockWorld): void {
	// Fakes of free content, the kind of thing a blacklist is for: wrong checksums, executables posing as media
	db.addToBlacklist(world.rng.hex(32), 'debian-12.5.0-amd64-netinst.iso', 'Wrong checksum, not the official image', F.mb(661));
	db.addToBlacklist(world.rng.hex(32), 'Big Buck Bunny 1080p (Blender Open Movie).exe', 'Executable posing as a video', F.mb(2.1));
	db.addToBlacklist(world.rng.hex(32), 'Free Music Archive - Ambient Selection Vol.2 [MP3].zip', 'Corrupt archive, does not extract', null);
}

/**
 * Empty files where the shared and completed downloads are supposed to be, so the real code paths that
 * look at the disk (dead-record cleanup, moving files between categories, delete on cancel) behave as in production.
 */
function createPlaceholderFiles(world: MockWorld): void {
	fs.mkdirSync(world.tempDir, { recursive: true });
	for (const category of world.categories) {
		if (category.path) fs.mkdirSync(category.path, { recursive: true });
	}
	for (const file of world.shared) {
		fs.mkdirSync(file.filePath, { recursive: true });
		fs.writeFileSync(path.join(file.filePath, file.fileName), '');
	}
	for (const download of world.seededTelegramDownloads) {
		if (download.completed) fs.writeFileSync(path.join(world.categoryDir(download.category), download.name), '');
	}
}
