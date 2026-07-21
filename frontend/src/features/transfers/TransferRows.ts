import { computed, componentList, Signal } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { getProviderIcon, getProviderName } from '../../services/ProvidersApiService';
import { Transfer } from '../../services/MediaApiService';
import { ExtensionsApiService } from '../../services/ExtensionsApiService';
import { ContextMenuService, ContextMenuItem } from '../../services/ContextMenuService';
import { TransfersContextService } from '../../services/TransfersContextService';
import { DialogService } from '../../services/DialogService';
import { getFileIcon } from '../../utils/icons';
import { isVideoFile } from '../../utils/files';
import { fbytes, formatRemaining } from '../../utils/formats';
import { RowSelectionManager } from '../../utils/ListManager';
import { TransferDetailsDialog } from './TransferDetailsDialog';
import { TransferProgressBar } from './TransferProgressBar';
import { formatSourcesSummary } from './sourcesSummary';
import { LocalPrefsService } from '../../services/LocalPrefsService';
import { statusMap } from './transferStatus';
import tpl from './TransfersView.html';
import './TransfersView.css';

export const DEFAULT_VALUE = 'default';

const numberToColor = (num: number) => {
	const r = num & 0xff;
	const g = (num >> 8) & 0xff;
	const b = (num >> 16) & 0xff;
	return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

async function buildContextMenuActions(t: Signal<Transfer>, selectionMgr: RowSelectionManager): Promise<ContextMenuItem[]> {
	const extensionsApi = services.get(ExtensionsApiService);
	const ctx = services.get(TransfersContextService);
	const dialogService = services.get(DialogService);
	const actions: ContextMenuItem[] = [];
	const popupProps = 'width=1280,height=720,toolbar=no,menubar=no,location=no,status=no';

	const transfer = t.get();
	const hash = transfer.hash ?? '';
	const allHashes = [...selectionMgr.selectedHashes.get()].filter(Boolean) as string[];
	const targetHashes = allHashes.length > 0 ? allHashes : hash ? [hash] : [];

	// ---- Details action ----
	actions.push({
		label: 'Details ...',
		icon: 'ℹ️',
		onClick: () => {
			dialogService.open({
				title: transfer.name || 'Transfer Details',
				width: '680px',
				render: (close) => TransferDetailsDialog({ transfer: t, onClose: close }),
			});
		},
	});
	actions.push({ separator: true });

	// ---- Media preview actions ----
	const filePath = transfer.filePath;
	if (filePath && isVideoFile(filePath)) {
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

	// ---- Transfer control actions ----
	const canPause = !transfer.isCompleted && !transfer.stopped && transfer.statusId === 0;
	const canResume = !transfer.isCompleted && (!!transfer.stopped || transfer.statusId === 7);
	const canStop = transfer.provider === 'amule' && !transfer.isCompleted && !transfer.stopped;

	actions.push({ label: 'Pause', icon: '⏸', disabled: !canPause, onClick: () => ctx.executeCommand(targetHashes, 'pause') });
	actions.push({ label: 'Resume', icon: '▶', disabled: !canResume, onClick: () => ctx.executeCommand(targetHashes, 'resume') });
	actions.push({ label: 'Stop', icon: '⏹', disabled: !canStop, onClick: () => ctx.executeCommand(targetHashes, 'stop') });
	actions.push({
		label: 'Cancel Download',
		icon: '✖',
		onClick: async () => {
			const ok = await ctx.executeCommand(targetHashes, 'cancel');
			if (ok) selectionMgr.clearSelection();
		},
	});

	// ---- Category actions (read from in-memory signal — no API call) ----
	const categories = ctx.categories.get();
	if (categories.length > 0) {
		actions.push({ separator: true });
		for (const cat of categories) {
			const catId = cat.id;
			const catLabel = cat.id === 0 ? 'Default' : cat.name;
			actions.push({
				label: `Set Category: ${catLabel}`,
				icon: '📁',
				onClick: () => ctx.changeCategory(targetHashes, catId),
			});
		}
	}

	// ---- Blacklist action ----
	if (hash) {
		actions.push({ separator: true });
		actions.push({
			label: 'Blacklist Hash…',
			icon: '🚫',
			onClick: async () => {
				const ok = await ctx.blacklistHash(hash, transfer.name || '');
				if (ok) selectionMgr.clearSelection();
			},
		});
	}

	// ---- ed2k link action (amule only) ----
	if (transfer.provider === 'amule' && transfer.link) {
		const ed2kLink = transfer.link;
		actions.push({ separator: true });
		actions.push({
			label: 'Copy ed2k Link',
			icon: '🔗',
			onClick: () => navigator.clipboard.writeText(ed2kLink),
		});
	}

	return actions;
}

interface TransferListProps {
	selectionMgr: RowSelectionManager;
	onRowClick: (hash: string) => void;
}

export const TransfersRows = componentList<Transfer, TransferListProps>(
	(t, i, l, props) => {
		const selectionMgr = props!.selectionMgr;
		const onRowClick = props!.onRowClick;
		const prefs = services.get(LocalPrefsService);
		const ctxMenu = services.get(ContextMenuService);
		const transferCtx = services.get(TransfersContextService);
		const isSelected = computed(() => selectionMgr.selectedHashes.get().has(t.get().hash || ''));
		const addedOn = computed(() => {
			const dt = t.get().addedOn;
			return dt ? new Date(dt).toLocaleString() : '-';
		});
		const categoryName = () => {
			const name = t.get().categoryName;
			return name === DEFAULT_VALUE ? '-' : (name ?? '-');
		};
		const categoryColor = () => {
			const name = t.get().categoryName;
			if (!name || name === DEFAULT_VALUE) return 'transparent';
			const cat = transferCtx.categories.get().find((c) => c.name === name);
			if (!cat || !cat.color) return 'transparent';
			return numberToColor(cat.color);
		};

		return tpl.transferRow({
			classes: { selected: isSelected },
			onclick: (e: MouseEvent) => {
				const hash = t.get().hash;
				if (!hash) return;
				selectionMgr.handleRowSelection(e, hash, l.get());
				onRowClick(hash);
			},
			oncontextmenu: async (e: MouseEvent) => {
				e.preventDefault();
				const transfer = t.get();
				const hash = transfer.hash;
				if (hash) {
					selectionMgr.handleRowSelection(e, hash, l.get());
					onRowClick(hash);
				}
				const actions = await buildContextMenuActions(t, selectionMgr);
				ctxMenu.show(e, actions);
			},
			nodes: {
				nameCol: {
					nodes: {
						fileNameText: { inner: () => t.get().name || 'Unknown', title: () => t.get().name || 'Unknown' },
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
										if (tfer.isCompleted) return 'Completed';
										if (tfer.stopped) return 'Stopped';
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
				sourceInfoCol: { inner: () => t.get().sourceName || '', title: () => t.get().sourceName || '' },
				sizeCol: { inner: () => fbytes(t.get().size) },
				categoryCol: {
					nodes: {
						categoryColorDot: () =>
							categoryColor() === 'transparent' ? null : tpl.categoryColorDot({ style: { backgroundColor: categoryColor } }),
						categoryText: { inner: categoryName },
					},
				},
				completedCol: { inner: () => fbytes(t.get().completed) },
				speedCol: { inner: () => ((t.get().speed ?? 0) > 0 ? fbytes(t.get().speed) + '/s' : '') },
				progressCol: {
					inner: TransferProgressBar({
						transfer: t,
						preferChunked: prefs.get('ui.transfers.useDetailedProgress', false),
					}),
				},
				sourcesCol: { inner: () => formatSourcesSummary(t.get()) },
				priorityCol: { inner: () => String(t.get().priority || 0) },
				statusCol: {
					inner: () => {
						const tfer = t.get();
						if (tfer.isCompleted) return 'Completed';
						if (tfer.stopped) return 'Stopped';
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
