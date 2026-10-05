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
	/** Whether searches reach the Telegram index; independent of being signed in. */
	searchEnabled: boolean;
}

/** A chat of the account with what the index holds for it. Every `_at` is epoch ms. */
export interface TelegramChat {
	id: string;
	title: string;
	type: string;
	indexing_enabled: boolean;
	/** A pass over this chat is running right now. */
	indexing_now: boolean;
	/** Indexed messages (text or media). */
	message_count: number;
	/** Indexed messages carrying a file. */
	media_count: number;
	/** Sum of the indexed file sizes, in bytes. */
	media_size: number;
	/** Forum topics known for the chat (0 for non-forum chats). */
	topic_count: number;
	last_message_id: number;
	/** Date of the newest indexed message; null while nothing is indexed. */
	last_message_at: number | null;
	/** End of the last indexing pass; null if the chat was never visited. */
	last_checked_at: number | null;
	/** Last pass that stored new messages; null if none did. */
	last_indexed_at: number | null;
	/** Error that ended the last pass; null when it went fine. */
	last_error: string | null;
}

/** Where the periodic indexing cycle stands. Times are epoch ms. */
export interface TelegramIndexingCycle {
	running: boolean;
	currentChatId: string | null;
	lastRunAt: number | null;
	/** When the next cycle is due; null while one runs or nothing is scheduled. */
	nextRunAt: number | null;
}

export interface TelegramChatsResponse {
	chats: TelegramChat[];
	cycle: TelegramIndexingCycle;
}

/**
 * Where a queued join stands: `pending` waits for its turn (maybe until `next_attempt_at`), `joined` is done
 * (also when the account already was a member), `request_sent` needs an admin to approve it, `failed` is final
 * until retried.
 */
export type TelegramJoinStatus = 'pending' | 'joined' | 'request_sent' | 'failed';

/** A channel link the account was asked to join in the background. Every `_at` is epoch ms. */
export interface TelegramJoinItem {
	id: number;
	/** The link as it was given. */
	link: string;
	/** Normalized form (`@name` or `+hash`), unique in the queue. */
	target: string;
	status: TelegramJoinStatus;
	/** Whether indexing is enabled for the chat once joined. */
	index_on_join: boolean;
	chat_id: string | null;
	chat_title: string | null;
	/** Why the last attempt failed or was deferred; null when nothing went wrong so far. */
	error: string | null;
	attempts: number;
	added_at: number;
	attempted_at: number | null;
	/** When a pending link is tried again (after a flood wait or a transient failure); null means as soon as its turn comes. */
	next_attempt_at: number | null;
}

export interface TelegramJoinQueueResponse {
	items: TelegramJoinItem[];
	/** The link being joined right now, null between attempts. */
	joiningId: number | null;
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

	async setSearchEnabled(enabled: boolean): Promise<{ success: boolean }> {
		return this.request<{ success: boolean }>('/search-enabled', {
			method: 'PUT',
			body: JSON.stringify({ enabled }),
		});
	}

	async getChats(): Promise<TelegramChatsResponse> {
		return this.request<TelegramChatsResponse>('/chats');
	}

	/** Indexes the chat now instead of waiting for the next cycle (it must be enabled). */
	async indexChatNow(chatId: string): Promise<{ success: boolean }> {
		return this.request<{ success: boolean }>(`/chats/${chatId}/index`, { method: 'POST' });
	}

	async updateChatIndexing(chatId: string, enabled: boolean): Promise<{ success: boolean }> {
		return this.request<{ success: boolean }>(`/chats/${chatId}/indexing`, {
			method: 'PUT',
			body: JSON.stringify({ enabled }),
		});
	}

	/** Drops everything indexed for the chat; the chat and its indexing flag stay (an enabled chat is indexed again from scratch). */
	async clearChatIndex(chatId: string): Promise<{ success: boolean }> {
		return this.request<{ success: boolean }>(`/chats/${chatId}/index`, { method: 'DELETE' });
	}

	/** Removes the chat with its index; it comes back as ignored after the next cycle while the account still has it. */
	async deleteChat(chatId: string): Promise<{ success: boolean }> {
		return this.request<{ success: boolean }>(`/chats/${chatId}`, { method: 'DELETE' });
	}

	async getJoinQueue(): Promise<TelegramJoinQueueResponse> {
		return this.request<TelegramJoinQueueResponse>('/join-queue');
	}

	/** Queues channel links to join one by one in the background; `invalid` holds the lines that were not understood. */
	async addJoinLinks(links: string[], indexOnJoin: boolean): Promise<{ added: number; invalid: string[] }> {
		return this.request<{ added: number; invalid: string[] }>('/join-queue', {
			method: 'POST',
			body: JSON.stringify({ links, indexOnJoin }),
		});
	}

	/** Puts a failed (or request-sent) link back in the queue. */
	async retryJoin(id: number): Promise<{ success: boolean }> {
		return this.request<{ success: boolean }>(`/join-queue/${id}/retry`, { method: 'POST' });
	}

	async removeJoin(id: number): Promise<{ success: boolean }> {
		return this.request<{ success: boolean }>(`/join-queue/${id}`, { method: 'DELETE' });
	}

	/** Drops every link that is joined, failed or awaiting approval. */
	async clearFinishedJoins(): Promise<{ removed: number }> {
		return this.request<{ removed: number }>('/join-queue/finished', { method: 'DELETE' });
	}
}
