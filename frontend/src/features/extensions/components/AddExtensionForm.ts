import { bindControlledInput, bindControlledSelect, component, SelectOption, signal } from 'chispa';
import { EXTENSION_TYPES, ExtensionType } from '../../../services/ExtensionsApiService';
import tpl from './AddExtensionForm.html';

const EXTENSION_TYPE_OPTIONS: SelectOption[] = Object.entries(EXTENSION_TYPES).map(([k, v]) => ({ label: v.label, value: k }));

export interface AddExtensionFormProps {
	onSave: (data: { name: string; url: string; type: ExtensionType; enabled: number }) => void;
	onCancel: () => void;
}

export const AddExtensionForm = component<AddExtensionFormProps>(({ onSave, onCancel }) => {
	const extensionType = signal<ExtensionType>('media_previewer');
	const url = signal('');

	const handleSubmit = (e: Event) => {
		e.preventDefault();
		const form = e.target as HTMLFormElement;
		const formData = new FormData(form);
		const type = extensionType.get(); // formData.get('type') as ExtensionType;
		const urlValue = url.get(); // formData.get('url') as string;

		onSave({
			name: formData.get('name') as string,
			url: urlValue,
			type: type,
			enabled: formData.get('enabled') ? 1 : 0,
		});
	};

	return tpl.fragment({
		form: {
			onsubmit: handleSubmit,
		},
		urlFormGroup: {
			style: { display: () => (extensionType.get() === 'telegram_indexer' ? 'none' : '') },
		},
		url: {
			_ref: (el) => {
				bindControlledInput(el, url);
			},
		},
		extensionType: {
			_ref: (el) => {
				bindControlledSelect(el, extensionType, EXTENSION_TYPE_OPTIONS);
			},
		},
		btnCancel: {
			onclick: onCancel,
		},
	});
});
