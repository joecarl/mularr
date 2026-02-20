import { component, type Component } from 'chispa';
import tpl from './DialogHost.html';
import '../styles/ui-modal.css';

export interface IDialogProps {
	title: string;
	width?: string;
	onClose: () => void;
	body: Component;
}

export const DialogHost = component<IDialogProps>(({ title, width, onClose, body }) => {
	return tpl.fragment({
		overlay: {},
		window: {
			style: {
				width: width || '400px',
			},
		},
		header: {},
		title: {
			inner: title,
		},
		closeBtn: {
			onclick: onClose,
		},
		content: {
			inner: body,
		},
	});
});
