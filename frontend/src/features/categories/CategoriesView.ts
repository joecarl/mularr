import { component, signal, bindControlledInput } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { CategoriesApiService, Category } from '../../services/CategoriesApiService';
import tpl from './CategoriesView.html';

export const CategoriesView = component(() => {
	const apiService = services.get(CategoriesApiService);
	const categories = signal<Category[]>([]);
	const isModalOpen = signal(false);
	const editingCategoryId = signal<number | null>(null);

	// Form signals
	const formName = signal('');
	const formPath = signal('');
	const formComment = signal('');

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
		} else {
			editingCategoryId.set(null);
			formName.set('');
			formPath.set('');
			formComment.set('');
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
			alert('Error saving category');
		}
	};

	const handleDelete = async (id: number) => {
		if (confirm('Are you sure you want to delete this category?')) {
			try {
				await apiService.delete(id);
				loadCategories();
			} catch (err) {
				alert('Error deleting category');
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
				display: () => (isModalOpen.get() ? 'flex' : 'none'),
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
				comment: {
					_ref: (el) => {
						bindControlledInput(el, formComment);
					},
				},
			},
		},
	});
});
