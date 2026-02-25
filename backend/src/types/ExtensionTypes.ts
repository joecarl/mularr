export type ExtensionType = 'validator' | 'enhanced_search' | 'webhook' | 'telegram_indexer' | 'media_previewer';

export interface Extension {
	id: number;
	name: string;
	url: string;
	type: ExtensionType;
	enabled: number;
	config?: string;
}

export interface ValidationResult {
	file_hash: string;
	extension_id: number;
	status: 'pending' | 'passed' | 'failed';
	details?: string;
	last_check: number;
}
