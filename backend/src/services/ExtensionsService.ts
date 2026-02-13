import db from '../db';
import { Extension, ValidationResult } from '../types/ExtensionTypes';

export class ExtensionsService {
	// CRUD Extensions
	getAllExtensions(): Extension[] {
		return db.prepare('SELECT * FROM extensions').all() as Extension[];
	}

	addExtension(extension: Omit<Extension, 'id'>) {
		const stmt = db.prepare('INSERT INTO extensions (name, url, type, enabled) VALUES (?, ?, ?, ?)');
		return stmt.run(extension.name, extension.url, extension.type, extension.enabled);
	}

	deleteExtension(id: number) {
		db.prepare('DELETE FROM extensions WHERE id = ?').run(id);
		db.prepare('DELETE FROM file_validations WHERE extension_id = ?').run(id);
	}

	toggleExtension(id: number, enabled: boolean) {
		db.prepare('UPDATE extensions SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
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
		const results = db.prepare('SELECT * FROM file_validations WHERE file_hash = ?').all(fileHash) as ValidationResult[];

		// Every enabled validator must have a 'passed' result
		for (const v of extensions) {
			const res = results.find((r) => r.extension_id === v.id);
			if (!res || res.status !== 'passed') return false;
		}
		return true;
	}

	getResultsForFile(fileHash: string): ValidationResult[] {
		return db.prepare('SELECT * FROM file_validations WHERE file_hash = ?').all(fileHash) as ValidationResult[];
	}

	async processFile(fileHash: string, filePath: string) {
		// Only process Type 'validator'
		const extensions = this.getAllExtensions().filter((v) => v.enabled && v.type === 'validator');
		if (extensions.length === 0) return;

		console.log(`[ExtensionsService] Processing file ${fileHash} (${filePath})`);

		for (const v of extensions) {
			// Check if already validated (optional, but good optimize)
			const existing = db.prepare('SELECT * FROM file_validations WHERE file_hash = ? AND extension_id = ?').get(fileHash, v.id) as ValidationResult;
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
				console.log(`[ExtensionsService] Validator ${v.name} result for ${fileHash}: ${status}`);
			} catch (error: any) {
				console.error(`Validator ${v.name} failed:`, error);
				this.upsertValidation(fileHash, v.id, 'failed', error.message);
			}
		}
	}

	private upsertValidation(fileHash: string, extensionId: number, status: string, details: string) {
		const stmt = db.prepare(`
            INSERT INTO file_validations (file_hash, extension_id, status, details, last_check)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(file_hash, extension_id) DO UPDATE SET
            status = excluded.status,
            details = excluded.details,
            last_check = CURRENT_TIMESTAMP
        `);
		stmt.run(fileHash, extensionId, status, details);
	}
}
