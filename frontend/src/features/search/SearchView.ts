import { component, signal, bindControlledInput, bindControlledSelect, onUnmount, effect, computed, componentList, Signal } from 'chispa';
import { getFileIcon } from '../../utils/icons';
import { fbytes } from '../../utils/formats';
import { ListManager, RowSelectionManager } from '../../utils/ListManager';
import { services } from '../../services/container/ServiceContainer';
import { DialogService } from '../../services/DialogService';
import { LocalPrefsService } from '../../services/LocalPrefsService';
import { MediaApiService, SearchResult } from '../../services/MediaApiService';
import { getProviderIcon, getProviderName } from '../../services/ProvidersApiService';
import tpl from './SearchView.html';
import './SearchView.css';

const MOBILE_SORT_OPTIONS: { value: string; label: string; col: keyof SearchResult; dir: 'asc' | 'desc' }[] = [
	{ value: 'name-asc', label: 'Name A→Z', col: 'name', dir: 'asc' },
	{ value: 'name-desc', label: 'Name Z→A', col: 'name', dir: 'desc' },
	{ value: 'provider-asc', label: 'Provider A→Z', col: 'provider', dir: 'asc' },
	{ value: 'provider-desc', label: 'Provider Z→A', col: 'provider', dir: 'desc' },
	{ value: 'sources-asc', label: 'Sources ↑', col: 'sources', dir: 'asc' },
	{ value: 'sources-desc', label: 'Sources ↓', col: 'sources', dir: 'desc' },
	{ value: 'size-asc', label: 'Size ↑', col: 'size', dir: 'asc' },
	{ value: 'size-desc', label: 'Size ↓', col: 'size', dir: 'desc' },
];

interface ResultsRowsProps {
	onDownload: (linkOrHash: string) => void;
	downloadingHashes: Signal<Set<string>>;
	selectionMgr: RowSelectionManager;
}
const ResultsRows = componentList<SearchResult, ResultsRowsProps>(
	(res, i, l, props) => {
		const onDownload = props!.onDownload;
		const downloadingHashes = props!.downloadingHashes;
		const selectionMgr = props!.selectionMgr;
		const isSelected = computed(() => selectionMgr.selectedHashes.get().has(res.get().hash || ''));
		const isDownloading = computed(() => downloadingHashes.get().has(res.get().hash || ''));

		return tpl.resultRow({
			classes: {
				'status-downloaded': () => res.get().downloadStatus === 1,
				'status-queued': () => res.get().downloadStatus === 2,
				selected: isSelected,
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
						mobSources: { inner: () => (res.get().sources ? `${res.get().sources}` : '0') },
						mobDownloadBtn: {
							onclick: (e: MouseEvent) => {
								e.stopPropagation();
								onDownload(res.get().hash);
							},
							disabled: isDownloading,
						},
					},
				},
				providerCol: {
					inner: () => getProviderIcon(res.get().provider),
					title: () => getProviderName(res.get().provider),
				},
				typeCol: { inner: () => res.get().type || '' },
				sizeCol: { inner: () => fbytes(res.get().size) },
				sourcesCol: { inner: () => res.get().sources || '0' },
				completeCol: {
					inner: () => {
						const r = res.get();
						if (!r.sources || !r.completeSources) return '0%';
						const s = parseInt(r.sources);
						const c = parseInt(r.completeSources);
						if (isNaN(s) || isNaN(c) || s === 0) return '0%';
						return `${((c / s) * 100).toFixed(0)}% (${c})`;
					},
				},
				downloadMiniBtn: {
					onclick: (e: MouseEvent) => {
						e.stopPropagation();
						onDownload(res.get().hash);
					},
					disabled: isDownloading,
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
	const downloadLink = signal('');

	const mgr = new ListManager<SearchResult, keyof SearchResult>({
		defaultColumn: 'name',
		numericColumns: ['size', 'sources', 'completeSources'],
		mobileSortOptions: MOBILE_SORT_OPTIONS,
		prefs: { service: prefs, key: 'search' },
	});

	effect(() => {
		prefs.set('search.type', searchType.get());
	});

	const searchProgress = signal(0);
	const downloadingHashes = signal<Set<string>>(new Set());

	let isPolling = false;

	const performSearch = async () => {
		if (!searchQuery.get()) return;
		try {
			await apiService.search(searchQuery.get(), searchType.get());
			statusLog.set('Search started. Waiting for results...');
			mgr.items.set([]);
			searchProgress.set(0);
			startPolling();
		} catch (e: any) {
			await dialogService.alert(e.message, 'Search Error');
		}
	};

	const loadSearchStatus = async () => {
		try {
			const status = await apiService.getSearchStatus();
			// Progress comes as 0 to 1 from backend
			searchProgress.set(status.progress);
			return status.progress;
		} catch (e: any) {
			console.error('Error loading search status:', e);
			return 1; // Stop polling on error
		}
	};

	const loadResults = async () => {
		try {
			const data = await apiService.getSearchResults();
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

			if (progress >= 1 || progress === 0) {
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

	const download = async (linkOrHash?: string) => {
		const targetLink = linkOrHash || downloadLink.get();
		if (!targetLink) return;
		const isHashDownload = !!linkOrHash;
		try {
			if (isHashDownload) {
				const s = new Set(downloadingHashes.get());
				s.add(linkOrHash);
				downloadingHashes.set(s);
			}
			await apiService.addDownload(targetLink);
			console.log('Download added successfully');
			loadResults();
			if (!isHashDownload) downloadLink.set('');
			if (isHashDownload) mgr.clearSelection();
		} catch (e: any) {
			await dialogService.alert('Error adding download: ' + e.message, 'Download Error');
		} finally {
			if (isHashDownload) {
				const s = new Set(downloadingHashes.get());
				s.delete(linkOrHash);
				downloadingHashes.set(s);
			}
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
		thSize: { onclick: () => mgr.sort('size') },
		thSources: { onclick: () => mgr.sort('sources') },
		thCompleted: { onclick: () => mgr.sort('completeSources') },
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
			inner: () => ResultsRows(mgr.sortedItems, { onDownload: (linkOrHash) => download(linkOrHash), downloadingHashes, selectionMgr: mgr }),
		},
		downloadInput: {
			_ref: (el) => {
				bindControlledInput(el, downloadLink);
			},
		},
		downloadBtn: { onclick: () => download() },
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
	});
});
