export type ExtensionType = 'validator' | 'enhanced_search' | 'webhook';

export interface Extension {
	id: number;
	name: string;
	url: string;
	type: ExtensionType;
	enabled: number;
}

export interface ValidationResult {
	file_hash: string;
	extension_id: number;
	status: 'pending' | 'passed' | 'failed';
	details?: string;
	last_check: number;
}
