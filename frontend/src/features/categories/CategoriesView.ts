import { component, signal } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { CategoriesApiService, Category } from '../../services/CategoriesApiService';
import { DialogService } from '../../services/DialogService';
import { CategoryFormModal } from './components/CategoryFormModal';
import tpl from './CategoriesView.html';

const numberToColor = (num: number) => {
	const r = num & 0xff;
	const g = (num >> 8) & 0xff;
	const b = (num >> 16) & 0xff;
	return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

export const CategoriesView = component(() => {
	const apiService = services.get(CategoriesApiService);
	const dialogService = services.get(DialogService);
	const categories = signal<Category[]>([]);

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
		dialogService.open({
			title: cat ? 'Edit Category' : 'New Category',
			render: (close) =>
				CategoryFormModal({
					initialData: cat,
					onSave: async (data) => {
						try {
							if (cat) {
								const oldPath = cat.path || '';
								const newPath = data.path || '';
								const pathChanged = oldPath !== newPath && !!newPath;

								if (pathChanged) {
									const confirmed = await dialogService.confirm(
										`Save path for "${cat.name}" has changed. All completed files will be moved to the new directory.\n\nOld: ${oldPath || '(none)'}\nNew: ${newPath}\n\nSave and move files?`,
										'Update Category'
									);
									if (!confirmed) return;
								}

								await apiService.update(cat.id, data, pathChanged);
							} else {
								await apiService.create(data);
							}
							close();
							loadCategories();
						} catch (err) {
							await dialogService.alert('Error saving category', 'Error');
						}
					},
					onCancel: close,
				}),
		});
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
		addBtn: { onclick: () => openModal() },
		categoriesTable: {
			inner: () => {
				const list = categories.get();
				return list.map((cat) =>
					tpl.categoryRow({
						nodes: {
							catName: {
								nodes: {
									catNameText: { inner: cat.name },
									mobileInfo: {
										nodes: {
											mobPath: { inner: cat.path || 'No path' },
											mobColorPreview: { style: { backgroundColor: cat.color > 0 ? numberToColor(cat.color) : 'transparent' } },
											mobEditBtn: {
												onclick: () => openModal(cat),
											},
											mobDeleteBtn: {
												onclick: () => handleDelete(cat.id),
											},
										},
									},
								},
							},
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
	});
});
