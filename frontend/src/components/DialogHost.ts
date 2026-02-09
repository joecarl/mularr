import { component, effect } from 'chispa';
import { services } from '../services/container/ServiceContainer';
import { DialogService } from '../services/DialogService';
import tpl from './DialogHost.html';
import '../styles/xp-modal.css';

export const DialogHost = component(() => {
	const dialogService = services.get(DialogService);

	return tpl.fragment({
		overlay: {
			style: {
				display: () => (dialogService.activeDialog.get() ? 'flex' : 'none'),
			},
		},
		title: {
			inner: () => dialogService.activeDialog.get()?.title || 'Dialog',
		},
		message: {
			inner: () => dialogService.activeDialog.get()?.message || '',
		},
		icon: {
			inner: () => (dialogService.activeDialog.get()?.type === 'confirm' ? '❓' : '⚠️'),
		},
		closeBtn: {
			onclick: () => dialogService.close(),
		},
		confirmBtn: {
			onclick: () => dialogService.activeDialog.get()?.onConfirm?.(),
		},
		cancelBtn: {
			style: {
				display: () => (dialogService.activeDialog.get()?.type === 'confirm' ? 'block' : 'none'),
			},
			onclick: () => dialogService.activeDialog.get()?.onCancel?.(),
		},
	});
});
