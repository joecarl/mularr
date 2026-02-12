import db from '../db';
import { Webhook, ValidationResult } from '../types/WebhookTypes';

export class WebhooksService {
	// CRUD Webhooks
	getAllWebhooks(): Webhook[] {
		return db.prepare('SELECT * FROM validators').all() as Webhook[];
	}

	addWebhook(webhook: Omit<Webhook, 'id'>) {
		const stmt = db.prepare('INSERT INTO validators (name, url, type, enabled) VALUES (?, ?, ?, ?)');
		return stmt.run(webhook.name, webhook.url, webhook.type, webhook.enabled);
	}

	deleteWebhook(id: number) {
		db.prepare('DELETE FROM validators WHERE id = ?').run(id);
		db.prepare('DELETE FROM file_validations WHERE validator_id = ?').run(id);
	}

	toggleWebhook(id: number, enabled: boolean) {
		db.prepare('UPDATE validators SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
	}

	// Validations
	/**
	 * Returns true if the file is considered safe/valid to be exposed as 100% completed.
	 */
	getValidationStatus(fileHash: string): boolean {
		// Get all enabled validators, strictly of type 'Validator'
		const validators = this.getAllWebhooks().filter((v) => v.enabled && v.type === 'Validator');
		if (validators.length === 0) return true; // No validators = no restrictions

		// Check results
		const results = db.prepare('SELECT * FROM file_validations WHERE file_hash = ?').all(fileHash) as ValidationResult[];

		// Every enabled validator must have a 'passed' result
		for (const v of validators) {
			const res = results.find((r) => r.validator_id === v.id);
			if (!res || res.status !== 'passed') return false;
		}
		return true;
	}

	getResultsForFile(fileHash: string): ValidationResult[] {
		return db.prepare('SELECT * FROM file_validations WHERE file_hash = ?').all(fileHash) as ValidationResult[];
	}

	async processFile(fileHash: string, filePath: string) {
		// Only process Type 'Validator'
		const validators = this.getAllWebhooks().filter((v) => v.enabled && v.type === 'Validator');
		if (validators.length === 0) return;

		console.log(`[WebhooksService] Processing file ${fileHash} (${filePath})`);

		for (const v of validators) {
			// Check if already validated (optional, but good optimize)
			const existing = db.prepare('SELECT * FROM file_validations WHERE file_hash = ? AND validator_id = ?').get(fileHash, v.id) as ValidationResult;
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
				console.log(`[WebhooksService] Validator ${v.name} result for ${fileHash}: ${status}`);
			} catch (error: any) {
				console.error(`Validator ${v.name} failed:`, error);
				this.upsertValidation(fileHash, v.id, 'failed', error.message);
			}
		}
	}

	private upsertValidation(fileHash: string, validatorId: number, status: string, details: string) {
		const stmt = db.prepare(`
            INSERT INTO file_validations (file_hash, validator_id, status, details, last_check)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(file_hash, validator_id) DO UPDATE SET
            status = excluded.status,
            details = excluded.details,
            last_check = CURRENT_TIMESTAMP
        `);
		stmt.run(fileHash, validatorId, status, details);
	}
}
