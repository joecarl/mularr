/**
 * The simulated aMule daemon, Telegram client and network every mock service reads from and writes to.
 * Everything is generated from one seeded PRNG, so the dataset is identical on every start; progress,
 * speeds and log lines then move with the wall clock so the UI looks alive while a screenshot is taken.
 */
import path from 'path';
import { FileStatus, PARTSIZE } from 'amule-ec-client';
import type { AmuleFile, AmuleServer, AmuleTransferringFile, AmuleUpDownClient, StatsResponse } from 'amule-ec-client';
import { __APP_CONFIG__ } from '../app-env';
import { CHUNK_STATUS, type ChunkInfo, type MediaCategory, type TransferSource, type TransferSourceNameCount } from '../types/MediaTypes';
import type { SpeedSample } from '../types/StatsTypes';
import type { DownloadStatus } from '../services/TelegramDownloadManager';
import type { Chat, MessageRow } from '../services/db/TelegramIndexerDB';
import { buildEd2kLink } from '../services/eD2kTools';
import { MockRandom } from './MockRandom';
import * as F from './fixtures';

const MiB = 1024 * 1024;
/** A search "finishes" this long after it starts; results show up progressively meanwhile. */
const SEARCH_DURATION_MS = 6000;
/** Reads closer together than this see the same snapshot, so one broadcast cycle is consistent. */
const MIN_STEP_MS = 250;
/** Cap on a single step, so a suspended process doesn't complete every download at once when it resumes. */
const MAX_STEP_MS = 60_000;
const MAX_LOG_LINES = 500;

export interface MockServer extends AmuleServer {
	ecid: number;
	name: string;
	ip: string;
	port: number;
}

export interface MockSharedFile extends AmuleFile {
	fileHashHexString: string;
	fileName: string;
	filePath: string;
	sizeFull: number;
	fileEd2kLink: string;
}

/** A download in the mock daemon's queue. Progress advances in real time while it is downloading. */
export interface MockQueueEntry {
	ecid: number;
	hash: string;
	name: string;
	size: number;
	done: number;
	/** Bytes/s right now; wanders around `cruiseSpeed` while downloading, 0 otherwise. */
	speed: number;
	cruiseSpeed: number;
	status: FileStatus;
	stopped: boolean;
	priority: number;
	sourceCount: number;
	sources: TransferSource[];
	sourceNames: TransferSourceNameCount[];
	/** Number of sources holding each part. */
	availability: number[];
	/** Order in which parts complete, so the progress bar fills scattered like a real download. */
	partOrder: number[];
}

export interface MockSearchResult {
	name: string;
	size: number;
	hash: string;
	link: string;
	sourceCount: number;
	completeSourceCount: number;
	type: string;
}

export interface SharedDirectoryEntry {
	path: string;
	recursive: boolean;
}

/** Downloads present at start, for the database seed (see createMockDatabase). */
export interface SeededDownload {
	hash: string;
	name: string;
	size: number;
	category: string | null;
	completed: boolean;
}

interface MockSearch {
	query: string;
	startedAt: number;
	results: MockSearchResult[];
}

type SearchKind = keyof typeof F.SEARCH_TEMPLATES;

function formatLogTime(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function titleCase(text: string): string {
	return text
		.trim()
		.split(/\s+/)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

/** What a query is probably looking for, or null when it could be anything. */
function inferSearchKind(query: string): SearchKind | null {
	const q = query.toLowerCase();
	if (/\b(iso|linux|debian|ubuntu|fedora|windows|setup|portable|installer|apk|exe|firmware)\b/.test(q)) return 'software';
	if (/\b(mp3|flac|album|live|ost|soundtrack|discography|remix|symphony)\b/.test(q)) return 'audio';
	if (/\b(pdf|epub|book|ebook|guide|manual|magazine|tutorial|handbook|gutenberg|report)\b/.test(q)) return 'document';
	if (/\b(film|movie|documentary|lecture|talk|timelapse|footage|1080p|720p|4k)\b/.test(q)) return 'video';
	return null;
}

export class MockWorld {
	readonly rng = new MockRandom(F.MOCK_SEED);
	/** Everything the mock pretends to write lives under the throwaway data directory (see app-env.ts). */
	readonly dataDir = path.dirname(__APP_CONFIG__.databasePath);
	readonly incomingDir = path.join(this.dataDir, 'incoming');
	readonly tempDir = path.join(this.incomingDir, '.incomplete');
	readonly libraryDir = path.join(this.dataDir, 'library');

	readonly categories: MediaCategory[];
	readonly servers: MockServer[];
	connectedServer: MockServer | null;
	readonly shared: MockSharedFile[] = [];
	/** Same keys as AmuledService.getConfig() reports (numbers as strings, flags as booleans). */
	readonly amuleConfig: Record<string, unknown>;
	sharedDirs: SharedDirectoryEntry[];
	readonly telegramChats: Chat[];
	readonly seededAmuleDownloads: SeededDownload[] = [];
	readonly seededTelegramDownloads: SeededDownload[] = [];

	private readonly queue: MockQueueEntry[] = [];
	private readonly uploadQueue: AmuleUpDownClient[];
	/** Indexed Telegram messages keyed by `${chatId}:${messageId}`. */
	private readonly telegramMessages = new Map<string, MessageRow>();
	private readonly telegramDownloads = new Map<string, DownloadStatus>();
	private readonly telegramCruise = new Map<string, number>();
	private readonly logLines: string[] = [];
	private readonly logListeners = new Set<(lines: string[]) => void>();
	private search: MockSearch | null = null;
	private nextEcid = 1;
	private nextMessageRowId = 1;
	private nextSyntheticMessageId = 20_000;
	private readonly clientId = 3_232_235_777; // > 16777216, so a HighID
	private readonly kadId: string;
	private totalSent = 118 * 1024 * MiB;
	private totalReceived = 342 * 1024 * MiB;
	private lastAdvance = Date.now();

	constructor() {
		this.kadId = this.rng.hex(32).toUpperCase();
		this.categories = [
			{ id: 0, name: 'Default', path: '', comment: 'aMule default category', color: 0, priority: 0 },
			...F.CATEGORIES.map((c, i) => ({
				id: i + 1,
				name: c.name,
				path: c.dir ? path.join(this.incomingDir, c.dir) : '',
				comment: c.comment,
				color: c.color,
				priority: c.priority,
			})),
		];
		this.servers = F.SERVERS.map((s) => this.toServer(s));
		this.connectedServer = this.servers[0];

		F.QUEUE_FILES.forEach((file, index) => {
			const entry = this.makeQueueEntry(file.name, file.size, index);
			this.queue.push(entry);
			this.seededAmuleDownloads.push({ hash: entry.hash, name: file.name, size: file.size, category: file.category, completed: false });
		});
		for (const file of F.COMPLETED_FILES) {
			const shared = this.makeSharedFile(file.name, file.size, this.categoryDir(file.category));
			this.shared.push(shared);
			this.seededAmuleDownloads.push({ hash: shared.fileHashHexString, name: file.name, size: file.size, category: file.category, completed: true });
		}
		for (const file of F.LIBRARY_FILES) this.shared.push(this.makeSharedFile(file.name, file.size, this.libraryDir));

		this.uploadQueue = Array.from({ length: 9 }, (_, i) => this.makeUploadClient(i, i < 3));
		this.amuleConfig = {
			...F.AMULE_CONFIG,
			// Already on the Gluetun-forwarded port, as after the first run in production, so the monitor doesn't restart the daemon at boot
			tcpPort: String(F.VPN_FORWARDED_PORT),
			udpPort: String(F.VPN_FORWARDED_PORT),
			incomingDir: this.incomingDir,
			tempDir: this.tempDir,
		};
		this.sharedDirs = [
			{ path: this.libraryDir, recursive: true },
			{ path: path.join(this.dataDir, 'manual-share'), recursive: false },
		];

		this.telegramChats = F.TELEGRAM_CHATS.map((c) => ({ ...c }));
		for (const file of F.TELEGRAM_FILES) this.registerTelegramMessage(file);
		for (const { fileIndex, state } of F.TELEGRAM_DOWNLOADS) {
			const file = F.TELEGRAM_FILES[fileIndex];
			const hash = `telegram:${this.telegramChats[file.chatIndex].id}:${file.messageId}`;
			this.seededTelegramDownloads.push({ hash, name: file.name, size: file.size, category: null, completed: state === 'completed' });
			if (state === 'completed') continue; // finished downloads only live in the database, as with the real manager
			this.telegramDownloads.set(hash, {
				hash,
				fileName: file.name,
				size: file.size,
				downloaded: state === 'downloading' ? Math.round(file.size * this.rng.float(0.1, 0.7)) : 0,
				speed: 0,
				status: state,
				startTime: Date.now() - this.rng.int(60, 3600) * 1000,
			});
			this.telegramCruise.set(hash, this.rng.int(400, 2500) * 1024);
		}

		this.seedLog();
	}

	// ── Time ──────────────────────────────────────────────────────────────────

	/** Moves every simulated quantity forward by the wall-clock time elapsed since the last call. */
	advance(): void {
		const now = Date.now();
		const elapsed = now - this.lastAdvance;
		if (elapsed < MIN_STEP_MS) return;
		this.lastAdvance = now;
		const dt = Math.min(elapsed, MAX_STEP_MS) / 1000;

		for (const entry of this.queue) this.advanceEntry(entry, dt);
		for (const status of this.telegramDownloads.values()) this.advanceTelegram(status, dt);
		for (const client of this.uploadQueue) {
			if (client.upSpeed) client.upSpeed = Math.round(Math.min(220 * 1024, Math.max(12 * 1024, client.upSpeed * this.rng.float(0.9, 1.1))));
		}
		this.totalSent += this.uploadSpeed() * dt;
		// About one new amuled log line every six seconds
		if (this.rng.chance(dt / 6)) this.appendLog(this.fillLogTemplate(this.rng.pick(F.LOG_TEMPLATES)));
	}

	private advanceEntry(entry: MockQueueEntry, dt: number): void {
		if (!this.isDownloading(entry)) {
			entry.speed = 0;
			for (const source of entry.sources) source.downloadSpeed = 0;
			return;
		}
		entry.speed = this.drift(entry.speed, entry.cruiseSpeed);
		entry.done = Math.min(entry.size, entry.done + entry.speed * dt);
		this.totalReceived += entry.speed * dt;
		// The first few sources are the ones transferring; they share the file's speed
		const transferring = Math.min(entry.sources.length, 4);
		entry.sources.forEach((source, i) => {
			source.downloadSpeed = i < transferring ? Math.round(entry.speed / transferring) : 0;
		});
		if (entry.done >= entry.size) {
			entry.done = entry.size;
			entry.speed = 0;
			// The daemon reports completed downloads as stopped
			entry.status = FileStatus.COMPLETE;
			entry.stopped = true;
			for (const source of entry.sources) source.downloadSpeed = 0;
			this.appendLog(`Completed download of ${entry.name}`);
		}
	}

	private advanceTelegram(status: DownloadStatus, dt: number): void {
		if (status.status !== 'downloading') {
			status.speed = 0;
			return;
		}
		status.speed = this.drift(status.speed, this.telegramCruise.get(status.hash) ?? 1000 * 1024);
		status.downloaded = Math.min(status.size, status.downloaded + status.speed * dt);
		status.lastUpdate = Date.now();
		if (status.downloaded >= status.size) {
			status.status = 'completed';
			status.speed = 0;
			this.promoteQueuedTelegramDownload();
		}
	}

	/** One step of a bounded random walk pulling `value` towards `target`. */
	private drift(value: number, target: number): number {
		if (target <= 0) return 0;
		const next = value + (target - value) * 0.25 + this.rng.float(-0.12, 0.12) * target;
		return Math.round(Math.max(0, Math.min(target * 1.6, next)));
	}

	// ── aMule: stats ──────────────────────────────────────────────────────────

	getStats(): StatsResponse & { isHighID: boolean; raw: string } {
		this.advance();
		const downloadSpeed = this.queue.reduce((sum, e) => sum + e.speed, 0);
		const uploadSpeed = this.uploadSpeed();
		const server = this.connectedServer;
		return {
			id: this.clientId,
			ed2kId: this.clientId,
			kadId: this.kadId,
			connectedServer: server ? { name: server.name, description: server.description, ip: server.ip, port: server.port } : undefined,
			connectionState: {
				ed2kConnected: server !== null,
				ed2kConnecting: false,
				kadConnected: true,
				kadFirewalled: false,
				kadRunning: true,
				serverIpv4: server ? { address: server.ip, port: server.port } : undefined,
				serverPing: server?.ping,
				serverPrio: server?.priority,
				serverFailed: server?.failedCount,
				serverStatic: server?.isStatic,
				serverVersion: server?.version,
				serverName: server?.name,
				serverDescription: server?.description,
			},
			uploadOverhead: Math.round(uploadSpeed * 0.03),
			downloadOverhead: Math.round(downloadSpeed * 0.02),
			bannedCount: 3,
			loggerMessage: [],
			totalSentBytes: Math.round(this.totalSent),
			totalReceivedBytes: Math.round(this.totalReceived),
			sharedFileCount: this.shared.length,
			uploadSpeed,
			downloadSpeed,
			uploadSpeedLimit: 120 * 1024,
			downloadSpeedLimit: 0,
			uploadQueueLength: this.uploadQueue.length,
			totalSourceCount: this.queue.reduce((sum, e) => sum + e.sourceCount, 0),
			ed2kUsers: this.servers.reduce((sum, s) => sum + (s.users ?? 0), 0),
			kadUsers: 3_412_000 + this.rng.int(-20_000, 20_000),
			ed2kFiles: this.servers.reduce((sum, s) => sum + (s.files ?? 0), 0),
			kadFiles: 428_000_000 + this.rng.int(-500_000, 500_000),
			kadNodes: this.rng.int(150, 210),
			isHighID: this.clientId >= 16_777_216,
			raw: `Download: ${downloadSpeed} bytes/s\nUpload: ${uploadSpeed} bytes/s`,
		};
	}

	private uploadSpeed(): number {
		return this.uploadQueue.reduce((sum, c) => sum + (c.upSpeed ?? 0), 0);
	}

	// ── aMule: download queue ─────────────────────────────────────────────────

	getQueue(): readonly MockQueueEntry[] {
		this.advance();
		return this.queue;
	}

	findQueueEntry(hash: string): MockQueueEntry | undefined {
		this.advance();
		const lower = hash.toLowerCase();
		return this.queue.find((e) => e.hash === lower);
	}

	addQueueEntry(hash: string, name: string, size: number): MockQueueEntry {
		const entry = this.makeQueueEntry(name, size, -1, hash.toLowerCase());
		entry.done = 0;
		this.queue.push(entry);
		this.appendLog(`Added new download: ${name}`);
		return entry;
	}

	removeQueueEntry(hash: string): boolean {
		const lower = hash.toLowerCase();
		const index = this.queue.findIndex((e) => e.hash === lower);
		if (index < 0) return false;
		this.queue.splice(index, 1);
		return true;
	}

	pauseEntry(hash: string): void {
		const entry = this.findQueueEntry(hash);
		if (!entry || entry.status === FileStatus.COMPLETE) return;
		entry.status = FileStatus.PAUSED;
		entry.stopped = false;
	}

	stopEntry(hash: string): void {
		const entry = this.findQueueEntry(hash);
		if (!entry || entry.status === FileStatus.COMPLETE) return;
		entry.status = FileStatus.PAUSED;
		entry.stopped = true;
	}

	resumeEntry(hash: string): void {
		const entry = this.findQueueEntry(hash);
		if (!entry || entry.status === FileStatus.COMPLETE) return;
		entry.status = FileStatus.READY;
		entry.stopped = false;
		if (entry.cruiseSpeed === 0 && entry.sourceCount > 0) entry.cruiseSpeed = this.rng.int(60, 2200) * 1024;
	}

	isDownloading(entry: MockQueueEntry): boolean {
		return entry.status === FileStatus.READY && !entry.stopped;
	}

	toChunkInfo(entry: MockQueueEntry): ChunkInfo {
		const partCount = entry.availability.length;
		const progress = entry.size > 0 ? entry.done / entry.size : 0;
		const completeParts = Math.floor(progress * partCount);
		const downloadingParts = this.isDownloading(entry) && entry.speed > 0 ? Math.min(3, partCount - completeParts) : 0;
		const rank = new Array<number>(partCount);
		entry.partOrder.forEach((part, position) => (rank[part] = position));
		const chunkStates = entry.availability.map((sources, part) => {
			if (rank[part] < completeParts) return CHUNK_STATUS.COMPLETE;
			if (rank[part] < completeParts + downloadingParts) return CHUNK_STATUS.DOWNLOADING;
			return sources > 0 ? CHUNK_STATUS.AVAILABLE : CHUNK_STATUS.UNAVAILABLE;
		});
		return { chunkStates, chunkAvailability: entry.availability.slice(), partCount, sizeFull: entry.size };
	}

	toTransferringFile(entry: MockQueueEntry): AmuleTransferringFile {
		const chunkInfo = this.toChunkInfo(entry);
		return {
			ecid: entry.ecid,
			fileHashHexString: entry.hash,
			fileName: entry.name,
			sizeFull: entry.size,
			sizeDone: Math.round(entry.done),
			fileStatus: entry.status,
			stopped: entry.stopped,
			sourceCount: entry.sourceCount,
			sourceXferCount: entry.sources.filter((s) => (s.downloadSpeed ?? 0) > 0).length,
			speed: entry.speed,
			downPrio: entry.priority,
			fileEd2kLink: buildEd2kLink(entry.name, entry.size, entry.hash),
			chunkInfo: { chunks: chunkInfo.chunkStates, availability: chunkInfo.chunkAvailability, partCount: chunkInfo.partCount, sizeFull: entry.size },
		};
	}

	private makeQueueEntry(name: string, size: number, index: number, hash = this.rng.hex(32)): MockQueueEntry {
		// Fixture slots: 4 has no sources (stalled), 5 is paused, 6 is stopped, the rest download
		const state = index === 4 ? 'stalled' : index === 5 ? 'paused' : index === 6 ? 'stopped' : 'downloading';
		const partCount = Math.max(1, Math.ceil(size / PARTSIZE));
		const sourceCount = state === 'stalled' ? 0 : this.rng.int(3, 60);
		const cruiseSpeed = state === 'downloading' ? this.rng.int(60, 2200) * 1024 : 0;
		// Some peers know the file under a slightly different name
		const variant = name.replace(/\.(?=[^.]*\.)/g, ' ');
		const sources = Array.from({ length: Math.min(sourceCount, 12) }, () => this.makeSource(this.rng.chance(0.7) ? name : variant, partCount));
		const sourceNames = [
			{ name, count: Math.ceil(sourceCount * 0.7) },
			{ name: variant, count: Math.floor(sourceCount * 0.3) },
		].filter((s) => s.count > 0);
		const availability = Array.from({ length: partCount }, () => (this.rng.chance(0.06) ? 0 : this.rng.int(1, Math.max(1, sourceCount))));
		const partOrder = Array.from({ length: partCount }, (_, i) => i);
		for (let i = partOrder.length - 1; i > 0; i--) {
			const j = this.rng.int(0, i);
			[partOrder[i], partOrder[j]] = [partOrder[j], partOrder[i]];
		}
		return {
			ecid: this.nextEcid++,
			hash,
			name,
			size,
			done: Math.round(size * this.rng.float(0.03, 0.92)),
			speed: cruiseSpeed,
			cruiseSpeed,
			status: state === 'paused' || state === 'stopped' ? FileStatus.PAUSED : FileStatus.READY,
			stopped: state === 'stopped',
			priority: this.rng.int(0, 2),
			sourceCount,
			sources,
			sourceNames,
			availability,
			partOrder,
		};
	}

	private makeSource(remoteFilename: string, partCount: number): TransferSource {
		const sw = this.rng.pick(F.CLIENT_SOFTWARE);
		return {
			clientName: this.rng.pick(F.CLIENT_NAMES),
			ip: this.rng.ipv4(),
			port: this.rng.int(1024, 65000),
			software: sw.software,
			softwareVersion: this.rng.pick(sw.versions),
			downloadSpeed: 0,
			uploadSpeed: 0,
			availableParts: this.rng.int(1, partCount),
			remoteFilename,
			sourceFrom: this.rng.int(0, 3),
			remoteQueueRank: this.rng.int(0, 2500),
			waitingPosition: this.rng.int(0, 400),
		};
	}

	// ── aMule: shared files ───────────────────────────────────────────────────

	addSharedFile(name: string, size: number, dir: string, hash: string): MockSharedFile {
		const shared = this.makeSharedFile(name, size, dir, hash);
		this.shared.push(shared);
		return shared;
	}

	removeSharedFile(hash: string): MockSharedFile | undefined {
		const lower = hash.toLowerCase();
		const index = this.shared.findIndex((f) => f.fileHashHexString === lower);
		if (index < 0) return undefined;
		return this.shared.splice(index, 1)[0];
	}

	/** Directory where a file of the given category ends up: the category path, or the incoming directory. */
	categoryDir(categoryName: string | null): string {
		const category = categoryName ? this.categories.find((c) => c.name === categoryName) : undefined;
		return category?.path || this.incomingDir;
	}

	private makeSharedFile(name: string, size: number, dir: string, hash = this.rng.hex(32)): MockSharedFile {
		const requests = this.rng.int(0, 60);
		const accepts = this.rng.int(0, requests);
		const completeSources = this.rng.int(0, 40);
		return {
			ecid: this.nextEcid++,
			fileHashHexString: hash,
			fileName: name,
			filePath: dir,
			sizeFull: size,
			fileEd2kLink: buildEd2kLink(name, size, hash),
			upPrio: this.rng.pick([0, 1, 1, 1, 2, 5]),
			getRequests: requests,
			getAllRequests: requests + this.rng.int(0, 900),
			getAccepts: accepts,
			getAllAccepts: accepts + this.rng.int(0, 400),
			getXferred: this.rng.int(0, 3) * MiB * this.rng.int(1, 300),
			getAllXferred: this.rng.int(2, 40) * 1024 * MiB,
			getCompleteSourcesLow: Math.max(0, completeSources - 2),
			getCompleteSourcesHigh: completeSources + 3,
			getCompleteSources: completeSources,
			getOnQueue: this.rng.int(0, 25),
			getComment: this.rng.chance(0.3) ? 'Verified, thanks for sharing!' : '',
			getRating: this.rng.int(0, 5),
		};
	}

	// ── aMule: upload queue ───────────────────────────────────────────────────

	getUploadQueue(): readonly AmuleUpDownClient[] {
		this.advance();
		return this.uploadQueue;
	}

	private makeUploadClient(index: number, uploading: boolean): AmuleUpDownClient {
		const sw = this.rng.pick(F.CLIENT_SOFTWARE);
		const file = this.rng.pick(this.shared);
		const server = this.servers[0];
		return {
			ecid: this.nextEcid++,
			clientName: this.rng.pick(F.CLIENT_NAMES),
			userHashHexString: this.rng.hex(32).toUpperCase(),
			userID: this.rng.int(16_777_217, 2_147_483_647),
			score: this.rng.int(100, 90_000),
			software: sw.software,
			softVerStr: `${sw.software} ${this.rng.pick(sw.versions)}`,
			userIP: this.rng.ipv4(),
			userPort: this.rng.int(1024, 65000),
			serverIP: server.ip,
			serverPort: server.port,
			serverName: server.name,
			upSpeed: uploading ? this.rng.int(20, 160) * 1024 : 0,
			uploadedTotal: this.rng.int(5, 900) * MiB,
			uploadFilename: file.fileName,
			remoteFilename: file.fileName,
			waitingPosition: uploading ? 0 : index - 2,
			remoteQueueRank: 0,
			obfuscationStatus: this.rng.int(0, 1),
		};
	}

	// ── aMule: servers ────────────────────────────────────────────────────────

	findServer(ip: string, port: number): MockServer | undefined {
		return this.servers.find((s) => s.ip === ip && s.port === port);
	}

	connectToServer(ip: string, port: number): void {
		const server = this.findServer(ip, port);
		if (!server) throw new Error(`Server not found: ${ip}:${port}`);
		this.connectedServer = server;
		this.appendLog(`Connecting to ${server.name} (${server.ip} - ${server.ip}:${server.port}) using protocol obfuscation.`);
		this.appendLog(`Connected to ${server.name} with HighID`);
	}

	disconnectFromServer(): void {
		if (!this.connectedServer) return;
		this.appendLog(`Disconnected from ${this.connectedServer.name}`);
		this.connectedServer = null;
	}

	addServer(ip: string, port: number, name?: string): void {
		if (this.findServer(ip, port)) return;
		this.servers.push(
			this.toServer({
				name: name || `${ip}:${port}`,
				description: '',
				ip,
				port,
				users: 0,
				maxUsers: 0,
				files: 0,
				ping: 0,
				version: '',
				priority: 0,
				isStatic: false,
				failedCount: 0,
			})
		);
		this.appendLog(`Added server ${name || ip}:${port} to the list`);
	}

	removeServer(ip: string, port: number): void {
		const index = this.servers.findIndex((s) => s.ip === ip && s.port === port);
		if (index < 0) return;
		const [removed] = this.servers.splice(index, 1);
		if (this.connectedServer === removed) this.connectedServer = null;
	}

	/** Adds the fixture servers a server.met download would bring in. */
	refreshServerList(url: string): void {
		for (const server of F.EXTRA_SERVERS) {
			if (!this.findServer(server.ip, server.port)) this.servers.push(this.toServer(server));
		}
		this.appendLog(`Downloaded server list from ${url}`);
	}

	private toServer(s: F.FixtureServer): MockServer {
		return {
			ecid: this.nextEcid++,
			name: s.name,
			description: s.description,
			address: s.ip,
			ip: s.ip,
			port: s.port,
			ping: s.ping,
			users: s.users,
			maxUsers: s.maxUsers,
			files: s.files,
			priority: s.priority,
			version: s.version,
			isStatic: s.isStatic,
			failedCount: s.failedCount,
		};
	}

	// ── aMule: categories ─────────────────────────────────────────────────────

	createCategory(data: Partial<MediaCategory>): MediaCategory {
		const category: MediaCategory = {
			id: Math.max(...this.categories.map((c) => c.id)) + 1,
			name: data.name || 'New Category',
			path: data.path || '',
			comment: data.comment || '',
			color: typeof data.color === 'number' ? data.color : 0,
			priority: typeof data.priority === 'number' ? data.priority : 0,
		};
		this.categories.push(category);
		return category;
	}

	updateCategory(id: number, data: Partial<MediaCategory>): MediaCategory {
		const existing = this.categories.find((c) => c.id === id);
		if (!existing) throw new Error(`Category with id ${id} not found`);
		for (const [key, value] of Object.entries(data)) {
			if (value !== undefined && key !== 'id' && key !== 'resolvedPath') (existing as unknown as Record<string, unknown>)[key] = value;
		}
		return existing;
	}

	deleteCategory(id: number): void {
		const index = this.categories.findIndex((c) => c.id === id);
		if (index < 0) throw new Error(`Category with id ${id} not found`);
		this.categories.splice(index, 1);
	}

	// ── aMule: search ─────────────────────────────────────────────────────────

	startSearch(query: string): void {
		this.search = { query, startedAt: Date.now(), results: this.generateSearchResults(query) };
		this.appendLog(`Search request sent for "${query}"`);
	}

	/** 0 to 1; results are revealed in proportion while the search runs. */
	getSearchProgress(): number {
		if (!this.search) return 0;
		return Math.min(1, (Date.now() - this.search.startedAt) / SEARCH_DURATION_MS);
	}

	getSearchResults(): MockSearchResult[] {
		if (!this.search) return [];
		const revealed = Math.ceil(this.getSearchProgress() * this.search.results.length);
		return this.search.results.slice(0, revealed);
	}

	/** Any result of the current search, revealed or not: what the daemon can turn into a download by hash. */
	findSearchResult(hash: string): MockSearchResult | undefined {
		const lower = hash.toLowerCase();
		return this.search?.results.find((r) => r.hash === lower);
	}

	private generateSearchResults(query: string): MockSearchResult[] {
		const kind = inferSearchKind(query);
		const count = this.rng.int(14, 40);
		const results: MockSearchResult[] = [];
		const seen = new Set<string>();
		for (let i = 0; i < count; i++) {
			const k: SearchKind = kind ?? (this.rng.chance(0.6) ? 'video' : this.rng.pick(['audio', 'document', 'software'] as const));
			const name = this.fillNameTemplate(this.rng.pick(F.SEARCH_TEMPLATES[k]), query);
			if (seen.has(name)) continue;
			seen.add(name);
			// Most results have a handful of sources, a few are very popular
			const sourceCount = Math.max(1, Math.floor(this.rng.next() ** 2 * 900));
			const hash = this.rng.hex(32);
			const size = this.sizeFor(k);
			results.push({ name, size, hash, link: buildEd2kLink(name, size, hash), sourceCount, completeSourceCount: this.rng.int(0, sourceCount), type: '' });
		}
		return results.sort((a, b) => b.sourceCount - a.sourceCount);
	}

	private fillNameTemplate(template: string, query: string): string {
		return template.replace(/\{(\w+)\}/g, (_, key: string) => {
			switch (key) {
				case 'q':
					return query.trim().replace(/\s+/g, '.');
				case 'Q':
					return titleCase(query);
				case 'year':
					return String(this.rng.int(1998, 2025));
				case 'city':
					return this.rng.pick(F.CITIES);
				case 'n':
					return String(this.rng.int(1, 5));
				case 'm':
					return String(this.rng.int(1, 9));
				case 'ver':
					return `${this.rng.int(1, 24)}.${this.rng.int(0, 9)}.${this.rng.int(0, 9)}`;
				default:
					return key;
			}
		});
	}

	private sizeFor(kind: SearchKind): number {
		switch (kind) {
			case 'video':
				return F.gb(this.rng.float(0.7, 8));
			case 'audio':
				return F.mb(this.rng.float(60, 900));
			case 'document':
				return F.mb(this.rng.float(2, 80));
			case 'software':
				return F.mb(this.rng.float(40, 4500));
		}
	}

	// ── Telegram ──────────────────────────────────────────────────────────────

	getTelegramMessage(chatId: string, messageId: number): MessageRow | undefined {
		return this.telegramMessages.get(`${chatId}:${messageId}`);
	}

	/**
	 * Indexed messages whose file name contains every word of the query, newest first. A query with few
	 * hits gets synthetic messages first, so the search view is never empty.
	 */
	searchTelegram(query: string): MessageRow[] {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		const matches = (row: MessageRow) => words.every((w) => (row.file_name ?? '').toLowerCase().includes(w));
		if ([...this.telegramMessages.values()].filter(matches).length < 6) {
			const count = this.rng.int(6, 14);
			for (let i = 0; i < count; i++) this.registerSyntheticTelegramMessage(query);
		}
		return [...this.telegramMessages.values()].filter(matches).sort((a, b) => b.date - a.date);
	}

	getTelegramDownload(hash: string): DownloadStatus | undefined {
		this.advance();
		return this.telegramDownloads.get(hash);
	}

	startTelegramDownload(hash: string, row: MessageRow): void {
		const running = [...this.telegramDownloads.values()].some((s) => s.status === 'downloading');
		this.telegramDownloads.set(hash, {
			hash,
			fileName: row.file_name || 'Unknown',
			size: row.file_size || 0,
			downloaded: 0,
			speed: 0,
			status: running ? 'queued' : 'downloading',
			startTime: Date.now(),
		});
		this.telegramCruise.set(hash, this.rng.int(400, 2500) * 1024);
	}

	setTelegramDownloadStatus(hash: string, status: DownloadStatus['status']): void {
		const download = this.telegramDownloads.get(hash);
		if (!download || download.status === 'completed') return;
		download.status = status;
		if (status !== 'downloading') download.speed = 0;
	}

	cancelTelegramDownload(hash: string): void {
		this.telegramDownloads.delete(hash);
		this.telegramCruise.delete(hash);
		this.promoteQueuedTelegramDownload();
	}

	private promoteQueuedTelegramDownload(): void {
		const downloads = [...this.telegramDownloads.values()];
		if (downloads.some((s) => s.status === 'downloading')) return;
		const next = downloads.find((s) => s.status === 'queued');
		if (next) next.status = 'downloading';
	}

	private registerTelegramMessage(file: F.FixtureTelegramFile): MessageRow {
		const chat = this.telegramChats[file.chatIndex];
		const row: MessageRow = {
			id: this.nextMessageRowId++,
			chat_id: chat.id,
			chat_title: chat.title,
			topic_id: file.topicName ? this.rng.int(1, 999) : 0,
			topic_name: file.topicName,
			message_id: file.messageId,
			sender_id: String(this.rng.int(100_000_000, 999_999_999)),
			date: Math.floor(Date.now() / 1000) - this.rng.int(3600, 90 * 86400),
			text: file.text,
			has_media: 1,
			media_type: file.mediaType,
			file_name: file.name,
			file_size: file.size,
			media_verified_at: Date.now(),
		};
		this.telegramMessages.set(`${chat.id}:${file.messageId}`, row);
		return row;
	}

	private registerSyntheticTelegramMessage(query: string): void {
		const enabled = this.telegramChats.filter((c) => c.indexing_enabled);
		const chat = this.rng.pick(enabled.length > 0 ? enabled : this.telegramChats);
		const kind: SearchKind = inferSearchKind(query) ?? (this.rng.chance(0.6) ? 'video' : this.rng.pick(['audio', 'document', 'software'] as const));
		this.registerTelegramMessage({
			chatIndex: this.telegramChats.indexOf(chat),
			messageId: this.nextSyntheticMessageId++,
			topicName: this.rng.chance(0.4) ? titleCase(query) : null,
			name: this.fillNameTemplate(this.rng.pick(F.SEARCH_TEMPLATES[kind]), query),
			size: this.sizeFor(kind),
			mediaType: kind === 'video' ? 'video' : kind === 'audio' ? 'audio' : 'document',
			text: this.rng.chance(0.5) ? `Re-upload of ${titleCase(query)}, enjoy` : '',
		});
	}

	// ── Speed history ─────────────────────────────────────────────────────────

	currentSpeedSample(): SpeedSample {
		this.advance();
		const active = this.queue.filter((e) => e.status !== FileStatus.COMPLETE && !e.stopped);
		const telegram = [...this.telegramDownloads.values()].filter((s) => s.status !== 'completed' && s.status !== 'stopped');
		const dlAmule = active.reduce((sum, e) => sum + e.speed, 0);
		const dlTelegram = telegram.reduce((sum, s) => sum + s.speed, 0);
		return {
			ts: Date.now(),
			dlAmule,
			dlTelegram,
			dlTotal: dlAmule + dlTelegram,
			ulAmule: this.uploadSpeed(),
			activeAmule: active.length,
			activeTelegram: telegram.length,
			totalShared: this.shared.length,
		};
	}

	/** A plausible past for the dashboard chart: `count` samples `stepMs` apart, ending at the current one. */
	buildSpeedHistory(count: number, stepMs: number): SpeedSample[] {
		const now = this.currentSpeedSample();
		const dlBase = this.queue.filter((e) => this.isDownloading(e)).reduce((sum, e) => sum + e.cruiseSpeed, 0);
		const tgBase = [...this.telegramDownloads.values()]
			.filter((s) => s.status === 'downloading')
			.reduce((sum, s) => sum + (this.telegramCruise.get(s.hash) ?? 0), 0);
		const ulBase = now.ulAmule || 60 * 1024;
		const wave = (i: number, period: number, phase: number) => Math.sin((i / period) * Math.PI * 2 + phase);
		const positive = (x: number) => Math.max(0, Math.round(x));
		const samples: SpeedSample[] = [];
		for (let i = 0; i < count; i++) {
			let dlEnv = 0.7 + 0.2 * wave(i, 720, 0) + 0.1 * wave(i, 90, 1.3) + this.rng.float(-0.07, 0.07);
			const quiet = i > count * 0.31 && i < count * 0.37; // sources dried up for a while
			if (quiet) dlEnv *= 0.08;
			const telegramStarted = i >= count * 0.55; // the Telegram download started a while ago
			const tgEnv = telegramStarted ? 0.8 + 0.15 * wave(i, 300, 0.4) + this.rng.float(-0.1, 0.1) : 0;
			const ulEnv = 0.75 + 0.2 * wave(i, 500, 2) + this.rng.float(-0.1, 0.1);
			const dlAmule = positive(dlBase * dlEnv);
			const dlTelegram = positive(tgBase * tgEnv);
			samples.push({
				ts: now.ts - (count - i) * stepMs,
				dlAmule,
				dlTelegram,
				dlTotal: dlAmule + dlTelegram,
				ulAmule: positive(ulBase * ulEnv),
				activeAmule: quiet ? Math.max(1, now.activeAmule - 2) : now.activeAmule,
				activeTelegram: telegramStarted ? now.activeTelegram : Math.max(0, now.activeTelegram - 1),
				totalShared: i < count * 0.2 ? Math.max(0, now.totalShared - 1) : now.totalShared,
			});
		}
		samples.push(now);
		return samples;
	}

	// ── amuled log ────────────────────────────────────────────────────────────

	appendLog(message: string): void {
		const line = `${formatLogTime(new Date())}: ${message}`;
		this.logLines.push(line);
		if (this.logLines.length > MAX_LOG_LINES) this.logLines.splice(0, this.logLines.length - MAX_LOG_LINES);
		for (const listener of this.logListeners) listener([line]);
	}

	getLogLines(): string[] {
		return this.logLines.slice();
	}

	onLogLines(listener: (lines: string[]) => void): () => void {
		this.logListeners.add(listener);
		return () => this.logListeners.delete(listener);
	}

	private seedLog(): void {
		const server = this.servers[0];
		let time = Date.now() - 25 * 60 * 1000;
		const push = (message: string) => {
			this.logLines.push(`${formatLogTime(new Date(time))}: ${message}`);
			time += this.rng.int(4, 70) * 1000;
		};
		push('Initialising aMule 3.0.1 compiled with wxGTK2 v3.2.4');
		push(`Loading temp files from ${this.tempDir}.`);
		push(`Loading PartFile ${this.rng.int(1, 30)} of ${this.queue.length}`);
		push('All PartFiles Loaded.');
		push(`Loaded ${this.rng.int(150_000, 280_000)} IP addresses from ipfilter.dat`);
		push(`Found ${this.shared.length} known shared files`);
		push('External connections: listening on TCP port 4712');
		push(`Connecting to ${server.name} (${server.ip} - ${server.ip}:${server.port}) using protocol obfuscation.`);
		push(`Connected to ${server.name} with HighID`);
		push(`New clientid is ${this.clientId}`);
		push(`Kad: Connected. Nodes: ${this.rng.int(150, 210)}`);
		while (this.logLines.length < 40 && time < Date.now()) push(this.fillLogTemplate(this.rng.pick(F.LOG_TEMPLATES)));
	}

	private fillLogTemplate(template: string): string {
		const server = this.connectedServer ?? this.servers[0];
		return template.replace(/\{(\w+)\}/g, (_, key: string) => {
			switch (key) {
				case 'server':
					return server.name;
				case 'serverIp':
					return server.ip;
				case 'port':
					return String(server.port);
				case 'ip':
					return this.rng.ipv4();
				case 'id':
					return String(this.clientId);
				case 'n':
					return String(this.rng.int(1, 400));
				case 'file':
					return this.rng.pick([...this.queue.map((e) => e.name), ...this.shared.map((f) => f.fileName)]);
				case 'client':
					return this.rng.pick(F.CLIENT_NAMES);
				case 'word':
					return this.rng.pick(F.SEARCH_WORDS);
				default:
					return key;
			}
		});
	}
}

let instance: MockWorld | null = null;

/** The one simulated daemon every mock service shares. Built on first use, once __APP_CONFIG__ is loaded. */
export function getMockWorld(): MockWorld {
	if (!instance) instance = new MockWorld();
	return instance;
}
