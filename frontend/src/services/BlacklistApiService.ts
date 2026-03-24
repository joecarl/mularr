import { BaseApiService } from './BaseApiService';

export interface BlacklistEntry {
	hash: string;
	name: string;
	reason: string | null;
	added_at: string;
}

export interface BlacklistCheckResult {
	blacklisted: boolean;
	entry: BlacklistEntry | null;
}

export class BlacklistApiService extends BaseApiService {
	constructor() {
		super('/api/blacklist');
	}

	async getBlacklist(): Promise<BlacklistEntry[]> {
		return this.request<BlacklistEntry[]>('/');
	}

	async checkBlacklist(hash: string): Promise<BlacklistCheckResult> {
		return this.request<BlacklistCheckResult>(`/${encodeURIComponent(hash)}`);
	}

	async addToBlacklist(hash: string, name: string, reason: string = ''): Promise<{ success: boolean }> {
		return this.request<{ success: boolean }>('/', {
			method: 'POST',
			body: JSON.stringify({ hash, name, reason }),
		});
	}

	async removeFromBlacklist(hash: string): Promise<void> {
		await this.request<void>(`/${encodeURIComponent(hash)}`, { method: 'DELETE' });
	}
}
