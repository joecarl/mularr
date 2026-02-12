import { component, signal } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { WebhooksApiService, Webhook, WebhookType } from '../../services/WebhooksApiService';
import { DialogService } from '../../services/DialogService';
import tpl from './WebhooksView.html';
import './WebhooksView.css';

export const WebhooksView = component(() => {
	const api = services.get(WebhooksApiService);
	const dialogService = services.get(DialogService);
	const webhooks = signal<Webhook[]>([]);
	const showDialog = signal(false);

	const refresh = async () => {
		try {
			const list = await api.getWebhooks();
			webhooks.set(list);
		} catch (e) {
			console.error(e);
			await dialogService.alert('Failed to load webhooks', 'Error');
		}
	};

	const handleDelete = async (id: number) => {
		if (await dialogService.confirm('Are you sure you want to delete this webhook?', 'Delete Webhook')) {
			try {
				await api.deleteWebhook(id);
				refresh();
			} catch (e) {
				console.error(e);
				await dialogService.alert('Failed to delete webhook', 'Error');
			}
		}
	};

	const handleToggle = async (id: number, current: boolean) => {
		try {
			await api.toggleWebhook(id, !current);
			refresh();
		} catch (e) {
			console.error(e);
			await dialogService.alert('Failed to toggle webhook status', 'Error');
		}
	};

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		const form = e.target as HTMLFormElement;
		const formData = new FormData(form);
		const v = {
			name: formData.get('name') as string,
			url: formData.get('url') as string,
			type: formData.get('type') as WebhookType,
			enabled: formData.get('enabled') ? 1 : 0,
		};
		try {
			await api.addWebhook(v);
			showDialog.set(false);
			form.reset();
			refresh();
		} catch (e) {
			console.error(e);
			await dialogService.alert('Failed to add webhook', 'Error');
		}
	};

	refresh();

	return tpl.fragment({
		btnRefresh: { onclick: refresh },
		btnAdd: { onclick: () => showDialog.set(true) },

		listBody: {
			inner: () => {
				const list = webhooks.get();
				if (list.length === 0) {
					return tpl.noItemsRow({});
				}

				return list.map((v) =>
					tpl.webhookRow({
						nodes: {
							idCol: { inner: String(v.id) },
							nameCol: { inner: v.name },
							urlCol: { inner: v.url },
							typeCol: { inner: v.type },
							enabledCol: { inner: v.enabled ? 'Yes' : 'No' },
							btnToggle: {
								onclick: () => handleToggle(v.id, !!v.enabled),
								inner: v.enabled ? 'Disable' : 'Enable',
							},
							btnDelete: { onclick: () => handleDelete(v.id) },
						},
					})
				);
			},
		},

		dlgAdd: {
			style: {
				display: () => (showDialog.get() ? '' : 'none'),
			},
		},
		btnCloseDlg: { onclick: () => showDialog.set(false) },
		btnCancelDlg: { onclick: () => showDialog.set(false) },
		formAdd: { onsubmit: handleSubmit },
	});
});
