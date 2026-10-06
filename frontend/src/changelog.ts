/**
 * User-facing changelog shown by the "What's new" dialog.
 *
 * Versions are listed newest first. Every entry has a globally unique,
 * strictly increasing `id`: the dialog stores the highest id it has shown in
 * localStorage and only presents entries with a higher id next time, so new
 * entries can be appended to an in-development version and still be notified.
 *
 * When adding an entry: use the next free id (highest existing + 1), never
 * reuse or reorder ids.
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
			{ id: 1, type: 'feature', text: 'Indexer feed: Mularr now exposes a Torznab-compatible feed so Sonarr/Radarr can pull releases from it.' },
			{ id: 2, type: 'feature', text: 'Extensions can be configured individually from a redesigned Extensions view.' },
			{ id: 3, type: 'feature', text: 'Hispashare search provider for eD2k searches and downloads.' },
			{ id: 4, type: 'feature', text: 'Table columns can be shown, hidden and resized; the layout is remembered per table.' },
			{ id: 5, type: 'improvement', text: 'Search providers can be selected per Arr sync and media search.' },
			{ id: 6, type: 'improvement', text: 'Transfer details and the indexer feed show the network and origin (search provider) of each download.' },
			{ id: 7, type: 'improvement', text: 'Telegram has its own section in the sidebar and is no longer managed as an extension.' },
			{ id: 8, type: 'improvement', text: 'aMule updated to 3.1.0 in the Docker image.' },
			{
				id: 9,
				type: 'feature',
				text: "What's new dialog: changes are grouped by version and shown once after each update. Click the version in the sidebar to open the full changelog.",
			},
			{
				id: 10,
				type: 'improvement',
				text: 'Telegram: the chats table shows indexed messages and files, size, topics, last message, last check and last error per chat, can be filtered, and chats can be indexed on demand.',
			},
			{
				id: 11,
				type: 'improvement',
				text: 'Indexer: with Hispashare enabled, Sonarr/Radarr automatic searches can look releases up by IMDb id, answered from the Hispashare catalogue.',
			},
			{
				id: 12,
				type: 'improvement',
				text: 'Telegram: the chats table can be sorted by column and rows can be selected; the row menu (right click) can clear the index of a chat or delete it, also for several chats at once.',
			},
			{
				id: 13,
				type: 'fix',
				text: 'Telegram: a chat the account has left or that no longer exists is disabled automatically, and messages of disabled chats are left out of searches, so they no longer cause errors.',
			},
			{
				id: 14,
				type: 'feature',
				text: 'Seed limits for Sonarr/Radarr: the qBittorrent API reports the real upload ratio of each finished download and honours the Seed Ratio / Seed Time set per indexer in Sonarr/Radarr, with global defaults in the SEED_RATIO_LIMIT and SEED_TIME_LIMIT_MINUTES environment variables. With a limit, the file is copied on import and keeps being shared until the limit is reached; without one, it is moved and the download removed right away, as before.',
			},
			{
				id: 15,
				type: 'fix',
				text: 'Removing a finished download no longer sends a delete to aMule for a file it already considers complete, which could bring the daemon down.',
			},
			{
				id: 16,
				type: 'feature',
				text: 'Telegram: a Join queue tab to paste a list of channel links (public usernames or invite links) that Mularr joins one by one in the background, pausing between joins and waiting whenever Telegram limits the account; joined chats can be enabled for indexing right away. Links of chats the account is already in are skipped.',
			},
			{
				id: 17,
				type: 'fix',
				text: 'Telegram: renaming a chat or a topic on Telegram no longer leaves stale entries in the search index, which could end in a "database disk image is malformed" error when clearing or deleting the chat. The index is rebuilt once after this update and repairs itself if the error ever shows up again.',
			},
			{
				id: 18,
				type: 'feature',
				text: 'Indexer feed: besides the Sonarr/Radarr wanted sync, the feed can now carry the newest releases of the providers themselves. A Hispashare extension can poll the catalogue periodically (option in its settings) and Telegram can publish the video files its indexer finds in already indexed chats (toggle in the Telegram view). Each source keeps its latest 1000 releases; their state shows in the Indexer Feed view.',
			},
			{
				id: 19,
				type: 'improvement',
				text: 'Indexer: the search providers selected in the Sonarr/Radarr extensions now also apply to the automatic searches those apps run through the Torznab indexer (Sonarr extensions to TV searches, Radarr extensions to movie searches). Without such an extension, or with one saved before the selection existed, every provider is searched as before.',
			},
		],
	},
];
