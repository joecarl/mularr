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
	/** Main SQLite database. The data directory (JWT secret file, indexer DB) is derived from it. In mock mode it lives under the OS temp directory. */
	databasePath: string;
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
	gluetun: {
		enabled: boolean;
		/** Control server base URL, without trailing slash. */
		api: string;
		/** Index into the `ports` array of the portforward response; undefined uses the single `port` value. */
		portIndex?: number;
	};
	amule: {
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
}

/** Raw value, or undefined when the variable is unset or empty. */
function envString(name: string): string | undefined {
	const value = process.env[name];
	return value === undefined || value === '' ? undefined : value;
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

/** True only for "true" (case-insensitive), the convention documented in docker-compose.example.yml. */
function envBool(name: string): boolean {
	return envString(name)?.toLowerCase() === 'true';
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
	return {
		mockMode,
		port: envInt('PORT', 8940),
		logLevel: envEnum('LOG_LEVEL', LOG_LEVELS, 'info'),
		databasePath: mockMode
			? path.join(os.tmpdir(), 'mularr-mock', 'database.sqlite') // DATABASE_PATH is ignored on purpose: the mock wipes its data directory on start
			: (envString('DATABASE_PATH') ?? path.join(__dirname, '../dev-data/database.sqlite')),
		auth: {
			username: envString('AUTH_USERNAME'),
			password: envString('AUTH_PASSWORD'),
			apiKey: envString('API_KEY'),
			jwtSecret: envString('JWT_SECRET'),
		},
		telegramBot: telegramBotToken ? { token: telegramBotToken, chatId: envString('TELEGRAM_CHAT_ID'), topicId: envInt('TELEGRAM_TOPIC_ID') } : undefined,
		gluetun: {
			enabled: envBool('GLUETUN_ENABLED'),
			api: (envString('GLUETUN_API') ?? 'http://localhost:8000/v1').replace(/\/$/, ''),
			portIndex: envInt('GLUETUN_PORT_INDEX'),
		},
		amule: {
			configDir: envString('AMULE_CONFIG_DIR') ?? path.join(envString('HOME') ?? '/home/node', '.aMule'),
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
	};
}

export const __APP_CONFIG__: AppConfig = loadConfig();
