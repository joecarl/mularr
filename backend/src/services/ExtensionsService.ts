import { MainDB, Extension, ValidationResult } from '../services/db/MainDB';
import { container } from './container/ServiceContainer';

export class ExtensionsService {
	private db: MainDB;

	constructor() {
		this.db = container.get(MainDB);
	}

	// CRUD Extensions
	getAllExtensions(): Extension[] {
		return this.db.getAllExtensions();
	}

	addExtension(extension: Omit<Extension, 'id'>) {
		return this.db.addExtension(extension);
	}

	deleteExtension(id: number) {
		this.db.deleteExtension(id);
	}

	toggleExtension(id: number, enabled: boolean) {
		this.db.toggleExtension(id, enabled);
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

		console.log(`[ExtensionsService] Processing file ${fileHash} (${filePath})`);

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
				console.log(`[ExtensionsService] Validator ${v.name} result for ${fileHash}: ${status}`);
			} catch (error: any) {
				console.error(`Validator ${v.name} failed:`, error);
				this.upsertValidation(fileHash, v.id, 'failed', error.message);
			}
		}
	}

	private upsertValidation(fileHash: string, extensionId: number, status: string, details: string) {
		this.db.upsertValidation(fileHash, extensionId, status, details);
	}
}
