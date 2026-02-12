export type WebhookType = 'Validator' | 'Advanced search';

export interface Webhook {
	id: number;
	name: string;
	url: string;
	type: WebhookType;
	enabled: number;
}

export interface ValidationResult {
	file_hash: string;
	validator_id: number;
	status: 'pending' | 'passed' | 'failed';
	details?: string;
	last_check: number;
}
