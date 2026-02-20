import { BaseApiService } from './BaseApiService';

export interface TelegramUser {
	id: string;
	firstName: string;
	lastName?: string;
	username?: string;
	phone?: string;
}

export interface TelegramStatus {
	status: 'connected' | 'disconnected' | 'waiting_code' | 'waiting_password';
	user?: TelegramUser;
}

export interface TelegramChat {
	id: string;
	title: string;
	type: string;
	indexing_enabled: boolean;
}

export class TelegramApiService extends BaseApiService {
	public constructor() {
		super('/api/telegram');
	}

	async getStatus(): Promise<TelegramStatus> {
		return this.request<TelegramStatus>('/status');
	}

	async startAuth(apiId: number, apiHash: string, phoneNumber: string): Promise<{ error?: string }> {
		return this.request<{ error?: string }>('/auth/start', {
			method: 'POST',
			body: JSON.stringify({ apiId, apiHash, phoneNumber }),
		});
	}

	async submitCode(code: string): Promise<{ error?: string }> {
		return this.request<{ error?: string }>('/auth/code', {
			method: 'POST',
			body: JSON.stringify({ code }),
		});
	}

	async submitPassword(password: string): Promise<{ error?: string }> {
		return this.request<{ error?: string }>('/auth/password', {
			method: 'POST',
			body: JSON.stringify({ password }),
		});
	}

	async logout(): Promise<{ success: boolean }> {
		return this.request<{ success: boolean }>('/logout', {
			method: 'POST',
		});
	}

	async getChats(): Promise<TelegramChat[]> {
		return this.request<TelegramChat[]>('/chats');
	}

	async updateChatIndexing(chatId: string, enabled: boolean): Promise<{ success: boolean }> {
		return this.request<{ success: boolean }>(`/chats/${chatId}/indexing`, {
			method: 'PUT',
			body: JSON.stringify({ enabled }),
		});
	}
}
