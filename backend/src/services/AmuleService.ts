import { AmuleClient, AmuleFile, SearchType, type AmuleCategory } from 'amule-ec-client';
import { AmulecmdService } from './AmulecmdService';
import { exec } from 'child_process';
import util from 'util';
import db from '../db';
import { hash } from 'crypto';
import path from 'path';

const execPromise = util.promisify(exec);

interface FileRefData {
	isEd2kLink: boolean;
	hash: string;
	name?: string;
	size?: number;
}

interface DownloadDbRecord {
	hash: string;
	name: string;
	size: number;
	category_name: string | null;
	added_at: string;
	is_completed: number;
}

interface Download {
	rawLine: string;
	name?: string;
	size?: number;
	completed?: number;
	speed?: number;
	isCompleted?: boolean;
	progress?: number;
	sources?: number;
	priority?: number;
	status?: string;
	remaining?: number;
	hash?: string;
	link?: string;
	timeLeft?: number;
	categoryId?: number;
	categoryName?: string | null;
	addedOn?: string | null;
}

function getDataFromFileRef(hashOrLink: string): FileRefData | null {
	const ed2kMatch = hashOrLink.match(/^ed2k:\/\/\|file\|([^|]+)\|(\d+)\|([a-fA-F0-9]{32})\|/);
	if (ed2kMatch) {
		return {
			name: decodeURIComponent(ed2kMatch[1]),
			size: parseInt(ed2kMatch[2], 10),
			hash: ed2kMatch[3].toLowerCase(),
			isEd2kLink: true,
		};
	} else if (/^[a-fA-F0-9]{32}$/.test(hashOrLink)) {
		return {
			name: 'Unknown',
			size: 0,
			hash: hashOrLink.toLowerCase(),
			isEd2kLink: false,
		};
	} else {
		console.warn('Input does not appear to be a valid hash or ed2k link:', hashOrLink);
	}
	return null;
}

function findByHash<T extends AmuleFile>(downloads: T[], hash: string): T | null {
	const lowerHash = hash.toLowerCase();
	return downloads.find((d) => (d.fileHashHexString || '').toLowerCase() === lowerHash) || null;
}

export class AmuleService {
	private readonly host = process.env.AMULE_HOST || 'localhost';
	private readonly port = process.env.AMULE_PORT || '4712';
	private readonly password = process.env.AMULE_PASSWORD || 'secret';
	private readonly client = new AmuleClient({ host: this.host, port: parseInt(this.port), password: this.password });
	private readonly amulecmdService: AmulecmdService | null = null;

	constructor() {
		//this.client.connection.setDebug(true);
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
		} catch (error) {
			console.error('EC Client Connect Error:', error);
			throw error;
		}
	}

	async getSharedFiles() {
		try {
			const files = await this.client.getSharedFiles();
			if (files.length === 0) {
				console.log('!!!!!!!! NO Shared Files from EC Client');
			}
			const list = files.map((file) => ({
				name: file.fileName,
				hash: file.fileHashHexString,
				size: file.sizeFull,
				path: file.filePath,
			}));
			return { raw: `Shared Files (${files.length})`, list: list };
		} catch (error) {
			console.error('EC Client Shared Files Error:', error);
		}
		return { raw: 'Error getting shared files', list: [] };
	}

	async getTransfers(): Promise<{ raw: string; downloads: Download[] }> {
		try {
			const queue = await this.client.getDownloadQueue();
			//console.log('Download Queue from EC Client:', queue);
			let dbRecords = db.prepare<[], DownloadDbRecord>('SELECT * FROM downloads').all();

			let sharedFiles: AmuleFile[] | null = null;
			const getSharedFiles = async () => {
				if (sharedFiles === null) {
					sharedFiles = await this.client.getSharedFiles();
				}
				return sharedFiles;
			};

			//console.log('Download Queue:', queue);
			const transfers = dbRecords.map(async (dbRecord) => {
				const queueFile = findByHash(queue, dbRecord.hash);
				//console.log('Matching queue file for hash', dbRecord.hash, ':', queueFile);
				if (!queueFile && !dbRecord.is_completed) {
					const sharedFiles = await getSharedFiles();
					//console.log('Checking shared files for completion of hash:', dbRecord.hash, sharedFiles);
					const sharedFile = findByHash(sharedFiles, dbRecord.hash);
					//console.log('Shared file found:', sharedFile);
					if (sharedFile) {
						// Mark as completed in DB
						try {
							// Also update name and size from shared file info just in case they were never set
							db.prepare('UPDATE downloads SET is_completed = 1, name = ?, size = ? WHERE hash = ?').run(
								sharedFile.fileName,
								sharedFile.sizeFull,
								dbRecord.hash
							);
							dbRecord.is_completed = 1;
							dbRecord.name = sharedFile.fileName ?? '';
							dbRecord.size = sharedFile.sizeFull || 0;
							console.log('Marked file as completed in DB:', dbRecord.hash, dbRecord.name);
						} catch (e) {
							console.error('DB update completion error:', e);
						}
					}
				}

				if (dbRecord.is_completed) {
					const sizeFull = dbRecord.size || 0;
					const mbSize = (sizeFull / (1024 * 1024)).toFixed(2);
					//console.log('File marked as completed in DB:', dbRecord.hash, dbRecord);

					return {
						rawLine: `> ${dbRecord.name} [${mbSize} MB] Completed 100%`,
						name: dbRecord.name,
						size: sizeFull,
						progress: 1,
						status: 'Completed',
						hash: dbRecord.hash,
						link: '',
						completed: sizeFull,
						speed: 0,
						sources: 0,
						priority: 0,
						remaining: 0,
						addedOn: dbRecord.added_at,
						timeLeft: 0,
						categoryName: dbRecord.category_name,
						isCompleted: true,
					} as Download;
				}

				if (!queueFile) {
					console.warn('File not in queue or shared, skipping:', dbRecord.hash);
					return {
						rawLine: `> ${dbRecord.name} [${(dbRecord.size / (1024 * 1024)).toFixed(2)} MB] Not in queue`,
						name: dbRecord.name,
						size: dbRecord.size || 0,
						progress: 0,
						status: 'Not in queue',
						hash: dbRecord.hash,
						link: '',
						completed: 0,
						speed: 0,
						sources: 0,
						priority: 0,
						remaining: dbRecord.size || 0,
						addedOn: dbRecord.added_at,
						timeLeft: Infinity,
						categoryName: dbRecord.category_name,
						isCompleted: false,
					} as Download;
				}

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
				const file = queueFile;
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
					categoryName: dbRecord ? dbRecord.category_name : null,
					addedOn: dbRecord ? dbRecord.added_at : null,
					isCompleted: false,
				} as Download;
			});

			return {
				raw: `Downloads (${queue.length})`,
				downloads: await Promise.all(transfers),
			};
		} catch (error) {
			console.error('EC Client Transfers Error:', error);
			// if (this.amulecmdService) {
			// 	return this.amulecmdService.getTransfers();
			// }
			return { raw: 'Error getting transfers', downloads: [] };
		}
	}

	async clearCompletedTransfers() {
		console.log('[AmuleService] Clearing completed transfers from DB and client queue');
		try {
			db.exec('DELETE FROM downloads WHERE is_completed = 1');
		} catch (e) {
			console.error('DB Clear Completed Transfers Error:', e);
			throw e;
		}
	}

	private lastSearchResults: any[] = [];

	async startSearch(query: string, type: string = 'Global') {
		console.log(`[AmuleService] Starting Search for: ${query}`);

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

		// Parse metadata for DB
		let hash: string | undefined;

		const fileRefData = getDataFromFileRef(link);
		if (fileRefData) {
			hash = fileRefData.hash;
		} else {
			console.warn('Failed to parse link for metadata:', link);
		}

		try {
			if (!fileRefData) {
				throw new Error('File ref error, skipping direct add and going to fallback');
			} else if (!fileRefData.isEd2kLink) {
				await this.client.downloadSearchResult(Buffer.from(link, 'hex'));
				console.log(`Added download for hash ${link}`);
			} else if (fileRefData.isEd2kLink) {
				await this.client.downloadEd2kLink(link);
				console.log(`Added download for ed2k link`);
			}
		} catch (e) {
			console.warn('EC Client failed to add download, falling back to amulecmd:', e);

			if (this.amulecmdService) {
				this.amulecmdService.addDownload(link);
			}
		}

		if (hash) {
			const added = await this.client.getDownloadQueue();
			const fileInQueue = added.find((f) => (f.fileHashHexString || '').toLowerCase() === hash!.toLowerCase());
			const name = fileInQueue ? fileInQueue.fileName : 'Unknown';
			const size = fileInQueue ? fileInQueue.sizeFull || 0 : 0;
			try {
				const existing = db.prepare('SELECT hash FROM downloads WHERE hash = ?').get(hash);
				if (!existing) {
					db.prepare('INSERT INTO downloads (hash, name, size, category_name, added_at, is_completed) VALUES (?, ?, ?, ?, ?, 0)').run(
						hash,
						name,
						size,
						null,
						new Date().toISOString()
					);
				}
			} catch (dbe) {
				console.error('DB Insert Error:', dbe);
			}
		}
	}

	async removeDownload(hash: string) {
		console.log('Removing download:', hash);

		try {
			await this.client.deleteDownload(Buffer.from(hash, 'hex'));
			// Remove from DB if successfully deleted from client
		} catch (e) {
			console.warn('EC Client removeDownload failed, falling back to amulecmd:', e);

			if (this.amulecmdService) {
				await this.amulecmdService.removeDownload(hash);
			}
		}

		try {
			db.prepare('DELETE FROM downloads WHERE hash = ?').run(hash.toLowerCase());
		} catch (e) {
			console.error('Failed to remove download from DB:', e);
		}
	}

	async pauseDownload(hash: string) {
		console.log('Pausing download:', hash);
		try {
			await this.client.pauseDownload(Buffer.from(hash, 'hex'));
		} catch (e) {
			console.error('Pause Download Error:', e);
			throw e;
		}
	}

	async resumeDownload(hash: string) {
		console.log('Resuming download:', hash);
		try {
			await this.client.resumeDownload(Buffer.from(hash, 'hex'));
		} catch (e) {
			console.error('Resume Download Error:', e);
			throw e;
		}
	}

	async stopDownload(hash: string) {
		console.log('Stopping download:', hash);
		try {
			await this.client.stopDownload(Buffer.from(hash, 'hex'));
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
			const ctgs = await this.getCategories();
			// Get ctg with highest ID - should be the one we just created
			const created = ctgs.reduce((prev, current) => (prev.id > current.id ? prev : current));
			if (created.name !== category.name) {
				throw new Error('Failed to verify created category');
			}
			return created;
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

			// Update DB if name changed and category is not "All" (id 0)
			if (id !== 0 && data.name && data.name !== existing.name) {
				try {
					db.prepare('UPDATE downloads SET category_name = ? WHERE category_name = ?').run(data.name, existing.name);
				} catch (e) {
					console.error('Failed to update category name in DB:', e);
				}
			}

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

			// Update DB
			try {
				const cats = await this.getCategories();
				const cat = cats.find((c) => c.id === categoryId);
				const catName = categoryId === 0 ? '' : cat ? cat.name : null;
				// If categoryId is 0 (All) or not found, it might mean "General" or unassigned.
				// Assuming if cat found, we use name.
				if (catName !== null && catName !== undefined) {
					db.prepare('UPDATE downloads SET category_name = ? WHERE hash = ?').run(catName, hashHex.toLowerCase());
				}
			} catch (e) {
				console.error('DB update category error', e);
			}
		} catch (e) {
			console.error('Set File Category Error:', e);
			throw e;
		}
	}
}
