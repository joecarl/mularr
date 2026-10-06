import { inject, component, componentList, signal, refBindInput, refBindSelect, computed, effect } from 'chispa';
import {
	IndexerFeedApiService,
	type ArrSyncExtensionStatus,
	type ArrSyncStatusResponse,
	type IndexerFeedItem,
	type IndexerFeedMediaType,
	type ProviderFeedStatus,
	type WantedItem,
	type WantedListResponse,
} from '../../services/IndexerFeedApiService';
import { BlacklistService } from '../../services/BlacklistService';
import { ContextMenuService, type ContextMenuItem } from '../../services/ContextMenuService';
import { DialogService } from '../../services/DialogService';
import { ApiError } from '../../services/BaseApiService';
import { LocalPrefsService } from '../../services/LocalPrefsService';
import { ColumnsMenuService } from '../../services/ColumnsMenuService';
import { getProviderIcon, getProviderName } from '../../services/ProvidersApiService';
import { sourceInfoContent, type SourceInfo } from '../../utils/sourceInfo';
import { ListManager } from '../../utils/ListManager';
import { TableColumns } from '../../utils/TableColumns';
import { smartLoad, smartPoll } from '../../utils/scheduling';
import { fbytes, relativeTime } from '../../utils/formats';
import tpl from './IndexerFeedView.html';
import './IndexerFeedView.css';

const PAGE_SIZE = 100;
const STATUS_POLL_MS = 5000;
const SEARCH_DEBOUNCE_MS = 300;

type Tab = 'wanted' | 'feed';

const MEDIA_TYPE_LABELS: Record<IndexerFeedMediaType, string> = { tv: 'TV', movie: 'Movie' };

/**
 * Origin of a feed item (label and website page), from the search-result snapshot the sync stored with it.
 * The provider id itself is a column of the row; a corrupt or missing snapshot only loses the label.
 */
function parseSearchResult(item: IndexerFeedItem): SourceInfo {
	if (!item.search_result) return { provider: item.provider };
	try {
		const r = JSON.parse(item.search_result) as Partial<SourceInfo>;
		return { provider: item.provider, sourceName: r.sourceName, webUrl: r.webUrl };
	} catch {
		return { provider: item.provider };
	}
}

function badgeOf(s: ArrSyncExtensionStatus): { text: string; color: string } {
	if (!s.enabled) return { text: 'Disabled', color: '#808080' };
	if (!s.configured) return { text: 'Not configured', color: '#ff4d4d' };
	if (!s.syncWanted) return { text: 'Sync off', color: '#808080' };
	if (s.searchProviders?.length === 0) return { text: 'Not searched', color: '#808080' };
	if (s.running) return { text: 'Running', color: '#2b7bd6' };
	if (s.queued) return { text: 'Queued', color: '#2b7bd6' };
	if (s.error) return { text: 'Error', color: '#ff4d4d' };
	if (!s.lastRunAt) return { text: 'Pending', color: '#808080' };
	return { text: 'OK', color: '#008000' };
}

function feedBadgeOf(s: ProviderFeedStatus): { text: string; color: string } {
	if (!s.enabled) return { text: 'Disabled', color: '#808080' };
	if (s.running) return { text: 'Running', color: '#2b7bd6' };
	if (s.error) return { text: 'Error', color: '#ff4d4d' };
	if (!s.lastRunAt) return { text: 'Pending', color: '#808080' };
	return { text: 'OK', color: '#008000' };
}

interface FeedRowProps {
	/** Selection only: the feed comes sorted from the server, see getIndexerFeed. */
	mgr: ListManager<IndexerFeedItem>;
	onBlacklist: (items: IndexerFeedItem[]) => void;
	onRemove: (items: IndexerFeedItem[]) => void;
}

/** One row per feed release; rows are selectable and the context menu acts on the whole selection. */
const FeedRows = componentList<IndexerFeedItem, FeedRowProps>(
	(it, i, l, props) => {
		const { mgr, onBlacklist, onRemove } = props!;
		const ctxMenu = inject(ContextMenuService);
		const item = it.get.bind(it);
		const isSelected = computed(() => mgr.selectedHashes.get().has(item().hash));
		const type = () => MEDIA_TYPE_LABELS[item().media_type] ?? item().media_type;
		const discovered = () => new Date(item().discovered_at).toLocaleString();
		const origin = computed(() => parseSearchResult(item()));
		// Row buttons act on their own release only, so their clicks must not reach the row selection handler
		const blacklistBtn = {
			onclick: (e: MouseEvent) => {
				e.stopPropagation();
				onBlacklist([item()]);
			},
		};
		const deleteBtn = {
			onclick: (e: MouseEvent) => {
				e.stopPropagation();
				onRemove([item()]);
			},
		};

		return tpl.feedRow({
			classes: { selected: isSelected },
			onclick: (e: MouseEvent) => mgr.handleRowSelection(e, item().hash, l.get()),
			oncontextmenu: (e: MouseEvent) => {
				mgr.handleContextMenuSelection(e, item().hash, l.get());
				const selected = mgr.selectedHashes.get();
				const targets = l.get().filter((x) => selected.has(x.hash));
				const multi = targets.length > 1;
				const actions: ContextMenuItem[] = [
					{ label: multi ? `Blacklist ${targets.length} Hashes…` : 'Blacklist Hash…', icon: '🚫', onClick: () => onBlacklist(targets) },
					{ label: multi ? `Remove ${targets.length} from feed` : 'Remove from feed', icon: '🗑️', onClick: () => onRemove(targets) },
				];
				ctxMenu.show(e, actions);
			},
			nodes: {
				nameCol: {},
				nameText: { inner: () => item().name, title: () => item().hash },
				mobileInfo: {
					nodes: {
						mobType: { inner: type },
						mobSize: { inner: () => fbytes(item().size) },
						mobSources: { inner: () => `${item().source_count} src` },
						mobProviderIcon: { inner: () => getProviderIcon(item().provider), title: () => getProviderName(item().provider) },
						mobDiscovered: { inner: discovered },
						mobQuery: { inner: () => item().query ?? '', title: () => item().query ?? '' },
						mobBlacklistBtn: blacklistBtn,
						mobDeleteBtn: deleteBtn,
					},
				},
				typeCol: { inner: type },
				sizeCol: { inner: () => fbytes(item().size) },
				sourcesCol: { inner: () => String(item().source_count) },
				providerCol: { inner: () => getProviderIcon(item().provider), title: () => getProviderName(item().provider) },
				originCol: { inner: () => sourceInfoContent(origin.get(), '-'), title: () => origin.get().sourceName ?? '' },
				queryCol: { inner: () => item().query ?? '-', title: () => item().query ?? '' },
				imdbCol: { inner: () => item().imdb_id ?? '-' },
				discoveredCol: { inner: discovered, title: () => item().discovered_at },
				blacklistBtn,
				deleteBtn,
			},
		});
	},
	(item) => item.hash
);

/**
 * Two views of the *arr integration: the wanted titles read live from Sonarr/Radarr, with what the sync
 * did about each, and the feed the Torznab endpoint serves them on their RSS sync. Together they answer
 * "why doesn't Sonarr grab X": not wanted, not searched yet, searched with no hits, or in the feed already.
 * The feed is also fed by the providers' own new releases (Hispashare polling, the Telegram indexer), whose
 * state shows next to the sync cards.
 */
export const IndexerFeedView = component(() => {
	const api = inject(IndexerFeedApiService);
	const blacklistService = inject(BlacklistService);
	const dialogService = inject(DialogService);
	const prefs = inject(LocalPrefsService);
	const columnsMenu = inject(ColumnsMenuService);
	const wantedColumns = new TableColumns({ prefs, prefsKey: 'indexerfeed.wanted' });
	const feedColumns = new TableColumns({ prefs, prefsKey: 'indexerfeed.feed' });
	// Multi-selection of feed rows (click, Ctrl/Cmd+click, Shift+click); the server keeps the order, so no sorting here
	const feedMgr = new ListManager<IndexerFeedItem>({ defaultColumn: 'discovered_at', skipSort: () => true });

	const tab = signal<Tab>('feed');

	// Wanted listing
	const wanted = signal<WantedListResponse | null>(null);
	// Feed listing
	const items = signal<IndexerFeedItem[]>([]);
	const total = signal(0);
	const offset = signal(0);
	const typeFilter = signal('');
	const search = signal('');
	/** Feed restricted to the releases found for one wanted title (set from the Wanted tab). */
	const jobFilter = signal<{ key: string; title: string } | null>(null);
	// Sync status
	const status = signal<ArrSyncStatusResponse | null>(null);
	const feeds = signal<ProviderFeedStatus[]>([]);
	const now = signal(Date.now());

	const loadWanted = smartLoad(async () => {
		wanted.set(await api.getWanted());
		now.set(Date.now());
	}, 'indexer-feed-wanted');

	const loadFeed = smartLoad(async () => {
		const type = typeFilter.get() as IndexerFeedMediaType | '';
		const res = await api.list({
			type: type || undefined,
			search: search.get().trim() || undefined,
			jobKey: jobFilter.get()?.key,
			offset: offset.get(),
			limit: PAGE_SIZE,
		});
		items.set(res.items);
		total.set(res.total);
		// The page vanished under us (items removed, filter narrowed): step back to the last one
		if (res.items.length === 0 && res.total > 0 && res.offset >= res.total) {
			offset.set(Math.max(0, Math.floor((res.total - 1) / PAGE_SIZE) * PAGE_SIZE));
			await loadFeed();
		}
	}, 'indexer-feed');

	const reloadFromStart = () => {
		offset.set(0);
		feedMgr.clearSelection();
		return loadFeed();
	};

	const loadCurrentTab = () => (tab.get() === 'wanted' ? loadWanted() : loadFeed());

	const switchTab = (next: Tab) => {
		if (tab.get() === next) return;
		tab.set(next);
		loadCurrentTab();
	};

	// Status is polled; when a run (sync or feed poll) ends, the current tab is reloaded so new releases show up without a click
	let wasRunning = false;
	const loadStatus = smartLoad(async () => {
		const [sync, feedRes] = await Promise.all([api.getSyncStatus(), api.getProviderFeeds()]);
		status.set(sync);
		feeds.set(feedRes.sources);
		now.set(Date.now());
		const running = sync.running || feedRes.sources.some((s) => s.running);
		if (wasRunning && !running) await loadCurrentTab();
		wasRunning = running;
	}, 'indexer-feed-status');

	// The Feed tab loads itself through the filters effect below; the Wanted tab loads when it is opened
	smartPoll(loadStatus, STATUS_POLL_MS);

	// The feed follows its filters: this also performs the initial load. The reload is deferred so the
	// signals loadFeed reads (search, offset) stay out of this effect's dependencies; the text filter is
	// debounced and paging loads on its own.
	effect(() => {
		typeFilter.get();
		jobFilter.get();
		queueMicrotask(() => void reloadFromStart());
	});

	// Filters
	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	const onSearchInput = () => {
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => void reloadFromStart(), SEARCH_DEBOUNCE_MS);
	};

	const showFeedForWanted = (w: WantedItem) => {
		jobFilter.set({ key: w.key, title: w.title });
		tab.set('feed');
	};

	/** Feed restricted to the releases a provider feed published. */
	const showFeedForSource = (s: ProviderFeedStatus) => {
		jobFilter.set({ key: s.jobKey, title: `${getProviderName(s.source)} feed` });
		tab.set('feed');
	};

	const clearJobFilter = () => jobFilter.set(null);

	// Actions
	const runSync = async (s: ArrSyncExtensionStatus) => {
		try {
			const res = await api.runSync(s.extensionId);
			status.set(res.status);
			wasRunning = res.status.running;
		} catch (e) {
			await dialogService.alert(e instanceof ApiError ? e.message : 'Failed to start the sync', 'Error');
		}
	};

	/** Removes the releases from the feed; several at once ask first (the row button and a single-row menu do not). */
	const removeItems = async (list: IndexerFeedItem[]) => {
		if (list.length === 0) return;
		if (list.length > 1 && !(await dialogService.confirm(`Remove ${list.length} releases from the feed?`, 'Remove From Feed'))) return;
		try {
			await Promise.all(list.map((item) => api.removeItem(item.hash)));
			feedMgr.clearSelection();
			await loadFeed();
		} catch (e) {
			await dialogService.alert(e instanceof ApiError ? e.message : 'Failed to remove the item', 'Error');
		}
	};

	const blacklistItems = async (list: IndexerFeedItem[]) => {
		const single = list.length === 1;
		const ok = await blacklistService.blacklistWithConfirm(
			list.map((item) => ({ hash: item.hash, name: item.name, size: item.size })),
			`The release${single ? ' is' : 's are'} removed from the feed and will not be offered to Sonarr/Radarr again.`
		);
		if (!ok) return;
		try {
			await Promise.all(list.map((item) => api.removeItem(item.hash)));
			feedMgr.clearSelection();
			await loadFeed();
		} catch (e) {
			await dialogService.alert(e instanceof ApiError ? e.message : 'Failed to remove the item', 'Error');
		}
	};

	const clearFeed = async () => {
		const count = total.get();
		if (
			!(await dialogService.confirm(
				`Remove every release from the feed (${count} item${count === 1 ? '' : 's'})?\n\nThe next sync will fill it again.`,
				'Clear Feed'
			))
		) {
			return;
		}
		try {
			await api.clear();
			await reloadFromStart();
		} catch (e) {
			await dialogService.alert(e instanceof ApiError ? e.message : 'Failed to clear the feed', 'Error');
		}
	};

	// Paging
	const pageInfo = computed(() => {
		const t = total.get();
		if (t === 0) return '0 releases';
		const from = offset.get() + 1;
		const to = Math.min(offset.get() + items.get().length, t);
		return `${from}-${to} of ${t} release${t === 1 ? '' : 's'}`;
	});
	const goPrev = () => {
		if (offset.get() === 0) return;
		offset.set(Math.max(0, offset.get() - PAGE_SIZE));
		loadFeed();
	};
	const goNext = () => {
		if (offset.get() + PAGE_SIZE >= total.get()) return;
		offset.set(offset.get() + PAGE_SIZE);
		loadFeed();
	};

	const onFeedTab = () => tab.get() === 'feed';
	const showWhen = (visible: () => boolean) => ({ display: () => (visible() ? '' : 'none') });

	return tpl.fragment({
		tabWanted: { onclick: () => switchTab('wanted'), classes: { active: () => tab.get() === 'wanted' } },
		tabFeed: { onclick: () => switchTab('feed'), classes: { active: onFeedTab } },
		feedFilters: { style: showWhen(onFeedTab) },
		jobFilterChip: { style: showWhen(() => jobFilter.get() !== null) },
		jobFilterLabel: { inner: () => (jobFilter.get() ? `Releases of: ${jobFilter.get()!.title}` : ''), title: () => jobFilter.get()?.title ?? '' },
		jobFilterClear: { onclick: clearJobFilter },
		typeSelect: { _ref: refBindSelect(typeFilter) },
		searchInput: { _ref: refBindInput(search), oninput: onSearchInput },
		btnRefresh: {
			onclick: () => {
				loadCurrentTab();
				loadStatus();
			},
		},
		btnClear: { onclick: clearFeed, disabled: () => total.get() === 0, style: showWhen(onFeedTab) },
		// One button for both tabs: it opens the menu of the table currently shown
		columnsBtn: { onclick: (e) => columnsMenu.show(e.currentTarget as HTMLElement, onFeedTab() ? feedColumns : wantedColumns) },
		wantedTable: { _ref: (el) => wantedColumns.attach(el) },
		feedTable: { _ref: (el) => feedColumns.attach(el) },

		// Each tab shows the cards of what fills its view: the wanted sync next to the wanted titles, the provider feeds next to the feed
		wantedSyncPanel: { style: showWhen(() => tab.get() === 'wanted') },
		providerFeedsPanel: { style: showWhen(onFeedTab) },
		postponedNote: { inner: () => (status.get()?.postponedReason ? `Postponed: ${status.get()!.postponedReason}` : '') },
		syncCards: {
			inner: () => {
				const list = status.get()?.extensions ?? [];
				if (list.length === 0) return tpl.syncEmpty({});
				const nowMs = now.get();
				return list.map((s) => {
					const badge = badgeOf(s);
					const counts = s.wantedCount === null ? '-' : `${s.wantedCount} / ${s.searched ?? '-'} / ${s.found ?? '-'}`;
					return tpl.syncCard({
						nodes: {
							cardName: { inner: s.name, title: s.name },
							cardType: { inner: s.type === 'sonarr' ? 'Sonarr' : 'Radarr' },
							cardBadge: { inner: badge.text, style: { color: badge.color } },
							cardRunBtn: {
								onclick: () => runSync(s),
								disabled: !s.enabled || !s.configured || !s.syncWanted || s.searchProviders?.length === 0 || s.running || s.queued,
							},
							cardLastRun: {
								inner: s.lastRunAt
									? `${relativeTime(s.lastRunAt, nowMs)}${s.lastDurationMs !== null ? ` (took ${Math.round(s.lastDurationMs / 1000)} s)` : ''}`
									: 'never',
								title: s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : '',
							},
							cardNextRun: {
								inner: s.running ? 'running now' : s.nextRunAt ? relativeTime(s.nextRunAt, nowMs) : '-',
								title: s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : '',
							},
							cardCounts: { inner: counts },
							cardProviders: {
								inner: s.searchProviders ? s.searchProviders.map((p) => getProviderName(p)).join(', ') || 'none' : 'all',
							},
							cardError: { inner: s.error ?? '', style: { display: s.error ? '' : 'none' } },
						},
					});
				});
			},
		},

		feedCards: {
			inner: () => {
				const nowMs = now.get();
				return feeds.get().map((s) => {
					const badge = feedBadgeOf(s);
					const polled = s.source === 'hispashare';
					return tpl.feedCard({
						nodes: {
							fCardIcon: { inner: getProviderIcon(s.source) },
							fCardName: { inner: getProviderName(s.source), title: s.jobKey },
							fCardBadge: { inner: badge.text, style: { color: badge.color } },
							fCardLastRun: {
								inner: s.lastRunAt ? relativeTime(s.lastRunAt, nowMs) : 'never',
								title: s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : '',
							},
							fCardNextRunKey: { inner: polled ? 'Next poll' : 'Trigger' },
							fCardNextRun: {
								inner: !polled
									? 'each indexing pass over a chat'
									: s.running
										? 'running now'
										: s.nextRunAt
											? `${relativeTime(s.nextRunAt, nowMs)} (every ${s.intervalMinutes} min)`
											: '-',
								title: s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : '',
							},
							fCardAdded: { inner: s.added === null ? '-' : String(s.added) },
							fCardInFeedBtn: { inner: String(s.inFeed), onclick: () => showFeedForSource(s), disabled: s.inFeed === 0 },
							fCardError: { inner: s.error ?? '', style: { display: s.error ? '' : 'none' } },
						},
					});
				});
			},
		},

		// ---- Wanted tab ----
		wantedPane: { style: showWhen(() => tab.get() === 'wanted') },
		wantedErrors: {
			style: showWhen(() => (wanted.get()?.errors.length ?? 0) > 0),
			inner: () => (wanted.get()?.errors ?? []).map((e) => tpl.wantedError({ inner: `${e.extensionName}: ${e.message}` })),
		},
		wantedBody: {
			inner: () => {
				const res = wanted.get();
				if (!res) return tpl.wantedNoRows({ nodes: { wantedNoRowsText: { inner: 'Loading...' } } });
				if (res.items.length === 0) {
					const text =
						res.errors.length > 0
							? 'No wanted titles could be read.'
							: 'Nothing is wanted: every monitored item of the configured instances has a file.';
					return tpl.wantedNoRows({ nodes: { wantedNoRowsText: { inner: text } } });
				}
				const nowMs = now.get();
				return res.items.map((w) => {
					const pending = w.pending.join(', ');
					const searched = w.lastSearchedAt ? relativeTime(w.lastSearchedAt, nowMs) : 'not yet';
					const hits = w.feedHits === 0 ? (w.lastSearchedAt ? 'none' : '-') : String(w.feedHits);
					return tpl.wantedRow({
						nodes: {
							wTitleCol: {},
							wTitle: { inner: w.title, title: w.key },
							wMobileInfo: {
								nodes: {
									wMobInstance: { inner: w.extensionName },
									wMobPending: { inner: pending, title: pending },
									wMobSearched: { inner: `Searched: ${searched}` },
									wMobHitsBtn: { inner: `In feed: ${hits}`, onclick: () => showFeedForWanted(w), disabled: w.feedHits === 0 },
								},
							},
							wInstanceCol: { inner: w.extensionName, title: w.extensionName },
							wTypeCol: { inner: MEDIA_TYPE_LABELS[w.mediaType] ?? w.mediaType },
							wPendingCol: { inner: pending || '-', title: pending },
							wQueryCol: { inner: w.query, title: w.query },
							wImdbCol: { inner: w.imdbId ?? '-' },
							wSearchedCol: { inner: searched, title: w.lastSearchedAt ? new Date(w.lastSearchedAt).toLocaleString() : '' },
							wHitsBtn: { inner: hits, onclick: () => showFeedForWanted(w), disabled: w.feedHits === 0 },
						},
					});
				});
			},
		},

		// ---- Feed tab ----
		feedPane: { style: showWhen(onFeedTab) },
		feedFooter: { style: showWhen(onFeedTab) },
		feedBody: {
			inner: () => {
				if (items.get().length === 0) {
					const filtered = typeFilter.get() !== '' || search.get().trim() !== '' || jobFilter.get() !== null;
					return tpl.noItemsRow({ nodes: { noItemsText: { inner: filtered ? 'No releases match the current filters.' : 'The feed is empty.' } } });
				}
				return FeedRows(items, { mgr: feedMgr, onBlacklist: blacklistItems, onRemove: removeItems });
			},
		},

		pageInfo: { inner: () => pageInfo.get() },
		btnPrev: { onclick: goPrev, disabled: () => offset.get() === 0 },
		btnNext: { onclick: goNext, disabled: () => offset.get() + PAGE_SIZE >= total.get() },
	});
});
