export abstract class BaseApiService {
	protected baseUrl = '/api';

	protected constructor(baseUrl: string) {
		this.baseUrl = baseUrl;
	}

	protected async request<T>(path: string, options: RequestInit = {}): Promise<T> {
		// Add timestamp to avoid caching issues
		const url = new URL(`${this.baseUrl}${path}`, window.location.origin);
		url.searchParams.append('_', Date.now().toString());

		const token = localStorage.getItem('mularr.auth.token');
		const authHeader: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

		const response = await fetch(url.toString(), {
			...options,
			headers: {
				'Content-Type': 'application/json',
				...authHeader,
				...options.headers,
			},
		});

		if (response.status === 401) {
			// Token expired or invalid — clear it and reload so main.ts will show LoginView
			localStorage.removeItem('mularr.auth.token');
			window.location.reload();
			throw new Error('Session expired');
		}

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
}
