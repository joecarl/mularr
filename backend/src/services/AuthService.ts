import crypto from 'crypto';
import jwt from 'jsonwebtoken';

export interface AuthStatus {
	enabled: boolean;
	hasCredentials: boolean;
	hasApiKey: boolean;
}

export class AuthService {
	private readonly username?: string;
	private readonly password?: string;
	private readonly apiKey?: string;
	private readonly jwtSecret: string;

	constructor() {
		this.username = process.env.AUTH_USERNAME;
		this.password = process.env.AUTH_PASSWORD;
		this.apiKey = process.env.API_KEY;

		const envSecret = process.env.JWT_SECRET;
		if (envSecret) {
			this.jwtSecret = envSecret;
		} else {
			// Auto-generate a random secret (invalidates on restart, acceptable)
			this.jwtSecret = crypto.randomBytes(48).toString('hex');
			if (this.isAuthEnabled()) {
				console.warn('[AuthService] JWT_SECRET not set — session tokens will be invalidated on restart.');
			}
		}
	}

	isAuthEnabled(): boolean {
		return !!(this.username || this.apiKey);
	}

	getStatus(): AuthStatus {
		return {
			enabled: this.isAuthEnabled(),
			hasCredentials: !!(this.username && this.password),
			hasApiKey: !!this.apiKey,
		};
	}

	validateCredentials(username: string, password: string): boolean {
		if (!this.username || !this.password) return false;
		return username === this.username && password === this.password;
	}

	validateApiKey(key: string): boolean {
		if (!this.apiKey) return false;
		// Use timing-safe comparison to prevent timing attacks
		try {
			return this.apiKey.length === key.length && crypto.timingSafeEqual(Buffer.from(this.apiKey), Buffer.from(key));
		} catch {
			return false;
		}
	}

	generateToken(username: string): string {
		return jwt.sign({ sub: username }, this.jwtSecret, { expiresIn: '7d' });
	}

	validateToken(token: string): boolean {
		try {
			jwt.verify(token, this.jwtSecret);
			return true;
		} catch {
			return false;
		}
	}
}
