import { Api, TelegramClient, utils } from 'telegram';
import { FloodWaitError, RPCError } from 'telegram/errors';
import { JoinQueueRow, TelegramIndexerDB } from './db/TelegramIndexerDB';
import { AuthStatus } from './TelegramIndexerService';
import { LoggerFactory } from './logging/Logger';

/**
 * Pause between two attempts, on top of whatever FLOOD_WAIT Telegram asks for: joining in quick succession
 * is what earns the account long flood waits, so the queue is deliberately slow.
 */
const JOIN_INTERVAL_MS = 30 * 1000;
/** Retry delay after a failure that looks transient (network, server error). */
const TRANSIENT_RETRY_MS = 5 * 60 * 1000;
/** A link that keeps failing transiently is given up on after this many attempts. */
const MAX_TRANSIENT_ATTEMPTS = 5;
/** Retry delay when the queue is due but the client is momentarily disconnected. */
const RECONNECT_RETRY_MS = 60 * 1000;

/** Telegram errors that end an attempt for good, with the text the user sees. Anything else RPC is reported verbatim. */
const FINAL_RPC_ERRORS: Record<string, string> = {
	CHANNELS_TOO_MUCH: 'The account has joined too many channels and groups (Telegram limit)',
	INVITE_HASH_EXPIRED: 'The invite link has expired',
	INVITE_HASH_INVALID: 'The invite link is not valid',
	INVITE_HASH_EMPTY: 'The invite link is not valid',
	USERNAME_NOT_OCCUPIED: 'No channel or group has this username',
	USERNAME_INVALID: 'The username is not valid',
	CHANNEL_PRIVATE: 'The channel is private: an invite link is needed',
	CHANNEL_INVALID: 'The channel is not valid',
	USERS_TOO_MUCH: 'The group is full',
	INVITE_REQUEST_SENT: 'A join request was sent and needs an admin to approve it',
};

export type JoinTarget = { kind: 'username'; value: string; target: string } | { kind: 'invite'; value: string; target: string };

/**
 * What a user may paste: `@name`, a bare username, `t.me/name` (also telegram.me/.dog, with or without
 * scheme, `/s/` previews and message links), invites as `t.me/+hash`, `t.me/joinchat/hash` or
 * `tg://join?invite=hash`, and `tg://resolve?domain=name`. Returns null for anything else, including
 * `t.me/c/...` links (private chats by id, which cannot be joined) and links to users.
 */
export function parseJoinLink(raw: string): JoinTarget | null {
	const text = raw.trim();
	if (!text) return null;

	const invite = (hash: string): JoinTarget | null => (/^[A-Za-z0-9_-]{8,}$/.test(hash) ? { kind: 'invite', value: hash, target: `+${hash}` } : null);
	const username = (name: string): JoinTarget | null => {
		const clean = name.replace(/^@/, '');
		if (!/^[a-z][a-z0-9_]{2,30}[a-z0-9]$/i.test(clean) || clean.includes('__')) return null;
		return { kind: 'username', value: clean.toLowerCase(), target: `@${clean.toLowerCase()}` };
	};

	let m = text.match(/^tg:\/\/join\?invite=([^&#]+)$/i);
	if (m) return invite(m[1]);
	m = text.match(/^tg:\/\/resolve\?domain=([^&#]+)/i);
	if (m) return username(m[1]);

	m = text.match(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/(.+)$/i);
	if (m) {
		const path = m[1].split(/[?#]/)[0].replace(/\/+$/, '');
		if (path.startsWith('+')) return invite(path.slice(1));
		if (path.toLowerCase().startsWith('joinchat/')) return invite(path.slice('joinchat/'.length));
		if (path.toLowerCase().startsWith('c/')) return null;
		const first = path.toLowerCase().startsWith('s/') ? path.slice(2) : path;
		return username(first.split('/')[0]);
	}
	if (text.includes('/') || text.includes('.')) return null;
	return username(text);
}

/** Describes the target behind a stored `JoinQueueRow.target`, the inverse of parseJoinLink's normalization. */
function targetOf(row: JoinQueueRow): JoinTarget {
	return row.target.startsWith('+')
		? { kind: 'invite', value: row.target.slice(1), target: row.target }
		: { kind: 'username', value: row.target.slice(1), target: row.target };
}

/** A chat the account got into, as the indexer registers it. */
export interface JoinedChat {
	/** Marked peer id, the same the dialogs list yields ("-100..." for channels). */
	id: string;
	title: string;
	type: 'channel' | 'group';
	/** Public username (lowercase, no @), null for private chats. See Chat.username. */
	username: string | null;
}

/** The public username of a channel or group entity (lowercase, no @): the main one, else the first active alias; null without one. */
export function usernameOf(entity: unknown): string | null {
	if (!(entity instanceof Api.Channel)) return null; // basic groups (Api.Chat) have no username
	const name = entity.username ?? entity.usernames?.find((u) => u.active)?.username ?? entity.usernames?.[0]?.username;
	return name ? name.toLowerCase() : null;
}

/** The queue as the UI shows it. */
export interface JoinQueueStatus {
	items: JoinQueueRow[];
	/** The link being joined at this very moment, null between attempts. */
	joiningId: number | null;
}

type AttemptOutcome = { status: 'joined'; chat: JoinedChat; alreadyMember: boolean } | { status: 'request_sent'; title: string | null };

/** Formats a FLOOD_WAIT delay for the queue note. */
function describeWait(seconds: number): string {
	if (seconds < 90) return `${seconds} s`;
	if (seconds < 90 * 60) return `${Math.round(seconds / 60)} min`;
	return `${Math.round(seconds / 3600)} h`;
}

/**
 * Joins channels and groups from the links queued in the indexer DB, one at a time and in the background:
 * a pause between attempts, and on FLOOD_WAIT the wait Telegram asks for before going on. The queue
 * survives restarts (it is a table) and works while the account is signed in; sign-in resumes it.
 */
export class TelegramJoinManager {
	private readonly logger = LoggerFactory.create(this);
	private timer: NodeJS.Timeout | null = null;
	/** An attempt is in progress; the loop reschedules itself when it ends. */
	private busy = false;
	private joiningId: number | null = null;

	constructor(
		private readonly getClient: () => TelegramClient | null,
		private readonly getAuthStatus: () => AuthStatus,
		private readonly db: TelegramIndexerDB,
		/** Called once the account is in the chat (also when it already was), so the indexer registers it. */
		private readonly onJoined: (chat: JoinedChat, indexOnJoin: boolean) => void
	) {}

	public getStatus(): JoinQueueStatus {
		return { items: this.db.getJoinQueue(), joiningId: this.joiningId };
	}

	/**
	 * Queues the links that parse (see parseJoinLink) and wakes the worker. A public link whose chat the
	 * account already has (a valid chat with that username, as the indexing cycle recorded it) is skipped
	 * without touching Telegram (`alreadyJoined`); invite links cannot be checked without asking, so they
	 * are queued and the worker finds out. A link whose chat is already queued or joined is left as it is; a failed one goes
	 * back to pending. Returns what was queued, the links skipped and the lines that were not understood.
	 */
	public addJoinLinks(links: string[], indexOnJoin: boolean): { added: JoinQueueRow[]; alreadyJoined: string[]; invalid: string[] } {
		const added: JoinQueueRow[] = [];
		const alreadyJoined: string[] = [];
		const invalid: string[] = [];
		const now = Date.now();
		for (const raw of links) {
			const link = raw.trim();
			if (!link) continue;
			const target = parseJoinLink(link);
			if (!target) {
				invalid.push(link);
				continue;
			}
			if (target.kind === 'username' && this.db.getValidChatIdByUsername(target.value)) {
				alreadyJoined.push(link);
				continue;
			}
			added.push(this.db.enqueueJoin(link, target.target, indexOnJoin, now));
		}
		if (alreadyJoined.length > 0) this.logger.info(`Skipped ${alreadyJoined.length} channel links the account is already a member of`);
		if (added.length > 0) {
			this.logger.info(`Queued ${added.length} channel links to join`);
			this.wake();
		}
		return { added, alreadyJoined, invalid };
	}

	/** Puts a failed (or request-sent) link back in the queue. */
	public retry(id: number) {
		if (!this.db.getJoinQueueRow(id)) throw new Error('The link is not in the queue');
		this.db.resetJoin(id);
		this.wake();
	}

	public remove(id: number) {
		if (this.joiningId === id) throw new Error('The link is being joined right now, try again in a moment');
		this.db.deleteJoin(id);
	}

	/** Drops every link the worker is done with; returns how many went. */
	public clearFinished(): number {
		return this.db.deleteFinishedJoins();
	}

	/** Starts (or resumes) working the queue; call once the client is signed in. */
	public resume() {
		this.wake();
	}

	/** Stops scheduling attempts; a running one ends on its own. Call on sign-out. */
	public stop() {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
	}

	/** Arms the loop to run after `delayMs`, replacing any pending timer. A running attempt reschedules itself. */
	private wake(delayMs = 0) {
		if (this.busy) return;
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => this.processNext(), delayMs);
	}

	private async processNext() {
		this.timer = null;
		if (this.busy) return;
		const client = this.getClient();
		// Signed out: nothing to do until the next sign-in resumes the queue
		if (!client || this.getAuthStatus() !== 'connected') return;
		if (!client.connected) {
			this.wake(RECONNECT_RETRY_MS);
			return;
		}

		const now = Date.now();
		const row = this.db.getNextPendingJoin(now);
		if (!row) {
			// Nothing due: sleep until the earliest deferred link, if any
			const at = this.db.getEarliestPendingJoinAt();
			if (at !== null) this.wake(Math.max(0, at - now));
			return;
		}

		this.busy = true;
		this.joiningId = row.id;
		try {
			await this.attempt(client, row);
		} finally {
			this.busy = false;
			this.joiningId = null;
			this.wake(JOIN_INTERVAL_MS);
		}
	}

	/** One attempt over the link; every outcome, including errors, is recorded on the row. */
	private async attempt(client: TelegramClient, row: JoinQueueRow) {
		const target = targetOf(row);
		const now = Date.now();
		this.logger.info(`Joining ${row.link} (attempt ${row.attempts + 1})`);
		try {
			const outcome = target.kind === 'invite' ? await this.joinByInvite(client, target.value) : await this.joinByUsername(client, target.value);
			if (outcome.status === 'joined') {
				const { chat } = outcome;
				this.db.recordJoinAttempt(row.id, now, { status: 'joined', chat_id: chat.id, chat_title: chat.title, error: null, next_attempt_at: null });
				this.logger.info(`${outcome.alreadyMember ? 'Already a member of' : 'Joined'} ${chat.title} (${chat.id})`);
				this.onJoined(chat, row.index_on_join === 1);
			} else {
				this.db.recordJoinAttempt(row.id, now, { status: 'request_sent', chat_title: outcome.title, error: null, next_attempt_at: null });
				this.logger.info(`Join request sent for ${row.link}; an admin has to approve it`);
			}
		} catch (err) {
			if (err instanceof FloodWaitError) {
				const retryAt = now + (err.seconds + 1) * 1000;
				this.logger.warn(`FLOOD_WAIT joining ${row.link}: waiting ${err.seconds}s before the next attempt`);
				this.db.recordJoinAttempt(row.id, now, { error: `Telegram asked to wait ${describeWait(err.seconds)}`, next_attempt_at: retryAt });
				return;
			}
			if (err instanceof RPCError) {
				if (err.errorMessage === 'INVITE_REQUEST_SENT') {
					this.db.recordJoinAttempt(row.id, now, { status: 'request_sent', error: null, next_attempt_at: null });
					this.logger.info(`Join request sent for ${row.link}; an admin has to approve it`);
					return;
				}
				const message = FINAL_RPC_ERRORS[err.errorMessage] ?? `Telegram refused the request: ${err.errorMessage}`;
				this.logger.warn(`Could not join ${row.link}: ${err.errorMessage}`);
				this.db.recordJoinAttempt(row.id, now, { status: 'failed', error: message, next_attempt_at: null });
				return;
			}
			// Anything else (network, unexpected shape) is retried a few times before giving up
			const message = err instanceof Error ? err.message : String(err);
			const attempts = row.attempts + 1;
			this.logger.error(`Error joining ${row.link} (attempt ${attempts}):`, err);
			if (attempts >= MAX_TRANSIENT_ATTEMPTS) {
				this.db.recordJoinAttempt(row.id, now, { status: 'failed', error: `Gave up after ${attempts} attempts: ${message}`, next_attempt_at: null });
			} else {
				this.db.recordJoinAttempt(row.id, now, { error: `${message} (retrying)`, next_attempt_at: now + TRANSIENT_RETRY_MS });
			}
		}
	}

	/** Public channel or supergroup by username: resolve it, then join unless the account is already in. */
	private async joinByUsername(client: TelegramClient, username: string): Promise<AttemptOutcome> {
		const resolved = await client.invoke(new Api.contacts.ResolveUsername({ username }));
		if (resolved.peer instanceof Api.PeerUser) throw new Error('The link points to a user, not to a channel or group');
		const channel = resolved.chats.find((c): c is Api.Channel => c instanceof Api.Channel);
		if (!channel) throw new Error('The link does not point to a channel or group');
		if (!channel.left) return { status: 'joined', chat: toJoinedChat(channel), alreadyMember: true };

		const updates = await client.invoke(new Api.channels.JoinChannel({ channel: utils.getInputChannel(channel) }));
		return { status: 'joined', chat: toJoinedChat(chatFromUpdates(updates) ?? channel), alreadyMember: false };
	}

	/**
	 * Private invite: check it first (it tells whether the account is already in, and the chat title),
	 * then import it. A chat that approves joins makes the import throw INVITE_REQUEST_SENT, handled by the caller.
	 */
	private async joinByInvite(client: TelegramClient, hash: string): Promise<AttemptOutcome> {
		const invite = await client.invoke(new Api.messages.CheckChatInvite({ hash }));
		if (invite instanceof Api.ChatInviteAlready) return { status: 'joined', chat: toJoinedChat(invite.chat), alreadyMember: true };
		const title = invite instanceof Api.ChatInvite ? invite.title : null;
		try {
			const updates = await client.invoke(new Api.messages.ImportChatInvite({ hash }));
			const chat = chatFromUpdates(updates);
			if (!chat) throw new Error('Telegram did not return the joined chat');
			return { status: 'joined', chat: toJoinedChat(chat), alreadyMember: false };
		} catch (err) {
			// Joined meanwhile (e.g. an earlier attempt that timed out on our side): take the chat from the invite check
			if (err instanceof RPCError && err.errorMessage === 'USER_ALREADY_PARTICIPANT') {
				const again = await client.invoke(new Api.messages.CheckChatInvite({ hash }));
				if (again instanceof Api.ChatInviteAlready) return { status: 'joined', chat: toJoinedChat(again.chat), alreadyMember: true };
				throw new Error(`Already a member of ${title ?? 'the chat'}, but Telegram did not return it`);
			}
			throw err;
		}
	}
}

/** The channel or group an Updates result carries, if any. */
function chatFromUpdates(updates: Api.TypeUpdates): Api.TypeChat | undefined {
	if (!(updates instanceof Api.Updates) && !(updates instanceof Api.UpdatesCombined)) return undefined;
	return updates.chats.find((c) => c instanceof Api.Channel || c instanceof Api.Chat);
}

/** Types the chat as the indexer's dialogs pass does: broadcast channels are 'channel', everything else 'group'. */
function toJoinedChat(chat: Api.TypeChat): JoinedChat {
	const title = 'title' in chat && typeof chat.title === 'string' ? chat.title : utils.getPeerId(chat);
	const type = chat instanceof Api.Channel && !chat.megagroup ? 'channel' : 'group';
	return { id: utils.getPeerId(chat), title, type, username: usernameOf(chat) };
}
