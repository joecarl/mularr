import { component, signal } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { ExtensionsApiService, Extension, ExtensionType } from '../../services/ExtensionsApiService';
import { DialogService } from '../../services/DialogService';
import tpl from './ExtensionsView.html';
import './ExtensionsView.css';

export const ExtensionsView = component(() => {
	const api = services.get(ExtensionsApiService);
	const dialogService = services.get(DialogService);
	const extensions = signal<Extension[]>([]);
	const showDialog = signal(false);

	const refresh = async () => {
		try {
			const list = await api.getExtensions();
			extensions.set(list);
		} catch (e) {
			console.error(e);
			await dialogService.alert('Failed to load extensions', 'Error');
		}
	};

	const handleDelete = async (id: number) => {
		if (await dialogService.confirm('Are you sure you want to delete this extension?', 'Delete Extension')) {
			try {
				await api.deleteExtension(id);
				refresh();
			} catch (e) {
				console.error(e);
				await dialogService.alert('Failed to delete extension', 'Error');
			}
		}
	};

	const handleToggle = async (id: number, current: boolean) => {
		try {
			await api.toggleExtension(id, !current);
			refresh();
		} catch (e) {
			console.error(e);
			await dialogService.alert('Failed to toggle extension status', 'Error');
		}
	};

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		const form = e.target as HTMLFormElement;
		const formData = new FormData(form);
		const v = {
			name: formData.get('name') as string,
			url: formData.get('url') as string,
			type: formData.get('type') as ExtensionType,
			enabled: formData.get('enabled') ? 1 : 0,
		};
		try {
			await api.addExtension(v);
			showDialog.set(false);
			form.reset();
			refresh();
		} catch (e) {
			console.error(e);
			await dialogService.alert('Failed to add extension', 'Error');
		}
	};

	refresh();

	return tpl.fragment({
		btnRefresh: { onclick: refresh },
		btnAdd: { onclick: () => showDialog.set(true) },

		listBody: {
			inner: () => {
				const list = extensions.get();
				if (list.length === 0) {
					return tpl.noItemsRow({});
				}

				return list.map((v) =>
					tpl.extensionRow({
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
