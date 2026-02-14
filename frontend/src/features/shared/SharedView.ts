import { component, signal, computed, componentList, WritableSignal, effect } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { AmuleApiService, AmuleFile } from '../../services/AmuleApiService';
import { DialogService } from '../../services/DialogService';
import { LocalPrefsService } from '../../services/LocalPrefsService';
import { getFileIcon } from '../../utils/icons';
import { fbytes } from '../../utils/formats';
import { smartPoll } from '../../utils/scheduling';
import tpl from './SharedView.html';
import './SharedView.css';

const SharedRows = componentList<AmuleFile, { selectedHash: WritableSignal<string | null> }>(
	(t, i, l, props) => {
		const selectedHash = props!.selectedHash;
		const isSelected = computed(() => selectedHash.get() === t.get().hash);

		return tpl.sharedRow({
			classes: { selected: isSelected },
			onclick: () => selectedHash.set(t.get().hash || null),
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

export const SharedView = component(() => {
	const apiService = services.get(AmuleApiService);
	const dialogService = services.get(DialogService);
	const prefs = services.get(LocalPrefsService);

	const sharedList = signal<AmuleFile[]>([]);
	const selectedHash = signal<string | null>(null);

	const initialSort = prefs.getSort<keyof AmuleFile>('shared', 'name');
	const sortColumn = signal(initialSort.column);
	const sortDirection = signal(initialSort.direction);

	effect(() => {
		prefs.setSort('shared', sortColumn.get(), sortDirection.get());
	});

	const isDisabled = computed(() => !selectedHash.get());

	const loadShared = smartPoll(async () => {
		const data = await apiService.getSharedFiles();
		sharedList.set(data.list || []);
	}, 2000);

	const sort = (col: keyof AmuleFile) => {
		if (sortColumn.get() === col) {
			sortDirection.set(sortDirection.get() === 'asc' ? 'desc' : 'asc');
		} else {
			sortColumn.set(col);
			sortDirection.set('asc');
		}
	};

	const executeCommand = async (cmd: 'pause' | 'resume' | 'stop' | 'cancel') => {
		const hash = selectedHash.get();
		if (!hash) return;
		try {
			if (cmd === 'cancel' && !(await dialogService.confirm('Are you sure you want to cancel this download?', 'Cancel Download'))) {
				return;
			}
			await apiService.sendDownloadCommand(hash, cmd);
			if (cmd === 'cancel') selectedHash.set(null);
			loadShared();
		} catch (e: any) {
			await dialogService.alert(e.message, 'Error');
		}
	};

	const sharedListLength = computed(() => sharedList.get().length);

	return tpl.fragment({
		refreshBtn: { onclick: loadShared },

		cancelBtn: {
			disabled: isDisabled,
			onclick: () => executeCommand('cancel'),
		},

		sharedListContainer: {
			inner: () => (sharedListLength.get() === 0 ? tpl.noSharedRow({}) : SharedRows(sharedList, { selectedHash })),
		},
	});
});
