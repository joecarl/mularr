import { component, signal, computed, componentList, WritableSignal, bindControlledSelect, effect } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { AmuleApiService, Transfer, Category, AmuleUpDownClient } from '../../services/AmuleApiService';
import { DialogService } from '../../services/DialogService';
import { getFileIcon } from '../../utils/Icons';
import { formatBytes } from '../../utils/formats';
import { smartPoll } from '../../utils/scheduling';
import tpl from './TransfersView.html';
import './TransfersView.css';

const statusMap: Record<number, string> = {
	0: 'Downloading',
	1: 'Empty',
	2: 'Waiting for Hash',
	3: 'Hashing',
	4: 'Error',
	5: 'Insufficient Space',
	6: 'Unknown',
	7: 'Paused',
	8: 'Completing',
	9: 'Completed',
	10: 'Allocating',
};

const fbytes = (bytes?: number) => {
	const b = formatBytes(bytes || 0);
	return `${b.text} ${b.unit}`;
};

interface TransferListProps {
	selectedHash: WritableSignal<string | null>;
}

const TransfersRows = componentList<Transfer, TransferListProps>(
	(t, i, l, props) => {
		const selectedHash = props!.selectedHash;
		const isSelected = computed(() => selectedHash.get() === t.get().hash);
		const addedOn = computed(() => {
			const dt = t.get().addedOn;
			return dt ? new Date(dt).toLocaleString() : '-';
		});

		return tpl.transferRow({
			classes: { selected: isSelected },
			onclick: () => selectedHash.set(t.get().hash || null),
			nodes: {
				nameCol: {
					nodes: {
						fileNameText: { inner: () => t.get().name || 'Unknown' },
						fileIcon: { inner: () => getFileIcon(t.get().name || '') },
					},
				},
				sizeCol: { inner: () => fbytes(t.get().size) },
				categoryCol: { inner: () => t.get().categoryName || '-' },
				completedCol: { inner: () => fbytes(t.get().completed) },
				speedCol: { inner: () => ((t.get().speed ?? 0) > 0 ? fbytes(t.get().speed) + '/s' : '') },
				progressCol: {
					nodes: {
						progressBar: {
							style: { width: () => `${(t.get().progress || 0) * 100}%` },
							classes: { 'transfer-progress-bar-complete': () => !!t.get().isCompleted },
						},
						progressText: { inner: () => ((t.get().progress || 0) * 100).toFixed(1) + '%' },
					},
				},
				sourcesCol: { inner: () => String(t.get().sources || 0) },
				priorityCol: { inner: () => String(t.get().priority || 0) },
				statusCol: {
					inner: () => {
						const tfer = t.get();
						if (tfer.stopped) return 'Stopped';
						if (tfer.isCompleted) return 'Completed';
						return statusMap[tfer.statusId ?? -1] || tfer.status || 'Unknown';
					},
				},
				remainingCol: { inner: () => fbytes(t.get().remaining) },
				addedOnCol: { inner: addedOn },
			},
		});
	},
	(t) => t.hash
);

export const TransfersView = component(() => {
	const apiService = services.get(AmuleApiService);
	const dialogService = services.get(DialogService);

	const transferList = signal<Transfer[]>([]);
	const uploadQueue = signal<AmuleUpDownClient[]>([]);
	const categories = signal<Category[]>([]);
	const selectedHash = signal<string | null>(null);
	const sortColumn = signal<keyof Transfer>('name');
	const sortDirection = signal<'asc' | 'desc'>('asc');

	const isDisabled = computed(() => !selectedHash.get());

	const selectedTransfer = computed(() => {
		const hash = selectedHash.get();
		if (!hash) return null;
		return transferList.get().find((t) => t.hash === hash) || null;
	});

	const canPause = computed(() => {
		const t = selectedTransfer.get();
		if (!t || t.isCompleted) return false;
		return !t.stopped && t.statusId === 0; // 0 is Downloading
	});

	const canResume = computed(() => {
		const t = selectedTransfer.get();
		if (!t || t.isCompleted) return false;
		return t.stopped || t.statusId === 7; // 7 is Paused
	});

	const canStop = computed(() => {
		const t = selectedTransfer.get();
		if (!t || t.isCompleted) return false;
		return !t.stopped;
	});

	const isSelectedCompleted = computed(() => {
		const t = selectedTransfer.get();
		return !!t?.isCompleted;
	});

	const loadTransfers = smartPoll(
		transferList,
		async () => {
			const data = await apiService.getTransfers();
			return data.list || [];
		},
		2000
	);

	const loadUploadQueue = smartPoll(
		uploadQueue,
		async () => {
			const data = await apiService.getUploadQueue();
			return data.list || [];
		},
		2000
	);

	const loadCategories = smartPoll(
		categories,
		async () => {
			const cats = await apiService.getCategories();
			return cats;
		},
		10000
	);

	const sort = (col: keyof Transfer) => {
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
			loadTransfers();
		} catch (e: any) {
			await dialogService.alert(e.message, 'Error');
		}
	};

	const changeCategory = async (catId: number) => {
		const hash = selectedHash.get();
		if (!hash || catId < 0) return;
		try {
			await apiService.setFileCategory(hash, catId);
			loadTransfers();
		} catch (e: any) {
			await dialogService.alert(e.message, 'Error');
		}
	};

	const computedTransferList = computed(() => {
		let list = [...transferList.get()];
		const col = sortColumn.get();
		const dir = sortDirection.get();

		if (list.length > 0 && !(list.length === 1 && !list[0].name && list[0].rawLine)) {
			list.sort((a, b) => {
				const va = a[col];
				const vb = b[col];
				if (va === vb) return 0;
				if (va === undefined) return 1;
				if (vb === undefined) return -1;
				if (va < vb) return dir === 'asc' ? -1 : 1;
				else return dir === 'asc' ? 1 : -1;
			});
		}

		return list;
	});

	const computedTransferListLength = computed(() => computedTransferList.get().length);

	const ctgOptions = computed(() => {
		const opts = [{ value: '-1', label: 'Select Category...' }, ...categories.get().map((c) => ({ value: String(c.id), label: c.name }))];
		return opts;
	});

	const selectedCategoryId = signal('-1');
	effect(() => {
		const currentSelection = selectedHash.get();
		const currentTransfer = transferList.get().find((t) => t.hash === currentSelection);
		const currentCatId = currentTransfer?.categoryId ?? -1;
		selectedCategoryId.set(String(currentCatId));
	});

	return tpl.fragment({
		refreshBtn: { onclick: loadTransfers },
		pauseBtn: {
			disabled: computed(() => !canPause.get()),
			onclick: () => executeCommand('pause'),
		},
		resumeBtn: {
			disabled: computed(() => !canResume.get()),
			onclick: () => executeCommand('resume'),
		},
		stopBtn: {
			disabled: computed(() => !canStop.get()),
			onclick: () => executeCommand('stop'),
		},
		cancelBtn: {
			disabled: isDisabled,
			onclick: () => executeCommand('cancel'),
		},
		catSelect: {
			disabled: isDisabled,
			_ref: (el) => {
				bindControlledSelect(el, selectedCategoryId, ctgOptions);
			},
			onchange: (e: any) => changeCategory(parseInt(e.target.value)),
		},
		clearSelectedBtn: {
			disabled: computed(() => !isSelectedCompleted.get()),
			onclick: async () => {
				const hash = selectedHash.get();
				if (!hash) return;
				if (await dialogService.confirm('Clear this completed file from the list? (The file will remain on disk)', 'Clear Selection')) {
					await apiService.clearCompletedTransfers([hash]);
					selectedHash.set(null);
					loadTransfers();
				}
			},
		},
		clearCompletedBtn: {
			onclick: async () => {
				if (await dialogService.confirm('Clear all completed transfers from the list? (Files will remain on disk)', 'Clear All Completed')) {
					await apiService.clearCompletedTransfers();
					loadTransfers();
				}
			},
		},

		thName: { onclick: () => sort('name') },
		thSize: { onclick: () => sort('size') },
		thCategory: { onclick: () => sort('categoryName') },
		thCompleted: { onclick: () => sort('completed') },
		thSpeed: { onclick: () => sort('speed') },
		thProgress: { onclick: () => sort('progress') },
		thSources: { onclick: () => sort('sources') },
		thPriority: { onclick: () => sort('priority') },
		thStatus: { onclick: () => sort('status') },
		thRemaining: { onclick: () => sort('remaining') },
		thAddedOn: { onclick: () => sort('addedOn') },

		transferListContainer: {
			inner: () => (computedTransferListLength.get() === 0 ? tpl.noTransferRow({}) : TransfersRows(computedTransferList, { selectedHash })),
		},

		sharedListContainer: {
			inner: () => {
				const list = uploadQueue.get();
				if (list.length === 0) return tpl.noSharedRow({});

				return list.map((t) => {
					return tpl.sharedRow({
						nodes: {
							sharedNameCol: {},
							sharedNameText: { inner: t.clientName || 'Unknown' },
							sharedIcon: { inner: '' },
							sharedFileNameCol: { inner: t.uploadFilename || t.remoteFilename || 'Unknown' },
							sharedVersionCol: { inner: t.softVerStr || 'Unknown' },
							sharedSpeedCol: { inner: t.upSpeed ? fbytes(t.upSpeed) + '/s' : '0 B/s' },
							sharedIpCol: { inner: t.userIP || '-' },
							sharedScoreCol: { inner: String(t.score || 0) },
							sharedTransferredCol: { inner: fbytes(t.uploadedTotal || 0) },
						},
					});
				});
			},
		},
	});
});
