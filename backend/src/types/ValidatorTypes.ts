export interface Validator {
	id: number;
	name: string;
	url: string;
	type: string;
	enabled: number;
}

export interface ValidationResult {
	file_hash: string;
	validator_id: number;
	status: 'pending' | 'passed' | 'failed';
	details?: string;
	last_check: number;
}
