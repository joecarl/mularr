import { refBindInput, component, signal } from 'chispa';
import type { BlacklistCandidate } from '../services/BlacklistService';
import { fbytes } from '../utils/formats';
import tpl from './BlacklistConfirmDialog.html';

export interface BlacklistConfirmDialogProps {
	files: BlacklistCandidate[];
	/** Sentence describing what will happen (differs between transfers and search). */
	consequences: string;
	onConfirm: (reason: string) => void;
	onCancel: () => void;
}

export const BlacklistConfirmDialog = component<BlacklistConfirmDialogProps>(({ files, consequences, onConfirm, onCancel }) => {
	const reason = signal('');

	return tpl.fragment({
		question: {
			inner: files.length === 1 ? 'Mark this file as bad content?' : `Mark these ${files.length} files as bad content?`,
		},
		filesList: {
			inner: () =>
				files.map((f) =>
					tpl.fileItem({
						nodes: {
							fileName: { inner: f.name || 'Unknown', title: f.name || 'Unknown' },
							fileHash: { inner: f.hash, title: f.hash },
							fileSize: { inner: f.size ? fbytes(f.size) : '-' },
						},
					})
				),
		},
		consequences: {
			inner: consequences,
		},
		reasonInput: {
			_ref: refBindInput(reason),
		},
		btnOk: {
			onclick: () => onConfirm(reason.get().trim()),
		},
		btnCancel: {
			onclick: onCancel,
		},
	});
});
