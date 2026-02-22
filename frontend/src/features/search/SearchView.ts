import { component, signal, bindControlledInput, bindControlledSelect, onUnmount, effect } from 'chispa';
import { getFileIcon } from '../../utils/icons';
import { fbytes } from '../../utils/formats';
import { services } from '../../services/container/ServiceContainer';
import { DialogService } from '../../services/DialogService';
import { LocalPrefsService } from '../../services/LocalPrefsService';
import { MediaApiService, SearchResult } from '../../services/MediaApiService';
import { getProviderIcon, getProviderName } from '../../services/ProvidersApiService';
import tpl from './SearchView.html';
import './SearchView.css';

export const SearchView = component(() => {
	const apiService = services.get(MediaApiService);
	const dialogService = services.get(DialogService);
	const prefs = services.get(LocalPrefsService);

	const results = signal<SearchResult[]>([]);
	const statusLog = signal('');
	const searchQuery = signal('');
	const searchType = signal(prefs.get('search.type', 'Global'));
	const downloadLink = signal('');

	const initialSort = prefs.getSort<keyof SearchResult>('search', 'name');
	const sortColumn = signal(initialSort.column);
	const sortDirection = signal(initialSort.direction);

	effect(() => {
		prefs.setSort('search', sortColumn.get(), sortDirection.get());
		prefs.set('search.type', searchType.get());
	});

	const searchProgress = signal(0);
	const addingDownload = signal(false);
	let isPolling = false;

	const performSearch = async () => {
		if (!searchQuery.get()) return;
		try {
			await apiService.search(searchQuery.get(), searchType.get());
			statusLog.set('Search started. Waiting for results...');
			results.set([]);
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
				results.set(data.list);
				statusLog.set(`Found ${data.list.length} results.`);
			} else if (results.get().length === 0) {
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
		try {
			addingDownload.set(true);
			await apiService.addDownload(targetLink);
			console.log('Download added successfully');
			loadResults();
			if (!linkOrHash) downloadLink.set('');
		} catch (e: any) {
			await dialogService.alert('Error adding download: ' + e.message, 'Download Error');
		} finally {
			addingDownload.set(false);
		}
	};

	const sort = (col: keyof SearchResult) => {
		if (sortColumn.get() === col) {
			sortDirection.set(sortDirection.get() === 'asc' ? 'desc' : 'asc');
		} else {
			sortColumn.set(col);
			sortDirection.set('asc');
		}
	};

	return tpl.fragment({
		thName: { onclick: () => sort('name') },
		thProvider: { onclick: () => sort('provider') },
		thSize: { onclick: () => sort('size') },
		thSources: { onclick: () => sort('sources') },
		thCompleted: { onclick: () => sort('completeSources') },
		thType: { onclick: () => sort('type') },

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
			inner: () => {
				let list = [...results.get()];
				const col = sortColumn.get();
				const dir = sortDirection.get();

				if (list.length > 0) {
					list.sort((a, b) => {
						const va = a[col];
						const vb = b[col];

						if (!va) return 1;
						if (!vb) return -1;

						if (col === 'size' || col === 'sources' || col === 'completeSources') {
							const na = va as number;
							const nb = vb as number;
							if (!isNaN(na) && !isNaN(nb)) {
								return dir === 'asc' ? na - nb : nb - na;
							}
						}

						if (va < vb) return dir === 'asc' ? -1 : 1;
						if (va > vb) return dir === 'asc' ? 1 : -1;
						return 0;
					});
				}

				return list.map((res) =>
					tpl.resultRow({
						classes: {
							'status-downloaded': res.downloadStatus === 1,
							'status-queued': res.downloadStatus === 2,
						},
						nodes: {
							nameCol: { title: res.name },
							fileIcon: { inner: getFileIcon(res.name) },
							fileNameText: { inner: res.name },
							mobileInfo: {
								nodes: {
									mobProviderIcon: {
										inner: getProviderIcon(res.provider),
										title: getProviderName(res.provider),
									},
									mobSize: { inner: fbytes(res.size) },
									mobSources: { inner: res.sources ? `${res.sources}` : '0' },
									mobDownloadBtn: { onclick: () => download(res.hash), disabled: addingDownload },
								},
							},
							providerCol: {
								inner: getProviderIcon(res.provider),
								title: getProviderName(res.provider),
							},
							typeCol: { inner: res.type || '' },
							sizeCol: { inner: fbytes(res.size) },
							sourcesCol: { inner: res.sources || '0' },
							completeCol: {
								inner: () => {
									if (!res.sources || !res.completeSources) return '0%';
									const s = parseInt(res.sources);
									const c = parseInt(res.completeSources);
									if (isNaN(s) || isNaN(c) || s === 0) return '0%';
									return `${((c / s) * 100).toFixed(0)}% (${c})`;
								},
							},
							downloadMiniBtn: { onclick: () => download(res.hash), disabled: addingDownload },
						},
					})
				);
			},
		},
		downloadInput: {
			_ref: (el) => {
				bindControlledInput(el, downloadLink);
			},
		},
		downloadBtn: { onclick: () => download() },
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
