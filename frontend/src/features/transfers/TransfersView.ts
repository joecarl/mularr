import { component, signal, computed, bindControlledSelect } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { AmuleApiService, AmuleUpDownClient } from '../../services/AmuleApiService';
import { MediaApiService, Transfer, Category } from '../../services/MediaApiService';
import { DialogService } from '../../services/DialogService';
import { LocalPrefsService } from '../../services/LocalPrefsService';
import { fbytes } from '../../utils/formats';
import { smartPoll } from '../../utils/scheduling';
import { ListManager } from '../../utils/ListManager';
import tpl from './TransfersView.html';
import './TransfersView.css';
import { DEFAULT_VALUE, TransfersRows } from './TransferRows';

export const NULL_VALUE = '-1';

const MOBILE_SORT_OPTIONS: { value: string; label: string; col: keyof Transfer; dir: 'asc' | 'desc' }[] = [
	{ value: 'added-asc', label: 'Added ↑', col: 'addedOn', dir: 'asc' },
	{ value: 'added-desc', label: 'Added ↓', col: 'addedOn', dir: 'desc' },
	{ value: 'name-asc', label: 'Name A→Z', col: 'name', dir: 'asc' },
	{ value: 'name-desc', label: 'Name Z→A', col: 'name', dir: 'desc' },
	{ value: 'sources-asc', label: 'Sources ↑', col: 'sources', dir: 'asc' },
	{ value: 'sources-desc', label: 'Sources ↓', col: 'sources', dir: 'desc' },
	{ value: 'provider-asc', label: 'Provider A→Z', col: 'provider', dir: 'asc' },
	{ value: 'provider-desc', label: 'Provider Z→A', col: 'provider', dir: 'desc' },
];

function hashesToTransfers(hashes: Set<string>, list: Transfer[]): Transfer[] {
	const selected: Transfer[] = [];
	for (const hash of hashes) {
		const t = list.find((x) => x.hash === hash);
		if (t) selected.push(t);
	}
	return selected;
}

export const TransfersView = component(() => {
	const apiService = services.get(AmuleApiService);
	const mediaService = services.get(MediaApiService);
	const dialogService = services.get(DialogService);
	const prefs = services.get(LocalPrefsService);

	const mgr = new ListManager<Transfer, keyof Transfer>({
		defaultColumn: 'name',
		skipSort: (list) => list.length === 1 && !list[0].name && !!list[0].rawLine,
		mobileSortOptions: MOBILE_SORT_OPTIONS,
		prefs: { service: prefs, key: 'transfers' },
	});

	const uploadQueue = signal<AmuleUpDownClient[]>([]);
	const categories = signal<Category[]>([]);
	const selectCategoryName = signal(NULL_VALUE);

	const isDisabled = computed(() => !mgr.hasSelection.get());

	const selectedTransfersSingle = computed(() => {
		const hashes = mgr.selectedHashes.get();
		if (hashes.size !== 1) return null;
		const [hash] = hashes;
		return mgr.items.get().find((t) => t.hash === hash) || null;
	});

	const canPause = computed(() => {
		const selection = hashesToTransfers(mgr.selectedHashes.get(), mgr.items.get());
		for (const t of selection) {
			if (!t.isCompleted && !t.stopped && t.statusId === 0) return true;
		}
		return false;
	});

	const canResume = computed(() => {
		const selection = hashesToTransfers(mgr.selectedHashes.get(), mgr.items.get());
		for (const t of selection) {
			if (!t.isCompleted && (t.stopped || t.statusId === 7)) return true;
		}
		return false;
	});

	const canStop = computed(() => {
		const selection = hashesToTransfers(mgr.selectedHashes.get(), mgr.items.get());
		for (const t of selection) {
			if (t.provider === 'amule' && !t.isCompleted && !t.stopped) return true;
		}
		return false;
	});

	const isSelectedCompleted = computed(() => {
		const t = selectedTransfersSingle.get();
		return !!t?.isCompleted;
	});

	const loadTransfers = smartPoll(async () => {
		const data = await mediaService.getTransfers();
		mgr.items.set(data.list || []);
		categories.set(data.categories || []);
	}, 2000);

	const loadUploadQueue = smartPoll(async () => {
		const data = await apiService.getUploadQueue();
		uploadQueue.set(data.list || []);
	}, 2000);

	const executeCommand = async (cmd: 'pause' | 'resume' | 'stop' | 'cancel') => {
		const hashes = [...mgr.selectedHashes.get()];
		if (hashes.length === 0) return;
		try {
			if (cmd === 'cancel' && !(await dialogService.confirm('Are you sure you want to cancel the selected downloads?', 'Cancel Download'))) {
				return;
			}
			await Promise.all(hashes.map((hash) => mediaService.sendDownloadCommand(hash, cmd)));
			if (cmd === 'cancel') mgr.clearSelection();
			loadTransfers();
		} catch (e: any) {
			await dialogService.alert(e.message, 'Error');
		}
	};

	const changeCategory = async (catName: string) => {
		const hashes = [...mgr.selectedHashes.get()];
		if (hashes.length === 0 || catName === NULL_VALUE) return;
		try {
			const allCats = categories.get();
			let catId: number;
			if (catName === DEFAULT_VALUE) {
				catId = 0;
			} else {
				const cat = allCats.find((c) => c.name === catName);
				if (!cat) throw new Error('Selected category not found');
				catId = cat.id;
			}

			// If completed files would actually change directory, ask confirmation before proceeding.
			// Answering No aborts the entire category change.
			let moveFiles = false;
			const destCat = allCats.find((c) => c.id === catId);
			const destPath = destCat?.resolvedPath ?? destCat?.path ?? '';
			if (destPath) {
				const completedThatMove = hashesToTransfers(new Set(hashes), mgr.items.get()).filter((t) => {
					if (!t.isCompleted) return false;
					const srcCat = allCats.find((c) => c.name === (t.categoryName ?? ''));
					const srcPath = srcCat?.resolvedPath ?? srcCat?.path ?? '';
					console.log('Comparing paths for completed file:', t.name, 'src:', srcPath, 'dest:', destPath);
					return srcPath !== destPath;
				});
				if (completedThatMove.length > 0) {
					const confirmed = await dialogService.confirm(
						`Change category and move ${completedThatMove.length === 1 ? 'the completed file' : `${completedThatMove.length} completed files`} to the new directory?\n\nDestination: ${destPath}`,
						'Change Category'
					);
					if (!confirmed) {
						selectCategoryName.set(NULL_VALUE);
						return;
					}
					moveFiles = true;
				}
			}

			await Promise.all(hashes.map((hash) => mediaService.setFileCategory(hash, catId, moveFiles)));
			loadTransfers();
		} catch (e: any) {
			await dialogService.alert(e.message, 'Error');
		}
	};

	const ctgOptions = computed(() => {
		const opts = [
			{ value: NULL_VALUE, label: 'Select Category...', disabled: true },
			...categories.get().map((c) => (c.id === 0 ? { value: DEFAULT_VALUE, label: 'Default' } : { value: c.name, label: c.name })),
		];
		return opts;
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
				bindControlledSelect(el, selectCategoryName, ctgOptions);
			},
			onchange: (e: any) => changeCategory(e.target.value),
		},
		selectionCountLabel: {
			inner: () => {
				const n = mgr.selectionCount.get();
				return n === 0 ? '' : `${n} selected`;
			},
		},
		clearSelectedBtn: {
			disabled: () => !isSelectedCompleted.get(),
			onclick: async () => {
				const hashes = [...mgr.selectedHashes.get()];
				if (hashes.length === 0) return;
				if (await dialogService.confirm('Clear the selected completed files from the list? (The files will remain on disk)', 'Clear Selection')) {
					await Promise.all(hashes.map((hash) => mediaService.clearCompletedTransfers([hash])));
					mgr.clearSelection();
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

		mobileSortSelect: {
			_ref: (el: HTMLSelectElement) => {
				bindControlledSelect(el, mgr.mobileSortValue, MOBILE_SORT_OPTIONS);
			},
		},
		thName: { onclick: () => mgr.sort('name') },
		thSize: { onclick: () => mgr.sort('size') },
		thProvider: { onclick: () => mgr.sort('provider') },
		thCategory: { onclick: () => mgr.sort('categoryName') },
		thCompleted: { onclick: () => mgr.sort('completed') },
		thSpeed: { onclick: () => mgr.sort('speed') },
		thProgress: { onclick: () => mgr.sort('progress') },
		thSources: { onclick: () => mgr.sort('sources') },
		thPriority: { onclick: () => mgr.sort('priority') },
		thStatus: { onclick: () => mgr.sort('status') },
		thRemaining: { onclick: () => mgr.sort('remaining') },
		thAddedOn: { onclick: () => mgr.sort('addedOn') },

		transferListContainer: {
			inner: () =>
				mgr.sortedItems.get().length === 0
					? tpl.noTransferRow({})
					: TransfersRows(mgr.sortedItems, {
							selectionMgr: mgr,
							onRowClick: (hash) => {
								const current = mgr.selectedHashes.get();

								// Show current category only when exactly one item is selected
								const singleTransfer = current.size === 1 ? mgr.items.get().find((t) => t.hash === hash) : null;
								const currentCatName = singleTransfer?.categoryName || DEFAULT_VALUE;
								selectCategoryName.set(singleTransfer ? currentCatName : NULL_VALUE);
							},
						}),
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
