import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Response } from 'express';

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

	generateToken(username: string, noExpiry = false): string {
		if (noExpiry) {
			// No expiry for API-key-based logins: apps like Sonarr/Radarr do not
			// re-authenticate on 401, so expiring tokens would permanently break them.
			return jwt.sign({ sub: username }, this.jwtSecret);
		}
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

	/**
	 * Verifies a JWT and returns a freshly-signed token.
	 * Preserves the expiry behaviour of the original token: if it had no `exp`
	 * claim (API-key login), the refreshed token also has no expiry.
	 * Returns null if the token is invalid (wrong secret, malformed, etc.).
	 */
	refreshToken(token: string): string | null {
		try {
			const payload = jwt.verify(token, this.jwtSecret) as jwt.JwtPayload;
			return this.generateToken(payload.sub as string, !payload.exp);
		} catch {
			return null;
		}
	}

	/**
	 * Sets the SID cookie on the response. Max-Age is derived from the JWT `exp`
	 * claim so credential-based sessions expire with the token. For API-key tokens
	 * (no `exp` claim) a 10-year fallback is used so integrations like Sonarr/Radarr
	 * are never broken by cookie expiry.
	 */
	setSidCookie(res: Response, token: string): void {
		const NO_EXPIRY_MAX_AGE = 60 * 60 * 24 * 365 * 10; // 10 years in seconds
		let maxAge: number;
		try {
			const payload = jwt.decode(token) as jwt.JwtPayload;
			maxAge = payload?.exp ? payload.exp - Math.floor(Date.now() / 1000) : NO_EXPIRY_MAX_AGE;
		} catch {
			maxAge = NO_EXPIRY_MAX_AGE;
		}
		res.setHeader('Set-Cookie', `SID=${token}; HttpOnly; Path=/; Max-Age=${maxAge}`);
	}

	/** Clears the SID cookie by setting Max-Age=0. */
	clearSidCookie(res: Response): void {
		res.setHeader('Set-Cookie', 'SID=; HttpOnly; Path=/; Max-Age=0');
	}

	setSidCookieOpenMode(res: Response): void {
		res.setHeader('Set-Cookie', 'SID=mularr_open; HttpOnly; Path=/; Max-Age=3600');
	}
}
