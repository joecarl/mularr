import { component, computed, Signal } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { ClipboardService } from '../../services/ClipboardService';
import { AmuleFile } from '../../services/AmuleApiService';
import { getFileIcon } from '../../utils/icons';
import { fbytes } from '../../utils/formats';
import { joinPath } from '../../utils/files';
import tpl from './SharedDetailsDialog.html';
import './SharedView.css';

export interface SharedDetailsDialogProps {
	file: Signal<AmuleFile>;
	onClose: () => void;
}

const UP_PRIORITY_LABELS: Record<number, string> = {
	0: 'Low',
	1: 'Normal',
	2: 'High',
	3: 'Very High',
	4: 'Very Low',
	6: 'PowerShare',
};

function formatUpPriority(prio?: number): string {
	if (prio === undefined || prio === null) return '-';
	// aMule offsets the priority by 10 when it is set to auto
	if (prio >= 10) return `Auto [${UP_PRIORITY_LABELS[prio - 10] ?? prio - 10}]`;
	return UP_PRIORITY_LABELS[prio] ?? String(prio);
}

export const SharedDetailsDialog = component<SharedDetailsDialogProps>(({ file: f, onClose }) => {
	const ed2kLink = computed(() => f.get().fileEd2kLink || '');
	const hasLink = computed(() => !!ed2kLink.get());
	const filePath = computed(() => joinPath(f.get().path, f.get().name));
	const comment = computed(() => f.get().getComment || '');

	return tpl.fragment({
		fileIcon: { inner: () => getFileIcon(f.get().name || '') },
		valName: { inner: () => f.get().name || '-' },
		valHash: { inner: () => f.get().hash || '-' },
		valSize: { inner: () => fbytes(f.get().size) },
		valUpPrio: { inner: () => formatUpPriority(f.get().upPrio) },
		valRating: { inner: () => String(f.get().getRating ?? 0) },
		valOnQueue: { inner: () => String(f.get().getOnQueue ?? 0) },
		valRequests: { inner: () => `${f.get().getRequests ?? 0} (${f.get().getAllRequests ?? 0})` },
		valAccepts: { inner: () => `${f.get().getAccepts ?? 0} (${f.get().getAllAccepts ?? 0})` },
		valTransferred: { inner: () => `${fbytes(f.get().getXferred ?? 0)} (${fbytes(f.get().getAllXferred ?? 0)})` },
		valCompleteSources: { inner: () => String(f.get().getCompleteSources ?? 0) },
		commentRow: {
			style: { display: () => (comment.get() ? '' : 'none') },
		},
		valComment: { inner: comment },
		filePathRow: {
			style: { display: () => (filePath.get() ? '' : 'none') },
		},
		valFilePath: { inner: filePath },
		ed2kSection: {
			style: { display: () => (hasLink.get() ? '' : 'none') },
		},
		valEd2kLink: { inner: ed2kLink },
		copyLinkBtn: {
			onclick: () => services.get(ClipboardService).copy(ed2kLink.get()),
		},
		btnClose: { onclick: onClose },
	});
});
