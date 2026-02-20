import { component } from 'chispa';
import tpl from './MessageDialog.html';

export interface MessageDialogProps {
	message: string;
	type: 'alert' | 'confirm';
	onConfirm: () => void;
	onCancel?: () => void;
}

export const MessageDialog = component<MessageDialogProps>(({ message, type, onConfirm, onCancel }) => {
	return tpl.fragment({
		icon: {
			inner: type === 'confirm' ? '❓' : '⚠️',
		},
		message: {
			inner: message,
		},
		btnOk: {
			onclick: onConfirm,
		},
		btnCancel: {
			style: {
				display: type === 'confirm' ? '' : 'none',
			},
			onclick: onCancel,
		},
	});
});
