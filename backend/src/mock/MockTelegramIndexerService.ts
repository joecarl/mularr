import { Api } from 'telegram';
import { returnBigInt } from 'telegram/Helpers';
import type { JoinQueueRow, MessageRow, TelegramAccount } from '../services/db/TelegramIndexerDB';
import type { DownloadStatus } from '../services/TelegramDownloadManager';
import type { JoinQueueStatus } from '../services/TelegramJoinManager';
import type { AuthStatus, TelegramChatsResponse, TelegramIndexerSearchResult } from '../services/TelegramIndexerService';
import { LoggerFactory } from '../services/logging/Logger';
import * as F from './fixtures';
import { getMockWorld } from './MockWorld';

/** Login code that takes the mock through the 2FA step, for screenshots of the password form. */
const CODE_REQUIRING_PASSWORD = '000000';

/**
 * Stand-in for TelegramIndexerService in MOCK_MODE. Nothing connects to Telegram: the account lives in memory
 * (seeded from fixtures) and its session is "restored" when present, the login flow accepts any code (see
 * CODE_REQUIRING_PASSWORD), the index is MockWorld's message set and downloads progress on their own.
 */
export class MockTelegramIndexerService {
	private readonly logger = LoggerFactory.create(this);
	private readonly world = getMockWorld();
	private account: TelegramAccount = { ...F.TELEGRAM_ACCOUNT };
	private authStatus: AuthStatus = 'disconnected';

	async getAuthStatus() {
		return {
			status: this.authStatus,
			user: this.authStatus === 'connected' ? this.currentUser() : null,
			searchEnabled: this.isSearchEnabled(),
		};
	}

	isSearchEnabled(): boolean {
		return this.account.searchEnabled;
	}

	setSearchEnabled(enabled: boolean): void {
		this.account.searchEnabled = enabled;
	}

	private currentUser(): Api.User {
		const { id, firstName, lastName, username, phone } = F.TELEGRAM_USER;
		return new Api.User({ id: returnBigInt(id), self: true, firstName, lastName, username, phone });
	}

	async start(): Promise<void> {
		if (this.account.session) {
			this.logger.info('Restoring Telegram session from DB (simulated)...');
			this.authStatus = 'connected';
		}
	}

	// ── Auth flow ─────────────────────────────────────────────────────────────

	async startAuth(apiId: number, apiHash: string, _phoneNumber: string): Promise<void> {
		if (this.authStatus === 'connected') throw new Error('Already connected');
		this.authStatus = 'waiting_code';
		this.account = { ...this.account, apiId, apiHash };
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
		this.account.session = 'mock-session';
		this.logger.info('Telegram login successful (simulated)!');
	}

	async logout(): Promise<void> {
		this.authStatus = 'disconnected';
		this.account.session = null;
	}

	// ── Chats ─────────────────────────────────────────────────────────────────

	getDiscoveredChats(): TelegramChatsResponse {
		return this.world.getTelegramChatsOverview();
	}

	setChatIndexing(chatId: string, enabled: boolean): void {
		const chat = this.world.telegramChats.find((c) => c.id === chatId);
		if (!chat) return;
		chat.indexing_enabled = enabled ? 1 : 0;
		if (enabled) this.world.requestTelegramIndexing(chatId);
	}

	requestIndexing(chatId: string): void {
		const chat = this.world.telegramChats.find((c) => c.id === chatId);
		if (!chat?.indexing_enabled) throw new Error('Indexing is disabled for this chat');
		this.world.requestTelegramIndexing(chatId);
	}

	clearChatIndex(chatId: string): void {
		this.world.clearTelegramChatIndex(chatId);
	}

	deleteChat(chatId: string): void {
		this.world.deleteTelegramChat(chatId);
	}

	// ── Join queue ────────────────────────────────────────────────────────────

	getJoinQueue(): JoinQueueStatus {
		return this.world.getTelegramJoinQueue();
	}

	addJoinLinks(links: string[], indexOnJoin: boolean): { added: JoinQueueRow[]; invalid: string[] } {
		return this.world.enqueueTelegramJoins(links, indexOnJoin);
	}

	retryJoin(id: number): void {
		this.world.retryTelegramJoin(id);
	}

	removeJoin(id: number): void {
		this.world.removeTelegramJoin(id);
	}

	clearFinishedJoins(): number {
		return this.world.clearFinishedTelegramJoins();
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

	/** Like the real one, empty while search is disabled; `cursorId` is an offset into the result set. */
	async search(query: string, limit: number = 50, cursorId: number = 0): Promise<{ results: TelegramIndexerSearchResult[]; nextCursor: number | null }> {
		if (!this.isSearchEnabled() || this.authStatus !== 'connected') return { results: [], nextCursor: null };
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
