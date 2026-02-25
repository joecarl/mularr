import { BaseApiService } from './BaseApiService';

export type ExtensionType = /*'validator' | 'enhanced_search' | 'webhook' |*/ 'telegram_indexer' | 'media_previewer';

export interface Extension {
	id: number;
	name: string;
	url: string;
	type: ExtensionType;
	enabled: number;
}

export const EXTENSION_TYPES: Record<ExtensionType, { label: string; requiresUrl: boolean }> = {
	// validator: { label: 'Validator', requiresUrl: true },
	// enhanced_search: { label: 'Enhanced Search', requiresUrl: false },
	// webhook: { label: 'Webhook', requiresUrl: true },
	telegram_indexer: { label: 'Telegram Indexer', requiresUrl: false },
	media_previewer: { label: 'Media Previewer', requiresUrl: true },
};

export class ExtensionsApiService extends BaseApiService {
	constructor() {
		super('/api/extensions');
	}

	async getExtensions(): Promise<Extension[]> {
		return this.request<Extension[]>('');
	}

	async addExtension(v: Partial<Extension>): Promise<void> {
		return this.request<void>('', {
			method: 'POST',
			body: JSON.stringify(v),
		});
	}

	async deleteExtension(id: number): Promise<void> {
		return this.request<void>(`/${id}`, { method: 'DELETE' });
	}

	async toggleExtension(id: number, enabled: boolean): Promise<void> {
		return this.request<void>(`/${id}/toggle`, {
			method: 'PATCH',
			body: JSON.stringify({ enabled }),
		});
	}
}
