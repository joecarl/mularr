import { Request, Response, NextFunction } from 'express';
import { container } from '../services/container/ServiceContainer';
import { AuthService } from '../services/AuthService';

function parseSidCookie(req: Request): string | undefined {
	const cookieHeader = req.headers.cookie || '';
	for (const part of cookieHeader.split(';')) {
		const [key, ...rest] = part.trim().split('=');
		if (key === 'SID') return rest.join('=');
	}
	return undefined;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
	const authService = container.get(AuthService);

	if (!authService.isAuthEnabled()) {
		return next();
	}

	// 1. Authorization: Bearer <token|apikey>
	const authHeader = req.headers.authorization;
	if (authHeader?.startsWith('Bearer ')) {
		const token = authHeader.slice(7);
		if (authService.validateToken(token) || authService.validateApiKey(token)) {
			return next();
		}
	}

	// 2. X-Api-Key header (Sonarr / Prowlarr style)
	const xApiKey = req.headers['x-api-key'] as string | undefined;
	if (xApiKey && authService.validateApiKey(xApiKey)) {
		return next();
	}

	// 3. Cookie: SID=<key> (qBittorrent compat — used by Sonarr after qbt login)
	const sid = parseSidCookie(req);
	if (sid) {
		// API key stored as SID — always valid, no refresh needed
		if (authService.validateApiKey(sid)) {
			return next();
		}
		// JWT stored as SID — refresh on every valid request (sliding window) so
		// the session never expires as long as Sonarr/Radarr keep polling.
		const refreshed = authService.refreshToken(sid);
		if (refreshed) {
			authService.setSidCookie(res, refreshed);
			return next();
		}
		// If the token is invalid or expired, clear the cookie to prevent confusion.
		console.log('[AuthMiddleware] Invalid or expired SID cookie, clearing it');
		authService.clearSidCookie(res);
	}

	// 4. ?apikey=<key> query param (Torznab / Newznab compat)
	const queryApiKey = req.query.apikey as string | undefined;
	if (queryApiKey && authService.validateApiKey(queryApiKey)) {
		return next();
	}

	console.warn(`[AuthMiddleware] Unauthorized request to ${req.method} ${req.path}`);
	// DEBUG INFO
	console.log('Headers:', req.headers);
	console.log('Query:', req.query);

	res.status(401).json({ error: 'Unauthorized' });
}
