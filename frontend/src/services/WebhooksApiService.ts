import { BaseApiService } from './BaseApiService';

export type WebhookType = 'Validator' | 'Advanced search';

export interface Webhook {
	id: number;
	name: string;
	url: string;
	type: WebhookType;
	enabled: number;
}

export class WebhooksApiService extends BaseApiService {
	constructor() {
		super('/api/webhooks');
	}

	async getWebhooks(): Promise<Webhook[]> {
		return this.request<Webhook[]>('');
	}

	async addWebhook(v: Partial<Webhook>): Promise<void> {
		return this.request<void>('', {
			method: 'POST',
			body: JSON.stringify(v),
		});
	}

	async deleteWebhook(id: number): Promise<void> {
		return this.request<void>(`/${id}`, { method: 'DELETE' });
	}

	async toggleWebhook(id: number, enabled: boolean): Promise<void> {
		return this.request<void>(`/${id}/toggle`, {
			method: 'PATCH',
			body: JSON.stringify({ enabled }),
		});
	}
}
