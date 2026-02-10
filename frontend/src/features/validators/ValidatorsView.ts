import { component, signal } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { ValidatorsApiService, Validator } from '../../services/ValidatorsApiService';
import { DialogService } from '../../services/DialogService';
import tpl from './ValidatorsView.html';
import './ValidatorsView.css';

export const ValidatorsView = component(() => {
	const api = services.get(ValidatorsApiService);
	const dialogService = services.get(DialogService);
	const validators = signal<Validator[]>([]);
	const showDialog = signal(false);

	const refresh = async () => {
		try {
			const list = await api.getValidators();
			validators.set(list);
		} catch (e) {
			console.error(e);
			await dialogService.alert('Failed to load validators', 'Error');
		}
	};

	const handleDelete = async (id: number) => {
		if (await dialogService.confirm('Are you sure you want to delete this validator?', 'Delete Validator')) {
			try {
				await api.deleteValidator(id);
				refresh();
			} catch (e) {
				console.error(e);
				await dialogService.alert('Failed to delete validator', 'Error');
			}
		}
	};

	const handleToggle = async (id: number, current: boolean) => {
		try {
			await api.toggleValidator(id, !current);
			refresh();
		} catch (e) {
			console.error(e);
			await dialogService.alert('Failed to toggle validator status', 'Error');
		}
	};

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		const form = e.target as HTMLFormElement;
		const formData = new FormData(form);
		const v = {
			name: formData.get('name') as string,
			url: formData.get('url') as string,
			type: formData.get('type') as string,
			enabled: formData.get('enabled') ? 1 : 0,
		};
		try {
			await api.addValidator(v);
			showDialog.set(false);
			form.reset();
			refresh();
		} catch (e) {
			console.error(e);
			await dialogService.alert('Failed to add validator', 'Error');
		}
	};

	refresh();

	return tpl.fragment({
		btnRefresh: { onclick: refresh },
		btnAdd: { onclick: () => showDialog.set(true) },

		listBody: {
			inner: () => {
				const list = validators.get();
				if (list.length === 0) {
					return tpl.noItemsRow({});
				}

				return list.map((v) =>
					tpl.validatorRow({
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
