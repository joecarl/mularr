import { AmuleClient, AmuleFile, AmuleTransferringFile, AmuleUpDownClient, FileStatus, SearchType, ServerPriority } from 'amule-ec-client';
import type { AmuleCategory, SourceNameCount } from 'amule-ec-client';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs/promises';
import path from 'path';
import { __APP_CONFIG__ } from '../app-env';
import { container } from './container/ServiceContainer';
import { MainDB, DownloadDbRecord } from '../services/db/MainDB';
import { AppEvents, toDownloadEventPayload } from './AppEvents';
import { buildEd2kLink, parseEd2kLink } from './eD2kTools';
import { MediaCategory, ChunkInfo, TransferSource, TransferSourceNameCount } from './mediaprovider/types';
import { LoggerFactory } from './logging/Logger';

function normalizeCategoryName(name: string | null, ctgs: MediaCategory[]): string {
	const DEFAULT_VALUE = 'default';
	if (!name || !name.trim()) return DEFAULT_VALUE;
	const found = ctgs.find((c) => c.name === name);
	if (!found) return DEFAULT_VALUE;
	if (found.id === 0) return DEFAULT_VALUE;
	return name;
}

export const getCatByName = (ctgs: MediaCategory[], name: string) => {
	const cat = ctgs.find((c) => c.name === name);
	if (!cat) return ctgs.find((c) => c.id === 0); // Default category
	return cat;
};

/**
 * The EC library types every category field as optional, but the daemon always sends them. Normalize
 * once here so the rest of the app (and the frontend, through the wire contract) can rely on them.
 */
function toCategory(c: AmuleCategory): MediaCategory {
	return { id: c.id ?? 0, name: c.name ?? '', path: c.path ?? '', comment: c.comment ?? '', color: c.color ?? 0, priority: c.priority ?? 0 };
}

const execPromise = util.promisify(exec);

interface FileRefData {
	isEd2kLink: boolean;
	hash: string;
	name?: string;
	size?: number;
}

interface Download {
	rawLine: string;
	name?: string;
	size?: number;
	completed?: number;
	speed?: number;
	isCompleted?: boolean;
	progress?: number;
	sourceCount?: number;
	priority?: number;
	status?: string;
	statusId?: number;
	stopped?: boolean;
	remaining?: number;
	hash?: string;
	link?: string;
	timeLeft?: number;
	categoryName?: string | null;
	addedOn?: string | null;
	chunkInfo?: ChunkInfo;
	sources?: TransferSource[];
	sourceNames?: TransferSourceNameCount[];
	provider?: string;
	providerData?: any; // Raw data from the provider
}

function normalizeSourceNameCounts(sourceNames: SourceNameCount[] | undefined): TransferSourceNameCount[] {
	if (!sourceNames || sourceNames.length === 0) return [];
	return sourceNames.map((s) => ({ name: (s.name || '').trim(), count: Number(s.count || 0) })).filter((s) => !!s.name && s.count > 0);
}

function toTransferSourceFromClient(client: AmuleUpDownClient): TransferSource {
	return {
		clientName: client.clientName,
		ip: client.userIP,
		port: client.userPort,
		software: client.software,
		softwareVersion: client.softVerStr,
		downloadSpeed: client.downSpeed,
		uploadSpeed: client.upSpeed,
		availableParts: client.availableParts,
		remoteFilename: client.remoteFilename,
		sourceFrom: client.sourceFrom,
		remoteQueueRank: client.remoteQueueRank,
		waitingPosition: client.waitingPosition,
	};
}

export function normalizeChunkProgress(transfer: AmuleTransferringFile): ChunkInfo | null {
	const chunkInfo = transfer.chunkInfo;
	if (!chunkInfo) return null;

	return {
		chunkStates: chunkInfo.chunks,
		chunkAvailability: chunkInfo.availability,
		partCount: chunkInfo.partCount,
		sizeFull: chunkInfo.sizeFull,
	};
}

function getDataFromFileRef(hashOrLink: string): FileRefData | null {
	const ed2kMatch = parseEd2kLink(hashOrLink);
	if (ed2kMatch) {
		return {
			...ed2kMatch,
			isEd2kLink: true,
		};
	} else if (/^[a-fA-F0-9]{32}$/.test(hashOrLink)) {
		return {
			name: 'Unknown',
			size: 0,
			hash: hashOrLink.toLowerCase(),
			isEd2kLink: false,
		};
	}
	return null;
}

function findByHash<T extends AmuleFile>(downloads: T[], hash: string): T | null {
	const lowerHash = hash.toLowerCase();
	return downloads.find((d) => (d.fileHashHexString || '').toLowerCase() === lowerHash) || null;
}

export class AmuleService {
	private readonly logger = LoggerFactory.create(this);
	private readonly client = new AmuleClient({
		host: __APP_CONFIG__.amule.ec.host,
		port: __APP_CONFIG__.amule.ec.port,
		password: __APP_CONFIG__.amule.ec.password,
		timeout: 5000,
		requestTimeout: 5000,
	});
	private readonly events = container.get(AppEvents);
	private readonly db = container.get(MainDB);

	constructor() {
		//this.client.connection.setDebug(true);
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

		// Output format: "aMule x.y.z ..."
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
		} catch (error: any) {
			this.logger.error('EC Client Stats Error:', error.message);
			return { raw: 'Stats error' };
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
		} catch (error: any) {
			this.logger.error('EC Client Servers Error:', error.message);
			return { raw: 'Error getting servers', list: [] };
		}
	}

	async connectToServer(ip: string, port: number) {
		try {
			await this.client.connectToServer(ip, port);
		} catch (error) {
			this.logger.error('EC Client Connect Error:', error);
			throw error;
		}
	}

	async disconnectFromServer() {
		try {
			await this.client.disconnectFromServer();
		} catch (error) {
			this.logger.error('EC Client Disconnect Error:', error);
			throw error;
		}
	}

	async updateServerListFromUrl(url: string) {
		try {
			await this.client.updateServerListFromUrl(url);
		} catch (error) {
			this.logger.error('EC Client Update Server List Error:', error);
			throw error;
		}
	}

	async addServer(ip: string, port: number, name?: string) {
		try {
			await this.client.addServer(ip, port, name);
		} catch (error) {
			this.logger.error('EC Client Add Server Error:', error);
			throw error;
		}
	}

	async removeServer(ip: string, port: number) {
		try {
			await this.client.removeServer(ip, port);
		} catch (error) {
			this.logger.error('EC Client Remove Server Error:', error);
			throw error;
		}
	}

	/**
	 * The daemon identifies servers by ECID for the static/priority operations,
	 * but only reports it through the incremental update mechanism.
	 */
	private async resolveServerEcid(ip: string, port: number): Promise<number> {
		const update = await this.client.getUpdate();
		const server = (update.servers || []).find((s) => s.ip === ip && s.port === port);
		if (!server?.ecid) {
			throw new Error(`Server not found: ${ip}:${port}`);
		}
		return server.ecid;
	}

	async setServerPriority(ip: string, port: number, priority: ServerPriority) {
		try {
			const ecid = await this.resolveServerEcid(ip, port);
			await this.client.setServerPriority(ecid, priority);
		} catch (error) {
			this.logger.error('EC Client Set Server Priority Error:', error);
			throw error;
		}
	}

	async setServerStatic(ip: string, port: number, isStatic: boolean) {
		try {
			const ecid = await this.resolveServerEcid(ip, port);
			await this.client.setServerStatic(ecid, isStatic);
		} catch (error) {
			this.logger.error('EC Client Set Server Static Error:', error);
			throw error;
		}
	}

	async getSharedFiles() {
		try {
			const files = await this.client.getSharedFiles();
			if (files.length === 0) {
				this.logger.debug('!! NO Shared Files from EC Client');
			}
			const list = files.map((file) => ({
				...file,
				name: file.fileName,
				hash: file.fileHashHexString,
				size: file.sizeFull,
				path: file.filePath,
			}));
			return { raw: `Shared Files (${files.length})`, list: list };
		} catch (error: any) {
			this.logger.error('EC Client Shared Files Error:', error.message);
		}
		return { raw: 'Error getting shared files', list: [] };
	}

	async deleteSharedFile(hash: string): Promise<void> {
		const files = await this.client.getSharedFiles();
		const file = findByHash(files, hash);
		if (!file) throw new Error(`Shared file with hash ${hash} not found`);
		if (!file.filePath || !file.fileName) throw new Error(`No path available for shared file with hash ${hash}`);
		const filePath = path.join(file.filePath, file.fileName);
		await fs.unlink(filePath);
		this.logger.info(`Deleted shared file from disk: ${filePath}`);
		try {
			await this.client.reloadSharedFiles();
		} catch (e) {
			// The file is already gone; the shared list just stays stale until the next reload
			this.logger.warn('EC Client reloadSharedFiles failed after deleting a shared file:', e);
		}
	}

	async getTransfers(): Promise<{ raw: string; list: Download[]; categories: MediaCategory[] }> {
		try {
			const queue = await this.client.getDownloadQueueWithSources();
			//const queue = await this.client.getDownloadQueue();
			const categories = await this.getCategories();
			//console.log('Download Queue from EC Client:', queue);
			let dbRecords = this.db.getAllDownloads().filter((r) => !r.provider || r.provider === 'amule');

			// Cache the promise, not the result: the map below processes every record concurrently,
			// so caching the resolved value would still fire one EC request per record
			let sharedFiles: Promise<AmuleFile[]> | null = null;
			const getSharedFiles = () => {
				if (!sharedFiles) sharedFiles = this.client.getSharedFiles();
				return sharedFiles;
			};

			//console.log('Download Queue:', queue);
			const transfers = dbRecords.map(async (dbRecord) => {
				const queueFile = findByHash(queue, dbRecord.hash);
				//console.log('Matching queue file for hash', dbRecord.hash, ':', queueFile);

				if (!dbRecord.is_completed) {
					// Completed downloads may linger in the download queue (status COMPLETE, stopped)
					// until the daemon restarts — detect completion there too, not only via shared files.
					let completedFile: AmuleFile | null = null;
					if (queueFile) {
						if (queueFile.fileStatus === FileStatus.COMPLETE) completedFile = queueFile;
					} else {
						completedFile = findByHash(await getSharedFiles(), dbRecord.hash);
					}
					if (completedFile) {
						// Mark as completed in DB
						try {
							// Also update name and size from file info just in case they were never set
							this.db.updateDownloadCompletion(dbRecord.hash, true, completedFile.fileName, completedFile.sizeFull);
							dbRecord.is_completed = 1;
							dbRecord.name = completedFile.fileName ?? '';
							dbRecord.size = completedFile.sizeFull || 0;
							this.logger.info('Marked file as completed in DB:', dbRecord.hash, dbRecord.name);
							this.events.emit('download.completed', toDownloadEventPayload(dbRecord, 'amule'));
						} catch (e) {
							this.logger.error('DB update completion error:', e);
						}
					}
				}

				if (dbRecord.is_completed) {
					const sizeFull = dbRecord.size || 0;
					const mbSize = (sizeFull / (1024 * 1024)).toFixed(2);
					//console.log('File marked as completed in DB:', dbRecord.hash, dbRecord);
					const link = buildEd2kLink(dbRecord.name, sizeFull, dbRecord.hash);

					return {
						rawLine: `> ${dbRecord.name} [${mbSize} MB] Completed 100%`,
						name: dbRecord.name,
						size: sizeFull,
						progress: 1,
						status: 'Completed',
						statusId: 9, // Completed
						// The daemon reports completed downloads as stopped, so we do the same
						stopped: true,
						hash: dbRecord.hash,
						link: link,
						completed: sizeFull,
						speed: 0,
						sourceCount: 0,
						priority: 0,
						remaining: 0,
						addedOn: dbRecord.added_at,
						timeLeft: 0,
						categoryName: normalizeCategoryName(dbRecord.category_name, categories),
						isCompleted: true,
					} as Download;
				}

				if (!queueFile) {
					this.logger.warn('File not in queue or shared, skipping:', dbRecord.hash);
					return {
						rawLine: `> ${dbRecord.name} [${(dbRecord.size / (1024 * 1024)).toFixed(2)} MB] Not in queue`,
						name: dbRecord.name,
						size: dbRecord.size || 0,
						progress: 0,
						status: 'Not in queue',
						statusId: -1,
						stopped: false,
						hash: dbRecord.hash,
						link: '',
						completed: 0,
						speed: 0,
						sourceCount: 0,
						priority: 0,
						remaining: dbRecord.size || 0,
						addedOn: dbRecord.added_at,
						timeLeft: Infinity,
						categoryName: normalizeCategoryName(dbRecord.category_name, categories),
						isCompleted: false,
					} as Download;
				}

				const file = queueFile;
				const sizeFull = file.sizeFull || 0;
				const sizeDone = file.sizeDone || 0;
				const mbSize = (sizeFull / (1024 * 1024)).toFixed(2);
				const progress = sizeFull > 0 ? sizeDone / sizeFull : 0;
				const remaining = sizeFull - sizeDone;
				const timeLeft = remaining / (file.speed || 1); // in seconds

				return {
					rawLine: `> ${file.fileName} [${mbSize} MB] Status: ${file.fileStatus} ${(progress * 100).toFixed(1)}%`,
					name: file.fileName,
					size: sizeFull,
					progress: progress,
					status: String(file.fileStatus),
					statusId: file.fileStatus,
					stopped: file.stopped || false,
					hash: file.fileHashHexString,
					link: file.fileEd2kLink,
					completed: sizeDone,
					speed: file.speed || 0,
					sourceCount: file.sourceCount,
					priority: file.downPrio,
					remaining: remaining,
					timeLeft: timeLeft,
					categoryName: normalizeCategoryName(dbRecord?.category_name, categories),
					addedOn: dbRecord ? dbRecord.added_at : null,
					isCompleted: file.fileStatus === FileStatus.COMPLETE,
					chunkInfo: normalizeChunkProgress(file),
					sources: file.sources?.map((s) => toTransferSourceFromClient(s)) || [],
					sourceNames: normalizeSourceNameCounts(file.sourceNames),
					providerData: file,
				} as Download;
			});

			return {
				raw: `Downloads (${queue.length})`,
				list: await Promise.all(transfers),
				categories: categories,
			};
		} catch (error: any) {
			this.logger.error('EC Client Transfers Error:', error.message);
			return { raw: 'Error getting transfers', list: [], categories: [] };
		}
	}

	async clearCompletedTransfers(hashes?: string[]) {
		this.logger.info('Clearing completed transfers from DB and client queue', hashes ? `for hashes: ${hashes.join(', ')}` : 'for all');
		try {
			this.db.clearCompletedDownloads(hashes);
		} catch (e) {
			this.logger.error('DB Clear Completed Transfers Error:', e);
			throw e;
		}
	}

	private lastSearchResults: any[] = [];

	async startSearch(query: string, type: string = 'Global') {
		this.logger.info(`Starting Search for: ${query}`);

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
			this.logger.error('Start Search Error:', e);
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

	async getSearchResults() {
		try {
			const results = await this.client.searchResults();

			if (results && results.files) {
				const list = results.files.map((file) => {
					const hash = file.hash.toString('hex');
					const ed2k = buildEd2kLink(file.fileName, file.sizeFull, hash);

					return {
						name: file.fileName,
						size: file.sizeFull,
						sourceCount: file.sourceCount,
						completeSourceCount: file.completeSourceCount,
						downloadStatus: file.downloadStatus,
						type: '',
						link: ed2k,
						hash: hash,
						provider: 'amule',
					};
				});
				if (list.length > 0) {
					return { raw: `Found ${list.length} results`, list };
				}
			}

			return { raw: 'No results yet', list: [] };
		} catch (e: any) {
			this.logger.error('Get Search Results Error:', e);
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
			this.logger.error('Get Search Status Error:', e);

			return { raw: 'Error fetching search status', progress: 0 };
		}
	}

	async getUploadQueue() {
		try {
			const uploads = await this.client.getClientQueue();
			return {
				raw: `Uploads (${uploads.length})`,
				list: uploads,
			};
		} catch (e: any) {
			this.logger.error('EC Client Upload Queue Error:', e.message);
			return { raw: 'Error fetching upload queue', list: [] };
		}
	}

	async addDownload(link: string) {
		this.logger.info('Adding download:', link);

		// Parse metadata for DB
		let hash: string | undefined;

		const fileRefData = getDataFromFileRef(link);
		if (fileRefData) {
			hash = fileRefData.hash;
		} else {
			this.logger.warn('Failed to parse link for metadata:', link);
		}

		try {
			if (!fileRefData) {
				throw new Error('File ref error, cannot add download');
			} else if (!fileRefData.isEd2kLink) {
				// This will only work if the hash is in the last search results.
				await this.client.downloadSearchResult(Buffer.from(link, 'hex'));
				this.logger.debug(`Added download for hash ${link}`);
			} else if (fileRefData.isEd2kLink) {
				await this.client.downloadEd2kLink(link);
				this.logger.debug(`Added download for ed2k link`);
			}
		} catch (e) {
			this.logger.error('EC Client failed to add download:', e);
		}

		if (hash) {
			const added = await this.client.getDownloadQueue();
			const fileInQueue = added.find((f) => (f.fileHashHexString || '').toLowerCase() === hash!.toLowerCase());
			if (!fileInQueue) {
				this.logger.error('File not found in queue after adding, skipping DB insert:', hash);
				return;
			}
			const name = fileInQueue.fileName ?? 'Unknown';
			const size = fileInQueue.sizeFull ?? 0;
			try {
				this.db.addDownload(hash, name, size);
			} catch (dbe) {
				this.logger.error('DB Insert Error:', dbe);
			}
		}
	}

	async removeDownload(hash: string) {
		this.logger.info('Removing download:', hash);

		try {
			await this.client.deleteDownload(Buffer.from(hash, 'hex'));
			// Remove from DB if successfully deleted from client
		} catch (e) {
			this.logger.error('EC Client removeDownload failed:', e);
		}

		try {
			this.db.deleteDownload(hash.toLowerCase());
		} catch (e) {
			this.logger.error('Failed to remove download from DB:', e);
		}
	}

	async pauseDownload(hash: string) {
		this.logger.info('Pausing download:', hash);

		try {
			await this.client.pauseDownload(Buffer.from(hash, 'hex'));
		} catch (e) {
			this.logger.error('Pause Download Error:', e);
			throw e;
		}
	}

	async resumeDownload(hash: string) {
		this.logger.info('Resuming download:', hash);

		try {
			await this.client.resumeDownload(Buffer.from(hash, 'hex'));
		} catch (e) {
			this.logger.error('Resume Download Error:', e);
			throw e;
		}
	}

	async stopDownload(hash: string) {
		this.logger.info('Stopping download:', hash);

		try {
			await this.client.stopDownload(Buffer.from(hash, 'hex'));
		} catch (e) {
			this.logger.error('Stop Download Error:', e);
			throw e;
		}
	}

	async getUpdate() {
		try {
			const update = await this.client.getUpdate();
			return update;
		} catch (e) {
			this.logger.error('Get Update Error:', e);
			throw e;
		}
	}

	// ------------------------------
	// Categories CRUD
	// ------------------------------

	/**
	 * Get all categories from aMule
	 */
	async getCategories(): Promise<MediaCategory[]> {
		try {
			const cats = await this.client.getCategories();
			return (cats || []).map(toCategory);
		} catch (e: any) {
			this.logger.error('EC Client getCategories Error:', e.message);
			// Return empty list on error
			return [];
		}
	}

	/**
	 * Create a category. If id is not provided, choose next available id.
	 */
	async createCategory(data: Partial<MediaCategory>): Promise<MediaCategory> {
		const category: MediaCategory = {
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
			this.logger.error('Create Category Error:', e);
			throw e;
		}
	}

	/**
	 * Update a category by id using available client methods.
	 */
	async updateCategory(id: number, data: Partial<MediaCategory>): Promise<MediaCategory> {
		const cats = await this.getCategories();
		const existing = cats.find((c) => c.id === id);
		if (!existing) throw new Error(`Category with id ${id} not found`);

		const updated: MediaCategory = {
			...existing,
			...data,
			id,
		};

		try {
			// In many EC implementations, creating a category with an existing ID updates it
			await this.client.updateCategory(id, updated);

			if (id !== 0 && data.name && data.name !== existing.name) {
				try {
					this.db.updateCategoryName(existing.name, data.name);
				} catch (e) {
					this.logger.error('Failed to update category name in DB:', e);
				}
			}

			return updated;
		} catch (e) {
			this.logger.error('Update Category Error:', e);
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
			this.logger.error('Delete Category Error:', e);
			throw e;
		}
	}

	/**
	 * Set a file's category by its hash (hex string).
	 */
	async setFileCategory(hashHex: string, categoryId: number) {
		try {
			await this.client.setFileCategory(Buffer.from(hashHex, 'hex'), categoryId);
		} catch (e) {
			this.logger.error('Set File Category Error:', e);
			throw e;
		}
	}
}
