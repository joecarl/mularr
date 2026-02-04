import { createHash } from 'crypto';

export function hashToBtih(hash: string): string {
	const btih = createHash('sha1').update(hash).digest('hex'); // 40 chars hex
	return btih;
}

export function hashToFakeMagnet(hash: string): string {
	// Hash determinístico (Radarr solo valida formato)
	const btih = hashToBtih(hash);
	const dn = encodeURIComponent(hash);

	return `magnet:?xt=urn:btih:${btih}&dn=${dn}`;
}

export function extractHashFromMagnet(magnet: string): string | null {
	if (!magnet.startsWith('magnet:?')) return null;

	const query = magnet.substring('magnet:?'.length);
	const params = new URLSearchParams(query);

	const dn = params.get('dn');
	if (!dn) return null;

	const decoded = decodeURIComponent(dn);

	return decoded;
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
