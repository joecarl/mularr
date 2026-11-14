import 'dotenv/config';
import { readFileSync } from 'fs';
import os from 'os';
import path from 'path/posix';

export interface AppManifest {
	version: string;
}

export const __APP_MANIFEST__ = JSON.parse(readFileSync(path.join(__dirname, '../../app-manifest.json'), 'utf-8')) as AppManifest;

// -- Environment configuration --------------------------------------------------
// Every environment variable is read and validated here, once, at startup. Services take what
// they need from __APP_CONFIG__ instead of reading process.env themselves, so an invalid value
// fails fast with a clear message instead of surfacing as NaN or a silent default at runtime.
// Empty values count as unset: docker-compose.example.yml passes every optional variable as `NAME=`.

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const HISPASHARE_DOWNLOAD_PRIORITIES = ['low', 'normal', 'high', 'very_high', 'off'] as const;
export type HispashareDownloadPriority = Exclude<(typeof HISPASHARE_DOWNLOAD_PRIORITIES)[number], 'off'>;

export interface AppConfig {
	/**
	 * Serve generated data instead of talking to aMule, Gluetun, Telegram or the public IP lookups (see
	 * src/mock). Meant for screenshots and UI work. So that it never reaches a real system, the database is
	 * forced into a throwaway directory that is reseeded on every start, and bot notifications are disabled.
	 */
	mockMode: boolean;
	/** HTTP and WebSocket port. */
	port: number;
	/** Minimum level written to the console; see services/logging/Logger.ts. */
	logLevel: LogLevel;
	/**
	 * Directory holding everything Mularr persists: the SQLite databases, the JWT secret file and, by default, the
	 * aMule config dir. The Docker image sets it to /app/data; outside Docker it defaults to dev-data/ at the
	 * repository root; in mock mode it is a throwaway directory under the OS temp folder.
	 */
	dataDir: string;
	/** Main SQLite database, `mularr.db` inside dataDir unless the deprecated DATABASE_PATH says otherwise. */
	databasePath: string;
	/** What the Telegram feature persists (the indexer database with the account and the chats index): `telegram/` inside dataDir. */
	telegramDir: string;
	auth: {
		username?: string;
		password?: string;
		apiKey?: string;
		/** Signing secret; when unset one is generated and persisted next to the database. */
		jwtSecret?: string;
	};
	/** Telegram bot notifications; undefined when TELEGRAM_BOT_TOKEN is not set. */
	telegramBot?: {
		token: string;
		chatId?: string;
		topicId?: number;
	};
	/**
	 * Seed limits: how long a finished download keeps being shared before a client of the qBittorrent API
	 * (Sonarr/Radarr) may remove it, as a torrent client stops seeding. Both 0: removable right after import,
	 * so they move the file and drop the download at once. Otherwise they copy the file on import and remove
	 * the download, and its file, once either limit is reached. A client can override them per download
	 * (torrents/setShareLimits).
	 */
	seeding: {
		/** Uploaded/size ratio (aMule's all-time upload stats); 0 disables. */
		ratioLimit: number;
		/** Minutes since completion; 0 disables. */
		timeLimitMinutes: number;
	};
	gluetun: {
		enabled: boolean;
		/** Control server base URL, without trailing slash. */
		api: string;
		/** Index into the `ports` array of the portforward response; undefined uses the single `port` value. */
		portIndex?: number;
	};
	amule: {
		/** amuled config directory (amule.conf, *.met, logfile). Defaults to `amule/` inside dataDir. */
		configDir: string;
		/** Environment overrides; when set, the matching Settings field is locked. */
		incomingDir?: string;
		tempDir?: string;
		/**
		 * Shared directories from the environment (absolute paths). When either list is defined,
		 * even if empty, shared directories are applied at startup and locked in Settings.
		 */
		sharedDirsRecursive?: string[];
		sharedDirsExplicit?: string[];
		/** Scheduled daemon restart period; 0 disables it. */
		restartIntervalHours: number;
		/** External Connection client settings used to reach amuled. */
		ec: {
			host: string;
			port: number;
			password: string;
		};
	};
	hispashare: {
		/**
		 * aMule download priority given to releases grabbed from Hispashare, so the Spanish eD2k catalogue
		 * releases the user wants first are fetched first. One of low, normal, high (default) or very_high;
		 * null leaves the priority aMule chose untouched.
		 */
		downloadPriority: HispashareDownloadPriority | null;
		/**
		 * Keep Hispashare downloads sharing after completion: the seed limits Sonarr/Radarr set on them are
		 * stored as -1 (no limit of that kind), so the *arr never remove the download, and its file, once it
		 * is imported. Enabled by default.
		 */
		keepSharing: boolean;
	};
}

/** Raw value, or undefined when the variable is unset or empty. */
function envString(name: string): string | undefined {
	const value = process.env[name];
	return value === undefined || value === '' ? undefined : value;
}

/** Non-negative decimal number, or `fallback` when unset. */
function envNumber(name: string, fallback: number): number {
	const raw = envString(name);
	if (raw === undefined) return fallback;
	const value = Number(raw.trim());
	if (!Number.isFinite(value) || value < 0) {
		throw new Error(`Invalid ${name}="${raw}": expected a number >= 0`);
	}
	return value;
}

function envInt(name: string): number | undefined;
function envInt(name: string, fallback: number): number;
function envInt(name: string, fallback?: number): number | undefined {
	const raw = envString(name);
	if (raw === undefined) return fallback;
	if (!/^-?\d+$/.test(raw.trim())) {
		throw new Error(`Invalid ${name}="${raw}": expected an integer`);
	}
	return parseInt(raw, 10);
}

/** One of `allowed` (case-insensitive), or `fallback` when unset. */
function envEnum<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
	const raw = envString(name);
	if (raw === undefined) return fallback;
	const value = raw.trim().toLowerCase();
	if (!(allowed as readonly string[]).includes(value)) {
		throw new Error(`Invalid ${name}="${raw}": expected one of ${allowed.join(', ')}`);
	}
	return value as T;
}

/** True only for "true" (case-insensitive), the convention documented in docker-compose.example.yml; `fallback` when unset. */
function envBool(name: string, fallback = false): boolean {
	const raw = envString(name);
	return raw === undefined ? fallback : raw.toLowerCase() === 'true';
}

/** Semicolon-separated absolute paths; non-absolute entries are dropped with a warning. Undefined when the variable is unset. */
function envPathList(name: string): string[] | undefined {
	const raw = envString(name);
	if (raw === undefined) return undefined;
	const paths: string[] = [];
	for (const entry of raw.split(';')) {
		const trimmed = entry.trim();
		if (!trimmed) continue;
		if (!path.isAbsolute(trimmed)) {
			console.warn(`Ignoring non-absolute shared directory path from ${name}: ${trimmed}`);
			continue;
		}
		paths.push(trimmed);
	}
	return paths;
}

function loadConfig(): AppConfig {
	const mockMode = envBool('MOCK_MODE');
	// Mock mode never notifies a real chat, whatever the environment says
	const telegramBotToken = mockMode ? undefined : envString('TELEGRAM_BOT_TOKEN');
	// Single data directory (mularr.db, jwt-secret, telegram/, amule/). The Docker image sets DATA_DIR to its
	// /app/data volume; in the devcontainer it is dev-data/ at the repository root, which .devcontainer/setup-amule.sh
	// seeds with an amule.conf. DATABASE_PATH predates DATA_DIR: when set it still wins, and the data directory is
	// the one containing the database as before, so existing deployments keep their layout untouched.
	const legacyDatabasePath = mockMode ? undefined : envString('DATABASE_PATH');
	if (legacyDatabasePath) {
		console.warn(
			`DATABASE_PATH is deprecated and will be removed in a future release. Set DATA_DIR=${path.dirname(legacyDatabasePath)} instead, and rename the database file to mularr.db if it is called differently.`
		);
	}
	const dataDir = mockMode
		? path.join(os.tmpdir(), 'mularr-mock') // DATA_DIR and DATABASE_PATH are ignored on purpose: the mock wipes its data directory on start
		: legacyDatabasePath
			? path.dirname(legacyDatabasePath)
			: (envString('DATA_DIR') ?? path.join(__dirname, '../../dev-data'));
	const hispashareDownloadPriority = envEnum('HISPASHARE_DOWNLOAD_PRIORITY', HISPASHARE_DOWNLOAD_PRIORITIES, 'high');
	return {
		mockMode,
		port: envInt('PORT', 8940),
		logLevel: envEnum('LOG_LEVEL', LOG_LEVELS, 'info'),
		dataDir,
		databasePath: legacyDatabasePath ?? path.join(dataDir, 'mularr.db'),
		telegramDir: path.join(dataDir, 'telegram'),
		auth: {
			username: envString('AUTH_USERNAME'),
			password: envString('AUTH_PASSWORD'),
			apiKey: envString('API_KEY'),
			jwtSecret: envString('JWT_SECRET'),
		},
		telegramBot: telegramBotToken ? { token: telegramBotToken, chatId: envString('TELEGRAM_CHAT_ID'), topicId: envInt('TELEGRAM_TOPIC_ID') } : undefined,
		seeding: {
			ratioLimit: envNumber('SEED_RATIO_LIMIT', 0),
			timeLimitMinutes: envInt('SEED_TIME_LIMIT_MINUTES', 0),
		},
		gluetun: {
			enabled: envBool('GLUETUN_ENABLED'),
			api: (envString('GLUETUN_API') ?? 'http://localhost:8000/v1').replace(/\/$/, ''),
			portIndex: envInt('GLUETUN_PORT_INDEX'),
		},
		amule: {
			configDir: envString('AMULE_CONFIG_DIR') ?? path.join(dataDir, 'amule'),
			incomingDir: envString('AMULE_INCOMING_DIR'),
			tempDir: envString('AMULE_TEMP_DIR'),
			sharedDirsRecursive: envPathList('AMULE_SHAREDDIR_RECURSIVE'),
			sharedDirsExplicit: envPathList('AMULE_SHAREDDIR_EXPLICIT'),
			restartIntervalHours: envInt('AMULE_RESTART_INTERVAL_HOURS', 12),
			ec: {
				host: envString('AMULE_EC_CLIENT_HOST') ?? 'localhost',
				port: envInt('AMULE_EC_CLIENT_PORT', 4712),
				password: envString('AMULE_EC_CLIENT_PASSWORD') ?? 'secret',
			},
		},
		hispashare: {
			downloadPriority: hispashareDownloadPriority === 'off' ? null : hispashareDownloadPriority,
			keepSharing: envBool('HISPASHARE_KEEP_SHARING', true),
		},
	};
}

export const __APP_CONFIG__: AppConfig = loadConfig();
