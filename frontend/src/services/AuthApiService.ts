export interface AuthStatus {
	enabled: boolean;
	hasCredentials: boolean;
	hasApiKey: boolean;
}

const TOKEN_KEY = 'mularr.auth.token';

export class AuthApiService {
	private readonly baseUrl = '/api/auth';

	getToken(): string | null {
		return localStorage.getItem(TOKEN_KEY);
	}

	setToken(token: string): void {
		localStorage.setItem(TOKEN_KEY, token);
	}

	clearToken(): void {
		localStorage.removeItem(TOKEN_KEY);
	}

	isLoggedIn(): boolean {
		return !!this.getToken();
	}

	async getStatus(): Promise<AuthStatus> {
		const res = await fetch(`${this.baseUrl}/status`);
		if (!res.ok) throw new Error('Failed to fetch auth status');
		return res.json();
	}

	async login(username: string, password: string): Promise<void> {
		const res = await fetch(`${this.baseUrl}/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username, password }),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({ error: 'Login failed' }));
			throw new Error(err.error || 'Login failed');
		}
		const { token } = await res.json();
		this.setToken(token);
	}

	logout(): void {
		this.clearToken();
	}
}
