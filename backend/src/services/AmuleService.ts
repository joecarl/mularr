import { AmuleClient, SearchType, type AmuleCategory } from 'amule-ec-client';
import { AmulecmdService } from './AmulecmdService';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

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

	async getVersion() {
		// Get Version (cached or executed)
		let version = 'Unknown';
		let output = '';
		try {
			const { stdout } = await execPromise('amuled --version');
			output = stdout;
		} catch (e: any) {
			//console.warn('Failed to get amuled version:', e);
			// If the process exits non-zero, exec still populates stdout on the Error object
			output = e.stdout || '';
		}

		// Output format: "aMule 2.3.3 ..."
		const match = output.match(/amuled? (\d+\.\d+\.\d+)/i);
		if (match) {
			version = match[1];
		} else {
			version = output.split('\n')[0];
		}

		return version;
	}

	async getStats() {
		try {
			const stats = await this.client.getStats();

			// Calculate HighID
			// LowID is < 16777216
			const isHighID = (stats.ed2kId || stats.id || 0) >= 16777216;

			return {
				...stats,
				isHighID,
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
		throw new Error('getConfig not implemented in AmuleService');
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
			//console.log('Download Queue:', queue);
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
				const remaining = sizeFull - sizeDone;
				const timeLeft = remaining / (file.speed || 1); // in seconds

				return {
					rawLine: `> ${file.fileName} [${mbSize} MB] ${status} ${(progress * 100).toFixed(1)}%`,
					name: file.fileName,
					size: sizeFull,
					progress: progress,
					status: status,
					hash: file.fileHashHexString,
					link: file.fileEd2kLink,
					completed: sizeDone,
					speed: file.speed || 0,
					sources: file.sourceCount,
					priority: file.downPrio,
					remaining: remaining,
					timeLeft: timeLeft,
					categoryId: file.fileCat,
				};
			});

			// Get Shared Files (Completed Downloads)
			let sharedList: any[] = [];
			try {
				// Using any cast in case types are incomplete in amule-ec-client
				const sharedFiles = await this.client.getSharedFiles();
				if (Array.isArray(sharedFiles)) {
					// Create a Set of hashes currently in queue to avoid duplicates
					const queueHashes = new Set(transfers.map((t) => t.hash));

					sharedList = sharedFiles
						.filter((file) => !queueHashes.has(file.fileHashHexString)) // Deduplicate
						.map((file) => {
							const sizeFull = file.sizeFull || 0;
							const mbSize = (sizeFull / (1024 * 1024)).toFixed(2);

							return {
								rawLine: `> ${file.fileName} [${mbSize} MB] Completed 100%`,
								name: file.fileName,
								size: sizeFull,
								progress: 1,
								status: 'Shared',
								hash: file.fileHashHexString,
								link: file.fileEd2kLink,
								completed: sizeFull,
								speed: 0,
								sources: 0, // Shared files usually have request counts or known sources, ec-client maps it
								priority: 0,
								remaining: 0,
								addedOn: 0,
								timeLeft: 0,
							};
						});
				}
			} catch (e) {
				console.warn('Failed to get shared files (completed downloads):', e);
			}

			return {
				raw: `Downloads (${queue.length})`,
				downloads: transfers,
				shared: sharedList,
			};
		} catch (error) {
			console.error('EC Client Transfers Error:', error);
			// if (this.amulecmdService) {
			// 	return this.amulecmdService.getTransfers();
			// }
			return { raw: 'Error getting transfers', downloads: [], shared: [] };
		}
	}

	private lastSearchResults: any[] = [];
	private isSearching = false;

	async startSearch(query: string, type: string = 'Global') {
		console.log(`[AmuleService] Starting Search for: ${query}`);
		this.isSearching = true;

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

	async searchSynchronous(query: string, timeoutMs: number = 10000, resultsThreshold: number = 100) {
		await this.startSearch(query, 'Global');

		const start = Date.now();
		let results = { list: [] as any[] };

		while (Date.now() - start < timeoutMs) {
			await new Promise((resolve) => setTimeout(resolve, 1500));
			results = await this.getSearchResults();
			// If we have a decent amount of results, return early
			if (results.list.length >= resultsThreshold) break;
		}

		return results;
	}

	// static buildEd2kLink(name: string, size: number, hash: string): string {
	// 	return `ed2k://|file|${encodeURIComponent(name)}|${size}|${hash}|/`;
	// }

	async getSearchResults() {
		try {
			const results = await this.client.searchResults();
			//console.log('Search Results:', results);

			if (results && results.files) {
				const list = results.files.map((file) => {
					const hash = file.hash.toString('hex');
					// Construct a proper ed2k link: ed2k://|file|NAME|SIZE|HASH|/
					//const ed2k = AmuleService.buildEd2kLink(file.fileName, file.sizeFull, hash);

					return {
						name: file.fileName,
						size: (file.sizeFull / (1024 * 1024)).toFixed(2), // MB string for frontend
						sizeBytes: file.sizeFull,
						sources: file.sourceCount,
						completeSources: file.sourceCount,
						type: '',
						//link: ed2k,
						hash: hash,
					};
				});

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

	async getSearchStatus() {
		try {
			const progress = await this.client.searchStatus();
			return {
				raw: `Search Status: ${progress}`,
				progress: progress,
			};
		} catch (e: any) {
			console.error('Get Search Status Error:', e);

			return { raw: 'Error fetching search status', progress: 0 };
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

	async removeDownload(hash: string) {
		console.log('Removing download:', hash);
		try {
			await this.client.deleteDownload(Buffer.from(hash, 'hex'));
			return { success: true };
		} catch (e) {
			console.warn('EC Client removeDownload failed, falling back to amulecmd:', e);
		}

		if (this.amulecmdService) {
			return this.amulecmdService.removeDownload(hash);
		}

		throw new Error('Could not remove download. Fallback disabled.');
	}

	async pauseDownload(hash: string) {
		console.log('Pausing download:', hash);
		try {
			await this.client.pauseDownload(Buffer.from(hash, 'hex'));
			return { success: true };
		} catch (e) {
			console.error('Pause Download Error:', e);
			throw e;
		}
	}

	async resumeDownload(hash: string) {
		console.log('Resuming download:', hash);
		try {
			await this.client.resumeDownload(Buffer.from(hash, 'hex'));
			return { success: true };
		} catch (e) {
			console.error('Resume Download Error:', e);
			throw e;
		}
	}

	async stopDownload(hash: string) {
		console.log('Stopping download:', hash);
		try {
			await this.client.stopDownload(Buffer.from(hash, 'hex'));
			return { success: true };
		} catch (e) {
			console.error('Stop Download Error:', e);
			throw e;
		}
	}

	// ------------------------------
	// Categories CRUD
	// ------------------------------

	/**
	 * Get all categories from aMule
	 */
	async getCategories(): Promise<AmuleCategory[]> {
		try {
			const cats = await this.client.getCategories();
			return cats || [];
		} catch (e) {
			console.error('EC Client getCategories Error:', e);
			// No reliable fallback via amulecmd - return empty list
			return [];
		}
	}

	/**
	 * Create a category. If id is not provided, choose next available id.
	 */
	async createCategory(data: Partial<AmuleCategory>): Promise<AmuleCategory> {
		const category: AmuleCategory = {
			id: 0,
			name: data.name || `New Category`,
			path: data.path || '',
			comment: data.comment || '',
			color: typeof data.color === 'number' ? data.color : 0,
			priority: typeof data.priority === 'number' ? data.priority : 0,
		};

		try {
			await this.client.createCategory(category);
			return category;
		} catch (e) {
			console.error('Create Category Error:', e);
			throw e;
		}
	}

	/**
	 * Update a category by id using available client methods.
	 */
	async updateCategory(id: number, data: Partial<AmuleCategory>): Promise<AmuleCategory> {
		const cats = await this.getCategories();
		const existing = cats.find((c) => c.id === id);
		if (!existing) throw new Error(`Category with id ${id} not found`);

		const updated: AmuleCategory = {
			...existing,
			...data,
			id,
		};

		try {
			// In many EC implementations, creating a category with an existing ID updates it
			await this.client.updateCategory(id, updated);
			return updated;
		} catch (e) {
			console.error('Update Category Error:', e);
			throw e;
		}
	}

	/**
	 * Delete a category by id.
	 */
	async deleteCategory(id: number): Promise<void> {
		try {
			await this.client.deleteCategory(id);
		} catch (e) {
			console.error('Delete Category Error:', e);
			throw e;
		}
	}

	/**
	 * Set a file's category by its hash (hex string)
	 */
	async setFileCategory(hashHex: string, categoryId: number) {
		try {
			await this.client.setFileCategory(Buffer.from(hashHex, 'hex'), categoryId);
			return { success: true };
		} catch (e) {
			console.error('Set File Category Error:', e);
			throw e;
		}
	}
}
