import { inject, component, signal } from 'chispa';
import { ExtensionsApiService, Extension, EXTENSION_TYPES, ExtensionType } from '../../services/ExtensionsApiService';
import { DialogService } from '../../services/DialogService';
import { ExtensionTypePicker } from './components/ExtensionTypePicker';
import { ExtensionForm } from './components/ExtensionForm';
import tpl from './ExtensionsView.html';
import './ExtensionsView.css';

export const ExtensionsView = component(() => {
	const api = inject(ExtensionsApiService);
	const dialogService = inject(DialogService);
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

	/**
	 * Adding is two steps: pick the type, then fill the complete form of that type. The extension is
	 * created, with its settings, only when that form is saved.
	 */
	const openAddDialog = () => {
		dialogService.open({
			title: 'Add Extension',
			width: '380px',
			render: (close) =>
				ExtensionTypePicker({
					onSelect: (type) => {
						close();
						openCreateDialog(type);
					},
					onCancel: close,
				}),
		});
	};

	const openCreateDialog = (type: ExtensionType) => {
		dialogService.open({
			title: `Add ${EXTENSION_TYPES[type]?.label ?? type}`,
			width: '520px',
			render: (close) =>
				ExtensionForm({
					type,
					onSave: async ({ name, enabled, url, config }) => {
						await api.addExtension({ name, url, type, enabled: enabled ? 1 : 0, config });
						await refresh();
						close();
					},
					onCancel: close,
				}),
		});
	};

	const openEditDialog = (ext: Extension) => {
		dialogService.open({
			title: `${EXTENSION_TYPES[ext.type]?.label ?? ext.type}: ${ext.name}`,
			width: '520px',
			render: (close) =>
				ExtensionForm({
					type: ext.type,
					extension: ext,
					onSave: async ({ url, config }) => {
						if (url !== ext.url) await api.updateExtensionUrl(ext.id, url);
						if (Object.keys(config).length > 0) await api.updateExtensionConfig(ext.id, config);
						await refresh();
						close();
					},
					onCancel: close,
				}),
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
											mobBtnConfigure: { onclick: () => openEditDialog(v) },
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
							typeCol: { inner: () => EXTENSION_TYPES[v.type]?.label ?? v.type },
							enabledCol: { inner: v.enabled ? 'Yes' : 'No' },

							btnConfigure: { onclick: () => openEditDialog(v) },

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
