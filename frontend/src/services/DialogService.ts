import { type Component } from 'chispa';
import { DialogHost } from '../components/DialogHost';
import { MessageDialog } from '../components/MessageDialog';

export interface DialogCustomOptions {
	title: string;
	width?: string;
	render: (close: () => void) => Component;
}

export class DialogService {
	public alert(message: string, title: string = 'Message'): Promise<void> {
		return new Promise((resolve) => {
			this.open({
				title,
				width: '350px',
				render: (close) =>
					MessageDialog({
						message,
						type: 'alert',
						onConfirm: () => {
							close();
							resolve();
						},
					}),
			});
		});
	}

	public confirm(message: string, title: string = 'Confirm'): Promise<boolean> {
		return new Promise((resolve) => {
			this.open({
				title,
				width: '350px',
				render: (close) =>
					MessageDialog({
						message,
						type: 'confirm',
						onConfirm: () => {
							close();
							resolve(true);
						},
						onCancel: () => {
							close();
							resolve(false);
						},
					}),
			});
		});
	}

	public open(options: DialogCustomOptions) {
		const dialogInstance = DialogHost({
			title: options.title,
			width: options.width,
			onClose: () => {
				dialogInstance.unmount();
			},
			body: options.render(() => dialogInstance.unmount()),
		});

		dialogInstance.mount(document.body);
		return dialogInstance;
	}
}
