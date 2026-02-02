import { component, signal, bindControlledInput, bindControlledSelect, onUnmount } from 'chispa';
import { ApiService, SearchResult } from '../../services/ApiService';
import { getFileIcon } from '../../utils/Icons';
import tpl from './SearchView.html';
import './SearchView.css';

export const SearchView = component(() => {
	const apiService = ApiService.getInstance();
	const results = signal<SearchResult[]>([]);
	const statusLog = signal('');
	const searchQuery = signal('');
	const searchType = signal('Global');
	const downloadLink = signal('');
	const sortColumn = signal<keyof SearchResult>('name');
	const sortDirection = signal<'asc' | 'desc'>('asc');

	const performSearch = async () => {
		if (!searchQuery.get()) return;
		try {
			await apiService.search(searchQuery.get(), searchType.get());
			statusLog.set('Search started. Waiting for results...');
			results.set([]);
		} catch (e: any) {
			alert(e.message);
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

	// Auto-update results every 3 seconds
	const intervalId = setInterval(loadResults, 3000);
	onUnmount(() => clearInterval(intervalId));

	// Initial load in case there are results from a previous search
	loadResults();

	const download = async (link?: string) => {
		const targetLink = link || downloadLink.get();
		if (!targetLink) return;
		try {
			await apiService.addDownload(targetLink);
			alert('Download added successfully');
			if (!link) downloadLink.set('');
		} catch (e: any) {
			alert('Error adding download: ' + e.message);
		}
	};

	const formatSize = (sizeStr: string) => {
		if (sizeStr === 'Unknown') return sizeStr;

		// Try to extract number and unit
		const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]*)$/);
		if (!match) return sizeStr;

		let val = parseFloat(match[1]);
		let unit = match[2].toUpperCase() || 'MB'; // Default to MB if no unit (amulecmd default)

		// Convert everything to MB first for easier handling if needed
		let sizeInMB = val;
		if (unit === 'KB') sizeInMB = val / 1024;
		else if (unit === 'GB') sizeInMB = val * 1024;
		else if (unit === 'B') sizeInMB = val / (1024 * 1024);

		if (sizeInMB < 1) {
			return `${(sizeInMB * 1024).toFixed(2)} KB`;
		} else if (sizeInMB >= 1024) {
			return `${(sizeInMB / 1024).toFixed(2)} GB`;
		} else {
			return `${sizeInMB.toFixed(2)} MB`;
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
		thSize: { onclick: () => sort('size') },
		thSources: { onclick: () => sort('sources') },
		thCompleted: { onclick: () => sort('completeSources') },
		thType: { onclick: () => sort('type') },

		searchInput: {
			_ref: (el) => {
				bindControlledInput(el, searchQuery);
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
							const na = parseFloat(va);
							const nb = parseFloat(vb);
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
						nodes: {
							nameCol: { title: res.name },
							fileIcon: { inner: getFileIcon(res.name) },
							fileNameText: { inner: res.name },
							typeCol: { inner: res.type || '' },
							sizeCol: { inner: formatSize(res.size) },
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
							downloadMiniBtn: { onclick: () => download(res.link) },
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
	});
});
