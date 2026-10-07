import { createHash } from 'crypto';
import { parseEd2kLink } from '../tools/eD2kTools';
import type { MediaTransfer } from '../types/MediaTypes';

/** Seed limits as configured (see AppConfig.seeding); 0 means no limit of that kind. */
export interface SeedLimits {
	ratioLimit: number;
	timeLimitMinutes: number;
}

/**
 * Share limits as sent to torrents/setShareLimits (qBittorrent semantics: >= 0 a limit, -1 none, -2 the
 * client's global one, which Mularr doesn't have). Only a real limit is kept; anything else clears it.
 */
export function parseShareLimit(raw: unknown): number | null {
	const value = Number(raw);
	return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Seeding fields of a torrents/info entry, as Sonarr/Radarr read them to decide whether a finished
 * download may be removed (and, with it, whether they move or copy its file on import). They remove
 * when state is pausedUP/stoppedUP and a limit is reached: `ratio >= ratio_limit` when ratio_limit >= 0,
 * or `seeding_time >= seeding_time_limit` (minutes) when seeding_time_limit >= 0; -1 means no limit of
 * that kind. The limits are the ones they set themselves on the download (see MediaTransfer.seedRatioLimit,
 * from the Seed Ratio / Seed Time fields of their indexer), each falling back to the configured one
 * (qBittorrent's -2, "use the global limit"). Without any, the ratio limit is 0, which the ratio always
 * satisfies, so the download is removable right after import.
 */
export function seedStats(t: MediaTransfer, defaults: SeedLimits, now = Date.now()) {
	const size = t.size || 0;
	const ratio = size > 0 ? (t.uploadedTotal || 0) / size : 0;
	// Seconds sharing the finished file; records completed before completedOn existed count from when they were added
	const since = t.isCompleted ? Date.parse(t.completedOn ?? t.addedOn ?? '') : NaN;
	const seedingTime = Number.isFinite(since) ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
	// A provider that doesn't share the file (uploadedTotal unset: Telegram, Hispashare) can never reach a
	// ratio, so a ratio limit would keep the download forever; only the time limit applies to it.
	const defaultRatio = defaults.ratioLimit > 0 ? defaults.ratioLimit : null;
	const defaultTime = defaults.timeLimitMinutes > 0 ? defaults.timeLimitMinutes : null;
	const ratioLimit = t.uploadedTotal !== undefined ? (t.seedRatioLimit ?? defaultRatio) : null;
	const timeLimit = t.seedTimeLimit ?? defaultTime;
	const hasLimit = ratioLimit !== null || timeLimit !== null;
	return {
		ratio: Math.round(ratio * 1000) / 1000,
		seeding_time: seedingTime,
		ratio_limit: !hasLimit ? 0 : (ratioLimit ?? -1),
		seeding_time_limit: timeLimit ?? -1,
		inactive_seeding_time_limit: -1,
	};
}

export function hashToBtih(hash: string): string {
	// Lowercase before hashing so the btih is identical whether computed from a
	// search-result hash (the magnet Sonarr grabs) or a transfer hash (reported
	// in torrents/info) — both must hash to the same 40-hex id or Sonarr can't
	// reconcile the grab with the download. No-op for the magnet path, already
	// lowercase hex.
	const btih = createHash('sha1').update(hash.toLowerCase()).digest('hex'); // 40 chars hex
	return btih;
}

/**
 * True if `clientHash` (from a qBittorrent client like Sonarr/Radarr) refers to
 * the transfer `mularrHash`. The transfer hash is provider-specific — a 32-hex
 * eD2k hash for aMule, or a custom hash minted for Telegram/future providers —
 * so never assume eD2k. Clients only know the fake 40-hex btih we advertise
 * (sha1 of the hash, one-way), so match forward: clientHash equals the transfer
 * hash directly or its btih. Case-insensitive.
 */
export function clientHashMatchesMularrHash(mularrHash: string | undefined, clientHash: string): boolean {
	if (!mularrHash || !clientHash) return false;
	const c = clientHash.toLowerCase();
	return mularrHash.toLowerCase() === c || hashToBtih(mularrHash) === c;
}

export function hashToFakeMagnet(hash: string): string {
	// Hash determinístico (Radarr solo valida formato)
	const btih = hashToBtih(hash);
	const dn = encodeURIComponent(hash);

	return `magnet:?xt=urn:btih:${btih}&dn=${dn}`;
}

export function eD2kLinkToFakeMagnet(link: string): string {
	const linkData = parseEd2kLink(link);
	if (!linkData) throw new Error(`Invalid eD2k link: ${link}`);
	// Hash determinístico (Radarr solo valida formato)
	const btih = hashToBtih(linkData.hash);
	const dn = encodeURIComponent(link);

	return `magnet:?xt=urn:btih:${btih}&dn=${dn}`;
}

interface ExtractedFileRef {
	/**
	 * A valid file reference which can be used to add a download to the media provider service.
	 */
	ref: string;
	/**
	 * The hash extracted from the file reference. This can be an eD2k hash or a custom hash.
	 */
	hash: string;
	type: string | undefined;
}

/**
 * Extracts the file reference from a magnet link. The reference can be:
 * - an eD2k link (never an eD2k hash, since amule cannot download from a hash alone unless it is the last search result)
 * - a custom hash (for Telegram or future providers)
 */
export function extractFileRefFromMagnet(magnet: string): ExtractedFileRef | null {
	if (!magnet.startsWith('magnet:?')) return null;

	const query = magnet.substring('magnet:?'.length);
	const params = new URLSearchParams(query);

	const dn = params.get('dn');
	if (!dn) return null;

	const decoded = decodeURIComponent(dn);

	const ed2kMatch = parseEd2kLink(decoded);

	const res: ExtractedFileRef = {
		ref: decoded,
		hash: decoded,
		type: undefined,
	};
	if (ed2kMatch) {
		res.hash = ed2kMatch.hash;
		res.type = 'ed2k';
	}

	return res;
}

/**
Torrent properties mapping:
save_path	string	Torrent save path
creation_date	integer	Torrent creation date (Unix timestamp)
piece_size	integer	Torrent piece size (bytes)
comment	string	Torrent comment
total_wasted	integer	Total data wasted for torrent (bytes)
total_uploaded	integer	Total data uploaded for torrent (bytes)
total_uploaded_session	integer	Total data uploaded this session (bytes)
total_downloaded	integer	Total data downloaded for torrent (bytes)
total_downloaded_session	integer	Total data downloaded this session (bytes)
up_limit	integer	Torrent upload limit (bytes/s)
dl_limit	integer	Torrent download limit (bytes/s)
time_elapsed	integer	Torrent elapsed time (seconds)
seeding_time	integer	Torrent elapsed time while complete (seconds)
nb_connections	integer	Torrent connection count
nb_connections_limit	integer	Torrent connection count limit
share_ratio	float	Torrent share ratio
addition_date	integer	When this torrent was added (unix timestamp)
completion_date	integer	Torrent completion date (unix timestamp)
created_by	string	Torrent creator
dl_speed_avg	integer	Torrent average download speed (bytes/second)
dl_speed	integer	Torrent download speed (bytes/second)
eta	integer	Torrent ETA (seconds)
last_seen	integer	Last seen complete date (unix timestamp)
peers	integer	Number of peers connected to
peers_total	integer	Number of peers in the swarm
pieces_have	integer	Number of pieces owned
pieces_num	integer	Number of pieces of the torrent
reannounce	integer	Number of seconds until the next announce
seeds	integer	Number of seeds connected to
seeds_total	integer	Number of seeds in the swarm
total_size	integer	Torrent total size (bytes)
up_speed_avg	integer	Torrent average upload speed (bytes/second)
up_speed	integer	Torrent upload speed (bytes/second)
isPrivate	bool	True if torrent is from a private tracker
*/

/*
Torrent info mapping:
added_on	integer	Time (Unix Epoch) when the torrent was added to the client
amount_left	integer	Amount of data left to download (bytes)
auto_tmm	bool	Whether this torrent is managed by Automatic Torrent Management
availability	float	Percentage of file pieces currently available
category	string	Category of the torrent
completed	integer	Amount of transfer data completed (bytes)
completion_on	integer	Time (Unix Epoch) when the torrent completed
content_path	string	Absolute path of torrent content (root path for multifile torrents, absolute file path for singlefile torrents)
dl_limit	integer	Torrent download speed limit (bytes/s). -1 if unlimited.
dlspeed	integer	Torrent download speed (bytes/s)
downloaded	integer	Amount of data downloaded
downloaded_session	integer	Amount of data downloaded this session
eta	integer	Torrent ETA (seconds)
f_l_piece_prio	bool	True if first last piece are prioritized
force_start	bool	True if force start is enabled for this torrent
hash	string	Torrent hash
isPrivate	bool	True if torrent is from a private tracker (added in 5.0.0)
last_activity	integer	Last time (Unix Epoch) when a chunk was downloaded/uploaded
magnet_uri	string	Magnet URI corresponding to this torrent
max_ratio	float	Maximum share ratio until torrent is stopped from seeding/uploading
max_seeding_time	integer	Maximum seeding time (seconds) until torrent is stopped from seeding
name	string	Torrent name
num_complete	integer	Number of seeds in the swarm
num_incomplete	integer	Number of leechers in the swarm
num_leechs	integer	Number of leechers connected to
num_seeds	integer	Number of seeds connected to
priority	integer	Torrent priority. Returns -1 if queuing is disabled or torrent is in seed mode
progress	float	Torrent progress (percentage/100)
ratio	float	Torrent share ratio. Max ratio value: 9999.
ratio_limit	float	TODO (what is different from max_ratio?)
save_path	string	Path where this torrent's data is stored
seeding_time	integer	Torrent elapsed time while complete (seconds)
seeding_time_limit	integer	TODO (what is different from max_seeding_time?) seeding_time_limit is a per torrent setting, when Automatic Torrent Management is disabled, furthermore then max_seeding_time is set to seeding_time_limit for this torrent. If Automatic Torrent Management is enabled, the value is -2. And if max_seeding_time is unset it have a default value -1.
seen_complete	integer	Time (Unix Epoch) when this torrent was last seen complete
seq_dl	bool	True if sequential download is enabled
size	integer	Total size (bytes) of files selected for download
state	string	Torrent state. See table here below for the possible values
super_seeding	bool	True if super seeding is enabled
tags	string	Comma-concatenated tag list of the torrent
time_active	integer	Total active time (seconds)
total_size	integer	Total size (bytes) of all file in this torrent (including unselected ones)
tracker	string	The first tracker with working status. Returns empty string if no tracker is working.
up_limit	integer	Torrent upload speed limit (bytes/s). -1 if unlimited.
uploaded	integer	Amount of data uploaded
uploaded_session	integer	Amount of data uploaded this session
upspeed	integer	Torrent upload speed (bytes/s)
*/
