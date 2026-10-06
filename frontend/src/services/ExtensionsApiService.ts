import { BaseApiService } from './BaseApiService';

export type ExtensionType = /*'validator' | 'enhanced_search' |*/ 'webhook' | 'media_previewer' | 'sonarr' | 'radarr' | 'hispashare';

export interface Extension {
	id: number;
	name: string;
	url: string;
	type: ExtensionType;
	enabled: number;
	config?: string;
}

export const EXTENSION_TYPES: Record<ExtensionType, { label: string; requiresUrl: boolean }> = {
	// validator: { label: 'Validator', requiresUrl: true },
	// enhanced_search: { label: 'Enhanced Search', requiresUrl: false },
	webhook: { label: 'Webhook', requiresUrl: true },
	media_previewer: { label: 'Media Previewer', requiresUrl: true },
	sonarr: { label: 'Sonarr', requiresUrl: true },
	radarr: { label: 'Radarr', requiresUrl: true },
	hispashare: { label: 'Hispashare', requiresUrl: true },
};

/** Must match HISPASHARE_DEFAULT_API_URL in backend/src/services/hispashare/HispashareApiClient.ts. */
export const HISPASHARE_DEFAULT_API_URL = 'https://api.hispashare.org';

/** Must match HISPASHARE_FEED_*_INTERVAL_MINUTES in backend/src/services/hispashare/HispashareService.ts. */
export const HISPASHARE_FEED_DEFAULT_INTERVAL_MINUTES = 30;
export const HISPASHARE_FEED_MIN_INTERVAL_MINUTES = 10;

/**
 * Settings of the hispashare extension, stored as { token, feedEnabled, feedIntervalMinutes } in its config.
 * Must match HispashareExtensionConfig in backend/src/services/hispashare/HispashareService.ts.
 */
export interface HispashareExtensionConfig {
	token: string;
	/** Publish the catalogue's newest releases in the indexer feed, polled every feedIntervalMinutes. */
	feedEnabled: boolean;
	feedIntervalMinutes: number;
}

export function parseHispashareConfig(config?: string): HispashareExtensionConfig {
	const defaults: HispashareExtensionConfig = { token: '', feedEnabled: false, feedIntervalMinutes: HISPASHARE_FEED_DEFAULT_INTERVAL_MINUTES };
	try {
		const parsed = JSON.parse(config || '{}');
		return {
			token: typeof parsed.token === 'string' ? parsed.token : defaults.token,
			feedEnabled: parsed.feedEnabled === true,
			feedIntervalMinutes: Number.isInteger(parsed.feedIntervalMinutes) ? parsed.feedIntervalMinutes : defaults.feedIntervalMinutes,
		};
	} catch {
		return defaults;
	}
}

/** Extension types that sync a *arr wanted list into the Torznab RSS feed. */
export const ARR_EXTENSION_TYPES: readonly ExtensionType[] = ['sonarr', 'radarr'];

export function isArrExtensionType(type: string): boolean {
	return (ARR_EXTENSION_TYPES as readonly string[]).includes(type);
}

/** Must match ARR_SYNC_*_INTERVAL_MINUTES in backend/src/services/arrsync/ArrSyncService.ts. */
export const ARR_SYNC_DEFAULT_INTERVAL_MINUTES = 60;
export const ARR_SYNC_MIN_INTERVAL_MINUTES = 15;

/**
 * Settings of a sonarr/radarr extension, stored as { apiKey, intervalMinutes, searchProviders } in its config.
 * Must match ArrExtensionConfig in backend/src/services/arrsync/ArrSyncService.ts.
 */
export interface ArrExtensionConfig {
	apiKey: string;
	intervalMinutes: number;
	/**
	 * Search providers of the instance: for its wanted sync and for the automatic searches its app runs through the
	 * Torznab indexer. Empty means none, undefined (configs saved before it existed) means all.
	 */
	searchProviders?: string[];
}

export function parseArrConfig(config?: string): ArrExtensionConfig {
	try {
		const parsed = JSON.parse(config || '{}');
		return {
			apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
			intervalMinutes: Number.isInteger(parsed.intervalMinutes) ? parsed.intervalMinutes : ARR_SYNC_DEFAULT_INTERVAL_MINUTES,
			searchProviders: Array.isArray(parsed.searchProviders)
				? parsed.searchProviders.filter((p: unknown): p is string => typeof p === 'string')
				: undefined,
		};
	} catch {
		return { apiKey: '', intervalMinutes: ARR_SYNC_DEFAULT_INTERVAL_MINUTES };
	}
}

/** App events a webhook extension can subscribe to. Must match AppEvent in backend/src/services/AppEvents.ts. */
export const WEBHOOK_EVENTS: { id: string; label: string; description: string }[] = [
	{ id: 'download.added', label: 'Download Added', description: 'A new download is added to the queue' },
	{ id: 'download.completed', label: 'Download Completed', description: 'A download finishes and the file is available' },
	{ id: 'download.cancelled', label: 'Download Cancelled', description: 'A download is cancelled and removed' },
	{ id: 'search.started', label: 'Search Started', description: 'A new search is launched' },
	{ id: 'blacklist.added', label: 'Blacklist Entry Added', description: 'A hash is added to the blacklist' },
	{ id: 'system.alert', label: 'System Alert', description: 'Monitoring notifications (daemon restarts, VPN issues...)' },
];

/** Events a webhook extension is subscribed to, stored as { events: string[] } in its config. */
export function parseWebhookEvents(config?: string): string[] {
	try {
		const parsed = JSON.parse(config || '{}');
		return Array.isArray(parsed.events) ? parsed.events : [];
	} catch {
		return [];
	}
}

export class ExtensionsApiService extends BaseApiService {
	constructor() {
		super('/api/extensions');
	}

	async getExtensions(): Promise<Extension[]> {
		return this.request<Extension[]>('');
	}

	/** Creates the extension together with its type-specific settings; the backend validates them as one. */
	async addExtension(v: { name: string; url: string; type: ExtensionType; enabled: number; config?: object }): Promise<{ success: boolean; id?: number }> {
		return this.request<{ success: boolean; id?: number }>('', {
			method: 'POST',
			body: JSON.stringify(v),
		});
	}

	async deleteExtension(id: number): Promise<void> {
		return this.request<void>(`/${id}`, { method: 'DELETE' });
	}

	async toggleExtension(id: number, enabled: boolean): Promise<void> {
		return this.request<void>(`/${id}/toggle`, {
			method: 'PATCH',
			body: JSON.stringify({ enabled }),
		});
	}

	async updateExtensionUrl(id: number, url: string): Promise<void> {
		return this.request<void>(`/${id}`, {
			method: 'PATCH',
			body: JSON.stringify({ url }),
		});
	}

	async updateExtensionConfig(id: number, config: object): Promise<void> {
		return this.request<void>(`/${id}/config`, {
			method: 'PATCH',
			body: JSON.stringify({ config }),
		});
	}

	/** Checks the given settings against the remote service without saving them. Rejects with the reason on failure. */
	async testConnection(type: ExtensionType, url: string, config: object): Promise<{ success: boolean; message: string }> {
		return this.request<{ success: boolean; message: string }>('/test-connection', {
			method: 'POST',
			body: JSON.stringify({ type, url, config }),
		});
	}
}
