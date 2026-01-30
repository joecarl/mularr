

export class ApiService {
	private static instance: ApiService;
	private baseUrl = import.meta.env.DEV ? 'http://localhost:8940/api' : '/api';

	private constructor() {}

	public static getInstance(): ApiService {
		if (!ApiService.instance) {
			ApiService.instance = new ApiService();
		}
		return ApiService.instance;
	}

	private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
		const response = await fetch(`${this.baseUrl}${path}`, {
			...options,
			headers: {
				'Content-Type': 'application/json',
				...options.headers,
			},
		});

		if (!response.ok) {
			const error = await response.json().catch(() => ({ error: 'Unknown error' }));
			throw new Error(error.error || `Request failed with status ${response.status}`);
		}

		if (response.status === 204) {
			return undefined as any;
		}

		const contentType = response.headers.get('content-type');
		if (contentType && contentType.includes('application/json')) {
			return response.json().catch(() => undefined as any);
		}

		return response.text() as any;
	}


	// async createWhatever(id: number): Promise<void> {
	// 	return this.request<void>(`/whatever/${id}`, {
	// 		method: 'POST',
	// 	});
	// }
}

export const apiService = ApiService.getInstance();
