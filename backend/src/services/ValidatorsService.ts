import db from '../db';
import { Validator, ValidationResult } from '../types/ValidatorTypes';

export class ValidatorsService {
	// CRUD Validators
	getAllValidators(): Validator[] {
		return db.prepare('SELECT * FROM validators').all() as Validator[];
	}

	addValidator(validator: Omit<Validator, 'id'>) {
		const stmt = db.prepare('INSERT INTO validators (name, url, type, enabled) VALUES (?, ?, ?, ?)');
		return stmt.run(validator.name, validator.url, validator.type, validator.enabled);
	}

	deleteValidator(id: number) {
		db.prepare('DELETE FROM validators WHERE id = ?').run(id);
		db.prepare('DELETE FROM file_validations WHERE validator_id = ?').run(id);
	}

	toggleValidator(id: number, enabled: boolean) {
		db.prepare('UPDATE validators SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
	}

	// Validations
	/**
	 * Returns true if the file is considered safe/valid to be exposed as 100% completed.
	 */
	getValidationStatus(fileHash: string): boolean {
		// Get all enabled validators
		const validators = this.getAllValidators().filter((v) => v.enabled);
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
		const validators = this.getAllValidators().filter((v) => v.enabled);
		if (validators.length === 0) return;

		console.log(`[ValidatorsService] Processing file ${fileHash} (${filePath})`);

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
				console.log(`[ValidatorsService] Validator ${v.name} result for ${fileHash}: ${status}`);
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
