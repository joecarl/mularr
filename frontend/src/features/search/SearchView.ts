import { component, signal, bindControlledInput, bindControlledSelect, onUnmount } from 'chispa';
import { ApiService, SearchResult } from '../../services/ApiService';
import tpl from './SearchView.html';
import './SearchView.css';

export const SearchView = component(() => {
	const apiService = ApiService.getInstance();
	const results = signal<SearchResult[]>([]);
	const statusLog = signal('');
	const searchQuery = signal('');
	const searchType = signal('Global');
	const downloadLink = signal('');

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

	const getFileIcon = (filename: string) => {
		const ext = filename.split('.').pop()?.toLowerCase() || '';
		const videos = ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'mpg', 'mpeg', 'divx'];
		const audio = ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'wma'];
		const images = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff'];
		const archives = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'];
		const documents = ['pdf', 'doc', 'docx', 'txt', 'epub', 'rtf', 'odt'];
		const isos = ['iso', 'bin', 'cue', 'nrg', 'img'];

		if (videos.includes(ext)) return '🎬';
		if (audio.includes(ext)) return '🎵';
		if (images.includes(ext)) return '🖼️';
		if (archives.includes(ext)) return '📦';
		if (documents.includes(ext)) return '📄';
		if (isos.includes(ext)) return '💿';
		if (ext === 'exe' || ext === 'msi') return '⚙️';

		return '📄';
	};

	return tpl.fragment({
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
			inner: () =>
				results.get().map((res) =>
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
				),
		},
		downloadInput: {
			_ref: (el) => {
				bindControlledInput(el, downloadLink);
			},
		},
		downloadBtn: { onclick: () => download() },
	});
});
