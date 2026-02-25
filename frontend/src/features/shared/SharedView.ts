import { component, computed, componentList } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { AmuleApiService, AmuleFile } from '../../services/AmuleApiService';
import { DialogService } from '../../services/DialogService';
import { LocalPrefsService } from '../../services/LocalPrefsService';
import { ListManager } from '../../utils/ListManager';
import { getFileIcon } from '../../utils/icons';
import { fbytes } from '../../utils/formats';
import { smartPoll } from '../../utils/scheduling';
import tpl from './SharedView.html';
import './SharedView.css';

const SharedRows = componentList<AmuleFile, { mgr: ListManager<AmuleFile, keyof AmuleFile> }>(
	(t, i, l, props) => {
		const mgr = props!.mgr;
		const isSelected = computed(() => mgr.selectedHashes.get().has(t.get().hash!));

		return tpl.sharedRow({
			classes: { selected: isSelected },
			onclick: (e) => {
				const hash = t.get().hash;
				if (!hash) return;
				mgr.handleRowSelection(e, hash, l.get());
			},
			nodes: {
				nameCol: {
					nodes: {
						sharedNameText: { inner: () => t.get().name || 'Unknown' },
						sharedIcon: { inner: () => getFileIcon(t.get().name || '') },
						mobileInfo: {
							nodes: {
								mobSize: { inner: () => fbytes(t.get().size) },
								mobRating: { inner: () => t.get().getRating ?? 0 },
								mobXfer: { inner: () => fbytes(t.get().getXferred ?? 0) },
								mobReq: { inner: () => t.get().getRequests ?? 0 },
							},
						},
					},
				},
				sizeCol: { inner: () => fbytes(t.get().size) },
				ratingCol: { inner: () => t.get().getRating ?? 0 },
				requestsCol: { inner: () => (t.get().getRequests ?? 0) + ' (' + (t.get().getAllRequests ?? 0) + ')' },
				transferredCol: { inner: () => fbytes(t.get().getXferred ?? 0) + ' (' + fbytes(t.get().getAllXferred ?? 0) + ')' },
				completeSourcesCol: { inner: () => t.get().getCompleteSources ?? 0 },
			},
		});
	},
	(t) => t.hash
);

const MOBILE_SORT_OPTIONS: any[] = [];

export const SharedView = component(() => {
	const apiService = services.get(AmuleApiService);
	const dialogService = services.get(DialogService);
	const prefs = services.get(LocalPrefsService);

	const mgr = new ListManager<AmuleFile, keyof AmuleFile>({
		defaultColumn: 'name',
		numericColumns: ['size', 'getRating', 'getRequests', 'getCompleteSources', 'getXferred'],
		mobileSortOptions: MOBILE_SORT_OPTIONS,
		prefs: { service: prefs, key: 'shared' },
	});

	const isDisabled = computed(() => mgr.selectedHashes.get().size === 0);

	const loadShared = smartPoll(async () => {
		const data = await apiService.getSharedFiles();
		mgr.items.set(data.list || []);
	}, 2000);

	const deleteSharedFiles = async () => {
		const hashes = [...mgr.selectedHashes.get()];
		if (hashes.length === 0) return;
		try {
			if (!(await dialogService.confirm('Are you sure you want to delete the selected shared files from disk?', 'Delete Files'))) return;
			await Promise.all(hashes.map((hash) => apiService.deleteSharedFile(hash)));
			mgr.clearSelection();
			loadShared();
		} catch (e: any) {
			await dialogService.alert(e.message, 'Error');
		}
	};

	return tpl.fragment({
		thName: { onclick: () => mgr.sort('name') },
		thSize: { onclick: () => mgr.sort('size') },
		thRating: { onclick: () => mgr.sort('getRating') },
		thRequests: { onclick: () => mgr.sort('getRequests') },
		thTransferred: { onclick: () => mgr.sort('getXferred') },
		thCompleteSources: { onclick: () => mgr.sort('getCompleteSources') },

		refreshBtn: { onclick: loadShared },

		cancelBtn: {
			disabled: isDisabled,
			onclick: () => deleteSharedFiles(),
		},

		sharedListContainer: {
			inner: () => (!mgr.hasItems.get() ? tpl.noSharedRow({}) : SharedRows(mgr.sortedItems, { mgr })),
		},
	});
});
