import { BaseApiService } from './BaseApiService';

export interface Validator {
	id: number;
	name: string;
	url: string;
	type: string;
	enabled: number;
}

export class ValidatorsApiService extends BaseApiService {
	constructor() {
		super('/api/validators');
	}

	async getValidators(): Promise<Validator[]> {
		return this.request<Validator[]>('');
	}

	async addValidator(v: Partial<Validator>): Promise<void> {
		return this.request<void>('', {
			method: 'POST',
			body: JSON.stringify(v),
		});
	}

	async deleteValidator(id: number): Promise<void> {
		return this.request<void>(`/${id}`, { method: 'DELETE' });
	}

	async toggleValidator(id: number, enabled: boolean): Promise<void> {
		return this.request<void>(`/${id}/toggle`, {
			method: 'PATCH',
			body: JSON.stringify({ enabled }),
		});
	}
}
