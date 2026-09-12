import { Api } from 'telegram';
import { returnBigInt } from 'telegram/Helpers';
import { container } from '../services/container/ServiceContainer';
import { MainDB } from '../services/db/MainDB';
import type { Chat, MessageRow } from '../services/db/TelegramIndexerDB';
import type { DownloadStatus } from '../services/TelegramDownloadManager';
import type { AuthStatus, TelegramIndexerSearchResult } from '../services/TelegramIndexerService';
import { LoggerFactory } from '../services/logging/Logger';
import * as F from './fixtures';
import { getMockWorld } from './MockWorld';

/** Login code that takes the mock through the 2FA step, for screenshots of the password form. */
const CODE_REQUIRING_PASSWORD = '000000';

/**
 * Stand-in for TelegramIndexerService in MOCK_MODE. Nothing connects to Telegram: the session is "restored"
 * when the extension config holds one, the login flow accepts any code (see CODE_REQUIRING_PASSWORD), the
 * index is MockWorld's message set and downloads progress on their own.
 */
export class MockTelegramIndexerService {
	private readonly logger = LoggerFactory.create(this);
	private readonly world = getMockWorld();
	private readonly mainDb = container.get(MainDB);
	private authStatus: AuthStatus = 'disconnected';

	async getAuthStatus() {
		return {
			status: this.authStatus,
			user: this.authStatus === 'connected' ? this.currentUser() : null,
		};
	}

	private currentUser(): Api.User {
		const { id, firstName, lastName, username, phone } = F.TELEGRAM_USER;
		return new Api.User({ id: returnBigInt(id), self: true, firstName, lastName, username, phone });
	}

	async start(): Promise<void> {
		if (this.getExtensionConfig().session) {
			this.logger.info('Restoring Telegram session from DB (simulated)...');
			this.authStatus = 'connected';
		}
	}

	private getExtensionConfig(): any {
		const ext = this.mainDb.getExtensionByType('telegram_indexer');
		if (!ext?.config) return {};
		try {
			return JSON.parse(ext.config);
		} catch {
			return {};
		}
	}

	private saveExtensionConfig(newConfig: any): void {
		let ext = this.mainDb.getExtensionByType('telegram_indexer');
		if (!ext) {
			const id = this.mainDb.addExtension({ name: 'Telegram Integration', url: 'local', type: 'telegram_indexer', enabled: 1, config: '{}' });
			ext = this.mainDb.getExtensionById(Number(id));
		}
		if (!ext) return;
		this.mainDb.updateExtensionConfig(ext.id, JSON.stringify({ ...this.getExtensionConfig(), ...newConfig }));
	}

	// ── Auth flow ─────────────────────────────────────────────────────────────

	async startAuth(apiId: number, apiHash: string, _phoneNumber: string): Promise<void> {
		if (this.authStatus === 'connected') throw new Error('Already connected');
		this.authStatus = 'waiting_code';
		this.saveExtensionConfig({ apiId, apiHash });
	}

	async submitCode(code: string): Promise<void> {
		if (this.authStatus !== 'waiting_code') throw new Error('Not waiting for code');
		if (code.trim() === CODE_REQUIRING_PASSWORD) {
			this.authStatus = 'waiting_password';
			throw new Error('SESSION_PASSWORD_NEEDED');
		}
		this.onLoginSuccess();
	}

	async submitPassword(_password: string): Promise<void> {
		if (this.authStatus !== 'waiting_password') throw new Error('Not waiting for password');
		this.onLoginSuccess();
	}

	private onLoginSuccess(): void {
		this.authStatus = 'connected';
		this.saveExtensionConfig({ session: 'mock-session' });
		this.logger.info('Telegram login successful (simulated)!');
	}

	async logout(): Promise<void> {
		this.authStatus = 'disconnected';
		this.saveExtensionConfig({ session: null });
	}

	// ── Chats ─────────────────────────────────────────────────────────────────

	getDiscoveredChats(): Chat[] {
		return this.world.telegramChats.map((c) => ({ ...c }));
	}

	setChatIndexing(chatId: string, enabled: boolean): void {
		const chat = this.world.telegramChats.find((c) => c.id === chatId);
		if (chat) chat.indexing_enabled = enabled ? 1 : 0;
	}

	// ── Downloads ─────────────────────────────────────────────────────────────

	getDownloadStatus(hash: string): DownloadStatus | undefined {
		return this.world.getTelegramDownload(hash);
	}

	async startDownload(chatId: string, messageId: number, hash: string): Promise<boolean> {
		const message = this.world.getTelegramMessage(chatId, messageId);
		if (!message) return false;
		this.world.startTelegramDownload(hash, message);
		return true;
	}

	pauseDownload(hash: string): void {
		this.world.setTelegramDownloadStatus(hash, 'paused');
	}

	resumeDownload(hash: string): void {
		this.world.setTelegramDownloadStatus(hash, 'downloading');
	}

	cancelDownload(hash: string): void {
		this.world.cancelTelegramDownload(hash);
	}

	getFileInfo(chatId: string, messageId: number): MessageRow | undefined {
		return this.world.getTelegramMessage(chatId, messageId);
	}

	getChatTitle(chatId: string): string | undefined {
		return this.world.telegramChats.find((c) => c.id === chatId)?.title;
	}

	// ── Search ────────────────────────────────────────────────────────────────

	/** Like the real one, empty while the extension is disabled; `cursorId` is an offset into the result set. */
	async search(query: string, limit: number = 50, cursorId: number = 0): Promise<{ results: TelegramIndexerSearchResult[]; nextCursor: number | null }> {
		const ext = this.mainDb.getExtensionByType('telegram_indexer');
		if (!ext || !ext.enabled || this.authStatus !== 'connected') return { results: [], nextCursor: null };
		const rows = this.world.searchTelegram(query);
		const page = rows.slice(cursorId, cursorId + limit);
		const results = page.map((msg) => ({
			name: msg.file_name || 'Unknown',
			size: msg.file_size || 0,
			hash: `telegram:${msg.chat_id}:${msg.message_id}`,
			chatId: msg.chat_id,
			chatTitle: msg.chat_title || undefined,
			topicName: msg.topic_name || undefined,
			messageId: msg.message_id,
			type: msg.media_type || '',
		}));
		return { results, nextCursor: cursorId + limit < rows.length ? cursorId + limit : null };
	}
}
