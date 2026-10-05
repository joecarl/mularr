import { component, componentList, computed, inject, signal, type Signal } from 'chispa';
import { TelegramApiService, type TelegramJoinItem, type TelegramJoinQueueResponse } from '../../../services/TelegramApiService';
import { DialogService } from '../../../services/DialogService';
import { relativeTime } from '../../../utils/formats';
import { smartLoad, smartPoll } from '../../../utils/scheduling';
import { JoinChannelsDialog } from './JoinChannelsDialog';
import tpl from './TelegramJoinQueue.html';
import './TelegramJoinQueue.css';

/** The queue is re-read this often, so links move from queued to joined on their own. */
const QUEUE_POLL_MS = 5_000;

export interface TelegramJoinQueueProps {
	/** Receives the message of a failed action (add, retry, remove, clear), for the host to display. */
	onError: (message: string) => void;
}

interface QueueRowProps {
	now: Signal<number>;
	joiningId: Signal<number | null>;
	onRetry: (item: TelegramJoinItem) => void;
	onRemove: (item: TelegramJoinItem) => void;
}

const fullDate = (at: number | null) => (at ? new Date(at).toLocaleString() : '');

/** Whether a pending link is on hold until `next_attempt_at` (flood wait or a transient failure). */
const isWaiting = (item: TelegramJoinItem, now: number) => item.status === 'pending' && !!item.next_attempt_at && item.next_attempt_at > now;

/** One row per queued link: its status, the chat once known, what went wrong, and Retry/Remove. */
const QueueRows = componentList<TelegramJoinItem, QueueRowProps>(
	(item, i, l, props) => {
		const { now, joiningId, onRetry, onRemove } = props!;
		const joining = () => joiningId.get() === item.get().id;
		const statusText = () => {
			const it = item.get();
			switch (it.status) {
				case 'pending':
					return joining() ? 'Joining…' : isWaiting(it, now.get()) ? 'Waiting' : 'Queued';
				case 'joined':
					return 'Joined';
				case 'request_sent':
					return 'Request sent';
				case 'failed':
					return 'Failed';
			}
		};
		const statusClasses = {
			'is-joining': joining,
			'is-waiting': () => !joining() && isWaiting(item.get(), now.get()),
			'is-queued': () => !joining() && item.get().status === 'pending' && !isWaiting(item.get(), now.get()),
			'is-joined': () => item.get().status === 'joined',
			'is-request': () => item.get().status === 'request_sent',
			'is-failed': () => item.get().status === 'failed',
		};
		const detailsText = () => {
			const it = item.get();
			if (it.status === 'request_sent') return 'Waiting for an admin to approve the join request';
			if (it.status === 'joined') return it.index_on_join ? 'Indexing enabled' : 'Joined, indexing left off';
			if (isWaiting(it, now.get())) return `${it.error ?? 'On hold'} · retry ${relativeTime(it.next_attempt_at!, now.get())}`;
			return it.error ?? '';
		};
		const isError = () => item.get().status === 'failed';
		const chatText = () => item.get().chat_title ?? '-';
		const canRetry = () => item.get().status === 'failed' || item.get().status === 'request_sent';
		const retryBtn = {
			onclick: () => onRetry(item.get()),
			style: { display: () => (canRetry() ? '' : 'none') },
		};
		const removeBtn = {
			onclick: () => onRemove(item.get()),
			disabled: joining,
		};

		return tpl.queueRow({
			nodes: {
				linkText: { inner: () => item.get().link, title: () => `${item.get().link} (${item.get().target})` },
				mobStatus: { inner: statusText, classes: statusClasses },
				mobChat: { inner: () => (item.get().chat_title ? `· ${item.get().chat_title}` : '') },
				mobDetails: {
					inner: detailsText,
					classes: { 'join-error': isError },
					style: { display: () => (detailsText() ? '' : 'none') },
				},
				mobRetryBtn: retryBtn,
				mobRemoveBtn: removeBtn,

				statusBadge: { inner: statusText, classes: statusClasses },
				chatCol: { inner: chatText, title: () => item.get().chat_id ?? '' },
				detailsCol: { inner: detailsText, title: detailsText, classes: { 'join-error': isError } },
				addedCol: { inner: () => relativeTime(item.get().added_at, now.get()), title: () => fullDate(item.get().added_at) },
				retryBtn,
				removeBtn,
			},
		});
	},
	(item) => item.id
);

/**
 * The channel links the account is joining in the background: a button to queue more (a dialog with one
 * link per line) and the list of what was queued with where each link stands. Loads and polls the queue
 * itself, so mount it only while signed in (it is the "Join queue" tab): the poller stops on unmount.
 */
export const TelegramJoinQueue = component<TelegramJoinQueueProps>(({ onError }) => {
	const api = inject(TelegramApiService);
	const dialogs = inject(DialogService);

	/** The queue as the API returns it; null until the first load. */
	const data = signal<TelegramJoinQueueResponse | null>(null);
	/** Wall-clock reference for the relative times, refreshed with `data`. */
	const now = signal(Date.now());

	const loadQueue = smartLoad(async () => {
		data.set(await api.getJoinQueue());
		now.set(Date.now());
	}, 'telegram-join-queue');

	/** Runs an action on the queue and reloads it; failures go to the host. */
	const runAction = async (action: () => Promise<unknown>, errorText: string) => {
		try {
			await action();
			loadQueue();
		} catch (e: any) {
			onError(e.message || errorText);
		}
	};

	const openJoinDialog = () => {
		dialogs.open({
			title: 'Join channels',
			width: '480px',
			render: (close) =>
				JoinChannelsDialog({
					onConfirm: async (links, indexOnJoin) => {
						close();
						try {
							const { added, alreadyJoined, invalid } = await api.addJoinLinks(links, indexOnJoin);
							loadQueue();
							if (alreadyJoined.length > 0 || invalid.length > 0) {
								const parts = [added === 1 ? '1 link was queued.' : `${added} links were queued.`];
								if (alreadyJoined.length > 0) parts.push(`The account is already a member of these, skipped:\n${alreadyJoined.join('\n')}`);
								if (invalid.length > 0) parts.push(`These lines were not understood and were skipped:\n${invalid.join('\n')}`);
								await dialogs.alert(parts.join('\n\n'), 'Join channels');
							}
						} catch (e: any) {
							onError(e.message || 'Error queuing the links');
						}
					},
					onCancel: close,
				}),
		});
	};

	const retry = (item: TelegramJoinItem) => runAction(() => api.retryJoin(item.id), 'Error retrying the link');
	const remove = (item: TelegramJoinItem) => runAction(() => api.removeJoin(item.id), 'Error removing the link');
	const clearFinished = () => runAction(() => api.clearFinishedJoins(), 'Error clearing the queue');

	// Loads right away and keeps the queue fresh until the component leaves the DOM
	smartPoll(loadQueue, QUEUE_POLL_MS);

	const items = computed(() => data.get()?.items ?? []);
	const joiningId = computed(() => data.get()?.joiningId ?? null);
	const finishedCount = computed(() => items.get().filter((it) => it.status !== 'pending').length);

	const emptyText = computed(() => {
		if (data.get() === null) return 'Loading the queue...';
		return items.get().length === 0
			? 'No links queued. Click "Join channels…" and paste the channels to join; mularr joins them one by one in the background.'
			: '';
	});

	const queueNote = computed(() => {
		const res = data.get();
		if (!res || res.items.length === 0) return '';
		const list = res.items;
		const count = (status: TelegramJoinItem['status']) => list.filter((it) => it.status === status).length;
		const parts: string[] = [];
		const pending = count('pending');
		if (pending > 0) parts.push(`${pending} pending`);
		if (count('joined') > 0) parts.push(`${count('joined')} joined`);
		if (count('request_sent') > 0) parts.push(`${count('request_sent')} awaiting approval`);
		if (count('failed') > 0) parts.push(`${count('failed')} failed`);
		const joining = res.joiningId !== null ? list.find((it) => it.id === res.joiningId) : undefined;
		if (joining) {
			parts.push(`joining ${joining.link}…`);
		} else if (pending > 0) {
			// Between attempts: say when the next one is due (the pause between joins, or a flood wait)
			const due = list.filter((it) => it.status === 'pending').map((it) => it.next_attempt_at ?? 0);
			const nextAt = Math.min(...due);
			if (nextAt > now.get()) parts.push(`next attempt ${relativeTime(nextAt, now.get())}`);
		}
		return parts.join(' · ');
	});

	return tpl.fragment({
		queueNote: { inner: queueNote },
		btnJoin: { onclick: openJoinDialog },
		btnClear: { onclick: clearFinished, disabled: () => finishedCount.get() === 0 },
		queueList: {
			inner: () =>
				emptyText.get()
					? tpl.emptyRow({ nodes: { emptyText: { inner: emptyText } } })
					: QueueRows(items, { now, joiningId, onRetry: retry, onRemove: remove }),
		},
	});
});
