import { component, signal } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { ExtensionsApiService, Extension, ExtensionType } from '../../services/ExtensionsApiService';
import { DialogService } from '../../services/DialogService';
import { TelegramConfig } from './components/TelegramConfig';
import { AddExtensionForm } from './components/AddExtensionForm';
import tpl from './ExtensionsView.html';
import './ExtensionsView.css';

export const ExtensionsView = component(() => {
	const api = services.get(ExtensionsApiService);
	const dialogService = services.get(DialogService);
	const extensions = signal<Extension[]>([]);

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

	const openAddDialog = () => {
		dialogService.open({
			title: 'Add Extension',
			render: (close) =>
				AddExtensionForm({
					onSave: async (v) => {
						if (v.type !== 'telegram_indexer' && !v.url) {
							await dialogService.alert('URL is required for this extension type');
							return;
						}
						try {
							await api.addExtension(v);
							refresh();
							close();
						} catch (e) {
							console.error(e);
							await dialogService.alert('Failed to add extension', 'Error');
						}
					},
					onCancel: close,
				}),
		});
	};

	const openTelegramDialog = () => {
		dialogService.open({
			title: 'Telegram Configuration',
			width: '700px',
			render: () => TelegramConfig(),
		});
	};

	refresh();

	return tpl.fragment({
		btnRefresh: { onclick: refresh },
		btnAdd: { onclick: openAddDialog },

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
							nameCol: {
								nodes: {
									nameText: { inner: v.name },
									mobileInfo: {
										nodes: {
											mobUrl: { inner: v.url },
											mobEnabled: {
												inner: v.enabled ? 'Enabled' : 'Disabled',
												style: { color: v.enabled ? '#46d369' : '#ff4d4d', fontWeight: 'bold' },
											},
											mobBtnToggle: {
												onclick: () => handleToggle(v.id, !!v.enabled),
												inner: v.enabled ? 'Disable' : 'Enable',
											},
											mobBtnDelete: { onclick: () => handleDelete(v.id) },
										},
									},
								},
							},
							urlCol: { inner: v.url },
							typeCol: { inner: v.type },
							enabledCol: { inner: v.enabled ? 'Yes' : 'No' },

							btnConfigure: {
								style: { display: v.type === 'telegram_indexer' ? 'inline-block' : 'none' },
								onclick: () => {
									openTelegramDialog();
								},
							},

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
	});
});
