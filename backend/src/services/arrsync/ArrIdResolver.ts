import axios from 'axios';
import { container } from '../container/ServiceContainer';
import { MainDB } from '../db/MainDB';
import { parseArrConfig } from './ArrSyncService';
import { LoggerFactory } from '../logging/Logger';

const REQUEST_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 500;

/** A row of the *arr lookup endpoints; only the fields the match needs. */
interface ArrLookupCandidate {
	title?: unknown;
	originalTitle?: unknown;
	year?: unknown;
	imdbId?: unknown;
}

/** Lowercase, drop accents and punctuation, collapse whitespace: "Bullet Train (2022)" -> "bullet train 2022". */
function normalize(value: unknown): string {
	if (typeof value !== 'string') return '';
	return value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/['’]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

/** The year the query carries, if any: the last standalone 4-digit token ("1917 2019" -> 2019). */
function queryYear(normalizedQuery: string): number | null {
	const tokens = normalizedQuery.split(' ');
	for (let i = tokens.length - 1; i >= 0; i--) {
		if (/^\d{4}$/.test(tokens[i])) return Number(tokens[i]);
	}
	return null;
}

/** The query without its year token, so it can be compared against the title ("Bullet Train"). */
function queryTitle(normalizedQuery: string, year: number | null): string {
	if (year === null) return normalizedQuery;
	const tokens = normalizedQuery.split(' ');
	for (let i = tokens.length - 1; i >= 0; i--) {
		if (tokens[i] === String(year)) {
			tokens.splice(i, 1);
			break;
		}
	}
	return tokens.join(' ');
}

function matches(candidate: ArrLookupCandidate, normalizedQuery: string, titleQuery: string): boolean {
	return [candidate.title, candidate.originalTitle].some((value) => {
		const title = normalize(value);
		return title !== '' && (title === normalizedQuery || title === titleQuery);
	});
}

/**
 * Resolves a text query to an IMDb id through the *arr instance that sent it.
 *
 * Radarr and Sonarr search their indexers with the title held in their database, which for most films is
 * the original (English) one. A catalogue provider such as Hispashare indexes the Spanish releases, so a
 * text search for "Bullet Train 2022" finds nothing while the same film looked up by its IMDb id finds its
 * releases: the id is language-independent. The indexer's caps advertise `imdbid`, but the *arr do not send
 * it for these searches, so the query is looked up once in the calling app (`/movie/lookup`,
 * `/series/lookup`) and its id is handed to the id-searching providers while the rest keep the text.
 *
 * Results are cached in memory for 10 minutes, null included (the lookup found no match), so two identical
 * searches do not hit the app twice. At most 500 entries are kept; the oldest is dropped when it overflows.
 */
export class ArrIdResolver {
	private readonly logger = LoggerFactory.create(this);
	private readonly db = container.get(MainDB);
	/** Insertion order is the age order used to drop the oldest entry. */
	private readonly cache = new Map<string, string | null>();
	private readonly cacheExpiresAt = new Map<string, number>();

	async resolve(app: 'sonarr' | 'radarr', query: string): Promise<string | null> {
		const normalizedQuery = normalize(query);
		const cacheKey = `${app}:${normalizedQuery}`;

		try {
			const expiresAt = this.cacheExpiresAt.get(cacheKey);
			if (expiresAt !== undefined && expiresAt > Date.now()) return this.cache.get(cacheKey) ?? null;
			if (expiresAt !== undefined) {
				this.cache.delete(cacheKey);
				this.cacheExpiresAt.delete(cacheKey);
			}

			const extension = this.db.getAllExtensions().find((ext) => ext.enabled && ext.type === app);
			const config = extension ? parseArrConfig(extension.config) : null;
			if (!extension?.url?.trim() || !config?.apiKey) return null;

			const path = app === 'radarr' ? '/movie/lookup' : '/series/lookup';
			const baseUrl = extension.url.trim().replace(/\/+$/, '');
			const url = `${baseUrl}/api/v3${path}?term=${encodeURIComponent(query)}`;
			const response = await axios.get(url, {
				headers: { 'X-Api-Key': config.apiKey },
				timeout: REQUEST_TIMEOUT_MS,
			});
			const candidates: ArrLookupCandidate[] = Array.isArray(response.data) ? response.data : [];

			const year = queryYear(normalizedQuery);
			const title = queryTitle(normalizedQuery, year);
			const found = candidates.filter((candidate) => matches(candidate, normalizedQuery, title));
			const winner = (year !== null && found.find((candidate) => Number(candidate.year) === year)) || found[0];
			const imdbId = typeof winner?.imdbId === 'string' && winner.imdbId.trim() ? winner.imdbId.trim() : null;

			this.cacheResult(cacheKey, imdbId);
			return imdbId;
		} catch (error: any) {
			this.logger.warn(`Could not resolve "${query}" to an IMDb id through ${app}: ${error?.message ?? error}`);
			return null;
		}
	}

	private cacheResult(key: string, imdbId: string | null): void {
		this.cache.delete(key);
		this.cache.set(key, imdbId);
		this.cacheExpiresAt.set(key, Date.now() + CACHE_TTL_MS);
		while (this.cache.size > CACHE_MAX_ENTRIES) {
			const oldest = this.cache.keys().next().value;
			if (oldest === undefined) break;
			this.cache.delete(oldest);
			this.cacheExpiresAt.delete(oldest);
		}
	}
}
