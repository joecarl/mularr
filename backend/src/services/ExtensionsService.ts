import { MainDB, Extension, ValidationResult } from '../services/db/MainDB';
import { container } from './container/ServiceContainer';
import { AppEvent, AppEvents, isAppEvent } from './AppEvents';
import { createArrApiClient, isArrExtensionType, validateArrConfig } from './arrsync/ArrSyncService';
import { HispashareApiClient } from './hispashare/HispashareApiClient';
import { validateHispashareConfig } from './hispashare/HispashareService';
import { LoggerFactory } from './logging/Logger';

function isHttpUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch {
		return false;
	}
}

export class ExtensionsService {
	private readonly logger = LoggerFactory.create(this);
	private readonly db = container.get(MainDB);
	private readonly events = container.get(AppEvents);

	constructor() {
		// Forward every app event to the 'webhook' extensions subscribed to it
		this.events.onAny((event, payload) => this.dispatchToWebhooks(event, payload));
	}

	// CRUD Extensions
	getAllExtensions(): Extension[] {
		return this.db.getAllExtensions();
	}

	/**
	 * Creates an extension with its settings in one step, so nothing half-configured is ever stored.
	 * The config is validated like in updateExtensionConfig. Throws a message fit for the user.
	 */
	addExtension(extension: Omit<Extension, 'id' | 'config'>, config?: Record<string, unknown>) {
		const name = typeof extension.name === 'string' ? extension.name.trim() : '';
		if (!name) throw new Error('Label is required');
		const url = typeof extension.url === 'string' ? extension.url.trim() : '';
		const normalized = config ? this.normalizeConfig(extension.type, config) : undefined;
		return this.db.addExtension({ ...extension, name, url, config: normalized ? JSON.stringify(normalized) : undefined });
	}

	deleteExtension(id: number) {
		this.db.deleteExtension(id);
	}

	toggleExtension(id: number, enabled: boolean) {
		this.db.toggleExtension(id, enabled);
	}

	/**
	 * Changes the endpoint an extension points to. Only the URL is editable after creation:
	 * the type is fixed and everything else lives in `config`.
	 */
	updateExtensionUrl(id: number, url: unknown) {
		const extension = this.db.getExtensionById(id);
		if (!extension) throw new Error(`Extension ${id} not found`);
		const trimmed = typeof url === 'string' ? url.trim() : null;
		// A Sonarr/Radarr extension needs no URL while its wanted sync is off (see ArrExtensionConfig.syncWanted)
		const emptyAllowed = trimmed === '' && isArrExtensionType(extension.type);
		if (trimmed === null || (!emptyAllowed && !isHttpUrl(trimmed))) {
			throw new Error('url must be a valid http(s) URL');
		}
		this.db.updateExtensionUrl(id, trimmed);
	}

	updateExtensionConfig(id: number, config: Record<string, unknown>) {
		const extension = this.db.getExtensionById(id);
		if (!extension) throw new Error(`Extension ${id} not found`);
		this.db.updateExtensionConfig(id, JSON.stringify(this.normalizeConfig(extension.type, config)));
	}

	/** Validates a config for the extension type and returns it normalized. Throws a message fit for the user. */
	private normalizeConfig(type: string, config: Record<string, unknown>): Record<string, unknown> {
		if (type === 'webhook') {
			const events = config.events;
			if (!Array.isArray(events) || !events.every(isAppEvent)) {
				throw new Error('Webhook config must contain an "events" array of valid event names');
			}
			return config;
		}
		// Normalized so the stored config always carries usable values (e.g. the default sync interval)
		if (isArrExtensionType(type)) return { ...validateArrConfig(config) };
		if (type === 'hispashare') return { ...validateHispashareConfig(config) };
		return config;
	}

	/**
	 * Checks that an extension's endpoint answers with the given settings, before or after saving them.
	 * Only Sonarr/Radarr extensions support it: they must be the right app and accept the API key.
	 * Resolves with a message for the user; rejects with the reason otherwise.
	 */
	async testConnection(type: string, url: string, config: Record<string, unknown>): Promise<string> {
		if (!isHttpUrl(url.trim())) {
			throw new Error('url must be a valid http(s) URL');
		}
		if (type === 'hispashare') {
			const { token } = validateHispashareConfig(config);
			const quota = await new HispashareApiClient(url.trim(), token).checkToken();
			const left = quota.remaining !== null && quota.limit !== null ? ` ${quota.remaining} of ${quota.limit} requests left this hour.` : '';
			return `Connected to Hispashare.${left}`;
		}
		if (!isArrExtensionType(type)) {
			throw new Error('Connection test is not supported for this extension type');
		}
		const { apiKey } = validateArrConfig(config);
		if (!apiKey) throw new Error('apiKey is required to test the connection');
		const status = await createArrApiClient(type, url.trim(), apiKey).getSystemStatus();
		const appName = (status.appName ?? '').toLowerCase();
		if (appName && appName !== type) {
			throw new Error(`The URL answers as ${status.appName}, not ${type}`);
		}
		return `Connected to ${status.appName ?? type}${status.version ? ` v${status.version}` : ''}`;
	}

	// Webhooks
	/**
	 * Sends the event to every enabled 'webhook' extension subscribed to it.
	 * Scheme: POST <extension.url> { event, timestamp, data }
	 * Webhooks are called in parallel; failures are logged and never propagate.
	 */
	private dispatchToWebhooks(event: AppEvent, data: unknown): void {
		try {
			const webhooks = this.getAllExtensions().filter((v) => v.enabled && v.type === 'webhook' && this.getSubscribedEvents(v).includes(event));
			if (webhooks.length === 0) return;

			const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data });
			for (const webhook of webhooks) void this.postWebhook(webhook, event, body);
		} catch (error) {
			this.logger.error(`Failed to dispatch ${event} to webhooks:`, error);
		}
	}

	/** Never rejects: every failure is logged here. */
	private async postWebhook(webhook: Extension, event: AppEvent, body: string): Promise<void> {
		try {
			const response = await fetch(webhook.url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body,
				signal: AbortSignal.timeout(10_000),
			});
			if (!response.ok) {
				throw new Error(`Webhook responded ${response.status}`);
			}
		} catch (error: any) {
			this.logger.error(`Webhook ${webhook.name} failed for ${event}:`, error?.message ?? error);
		}
	}

	/** Events a webhook extension is subscribed to, stored as { events: string[] } in its config. */
	private getSubscribedEvents(webhook: Extension): string[] {
		try {
			const config = JSON.parse(webhook.config || '{}');
			return Array.isArray(config.events) ? config.events : [];
		} catch {
			return [];
		}
	}

	// Validations
	/**
	 * Returns true if the file is considered safe/valid to be exposed as 100% completed.
	 */
	getValidationStatus(fileHash: string): boolean {
		// Get all enabled extensions, strictly of type 'validator'
		const extensions = this.getAllExtensions().filter((v) => v.enabled && v.type === 'validator');
		if (extensions.length === 0) return true; // No validators = no restrictions

		// Check results
		const results = this.db.getValidationsForFile(fileHash);

		// Every enabled validator must have a 'passed' result
		for (const v of extensions) {
			const res = results.find((r) => r.extension_id === v.id);
			if (!res || res.status !== 'passed') return false;
		}
		return true;
	}

	getResultsForFile(fileHash: string): ValidationResult[] {
		return this.db.getValidationsForFile(fileHash);
	}

	async processFile(fileHash: string, filePath: string) {
		// Only process Type 'validator'
		const extensions = this.getAllExtensions().filter((v) => v.enabled && v.type === 'validator');
		if (extensions.length === 0) return;

		this.logger.debug(`Processing file ${fileHash} (${filePath})`);

		for (const v of extensions) {
			// Check if already validated (optional, but good optimize)
			const existing = this.db.getValidation(fileHash, v.id);
			if (existing && existing.status === 'passed') continue;

			// Trigger validation
			try {
				// Initial status pending
				this.upsertValidation(fileHash, v.id, 'pending', 'Starting validation...');

				// Call external API
				// Scheme: POST /validate { fileHash, filePath }
				const response = await fetch(v.url, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ fileHash, filePath }),
				});

				if (!response.ok) {
					throw new Error(`Validator responded ${response.status}`);
				}

				const data = await response.json();
				// Assume response: { valid: boolean, details: string }
				const status = data.valid ? 'passed' : 'failed';
				this.upsertValidation(fileHash, v.id, status, data.details || 'Validation completed');
				this.logger.info(`Validator ${v.name} result for ${fileHash}: ${status}`);
			} catch (error: any) {
				this.logger.error(`Validator ${v.name} failed:`, error);
				this.upsertValidation(fileHash, v.id, 'failed', error.message);
			}
		}
	}

	private upsertValidation(fileHash: string, extensionId: number, status: string, details: string) {
		this.db.upsertValidation(fileHash, extensionId, status, details);
	}
}
