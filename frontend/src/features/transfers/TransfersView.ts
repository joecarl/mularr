import { component, signal, computed, onUnmount } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { AmuleApiService, Transfer, Category } from '../../services/AmuleApiService';
import { getFileIcon } from '../../utils/Icons';
import tpl from './TransfersView.html';
import './TransfersView.css';

export const TransfersView = component(() => {
	const apiService = services.get(AmuleApiService);

	const transferList = signal<Transfer[]>([]);
	const sharedList = signal<Transfer[]>([]);
	const categories = signal<Category[]>([]);
	const selectedHash = signal<string | null>(null);
	const sortColumn = signal<keyof Transfer>('name');
	const sortDirection = signal<'asc' | 'desc'>('asc');

	const isDisabled = computed(() => !selectedHash.get());

	const loadTransfers = async () => {
		try {
			const data: any = await apiService.getTransfers();
			if (data.downloads) {
				transferList.set(data.downloads);
				sharedList.set(data.shared || []);
			}
		} catch (e: any) {
			console.error('Error loading transfers:', e);
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
	const intervalId = setInterval(loadTransfers, 2000);
	onUnmount(() => clearInterval(intervalId));

	loadTransfers();
	loadCategories();

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
			inner: () => {
				const currentSelection = selectedHash.get();
				const currentTransfer = transferList.get().find((t) => t.hash === currentSelection);
				const currentCatId = currentTransfer?.categoryId ?? -1;

				const opts = [{ value: '-1', label: 'Select Category...' }, ...categories.get().map((c) => ({ value: String(c.id), label: c.name }))];

				// If tpl.catOption doesn't exist, we'll just use raw HTML for simplicity in this specific case
				// Or use a more standard way if tpl supports it.
				// Since I can't easily add a template now without editing HTML again,
				// I'll assume tpl might not have it unless I add it.
				// Let's just use string mapping for inner if supported, or document.create
				return opts.map((opt) => {
					const el = document.createElement('option');
					el.value = opt.value;
					el.textContent = opt.label;
					if (parseInt(opt.value) === currentCatId) el.selected = true;
					return el;
				});
			},
			onchange: (e: any) => changeCategory(parseInt(e.target.value)),
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
			inner: () => {
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

				if (list.length === 0) return tpl.noTransferRow({});

				const formatBytes = (bytes?: number) => {
					if (!bytes) return '0 B';
					const k = 1024;
					const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
					const i = Math.floor(Math.log(bytes) / Math.log(k));
					return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
				};

				return list.map((t) => {
					const isSelected = selectedHash.get() === t.hash;
					const category = categories.get().find((c) => c.id === t.categoryId);

					return tpl.transferRow({
						_ref: (el) => {
							if (isSelected) (el as HTMLElement).classList.add('selected');
							else (el as HTMLElement).classList.remove('selected');
						},
						// CSS class handles selection in win-list
						onclick: () => selectedHash.set(t.hash || null),
						nodes: {
							nameCol: {
								nodes: {
									fileNameText: { inner: t.name || 'Unknown' },
									fileIcon: { inner: getFileIcon(t.name || '') },
								},
							},
							sizeCol: { inner: formatBytes(t.size) },
							categoryCol: { inner: category?.name || '-' },
							completedCol: { inner: formatBytes(t.completed) },
							speedCol: { inner: formatBytes(t.speed) + '/s' },
							progressCol: {
								nodes: {
									progressBar: { style: { width: `${(t.progress || 0) * 100}%` } },
									progressText: { inner: ((t.progress || 0) * 100).toFixed(1) + '%' },
								},
							},
							sourcesCol: { inner: String(t.sources || 0) },
							priorityCol: { inner: String(t.priority || 0) },
							statusCol: { inner: t.status || '' },
							remainingCol: { inner: formatBytes(t.remaining) },
							addedOnCol: { inner: t.addedOn ? new Date(t.addedOn * 1000).toLocaleString() : '-' },
						},
					});
				});
			},
		},

		sharedListContainer: {
			inner: () => {
				const list = sharedList.get();
				if (list.length === 0) return tpl.noSharedRow({});

				const formatBytes = (bytes?: number) => {
					if (!bytes) return '0 B';
					const k = 1024;
					const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
					const i = Math.floor(Math.log(bytes) / Math.log(k));
					return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
				};

				return list.map((t) => {
					return tpl.sharedRow({
						nodes: {
							sharedNameCol: {
								nodes: {
									sharedNameText: { inner: t.name || 'Unknown' },
									sharedIcon: { inner: getFileIcon(t.name || '') },
								},
							},
							sharedSizeCol: { inner: formatBytes(t.size) },
							sharedStatusCol: { inner: 'Shared' },
							sharedSourcesCol: { inner: String(t.sources || 0) },
						},
					});
				});
			},
		},
	});
});
