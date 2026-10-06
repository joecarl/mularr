import { LoggerFactory } from '../logging/Logger';

/**
 * Client for the public Hispashare API (https://api.hispashare.org, OpenAPI at /openapi.json). Hispashare
 * catalogues eD2k releases by title: a search returns titles, each with releases, each with ed2k links.
 * Downloads never go through here (aMule handles the links); this is search only.
 *
 * The API allows 250 requests per hour per token, so every response is cached for a while (the *arr repeat
 * the same title search per episode) and background searches keep a reserve for the ones a user is waiting for.
 */

export const HISPASHARE_DEFAULT_API_URL = 'https://api.hispashare.org';
export const HISPASHARE_WEB_URL = 'https://www.hispashare.org';

/** Page of a title on the Hispashare website. */
export function hispashareTitleUrl(titleId: number): string {
	return `${HISPASHARE_WEB_URL}/?view=title&id=${titleId}`;
}

export interface HispashareRelease {
	date: string;
	codec_video: string;
	codec_audio: string;
	language: string[];
	format: string;
	release_info: string;
	/** Bytes, as a string in the API. */
	size: string;
	elinks: string[];
}

export interface HispashareTitle {
	id: number;
	imdb_id: string | null;
	title: string;
	original_title: string;
	synopsis: string;
	production_year: number;
	type: 'movie' | 'music' | 'documentary' | 'series' | null;
	cover: string;
	updated_at: string;
	releases: HispashareRelease[];
}

/** What the API reported last about the token's quota. */
export interface HispashareRateLimit {
	/** Requests per hour, null until the first response. */
	limit: number | null;
	/** Requests left in the current hour, null until the first response. */
	remaining: number | null;
	/** Epoch ms until which requests are refused after a 429, null when not throttled. */
	retryUntil: number | null;
}

/** Thrown when a request is not sent because of the quota (a 429, or the reserve for interactive searches). */
export class HispashareRateLimitError extends Error {}

/** One page of `GET /titles`, see listRecentTitles. */
export interface HispashareTitlesPage {
	titles: HispashareTitle[];
	/** Cursor of the next page, null on the last one. */
	nextCursor: string | null;
	hasMore: boolean;
}

/** Body of the title endpoints; the paging fields come with `/titles` only. */
interface TitlesBody {
	data?: unknown;
	next_cursor?: string | null;
	has_more?: boolean;
}

const REQUEST_TIMEOUT_MS = 20_000;
/** Identical requests within this window are served from memory and cost no quota. */
const CACHE_TTL_MS = 15 * 60_000;
/** Requests kept for searches a user is waiting for; background searches stop below this. */
const BACKGROUND_RESERVE = 30;
/** Pause after a 429 when the API sends no Retry-After. */
const DEFAULT_RETRY_AFTER_MS = 60_000;

export class HispashareApiClient {
	private readonly logger = LoggerFactory.create(this);
	private readonly baseUrl: string;
	readonly rateLimit: HispashareRateLimit = { limit: null, remaining: null, retryUntil: null };
	private readonly cache = new Map<string, { expiresAt: number; body: TitlesBody }>();

	constructor(
		baseUrl: string,
		private readonly token: string
	) {
		this.baseUrl = (baseUrl.trim() || HISPASHARE_DEFAULT_API_URL).replace(/\/+$/, '');
	}

	/** Titles whose title or original title contains `q` (first page, newest updates first). */
	async searchTitles(q: string, interactive: boolean): Promise<HispashareTitle[]> {
		return titlesOf(await this.get('/titles', { q }, interactive));
	}

	/** Titles catalogued under an IMDb id; usually zero or one. */
	async titlesByImdb(imdbId: string, interactive: boolean): Promise<HispashareTitle[]> {
		return titlesOf(await this.get(`/titles/imdb/${encodeURIComponent(imdbId)}`, {}, interactive));
	}

	/**
	 * A page of the whole catalogue, most recently updated titles first; `cursor` continues the previous page.
	 * A background request (it keeps the interactive reserve) that bypasses the cache: the first page is
	 * exactly what changes between two polls of the feed.
	 */
	async listRecentTitles(cursor?: string): Promise<HispashareTitlesPage> {
		const params: Record<string, string> = { sort_by: 'updated_at', sort_order: 'desc' };
		if (cursor) params.cursor = cursor;
		const body = await this.get('/titles', params, false, false);
		return { titles: titlesOf(body), nextCursor: typeof body.next_cursor === 'string' ? body.next_cursor : null, hasMore: body.has_more === true };
	}

	/** Validates the token with the cheapest authenticated call and refreshes the quota counters. Costs one request. */
	async checkToken(): Promise<HispashareRateLimit> {
		await this.get('/titles', { q: '' }, true, false);
		return this.rateLimit;
	}

	/** `cache` false neither reads nor stores the response: for requests whose answer is expected to change. */
	private async get(path: string, params: Record<string, string>, interactive: boolean, cache = true): Promise<TitlesBody> {
		const url = new URL(`${this.baseUrl}${path}`);
		for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
		const key = url.toString();

		const cached = cache ? this.cache.get(key) : undefined;
		if (cached) {
			if (cached.expiresAt > Date.now()) return cached.body;
			this.cache.delete(key);
		}

		const now = Date.now();
		if (this.rateLimit.retryUntil !== null && this.rateLimit.retryUntil > now) {
			throw new HispashareRateLimitError(`Hispashare rate limit exceeded; retry in ${Math.ceil((this.rateLimit.retryUntil - now) / 1000)} s`);
		}
		if (!interactive && this.rateLimit.remaining !== null && this.rateLimit.remaining <= BACKGROUND_RESERVE) {
			throw new HispashareRateLimitError(
				`Hispashare quota low (${this.rateLimit.remaining} left); the remaining requests are kept for interactive searches`
			);
		}

		let response: Response;
		try {
			response = await fetch(url, {
				headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch (error: any) {
			const cause = error?.cause?.code ?? error?.cause?.message ?? error?.name ?? error?.message;
			throw new Error(`Cannot reach ${url.host}: ${cause}`);
		}
		this.readRateLimitHeaders(response);

		if (response.status === 429) {
			const retryAfter = parseInt(response.headers.get('retry-after') ?? '', 10);
			this.rateLimit.retryUntil = Date.now() + (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : DEFAULT_RETRY_AFTER_MS);
			this.logger.warn(`Hispashare answered 429; pausing requests for ${Math.round((this.rateLimit.retryUntil - Date.now()) / 1000)} s`);
			throw new HispashareRateLimitError('Hispashare rate limit exceeded');
		}
		if (response.status === 401) throw new Error('Invalid Hispashare token');
		if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url.pathname}`);

		const body = (await response.json()) as TitlesBody;
		if (cache) this.cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, body });
		return body;
	}

	private readRateLimitHeaders(response: Response): void {
		const limit = parseInt(response.headers.get('ratelimit-limit') ?? '', 10);
		const remaining = parseInt(response.headers.get('ratelimit-remaining') ?? '', 10);
		if (Number.isFinite(limit)) this.rateLimit.limit = limit;
		if (Number.isFinite(remaining)) this.rateLimit.remaining = remaining;
		if (response.status !== 429) this.rateLimit.retryUntil = null;
	}
}

function titlesOf(body: TitlesBody): HispashareTitle[] {
	return Array.isArray(body.data) ? (body.data as HispashareTitle[]) : [];
}
