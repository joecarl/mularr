import { AmuleClient, SearchType } from 'amule-ec-client';
import { AmulecmdService } from './AmulecmdService';

export class AmuleService {
	private readonly host = process.env.AMULE_HOST || 'localhost';
	private readonly port = process.env.AMULE_PORT || '4712';
	private readonly password = process.env.AMULE_PASSWORD || 'secret';
	private readonly client = new AmuleClient({ host: this.host, port: parseInt(this.port), password: this.password });
	private readonly amulecmdService: AmulecmdService | null = null;

	constructor() {
		// Enable fallback logic for amulecmd unless disabled
		if (process.env.AMULECMD_FALLBACK !== 'false') {
			this.amulecmdService = new AmulecmdService();
		}
	}

	async getStats() {
		try {
			const stats = await this.client.getStats();
			return {
				...stats,
				raw: `Download: ${stats.downloadSpeed} bytes/s\nUpload: ${stats.uploadSpeed} bytes/s`,
			};
		} catch (error) {
			console.error('EC Client Stats Error:', error);
			// Fallback to amulecmd if EC fails
			if (this.amulecmdService) {
				return this.amulecmdService.getStats();
			}
			return { raw: 'Stats error and fallback disabled' };
		}
	}

	async getConfig() {
		// Currently relying on amulecmd/local file for config as EC client support is limited for config reading?
		if (this.amulecmdService) {
			return this.amulecmdService.getConfig();
		}
		// Todo: Implement EC-based config if possible
		return {
			raw: 'Config requires AMULECMD_FALLBACK=true',
			values: {},
		};
	}

	async getServers() {
		try {
			const servers = await this.client.getServerList();
			let connectedServer = null;
			try {
				const stats = await this.client.getStats();
				connectedServer = stats.connectedServer;
			} catch (e) {
				// ignore
			}

			return { list: servers, connectedServer };
		} catch (error) {
			console.error('EC Client Servers Error:', error);
			if (this.amulecmdService) {
				return this.amulecmdService.getServers();
			}
			return { raw: 'Error getting servers', list: [] };
		}
	}

	async connectToServer(ip: string, port: number) {
		try {
			await this.client.connectToServer(ip, port);
			return { success: true };
		} catch (error) {
			console.error('EC Client Connect Error:', error);
			throw error;
		}
	}

	async getTransfers() {
		try {
			const queue = await this.client.getDownloadQueue();
			const transfers = queue.map((file) => {
				// FileStatus enum mapping
				const statusMap: Record<number, string> = {
					0: 'Downloading',
					1: 'Empty',
					2: 'Waiting for Hash',
					3: 'Hashing',
					4: 'Error',
					5: 'Insufficient Space',
					6: 'Unknown',
					7: 'Paused',
					8: 'Completing',
					9: 'Completed',
					10: 'Allocating',
				};
				const status = statusMap[file.fileStatus] || `Status: ${file.fileStatus}`;
				const sizeFull = file.sizeFull || 0;
				const sizeDone = file.sizeDone || 0;
				const mbSize = (sizeFull / (1024 * 1024)).toFixed(2);
				const progress = sizeFull > 0 ? sizeDone / sizeFull : 0;

				return {
					rawLine: `> ${file.fileName} [${mbSize} MB] ${status} ${(progress * 100).toFixed(1)}%`,
					name: file.fileName,
					size: sizeFull,
					progress: progress,
					status: status,
					hash: file.fileHashHexString,
					completed: sizeDone,
					speed: file.speed || 0,
					sources: file.sourceCount,
					priority: file.downPrio,
					remaining: sizeFull - sizeDone,
				};
			});

			return {
				raw: `Downloads (${queue.length})`,
				list: transfers,
			};
		} catch (error) {
			console.error('EC Client Transfers Error:', error);
			if (this.amulecmdService) {
				return this.amulecmdService.getTransfers();
			}
			return { raw: 'Error getting transfers', list: [] };
		}
	}

	private lastSearchResults: any[] = [];
	private isSearching = false;

	async startSearch(query: string, type: string = 'Global') {
		console.log(`[AmuleService] Starting Search for: ${query}`);
		this.isSearching = true;
		this.lastSearchResults = [];

		try {
			// Convert string type to enum if possible, default to Global
			// Options: Local, Global, Kad, Web
			let searchType = SearchType.GLOBAL;
			const t = type.toLowerCase();
			if (t === 'local') searchType = SearchType.LOCAL;
			else if (t === 'kad') searchType = SearchType.KAD;

			await this.client.searchAsync(query, searchType);
			return 'Search Started';
		} catch (e) {
			console.error('Start Search Error:', e);
			this.isSearching = false;
			throw e;
		}
	}

	async getSearchResults() {
		try {
			const results = await this.client.searchResults();

			if (results && results.files) {
				const list = results.files.map((file) => ({
					name: file.fileName,
					size: (file.sizeFull / (1024 * 1024)).toFixed(2), // MB string for frontend
					sources: file.sourceCount,
					completeSources: file.sourceCount,
					type: '', // File type extension often in name
					link: file.hash.toString('hex'), // Link is now the hash for downloading
					hash: file.hash.toString('hex'),
				}));

				return {
					raw: `Found ${list.length} results`,
					list: list,
				};
			}
			return { raw: 'No results yet', list: [] };
		} catch (e: any) {
			console.error('Get Search Results Error:', e);
			if (this.amulecmdService) {
				return this.amulecmdService.getSearchResults();
			}
			return { raw: 'Error fetching results', list: [] };
		}
	}

	async addDownload(link: string) {
		console.log('Adding download:', link);

		// If it looks like a hash (32 hex chars), use EC client
		if (/^[a-fA-F0-9]{32}$/.test(link)) {
			try {
				await this.client.downloadSearchResult(Buffer.from(link, 'hex'));
				return `Added download for hash ${link}`;
			} catch (e) {
				console.error('EC Add Download Error:', e);
				throw e;
			}
		}

		// Try to use EC client for ED2K links if supported
		if (link.startsWith('ed2k://')) {
			try {
				await this.client.downloadEd2kLink(link);
				return `Added download for ed2k link`;
			} catch (e) {
				console.warn('EC Client failed to add ed2k link, falling back to amulecmd:', e);
			}
		}

		if (this.amulecmdService) {
			return this.amulecmdService.addDownload(link);
		}

		throw new Error('Could not add download. Fallback disabled.');
	}
}
