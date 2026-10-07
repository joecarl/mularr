import type { IndexerFeedMediaType } from '../db/MainDB';
import type { MediaSearchResult } from '../mediaprovider';
import { expandApostrophes } from '../../tools/releaseNameTools';

/**
 * Base client for the *arr v3 API (Sonarr, Radarr): authentication, paging, the endpoints they share and
 * the contract the wanted sync relies on (getWantedSearchJobs). SonarrApiClient and RadarrApiClient add
 * what is specific to each app.
 */

export type ArrApp = 'sonarr' | 'radarr';

/** One search to run for the wanted sync and how to pick the wanted releases out of its results. */
export interface SearchJob {
	/** Identifies the job across runs (rotation is by last search time). */
	key: string;
	query: string;
	label: string;
	mediaType: IndexerFeedMediaType;
	/** IMDb id of the wanted title, for providers that can search by it. Null when the *arr has none. */
	imdbId: string | null;
	/** Wanted title as the *arr reports it, for display. */
	title: string;
	/** Pending units, for display: episode numbers ("S01E05") for a series, the year for a movie. */
	pending: string[];
	matches: (result: MediaSearchResult) => boolean;
}

/** ed2k servers ignore shorter keywords. */
const MIN_QUERY_LENGTH = 3;

/** Search query for a library title: drops the disambiguation year Sonarr appends ("Doctor Who (2005)"), widens apostrophes. */
export function titleToSearchQuery(title: string): string | null {
	const cleaned = title
		.replace(/\s*\(\d{4}\)\s*$/, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (cleaned.length < MIN_QUERY_LENGTH) return null;
	return expandApostrophes(cleaned);
}

export interface ArrSystemStatus {
	appName?: string;
	version?: string;
	instanceName?: string;
}

interface PagingResponse<T> {
	page: number;
	pageSize: number;
	totalRecords: number;
	records: T[];
}

const REQUEST_TIMEOUT_MS = 20_000;
const PAGE_SIZE = 200;
/** Hard stop for the pagination loop: 1000 wanted items is plenty for one sync run to pick from. */
const MAX_PAGES = 5;

/**
 * Normalizes an IMDb id to "tt1234567". The *arr APIs report it with the "tt" prefix; Torznab requests
 * carry the digits alone (Radarr strips the prefix). Anything else is null.
 */
export function toImdbId(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const digits = value.trim().toLowerCase().replace(/^tt/, '');
	return /^\d+$/.test(digits) ? `tt${digits}` : null;
}

export abstract class ArrApiClient {
	/** Which app this client speaks to; `system/status` must report the same appName. */
	abstract readonly app: ArrApp;
	private readonly baseUrl: string;

	constructor(
		baseUrl: string,
		private readonly apiKey: string
	) {
		// URL base installs (http://host/sonarr) are supported: /api/v3 is appended to whatever is given
		this.baseUrl = baseUrl.trim().replace(/\/+$/, '');
	}

	getSystemStatus(): Promise<ArrSystemStatus> {
		return this.get<ArrSystemStatus>('/system/status');
	}

	/** Reads the instance's wanted list and turns it into the searches that could satisfy it. */
	abstract getWantedSearchJobs(): Promise<SearchJob[]>;

	protected async getAllPages<T>(path: string, params: Record<string, string>): Promise<T[]> {
		const all: T[] = [];
		for (let page = 1; page <= MAX_PAGES; page++) {
			const res = await this.get<PagingResponse<T>>(path, { ...params, page: String(page), pageSize: String(PAGE_SIZE) });
			const records = Array.isArray(res.records) ? res.records : [];
			all.push(...records);
			if (records.length < PAGE_SIZE || all.length >= res.totalRecords) break;
		}
		return all;
	}

	protected async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
		const url = new URL(`${this.baseUrl}/api/v3${path}`);
		for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

		let response: Response;
		try {
			response = await fetch(url, {
				headers: { 'X-Api-Key': this.apiKey, Accept: 'application/json' },
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch (error: any) {
			// fetch's own message is a bare "fetch failed"; the cause carries the useful part (ECONNREFUSED, ENOTFOUND, timeout...)
			const cause = error?.cause?.code ?? error?.cause?.message ?? error?.name ?? error?.message;
			throw new Error(`Cannot reach ${url.host}: ${cause}`);
		}
		if (response.status === 401) throw new Error('Unauthorized: check the API key');
		if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url.pathname}`);
		return (await response.json()) as T;
	}
}
