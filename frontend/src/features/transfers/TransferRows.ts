import { computed, componentList } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { getProviderIcon, getProviderName } from '../../services/ProvidersApiService';
import { Transfer } from '../../services/MediaApiService';
import { ExtensionsApiService } from '../../services/ExtensionsApiService';
import { ContextMenuService } from '../../services/ContextMenuService';
import { getFileIcon } from '../../utils/icons';
import { isVideoFile } from '../../utils/files';
import { fbytes, formatRemaining } from '../../utils/formats';
import { RowSelectionManager } from '../../utils/ListManager';
import tpl from './TransfersView.html';
import './TransfersView.css';

export const DEFAULT_VALUE = 'default';

async function buildTransferActions(transfer: Transfer) {
	const extensionsApi = services.get(ExtensionsApiService);
	const actions = [];
	const popupProps = 'width=1280,height=720,toolbar=no,menubar=no,location=no,status=no';

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
				const actions = await buildTransferActions(transfer);

				if (actions.length > 0) {
					ctxMenu.show(e, actions);
				}
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
