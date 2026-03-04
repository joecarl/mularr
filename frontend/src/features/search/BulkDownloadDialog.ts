import { bindControlledInput, component, signal } from 'chispa';
import tpl from './BulkDownloadDialog.html';

export interface BulkDownloadDialogProps {
	onConfirm: (links: string[]) => void;
	onCancel: () => void;
}

export const BulkDownloadDialog = component<BulkDownloadDialogProps>(({ onConfirm, onCancel }) => {
	const value = signal('');

	return tpl.fragment({
		linksInput: {
			_ref: (el) => {
				bindControlledInput(el, value);
			},
		},
		btnDownload: {
			onclick: () => {
				const links = value
					.get()
					.split('\n')
					.map((l) => l.trim())
					.filter((l) => l.length > 0);
				if (links.length > 0) onConfirm(links);
			},
		},
		btnCancel: { onclick: onCancel },
	});
});
