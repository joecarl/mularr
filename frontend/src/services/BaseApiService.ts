/** Request failure carrying the HTTP status so callers can branch on it
 * (e.g. 502 = upstream m3u unreachable vs 400 = invalid input). */
export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
	}
}

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
			throw new ApiError('Session expired', response.status);
		}

		if (!response.ok) {
			const error = await response.json().catch(() => ({ error: 'Unknown error' }));
			throw new ApiError(error.error || `Request failed with status ${response.status}`, response.status);
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
