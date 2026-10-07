import { inject, component, signal, refBindInput, refBindSelect, onUnmount, effect, computed, componentList, Signal, SelectOption } from 'chispa';
import { getFileIcon } from '../../utils/icons';
import { fbytes } from '../../utils/formats';
import { ListManager, RowSelectionManager } from '../../utils/ListManager';
import { TableColumns } from '../../utils/TableColumns';
import { smartLoad } from '../../utils/scheduling';
import { sourceInfoContent } from '../../utils/sourceInfo';
import { DialogService } from '../../services/DialogService';
import { LocalPrefsService } from '../../services/LocalPrefsService';
import { MediaApiService, MediaSearchResult } from '../../services/MediaApiService';
import { getProviderIcon, getProviderName } from '../../services/ProvidersApiService';
import { ContextMenuItem, ContextMenuService } from '../../services/ContextMenuService';
import { ClipboardService } from '../../services/ClipboardService';
import { ColumnsMenuService } from '../../services/ColumnsMenuService';
import { BlacklistService } from '../../services/BlacklistService';
import { Ed2kDownloadForm } from './Ed2kDownloadForm';
import { SearchTabsBar, SearchTabsManager } from './SearchTabs';
import tpl from './SearchView.html';
import './SearchView.css';

function buildContextMenuActions(
	result: MediaSearchResult,
	selectionMgr: RowSelectionManager,
	list: MediaSearchResult[],
	onBlacklisted: () => void
): ContextMenuItem[] {
	const actions: ContextMenuItem[] = [];
	const selected = selectionMgr.selectedHashes.get();
	const targets = selected.size > 0 ? list.filter((r) => r.hash && selected.has(r.hash)) : [result];
	const multi = targets.length > 1;

	const ed2kLinks = targets.filter((r) => r.link?.startsWith('ed2k://')).map((r) => r.link!);
	if (ed2kLinks.length > 0) {
		actions.push({
			label: ed2kLinks.length > 1 ? `Copy ${ed2kLinks.length} ed2k Links` : 'Copy ed2k Link',
			icon: '🔗',
			onClick: () => inject(ClipboardService).copy(ed2kLinks.join('\n')),
		});
	}

	if (targets.some((r) => r.hash)) {
		if (actions.length > 0) actions.push({ separator: true });
		actions.push({
			label: multi ? `Blacklist ${targets.length} Hashes…` : 'Blacklist Hash…',
			icon: '🚫',
			onClick: async () => {
				const ok = await inject(BlacklistService).blacklistWithConfirm(
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

const MOBILE_SORT_OPTIONS: { value: string; label: string; col: keyof MediaSearchResult; dir: 'asc' | 'desc' }[] = [
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
	onDownload: (result: MediaSearchResult) => void;
	downloadingHashes: Signal<Set<string>>;
	selectionMgr: RowSelectionManager;
	onBlacklisted: () => void;
}
const ResultsRows = componentList<MediaSearchResult, ResultsRowsProps>(
	(res, i, l, props) => {
		const onDownload = props!.onDownload;
		const downloadingHashes = props!.downloadingHashes;
		const selectionMgr = props!.selectionMgr;
		const onBlacklisted = props!.onBlacklisted;
		const ctxMenu = inject(ContextMenuService);
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
								onDownload(res.get());
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
						return `${((r.completeSourceCount / r.sourceCount) * 100).toFixed(0)}% (${r.completeSourceCount})`;
					},
				},
				sourceInfoCol: { inner: () => sourceInfoContent(res.get()) },
				downloadMiniBtn: {
					onclick: (e: MouseEvent) => {
						e.stopPropagation();
						onDownload(res.get());
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
	const apiService = inject(MediaApiService);
	const dialogService = inject(DialogService);
	const prefs = inject(LocalPrefsService);
	const columnsMenu = inject(ColumnsMenuService);
	const columns = new TableColumns({ prefs, prefsKey: 'search' });

	const searchQuery = signal('');
	const searchType = signal(prefs.get('search.type', 'Global'));

	const mgr = new ListManager<MediaSearchResult, keyof MediaSearchResult>({
		defaultColumn: 'name',
		numericColumns: ['size', 'sourceCount', 'completeSourceCount'],
		mobileSortOptions: MOBILE_SORT_OPTIONS,
		prefs: { service: prefs, key: 'search' },
	});

	effect(() => {
		prefs.set('search.type', searchType.get());
	});

	// Provider filter: one option per search provider, shown only once a second one joins aMule
	const providerFilter = signal('all');
	const providerFilterOptions = signal<SelectOption[]>([]);
	inject(MediaApiService)
		.getSearchProviders()
		.then((providers) => {
			if (providers.length > 1)
				providerFilterOptions.set([{ value: 'all', label: 'All' }, ...providers.map((p) => ({ value: p, label: getProviderName(p) }))]);
		})
		.catch(() => {});

	const visibleResults = computed(() => {
		const f = providerFilter.get();
		const items = mgr.sortedItems.get();
		return f === 'all' ? items : items.filter((r) => r.provider === f);
	});

	effect(() => {
		providerFilter.get();
		mgr.clearSelection();
	});

	const downloadingHashes = signal<Set<string>>(new Set());

	// ---- Tabs: one per search, the table shows the active one's results (see SearchTabs.ts) ----
	const tabs = new SearchTabsManager({
		api: apiService,
		prefs,
		showResults: (results) => mgr.items.set(results),
		onSwitch: () => mgr.clearSelection(),
	});
	const activeTab = tabs.activeTab;
	onUnmount(() => tabs.dispose());

	const performSearch = async () => {
		const query = searchQuery.get();
		if (!query) return;
		try {
			await tabs.start(query, searchType.get());
		} catch (e: any) {
			await dialogService.alert(e.message, 'Search Error');
		}
	};

	const loadResults = () => tabs.loadResults();

	// ---- Downloads --------------------------------------------------------------

	/**
	 * What to hand the backend to download a result: its ed2k link when it has one, the bare hash otherwise
	 * (Telegram). A bare hash only works for aMule while the hash is in the daemon's current search, and a
	 * tab shows its own buffered search, which another search may have replaced there by now; the link works
	 * regardless (it is what the *arr send too), the sources just come from the servers instead of the search.
	 */
	const downloadRefOf = (result: MediaSearchResult): string => (result.link?.startsWith('ed2k://') ? result.link : result.hash);

	const download = async (result: MediaSearchResult) => {
		const hash = result.hash;
		if (!hash) return;
		try {
			const s = new Set(downloadingHashes.get());
			s.add(hash);
			downloadingHashes.set(s);

			await apiService.addDownload(downloadRefOf(result));
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
			const byHash = new Map(mgr.items.get().map((r) => [r.hash, r]));
			await Promise.allSettled(hashes.map((hash) => apiService.addDownload(byHash.get(hash) ? downloadRefOf(byHash.get(hash)!) : hash)));
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

	const activeProgress = () => activeTab.get()?.progress ?? 0;

	return tpl.fragment({
		thName: { onclick: () => mgr.sort('name') },
		thProvider: { onclick: () => mgr.sort('provider') },
		thSourceInfo: { onclick: () => mgr.sort('sourceName') },
		thSize: { onclick: () => mgr.sort('size') },
		thSources: { onclick: () => mgr.sort('sourceCount') },
		thCompleted: { onclick: () => mgr.sort('completeSourceCount') },
		thType: { onclick: () => mgr.sort('type') },
		resultsTable: { _ref: (el) => columns.attach(el) },
		columnsBtn: { onclick: (e) => columnsMenu.show(e.currentTarget as HTMLElement, columns) },

		searchInput: {
			_ref: refBindInput(searchQuery),
			onkeydown: (e: KeyboardEvent) => {
				if (e.key === 'Enter') performSearch();
			},
		},
		typeSelect: {
			_ref: refBindSelect(searchType),
		},
		searchBtn: { onclick: performSearch },
		refreshBtn: { onclick: loadResults, disabled: () => activeTab.get() === null },
		providerFilterBlock: {
			style: { display: () => (providerFilterOptions.get().length > 0 ? '' : 'none') },
		},
		providerFilterSelect: {
			_ref: refBindSelect(providerFilter, providerFilterOptions),
		},
		searchTabs: SearchTabsBar({ tabs }),
		resultsList: { inner: () => activeTab.get()?.status ?? '' },
		resultsContainer: {
			inner: () => ResultsRows(visibleResults, { onDownload: (r) => download(r), downloadingHashes, selectionMgr: mgr, onBlacklisted: loadResults }),
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
			_ref: refBindSelect(mgr.mobileSortValue, MOBILE_SORT_OPTIONS),
		},
		searchProgressContainer: {
			style: {
				opacity: () => (activeProgress() === 0 ? '0.5' : ''),
			},
		},
		searchProgressBar: {
			style: {
				width: () => `${Math.min(100, activeProgress() * 100)}%`,
			},
		},
		searchProgressText: {
			inner: () => `${Math.floor(Math.min(1, activeProgress()) * 100)}%`,
		},
		resultsCountLabel: {
			style: { display: () => (visibleResults.get().length > 0 ? '' : 'none') },
			inner: () => {
				const n = visibleResults.get().length;
				return `${n} result${n === 1 ? '' : 's'}`;
			},
		},
		blacklistHiddenLabel: {
			style: { display: () => ((activeTab.get()?.blacklistedCount ?? 0) > 0 ? '' : 'none') },
			inner: () => {
				const n = activeTab.get()?.blacklistedCount ?? 0;
				return n > 0 ? `🚫 ${n} result${n === 1 ? '' : 's'} hidden by blacklist` : '';
			},
		},
	});
});
