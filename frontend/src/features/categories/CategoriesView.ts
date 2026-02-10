import { component, signal, bindControlledInput } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { CategoriesApiService, Category } from '../../services/CategoriesApiService';
import { DialogService } from '../../services/DialogService';
import tpl from './CategoriesView.html';

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

export const CategoriesView = component(() => {
	const apiService = services.get(CategoriesApiService);
	const dialogService = services.get(DialogService);
	const categories = signal<Category[]>([]);
	const isModalOpen = signal(false);
	const editingCategoryId = signal<number | null>(null);

	// Form signals
	const formName = signal('');
	const formPath = signal('');
	const formComment = signal('');
	const formColor = signal('#000000');
	const formPriority = signal(0);

	const loadCategories = async () => {
		try {
			const data = await apiService.getAll();
			categories.set(data);
		} catch (e: any) {
			console.error('Error loading categories:', e);
		}
	};

	loadCategories();

	const openModal = (cat?: Category) => {
		if (cat) {
			editingCategoryId.set(cat.id);
			formName.set(cat.name);
			formPath.set(cat.path || '');
			formComment.set(cat.comment || '');
			formColor.set(numberToColor(cat.color || 0));
			formPriority.set(cat.priority || 0);
		} else {
			editingCategoryId.set(null);
			formName.set('');
			formPath.set('');
			formComment.set('');
			formColor.set('#000000');
			formPriority.set(0);
		}
		isModalOpen.set(true);
	};

	const closeModal = () => {
		isModalOpen.set(false);
	};

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		const formData = {
			name: formName.get(),
			path: formPath.get(),
			comment: formComment.get(),
			color: colorToNumber(formColor.get()),
			priority: Number(formPriority.get()),
		};

		try {
			const id = editingCategoryId.get();
			if (id !== null) {
				await apiService.update(id, formData);
			} else {
				await apiService.create(formData);
			}
			closeModal();
			loadCategories();
		} catch (err) {
			await dialogService.alert('Error saving category', 'Error');
		}
	};

	const handleDelete = async (id: number) => {
		if (await dialogService.confirm('Are you sure you want to delete this category?', 'Delete Category')) {
			try {
				await apiService.delete(id);
				loadCategories();
			} catch (err) {
				await dialogService.alert('Error deleting category', 'Error');
			}
		}
	};

	return tpl.fragment({
		addBtn: {
			onclick: () => openModal(),
		},
		categoriesTable: {
			inner: () => {
				const list = categories.get();
				return list.map((cat) =>
					tpl.categoryRow({
						nodes: {
							catName: { inner: cat.name },
							catPath: { inner: cat.path || '-' },
							catColor: {
								style: {
									color: numberToColor(cat.color || 0),
								},
								inner: numberToColor(cat.color || 0),
							},
							catPriority: { inner: cat.priority },
							catPatterns: { inner: cat.comment || '-' },
							editBtn: {
								onclick: () => openModal(cat),
							},
							deleteBtn: {
								onclick: () => handleDelete(cat.id),
							},
						},
					})
				);
			},
		},
		modalOverlay: {
			style: {
				display: () => (isModalOpen.get() ? '' : 'none'),
			},
		},
		modalTitle: {
			inner: () => (editingCategoryId.get() !== null ? 'Edit Category' : 'New Category'),
		},
		closeModalBtn: { onclick: closeModal },
		cancelModalBtn: { onclick: closeModal },
		categoryForm: {
			onsubmit: handleSubmit,
			nodes: {
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
			},
		},
	});
});
