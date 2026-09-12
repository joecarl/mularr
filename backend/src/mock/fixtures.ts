/**
 * Static content of the mock dataset: file names, servers, chats and templates. MockWorld turns these into
 * live objects (hashes, progress, speeds, sources) with the seeded PRNG.
 *
 * Naming policy: every file name, seeded or generated, must read as content that is free to share, so a
 * screenshot never suggests the app is moving copyrighted material. That means free software, public domain
 * works, Creative Commons media (with the licence in the name when the kind of content could be ambiguous) or
 * the user's own recordings. No commercial titles, not even invented ones, and no scene-release formats
 * (BluRay/WEB-DL rips, release-group tags, "Setup.exe" installers).
 */
import type { Chat } from '../services/db/TelegramIndexerDB';

/** Seed of the shared PRNG (see MockRandom). Change it to get a different, equally stable dataset. */
export const MOCK_SEED = 20260912;

const MiB = 1024 * 1024;
export const mb = (n: number): number => Math.round(n * MiB);
export const gb = (n: number): number => Math.round(n * 1024 * MiB);

export interface FixtureFile {
	name: string;
	size: number;
	/** Category name, null for aMule's default category. */
	category: string | null;
}

/** Downloads still in the queue at start: five downloading (one of them without sources), one paused, one stopped. */
export const QUEUE_FILES: FixtureFile[] = [
	{ name: 'Big Buck Bunny (2008) 4K 60fps (Blender Open Movie, CC BY).mkv', size: gb(3.9), category: 'Movies' },
	{ name: 'MIT 6.006 Introduction to Algorithms - Lecture 04 (OpenCourseWare, CC BY-NC-SA).mp4', size: mb(940), category: 'Series' },
	{ name: 'Debian 12.5 netinst amd64.iso', size: mb(658), category: 'Software' },
	{ name: 'Open Goldberg Variations - Kimiko Ishizaka (CC0) [FLAC].zip', size: mb(412), category: 'Music' },
	{ name: 'SuperTuxKart 1.4 linux-64bit (GPL).tar.xz', size: mb(690), category: null },
	{ name: 'Pro Git, 2nd Edition - Scott Chacon (CC BY-NC-SA).pdf', size: mb(18.6), category: null },
	{ name: 'MIT 6.006 Introduction to Algorithms - Lecture 05 (OpenCourseWare, CC BY-NC-SA).mp4', size: mb(910), category: 'Series' },
];

/** Downloads already finished at start. They are also shared from their category directory. */
export const COMPLETED_FILES: FixtureFile[] = [
	{ name: 'MIT 6.006 Introduction to Algorithms - Lecture 03 (OpenCourseWare, CC BY-NC-SA).mp4', size: mb(905), category: 'Series' },
	{ name: 'Fedora-Workstation-Live-x86_64-40.iso', size: mb(2214), category: 'Software' },
	{ name: 'Free Music Archive - Ambient Selection Vol.2 (CC BY) [MP3 320].zip', size: mb(142), category: 'Music' },
	{ name: 'Sintel (2010) 1080p (Blender Open Movie, CC BY).mp4', size: gb(1.1), category: 'Movies' },
];

/** Files shared from the library directory, never tracked as downloads. */
export const LIBRARY_FILES: FixtureFile[] = [
	{ name: 'Apollo 11 Mission Report (NASA, public domain).pdf', size: mb(64), category: null },
	{ name: 'Northern Lights Timelapse 4K (own footage, CC0).mp4', size: mb(980), category: null },
	{ name: 'Home videos 1998 (VHS capture).avi', size: mb(1320), category: null },
];

export interface FixtureCategory {
	name: string;
	/** Directory name under the incoming directory; null keeps the files in the incoming directory itself. */
	dir: string | null;
	comment: string;
	color: number;
	priority: number;
}

/** aMule's default category (id 0) is added by MockWorld; these get ids 1..n. */
export const CATEGORIES: FixtureCategory[] = [
	{ name: 'Movies', dir: 'Movies', comment: 'Open movies and public domain films', color: 0x3366cc, priority: 0 },
	{ name: 'Series', dir: 'Series', comment: 'Lecture and web series', color: 0x33aa55, priority: 1 },
	{ name: 'Music', dir: 'Music', comment: 'Creative Commons and public domain recordings', color: 0xcc6633, priority: 0 },
	{ name: 'Software', dir: null, comment: 'ISOs and free software, kept in the incoming directory', color: 0x9933cc, priority: 2 },
];

export interface FixtureServer {
	name: string;
	description: string;
	ip: string;
	port: number;
	users: number;
	maxUsers: number;
	files: number;
	ping: number;
	version: string;
	/** ServerPriority: 0 normal, 1 high, 2 low. */
	priority: number;
	isStatic: boolean;
	failedCount: number;
}

/** The first one is the connected server. */
export const SERVERS: FixtureServer[] = [
	{
		name: 'Sunrise Server No.1',
		description: 'No logs, no filters',
		ip: '203.0.113.10',
		port: 4661,
		users: 184230,
		maxUsers: 250000,
		files: 24810332,
		ping: 38,
		version: '17.15',
		priority: 1,
		isStatic: true,
		failedCount: 0,
	},
	{
		name: 'Byte Harbor',
		description: 'Community server',
		ip: '198.51.100.24',
		port: 4242,
		users: 96410,
		maxUsers: 150000,
		files: 11204410,
		ping: 74,
		version: '17.15',
		priority: 0,
		isStatic: true,
		failedCount: 0,
	},
	{
		name: 'Peerless Relay',
		description: '',
		ip: '192.0.2.77',
		port: 5661,
		users: 42115,
		maxUsers: 80000,
		files: 6030122,
		ping: 121,
		version: '17.14',
		priority: 0,
		isStatic: false,
		failedCount: 1,
	},
	{
		name: 'Nordic Mule',
		description: 'Scandinavian mirror',
		ip: '203.0.113.201',
		port: 4661,
		users: 15320,
		maxUsers: 50000,
		files: 2410883,
		ping: 63,
		version: '17.15',
		priority: 2,
		isStatic: false,
		failedCount: 0,
	},
	{
		name: 'Old Faithful',
		description: 'Legacy server, often down',
		ip: '198.51.100.250',
		port: 4661,
		users: 0,
		maxUsers: 20000,
		files: 0,
		ping: 0,
		version: '16.50',
		priority: 2,
		isStatic: false,
		failedCount: 7,
	},
];

/** Servers "found" when the list is refreshed from a server.met URL. */
export const EXTRA_SERVERS: FixtureServer[] = [
	{
		name: 'Fresh Harvest',
		description: 'Just added from server.met',
		ip: '192.0.2.150',
		port: 4661,
		users: 8210,
		maxUsers: 30000,
		files: 1204110,
		ping: 88,
		version: '17.15',
		priority: 0,
		isStatic: false,
		failedCount: 0,
	},
	{
		name: 'Mule Depot',
		description: '',
		ip: '203.0.113.99',
		port: 4232,
		users: 27700,
		maxUsers: 60000,
		files: 3920441,
		ping: 52,
		version: '17.15',
		priority: 0,
		isStatic: false,
		failedCount: 0,
	},
];

export const CLIENT_NAMES = [
	'http://emule-project.net',
	'http://www.aMule.org',
	'Kobayashi',
	'mule_94',
	'Anonymous',
	'sharefriend',
	'dl_station',
	'ed2k-fan',
	'nightowl',
	'seedbox-01',
	'Pepe',
	'Amelie',
	'zeta_ray',
	'archivist',
	'TheCollector',
	'nas-basement',
];

export const CLIENT_SOFTWARE: { software: string; versions: string[] }[] = [
	{ software: 'eMule', versions: ['0.50a', '0.51d', '0.70b'] },
	{ software: 'aMule', versions: ['2.3.3', '2.3.2', '3.0.0', '3.0.1'] },
	{ software: 'MLDonkey', versions: ['3.1.7'] },
	{ software: 'Shareaza', versions: ['2.7.10'] },
];

/** amule.conf values as AmuledService.getConfig() reports them (numbers as strings, flags as booleans). */
export const AMULE_CONFIG: Record<string, string | boolean> = {
	nick: 'http://www.aMule.org',
	tcpPort: '4662',
	udpPort: '4672',
	maxSources: '300',
	maxConnections: '500',
	maxConnectionsPerFiveSeconds: '20',
	slotAllocation: '2',
	queueSizePref: '50',
	fileBufferSizePref: '16',
	downloadCap: '3072',
	uploadCap: '1024',
	maxUpload: '120',
	maxDownload: '0',
	ed2k: true,
	kad: true,
	autoconnect: true,
	reconnect: true,
	upnp: false,
	obfuscationRequested: true,
	obfuscationRequired: false,
	smartIdCheck: true,
	ich: true,
	allocateFullFile: false,
	previewPrio: false,
	ipFilterClients: true,
	ipFilterServers: true,
	filterLanIps: true,
	paranoidFiltering: false,
	ipFilterAutoLoad: true,
	ipFilterUrl: 'http://upd.emule-security.org/ipfilter.zip',
	ed2kServersUrl: 'http://upd.emule-security.org/server.met',
	filterLevel: '127',
	ipFilterSystem: false,
};

/** Documentation-reserved address and AS number, so the dashboard never shows anyone's real network. */
export const PUBLIC_IP = '203.0.113.42';
export const VPN_FORWARDED_PORT = 45123;
export const IP_DETAILS = {
	ip: PUBLIC_IP,
	hostname: 'vpn-exit-42.example.net',
	city: 'Zürich',
	region: 'Zurich',
	country: 'CH',
	loc: '47.3769,8.5417',
	org: 'AS64496 Example VPN Networks',
	postal: '8001',
	timezone: 'Europe/Zurich',
};

export const TELEGRAM_USER = { id: 123456789, firstName: 'Ada', lastName: 'Mockwell', username: 'ada_mockwell', phone: '34600123456' };

export const TELEGRAM_CHATS: Chat[] = [
	{ id: '-1001234567890', title: 'Open Source ISOs', type: 'channel', indexing_enabled: 1 },
	{ id: '-1001234567891', title: 'Public Domain & Open Cinema', type: 'channel', indexing_enabled: 1 },
	{ id: '-1001234567892', title: 'Creative Commons Music', type: 'group', indexing_enabled: 1 },
	{ id: '-1001234567893', title: 'Friends & Family', type: 'group', indexing_enabled: 0 },
];

export interface FixtureTelegramFile {
	/** Index into TELEGRAM_CHATS. */
	chatIndex: number;
	messageId: number;
	topicName: string | null;
	name: string;
	size: number;
	mediaType: string;
	text: string;
}

export const TELEGRAM_FILES: FixtureTelegramFile[] = [
	{
		chatIndex: 0,
		messageId: 4021,
		topicName: null,
		name: 'openSUSE-Leap-15.6-DVD-x86_64.iso',
		size: gb(4.3),
		mediaType: 'document',
		text: 'Leap 15.6 DVD image, checksums in the pinned message',
	},
	{
		chatIndex: 1,
		messageId: 1877,
		topicName: 'Open movies',
		name: 'Tears of Steel (2012) 1080p (Blender Open Movie, CC BY).mkv',
		size: gb(3.1),
		mediaType: 'video',
		text: 'Blender Foundation open movie, share freely',
	},
	{
		chatIndex: 2,
		messageId: 9120,
		topicName: null,
		name: 'Free Music Archive - Ambient Selection Vol.2 (CC BY) [FLAC].zip',
		size: mb(318),
		mediaType: 'document',
		text: 'Lossless version of the compilation',
	},
	{
		chatIndex: 1,
		messageId: 1903,
		topicName: 'Silent era',
		name: 'A Trip to the Moon (1902, Georges Melies) public domain.mp4',
		size: mb(420),
		mediaType: 'video',
		text: 'Original black and white print',
	},
	{ chatIndex: 0, messageId: 4102, topicName: null, name: 'Fedora-Workstation-Live-x86_64-40.iso', size: mb(2214), mediaType: 'document', text: '' },
	{
		chatIndex: 2,
		messageId: 9188,
		topicName: null,
		name: 'Field Recordings Vol.2 (CC BY) [MP3].zip',
		size: mb(96),
		mediaType: 'document',
		text: 'Rain, trains and market ambience',
	},
	{
		chatIndex: 1,
		messageId: 2044,
		topicName: 'Documentaries',
		name: 'Apollo 11 EVA footage (NASA, public domain) 1080p.mkv',
		size: gb(2.4),
		mediaType: 'video',
		text: '',
	},
];

/** Telegram downloads tracked at start, by index into TELEGRAM_FILES. */
export const TELEGRAM_DOWNLOADS: { fileIndex: number; state: 'downloading' | 'queued' | 'completed' }[] = [
	{ fileIndex: 0, state: 'downloading' },
	{ fileIndex: 1, state: 'queued' },
	{ fileIndex: 2, state: 'completed' },
];

/** Random amuled log lines; placeholders are filled by MockWorld. Events the simulation produces (downloads added or completed, server connections) log themselves. */
export const LOG_TEMPLATES = [
	'Connecting to {server} ({serverIp} - {serverIp}:{port}) using protocol obfuscation.',
	'Connected to {server} with HighID',
	'New clientid is {id}',
	'Kad: Connected. Nodes: {n}',
	'Requesting sources from server for {file}',
	'Received {n} sources from Kad for {file}',
	'Downloading part {n} of {file} from {client}',
	'Hashing file: {file}',
	'Search request sent for "{word}"',
	'IP filter is filtering {n} IP addresses',
	'External connection: client authenticated ({ip})',
	'Upload slot given to {client} for {file}',
	'Client {client} ({ip}) requested {file}',
	'Disconnected from server (no response). Reconnecting...',
];

export const SEARCH_WORDS = ['debian', 'big buck bunny', 'goldberg variations', 'apollo 11', 'gutenberg', 'timelapse', 'field recordings', 'supertux'];

/**
 * Name templates for search results, by kind. {q} keeps the query as typed (spaces become dots), {Q} title-cases it.
 * Every template names free content (see the naming policy at the top of this file).
 */
export const SEARCH_TEMPLATES: Record<'video' | 'audio' | 'document' | 'software', string[]> = {
	video: [
		'{Q} - documentary ({year}) 1080p [CC BY].mkv',
		'{Q} - conference talk {year} 720p [CC BY-SA].mp4',
		'{Q} - lecture {m} (OpenCourseWare, CC BY-NC-SA).mp4',
		'{Q} ({year}) public domain film 720p.mp4',
		'{q}-{year}-timelapse-4k-cc0.mp4',
		'{Q} - community tutorial series, part {m} [CC BY].mkv',
	],
	audio: [
		'{Q} - Free Music Archive compilation ({year}) [CC BY] [MP3 320].zip',
		'{Q} - live at {city} ({year}) [CC BY-SA] [FLAC].zip',
		'{Q} - public domain recording (Musopen) [FLAC].zip',
		'{Q} - podcast episode {m} ({year}) [CC BY].mp3',
		'{Q} - field recordings, {city} ({year}) [CC0] [MP3].zip',
	],
	document: [
		'{Q} - Project Gutenberg ebook.epub',
		'{Q} - Wikibooks compilation ({year}) [CC BY-SA].pdf',
		'{Q} - official documentation {ver} (GPL).pdf',
		'{Q} - open textbook ({year}) [CC BY].pdf',
		'{Q} - technical report ({year}, public domain).pdf',
	],
	software: [
		'{q}-{ver}-linux-amd64.tar.gz',
		'{q}-{ver}-live-amd64.iso',
		'{Q} {ver} win64 portable (open source).zip',
		'{q}-{ver}-src.tar.xz',
		'{q}-{ver}-x86_64.AppImage',
	],
};

export const CITIES = ['Berlin', 'Madrid', 'Lisbon', 'Oslo', 'Tokyo', 'Montreal'];
