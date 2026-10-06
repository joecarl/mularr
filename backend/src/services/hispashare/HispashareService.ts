import { container } from '../container/ServiceContainer';
import { MainDB, type Extension } from '../db/MainDB';
import { HispashareApiClient } from './HispashareApiClient';

// ---------------------------------------------------------------------------
// Extension config
// ---------------------------------------------------------------------------

/** Stored as the 'hispashare' extension's `config` JSON. The API base URL lives in the extension's `url`. */
export interface HispashareExtensionConfig {
	/** Personal token from https://www.hispashare.org/token/ */
	token: string;
	/**
	 * Publish the catalogue's newest releases in the indexer feed (see services/indexerfeed), polled every
	 * `feedIntervalMinutes`. Off in configs saved before this existed.
	 */
	feedEnabled: boolean;
	feedIntervalMinutes: number;
}

export const HISPASHARE_FEED_DEFAULT_INTERVAL_MINUTES = 30;
export const HISPASHARE_FEED_MIN_INTERVAL_MINUTES = 10;

/** Validates a config object as received from the API. Throws a message fit for the user on invalid input. */
export function validateHispashareConfig(config: Record<string, unknown>): HispashareExtensionConfig {
	const token = typeof config.token === 'string' ? config.token.trim() : '';
	if (!token) throw new Error('token is required');
	const feedEnabled = config.feedEnabled === true;
	let feedIntervalMinutes = HISPASHARE_FEED_DEFAULT_INTERVAL_MINUTES;
	if (config.feedIntervalMinutes !== undefined && config.feedIntervalMinutes !== null && config.feedIntervalMinutes !== '') {
		const n = Number(config.feedIntervalMinutes);
		if (!Number.isInteger(n) || n < HISPASHARE_FEED_MIN_INTERVAL_MINUTES) {
			throw new Error(`feedIntervalMinutes must be an integer of at least ${HISPASHARE_FEED_MIN_INTERVAL_MINUTES}`);
		}
		feedIntervalMinutes = n;
	}
	return { token, feedEnabled, feedIntervalMinutes };
}

/** Parses a stored config; null when it is missing or unusable (no token). */
export function parseHispashareConfig(config?: string | null): HispashareExtensionConfig | null {
	try {
		return validateHispashareConfig(JSON.parse(config || '{}'));
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** The enabled, configured Hispashare extension with the client that talks to it. */
export interface HispashareActive {
	extension: Extension;
	config: HispashareExtensionConfig;
	client: HispashareApiClient;
}

/**
 * Hands out the Hispashare API client for the current extension settings. One client serves both the
 * search provider and the feed poller (see services/indexerfeed), so its response cache and the quota
 * counters it reads from the API headers are shared; it is rebuilt only when the URL or token change.
 */
export class HispashareService {
	private readonly db = container.get(MainDB);
	private client: { key: string; instance: HispashareApiClient } | null = null;

	/** Whether a Hispashare extension exists at all, enabled or not. */
	hasExtension(): boolean {
		return this.db.getExtensionByType('hispashare') !== undefined;
	}

	/** The enabled extension with a token, or null when Hispashare is not configured. */
	getActive(): HispashareActive | null {
		const ext = this.db.getExtensionByType('hispashare');
		if (!ext || !ext.enabled) return null;
		const config = parseHispashareConfig(ext.config);
		if (!config) return null;
		const key = `${ext.url}|${config.token}`;
		if (this.client?.key !== key) this.client = { key, instance: new HispashareApiClient(ext.url, config.token) };
		return { extension: ext, config, client: this.client.instance };
	}

	/** Client for the enabled extension, or null when Hispashare is not configured. */
	getClient(): HispashareApiClient | null {
		return this.getActive()?.client ?? null;
	}
}
