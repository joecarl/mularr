import { computed, componentList, WritableSignal } from 'chispa';
import { getProviderIcon, getProviderName } from '../../services/ProvidersApiService';
import { Transfer } from '../../services/MediaApiService';
import { getFileIcon } from '../../utils/icons';
import { fbytes, formatRemaining } from '../../utils/formats';
import tpl from './TransfersView.html';
import './TransfersView.css';

export const DEFAULT_VALUE = 'default';

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
	onRowClick: (hash: string) => void;
}

export const TransfersRows = componentList<Transfer, TransferListProps>(
	(t, i, l, props) => {
		const selectedHashes = props!.selectedHashes;
		const lastClickedHash = props!.lastClickedHash;
		const onRowClick = props!.onRowClick;
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
				onRowClick(hash);
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
