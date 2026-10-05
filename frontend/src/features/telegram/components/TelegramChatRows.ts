import { componentList, computed, inject, type Signal } from 'chispa';
import type { TelegramChat } from '../../../services/TelegramApiService';
import { ContextMenuService, type ContextMenuItem } from '../../../services/ContextMenuService';
import type { ListManager } from '../../../utils/ListManager';
import { fbytes, relativeTime } from '../../../utils/formats';
import tpl from './TelegramChatsTable.html';
import './TelegramChatsTable.css';

// Chats have no natural hash, so synthesize one for ListManager (as the servers table does)
export type ChatItem = TelegramChat & { hash: string };
export type ChatColumn = keyof ChatItem;
export const toChatItems = (list: TelegramChat[]): ChatItem[] => list.map((c) => ({ ...c, hash: c.id }));

export interface ChatRowProps {
	now: Signal<number>;
	mgr: ListManager<ChatItem, ChatColumn>;
	onToggleChat: (chat: TelegramChat) => void;
	onIndexNow: (chat: TelegramChat) => void;
	/**
	 * The row menu (right click or the ⋯ button): every action, including the destructive ones, over the
	 * selected chats. `clicked` is the row that opened the menu, always among `targets`.
	 */
	menuItems: (targets: ChatItem[], clicked: ChatItem) => ContextMenuItem[];
}

const fullDate = (at: number | null) => (at ? new Date(at).toLocaleString() : '');

/** One row per chat: counters, status, the per-row buttons and the selection/menu handlers. */
export const ChatRows = componentList<ChatItem, ChatRowProps>(
	(c, i, l, props) => {
		const { now, mgr, onToggleChat, onIndexNow, menuItems } = props!;
		const ctxMenu = inject(ContextMenuService);
		const isSelected = computed(() => mgr.selectedHashes.get().has(c.get().hash));
		// An invalid chat (no longer in the account) shows as such; it is always disabled by then
		const statusText = () => {
			const chat = c.get();
			if (chat.indexing_now) return 'Indexing now…';
			if (chat.invalid) return 'Not in account';
			return chat.indexing_enabled ? 'Indexing' : 'Ignored';
		};
		const statusClasses = {
			'is-running': () => c.get().indexing_now,
			'is-indexing': () => !c.get().indexing_now && c.get().indexing_enabled,
			'is-ignored': () => !c.get().indexing_enabled,
		};
		const toggleText = () => (c.get().indexing_enabled ? 'Disable' : 'Enable');
		const lastMessage = () => (c.get().last_message_at ? relativeTime(c.get().last_message_at!, now.get()) : '-');
		const lastChecked = () => {
			const chat = c.get();
			if (chat.indexing_now) return 'now';
			return chat.last_checked_at ? relativeTime(chat.last_checked_at, now.get()) : 'never';
		};
		// Row buttons act on their own chat only, so their clicks must not reach the row selection handler
		const stopRow = (e: MouseEvent) => e.stopPropagation();
		// The index button only makes sense for enabled chats, and not while a pass over the chat runs
		const indexBtn = {
			onclick: (e: MouseEvent) => {
				stopRow(e);
				onIndexNow(c.get());
			},
			disabled: () => c.get().indexing_now,
			style: { display: () => (c.get().indexing_enabled ? '' : 'none') },
		};
		const toggleBtn = {
			inner: toggleText,
			onclick: (e: MouseEvent) => {
				stopRow(e);
				onToggleChat(c.get());
			},
		};
		// Like a right click: the menu covers the whole selection when the row is part of it, else this row alone
		const showMenu = (e: MouseEvent) => {
			mgr.handleContextMenuSelection(e, c.get().hash, l.get());
			const selected = mgr.selectedHashes.get();
			const targets = l.get().filter((x) => selected.has(x.hash));
			ctxMenu.show(e, menuItems(targets, c.get()));
		};
		const menuBtn = { onclick: showMenu };

		return tpl.chatRow({
			classes: { selected: isSelected },
			onclick: (e: MouseEvent) => mgr.handleRowSelection(e, c.get().hash, l.get()),
			oncontextmenu: showMenu,
			nodes: {
				chatNameText: { inner: () => c.get().title, title: () => `${c.get().title} (${c.get().id})` },
				mobType: { inner: () => c.get().type },
				mobCounts: {
					inner: () => {
						const chat = c.get();
						return `${chat.message_count.toLocaleString()} msgs · ${chat.media_count.toLocaleString()} files · ${fbytes(chat.media_size)}`;
					},
				},
				mobChecked: { inner: () => `Checked ${lastChecked()}` },
				mobError: {
					inner: () => c.get().last_error ?? '',
					style: { display: () => (c.get().last_error ? '' : 'none') },
				},
				mobStatusBadge: { inner: statusText, classes: statusClasses },
				mobIndexBtn: indexBtn,
				mobToggleBtn: toggleBtn,

				typeCol: { inner: () => c.get().type },
				statusBadge: { inner: statusText, classes: statusClasses },
				messagesCol: { inner: () => c.get().message_count.toLocaleString() },
				filesCol: { inner: () => c.get().media_count.toLocaleString() },
				sizeCol: { inner: () => (c.get().media_size > 0 ? fbytes(c.get().media_size) : '-') },
				topicsCol: { inner: () => (c.get().topic_count > 0 ? String(c.get().topic_count) : '-') },
				lastMessageCol: { inner: lastMessage, title: () => fullDate(c.get().last_message_at) },
				lastCheckedCol: {
					inner: lastChecked,
					title: () => {
						const chat = c.get();
						const checked = fullDate(chat.last_checked_at);
						const indexed = chat.last_indexed_at ? `New messages: ${fullDate(chat.last_indexed_at)}` : 'No new messages so far';
						return checked ? `${checked}\n${indexed}` : '';
					},
				},
				errorCol: { inner: () => c.get().last_error ?? '', title: () => c.get().last_error ?? '' },
				indexBtn,
				toggleBtn,
			},
		});
	},
	(c) => c.hash
);
