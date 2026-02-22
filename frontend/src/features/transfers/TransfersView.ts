import { component, signal, computed, componentList, WritableSignal, effect, bindControlledSelect } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { AmuleApiService, AmuleUpDownClient } from '../../services/AmuleApiService';
import { MediaApiService, Transfer, Category } from '../../services/MediaApiService';
import { DialogService } from '../../services/DialogService';
import { LocalPrefsService } from '../../services/LocalPrefsService';
import { getFileIcon } from '../../utils/icons';
import { fbytes, formatRemaining } from '../../utils/formats';
import { smartPoll } from '../../utils/scheduling';
import tpl from './TransfersView.html';
import './TransfersView.css';
import { getProviderIcon, getProviderName } from '../../services/ProvidersApiService';

const NULL_VALUE = '-1';
const DEFAULT_VALUE = 'default';

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

interface TransferListProps {
	selectedHashes: WritableSignal<Set<string>>;
	lastClickedHash: WritableSignal<string | null>;
}

const TransfersRows = componentList<Transfer, TransferListProps>(
	(t, i, l, props) => {
		const selectedHashes = props!.selectedHashes;
		const lastClickedHash = props!.lastClickedHash;
		const isSelected = computed(() => selectedHashes.get().has(t.get().hash || ''));
		const addedOn = computed(() => {
			const dt = t.get().addedOn;
			return dt ? new Date(dt).toLocaleString() : '-';
		});

		return tpl.transferRow({
			classes: { selected: isSelected },
			onclick: (e: MouseEvent) => {
				const hash = t.get().hash;
				if (!hash) return;
				const current = selectedHashes.get();

				if (e.shiftKey && lastClickedHash.get()) {
					// Range selection
					const list = l.get();
					const anchorIdx = list.findIndex((x) => x.hash === lastClickedHash.get());
					const targetIdx = list.findIndex((x) => x.hash === hash);
					if (anchorIdx !== -1 && targetIdx !== -1) {
						const lo = Math.min(anchorIdx, targetIdx);
						const hi = Math.max(anchorIdx, targetIdx);
						const next = e.ctrlKey || e.metaKey ? new Set(current) : new Set<string>();
						for (let k = lo; k <= hi; k++) {
							const h = list[k].hash;
							if (h) next.add(h);
						}
						selectedHashes.set(next);
					}
				} else if (e.ctrlKey || e.metaKey) {
					// Toggle individual
					const next = new Set(current);
					if (next.has(hash)) {
						next.delete(hash);
					} else {
						next.add(hash);
					}
					selectedHashes.set(next);
					lastClickedHash.set(hash);
				} else {
					// Normal click: select only this row
					selectedHashes.set(new Set([hash]));
					lastClickedHash.set(hash);
				}
			},
			nodes: {
				nameCol: {
					nodes: {
						fileNameText: { inner: () => t.get().name || 'Unknown' },
						fileIcon: { inner: () => getFileIcon(t.get().name || '') },
						mobileInfo: {
							nodes: {
								mobProviderIcon: {
									inner: () => getProviderIcon(t.get().provider),
									title: () => getProviderName(t.get().provider),
								},
								mobSize: { inner: () => fbytes(t.get().size) },
								mobStatus: {
									inner: () => {
										const tfer = t.get();
										if (tfer.stopped) return 'Stopped';
										if (tfer.isCompleted) return 'Completed';
										return statusMap[tfer.statusId ?? -1] || tfer.status || 'Unknown';
									},
								},
								mobSpeed: {
									inner: () => ((t.get().speed ?? 0) > 0 ? fbytes(t.get().speed) + '/s' : ''),
									style: { display: () => ((t.get().speed ?? 0) > 0 ? 'inline' : 'none') },
								},
								mobProgress: { inner: () => ((t.get().progress || 0) * 100).toFixed(1) + '%' },
								mobProgressBar: { style: { width: () => `${(t.get().progress || 0) * 100}%` } },
							},
						},
					},
				},
				providerCol: {
					inner: () => getProviderIcon(t.get().provider),
					title: () => getProviderName(t.get().provider),
				},
				sizeCol: { inner: () => fbytes(t.get().size) },
				categoryCol: { inner: () => (t.get().categoryName === DEFAULT_VALUE ? '-' : (t.get().categoryName ?? '-')) },
				completedCol: { inner: () => fbytes(t.get().completed) },
				speedCol: { inner: () => ((t.get().speed ?? 0) > 0 ? fbytes(t.get().speed) + '/s' : '') },
				progressCol: {
					nodes: {
						progressBar: {
							style: { width: () => `${(t.get().progress || 0) * 100}%` },
							addClass: () => {
								if (t.get().stopped || t.get().statusId === 7) return 'transfer-progress-bar-paused';
								if (t.get().isCompleted) return 'transfer-progress-bar-complete';
								return '';
							},
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
				remainingCol: { inner: () => formatRemaining(t.get().remaining, t.get().speed) },
				addedOnCol: { inner: addedOn },
			},
		});
	},
	(t) => t.hash
);

export const TransfersView = component(() => {
	const apiService = services.get(AmuleApiService);
	const mediaService = services.get(MediaApiService);
	const dialogService = services.get(DialogService);
	const prefs = services.get(LocalPrefsService);

	const transferList = signal<Transfer[]>([]);
	const uploadQueue = signal<AmuleUpDownClient[]>([]);
	const categories = signal<Category[]>([]);
	const selectedHashes = signal<Set<string>>(new Set());
	const lastClickedHash = signal<string | null>(null);

	const initialSort = prefs.getSort<keyof Transfer>('transfers', 'name');
	const sortColumn = signal(initialSort.column);
	const sortDirection = signal(initialSort.direction);

	effect(() => {
		prefs.setSort('transfers', sortColumn.get(), sortDirection.get());
	});

	const isDisabled = computed(() => selectedHashes.get().size === 0);

	const selectedTransfersSingle = computed(() => {
		const hashes = selectedHashes.get();
		if (hashes.size !== 1) return null;
		const [hash] = hashes;
		return transferList.get().find((t) => t.hash === hash) || null;
	});

	const canPause = computed(() => {
		const t = selectedTransfersSingle.get();
		if (!t || t.isCompleted) return false;
		return !t.stopped && t.statusId === 0; // 0 is Downloading
	});

	const canResume = computed(() => {
		const t = selectedTransfersSingle.get();
		if (!t || t.isCompleted) return false;
		return t.stopped || t.statusId === 7; // 7 is Paused
	});

	const canStop = computed(() => {
		const t = selectedTransfersSingle.get();
		if (!t || t.isCompleted) return false;
		return !t.stopped;
	});

	const isSelectedCompleted = computed(() => {
		const t = selectedTransfersSingle.get();
		return !!t?.isCompleted;
	});

	const selectionCount = computed(() => selectedHashes.get().size);

	const loadTransfers = smartPoll(async () => {
		const data = await mediaService.getTransfers();
		transferList.set(data.list || []);
		categories.set(data.categories || []);
	}, 2000);

	const loadUploadQueue = smartPoll(async () => {
		const data = await apiService.getUploadQueue();
		uploadQueue.set(data.list || []);
	}, 2000);

	const sort = (col: keyof Transfer) => {
		if (sortColumn.get() === col) {
			sortDirection.set(sortDirection.get() === 'asc' ? 'desc' : 'asc');
		} else {
			sortColumn.set(col);
			sortDirection.set('asc');
		}
	};

	const executeCommand = async (cmd: 'pause' | 'resume' | 'stop' | 'cancel') => {
		const hashes = [...selectedHashes.get()];
		if (hashes.length === 0) return;
		try {
			if (cmd === 'cancel' && !(await dialogService.confirm('Are you sure you want to cancel the selected downloads?', 'Cancel Download'))) {
				return;
			}
			await Promise.all(hashes.map((hash) => mediaService.sendDownloadCommand(hash, cmd)));
			if (cmd === 'cancel') selectedHashes.set(new Set());
			loadTransfers();
		} catch (e: any) {
			await dialogService.alert(e.message, 'Error');
		}
	};

	const changeCategory = async (catName: string) => {
		const hashes = [...selectedHashes.get()];
		if (hashes.length === 0 || catName === NULL_VALUE) return;
		try {
			let catId: number;
			if (catName === DEFAULT_VALUE) {
				catId = 0;
			} else {
				const cat = categories.get().find((c) => c.name === catName);
				if (!cat) throw new Error('Selected category not found');
				catId = cat.id;
			}
			await Promise.all(hashes.map((hash) => mediaService.setFileCategory(hash, catId)));
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

	const transferListLength = computed(() => computedTransferList.get().length);

	const ctgOptions = computed(() => {
		const opts = [
			{ value: NULL_VALUE, label: 'Select Category...' },
			...categories.get().map((c) => (c.id === 0 ? { value: DEFAULT_VALUE, label: 'Default' } : { value: c.name, label: c.name })),
		];
		return opts;
	});

	const selectedCategoryName = signal(NULL_VALUE);
	effect(() => {
		// Show current category only when exactly one item is selected
		const singleTransfer = selectedTransfersSingle.get();
		const currentCatName = singleTransfer?.categoryName ?? DEFAULT_VALUE;
		selectedCategoryName.set(singleTransfer ? currentCatName : NULL_VALUE);
	});

	return tpl.fragment({
		refreshBtn: { onclick: loadTransfers },
		pauseBtn: {
			disabled: () => !canPause.get(),
			onclick: () => executeCommand('pause'),
		},
		resumeBtn: {
			disabled: () => !canResume.get(),
			onclick: () => executeCommand('resume'),
		},
		stopBtn: {
			disabled: () => !canStop.get(),
			onclick: () => executeCommand('stop'),
		},
		cancelBtn: {
			disabled: isDisabled,
			onclick: () => executeCommand('cancel'),
		},
		catSelect: {
			disabled: isDisabled,
			_ref: (el) => {
				bindControlledSelect(el, selectedCategoryName, ctgOptions);
			},
			onchange: (e: any) => changeCategory(e.target.value),
		},
		selectionCountLabel: {
			inner: () => {
				const n = selectionCount.get();
				return n === 0 ? '' : `${n} selected`;
			},
		},
		clearSelectedBtn: {
			disabled: () => !isSelectedCompleted.get(),
			onclick: async () => {
				const hashes = [...selectedHashes.get()];
				if (hashes.length === 0) return;
				if (await dialogService.confirm('Clear the selected completed files from the list? (The files will remain on disk)', 'Clear Selection')) {
					await Promise.all(hashes.map((hash) => mediaService.clearCompletedTransfers([hash])));
					selectedHashes.set(new Set());
					loadTransfers();
				}
			},
		},
		clearCompletedBtn: {
			onclick: async () => {
				if (await dialogService.confirm('Clear all completed transfers from the list? (Files will remain on disk)', 'Clear All Completed')) {
					await mediaService.clearCompletedTransfers();
					loadTransfers();
				}
			},
		},

		thName: { onclick: () => sort('name') },
		thSize: { onclick: () => sort('size') },
		thProvider: { onclick: () => sort('provider') },
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
			inner: () => (transferListLength.get() === 0 ? tpl.noTransferRow({}) : TransfersRows(computedTransferList, { selectedHashes, lastClickedHash })),
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
