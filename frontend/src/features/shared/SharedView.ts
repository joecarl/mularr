import { component, computed, componentList, effect, signal, Signal, refBindInput } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { AmuleApiService, AmuleFile } from '../../services/AmuleApiService';
import { DialogService } from '../../services/DialogService';
import { ExtensionsApiService } from '../../services/ExtensionsApiService';
import { ContextMenuService, ContextMenuItem } from '../../services/ContextMenuService';
import { ClipboardService } from '../../services/ClipboardService';
import { LocalPrefsService } from '../../services/LocalPrefsService';
import { WsService } from '../../services/WsService';
import { ListManager } from '../../utils/ListManager';
import { getFileIcon } from '../../utils/icons';
import { fbytes } from '../../utils/formats';
import { isVideoFile, joinPath } from '../../utils/files';
import { smartLoad } from '../../utils/scheduling';
import { SharedDetailsDialog } from './SharedDetailsDialog';
import tpl from './SharedView.html';
import './SharedView.css';

async function buildContextMenuActions(
	t: Signal<AmuleFile>,
	mgr: ListManager<AmuleFile, keyof AmuleFile>,
	onDelete: (hashes: string[]) => void
): Promise<ContextMenuItem[]> {
	const extensionsApi = services.get(ExtensionsApiService);
	const dialogService = services.get(DialogService);
	const actions: ContextMenuItem[] = [];
	const popupProps = 'width=1280,height=720,toolbar=no,menubar=no,location=no,status=no';

	const file = t.get();
	const hash = file.hash ?? '';
	const allHashes = [...mgr.selectedHashes.get()].filter(Boolean) as string[];
	const targetHashes = allHashes.length > 0 ? allHashes : hash ? [hash] : [];
	// Resolve the selected files so multi-selection menus reflect all of them
	const allFiles = mgr.items.get();
	const targetFiles = targetHashes.map((h) => allFiles.find((x) => x.hash === h) ?? (h === hash ? file : null)).filter(Boolean) as AmuleFile[];
	const multi = targetHashes.length > 1;

	// ---- Details action (single selection only) ----
	if (!multi) {
		actions.push({
			label: 'Details ...',
			icon: 'ℹ️',
			onClick: () => {
				dialogService.open({
					title: file.name || 'Shared File Details',
					width: '560px',
					render: (close) => SharedDetailsDialog({ file: t, onClose: close }),
				});
			},
		});
		actions.push({ separator: true });
	}

	// ---- Media preview actions (single selection only) ----
	const filePath = joinPath(file.path, file.name);
	if (!multi && filePath && isVideoFile(filePath)) {
		try {
			const allExtensions = await extensionsApi.getExtensions();
			const previewers = allExtensions.filter((x) => x.type === 'media_previewer' && x.enabled);
			for (const previewer of previewers) {
				const baseUrl = previewer.url.replace(/\/$/, '');
				actions.push({
					label: `Open in ${previewer.name}`,
					icon: '🎬',
					onClick: () => window.open(`${baseUrl}?file=${encodeURIComponent(filePath)}`, '_blank', popupProps),
				});
			}
		} catch {
			// silently ignore if extensions can't be fetched
		}
		actions.push({ separator: true });
	}

	// ---- ed2k link action ----
	const ed2kLinks = targetFiles.filter((x) => x.fileEd2kLink).map((x) => x.fileEd2kLink!);
	if (ed2kLinks.length > 0) {
		actions.push({
			label: ed2kLinks.length > 1 ? `Copy ${ed2kLinks.length} ed2k Links` : 'Copy ed2k Link',
			icon: '🔗',
			onClick: () => services.get(ClipboardService).copy(ed2kLinks.join('\n')),
		});
		actions.push({ separator: true });
	}

	// ---- Delete action (confirmation handled by the view) ----
	actions.push({
		label: multi ? `Delete ${targetHashes.length} Files from Disk…` : 'Delete from Disk…',
		icon: '🗑️',
		onClick: () => onDelete(targetHashes),
	});

	return actions;
}

interface SharedListProps {
	mgr: ListManager<AmuleFile, keyof AmuleFile>;
	onDelete: (hashes: string[]) => void;
}

const SharedRows = componentList<AmuleFile, SharedListProps>(
	(t, i, l, props) => {
		const mgr = props!.mgr;
		const ctxMenu = services.get(ContextMenuService);
		const isSelected = computed(() => mgr.selectedHashes.get().has(t.get().hash!));

		return tpl.sharedRow({
			classes: { selected: isSelected },
			onclick: (e) => {
				const hash = t.get().hash;
				if (!hash) return;
				mgr.handleRowSelection(e, hash, l.get());
			},
			oncontextmenu: async (e: MouseEvent) => {
				e.preventDefault();
				const hash = t.get().hash;
				if (hash) mgr.handleContextMenuSelection(e, hash, l.get());
				const actions = await buildContextMenuActions(t, mgr, props!.onDelete);
				ctxMenu.show(e, actions);
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
const SHARED_PAGE_SIZE = 200;

export const SharedView = component(() => {
	const apiService = services.get(AmuleApiService);
	const dialogService = services.get(DialogService);
	const prefs = services.get(LocalPrefsService);
	const ws = services.get(WsService);
	const nameFilter = signal('');
	const visibleCount = signal(SHARED_PAGE_SIZE);

	const mgr = new ListManager<AmuleFile, keyof AmuleFile>({
		defaultColumn: 'name',
		numericColumns: ['size', 'getRating', 'getRequests', 'getCompleteSources', 'getXferred'],
		mobileSortOptions: MOBILE_SORT_OPTIONS,
		prefs: { service: prefs, key: 'shared' },
	});

	const isDisabled = computed(() => mgr.selectedHashes.get().size === 0);
	const filteredItems = computed(() => {
		const term = nameFilter.get().trim().toLowerCase();
		const list = mgr.sortedItems.get();
		if (!term) return list;
		return list.filter((item) => (item.name || '').toLowerCase().includes(term));
	});
	const visibleItems = computed(() => filteredItems.get().slice(0, visibleCount.get()));
	const hasMoreItems = computed(() => visibleItems.get().length < filteredItems.get().length);
	const shownCountLabel = computed(() => {
		const total = mgr.sortedItems.get().length;
		const filtered = filteredItems.get().length;
		const shown = visibleItems.get().length;
		if (filtered === total) return `${shown}/${total} shown`;
		return `${shown}/${filtered} shown (filtered from ${total})`;
	});

	effect(() => {
		filteredItems.get();
		visibleCount.set(SHARED_PAGE_SIZE);
	});

	// Sync shared files from WebSocket
	effect(() => {
		const s = ws.sharedFiles.get();
		if (s) mgr.items.set(s.list || []);
	});

	// Manual refresh after destructive actions
	const loadShared = smartLoad(async () => {
		const data = await apiService.getSharedFiles();
		mgr.items.set(data.list || []);
	}, 'shared');

	const deleteSharedFiles = async (hashes: string[]) => {
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

	const loadMoreItems = () => {
		if (!hasMoreItems.get()) return;
		visibleCount.set(Math.min(visibleCount.get() + SHARED_PAGE_SIZE, filteredItems.get().length));
	};

	const onSharedTableScroll = (e: Event) => {
		const el = e.currentTarget as HTMLElement | null;
		if (!el) return;
		if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
			loadMoreItems();
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
		nameFilterInput: {
			_ref: refBindInput(nameFilter),
		},
		sharedCountLabel: {
			inner: shownCountLabel,
		},

		cancelBtn: {
			disabled: isDisabled,
			onclick: () => deleteSharedFiles([...mgr.selectedHashes.get()]),
		},

		sharedTableContainer: {
			onscroll: onSharedTableScroll,
		},

		sharedListContainer: {
			inner: () => {
				const list = visibleItems.get();
				if (list.length === 0) {
					return tpl.noSharedRow({
						nodes: {
							noSharedText: {
								inner: () => (nameFilter.get().trim() ? 'No shared files match this name.' : 'No shared files.'),
							},
						},
					});
				}

				return SharedRows(visibleItems, { mgr, onDelete: deleteSharedFiles });
			},
		},
	});
});
