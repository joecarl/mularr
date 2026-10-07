/**
 * User-facing changelog shown by the "What's new" dialog.
 *
 * Versions are listed newest first. Every entry has a globally unique,
 * strictly increasing `id`: the dialog stores the highest id it has shown in
 * localStorage and only presents entries with a higher id next time, so new
 * entries can be appended to an in-development version and still be notified.
 *
 * When adding an entry: use the next free id (highest existing + 1), never
 * reuse or reorder ids. If the change is really progress on an entry of a
 * version not released yet, edit that entry instead of adding a new one.
 */

export type ChangelogEntryType = 'feature' | 'improvement' | 'fix';

export interface ChangelogEntry {
	id: number;
	type: ChangelogEntryType;
	text: string;
}

export interface ChangelogVersion {
	/** Version without pre-release suffix, e.g. "1.0.0". */
	version: string;
	/** Release date (YYYY-MM-DD); omitted while the version is still in development. */
	date?: string;
	entries: ChangelogEntry[];
}

export const CHANGELOG: ChangelogVersion[] = [
	{
		version: '1.0.0',
		entries: [
			{
				id: 1,
				type: 'feature',
				text: 'Indexer feed: Mularr exposes a Torznab-compatible feed that Sonarr/Radarr poll for new releases. eD2k has no such feed, so it is built from the Sonarr/Radarr wanted lists (periodic searches, configured per extension) and from the new releases the providers themselves report: Hispashare (option in its extension settings) and Telegram (toggle in the Telegram view). The Indexer Feed view shows the state of each source.',
			},
			{ id: 2, type: 'feature', text: 'Extensions can be configured individually from a redesigned Extensions view.' },
			{
				id: 3,
				type: 'feature',
				text: 'Hispashare search provider: its catalogue of eD2k releases shows up in searches next to aMule and is downloaded by aMule. With it enabled, Sonarr/Radarr automatic searches can also look releases up by IMDb id.',
			},
			{ id: 4, type: 'feature', text: 'Table columns can be shown, hidden and resized; the layout is remembered per table.' },
			{
				id: 5,
				type: 'improvement',
				text: 'Search providers can be chosen per search in the Search view and per Sonarr/Radarr extension, where the selection applies both to the wanted sync and to the automatic searches that app runs through the indexer (Sonarr extensions to TV searches, Radarr extensions to movie searches; with several instances of one app, each can use the indexer path shown in its extension to apply only its own selection). The wanted sync itself is optional: with it off, the extension needs no URL or API key.',
			},
			{ id: 6, type: 'improvement', text: 'Transfer details and the indexer feed show the network and origin (search provider) of each download.' },
			{
				id: 7,
				type: 'improvement',
				text: 'Telegram has its own section in the sidebar and is no longer managed as an extension. Its chats table shows indexed messages and files, size, topics, last message, last check and last error per chat; it can be filtered and sorted, rows can be selected, chats can be indexed on demand, and the row menu (right click) can clear the index of chats or delete them, also several at once.',
			},
			{ id: 8, type: 'improvement', text: 'aMule updated to 3.1.0 in the Docker image.' },
			{
				id: 9,
				type: 'feature',
				text: "What's new dialog: changes are grouped by version and shown once after each update. Click the version in the sidebar to open the full changelog.",
			},
			{
				id: 13,
				type: 'fix',
				text: 'Telegram: a chat the account has left or that no longer exists is disabled automatically and its messages are left out of searches. Renaming a chat or a topic no longer leaves stale entries in the search index, which could end in a "database disk image is malformed" error; the index is rebuilt once after this update and repairs itself if the error ever shows up again.',
			},
			{
				id: 14,
				type: 'feature',
				text: 'Seed limits for Sonarr/Radarr: the qBittorrent API reports the real upload ratio of each finished download and honours the Seed Ratio / Seed Time set per indexer in Sonarr/Radarr, with global defaults in the SEED_RATIO_LIMIT and SEED_TIME_LIMIT_MINUTES environment variables. With a limit, the file is copied on import and keeps being shared until the limit is reached; without one, it is moved and the download removed right away, as before.',
			},
			{
				id: 15,
				type: 'fix',
				text: 'Removing a finished download no longer sends a EC delete command to aMule, which could bring the daemon down.',
			},
			{
				id: 16,
				type: 'feature',
				text: 'Telegram: a Join queue tab to paste a list of channel links (public usernames or invite links) that Mularr joins one by one in the background, pausing between joins and waiting whenever Telegram limits the account; joined chats can be enabled for indexing right away. Links of chats the account is already in are skipped.',
			},
			{
				id: 17,
				type: 'feature',
				text: 'Search tabs: every search opens in its own tab with its own results, so several searches can be kept open, compared and downloaded from. Tabs survive navigating away and reloading; the backend keeps the last 20 searches. Searches from other browsers or devices no longer replace what you are looking at.',
			},
			{
				id: 18,
				type: 'fix',
				text: 'A search from the Search view no longer gets its results replaced by the Sonarr/Radarr wanted sync or by an automatic search running at the same time (seen as unrelated Hispashare results showing up under your query). aMule runs one search at a time, so searches now queue: a new one waits for the previous one to settle (up to 15 s), and the tab shows while it is waiting.',
			},
			{
				id: 19,
				type: 'feature',
				text: 'The Storage & Status panel of the sidebar shows the free space of the disk holding the downloads (the volume mounted at the incoming and temp directories when running in Docker), refreshed every minute.',
			},
			{
				id: 20,
				type: 'improvement',
				text: 'The download speed in the bottom bar now includes the Telegram transfers, like the Total Download on the dashboard. The Storage & Status panel of the sidebar shows the main aMule figures only, with a "Show more" button for the rest.',
			},
		],
	},
];
