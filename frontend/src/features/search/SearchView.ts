import { component, signal, bindControlledInput, bindControlledSelect } from 'chispa';
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
			statusLog.set('Search started. Wait a few seconds and click Update Results.');
			results.set([]);
		} catch (e: any) {
			alert(e.message);
		}
	};

	const loadResults = async () => {
		try {
			statusLog.set('Loading results...');
			const data = await apiService.getSearchResults();
			if (data.list && data.list.length > 0) {
				results.set(data.list);
				statusLog.set(`Found ${data.list.length} results.`);
			} else {
				results.set([]);
				statusLog.set('No results found yet or search is still in progress.');
			}
		} catch (e: any) {
			statusLog.set('Error loading results: ' + e.message);
		}
	};

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
							nameCol: { inner: res.name, title: res.name },
							sizeCol: { inner: res.size },
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
