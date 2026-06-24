import { component, computed, Signal } from 'chispa';
import { Transfer } from '../../services/MediaApiService';
import { getProviderIcon, getProviderName } from '../../services/ProvidersApiService';
import { getFileIcon } from '../../utils/icons';
import { fbytes, formatRemaining } from '../../utils/formats';
import { TransferProgressBar } from './TransferProgressBar';
import { statusMap } from './transferStatus';
import tpl from './TransferDetailsDialog.html';
import './TransfersView.css';

export interface TransferDetailsDialogProps {
	transfer: Signal<Transfer>;
	onClose: () => void;
}

export const TransferDetailsDialog = component<TransferDetailsDialogProps>(({ transfer: t, onClose }) => {
	const statusText = computed(() =>
		t.get().stopped ? 'Stopped' : t.get().isCompleted ? 'Completed' : statusMap[t.get().statusId ?? -1] || t.get().status || 'Unknown'
	);
	const addedOnText = computed(() => {
		const addedOn = t.get().addedOn;
		return addedOn ? new Date(addedOn).toLocaleString() : '-';
	});
	const ed2kLink = computed(() => t.get().link || t.get().fileEd2kLink || '');
	const hasLink = computed(() => !!ed2kLink.get());

	const categoryLabel = computed(() => {
		const categoryName = t.get().categoryName;
		return categoryName && categoryName !== 'default' ? categoryName : 'Default';
	});

	return tpl.fragment({
		fileIcon: { inner: () => getFileIcon(t.get().name || '') },
		valName: { inner: () => t.get().name || '-' },
		valHash: { inner: () => t.get().hash || '-' },
		valProviderIcon: { inner: () => getProviderIcon(t.get().provider) },
		valProviderName: { inner: () => ' ' + getProviderName(t.get().provider) },
		valStatus: { inner: statusText },
		valSize: { inner: () => fbytes(t.get().size) },
		valCompleted: { inner: () => fbytes(t.get().completed) },
		valSpeed: { inner: () => ((t.get().speed ?? 0) > 0 ? fbytes(t.get().speed) + '/s' : '-') },
		valRemaining: { inner: () => formatRemaining(t.get().remaining, t.get().speed) },
		valSources: { inner: () => String(t.get().sources ?? 0) },
		valPriority: { inner: () => String(t.get().priority ?? 0) },
		valCategory: { inner: categoryLabel },
		valSourceInfo: { inner: () => t.get().sourceName || '-' },
		valAddedOn: { inner: addedOnText },
		filePathRow: {
			style: { display: () => (t.get().filePath ? '' : 'none') },
		},
		valFilePath: { inner: () => t.get().filePath || '' },
		progressMount: TransferProgressBar({
			transfer: t,
			preferChunked: true,
		}),

		ed2kSection: {
			style: { display: () => (hasLink.get() ? '' : 'none') },
		},
		valEd2kLink: { inner: ed2kLink },
		copyLinkBtn: {
			onclick: () => navigator.clipboard.writeText(ed2kLink.get()),
		},
		btnClose: { onclick: onClose },
	});
});
