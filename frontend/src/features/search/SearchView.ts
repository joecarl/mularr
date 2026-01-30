import { component, signal, bindControlledInput, bindControlledSelect } from 'chispa';
import { apiService } from '../../services/ApiService';
import tpl from './SearchView.html';
import './SearchView.css';

export const SearchView = component(() => {
	const resultsText = signal('');
	const searchQuery = signal('');
	const searchType = signal('Global');
	const downloadLink = signal('');

	const performSearch = async () => {
		if (!searchQuery.get()) return;
		try {
			await apiService.search(searchQuery.get(), searchType.get());
			resultsText.set('Search started. Click refresh to see results.');
		} catch (e: any) {
			alert(e.message);
		}
	};

	const loadResults = async () => {
		try {
			const data = await apiService.getSearchResults();
			resultsText.set(data.raw);
		} catch (e: any) {
			resultsText.set('Error loading results: ' + e.message);
		}
	};

	const download = async () => {
		if (!downloadLink.get()) return;
		try {
			await apiService.addDownload(downloadLink.get());
			alert('Download added');
			downloadLink.set('');
		} catch (e: any) {
			alert(e.message);
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
		resultsList: { inner: resultsText },
		refreshBtn: { onclick: loadResults },
		downloadInput: {
			_ref: (el) => {
				bindControlledInput(el, downloadLink);
			},
		},
		downloadBtn: { onclick: download },
	});
});
