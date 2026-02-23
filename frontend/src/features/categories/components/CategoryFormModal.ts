import { bindControlledInput, component, signal } from 'chispa';
import { Category } from '../../../services/CategoriesApiService';
import tpl from './CategoryFormModal.html';

const numberToColor = (num: number) => {
	const r = num & 0xff;
	const g = (num >> 8) & 0xff;
	const b = (num >> 16) & 0xff;
	return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

const colorToNumber = (hex: string) => {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return r + (g << 8) + (b << 16);
};

export interface CategoryFormModalProps {
	initialData?: Category;
	onSave: (data: Partial<Category>) => void;
	onCancel: () => void;
}

export const CategoryFormModal = component<CategoryFormModalProps>(({ initialData, onSave, onCancel }) => {
	const formName = signal(initialData?.name ?? '');
	const formPath = signal(initialData?.path ?? '');
	const formComment = signal(initialData?.comment ?? '');
	const formColor = signal(initialData?.color ? numberToColor(initialData.color) : '#000000');
	const formPriority = signal(initialData?.priority ?? 0);

	const handleSubmit = (e: Event) => {
		e.preventDefault();
		onSave({
			name: formName.get(),
			path: formPath.get(),
			comment: formComment.get(),
			color: colorToNumber(formColor.get()),
			priority: Number(formPriority.get()),
		});
	};

	return tpl.fragment({
		form: { onsubmit: handleSubmit },
		name: {
			_ref: (el) => {
				bindControlledInput(el, formName);
			},
		},
		path: {
			_ref: (el) => {
				bindControlledInput(el, formPath);
			},
		},
		color: {
			_ref: (el) => {
				bindControlledInput(el, formColor);
			},
		},
		priority: {
			_ref: (el) => {
				bindControlledInput(el, formPriority);
			},
		},
		comment: {
			_ref: (el) => {
				bindControlledInput(el, formComment);
			},
		},
		btnCancel: { onclick: onCancel },
	});
});
