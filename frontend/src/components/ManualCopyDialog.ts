import { component } from 'chispa';
import tpl from './ManualCopyDialog.html';

export interface ManualCopyDialogProps {
	text: string;
	onClose: () => void;
}

export const ManualCopyDialog = component<ManualCopyDialogProps>(({ text, onClose }) => {
	return tpl.fragment({
		copyText: {
			value: text,
			_ref: (el: HTMLTextAreaElement) => {
				// Deferred so the dialog is mounted and focusable before selecting
				setTimeout(() => {
					el.focus();
					el.select();
				}, 0);
			},
			onfocus: (e: FocusEvent) => (e.target as HTMLTextAreaElement).select(),
		},
		btnClose: { onclick: onClose },
	});
});
