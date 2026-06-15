import { component } from 'chispa';
import { Transfer } from '../../services/MediaApiService';
import { getProviderIcon, getProviderName } from '../../services/ProvidersApiService';
import { getFileIcon } from '../../utils/icons';
import { fbytes, formatRemaining } from '../../utils/formats';
import { statusMap } from './transferStatus';
import tpl from './TransferDetailsDialog.html';
import './TransfersView.css';

export interface TransferDetailsDialogProps {
	transfer: Transfer;
	onClose: () => void;
}

export const TransferDetailsDialog = component<TransferDetailsDialogProps>(({ transfer: t, onClose }) => {
	const statusText = t.stopped ? 'Stopped' : t.isCompleted ? 'Completed' : statusMap[t.statusId ?? -1] || t.status || 'Unknown';
	const progressPct = ((t.progress || 0) * 100).toFixed(1);
	const addedOnText = t.addedOn ? new Date(t.addedOn).toLocaleString() : '-';
	const ed2kLink = t.link || t.fileEd2kLink || '';
	const hasLink = !!ed2kLink;

	let progressBarClass = '';
	if (t.stopped || t.statusId === 7) progressBarClass = 'transfer-progress-bar-paused';
	else if (t.isCompleted) progressBarClass = 'transfer-progress-bar-complete';

	const categoryLabel = t.categoryName && t.categoryName !== 'default' ? t.categoryName : 'Default';

	return tpl.fragment({
		fileIcon: { inner: getFileIcon(t.name || '') },
		valName: { inner: t.name || '-' },
		valHash: { inner: t.hash || '-' },
		valProviderIcon: { inner: getProviderIcon(t.provider) },
		valProviderName: { inner: ' ' + getProviderName(t.provider) },
		valStatus: { inner: statusText },
		valSize: { inner: fbytes(t.size) },
		valCompleted: { inner: fbytes(t.completed) },
		valSpeed: { inner: (t.speed ?? 0) > 0 ? fbytes(t.speed) + '/s' : '-' },
		valRemaining: { inner: formatRemaining(t.remaining, t.speed) },
		valSources: { inner: String(t.sources ?? 0) },
		valPriority: { inner: String(t.priority ?? 0) },
		valCategory: { inner: categoryLabel },
		valSourceInfo: { inner: t.sourceName || '-' },
		valAddedOn: { inner: addedOnText },
		filePathRow: {
			style: { display: t.filePath ? '' : 'none' },
		},
		valFilePath: { inner: t.filePath || '' },
		progressBar: {
			style: { width: `${progressPct}%` },
			addClass: () => progressBarClass,
		},
		progressText: { inner: `${progressPct}%` },
		ed2kSection: {
			style: { display: hasLink ? '' : 'none' },
		},
		valEd2kLink: { inner: ed2kLink },
		copyLinkBtn: {
			onclick: () => navigator.clipboard.writeText(ed2kLink),
		},
		btnClose: { onclick: onClose },
	});
});
