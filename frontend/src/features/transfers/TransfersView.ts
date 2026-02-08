import { component, signal, computed, onUnmount, componentList, Signal, WritableSignal, bindControlledSelect, effect } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { AmuleApiService, Transfer, Category, AmuleUpDownClient } from '../../services/AmuleApiService';
import { getFileIcon } from '../../utils/Icons';
import { formatBytes } from '../../utils/formats';
import tpl from './TransfersView.html';
import './TransfersView.css';

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
				statusCol: { inner: () => t.get().status || '' },
				remainingCol: { inner: () => fbytes(t.get().remaining) },
				addedOnCol: { inner: addedOn },
			},
		});
	},
	(t) => t.hash
);

export const TransfersView = component(() => {
	const apiService = services.get(AmuleApiService);

	const transferList = signal<Transfer[]>([]);
	const uploadQueue = signal<AmuleUpDownClient[]>([]);
	const categories = signal<Category[]>([]);
	const selectedHash = signal<string | null>(null);
	const sortColumn = signal<keyof Transfer>('name');
	const sortDirection = signal<'asc' | 'desc'>('asc');
	let loadPromise: Promise<any> | null = null;

	const isDisabled = computed(() => !selectedHash.get());

	const loadTransfers = async () => {
		try {
			const data = await apiService.getTransfers();
			if (data.list) {
				transferList.set(data.list);
			}
		} catch (e: any) {
			console.error('Error loading transfers:', e);
		}
	};

	const loadUploadQueue = async () => {
		try {
			const data = await apiService.getUploadQueue();
			if (data.list) {
				uploadQueue.set(data.list);
			}
			// We can choose to display upload queue in the same list or a separate one. For now, let's just log it.
			console.log('Upload Queue:', data);
		} catch (e: any) {
			console.error('Error loading upload queue:', e);
			// Optionally, we could set an error state here to display in the UI.
			// For example: uploadQueueError.set('Failed to load upload queue');
		}
	};

	const loadCategories = async () => {
		try {
			const cats = await apiService.getCategories();
			categories.set(cats);
		} catch (e: any) {
			console.error('Error loading categories:', e);
		}
	};

	// Auto-update transfers every 2 seconds
	const intervalId = setInterval(() => {
		loadTransfers();
		loadUploadQueue();
	}, 2000);
	onUnmount(() => clearInterval(intervalId));

	loadTransfers();
	loadCategories();
	loadUploadQueue();

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
			if (cmd === 'cancel' && !confirm('Are you sure you want to cancel this download?')) {
				return;
			}
			await apiService.sendDownloadCommand(hash, cmd);
			if (cmd === 'cancel') selectedHash.set(null);
			loadTransfers();
		} catch (e: any) {
			alert(e.message);
		}
	};

	const changeCategory = async (catId: number) => {
		const hash = selectedHash.get();
		if (!hash || catId < 0) return;
		try {
			await apiService.setFileCategory(hash, catId);
			loadTransfers();
		} catch (e: any) {
			alert(e.message);
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
			disabled: isDisabled,
			onclick: () => executeCommand('pause'),
		},
		resumeBtn: {
			disabled: isDisabled,
			onclick: () => executeCommand('resume'),
		},
		stopBtn: {
			disabled: isDisabled,
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
		clearCompletedBtn: {
			onclick: async () => {
				await apiService.clearCompletedTransfers();
				loadTransfers();
			},
		},

		thName: { onclick: () => sort('name') },
		thSize: { onclick: () => sort('size') },
		thCategory: { onclick: () => sort('categoryId') },
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
							sharedNameCol: {
								nodes: {
									sharedNameText: { inner: t.clientName || 'Unknown' },
									sharedIcon: { inner: '' },
								},
							},
							sharedFileNameCol: { inner: t.remoteFilename || 'Unknown' },
							sharedVersionCol: { inner: t.softVerStr || 'Unknown' },
							sharedSpeedCol: { inner: t.speedUp ? fbytes(t.speedUp) + '/s' : '0 B/s' },
							sharedIpCol: { inner: t.userIP || '-' },
							sharedScoreCol: { inner: String(t.score || 0) },
							sharedTransferredCol: { inner: fbytes(t.xferUp || 0) },
						},
					});
				});
			},
		},
	});
});
