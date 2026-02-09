import { signal } from 'chispa';

export interface DialogOptions {
	title: string;
	message: string;
	type: 'alert' | 'confirm';
	onConfirm?: () => void;
	onCancel?: () => void;
}

export class DialogService {
	public activeDialog = signal<DialogOptions | null>(null);

	public alert(message: string, title: string = 'Message'): Promise<void> {
		return new Promise((resolve) => {
			this.activeDialog.set({
				title,
				message,
				type: 'alert',
				onConfirm: () => {
					this.activeDialog.set(null);
					resolve();
				},
			});
		});
	}

	public confirm(message: string, title: string = 'Confirm'): Promise<boolean> {
		return new Promise((resolve) => {
			this.activeDialog.set({
				title,
				message,
				type: 'confirm',
				onConfirm: () => {
					this.activeDialog.set(null);
					resolve(true);
				},
				onCancel: () => {
					this.activeDialog.set(null);
					resolve(false);
				},
			});
		});
	}

	public close() {
		const current = this.activeDialog.get();
		if (current?.onCancel) {
			current.onCancel();
		} else if (current?.onConfirm) {
			current.onConfirm();
		}
		this.activeDialog.set(null);
	}
}
