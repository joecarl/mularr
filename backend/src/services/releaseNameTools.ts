import type { IndexerFeedMediaType } from '../types/IndexerFeedTypes';

/**
 * Helpers to match eD2k release names against what Sonarr/Radarr ask for. Shared by the Torznab
 * controller (episode searches), the *arr wanted sync (see services/arrsync) and the provider feeds
 * (see services/indexerfeed).
 */

// 0* absorbs zero-padding (S01E07 == S1E7); \s? allows a split SxxEyy.
const EPISODE_PATTERNS = [/\bs0*(\d+)\s?e0*(\d+)\b/i, /\b0*(\d+)x0*(\d+)\b/i];

/** Normalizes dot/underscore separators so word boundaries hold in release names. */
function normalizeSeparators(name: string): string {
	return name.replace(/[._]/g, ' ');
}

/** True when the release name carries the given season/episode (S01E07, S1E7, 1x07...). */
export function releaseMatchesEpisode(name: string, season: number, ep: number): boolean {
	const normalized = normalizeSeparators(name);
	for (const pattern of EPISODE_PATTERNS) {
		const m = normalized.match(pattern);
		if (m && parseInt(m[1], 10) === season && parseInt(m[2], 10) === ep) {
			return true;
		}
	}
	return false;
}

export function filterByEpisode<T extends { name: string }>(results: T[], season: number, ep: number): T[] {
	return results.filter((r) => releaseMatchesEpisode(r.name, season, ep));
}

/**
 * Feed category of a release nobody classified: an episode marker (S01E07, 1x07) makes it TV, anything else
 * is offered as a movie. The *arr parse the name themselves, so a wrong guess only means the release is
 * served to the app that will ignore it.
 */
export function guessMediaType(name: string): IndexerFeedMediaType {
	const normalized = normalizeSeparators(name);
	return EPISODE_PATTERNS.some((pattern) => pattern.test(normalized)) ? 'tv' : 'movie';
}

const VIDEO_EXTENSIONS = new Set(['mkv', 'mp4', 'avi', 'm4v', 'mov', 'wmv', 'ts', 'm2ts', 'mpg', 'mpeg', 'webm', 'flv', 'ogm', 'divx', 'iso']);

/** True when the file name has a video container extension: what the *arr can import, and all the feed offers them. */
export function isVideoFileName(name: string): boolean {
	const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
	return name.includes('.') && VIDEO_EXTENSIONS.has(ext);
}

/** True when the release name carries the given year as a standalone token (e.g. "Movie (1995)", "Movie.1995.1080p"). */
export function releaseMatchesYear(name: string, year: number): boolean {
	return new RegExp(`(^|[^0-9])${year}([^0-9]|$)`).test(normalizeSeparators(name));
}

/**
 * Releases often drop apostrophes (e.g. "Widow's Bay" -> "Widows Bay"), so the query is widened to
 * match both spellings.
 */
export function expandApostrophes(query: string): string {
	const stripped = query.replace(/['’]/g, '');
	return stripped === query || stripped.trim() === '' ? query : `${query} OR ${stripped}`;
}
