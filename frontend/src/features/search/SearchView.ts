import { component, signal, bindControlledInput, bindControlledSelect, onUnmount, effect, computed, componentList, Signal } from 'chispa';
import { getFileIcon } from '../../utils/icons';
import { fbytes } from '../../utils/formats';
import { ListManager, RowSelectionManager } from '../../utils/ListManager';
import { smartLoad } from '../../utils/scheduling';
import { services } from '../../services/container/ServiceContainer';
import { DialogService } from '../../services/DialogService';
import { LocalPrefsService } from '../../services/LocalPrefsService';
import { MediaApiService, SearchResult } from '../../services/MediaApiService';
import { getProviderIcon, getProviderName } from '../../services/ProvidersApiService';
import { ContextMenuItem, ContextMenuService } from '../../services/ContextMenuService';
import { ClipboardService } from '../../services/ClipboardService';
import { BlacklistService } from '../../services/BlacklistService';
import { Ed2kDownloadForm } from './Ed2kDownloadForm';
import tpl from './SearchView.html';
import './SearchView.css';

function buildContextMenuActions(
	result: SearchResult,
	selectionMgr: RowSelectionManager,
	list: SearchResult[],
	onBlacklisted: () => void
): ContextMenuItem[] {
	const actions: ContextMenuItem[] = [];
	const selected = selectionMgr.selectedHashes.get();
	const targets = selected.size > 0 ? list.filter((r) => r.hash && selected.has(r.hash)) : [result];
	const multi = targets.length > 1;

	const ed2kLinks = targets.filter((r) => r.provider === 'amule' && r.link).map((r) => r.link!);
	if (ed2kLinks.length > 0) {
		actions.push({
			label: ed2kLinks.length > 1 ? `Copy ${ed2kLinks.length} ed2k Links` : 'Copy ed2k Link',
			icon: '🔗',
			onClick: () => services.get(ClipboardService).copy(ed2kLinks.join('\n')),
		});
	}

	if (targets.some((r) => r.hash)) {
		if (actions.length > 0) actions.push({ separator: true });
		actions.push({
			label: multi ? `Blacklist ${targets.length} Hashes…` : 'Blacklist Hash…',
			icon: '🚫',
			onClick: async () => {
				const ok = await services.get(BlacklistService).blacklistWithConfirm(
					targets.map((r) => ({ hash: r.hash, name: r.name, size: r.size })),
					multi
						? 'The hashes will be blocked from downloads and hidden from search results.'
						: 'The hash will be blocked from downloads and hidden from search results.'
				);
				if (ok) {
					selectionMgr.clearSelection();
					onBlacklisted();
				}
			},
		});
	}

	return actions;
}

const MOBILE_SORT_OPTIONS: { value: string; label: string; col: keyof SearchResult; dir: 'asc' | 'desc' }[] = [
	{ value: 'name-asc', label: 'Name A→Z', col: 'name', dir: 'asc' },
	{ value: 'name-desc', label: 'Name Z→A', col: 'name', dir: 'desc' },
	{ value: 'provider-asc', label: 'Provider A→Z', col: 'provider', dir: 'asc' },
	{ value: 'provider-desc', label: 'Provider Z→A', col: 'provider', dir: 'desc' },
	{ value: 'sources-asc', label: 'Sources ↑', col: 'sourceCount', dir: 'asc' },
	{ value: 'sources-desc', label: 'Sources ↓', col: 'sourceCount', dir: 'desc' },
	{ value: 'size-asc', label: 'Size ↑', col: 'size', dir: 'asc' },
	{ value: 'size-desc', label: 'Size ↓', col: 'size', dir: 'desc' },
];

interface ResultsRowsProps {
	onDownload: (hash: string) => void;
	downloadingHashes: Signal<Set<string>>;
	selectionMgr: RowSelectionManager;
	onBlacklisted: () => void;
}
const ResultsRows = componentList<SearchResult, ResultsRowsProps>(
	(res, i, l, props) => {
		const onDownload = props!.onDownload;
		const downloadingHashes = props!.downloadingHashes;
		const selectionMgr = props!.selectionMgr;
		const onBlacklisted = props!.onBlacklisted;
		const ctxMenu = services.get(ContextMenuService);
		const isSelected = computed(() => selectionMgr.selectedHashes.get().has(res.get().hash || ''));
		const isDownloading = computed(() => downloadingHashes.get().has(res.get().hash || ''));
		const isDisabled = computed(() => isDownloading.get() || res.get().downloadStatus === 1 || res.get().downloadStatus === 2);
		const downloadBtnLabel = computed(() => {
			const s = res.get().downloadStatus;
			if (s === 1) return 'Downloaded';
			if (s === 2) return 'In Queue';
			return 'Download';
		});

		return tpl.resultRow({
			classes: {
				'status-downloaded': () => res.get().downloadStatus === 1,
				'status-queued': () => res.get().downloadStatus === 2,
				selected: isSelected,
			},
			oncontextmenu: (e: MouseEvent) => {
				e.preventDefault();
				const result = res.get();
				const hash = result.hash;
				if (hash) {
					selectionMgr.handleContextMenuSelection(e, hash, l.get());
				}
				const actions = buildContextMenuActions(result, selectionMgr, l.get(), onBlacklisted);
				ctxMenu.show(e, actions);
			},
			onclick: (e: MouseEvent) => {
				const hash = res.get().hash;
				if (!hash) return;
				selectionMgr.handleRowSelection(e, hash, l.get());
			},
			nodes: {
				nameCol: { title: () => res.get().name },
				fileIcon: { inner: () => getFileIcon(res.get().name) },
				fileNameText: { inner: () => res.get().name },
				mobileInfo: {
					nodes: {
						mobProviderIcon: {
							inner: () => getProviderIcon(res.get().provider),
							title: () => getProviderName(res.get().provider),
						},
						mobSize: { inner: () => fbytes(res.get().size) },
						mobSources: { inner: () => (res.get().sourceCount ? `${res.get().sourceCount}` : '0') },
						mobDownloadBtn: {
							onclick: (e: MouseEvent) => {
								e.stopPropagation();
								onDownload(res.get().hash);
							},
							disabled: isDisabled,
							inner: downloadBtnLabel,
						},
					},
				},
				providerCol: {
					inner: () => getProviderIcon(res.get().provider),
					title: () => getProviderName(res.get().provider),
				},
				typeCol: { inner: () => res.get().type || '' },
				sizeCol: { inner: () => fbytes(res.get().size) },
				sourcesCol: { inner: () => res.get().sourceCount || '0' },
				completeCol: {
					inner: () => {
						const r = res.get();
						if (!r.sourceCount || !r.completeSourceCount) return '0%';
						const s = parseInt(r.sourceCount);
						const c = parseInt(r.completeSourceCount);
						if (isNaN(s) || isNaN(c) || s === 0) return '0%';
						return `${((c / s) * 100).toFixed(0)}% (${c})`;
					},
				},
				sourceInfoCol: { inner: () => res.get().sourceName || '' },
				downloadMiniBtn: {
					onclick: (e: MouseEvent) => {
						e.stopPropagation();
						onDownload(res.get().hash);
					},
					disabled: isDisabled,
					inner: downloadBtnLabel,
				},
			},
		});
	},
	(r) => r.hash
);

export const SearchView = component(() => {
	const apiService = services.get(MediaApiService);
	const dialogService = services.get(DialogService);
	const prefs = services.get(LocalPrefsService);

	const statusLog = signal('');
	const searchQuery = signal('');
	const searchType = signal(prefs.get('search.type', 'Global'));

	const mgr = new ListManager<SearchResult, keyof SearchResult>({
		defaultColumn: 'name',
		numericColumns: ['size', 'sourceCount', 'completeSourceCount'],
		mobileSortOptions: MOBILE_SORT_OPTIONS,
		prefs: { service: prefs, key: 'search' },
	});

	effect(() => {
		prefs.set('search.type', searchType.get());
	});

	const searchProgress = signal(0);
	const downloadingHashes = signal<Set<string>>(new Set());
	const blacklistedCount = signal(0);

	let isPolling = false;

	const performSearch = async () => {
		if (!searchQuery.get()) return;
		try {
			await apiService.search(searchQuery.get(), searchType.get());
			statusLog.set('Search started. Waiting for results...');
			mgr.items.set([]);
			searchProgress.set(0);
			blacklistedCount.set(0);
			startPolling();
		} catch (e: any) {
			await dialogService.alert(e.message, 'Search Error');
		}
	};

	const loadSearchStatus = smartLoad(async () => {
		const status = await apiService.getSearchStatus();
		// Progress comes as 0 to 1 from backend
		searchProgress.set(status.progress);
		return status.progress;
	}, 'search-status');

	const loadResults = async () => {
		try {
			const data = await apiService.getSearchResults();
			blacklistedCount.set(data.blacklistedCount ?? 0);
			if (data.list && data.list.length > 0) {
				mgr.items.set(data.list);
				statusLog.set(`Found ${data.list.length} results.`);
			} else if (mgr.items.get().length === 0) {
				statusLog.set('No results found yet or search is still in progress.');
			}
		} catch (e: any) {
			statusLog.set('Error loading results: ' + e.message);
		}
	};

	let intervalId: any = null;

	const startPolling = () => {
		if (isPolling) return;
		isPolling = true;

		if (intervalId) clearInterval(intervalId);

		intervalId = setInterval(async () => {
			const progress = await loadSearchStatus();
			await loadResults();

			if (progress == null || progress >= 1 || progress === 0) {
				stopPolling();
				// Final load to ensure we have the latest results
				setTimeout(() => {
					loadResults();
				}, 1500);
			}
		}, 1000);
	};

	const stopPolling = () => {
		if (intervalId) {
			clearInterval(intervalId);
			intervalId = null;
		}
		isPolling = false;
	};

	onUnmount(() => stopPolling());

	// Initial load: check if a search is already in progress
	startPolling();

	const download = async (hash?: string) => {
		if (!hash) return;
		try {
			const s = new Set(downloadingHashes.get());
			s.add(hash);
			downloadingHashes.set(s);

			await apiService.addDownload(hash);
			console.log('Download added successfully');
			loadResults();
			mgr.clearSelection();
		} catch (e: any) {
			await dialogService.alert('Error adding download: ' + e.message, 'Download Error');
		} finally {
			const s = new Set(downloadingHashes.get());
			s.delete(hash);
			downloadingHashes.set(s);
		}
	};

	const downloadSelected = async () => {
		const hashes = [...mgr.selectedHashes.get()];
		if (hashes.length === 0) return;
		const newSet = new Set(downloadingHashes.get());
		for (const h of hashes) newSet.add(h);
		downloadingHashes.set(newSet);
		try {
			await Promise.allSettled(hashes.map((hash) => apiService.addDownload(hash)));
			loadResults();
			mgr.clearSelection();
		} catch (e: any) {
			await dialogService.alert('Error adding downloads: ' + e.message, 'Download Error');
		} finally {
			const s = new Set(downloadingHashes.get());
			for (const h of hashes) s.delete(h);
			downloadingHashes.set(s);
		}
	};

	return tpl.fragment({
		thName: { onclick: () => mgr.sort('name') },
		thProvider: { onclick: () => mgr.sort('provider') },
		thSourceInfo: { onclick: () => mgr.sort('sourceName') },
		thSize: { onclick: () => mgr.sort('size') },
		thSources: { onclick: () => mgr.sort('sourceCount') },
		thCompleted: { onclick: () => mgr.sort('completeSourceCount') },
		thType: { onclick: () => mgr.sort('type') },

		searchInput: {
			_ref: (el) => {
				bindControlledInput(el, searchQuery);
			},
			onkeydown: (e: KeyboardEvent) => {
				if (e.key === 'Enter') performSearch();
			},
		},
		typeSelect: {
			_ref: (el) => {
				bindControlledSelect(el, searchType);
			},
		},
		searchBtn: { onclick: performSearch },
		refreshBtn: { onclick: loadResults },
		resultsList: { inner: statusLog },
		resultsContainer: {
			inner: () =>
				ResultsRows(mgr.sortedItems, { onDownload: (hash) => download(hash), downloadingHashes, selectionMgr: mgr, onBlacklisted: loadResults }),
		},
		ed2kForm: Ed2kDownloadForm({ onAdded: loadResults }),
		downloadSelectedBtn: {
			disabled: () => !mgr.hasSelection.get(),
			onclick: downloadSelected,
		},
		selectionCountLabel: {
			inner: () => {
				const n = mgr.selectionCount.get();
				return n === 0 ? '' : `${n} selected`;
			},
		},
		mobileSortSelect: {
			_ref: (el: HTMLSelectElement) => {
				bindControlledSelect(el, mgr.mobileSortValue, MOBILE_SORT_OPTIONS);
			},
		},
		searchProgressContainer: {
			style: {
				opacity: () => (searchProgress.get() === 0 ? '0.5' : ''),
			},
		},
		searchProgressBar: {
			style: {
				width: () => `${Math.min(100, searchProgress.get() * 100)}%`,
			},
		},
		searchProgressText: {
			inner: () => `${Math.floor(Math.min(1, searchProgress.get()) * 100)}%`,
		},
		blacklistHiddenLabel: {
			style: { display: () => (blacklistedCount.get() > 0 ? '' : 'none') },
			inner: () => {
				const n = blacklistedCount.get();
				return n > 0 ? `🚫 ${n} result${n === 1 ? '' : 's'} hidden by blacklist` : '';
			},
		},
	});
});
