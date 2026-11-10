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

// What separates the tokens of a file name: "El.principe..." and "El_principe..." read the same.
const SEPARATORS = ' \t._-';
const OPENERS = '([';
const CLOSERS = ')]';
// Punctuation an uploader may glue a year with: "(Julius Onah,2025)".
const GLUE = ',;:';

/**
 * The year of a release name, as Radarr's Parser.ReportMovieTitleRegex reads it in its "Normal movie
 * format" branch: (1(8|9)|20)\d{2} behind a [-_\W] that is not ")", "[" or "!", and before a (\W+|_|$).
 * 1080p, x264 and two years in a row (".2017.2160p") are not years, so hoistMovieYear never moves a
 * token Radarr would not have read as the year in the first place.
 */
const MOVIE_YEAR_RE = /(?<![^\W_)\[!])(?:1(?:8|9)|20)\d{2}(?!p|i|(?:1(?:8|9)|20)\d{2}|\]|\W(?:1(?:8|9)|20)\d{2})/i;

/**
 * An episode marker ("S01E22", "1x04", "23x1156"): the one anchor the *arr match a series by, and no anchor
 * at all for a movie. Hispashare lists whole seasons as movies (all six chapters of "Furioso (Temporada 1)"
 * arrive as `movie`), so an episode name that reaches the movie feed keeps its shape: moving its year in
 * front of the title only offers Radarr a movie nobody has. Capturing 1920x1080 is not a risk: a resolution
 * has no separator before its first digits, so it never reads as an episode.
 */
const EPISODE_RE = /(?:^|[^\p{L}\p{N}])(?:s\d{1,2}[ ._-]?e\d{1,4}|\d{1,2}x\d{2,4})(?![\p{L}\p{N}])/iu;

function strip(value: string, characters: string, side: 'start' | 'end' | 'both'): string {
	const hits = (index: number) => characters.includes(value.charAt(index));
	let start = 0;
	let end = value.length;
	if (side !== 'end') while (start < end && hits(start)) start++;
	if (side !== 'start') while (end > start && hits(end - 1)) end--;
	return value.slice(start, end);
}

function occurrences(value: string, character: string): number {
	return character ? value.split(character).length - 1 : 0;
}

/**
 * Radarr's movie parser takes everything before the first year as the movie title, and its title group is
 * lazy: a file name that hides the year behind a parenthetical is read as a movie nobody has. Radarr still
 * finds the year, but the title comes out wrong and the release is rejected as Unknown Movie:
 *
 *   La.decision.de.Anne.(Nick.Cassavetes,2009).(Spanish.English.Subs).BDrip.1080p.x264-AC3.mkv
 *   before: title "La.decision.de.Anne.(Nick.Cassavetes"  year 2009
 *   after:  title "La.decision.de.Anne"                    year 2009
 *
 * Hispashare file names are typed by hand and carry all these shapes: the director next to the year
 * ("(Nick.Cassavetes,2009)"), a collection and the director in front of it ("(Clasicos Disney) (1990
 * George Scribner)"), or the original title and the director in two groups ("Titulo (Original) (Director,
 * 2009)"), of which only the first one separates the title from the year. The repair is a *move*: the year
 * goes right after the title and every other token
 * keeps its place, its brackets and its separators -- nothing is dropped, nothing is invented, and a
 * dot-separated name stays dot-separated.
 *
 * A name whose year already follows the title is returned untouched, so clean names ("Movie (1995)",
 * "Movie.1995.1080p"), names without a year ("Movie.avi") and episode names ("One Piece 23x1156") are all
 * published verbatim. The eD2k link is built elsewhere, so the file everybody downloads keeps its name.
 */
export function hoistMovieYear(name: string): string {
	// An episode is matched by its season/episode marker, never by a year (see EPISODE_RE)
	if (EPISODE_RE.test(name)) return name;
	const match = MOVIE_YEAR_RE.exec(name);
	if (!match) return name;
	const year = match[0];
	const before = name.slice(0, match.index);
	const after = name.slice(match.index + year.length);
	// `before` is the movie title, then whatever the uploader dragged in front of the year
	let body = strip(before, SEPARATORS, 'end');
	// A bracket right before the year is the year's *own* group ("... (1990)"), not junk: "(Clasicos
	// Disney) (1990 George Scribner)" hides the year behind the first group and brackets it with the second.
	const lastChar = body.charAt(body.length - 1);
	const yearBracket = OPENERS.includes(lastChar) ? lastChar : '';
	if (yearBracket) body = body.slice(0, -1);
	// The title ends at the *first* group the uploader opened: "(Original) (Director, 2009)" hides the year
	// behind two groups, and only the first one separates the title from both of them (the last one left the
	// original title glued to the movie title, which Radarr reads as a movie nobody has just the same).
	const openings = [body.indexOf('('), body.indexOf('[')].filter((index) => index >= 0);
	const opening = openings.length > 0 ? Math.min(...openings) : -1;
	// Nothing but separators (or the year's own bracket) before the year: Radarr already reads this right
	if (opening < 0) return name;
	const title = strip(body.slice(0, opening), SEPARATORS, 'end');
	if (!title) return name;
	// Everything the uploader typed between the title and the year
	const junkStart = body.charAt(opening);
	let junk = strip(body.slice(opening), SEPARATORS + GLUE, 'end');
	// The separator the uploader used between the title and the junk is the one to join the head with
	const gap = SEPARATORS.includes(before.charAt(title.length)) ? before.charAt(title.length) : ' ';
	// The character behind the year is the separator that joins it with the rest of the name, and it is the
	// uploader's too: dropping it left the dot of the extension out of "... (Tousou) (2015).mkv" and out of
	// "... DVD-Rip.1964.mp4", which is a name with no file extension left in it.
	let restGap = gap;
	let rest = after;
	if (SEPARATORS.includes(rest.charAt(0))) {
		restGap = rest.charAt(0);
		rest = strip(rest, SEPARATORS, 'start');
	}
	if (yearBracket) {
		// The year lived in a group of its own. When the group closes right behind it ("(2026)") both brackets
		// are the year's and go with it: keeping the opening one would leave an empty "()" in the name
		// ("Furioso (Temporada 1) (2026) Furioso.1x05.mkv"). When it does not close there ("(1990 George
		// Scribner)"), the group carries junk that keeps its place behind the year and the bracket goes with it.
		const closer = CLOSERS.charAt(OPENERS.indexOf(yearBracket));
		if (closer && rest.charAt(0) === closer) {
			rest = rest.slice(1);
			if (SEPARATORS.includes(rest.charAt(0))) restGap = rest.charAt(0);
			rest = strip(rest, SEPARATORS, 'start');
		} else rest = yearBracket + rest;
	} else {
		// The year lived inside a group that opened *before* it ("(Julius Onah,2025)"): junk owns that
		// bracket now, so the one that closed the group after the year moves over with it
		const closer = CLOSERS.charAt(OPENERS.indexOf(junkStart));
		if (closer && occurrences(junk, junkStart) > occurrences(junk, closer)) {
			junk += closer;
			if (rest.charAt(0) === closer) {
				rest = rest.slice(1);
				if (SEPARATORS.includes(rest.charAt(0))) restGap = rest.charAt(0);
				rest = strip(rest, SEPARATORS, 'start');
			}
		}
	}
	const parts = [title, `(${year})`];
	if (strip(junk, SEPARATORS + GLUE, 'both')) parts.push(junk);
	let published = parts.join(gap);
	if (/[\p{L}\p{N}]/u.test(rest)) published += restGap + rest;
	// "( George Scribner)" -> "(George Scribner)", in either separator style
	return published.replace(/([([])[._\s]+/g, '$1');
}
