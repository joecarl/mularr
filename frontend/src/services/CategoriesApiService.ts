import { BaseApiService } from './BaseApiService';

export interface Category {
	id: number;
	name: string;
	path: string;
	comment: string;
	color: number;
	priority: number;
}

export class CategoriesApiService extends BaseApiService {
	constructor() {
		super('/api/amule/categories');
	}

	public async getAll(): Promise<Category[]> {
		return this.request<Category[]>('/');
	}

	public async create(category: Partial<Category>): Promise<Category> {
		return this.request<Category>('/', {
			method: 'POST',
			body: JSON.stringify(category),
		});
	}

	public async update(id: number, category: Partial<Category>, moveFiles = false): Promise<Category> {
		return this.request<Category>(`/${id}`, {
			method: 'PUT',
			body: JSON.stringify({ ...category, moveFiles }),
		});
	}

	public async delete(id: number): Promise<void> {
		return this.request<void>(`/${id}`, {
			method: 'DELETE',
		});
	}
}
