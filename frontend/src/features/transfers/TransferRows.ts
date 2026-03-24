import { computed, componentList } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { getProviderIcon, getProviderName } from '../../services/ProvidersApiService';
import { Transfer } from '../../services/MediaApiService';
import { ExtensionsApiService } from '../../services/ExtensionsApiService';
import { ContextMenuService, ContextMenuItem } from '../../services/ContextMenuService';
import { TransfersContextService } from '../../services/TransfersContextService';
import { getFileIcon } from '../../utils/icons';
import { isVideoFile } from '../../utils/files';
import { fbytes, formatRemaining } from '../../utils/formats';
import { RowSelectionManager } from '../../utils/ListManager';
import tpl from './TransfersView.html';
import './TransfersView.css';

export const DEFAULT_VALUE = 'default';

async function buildContextMenuActions(transfer: Transfer, selectionMgr: RowSelectionManager): Promise<ContextMenuItem[]> {
	const extensionsApi = services.get(ExtensionsApiService);
	const ctx = services.get(TransfersContextService);
	const actions: ContextMenuItem[] = [];
	const popupProps = 'width=1280,height=720,toolbar=no,menubar=no,location=no,status=no';

	const hash = transfer.hash ?? '';
	const allHashes = [...selectionMgr.selectedHashes.get()].filter(Boolean) as string[];
	const targetHashes = allHashes.length > 0 ? allHashes : hash ? [hash] : [];

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
	}

	if (actions.length > 0) {
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

	return actions;
}

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
	// Custom statuses for other providers like Telegram downloads
	11: 'Queued',
};

interface TransferListProps {
	selectionMgr: RowSelectionManager;
	onRowClick: (hash: string) => void;
}

export const TransfersRows = componentList<Transfer, TransferListProps>(
	(t, i, l, props) => {
		const selectionMgr = props!.selectionMgr;
		const onRowClick = props!.onRowClick;
		const ctxMenu = services.get(ContextMenuService);
		const isSelected = computed(() => selectionMgr.selectedHashes.get().has(t.get().hash || ''));
		const addedOn = computed(() => {
			const dt = t.get().addedOn;
			return dt ? new Date(dt).toLocaleString() : '-';
		});

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
				const hash = t.get().hash;
				if (hash) {
					selectionMgr.handleRowSelection(e, hash, l.get());
					onRowClick(hash);
				}
				const transfer = t.get();
				const actions = await buildContextMenuActions(transfer, selectionMgr);
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
				sourceInfoCol: { inner: () => t.get().sourceName || '', title: () => t.get().sourceName || '' },
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
