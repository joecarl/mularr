import type { IncomingMessage } from 'http';
import { Request, Response, NextFunction } from 'express';
import { container } from '../services/container/ServiceContainer';
import { AuthService } from '../services/AuthService';
import { LoggerFactory } from '../services/logging/Logger';

const logger = LoggerFactory.create('AuthMiddleware');

/**
 * Result of authenticating a raw HTTP request.
 *
 * - `refreshedSid`: when the request was authenticated via a JWT stored in the
 *   SID cookie, a freshly-signed token the caller should set back as the cookie
 *   (sliding-window session). Only meaningful for HTTP responses.
 * - `clearSid`: when an SID cookie was present but invalid, the caller should
 *   clear it so stale cookies don't linger.
 */
export type AuthOutcome = { authorized: true; refreshedSid?: string } | { authorized: false; clearSid: boolean };

function parseSidCookie(req: IncomingMessage): string | undefined {
	const cookieHeader = req.headers.cookie || '';
	for (const part of cookieHeader.split(';')) {
		const [key, ...rest] = part.trim().split('=');
		if (key === 'SID') return rest.join('=');
	}
	return undefined;
}

function parseQuery(req: IncomingMessage): URLSearchParams {
	// req.url is path + query only; the base is irrelevant, it's just needed to build a URL
	return new URL(req.url ?? '/', 'http://localhost').searchParams;
}

/** Which credential kinds the request carried, for the 401 log. Values are never included: they are the tokens themselves. */
function describePresentedCredentials(req: IncomingMessage): string {
	const present: string[] = [];
	if (req.headers.authorization) present.push('Authorization header');
	if (req.headers['x-api-key']) present.push('X-Api-Key header');
	if (parseSidCookie(req)) present.push('SID cookie');
	const query = parseQuery(req);
	if (query.has('apikey')) present.push('apikey query param');
	if (query.has('token')) present.push('token query param');
	return present.length > 0 ? present.join(', ') : 'none';
}

/**
 * Authenticates a raw `http.IncomingMessage`, so it works both for Express
 * routes and for the WebSocket upgrade request (which never reaches Express).
 *
 * Accepted credentials, in order:
 *   1. `Authorization: Bearer <jwt|apikey>` header
 *   2. `X-Api-Key: <apikey>` header (Sonarr / Prowlarr style)
 *   3. `SID=<jwt|apikey>` cookie (qBittorrent compat)
 *   4. `?apikey=<apikey>` query param (Torznab / Newznab compat)
 *   5. `?token=<jwt|apikey>` query param (browser WebSocket clients can't set headers)
 */
export function authenticateRequest(req: IncomingMessage): AuthOutcome {
	const authService = container.get(AuthService);

	if (!authService.isAuthEnabled()) {
		return { authorized: true };
	}

	// 1. Authorization: Bearer <token|apikey>
	const authHeader = req.headers.authorization;
	if (authHeader?.startsWith('Bearer ')) {
		const token = authHeader.slice(7);
		if (authService.validateToken(token) || authService.validateApiKey(token)) {
			return { authorized: true };
		}
	}

	// 2. X-Api-Key header (Sonarr / Prowlarr style)
	const xApiKey = req.headers['x-api-key'];
	if (typeof xApiKey === 'string' && authService.validateApiKey(xApiKey)) {
		return { authorized: true };
	}

	// 3. Cookie: SID=<key> (qBittorrent compat — used by Sonarr after qbt login)
	let clearSid = false;
	const sid = parseSidCookie(req);
	if (sid) {
		// API key stored as SID — always valid, no refresh needed
		if (authService.validateApiKey(sid)) {
			return { authorized: true };
		}
		// JWT stored as SID — refresh on every valid request (sliding window) so
		// the session never expires as long as Sonarr/Radarr keep polling.
		const refreshed = authService.refreshToken(sid);
		if (refreshed) {
			return { authorized: true, refreshedSid: refreshed };
		}
		// Invalid or expired: tell the caller to clear the cookie to prevent confusion.
		clearSid = true;
	}

	const query = parseQuery(req);

	// 4. ?apikey=<key> query param (Torznab / Newznab compat)
	const queryApiKey = query.get('apikey');
	if (queryApiKey && authService.validateApiKey(queryApiKey)) {
		return { authorized: true };
	}

	// 5. ?token=<jwt|apikey> query param (WebSocket clients from the browser)
	const queryToken = query.get('token');
	if (queryToken && (authService.validateToken(queryToken) || authService.validateApiKey(queryToken))) {
		return { authorized: true };
	}

	return { authorized: false, clearSid };
}

function handleAuth(req: Request, res: Response, next: NextFunction, reject: (res: Response) => void): void {
	const outcome = authenticateRequest(req);
	const authService = container.get(AuthService);

	if (outcome.authorized) {
		if (outcome.refreshedSid) authService.setSidCookie(res, outcome.refreshedSid);
		return next();
	}

	if (outcome.clearSid) {
		logger.debug('Invalid or expired SID cookie, clearing it');
		authService.clearSidCookie(res);
	}

	// Never dump headers or query here: they carry the tokens and API keys themselves
	logger.warn(
		`Unauthorized request to ${req.method} ${req.path} from ${req.socket.remoteAddress} (credentials presented: ${describePresentedCredentials(req)})`
	);

	reject(res);
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
	handleAuth(req, res, next, (r) => r.status(401).json({ error: 'Unauthorized' }));
}

/**
 * Same checks as `authMiddleware`, but rejects like qBittorrent does: `403 Forbidden`.
 * Sonarr/Radarr only drop their cached SID and log in again when the qBittorrent API
 * answers 403; on a 401 they keep retrying with the stale cookie forever. That happens
 * whenever a credentials-based session expires (7 days) or the JWT secret changes.
 */
export function qbittorrentAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
	handleAuth(req, res, next, (r) => r.status(403).send('Forbidden'));
}
